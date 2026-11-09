//! What the bot does with each activity.
//!
//! Messages are acknowledged immediately and processed in the background
//! (Teams retries activities that take longer than a few seconds); invokes
//! (SSO token exchange, sign-in verification) are answered synchronously.

use super::TeamsBot;
use super::activity::{Activity, ConversationKind, IncomingFile, split_channel_thread};
use super::cards::{self, ApprovalSubmit};
use super::controls::{self, ControlCommand};
use super::graph::{Graph, GraphIdentity, context_markdown};
use super::host::{
    ActionKind, Completion, GenerationUpdate, Host, RequestState, Session, StartError, TeamsRequest,
};
use super::nudge;
use super::reminders;
use super::render::{self, Mention};
use super::streaming::{PROGRESS_INTERVAL, ReplyTarget, StreamingReply};
use super::texts::{Lang, Msg};
use super::user_token::sign_in_activity;
use crate::db::entity::users;
use crate::services::scheduled_items::{
    self, DisplayStatus, Refusal, ScheduledItemErrorCode, wording,
};
use axum::http::StatusCode;
use chrono::Utc;
use chrono_tz::Tz;
use eyre::{Report, eyre};
use sea_orm::prelude::Uuid;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

const NEW_CHAT_COMMANDS: [&str; 3] = ["/new", "new chat", "neuer chat"];
const CONTEXT_FILE_NAME: &str = "teams-conversation-context.md";
/// Bounds how long one control delivery can hold the card lease.
const CONTROL_DELIVERY_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_CONTROL_RENDERS: usize = 3;

#[cfg(test)]
mod generation_tests;
#[cfg(test)]
mod sign_in_tests;

/// The sender as Erato knows them by Entra object id, looked up once per
/// activity. A failed lookup only fails what needs the user.
type Sender = Result<Option<users::Model>, Report>;

struct UserContext {
    session: Session,
    identity: GraphIdentity,
    graph_token: String,
}

pub(super) async fn on_message(bot: Arc<TeamsBot>, host: Host, activity: Activity) {
    handle_message(bot, host, activity, true).await;
}

async fn handle_message(bot: Arc<TeamsBot>, host: Host, activity: Activity, allow_sign_in: bool) {
    let (sender, lang) = sender_and_language(&bot, &host, &activity).await;
    let Some(target) = reply_target(&bot, &activity, lang) else {
        return;
    };
    if let Err(error) =
        process_message(&bot, &host, &activity, &target, sender, allow_sign_in).await
    {
        tracing::error!(error = %error, "Teams message handling failed");
        let _ = target.send_text(Msg::SomethingWentWrong.text(lang)).await;
    }
}

/// The sender, and the language to answer them in. What the sender's client
/// reports is stored first, so the stored language that decides is never
/// older than this activity and the bot does not switch language from one
/// reply to the next.
async fn sender_and_language(bot: &TeamsBot, host: &Host, activity: &Activity) -> (Sender, Lang) {
    let sender = match activity.from_aad_object_id() {
        Some(entra_object_id) => host.find_user(entra_object_id).await,
        None => Ok(None),
    };
    let user_id = match &sender {
        Ok(user) => user.as_ref().map(|user| user.id),
        Err(error) => {
            tracing::warn!(%error, "Could not look up the sender of a Teams activity");
            None
        }
    };
    if let Some(user_id) = user_id {
        remember_client_locale(host, user_id, activity).await;
    }
    let lang = host
        .reply_language(
            user_id,
            activity.client_locale().locale.as_deref(),
            &bot.settings.default_language,
        )
        .await;
    (sender, lang)
}

