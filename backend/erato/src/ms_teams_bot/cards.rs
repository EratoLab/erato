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
use super::texts::{Lang, Msg};
use crate::services::scheduled_items::chat_tools::{CANCEL_REMINDER, CREATE_REMINDER};
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

/// What the turn is waiting on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalKind {
    McpTool,
    /// One of Erato's own tools, such as cancelling a reminder.
    BuiltinTool,
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
    /// One of Erato's own tools: the card asks about what the call does, and
    /// `display.title` names what it acts on.
    pub own_tool: bool,
    /// The tool-call limit's own choice, which the card's buttons give. The
    /// tasks' items on the same stop are asked about one by one.
    pub budget: bool,
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

    /// The item's question, and what the decided card says was approved or
    /// denied.
    fn ask(&self, lang: Lang) -> (String, String) {
        let name = [("name", self.display_name())];
        match self.tool_name.as_str() {
            CANCEL_REMINDER if self.own_tool => (
                Msg::CancelReminderApproval.fill(lang, &name),
                Msg::CancelReminderAction.fill(lang, &name),
            ),
            CREATE_REMINDER if self.own_tool => (
                Msg::CreateReminderApproval.fill(lang, &name),
                Msg::CreateReminderAction.fill(lang, &name),
            ),
            _ => (
                Msg::RunTool.fill(lang, &[("tool", self.display_name())]),
                self.display_name().to_string(),
            ),
        }
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
    fn decided(self, name: &str, decided_by: &str, lang: Lang) -> String {
        let msg = match self {
            ApprovalChoice::Approve => Msg::ApprovedBy,
            ApprovalChoice::Reject => Msg::DeniedBy,
            ApprovalChoice::Withdraw => Msg::StoppedBy,
        };
        msg.fill(lang, &[("tool", name), ("person", decided_by)])
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

fn heading(set: &PendingApprovalSet, app_name: &str, lang: Lang) -> String {
    let count = set.items.len().to_string();
    let msg = match set.kind {
        ApprovalKind::McpTool | ApprovalKind::BuiltinTool if set.items.len() == 1 => {
            Msg::ApprovalNeeded
        }
        ApprovalKind::McpTool | ApprovalKind::BuiltinTool => Msg::ToolCallsNeedApproval,
        ApprovalKind::TaskPlan => Msg::TasksToStart,
        ApprovalKind::DelegatedTask => Msg::SubTasksWaiting,
        ApprovalKind::ToolCallLimit => Msg::ToolCallLimitReached,
    };
    msg.fill(lang, &[("count", &count), ("app", app_name)])
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

pub fn approval_card(set: &PendingApprovalSet, app_name: &str, lang: Lang) -> Value {
    [Detail::Full, Detail::NoDescriptions, Detail::NoArguments]
        .into_iter()
        .map(|detail| build_approval_card(set, detail, app_name, lang))
        .find(card_fits)
        .unwrap_or_else(|| build_approval_card(set, Detail::Minimal, app_name, lang))
}

fn build_approval_card(
    set: &PendingApprovalSet,
    detail: Detail,
    app_name: &str,
    lang: Lang,
) -> Value {
    let count = set.items.len();
    let heading = heading(set, app_name, lang);
    let item_budget = (MAX_INPUT_PREVIEW_BYTES / count.max(1)).min(MAX_ITEM_PREVIEW_BYTES);
    let asks: Vec<(String, String)> = set.items.iter().map(|item| item.ask(lang)).collect();
    // Display names also travel in each button's data for the decided card.
    let names: Vec<String> = asks
        .iter()
        .map(|(_, name)| bounded_text(name, MAX_NAME_BYTES / count.max(1)))
        .collect();
    let mut body = vec![json!({
        "type": "TextBlock", "text": heading, "weight": "Bolder", "size": "Medium", "wrap": true,
    })];
    let limit = set.kind == ApprovalKind::ToolCallLimit;
    if limit {
        body.push(json!({"type": "TextBlock", "wrap": true,
            "text": Msg::ToolCallLimitChoice.text(lang)}));
    }
    // The limit's own choice is the buttons; its tasks' questions are asked
    // like any other item's.
    let budget_index = set
        .items
        .iter()
        .position(|item| item.budget)
        .filter(|_| limit);
    for (index, item) in set
        .items
        .iter()
        .enumerate()
        .filter(|(index, _)| !limit || budget_index.is_some_and(|budget| budget != *index))
    {
        let question = if item.own_tool {
            bounded_text(&asks[index].0, MAX_NAME_BYTES / count.max(1))
        } else {
            Msg::RunTool.fill(lang, &[("tool", &names[index])])
        };
        let mut title = plain_text(&question, json!({"weight": "Bolder"}));
        title["separator"] = json!(index > 0);
        body.push(title);
        if item.own_tool {
            // Says what the call does in place of the tool and its input.
            let when = item.display.as_ref().and_then(|d| d.description.as_deref());
            body.extend(when.map(|when| plain_text(when, json!({}))));
            // The text that will be delivered, which may come from content the
            // model read rather than from the user, so no card size drops it.
            if item.tool_name == CREATE_REMINDER
                && let Some(message) = item.input["message"].as_str()
            {
                body.push(plain_text(
                    &bounded_text(message, MAX_DESCRIPTION_BYTES / count.max(1)),
                    json!({}),
                ));
            }
            if item.tool_name == CANCEL_REMINDER {
                body.push(plain_text(
                    Msg::CancelReminderExplained.text(lang),
                    json!({"isSubtle": true}),
                ));
            }
        } else if detail < Detail::Minimal {
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
            && !item.own_tool
            && let Some(description) = item.display.as_ref().and_then(|d| d.description.as_deref())
        {
            body.push(plain_text(
                &bounded_text(description, MAX_DESCRIPTION_BYTES / count.max(1)),
                json!({}),
            ));
        }
        if detail < Detail::NoArguments
            && !item.own_tool
            && !item.input.as_object().is_some_and(|input| input.is_empty())
        {
            body.push(plain_text(
                &preview(&item.input, item_budget),
                json!({"fontType": "Monospace", "isSubtle": true}),
            ));
        }
        if count > 1 {
            let ((approve, _), (deny, _)) = answers(Some(item));
            body.push(json!({
                "type": "Input.ChoiceSet",
                "id": input_id(index),
                "style": "expanded",
                "isRequired": true,
                "errorMessage": Msg::ChooseApproveOrDeny.text(lang),
                "choices": [
                    {"title": approve.text(lang), "value": "approve"},
                    {"title": deny.text(lang), "value": "reject"},
                ],
            }));
        }
    }
    if detail > Detail::Full {
        body.push(json!({"type": "TextBlock", "wrap": true, "isSubtle": true,
            "text": Msg::OmittedDetails.fill(lang, &[("app", app_name)])}));
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
    let button = |title: Msg, style: &str, all: Option<ApprovalChoice>| {
        json!({
            "type": "Action.Submit",
            "title": title.text(lang),
            "style": style,
            // Per-item choices only travel (and are required) on the submit button.
            "associatedInputs": if all.is_some() { "none" } else { "auto" },
            "data": data(all),
        })
    };
    let actions = if limit {
        // With tasks asking too, Continue and Answer now carry the budget's
        // choice beside the tasks' own answers. Stop withdraws everything: the
        // tasks' questions go back to their own chats.
        let choose = |title: Msg, style: &str, choice: ApprovalChoice| match budget_index
            .filter(|_| count > 1 && choice != ApprovalChoice::Withdraw)
        {
            Some(index) => {
                let mut action = button(title, style, None);
                action["data"][input_id(index)] = json!(choice);
                action
            }
            None => button(title, style, Some(choice)),
        };
        vec![
            choose(Msg::ContinueToolCalls, "positive", ApprovalChoice::Approve),
            choose(Msg::AnswerNow, "default", ApprovalChoice::Reject),
            choose(Msg::Stop, "destructive", ApprovalChoice::Withdraw),
        ]
    } else if count > 1 {
        vec![
            button(Msg::SubmitDecisions, "default", None),
            button(Msg::ApproveAll, "positive", Some(ApprovalChoice::Approve)),
            button(Msg::DenyAll, "destructive", Some(ApprovalChoice::Reject)),
        ]
    } else {
        let ((approve, approve_style), (deny, deny_style)) = answers(set.items.first());
        vec![
            button(approve, approve_style, Some(ApprovalChoice::Approve)),
            button(deny, deny_style, Some(ApprovalChoice::Reject)),
        ]
    };
    adaptive_card(body, actions)
}

/// The two answers to an item with their button styles. A reminder question
/// keeps its own words on a shared card too, as on the web.
fn answers(item: Option<&PendingApprovalItem>) -> ((Msg, &'static str), (Msg, &'static str)) {
    match item
        .filter(|item| item.own_tool)
        .map(|item| item.tool_name.as_str())
    {
        Some(CANCEL_REMINDER) => (
            (Msg::CancelReminderConfirm, "destructive"),
            (Msg::KeepReminder, "default"),
        ),
        Some(CREATE_REMINDER) => (
            (Msg::CreateReminderConfirm, "positive"),
            (Msg::CreateReminderDeny, "destructive"),
        ),
        _ => ((Msg::Approve, "positive"), (Msg::Deny, "destructive")),
    }
}

/// Sent when the bot joins someone's personal chat, so the first thing they
/// see is how to start rather than an error on their first question.
pub fn welcome_card(
    app_name: &str,
    known_user: bool,
    tab_name: Option<&str>,
    open_url: Option<&str>,
    lang: Lang,
) -> Value {
    let app = ("app", app_name);
    let mut body = vec![plain_text(&Msg::Welcome.fill(lang, &[app]), json!({}))];
    if !known_user {
        let where_to = match tab_name {
            Some(tab) => Msg::WelcomeOpenTab.fill(lang, &[("tab", tab)]),
            None => Msg::WelcomeOpenApp.fill(lang, &[app]),
        };
        body.push(plain_text(&where_to, json!({})));
    }
    let actions = open_url
        .map(|url| json!({"type": "Action.OpenUrl", "title": Msg::OpenApp.fill(lang, &[app]), "url": url}))
        .into_iter()
        .collect();
    adaptive_card(body, actions)
}

/// What replaces the card once decided, so it cannot be answered twice.
pub fn decided_card(decisions: &[(String, ApprovalChoice)], decided_by: &str, lang: Lang) -> Value {
    let body = decisions
        .iter()
        .map(|(name, choice)| plain_text(&choice.decided(name, decided_by, lang), json!({})))
        .collect();
    adaptive_card(body, Vec::new())
}

/// Notification and preview text: the card heading, plus what the card body
/// would otherwise have said. A task plan's items are all `delegate_task`, so
/// only tool approvals name their tool.
pub fn approval_summary(set: &PendingApprovalSet, app_name: &str, lang: Lang) -> String {
    match (set.kind, set.items.as_slice()) {
        (ApprovalKind::ToolCallLimit, _) => {
            Msg::ToolCallLimitSummary.fill(lang, &[("heading", &heading(set, app_name, lang))])
        }
        (_, [item]) if item.own_tool => {
            format!("{}: {}", heading(set, app_name, lang), item.ask(lang).0)
        }
        (ApprovalKind::McpTool | ApprovalKind::DelegatedTask, [item]) => {
            Msg::ApprovalSummary.fill(lang, &[("tool", item.display_name())])
        }
        _ => format!("{}.", heading(set, app_name, lang)),
    }
}

pub fn decided_summary(
    decisions: &[(String, ApprovalChoice)],
    decided_by: &str,
    lang: Lang,
) -> String {
    decisions
        .iter()
        .map(|(name, choice)| choice.decided(name, decided_by, lang))
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

    #[test]
    fn welcome_card_tells_unknown_users_where_to_sign_in_first() {
        let card = welcome_card(
            "Hugo",
            false,
            Some("Hugo"),
            Some("https://hugo.example.com"),
            Lang::En,
        );
        let text = card.to_string();
        assert!(text.contains("Hi, I'm Hugo."));
        assert!(text.contains("Open the Hugo tab at the top of this chat once"));
        assert_eq!(
            card["content"]["actions"][0]["url"],
            "https://hugo.example.com"
        );
        let known = welcome_card("Hugo", true, Some("Hugo"), None, Lang::En);
        assert!(!known.to_string().contains("so I know your account"));
        assert_eq!(known["content"]["actions"], json!([]));
    }

    #[test]
    fn a_german_user_gets_the_welcome_and_approval_cards_in_german() {
        let card = welcome_card(
            "Hugo",
            false,
            Some("Hugo"),
            Some("https://hugo.example.com"),
            Lang::De,
        );
        let text = card.to_string();
        assert!(text.contains("Hallo, ich bin Hugo."));
        assert!(text.contains("Öffnen Sie einmal den Tab Hugo oben in diesem Chat"));
        assert_eq!(card["content"]["actions"][0]["title"], "Hugo öffnen");

        let card = approval_card(&set(2), "Hugo", Lang::De);
        assert_eq!(
            card["content"]["body"][0]["text"],
            "Hugo möchte 2 Aufgabe(n) starten"
        );
        let titles: Vec<_> = card["content"]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|action| action["title"].as_str().unwrap())
            .collect();
        assert_eq!(
            titles,
            ["Entscheidungen senden", "Alle genehmigen", "Alle ablehnen"]
        );
        assert_eq!(
            approval_summary(&set(1), "Hugo", Lang::De),
            "Genehmigung erforderlich, um tool_0 auszuführen."
        );
        let decided = [("tool_0".to_string(), ApprovalChoice::Reject)];
        assert_eq!(
            decided_summary(&decided, "Ihnen", Lang::De),
            "tool_0 wurde von Ihnen abgelehnt."
        );
    }

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
                    own_tool: false,
                    budget: false,
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
        assert_eq!(
            approval_summary(&set(1), "Erato", Lang::En),
            "Approval needed to run tool_0."
        );
        assert_eq!(
            approval_summary(&set(3), "Erato", Lang::En),
            "Erato wants to start 3 task(s)."
        );
    }

    fn reminder_cancel() -> PendingApprovalSet {
        PendingApprovalSet {
            message_id: "m-1".into(),
            kind: ApprovalKind::BuiltinTool,
            items: vec![PendingApprovalItem {
                approval_id: "call_cancel".into(),
                tool_name: CANCEL_REMINDER.into(),
                display: Some(ToolDisplay {
                    title: "Follow up on the offer".into(),
                    description: Some("Friday, 13 Nov, 10:00".into()),
                }),
                source: None,
                input: json!({"reminder_id": "0b9f3c1e-0000-4000-8000-000000000001"}),
                own_tool: true,
                budget: false,
            }],
        }
    }

    fn texts(card: &Value) -> Vec<String> {
        card["content"]["body"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|block| {
                block["text"]
                    .as_str()
                    .or_else(|| block["inlines"][0]["text"].as_str())
                    .map(str::to_string)
            })
            .collect()
    }

    fn action_titles(card: &Value) -> Vec<&str> {
        card["content"]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|action| action["title"].as_str().unwrap())
            .collect()
    }

    /// A cancel by chat asks about the reminder, never about a tool and its
    /// input, with the same note and answers as the confirmation card's own
    /// Cancel, and the decided card says what was approved.
    #[test]
    fn a_reminder_cancel_is_asked_about_in_the_users_words() {
        let set = reminder_cancel();
        let card = approval_card(&set, "Hugo", Lang::En);
        assert_eq!(
            texts(&card),
            [
                "Approval needed",
                "Cancel the reminder “Follow up on the offer”?",
                "Friday, 13 Nov, 10:00",
                "It will no longer be delivered. You can still find it under Past on the Scheduled page.",
            ]
        );
        assert_eq!(action_titles(&card), ["Cancel it", "Keep it"]);
        assert!(!card.to_string().contains("reminder_id"), "{card}");
        let submit = ApprovalSubmit::from_value(&submitted(&card, 0, json!({}))).unwrap();
        assert_eq!(
            submit.decisions(),
            Some(vec![("call_cancel".to_string(), ApprovalChoice::Approve)])
        );
        let decided: Vec<_> = submit
            .display_names
            .into_iter()
            .zip([ApprovalChoice::Approve])
            .collect();
        assert_eq!(
            decided_summary(&decided, "you", Lang::En),
            "Cancelling the reminder “Follow up on the offer” was approved by you."
        );
        assert_eq!(
            approval_summary(&set, "Hugo", Lang::En),
            "Approval needed: Cancel the reminder “Follow up on the offer”?"
        );

        let german = approval_card(&set, "Hugo", Lang::De);
        assert_eq!(
            texts(&german)[1],
            "Die Erinnerung „Follow up on the offer“ abbrechen?"
        );
        assert_eq!(action_titles(&german), ["Ja, abbrechen", "Behalten"]);
    }

    /// A create by chat shows the message that will be delivered: it is the
    /// one part of the call that content the model read can fill in.
    #[test]
    fn a_reminder_create_shows_what_will_be_delivered() {
        let mut set = reminder_cancel();
        set.items[0].tool_name = CREATE_REMINDER.into();
        set.items[0].input = json!({
            "name": "Follow up on the offer",
            "message": "Re-verify at https://example.invalid/login",
            "trigger": {"kind": "once", "date": "2026-11-13", "time": "10:00"},
        });
        let card = approval_card(&set, "Hugo", Lang::En);
        assert_eq!(
            texts(&card)[1..],
            [
                "Schedule the reminder “Follow up on the offer”?",
                "Friday, 13 Nov, 10:00",
                "Re-verify at https://example.invalid/login",
            ]
        );
        assert_eq!(action_titles(&card), ["Schedule", "Don't schedule"]);
        assert_eq!(
            action_titles(&approval_card(&set, "Hugo", Lang::De)),
            ["Planen", "Nicht planen"]
        );
    }

    /// On a card shared with other decisions, a create keeps the message it
    /// will deliver even when the size limit drops every other detail, and
    /// each reminder question keeps its own answers.
    #[test]
    fn a_shared_card_keeps_the_reminders_message_and_answers() {
        let mut create = reminder_cancel().items.remove(0);
        create.approval_id = "call_create".into();
        create.tool_name = CREATE_REMINDER.into();
        create.input = json!({
            "name": "Follow up on the offer",
            "message": "Re-verify at https://example.invalid/login",
        });
        let cancel = reminder_cancel().items.remove(0);
        let escaped = |bytes: usize| "\"\\".repeat(bytes / 2);
        let mut shared = set(30);
        shared.kind = ApprovalKind::BuiltinTool;
        for item in &mut shared.items {
            item.tool_name = "t".repeat(200);
            item.source = Some("sharepoint-production".into());
            item.display = Some(ToolDisplay {
                title: escaped(200),
                description: Some(escaped(4_000)),
            });
            item.input = json!({"text": escaped(5_000)});
        }
        shared.items.insert(0, create);
        shared.items.insert(1, cancel);

        let card = approval_card(&shared, "Hugo", Lang::En);
        assert!(card_fits(&card));
        let all = texts(&card);
        assert!(all.contains(&Msg::OmittedDetails.fill(Lang::En, &[("app", "Hugo")])));
        assert!(
            all.iter()
                .any(|text| text == "Re-verify at https://example.invalid/login"),
            "{all:?}"
        );
        let choices: Vec<Vec<&str>> = card["content"]["body"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|block| block["type"] == "Input.ChoiceSet")
            .map(|block| {
                block["choices"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|choice| choice["title"].as_str().unwrap())
                    .collect()
            })
            .collect();
        assert_eq!(choices.len(), 32);
        assert_eq!(choices[0], ["Schedule", "Don't schedule"]);
        assert_eq!(choices[1], ["Cancel it", "Keep it"]);
        assert_eq!(choices[2], ["Approve", "Deny"]);
    }

    #[test]
    fn a_single_item_card_submits_its_decision() {
        let card = approval_card(&set(1), "Erato", Lang::En);
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
        let card = approval_card(&set(2), "Erato", Lang::En);
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

    /// The tool-call limit's stop alone asks only its own choice. A task that
    /// asks on the same stop is a question of its own, and Continue or Answer
    /// now sends the budget's choice beside the task's answer, while Stop
    /// withdraws both.
    #[test]
    fn a_tool_call_limit_card_asks_its_tasks_questions_too() {
        let budget = PendingApprovalItem {
            approval_id: "tool-budget:1".into(),
            tool_name: "Tool-call budget".into(),
            display: None,
            source: None,
            input: json!({"budget": 4}),
            own_tool: false,
            budget: true,
        };
        let alone = PendingApprovalSet {
            message_id: "m-1".into(),
            kind: ApprovalKind::ToolCallLimit,
            items: vec![budget.clone()],
        };
        let card = approval_card(&alone, "Erato", Lang::En);
        assert_eq!(
            texts(&card),
            [
                "Tool-call limit reached",
                Msg::ToolCallLimitChoice.text(Lang::En)
            ]
        );
        assert_eq!(
            action_titles(&card),
            ["Continue tool calls", "Generate answer now", "Stop"]
        );
        let submit = ApprovalSubmit::from_value(&submitted(&card, 1, json!({}))).unwrap();
        assert_eq!(
            submit.decisions(),
            Some(vec![("tool-budget:1".to_string(), ApprovalChoice::Reject)])
        );

        let mut with_task = alone.clone();
        with_task.items.push(PendingApprovalItem {
            approval_id: "task-call".into(),
            tool_name: "publish_approval_probe".into(),
            display: None,
            source: Some("Approvals".into()),
            input: json!({}),
            own_tool: false,
            budget: false,
        });
        let card = approval_card(&with_task, "Erato", Lang::En);
        let all = texts(&card);
        assert!(
            all.contains(&"Run publish_approval_probe?".to_string()),
            "{all:?}"
        );
        assert!(
            !all.contains(&"Run Tool-call budget?".to_string()),
            "{all:?}"
        );
        let choice_sets: Vec<&Value> = card["content"]["body"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|block| block["type"] == "Input.ChoiceSet")
            .collect();
        assert_eq!(choice_sets.len(), 1, "only the task asks: {card}");
        assert_eq!(choice_sets[0]["id"], "d1");
        assert_eq!(
            action_titles(&card),
            ["Continue tool calls", "Generate answer now", "Stop"]
        );

        let cont =
            ApprovalSubmit::from_value(&submitted(&card, 0, json!({"d1": "approve"}))).unwrap();
        assert_eq!(
            cont.decisions(),
            Some(vec![
                ("tool-budget:1".to_string(), ApprovalChoice::Approve),
                ("task-call".to_string(), ApprovalChoice::Approve),
            ])
        );
        let answer =
            ApprovalSubmit::from_value(&submitted(&card, 1, json!({"d1": "reject"}))).unwrap();
        assert_eq!(
            answer.decisions(),
            Some(vec![
                ("tool-budget:1".to_string(), ApprovalChoice::Reject),
                ("task-call".to_string(), ApprovalChoice::Reject),
            ])
        );
        assert_eq!(card["content"]["actions"][2]["associatedInputs"], "none");
        let stop = ApprovalSubmit::from_value(&submitted(&card, 2, json!({}))).unwrap();
        assert_eq!(
            stop.decisions(),
            Some(vec![
                ("tool-budget:1".to_string(), ApprovalChoice::Withdraw),
                ("task-call".to_string(), ApprovalChoice::Withdraw),
            ])
        );
    }

    #[test]
    fn cards_posted_before_the_rename_keep_their_names() {
        let mut value = submitted(&approval_card(&set(1), "Erato", Lang::En), 0, json!({}));
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
        let card = approval_card(&approvals, "Erato", Lang::En);
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
        assert!(approval_summary(&approvals, "Erato", Lang::En).contains("Friendly [title]"));
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
        let card = approval_card(&approvals, "Erato", Lang::En);
        assert!(card_fits(&card));
        assert!(
            !card
                .to_string()
                .contains(&Msg::OmittedDetails.fill(Lang::En, &[("app", "Erato")]))
        );
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
            let card = approval_card(&approvals, "Erato", Lang::En);
            assert!(card_fits(&card), "{count} items");
            assert!(
                card.to_string()
                    .contains(&Msg::OmittedDetails.fill(Lang::En, &[("app", "Erato")]))
            );
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
