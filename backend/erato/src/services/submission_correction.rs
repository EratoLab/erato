use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;

use super::client_tools::{
    ClientToolOutcome, ClientToolSubmissionFeedback, ClientToolValidationIssue, OfferedClientTool,
    SubmissionRecovery,
};

/// The cancellation of a part call past the last one a request allows.
pub const PART_CALL_LIMIT: &str = "part_call_limit";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SubmissionStatus {
    Correcting,
    Accepted,
    Unresolved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SubmissionReason {
    ValidationFailed,
    AttemptsExhausted,
    ModelStopped,
    RecoveryReadsExhausted,
    PartCallsExhausted,
    TerminalValidation,
    ContextUnavailable,
    CapabilityUnavailable,
    ProviderError,
    Timeout,
    Cancelled,
    UserRequestedAnswer,
    UserStopped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SubmissionOutcome {
    pub status: SubmissionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<SubmissionReason>,
    pub attempts_used: u32,
    pub max_attempts: u32,
}

/// Stored with the turn's charges; model-provided draft and snapshot IDs are
/// deliberately absent from the identity of the editing step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubmissionCorrection {
    pub tool: String,
    pub outcome: SubmissionOutcome,
    pub recovery: SubmissionRecovery,
    pub recovery_read_tools: Vec<String>,
    pub recovery_reads_used: u32,
    pub max_recovery_reads: u32,
    #[serde(default)]
    pub last_no_progress_turn: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parts: Option<PartAllowance>,
}

/// The part calls that stage a draft before the submission call finishes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartAllowance {
    pub tools: Vec<String>,
    pub max_calls: u32,
    pub max_tries: u32,
    pub calls_used: u32,
    pub tries: Vec<PartTries>,
    /// A text answer while drafting got its one reminder.
    pub reminded: bool,
    /// The model turn whose part calls first went past `max_calls`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit_turn: Option<usize>,
}

/// The calls one part has had: a part tool, and the value of its `part_key`
/// argument when the call has one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartTries {
    pub tool: String,
    pub key: Option<String>,
    pub used: u32,
}

impl SubmissionCorrection {
    pub fn new(tool: &OfferedClientTool) -> Self {
        let config = tool.config.submission.as_ref().expect("submission policy");
        Self {
            tool: tool.config.qualified_name(),
            outcome: SubmissionOutcome {
                status: SubmissionStatus::Correcting,
                reason: Some(SubmissionReason::ValidationFailed),
                attempts_used: 0,
                max_attempts: config.max_attempts,
            },
            recovery: SubmissionRecovery::RepairArguments,
            recovery_read_tools: config.recovery_read_tools.clone(),
            recovery_reads_used: 0,
            max_recovery_reads: config.max_recovery_reads,
            last_no_progress_turn: None,
            parts: (!config.part_tools.is_empty()).then(|| PartAllowance {
                tools: config.part_tools.clone(),
                max_calls: config.max_part_calls,
                max_tries: config.max_row_tries,
                calls_used: 0,
                tries: Vec::new(),
                reminded: false,
                limit_turn: None,
            }),
        }
    }

    pub fn pending(&self) -> bool {
        self.outcome.status == SubmissionStatus::Correcting
    }

    /// The submission's name as the model calls it.
    pub fn model_name(&self) -> &str {
        self.tool.rsplit('/').next().unwrap_or(&self.tool)
    }

    /// The outcome the message shows: none while no submission call was made
    /// and the step is still open, so staged parts show no correction.
    pub fn shown_outcome(&self) -> Option<&SubmissionOutcome> {
        (!self.pending() || self.outcome.attempts_used > 0).then_some(&self.outcome)
    }

    pub fn stop(&mut self, reason: SubmissionReason) {
        if self.pending() {
            self.outcome.status = SubmissionStatus::Unresolved;
            self.outcome.reason = Some(reason);
        }
    }

