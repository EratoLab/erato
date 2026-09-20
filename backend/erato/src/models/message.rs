use crate::db::entity::messages;
use crate::db::entity::prelude::*;
use crate::metrics_constants::{
    POSTGRES_QUERY_DELEGATION_TOOL_CALL, POSTGRES_QUERY_RESOLVE_SYSTEM_DELIVERED_TIP,
};
use crate::models::file_upload::proxied_preview_url_for_file;
use crate::models::pagination;
use crate::policy::prelude::*;
use crate::query_metrics::named_statement_from_sql_and_values;
use crate::server::api::v1beta::message_streaming::FileContentsForGeneration;
use eyre::{Report, eyre};
use genai::chat::ReasoningItem;
use sea_orm::prelude::*;
use sea_orm::{
    ActiveValue, DatabaseConnection, EntityTrait, FromQueryResult, QueryOrder, QuerySelect,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, to_value};
use std::collections::HashMap;
use std::fmt;
use utoipa::ToSchema;

/// Parameters used for generating a message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationParameters {
    /// The chat provider ID that was used to generate the message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation_chat_provider_id: Option<String>,
    /// Request-scoped context for this generation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_context: Option<GenerationRequestContext>,
    /// Facets selected for this generation (facet_id -> enabled), includes all available facets
    #[serde(default)]
    pub selected_facets: HashMap<String, bool>,
    /// The ID of the action facet used for this generation, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_facet_id: Option<String>,
    /// The arguments of the action facet used for this generation, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_facet_args: Option<HashMap<String, String>>,
    /// Who started this generation. Absent means a user did.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initiator: Option<GenerationInitiator>,
}

// Homed here rather than in `services::delegation` because it is a
// wire+persistence type: requests deserialize it and `InputParameters`
// stores it.
/// How a delegated child run relates to the turn that spawned it: `wait`
/// blocks the turn on the child and feeds the result back into it,
/// `background` returns at launch and the child result never re-enters the
/// turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DelegationRunMode {
    #[default]
    Wait,
    Background,
}

/// How a delegated run's result gets back to the turn that started it, as
/// persisted on [`crate::models::chat::ChatProvenance`].
///
/// A superset of [`DelegationRunMode`], deliberately kept as its own type: the
/// request wire stays at two variants, so `"async"` in a submit, edit or
/// regenerate body is a deserialization failure rather than a mode a client can
/// ask for. `Wait` is never written - absence means it - so every envelope
/// stored before this type existed deserializes unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProvenanceRunMode {
    #[default]
    Wait,
    Background,
    Async,
}

impl From<DelegationRunMode> for ProvenanceRunMode {
    fn from(mode: DelegationRunMode) -> Self {
        match mode {
            DelegationRunMode::Wait => ProvenanceRunMode::Wait,
            DelegationRunMode::Background => ProvenanceRunMode::Background,
        }
    }
}

impl From<erato_config::config::TaskRunMode> for ProvenanceRunMode {
    fn from(mode: erato_config::config::TaskRunMode) -> Self {
        match mode {
            erato_config::config::TaskRunMode::Wait => ProvenanceRunMode::Wait,
            erato_config::config::TaskRunMode::Async => ProvenanceRunMode::Async,
        }
    }
}

impl ProvenanceRunMode {
    /// True for a run the origin turn does not await. Both detached modes
    /// consume a `max_concurrent_background_runs` slot and both take the
    /// dispatch branch; they differ only in whether the result comes back.
    pub fn is_detached(self) -> bool {
        matches!(
            self,
            ProvenanceRunMode::Background | ProvenanceRunMode::Async
        )
    }

    /// The spelling persisted in provenance and used in tracing fields.
    pub fn as_str(self) -> &'static str {
        match self {
            ProvenanceRunMode::Wait => "wait",
            ProvenanceRunMode::Background => "background",
            ProvenanceRunMode::Async => "async",
        }
    }
}

/// User-provided input context stored on user messages.
///
/// Captures contextual information the user supplied alongside their message,
/// such as action facet payloads (e.g., selected text from Outlook compose).
/// Semantically distinct from `GenerationParameters` which records how the
/// assistant response was produced.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InputParameters {
    /// The action facet ID supplied with this message, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_facet_id: Option<String>,
    /// The action facet arguments supplied with this message, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_facet_args: Option<HashMap<String, String>>,
    /// Assistants the user @-mentioned in this message (delegation targets),
    /// if any. Persisted so edit and regenerate replay the mentions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentioned_assistant_ids: Option<Vec<String>>,
    /// Run mode requested for the delegated runs of this message. Only
    /// `background` is ever written — absence means wait — and it is the
    /// requested mode, not the gate-downgraded one: `allow_background` is
    /// applied at dispatch time, so a replay under a later-enabled gate
    /// honours the user's original choice.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegation_run_mode: Option<DelegationRunMode>,
    /// Present on a user row the server appended to deliver a finished
    /// `async` task's result. Absent on everything a person wrote.
    ///
    /// This is what the composition walk keys on to fold a delivered result
    /// into later turns, and what the client keys on to decide whether the
    /// result still needs reacting to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_result: Option<TaskResultInput>,
}

/// The marker on a delivered task result's user row.
///
/// Deliberately not the same shape as `ContentPartTaskResult`: that one is the
/// rendered artifact the UI shows, this one is the bookkeeping that ties the
/// row back to the delivery record on the child chat.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct TaskResultInput {
    /// Matches `ResultDelivery::delivery_id`; the idempotency key that makes
    /// "has this already been delivered?" answerable with a query.
    pub delivery_id: Uuid,
    pub child_chat_id: Uuid,
    /// The child's assistant row this result came from. Absent when the run
    /// finished but its answer row is gone (`reason = "result_missing"`): the
    /// delivery still happens, because the origin model has to learn the task
    /// failed, but there is no row to point at.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub result_message_id: Option<Uuid>,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub reason: Option<String>,
    /// Whether the delivery was meant to provoke a reaction turn. A `silent`
    /// result is folded into the user's next message instead.
    pub scheduling: String,
    pub sequence: u32,
}

/// Who started a generation.
///
/// Absent means a person did, so rows written before this existed keep their
/// meaning without a migration.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GenerationInitiator {
    User,
    /// The turn reacting to a delivered task result.
    TaskResult,
}

/// The stored spelling of `GenerationInitiator::TaskResult`, as the
/// re-anchoring walk compares it in SQL. Kept honest by
/// `task_result_initiator_wire_spelling_matches_the_sql_predicate`.
pub const TASK_RESULT_INITIATOR_WIRE: &str = "task_result";

/// Request-scoped context captured for a generation request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GenerationRequestContext {
    /// The originating Erato platform for the request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case", tag = "error_type")]
/// Represents different types of errors that can occur during message generation.
pub enum GenerationErrorType {
    /// Content was filtered by the model provider's content policy.
    #[serde(rename = "content_filter")]
    ContentFilter {
        /// Description of why the content was filtered.
        error_description: String,
        /// Additional details about which filters were triggered.
        #[serde(skip_serializing_if = "Option::is_none")]
        filter_details: Option<JsonValue>,
    },
    /// Rate limit was exceeded.
    #[allow(dead_code)]
    #[serde(rename = "rate_limit")]
    RateLimit {
        /// Description of the rate limit error.
        error_description: String,
    },
    /// Model or provider is unavailable.
    #[allow(dead_code)]
    #[serde(rename = "model_unavailable")]
    ModelUnavailable {
        /// Description of the availability issue.
        error_description: String,
    },
    /// Invalid request parameters.
    #[allow(dead_code)]
    #[serde(rename = "invalid_request")]
    InvalidRequest {
        /// Description of what was invalid.
        error_description: String,
    },
    /// Generic error from the model provider.
    #[serde(rename = "provider_error")]
    ProviderError {
        /// Description of the provider error.
        error_description: String,
        /// HTTP status code if available.
        #[serde(skip_serializing_if = "Option::is_none")]
        status_code: Option<u16>,
    },
    /// Generation was aborted because a hallucination loop was detected.
    #[serde(rename = "hallucination_loop")]
    HallucinationLoop {
        /// Description of why generation was aborted.
        error_description: String,
    },
    /// Internal server error.
    #[serde(rename = "internal_error")]
    InternalError {
        /// Description of the internal error.
        error_description: String,
    },
}

