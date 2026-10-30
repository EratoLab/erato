//! Logged, account-scoped attempts for explicitly registered client operations.
//! Model history remains on the message row; no composed request is stored here.
pub mod client_tool;
pub mod executor_stream;
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

    /// Further bindings beside `X-Erato-Executor`, one per host context kind.
    /// Each element is parsed on its own, so an entry a newer client shapes
    /// differently drops only itself; an older backend ignores the header,
    /// which is why `X-Erato-Executor` keeps its strict shape.
    pub fn additional_from_headers(
        headers: &axum::http::HeaderMap,
        primary: Option<&Self>,
    ) -> Vec<Self> {
        let Some(value) = headers
            .get(ADDITIONAL_EXECUTORS_HEADER)
            .and_then(|value| value.to_str().ok())
            .filter(|value| value.len() <= MAX_ADDITIONAL_EXECUTORS_BYTES)
        else {
            return Vec::new();
        };
        let Ok(entries) = serde_json::from_str::<Vec<Value>>(value) else {
            return Vec::new();
        };
        let primary_kind = primary
            .and_then(|binding| binding.host_context.as_ref())
            .map(|host| host.kind.as_str());
        let mut bindings: Vec<Self> = Vec::new();
        for entry in entries {
            if bindings.len() == MAX_ADDITIONAL_EXECUTORS {
                break;
            }
            let Ok(binding) = serde_json::from_value::<Self>(entry) else {
                continue;
            };
            let Some(kind) = binding.host_context.as_ref().map(|host| host.kind.as_str()) else {
                continue;
            };
            if !binding.validate()
                || primary_kind == Some(kind)
                || bindings.iter().any(|known| {
                    known
                        .host_context
                        .as_ref()
                        .is_some_and(|host| host.kind == kind)
                })
            {
                continue;
            }
            bindings.push(binding);
        }
        bindings
    }
}

/// Submit header listing the bindings beside `X-Erato-Executor`.
pub const ADDITIONAL_EXECUTORS_HEADER: &str = "X-Erato-Additional-Executors";
pub const MAX_ADDITIONAL_EXECUTORS: usize = 4;
const MAX_ADDITIONAL_EXECUTORS_BYTES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConsentPolicy {
    None,
    Ask,
    Native,
}

