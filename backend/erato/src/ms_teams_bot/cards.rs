//! Adaptive Cards for tool approvals.
//!
//! A parked turn can wait on several decisions at once (a delegated task plan,
//! or several delegated tasks that parked in one batch), and Erato only
//! resumes it when every open item is answered in one request. So there is
//! one card per parked message: a choice per item plus "Approve all" and
//! "Deny all", and every button submits the complete set.
//!
//! The buttons are `Action.Submit`, which Teams delivers back as a message
//! activity whose `value` carries the button data merged with the card's
//! inputs — in personal chats, group chats and channels alike.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;

pub const APPROVAL_ACTION: &str = "erato_tool_approval";
/// Total input preview budget per card; Teams rejects cards above ~28 KB.
const MAX_INPUT_PREVIEW_CHARS: usize = 6_000;
const MAX_ITEM_PREVIEW_CHARS: usize = 1_500;

/// What the turn is waiting on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalKind {
    McpTool,
    DelegatedTask,
    TaskPlan,
    ToolCallLimit,
}

/// One decision the user owes.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingApprovalItem {
    pub approval_id: String,
    /// The tool the decision is about (for delegated tasks: the child's call).
    pub tool_name: String,
    pub input: Value,
}

/// Every open decision of one parked assistant message.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingApprovalSet {
    pub message_id: String,
    pub kind: ApprovalKind,
    pub items: Vec<PendingApprovalItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalChoice {
    Approve,
    Reject,
    Withdraw,
}

/// The data an approval card submits: the button's data plus the card's
/// per-item inputs (`d0`, `d1`, …), which Teams merges in as top-level keys.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ApprovalSubmit {
    pub action: String,
    pub message_id: String,
    pub approval_ids: Vec<String>,
    /// Tool names in the order of `approval_ids`, for the decided card.
    #[serde(default)]
    pub tool_names: Vec<String>,
    /// Set by "Approve all" / "Deny all" (and the buttons of a single item).
    #[serde(default)]
    pub all: Option<ApprovalChoice>,
    #[serde(flatten)]
    pub inputs: HashMap<String, Value>,
}

impl ApprovalSubmit {
    pub fn from_value(value: &Value) -> Option<Self> {
        let submit: Self = serde_json::from_value(value.clone()).ok()?;
        (submit.action == APPROVAL_ACTION && !submit.approval_ids.is_empty()).then_some(submit)
    }

    /// Every listed approval paired with its choice, or `None` when an item
    /// was left unanswered. Nothing is filled in: Erato validates the set.
    pub fn decisions(&self) -> Option<Vec<(String, ApprovalChoice)>> {
        self.approval_ids
            .iter()
            .enumerate()
            .map(|(index, approval_id)| {
                let choice = self.all.or_else(|| {
                    self.inputs
                        .get(&input_id(index))
                        .and_then(|value| serde_json::from_value(value.clone()).ok())
                })?;
                Some((approval_id.clone(), choice))
            })
            .collect()
    }
}

pub fn approval_card(set: &PendingApprovalSet) -> Value {
    let count = set.items.len();
    let heading = match set.kind {
        ApprovalKind::McpTool if count == 1 => "Approval needed".to_string(),
        ApprovalKind::McpTool => format!("{count} tool calls need approval"),
        ApprovalKind::TaskPlan => format!("Erato wants to start {count} task(s)"),
        ApprovalKind::DelegatedTask => "Sub-tasks are waiting for approval".to_string(),
        ApprovalKind::ToolCallLimit => "Tool-call limit reached".to_string(),
    };
    let item_budget = (MAX_INPUT_PREVIEW_CHARS / count.max(1)).min(MAX_ITEM_PREVIEW_CHARS);
    let mut body = vec![json!({
        "type": "TextBlock", "text": heading, "weight": "Bolder", "size": "Medium", "wrap": true,
    })];
    if set.kind == ApprovalKind::ToolCallLimit {
        body.push(json!({"type": "TextBlock", "wrap": true,
            "text": "Continue with twice the tool-call budget, generate an answer using the information collected so far, or stop this response."}));
    }
    for (index, item) in set
        .items
        .iter()
        .enumerate()
        .filter(|_| set.kind != ApprovalKind::ToolCallLimit)
    {
        body.push(json!({
            "type": "TextBlock", "wrap": true, "separator": index > 0,
            "text": format!("Run the tool **{}**?", item.tool_name),
        }));
        body.push(json!({
            "type": "TextBlock", "wrap": true, "fontType": "Monospace", "isSubtle": true,
            "text": preview(&item.input, item_budget),
        }));
        if count > 1 {
            body.push(json!({
                "type": "Input.ChoiceSet",
                "id": input_id(index),
                "style": "expanded",
                "isRequired": true,
                "errorMessage": "Choose approve or deny",
                "choices": [
                    {"title": "Approve", "value": "approve"},
                    {"title": "Deny", "value": "reject"},
                ],
            }));
        }
    }

    let data = |all: Option<ApprovalChoice>| {
        let mut data = json!({
            "action": APPROVAL_ACTION,
            "message_id": set.message_id,
            "approval_ids": set.items.iter().map(|item| &item.approval_id).collect::<Vec<_>>(),
            "tool_names": set.items.iter().map(|item| &item.tool_name).collect::<Vec<_>>(),
        });
        if let Some(all) = all {
            data["all"] = json!(all);
        }
        data
    };
    let button = |title: &str, style: &str, all: Option<ApprovalChoice>| {
        json!({
            "type": "Action.Submit",
            "title": title,
            "style": style,
            // Per-item choices only travel (and are required) on the submit button.
            "associatedInputs": if all.is_some() { "none" } else { "auto" },
            "data": data(all),
        })
    };
    let actions = if set.kind == ApprovalKind::ToolCallLimit {
        vec![
            button(
                "Continue tool calls",
                "positive",
                Some(ApprovalChoice::Approve),
            ),
            button(
                "Generate answer now",
                "default",
                Some(ApprovalChoice::Reject),
            ),
            button("Stop", "destructive", Some(ApprovalChoice::Withdraw)),
        ]
    } else if count > 1 {
        vec![
            button("Submit decisions", "default", None),
            button("Approve all", "positive", Some(ApprovalChoice::Approve)),
            button("Deny all", "destructive", Some(ApprovalChoice::Reject)),
        ]
    } else {
        vec![
            button("Approve", "positive", Some(ApprovalChoice::Approve)),
            button("Deny", "destructive", Some(ApprovalChoice::Reject)),
        ]
    };
    adaptive_card(body, actions)
}

