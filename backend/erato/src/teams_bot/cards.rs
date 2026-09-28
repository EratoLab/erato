//! Adaptive Cards for MCP tool approvals.
//!
//! The card's buttons are `Action.Submit`, which Teams delivers back as a
//! message activity whose `value` carries [`ApprovalSubmit`] — in personal
//! chats, group chats and channels alike.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const APPROVAL_ACTION: &str = "erato_tool_approval";
const MAX_INPUT_PREVIEW_CHARS: usize = 1_500;

/// One tool call waiting for the user's decision.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingApproval {
    pub message_id: String,
    pub approval_id: String,
    pub tool_name: String,
    pub input: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalChoice {
    Approve,
    Reject,
}

/// The data an approval button submits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalSubmit {
    pub action: String,
    pub message_id: String,
    pub approval_id: String,
    pub choice: ApprovalChoice,
}

impl ApprovalSubmit {
    pub fn from_value(value: &Value) -> Option<Self> {
        let submit: Self = serde_json::from_value(value.clone()).ok()?;
        (submit.action == APPROVAL_ACTION).then_some(submit)
    }
}

pub fn approval_card(approval: &PendingApproval) -> Value {
    let input = serde_json::to_string_pretty(&approval.input).unwrap_or_default();
    let input = if input.chars().count() > MAX_INPUT_PREVIEW_CHARS {
        format!(
            "{}…",
            input
                .chars()
                .take(MAX_INPUT_PREVIEW_CHARS)
                .collect::<String>()
        )
    } else {
        input
    };
    let submit = |choice: ApprovalChoice, title: &str, style: &str| {
        json!({
            "type": "Action.Submit",
            "title": title,
            "style": style,
            "data": ApprovalSubmit {
                action: APPROVAL_ACTION.to_string(),
                message_id: approval.message_id.clone(),
                approval_id: approval.approval_id.clone(),
                choice,
            },
        })
    };
    adaptive_card(
        vec![
            json!({"type": "TextBlock", "text": "Approval needed", "weight": "Bolder", "size": "Medium"}),
            json!({"type": "TextBlock", "wrap": true,
                   "text": format!("Erato wants to run the tool **{}**.", approval.tool_name)}),
            json!({"type": "TextBlock", "wrap": true, "fontType": "Monospace",
                   "isSubtle": true, "text": input}),
        ],
        vec![
            submit(ApprovalChoice::Approve, "Approve", "positive"),
            submit(ApprovalChoice::Reject, "Deny", "destructive"),
        ],
    )
}

/// What replaces the card once someone decided, so it cannot be clicked twice.
pub fn decided_card(tool_name: &str, choice: ApprovalChoice, decided_by: &str) -> Value {
    let verb = match choice {
        ApprovalChoice::Approve => "approved",
        ApprovalChoice::Reject => "denied",
    };
    adaptive_card(
        vec![json!({"type": "TextBlock", "wrap": true,
                    "text": format!("**{tool_name}** was {verb} by {decided_by}.")})],
        Vec::new(),
    )
}

fn adaptive_card(body: Vec<Value>, actions: Vec<Value>) -> Value {
    json!({
        "contentType": "application/vnd.microsoft.card.adaptive",
        "content": {
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            "type": "AdaptiveCard",
            "version": "1.4",
            "body": body,
            "actions": actions,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_buttons_round_trip_through_submit_data() {
        let card = approval_card(&PendingApproval {
            message_id: "m-1".into(),
            approval_id: "a-1".into(),
            tool_name: "create_ticket".into(),
            input: json!({"title": "x"}),
        });
        let approve = &card["content"]["actions"][0]["data"];
        assert_eq!(
            ApprovalSubmit::from_value(approve),
            Some(ApprovalSubmit {
                action: APPROVAL_ACTION.into(),
                message_id: "m-1".into(),
                approval_id: "a-1".into(),
                choice: ApprovalChoice::Approve,
            })
        );
        assert_eq!(
            ApprovalSubmit::from_value(&json!({"action": "other"})),
            None
        );
    }
}
