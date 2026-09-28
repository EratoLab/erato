//! What the bot does with each activity.
//!
//! Messages are acknowledged immediately and processed in the background
//! (Teams retries activities that take longer than a few seconds); invokes
//! (SSO token exchange, sign-in verification) are answered synchronously.

use super::TeamsBot;
use super::activity::{Activity, ConversationKind, IncomingFile, split_channel_thread};
use super::cards::{self, ApprovalSubmit};
use super::graph::{Graph, GraphIdentity, context_markdown};
use super::host::{Completion, GenerationUpdate, Host, Session, StartError};
use super::render::{self, Mention};
use super::streaming::{ReplyTarget, StreamingReply};
use super::user_token::oauth_card;
use axum::http::StatusCode;
use eyre::{Report, eyre};
use sea_orm::prelude::Uuid;
use serde_json::{Value, json};
use std::time::Duration;
use tokio::sync::mpsc;

const NEW_CHAT_COMMANDS: [&str; 3] = ["/new", "new chat", "neuer chat"];
const TYPING_INTERVAL: Duration = Duration::from_secs(4);
const CONTEXT_FILE_NAME: &str = "teams-conversation-context.md";

struct UserContext {
    session: Session,
    identity: GraphIdentity,
    graph_token: String,
}

pub(super) async fn on_message(bot: std::sync::Arc<TeamsBot>, host: Host, activity: Activity) {
    let Some(target) = reply_target(&bot, &activity) else {
        return;
    };
    if let Err(error) = process_message(&bot, &host, &activity, &target).await {
        tracing::error!(error = %error, "Teams message handling failed");
        let _ = target
            .send_text("Sorry, something went wrong while handling your message.")
            .await;
    }
}

async fn process_message(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
) -> Result<(), Report> {
    let kind = activity.conversation_kind();
    if let Some(submit) = activity.value.as_ref().and_then(ApprovalSubmit::from_value) {
        return on_approval(bot, host, activity, target, submit).await;
    }

    let text = activity.text_without_bot_mention();
    let files = activity.incoming_files();
    if text.is_empty() && files.is_empty() {
        if kind.is_personal() {
            target
                .send_text("Send me a message to start a chat with Erato.")
                .await?;
        }
        return Ok(());
    }

    let Some(user) = authenticate(bot, host, activity, target).await? else {
        return Ok(());
    };
    let (conversation_id, service_url, from_id) = routing(activity)?;
    let row = host
        .upsert_conversation(
            conversation_id,
            kind,
            user.session.user_id(),
            service_url,
            from_id,
        )
        .await?;

    if is_new_chat_command(&text) {
        host.set_current_chat(&row, None).await?;
        target
            .send_text("Started a new chat. Send your next message when you are ready.")
            .await?;
        return Ok(());
    }

    let (chat_id, _) = host
        .ensure_chat(&user.session, &row, bot.settings.assistant_id)
        .await?;

    let mut file_ids = Vec::new();
    for file in files {
        match intake_file(bot, host, &user, chat_id, &file).await {
            Ok(file_id) => file_ids.push(file_id),
            Err(error) => {
                tracing::warn!(%error, "Teams attachment could not be processed");
                target
                    .send_text(&format!(
                        "I could not read the attachment \"{}\"; continuing without it.",
                        file_name(&file)
                    ))
                    .await?;
            }
        }
    }
    if !kind.is_personal() && bot.settings.context_message_count > 0 {
        match conversation_context(bot, host, activity, &user, chat_id).await {
            Ok(Some(file_id)) => file_ids.push(file_id),
            Ok(None) => {}
            // Missing consent for Chat.Read/ChannelMessage.Read.All only costs
            // the context, not the answer.
            Err(error) => tracing::warn!(%error, "Teams conversation context unavailable"),
        }
    }

    let message = if text.is_empty() {
        "Please take a look at the attached file(s).".to_string()
    } else {
        text
    };
    match host.submit(&user.session, chat_id, message, file_ids).await {
        Ok(updates) => render_generation(bot, target, kind, updates).await,
        Err(error) => reply_start_error(target, error).await,
    }
}

