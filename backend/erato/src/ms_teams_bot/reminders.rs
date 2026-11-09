//! The confirmation card after a reminder was scheduled in a Teams chat, the
//! list card of the user's upcoming reminders, and their Cancel buttons.
//!
//! Erato-side like `host` and `nudge`: the confirmation card is rendered from
//! the stored item ([`Confirmation`]), the same content the web chat shows;
//! the list card from what `list_reminders` returns. Cancel works for as long
//! as the reminder is upcoming, with no token that could expire: the button
//! names the item, and the press is checked against the Teams user's own
//! items before the shared cancel runs. It first asks, as the Scheduled page
//! does, since a repeating reminder stops for good.

use super::cards;
use super::host::Host;
use super::render;
use super::texts::Msg;
use crate::db::entity::scheduled_items::Model as ScheduledItem;
use crate::models::user_preference::user_time_zone;
use crate::services::scheduled_items::chat_tools::{
    self, CREATE_REMINDER, Confirmation, LIST_REMINDERS, ReminderSummary,
};
use crate::services::scheduled_items::wording;
use crate::services::scheduled_items::{self, Checked, DisplayStatus};
use crate::services::text_language::Lang;
use chrono::Utc;
use eyre::Report;
use sea_orm::prelude::Uuid;
use serde::Deserialize;
use serde_json::{Value, json};

/// `data.action` of "Cancel it" in the question a confirmation card's Cancel
/// opens.
pub const CANCEL_ACTION: &str = "erato_reminder_cancel";
/// `data.action` of "Keep it" there.
pub const KEEP_ACTION: &str = "erato_reminder_keep";
/// The same two on a row of the list card.
pub const LIST_CANCEL_ACTION: &str = "erato_reminder_list_cancel";
pub const LIST_KEEP_ACTION: &str = "erato_reminder_list_keep";

/// A press of "Cancel it" or "Keep it" on a confirmation card or a row of
/// the list card.
#[derive(Debug, Deserialize)]
pub struct CardSubmit {
    action: String,
    pub item_id: Uuid,
}

impl CardSubmit {
    pub fn from_value(value: &Value) -> Option<Self> {
        let submit: Self = serde_json::from_value(value.clone()).ok()?;
        [
            CANCEL_ACTION,
            KEEP_ACTION,
            LIST_CANCEL_ACTION,
            LIST_KEEP_ACTION,
        ]
        .contains(&submit.action.as_str())
        .then_some(submit)
    }

    pub fn keeps(&self) -> bool {
        matches!(self.action.as_str(), KEEP_ACTION | LIST_KEEP_ACTION)
    }

    /// Pressed on the list card rather than a confirmation card.
    pub fn on_list(&self) -> bool {
        matches!(self.action.as_str(), LIST_CANCEL_ACTION | LIST_KEEP_ACTION)
    }
}

/// The "Cancel" button that first asks "Cancel “name”?", whose "Cancel it"
/// and "Keep it" submit these actions for the item.
fn cancel_question(item_id: Uuid, name: &str, lang: Lang, (cancel, keep): (&str, &str)) -> Value {
    let press = |action: &str, title: Msg| {
        json!({
            "type": "Action.Submit", "title": title.text(lang),
            "data": {"action": action, "item_id": item_id},
        })
    };
    json!({
        "type": "Action.ShowCard", "title": wording::cancel_button(lang),
        "card": {
            "type": "AdaptiveCard",
            "body": [
                {
                    "type": "TextBlock", "wrap": true, "weight": "Bolder",
                    "text": Msg::CancelReminderQuestion.fill(lang, &[("name", name)]),
                },
                {
                    "type": "TextBlock", "wrap": true, "isSubtle": true,
                    "text": Msg::CancelReminderExplained.text(lang),
                },
            ],
            "actions": [
                press(cancel, Msg::CancelReminderConfirm),
                press(keep, Msg::KeepReminder),
            ],
        },
    })
}

