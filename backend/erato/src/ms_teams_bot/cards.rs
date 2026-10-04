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

use super::render::{bounded_text, card_fits};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;

pub const APPROVAL_ACTION: &str = "erato_tool_approval";
/// Text budgets the items of one card share. They count bytes before JSON
/// escaping, so the finished card is measured as well.
const MAX_NAME_BYTES: usize = 1_600;
const MAX_DESCRIPTION_BYTES: usize = 4_000;
const MAX_INPUT_PREVIEW_BYTES: usize = 6_000;
const MAX_ITEM_PREVIEW_BYTES: usize = 1_500;
const OMITTED_DETAILS: &str = "Some details are not shown because Teams limits card size. Open the chat in Erato to see them.";

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
    pub display: Option<ToolDisplay>,
    pub source: Option<String>,
    pub input: Value,
}

/// Display-only projection of the backend's descriptor snapshot.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolDisplay {
    pub title: String,
    pub description: Option<String>,
}

impl PendingApprovalItem {
    fn display_name(&self) -> &str {
        self.display.as_ref().map_or(&self.tool_name, |d| &d.title)
    }
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

impl ApprovalChoice {
    fn past_tense(self) -> &'static str {
        match self {
            ApprovalChoice::Approve => "approved",
            ApprovalChoice::Reject => "denied",
            ApprovalChoice::Withdraw => "stopped",
        }
    }
}

/// The data an approval card submits: the button's data plus the card's
/// per-item inputs (`d0`, `d1`, …), which Teams merges in as top-level keys.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ApprovalSubmit {
    pub action: String,
    pub message_id: String,
    pub approval_ids: Vec<String>,
    /// Display names in the order of `approval_ids`, only for the decided card.
    /// Execution and authorization use the backend's recorded approval ids.
    /// Cards posted before the rename send them as `tool_names`.
    #[serde(default, alias = "tool_names")]
    pub display_names: Vec<String>,
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

fn heading(set: &PendingApprovalSet) -> String {
    let count = set.items.len();
    match set.kind {
        ApprovalKind::McpTool if count == 1 => "Approval needed".to_string(),
        ApprovalKind::McpTool => format!("{count} tool calls need approval"),
        ApprovalKind::TaskPlan => format!("Erato wants to start {count} task(s)"),
        ApprovalKind::DelegatedTask => "Sub-tasks are waiting for approval".to_string(),
        ApprovalKind::ToolCallLimit => "Tool-call limit reached".to_string(),
    }
}

/// How much of each item a card shows. Later levels give up details to fit
/// Teams' size limit, never a decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Detail {
    Full,
    NoDescriptions,
    NoArguments,
    /// Also drops the server/tool lines and the decided card's names.
    Minimal,
}

pub fn approval_card(set: &PendingApprovalSet) -> Value {
    [Detail::Full, Detail::NoDescriptions, Detail::NoArguments]
        .into_iter()
        .map(|detail| build_approval_card(set, detail))
        .find(card_fits)
        .unwrap_or_else(|| build_approval_card(set, Detail::Minimal))
}

