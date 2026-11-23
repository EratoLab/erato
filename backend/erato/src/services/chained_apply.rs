//! The server-chained apply.
//!
//! A submission whose tool names `[submission.apply]` is checked by the client
//! as before. Once the client accepts it, the server itself calls the named
//! `called_by = "server"` tool with the accepted submission's call id, through
//! the normal client tool approval. The model never calls the apply tool, so
//! the change the user approves is always the change the client checked.
//!
//! After the apply's result, the answer ends without another model request
//! unless the result needs it (it did not fully apply, or the host asks for a
//! follow-up) or the submission said more steps follow (`more_steps`).

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::config::{
    ClientToolApproval, ClientToolCalledBy, ClientToolConfig, ClientToolSubmissionApplyConfig,
    ClientToolsConfig,
};
use crate::models::message::{ContentPart, InputMessage, MessageRole, ToolDisplayMetadata};
use crate::models::user_preference::ClientToolDecision;
use crate::services::client_tools::{ClientToolOutcome, OfferedClientTool};
use crate::services::display_text::{MAX_DISPLAY_NAME_CHARS, sanitize_display_text};
use crate::services::prompt_composition::replay_policy::ToolReplayPolicy;
use crate::services::submission_correction::SubmissionOutcome;

/// Appended to the accepted submission's call id. A model's call id never
/// carries it, so the chained call cannot collide with one.
pub const CALL_ID_SUFFIX: &str = ".apply";
/// The reason of a chained call whose client went away before it answered.
pub const PANE_GONE: &str = "pane_gone";
/// Largest `client_confirmation` a decision may carry, as JSON.
pub const MAX_CLIENT_CONFIRMATION_BYTES: usize = 4096;
const MAX_REASON_CHARS: usize = 64;
const MAX_SUMMARY_CHARS: usize = 500;
const MAX_DRAFT_ID_CHARS: usize = 128;

const SUBMISSION_NOTE: &str = "The checked change was accepted. Its result is shortened here; the result of applying it follows.";
const CONSUMED_READ_NOTE: &str = "This result describes the state before a change was applied in this answer, so its content is left out. Read again for the current state.";

/// One chained apply of the answer, kept with the turn's consumption.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChainedApplyState {
    pub submission_call_id: String,
    /// Qualified name of the submission tool.
    pub submission_tool: String,
    /// Qualified name of the apply tool.
    pub apply_tool: String,
    #[serde(default)]
    pub more_steps: bool,
    /// The facet actions the change uses, from the receipt; empty means all of
    /// the apply tool's `client_actions`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<String>,
    /// The user decides on screen: no Always, no voice.
    #[serde(default)]
    pub decide_on_screen: bool,
    /// The host's code for a re-park after `needs_decision`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The call was parked again once after `needs_decision`.
    #[serde(default)]
    pub reparked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// How many chained applies the answer had made before this one.
    #[serde(default)]
    pub order: u32,
    /// The accepted submission's outcome, which the message keeps once the
    /// next change has not started.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submission_outcome: Option<SubmissionOutcome>,
}

/// The latest chained apply's submission outcome.
pub fn latest_outcome(chained: &BTreeMap<String, ChainedApplyState>) -> Option<&SubmissionOutcome> {
    chained
        .values()
        .max_by_key(|state| state.order)
        .and_then(|state| state.submission_outcome.as_ref())
}

/// What the client's receipt says about the change, for the card and the
/// gate. Facts only: neither field can make a call skip a question.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ApplyPreview {
    pub title: Option<String>,
    pub summary: Option<String>,
    pub actions: Vec<String>,
    pub decide_on_screen: bool,
}