/// The confirmation card: heading, name, time, repeat and where it arrives,
/// then Cancel (while `cancellable`) and Open in Scheduled (with a public
/// base URL). Cancel opens a question whose "Cancel it" cancels. A `note`
/// says what happened to it.
pub fn confirmation_card(
    confirmation: &Confirmation,
    scheduled_url: Option<&str>,
    note: Option<&str>,
    cancellable: bool,
) -> Value {
    let mut body = vec![
        json!({
            "type": "TextBlock", "text": confirmation.heading, "wrap": true,
            "isSubtle": true, "size": "Small",
        }),
        json!({
            "type": "TextBlock", "text": confirmation.name, "wrap": true,
            "weight": "Bolder", "size": "Medium", "spacing": "None",
        }),
    ];
    for line in [&confirmation.when, &confirmation.repeats]
        .into_iter()
        .flatten()
    {
        body.push(json!({"type": "TextBlock", "text": line, "wrap": true, "spacing": "Small"}));
    }
    body.push(json!({
        "type": "TextBlock", "text": confirmation.delivery, "wrap": true,
        "isSubtle": true, "spacing": "Small",
    }));
    if let Some(note) = note {
        body.push(json!({
            "type": "TextBlock", "text": note, "wrap": true,
            "isSubtle": true, "spacing": "Medium",
        }));
    }
    let mut actions = Vec::new();
    if cancellable {
        let mut cancel = cancel_question(
            confirmation.item_id,
            &confirmation.name,
            Lang::from_tag(&confirmation.language),
            (CANCEL_ACTION, KEEP_ACTION),
        );
        cancel["title"] = json!(confirmation.cancel_label);
        actions.push(cancel);
    }
    if let Some(url) = scheduled_url {
        actions.push(json!({
            "type": "Action.OpenUrl", "title": confirmation.open_scheduled_label, "url": url,
        }));
    }
    render::card_message(
        cards::adaptive_card(body, actions),
        &format!("{}: {}", confirmation.heading, confirmation.name),
    )
}

/// The list card: each upcoming reminder with its time, schedule and linked
/// chat, and a Cancel that first asks; Open in Scheduled with a public base
/// URL. A `note` says what the last press did.
pub fn list_card(
    reminders: &[ReminderSummary],
    base_url: Option<&str>,
    note: Option<&str>,
    lang: Lang,
) -> Value {
    let heading = Msg::UpcomingReminders.text(lang);
    let scheduled_url = base_url.map(|base| format!("{base}{}", chat_tools::SCHEDULED_PATH));
    let mut body = vec![json!({
        "type": "TextBlock", "text": heading, "wrap": true,
        "weight": "Bolder", "size": "Medium",
    })];
    if reminders.is_empty() {
        body.push(json!({
            "type": "TextBlock", "wrap": true, "isSubtle": true,
            "text": Msg::NoUpcomingReminders
                .fill(lang, &[("page", &scheduled_page_link(scheduled_url.as_deref(), lang))]),
        }));
    }
    for reminder in reminders {
        let mut items = vec![json!({
            "type": "TextBlock", "text": reminder.name, "wrap": true, "weight": "Bolder",
        })];
        let repeats = reminder.repeats.as_deref().map(wording::capitalized);
        for line in [reminder.when.clone(), repeats].into_iter().flatten() {
            items.push(json!({"type": "TextBlock", "text": line, "wrap": true, "spacing": "None"}));
        }
        if let Some(chat) = &reminder.linked_chat {
            let title = if chat.title.is_empty() {
                wording::untitled_chat(lang)
            } else {
                &chat.title
            };
            let chat = match base_url {
                Some(base) => format!("[{title}]({base}/chat/{})", chat.id),
                None => title.to_string(),
            };
            items.push(json!({
                "type": "TextBlock", "wrap": true, "isSubtle": true, "spacing": "None",
                "text": Msg::LinkedChat.fill(lang, &[("chat", &chat)]),
            }));
        }
        items.push(json!({
            "type": "ActionSet",
            "actions": [cancel_question(
                reminder.id,
                &reminder.name,
                lang,
                (LIST_CANCEL_ACTION, LIST_KEEP_ACTION),
            )],
        }));
        body.push(json!({
            "type": "Container", "separator": true, "spacing": "Medium", "items": items,
        }));
    }
    if let Some(note) = note {
        body.push(json!({
            "type": "TextBlock", "text": note, "wrap": true,
            "isSubtle": true, "spacing": "Medium",
        }));
    }
    let actions = scheduled_url
        .map(|url| {
            json!({
                "type": "Action.OpenUrl", "title": wording::open_scheduled_button(lang), "url": url,
            })
        })
        .into_iter()
        .collect();
    render::card_message(cards::adaptive_card(body, actions), heading)
}

