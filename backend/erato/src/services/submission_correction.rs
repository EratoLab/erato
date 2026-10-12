use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::client_tools::{ClientToolOutcome, OfferedClientTool, SubmissionRecovery};

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
    WorkLimitReached,
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

    pub fn is_recovery_read(&self, tool: &OfferedClientTool) -> bool {
        self.pending()
            && self.recovery == SubmissionRecovery::ReadCurrentContext
            && tool.submission.is_none()
            && self
                .recovery_read_tools
                .contains(&tool.config.qualified_name())
    }

    pub fn charge_read(&mut self) -> bool {
        if self.recovery_reads_used >= self.max_recovery_reads {
            self.stop(SubmissionReason::RecoveryReadsExhausted);
            return false;
        }
        self.recovery_reads_used += 1;
        true
    }

    pub fn no_progress(&mut self, turn: usize) -> bool {
        if !self.pending() {
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

    pub fn reminder(&self) -> String {
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