/// Reads `approval_preview` of an accepted submission's result. Actions the
/// apply tool does not list are dropped.
pub fn read_preview(result: &Value, apply: &ClientToolConfig) -> ApplyPreview {
    let Some(preview) = result
        .get("approval_preview")
        .filter(|value| value.is_object())
    else {
        return ApplyPreview::default();
    };
    let text = |key: &str, max: usize| {
        preview
            .get(key)
            .and_then(Value::as_str)
            .map(|text| sanitize_display_text(text, max).text)
            .filter(|text| !text.is_empty())
    };
    let mut actions: Vec<String> = preview
        .get("actions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|action| apply.client_actions.iter().any(|known| known == action))
        .map(str::to_owned)
        .collect();
    actions.sort();
    actions.dedup();
    ApplyPreview {
        title: text("title", MAX_DISPLAY_NAME_CHARS),
        summary: text("summary", MAX_SUMMARY_CHARS),
        actions,
        decide_on_screen: preview.get("decide_on_screen") == Some(&Value::Bool(true)),
    }
}

/// The chained call's input: which accepted submission to apply.
pub fn apply_input(submission_call_id: &str, result: &Value) -> Value {
    let draft_id = result
        .get("draft_id")
        .and_then(Value::as_str)
        .filter(|id| id.chars().count() <= MAX_DRAFT_ID_CHARS);
    json!({
        "submission_call_id": submission_call_id,
        "draft_id": draft_id,
        "confirmation": null,
    })
}

/// Removes the top-level argument `pointer` names and returns its value.
pub fn take_more_steps(input: &mut Value, pointer: &str) -> Option<Value> {
    let key = pointer.strip_prefix('/')?;
    input.as_object_mut()?.remove(key)
}

/// The arguments as the model sent them, for the schema check.
pub fn with_more_steps(input: &Value, pointer: &str, value: &Value) -> Value {
    let mut restored = input.clone();
    if let (Some(key), Some(object)) = (pointer.strip_prefix('/'), restored.as_object_mut()) {
        object.insert(key.to_string(), value.clone());
    }
    restored
}

/// The apply configuration of a submission, when its apply tool is offered.
pub fn offered_apply<'a>(
    submission: &'a OfferedClientTool,
    offered: &'a HashMap<String, OfferedClientTool>,
) -> Option<(&'a ClientToolSubmissionApplyConfig, &'a OfferedClientTool)> {
    let apply = submission.config.submission.as_ref()?.apply.as_ref()?;
    let tool = offered.values().find(|tool| {
        tool.config.called_by == ClientToolCalledBy::Server
            && tool.config.qualified_name() == apply.tool
    })?;
    Some((apply, tool))
}

/// Qualified names of the submissions, and their part tools, whose apply tool
/// the user set to Never: changes are turned off, so none is offered.
pub fn turned_off(
    tools: &HashMap<String, ClientToolConfig>,
    decisions: &BTreeMap<String, ClientToolDecision>,
) -> HashSet<String> {
    let mut names = HashSet::new();
    for tool in tools.values() {
        let Some(submission) = &tool.submission else {
            continue;
        };
        let Some(apply) = &submission.apply else {
            continue;
        };
        if decisions.get(&apply.tool) == Some(&ClientToolDecision::NeverAllow) {
            names.insert(tool.qualified_name());
            names.extend(submission.part_tools.iter().cloned());
        }
    }
    names
}

/// Adds the apply tool of every offered submission to `offered`, when the
/// requesting client registered it and the user did not set it to Never. It
/// is never offered to the model: the caller keeps it out of the tool list.
pub fn offer_apply_tools(
    tools: &HashMap<String, ClientToolConfig>,
    offered: &mut HashMap<String, OfferedClientTool>,
    registered: &[String],
    decisions: &BTreeMap<String, ClientToolDecision>,
    facet_always_ask: &[String],
    executor_for: impl Fn(
        &ClientToolConfig,
    ) -> Option<crate::services::client_operations::ExecutorBinding>,
) {
    let wanted: Vec<String> = offered
        .values()
        .filter_map(|tool| tool.config.submission.as_ref()?.apply.as_ref())
        .map(|apply| apply.tool.clone())
        .collect();
    for qualified in wanted {
        let Some(apply) = tools.values().find(|tool| {
            tool.called_by == ClientToolCalledBy::Server && tool.qualified_name() == qualified
        }) else {
            continue;
        };
        if !crate::services::client_tools::client_tool_is_available(apply, registered)
            || decisions.get(&qualified) == Some(&ClientToolDecision::NeverAllow)
        {
            continue;
        }
        if offered.contains_key(&apply.name) {
            tracing::warn!(
                "Not chaining the apply tool '{qualified}': another offered tool already uses the name '{}'",
                apply.name
            );
            continue;
        }
        let Ok(mut policy) = OfferedClientTool::prepare(apply, &json!({"type": "object"})) else {
            continue;
        };
        policy.executor = executor_for(apply);
        policy.always_ask_actions = facet_always_ask
            .iter()
            .filter(|action| apply.client_actions.contains(action))
            .cloned()
            .collect();
        offered.insert(apply.name.clone(), policy);
    }
}

