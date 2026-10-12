//! Logged, account-scoped attempts for explicitly registered client operations.
//! Model history remains on the message row; no composed request is stored here.
pub mod client_tool;
pub mod store;
pub mod transport;

use chrono::{DateTime, Utc};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, sync::Arc};
use utoipa::ToSchema;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionRealm {
    Frontend,
    OfficeAddin,
    DesktopSidecar,
}

/// Client-asserted routing identity, not attestation. Kinds may require stronger proof.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ExecutorBinding {
    pub device_id: String,
    pub realm: ExecutionRealm,
    pub host_context: Option<HostContext>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct HostContext {
    pub kind: String,
    pub identity: String,
}

impl ExecutorBinding {
    pub fn validate(&self) -> bool {
        fn bounded(value: &str) -> bool {
            !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
        }
        bounded(&self.device_id)
            && self
                .host_context
                .as_ref()
                .is_none_or(|context| bounded(&context.kind) && bounded(&context.identity))
    }

    pub fn from_headers(headers: &axum::http::HeaderMap) -> Option<Self> {
        let value = headers.get("X-Erato-Executor")?.to_str().ok()?;
        if value.len() > 2048 {
            return None;
        }
        let binding: Self = serde_json::from_str(value).ok()?;
        binding.validate().then_some(binding)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConsentPolicy {
    None,
    Ask,
    Native,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OperationRequest {
    pub attempt_id: Uuid,
    pub operation_id: String,
    pub kind: String,
    pub realm: ExecutionRealm,
    pub chat_id: Uuid,
    pub message_id: Uuid,
    pub tool_call_id: String,
    pub account_id: Uuid,
    pub binding: ExecutorBinding,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub base_revision: Option<u64>,
    pub consent: ConsentPolicy,
    pub expires_at: DateTime<Utc>,
    #[schema(value_type = OperationPayload)]
    pub input: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OperationOutcome {
    Succeeded,
    Rejected,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum OperationValue {
    Value {
        #[schema(value_type = OperationPayload)]
        value: Value,
    },
    Reference {
        reference: Uuid,
    },
    Receipt {
        #[schema(value_type = OperationPayload)]
        receipt: Value,
    },
}

/// JSON transport shape only: every payload still requires its compiled kind's
/// validator. An explicit schema keeps generated clients from treating JSON as void.
#[derive(ToSchema, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OperationPayload {
    Null,
    Boolean(bool),
    Number(f64),
    String(String),
    #[schema(no_recursion)]
    Array(Vec<OperationPayload>),
    #[schema(no_recursion)]
    Object(HashMap<String, OperationPayload>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OperationError {
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub validation: Option<OperationValidation>,
    /// Executor text, at most 1024 characters. Only a kind validator may forward it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub message: Option<String>,
}

/// Bounded client-tool diagnostics; only the Word host family forwards them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OperationValidation {
    pub issues: Vec<crate::services::client_tools::ClientToolValidationIssue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub feedback: Option<crate::services::client_tools::ClientToolSubmissionFeedback>,
}

/// Longest executor error message a kind may accept, in characters.
pub const MAX_OPERATION_MESSAGE_CHARS: usize = 1024;

/// One line of executor text: control characters become spaces, and blank
/// text is no message at all.
pub fn clean_message(message: &str) -> Option<String> {
    let cleaned: String = message
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let cleaned = cleaned.trim();
    (!cleaned.is_empty()).then(|| cleaned.to_string())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OperationResult {
    pub attempt_id: Uuid,
    pub operation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub base_revision: Option<u64>,
    pub outcome: OperationOutcome,
    pub result: Option<OperationValue>,
    pub error: Option<OperationError>,
    pub executor: ExecutorBinding,
}

/// Only a kind validator constructs the model-visible result. Raw receipts are
/// never forwarded; `client_tool.v1` forwards a bounded executor message, as
/// the legacy fast path does.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ValidatedResult {
    pub output: Value,
    pub succeeded: bool,
}

/// Server-owned offer context. Kinds may authorize a bound synthetic operation
/// here, including in a child; ordinary configured client tools stay suppressed.
pub struct OperationOfferContext<'a> {
    pub config: &'a crate::config::AppConfig,
    pub chat: &'a crate::db::entity::chats::Model,
    pub account_id: Option<Uuid>,
    pub request_context: &'a crate::models::message::GenerationRequestContext,
    pub allowlist: &'a [String],
    pub other_tools: bool,
}

pub struct OperationToolOffer {
    /// Compiled descriptor, not a `[client_tools.tools]` configuration entry.
    /// The registry owner must match its `erato/<name>` identity exactly.
    pub definition: crate::config::ClientToolConfig,
    pub binding: ExecutorBinding,
}

pub trait OperationKind: Send + Sync {
    fn kind(&self) -> &'static str;
    fn operation_id(&self) -> &str;
    fn realm(&self) -> ExecutionRealm;
    fn consent(&self) -> ConsentPolicy;
    /// No offer, including no child-run exception, unless the kind explicitly
    /// authorizes this context and supplies its executor binding.
    fn tool_offer(&self, _context: &OperationOfferContext<'_>) -> Option<OperationToolOffer> {
        None
    }
    /// Whether this logical turn may offer the operation again after its result.
    /// For example, cancelling native collection must not start another search.
    fn reoffer_after_result(&self, _result: &OperationResult) -> bool {
        true
    }
    fn allow_cross_device(&self) -> bool {
        false
    }
    fn attempt_ttl(&self) -> chrono::Duration {
        chrono::Duration::hours(24)
    }
    /// Bounded by the attempt's expiry when claimed.
    fn claim_lease(&self) -> chrono::Duration {
        chrono::Duration::minutes(5)
    }
    /// Configured tools keep the user's per-tool decision (the approval card)
    /// before dispatch; compiled kinds ask through their own consent policy.
    fn gated_by_user_decision(&self) -> bool {
        false
    }
    /// Without a valid binding the call fails instead of keeping the
    /// in-memory path, as a kind that must never run unbound requires.
    fn requires_binding(&self) -> bool {
        true
    }
    /// Settle a malformed claimed result as fixed feedback instead of refusing
    /// it, so a configured tool's executor cannot loop on its own output.
    fn settle_invalid_claimed(&self) -> bool {
        false
    }
    /// An explicit per-kind eligibility check; ordinary delegated client tools
    /// remain suppressed unless a kind supplies a bound, authorized operation.
    fn validate_input(&self, input: &Value, binding: &ExecutorBinding) -> Result<(), String>;
    fn validate_result(
        &self,
        request: &OperationRequest,
        result: &OperationResult,
    ) -> Result<ValidatedResult, String>;
}

/// Keyed by qualified operation id. Every kind is compiled: configuration may
/// only opt a configured tool into the generic `client_tool.v1` kind (see
/// [`registry`]), never register an arbitrary JSON executor.
#[derive(Clone, Default)]
pub struct OperationRegistry(HashMap<String, Arc<dyn OperationKind>>);

impl OperationRegistry {
    pub fn register(&mut self, kind: Arc<dyn OperationKind>) -> Result<(), String> {
        if self.0.contains_key(kind.operation_id()) {
            return Err("Operation already registered".into());
        }
        self.0.insert(kind.operation_id().into(), kind);
        Ok(())
    }
    pub fn kinds(&self) -> impl Iterator<Item = &dyn OperationKind> {
        self.0.values().map(AsRef::as_ref)
    }
    pub fn for_operation(&self, id: &str) -> Option<&dyn OperationKind> {
        self.0.get(id).map(AsRef::as_ref)
    }
    pub fn for_request(&self, request: &OperationRequest) -> Option<&dyn OperationKind> {
        self.for_operation(&request.operation_id).filter(|kind| {
            kind.kind() == request.kind
                && kind.realm() == request.realm
                && request.realm == request.binding.realm
                && kind.consent() == request.consent
        })
    }
}

/// Local evidence when its signer exists, plus one `client_tool.v1` instance per
/// configured tool with a `durable` table while durable operations are enabled.
pub fn registry(
    config: &crate::config::AppConfig,
    signer: Option<&Arc<crate::services::local_delegation::signing::Signer>>,
) -> Result<OperationRegistry, eyre::Report> {
    let mut registry = crate::services::local_delegation::tool::registry(signer);
    if config.client_tools.durable_operations_enabled {
        for tool in config.client_tools.tools.values() {
            let Some(kind) =
                client_tool::ConfiguredClientToolKind::from_config(tool).map_err(|error| {
                    eyre::eyre!(
                        "Client tool '{}' cannot be durable: {error}",
                        tool.qualified_name()
                    )
                })?
            else {
                continue;
            };
            registry
                .register(Arc::new(kind))
                .map_err(|error| eyre::eyre!("Client tool '{}': {error}", tool.qualified_name()))?;
        }
    }
    Ok(registry)
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnConsumption {
    pub model_turns: usize,
    pub tool_calls: u32,
    pub server_tool_calls: u32,
    pub client_tool_calls: u32,
    pub submission_attempts: HashMap<String, u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submission_correction: Option<crate::services::submission_correction::SubmissionCorrection>,
    pub client_action_proposed: bool,
    /// Charges belong to logical call IDs, not executions of the recovery loop.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub tool_charges: HashMap<String, ToolCallCharge>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolCallCharge {
    pub budget_refusal: Option<String>,
    pub submission_attempt: Option<u32>,
    #[serde(default)]
    pub submission_mixed_batch: bool,
    #[serde(default)]
    pub recovery_read: bool,
    pub operation_identity: Option<OperationIdentity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OperationIdentity {
    pub attempt_id: Uuid,
    pub expires_at: DateTime<Utc>,
}

/// Metadata-only suspension marker. Input and approved output use the normal
/// ToolUse part; this marker is never replayed as model context.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ClientToolPending {
    pub attempt_id: Uuid,
    pub tool_call_id: String,
    pub pending_tool_calls: Vec<crate::models::message::PendingToolCall>,
}

pub fn pending(content: &[crate::models::message::ContentPart]) -> Option<&ClientToolPending> {
    match content.last() {
        Some(crate::models::message::ContentPart::ClientToolPending(pending)) => Some(pending),
        _ => None,
    }
}

pub fn from_fast_result(
    request: &OperationRequest,
    outcome: crate::services::client_tools::ClientToolOutcome,
) -> Result<OperationResult, eyre::Report> {
    use crate::services::client_tools::ClientToolOutcome;
    let (outcome, result, error) = match outcome {
        ClientToolOutcome::Result(value, files) if files.is_empty() => (
            OperationOutcome::Succeeded,
            Some(OperationValue::Value { value }),
            None,
        ),
        ClientToolOutcome::ValidationFailed(issues, feedback) => (
            OperationOutcome::Rejected,
            None,
            Some(OperationError {
                code: "validation_failed".into(),
                message: None,
                validation: request
                    .binding
                    .host_context
                    .as_ref()
                    .filter(|host| host.kind == "word_document")
                    .map(|_| OperationValidation { issues, feedback }),
            }),
        ),
        ClientToolOutcome::Error(message) => (
            OperationOutcome::Failed,
            None,
            Some(OperationError {
                validation: None,
                code: "execution_failed".into(),
                message: clean_message(
                    &message
                        .chars()
                        .take(MAX_OPERATION_MESSAGE_CHARS)
                        .collect::<String>(),
                ),
            }),
        ),
        _ => return Err(eyre::eyre!("Unsupported durable result envelope")),
    };
    Ok(OperationResult {
        attempt_id: request.attempt_id,
        operation_id: request.operation_id.clone(),
        base_revision: request.base_revision,
        outcome,
        result,
        error,
        executor: request.binding.clone(),
    })
}

/// Fixed server-authored feedback for a malformed executor result. Authentication
/// and binding failures remain HTTP refusals and never settle another executor's call.
pub fn invalid_result_outcome() -> crate::services::client_tools::ClientToolOutcome {
    crate::services::client_tools::ClientToolOutcome::ValidationFailed(
        vec![crate::services::client_tools::ClientToolValidationIssue {
            path: String::new(),
            code: "invalid_operation_result".into(),
            message: "The executor returned an invalid operation result.".into(),
        }],
        None,
    )
}

pub fn invalid_result_feedback() -> ValidatedResult {
    ValidatedResult {
        succeeded: false,
        output: serde_json::json!({
            "status": "error", "error": "The executor returned an invalid operation result.",
            "validation_errors": [{"path":"", "code":"invalid_operation_result",
                "message":"The executor returned an invalid operation result."}]
        }),
    }
}

/// An unsupported fast envelope is also a refused call, including when delivery
/// races the transaction that parks it. Never persist its unvalidated payload.
pub fn fast_result_or_refusal(
    request: &OperationRequest,
    outcome: crate::services::client_tools::ClientToolOutcome,
) -> OperationResult {
    from_fast_result(request, outcome).unwrap_or_else(|_| OperationResult {
        attempt_id: request.attempt_id,
        operation_id: request.operation_id.clone(),
        base_revision: request.base_revision,
        outcome: OperationOutcome::Rejected,
        result: None,
        error: Some(OperationError {
            validation: None,
            code: "invalid_operation_result".into(),
            message: None,
        }),
        executor: request.binding.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_errors_keep_a_cleaned_bounded_message() {
        let request = OperationRequest {
            attempt_id: Uuid::new_v4(),
            operation_id: "outlook/fetch_availability".into(),
            kind: client_tool::CLIENT_TOOL_KIND.into(),
            realm: ExecutionRealm::OfficeAddin,
            chat_id: Uuid::new_v4(),
            message_id: Uuid::new_v4(),
            tool_call_id: "call".into(),
            account_id: Uuid::new_v4(),
            binding: ExecutorBinding {
                device_id: "device-one".into(),
                realm: ExecutionRealm::OfficeAddin,
                host_context: None,
            },
            base_revision: None,
            consent: ConsentPolicy::None,
            expires_at: Utc::now(),
            input: serde_json::json!({}),
        };
        let error = |message: String| {
            from_fast_result(
                &request,
                crate::services::client_tools::ClientToolOutcome::Error(message),
            )
            .unwrap()
            .error
            .unwrap()
        };
        let long = format!(
            "first\nline {}",
            "x".repeat(2 * MAX_OPERATION_MESSAGE_CHARS)
        );
        let bounded = error(long).message.unwrap();
        assert!(bounded.starts_with("first line x"));
        assert_eq!(bounded.chars().count(), MAX_OPERATION_MESSAGE_CHARS);
        assert_eq!(error("\r\n".into()).message, None);
        assert_eq!(error("\r\n".into()).code, "execution_failed");
    }
}