async fn on_approval(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    submit: ApprovalSubmit,
) -> Result<(), Report> {
    let Some(user) = authenticate(bot, host, activity, target).await? else {
        return Ok(());
    };
    let message_id = Uuid::parse_str(&submit.message_id)?;
    let updates = match host
        .continue_approval(&user.session, message_id, submit.approval_id, submit.choice)
        .await
    {
        Ok(updates) => updates,
        Err(StartError::Rejected(_)) => {
            // Someone else's card, or already decided: the turn is not theirs.
            return target
                .send_text("This approval is not open for you anymore.")
                .await;
        }
        Err(error) => return reply_start_error(target, error).await,
    };
    // Replace the card so it cannot be answered twice.
    if let (Some(card_activity_id), Some(conversation_id), Some(service_url)) = (
        activity.reply_to_id.as_deref(),
        activity.conversation_id(),
        activity.service_url.as_deref(),
    ) {
        let tool_name = activity
            .value
            .as_ref()
            .and_then(|value| value.get("tool_name"))
            .and_then(Value::as_str)
            .unwrap_or("The tool");
        let decided_by = user.identity.display_name.as_deref().unwrap_or("you");
        let card = cards::decided_card(tool_name, submit.choice, decided_by);
        let update = json!({"type": "message", "id": card_activity_id, "attachments": [card]});
        if let Err(error) = bot
            .connector
            .update(service_url, conversation_id, card_activity_id, &update)
            .await
        {
            tracing::debug!(%error, "Could not replace the decided approval card");
        }
    }
    render_generation(bot, target, activity.conversation_kind(), updates).await
}

/// Resolve the Erato user and their Graph token; tells the user what to do
/// when either is missing.
async fn authenticate(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
) -> Result<Option<UserContext>, Report> {
    let (Some(entra_object_id), Some(from)) =
        (activity.from_aad_object_id(), activity.from.as_ref())
    else {
        return Ok(None);
    };
    let Some(user) = host.find_user(entra_object_id).await? else {
        let hint = match bot.settings.public_base_url.as_deref() {
            Some(base) => format!("Please open [Erato]({base}) once, then message me again."),
            None => "Please open Erato (or the Erato tab in Teams) once, then message me again."
                .to_string(),
        };
        target
            .send_text(&format!("I don't know you in Erato yet. {hint}"))
            .await?;
        return Ok(None);
    };
    let Some(graph_token) = bot
        .user_tokens
        .get_token(&bot.connector, &from.id, None)
        .await?
    else {
        send_sign_in(bot, activity, target).await?;
        return Ok(None);
    };

    let (identity, groups) = match bot.identities.get(entra_object_id).await {
        Some(cached) => cached,
        None => {
            let graph = Graph::new(bot.connector.http(), &graph_token);
            let identity = graph.me().await?;
            let groups = graph
                .member_groups(bot.settings.security_groups_only)
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(%error, "Could not resolve group memberships for a Teams user");
                    Vec::new()
                });
            let resolved = (identity, groups);
            bot.identities
                .insert(entra_object_id.to_string(), resolved.clone())
                .await;
            resolved
        }
    };
    if !identity.id.eq_ignore_ascii_case(entra_object_id) {
        // The token belongs to someone else; never act on it.
        bot.identities.invalidate(entra_object_id).await;
        return Err(eyre!("Graph identity does not match the Teams sender"));
    }
    let session = host
        .session(
            &user,
            &identity,
            groups,
            graph_token.clone(),
            activity.locale.as_deref(),
            &bot.settings.tenant_id,
        )
        .await?;
    Ok(Some(UserContext {
        session,
        identity,
        graph_token,
    }))
}

/// Ask for sign-in. Personal chats get the card directly; group chats and
/// channels get it in a private chat, so nobody signs in in front of others.
async fn send_sign_in(
    bot: &TeamsBot,
    activity: &Activity,
    target: &ReplyTarget<'_>,
) -> Result<(), Report> {
    let text = "Please sign in so I can work with your Microsoft 365 data.";
    if activity.conversation_kind().is_personal() {
        let resource = bot
            .user_tokens
            .sign_in_resource(&bot.connector, activity)
            .await?;
        let card = oauth_card(bot.user_tokens.connection_name(), &resource, text);
        target
            .send(&render::with_attachment(render::message(text, None), card))
            .await?;
        return Ok(());
    }

    let (_, service_url, from_id) = routing(activity)?;
    let bot_id = activity
        .recipient
        .as_ref()
        .map(|recipient| recipient.id.clone())
        .ok_or_else(|| eyre!("activity has no recipient"))?;
    let personal_id = bot
        .connector
        .create_personal_conversation(service_url, &bot_id, from_id, &bot.settings.tenant_id)
        .await?;
    let mut personal = activity.clone();
    if let Some(conversation) = personal.conversation.as_mut() {
        conversation.id = personal_id.clone();
        conversation.conversation_type = Some("personal".to_string());
    }
    let resource = bot
        .user_tokens
        .sign_in_resource(&bot.connector, &personal)
        .await?;
    let card = oauth_card(bot.user_tokens.connection_name(), &resource, text);
    bot.connector
        .send(
            service_url,
            &personal_id,
            &render::with_attachment(render::message(text, None), card),
        )
        .await?;
    target
        .send_text("I sent you a private message to sign in. Mention me again afterwards.")
        .await
}