/// The names of the offered tools the server calls, which the dispatch loop
/// must accept although the model is never offered them.
pub fn server_called_names(
    offered: &HashMap<String, OfferedClientTool>,
) -> impl Iterator<Item = &String> {
    offered
        .iter()
        .filter(|(_, tool)| tool.config.called_by == ClientToolCalledBy::Server)
        .map(|(name, _)| name)
}

/// What the gate does with a call of a tool with an `approval` setting other
/// than the plain user decision, or of a chained apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gate {
    Run,
    Refuse,
    Ask {
        allow_always: bool,
    },
    /// The ordinary client tool gate decides.
    Ordinary,
}

/// Why a call asks however the user decided before.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AskReasons {
    /// The facet asks every time for an action the call uses.
    pub facet_always_asks: bool,
    /// The user asked for a change to the previous chained apply; they see
    /// the corrected one, and may still allow it always.
    pub after_change_request: bool,
    /// The card needs the user's choice on screen.
    pub decide_on_screen: bool,
}

/// The gate table for chained and `every_call` / `none` calls. A chained call
/// with no stored decision asks: writes ask by default.
pub fn gate(
    approval: ClientToolApproval,
    decision: Option<ClientToolDecision>,
    chained: bool,
    reasons: AskReasons,
) -> Gate {
    if approval == ClientToolApproval::None {
        return Gate::Run;
    }
    if decision == Some(ClientToolDecision::NeverAllow) {
        return Gate::Refuse;
    }
    if reasons.decide_on_screen
        || reasons.facet_always_asks
        || approval == ClientToolApproval::EveryCall
    {
        return Gate::Ask {
            allow_always: false,
        };
    }
    if reasons.after_change_request && chained {
        return Gate::Ask { allow_always: true };
    }
    if !chained {
        return Gate::Ordinary;
    }
    match decision {
        Some(ClientToolDecision::AlwaysAllow) => Gate::Run,
        _ => Gate::Ask { allow_always: true },
    }
}

/// Whether the facet's always-ask actions meet the actions of a call: a
/// chained apply's receipt actions, else every action the tool carries out.
pub fn facet_always_asks(tool: &OfferedClientTool, actions: &[String]) -> bool {
    let used: &[String] = if actions.is_empty() {
        &tool.config.client_actions
    } else {
        actions
    };
    tool.always_ask_actions
        .iter()
        .any(|action| used.contains(action))
}

/// How the apply ended, as the continue rule reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyReport {
    pub status: String,
    pub reason: Option<String>,
    pub needs_follow_up: bool,
}

pub fn report(outcome: &ClientToolOutcome) -> ApplyReport {
    match outcome {
        ClientToolOutcome::Result(result, _) => ApplyReport {
            status: result
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("failed")
                .to_string(),
            reason: result
                .get("reason")
                .and_then(Value::as_str)
                .map(|reason| reason.chars().take(MAX_REASON_CHARS).collect()),
            needs_follow_up: result.get("needs_follow_up") == Some(&Value::Bool(true)),
        },
        ClientToolOutcome::Cancelled { reason } if reason == PANE_GONE => ApplyReport {
            status: "unavailable".into(),
            reason: Some(PANE_GONE.into()),
            needs_follow_up: false,
        },
        ClientToolOutcome::Cancelled { reason } => ApplyReport {
            status: "failed".into(),
            reason: Some(reason.clone()),
            needs_follow_up: false,
        },
        ClientToolOutcome::Error(_) | ClientToolOutcome::ValidationFailed(..) => ApplyReport {
            status: "failed".into(),
            reason: Some("host_error".into()),
            needs_follow_up: false,
        },
    }
}

/// What follows an apply's result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AfterApply {
    /// The host found during the write that the user must tick something:
    /// the same call asks again, on screen, without a model request.
    Repark {
        reason: Option<String>,
    },
    End,
    Continue,
}