/// "Scheduled page", linked when the app has a public base URL.
pub fn scheduled_page_link(scheduled_url: Option<&str>, lang: Lang) -> String {
    let name = Msg::ScheduledPage.text(lang);
    match scheduled_url {
        Some(url) => format!("[{name}]({url})"),
        None => name.to_string(),
    }
}

/// What a finished turn did with reminders that the bot follows up on.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TurnReminders {
    /// The reminders it created, in order, each confirmed on a card.
    pub created: Vec<Uuid>,
    /// It listed the user's reminders, which then follow as the list card.
    pub listed: bool,
}

/// The reminder calls of a finished turn. Calls before an approval stop that
/// is not the turn's last part were followed up when the turn stopped there,
/// so a continuation does not repeat them.
pub fn turn_reminders(content: &[crate::models::message::ContentPart]) -> TurnReminders {
    use crate::models::message::{ContentPart, ToolCallStatus};
    let last = content.len().saturating_sub(1);
    let start = content
        .iter()
        .enumerate()
        .rev()
        .find(|(index, part)| *index != last && matches!(part, ContentPart::ToolApprovalRequest(_)))
        .map_or(0, |(index, _)| index + 1);
    let mut turn = TurnReminders::default();
    for part in &content[start..] {
        let ContentPart::ToolUse(tool) = part else {
            continue;
        };
        if tool.status != ToolCallStatus::Success {
            continue;
        }
        match tool.tool_name.as_str() {
            CREATE_REMINDER => turn.created.extend(
                tool.output
                    .as_ref()
                    .and_then(|output| output.pointer("/reminder/id"))
                    .and_then(Value::as_str)
                    .and_then(|id| Uuid::parse_str(id).ok()),
            ),
            LIST_REMINDERS => turn.listed = true,
            _ => {}
        }
    }
    turn
}

impl Host {
    /// The confirmation of one of the user's reminders, from what is stored
    /// now, with the status the Scheduled page shows; `None` when it is not
    /// theirs or no longer exists.
    pub async fn reminder_confirmation(
        &self,
        user_id: Uuid,
        item_id: Uuid,
        lang: Lang,
    ) -> Result<Option<(Confirmation, DisplayStatus)>, Report> {
        let db = &self.app_state.db;
        let Some(view) = scheduled_items::get(db, user_id, item_id).await? else {
            return Ok(None);
        };
        let user_zone = user_time_zone(db, &user_id).await?;
        let now = Utc::now();
        Ok(Some((
            Confirmation::of(&view, user_zone, now, lang)?,
            scheduled_items::display_status(&view, now),
        )))
    }

    /// The user's upcoming reminders as the list card shows them.
    pub async fn upcoming_reminders(
        &self,
        user_id: Uuid,
        lang: Lang,
    ) -> Result<Vec<ReminderSummary>, Report> {
        chat_tools::upcoming_reminders(&self.app_state, user_id, lang).await
    }

    /// The shared cancel, for the user's own reminder only.
    pub async fn cancel_reminder(&self, user_id: Uuid, item_id: Uuid) -> Checked<ScheduledItem> {
        scheduled_items::cancel_checked(&self.app_state, user_id, item_id).await
    }

    /// The status the Scheduled page shows for one of the user's reminders.
    pub async fn reminder_status(
        &self,
        user_id: Uuid,
        item_id: Uuid,
    ) -> Result<Option<DisplayStatus>, Report> {
        Ok(scheduled_items::get(&self.app_state.db, user_id, item_id)
            .await?
            .map(|view| scheduled_items::display_status(&view, Utc::now())))
    }