/// Answer an `invoke` activity; the return value is the HTTP response.
pub(super) async fn on_invoke(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
) -> (StatusCode, Value) {
    let result = match activity.name.as_deref() {
        Some("signin/tokenExchange") => token_exchange(bot, host, activity).await,
        Some("signin/verifyState") => verify_state(bot, activity).await,
        _ => Ok((StatusCode::OK, json!({}))),
    };
    result.unwrap_or_else(|error| {
        tracing::warn!(%error, name = ?activity.name, "Teams invoke failed");
        (StatusCode::INTERNAL_SERVER_ERROR, json!({}))
    })
}

async fn token_exchange(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
) -> Result<(StatusCode, Value), Report> {
    let value = activity.value.clone().unwrap_or_default();
    let exchange_id = value.get("id").and_then(Value::as_str).unwrap_or_default();
    let connection_name = bot.user_tokens.connection_name();
    let sso_token = value
        .get("token")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let from_id = activity
        .from
        .as_ref()
        .map(|from| from.id.as_str())
        .unwrap_or_default();
    // Every open Teams client sends this invoke; exactly one gets processed.
    if !host.claim_token_exchange(exchange_id).await? {
        return Ok((StatusCode::OK, json!({})));
    }
    let token = bot
        .user_tokens
        .exchange(&bot.connector, from_id, sso_token)
        .await?;
    if token.is_none() {
        // 412 makes Teams fall back to the sign-in button (consent needed).
        return Ok((
            StatusCode::PRECONDITION_FAILED,
            json!({
                "id": exchange_id,
                "connectionName": connection_name,
                "failureDetail": "The token could not be exchanged.",
            }),
        ));
    }
    send_signed_in(bot, activity).await;
    Ok((
        StatusCode::OK,
        json!({"id": exchange_id, "connectionName": connection_name}),
    ))
}

async fn verify_state(bot: &TeamsBot, activity: &Activity) -> Result<(StatusCode, Value), Report> {
    let code = activity
        .value
        .as_ref()
        .and_then(|value| value.get("state"))
        .and_then(Value::as_str);
    let from_id = activity
        .from
        .as_ref()
        .map(|from| from.id.as_str())
        .unwrap_or_default();
    let token = bot
        .user_tokens
        .get_token(&bot.connector, from_id, code)
        .await?;
    if token.is_some() {
        send_signed_in(bot, activity).await;
        Ok((StatusCode::OK, json!({})))
    } else {
        Ok((StatusCode::PRECONDITION_FAILED, json!({})))
    }
}

async fn send_signed_in(bot: &TeamsBot, activity: &Activity) {
    if let Some(target) = reply_target(bot, activity)
        && let Err(error) = target
            .send_text("You're signed in. Send your question again and I'll get to work.")
            .await
    {
        tracing::debug!(%error, "Could not confirm the Teams sign-in");
    }
}

/// Store an attachment on the chat and return the Erato file ID.
async fn intake_file(
    bot: &TeamsBot,
    host: &Host,
    user: &UserContext,
    chat_id: Uuid,
    file: &IncomingFile,
) -> Result<Uuid, Report> {
    let max_bytes = host.max_upload_bytes();
    match file {
        IncomingFile::Download { name, download_url } => {
            let bytes = bot.connector.download(download_url, max_bytes).await?;
            host.store_file(&user.session, chat_id, name, None, bytes)
                .await
        }
        IncomingFile::InlineImage { name, content_url } => {
            let bytes = bot.connector.download(content_url, max_bytes).await?;
            host.store_file(&user.session, chat_id, name, None, bytes)
                .await
        }
        IncomingFile::Reference { name, url } => {
            let graph = Graph::new(bot.connector.http(), &user.graph_token);
            if host.sharepoint_enabled() {
                let item = graph.resolve_shared_item(url).await?;
                host.link_sharepoint_file(&user.session, chat_id, item)
                    .await
            } else {
                let bytes = graph.download_shared_item(url, max_bytes).await?;
                host.store_file(&user.session, chat_id, name, None, bytes)
                    .await
            }
        }
    }
}