async fn process_message(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    sender: Sender,
    allow_sign_in: bool,
) -> Result<(), Report> {
    let kind = activity.conversation_kind();
    let lang = target.lang;
    if let Some(submit) = activity.value.as_ref().and_then(ApprovalSubmit::from_value) {
        return on_approval(bot, host, activity, target, sender, submit, allow_sign_in).await;
    }
    if let Some(submit) = activity
        .value
        .as_ref()
        .and_then(controls::Submit::from_value)
    {
        return on_control(bot, host, activity, target, sender, submit, allow_sign_in).await;
    }
    if let Some(submit) = activity
        .value
        .as_ref()
        .and_then(nudge::DeliverySubmit::from_value)
    {
        return on_delivery_action(bot, host, activity, target, sender, submit).await;
    }
    if let Some(submit) = activity
        .value
        .as_ref()
        .and_then(reminders::CardSubmit::from_value)
    {
        return match (submit.on_list(), submit.keeps()) {
            (false, true) => on_reminder_keep(bot, host, activity, target, sender, submit).await,
            (false, false) => on_reminder_cancel(bot, host, activity, target, sender, submit).await,
            (true, true) => on_list_keep(bot, host, activity, target, sender).await,
            (true, false) => on_list_cancel(bot, host, activity, target, sender, submit).await,
        };
    }

    let text = activity.text_without_bot_mention();
    let files = activity.incoming_files();
    if text.is_empty() && files.is_empty() {
        if kind.is_personal() {
            let app = &bot.settings.app_name;
            target
                .send_text(&Msg::SendAMessage.fill(lang, &[("app", app)]))
                .await?;
        }
        return Ok(());
    }

    // An unsubscribe must not depend on Graph consent: the activity is
    // verified at the route, and the sender is known by Entra object id.
    if let Some(command) = nudge::reminders_command(&text) {
        let Some(user) = known_user(bot, activity, target, sender).await? else {
            return Ok(());
        };
        return match command {
            nudge::RemindersCommand::Tips(tips_on) => {
                host.set_teams_nudges_opt_out(user.id, !tips_on).await?;
                target.send_text(&reminders_text(bot, tips_on, lang)).await
            }
            nudge::RemindersCommand::List => {
                let card = reminders_list_card(bot, host, user.id, None, lang).await?;
                target.send(&card).await.map(|_| ())
            }
        };
    }

    let Some(user) = authenticate(bot, host, activity, target, sender, allow_sign_in).await? else {
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
        target.send_text(Msg::NewChatStarted.text(lang)).await?;
        return Ok(());
    }

    if text.eq_ignore_ascii_case("/stop") {
        let active = match row.current_chat_id {
            Some(chat_id) => {
                host.active_request(&user.session, conversation_id, chat_id)
                    .await?
            }
            None => None,
        };
        if let Some(request) = active
            && let Some(message_id) = request.assistant_message_id
            && host
                .stop_request(&user.session, &request, message_id)
                .await?
        {
            update_controls(host, target, request.id).await;
        } else {
            target.send_text(Msg::NothingToStop.text(lang)).await?;
        }
        return Ok(());
    }

    // Resolve the request before displaying progress so a duplicate Teams
    // delivery cannot leave a second Working bubble behind.
    let (chat_id, _) = host
        .ensure_chat(&user.session, &row, bot.settings.assistant_id)
        .await?;
    let Some(source_id) = activity.id.as_deref() else {
        return target.send_text(Msg::MessageNotIdentified.text(lang)).await;
    };
    let Some(request) = host
        .remember_request(&user.session, conversation_id, source_id, chat_id)
        .await?
    else {
        return Ok(());
    };

    let mut stream = stream_for(bot, target, kind);
    stream.preparing(Msg::Preparing.text(lang)).await;
    let prepared = async {
        let mut file_ids = Vec::new();
        for file in files {
            match stream
                .during(
                    Msg::ReadingAttachments.text(lang),
                    intake_file(bot, host, &user, chat_id, &file),
                )
                .await
            {
                Ok(file_id) => file_ids.push(file_id),
                Err(error) => {
                    tracing::warn!(%error, "Teams attachment could not be processed");
                    target
                        .send_text(
                            &Msg::AttachmentUnreadable.fill(lang, &[("file", file_name(&file))]),
                        )
                        .await?;
                }
            }
        }
        if !kind.is_personal() && bot.settings.context_message_count > 0 {
            match stream
                .during(
                    Msg::ReadingConversation.text(lang),
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
            Msg::LookAtAttachedFiles.text(lang).to_string()
        } else {
            text
        };
        Ok::<_, Report>(
            stream
                .during(
                    Msg::Preparing.text(lang),
                    host.submit(&user.session, chat_id, message, file_ids),
                )
                .await,
        )
    }
    .await;
    match prepared {
        Ok(Ok(updates)) => {
            let user_id = user.session.user_id();
            render_generation(bot, host, target, user_id, updates, stream, Some(request)).await
        }
        Ok(Err(error)) => {
            let finished = stream.finish(&start_error_text(error, lang)).await;
            record_outcome(host, &request, RequestState::Failed).await;
            finished
        }
        Err(error) => {
            tracing::error!(%error, "Teams request preparation failed");
            let finished = stream.finish(Msg::PreparingFailed.text(lang)).await;
            record_outcome(host, &request, RequestState::Failed).await;
            finished
        }
    }
}

async fn on_approval(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    sender: Sender,
    submit: ApprovalSubmit,
    allow_sign_in: bool,
) -> Result<(), Report> {
    let Some(user) = authenticate(bot, host, activity, target, sender, allow_sign_in).await? else {
        return Ok(());
    };
    let lang = target.lang;
    let message_id = Uuid::parse_str(&submit.message_id)?;
    let Some(decisions) = submit.decisions() else {
        return target.send_text(Msg::ChooseEveryItem.text(lang)).await;
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
                    target.send_text(Msg::ApprovalsChanged.text(lang)).await?;
                    send_approval_card(target, &set, &bot.settings.app_name).await
                }
                None => {
                    target
                        .send_text(Msg::ApprovalNotOpenForYou.text(lang))
                        .await
                }
            };
        }
        Err(error) => return target.send_text(&approval_error_text(error, lang)).await,
    };
    // Replace the card so it cannot be answered twice.
    if let Some(card_activity_id) = activity.reply_to_id.as_deref() {
        let named: Vec<(String, cards::ApprovalChoice)> = decisions
            .iter()
            .enumerate()
            .map(|(index, (_, choice))| {
                let name = submit
                    .display_names
                    .get(index)
                    .cloned()
                    .unwrap_or_else(|| Msg::TheTool.text(lang).to_string());
                (name, *choice)
            })
            .collect();
        let decided_by = user
            .identity
            .display_name
            .as_deref()
            .unwrap_or(Msg::You.text(lang));
        let card = cards::decided_card(&named, decided_by, lang);
        let summary = cards::decided_summary(&named, decided_by, lang);
        let update = render::card_message(card, &summary);
        if let Err(error) = target.update(card_activity_id, update).await {
            tracing::debug!(%error, "Could not replace the decided approval card");
        }
    }
    let stream = stream_for(bot, target, activity.conversation_kind());
    let request = host.request_for_assistant(message_id).await?;
    let user_id = user.session.user_id();
    render_generation(bot, host, target, user_id, updates, stream, request).await
}

/// The reply to an approval answer that did not continue the response.
fn approval_error_text(error: StartError, lang: Lang) -> String {
    match error {
        StartError::AlreadyDecided => Msg::ApprovalAlreadyDecided.text(lang).to_string(),
        StartError::Rejected(message) => {
            tracing::debug!(%message, "Teams approval refused");
            // Someone else's card, or a chat the user cannot continue.
            Msg::ApprovalNotOpenForYou.text(lang).to_string()
        }
        StartError::Refused(reason) => reason.text(lang).to_string(),
        error => start_error_text(error, lang),
    }
}

/// An edit is only a proposal. It never starts a generation or repeats tools.
pub(super) async fn on_message_edit(bot: Arc<TeamsBot>, host: Host, activity: Activity) {
    let (sender, lang) = sender_and_language(&bot, &host, &activity).await;
    let Some(target) = reply_target(&bot, &activity, lang) else {
        return;
    };
    if let Err(error) = offer_edited_question(&bot, &host, &activity, &target, sender).await {
        tracing::warn!(%error, "Teams edited question could not be offered");
    }
}

async fn offer_edited_question(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    sender: Sender,
) -> Result<(), Report> {
    let (Some(source_id), Some(edited_at), Some(conversation)) = (
        activity.id.as_deref(),
        activity.timestamp,
        activity.conversation_id(),
    ) else {
        return Ok(());
    };
    let Some(user) = authenticate(bot, host, activity, target, sender, false).await? else {
        return Ok(());
    };
    let app = [("app", bot.settings.app_name.as_str())];
    let Some(request) = host
        .request_for_activity(&user.session, conversation, source_id)
        .await?
    else {
        return if activity.conversation_kind().is_personal() {
            target
                .send_text(&Msg::EditSavedResend.fill(target.lang, &app))
                .await
        } else {
            Ok(())
        };
    };
    if !host.request_is_current(&user.session, &request).await? {
        return target
            .send_text(&Msg::EditSavedNotLatest.fill(target.lang, &app))
            .await;
    }
    let text = activity.text_without_bot_mention();
    if text.trim().is_empty() {
        return Ok(());
    }
    if let Some(updated) = host.propose_edit(request.id, &text, edited_at).await? {
        update_controls(host, target, updated.id).await;
    }
    Ok(())
}