    pub fn restore(&mut self, tool: Option<&OfferedClientTool>) {
        let Some(config) = tool.and_then(|tool| tool.config.submission.as_ref()) else {
            self.stop(SubmissionReason::CapabilityUnavailable);
            return;
        };
        self.outcome.max_attempts = self.outcome.max_attempts.min(config.max_attempts);
        self.max_recovery_reads = self.max_recovery_reads.min(config.max_recovery_reads);
        self.recovery_read_tools
            .retain(|name| config.recovery_read_tools.contains(name));
        if let Some(parts) = self.parts.as_mut() {
            parts.max_calls = parts.max_calls.min(config.max_part_calls);
            parts.max_tries = parts.max_tries.min(config.max_row_tries);
            parts.tools.retain(|name| config.part_tools.contains(name));
        }
        if self.outcome.attempts_used > self.outcome.max_attempts {
            self.stop(SubmissionReason::AttemptsExhausted);
        }
    }

    pub fn charge_submission(&mut self) -> u32 {
        if !self.pending() || self.outcome.attempts_used >= self.outcome.max_attempts {
            return self.outcome.max_attempts + 1;
        }
        self.outcome.attempts_used += 1;
        self.outcome.attempts_used
    }

    pub fn is_declared_read(&self, tool: &OfferedClientTool) -> bool {
        self.pending()
            && tool.submission.is_none()
            && self
                .recovery_read_tools
                .contains(&tool.config.qualified_name())
    }

    pub fn is_recovery_read(&self, tool: &OfferedClientTool) -> bool {
        self.recovery == SubmissionRecovery::ReadCurrentContext && self.is_declared_read(tool)
    }

    pub fn charge_read(&mut self) -> bool {
        if self.recovery_reads_used >= self.max_recovery_reads {
            self.stop(SubmissionReason::RecoveryReadsExhausted);
            return false;
        }
        self.recovery_reads_used += 1;
        true
    }

    /// Whether `tool` stages parts of this submission's draft.
    pub fn is_part(&self, tool: &OfferedClientTool) -> bool {
        tool.part
            .as_ref()
            .is_some_and(|part| part.submission == self.tool)
            && self
                .parts
                .as_ref()
                .is_some_and(|parts| parts.tools.contains(&tool.config.qualified_name()))
    }

    /// Parts were staged and no submission call has finished the draft yet.
    fn drafting(&self) -> bool {
        self.outcome.attempts_used == 0 && self.parts.as_ref().is_some_and(|p| p.calls_used > 0)
    }

    /// Counts a call of the part tool `tool` for the part `key` in the model
    /// turn `turn`; returns its number among the request's part calls and
    /// among the part's tries.
    pub fn charge_part(&mut self, tool: &str, key: Option<String>, turn: usize) -> (u32, u32) {
        let pending = self.pending();
        let parts = self.parts.as_mut().expect("a part of this submission");
        if !pending {
            return (parts.max_calls + 2, 0);
        }
        parts.calls_used += 1;
        if parts.calls_used > parts.max_calls && parts.limit_turn.is_none() {
            parts.limit_turn = Some(turn);
        }
        // Every call of the turn that went past the limit is asked for the
        // finish; only a later turn ends the step, after the model saw that.
        let call = if parts.limit_turn == Some(turn) {
            parts.calls_used.min(parts.max_calls + 1)
        } else {
            parts.calls_used
        };
        let position = match parts
            .tries
            .iter()
            .position(|tries| tries.tool == tool && tries.key == key)
        {
            Some(position) => position,
            None => {
                parts.tries.push(PartTries {
                    tool: tool.to_owned(),
                    key,
                    used: 0,
                });
                parts.tries.len() - 1
            }
        };
        parts.tries[position].used += 1;
        (call, parts.tries[position].used)
    }