/// A parked call as the server stored it. Clients only receive it; it is read
/// leniently so that a key a newer release adds does not break a replica that
/// still runs this one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
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
    /// Set only on a delegated task's granted call: the turn that owns its
    /// client context and the task turn that made it. Its result arrives only
    /// through a claim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub lineage: Option<executor_stream::CallLineage>,
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
        /// Files the tool uploaded for its result, sent only when there are
        /// any so that a result without files keeps its earlier shape.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[schema(nullable = false)]
        file_upload_ids: Vec<Uuid>,
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
    /// Files the executor reported with a succeeded value. The server reads
    /// them, as the user, where it writes the tool's output.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub file_ids: Vec<Uuid>,
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
    /// Whether this logical turn may offer the operation again after a result
    /// with this outcome. For example, cancelling native collection must not
    /// start another search.
    fn reoffer_after_result(&self, _outcome: OperationOutcome) -> bool {
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

/// The outcome of a stored result, whatever other keys a newer release wrote
/// beside it. A continuation needs nothing else, and reading the whole result
/// strictly would end a task for good on a key this release does not know.
pub fn stored_result_outcome(result: &Value) -> Result<OperationOutcome, eyre::Report> {
    let outcome = result
        .get("outcome")
        .ok_or_else(|| eyre::eyre!("Stored operation result has no outcome"))?;
    Ok(serde_json::from_value(outcome.clone())?)
}

pub fn from_fast_result(
    request: &OperationRequest,
    outcome: crate::services::client_tools::ClientToolOutcome,
) -> Result<OperationResult, eyre::Report> {
    use crate::services::client_tools::ClientToolOutcome;
    let (outcome, result, error) = match outcome {
        ClientToolOutcome::Result(value, file_upload_ids) => (
            OperationOutcome::Succeeded,
            Some(OperationValue::Value {
                value,
                file_upload_ids,
            }),
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
                    .filter(|host| {
                        host.kind == crate::config::ClientToolHostContext::WordDocument.as_str()
                    })
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
        file_ids: Vec::new(),
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
    use axum::http::{HeaderMap, HeaderValue};
    use serde_json::json;

    fn binding_json(kind: &str, device: &str) -> Value {
        json!({"device_id": device, "realm": "desktop-sidecar",
            "host_context": {"kind": kind, "identity": "local"}})
    }

    fn additional(value: &str, primary: Option<&ExecutorBinding>) -> Vec<ExecutorBinding> {
        let mut headers = HeaderMap::new();
        headers.insert(
            ADDITIONAL_EXECUTORS_HEADER,
            HeaderValue::from_str(value).unwrap(),
        );
        ExecutorBinding::additional_from_headers(&headers, primary)
    }

    fn kinds(bindings: &[ExecutorBinding]) -> Vec<&str> {
        bindings
            .iter()
            .map(|binding| binding.host_context.as_ref().unwrap().kind.as_str())
            .collect()
    }

    #[test]
    fn additional_executors_are_parsed_one_entry_at_a_time() {
        let office = ExecutorBinding {
            device_id: "office".into(),
            realm: ExecutionRealm::OfficeAddin,
            host_context: Some(HostContext {
                kind: "outlook_mailbox".into(),
                identity: "mailbox".into(),
            }),
        };
        assert!(ExecutorBinding::additional_from_headers(&HeaderMap::new(), None).is_empty());

        let sidecar = binding_json("desktop_sidecar", "client");
        let parsed = additional(&json!([sidecar]).to_string(), Some(&office));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].realm, ExecutionRealm::DesktopSidecar);
        assert_eq!(parsed[0].device_id, "client");

        let mut future = binding_json("future_host", "client");
        future["capabilities"] = json!(["x"]);
        let no_host = json!({"device_id": "client", "realm": "desktop-sidecar"});
        let empty_device = binding_json("empty_device", "");
        let mixed = json!([future, no_host, empty_device, 7, sidecar]).to_string();
        assert_eq!(kinds(&additional(&mixed, None)), ["desktop_sidecar"]);

        let duplicate = json!([
            binding_json("desktop_sidecar", "first"),
            binding_json("desktop_sidecar", "second")
        ]);
        let parsed = additional(&duplicate.to_string(), None);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].device_id, "first");

        let primary_kind = json!([binding_json("outlook_mailbox", "client"), sidecar]);
        assert_eq!(
            kinds(&additional(&primary_kind.to_string(), Some(&office))),
            ["desktop_sidecar"]
        );

        let many: Vec<Value> = (0..6)
            .map(|index| binding_json(&format!("kind_{index}"), "client"))
            .collect();
        assert_eq!(
            additional(&json!(many).to_string(), None).len(),
            MAX_ADDITIONAL_EXECUTORS
        );

        assert!(additional(&sidecar.to_string(), None).is_empty());
        assert!(additional("not json", None).is_empty());
        let padded = json!([
            binding_json("desktop_sidecar", "client"),
            {"pad": "x".repeat(MAX_ADDITIONAL_EXECUTORS_BYTES)}
        ]);
        assert!(additional(&padded.to_string(), None).is_empty());
    }

    fn stored_request() -> Value {
        json!({
            "attempt_id": Uuid::new_v4(), "operation_id": "desktop/search_sidecar_index",
            "kind": client_tool::CLIENT_TOOL_KIND, "realm": "desktop-sidecar",
            "chat_id": Uuid::new_v4(), "message_id": Uuid::new_v4(), "tool_call_id": "call",
            "account_id": Uuid::new_v4(),
            "binding": binding_json("desktop_sidecar", "client"),
            "consent": "none", "expires_at": "2026-10-30T12:00:00Z", "input": {}
        })
    }

    #[test]
    fn a_stored_request_with_a_newer_field_still_parses() {
        let mut stored = stored_request();
        let plain: OperationRequest = serde_json::from_value(stored.clone()).unwrap();
        assert_eq!(serde_json::to_value(&plain).unwrap(), stored);
        stored["approval_scope"] = json!({"kind": "thread"});
        let newer: OperationRequest = serde_json::from_value(stored).unwrap();
        assert_eq!(newer, plain);
    }

    #[test]
    fn a_stored_result_gives_its_outcome_whatever_else_it_carries() {
        let stored = json!({
            "attempt_id": Uuid::new_v4(), "operation_id": "desktop/search_sidecar_index",
            "outcome": "succeeded",
            "result": {"type": "value", "value": {"hits": []}, "future": 1},
            "error": null,
            "executor": binding_json("desktop_sidecar", "client"),
            "approval_scope": {"kind": "thread"}
        });
        assert!(serde_json::from_value::<OperationResult>(stored.clone()).is_err());
        assert_eq!(
            stored_result_outcome(&stored).unwrap(),
            OperationOutcome::Succeeded
        );
        let mut rejected = stored.clone();
        rejected["outcome"] = json!("rejected");
        assert_eq!(
            stored_result_outcome(&rejected).unwrap(),
            OperationOutcome::Rejected
        );
        let mut missing = stored.clone();
        missing.as_object_mut().unwrap().remove("outcome");
        assert!(stored_result_outcome(&missing).is_err());
        let mut unknown = stored;
        unknown["outcome"] = json!("postponed");
        assert!(stored_result_outcome(&unknown).is_err());
    }

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
            lineage: None,
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