async fn on_control(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    sender: Sender,
    submit: controls::Submit,
    allow_sign_in: bool,
) -> Result<(), Report> {
    let Some(user) = authenticate(bot, host, activity, target, sender, allow_sign_in).await? else {
        return Ok(());
    };
    let lang = target.lang;
    let Some(request) = host
        .request_for_user(
            &user.session,
            activity.conversation_id().unwrap_or_default(),
            submit.request_id,
        )
        .await?
    else {
        return target.send_text(Msg::ControlUnavailable.text(lang)).await;
    };
    let target = &ReplyTarget {
        connector: target.connector,
        service_url: target.service_url,
        conversation_id: target.conversation_id,
        reply_to_id: (!activity.conversation_kind().is_personal())
            .then_some(request.source_activity_id.as_str()),
        mention: target.mention.clone(),
        lang,
    };
    let kind = match submit.command {
        ControlCommand::Stop => {
            return stop_from_card(host, &user.session, target, &request, submit.message_id).await;
        }
        ControlCommand::Retry => ActionKind::Retry,
        ControlCommand::Edit => ActionKind::Edit,
    };
    let Some(token) = submit.token else {
        return Ok(());
    };
    if request.running() {
        return target.send_text(Msg::StopOrWaitFirst.text(lang)).await;
    }
    // A claim moves the run ID, which a renderer still delivering in this chat
    // (such as an approval continuation) relies on.
    if host.generation_active(request.chat_id).await {
        return target.send_text(Msg::StillFinishing.text(lang)).await;
    }
    let Some(claimed) = host.claim_request_action(&request, token, kind).await? else {
        return target.send_text(Msg::ActionGone.text(lang)).await;
    };
    match host.revise_request(&user.session, &claimed, kind).await {
        Ok(updates) => {
            // The revision runs now; failing bookkeeping must not abandon it.
            let current = match host.reset_request_action(&claimed).await {
                Ok(current) => current,
                Err(error) => {
                    tracing::warn!(%error, "Teams revision state could not be reset");
                    Some(claimed)
                }
            };
            let stream = stream_for(bot, target, activity.conversation_kind());
            let user_id = user.session.user_id();
            render_generation(bot, host, target, user_id, updates, stream, current).await
        }
        Err(error @ (StartError::Busy | StartError::Internal)) => {
            host.restore_request_action(&claimed, token, &request)
                .await?;
            let text = match error {
                StartError::Busy => Msg::StillFinishing,
                _ => Msg::StartFailedTryButton,
            };
            target.send_text(text.text(lang)).await
        }
        Err(error) => {
            host.reject_request_action(&claimed, &request).await?;
            update_controls(host, target, request.id).await;
            reply_start_error(target, error).await
        }
    }
}

/// A button on a delivered card (a tip's "Don't remind me", a reminder's
/// Done and snooze buttons). The token is claimed once, for the user who got
/// the card in the conversation it was sent to, so a forwarded or replayed
/// card does nothing. No sign-in: an unsubscribe must work for someone whose
/// Graph consent never completes, and the token already binds recipient and
/// conversation. A reminder's buttons call the services the Scheduled page
/// calls and show the outcome on the card itself, which loses its buttons.
async fn on_delivery_action(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    sender: Sender,
    submit: nudge::DeliverySubmit,
) -> Result<(), Report> {
    let lang = target.lang;
    let Some(command) = submit.command() else {
        return target.send_text(Msg::ButtonNotSupported.text(lang)).await;
    };
    let Some(user) = known_user(bot, activity, target, sender).await? else {
        return Ok(());
    };
    if command == nudge::DeliveryCommand::ContinueChat {
        return continue_reminder_chat(host, activity, target, user.id, submit.delivery_id).await;
    }
    let conversation_id = activity.conversation_id().unwrap_or_default();
    if !host
        .claim_delivery_action(user.id, conversation_id, &submit)
        .await?
    {
        let text = match command {
            nudge::DeliveryCommand::OptOut => Msg::ButtonGone.text(lang).to_string(),
            _ => reminder_button_gone_text(scheduled_page_url(bot).as_deref(), lang),
        };
        return target.send_text(&text).await;
    }
    let note = match run_delivery_command(host, user.id, submit.delivery_id, command, lang).await {
        Ok(Some(note)) => note,
        Ok(None) => return target.send_text(&reminders_text(bot, false, lang)).await,
        Err(error) => {
            // Nothing changed, so the press may be tried again.
            tracing::error!(%error, delivery_id = %submit.delivery_id, "A delivered card's button failed");
            if let Err(error) = host.release_delivery_action(&submit).await {
                tracing::warn!(%error, delivery_id = %submit.delivery_id, "Could not release a delivered card's button");
            }
            return target.send_text(Msg::ButtonFailed.text(lang)).await;
        }
    };
    settle_delivered_card(host, target, submit.delivery_id, &note).await
}

/// Continue here on a delivered reminder: its linked chat becomes this
/// conversation's current chat, so the next message goes on there. The card
/// stays as it is, and the press works as often as the user likes.
async fn continue_reminder_chat(
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    user_id: Uuid,
    delivery_id: Uuid,
) -> Result<(), Report> {
    let lang = target.lang;
    let kind = activity.conversation_kind();
    if !kind.is_personal() {
        return target.send_text(Msg::ButtonNotSupported.text(lang)).await;
    }
    let Some(chat) = host.reminder_chat_to_continue(user_id, delivery_id).await? else {
        return target
            .send_text(Msg::ReminderChatUnavailable.text(lang))
            .await;
    };
    let (conversation_id, service_url, from_id) = routing(activity)?;
    let row = host
        .upsert_conversation(conversation_id, kind, user_id, service_url, from_id)
        .await?;
    host.set_current_chat(&row, Some(chat.id)).await?;
    let title = crate::models::chat::chat_title(
        chat.title_by_user_provided.as_deref(),
        chat.title_by_summary.as_deref(),
    )
    .unwrap_or(wording::untitled_chat(lang));
    target
        .send_text(&Msg::ContinuingChat.fill(lang, &[("chat", title)]))
        .await
}

/// Call the service behind a claimed button. `Err` only when that call
/// failed and changed nothing; a refusal is a note like any outcome. `None`
/// for the opt-out, which answers with a message instead of a note.
async fn run_delivery_command(
    host: &Host,
    user_id: Uuid,
    delivery_id: Uuid,
    command: nudge::DeliveryCommand,
    lang: Lang,
) -> Result<Option<String>, Report> {
    let (item, until) = match command {
        nudge::DeliveryCommand::OptOut => {
            host.set_teams_nudges_opt_out(user_id, true).await?;
            return Ok(None);
        }
        nudge::DeliveryCommand::Done => {
            return Ok(Some(
                match host.acknowledge_reminder(user_id, delivery_id).await? {
                    Ok(_) => Msg::MarkedDone.text(lang).to_string(),
                    Err(refusal) => reminder_refusal_note(refusal).text(lang).to_string(),
                },
            ));
        }
        nudge::DeliveryCommand::ContinueChat => {
            return Err(eyre!("Continue here is not a claimed button"));
        }
        nudge::DeliveryCommand::Snooze(choice) => match host
            .snooze_delivered_reminder(user_id, delivery_id, choice)
            .await?
        {
            Ok(snoozed) => snoozed,
            Err(refusal) => {
                return Ok(Some(reminder_refusal_note(refusal).text(lang).to_string()));
            }
        },
    };
    // The snooze is committed; from here on nothing may fail.
    let user_zone = host
        .stored_time_zone(user_id)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "Could not read the user's time zone");
            None
        });
    let zone = scheduled_items::zone_of(&item).unwrap_or(user_zone.unwrap_or(Tz::UTC));
    let time = wording::when(until, zone, user_zone, Utc::now(), lang);
    Ok(Some(Msg::SnoozedUntil.fill(lang, &[("time", &time)])))
}