fn build_approval_card(set: &PendingApprovalSet, detail: Detail) -> Value {
    let count = set.items.len();
    let heading = heading(set);
    let item_budget = (MAX_INPUT_PREVIEW_BYTES / count.max(1)).min(MAX_ITEM_PREVIEW_BYTES);
    // Display names also travel in each button's data for the decided card.
    let names: Vec<String> = set
        .items
        .iter()
        .map(|item| bounded_text(item.display_name(), MAX_NAME_BYTES / count.max(1)))
        .collect();
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
        let mut title = plain_text(
            &format!("Run {}?", names[index]),
            json!({"weight": "Bolder"}),
        );
        title["separator"] = json!(index > 0);
        body.push(title);
        if detail < Detail::Minimal {
            if let Some(source) = &item.source {
                body.push(plain_text(
                    &format!("{source} / {}", item.tool_name),
                    json!({}),
                ));
            } else if item.display_name() != item.tool_name {
                body.push(plain_text(&item.tool_name, json!({})));
            }
        }
        if detail < Detail::NoDescriptions
            && let Some(description) = item.display.as_ref().and_then(|d| d.description.as_deref())
        {
            body.push(plain_text(
                &bounded_text(description, MAX_DESCRIPTION_BYTES / count.max(1)),
                json!({}),
            ));
        }
        if detail < Detail::NoArguments
            && !item.input.as_object().is_some_and(|input| input.is_empty())
        {
            body.push(plain_text(
                &preview(&item.input, item_budget),
                json!({"fontType": "Monospace", "isSubtle": true}),
            ));
        }
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
    if detail > Detail::Full {
        body.push(
            json!({"type": "TextBlock", "wrap": true, "isSubtle": true, "text": OMITTED_DETAILS}),
        );
    }

    let data = |all: Option<ApprovalChoice>| {
        let mut data = json!({
            "action": APPROVAL_ACTION,
            "message_id": set.message_id,
            "approval_ids": set.items.iter().map(|item| &item.approval_id).collect::<Vec<_>>(),
        });
        if detail < Detail::Minimal {
            data["display_names"] = json!(names);
        }
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
        .map(|(name, choice)| {
            plain_text(
                &format!("{name} was {} by {decided_by}.", choice.past_tense()),
                json!({}),
            )
        })
        .collect();
    adaptive_card(body, Vec::new())
}

/// Notification and preview text: the card heading, plus what the card body
/// would otherwise have said. A task plan's items are all `delegate_task`, so
/// only tool approvals name their tool.
pub fn approval_summary(set: &PendingApprovalSet) -> String {
    match (set.kind, set.items.as_slice()) {
        (ApprovalKind::ToolCallLimit, _) => format!(
            "{}. Choose whether to continue, answer now, or stop.",
            heading(set)
        ),
        (ApprovalKind::McpTool | ApprovalKind::DelegatedTask, [item]) => {
            format!("Approval needed to run {}.", item.display_name())
        }
        _ => format!("{}.", heading(set)),
    }
}

pub fn decided_summary(decisions: &[(String, ApprovalChoice)], decided_by: &str) -> String {
    decisions
        .iter()
        .map(|(name, choice)| format!("{name} was {} by {decided_by}.", choice.past_tense()))
        .collect::<Vec<_>>()
        .join(" ")
}

fn input_id(index: usize) -> String {
    format!("d{index}")
}

fn preview(input: &Value, max_bytes: usize) -> String {
    let text = serde_json::to_string_pretty(input).unwrap_or_default();
    bounded_text(&text, max_bytes)
}

/// TextRun does not interpret Markdown. MCP descriptors and tool inputs
/// must not be able to create links, images or misleading formatting.
/// `run` carries the run's styling, e.g. `json!({"weight": "Bolder"})`.
fn plain_text(text: &str, mut run: Value) -> Value {
    run["type"] = json!("TextRun");
    run["text"] = json!(text);
    json!({"type": "RichTextBlock", "inlines": [run]})
}

pub(super) fn adaptive_card(body: Vec<Value>, actions: Vec<Value>) -> Value {
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
                    display: None,
                    source: None,
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
    fn summaries_follow_the_card_heading() {
        assert_eq!(approval_summary(&set(1)), "Approval needed to run tool_0.");
        assert_eq!(approval_summary(&set(3)), "Erato wants to start 3 task(s).");
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
        assert_eq!(approve_all.display_names, vec!["tool_0", "tool_1"]);
    }

    #[test]
    fn cards_posted_before_the_rename_keep_their_names() {
        let mut value = submitted(&approval_card(&set(1)), 0, json!({}));
        let names = value
            .as_object_mut()
            .unwrap()
            .remove("display_names")
            .unwrap();
        value["tool_names"] = names;
        let submit = ApprovalSubmit::from_value(&value).unwrap();
        assert_eq!(submit.display_names, vec!["tool_0"]);
        assert!(!submit.inputs.contains_key("tool_names"));
    }

    #[test]
    fn descriptor_text_is_inert_and_decisions_keep_the_approval_id() {
        let mut approvals = set(1);
        approvals.items[0].display = Some(ToolDisplay {
            title: "Friendly [title](https://example.com)".into(),
            description: Some("<b>Not markup</b>".into()),
        });
        approvals.items[0].source = Some("new_server".into());
        approvals.items[0].input = json!({});
        let card = approval_card(&approvals);
        let body = card["content"]["body"].as_array().unwrap();
        assert_eq!(body.len(), 4, "empty argument objects are omitted");
        assert_eq!(body[1]["type"], "RichTextBlock");
        assert_eq!(
            body[1]["inlines"][0]["text"],
            "Run Friendly [title](https://example.com)?"
        );
        assert_eq!(body[2]["inlines"][0]["text"], "new_server / tool_0");
        assert_eq!(body[3]["inlines"][0]["text"], "<b>Not markup</b>");
        let submit = ApprovalSubmit::from_value(&submitted(&card, 0, json!({}))).unwrap();
        assert_eq!(
            submit.decisions().unwrap(),
            vec![("plan:1:0".into(), ApprovalChoice::Approve)]
        );
        assert_eq!(
            submit.display_names,
            vec!["Friendly [title](https://example.com)"]
        );
        assert!(approval_summary(&approvals).contains("Friendly [title]"));
    }

    #[test]
    fn large_multibyte_descriptions_and_inputs_fit_the_card() {
        let mut approvals = set(8);
        for item in &mut approvals.items {
            item.display = Some(ToolDisplay {
                title: "😀".repeat(200),
                description: Some("😀".repeat(4_000)),
            });
            item.input = json!({"text": "😀".repeat(5_000)});
        }
        let card = approval_card(&approvals);
        assert!(card_fits(&card));
        assert!(!card.to_string().contains(OMITTED_DETAILS));
        let submit = ApprovalSubmit::from_value(&submitted(&card, 1, json!({}))).unwrap();
        assert_eq!(submit.decisions().unwrap().len(), 8);
    }

    #[test]
    fn escaped_text_that_overflows_drops_details_but_keeps_every_decision() {
        // `"` and `\` double when the card is serialized; the arguments
        // preview is JSON already, so they double twice.
        let escaped = |bytes: usize| "\"\\".repeat(bytes / 2);
        for count in [4, 8, 30] {
            let mut approvals = set(count);
            approvals.kind = ApprovalKind::DelegatedTask;
            for item in &mut approvals.items {
                item.tool_name = "t".repeat(200);
                item.source = Some("sharepoint-production".into());
                item.display = Some(ToolDisplay {
                    title: escaped(200),
                    description: Some(escaped(4_000)),
                });
                item.input = json!({"text": escaped(5_000)});
            }
            let card = approval_card(&approvals);
            assert!(card_fits(&card), "{count} items");
            assert!(card.to_string().contains(OMITTED_DETAILS));
            let submit = ApprovalSubmit::from_value(&submitted(&card, 1, json!({}))).unwrap();
            assert_eq!(submit.decisions().unwrap().len(), count);
        }
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