    /// The answer to a part call past its allowances, given before dispatch.
    /// Calls past the request's last one ask for the finish in the model turn
    /// that went past it, and end the submission in a later turn.
    pub fn part_refusal(
        &self,
        call: u32,
        try_number: u32,
        key_path: &str,
    ) -> Option<ClientToolOutcome> {
        let parts = self.parts.as_ref()?;
        let finish = self.model_name();
        let refusal = |path: &str, code: &str, message: String| {
            ClientToolOutcome::ValidationFailed(
                vec![ClientToolValidationIssue {
                    path: path.into(),
                    code: code.into(),
                    message,
                }],
                None,
            )
        };
        if call > parts.max_calls + 1 {
            Some(ClientToolOutcome::Cancelled {
                reason: PART_CALL_LIMIT.into(),
            })
        } else if call > parts.max_calls {
            Some(refusal(
                "",
                "part_calls_exhausted",
                format!(
                    "This request has used all {} of its part calls. Finish the draft now with {finish} alone.",
                    parts.max_calls
                ),
            ))
        } else if try_number > parts.max_tries {
            // A call without a part key, such as a section plan, has no other
            // parts of its own to go on with.
            let next = if key_path.is_empty() {
                format!("Do not call it again; finish with {finish} alone.")
            } else {
                format!("Go on with the other parts, then finish the draft with {finish} alone.")
            };
            Some(refusal(
                key_path,
                "part_tries_exhausted",
                format!(
                    "This part has used all {} of its tries. {next}",
                    parts.max_tries
                ),
            ))
        } else {
            None
        }
    }

    /// What is left for the part `key` of `tool` and for the request.
    pub fn part_budget(&self, tool: &str, key: Option<&str>) -> Value {
        let Some(parts) = self.parts.as_ref() else {
            return Value::Null;
        };
        let used = parts
            .tries
            .iter()
            .find(|tries| tries.tool == tool && tries.key.as_deref() == key)
            .map_or(0, |tries| tries.used);
        json!({
            "tries_remaining": parts.max_tries.saturating_sub(used),
            "calls_remaining": parts.max_calls.saturating_sub(parts.calls_used),
        })
    }

    /// Only what ends the draft's chance ends the submission: a rejected
    /// part costs its own tries, never an attempt.
    pub fn record_part(&mut self, result: &ClientToolOutcome) {
        match result {
            ClientToolOutcome::Result(..) => self.recovery = SubmissionRecovery::RepairArguments,
            ClientToolOutcome::Cancelled { reason } => self.stop_cancelled(reason),
            ClientToolOutcome::ValidationFailed(_, feedback) => {
                self.take_feedback(feedback.as_ref());
            }
            ClientToolOutcome::Error(_) => self.stop(SubmissionReason::CapabilityUnavailable),
        }
    }

    /// `expired` comes only from durable calls, which a submission or a part
    /// call never is.
    fn stop_cancelled(&mut self, reason: &str) {
        self.stop(match reason {
            "timeout" | "expired" => SubmissionReason::Timeout,
            "context_unavailable" => SubmissionReason::ContextUnavailable,
            "submission_attempt_limit" => SubmissionReason::AttemptsExhausted,
            PART_CALL_LIMIT => SubmissionReason::PartCallsExhausted,
            _ => SubmissionReason::Cancelled,
        });
    }

    /// Takes the host's recovery request from a rejection; returns whether it
    /// ended the step.
    fn take_feedback(&mut self, feedback: Option<&ClientToolSubmissionFeedback>) -> bool {
        self.recovery = feedback.map_or(SubmissionRecovery::RepairArguments, |f| f.recovery);
        let end = if self.recovery == SubmissionRecovery::CannotContinue {
            Some(SubmissionReason::ContextUnavailable)
        } else if feedback.is_some_and(|f| f.terminal) {
            Some(SubmissionReason::TerminalValidation)
        } else {
            None
        };
        if let Some(reason) = end {
            self.stop(reason);
        }
        end.is_some()
    }