/// Replace a delivered card with its settled form; when that fails, the note
/// goes out as a message.
pub(super) async fn settle_delivered_card(
    host: &Host,
    target: &ReplyTarget<'_>,
    delivery_id: Uuid,
    note: &str,
) -> Result<(), Report> {
    match host.delivered_card(delivery_id).await {
        Ok(Some((activity_id, content))) => {
            let card = nudge::settled_delivery_card(&content, delivery_id, note);
            match target.update(&activity_id, card).await {
                Ok(()) => return Ok(()),
                Err(error) => {
                    tracing::warn!(%error, %delivery_id, "Could not replace a delivered card")
                }
            }
        }
        Ok(None) => {}
        Err(error) => tracing::warn!(%error, %delivery_id, "Could not read a delivered card"),
    }
    target.send_text(note).await
}

/// "Cancel it" on a confirmation card. It works while the reminder is
/// upcoming, for the user whose reminder it is, with no sign-in, as the
/// delivered card's buttons. The outcome replaces the card in place, which
/// keeps Open in Scheduled; someone else's press only gets a reply that it is
/// not theirs to cancel.
async fn on_reminder_cancel(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    sender: Sender,
    submit: reminders::CardSubmit,
) -> Result<(), Report> {
    let lang = target.lang;
    let Some(user) = known_user(bot, activity, target, sender).await? else {
        return Ok(());
    };
    let scheduled_url = scheduled_page_url(bot);
    let note = match host.cancel_reminder(user.id, submit.item_id).await? {
        Ok(_) => Msg::ReminderCancelled.text(lang).to_string(),
        Err(refused) => match refused.code {
            ScheduledItemErrorCode::NotFound => {
                let reply = if host.reminder_exists(submit.item_id).await? {
                    Msg::ReminderNotYours
                } else {
                    Msg::ReminderGone
                };
                return target.send_text(reply.text(lang)).await;
            }
            ScheduledItemErrorCode::Finished => settled_note(
                host.reminder_status(user.id, submit.item_id).await?,
                scheduled_url.as_deref(),
                lang,
            ),
            _ => Msg::ReminderUnchangeable.text(lang).to_string(),
        },
    };
    if let Some(card_id) = activity.reply_to_id.as_deref()
        && let Some((confirmation, _)) = host
            .reminder_confirmation(user.id, submit.item_id, lang)
            .await?
    {
        let card = reminders::confirmation_card(
            &confirmation,
            scheduled_url.as_deref(),
            Some(&note),
            false,
        );
        match target.update(card_id, card).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                tracing::warn!(%error, "Could not replace a reminder's confirmation card")
            }
        }
    }
    target.send_text(&note).await
}

/// "Keep it" under a confirmation card's Cancel: the card goes back as it
/// stands, which folds the question away. Nothing is said, and someone
/// else's press changes nothing.
async fn on_reminder_keep(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    sender: Sender,
    submit: reminders::CardSubmit,
) -> Result<(), Report> {
    let (Ok(Some(user)), Some(card_id)) = (sender, activity.reply_to_id.as_deref()) else {
        return Ok(());
    };
    let scheduled_url = scheduled_page_url(bot);
    if let Some(card) = current_confirmation_card(
        host,
        user.id,
        submit.item_id,
        scheduled_url.as_deref(),
        target.lang,
    )
    .await?
        && let Err(error) = target.update(card_id, card).await
    {
        tracing::warn!(%error, "Could not put back a reminder's confirmation card");
    }
    Ok(())
}

/// The line a confirmation card ends with once its reminder is no longer
/// upcoming, as the web card's status reads.
fn settled_note(status: Option<DisplayStatus>, scheduled_url: Option<&str>, lang: Lang) -> String {
    let page = reminders::scheduled_page_link(scheduled_url, lang);
    match status {
        Some(DisplayStatus::Cancelled) => Msg::ReminderCancelled.text(lang).to_string(),
        Some(DisplayStatus::Failed) => Msg::ReminderNotDelivered.fill(lang, &[("page", &page)]),
        _ => Msg::ReminderAlreadyHappened.fill(lang, &[("page", &page)]),
    }
}

/// The confirmation card of one of the user's reminders as it stands now:
/// Cancel while it is upcoming, otherwise its status instead. `None` when it
/// is not theirs or no longer exists.
async fn current_confirmation_card(
    host: &Host,
    user_id: Uuid,
    item_id: Uuid,
    scheduled_url: Option<&str>,
    lang: Lang,
) -> Result<Option<Value>, Report> {
    let Some((confirmation, status)) = host.reminder_confirmation(user_id, item_id, lang).await?
    else {
        return Ok(None);
    };
    let upcoming = matches!(status, DisplayStatus::Scheduled | DisplayStatus::Snoozed);
    let note = (!upcoming).then(|| settled_note(Some(status), scheduled_url, lang));
    Ok(Some(reminders::confirmation_card(
        &confirmation,
        scheduled_url,
        note.as_deref(),
        note.is_none(),
    )))
}

/// One confirmation card per reminder the turn scheduled, after its answer,
/// then the list card when it listed the user's reminders and they have any.
/// A reminder the turn also cancelled is confirmed as cancelled. A card that
/// cannot be built or sent is logged: the reminder is stored and the answer
/// already went out.
pub(super) async fn send_reminder_confirmations(
    bot: &TeamsBot,
    host: &Host,
    target: &ReplyTarget<'_>,
    user_id: Uuid,
    reminders: &reminders::TurnReminders,
) {
    let scheduled_url = scheduled_page_url(bot);
    for item_id in &reminders.created {
        let card = match current_confirmation_card(
            host,
            user_id,
            *item_id,
            scheduled_url.as_deref(),
            target.lang,
        )
        .await
        {
            Ok(Some(card)) => card,
            Ok(None) => continue,
            Err(error) => {
                tracing::warn!(%error, %item_id, "Could not build a reminder's confirmation card");
                continue;
            }
        };
        if let Err(error) = target.send(&card).await {
            tracing::warn!(%error, %item_id, "Could not send a reminder's confirmation card");
        }
    }
    if !reminders.listed {
        return;
    }
    let card = match host.upcoming_reminders(user_id, target.lang).await {
        Ok(upcoming) if upcoming.is_empty() => return,
        Ok(upcoming) => reminders::list_card(&upcoming, base_url(bot), None, target.lang),
        Err(error) => {
            tracing::warn!(%error, "Could not build the reminders list card");
            return;
        }
    };
    if let Err(error) = target.send(&card).await {
        tracing::warn!(%error, "Could not send the reminders list card");
    }
}