/// The continue rule, in order: a first `needs_decision` asks again; a lost
/// pane ends; anything short of `applied`, a follow-up the host asks for, or
/// more planned steps continue; a clean single change ends.
pub fn after_apply(report: &ApplyReport, state: &ChainedApplyState) -> AfterApply {
    if report.status == "needs_decision" {
        return if state.reparked {
            AfterApply::Continue
        } else {
            AfterApply::Repark {
                reason: report.reason.clone(),
            }
        };
    }
    if report.status == "unavailable" && report.reason.as_deref() == Some(PANE_GONE) {
        return AfterApply::End;
    }
    if report.status != "applied" || report.needs_follow_up || state.more_steps {
        return AfterApply::Continue;
    }
    AfterApply::End
}

/// A second `needs_decision` for the same call is recorded as a failure.
pub fn mark_needs_decision_again(output: &mut Value) {
    if let Some(result) = output.get_mut("result").and_then(Value::as_object_mut) {
        result.insert("status".into(), json!("failed"));
        result.insert("reason".into(), json!("needs_decision_again"));
    }
}

/// What the model reads of an accepted chained submission: its replay
/// receipt when the tool has one, never the card's preview.
pub fn submission_model_output(
    output: &Value,
    tool_name: &str,
    replay: &ToolReplayPolicy,
) -> Value {
    let mut text = replay
        .shortened_result(tool_name, output, SUBMISSION_NOTE)
        .unwrap_or_else(|| output.clone());
    if let Some(result) = text.get_mut("result").and_then(Value::as_object_mut) {
        result.remove("approval_preview");
    }
    if let Some(object) = text.as_object_mut() {
        object.remove("apply");
    }
    text
}

/// What the model reads of a read of the state an applied change replaced.
pub fn consumed_read_output(
    output: &Value,
    tool_name: &str,
    replay: &ToolReplayPolicy,
) -> Option<Value> {
    replay.shortened_result(tool_name, output, CONSUMED_READ_NOTE)
}

/// The model-facing names the in-answer cuts need.
#[derive(Debug, Clone, Default)]
pub struct AnswerCuts {
    pub replay: ToolReplayPolicy,
    /// Submissions with an apply table.
    pub submissions: HashSet<String>,
    pub consumed_reads: HashSet<String>,
    pub apply_tools: HashSet<String>,
}

impl AnswerCuts {
    pub fn from_config(config: &ClientToolsConfig) -> Self {
        let mut cuts = Self {
            replay: ToolReplayPolicy::from_client_tools(config),
            ..Default::default()
        };
        for tool in config.tools.values() {
            let Some(submission) = &tool.submission else {
                continue;
            };
            let Some(apply) = &submission.apply else {
                continue;
            };
            cuts.submissions.insert(tool.name.clone());
            for read in submission.consumed_reads() {
                if let Some(read) = config
                    .tools
                    .values()
                    .find(|candidate| candidate.qualified_name() == *read)
                {
                    cuts.consumed_reads.insert(read.name.clone());
                }
            }
            if let Some(applier) = config
                .tools
                .values()
                .find(|candidate| candidate.qualified_name() == apply.tool)
            {
                cuts.apply_tools.insert(applier.name.clone());
            }
        }
        cuts
    }

    pub fn is_empty(&self) -> bool {
        self.submissions.is_empty()
    }

    /// The model-facing results of the answer's earlier calls once a chained
    /// apply ran and the answer goes on, by call id: every read of the
    /// replaced state shortened to its receipt.
    pub fn consumed_reads_in(&self, content: &[ContentPart]) -> HashMap<String, Value> {
        content
            .iter()
            .filter_map(|part| match part {
                ContentPart::ToolUse(tool_use)
                    if self.consumed_reads.contains(&tool_use.tool_name) =>
                {
                    let output = tool_use.output.as_ref()?;
                    let shortened =
                        consumed_read_output(output, &tool_use.tool_name, &self.replay)?;
                    Some((tool_use.tool_call_id.clone(), shortened))
                }
                _ => None,
            })
            .collect()
    }

