//! The confirmation card after a reminder was scheduled in a Teams chat, and
//! its Cancel button.
//!
//! Erato-side like `host` and `nudge`: the card is rendered from the stored
//! item ([`Confirmation`]), the same content the web chat shows. Cancel works
//! for as long as the reminder is upcoming, with no token that could expire:
//! the button names the item, and the press is checked against the Teams
//! user's own items before the shared cancel runs.

use super::cards;
use super::host::Host;
use super::render;
use crate::db::entity::scheduled_items::{ItemStatus, Model as ScheduledItem};
use crate::models::user_preference::user_time_zone;
use crate::services::scheduled_items::chat_tools::{CREATE_REMINDER, Confirmation};
use crate::services::scheduled_items::{self, Checked};
use crate::services::text_language::Lang;
use chrono::Utc;
use eyre::Report;
use sea_orm::prelude::Uuid;
use serde::Deserialize;
use serde_json::{Value, json};

/// `data.action` of a confirmation card's Cancel.
pub const CANCEL_ACTION: &str = "erato_reminder_cancel";

/// A press of Cancel on a confirmation card.
#[derive(Debug, Deserialize)]
pub struct CancelSubmit {
    action: String,
    pub item_id: Uuid,
}

impl CancelSubmit {
    pub fn from_value(value: &Value) -> Option<Self> {
        let submit: Self = serde_json::from_value(value.clone()).ok()?;
        (submit.action == CANCEL_ACTION).then_some(submit)
    }
}

/// The confirmation card: heading, name, time, repeat and where it arrives,
/// then Cancel (while `cancellable`) and Open in Scheduled (with a public
/// base URL). A `note` says what happened to it.
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
        actions.push(json!({
            "type": "Action.Submit", "title": confirmation.cancel_label,
            "data": {"action": CANCEL_ACTION, "item_id": confirmation.item_id},
        }));
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

/// The reminders a finished turn created, in order. Calls before an approval
/// stop that is not the turn's last part were confirmed when the turn
/// stopped there, so a continuation does not confirm them twice.
pub fn created_reminders(content: &[crate::models::message::ContentPart]) -> Vec<Uuid> {
    use crate::models::message::{ContentPart, ToolCallStatus};
    let last = content.len().saturating_sub(1);
    let start = content
        .iter()
        .enumerate()
        .rev()
        .find(|(index, part)| *index != last && matches!(part, ContentPart::ToolApprovalRequest(_)))
        .map_or(0, |(index, _)| index + 1);
    content[start..]
        .iter()
        .filter_map(|part| match part {
            ContentPart::ToolUse(tool)
                if tool.tool_name == CREATE_REMINDER && tool.status == ToolCallStatus::Success =>
            {
                tool.output
                    .as_ref()?
                    .pointer("/reminder/id")?
                    .as_str()
                    .and_then(|id| Uuid::parse_str(id).ok())
            }
            _ => None,
        })
        .collect()
}

impl Host {
    /// The confirmation of one of the user's reminders, from what is stored
    /// now; `None` when it is not theirs or no longer exists.
    pub async fn reminder_confirmation(
        &self,
        user_id: Uuid,
        item_id: Uuid,
        lang: Lang,
    ) -> Result<Option<Confirmation>, Report> {
        let db = &self.app_state.db;
        let Some(view) = scheduled_items::get(db, user_id, item_id).await? else {
            return Ok(None);
        };
        let user_zone = user_time_zone(db, &user_id).await?;
        Ok(Some(Confirmation::of(&view, user_zone, Utc::now(), lang)?))
    }

    /// The shared cancel, for the user's own reminder only.
    pub async fn cancel_reminder(&self, user_id: Uuid, item_id: Uuid) -> Checked<ScheduledItem> {
        scheduled_items::cancel_checked(&self.app_state, user_id, item_id).await
    }

    pub async fn reminder_status(
        &self,
        user_id: Uuid,
        item_id: Uuid,
    ) -> Result<Option<ItemStatus>, Report> {
        Ok(scheduled_items::get(&self.app_state.db, user_id, item_id)
            .await?
            .map(|view| view.item.status))
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
    fn cancel_presses_parse_only_with_their_action() {
        let id = Uuid::new_v4();
        let submit =
            CancelSubmit::from_value(&json!({"action": CANCEL_ACTION, "item_id": id})).unwrap();
        assert_eq!(submit.item_id, id);
        assert!(CancelSubmit::from_value(&json!({"action": "other", "item_id": id})).is_none());
        assert!(CancelSubmit::from_value(&json!({"action": CANCEL_ACTION})).is_none());
    }
}