fn base_url(bot: &TeamsBot) -> Option<&str> {
    bot.settings
        .public_base_url
        .as_deref()
        .map(|base| base.trim_end_matches('/'))
}

/// The user's upcoming reminders as the list card, with a note on the last
/// press.
async fn reminders_list_card(
    bot: &TeamsBot,
    host: &Host,
    user_id: Uuid,
    note: Option<&str>,
    lang: Lang,
) -> Result<Value, Report> {
    let upcoming = host.upcoming_reminders(user_id, lang).await?;
    Ok(reminders::list_card(&upcoming, base_url(bot), note, lang))
}

/// "Cancel it" on a row of the list card: the shared cancel for the user's
/// own reminder, as on the confirmation card. The list then replaces the card
/// in place, without that reminder and with a line on what happened; someone
/// else's press only gets a reply.
async fn on_list_cancel(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    sender: Sender,
    submit: reminders::CardSubmit,
) -> Result<(), Report> {
    let lang = target.lang;
    let Some(user) = known_user(bot, activity, target, sender).await? else {
        return Ok(());
    };
    let note = match host.cancel_reminder(user.id, submit.item_id).await? {
        Ok(item) => Msg::NamedReminderCancelled.fill(lang, &[("name", &item.name)]),
        Err(refused) => match refused.code {
            ScheduledItemErrorCode::NotFound if host.reminder_exists(submit.item_id).await? => {
                return target.send_text(Msg::ReminderNotYours.text(lang)).await;
            }
            ScheduledItemErrorCode::NotFound => Msg::ReminderGone.text(lang).to_string(),
            ScheduledItemErrorCode::Finished => settled_note(
                host.reminder_status(user.id, submit.item_id).await?,
                scheduled_page_url(bot).as_deref(),
                lang,
            ),
            _ => Msg::ReminderUnchangeable.text(lang).to_string(),
        },
    };
    replace_list_card(bot, host, activity, target, user.id, &note).await
}

/// "Keep it" on a row of the list card: the list goes back as it stands now,
/// which folds the question away. Someone else's press changes nothing.
async fn on_list_keep(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    sender: Sender,
) -> Result<(), Report> {
    let (Ok(Some(user)), Some(card_id)) = (sender, activity.reply_to_id.as_deref()) else {
        return Ok(());
    };
    let card = reminders_list_card(bot, host, user.id, None, target.lang).await?;
    if let Err(error) = target.update(card_id, card).await {
        tracing::warn!(%error, "Could not put back the reminders list card");
    }
    Ok(())
}

/// Replace the pressed list card with the current list and `note`; when that
/// fails, the note goes out as a message.
async fn replace_list_card(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    user_id: Uuid,
    note: &str,
) -> Result<(), Report> {
    if let Some(card_id) = activity.reply_to_id.as_deref() {
        let card = reminders_list_card(bot, host, user_id, Some(note), target.lang).await?;
        match target.update(card_id, card).await {
            Ok(()) => return Ok(()),
            Err(error) => tracing::warn!(%error, "Could not replace the reminders list card"),
        }
    }
    target.send_text(note).await
}

fn scheduled_page_url(bot: &TeamsBot) -> Option<String> {
    base_url(bot).map(|base| format!("{base}{}", scheduled_items::chat_tools::SCHEDULED_PATH))
}

/// Why a reminder's button did nothing, shown on the card in its place.
fn reminder_refusal_note(refusal: Refusal) -> Msg {
    match refusal {
        Refusal::NotFound => Msg::ReminderGone,
        Refusal::Finished => Msg::ReminderCancelled,
        Refusal::InFlight => Msg::ReminderArriving,
        Refusal::NextOccurrenceFirst => Msg::DueAgainFirst,
        Refusal::NoFutureOccurrence => Msg::TimeHasPassed,
        Refusal::NothingToSnooze | Refusal::NotFinished => Msg::ReminderUnchangeable,
    }
}

fn reminder_button_gone_text(scheduled_url: Option<&str>, lang: Lang) -> String {
    Msg::ReminderButtonGone.fill(
        lang,
        &[("page", &reminders::scheduled_page_link(scheduled_url, lang))],
    )
}

/// The sender as Erato knows them, by Entra object id alone: enough for
/// settings that must not depend on a Graph token.
async fn known_user(
    bot: &TeamsBot,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    sender: Sender,
) -> Result<Option<users::Model>, Report> {
    if activity.from_aad_object_id().is_none() {
        return Ok(None);
    }
    let Some(user) = sender? else {
        target
            .send_text(&unknown_user_text(bot, target.lang))
            .await?;
        return Ok(None);
    };
    Ok(Some(user))
}

fn reminders_text(bot: &TeamsBot, tips_on: bool, lang: Lang) -> String {
    let msg = if tips_on { Msg::TipsOn } else { Msg::TipsOff };
    msg.fill(lang, &[("app", &bot.settings.app_name)])
}

async fn stop_from_card(
    host: &Host,
    session: &Session,
    target: &ReplyTarget<'_>,
    request: &TeamsRequest,
    message_id: Option<Uuid>,
) -> Result<(), Report> {
    let stopped = match message_id {
        Some(message_id) => host.stop_request(session, request, message_id).await?,
        None => false,
    };
    if stopped {
        update_controls(host, target, request.id).await;
        return Ok(());
    }
    if request.running() && message_id == request.assistant_message_id {
        host.expire_request_controls(request).await?;
        update_controls(host, target, request.id).await;
    }
    target
        .send_text(Msg::NothingLeftToStop.text(target.lang))
        .await
}

async fn update_controls(host: &Host, target: &ReplyTarget<'_>, request_id: Uuid) {
    if let Err(error) = sync_controls(host, target, request_id).await {
        tracing::warn!(%error, "Teams response control could not be delivered; /stop remains available");
    }
}

/// Deliver the latest control state without holding a database transaction
/// across Connector calls. Concurrent callers only bump the version; the
/// lease holder keeps rendering until the version it delivered is the latest.
async fn sync_controls(
    host: &Host,
    target: &ReplyTarget<'_>,
    request_id: Uuid,
) -> Result<(), Report> {
    let owner = Uuid::new_v4();
    let Some(mut current) = host.claim_controls(request_id, owner).await? else {
        return Ok(());
    };
    let mut renders = 0;
    loop {
        renders += 1;
        let shown = current.control_activity_id.clone();
        let delivered =
            tokio::time::timeout(CONTROL_DELIVERY_TIMEOUT, deliver_controls(target, &current))
                .await
                .unwrap_or_else(|_| Err(eyre!("Teams response control delivery timed out")));
        let (card, failure) = match delivered {
            Ok(card) => (card, None),
            Err(error) => (shown, Some(error)),
        };
        let give_up = failure.is_some() || renders >= MAX_CONTROL_RENDERS;
        let next = host
            .release_controls(&current, owner, card.as_deref(), give_up)
            .await?;
        if let Some(error) = failure {
            return Err(error);
        }
        match next {
            Some(next) => current = next,
            None => return Ok(()),
        }
    }
}