/// The messages preceding a mention, attached as a markdown file (the same
/// shape the Teams tab's chat picker uploads).
async fn conversation_context(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    user: &UserContext,
    chat_id: Uuid,
) -> Result<Option<Uuid>, Report> {
    let graph = Graph::new(bot.connector.http(), &user.graph_token);
    let count = bot.settings.context_message_count;
    let conversation_id = activity.conversation_id().unwrap_or_default();
    let (label, mut messages) = match activity.conversation_kind() {
        ConversationKind::GroupChat => (
            "group chat",
            graph
                .group_chat_messages(conversation_id, count + 1)
                .await?,
        ),
        ConversationKind::Channel => {
            let (channel_id, root_id) = split_channel_thread(conversation_id);
            let (Some(team_id), Some(root_id)) = (activity.team_aad_group_id(), root_id) else {
                return Ok(None);
            };
            (
                "channel thread",
                graph
                    .channel_thread_messages(team_id, channel_id, root_id, count + 1)
                    .await?,
            )
        }
        ConversationKind::Personal => return Ok(None),
    };
    // The mention itself is the user message; do not repeat it as context.
    if let Some(current_id) = activity.id.as_deref() {
        messages.retain(|message| message.id != current_id);
    }
    let keep_from = messages.len().saturating_sub(count as usize);
    let messages = &messages[keep_from..];
    if messages.is_empty() {
        return Ok(None);
    }
    let markdown = context_markdown(label, messages);
    let file_id = host
        .store_file(
            &user.session,
            chat_id,
            CONTEXT_FILE_NAME,
            Some("text/markdown"),
            markdown.into_bytes(),
        )
        .await?;
    Ok(Some(file_id))
}

/// Stream (personal chats) or type-then-send (elsewhere) a generation, then
/// post approval cards for any tool calls it stopped on.
async fn render_generation(
    bot: &TeamsBot,
    target: &ReplyTarget<'_>,
    kind: ConversationKind,
    mut updates: mpsc::Receiver<GenerationUpdate>,
) -> Result<(), Report> {
    let streaming_enabled = kind.is_personal() && bot.settings.streaming;
    let mut stream = StreamingReply::new(target, streaming_enabled);
    let mut typing = tokio::time::interval(TYPING_INTERVAL);
    let mut completion: Option<Completion> = None;
    let mut failure: Option<String> = None;
    loop {
        tokio::select! {
            update = updates.recv() => match update {
                Some(GenerationUpdate::Text(text)) => stream.update(&text).await,
                Some(GenerationUpdate::Tool(name)) => {
                    stream.informative(&format!("Using {name}…")).await;
                }
                Some(GenerationUpdate::Completed(done)) => completion = Some(done),
                Some(GenerationUpdate::Failed(message)) => failure = Some(message),
                None => break,
            },
            _ = typing.tick(), if !streaming_enabled => {
                let _ = target.send(&render::typing()).await;
            }
        }
    }

    let Some(completion) = completion else {
        let text = match failure {
            Some(message) => format!("Sorry, something went wrong: {message}"),
            None => "Sorry, I did not get an answer this time.".to_string(),
        };
        return stream.finish(&text).await;
    };
    let link = render::chat_link(
        bot.settings.public_base_url.as_deref(),
        &completion.chat_id.to_string(),
    );
    stream
        .finish(&completion_text(&completion, link.as_deref()))
        .await?;
    send_approval_cards(target, &completion).await
}

pub(super) fn completion_text(completion: &Completion, chat_link: Option<&str>) -> String {
    let mut text = completion.text.clone();
    if text.is_empty() && !completion.approvals.is_empty() {
        text = "I need your approval before I continue.".to_string();
    }
    if completion.needs_client {
        let open = match chat_link {
            Some(link) => format!("[Open the chat in Erato]({link}) to continue."),
            None => "Open the chat in Erato to continue.".to_string(),
        };
        text = format!("{text}\n\n_This step needs the Erato app._ {open}");
    }
    if text.trim().is_empty() {
        text = "(The answer contained no text.)".to_string();
    }
    text
}

pub(super) async fn send_approval_cards(
    target: &ReplyTarget<'_>,
    completion: &Completion,
) -> Result<(), Report> {
    for approval in &completion.approvals {
        let mut card = cards::approval_card(approval);
        // Carried along so the decided card can name the tool.
        for action in card["content"]["actions"]
            .as_array_mut()
            .into_iter()
            .flatten()
        {
            action["data"]["tool_name"] = json!(approval.tool_name);
        }
        target
            .send(&json!({"type": "message", "attachments": [card]}))
            .await?;
    }
    Ok(())
}