    /// Whether the reminder exists, whoever's it is.
    pub async fn reminder_exists(&self, item_id: Uuid) -> Result<bool, Report> {
        scheduled_items::exists(&self.app_state.db, item_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{
        ContentPart, ContentPartText, ContentPartToolApprovalRequest, ToolApprovalAnnotations,
        ToolApprovalKind, ToolCallStatus, ToolUse,
    };

    fn created(id: Uuid) -> ContentPart {
        ContentPart::ToolUse(ToolUse {
            tool_call_id: id.to_string(),
            status: ToolCallStatus::Success,
            tool_name: CREATE_REMINDER.into(),
            output: Some(json!({"status": "created", "reminder": {"id": id}})),
            ..Default::default()
        })
    }

    fn approval() -> ContentPart {
        ContentPart::ToolApprovalRequest(ContentPartToolApprovalRequest {
            tool_call_id: "call".into(),
            tool_name: "send_mail".into(),
            display: None,
            mcp_server_id: "mail".into(),
            input: json!({}),
            annotations: ToolApprovalAnnotations {
                read_only_hint: false,
                destructive_hint: false,
                idempotent_hint: false,
                open_world_hint: true,
            },
            preset: String::new(),
            allow_always: true,
            requested_at: String::new(),
            kind: ToolApprovalKind::McpTool,
            approvals: Vec::new(),
            pending_tool_calls: Vec::new(),
            approval_scope: None,
            labels_updated_at: None,
        })
    }

    fn listed() -> ContentPart {
        ContentPart::ToolUse(ToolUse {
            tool_call_id: "list".into(),
            status: ToolCallStatus::Success,
            tool_name: LIST_REMINDERS.into(),
            output: Some(json!({"status": "ok", "reminders": []})),
            ..Default::default()
        })
    }

    fn created_reminders(content: &[ContentPart]) -> Vec<Uuid> {
        turn_reminders(content).created
    }

    #[test]
    fn a_turn_lists_once_after_its_last_approval_stop() {
        assert!(turn_reminders(&[listed()]).listed);
        assert!(turn_reminders(&[listed(), approval()]).listed);
        assert!(!turn_reminders(&[listed(), approval(), created(Uuid::new_v4())]).listed);
        assert!(!turn_reminders(&[created(Uuid::new_v4())]).listed);
    }

    #[test]
    fn a_turn_confirms_each_reminder_it_created_once() {
        let (first, second) = (Uuid::new_v4(), Uuid::new_v4());
        let text = ContentPart::Text(ContentPartText {
            text: "Done.".into(),
        });
        let refused = ContentPart::ToolUse(ToolUse {
            tool_name: CREATE_REMINDER.into(),
            status: ToolCallStatus::Error,
            output: Some(json!({"status": "refused"})),
            ..Default::default()
        });
        assert_eq!(
            created_reminders(&[created(first), refused.clone(), text.clone()]),
            [first]
        );
        // Stopped on an approval: the reminder before it is confirmed now.
        assert_eq!(created_reminders(&[created(first), approval()]), [first]);
        // The continuation: only what came after the stop.
        assert_eq!(
            created_reminders(&[created(first), approval(), created(second), text]),
            [second]
        );
        assert!(created_reminders(&[]).is_empty());
    }

    #[test]
    fn card_presses_parse_only_with_their_action() {
        let id = Uuid::new_v4();
        let submit =
            CardSubmit::from_value(&json!({"action": CANCEL_ACTION, "item_id": id})).unwrap();
        assert_eq!(submit.item_id, id);
        assert!(!submit.keeps());
        assert!(
            CardSubmit::from_value(&json!({"action": KEEP_ACTION, "item_id": id}))
                .unwrap()
                .keeps()
        );
        assert!(CardSubmit::from_value(&json!({"action": "other", "item_id": id})).is_none());
        assert!(CardSubmit::from_value(&json!({"action": CANCEL_ACTION})).is_none());
    }
}