/// Make the control card match `request`; returns the card now showing it.
async fn deliver_controls(
    target: &ReplyTarget<'_>,
    request: &TeamsRequest,
) -> Result<Option<String>, Report> {
    let shown = request.control_activity_id.as_deref();
    if !controls::should_show(request) {
        let Some(id) = shown else {
            return Ok(None);
        };
        if let Err(error) = target
            .connector
            .delete(target.service_url, target.conversation_id, id)
            .await
        {
            tracing::debug!(%error, "Could not remove redundant response controls");
            // At least remove the duplicate button if deleting its card fails.
            target
                .update(id, controls::activity(request, target.lang))
                .await?;
            return Ok(Some(id.to_string()));
        }
        return Ok(None);
    }
    let activity = controls::activity(request, target.lang);
    match shown {
        Some(id) => {
            target.update(id, activity).await?;
            Ok(Some(id.to_string()))
        }
        None => target.send(&activity).await,
    }
}

/// Record how the request ended. Delivery already happened, so failures are
/// only logged; `None` also means a newer run took the request over.
async fn record_outcome(
    host: &Host,
    request: &TeamsRequest,
    state: RequestState,
) -> Option<TeamsRequest> {
    match host.finish_request(request, state).await {
        Ok(updated) => updated,
        Err(error) => {
            tracing::warn!(%error, "Teams request outcome could not be recorded");
            None
        }
    }
}

async fn settle_controls(
    host: &Host,
    target: &ReplyTarget<'_>,
    request: &TeamsRequest,
    state: RequestState,
) {
    if record_outcome(host, request, state).await.is_some() {
        update_controls(host, target, request.id).await;
    }
}

fn stream_for<'a>(
    bot: &TeamsBot,
    target: &'a ReplyTarget<'a>,
    kind: ConversationKind,
) -> StreamingReply<'a> {
    StreamingReply::new(target, kind.is_personal() && bot.settings.streaming)
}

