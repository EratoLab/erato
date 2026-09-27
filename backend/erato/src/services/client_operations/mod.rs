//! Logged, account-scoped attempts for explicitly registered client operations.
//! Model history remains on the message row; no composed request is stored here.
pub mod store;

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

/// Only a kind validator constructs the model-visible result. Raw receipts and
/// executor errors are never automatically forwarded to the model or telemetry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ValidatedResult {
    pub output: Value,
    pub succeeded: bool,
}

pub trait OperationKind: Send + Sync {
    fn kind(&self) -> &'static str;
    fn operation_id(&self) -> &'static str;
    fn realm(&self) -> ExecutionRealm;
    fn consent(&self) -> ConsentPolicy;
    fn allow_cross_device(&self) -> bool {
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

/// Production starts empty. Adding a kind requires compiled validation and its
/// own qualification; configuration cannot register an arbitrary JSON executor.
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

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnConsumption {
    pub model_turns: usize,
    pub tool_calls: u32,
    pub server_tool_calls: u32,
    pub client_tool_calls: u32,
    pub submission_attempts: HashMap<String, u32>,
    pub client_action_proposed: bool,
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
        ClientToolOutcome::ValidationFailed(_) => (
            OperationOutcome::Rejected,
            None,
            Some(OperationError {
                code: "validation_failed".into(),
            }),
        ),
        ClientToolOutcome::Error(_) => (
            OperationOutcome::Failed,
            None,
            Some(OperationError {
                code: "execution_failed".into(),
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