    /// Applies the in-answer cuts to the replay of the answer in progress, as
    /// a continuation rebuilds it: an accepted chained submission reads as
    /// its receipt, and the reads before the latest apply that ran read as
    /// theirs, as they did before the answer stopped.
    pub fn apply_to_replay(&self, messages: &mut [InputMessage]) {
        if self.is_empty() {
            return;
        }
        let last_apply = messages.iter().rposition(|message| {
            matches!(
                (&message.role, &message.content),
                (MessageRole::Tool, ContentPart::ToolUse(tool_use))
                    if self.apply_tools.contains(&tool_use.tool_name) && tool_use.output.is_some()
            )
        });
        for (index, message) in messages.iter_mut().enumerate() {
            if message.role != MessageRole::Tool {
                continue;
            }
            let ContentPart::ToolUse(tool_use) = &mut message.content else {
                continue;
            };
            let Some(output) = tool_use.output.as_ref() else {
                continue;
            };
            let chained_submission = self.submissions.contains(&tool_use.tool_name)
                && output
                    .pointer("/apply/call_id")
                    .is_some_and(Value::is_string);
            let shortened = if chained_submission {
                Some(submission_model_output(
                    output,
                    &tool_use.tool_name,
                    &self.replay,
                ))
            } else if last_apply.is_some_and(|last| index < last)
                && self.consumed_reads.contains(&tool_use.tool_name)
            {
                consumed_read_output(output, &tool_use.tool_name, &self.replay)
            } else {
                None
            };
            if let Some(shortened) = shortened {
                tool_use.output = Some(shortened);
            }
        }
    }
}

/// The approval card's display: the apply tool's label, titled and
/// described by the client's receipt, else by the tool's description.
pub fn card_display(
    config: &ClientToolConfig,
    input: &Value,
    state: &ChainedApplyState,
) -> ToolDisplayMetadata {
    let title = state
        .title
        .clone()
        .unwrap_or_else(|| sanitize_display_text(&config.description, MAX_DISPLAY_NAME_CHARS).text);
    match crate::services::tool_display::client_tool_call_display(config, input) {
        Some(display) => ToolDisplayMetadata {
            title,
            description: state.summary.clone(),
            description_truncated: false,
            ..display
        },
        None => ToolDisplayMetadata {
            title,
            description: state.summary.clone(),
            description_truncated: false,
            server_name: None,
            tool_name: None,
            label: None,
            read_only: false,
            closed_world: false,
            plain_read: false,
        },
    }
}