/// Resolve the Erato user and their Graph token; tells the user what to do
/// when either is missing.
async fn authenticate(
    bot: &TeamsBot,
    host: &Host,
    activity: &Activity,
    target: &ReplyTarget<'_>,
    sender: Sender,
    allow_sign_in: bool,
) -> Result<Option<UserContext>, Report> {
    let (Some(entra_object_id), Some(from)) =
        (activity.from_aad_object_id(), activity.from.as_ref())
    else {
        return Ok(None);
    };
    let Some(user) = sender? else {
        target
            .send_text(&unknown_user_text(bot, target.lang))
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
        send_sign_in(bot, host, activity, target.lang).await?;
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
        .await?
        .in_language(target.lang);
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
    host: &Host,
    activity: &Activity,
    lang: Lang,
) -> Result<(), Report> {
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
    let card = sign_in_activity(
        &personal,
        bot.user_tokens.connection_name(),
        &resource,
        &bot.settings.app_name,
        lang,
    )?;
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

/// Stream or edit one progress reply, then post approval cards for any tool
/// calls it stopped on and a confirmation for each reminder it scheduled.
async fn render_generation(
    bot: &TeamsBot,
    host: &Host,
    target: &ReplyTarget<'_>,
    user_id: Uuid,
    mut updates: mpsc::Receiver<GenerationUpdate>,
    mut stream: StreamingReply<'_>,
    mut request: Option<TeamsRequest>,
) -> Result<(), Report> {
    let lang = target.lang;
    stream.informative(Msg::Working.text(lang)).await;
    let mut timer = tokio::time::interval(PROGRESS_INTERVAL);
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut generation = None;
    let mut completion: Option<Completion> = None;
    let mut failure: Option<String> = None;
    let mut stop_requested = false;
    let mut native_stop_recorded = None;
    loop {
        tokio::select! {
            update = updates.recv() => {
                let Some(update) = update else {
                    break;
                };
                host.track_update(&mut request, &update, stream.native_stop_available()).await;
                match update {
                    GenerationUpdate::Started { chat_id, message_id } => {
                        generation = Some((chat_id, message_id));
                        native_stop_recorded = Some(stream.native_stop_available());
                        // Stop may arrive on the opening informative chunk before
                        // the backend has announced its saved assistant ID.
                        if stop_requested || stream.is_cancelled() {
                            stop_requested = true;
                            host.stop_generation(chat_id, message_id).await;
                            host.mark_request_stopping(&mut request).await;
                        }
                        if let Some(current) = &request {
                            update_controls(host, target, current.id).await;
                        }
                    }
                    GenerationUpdate::Text(text) => {
                        if !stop_requested {
                            stream.update(&text).await;
                        }
                    }
                    GenerationUpdate::Status(status) => stream.informative(&status).await,
                    GenerationUpdate::Completed(done) => completion = Some(done),
                    GenerationUpdate::Failed(message) => failure = Some(message),
                    GenerationUpdate::UserMessageSaved(_) | GenerationUpdate::ToolStarted => {}
                }
            }
            _ = timer.tick() => stream.flush().await,
        }
        if stream.is_cancelled() && !stop_requested {
            stop_requested = true;
            if let Some((chat_id, message_id)) = generation {
                host.stop_generation(chat_id, message_id).await;
            }
            host.mark_request_stopping(&mut request).await;
            if let Some(current) = &request {
                update_controls(host, target, current.id).await;
            }
            // Drain terminal events before offering Retry: tools and their
            // final effects may still be persisting after cancellation.
        }
        let native_stop = stream.native_stop_available();
        if !stop_requested && native_stop_recorded.is_some_and(|recorded| recorded != native_stop) {
            native_stop_recorded = Some(native_stop);
            host.track_native_stop(&mut request, native_stop).await;
            if let Some(current) = &request {
                update_controls(host, target, current.id).await;
            }
        }
    }

    if stop_requested || host.stop_was_requested(request.as_ref()).await {
        let finished = stream.finish_stopped().await;
        confirm_unfinished_turn(bot, host, target, user_id, completion.as_ref(), generation).await;
        if let Some(request) = &request {
            settle_controls(host, target, request, RequestState::Stopped).await;
        }
        return finished;
    }

    if failure.is_some() || completion.is_none() {
        let text = match failure {
            Some(message) => Msg::GenerationFailed.fill(lang, &[("reason", &message)]),
            None => Msg::NoAnswer.text(lang).to_string(),
        };
        let finished = stream.finish(&text).await;
        confirm_unfinished_turn(bot, host, target, user_id, completion.as_ref(), generation).await;
        if let Some(request) = &request {
            settle_controls(host, target, request, RequestState::Failed).await;
        }
        return finished;
    }
    let completion = completion.expect("completion checked above");
    let link = render::chat_link(
        bot.settings.public_base_url.as_deref(),
        &completion.chat_id.to_string(),
    );
    let sources = citation_sources(host, &completion).await;
    let delivered = stream
        .finish_with_sources(
            &completion_text(&completion, link.as_deref(), &bot.settings.app_name, lang),
            &completion.earlier_text,
            &sources,
            bot.settings.public_base_url.as_deref(),
        )
        .await;
    if stream.is_cancelled() {
        if let Some((chat_id, message_id)) = generation {
            host.stop_generation(chat_id, message_id).await;
        }
        let stopped = stream.finish_stopped().await;
        send_reminder_confirmations(bot, host, target, user_id, &completion.reminders).await;
        if let Some(request) = &request {
            settle_controls(host, target, request, RequestState::Stopped).await;
        }
        return delivered.and(stopped);
    }
    if delivered.is_ok() {
        send_reminder_confirmations(bot, host, target, user_id, &completion.reminders).await;
    }
    let approvals = match (&delivered, &completion.approvals) {
        (Ok(()), Some(set)) => send_approval_card(target, set, &bot.settings.app_name).await,
        _ => Ok(()),
    };
    if let Some(request) = &request {
        settle_controls(host, target, request, RequestState::Completed).await;
    }
    delivered.and(approvals)
}

/// Confirm the reminders a stopped or failed turn already scheduled: they are
/// stored and arrive either way. A turn that ended without its final event
/// has them in its saved message.
async fn confirm_unfinished_turn(
    bot: &TeamsBot,
    host: &Host,
    target: &ReplyTarget<'_>,
    user_id: Uuid,
    completion: Option<&Completion>,
    generation: Option<(Uuid, Uuid)>,
) {
    let reminders = match (completion, generation) {
        (Some(completion), _) => completion.reminders.clone(),
        (None, Some((chat_id, message_id))) => {
            match host.completion_for_message(chat_id, message_id).await {
                Ok(stored) => stored.map(|stored| stored.reminders).unwrap_or_default(),
                Err(error) => {
                    tracing::warn!(%error, %message_id, "Could not read the reminders a turn scheduled");
                    return;
                }
            }
        }
        (None, None) => return,
    };
    send_reminder_confirmations(bot, host, target, user_id, &reminders).await;
}

async fn citation_sources(
    host: &Host,
    completion: &Completion,
) -> Vec<super::citations::FileSource> {
    match host.citation_sources(completion).await {
        Ok(sources) => sources,
        Err(error) => {
            // Source enrichment must not turn a successful answer into a failure.
            tracing::warn!(%error, "Could not resolve Teams file citations");
            Vec::new()
        }
    }
}

pub(super) fn completion_text(
    completion: &Completion,
    chat_link: Option<&str>,
    app_name: &str,
    lang: Lang,
) -> String {
    let mut text = completion.text.clone();
    if completion.approvals.is_some() {
        text = if text.is_empty() {
            Msg::NeedApproval.text(lang).to_string()
        } else {
            format!("{text}\n\n**{}**", Msg::ApprovalNeededToContinue.text(lang))
        };
    }
    if completion.needs_client {
        let app = ("app", app_name);
        let open = match chat_link {
            Some(link) => Msg::OpenChatToContinue.fill(lang, &[app, ("link", link)]),
            None => Msg::OpenChatToContinuePlain.fill(lang, &[app]),
        };
        text = format!("{text}\n\n_{}_ {open}", Msg::NeedsApp.fill(lang, &[app]));
    }
    if text.trim().is_empty() {
        text = Msg::NoText.text(lang).to_string();
    }
    text
}

/// One card for every open decision of a parked message.
async fn send_approval_card(
    target: &ReplyTarget<'_>,
    set: &cards::PendingApprovalSet,
    app_name: &str,
) -> Result<(), Report> {
    let card = cards::approval_card(set, app_name, target.lang);
    let summary = cards::approval_summary(set, app_name, target.lang);
    target.send(&render::card_message(card, &summary)).await?;
    Ok(())
}

async fn reply_start_error(target: &ReplyTarget<'_>, error: StartError) -> Result<(), Report> {
    target
        .send_text(&start_error_text(error, target.lang))
        .await
}

fn start_error_text(error: StartError, lang: Lang) -> String {
    match error {
        StartError::Busy => Msg::Busy.text(lang).to_string(),
        // Erato words its own refusals in English only.
        StartError::Rejected(message) => match lang {
            Lang::En => Msg::CouldNotStart.fill(lang, &[("reason", &message)]),
            Lang::De => {
                tracing::debug!(%message, "Teams request refused");
                Msg::CouldNotStartPlain.text(lang).to_string()
            }
        },
        StartError::Refused(reason) => {
            Msg::CouldNotStart.fill(lang, &[("reason", reason.text(lang))])
        }
        StartError::DecisionsMismatch | StartError::AlreadyDecided => {
            Msg::ApprovalNotOpen.text(lang).to_string()
        }
        StartError::Internal => Msg::StartFailed.text(lang).to_string(),
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
    let sources = citation_sources(host, &completion).await;
    for conversation in conversations {
        // Nothing to answer: the result is in the conversation owner's language.
        let lang = host
            .stored_language(conversation.user_id, &bot.settings.default_language)
            .await;
        let text = format!(
            "**{}**\n\n{}",
            Msg::TaskFinished.text(lang),
            completion_text(&completion, link.as_deref(), &bot.settings.app_name, lang)
        );
        let target = ReplyTarget {
            connector: &bot.connector,
            service_url: &conversation.service_url,
            conversation_id: &conversation.conversation_id,
            reply_to_id: None,
            mention: None,
            lang,
        };
        let mut reply = StreamingReply::new(&target, false);
        reply
            .finish_with_sources(
                &text,
                &completion.earlier_text,
                &sources,
                bot.settings.public_base_url.as_deref(),
            )
            .await?;
        send_reminder_confirmations(
            bot,
            host,
            &target,
            conversation.user_id,
            &completion.reminders,
        )
        .await;
        if let Some(set) = &completion.approvals {
            send_approval_card(&target, set, &bot.settings.app_name).await?;
        }
    }
    Ok(())
}

/// Users are recognized once they opened Erato (web app or tab); say where.
fn unknown_user_text(bot: &TeamsBot, lang: Lang) -> String {
    let settings = &bot.settings;
    let name = &settings.app_name;
    let place = match (
        settings.public_base_url.as_deref(),
        settings.tab_name.as_deref(),
    ) {
        (Some(base), Some(tab)) => Msg::PlaceTabOrLink.fill(
            lang,
            &[("tab", tab), ("link", &format!("[{name}]({base})"))],
        ),
        (Some(base), None) => format!("[{name}]({base})"),
        (None, Some(tab)) => Msg::PlaceTab.fill(lang, &[("tab", tab)]),
        (None, None) => name.clone(),
    };
    Msg::UnknownUser.fill(lang, &[("app", name), ("place", &place)])
}

/// Someone has the bot in a personal chat for the first time: greet them and,
/// if Erato does not know them yet, say what to do before the first question.
pub(super) async fn on_bot_added(bot: Arc<TeamsBot>, host: Host, activity: Activity) {
    let (sender, lang) = sender_and_language(&bot, &host, &activity).await;
    let Some(target) = reply_target(&bot, &activity, lang) else {
        return;
    };
    let known_user = sender.ok().flatten();
    // Remember the personal conversation now, so a user the app was installed
    // for by policy can be reached (tips, reminders) before they ever write.
    if let Some(user) = &known_user
        && let Ok((conversation_id, service_url, from_id)) = routing(&activity)
        && let Err(error) = host
            .upsert_conversation(
                conversation_id,
                ConversationKind::Personal,
                user.id,
                service_url,
                from_id,
            )
            .await
    {
        tracing::warn!(%error, "Could not record the personal Teams conversation on install");
    }
    let settings = &bot.settings;
    let card = cards::welcome_card(
        &settings.app_name,
        known_user.is_some(),
        settings.tab_name.as_deref(),
        settings.public_base_url.as_deref(),
        lang,
    );
    let summary = Msg::WelcomeSummary.fill(lang, &[("app", &settings.app_name)]);
    if let Err(error) = target.send(&render::card_message(card, &summary)).await {
        tracing::warn!(%error, "Could not send the Teams welcome message");
    }
}

/// Best effort: a failed write must not cost the user their answer.
async fn remember_client_locale(host: &Host, user_id: Uuid, activity: &Activity) {
    if let Err(error) = host
        .record_client_locale(user_id, &activity.client_locale())
        .await
    {
        tracing::warn!(%error, "Could not store the Teams client's time zone and language");
    }
}

fn reply_target<'a>(
    bot: &'a TeamsBot,
    activity: &'a Activity,
    lang: Lang,
) -> Option<ReplyTarget<'a>> {
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
                name: from
                    .name
                    .clone()
                    .unwrap_or_else(|| Msg::MentionFallback.text(lang).to_string()),
            })
        } else {
            None
        },
        lang,
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
            reminders: Default::default(),
        }
    }

    #[test]
    fn a_gone_reminder_button_points_to_the_scheduled_page() {
        assert_eq!(
            reminder_button_gone_text(Some("https://erato.example.com/scheduled"), Lang::En),
            "This button was already used or has expired. You can find your reminders on the [Scheduled page](https://erato.example.com/scheduled)."
        );
        assert!(reminder_button_gone_text(None, Lang::En).ends_with("on the Scheduled page."));
        assert_eq!(
            reminder_button_gone_text(Some("https://erato.example.com/scheduled"), Lang::De),
            "Diese Schaltfläche wurde bereits verwendet oder ist abgelaufen. Ihre Erinnerungen finden Sie auf der Seite [„Geplant“](https://erato.example.com/scheduled)."
        );
    }

    #[test]
    fn a_german_answer_explains_approvals_and_client_steps_in_german() {
        let mut client = completion("Teilantwort");
        client.needs_client = true;
        assert_eq!(
            completion_text(
                &client,
                Some("https://hugo.example/chat/1"),
                "Hugo",
                Lang::De
            ),
            "Teilantwort\n\n_Dieser Schritt erfordert die Hugo-App._ [Öffnen Sie den Chat in Hugo](https://hugo.example/chat/1), um fortzufahren."
        );
        assert_eq!(
            start_error_text(StartError::Refused(Msg::ToolsMayHaveRun), Lang::De),
            "Ich konnte diese Anfrage nicht starten: Möglicherweise wurden bereits Tools ausgeführt. Senden Sie eine neue Anweisung, um fortzufahren, ohne deren Wirkung zu wiederholen."
        );
        assert_eq!(
            reminder_refusal_note(Refusal::NextOccurrenceFirst).text(Lang::De),
            "Nicht zurückgestellt: Diese Erinnerung ist bis dahin ohnehin wieder fällig oder war es schon."
        );
    }

    #[test]
    fn erato_refusals_keep_their_english_details_out_of_german_replies() {
        let rejected = || {
            StartError::Rejected(
                "Only one audio transcription attachment is allowed per message.".into(),
            )
        };
        assert_eq!(
            start_error_text(rejected(), Lang::En),
            "I could not start this request: Only one audio transcription attachment is allowed per message."
        );
        assert_eq!(
            start_error_text(rejected(), Lang::De),
            "Ich konnte diese Anfrage nicht starten."
        );
    }

    #[test]
    fn a_refused_approval_says_why_in_the_users_language() {
        assert_eq!(
            approval_error_text(StartError::Refused(Msg::ApprovalInParentChat), Lang::De),
            "Diese Genehmigung wird in dem Chat erteilt, der die Aufgabe gestartet hat."
        );
        assert_eq!(
            approval_error_text(StartError::Refused(Msg::ContinuesOnItsOwn), Lang::En),
            "This response continues on its own once its tasks finish."
        );
        assert_eq!(
            approval_error_text(StartError::Rejected("Chat not found".into()), Lang::De),
            "Diese Genehmigung ist für Sie nicht mehr offen."
        );
        assert_eq!(
            approval_error_text(StartError::AlreadyDecided, Lang::En),
            "This approval was already decided."
        );
    }

    #[test]
    fn a_snooze_after_the_next_occurrence_is_refused_as_due_again() {
        assert_eq!(
            reminder_refusal_note(Refusal::NextOccurrenceFirst).text(Lang::En),
            "Not snoozed: this reminder is due again by then, or already was."
        );
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
                display: None,
                source: None,
                input: json!({}),
                own_tool: false,
            }],
        });
        assert_eq!(
            completion_text(&waiting, None, "Erato", Lang::En),
            "I need your approval before I continue."
        );
        let mut client = completion("Partial answer");
        client.needs_client = true;
        assert_eq!(
            completion_text(
                &client,
                Some("https://erato.example/chat/1"),
                "Erato",
                Lang::En
            ),
            "Partial answer\n\n_This step needs the Erato app._ [Open the chat in Erato](https://erato.example/chat/1) to continue."
        );
        assert_eq!(
            completion_text(&completion(""), None, "Erato", Lang::En),
            "(The answer contained no text.)"
        );
    }
}