    /// While drafting, the first text answer gets one reminder without an
    /// attempt, the next one ends the submission, and other tool calls are
    /// ordinary calls. Once a submission call was made, every reply without
    /// progress uses an attempt.
    pub fn no_progress(&mut self, turn: usize, text_only: bool) -> bool {
        if !self.pending() {
            return false;
        }
        if self.drafting() {
            if !text_only {
                return true;
            }
            let repeated = self.last_no_progress_turn == Some(turn);
            let parts = self.parts.as_mut().expect("drafting");
            if !parts.reminded || repeated {
                parts.reminded = true;
                self.last_no_progress_turn = Some(turn);
                return true;
            }
            self.stop(SubmissionReason::ModelStopped);
            return false;
        }
        if self.last_no_progress_turn != Some(turn) {
            self.last_no_progress_turn = Some(turn);
            self.outcome.attempts_used += 1;
        }
        if self.outcome.attempts_used >= self.outcome.max_attempts {
            self.stop(SubmissionReason::AttemptsExhausted);
        } else {
            self.outcome.reason = Some(SubmissionReason::ModelStopped);
        }
        self.pending()
    }

    pub fn record(&mut self, result: &ClientToolOutcome) {
        match result {
            ClientToolOutcome::Result(..) => {
                self.outcome.status = SubmissionStatus::Accepted;
                self.outcome.reason = None;
            }
            ClientToolOutcome::Cancelled { reason } => self.stop_cancelled(reason),
            ClientToolOutcome::ValidationFailed(_, feedback) => {
                if !self.take_feedback(feedback.as_ref()) {
                    if self.outcome.attempts_used >= self.outcome.max_attempts {
                        self.stop(SubmissionReason::AttemptsExhausted);
                    } else {
                        self.outcome.reason = Some(SubmissionReason::ValidationFailed);
                    }
                }
            }
            ClientToolOutcome::Error(_) => self.stop(SubmissionReason::CapabilityUnavailable),
        }
    }

    pub fn record_read(&mut self, result: &ClientToolOutcome) {
        match result {
            ClientToolOutcome::ValidationFailed(_, Some(feedback))
                if feedback.recovery == SubmissionRecovery::CannotContinue =>
            {
                self.stop(SubmissionReason::ContextUnavailable)
            }
            ClientToolOutcome::Cancelled { reason } => self.stop_cancelled(reason),
            ClientToolOutcome::Error(_) => self.stop(SubmissionReason::CapabilityUnavailable),
            _ => {}
        }
    }