/// Bounds a host's reason code for the card.
pub fn bounded_reason(reason: Option<&str>) -> Option<String> {
    reason
        .map(|reason| reason.chars().take(MAX_REASON_CHARS).collect::<String>())
        .filter(|reason| !reason.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply_tool() -> ClientToolConfig {
        ClientToolConfig {
            name: "apply_comment_changes".into(),
            namespace: Some("word".into()),
            called_by: ClientToolCalledBy::Server,
            client_actions: vec!["word.add_comments".into(), "word.modify_comments".into()],
            ..Default::default()
        }
    }

    #[test]
    fn the_preview_keeps_known_actions_and_bounded_text() {
        let preview = read_preview(
            &json!({"approval_preview": {
                "title": "Change \u{202e}“Vertrag.docx”",
                "summary": "x".repeat(900),
                "actions": ["word.modify_comments", "word.delete_everything"],
                "decide_on_screen": true,
            }}),
            &apply_tool(),
        );
        assert_eq!(preview.title.as_deref(), Some("Change “Vertrag.docx”"));
        assert_eq!(preview.summary.unwrap().chars().count(), MAX_SUMMARY_CHARS);
        assert_eq!(preview.actions, vec!["word.modify_comments".to_string()]);
        assert!(preview.decide_on_screen);
        assert_eq!(
            read_preview(&json!({}), &apply_tool()),
            ApplyPreview::default()
        );
    }

    #[test]
    fn the_gate_asks_writes_by_default_and_never_skips_a_forced_question() {
        use ClientToolDecision::*;
        let none = AskReasons::default();
        let chained =
            |decision, reasons| gate(ClientToolApproval::UserDecision, decision, true, reasons);
        assert_eq!(chained(None, none), Gate::Ask { allow_always: true });
        assert_eq!(chained(Some(Ask), none), Gate::Ask { allow_always: true });
        assert_eq!(chained(Some(AlwaysAllow), none), Gate::Run);
        assert_eq!(chained(Some(NeverAllow), none), Gate::Refuse);
        let on_screen = AskReasons {
            decide_on_screen: true,
            ..none
        };
        assert_eq!(
            chained(Some(AlwaysAllow), on_screen),
            Gate::Ask {
                allow_always: false
            }
        );
        let facet = AskReasons {
            facet_always_asks: true,
            ..none
        };
        assert_eq!(
            chained(Some(AlwaysAllow), facet),
            Gate::Ask {
                allow_always: false
            }
        );
        let change = AskReasons {
            after_change_request: true,
            ..none
        };
        assert_eq!(
            chained(Some(AlwaysAllow), change),
            Gate::Ask { allow_always: true }
        );
        assert_eq!(
            gate(
                ClientToolApproval::EveryCall,
                Some(AlwaysAllow),
                false,
                none
            ),
            Gate::Ask {
                allow_always: false
            }
        );
        assert_eq!(
            gate(ClientToolApproval::EveryCall, Some(NeverAllow), false, none),
            Gate::Refuse
        );
        assert_eq!(
            gate(ClientToolApproval::None, Some(NeverAllow), false, none),
            Gate::Run
        );
        assert_eq!(
            gate(ClientToolApproval::UserDecision, None, false, none),
            Gate::Ordinary
        );
    }

    #[test]
    fn the_continue_rule_ends_only_a_clean_last_change() {
        let state = ChainedApplyState::default();
        let result = |value: Value| report(&ClientToolOutcome::Result(value, vec![]));
        assert_eq!(
            after_apply(&result(json!({"status":"applied"})), &state),
            AfterApply::End
        );
        assert_eq!(
            after_apply(
                &result(json!({"status":"applied","needs_follow_up":true})),
                &state
            ),
            AfterApply::Continue
        );
        for status in ["partial", "unconfirmed", "failed", "stale", "unavailable"] {
            assert_eq!(
                after_apply(&result(json!({"status":status})), &state),
                AfterApply::Continue
            );
        }
        let more = ChainedApplyState {
            more_steps: true,
            ..Default::default()
        };
        assert_eq!(
            after_apply(&result(json!({"status":"applied"})), &more),
            AfterApply::Continue
        );
        assert_eq!(
            after_apply(
                &result(json!({"status":"needs_decision","reason":"whole_document"})),
                &state
            ),
            AfterApply::Repark {
                reason: Some("whole_document".into())
            }
        );
        let reparked = ChainedApplyState {
            reparked: true,
            ..Default::default()
        };
        assert_eq!(
            after_apply(&result(json!({"status":"needs_decision"})), &reparked),
            AfterApply::Continue
        );
        let gone = report(&ClientToolOutcome::Cancelled {
            reason: PANE_GONE.into(),
        });
        assert_eq!(after_apply(&gone, &more), AfterApply::End);
        let timed_out = report(&ClientToolOutcome::Cancelled {
            reason: "timeout".into(),
        });
        assert_eq!(after_apply(&timed_out, &state), AfterApply::Continue);
    }

    #[test]
    fn more_steps_is_taken_out_and_put_back_for_the_check() {
        let mut input = json!({"snapshot":"s","more_changes":true});
        assert_eq!(
            take_more_steps(&mut input, "/more_changes"),
            Some(json!(true))
        );
        assert_eq!(input, json!({"snapshot":"s"}));
        assert_eq!(take_more_steps(&mut input, "/more_changes"), None);
        assert_eq!(
            with_more_steps(&input, "/more_changes", &Value::Null),
            json!({"snapshot":"s","more_changes":null})
        );
    }

    #[test]
    fn the_apply_input_carries_only_a_bounded_draft_id() {
        assert_eq!(
            apply_input("call_1", &json!({"draft_id":"d-1","plan":{}})),
            json!({"submission_call_id":"call_1","draft_id":"d-1","confirmation":null})
        );
        assert_eq!(
            apply_input("call_1", &json!({"draft_id":"d".repeat(200)}))["draft_id"],
            Value::Null
        );
    }
}