/// Metadata about the generation process, including usage statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GenerationMetadata {
    /// Number of prompt tokens used during generation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_prompt_tokens: Option<u32>,
    /// Number of completion tokens used during generation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_completion_tokens: Option<u32>,
    /// Total number of tokens used during generation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_total_tokens: Option<u32>,
    /// Number of reasoning tokens used during generation (e.g., for o1 models)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_reasoning_tokens: Option<u32>,
    /// Reasoning summary emitted by the model, persisted separately from assistant text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_summary: Option<String>,
    /// Provider-native reasoning items required for stateless replay.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_items: Option<Vec<ReasoningItem>>,
    /// Encrypted reasoning items required for stateless Responses API replay.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_item_encrypted_content: Option<Vec<String>>,
    /// Langfuse trace ID for this generation (if Langfuse tracing was enabled)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub langfuse_trace_id: Option<String>,
    /// Whether this generation was stopped before natural completion
    #[serde(skip_serializing_if = "Option::is_none")]
    pub was_aborted: Option<bool>,
    /// Error information if generation failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<GenerationErrorType>,
    /// MCP server IDs that were unavailable while preparing this generation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers_unavailable: Option<Vec<String>>,
    /// MCP server IDs skipped because the requesting user had not completed
    /// the server's OAuth authorization. Distinct from unavailable: these
    /// servers work, the user just needs to connect them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers_needing_auth: Option<Vec<String>>,
    /// MCP server IDs whose tools were withheld because the user switched the
    /// server off for this chat. Lets the UI explain why a server was not used.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers_disabled_by_user: Option<Vec<String>>,
    /// `server/tool` names of MCP tools withheld because the user switched the
    /// tool off for this chat. Lets the UI explain why a tool was not used.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_tools_disabled_by_user: Option<Vec<String>>,
    /// Set while an approval continuation owes this message its answer, and
    /// cleared by the write that ends the turn. Whether the answer was reached
    /// cannot be read off the row's parts: a turn that says something and then
    /// calls another tool commits that text mid-turn, so a `text` part proves
    /// nothing. Without this, a continuation that died after that commit could
    /// never be retried.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation_in_flight: Option<bool>,
}

/// Role of the message author (as defined by the LLM providers)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

impl fmt::Display for MessageRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MessageRole::System => write!(f, "system"),
            MessageRole::User => write!(f, "user"),
            MessageRole::Assistant => write!(f, "assistant"),
            MessageRole::Tool => write!(f, "tool"),
        }
    }
}

#[derive(Serialize, Deserialize, ToSchema, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    #[default]
    InProgress,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema, Default)]
#[serde(default)]
pub struct ToolUse {
    pub tool_call_id: String,
    pub status: ToolCallStatus,
    pub tool_name: String,
    pub progress_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub progress: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub total: Option<f64>,
    pub input: Option<JsonValue>,
    pub output: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
}

/// Snapshot of the MCP annotations used to decide whether a tool call needs
/// user approval. The values are normalized to the MCP defaults so an absent
/// annotation remains auditable as the pessimistic interpretation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolApprovalAnnotations {
    pub read_only_hint: bool,
    pub destructive_hint: bool,
    pub idempotent_hint: bool,
    pub open_world_hint: bool,
}

/// Which surface a durable approval stop belongs to. `McpTool` is the
/// default so rows written before the other kinds existed keep parsing.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolApprovalKind {
    #[default]
    McpTool,
    DelegatedTask,
    TaskPlan,
}

/// The gated call a delegated child parked on, copied onto the parent's
/// approval item so the card renders without reading the child's chat.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ChildApprovalRef {
    pub child_chat_id: Uuid,
    pub child_message_id: Uuid,
    pub child_tool_call_id: String,
    pub tool_name: String,
    pub mcp_server_id: String,
    pub input: JsonValue,
    pub annotations: ToolApprovalAnnotations,
    pub preset: String,
    pub requested_at: String,
}

/// One decision the user owes on a parked turn. A stop carries several of
/// these when a batch parked on more than one call.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ApprovalItem {
    pub approval_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub input: JsonValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child: Option<ChildApprovalRef>,
}

/// A call of the parked batch that was never popped. The parked part is the
/// only record of these, so the continuation has to replay them from here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct PendingToolCall {
    pub call_id: String,
    pub fn_name: String,
    pub fn_arguments: JsonValue,
}

/// A durable request for user approval before an MCP tool call is executed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartToolApprovalRequest {
    pub tool_call_id: String,
    pub tool_name: String,
    pub mcp_server_id: String,
    pub input: JsonValue,
    pub annotations: ToolApprovalAnnotations,
    pub preset: String,
    /// Snapshot the global policy so the client can hide the option when
    /// persistent approval settings are disabled.
    pub allow_always: bool,
    pub requested_at: String,
    #[serde(default)]
    pub kind: ToolApprovalKind,
    /// Every decision this stop covers. An `mcp_tool` stop carries one item
    /// describing the same call as the flat fields above; readers that branch
    /// on `kind` first may use either.
    #[serde(default)]
    pub approvals: Vec<ApprovalItem>,
    #[serde(default)]
    pub pending_tool_calls: Vec<PendingToolCall>,
}

impl ContentPartToolApprovalRequest {
    /// Every decision this stop covers, in the order the calls were made.
    ///
    /// Rows written before `approvals` existed describe their single call in
    /// the flat fields only, so those are projected into one item keyed by the
    /// call id — the same id `gate_mcp_tool_call` now writes.
    pub fn approval_items(&self) -> Vec<ApprovalItem> {
        if !self.approvals.is_empty() {
            return self.approvals.clone();
        }
        vec![ApprovalItem {
            approval_id: self.tool_call_id.clone(),
            tool_call_id: self.tool_call_id.clone(),
            tool_name: self.tool_name.clone(),
            input: self.input.clone(),
            child: None,
        }]
    }
}

/// Records a user approval in the assistant message lifecycle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartToolApproval {
    pub tool_call_id: String,
    #[serde(default)]
    pub always_allow: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_tool_approval_setting_id: Option<Uuid>,
    pub approved_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child_chat_id: Option<Uuid>,
}

/// Records a user rejection in the assistant message lifecycle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartToolRejection {
    pub tool_call_id: String,
    /// Both fields default, so rejections stored before standing denials
    /// existed still parse.
    #[serde(default)]
    pub never_allow: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_tool_approval_setting_id: Option<Uuid>,
    pub rejected_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child_chat_id: Option<Uuid>,
    /// Why the call was rejected when the user did not decide it directly.
    /// The only value is `withdrawn`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
#[serde(tag = "content_type")]
pub enum ContentPart {
    Text(ContentPartText),
    Reasoning(ContentPartReasoning),
    ToolUse(ToolUse),
    ToolApprovalRequest(ContentPartToolApprovalRequest),
    ToolApproval(ContentPartToolApproval),
    ToolRejection(ContentPartToolRejection),
    TextFilePointer(ContentPartTextFilePointer),
    ImageFilePointer(ContentPartImageFilePointer),
    Image(ContentPartImage),
    /// Reference to an action-facet directive that will be rendered fresh
    /// at request-build time. Persisted in `generation_input_messages` as a
    /// metadata-only marker (facet id + invocation args) instead of the
    /// rendered template text — mirrors the `TextFilePointer` pattern.
    /// Action facets are request-scoped: when this marker is loaded as part
    /// of *prior-turn* history, the resolver drops it; for the *current
    /// turn* it renders the template against the current config + args.
    ActionFacetMarker(ContentPartActionFacetMarker),
    /// Reference to the run directive of a delegated chat, resolved the same
    /// way as `ActionFacetMarker`: metadata in the persisted snapshot, text
    /// only in the request about to be sent, dropped when the snapshot is
    /// replayed as prior-turn history.
    DelegationPreambleMarker(ContentPartDelegationPreambleMarker),
    /// The result of an `async` delegated task, delivered back into the chat
    /// the task was started from as a user-role row.
    ///
    /// A user row rather than an assistant one because the model has to react
    /// to it: it is material that arrived, not something the assistant said.
    /// The history walk keeps it (unlike the directive markers above, which
    /// are request-scoped) so later turns can still see what came back.
    TaskResult(ContentPartTaskResult),
}

