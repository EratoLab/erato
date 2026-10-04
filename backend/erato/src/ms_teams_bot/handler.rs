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
use super::streaming::{PROGRESS_INTERVAL, ReplyTarget, StreamingReply};
use super::user_token::sign_in_activity;
use axum::http::StatusCode;
use eyre::{Report, eyre};
use sea_orm::prelude::Uuid;
use serde_json::{Value, json};
use std::sync::Arc;
#[cfg(test)]
use std::time::Duration;
use tokio::sync::mpsc;

const NEW_CHAT_COMMANDS: [&str; 3] = ["/new", "new chat", "neuer chat"];
const CONTEXT_FILE_NAME: &str = "teams-conversation-context.md";

#[cfg(test)]
mod sign_in_tests;

struct UserContext {
    session: Session,
    identity: GraphIdentity,
    graph_token: String,
}

pub(super) async fn on_message(bot: Arc<TeamsBot>, host: Host, activity: Activity) {
    handle_message(bot, host, activity, true).await;
}

async fn handle_message(bot: Arc<TeamsBot>, host: Host, activity: Activity, allow_sign_in: bool) {
    let Some(target) = reply_target(&bot, &activity) else {
        return;
    };
    if let Err(error) = process_message(&bot, &host, &activity, &target, allow_sign_in).await {
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
    allow_sign_in: bool,
) -> Result<(), Report> {
    let kind = activity.conversation_kind();
    if let Some(submit) = activity.value.as_ref().and_then(ApprovalSubmit::from_value) {
        return on_approval(bot, host, activity, target, submit, allow_sign_in).await;
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

    let Some(user) = authenticate(bot, host, activity, target, allow_sign_in).await? else {
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

    let mut stream = StreamingReply::new(target, kind.is_personal() && bot.settings.streaming);
    stream.preparing("Preparing your request…").await;
    let prepared = async {
        let (chat_id, _) = while_working(
            &mut stream,
            host.ensure_chat(&user.session, &row, bot.settings.assistant_id),
        )
        .await?;

        let mut file_ids = Vec::new();
        for file in files {
            stream.preparing("Reading attachments…").await;
            match while_working(&mut stream, intake_file(bot, host, &user, chat_id, &file)).await {
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
            stream.preparing("Reading the conversation…").await;
            match while_working(
                &mut stream,
                conversation_context(bot, host, activity, &user, chat_id),
            )
            .await
            {
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
        stream.preparing("Preparing your request…").await;
        Ok::<_, Report>(
            while_working(
                &mut stream,
                host.submit(&user.session, chat_id, message, file_ids),
            )
            .await,
        )
    }
    .await;
    match prepared {
        Ok(Ok(updates)) => render_generation(bot, host, target, updates, stream).await,
        Ok(Err(error)) => stream.finish(&start_error_text(error)).await,
        Err(error) => {
            tracing::error!(%error, "Teams request preparation failed");
            stream
                .finish("Sorry, something went wrong while preparing your message.")
                .await
        }
    }
}

async fn on_approval(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    submit: ApprovalSubmit,
    allow_sign_in: bool,
) -> Result<(), Report> {
    let Some(user) = authenticate(bot, host, activity, target, allow_sign_in).await? else {
        return Ok(());
    };
    let message_id = Uuid::parse_str(&submit.message_id)?;
    let Some(decisions) = submit.decisions() else {
        return target
            .send_text("Please choose Approve or Deny for every item, then submit again.")
            .await;
    };
    let updates = match host
        .continue_approval(&user.session, message_id, decisions.clone())
        .await
    {
        Ok(updates) => updates,
        Err(StartError::DecisionsMismatch) => {
            // The open set changed since the card was posted: show it afresh.
            return match host.pending_approvals(&user.session, message_id).await? {
                Some(set) => {
                    target
                        .send_text("The approvals changed in the meantime. Here they are again:")
                        .await?;
                    send_approval_card(target, &set).await
                }
                None => {
                    target
                        .send_text("This approval is not open for you anymore.")
                        .await
                }
            };
        }
        Err(StartError::AlreadyDecided) => {
            return target.send_text("This approval was already decided.").await;
        }
        Err(StartError::Rejected(message)) => {
            tracing::debug!(%message, "Teams approval refused");
            // Someone else's card, or a chat the user cannot continue.
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
        let named: Vec<(String, cards::ApprovalChoice)> = decisions
            .iter()
            .enumerate()
            .map(|(index, (_, choice))| {
                let tool_name = submit
                    .tool_names
                    .get(index)
                    .cloned()
                    .unwrap_or_else(|| "The tool".to_string());
                (tool_name, *choice)
            })
            .collect();
        let decided_by = user.identity.display_name.as_deref().unwrap_or("you");
        let card = cards::decided_card(&named, decided_by);
        let summary = cards::decided_summary(&named, decided_by);
        let mut update = render::card_message(card, &summary);
        update["id"] = json!(card_activity_id);
        if let Err(error) = bot
            .connector
            .update(service_url, conversation_id, card_activity_id, &update)
            .await
        {
            tracing::debug!(%error, "Could not replace the decided approval card");
        }
    }
    let stream = StreamingReply::new(
        target,
        activity.conversation_kind().is_personal() && bot.settings.streaming,
    );
    render_generation(bot, host, target, updates, stream).await
}

/// Resolve the Erato user and their Graph token; tells the user what to do
/// when either is missing.
async fn authenticate(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    allow_sign_in: bool,
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
    let graph_token = bot
        .user_tokens
        .get_token(&bot.connector, &from.id, None)
        .await?;
    // Check after reading the token: another replica may have completed SSO
    // while GetToken was in flight. A retry must not also submit that message.
    // Resumed messages skip this check because they already own the claim.
    if allow_sign_in
        && host
            .has_sign_in_request(&bot.user_tokens.sign_in_scope(activity)?, activity)
            .await?
    {
        return Ok(None);
    }
    let Some(graph_token) = graph_token else {
        if !allow_sign_in {
            return Err(eyre!(
                "Teams Graph token unavailable after successful sign-in"
            ));
        }
        send_sign_in(bot, host, activity).await?;
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
async fn send_sign_in(bot: &TeamsBot, host: &Host, activity: &Activity) -> Result<(), Report> {
    let (_, service_url, from_id) = routing(activity)?;
    let mut personal = activity.clone();
    if !activity.conversation_kind().is_personal() {
        let bot_id = activity
            .recipient
            .as_ref()
            .map(|recipient| recipient.id.as_str())
            .ok_or_else(|| eyre!("activity has no recipient"))?;
        let personal_id = bot
            .connector
            .create_personal_conversation(service_url, bot_id, from_id, &bot.settings.tenant_id)
            .await?;
        if let Some(conversation) = personal.conversation.as_mut() {
            conversation.id = personal_id;
            conversation.conversation_type = Some("personal".to_string());
        }
    }
    let resource = bot
        .user_tokens
        .sign_in_resource(&bot.connector, &personal)
        .await?;
    let scope = bot.user_tokens.sign_in_scope(&personal)?;
    let exchange_id = resource
        .token_exchange_resource
        .as_ref()
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str);
    let card = sign_in_activity(&personal, bot.user_tokens.connection_name(), &resource)?;
    if host.remember_sign_in(&scope, exchange_id, activity).await?
        && let Err(error) = bot
            .connector
            .send(service_url, &scope.conversation_id, &card)
            .await
    {
        host.discard_sign_in(&scope, activity).await?;
        return Err(error);
    }
    Ok(())
}

/// Answer an `invoke` activity; the return value is the HTTP response.
pub(super) async fn on_invoke(
    bot: &Arc<TeamsBot>,
    host: &Host,
    activity: &Activity,
) -> (StatusCode, Value) {
    let result = match activity.name.as_deref() {
        Some("signin/tokenExchange") => token_exchange(bot, host, activity).await,
        Some("signin/verifyState") => verify_state(bot, host, activity).await,
        Some("signin/failure") => {
            // Do not log the whole payload: it may contain authentication data.
            tracing::warn!(code = ?activity.value.as_ref().and_then(|v| v.get("code")).and_then(|v| v.as_str()),
                "Teams client could not complete SSO");
            Ok((StatusCode::OK, json!({})))
        }
        _ => Ok((StatusCode::OK, json!({}))),
    };
    result.unwrap_or_else(|error| {
        tracing::warn!(%error, name = ?activity.name, "Teams invoke failed");
        (StatusCode::INTERNAL_SERVER_ERROR, json!({}))
    })
}

async fn token_exchange(
    bot: &Arc<TeamsBot>,
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
    let exchanged = json!({"id": exchange_id, "connectionName": connection_name});
    let not_exchanged = (
        StatusCode::PRECONDITION_FAILED,
        json!({
            "id": exchange_id,
            "connectionName": connection_name,
            "failureDetail": "The bot is unable to exchange token. Proceed with regular login.",
        }),
    );
    if value.get("connectionName").and_then(Value::as_str) != Some(connection_name) {
        return Ok((
            StatusCode::BAD_REQUEST,
            json!({"failureDetail": "Unknown OAuth connection"}),
        ));
    }
    if exchange_id.is_empty() || sso_token.is_empty() || from_id.is_empty() {
        return Ok(not_exchanged);
    }
    // Exchange first, deduplicate second (as Microsoft's middleware does):
    // when consent is missing, every client needs its own 412 to fall back to
    // the sign-in button, so a failed exchange must not claim the ID.
    let token = bot
        .user_tokens
        .exchange(&bot.connector, from_id, sso_token)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "Teams SSO token exchange failed");
            None
        });
    if token.is_none() {
        return Ok(not_exchanged);
    }
    resume_after_sign_in(bot, host, activity, Some(exchange_id)).await?;
    Ok((StatusCode::OK, exchanged))
}

async fn verify_state(
    bot: &Arc<TeamsBot>,
    host: &Host,
    activity: &Activity,
) -> Result<(StatusCode, Value), Report> {
    if let Some(connection) = activity
        .value
        .as_ref()
        .and_then(|v| v.get("connectionName"))
        .and_then(Value::as_str)
        && connection != bot.user_tokens.connection_name()
    {
        return Ok((StatusCode::BAD_REQUEST, json!({})));
    }
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
        resume_after_sign_in(bot, host, activity, None).await?;
        Ok((StatusCode::OK, json!({})))
    } else {
        Ok((StatusCode::PRECONDITION_FAILED, json!({})))
    }
}

async fn resume_after_sign_in(
    bot: &Arc<TeamsBot>,
    host: &Host,
    activity: &Activity,
    exchange_id: Option<&str>,
) -> Result<(), Report> {
    let scope = bot.user_tokens.sign_in_scope(activity)?;
    let pending = host.claim_pending_sign_ins(&scope, exchange_id).await?;
    if !pending.is_empty() {
        let bot = bot.clone();
        let host = host.clone();
        // Acknowledge the invoke without waiting for Graph, attachments or the
        // model. Only the replica which claimed the payload can submit it.
        tokio::spawn(async move {
            for activity in pending {
                handle_message(bot.clone(), host.clone(), activity, false).await;
            }
        });
    }
    Ok(())
}

/// Some interactive OAuth clients complete with an event rather than a
/// verifyState invoke. Read the token from the token service, not the payload.
pub(super) async fn on_token_response(bot: Arc<TeamsBot>, host: Host, activity: Activity) {
    if activity
        .value
        .as_ref()
        .and_then(|v| v.get("connectionName"))
        .and_then(Value::as_str)
        != Some(bot.user_tokens.connection_name())
    {
        return;
    }
    if let Err(error) = verify_state(&bot, &host, &activity).await {
        tracing::warn!(%error, "Teams OAuth completion failed");
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

/// Stream or edit one progress reply, then
/// post approval cards for any tool calls it stopped on.
async fn render_generation(
    bot: &TeamsBot,
    host: &Host,
    target: &ReplyTarget<'_>,
    mut updates: mpsc::Receiver<GenerationUpdate>,
    mut stream: StreamingReply<'_>,
) -> Result<(), Report> {
    stream.informative("Working on your request…").await;
    let mut timer = tokio::time::interval(PROGRESS_INTERVAL);
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut generation = None;
    let mut completion: Option<Completion> = None;
    let mut failure: Option<String> = None;
    loop {
        tokio::select! {
            update = updates.recv() => match update {
                Some(GenerationUpdate::Started { chat_id, message_id }) => {
                    generation = Some((chat_id, message_id));
                }
                Some(GenerationUpdate::Text(text)) => stream.update(&text).await,
                Some(GenerationUpdate::Status(status)) => {
                    stream.informative(&status).await;
                }
                Some(GenerationUpdate::Completed(done)) => completion = Some(done),
                Some(GenerationUpdate::Failed(message)) => failure = Some(message),
                None => break,
            },
            _ = timer.tick() => stream.flush().await,
        }
        if stream.is_cancelled() {
            if let Some((chat_id, message_id)) = generation {
                host.stop_generation(chat_id, message_id).await;
            }
            return Ok(());
        }
    }

    if failure.is_some() || completion.is_none() {
        let text = match failure {
            Some(message) => format!("Sorry, something went wrong: {message}"),
            None => "Sorry, I did not get an answer this time.".to_string(),
        };
        return stream.finish(&text).await;
    }
    let completion = completion.expect("completion checked above");
    let link = render::chat_link(
        bot.settings.public_base_url.as_deref(),
        &completion.chat_id.to_string(),
    );
    stream
        .finish_with_details(
            &completion_text(&completion, link.as_deref()),
            &completion.earlier_text,
        )
        .await?;
    if stream.is_cancelled() {
        return Ok(());
    }
    match &completion.approvals {
        Some(set) => send_approval_card(target, set).await,
        None => Ok(()),
    }
}

/// Keep preparation visible and enforce stream deadlines even if a download
/// or backend operation has not produced any events yet.
async fn while_working<T>(
    stream: &mut StreamingReply<'_>,
    work: impl std::future::Future<Output = T>,
) -> T {
    tokio::pin!(work);
    let mut timer = tokio::time::interval(PROGRESS_INTERVAL);
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            result = &mut work => return result,
            _ = timer.tick() => stream.flush().await,
        }
    }
}

pub(super) fn completion_text(completion: &Completion, chat_link: Option<&str>) -> String {
    let mut text = completion.text.clone();
    if completion.approvals.is_some() {
        text = if text.is_empty() {
            "I need your approval before I continue.".to_string()
        } else {
            format!("{text}\n\n**Approval needed to continue.**")
        };
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

/// One card for every open decision of a parked message.
async fn send_approval_card(
    target: &ReplyTarget<'_>,
    set: &cards::PendingApprovalSet,
) -> Result<(), Report> {
    let card = cards::approval_card(set);
    target
        .send(&render::card_message(card, &cards::approval_summary(set)))
        .await?;
    Ok(())
}

async fn reply_start_error(target: &ReplyTarget<'_>, error: StartError) -> Result<(), Report> {
    target.send_text(&start_error_text(error)).await
}

fn start_error_text(error: StartError) -> String {
    match error {
        StartError::Busy => "I'm still working on your previous message.".to_string(),
        StartError::Rejected(message) => format!("I could not start this request: {message}"),
        StartError::DecisionsMismatch | StartError::AlreadyDecided => {
            "This approval is not open anymore.".to_string()
        }
    }
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
        let mut reply = StreamingReply::new(&target, false);
        reply
            .finish_with_details(&text, &completion.earlier_text)
            .await?;
        if let Some(set) = &completion.approvals {
            send_approval_card(&target, set).await?;
        }
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
    use crate::ms_teams_bot::cards::{ApprovalKind, PendingApprovalItem, PendingApprovalSet};

    fn completion(text: &str) -> Completion {
        Completion {
            chat_id: Uuid::nil(),
            message_id: Uuid::nil(),
            text: text.to_string(),
            earlier_text: String::new(),
            approvals: None,
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
        waiting.approvals = Some(PendingApprovalSet {
            message_id: "m".into(),
            kind: ApprovalKind::McpTool,
            items: vec![PendingApprovalItem {
                approval_id: "a".into(),
                tool_name: "t".into(),
                input: json!({}),
            }],
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