/// What replaces the card once decided, so it cannot be answered twice.
pub fn decided_card(decisions: &[(String, ApprovalChoice)], decided_by: &str) -> Value {
    let body = decisions
        .iter()
        .map(|(tool_name, choice)| {
            let verb = match choice {
                ApprovalChoice::Approve => "approved",
                ApprovalChoice::Reject => "denied",
                ApprovalChoice::Withdraw => "stopped",
            };
            json!({"type": "TextBlock", "wrap": true,
                   "text": format!("**{tool_name}** was {verb} by {decided_by}.")})
        })
        .collect();
    adaptive_card(body, Vec::new())
}

pub fn approval_summary(set: &PendingApprovalSet) -> String {
    if set.kind == ApprovalKind::ToolCallLimit {
        return "Tool-call limit reached. Choose whether to continue, answer now, or stop.".into();
    }
    match set.items.as_slice() {
        [item] => format!("Approval needed to run {}.", item.tool_name),
        items => format!("{} tool calls need approval.", items.len()),
    }
}

pub fn decided_summary(decisions: &[(String, ApprovalChoice)], decided_by: &str) -> String {
    decisions
        .iter()
        .map(|(name, choice)| {
            let verb = match choice {
                ApprovalChoice::Approve => "approved",
                ApprovalChoice::Reject => "denied",
                ApprovalChoice::Withdraw => "stopped",
            };
            format!("{name} was {verb} by {decided_by}.")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn input_id(index: usize) -> String {
    format!("d{index}")
}

fn preview(input: &Value, max_chars: usize) -> String {
    let text = serde_json::to_string_pretty(input).unwrap_or_default();
    if text.chars().count() > max_chars {
        format!("{}…", text.chars().take(max_chars).collect::<String>())
    } else {
        text
    }
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

    fn set(count: usize) -> PendingApprovalSet {
        PendingApprovalSet {
            message_id: "m-1".into(),
            kind: if count > 1 {
                ApprovalKind::TaskPlan
            } else {
                ApprovalKind::McpTool
            },
            items: (0..count)
                .map(|index| PendingApprovalItem {
                    approval_id: format!("plan:1:{index}"),
                    tool_name: format!("tool_{index}"),
                    input: json!({"n": index}),
                })
                .collect(),
        }
    }

    /// What Teams posts back: the button data merged with the card inputs.
    fn submitted(card: &Value, action: usize, inputs: Value) -> Value {
        let mut value = card["content"]["actions"][action]["data"].clone();
        for (key, input) in inputs.as_object().unwrap() {
            value[key] = input.clone();
        }
        value
    }

    #[test]
    fn a_single_item_card_submits_its_decision() {
        let card = approval_card(&set(1));
        assert!(
            card["content"]["body"]
                .as_array()
                .unwrap()
                .iter()
                .all(|block| block["type"] != "Input.ChoiceSet")
        );
        let submit = ApprovalSubmit::from_value(&submitted(&card, 1, json!({}))).unwrap();
        assert_eq!(
            submit.decisions(),
            Some(vec![("plan:1:0".to_string(), ApprovalChoice::Reject)])
        );
    }

    #[test]
    fn a_multi_item_card_submits_every_decision_together() {
        let card = approval_card(&set(2));
        let per_item = ApprovalSubmit::from_value(&submitted(
            &card,
            0,
            json!({"d0": "approve", "d1": "reject"}),
        ))
        .unwrap();
        assert_eq!(
            per_item.decisions(),
            Some(vec![
                ("plan:1:0".to_string(), ApprovalChoice::Approve),
                ("plan:1:1".to_string(), ApprovalChoice::Reject),
            ])
        );
        let approve_all = ApprovalSubmit::from_value(&submitted(&card, 1, json!({}))).unwrap();
        assert_eq!(
            approve_all.decisions(),
            Some(vec![
                ("plan:1:0".to_string(), ApprovalChoice::Approve),
                ("plan:1:1".to_string(), ApprovalChoice::Approve),
            ])
        );
        let half =
            ApprovalSubmit::from_value(&submitted(&card, 0, json!({"d0": "approve"}))).unwrap();
        assert_eq!(
            half.decisions(),
            None,
            "an unanswered item is never filled in"
        );
        assert_eq!(approve_all.tool_names, vec!["tool_0", "tool_1"]);
    }

    #[test]
    fn ignores_foreign_submit_data() {
        assert_eq!(
            ApprovalSubmit::from_value(&json!({"action": "other"})),
            None
        );
        assert_eq!(
            ApprovalSubmit::from_value(
                &json!({"action": APPROVAL_ACTION, "message_id": "m", "approval_ids": []})
            ),
            None
        );
    }
}