/// A delivered task result, as it sits in the conversation.
///
/// `summary` is the child's own answer, already bounded to
/// `delegation.result_max_chars`, and is the only untrusted field here: the
/// rest is written by the server. It is stored RAW — the untrusted-data frame
/// and the safety guidance are applied when the conversation is composed for
/// the model, so the UI can render the answer plainly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartTaskResult {
    /// The child chat that produced this result; the link the UI offers.
    pub child_chat_id: Uuid,
    /// The `delegate_task` call in the origin turn that started it.
    pub parent_tool_call_id: String,
    /// Terminal status of the run, from the D-K vocabulary.
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub reason: Option<String>,
    /// The child's answer, bounded. Untrusted.
    pub summary: String,
    /// Whether `summary` was shortened to fit.
    pub truncated: bool,
    /// Which delivery for this task this is. `0` is the first; a later value
    /// means the result was delivered again after the origin branched away
    /// from the first one.
    pub sequence: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartText {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema, Default)]
#[serde(default)]
pub struct ContentPartReasoning {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
}

impl From<ContentPartText> for String {
    fn from(content: ContentPartText) -> Self {
        content.text
    }
}

impl From<String> for ContentPartText {
    fn from(text: String) -> Self {
        ContentPartText { text }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartTextFilePointer {
    pub file_upload_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartImageFilePointer {
    pub file_upload_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartImage {
    pub content_type: String,
    pub base64_data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartActionFacetMarker {
    /// Identifier of the action facet whose template should be rendered.
    pub facet_id: String,
    /// Arguments captured at the time of the user's request (e.g. the
    /// selected text for `outlook_rewrite_selection`, the compose body for
    /// `outlook_review_draft`).
    pub args: HashMap<String, String>,
}

/// The structured-brief fields of a delegated run, copied from the chat's
/// provenance envelope at composition time. The preamble template itself is
/// not carried: it is read from the config in force when the marker resolves.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartDelegationPreambleMarker {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_output: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraints: Option<String>,
    /// How the run relates to its origin turn; the preamble tells a background
    /// delegate its answer is read in place rather than returned, and an async
    /// one that its answer is delivered back later. Absent means awaited, so
    /// markers persisted before the field existed keep rendering the same text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_mode: Option<ProvenanceRunMode>,
}

/// Statistics for a list of messages
#[derive(Debug, Clone)]
pub struct MessageListStats {
    /// Total number of messages in the chat
    pub total_count: i64,
    /// Current offset in the list
    pub current_offset: u64,
    /// Number of messages in the current response
    pub returned_count: usize,
    /// Whether there are more messages available
    pub has_more: bool,
}

/// Schema for validating message structure
///
/// This struct validates that messages have the required fields:
/// - content: string or array of strings
/// - role: either "system" or "user"
/// - name: optional string to identify the participant
///
/// Additional fields beyond these are allowed and will be preserved in the raw JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageSchema {
    /// The contents of the message, can be a string or array of strings
    pub content: Vec<ContentPart>,

    /// The role of the message author (system or user)
    pub role: MessageRole,

    /// An optional name for the participant
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// Additional fields that may be present in the message
    #[serde(flatten)]
    pub additional_fields: std::collections::HashMap<String, JsonValue>,
}

impl MessageSchema {
    /// Validate a JSON value against the MessageSchema
    pub fn validate(json: &JsonValue) -> Result<Self, Report> {
        let message: Self = serde_json::from_value(json.clone())
            .map_err(|e| eyre!("Invalid message format: {}", e))?;
        message.validate_tool_approval_lifecycle()?;
        Ok(message)
    }

    /// Validate the durable approval lifecycle while leaving historical tool
    /// messages (which predate approval content parts) untouched.
    fn validate_tool_approval_lifecycle(&self) -> Result<(), Report> {
        use std::collections::HashMap;

        #[derive(Clone, Copy)]
        enum State {
            Requested,
            Resolved,
        }

        let mut pending: HashMap<String, State> = HashMap::new();
        for part in &self.content {
            match part {
                ContentPart::ToolApprovalRequest(request) => {
                    // A batch park asks about more than one call, and its
                    // per-item decisions have to be able to land on the row.
                    for item in request.approval_items() {
                        let tool_call_id = item.tool_call_id;
                        if pending
                            .insert(tool_call_id.clone(), State::Requested)
                            .is_some()
                        {
                            return Err(eyre!(
                                "Duplicate tool approval request for {}",
                                tool_call_id
                            ));
                        }
                    }
                }
                ContentPart::ToolApproval(approval) => {
                    match pending.get_mut(approval.tool_call_id.as_str()) {
                        Some(state @ State::Requested) => *state = State::Resolved,
                        _ => {
                            return Err(eyre!(
                                "Tool approval without a pending request for {}",
                                approval.tool_call_id
                            ));
                        }
                    }
                }
                ContentPart::ToolRejection(rejection) => {
                    match pending.get_mut(rejection.tool_call_id.as_str()) {
                        Some(state @ State::Requested) => *state = State::Resolved,
                        _ => {
                            return Err(eyre!(
                                "Tool rejection without a pending request for {}",
                                rejection.tool_call_id
                            ));
                        }
                    }
                }
                ContentPart::ToolUse(tool_use) => {
                    if matches!(
                        pending.get(tool_use.tool_call_id.as_str()),
                        Some(State::Resolved)
                    ) {
                        pending.remove(tool_use.tool_call_id.as_str());
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Convert the schema to a JSON value
    pub fn to_json(&self) -> Result<JsonValue, Report> {
        serde_json::to_value(self).map_err(|e| eyre!("Failed to serialize message: {}", e))
    }

    pub fn full_text(&self) -> String {
        self.content
            .iter()
            .filter_map(|part| match part {
                ContentPart::Text(text) => Some(text.text.as_str()),
                ContentPart::Reasoning(_) => None,
                ContentPart::ToolUse(_) => None,
                ContentPart::ToolApprovalRequest(_) => None,
                ContentPart::ToolApproval(_) => None,
                ContentPart::ToolRejection(_) => None,
                ContentPart::TextFilePointer(_) => None,
                ContentPart::ImageFilePointer(_) => None,
                ContentPart::Image(_) => None,
                // Markers are placeholders for the directive resolver and do
                // not contribute to a message's full text representation.
                // A task result is likewise not the user's own words: it is a
                // child's answer that arrived, and letting it through here
                // would let a delegated run write the chat's title.
                ContentPart::ActionFacetMarker(_)
                | ContentPart::DelegationPreambleMarker(_)
                | ContentPart::TaskResult(_) => None,
            })
            .collect::<Vec<&str>>()
            .join(" ")
    }
}

impl From<&messages::Model> for Resource {
    fn from(val: &messages::Model) -> Self {
        Resource::Message(val.id.as_hyphenated().to_string())
    }
}

/// The lineage write behind [`submit_message`], with authorization already
/// settled by the caller.
///
/// Takes a transaction it does not own and does not commit, so a caller that
/// must append a row and record the append in the same breath - the task-result
/// delivery, which sets `result_delivery.state = delivered` on the child in the
/// same transaction - cannot half-succeed. Without that the delivery's fence has
/// nothing to bite on: the row commits before the state write, and a sweeper
/// that requeued the claim in between double-inserts.
///
/// "Unchecked" is about authorization only: the schema is still validated here,
/// so no caller can write a malformed row by skipping the public entry point.
/// The only lawful callers are ones that have evaluated the `submit_message`
/// rule themselves; that rule is ownership-only.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn append_message_unchecked(
    txn: &sea_orm::DatabaseTransaction,
    chat_id: &Uuid,
    raw_message: JsonValue,
    previous_message_id: Option<&Uuid>,
    sibling_message_id: Option<&Uuid>,
    generation_input_messages: Option<JsonValue>,
    input_files_ids: &[Uuid],
    generation_parameters_json: Option<JsonValue>,
    generation_metadata_json: Option<JsonValue>,
    input_parameters_json: Option<JsonValue>,
) -> Result<messages::Model, Report> {
    // Validated again here rather than trusted from the caller: one
    // `from_value` plus a lifecycle loop is cheap, and it makes this safe for
    // a caller that never went through the public entry point.
    MessageSchema::validate(&raw_message)?;

    if let Some(prev_msg_id) = previous_message_id {
        // Find the previous message
        let previous_message = Messages::find_by_id(*prev_msg_id)
            .one(txn)
            .await?
            .ok_or_else(|| eyre!("Previous message with ID {} not found", prev_msg_id))?;

        // Verify that the previous message belongs to the same chat
        if previous_message.chat_id != *chat_id {
            return Err(eyre!(
                "Previous message does not belong to the specified chat"
            ));
        }
    }

    if let Some(sibling_id) = sibling_message_id {
        // Find the sibling message
        let sibling_message = Messages::find_by_id(*sibling_id)
            .one(txn)
            .await?
            .ok_or_else(|| eyre!("Sibling message with ID {} not found", sibling_id))?;

        // Verify that the sibling message belongs to the same chat
        if sibling_message.chat_id != *chat_id {
            return Err(eyre!(
                "Sibling message does not belong to the specified chat"
            ));
        }
    }

    // Step 1: Set all existing thread messages as inactive by default.
    let active_thread_update = messages::ActiveModel {
        is_message_in_active_thread: ActiveValue::Set(false),
        ..Default::default()
    };

    messages::Entity::update_many()
        .set(active_thread_update)
        .filter(messages::Column::ChatId.eq(*chat_id))
        .exec(txn)
        .await
        .map_err(|e| eyre!("Failed to update active thread flags: {}", e))?;

    // Step 2: Identify the lineage that should remain in the active thread.
    let mut active_thread_ids = Vec::new();
    if let Some(prev_msg_id) = previous_message_id {
        let mut current_msg_id = *prev_msg_id;

        // Keep track of visited message IDs to avoid infinite loops
        let mut visited_ids = std::collections::HashSet::new();

        while !visited_ids.contains(&current_msg_id) {
            visited_ids.insert(current_msg_id);
            active_thread_ids.push(current_msg_id);

            // Get the previous message ID
            let message = Messages::find_by_id(current_msg_id)
                .one(txn)
                .await
                .map_err(|e| eyre!("Failed to find message {}: {}", current_msg_id, e))?
                .ok_or_else(|| eyre!("Message with ID {} not found", current_msg_id))?;

            // If there's no previous message, break the loop
            if let Some(prev_id) = message.previous_message_id {
                current_msg_id = prev_id;
            } else {
                break;
            }
        }
    }

    // Step 3: Create and insert the new message
    let new_message = messages::ActiveModel {
        chat_id: ActiveValue::Set(*chat_id),
        raw_message: ActiveValue::Set(raw_message),
        previous_message_id: ActiveValue::Set(previous_message_id.copied()),
        sibling_message_id: ActiveValue::Set(sibling_message_id.copied()),
        is_message_in_active_thread: ActiveValue::Set(true), // New messages are active by default
        generation_input_messages: ActiveValue::Set(generation_input_messages),
        input_file_uploads: ActiveValue::Set(if input_files_ids.is_empty() {
            None
        } else {
            Some(input_files_ids.to_vec())
        }),
        generation_parameters: ActiveValue::Set(generation_parameters_json),
        generation_metadata: ActiveValue::Set(generation_metadata_json),
        input_parameters: ActiveValue::Set(input_parameters_json),
        ..Default::default()
    };

    let created_message = messages::Entity::insert(new_message)
        .exec_with_returning(txn)
        .await
        .map_err(|e| eyre!("Failed to insert new message: {}", e))?;

    // Step 4: Reactivate this message and its active lineage.
    active_thread_ids.push(created_message.id);

    if !active_thread_ids.is_empty() {
        let active_thread_update = messages::ActiveModel {
            is_message_in_active_thread: ActiveValue::Set(true),
            ..Default::default()
        };

        messages::Entity::update_many()
            .set(active_thread_update)
            .filter(messages::Column::Id.is_in(active_thread_ids))
            .exec(txn)
            .await
            .map_err(|e| eyre!("Failed to reactivate target active thread messages: {}", e))?;
    }

    Ok(created_message)
}

/// Submit a new message to a chat.
///
/// If `previous_message_id` is specified, the previous message will be queried,
/// and the order_index of the new message will be set to the previous message's order_index + 1.
///
/// If `previous_message_id` is not specified, the order_index will be set to 0.
#[allow(clippy::too_many_arguments)]
pub async fn submit_message(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    raw_message: JsonValue,
    previous_message_id: Option<&Uuid>,
    sibling_message_id: Option<&Uuid>,
    generation_input_messages: Option<GenerationInputMessages>,
    input_files_ids: &[Uuid],
    generation_parameters: Option<GenerationParameters>,
    generation_metadata: Option<GenerationMetadata>,
    input_parameters: Option<InputParameters>,
) -> Result<messages::Model, Report> {
    // Validate the message format
    MessageSchema::validate(&raw_message)?;
    let generation_input_messages: Option<JsonValue> =
        generation_input_messages.map(to_value).transpose()?;
    let generation_parameters_json: Option<JsonValue> =
        generation_parameters.map(to_value).transpose()?;
    let generation_metadata_json: Option<JsonValue> =
        generation_metadata.map(to_value).transpose()?;
    let input_parameters_json: Option<JsonValue> = input_parameters.map(to_value).transpose()?;

    // Authorize that the subject can submit messages to this chat
    authorize!(
        policy,
        subject,
        &Resource::Chat(chat_id.as_hyphenated().to_string()),
        Action::SubmitMessage
    )?;

    let txn = conn
        .begin()
        .await
        .map_err(|e| eyre!("Failed to begin transaction: {}", e))?;

    let created_message = append_message_unchecked(
        &txn,
        chat_id,
        raw_message,
        previous_message_id,
        sibling_message_id,
        generation_input_messages,
        input_files_ids,
        generation_parameters_json,
        generation_metadata_json,
        input_parameters_json,
    )
    .await?;

    txn.commit()
        .await
        .map_err(|e| eyre!("Failed to commit transaction: {}", e))?;

    Ok(created_message)
}

/// The deepest system-delivered row still on the active thread below
/// `anchor_message_id`, if the chain below the anchor starts with one.
///
/// A client that last saw the assistant row above a delivered task result
/// anchors there; submitting on that anchor would branch the result and the
/// turn that reacted to it off the active thread, because `submit_message`
/// deactivates the whole chat and reactivates only the anchor's ancestors.
/// Walking down past the server's own rows puts the new turn below them
/// instead, and that reactivation then keeps them on the thread for free.
///
/// `None` means "leave the anchor alone": either nothing is below it, or what
/// The newest message on the chat's active thread.
///
/// The row a new message must hang off, so `submit_message`'s lineage walk
/// keeps the thread the user is looking at instead of resetting it to the new
/// row alone. `id` is a uuidv7 default, so the secondary sort is a real
/// tiebreaker for two rows written in the same instant.
pub async fn get_active_thread_tip<C: ConnectionTrait>(
    conn: &C,
    chat_id: &Uuid,
) -> Result<Option<messages::Model>, Report> {
    Ok(Messages::find()
        .filter(messages::Column::ChatId.eq(*chat_id))
        .filter(messages::Column::IsMessageInActiveThread.eq(true))
        .order_by_desc(messages::Column::CreatedAt)
        .order_by_desc(messages::Column::Id)
        .one(conn)
        .await?)
}

/// is below it is a row the user wrote. Branching below a user's own later
/// turn stays a feature.
pub async fn resolve_system_delivered_tip(
    conn: &DatabaseConnection,
    chat_id: &Uuid,
    anchor_message_id: &Uuid,
) -> Result<Option<Uuid>, Report> {
    #[derive(Debug, FromQueryResult)]
    struct TipRow {
        id: Uuid,
    }

    // The join is served by the index on `previous_message_id`; the chat id and
    // the active flag are rechecks over the one row a parent normally has.
    //
    // UNION ALL with a depth cap rather than UNION: `previous_message_id` is a
    // self-referencing FK, so a cycle is representable even though a real chain
    // is two rows. The cap is a stop, not a business rule.
    //
    // The `is_task_result AND role = 'assistant'` clause is load-bearing, not
    // belt-and-braces. Regenerating a reaction rebuilds its generation
    // parameters through the ordinary request path, which writes no
    // `initiator`, so a regenerated reaction carries no marker. Keying on the
    // marker alone would stop the walk one row short and silently deactivate
    // the answer the user just pressed regenerate for.
    let sql = format!(
        r#"
        WITH RECURSIVE chain AS (
            SELECT "m"."id",
                   "m"."created_at",
                   0 AS depth,
                   ("m"."input_parameters"      #>> '{{task_result,delivery_id}}') IS NOT NULL AS is_task_result,
                   ("m"."generation_parameters" #>> '{{initiator}}') = '{initiator}'           AS is_reaction
            FROM "messages" AS "m"
            WHERE "m"."chat_id" = $1::uuid
              AND "m"."previous_message_id" = $2::uuid
              AND "m"."is_message_in_active_thread"
            UNION ALL
            SELECT "c"."id",
                   "c"."created_at",
                   chain.depth + 1,
                   ("c"."input_parameters"      #>> '{{task_result,delivery_id}}') IS NOT NULL,
                   ("c"."generation_parameters" #>> '{{initiator}}') = '{initiator}'
                       OR (chain.is_task_result AND ("c"."raw_message" ->> 'role') = 'assistant')
            FROM "messages" AS "c"
            JOIN chain ON "c"."previous_message_id" = chain.id
            WHERE "c"."chat_id" = $1::uuid
              AND "c"."is_message_in_active_thread"
              AND (chain.is_task_result OR chain.is_reaction)
              AND chain.depth < 64
        )
        SELECT id
        FROM chain
        WHERE is_task_result OR is_reaction
        ORDER BY depth DESC, created_at DESC, id DESC
        LIMIT 1
        "#,
        initiator = TASK_RESULT_INITIATOR_WIRE,
    );

    let row = TipRow::find_by_statement(named_statement_from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        POSTGRES_QUERY_RESOLVE_SYSTEM_DELIVERED_TIP,
        sql,
        [(*chat_id).into(), (*anchor_message_id).into()],
    ))
    .one(conn)
    .await?;

    Ok(row.map(|row| row.id))
}

/// The origin-side `delegate_*` call a delegated child run answers, recovered
/// from the origin chat's persisted messages.
pub struct RecoveredDelegationCall {
    pub message_id: Uuid,
    pub previous_message_id: Option<Uuid>,
    pub tool_call_id: String,
    pub tool_name: String,
    /// The arguments the origin model actually sent. A retry rebuilds its
    /// brief from these rather than from the child, because the child's own
    /// rows are the run's output, not the request that produced it.
    pub input: JsonValue,
}

/// Find the origin message whose tool call dispatched `child_chat_id`.
///
/// The primary key is a JSONB containment probe on the persisted
/// `output.delegate_chat_id`: that marker is written by the server at dispatch
/// and is present on every delegated run ever launched, including runs from
/// before `TaskSpec.parent_tool_call_id` existed.
///
/// `expected_tool_call_id` is the child's own record of which call it answers,
/// when it has one. Supplying it turns a best-effort "newest matching row"
/// pick into an exact match, which matters when one turn dispatched several
/// children and their tool parts live on the same message.
///
/// Active-thread rows are preferred over rows an edit has branched away from,
/// because the live conversation is the one a retry should be parented to.
pub async fn find_delegation_tool_call(
    conn: &DatabaseConnection,
    origin_chat_id: &Uuid,
    child_chat_id: &Uuid,
    expected_tool_call_id: Option<&str>,
) -> Result<Option<RecoveredDelegationCall>, Report> {
    #[derive(Debug, FromQueryResult)]
    struct DelegationCallRow {
        id: Uuid,
        previous_message_id: Option<Uuid>,
        raw_message: JsonValue,
    }

    // Bound as text and cast, rather than handed over as a JSON value: the
    // probe is a literal this function builds, and text is the one binding
    // every driver path agrees about.
    let probe = serde_json::json!([{
        "content_type": "tool_use",
        "output": { "delegate_chat_id": child_chat_id },
    }])
    .to_string();

    let row = DelegationCallRow::find_by_statement(named_statement_from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        POSTGRES_QUERY_DELEGATION_TOOL_CALL,
        r#"
        SELECT "id", "previous_message_id", "raw_message"
        FROM "messages"
        WHERE "chat_id" = $1::uuid
          AND "raw_message" -> 'content' @> $2::jsonb
        ORDER BY "is_message_in_active_thread" DESC, "created_at" DESC
        LIMIT 1
        "#,
        [(*origin_chat_id).into(), probe.into()],
    ))
    .one(conn)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    // Validated rather than plucked straight out of the JSON: the containment
    // probe already proved a matching part exists, and going through the
    // schema means a retry reads the call exactly as the rest of the system
    // does.
    let message = MessageSchema::validate(&row.raw_message)?;
    let recovered = message.content.iter().find_map(|part| {
        let ContentPart::ToolUse(tool_use) = part else {
            return None;
        };
        let delegate_chat_id = tool_use
            .output
            .as_ref()
            .and_then(|output| output.get("delegate_chat_id"))
            .and_then(JsonValue::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())?;
        if delegate_chat_id != *child_chat_id {
            return None;
        }
        if let Some(expected) = expected_tool_call_id
            && tool_use.tool_call_id != expected
        {
            return None;
        }
        let input = tool_use.input.clone()?;
        Some(RecoveredDelegationCall {
            message_id: row.id,
            previous_message_id: row.previous_message_id,
            tool_call_id: tool_use.tool_call_id.clone(),
            tool_name: tool_use.tool_name.clone(),
            input,
        })
    });

    Ok(recovered)
}

/// Get messages for a chat with pagination support.
///
/// This function retrieves messages for a given chat ID, after checking that
/// the subject has read permission for the chat. It supports pagination with
/// limit and offset parameters.
///
/// Returns a tuple of (messages, stats) where:
/// - messages: Vec<messages::Model> - The list of messages
/// - stats: MessageListStats - Statistics about the message list
pub async fn get_chat_messages(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    limit: Option<u64>,
    offset: Option<u64>,
) -> Result<(Vec<messages::Model>, MessageListStats), Report> {
    // Authorize that the subject can read this chat
    authorize!(
        policy,
        subject,
        &Resource::Chat(chat_id.as_hyphenated().to_string()),
        Action::Read
    )?;

    // Owner route: return every branch (no active-thread filter).
    fetch_chat_messages(conn, chat_id, false, limit, offset).await
}

/// Get the shared view of a chat's messages: the active thread only, with
/// branches from edits/regenerations excluded.
///
/// Authorizes via [`Action::SharedRead`], which the policy grants to any
/// logged-in user when chat sharing is enabled and the chat has an enabled
/// share link and is not archived.
pub async fn get_shared_chat_messages(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    limit: Option<u64>,
    offset: Option<u64>,
) -> Result<(Vec<messages::Model>, MessageListStats), Report> {
    authorize!(
        policy,
        subject,
        &Resource::Chat(chat_id.as_hyphenated().to_string()),
        Action::SharedRead
    )?;

    fetch_chat_messages(conn, chat_id, true, limit, offset).await
}

/// Fetch messages for a chat with pagination support, without any authorization
/// check.
///
/// When `active_thread_only` is true, only messages that are part of the chat's
/// active thread are returned (branches from edits/regenerations are excluded).
async fn fetch_chat_messages(
    conn: &DatabaseConnection,
    chat_id: &Uuid,
    active_thread_only: bool,
    limit: Option<u64>,
    offset: Option<u64>,
) -> Result<(Vec<messages::Model>, MessageListStats), Report> {
    // Set default pagination values
    let limit = limit.unwrap_or(100);
    let offset = offset.unwrap_or(0);

    // Query messages for this chat with pagination, ordered by creation time
    let mut query = Messages::find().filter(messages::Column::ChatId.eq(*chat_id));
    if active_thread_only {
        query = query.filter(messages::Column::IsMessageInActiveThread.eq(true));
    }
    let messages = query
        .order_by_desc(messages::Column::CreatedAt)
        .limit(limit)
        .offset(offset)
        .all(conn)
        .await?;

    // Use our pagination utility to efficiently calculate the total count
    let (total_count, has_more) =
        pagination::calculate_total_count(offset, limit, messages.len(), || async {
            let mut count_query = Messages::find().filter(messages::Column::ChatId.eq(*chat_id));
            if active_thread_only {
                count_query =
                    count_query.filter(messages::Column::IsMessageInActiveThread.eq(true));
            }
            count_query.count(conn).await
        })
        .await?;

    // Create the statistics object
    let stats = MessageListStats {
        total_count: pagination::u64_to_i64_count(total_count),
        current_offset: offset,
        returned_count: messages.len(),
        has_more,
    };

    Ok((messages, stats))
}

pub async fn get_message_by_id(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    message_id: &Uuid,
) -> Result<messages::Model, Report> {
    // Find the message
    let message = Messages::find_by_id(*message_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Message with ID {} not found", message_id))?;

    // Authorize that the subject can read this message
    authorize!(
        policy,
        subject,
        &Resource::Chat(message.chat_id.to_string()),
        Action::Read
    )?;

    Ok(message)
}

pub fn get_generation_chat_provider_id_from_message(
    message: &messages::Model,
) -> Result<Option<String>, Report> {
    if let Some(generation_params_json) = &message.generation_parameters {
        let generation_params: GenerationParameters =
            serde_json::from_value(generation_params_json.clone()).map_err(|e| {
                eyre!(
                    "Failed to parse generation parameters for message {}: {}",
                    message.id,
                    e
                )
            })?;
        return Ok(generation_params.generation_chat_provider_id);
    }
    Ok(None)
}

/// An action facet (id + args) as stored in generation parameters.
pub type StoredActionFacet = (String, std::collections::HashMap<String, String>);

/// The action facet (id + args) stored in a message's generation parameters,
/// if any. Used by regenerate to re-apply the facet the original generation
/// ran under when the request doesn't re-send one.
pub fn get_generation_action_facet_from_message(
    message: &messages::Model,
) -> Result<Option<StoredActionFacet>, Report> {
    if let Some(generation_params_json) = &message.generation_parameters {
        let generation_params: GenerationParameters =
            serde_json::from_value(generation_params_json.clone()).map_err(|e| {
                eyre!(
                    "Failed to parse generation parameters for message {}: {}",
                    message.id,
                    e
                )
            })?;
        return Ok(generation_params
            .action_facet_id
            .map(|id| (id, generation_params.action_facet_args.unwrap_or_default())));
    }
    Ok(None)
}

/// The action facet (id + args) stored in a user message's input parameters,
/// if any. Used by edit to re-apply the facet the original user message
/// carried when the edit request doesn't re-send one.
pub fn get_input_action_facet_from_message(
    message: &messages::Model,
) -> Result<Option<StoredActionFacet>, Report> {
    if let Some(input_params_json) = &message.input_parameters {
        let input_params: InputParameters = serde_json::from_value(input_params_json.clone())
            .map_err(|e| {
                eyre!(
                    "Failed to parse input parameters for message {}: {}",
                    message.id,
                    e
                )
            })?;
        return Ok(input_params
            .action_facet_id
            .map(|id| (id, input_params.action_facet_args.unwrap_or_default())));
    }
    Ok(None)
}

/// The assistant mentions stored in a user message's input parameters, if any.
/// Used by regenerate (and edit fallback) to replay the mentions the original
/// message carried when the request doesn't re-send them. Entries that are not
/// valid uuids are skipped.
pub fn get_input_mentioned_assistant_ids_from_message(
    message: &messages::Model,
) -> Result<Option<Vec<Uuid>>, Report> {
    let Some(input_params_json) = &message.input_parameters else {
        return Ok(None);
    };
    let input_params: InputParameters =
        serde_json::from_value(input_params_json.clone()).map_err(|e| {
            eyre!(
                "Failed to parse input parameters for message {}: {}",
                message.id,
                e
            )
        })?;
    Ok(input_params.mentioned_assistant_ids.map(|ids| {
        ids.iter()
            .filter_map(|id| match Uuid::parse_str(id) {
                Ok(parsed) => Some(parsed),
                Err(_) => {
                    tracing::warn!(
                        message_id = %message.id,
                        mentioned_assistant_id = %id,
                        "Skipping unparseable mentioned assistant id"
                    );
                    None
                }
            })
            .collect()
    }))
}

/// The delegation run mode stored in a user message's input parameters, if
/// any. Used by regenerate (and edit fallback) to replay the mode the original
/// message carried when the request doesn't re-send it.
pub fn get_input_delegation_run_mode_from_message(
    message: &messages::Model,
) -> Result<Option<DelegationRunMode>, Report> {
    let Some(input_params_json) = &message.input_parameters else {
        return Ok(None);
    };
    let input_params: InputParameters =
        serde_json::from_value(input_params_json.clone()).map_err(|e| {
            eyre!(
                "Failed to parse input parameters for message {}: {}",
                message.id,
                e
            )
        })?;
    Ok(input_params.delegation_run_mode)
}

/// Resolve a provider for a user message branch by checking the assistant response that follows
/// the user message. Prefer the active-thread assistant sibling; fall back to newest sibling.
pub async fn get_generation_chat_provider_id_for_replaced_user_message(
    conn: &DatabaseConnection,
    user_message_id: &Uuid,
) -> Result<Option<String>, Report> {
    let active_sibling = Messages::find()
        .filter(messages::Column::PreviousMessageId.eq(*user_message_id))
        .filter(messages::Column::GenerationParameters.is_not_null())
        .filter(messages::Column::IsMessageInActiveThread.eq(true))
        .order_by_desc(messages::Column::CreatedAt)
        .one(conn)
        .await?;

    if let Some(message) = active_sibling {
        return get_generation_chat_provider_id_from_message(&message);
    }

    let newest_sibling = Messages::find()
        .filter(messages::Column::PreviousMessageId.eq(*user_message_id))
        .filter(messages::Column::GenerationParameters.is_not_null())
        .order_by_desc(messages::Column::CreatedAt)
        .one(conn)
        .await?;

    if let Some(message) = newest_sibling {
        return get_generation_chat_provider_id_from_message(&message);
    }

    Ok(None)
}

pub async fn update_message_content(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    message_id: &Uuid,
    new_content_parts: Vec<ContentPart>,
) -> Result<messages::Model, Report> {
    // Find the message to get its current raw_message and chat_id for authorization
    let message = Messages::find_by_id(*message_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Message with ID {} not found for update", message_id))?;

    // Authorize that the subject can update this message (part of submitting to chat)
    authorize!(
        policy,
        subject,
        &Resource::Chat(message.chat_id.as_hyphenated().to_string()),
        Action::SubmitMessage
    )?;

    let mut parsed_raw_message = MessageSchema::validate(&message.raw_message)?;
    // Ensure it's an assistant message we are updating
    if parsed_raw_message.role != MessageRole::Assistant {
        return Err(eyre!(
            "Attempted to update content of a non-assistant message"
        ));
    }

    parsed_raw_message.content = strip_image_urls_from_content(new_content_parts);
    let updated_raw_message = parsed_raw_message.to_json()?;

    let active_model = messages::ActiveModel {
        id: ActiveValue::Set(*message_id),
        raw_message: ActiveValue::Set(updated_raw_message),
        ..Default::default() // Only update raw_message, preserve other fields
    };

    messages::Entity::update(active_model)
        .exec(conn)
        .await
        .map_err(|e| eyre!("Failed to update message content: {}", e))?;

    // Re-fetch the message to return the updated model
    let updated_message_model = Messages::find_by_id(*message_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Message with ID {} not found after update", message_id))?;

    Ok(updated_message_model)
}

/// Update the generation metadata for a message.
pub async fn update_message_generation_metadata(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    message_id: &Uuid,
    generation_metadata: GenerationMetadata,
) -> Result<messages::Model, Report> {
    // Find the message to get its chat_id for authorization
    let message = Messages::find_by_id(*message_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Message with ID {} not found for update", message_id))?;

    // Authorize that the subject can update this message (part of submitting to chat)
    authorize!(
        policy,
        subject,
        &Resource::Chat(message.chat_id.to_string()),
        Action::SubmitMessage
    )?;

    let generation_metadata_json = to_value(generation_metadata)?;

    let active_model = messages::ActiveModel {
        id: ActiveValue::Set(*message_id),
        generation_metadata: ActiveValue::Set(Some(generation_metadata_json)),
        ..Default::default() // Only update generation_metadata, preserve other fields
    };

    messages::Entity::update(active_model)
        .exec(conn)
        .await
        .map_err(|e| eyre!("Failed to update message generation metadata: {}", e))?;

    // Re-fetch the message to return the updated model
    let updated_message_model = Messages::find_by_id(*message_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Message with ID {} not found after update", message_id))?;

    Ok(updated_message_model)
}

/// One input message for an LLM generation.
/// In contrast to the `Message` model, which bundles multiple individual LLM messages, this is closer
/// to the native format of the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputMessage {
    pub role: MessageRole,
    pub content: ContentPart,
}

impl InputMessage {
    pub fn full_text(&self) -> String {
        match &self.content {
            ContentPart::Text(content) => content.text.to_string(),
            ContentPart::Reasoning(_) => String::new(),
            ContentPart::ToolUse(_) => String::new(),
            ContentPart::ToolApprovalRequest(_) => String::new(),
            ContentPart::ToolApproval(_) => String::new(),
            ContentPart::ToolRejection(_) => String::new(),
            ContentPart::TextFilePointer(_) => String::new(),
            ContentPart::ImageFilePointer(_) => String::new(),
            ContentPart::Image(_) => String::new(),
            // Markers are metadata-only; rendering happens in the resolver.
            // A task result renders there too, through the configured result
            // template and inside the untrusted-data frame.
            ContentPart::ActionFacetMarker(_)
            | ContentPart::DelegationPreambleMarker(_)
            | ContentPart::TaskResult(_) => String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationInputMessages {
    pub(crate) messages: Vec<InputMessage>,
}

impl GenerationInputMessages {
    pub fn validate(json: &JsonValue) -> Result<Self, Report> {
        serde_json::from_value(json.clone())
            .map_err(|e| eyre!("Invalid input message format: {}", e))
    }
}

/// Action-facet templates (e.g. `outlook_review_draft`,
/// `outlook_rewrite_selection`) prefix every rendered prompt with the
/// literal string `"FOR THIS MESSAGE ONLY:"`. They are request-scoped and
/// must never replay into later turns — when they do, the model sees
/// multiple competing format directives in the same chat request and
/// drifts. We filter on the prefix rather than a sentinel marker so this
/// also cleans up history rows already saved before the filter existed,
/// without requiring a DB migration.
fn is_action_facet_system_message(message: &InputMessage) -> bool {
    if !matches!(message.role, MessageRole::System) {
        return false;
    }
    if let ContentPart::Text(ContentPartText { text }) = &message.content {
        return text.trim_start().starts_with("FOR THIS MESSAGE ONLY:");
    }
    false
}

/// Helper function to determine if a file is an image based on its extension
fn is_image_file(filename: &str) -> bool {
    if let Some(extension) = filename.rsplit('.').next() {
        matches!(
            extension.to_lowercase().as_str(),
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "tiff" | "tif" | "ico"
        )
    } else {
        false
    }
}

/// For now retrieves the last `n` (= default 10) messages in the chat to serve as input for generating the next message.
/// Supports both a global system prompt and an optional assistant-specific prompt.
pub async fn get_generation_input_messages_by_previous_message_id(
    conn: &DatabaseConnection,
    system_prompt: Option<String>,
    assistant_prompt: Option<String>,
    previous_message_id: &Uuid,
    num_previous_messages: Option<usize>,
    new_generation_files: Vec<FileContentsForGeneration>,
) -> Result<GenerationInputMessages, Report> {
    let num_previous_messages = num_previous_messages.unwrap_or(10);
    let mut messages_to_process: Vec<messages::Model> = vec![];
    let mut base_history: Option<GenerationInputMessages> = None;
    let mut current_message_id_opt = Some(*previous_message_id);

    while let Some(current_message_id) = current_message_id_opt {
        // Traverse the chat history, until we have `num_previous_messages` messages, or we reach the first message
        if messages_to_process.len() >= num_previous_messages {
            break;
        }

        let message = Messages::find_by_id(current_message_id)
            .one(conn)
            .await?
            .ok_or_else(|| eyre!("Message with ID {} not found", current_message_id))?;

        current_message_id_opt = message.previous_message_id;

        if let Some(gen_input_json) = &message.generation_input_messages {
            let validated = GenerationInputMessages::validate(gen_input_json)?;
            // Strip per-turn action-facet System messages that pollute prior
            // turns' snapshots. Each action-facet directive is request-scoped
            // ("FOR THIS MESSAGE ONLY") and must not leak into later turns —
            // when it does, the model sees competing format directives from
            // past turns and the current turn, and drifts toward whichever
            // pattern its history-bias prefers (typically the older one).
            let filtered = GenerationInputMessages {
                messages: validated
                    .messages
                    .into_iter()
                    .filter(|msg| !is_action_facet_system_message(msg))
                    .collect(),
            };
            base_history = Some(filtered);
            messages_to_process.push(message);
            break; // Found anchor
        } else {
            messages_to_process.push(message);
        }
    }

    // `messages_to_process` is in reverse chronological order. Reverse it to process chronologically.
    messages_to_process.reverse();

    // Start with the base history if we found one.
    let mut input_messages: Vec<InputMessage> = if let Some(history) = base_history {
        history.messages
    } else {
        vec![]
    };

    // Process the collected messages and add their content to the input_messages.
    for message in messages_to_process {
        let parsed_raw_message = MessageSchema::validate(&message.raw_message)?;
        for content_part in parsed_raw_message.content {
            input_messages.push(InputMessage {
                role: parsed_raw_message.role.clone(),
                content: content_part,
            });
        }
    }

    // Add system prompts if not already present
    // Only add prompts if there are no system messages in the input messages yet
    if !input_messages.iter().any(|m| m.role == MessageRole::System) {
        let mut prompts_to_add = vec![];

        // First add the global system prompt if present
        if let Some(prompt) = system_prompt {
            prompts_to_add.push(InputMessage {
                role: MessageRole::System,
                content: ContentPart::Text(ContentPartText { text: prompt }),
            });
        }

        // Then add the assistant prompt as a second system message if present
        if let Some(prompt) = assistant_prompt {
            prompts_to_add.push(InputMessage {
                role: MessageRole::System,
                content: ContentPart::Text(ContentPartText { text: prompt }),
            });
        }

        // Insert all prompts at the beginning
        for (i, prompt) in prompts_to_add.into_iter().enumerate() {
            input_messages.insert(i, prompt);
        }
    }

    // Now add the new generation files to the input messages as file pointers
    // The actual content extraction/encoding will happen JIT when preparing for LLM generation
    for file in new_generation_files {
        let content = if is_image_file(&file.filename) {
            ContentPart::ImageFilePointer(ContentPartImageFilePointer {
                file_upload_id: file.id,
                download_url: None,
                preview_url: None,
            })
        } else {
            ContentPart::TextFilePointer(ContentPartTextFilePointer {
                file_upload_id: file.id,
            })
        };

        input_messages.push(InputMessage {
            role: MessageRole::User,
            content,
        });
    }

    Ok(GenerationInputMessages {
        messages: input_messages,
    })
}

/// Remove request-scoped URLs from image pointers before storing them.
pub fn strip_image_urls_from_content(content: Vec<ContentPart>) -> Vec<ContentPart> {
    content
        .into_iter()
        .map(|part| match part {
            ContentPart::ImageFilePointer(pointer) => {
                ContentPart::ImageFilePointer(ContentPartImageFilePointer {
                    file_upload_id: pointer.file_upload_id,
                    download_url: None,
                    preview_url: None,
                })
            }
            other => other,
        })
        .collect()
}

/// Regenerate presigned URLs for ImageFilePointer content parts.
///
/// This function takes message content and hydrates fresh presigned URLs for any
/// ImageFilePointer content parts, without relying on URLs stored in the database.
pub async fn regenerate_image_urls_in_content(
    conn: &DatabaseConnection,
    content: Vec<ContentPart>,
    file_storage_providers: &std::collections::HashMap<
        String,
        crate::services::file_storage::FileStorage,
    >,
) -> Result<Vec<ContentPart>, Report> {
    use crate::db::entity::file_uploads;

    let mut updated_content = Vec::with_capacity(content.len());

    for part in content {
        let updated_part = match part {
            ContentPart::ImageFilePointer(ref pointer) => {
                // Fetch the file upload record to get storage path and provider
                let file_upload = file_uploads::Entity::find_by_id(pointer.file_upload_id)
                    .one(conn)
                    .await?;

                if let Some(file) = file_upload {
                    // Get the file storage provider
                    let file_storage = file_storage_providers.get(&file.file_storage_provider_id);

                    if let Some(storage) = file_storage {
                        let download_url = match storage
                            .generate_presigned_download_url_with_context(
                                &file.file_storage_path,
                                None,
                                Some(&file.filename),
                                None, // No Sharepoint context for now (image generation uses default provider)
                            )
                            .await
                        {
                            Ok(url) => url,
                            Err(err) => {
                                tracing::warn!(
                                    file_id = %file.id,
                                    provider = %file.file_storage_provider_id,
                                    error = %err,
                                    "Failed to regenerate download URL, using placeholder"
                                );
                                // Return placeholder URL that the frontend can use to fetch via API
                                format!("/api/v1beta/files/{}", file.id)
                            }
                        };
                        ContentPart::ImageFilePointer(ContentPartImageFilePointer {
                            file_upload_id: pointer.file_upload_id,
                            download_url: Some(download_url),
                            preview_url: Some(proxied_preview_url_for_file(&file.id)),
                        })
                    } else {
                        tracing::warn!(
                            file_id = %file.id,
                            provider = %file.file_storage_provider_id,
                            "File storage provider not found, keeping original URL"
                        );
                        part
                    }
                } else {
                    tracing::warn!(
                        file_upload_id = %pointer.file_upload_id,
                        "File upload not found for ImageFilePointer, keeping original URL"
                    );
                    part
                }
            }
            // Pass through all other content types unchanged
            other => other,
        };

        updated_content.push(updated_part);
    }

    Ok(updated_content)
}

#[cfg(test)]
mod action_facet_filter_tests {
    use super::is_action_facet_system_message;
    use super::{
        ContentPart, ContentPartImageFilePointer, ContentPartText, InputMessage, MessageRole,
        strip_image_urls_from_content,
    };
    use sqlx::types::Uuid;

    fn system_text(text: &str) -> InputMessage {
        InputMessage {
            role: MessageRole::System,
            content: ContentPart::Text(ContentPartText {
                text: text.to_string(),
            }),
        }
    }

    fn user_text(text: &str) -> InputMessage {
        InputMessage {
            role: MessageRole::User,
            content: ContentPart::Text(ContentPartText {
                text: text.to_string(),
            }),
        }
    }

    #[test]
    fn flags_action_facet_directives_for_both_outlook_templates() {
        assert!(is_action_facet_system_message(&system_text(
            "FOR THIS MESSAGE ONLY: The user is composing an email (format: text). The full draft body is:\n\nHi"
        )));
        assert!(is_action_facet_system_message(&system_text(
            "FOR THIS MESSAGE ONLY: The user is composing an email in html format and has selected the following text from the email body:\n\nHi"
        )));
    }

    #[test]
    fn tolerates_leading_whitespace_in_rendered_template() {
        // The rendered template is wrapped in r#"..."# string literals that
        // begin with a newline; the trim before prefix-match handles that.
        assert!(is_action_facet_system_message(&system_text(
            "\nFOR THIS MESSAGE ONLY: The user is composing an email"
        )));
    }

    #[test]
    fn ignores_user_messages_even_with_matching_text() {
        assert!(!is_action_facet_system_message(&user_text(
            "FOR THIS MESSAGE ONLY: not really, just user prose"
        )));
    }

    #[test]
    fn ignores_unrelated_system_messages() {
        assert!(!is_action_facet_system_message(&system_text(
            "You are a helpful assistant."
        )));
        assert!(!is_action_facet_system_message(&system_text(
            "Respond in plain text."
        )));
    }

    #[test]
    fn strips_hydrated_urls_from_image_file_pointers() {
        let file_upload_id = Uuid::new_v4();
        let stripped = strip_image_urls_from_content(vec![ContentPart::ImageFilePointer(
            ContentPartImageFilePointer {
                file_upload_id,
                download_url: Some("https://storage.example/download".to_string()),
                preview_url: Some("https://storage.example/preview".to_string()),
            },
        )]);

        assert_eq!(
            stripped,
            vec![ContentPart::ImageFilePointer(ContentPartImageFilePointer {
                file_upload_id,
                download_url: None,
                preview_url: None,
            })]
        );
    }
}

#[cfg(test)]
mod provenance_run_mode_tests {
    use super::{DelegationRunMode, ProvenanceRunMode};

    /// The persisted spellings, and what absence means.
    ///
    /// `run_mode` is stored inside a JSON envelope that predates this type, so
    /// the wire strings are not free to change: `"background"` rows written
    /// before `async` existed must still parse, and a row with no `run_mode` at
    /// all must read as the awaited mode rather than failing. `Wait` is never
    /// written, which is what keeps those old envelopes byte-identical.
    #[test]
    fn provenance_run_mode_round_trips_and_absence_means_wait() {
        for (mode, wire) in [
            (ProvenanceRunMode::Wait, "wait"),
            (ProvenanceRunMode::Background, "background"),
            (ProvenanceRunMode::Async, "async"),
        ] {
            let value = serde_json::to_value(mode).expect("serializes");
            assert_eq!(value.as_str(), Some(wire), "{mode:?} must spell {wire}");
            assert_eq!(
                serde_json::from_value::<ProvenanceRunMode>(value).expect("parses"),
                mode
            );
        }

        // Absence is the awaited mode, which is why nothing writes `wait`.
        let absent: Option<ProvenanceRunMode> =
            serde_json::from_value(serde_json::json!(null)).expect("parses");
        assert_eq!(absent, None);
        assert_eq!(absent.unwrap_or_default(), ProvenanceRunMode::Wait);

        // The request wire stays at two variants: a client cannot ask for a
        // mode only the server may choose.
        assert!(serde_json::from_value::<DelegationRunMode>(serde_json::json!("async")).is_err());

        // Both detached modes take the dispatch branch and consume a slot.
        assert!(!ProvenanceRunMode::Wait.is_detached());
        assert!(ProvenanceRunMode::Background.is_detached());
        assert!(ProvenanceRunMode::Async.is_detached());
    }
}

#[cfg(test)]
mod task_result_marker_tests {
    use super::{GenerationInitiator, TASK_RESULT_INITIATOR_WIRE};

    /// The re-anchoring walk compares a literal against the stored JSON; the
    /// enum decides what is stored. If they drift, re-anchoring stops one row
    /// short of the reaction and nothing fails loudly — the user just loses
    /// the answer off the active thread.
    #[test]
    fn task_result_initiator_wire_spelling_matches_the_sql_predicate() {
        assert_eq!(
            serde_json::to_value(GenerationInitiator::TaskResult)
                .unwrap()
                .as_str(),
            Some(TASK_RESULT_INITIATOR_WIRE),
        );
    }
}

#[cfg(test)]
mod tool_approval_part_tests {
    use super::{ContentPart, ContentPartToolRejection, ToolApprovalKind};
    use serde_json::json;

    /// Approval rows are durable and predate every field this stop now carries,
    /// so a row written by an older release has to keep resuming — as an
    /// `mcp_tool` stop describing the one call it recorded.
    #[test]
    fn approval_request_old_row_parses_as_mcp_tool() {
        let row = json!({
            "content_type": "tool_approval_request",
            "tool_call_id": "call-1",
            "tool_name": "publish",
            "mcp_server_id": "server",
            "input": {"topic": "news"},
            "annotations": {
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": true
            },
            "preset": "restrictive",
            "allow_always": true,
            "requested_at": "2026-01-01T00:00:00Z"
        });

        let ContentPart::ToolApprovalRequest(request) =
            serde_json::from_value::<ContentPart>(row).expect("an old row still parses")
        else {
            panic!("expected an approval request");
        };
        assert_eq!(request.kind, ToolApprovalKind::McpTool);
        assert!(request.approvals.is_empty());
        assert!(request.pending_tool_calls.is_empty());

        let items = request.approval_items();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].approval_id, "call-1");
        assert_eq!(items[0].tool_call_id, "call-1");
        assert_eq!(items[0].tool_name, "publish");
        assert_eq!(items[0].input, json!({"topic": "news"}));
        assert!(items[0].child.is_none());
    }

    /// The projection has to agree with what the gate writes, or a row written
    /// now and a row written before would be decided under different ids.
    #[test]
    fn approval_items_prefers_the_recorded_list() {
        let row = json!({
            "content_type": "tool_approval_request",
            "tool_call_id": "call-1",
            "tool_name": "publish",
            "mcp_server_id": "server",
            "input": {},
            "annotations": {
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": false,
                "openWorldHint": false
            },
            "preset": "permissive",
            "allow_always": false,
            "requested_at": "2026-01-01T00:00:00Z",
            "kind": "delegated_task",
            "approvals": [
                {
                    "approval_id": "parent-call-1",
                    "tool_call_id": "parent-call-1",
                    "tool_name": "delegate_task",
                    "input": {"task": "summarize"}
                }
            ],
            "pending_tool_calls": [
                {"call_id": "call-2", "fn_name": "search", "fn_arguments": {}}
            ]
        });

        let ContentPart::ToolApprovalRequest(request) =
            serde_json::from_value::<ContentPart>(row).expect("a kinded row parses")
        else {
            panic!("expected an approval request");
        };
        assert_eq!(request.kind, ToolApprovalKind::DelegatedTask);
        let items = request.approval_items();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].approval_id, "parent-call-1");
        assert_eq!(request.pending_tool_calls.len(), 1);
        assert_eq!(request.pending_tool_calls[0].call_id, "call-2");
    }

    #[test]
    fn rejection_row_without_the_new_fields_parses() {
        let row = json!({
            "content_type": "tool_rejection",
            "tool_call_id": "call-1",
            "rejected_at": "2026-01-01T00:00:00Z"
        });
        let ContentPart::ToolRejection(ContentPartToolRejection {
            approval_id,
            child_chat_id,
            reason,
            ..
        }) = serde_json::from_value::<ContentPart>(row).expect("an old rejection still parses")
        else {
            panic!("expected a rejection");
        };
        assert!(approval_id.is_none());
        assert!(child_chat_id.is_none());
        assert!(reason.is_none());
    }
}