async fn reply_start_error(target: &ReplyTarget<'_>, error: StartError) -> Result<(), Report> {
    let text = match error {
        StartError::Busy => "I'm still working on your previous message.".to_string(),
        StartError::Rejected(message) => format!("I could not start this request: {message}"),
    };
    target.send_text(&text).await
}

/// Push the answer of a background task reaction into every Teams
/// conversation whose current chat it belongs to.
pub(super) async fn deliver_proactive(
    bot: &TeamsBot,
    host: &Host,
    chat_id: Uuid,
    message_id: Uuid,
) -> Result<(), Report> {
    let conversations = host.conversations_for_chat(chat_id).await?;
    if conversations.is_empty() {
        return Ok(());
    }
    let Some(completion) = host.completion_for_message(chat_id, message_id).await? else {
        return Ok(());
    };
    let link = render::chat_link(
        bot.settings.public_base_url.as_deref(),
        &chat_id.to_string(),
    );
    let text = format!(
        "**A background task finished.**\n\n{}",
        completion_text(&completion, link.as_deref())
    );
    for conversation in conversations {
        let target = ReplyTarget {
            connector: &bot.connector,
            service_url: &conversation.service_url,
            conversation_id: &conversation.conversation_id,
            reply_to_id: None,
            mention: None,
        };
        target.send_text(&text).await?;
        send_approval_cards(&target, &completion).await?;
    }
    Ok(())
}

fn reply_target<'a>(bot: &'a TeamsBot, activity: &'a Activity) -> Option<ReplyTarget<'a>> {
    let (conversation_id, service_url, _) = routing(activity).ok()?;
    let group = !activity.conversation_kind().is_personal();
    Some(ReplyTarget {
        connector: &bot.connector,
        service_url,
        conversation_id,
        reply_to_id: if group { activity.id.as_deref() } else { None },
        mention: if group {
            activity.from.as_ref().map(|from| Mention {
                id: from.id.clone(),
                name: from.name.clone().unwrap_or_else(|| "you".to_string()),
            })
        } else {
            None
        },
    })
}

fn routing(activity: &Activity) -> Result<(&str, &str, &str), Report> {
    let conversation_id = activity
        .conversation_id()
        .ok_or_else(|| eyre!("activity has no conversation"))?;
    let service_url = activity
        .service_url
        .as_deref()
        .ok_or_else(|| eyre!("activity has no service URL"))?;
    let from_id = activity
        .from
        .as_ref()
        .map(|from| from.id.as_str())
        .filter(|id| !id.is_empty())
        .ok_or_else(|| eyre!("activity has no sender"))?;
    Ok((conversation_id, service_url, from_id))
}

fn is_new_chat_command(text: &str) -> bool {
    let normalized = text.trim().to_lowercase();
    NEW_CHAT_COMMANDS.contains(&normalized.as_str())
}

fn file_name(file: &IncomingFile) -> &str {
    match file {
        IncomingFile::Download { name, .. }
        | IncomingFile::InlineImage { name, .. }
        | IncomingFile::Reference { name, .. } => name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::teams_bot::cards::PendingApproval;

    fn completion(text: &str) -> Completion {
        Completion {
            chat_id: Uuid::nil(),
            message_id: Uuid::nil(),
            text: text.to_string(),
            approvals: Vec::new(),
            needs_client: false,
        }
    }

    #[test]
    fn recognizes_new_chat_commands() {
        assert!(is_new_chat_command(" /new "));
        assert!(is_new_chat_command("New Chat"));
        assert!(!is_new_chat_command("/new idea for the roadmap"));
    }

    #[test]
    fn completion_text_explains_approvals_and_client_steps() {
        let mut waiting = completion("");
        waiting.approvals.push(PendingApproval {
            message_id: "m".into(),
            approval_id: "a".into(),
            tool_name: "t".into(),
            input: json!({}),
        });
        assert_eq!(
            completion_text(&waiting, None),
            "I need your approval before I continue."
        );
        let mut client = completion("Partial answer");
        client.needs_client = true;
        assert_eq!(
            completion_text(&client, Some("https://erato.example/chat/1")),
            "Partial answer\n\n_This step needs the Erato app._ [Open the chat in Erato](https://erato.example/chat/1) to continue."
        );
        assert_eq!(
            completion_text(&completion(""), None),
            "(The answer contained no text.)"
        );
    }
}