    pub fn reminder(&self) -> String {
        if self.drafting() {
            return format!(
                "The draft is not finished, and a text answer does not submit it. Send the remaining parts, then finish the draft with {} alone. This is the only reminder: another text answer ends the request without a proposal.",
                self.model_name()
            );
        }
        // Unchanged without part tools, which keep today's behaviour exactly.
        let next = if self.parts.is_some() {
            format!(
                "Resend the parts the rejection names, then submit using {} alone.",
                self.model_name()
            )
        } else {
            format!("Submit a corrected proposal using {} alone.", self.tool)
        };
        format!(
            "The validated submission is unresolved. A text answer does not prepare a valid proposal and consumes an attempt. {next} {} of {} total attempts remain. Only declared recovery reads may use the separate read allowance.",
            self.outcome
                .max_attempts
                .saturating_sub(self.outcome.attempts_used),
            self.outcome.max_attempts,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ClientToolConfig, ClientToolSubmissionConfig};

    fn submission_tool(part_tools: &[&str], max_part_calls: u32) -> OfferedClientTool {
        let config = ClientToolConfig {
            name: "submit_draft".into(),
            submission: Some(ClientToolSubmissionConfig {
                max_attempts: 5,
                part_tools: part_tools.iter().map(|tool| tool.to_string()).collect(),
                max_part_calls,
                ..Default::default()
            }),
            ..Default::default()
        };
        OfferedClientTool::prepare(&config, &json!({"type":"object"})).unwrap()
    }

    fn correction(part_tools: &[&str], max_part_calls: u32) -> SubmissionCorrection {
        SubmissionCorrection::new(&submission_tool(part_tools, max_part_calls))
    }

    fn code(outcome: Option<ClientToolOutcome>) -> Option<String> {
        match outcome? {
            ClientToolOutcome::ValidationFailed(issues, None) => Some(issues[0].code.clone()),
            ClientToolOutcome::Cancelled { reason } => Some(reason),
            other => panic!("unexpected refusal {other:?}"),
        }
    }

    fn message(outcome: Option<ClientToolOutcome>) -> String {
        match outcome {
            Some(ClientToolOutcome::ValidationFailed(issues, None)) => issues[0].message.clone(),
            other => panic!("unexpected refusal {other:?}"),
        }
    }

    #[test]
    fn a_correction_without_part_tools_is_stored_as_before() {
        let stored = serde_json::to_value(correction(&[], 40)).unwrap();
        assert!(stored.get("parts").is_none(), "{stored}");
    }

    #[test]
    fn tries_are_counted_per_part_and_calls_per_request() {
        let mut correction = correction(&["client/plan", "client/write"], 6);
        assert_eq!(correction.charge_part("client/plan", None, 1), (1, 1));
        for try_number in 1..=3 {
            let (call, tries) = correction.charge_part("client/write", Some("2".into()), 2);
            assert_eq!(tries, try_number);
            assert_eq!(code(correction.part_refusal(call, tries, "/row")), None);
        }
        let (call, tries) = correction.charge_part("client/write", Some("2".into()), 3);
        assert_eq!(
            code(correction.part_refusal(call, tries, "/row")).as_deref(),
            Some("part_tries_exhausted")
        );
        assert_eq!(
            correction.charge_part("client/write", Some("3".into()), 4),
            (6, 1)
        );
        assert_eq!(
            correction.part_budget("client/write", Some("2")),
            json!({"tries_remaining":0,"calls_remaining":0})
        );
        let (call, tries) = correction.charge_part("client/write", Some("4".into()), 5);
        assert_eq!(
            code(correction.part_refusal(call, tries, "/row")).as_deref(),
            Some("part_calls_exhausted")
        );
        let (call, tries) = correction.charge_part("client/write", Some("5".into()), 6);
        let refusal = correction.part_refusal(call, tries, "/row").unwrap();
        assert_eq!(
            code(Some(refusal.clone())).as_deref(),
            Some(PART_CALL_LIMIT)
        );
        correction.record_part(&refusal);
        assert_eq!(
            correction.outcome.reason,
            Some(SubmissionReason::PartCallsExhausted)
        );
        assert_eq!(correction.outcome.attempts_used, 0);
    }

    #[test]
    fn calls_past_the_limit_in_one_batch_are_all_asked_for_the_finish() {
        let mut correction = correction(&["client/write"], 1);
        correction.charge_part("client/write", Some("1".into()), 1);
        for row in ["2", "3"] {
            let (call, tries) = correction.charge_part("client/write", Some(row.into()), 2);
            assert_eq!(
                code(correction.part_refusal(call, tries, "/row")).as_deref(),
                Some("part_calls_exhausted")
            );
        }
        let (call, tries) = correction.charge_part("client/write", Some("4".into()), 3);
        assert_eq!(
            code(correction.part_refusal(call, tries, "/row")).as_deref(),
            Some(PART_CALL_LIMIT)
        );
    }

    #[test]
    fn a_part_without_a_key_is_not_told_to_go_on_with_other_parts() {
        let mut correction = correction(&["client/plan", "client/write"], 40);
        for _ in 0..3 {
            correction.charge_part("client/plan", None, 1);
        }
        let (call, tries) = correction.charge_part("client/plan", None, 2);
        let keyless = message(correction.part_refusal(call, tries, ""));
        assert!(
            keyless.contains("finish with submit_draft alone"),
            "{keyless}"
        );
        assert!(!keyless.contains("other parts"), "{keyless}");
        for _ in 0..3 {
            correction.charge_part("client/write", Some("2".into()), 3);
        }
        let (call, tries) = correction.charge_part("client/write", Some("2".into()), 3);
        assert!(message(correction.part_refusal(call, tries, "/row")).contains("other parts"));
    }

    #[test]
    fn a_rejected_part_keeps_the_submission_open() {
        let mut correction = correction(&["client/write"], 40);
        correction.charge_part("client/write", Some("1".into()), 1);
        correction.record_part(&ClientToolOutcome::ValidationFailed(Vec::new(), None));
        assert!(correction.pending());
        correction.record_part(&ClientToolOutcome::Result(Value::Null, Vec::new()));
        assert!(correction.pending());
        correction.record_part(&ClientToolOutcome::Cancelled {
            reason: "timeout".into(),
        });
        assert_eq!(correction.outcome.reason, Some(SubmissionReason::Timeout));
    }

    #[test]
    fn a_resumed_correction_keeps_the_narrower_part_budgets() {
        let mut correction = correction(&["client/plan", "client/write"], 40);
        correction.charge_part("client/write", Some("1".into()), 1);
        let mut current = submission_tool(&["client/write", "client/other"], 20);
        current.config.submission.as_mut().unwrap().max_row_tries = 2;
        correction.restore(Some(&current));
        let parts = correction.parts.as_ref().unwrap();
        assert_eq!(parts.tools, ["client/write"]);
        assert_eq!(
            (parts.max_calls, parts.max_tries, parts.calls_used),
            (20, 2, 1)
        );
        assert!(correction.pending());
    }

    #[test]
    fn no_outcome_is_shown_before_a_submission_call() {
        let mut stopped = correction(&["client/write"], 40);
        stopped.stop(SubmissionReason::Timeout);
        let mut correction = correction(&["client/write"], 40);
        correction.charge_part("client/write", Some("1".into()), 1);
        assert_eq!(correction.shown_outcome(), None);
        correction.charge_submission();
        assert_eq!(
            correction.shown_outcome().map(|outcome| outcome.status),
            Some(SubmissionStatus::Correcting)
        );
        assert_eq!(
            stopped.shown_outcome().map(|outcome| outcome.attempts_used),
            Some(0)
        );
    }

    #[test]
    fn text_while_drafting_gets_one_reminder_and_no_attempt() {
        let mut correction = correction(&["client/write"], 40);
        correction.charge_part("client/write", Some("1".into()), 1);
        assert!(correction.no_progress(3, false));
        assert!(correction.no_progress(4, true));
        assert!(correction.reminder().contains("This is the only reminder"));
        assert!(correction.no_progress(4, true), "the same turn again");
        assert!(!correction.no_progress(5, true));
        assert_eq!(
            correction.outcome.reason,
            Some(SubmissionReason::ModelStopped)
        );
        assert_eq!(correction.outcome.attempts_used, 0);
    }

    #[test]
    fn after_a_finish_attempt_text_uses_attempts_as_before() {
        let mut correction = correction(&["client/write"], 40);
        correction.charge_part("client/write", Some("1".into()), 1);
        assert_eq!(correction.charge_submission(), 1);
        assert!(correction.no_progress(3, true));
        assert_eq!(correction.outcome.attempts_used, 2);
        let reminder = correction.reminder();
        assert!(
            reminder.contains("3 of 5 total attempts remain"),
            "{reminder}"
        );
        assert!(
            reminder.contains(
                "Resend the parts the rejection names, then submit using submit_draft alone."
            ),
            "{reminder}"
        );
    }

    #[test]
    fn the_reminder_without_part_tools_is_unchanged() {
        let mut correction = correction(&[], 40);
        correction.charge_submission();
        assert_eq!(
            correction.reminder(),
            "The validated submission is unresolved. A text answer does not prepare a valid proposal and consumes an attempt. Submit a corrected proposal using client/submit_draft alone. 4 of 5 total attempts remain. Only declared recovery reads may use the separate read allowance."
        );
    }
}
