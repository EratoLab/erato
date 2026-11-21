use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;

use super::client_tools::{
    ClientToolOutcome, ClientToolValidationIssue, OfferedClientTool, SubmissionRecovery,
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
            }),
        }
    }

    pub fn pending(&self) -> bool {
        self.outcome.status == SubmissionStatus::Correcting
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

    /// Counts a call of the part tool `tool` for the part `key`; returns its
    /// number among the request's part calls and among the part's tries.
    pub fn charge_part(&mut self, tool: &str, key: Option<String>) -> (u32, u32) {
        let pending = self.pending();
        let parts = self.parts.as_mut().expect("a part of this submission");
        if !pending {
            return (parts.max_calls + 2, 0);
        }
        parts.calls_used += 1;
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
        (parts.calls_used, parts.tries[position].used)
    }

    /// The answer to a part call past its allowances, given before dispatch.
    /// The first call past the request's last one asks for the finish; the
    /// next ends the submission.
    pub fn part_refusal(
        &self,
        call: u32,
        try_number: u32,
        key_path: &str,
    ) -> Option<ClientToolOutcome> {
        let parts = self.parts.as_ref()?;
        let finish = self.tool.rsplit('/').next().unwrap_or(&self.tool);
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
            Some(refusal(
                key_path,
                "part_tries_exhausted",
                format!(
                    "This part has used all {} of its tries. Go on with the other parts, then finish the draft with {finish} alone.",
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
            ClientToolOutcome::Cancelled { reason } => self.stop(match reason.as_str() {
                "timeout" | "expired" => SubmissionReason::Timeout,
                "context_unavailable" => SubmissionReason::ContextUnavailable,
                PART_CALL_LIMIT => SubmissionReason::AttemptsExhausted,
                _ => SubmissionReason::Cancelled,
            }),
            ClientToolOutcome::ValidationFailed(_, feedback) => {
                self.recovery = feedback
                    .as_ref()
                    .map_or(SubmissionRecovery::RepairArguments, |f| f.recovery);
                if self.recovery == SubmissionRecovery::CannotContinue {
                    self.stop(SubmissionReason::ContextUnavailable);
                } else if feedback.as_ref().is_some_and(|f| f.terminal) {
                    self.stop(SubmissionReason::TerminalValidation);
                }
            }
            ClientToolOutcome::Error(_) => self.stop(SubmissionReason::CapabilityUnavailable),
        }
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
            ClientToolOutcome::Cancelled { reason } => self.stop(match reason.as_str() {
                "timeout" => SubmissionReason::Timeout,
                "context_unavailable" => SubmissionReason::ContextUnavailable,
                "submission_attempt_limit" => SubmissionReason::AttemptsExhausted,
                _ => SubmissionReason::Cancelled,
            }),
            ClientToolOutcome::ValidationFailed(_, feedback) => {
                self.recovery = feedback
                    .as_ref()
                    .map_or(SubmissionRecovery::RepairArguments, |f| f.recovery);
                if self.recovery == SubmissionRecovery::CannotContinue {
                    self.stop(SubmissionReason::ContextUnavailable);
                } else if feedback.as_ref().is_some_and(|f| f.terminal) {
                    self.stop(SubmissionReason::TerminalValidation);
                } else if self.outcome.attempts_used >= self.outcome.max_attempts {
                    self.stop(SubmissionReason::AttemptsExhausted);
                } else {
                    self.outcome.reason = Some(SubmissionReason::ValidationFailed);
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
            ClientToolOutcome::Cancelled { reason } => self.stop(match reason.as_str() {
                "timeout" | "expired" => SubmissionReason::Timeout,
                "context_unavailable" => SubmissionReason::ContextUnavailable,
                _ => SubmissionReason::Cancelled,
            }),
            ClientToolOutcome::Error(_) => self.stop(SubmissionReason::CapabilityUnavailable),
            _ => {}
        }
    }

    pub fn reminder(&self) -> String {
        if self.drafting() {
            return format!(
                "The draft is not finished, and a text answer does not submit it. Send the remaining parts, then finish the draft with {} alone. This is the only reminder: another text answer ends the request without a proposal.",
                self.tool.rsplit('/').next().unwrap_or(&self.tool)
            );
        }
        format!(
            "The validated submission is unresolved. A text answer does not prepare a valid proposal and consumes an attempt. Submit a corrected proposal using {} alone. {} of {} total attempts remain. Only declared recovery reads may use the separate read allowance.",
            self.tool,
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

    fn correction(part_tools: &[&str], max_part_calls: u32) -> SubmissionCorrection {
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
        let tool = OfferedClientTool::prepare(&config, &json!({"type":"object"})).unwrap();
        SubmissionCorrection::new(&tool)
    }

    fn code(outcome: Option<ClientToolOutcome>) -> Option<String> {
        match outcome? {
            ClientToolOutcome::ValidationFailed(issues, None) => Some(issues[0].code.clone()),
            ClientToolOutcome::Cancelled { reason } => Some(reason),
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
        assert_eq!(correction.charge_part("client/plan", None), (1, 1));
        for try_number in 1..=3 {
            let (call, tries) = correction.charge_part("client/write", Some("2".into()));
            assert_eq!(tries, try_number);
            assert_eq!(code(correction.part_refusal(call, tries, "/row")), None);
        }
        let (call, tries) = correction.charge_part("client/write", Some("2".into()));
        assert_eq!(
            code(correction.part_refusal(call, tries, "/row")).as_deref(),
            Some("part_tries_exhausted")
        );
        assert_eq!(
            correction.charge_part("client/write", Some("3".into())),
            (6, 1)
        );
        assert_eq!(
            correction.part_budget("client/write", Some("2")),
            json!({"tries_remaining":0,"calls_remaining":0})
        );
        let (call, tries) = correction.charge_part("client/write", Some("4".into()));
        assert_eq!(
            code(correction.part_refusal(call, tries, "/row")).as_deref(),
            Some("part_calls_exhausted")
        );
        let (call, tries) = correction.charge_part("client/write", Some("5".into()));
        let refusal = correction.part_refusal(call, tries, "/row").unwrap();
        assert_eq!(
            code(Some(refusal.clone())).as_deref(),
            Some(PART_CALL_LIMIT)
        );
        correction.record_part(&refusal);
        assert_eq!(
            correction.outcome.reason,
            Some(SubmissionReason::AttemptsExhausted)
        );
        assert_eq!(correction.outcome.attempts_used, 0);
    }

    #[test]
    fn a_rejected_part_keeps_the_submission_open() {
        let mut correction = correction(&["client/write"], 40);
        correction.charge_part("client/write", Some("1".into()));
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
    fn text_while_drafting_gets_one_reminder_and_no_attempt() {
        let mut correction = correction(&["client/write"], 40);
        correction.charge_part("client/write", Some("1".into()));
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
        correction.charge_part("client/write", Some("1".into()));
        assert_eq!(correction.charge_submission(), 1);
        assert!(correction.no_progress(3, true));
        assert_eq!(correction.outcome.attempts_used, 2);
        assert!(
            correction
                .reminder()
                .contains("3 of 5 total attempts remain")
        );
    }
}
