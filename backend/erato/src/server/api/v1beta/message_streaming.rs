use crate::config::{
    FacetsConfig, HallucinationSuppressionConfig, McpToolApprovalConfig, McpToolApprovalPreset,
};
use crate::db::entity_ext::{chats, messages};
use crate::metrics::{
    report_chat_provider_generation_error, report_chat_provider_time_to_first_token,
    report_chat_provider_time_to_last_token,
};
use crate::models::chat::{
    ChatCreationStatus, get_chat_by_message_id, get_or_create_chat,
    get_or_create_chat_by_previous_message_id,
};
use crate::models::message::{
    ApprovalItem, ContentPart, ContentPartImage, ContentPartReasoning, ContentPartText,
    ContentPartToolApproval, ContentPartToolApprovalRequest, ContentPartToolRejection,
    DelegationRunMode, GenerationErrorType, GenerationInputMessages, GenerationMetadata,
    GenerationParameters, GenerationRequestContext, MessageRole, MessageSchema, ToolApprovalKind,
    ToolCallStatus as MessageToolCallStatus, ToolUse,
    get_generation_chat_provider_id_for_replaced_user_message,
    get_generation_chat_provider_id_from_message, get_message_by_id, submit_message,
    update_message_content, update_message_generation_metadata,
};
use crate::models::user_tool_approval_setting::UserToolDecision;
use crate::policy::engine::{PolicyEngine, authorize};
use crate::policy::types::{Action, Resource, Subject};
use crate::server::api::v1beta::ChatMessage;
use crate::server::api::v1beta::file_resolution::{
    resolve_directive_markers_in_generation_input, resolve_file_pointers_in_generation_input,
};
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::server::api::v1beta::message_streaming_file_extraction::{
    parse_content_filter_error_from_mcp_tool_result, post_process_mcp_tool_result,
};
use crate::services::background_tasks::{
    BackgroundTaskManager, StreamingEvent, StreamingTask, Takeover, TaskCleanupGuard, TaskOutcome,
    ToolCallStatus as BgToolCallStatus,
};
use crate::services::client_tools::{ClientToolDelivery, ClientToolOutcome};
use crate::services::display_text::{MAX_DISPLAY_NAME_CHARS, sanitize_display_text};
use crate::services::genai::{build_chat_options_for_completion, build_chat_options_for_summary};
use crate::services::genai_langfuse::{
    TracedGenerationBuilder, create_otel_error_generation_from_chat, create_otel_tool_call_span,
    create_tool_call_span_from_chat, create_trace_from_chat, create_trace_metadata,
    create_trace_with_generation_from_chat, generate_langfuse_ids, generate_name_from_chat_request,
    langfuse_model_tag, langfuse_tool_called_tag,
};
use crate::services::langfuse::TracingLangfuseClient;
use crate::services::mcp_manager::{McpRequestAuthContext, convert_mcp_tools_to_genai_tools};
use crate::services::mcp_session_manager::is_tool_allowed_to_wait;
use crate::services::mcp_tool_approval::{
    McpToolEffectiveState, effective_mcp_tool_state, evaluate_mcp_tool_approval,
};
use crate::services::prompt_composition::traits::{
    FileResolver, MessageRepository, PromptProvider,
};
use crate::services::prompt_composition::{
    AppStateFileResolver, AppStatePromptProvider, DatabaseMessageRepository,
    PromptCompositionUserInput, compose_prompt_messages,
};
use crate::services::prompt_composition::{
    build_mcp_tool_allowlist, build_model_settings_for_facets,
};
use crate::services::prompt_guardrails::{
    prompt_injection_filter_details, scan_chat_request_for_prompt_injection,
};
use crate::services::sentry::capture_report;
use crate::services::template_rendering::contexts::chat_provider_headers::ChatProviderHeadersContext;
use crate::services::tool_arguments::{
    ToolArgumentStreams, tool_call_content_index, upsert_tool_use, without_preparing_tools,
};
use crate::state::{AppState, ChatProviderConfigWithId};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Sse;
use axum::response::sse::Event;
use axum::{Extension, Json};
use chrono::Utc;
use eyre::{OptionExt, WrapErr};
use eyre::{Report, eyre};
use futures::Stream;
use genai::chat::{
    ChatMessage as GenAiChatMessage, ChatOptions, ChatRequest, ChatRole, ChatStreamEvent,
    ContentPart as GenAiContentPart, MessageContent, ReasoningItem, ReasoningSummaryText,
    StreamChunk, StreamEnd,
};
use sea_orm::EntityTrait;
use sea_orm::JsonValue;
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::mpsc::Sender;
use tokio_stream::StreamExt as _;
use tracing;
use tracing::{Instrument, instrument};
use utoipa::ToSchema;

const HALLUCINATION_LOOP_ERROR_DESCRIPTION: &str =
    "Generation aborted. Hallucination loop detected. Please regenerate the message.";
const PROMPT_INJECTION_FILTER_ERROR_DESCRIPTION: &str =
    "The request was filtered because it matched a configured prompt injection guardrail.";

fn is_openai_responses_provider_kind(provider_kind: &str) -> bool {
    matches!(provider_kind, "openai_responses" | "azure_openai_responses")
}

fn should_strip_persisted_reasoning_messages(
    provider_kind: &str,
    compat_no_replay_summary: bool,
    did_prior_assistant_chat_provider_change: bool,
) -> bool {
    did_prior_assistant_chat_provider_change
        || compat_no_replay_summary
        || is_openai_responses_provider_kind(provider_kind)
}

fn non_empty_string(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

fn non_empty_vec<T: Clone>(value: &[T]) -> Option<Vec<T>> {
    (!value.is_empty()).then(|| value.to_vec())
}

fn reasoning_summary_part(summary: Option<&str>) -> ReasoningSummaryText {
    ReasoningSummaryText::new(summary.unwrap_or_default())
}

fn now_timestamp() -> String {
    Utc::now().to_rfc3339()
}

/// What the approval gate does with one MCP tool call once the policy and
/// the user's own decision are combined.
#[derive(Debug, PartialEq)]
enum McpToolCallGate {
    Run,
    /// Boxed: the request carries the whole decision list, and every call that
    /// simply runs would otherwise pay for it.
    Ask(Box<ContentPartToolApprovalRequest>),
    Refuse(String),
}

/// Decide whether a tool call runs, parks on a durable approval request or
/// is refused outright. A denial is refused here rather than parked: the
/// user already answered, so a card would only ask them again.
///
/// The parked request's `tool_name` is both what the card shows and the key
/// the continuation runs the tool by, so it must survive display cleaning
/// unchanged; a name that would not is refused instead of parked.
fn gate_mcp_tool_call(
    config: &McpToolApprovalConfig,
    server_id: &str,
    tool: &rmcp::model::Tool,
    tool_call: &genai::chat::ToolCall,
    user_decision: Option<UserToolDecision>,
) -> McpToolCallGate {
    let verdict = evaluate_mcp_tool_approval(config, tool);
    match effective_mcp_tool_state(config, &verdict, user_decision) {
        McpToolEffectiveState::Allow => McpToolCallGate::Run,
        McpToolEffectiveState::Denied => McpToolCallGate::Refuse(format!(
            "The user has disabled the tool '{}' in their settings; the call was not executed.",
            tool_call.fn_name
        )),
        McpToolEffectiveState::Ask => {
            let display_name = sanitize_display_text(&tool_call.fn_name, MAX_DISPLAY_NAME_CHARS);
            if display_name.truncated || display_name.text != tool_call.fn_name {
                return McpToolCallGate::Refuse(format!(
                    "The tool '{}' has a name that cannot be shown for approval; the call was not executed.",
                    display_name.text
                ));
            }
            McpToolCallGate::Ask(Box::new(ContentPartToolApprovalRequest {
                tool_call_id: tool_call.call_id.clone(),
                tool_name: display_name.text.clone(),
                mcp_server_id: server_id.to_string(),
                input: tool_call.fn_arguments.clone(),
                annotations: verdict.annotations.clone(),
                preset: match config.preset {
                    McpToolApprovalPreset::Permissive => "permissive",
                    McpToolApprovalPreset::Restrictive => "restrictive",
                }
                .to_string(),
                allow_always: config.allow_always,
                requested_at: now_timestamp(),
                kind: ToolApprovalKind::McpTool,
                // The call id doubles as the approval id: one gated MCP call
                // is one decision, and the continuation already keys the
                // resolved slot by it.
                approvals: vec![ApprovalItem {
                    approval_id: tool_call.call_id.clone(),
                    tool_call_id: tool_call.call_id.clone(),
                    tool_name: display_name.text,
                    input: tool_call.fn_arguments.clone(),
                    child: None,
                }],
                // The rest of the parked batch is recorded by the caller that
                // owns the queue, not by this per-call gate.
                pending_tool_calls: Vec::new(),
            }))
        }
    }
}

fn build_openai_responses_reasoning_replay_parts(
    generation_metadata: GenerationMetadata,
    compat_no_replay_summary: bool,
) -> Vec<GenAiContentPart> {
    let reasoning_summary = generation_metadata
        .reasoning_summary
        .filter(|summary| !summary.is_empty());
    let mut reasoning_items = generation_metadata.reasoning_items.unwrap_or_default();

    for reasoning_item in &mut reasoning_items {
        if reasoning_item.summary.is_empty() {
            reasoning_item
                .summary
                .push(reasoning_summary_part(reasoning_summary.as_deref()));
        }
    }

    if let Some(encrypted_items) = generation_metadata.reasoning_item_encrypted_content {
        for encrypted_content in encrypted_items.into_iter().filter(|item| !item.is_empty()) {
            let already_present = reasoning_items
                .iter()
                .any(|item| item.encrypted_content.as_deref() == Some(encrypted_content.as_str()));
            if already_present {
                continue;
            }

            reasoning_items.push(ReasoningItem {
                summary: vec![reasoning_summary_part(reasoning_summary.as_deref())],
                encrypted_content: Some(encrypted_content),
                ..Default::default()
            });
        }
    }

    if !reasoning_items.is_empty() {
        return reasoning_items
            .into_iter()
            .map(GenAiContentPart::ReasoningItem)
            .collect();
    }

    if compat_no_replay_summary {
        Vec::new()
    } else {
        reasoning_summary
            .map(GenAiContentPart::ReasoningContent)
            .into_iter()
            .collect()
    }
}

fn strip_persisted_reasoning_messages(chat_request: &mut ChatRequest) {
    chat_request.messages.retain(|message| {
        if message.role != ChatRole::Assistant {
            return true;
        }

        let parts = message.content.parts();
        let is_summary_only_reasoning_message = !parts.is_empty()
            && parts
                .iter()
                .all(|part| matches!(part, GenAiContentPart::ReasoningContent(_)));

        !is_summary_only_reasoning_message
    });
}

async fn prior_assistant_chat_provider_changed(
    message_repo: &impl MessageRepository,
    just_submitted_user_message_id: &Uuid,
    current_chat_provider_id: &str,
) -> Result<bool, Report> {
    let current_message = message_repo
        .get_message_by_id(just_submitted_user_message_id)
        .await?;

    let Some(previous_message_id) = current_message.previous_message_id else {
        return Ok(false);
    };

    let previous_message = message_repo.get_message_by_id(&previous_message_id).await?;
    let parsed_message = MessageSchema::validate(&previous_message.raw_message)?;
    if parsed_message.role != MessageRole::Assistant {
        return Ok(false);
    }

    Ok(
        get_generation_chat_provider_id_from_message(&previous_message)?
            .as_deref()
            .is_some_and(|previous_chat_provider_id| {
                previous_chat_provider_id != current_chat_provider_id
            }),
    )
}

struct OpenAiResponsesReasoningReplayMessage {
    assistant_text: String,
    replay_message: GenAiChatMessage,
}

fn insert_openai_responses_reasoning_replay_messages(
    chat_request: &mut ChatRequest,
    reasoning_replay_messages: Vec<OpenAiResponsesReasoningReplayMessage>,
) {
    for replay in reasoning_replay_messages {
        let insert_index = chat_request
            .messages
            .iter()
            .position(|message| {
                message.role == ChatRole::Assistant
                    && message.content.first_text() == Some(replay.assistant_text.as_str())
            })
            .unwrap_or_else(|| chat_request.messages.len().saturating_sub(1));

        chat_request
            .messages
            .insert(insert_index, replay.replay_message);
    }
}

fn openai_responses_reasoning_replay_model_matches(
    current_chat_provider_id: &str,
    generation_parameters: Option<GenerationParameters>,
) -> bool {
    generation_parameters
        .and_then(|parameters| parameters.generation_chat_provider_id)
        .as_deref()
        == Some(current_chat_provider_id)
}

async fn collect_reasoning_replay_messages(
    message_repo: &impl MessageRepository,
    just_submitted_user_message_id: &Uuid,
    current_chat_provider_id: &str,
    compat_no_replay_summary: bool,
) -> Result<Vec<OpenAiResponsesReasoningReplayMessage>, Report> {
    // Token estimates provide an unsaved draft through a synthetic repository.
    // All history traversal must use that same repository, including replay.
    let mut current_message = message_repo
        .get_message_by_id(just_submitted_user_message_id)
        .await?;
    let mut replay_messages = Vec::new();

    while let Some(previous_message_id) = current_message.previous_message_id {
        current_message = message_repo.get_message_by_id(&previous_message_id).await?;
        let parsed_message = MessageSchema::validate(&current_message.raw_message)?;
        if parsed_message.role != MessageRole::Assistant {
            continue;
        }

        let Some(generation_metadata_value) = current_message.generation_metadata.as_ref() else {
            continue;
        };
        let generation_metadata =
            match serde_json::from_value::<GenerationMetadata>(generation_metadata_value.clone()) {
                Ok(metadata) => metadata,
                Err(error) => {
                    tracing::warn!(
                        message_id = %current_message.id,
                        error = ?error,
                        "Skipping malformed generation metadata during reasoning replay"
                    );
                    continue;
                }
            };

        let replay_parts = build_openai_responses_reasoning_replay_parts(
            generation_metadata,
            compat_no_replay_summary,
        );
        if !replay_parts.is_empty() {
            let generation_parameters = match current_message.generation_parameters.as_ref() {
                Some(parameters) => {
                    match serde_json::from_value::<GenerationParameters>(parameters.clone()) {
                        Ok(parameters) => Some(parameters),
                        Err(error) => {
                            tracing::warn!(
                                message_id = %current_message.id,
                                error = ?error,
                                "Disabling reasoning replay because generation parameters are malformed"
                            );
                            return Ok(Vec::new());
                        }
                    }
                }
                None => None,
            };
            if !openai_responses_reasoning_replay_model_matches(
                current_chat_provider_id,
                generation_parameters,
            ) {
                return Ok(Vec::new());
            }

            replay_messages.push(OpenAiResponsesReasoningReplayMessage {
                assistant_text: parsed_message.full_text(),
                replay_message: GenAiChatMessage::assistant(MessageContent::from_parts(
                    replay_parts,
                )),
            });
        }
    }

    replay_messages.reverse();
    Ok(replay_messages)
}

/// A facet action requested by the user for this generation.
#[derive(Clone, Debug, serde::Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ActionFacetRequest {
    /// The unique identifier of the action facet.
    pub id: String,
    /// Key-value arguments for the action facet.
    #[serde(default)]
    pub args: HashMap<String, String>,
}

const X_ERATO_PLATFORM_HEADER: &str = "X-Erato-Platform";
const DEFAULT_ERATO_PLATFORM: &str = "web";

/// Input parameters extracted from MeProfile for chat request preparation.
/// This type acts as a safeguard to only expose the specific attributes
/// needed during chat generation, rather than passing the full MeProfile.
#[derive(Debug, Clone)]
pub struct MeProfileChatRequestInput<'a> {
    pub subject: Subject,
    pub user_id: Option<Uuid>,
    pub user_groups: &'a [String],
    pub organization_user_id: Option<&'a str>,
    pub organization_group_ids: &'a [String],
    pub oidc_token: &'a str,
    pub access_token: Option<&'a str>,
    pub preferred_language: &'a str,
    pub user_preference_nickname: Option<&'a str>,
    pub user_preference_job_title: Option<&'a str>,
    pub user_preference_assistant_custom_instructions: Option<&'a str>,
    pub user_preference_assistant_additional_information: Option<&'a str>,
}

impl<'a> MeProfileChatRequestInput<'a> {
    /// Create a new MeProfileChatRequestInput from a MeProfile reference.
    pub fn from_me_profile(me_profile: &'a MeProfile) -> Self {
        Self {
            subject: me_profile.to_subject(),
            user_id: Uuid::parse_str(&me_profile.id).ok(),
            user_groups: &me_profile.groups,
            organization_user_id: me_profile.organization_user_id.as_deref(),
            organization_group_ids: &me_profile.organization_group_ids,
            oidc_token: &me_profile.oidc_token,
            access_token: me_profile.access_token.as_deref(),
            preferred_language: &me_profile.preferred_language,
            user_preference_nickname: me_profile.preference_nickname.as_deref(),
            user_preference_job_title: me_profile.preference_job_title.as_deref(),
            user_preference_assistant_custom_instructions: me_profile
                .preference_assistant_custom_instructions
                .as_deref(),
            user_preference_assistant_additional_information: me_profile
                .preference_assistant_additional_information
                .as_deref(),
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitStreamingResponseChatCreated {
    chat_id: Uuid,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitStreamingResponseUserMessageSaved {
    message_id: Uuid,
    message: ChatMessage,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitStreamingResponseMessageComplete {
    message_id: Uuid,
    content: Vec<ContentPart>,
    message: ChatMessage,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitStreamingResponseAssistantMessageStarted {
    message_id: Uuid,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitStreamingResponseMessageTextDelta {
    message_id: Uuid,
    content_index: usize,
    new_text: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitStreamingResponseMessageReasoningDelta {
    message_id: Uuid,
    content_index: usize,
    new_text: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitStreamingResponseToolCallProposed {
    message_id: Uuid,
    content_index: usize,
    tool_call_id: String,
    tool_name: String,
    input: Option<JsonValue>,
}

/// Sent when the model calls a facet `client_tool`: the generation is suspended
/// until the client executes the tool and POSTs the result back to the
/// continuation endpoint. Distinct from `tool_call_proposed` (which fires for
/// every proposed tool call) — this is the signal to execute on the client.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitStreamingResponseClientToolCall {
    message_id: Uuid,
    content_index: usize,
    tool_call_id: String,
    tool_name: String,
    input: Option<JsonValue>,
}

#[derive(Serialize, ToSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum ToolCallStatus {
    Preparing,
    InProgress,
    Success,
    Error,
}

#[derive(Serialize, ToSchema, Clone)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitStreamingResponseToolCallUpdate {
    message_id: Uuid,
    content_index: usize,
    tool_call_id: String,
    tool_name: String,
    input: Option<JsonValue>,
    status: ToolCallStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    progress_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    progress: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    total: Option<f64>,
    output: Option<JsonValue>,
}

#[derive(Serialize, ToSchema, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitStreamingResponseError {
    /// The message ID if available (may not be present if error occurred before message creation).
    #[serde(skip_serializing_if = "Option::is_none")]
    message_id: Option<Uuid>,
    /// The error details.
    #[serde(flatten)]
    error: GenerationErrorType,
}

trait SendAsSseEvent {
    fn tag(&self) -> &'static str;
    fn data_json(&self) -> Result<String, Report>;

    async fn send_event_report(&self, tx: Sender<Result<Event, Report>>) -> Result<(), Report> {
        let json = self
            .data_json()
            .wrap_err_with(|| format!("Failed to serialize {} event", self.tag()))?;
        tracing::trace!(
            tag = self.tag(),
            data_json = json.as_str(),
            "Sending response event"
        );
        tx.send(Ok(Event::default().event(self.tag()).data(json)))
            .await
            .map_err(|err| eyre!("Failed to send {} event: {err}", self.tag()))?;
        Ok(())
    }
}

/// Drain accepted progress before exposing the final result to the caller.
async fn await_mcp_tool_with_progress<
    MSG: SendAsSseEvent + From<MessageSubmitStreamingResponseToolCallUpdate>,
>(
    call: impl std::future::Future<Output = Result<rmcp::model::CallToolResult, Report>>,
    mut receiver: tokio::sync::mpsc::UnboundedReceiver<rmcp::model::ProgressNotificationParam>,
    mut update: MessageSubmitStreamingResponseToolCallUpdate,
    task: Option<&Arc<StreamingTask>>,
    tx: Sender<Result<Event, Report>>,
) -> Result<rmcp::model::CallToolResult, Report> {
    tokio::pin!(call);
    let mut completed = None;
    loop {
        let progress = if let Some(result) = completed.take() {
            match receiver.try_recv() {
                Ok(progress) => {
                    completed = Some(result);
                    progress
                }
                Err(_) => return result,
            }
        } else {
            tokio::select! {
                biased;
                _ = async {
                    match task {
                        Some(task) => task.wait_for_abort().await,
                        None => std::future::pending::<()>().await,
                    }
                } => return Err(eyre!("MCP tool call cancelled")),
                Some(progress) = receiver.recv() => progress,
                result = &mut call => {
                    completed = Some(result);
                    continue;
                }
            }
        };
        update.progress_message = progress.message;
        update.progress = Some(progress.progress);
        update.total = progress.total;
        if let Some(task) = task {
            send_background_event(
                task,
                StreamingEvent::ToolCallUpdate {
                    message_id: update.message_id,
                    content_index: update.content_index,
                    tool_call_id: update.tool_call_id.clone(),
                    tool_name: update.tool_name.clone(),
                    input: None,
                    status: BgToolCallStatus::InProgress,
                    progress_message: update.progress_message.clone(),
                    progress: update.progress,
                    total: update.total,
                    output: None,
                },
                "broadcast MCP progress",
            )
            .await;
        }
        let message: MSG = update.clone().into();
        send_generation_event(&message, tx.clone()).await?;
    }
}

async fn send_generation_event(
    message: &impl SendAsSseEvent,
    tx: Sender<Result<Event, Report>>,
) -> Result<(), Report> {
    let json = message
        .data_json()
        .wrap_err_with(|| format!("Failed to serialize {} event", message.tag()))?;
    tracing::trace!(
        tag = message.tag(),
        data_json = json.as_str(),
        "Sending response event"
    );

    // Generation is also delivered through StreamingTask's broadcast/history
    // path. The request-scoped SSE receiver can disappear when a client
    // navigates away or reconnects; that must not cancel the generation or
    // turn a successfully persisted tool call into a generation failure.
    if let Err(error) = crate::latency::stage(
        "generation.sse_channel_wait",
        tx.send(Ok(Event::default().event(message.tag()).data(json))),
    )
    .await
    {
        tracing::debug!(
            tag = message.tag(),
            error = ?error,
            "Client SSE channel closed while forwarding generation event"
        );
    }
    Ok(())
}

async fn forward_error_report(tx: &Sender<Result<Event, Report>>, error: &Report) {
    // `Report` is not cloneable. Recreate the channel error from its debug
    // representation so the returned report retains its original cause chain
    // and backtrace while legacy SSE consumers still receive the diagnostics.
    if let Err(send_error) = tx.send(Err(eyre!(format!("{error:?}")))).await {
        tracing::debug!(
            error = ?send_error,
            "Could not forward error to a closed SSE stream"
        );
    }
}

fn log_and_capture_error(context: &'static str, error: &Report) {
    tracing::error!(context, error = ?error, "Handled message-streaming error");
    capture_report(error);
}

fn warn_and_capture_error(context: &'static str, error: &Report) {
    tracing::warn!(context, error = ?error, "Continuing after message-streaming error");
    capture_report(error);
}

fn serialize_json_value<T: Serialize>(value: T, context: &'static str) -> Option<JsonValue> {
    match serde_json::to_value(value) {
        Ok(value) => Some(value),
        Err(error) => {
            let error = Report::new(error).wrap_err(context);
            warn_and_capture_error(context, &error);
            None
        }
    }
}

fn content_parts_json_or_log(content: &[ContentPart], context: &'static str) -> Option<JsonValue> {
    match crate::services::genai_langfuse::convert_content_parts_to_json(content) {
        Ok(value) => Some(value),
        Err(error) => {
            let error = error.wrap_err(context);
            warn_and_capture_error(context, &error);
            None
        }
    }
}

pub(crate) async fn send_background_event(
    task: &StreamingTask,
    event: StreamingEvent,
    context: &'static str,
) {
    if let Err(error) = task.send_event(event).await {
        let error = Report::msg(error).wrap_err(context);
        warn_and_capture_error(context, &error);
    }
}

#[derive(Clone, serde::Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct MessageSubmitRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of the message that this message is a response to. If this is the first message in the chat, this should be empty.
    previous_message_id: Option<Uuid>,
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of an existing chat to use. If provided, the chat with this ID will be used instead of creating a new one.
    /// This is useful for scenarios where you have created a chat first (e.g. for file uploads) before sending the first message.
    existing_chat_id: Option<Uuid>,
    #[schema(example = "Hello, world!")]
    /// The text of the message.
    #[allow(dead_code)]
    user_message: String,
    #[schema(example = "[\"00000000-0000-0000-0000-000000000000\"]")]
    /// The IDs of any files attached to this message. These files must already be uploaded to the file_uploads table.
    /// The files should normally only be provided with the first message they appear in the chat. After that they can assumed to be part of the chat history.
    #[serde(default)]
    input_files_ids: Vec<Uuid>,
    #[schema(example = "primary")]
    /// The ID of the chat provider to use for generation. If not provided, will use the highest priority model for the user.
    #[schema(nullable = false)]
    chat_provider_id: Option<String>,
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// Optional assistant ID to associate with the chat when creating a new chat.
    /// If provided with an existing_chat_id, this field is ignored.
    #[schema(nullable = false)]
    assistant_id: Option<Uuid>,
    /// Optional user-specified display name for a newly created chat.
    /// Ignored when existing_chat_id is provided.
    #[schema(nullable = false)]
    title_by_user_provided: Option<String>,
    /// Whether a newly created chat offers the model MCP write tools and
    /// client actions. Defaults to enabled. Ignored when existing_chat_id is
    /// provided; `PUT /me/chats/{chat_id}` changes it on an existing chat.
    #[schema(nullable = false)]
    mcp_write_tools_enabled: Option<bool>,
    /// MCP servers a newly created chat starts with switched off; their tools
    /// are withheld from the model. Ignored when existing_chat_id is
    /// provided; `PUT /me/chats/{chat_id}` changes the list on an existing
    /// chat.
    #[schema(nullable = false)]
    disabled_mcp_server_ids: Option<Vec<String>>,
    /// `server/tool` patterns of MCP tools a newly created chat starts with
    /// switched off; matching tools are withheld from the model. Ignored when
    /// existing_chat_id is provided; `PUT /me/chats/{chat_id}` changes the
    /// list on an existing chat.
    #[schema(nullable = false)]
    disabled_mcp_tools: Option<Vec<String>>,
    /// IDs of facets selected by the user for this generation.
    #[serde(default)]
    selected_facet_ids: Vec<String>,
    /// Optional action facet to apply during this generation.
    action_facet: Option<ActionFacetRequest>,
    /// Assistants the user @-mentioned in this message as delegation targets.
    /// Validated server-side; requires `delegation.assistants.enabled`.
    #[serde(default)]
    #[schema(nullable = false)]
    mentioned_assistant_ids: Option<Vec<Uuid>>,
    /// How delegated runs spawned by this message are awaited. Defaults to
    /// `wait`; `background` requires `delegation.allow_background`
    /// and is downgraded to `wait` server-side when the gate is off.
    #[serde(default)]
    #[schema(nullable = false)]
    delegation_run_mode: Option<DelegationRunMode>,
}

#[derive(Serialize, ToSchema)]
#[serde(tag = "message_type")]
pub enum MessageSubmitStreamingResponseMessage {
    #[serde(rename = "chat_created")]
    /// May optionally be sent at the start of the stream to indicate that a new chat has been created.
    ChatCreated(MessageSubmitStreamingResponseChatCreated),
    #[serde(rename = "user_message_saved")]
    /// Sent at the start of the stream to indicate that the user's message has been saved.
    UserMessageSaved(MessageSubmitStreamingResponseUserMessageSaved),
    #[serde(rename = "assistant_message_started")]
    /// Sent when the assistant message entry has been created, before generation starts.
    AssistantMessageStarted(MessageSubmitStreamingResponseAssistantMessageStarted),
    #[serde(rename = "assistant_message_completed")]
    /// Sent when the assistant's response has been saved in full.
    AssistantMessageCompleted(MessageSubmitStreamingResponseMessageComplete),
    #[serde(rename = "text_delta")]
    /// Sent whenever a new text chunk is generated by the assistant.
    TextDelta(MessageSubmitStreamingResponseMessageTextDelta),
    #[serde(rename = "reasoning_delta")]
    /// Sent whenever a new reasoning chunk is generated by the assistant.
    ReasoningDelta(MessageSubmitStreamingResponseMessageReasoningDelta),
    #[serde(rename = "tool_call_proposed")]
    /// Sent when the LLM proposes a tool call to be part of the assistant message.
    ToolCallProposed(MessageSubmitStreamingResponseToolCallProposed),
    #[serde(rename = "tool_call_update")]
    /// Sent to update the status of a tool call execution by the backend.
    ToolCallUpdate(MessageSubmitStreamingResponseToolCallUpdate),
    #[serde(rename = "client_tool_call")]
    /// Sent when the model calls a facet client tool: the turn is suspended
    /// until the client executes it and POSTs the result back.
    ClientToolCall(MessageSubmitStreamingResponseClientToolCall),
    #[serde(rename = "error")]
    /// Sent when an error occurs during message generation.
    Error(MessageSubmitStreamingResponseError),
}

impl SendAsSseEvent for MessageSubmitStreamingResponseMessage {
    fn tag(&self) -> &'static str {
        match self {
            Self::ChatCreated(_) => "chat_created",
            Self::UserMessageSaved(_) => "user_message_saved",
            Self::AssistantMessageStarted(_) => "assistant_message_started",
            Self::AssistantMessageCompleted(_) => "assistant_message_completed",
            Self::TextDelta(_) => "text_delta",
            Self::ReasoningDelta(_) => "reasoning_delta",
            Self::ToolCallProposed(_) => "tool_call_proposed",
            Self::ToolCallUpdate(_) => "tool_call_update",
            Self::ClientToolCall(_) => "client_tool_call",
            Self::Error(_) => "error",
        }
    }

    fn data_json(&self) -> Result<String, Report> {
        Ok(serde_json::to_string(self)?)
    }
}

impl From<MessageSubmitStreamingResponseChatCreated> for MessageSubmitStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseChatCreated) -> Self {
        MessageSubmitStreamingResponseMessage::ChatCreated(value)
    }
}

impl From<MessageSubmitStreamingResponseUserMessageSaved>
    for MessageSubmitStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseUserMessageSaved) -> Self {
        MessageSubmitStreamingResponseMessage::UserMessageSaved(value)
    }
}

impl From<MessageSubmitStreamingResponseMessageComplete> for MessageSubmitStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseMessageComplete) -> Self {
        MessageSubmitStreamingResponseMessage::AssistantMessageCompleted(value)
    }
}

impl From<MessageSubmitStreamingResponseAssistantMessageStarted>
    for MessageSubmitStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseAssistantMessageStarted) -> Self {
        MessageSubmitStreamingResponseMessage::AssistantMessageStarted(value)
    }
}

impl From<MessageSubmitStreamingResponseMessageTextDelta>
    for MessageSubmitStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseMessageTextDelta) -> Self {
        MessageSubmitStreamingResponseMessage::TextDelta(value)
    }
}

impl From<MessageSubmitStreamingResponseMessageReasoningDelta>
    for MessageSubmitStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseMessageReasoningDelta) -> Self {
        MessageSubmitStreamingResponseMessage::ReasoningDelta(value)
    }
}

impl From<MessageSubmitStreamingResponseToolCallProposed>
    for MessageSubmitStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseToolCallProposed) -> Self {
        MessageSubmitStreamingResponseMessage::ToolCallProposed(value)
    }
}

impl From<MessageSubmitStreamingResponseClientToolCall> for MessageSubmitStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseClientToolCall) -> Self {
        MessageSubmitStreamingResponseMessage::ClientToolCall(value)
    }
}

impl From<MessageSubmitStreamingResponseToolCallUpdate> for MessageSubmitStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseToolCallUpdate) -> Self {
        MessageSubmitStreamingResponseMessage::ToolCallUpdate(value)
    }
}

impl From<MessageSubmitStreamingResponseError> for MessageSubmitStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseError) -> Self {
        MessageSubmitStreamingResponseMessage::Error(value)
    }
}

fn parse_error_body(
    body: &Value,
    message_id: Uuid,
    status_code: Option<u16>,
) -> Option<MessageSubmitStreamingResponseError> {
    let error_obj = body.get("error")?;
    let error_code = error_obj
        .get("code")
        .and_then(|c| c.as_str())
        .or_else(|| error_obj.get("type").and_then(|t| t.as_str()))
        .or_else(|| error_obj.get("error_type").and_then(|t| t.as_str()));
    let error_message = error_obj
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or("Provider returned an error response");
    let message_is_rate_limit = error_message.to_lowercase().contains("rate limit");

    if error_code == Some("content_filter") {
        let filter_details = error_obj
            .get("innererror")
            .and_then(|ie| ie.get("content_filter_result"))
            .or_else(|| error_obj.get("content_filter_result"))
            .cloned();

        return Some(MessageSubmitStreamingResponseError {
            message_id: Some(message_id),
            error: GenerationErrorType::ContentFilter {
                error_description: error_message.to_string(),
                filter_details,
            },
        });
    }

    if error_code == Some("429") || status_code == Some(429) || message_is_rate_limit {
        return Some(MessageSubmitStreamingResponseError {
            message_id: Some(message_id),
            error: GenerationErrorType::RateLimit {
                error_description: error_message.to_string(),
            },
        });
    }

    Some(MessageSubmitStreamingResponseError {
        message_id: Some(message_id),
        error: GenerationErrorType::ProviderError {
            error_description: error_message.to_string(),
            status_code,
        },
    })
}

fn extract_embedded_json_payload(error_text: &str) -> Option<Value> {
    // Some upstream errors include JSON body as text like:
    // "... Status: 400 ... Body: {\"error\":{...}}"
    let body_index = error_text.find("Body:")?;
    let body_text = error_text.get(body_index + "Body:".len()..)?.trim();

    if let Ok(value) = serde_json::from_str::<Value>(body_text) {
        return Some(value);
    }

    let json_start = body_text.find('{')?;
    let json_candidate = body_text.get(json_start..)?.trim();
    serde_json::from_str::<Value>(json_candidate).ok()
}

/// Parse an error from the LLM streaming response and create an appropriate error type.
async fn parse_streaming_error(
    err: genai::Error,
    message_id: Uuid,
) -> MessageSubmitStreamingResponseError {
    let err_text = err.to_string();

    if let genai::Error::ChatResponse { body, .. } = &err
        && let Some(parsed) = parse_error_body(body, message_id, None)
    {
        return parsed;
    }

    if let genai::Error::WebModelCall { webc_error, .. }
    | genai::Error::WebAdapterCall { webc_error, .. } = &err
    {
        match webc_error {
            genai::webc::Error::ResponseFailedStatus { status, body, .. } => {
                if let Ok(body_json) = serde_json::from_str::<Value>(body)
                    && let Some(parsed) =
                        parse_error_body(&body_json, message_id, Some(status.as_u16()))
                {
                    return parsed;
                }
                if status.as_u16() == 429 {
                    return MessageSubmitStreamingResponseError {
                        message_id: Some(message_id),
                        error: GenerationErrorType::RateLimit {
                            error_description: body.clone(),
                        },
                    };
                }
                return MessageSubmitStreamingResponseError {
                    message_id: Some(message_id),
                    error: GenerationErrorType::ProviderError {
                        error_description: body.clone(),
                        status_code: Some(status.as_u16()),
                    },
                };
            }
            genai::webc::Error::ResponseFailedNotJson { body, .. } => {
                return MessageSubmitStreamingResponseError {
                    message_id: Some(message_id),
                    error: GenerationErrorType::ProviderError {
                        error_description: body.clone(),
                        status_code: None,
                    },
                };
            }
            _ => {}
        }
    }

    if let Some(payload_json) = extract_embedded_json_payload(&err_text)
        && let Some(parsed) = parse_error_body(&payload_json, message_id, None)
    {
        return parsed;
    }

    MessageSubmitStreamingResponseError {
        message_id: Some(message_id),
        error: GenerationErrorType::InternalError {
            error_description: format!("Unexpected generation error: {err:?}"),
        },
    }
}

/// Why a turn stopped consuming its provider stream.
///
/// A stall produces no error of its own — nothing is returned at all — so the
/// turn has to decide for itself that it has waited long enough.
enum ProviderStreamFailure {
    Provider(genai::Error),
    Idle { after: Duration },
}

impl ProviderStreamFailure {
    async fn into_error_event(self, message_id: Uuid) -> MessageSubmitStreamingResponseError {
        match self {
            ProviderStreamFailure::Provider(err) => parse_streaming_error(err, message_id).await,
            // A provider error, not an internal one: nothing on our side
            // failed. The wording says "no content" because that is what is
            // measured — see `next_provider_stream_item`.
            ProviderStreamFailure::Idle { after } => MessageSubmitStreamingResponseError {
                message_id: Some(message_id),
                error: GenerationErrorType::ProviderError {
                    error_description: format!(
                        "The model provider produced no content for {} seconds, so the \
                         generation was stopped.",
                        after.as_secs()
                    ),
                    status_code: None,
                },
            },
        }
    }
}

/// Resolves to the budget it waited out, or never when there is none.
async fn provider_idle_elapsed(budget: Option<Duration>) -> Duration {
    match budget {
        Some(budget) => {
            tokio::time::sleep(budget).await;
            budget
        }
        None => std::future::pending().await,
    }
}

/// The next item of a provider stream, or the idle failure if nothing arrives
/// for the whole budget.
///
/// Per item, not per turn: every item restarts the budget, so a long answer is
/// never cut off. `None` restores the unbounded wait.
///
/// What restarts it is an item the ADAPTER surfaced, which is not the same as
/// traffic on the socket — genai drops keep-alive pings, empty deltas and SSE
/// comments before this loop sees them. A connection held open without
/// producing content is therefore idle here, deliberately: that is exactly the
/// case a live socket cannot tell apart from a wedged one.
async fn next_provider_stream_item<S>(
    stream: &mut S,
    budget: Option<Duration>,
) -> Option<Result<ChatStreamEvent, ProviderStreamFailure>>
where
    S: futures::Stream<Item = genai::Result<ChatStreamEvent>> + Unpin,
{
    tokio::select! {
        // Biased so an item that lands in the same poll as the deadline wins
        // the tie. Unbiased, `select!` would pick at random and could report
        // a stall while holding the data that disproves it.
        biased;
        result = stream.next() => {
            result.map(|item| item.map_err(ProviderStreamFailure::Provider))
        }
        after = provider_idle_elapsed(budget) => Some(Err(ProviderStreamFailure::Idle { after })),
    }
}

#[cfg(test)]
mod provider_stream_idle_tests {
    use super::*;

    const BUDGET: Duration = Duration::from_secs(45);

    fn chunk(text: &str) -> genai::Result<ChatStreamEvent> {
        Ok(ChatStreamEvent::Chunk(StreamChunk {
            content: text.to_string(),
        }))
    }

    /// A provider that accepted the request and then went quiet without
    /// closing the connection: the stream is neither ready nor finished.
    fn stalled_stream() -> impl futures::Stream<Item = genai::Result<ChatStreamEvent>> + Unpin {
        futures::stream::pending()
    }

    #[tokio::test(start_paused = true)]
    async fn a_stalled_provider_fails_the_turn_once_the_budget_runs_out() {
        let mut stream = stalled_stream();

        let item = next_provider_stream_item(&mut stream, Some(BUDGET)).await;

        match item {
            Some(Err(ProviderStreamFailure::Idle { after })) => assert_eq!(after, BUDGET),
            other => panic!("expected an idle failure, got {:?}", other.is_some()),
        }
    }

    #[tokio::test(start_paused = true)]
    async fn the_budget_bounds_silence_rather_than_the_whole_answer() {
        // Each item arrives just inside the budget, so an answer far longer
        // than the budget still streams to its end. This is the property that
        // keeps a slow-but-healthy model from being cut off.
        let items = futures::stream::iter(vec![chunk("one"), chunk("two"), chunk("three")]);
        let mut paced = Box::pin(futures::StreamExt::then(items, |item| async move {
            tokio::time::sleep(BUDGET - Duration::from_secs(1)).await;
            item
        }));

        for expected in ["one", "two", "three"] {
            match next_provider_stream_item(&mut paced, Some(BUDGET)).await {
                Some(Ok(ChatStreamEvent::Chunk(StreamChunk { content }))) => {
                    assert_eq!(content, expected)
                }
                _ => panic!("expected the chunk {expected} to arrive within its own budget"),
            }
        }
        assert!(
            next_provider_stream_item(&mut paced, Some(BUDGET))
                .await
                .is_none(),
            "a finished stream must end the turn, not raise an idle failure"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_zero_budget_waits_on_the_provider_indefinitely() {
        let mut stream = stalled_stream();

        let waited = tokio::time::timeout(
            Duration::from_secs(60 * 60),
            next_provider_stream_item(&mut stream, None),
        )
        .await;

        assert!(
            waited.is_err(),
            "with the bound disabled the turn must keep waiting, as it did before"
        );
    }

    #[tokio::test]
    async fn an_idle_failure_is_reported_as_a_provider_error() {
        let message_id = Uuid::new_v4();

        let event = ProviderStreamFailure::Idle { after: BUDGET }
            .into_error_event(message_id)
            .await;

        assert_eq!(event.message_id, Some(message_id));
        match event.error {
            GenerationErrorType::ProviderError {
                error_description,
                status_code,
            } => {
                assert!(
                    error_description.contains("45 seconds"),
                    "{error_description}"
                );
                assert_eq!(status_code, None);
            }
            other => panic!("expected a provider error, got {other:?}"),
        }
    }
}

async fn fetch_non_streaming_error(
    app_state: &AppState,
    chat_request: ChatRequest,
    chat_options: &ChatOptions,
    message_id: Uuid,
    chat_provider_id: Option<&str>,
    chat_provider_headers_context: &ChatProviderHeadersContext<'_>,
) -> Result<Option<MessageSubmitStreamingResponseError>, Report> {
    let client = app_state
        .genai_for_chat_provider_id_with_headers_context(
            chat_provider_id,
            Some(chat_provider_headers_context),
        )
        .wrap_err("Unable to choose a chat provider for non-streaming error recovery")?;
    // This runs precisely when a stream ended without saying why — which
    // includes the upstream having gone sick. Re-asking that same upstream
    // without a bound would hand the turn straight back to the hang it was
    // recovering from, so the recovery gets the same budget the stream had.
    let attempt = client.exec_chat("PLACEHOLDER_MODEL", chat_request, Some(chat_options));
    let result = match app_state
        .config
        .generation_status
        .provider_idle_timeout_secs
    {
        0 => attempt.await,
        secs => match tokio::time::timeout(Duration::from_secs(secs), attempt).await {
            Ok(result) => result,
            Err(_) => {
                return Ok(Some(
                    ProviderStreamFailure::Idle {
                        after: Duration::from_secs(secs),
                    }
                    .into_error_event(message_id)
                    .await,
                ));
            }
        },
    };
    Ok(match result {
        Err(err) => Some(parse_streaming_error(err, message_id).await),
        Ok(_) => None,
    })
}
/// Convert a StreamingEvent to an SSE Event for message submission
fn streaming_event_to_sse(event: &StreamingEvent) -> Result<Event, Report> {
    let (event_name, data) = match event {
        StreamingEvent::ChatCreated { chat_id } => {
            let data = serde_json::to_string(&serde_json::json!({
                "message_type": "chat_created",
                "chat_id": chat_id.to_string()
            }))?;
            ("chat_created", data)
        }
        StreamingEvent::UserMessageSaved {
            message_id,
            message,
        } => {
            let data = serde_json::to_string(&serde_json::json!({
                "message_type": "user_message_saved",
                "message_id": message_id.to_string(),
                "message": message
            }))?;
            ("user_message_saved", data)
        }
        StreamingEvent::AssistantMessageStarted { message_id } => {
            let data = serde_json::to_string(&serde_json::json!({
                "message_type": "assistant_message_started",
                "message_id": message_id.to_string()
            }))?;
            ("assistant_message_started", data)
        }
        StreamingEvent::TextDelta {
            message_id,
            content_index,
            new_text,
        } => {
            let data = serde_json::to_string(&serde_json::json!({
                "message_type": "text_delta",
                "message_id": message_id.to_string(),
                "content_index": content_index,
                "new_text": new_text
            }))?;
            ("text_delta", data)
        }
        StreamingEvent::ReasoningDelta {
            message_id,
            content_index,
            new_text,
        } => {
            let data = serde_json::to_string(&serde_json::json!({
                "message_type": "reasoning_delta",
                "message_id": message_id.to_string(),
                "content_index": content_index,
                "new_text": new_text
            }))?;
            ("reasoning_delta", data)
        }
        StreamingEvent::ToolCallProposed {
            message_id,
            content_index,
            tool_call_id,
            tool_name,
            input,
        } => {
            let data = serde_json::to_string(&serde_json::json!({
                "message_type": "tool_call_proposed",
                "message_id": message_id.to_string(),
                "content_index": content_index,
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "input": input
            }))?;
            ("tool_call_proposed", data)
        }
        StreamingEvent::ToolCallUpdate {
            message_id,
            content_index,
            tool_call_id,
            tool_name,
            input,
            status,
            progress_message,
            progress,
            total,
            output,
        } => {
            let status = match status {
                BgToolCallStatus::Preparing => ToolCallStatus::Preparing,
                BgToolCallStatus::InProgress => ToolCallStatus::InProgress,
                BgToolCallStatus::Success => ToolCallStatus::Success,
                BgToolCallStatus::Error => ToolCallStatus::Error,
            };
            let data = MessageSubmitStreamingResponseMessage::ToolCallUpdate(
                MessageSubmitStreamingResponseToolCallUpdate {
                    message_id: *message_id,
                    content_index: *content_index,
                    tool_call_id: tool_call_id.clone(),
                    tool_name: tool_name.clone(),
                    input: input.clone(),
                    status,
                    progress_message: progress_message.clone(),
                    progress: *progress,
                    total: *total,
                    output: output.clone(),
                },
            )
            .data_json()?;
            ("tool_call_update", data)
        }
        StreamingEvent::ClientToolCall {
            message_id,
            content_index,
            tool_call_id,
            tool_name,
            input,
        } => {
            let data = serde_json::to_string(&serde_json::json!({
                "message_type": "client_tool_call",
                "message_id": message_id.to_string(),
                "content_index": content_index,
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "input": input
            }))?;
            ("client_tool_call", data)
        }
        StreamingEvent::AssistantMessageCompleted {
            message_id,
            content,
            message,
        } => {
            let data = serde_json::to_string(&serde_json::json!({
                "message_type": "assistant_message_completed",
                "message_id": message_id.to_string(),
                "content": content,
                "message": message
            }))?;
            ("assistant_message_completed", data)
        }
        StreamingEvent::Error { error } => {
            let data_value = match error {
                Some(error_value) => match error_value {
                    JsonValue::Object(map) => {
                        let mut map = map.clone();
                        map.entry("message_type".to_string())
                            .or_insert(JsonValue::String("error".to_string()));
                        JsonValue::Object(map)
                    }
                    _ => json!({
                        "message_type": "error",
                        "error": error_value
                    }),
                },
                None => json!({
                    "message_type": "error"
                }),
            };
            let data = serde_json::to_string(&data_value)?;
            ("error", data)
        }
        StreamingEvent::StreamEnd => {
            let data = serde_json::to_string(&serde_json::json!({
                "message_type": "stream_end"
            }))?;
            ("stream_end", data)
        }
    };

    Ok(Event::default().event(event_name).data(data))
}

type SseEventStream = Pin<Box<dyn Stream<Item = Result<Event, Report>> + Send>>;
type SseEventStreamWithKeepAlive = axum::response::sse::KeepAliveStream<SseEventStream>;

fn streaming_events_to_sse<S>(events: S) -> SseEventStream
where
    S: Stream<Item = Result<StreamingEvent, Report>> + Send + 'static,
{
    Box::pin(futures::StreamExt::filter_map(events, |result| {
        futures::future::ready(match result {
            Ok(streaming_event) => match streaming_event_to_sse(&streaming_event) {
                Ok(sse_event) => Some(Ok(sse_event)),
                Err(error) => Some(Err(error)),
            },
            Err(error) => Some(Err(error)),
        })
    }))
}

struct SharedResumeState {
    manager: BackgroundTaskManager,
    generation_id: Uuid,
    last_event_id: i64,
    pending: VecDeque<StreamingEvent>,
    finished: bool,
}

fn shared_generation_event_stream(
    manager: BackgroundTaskManager,
    generation_id: Uuid,
) -> impl Stream<Item = Result<StreamingEvent, Report>> + Send {
    futures::stream::unfold(
        SharedResumeState {
            manager,
            generation_id,
            last_event_id: 0,
            pending: VecDeque::new(),
            finished: false,
        },
        |mut state| async move {
            loop {
                if let Some(event) = state.pending.pop_front() {
                    return Some((Ok(event), state));
                }
                if state.finished {
                    return None;
                }

                match state
                    .manager
                    .get_shared_events(state.generation_id, state.last_event_id)
                    .await
                {
                    Ok(events) if !events.is_empty() => {
                        for (event_id, event) in events {
                            state.last_event_id = state.last_event_id.max(event_id);
                            if matches!(event, StreamingEvent::StreamEnd) {
                                state.finished = true;
                            }
                            state.pending.push_back(event);
                        }
                    }
                    Ok(_) => {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                    Err(error) => {
                        state.finished = true;
                        return Some((Err(eyre!(error)), state));
                    }
                }
            }
        },
    )
}

#[derive(serde::Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct RegenerateMessageRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of the message that should have a replacement response generated.
    current_message_id: Uuid,
    #[schema(example = "primary")]
    /// The ID of the chat provider to use for generation. If not provided, will use the highest priority model for the user.
    #[schema(nullable = false)]
    chat_provider_id: Option<String>,
    /// IDs of facets selected by the user for this generation.
    #[serde(default)]
    selected_facet_ids: Vec<String>,
    /// Optional action facet to apply during this generation.
    action_facet: Option<ActionFacetRequest>,
    /// Assistants the user @-mentioned in this message as delegation targets.
    /// Validated server-side; requires `delegation.assistants.enabled`.
    #[serde(default)]
    #[schema(nullable = false)]
    mentioned_assistant_ids: Option<Vec<Uuid>>,
    /// How delegated runs spawned by this message are awaited. Defaults to
    /// `wait`; `background` requires `delegation.allow_background`
    /// and is downgraded to `wait` server-side when the gate is off.
    #[serde(default)]
    #[schema(nullable = false)]
    delegation_run_mode: Option<DelegationRunMode>,
}

#[derive(Serialize, ToSchema)]
#[serde(tag = "message_type")]
#[allow(clippy::large_enum_variant)]
pub enum RegenerateMessageStreamingResponseMessage {
    #[serde(rename = "assistant_message_started")]
    /// Sent when the assistant message entry has been created, before generation starts.
    AssistantMessageStarted(MessageSubmitStreamingResponseAssistantMessageStarted),
    #[serde(rename = "assistant_message_completed")]
    /// Sent when the assistant's response has been saved in full.
    AssistantMessageCompleted(MessageSubmitStreamingResponseMessageComplete),
    #[serde(rename = "text_delta")]
    /// Sent whenever a new text chunk is generated by the assistant.
    TextDelta(MessageSubmitStreamingResponseMessageTextDelta),
    #[serde(rename = "reasoning_delta")]
    /// Sent whenever a new reasoning chunk is generated by the assistant.
    ReasoningDelta(MessageSubmitStreamingResponseMessageReasoningDelta),
    #[serde(rename = "tool_call_proposed")]
    /// Sent when the LLM proposes a tool call to be part of the assistant message.
    ToolCallProposed(MessageSubmitStreamingResponseToolCallProposed),
    #[serde(rename = "tool_call_update")]
    /// Sent to update the status of a tool call execution by the backend.
    ToolCallUpdate(MessageSubmitStreamingResponseToolCallUpdate),
    #[serde(rename = "client_tool_call")]
    /// Sent when the model calls a facet client tool: the turn is suspended
    /// until the client executes it and POSTs the result back.
    ClientToolCall(MessageSubmitStreamingResponseClientToolCall),
    #[serde(rename = "error")]
    /// Sent when an error occurs during message generation.
    Error(MessageSubmitStreamingResponseError),
}

impl SendAsSseEvent for RegenerateMessageStreamingResponseMessage {
    fn tag(&self) -> &'static str {
        match self {
            Self::AssistantMessageStarted(_) => "assistant_message_started",
            Self::AssistantMessageCompleted(_) => "assistant_message_completed",
            Self::TextDelta(_) => "text_delta",
            Self::ReasoningDelta(_) => "reasoning_delta",
            Self::ToolCallProposed(_) => "tool_call_proposed",
            Self::ToolCallUpdate(_) => "tool_call_update",
            Self::ClientToolCall(_) => "client_tool_call",
            Self::Error(_) => "error",
        }
    }

    fn data_json(&self) -> Result<String, Report> {
        Ok(serde_json::to_string(self)?)
    }
}

impl From<MessageSubmitStreamingResponseAssistantMessageStarted>
    for RegenerateMessageStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseAssistantMessageStarted) -> Self {
        RegenerateMessageStreamingResponseMessage::AssistantMessageStarted(value)
    }
}

impl From<MessageSubmitStreamingResponseMessageComplete>
    for RegenerateMessageStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseMessageComplete) -> Self {
        RegenerateMessageStreamingResponseMessage::AssistantMessageCompleted(value)
    }
}

impl From<MessageSubmitStreamingResponseMessageTextDelta>
    for RegenerateMessageStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseMessageTextDelta) -> Self {
        RegenerateMessageStreamingResponseMessage::TextDelta(value)
    }
}

impl From<MessageSubmitStreamingResponseMessageReasoningDelta>
    for RegenerateMessageStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseMessageReasoningDelta) -> Self {
        RegenerateMessageStreamingResponseMessage::ReasoningDelta(value)
    }
}

impl From<MessageSubmitStreamingResponseToolCallProposed>
    for RegenerateMessageStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseToolCallProposed) -> Self {
        RegenerateMessageStreamingResponseMessage::ToolCallProposed(value)
    }
}

impl From<MessageSubmitStreamingResponseClientToolCall>
    for RegenerateMessageStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseClientToolCall) -> Self {
        RegenerateMessageStreamingResponseMessage::ClientToolCall(value)
    }
}

impl From<MessageSubmitStreamingResponseToolCallUpdate>
    for RegenerateMessageStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseToolCallUpdate) -> Self {
        RegenerateMessageStreamingResponseMessage::ToolCallUpdate(value)
    }
}

impl From<MessageSubmitStreamingResponseError> for RegenerateMessageStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseError) -> Self {
        RegenerateMessageStreamingResponseMessage::Error(value)
    }
}

#[derive(serde::Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct EditMessageRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of the message that should be edited with a new response. It will be considered a sibling message to the new message.
    message_id: Uuid,
    #[schema(example = "Hello, world!")]
    /// The text of the message that should replace the user message.
    replace_user_message: String,
    #[schema(example = "[\"00000000-0000-0000-0000-000000000000\"]")]
    /// The IDs of any files that should replace the input files. These files must already be uploaded to the file_uploads table.
    #[serde(default)]
    replace_input_files_ids: Vec<Uuid>,
    #[schema(example = "primary")]
    /// The ID of the chat provider to use for generation. If not provided, will use the highest priority model for the user.
    #[schema(nullable = false)]
    chat_provider_id: Option<String>,
    /// IDs of facets selected by the user for this generation.
    #[serde(default)]
    selected_facet_ids: Vec<String>,
    /// Optional action facet to apply during this generation.
    action_facet: Option<ActionFacetRequest>,
    /// Assistants the user @-mentioned in this message as delegation targets.
    /// Validated server-side; requires `delegation.assistants.enabled`.
    #[serde(default)]
    #[schema(nullable = false)]
    mentioned_assistant_ids: Option<Vec<Uuid>>,
    /// How delegated runs spawned by this message are awaited. Defaults to
    /// `wait`; `background` requires `delegation.allow_background`
    /// and is downgraded to `wait` server-side when the gate is off.
    #[serde(default)]
    #[schema(nullable = false)]
    delegation_run_mode: Option<DelegationRunMode>,
}

#[derive(serde::Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ResumeStreamRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of the chat to resume streaming for.
    chat_id: Uuid,
}

/// Decision submitted for a generation stopped at an MCP approval gate.
///
/// `RejectAlways` needs no policy flag the way `ApproveAlways` needs
/// `allow_always`: a denial is more restrictive than anything the policy does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolApprovalDecision {
    Approve,
    Reject,
    ApproveAlways,
    RejectAlways,
    /// Take the question back: every open approval is rejected with
    /// `reason: withdrawn` and the turn continues with those denials. A
    /// decision value rather than an endpoint, so it travels the same
    /// validation and lease path as a real answer.
    Withdraw,
}

impl ToolApprovalDecision {
    /// Whether the decision lets the gated call run.
    fn is_approval(self) -> bool {
        matches!(
            self,
            ToolApprovalDecision::Approve | ToolApprovalDecision::ApproveAlways
        )
    }
}

/// One decision of a continuation, naming the approval it answers.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ApprovalDecisionItem {
    #[schema(example = "call_abc123")]
    pub approval_id: String,
    pub decision: ToolApprovalDecision,
}

/// Rehydrates a generation that was deliberately stopped for tool approval.
///
/// A stop can cover several decisions, so the body names each one. The legacy
/// shape `{ message_id, decision }` carries no `approval_id` and is therefore
/// accepted only while exactly one approval is open — otherwise it would have
/// to guess which call the user answered.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ContinueStreamRequest {
    /// The assistant message/generation that contains the pending approval request.
    message_id: Uuid,
    #[serde(default)]
    decisions: Vec<ApprovalDecisionItem>,
    #[serde(default)]
    decision: Option<ToolApprovalDecision>,
}

#[derive(serde::Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct AbortStreamRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of the chat whose active generation should be stopped.
    chat_id: Uuid,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct AbortStreamResponse {
    abort_requested: bool,
}

/// Body of the `409` a streaming route answers when the chat's generation
/// lease is already held.
///
/// `code` is what the client discriminates on: the same status is also used
/// for archived chats and for live delegated runs, which stay plain text.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct GenerationRunningError {
    /// Always `generation_running`.
    pub code: String,
    /// The chat whose lease is held.
    pub chat_id: Uuid,
    /// Who started the generation holding the lease. Always `user` until
    /// system-initiated deliveries persist their own marker.
    pub initiator: String,
    /// When the holding generation started, RFC 3339, when the row records it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
}

/// What a client asks `/react` to answer.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ReactToTaskResultRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The delivered `task_result` user row to react to.
    task_result_message_id: Uuid,
}

/// Body of the `409` `/react` answers when there is nothing to react to.
///
/// Distinct from [`GenerationRunningError`] because the two are different
/// decisions: that one says "not now", this one says "not this row, ever".
/// `code` is what the client discriminates on; `reason` is what it uses to
/// choose between suppressing the affordance and offering a re-anchor.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct NothingToReactError {
    /// Always `nothing_to_react`.
    pub code: String,
    pub chat_id: Uuid,
    pub task_result_message_id: Uuid,
    /// One of `not_a_task_result`, `not_delivered`, `already_reacted`,
    /// `tip_moved`.
    pub reason: String,
}

/// Body of the `400` answers when the submitted decisions do not match the
/// approvals a parked turn has open.
///
/// Two lists rather than one message, because the client's recovery differs:
/// `missing` means it has to ask the user the remaining questions, `unknown`
/// means the card it rendered is stale and the row needs refetching.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ApprovalDecisionsError {
    /// Always `decisions_mismatch`.
    pub code: String,
    /// Open approvals that no submitted decision covers.
    pub missing: Vec<String>,
    /// Submitted approval ids this turn does not have open.
    pub unknown: Vec<String>,
}

pub(crate) const DECISIONS_MISMATCH_CODE: &str = "decisions_mismatch";

/// Body of the `409` `continuestream` answers when the named row has nothing
/// left to decide: a duplicate resume, not a decision the server refused.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct AlreadyContinuedError {
    /// Always `already_continued`.
    pub code: String,
}

pub(crate) const ALREADY_CONTINUED_CODE: &str = "already_continued";

/// Body of the `409` `continuestream` answers on a delegated child whose
/// request is currently being asked about in the chat that started it.
///
/// `parent_message_id` is where the question actually is: the client follows it
/// rather than telling the user their own chat is broken.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct CoveredByParentError {
    /// Always `covered_by_parent`.
    pub code: String,
    /// The origin row whose approval part carries this child's request.
    pub parent_message_id: Uuid,
}

pub(crate) const COVERED_BY_PARENT_CODE: &str = "covered_by_parent";

/// `ContentPartToolRejection.reason` for a call the user took back rather than
/// answered. The only value the field has.
pub(crate) const REJECTION_REASON_WITHDRAWN: &str = "withdrawn";

/// The row a client named is not a delivered task result at all.
pub(crate) const REACT_REASON_NOT_A_TASK_RESULT: &str = "not_a_task_result";
/// It is one, but its delivery never reached `delivered` — or reached it under
/// a different row than the one named.
pub(crate) const REACT_REASON_NOT_DELIVERED: &str = "not_delivered";
/// A turn has already answered it. The client suppresses the affordance.
pub(crate) const REACT_REASON_ALREADY_REACTED: &str = "already_reacted";
/// The conversation moved on past the row. The client offers a re-anchor.
pub(crate) const REACT_REASON_TIP_MOVED: &str = "tip_moved";

/// Error type of the streaming routes.
///
/// Exists so one route can answer a machine-readable body without changing
/// what every other error on that route looks like: `PlainText` reproduces
/// the historical `(StatusCode, String)` response byte for byte, and the
/// `From` impl means existing `?` sites keep compiling untouched.
#[derive(Debug)]
pub enum StreamRouteError {
    PlainText(axum::http::StatusCode, String),
    GenerationRunning(Box<GenerationRunningError>),
    /// `/react` only: the named row cannot be reacted to, and never will be.
    NothingToReact(Box<NothingToReactError>),
    /// `continuestream` only: the decisions do not cover the open approvals.
    DecisionsMismatch(Box<ApprovalDecisionsError>),
    /// `continuestream` only: every approval this row opened is already decided.
    AlreadyContinued(Box<AlreadyContinuedError>),
    /// `continuestream` only: the chat that dispatched this child is asking the
    /// same question, and its card is the one that can act on the answer.
    CoveredByParent(Box<CoveredByParentError>),
}

impl From<(axum::http::StatusCode, String)> for StreamRouteError {
    fn from((status, message): (axum::http::StatusCode, String)) -> Self {
        StreamRouteError::PlainText(status, message)
    }
}

impl axum::response::IntoResponse for StreamRouteError {
    fn into_response(self) -> axum::response::Response {
        match self {
            StreamRouteError::PlainText(status, message) => (status, message).into_response(),
            StreamRouteError::GenerationRunning(body) => {
                (axum::http::StatusCode::CONFLICT, Json(*body)).into_response()
            }
            // The same status as `GenerationRunning`, deliberately: both are
            // "the chat will not take this write". The client tells them apart
            // on `code`, which is why neither is plain text.
            StreamRouteError::NothingToReact(body) => {
                (axum::http::StatusCode::CONFLICT, Json(*body)).into_response()
            }
            // A bad request rather than a conflict: the row is answerable, the
            // body just does not answer it.
            StreamRouteError::DecisionsMismatch(body) => {
                (axum::http::StatusCode::BAD_REQUEST, Json(*body)).into_response()
            }
            // Nothing about this request is malformed — the row just has nothing
            // left to decide.
            StreamRouteError::AlreadyContinued(body) => {
                (axum::http::StatusCode::CONFLICT, Json(*body)).into_response()
            }
            // The row is answerable in principle, just not here and not yet — the
            // question is open somewhere else.
            StreamRouteError::CoveredByParent(body) => {
                (axum::http::StatusCode::CONFLICT, Json(*body)).into_response()
            }
        }
    }
}

/// Take the chat's generation lease for a user-initiated write.
///
/// Behind `delegation.tasks.enabled` this is a compare-and-set that refuses
/// rather than displacing a live generation, because once a task result can
/// arrive on its own the chat has two possible writers and "last start wins"
/// silently drops one of them. With the gate off it is the historical
/// replace-on-start, unchanged.
async fn acquire_user_generation_lease(
    app_state: &AppState,
    chat_id: Uuid,
    message_id: Uuid,
) -> Result<
    (
        tokio::sync::broadcast::Receiver<StreamingEvent>,
        Arc<StreamingTask>,
    ),
    StreamRouteError,
> {
    if !app_state.config.delegation.tasks.enabled {
        return Ok(app_state
            .background_tasks
            .start_task(chat_id, message_id)
            .await);
    }

    app_state
        .background_tasks
        .try_start_task(
            chat_id,
            message_id,
            // A person is asking for this turn: abandoning an approval card
            // they have stopped answering is their call to make.
            Takeover::TakeParked,
            app_state.config.generation_status.stale_after_secs,
        )
        .await
        .map_err(|held| {
            StreamRouteError::GenerationRunning(Box::new(GenerationRunningError {
                code: "generation_running".to_string(),
                chat_id,
                // Always "user" today, even when a delivery holds the lease:
                // the chats row records no initiator, so this handler cannot
                // tell the two apart. Reporting it honestly needs a column of
                // its own on the shared-generation row; tracked as a follow-up
                // rather than smuggled into the delivery change.
                initiator: "user".to_string(),
                started_at: held.started_at,
            }))
        })
}

/// Take the chat's generation lease for a turn a delivered task result
/// triggered.
///
/// `RefuseParked`, unlike the user-initiated sibling above: a person parked on
/// an approval card is mid-decision, and a reaction turn — whose content the
/// server wrote — is not a good enough reason to move them off it.
/// `deliver_task_result` refuses a parked chat for the same reason, and the two
/// stay separate helpers rather than one with a `takeover` argument so the
/// decision reads at the call site instead of at a bool six submits share.
///
/// There is no `!delegation.tasks.enabled` fallback branch, because `/react`'s
/// first precondition 404s with the gate off: this is always the real
/// compare-and-set.
async fn acquire_task_result_generation_lease(
    app_state: &AppState,
    chat_id: Uuid,
    message_id: Uuid,
) -> Result<
    (
        tokio::sync::broadcast::Receiver<StreamingEvent>,
        Arc<StreamingTask>,
    ),
    StreamRouteError,
> {
    app_state
        .background_tasks
        .try_start_task(
            chat_id,
            message_id,
            Takeover::RefuseParked,
            app_state.config.generation_status.stale_after_secs,
        )
        .await
        .map_err(|held| {
            StreamRouteError::GenerationRunning(Box::new(GenerationRunningError {
                code: "generation_running".to_string(),
                chat_id,
                // The same honest-but-incomplete string the user helper
                // reports: the chats row records no initiator, so this handler
                // cannot tell a delivery's lease from a person's. Fixing that
                // needs a column on the shared-generation row and belongs to
                // the delivery change, not here.
                initiator: "user".to_string(),
                // Already RFC 3339 on `LeaseHeld`; re-formatting it here would
                // be a second opinion about the wire shape.
                started_at: held.started_at,
            }))
        })
}

/// Deserialize a present field (including an explicit JSON `null`) as `Some`.
/// Plain `Option<JsonValue>` + `#[serde(default)]` maps BOTH an absent field and
/// an explicit `null` to `None`; this preserves the difference, so a legitimate
/// `null` client-tool result is treated as a result, not a missing one. (serde
/// skips a `deserialize_with` for an absent field when `default` is also set.)
fn deserialize_present_json<'de, D>(deserializer: D) -> Result<Option<JsonValue>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    JsonValue::deserialize(deserializer).map(Some)
}

#[derive(serde::Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ClientToolResultRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The chat whose suspended generation is awaiting this result.
    chat_id: Uuid,
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The id of the assistant message whose generation emitted the client
    /// tool call. Disambiguates a result from a task that has since been
    /// replaced by a concurrent generation on the same chat.
    message_id: Uuid,
    /// The `tool_call_id` from the `client_tool_call` event being answered.
    tool_call_id: String,
    /// The tool's JSON result (any JSON value, including `null`). Provide this
    /// OR `error`. An absent field is treated as "no result"; an explicit
    /// `null` is a valid result.
    #[serde(default, deserialize_with = "deserialize_present_json")]
    #[schema(nullable = false)]
    result: Option<JsonValue>,
    /// Uploaded files to attach to the assistant message with rich previews and
    /// read with the normal file processor for this tool result. Each file is
    /// authorized before reading or attaching. Duplicate IDs are ignored; at
    /// most min(frontend.max_files, 20) unique files are considered.
    #[serde(default)]
    file_upload_ids: Vec<Uuid>,
    /// An error message if the client could not execute the tool. Provide this
    /// OR `result`.
    #[serde(default)]
    #[schema(nullable = false)]
    error: Option<String>,
    /// Parser diagnostics for a rejected submission. Nonempty diagnostics are
    /// a failure even if a result is also supplied. Messages should be concise;
    /// the backend retains at most 16 issues with bounded field lengths.
    #[serde(default)]
    validation_errors: Vec<crate::services::client_tools::ClientToolValidationIssue>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ClientToolResultResponse {
    /// True if a suspended generation received this result; false if it was a
    /// benign no-op (already delivered, timed out, aborted, or unknown id).
    delivered: bool,
}

#[derive(Serialize, ToSchema)]
#[serde(tag = "message_type")]
pub enum EditMessageStreamingResponseMessage {
    #[serde(rename = "assistant_message_started")]
    /// Sent when the assistant message entry has been created, before generation starts.
    AssistantMessageStarted(MessageSubmitStreamingResponseAssistantMessageStarted),
    #[serde(rename = "assistant_message_completed")]
    /// Sent when the assistant's response has been saved in full.
    AssistantMessageCompleted(MessageSubmitStreamingResponseMessageComplete),
    #[serde(rename = "text_delta")]
    /// Sent whenever a new text chunk is generated by the assistant.
    TextDelta(MessageSubmitStreamingResponseMessageTextDelta),
    #[serde(rename = "reasoning_delta")]
    /// Sent whenever a new reasoning chunk is generated by the assistant.
    ReasoningDelta(MessageSubmitStreamingResponseMessageReasoningDelta),
    #[serde(rename = "tool_call_proposed")]
    /// Sent when the LLM proposes a tool call to be part of the assistant message.
    ToolCallProposed(MessageSubmitStreamingResponseToolCallProposed),
    #[serde(rename = "tool_call_update")]
    /// Sent to update the status of a tool call execution by the backend.
    ToolCallUpdate(MessageSubmitStreamingResponseToolCallUpdate),
    #[serde(rename = "client_tool_call")]
    /// Sent when the model calls a facet client tool: the turn is suspended
    /// until the client executes it and POSTs the result back.
    ClientToolCall(MessageSubmitStreamingResponseClientToolCall),
    #[serde(rename = "error")]
    /// Sent when an error occurs during message generation.
    Error(MessageSubmitStreamingResponseError),
    #[serde(rename = "user_message_saved")]
    /// Sent when the edited user message has been saved.
    UserMessageSaved(MessageSubmitStreamingResponseUserMessageSaved),
}

impl SendAsSseEvent for EditMessageStreamingResponseMessage {
    fn tag(&self) -> &'static str {
        match self {
            Self::AssistantMessageStarted(_) => "assistant_message_started",
            Self::AssistantMessageCompleted(_) => "assistant_message_completed",
            Self::TextDelta(_) => "text_delta",
            Self::ReasoningDelta(_) => "reasoning_delta",
            Self::ToolCallProposed(_) => "tool_call_proposed",
            Self::ToolCallUpdate(_) => "tool_call_update",
            Self::ClientToolCall(_) => "client_tool_call",
            Self::Error(_) => "error",
            Self::UserMessageSaved(_) => "user_message_saved",
        }
    }

    fn data_json(&self) -> Result<String, Report> {
        Ok(serde_json::to_string(self)?)
    }
}

impl From<MessageSubmitStreamingResponseAssistantMessageStarted>
    for EditMessageStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseAssistantMessageStarted) -> Self {
        EditMessageStreamingResponseMessage::AssistantMessageStarted(value)
    }
}

impl From<MessageSubmitStreamingResponseMessageComplete> for EditMessageStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseMessageComplete) -> Self {
        EditMessageStreamingResponseMessage::AssistantMessageCompleted(value)
    }
}

impl From<MessageSubmitStreamingResponseUserMessageSaved> for EditMessageStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseUserMessageSaved) -> Self {
        EditMessageStreamingResponseMessage::UserMessageSaved(value)
    }
}

impl From<MessageSubmitStreamingResponseMessageTextDelta> for EditMessageStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseMessageTextDelta) -> Self {
        EditMessageStreamingResponseMessage::TextDelta(value)
    }
}

impl From<MessageSubmitStreamingResponseMessageReasoningDelta>
    for EditMessageStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseMessageReasoningDelta) -> Self {
        EditMessageStreamingResponseMessage::ReasoningDelta(value)
    }
}

impl From<MessageSubmitStreamingResponseToolCallProposed> for EditMessageStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseToolCallProposed) -> Self {
        EditMessageStreamingResponseMessage::ToolCallProposed(value)
    }
}

impl From<MessageSubmitStreamingResponseClientToolCall> for EditMessageStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseClientToolCall) -> Self {
        EditMessageStreamingResponseMessage::ClientToolCall(value)
    }
}

impl From<MessageSubmitStreamingResponseToolCallUpdate> for EditMessageStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseToolCallUpdate) -> Self {
        EditMessageStreamingResponseMessage::ToolCallUpdate(value)
    }
}

impl From<MessageSubmitStreamingResponseError> for EditMessageStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseError) -> Self {
        EditMessageStreamingResponseMessage::Error(value)
    }
}

#[allow(clippy::too_many_arguments)]
async fn bg_stream_save_user_message(
    task: &Arc<StreamingTask>,
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    chat: &chats::Model,
    previous_message_id: Option<&Uuid>,
    user_message: &str,
    input_files_ids: &[Uuid],
    input_parameters: Option<crate::models::message::InputParameters>,
) -> Result<messages::Model, Report> {
    bg_stream_save_user_row(
        task,
        app_state,
        policy,
        me_user,
        chat,
        previous_message_id,
        vec![json!({
            "content_type": "text",
            "text": user_message.to_owned()})],
        input_files_ids,
        input_parameters,
    )
    .await
}

/// Persist one user-role row and announce it on the chat's stream.
///
/// Split out of [`bg_stream_save_user_message`] because a delivered task result
/// is a user row whose content is not text: it takes the same lineage,
/// authorization and `UserMessageSaved` event, and only the parts differ.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn bg_stream_save_user_row(
    task: &Arc<StreamingTask>,
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    chat: &chats::Model,
    previous_message_id: Option<&Uuid>,
    content_parts: Vec<JsonValue>,
    input_files_ids: &[Uuid],
    input_parameters: Option<crate::models::message::InputParameters>,
) -> Result<messages::Model, Report> {
    let user_message_json = json!({
        "role": "user",
        "content": content_parts,
        "name": me_user.id
    });

    let saved_user_message = submit_message(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &chat.id,
        user_message_json,
        previous_message_id,
        None,
        None,
        input_files_ids,
        None,
        None,
        input_parameters,
    )
    .await
    .wrap_err("Failed to submit user message")?;

    bg_stream_announce_user_row(task, app_state, &saved_user_message).await?;

    Ok(saved_user_message)
}

/// Announce a user row that is already committed.
///
/// Split from the save so a caller that wrote the row inside its own
/// transaction — the task-result delivery, which must append and record the
/// append atomically — still emits the identical event, and only after its
/// transaction has actually committed.
pub(crate) async fn bg_stream_announce_user_row(
    task: &Arc<StreamingTask>,
    app_state: &AppState,
    saved_user_message: &messages::Model,
) -> Result<(), Report> {
    // Resolved here so the live event carries the same display pairs the read
    // API serves — the just-sent message highlights without a refetch.
    let saved_user_message_wrapped = ChatMessage::from_model(saved_user_message.clone())
        .wrap_err("Failed to convert user message")?
        .with_mentioned_assistants(&app_state.db, saved_user_message)
        .await;

    task.send_event(StreamingEvent::UserMessageSaved {
        message_id: saved_user_message.id,
        message: saved_user_message_wrapped,
    })
    .await
    .map_err(Report::msg)?;

    Ok(())
}

fn ensure_saved_assistant_content_for_abort(mut content: Vec<ContentPart>) -> Vec<ContentPart> {
    if content.is_empty() {
        content.push(ContentPart::Text(ContentPartText {
            text: String::new(),
        }));
    }

    content
}

pub struct PreparedChatRequest {
    // Our internal abstract structure of the message chain
    generation_input_messages: GenerationInputMessages,
    // Our internal abstract representation of generation parameters
    generation_parameters: GenerationParameters,
    // Request-scoped context used for persistence and tracing
    generation_request_context: GenerationRequestContext,
    // MCP servers that were unavailable while listing tools for this request.
    mcp_servers_unavailable: Vec<String>,
    // MCP servers skipped while listing tools because the requesting user has
    // not completed their OAuth authorization (user-fixable, unlike the above).
    mcp_servers_needing_auth: Vec<String>,
    // MCP servers in scope for this request whose tools were withheld because
    // the user switched them off for the chat.
    mcp_servers_disabled_by_user: Vec<String>,
    // `server/tool` names of MCP tools withheld because the user switched the
    // tool off for the chat.
    mcp_tools_disabled_by_user: Vec<String>,
    // Filtered MCP tools available to this request, including server routing info.
    available_mcp_tools: Vec<crate::services::mcp_session_manager::ManagedTool>,
    // Runtime policies of the client tools OFFERED to this request, keyed by the
    // model-facing name (unique post-dedup). The dispatch/park site resolves
    // timeouts from here instead of re-finding config entries by bare name,
    // which is ambiguous when namespaces reuse a name.
    offered_client_tools: HashMap<String, crate::services::client_tools::OfferedClientTool>,
    // Prepared `genai` `ChatRequest` (messages + available tools)
    chat_request: ChatRequest,
    // Prepared `genai` `ChatOptions` (e.g. reasoning effort)
    chat_options: ChatOptions,
    // Validated delegation targets whose ids the `delegate_to_assistant`
    // dispatch accepts for this request.
    delegation_targets: Vec<crate::services::delegation::DelegationTarget>,
    // Parent-chat file ids enumerated in the delegation tool offer; the
    // dispatch validates requested `file_ids` against this set.
    delegation_offered_file_ids: Vec<Uuid>,
    // What the task route may offer and spend this turn, or `None` when
    // `delegate_task` was not offered. Resolved at offer time so the schema
    // the model saw and the list its arguments are checked against are one
    // and the same.
    task_offer_scope: Option<crate::services::delegation::TaskOfferScope>,
}

impl PreparedChatRequest {
    pub(crate) fn chat_request(&self) -> &ChatRequest {
        &self.chat_request
    }
}

/// The frame a failed generation broadcasts to every listener — the original
/// stream AND any resume — so the client resolves instead of waiting for a
/// completion that will never arrive. The detailed error is captured
/// server-side; the client gets only a generic message.
fn generation_failure_error_value() -> Option<JsonValue> {
    let error_event = MessageSubmitStreamingResponseError {
        message_id: None,
        error: GenerationErrorType::InternalError {
            error_description: "The message could not be generated.".to_string(),
        },
    };
    serde_json::to_value(MessageSubmitStreamingResponseMessage::Error(error_event)).ok()
}

/// The delivery work every generation tail on a user-writable chat owes: this
/// chat may be a parked `async` child whose answer an origin is still waiting
/// for, and it may itself be an origin with results owed to it.
///
/// One function rather than four copies because the outward half is the easy
/// one to forget: the decision that finishes a parked child runs on the CHILD
/// chat, so a tail that drained only its own chat is a result nobody ever hears
/// about.
///
/// Called after `remove_task`, wherever the tail owns that: a delivery takes the
/// chat's lease for itself and `RefuseParked` would refuse a lease this turn
/// still held.
async fn settle_tail_deliveries(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    chat_id: Uuid,
    task: &Arc<StreamingTask>,
    outcome: TaskOutcome,
) {
    if let Some(origin_chat_id) =
        crate::services::task_delivery::rearm_delivery_after_child_decision(
            app_state,
            chat_id,
            task.message_id(),
            outcome,
            task.tool_budget_exhausted(),
        )
        .await
    {
        crate::services::task_delivery::drain_pending_deliveries(
            app_state,
            policy,
            me_user,
            origin_chat_id,
        )
        .await;
    }
    crate::services::task_delivery::drain_pending_deliveries(app_state, policy, me_user, chat_id)
        .await;
}

/// Runs a generation inside the lifecycle a user submit and a delegated child
/// share: a cleanup guard around the run, the failure frame, the closing stream
/// end, and the terminal outcome on the chat's generation lease. The edit,
/// regenerate and continue paths run their own tail instead — each owns its
/// request's response channel and forwards a failure over that, so neither the
/// broadcast failure frame nor a stream end applies to them.
///
/// A failure is captured even where the caller absorbs it: delegation turns a
/// failed child into a `failed` envelope the parent recovers from in prose, and
/// that recovery does not make the run any less broken.
pub(crate) async fn with_generation_task_lifecycle<F>(
    background_tasks: &BackgroundTaskManager,
    task: &Arc<StreamingTask>,
    chat_id: Uuid,
    run: F,
) -> Result<(), Report>
where
    F: std::future::Future<Output = Result<(), Report>>,
{
    let mut cleanup_guard =
        TaskCleanupGuard::new(background_tasks.clone(), chat_id, task.generation_id);

    let result = crate::latency::stage("generation.run", run).await;

    match &result {
        Ok(()) => tracing::info!(%chat_id, "Generation task completed"),
        Err(error) => {
            tracing::error!(%chat_id, error = ?error, "Generation task failed");
            capture_report(error);
            send_background_event(
                task,
                StreamingEvent::Error {
                    error: generation_failure_error_value(),
                },
                "broadcast generation failure",
            )
            .await;
        }
    }

    send_background_event(task, StreamingEvent::StreamEnd, "broadcast stream end").await;
    let outcome = task.derive_outcome(result.is_err());
    task.mark_completed();
    cleanup_guard.disarm();
    background_tasks
        .remove_task(&chat_id, task.generation_id, outcome)
        .await;

    result
}

#[cfg(test)]
mod generation_task_lifecycle_tests {
    use super::*;
    use crate::config::GenerationStatusConfig;

    async fn events_of_run(
        run: Result<(), Report>,
    ) -> (Vec<StreamingEvent>, BackgroundTaskManager, Uuid) {
        let background_tasks =
            BackgroundTaskManager::new(None, GenerationStatusConfig::default(), None);
        let chat_id = Uuid::new_v4();
        let (_receiver, task) = background_tasks.start_task(chat_id, Uuid::new_v4()).await;

        let _ =
            with_generation_task_lifecycle(&background_tasks, &task, chat_id, async move { run })
                .await;

        (task.get_event_history().await, background_tasks, chat_id)
    }

    #[tokio::test]
    async fn a_failed_run_broadcasts_the_generic_frame_and_then_the_stream_end() {
        let (events, background_tasks, chat_id) =
            events_of_run(Err(eyre!("the generation blew up"))).await;

        let [StreamingEvent::Error { error }, StreamingEvent::StreamEnd] = events.as_slice() else {
            panic!("Expected a failure frame closed by a single stream end, got: {events:?}");
        };
        let error = error.as_ref().expect("Expected an error payload");
        assert_eq!(error["message_type"], "error");
        assert_eq!(error["error_type"], "internal_error");
        assert_eq!(
            error["error_description"],
            "The message could not be generated."
        );
        assert!(background_tasks.get_task(&chat_id).await.is_none());
    }

    #[tokio::test]
    async fn a_successful_run_closes_with_the_stream_end_alone() {
        let (events, background_tasks, chat_id) = events_of_run(Ok(())).await;

        assert!(
            matches!(events.as_slice(), [StreamingEvent::StreamEnd]),
            "Got: {events:?}"
        );
        assert!(background_tasks.get_task(&chat_id).await.is_none());
    }
}

impl MessageSubmitRequest {
    /// Synthetic request driving a delegated child run through the same task
    /// machinery as a user submit.
    pub(crate) fn for_delegated_run(
        chat_id: Uuid,
        user_message: String,
        input_files_ids: Vec<Uuid>,
        previous_message_id: Option<Uuid>,
    ) -> Self {
        Self {
            previous_message_id,
            existing_chat_id: Some(chat_id),
            user_message,
            input_files_ids,
            chat_provider_id: None,
            assistant_id: None,
            title_by_user_provided: None,
            mcp_write_tools_enabled: None,
            disabled_mcp_server_ids: None,
            disabled_mcp_tools: None,
            selected_facet_ids: Vec::new(),
            action_facet: None,
            mentioned_assistant_ids: None,
            delegation_run_mode: None,
        }
    }

    /// Synthetic request driving the reaction to a delivered task result
    /// through the same generation machinery as a user submit.
    ///
    /// `user_message` is never read past the user-row save, and a delivery does
    /// not do that save: its row is the `task_result` part, written before this
    /// request exists.
    pub(crate) fn for_result_delivery(
        chat_id: Uuid,
        chat_provider_id: Option<String>,
        selected_facet_ids: Vec<String>,
        previous_message_id: Option<Uuid>,
    ) -> Self {
        Self {
            previous_message_id,
            existing_chat_id: Some(chat_id),
            user_message: String::new(),
            input_files_ids: Vec::new(),
            chat_provider_id,
            assistant_id: None,
            title_by_user_provided: None,
            mcp_write_tools_enabled: None,
            disabled_mcp_server_ids: None,
            disabled_mcp_tools: None,
            selected_facet_ids,
            action_facet: None,
            mentioned_assistant_ids: None,
            delegation_run_mode: None,
        }
    }
}

/// Everything the tool-dispatch loop needs to run a delegated child assistant
/// for a `delegate_to_assistant` call.
pub(crate) struct DelegationDispatchContext<'a> {
    /// The origin user; the child chat and its messages are owned by them.
    pub me_user: &'a MeProfile,
    /// Targets validated for this turn — the only accepted `assistant_id`s.
    pub targets: &'a [crate::services::delegation::DelegationTarget],
    /// Parent-chat file ids enumerated in the tool offer.
    pub offered_file_ids: &'a [Uuid],
    /// The chat this generation runs in.
    pub origin_chat: &'a chats::Model,
    /// The turn's user message; seeding source and provenance anchor.
    pub origin_user_message_id: Uuid,
    /// Effective run mode for this turn's delegated runs — resolved and
    /// gate-downgraded at request time, so dispatch executes it as-is.
    pub run_mode: crate::models::message::DelegationRunMode,
    /// Background launches this generation already made. A launch is not yet
    /// visible as a running generation when the next call of the same turn is
    /// dispatched, so within a turn this counter is what keeps the
    /// concurrency cap honest.
    pub background_dispatches: std::sync::atomic::AtomicUsize,
    /// What the task route may offer and spend this turn, or `None` when
    /// `delegate_task` was not offered. Resolved once, at offer time, so the
    /// tool schema and the dispatch validation cannot drift apart.
    pub task_scope: Option<crate::services::delegation::TaskOfferScope>,
    /// `delegate_task` calls ATTEMPTED this turn, refusals included.
    ///
    /// Attempts, not successful dispatches: the built-in tools are exempt
    /// from the per-task budgets, so a refused call costs the model nothing
    /// and a model that keeps retrying one would otherwise be bounded only by
    /// wall-clock. Incremented once, where the call is parsed, before
    /// anything can refuse it.
    pub tasks_this_turn: std::sync::atomic::AtomicUsize,
}

#[derive(Clone, Debug, Default)]
struct LangfuseTraceEnrichment {
    base_tags: Vec<String>,
    filenames: Vec<String>,
    platform: String,
}

impl LangfuseTraceEnrichment {
    fn all_tags(&self, model_tags: &HashSet<String>, tool_names: &HashSet<String>) -> Vec<String> {
        let mut tags: BTreeSet<String> = self.base_tags.iter().cloned().collect();
        tags.extend(model_tags.iter().cloned());
        tags.extend(
            tool_names
                .iter()
                .map(|tool_name| langfuse_tool_called_tag(tool_name)),
        );
        tags.into_iter().collect()
    }

    fn trace_metadata(
        &self,
        assistant_id: Option<Uuid>,
        tool_names: &HashSet<String>,
        mcp_servers_unavailable: &[String],
        mcp_servers_needing_auth: &[String],
        was_aborted: bool,
    ) -> Option<JsonValue> {
        let mut tool_names: Vec<String> = tool_names.iter().cloned().collect();
        tool_names.sort();
        create_trace_metadata(
            assistant_id,
            &tool_names,
            &self.filenames,
            mcp_servers_unavailable,
            mcp_servers_needing_auth,
            was_aborted,
            Some(&self.platform),
        )
    }
}

fn generation_request_context_from_headers(headers: &HeaderMap) -> GenerationRequestContext {
    let platform = headers
        .get(X_ERATO_PLATFORM_HEADER)
        .and_then(|value| match value.to_str() {
            Ok(value) => Some(value),
            Err(error) => {
                tracing::warn!(
                    error = ?error,
                    header = X_ERATO_PLATFORM_HEADER,
                    "Ignoring malformed platform header"
                );
                None
            }
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| DEFAULT_ERATO_PLATFORM.to_string());

    GenerationRequestContext {
        platform: Some(platform),
        registered_client_tools: crate::services::client_tools::registered_client_tools(headers),
    }
}

/// Returns whether the given platform string is a known platform value.
///
/// Known platforms are `"web"` (always valid) plus any `platform` values declared
/// on configured action facets in `erato.toml`.
pub(crate) fn is_known_platform(config: &crate::config::AppConfig, platform: &str) -> bool {
    if platform == DEFAULT_ERATO_PLATFORM {
        return true;
    }

    config
        .action_facets
        .facets
        .values()
        .filter_map(|af| af.platform.as_deref())
        .any(|p| p == platform)
}

/// Logs a warning if the `X-Erato-Platform` header value is not a known platform.
pub(crate) fn warn_unknown_platform(config: &crate::config::AppConfig, platform: &str) {
    if !is_known_platform(config, platform) {
        tracing::warn!(
            platform = platform,
            "Unknown X-Erato-Platform value '{}'. Known platforms: 'web' + action facet platforms {:?}",
            platform,
            config
                .action_facets
                .facets
                .values()
                .filter_map(|af| af.platform.as_deref())
                .collect::<Vec<_>>()
        );
    }
}

/// Maximum allowed size in bytes for a single action facet argument value.
///
/// Sized to fit a typical Outlook compose-mode reply over a multi-message
/// thread: empirically 30–60 KB raw HTML, ~5–10 KB once the add-in coerces
/// to plain text. 64 KB leaves comfortable headroom for the worst-case
/// fully-quoted thread without inviting unbounded prompt growth — at the
/// O(4 chars/token) ratio this is roughly 16k tokens, well below any
/// supported model's context window but high enough that a real user
/// shouldn't see a 413.
const ACTION_FACET_ARG_MAX_SIZE: usize = 64 * 1024; // 64 KB

/// Validates an action facet request against the application configuration.
///
/// Returns `Ok(())` if no action facet is present or if the action facet is valid.
/// Returns `Err((StatusCode::BAD_REQUEST, message))` if validation fails.
pub(crate) fn validate_action_facet(
    config: &crate::config::AppConfig,
    action_facet: Option<&ActionFacetRequest>,
    platform: &str,
) -> Result<(), (axum::http::StatusCode, String)> {
    let Some(af) = action_facet else {
        return Ok(());
    };

    let Some(af_config) = config.action_facets.facets.get(&af.id) else {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            format!("Unknown action facet: {}", af.id),
        ));
    };

    // Validate platform match if configured
    if let Some(ref required_platform) = af_config.platform
        && required_platform != platform
    {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            format!(
                "Action facet '{}' requires platform '{}', but request has '{}'",
                af.id, required_platform, platform
            ),
        ));
    }

    // Validate arg keys against allowed_args
    for key in af.args.keys() {
        if !af_config.allowed_args.contains(key) {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                format!(
                    "Unexpected argument '{}' for action facet '{}'. Allowed: {:?}",
                    key, af.id, af_config.allowed_args
                ),
            ));
        }
    }

    // Validate arg value sizes
    for (key, value) in &af.args {
        if value.len() > ACTION_FACET_ARG_MAX_SIZE {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                format!(
                    "Argument '{}' for action facet '{}' exceeds maximum size of {} bytes (got {} bytes)",
                    key,
                    af.id,
                    ACTION_FACET_ARG_MAX_SIZE,
                    value.len()
                ),
            ));
        }
    }

    Ok(())
}

async fn build_langfuse_trace_enrichment(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    generation_input_messages: &GenerationInputMessages,
    assistant_id: Option<Uuid>,
    generation_request_context: &GenerationRequestContext,
) -> Result<LangfuseTraceEnrichment, Report> {
    let platform = generation_request_context
        .platform
        .clone()
        .unwrap_or_else(|| DEFAULT_ERATO_PLATFORM.to_string());
    let mut base_tags = BTreeSet::from([format!("frontend-platform-{}", platform)]);
    if assistant_id.is_some() {
        base_tags.insert("assistant".to_string());
    }

    let mut filenames = BTreeSet::new();
    let mut file_upload_ids = BTreeSet::new();

    for message in &generation_input_messages.messages {
        match &message.content {
            ContentPart::TextFilePointer(pointer) => {
                file_upload_ids.insert(pointer.file_upload_id);
            }
            ContentPart::ImageFilePointer(pointer) => {
                file_upload_ids.insert(pointer.file_upload_id);
            }
            _ => {}
        }
    }

    for file_upload_id in file_upload_ids {
        let file_upload = crate::models::file_upload::get_file_upload_by_id(
            &app_state.db,
            policy,
            subject,
            &file_upload_id,
        )
        .await?;

        filenames.insert(file_upload.filename.clone());

        if let Some(extension) = file_upload.filename.rsplit('.').next()
            && file_upload.filename.contains('.')
        {
            base_tags.insert(format!("file-extension-{}", extension.to_lowercase()));
        }

        base_tags.insert(format!(
            "file-provider-{}",
            file_upload.file_storage_provider_id.to_lowercase()
        ));
    }

    Ok(LangfuseTraceEnrichment {
        base_tags: base_tags.into_iter().collect(),
        filenames: filenames.into_iter().collect(),
        platform,
    })
}

fn build_selected_facets(
    config: &FacetsConfig,
    selected_facet_ids: &[String],
) -> HashMap<String, bool> {
    let selected_set: HashSet<&String> = selected_facet_ids.iter().collect();
    config
        .facets
        .keys()
        .map(|id| (id.clone(), selected_set.contains(id)))
        .collect()
}

pub(crate) fn sanitize_selected_facet_ids(
    config: &FacetsConfig,
    selected_facet_ids: &[String],
) -> Vec<String> {
    // Hidden facets are always-on baselines, never user-selectable — drop them
    // from user-supplied selections so they cannot be forced on by id.
    let available_facet_ids: HashSet<&str> = config
        .facets
        .iter()
        .filter(|(_, facet)| !facet.hidden)
        .map(|(id, _)| id.as_str())
        .collect();
    let mut sanitized = Vec::new();

    for facet_id in selected_facet_ids {
        if available_facet_ids.contains(facet_id.as_str()) && !sanitized.contains(facet_id) {
            sanitized.push(facet_id.clone());
        }
    }

    if config.only_single_facet {
        sanitized.truncate(1);
    }

    sanitized
}

/// Hidden facets that must be force-activated for this request's platform.
///
/// Hidden facets are system baselines: not user-selectable and injected
/// regardless of per-user facet authorization. A facet with no
/// `hidden_always_active_for_platform` applies on every platform. Returned
/// id-sorted for deterministic ordering.
pub(crate) fn active_hidden_facet_ids(
    config: &FacetsConfig,
    platform: Option<&str>,
) -> Vec<String> {
    let mut ids: Vec<String> = config
        .facets
        .iter()
        .filter(|(_, facet)| facet.hidden)
        .filter(
            |(_, facet)| match &facet.hidden_always_active_for_platform {
                None => true,
                Some(required) => platform == Some(required.as_str()),
            },
        )
        .map(|(id, _)| id.clone())
        .collect();
    ids.sort();
    ids
}

/// What a run may spend on tool calls, read off its own chat row.
///
/// Only a task run has budgets: they were resolved from the config and the
/// planning facets when it was launched and written into its `TaskSpec`, so
/// the run stays bounded by what was agreed at launch rather than by whatever
/// the config happens to say now. Every other turn — ordinary chats, mention
/// runs — returns `None` and keeps the per-message cap.
pub(crate) fn task_tool_budgets_for_chat(
    chat: &chats::Model,
) -> Option<crate::services::delegation::TaskToolBudgets> {
    let task = crate::models::chat::parse_chat_configuration(chat)
        .ok()
        .flatten()?
        .task?;
    Some(crate::services::delegation::TaskToolBudgets {
        server: task.max_server_tool_calls_per_task?,
        client: task.max_client_tool_calls_per_task?,
    })
}

pub(crate) fn resolve_effective_selected_facet_ids(
    config: &FacetsConfig,
    requested_facet_ids: &[String],
    assistant_config: Option<&crate::models::assistant::AssistantWithFiles>,
) -> Vec<String> {
    let selected_facet_ids = if let Some(assistant) = assistant_config {
        if assistant.enforce_facet_settings {
            assistant.facet_ids.as_deref().unwrap_or(&[])
        } else {
            requested_facet_ids
        }
    } else {
        requested_facet_ids
    };

    sanitize_selected_facet_ids(config, selected_facet_ids)
}

/// Prepares a chat request for LLM generation.
///
/// This function is boxed to reduce stack usage, as it has a deep async call chain.
#[allow(clippy::too_many_arguments)]
fn prepare_chat_request<'a>(
    app_state: &'a AppState,
    policy: &'a PolicyEngine,
    chat: &'a chats::Model,
    user_input: PromptCompositionUserInput,
    generation_request_context: GenerationRequestContext,
    me_profile_input: &'a MeProfileChatRequestInput<'a>,
) -> std::pin::Pin<
    Box<dyn std::future::Future<Output = Result<PreparedChatRequest, Report>> + Send + 'a>,
> {
    Box::pin(async move {
        // Create subject from chat owner with organization info if available
        let subject = if me_profile_input.organization_user_id.is_some()
            || !me_profile_input.organization_group_ids.is_empty()
        {
            crate::policy::types::Subject::UserWithOrganizationInfo {
                id: chat.owner_user_id.clone(),
                organization_user_id: me_profile_input.organization_user_id.map(String::from),
                organization_group_ids: me_profile_input.organization_group_ids.to_vec(),
            }
        } else {
            crate::policy::types::Subject::User(chat.owner_user_id.clone())
        };

        // Create the dependency adapters
        let message_repo = DatabaseMessageRepository {
            conn: &app_state.db,
            policy,
            subject: &subject,
        };
        let file_resolver = AppStateFileResolver {
            app_state,
            access_token: me_profile_input.access_token,
        };
        let prompt_provider = AppStatePromptProvider {
            app_state,
            policy,
            subject: &subject,
            access_token: me_profile_input.access_token,
        };

        // Get assistant configuration to check for default provider
        let assistant_config = crate::models::chat::get_chat_assistant_configuration(
            &app_state.db,
            policy,
            &subject,
            chat,
        )
        .await?;

        prepare_chat_request_with_adapters(
            app_state,
            policy,
            chat,
            user_input,
            generation_request_context,
            me_profile_input,
            assistant_config,
            &message_repo,
            &file_resolver,
            &prompt_provider,
        )
        .await
    })
}

#[allow(clippy::too_many_arguments)]
#[instrument(skip_all)]
pub(crate) async fn prepare_chat_request_with_adapters(
    app_state: &AppState,
    policy: &PolicyEngine,
    chat: &chats::Model,
    user_input: PromptCompositionUserInput,
    generation_request_context: GenerationRequestContext,
    me_profile_input: &MeProfileChatRequestInput<'_>,
    assistant_config: Option<crate::models::assistant::AssistantWithFiles>,
    message_repo: &impl MessageRepository,
    file_resolver: &impl FileResolver,
    prompt_provider: &impl PromptProvider,
) -> Result<PreparedChatRequest, Report> {
    let mcp = app_state.mcp_state().await;
    // A task child is scoped by the facets its brief asked for. They are read
    // from the durable chat row rather than carried on the request, for the
    // same reason the client-tool collector reads the row: what a delegated
    // run may reach for is a property of the run, not of whoever submitted
    // the turn, and it must survive every later turn of that child.
    let task_facet_ids: Vec<String> = crate::models::chat::parse_chat_configuration(chat)
        .ok()
        .flatten()
        .and_then(|configuration| configuration.task)
        .map(|task| task.facet_ids)
        .unwrap_or_default();
    let requested_facet_ids: &[String] = if user_input.selected_facet_ids.is_empty() {
        &task_facet_ids
    } else {
        &user_input.selected_facet_ids
    };
    let effective_selected_facet_ids = resolve_effective_selected_facet_ids(
        &app_state.config.facets,
        requested_facet_ids,
        assistant_config.as_ref(),
    );
    // An assistant that enforces its own facet settings REPLACES the request's
    // list, so a task child inheriting such an assistant silently loses the
    // scope its brief asked for. The assistant wins on purpose — it is the
    // owner's configuration, not the model's — but it is worth saying out loud.
    if !task_facet_ids.is_empty()
        && !task_facet_ids
            .iter()
            .all(|facet_id| effective_selected_facet_ids.contains(facet_id))
    {
        tracing::warn!(
            chat_id = %chat.id,
            requested = ?task_facet_ids,
            effective = ?effective_selected_facet_ids,
            "Task run's requested facets were narrowed by the assistant's enforced facet settings"
        );
    }
    let mut effective_selected_facet_ids = policy
        .filter_authorized_facet_ids(
            &me_profile_input.subject,
            me_profile_input.user_groups,
            &effective_selected_facet_ids,
        )
        .await?;
    // Append always-on hidden baseline facets for this platform. Added after
    // the authorization filter (they are system baselines, not user-gated) so
    // their prompt injection, model settings, and tool allowlist all flow
    // through the same machinery as user-selected facets.
    for facet_id in active_hidden_facet_ids(
        &app_state.config.facets,
        generation_request_context.platform.as_deref(),
    ) {
        if !effective_selected_facet_ids.contains(&facet_id) {
            effective_selected_facet_ids.push(facet_id);
        }
    }

    // Determine the chat provider to use
    let requested_chat_provider_id = user_input.requested_chat_provider_id.as_deref();
    let effective_chat_provider_id = requested_chat_provider_id.or_else(|| {
        assistant_config
            .as_ref()
            .and_then(|a| a.default_chat_provider.as_deref())
    });

    // Resolve chat provider configuration
    let ChatProviderConfigWithId {
        chat_provider_config,
        chat_provider_id,
    } = app_state
        .chat_provider_for_chatcompletion(
            policy,
            &me_profile_input.subject,
            me_profile_input.user_groups,
            effective_chat_provider_id,
        )
        .await?;

    let mcp_auth_context = McpRequestAuthContext {
        app_state: Some(app_state),
        user_id: me_profile_input.user_id,
        oidc_token: Some(me_profile_input.oidc_token),
        access_token: me_profile_input.access_token,
    };
    let GenerationMcpToolSet {
        tools: generation_mcp_tools,
        mcp_claimed_names,
        denied: _,
        write_suppressed: _,
        disabled_server_ids: mcp_servers_disabled_by_user,
        disabled_tools: mcp_tools_disabled_by_user,
        unavailable_server_ids: mcp_servers_unavailable,
        needing_auth_server_ids: mcp_servers_needing_auth,
        missing_credential_server_ids: _,
    } = resolve_generation_mcp_tools(
        app_state,
        policy,
        &mcp,
        chat.id,
        GenerationMcpToolInputs {
            effective_selected_facet_ids: &effective_selected_facet_ids,
            action_facet_id: user_input.action_facet.as_ref().map(|af| af.id.as_str()),
            assistant_config: assistant_config.as_ref(),
            subject: &me_profile_input.subject,
            user_groups: me_profile_input.user_groups,
            user_id: me_profile_input.user_id,
            write_tools_enabled: chat.mcp_write_tools_enabled,
            disabled_server_ids: &chat.disabled_mcp_server_ids,
            disabled_tool_patterns: &chat.disabled_mcp_tools,
        },
        &mcp_auth_context,
    )
    .await?;
    let facet_tool_expansions = build_facet_tool_template_expansions(
        &app_state.config.facets,
        &effective_selected_facet_ids,
        &generation_mcp_tools,
    );

    // Use the new prompt composition service
    let generation_input_messages = compose_prompt_messages(
        message_repo,
        file_resolver,
        prompt_provider,
        chat,
        &user_input,
        &chat_provider_config,
        &app_state.config.facets,
        Some(me_profile_input.preferred_language),
        me_profile_input.user_preference_nickname,
        me_profile_input.user_preference_job_title,
        me_profile_input.user_preference_assistant_custom_instructions,
        me_profile_input.user_preference_assistant_additional_information,
        Some(&facet_tool_expansions),
        &app_state.config.action_facets.facets,
        generation_request_context.platform.as_deref(),
    )
    .await?;

    // Resolve TextFilePointer to Text by extracting file contents JIT
    let resolved_generation_input_messages = resolve_file_pointers_in_generation_input(
        app_state,
        generation_input_messages.clone(),
        me_profile_input.access_token,
    )
    .await?;

    // Render any per-turn directive markers against the current config.
    // Saved snapshot keeps the markers; only the about-to-be-sent
    // chat_request gets rendered text. Past-turn markers were already
    // stripped during historical replay in `compose_prompt_messages`, so
    // anything that reaches here is the current turn's directive.
    let resolved_generation_input_messages = resolve_directive_markers_in_generation_input(
        app_state,
        resolved_generation_input_messages,
    );

    // Build genai ChatRequest (messages + tools) + ChatOptions
    let effective_model_settings = build_model_settings_for_facets(
        &chat_provider_config.model_settings,
        &app_state.config.facets,
        &effective_selected_facet_ids,
    );

    let mut chat_request = resolved_generation_input_messages
        .clone()
        .into_chat_request();
    let did_prior_assistant_chat_provider_change = prior_assistant_chat_provider_changed(
        message_repo,
        &user_input.just_submitted_user_message_id,
        chat_provider_id.as_str(),
    )
    .await?;
    if should_strip_persisted_reasoning_messages(
        &chat_provider_config.provider_kind,
        effective_model_settings.compat_no_replay_summary,
        did_prior_assistant_chat_provider_change,
    ) {
        strip_persisted_reasoning_messages(&mut chat_request);
    }
    let mut chat_request_tools = convert_mcp_tools_to_genai_tools(
        generation_mcp_tools.clone(),
        effective_model_settings.compat_omit_strict,
    );
    // A delegated child run has no interactive client on its own chat: the
    // parent awaits it, so every client-interaction affordance would burn its
    // park budget against nobody. Suppression acts HERE, at the offering
    // site, across every source (client-action tool, global/facet/action
    // client-tool allowlists) — a security control derived from the durable
    // chat row, not caller-remembered state.
    let is_delegated_run = crate::models::chat::chat_is_delegated_run(chat);
    // Offer the synthetic client-action tool only when the current request's
    // action facet declares client actions and the chat allows writes: client
    // actions are the mutation channel, so the write toggle withholds them
    // together with non-read-only MCP tools. The tool is handled in the tool
    // call loop instead of being dispatched to an MCP server. If an MCP tool
    // already claims the same name, it wins — adding a duplicate tool name
    // would be rejected by providers and ambiguous to dispatch.
    if !is_delegated_run
        && chat.mcp_write_tools_enabled
        && let Some(action_facet) = user_input.action_facet.as_ref()
        && let Some(facet_config) = app_state.config.action_facets.facets.get(&action_facet.id)
        && !facet_config.client_actions.is_empty()
    {
        let name_taken_by_mcp_tool =
            mcp_claimed_names.contains(crate::services::client_actions::CLIENT_ACTION_TOOL_NAME);
        if name_taken_by_mcp_tool {
            tracing::warn!(
                "Not offering the client-action tool for action facet '{}': an MCP tool already uses the name '{}'",
                action_facet.id,
                crate::services::client_actions::CLIENT_ACTION_TOOL_NAME
            );
        } else {
            chat_request_tools.push(crate::services::client_actions::build_client_action_tool(
                &facet_config.client_actions,
                effective_model_settings.compat_omit_strict,
            ));
        }
    }
    // Offer top-level `client_tools` (returning round-trip tools) selected by
    // any active `tool_call_allowlist` — the GLOBAL
    // `facets.tool_call_allowlist` (so a client tool can be
    // globally active with no facet at all), plus any selected regular facets,
    // plus the active action facet — using the same namespaced pattern
    // mechanism as MCP tools (e.g. `outlook/*`). Like the client-action tool
    // these are NOT dispatched to an MCP server; the tool call loop suspends for
    // a client-supplied result instead. Skip any whose model-facing name
    // collides with an MCP tool or the reserved client-action tool name (a
    // duplicate name is ambiguous to dispatch and rejected by providers);
    // `namespace/name` uniqueness is already enforced at config load. An empty
    // effective allowlist offers nothing — client tools are strictly opt-in.
    let client_tool_allowlist = effective_client_tool_allowlist(
        &app_state.config.facets,
        &app_state.config.action_facets,
        &effective_selected_facet_ids,
        user_input.action_facet.as_ref().map(|af| af.id.as_str()),
    );
    // Runtime policies of the client tools OFFERED to this request, keyed by the
    // model-facing name (unique post-dedup). The dispatch/park site resolves
    // timeouts from here instead of re-finding config entries by bare name.
    let mut offered_client_tools: std::collections::HashMap<
        String,
        crate::services::client_tools::OfferedClientTool,
    > = std::collections::HashMap::new();
    if !client_tool_allowlist.is_empty() && !is_delegated_run {
        let allowlist_matched: Vec<&crate::config::ClientToolConfig> = app_state
            .config
            .client_tools
            .tools
            .values()
            .filter(|client_tool| {
                crate::services::client_tools::client_tool_is_available(
                    client_tool,
                    &generation_request_context.registered_client_tools,
                )
            })
            .filter(|client_tool| {
                is_qualified_tool_allowed(
                    client_tool.namespace_or_default(),
                    &client_tool.name,
                    &client_tool_allowlist,
                )
            })
            .collect();
        let selection = crate::services::client_tools::select_client_tools(
            allowlist_matched,
            &client_tool_allowlist,
            |name| mcp_claimed_names.contains(name),
        );
        for (skipped_tool, skip) in &selection.skipped {
            use crate::services::client_tools::ClientToolSkip;
            match skip {
                ClientToolSkip::ReservedName => tracing::warn!(
                    "Not offering client tool '{}': the name is reserved",
                    skipped_tool.qualified_name()
                ),
                // An exact allowlist entry naming a tool that then cannot be
                // offered is always a config bug — surface it loudly.
                ClientToolSkip::McpCollision {
                    explicitly_selected: true,
                } => tracing::error!(
                    "Not offering client tool '{}' although the allowlist selects it EXACTLY: an MCP tool already uses the model-facing name '{}' — fix the config",
                    skipped_tool.qualified_name(),
                    skipped_tool.name
                ),
                ClientToolSkip::McpCollision { .. } => tracing::warn!(
                    "Not offering client tool '{}': an MCP tool already uses the model-facing name '{}'",
                    skipped_tool.qualified_name(),
                    skipped_tool.name
                ),
                ClientToolSkip::DuplicateBareName { winner_qualified } => tracing::warn!(
                    "Not offering client tool '{}': '{}' already offers the model-facing name '{}' (providers require unique tool names)",
                    skipped_tool.qualified_name(),
                    winner_qualified,
                    skipped_tool.name
                ),
            }
        }
        for client_tool in selection.offered {
            let name = client_tool.name.as_str();
            let schema = match serde_json::from_str::<serde_json::Value>(&client_tool.parameters) {
                Ok(schema) => schema,
                Err(error) => {
                    tracing::warn!(
                        "Not offering client tool '{}': parameters are not valid JSON: {}",
                        name,
                        error
                    );
                    continue;
                }
            };
            // Remember the OFFERED entry's policy by model-facing name
            // (unique post-dedup) — the dispatch site must not re-find the
            // config by bare name, which is ambiguous across namespaces.
            let policy =
                crate::services::client_tools::OfferedClientTool::prepare(client_tool, &schema)
                    .map_err(|error| {
                        eyre!("Invalid client submission schema for '{}': {}", name, error)
                    })?;
            let native_strict = crate::services::client_tools::native_strict_for_submission(
                client_tool,
                &schema,
                &chat_provider_config.provider_kind,
                chat_provider_config
                    .model_capabilities
                    .supports_strict_tool_calling,
                effective_model_settings.compat_omit_strict,
            )
            .map_err(|error| eyre!(error))?;
            offered_client_tools.insert(name.to_string(), policy);
            chat_request_tools.push(crate::services::client_tools::build_client_tool(
                name,
                &client_tool.description,
                schema,
                effective_model_settings.compat_omit_strict,
                native_strict,
            ));
        }
    }
    // Both delegation routes are offered here. They are request-scoped like
    // the client-action tool and never offered inside a delegated run itself
    // — depth stays at one even if a user mentions assistants inside a
    // delegated chat. If an MCP tool claims either name, it wins (same
    // precedence as the other synthetic tools).
    //
    // `delegate_to_assistant` is aimed at an assistant the user mentioned;
    // `delegate_task` lets the model plan its own sub-task, scoped by facets.
    // They share one list of attachable files, fetched once below, because
    // the dispatch context validates every requested file against it.
    let offer_mention_tool = !user_input.delegation_targets.is_empty()
        && !is_delegated_run
        && !mcp_claimed_names
            .contains(crate::services::delegation::DELEGATE_TO_ASSISTANT_TOOL_NAME);
    if !user_input.delegation_targets.is_empty() && !is_delegated_run && !offer_mention_tool {
        tracing::warn!(
            "Not offering the delegation tool: an MCP tool already uses the name '{}'",
            crate::services::delegation::DELEGATE_TO_ASSISTANT_TOOL_NAME
        );
    }
    // The suppression check comes first and is not part of the slot decision:
    // `synthetic_tool_offer_slot` withholds the tool from a delegated RUN, and
    // a task-result reaction runs in the origin chat, where nothing there would
    // have stopped it.
    let offer_task_tool = !user_input.suppress_task_offer
        && synthetic_tool_offer_slot(
            erato_config::config::DELEGATE_TASK_TOOL_NAME,
            app_state.config.delegation.tasks.enabled,
            &client_tool_allowlist,
            &generation_mcp_tools,
            is_delegated_run,
        );

    let mut delegation_offered_file_ids: Vec<Uuid> = Vec::new();
    let mut task_offer_scope: Option<crate::services::delegation::TaskOfferScope> = None;
    if offer_mention_tool || offer_task_tool {
        let offered_files = crate::models::file_upload::get_chat_file_uploads(
            &app_state.db,
            policy,
            &me_profile_input.subject,
            &chat.id,
        )
        .await?
        .into_iter()
        .map(|file| crate::services::delegation::DelegationOfferedFile {
            id: file.id,
            filename: file.filename,
        })
        .collect::<Vec<_>>();
        delegation_offered_file_ids = offered_files.iter().map(|file| file.id).collect();

        if offer_mention_tool {
            chat_request_tools.push(
                crate::services::delegation::build_delegate_to_assistant_tool(
                    &user_input.delegation_targets,
                    &offered_files,
                    user_input.delegation_run_mode,
                    effective_model_settings.compat_omit_strict,
                ),
            );
        }

        if offer_task_tool {
            let scope = resolve_task_offer_scope(
                app_state,
                policy,
                &me_profile_input.subject,
                me_profile_input.user_groups,
                &effective_selected_facet_ids,
            )
            .await?;
            chat_request_tools.push(crate::services::delegation::build_delegate_task_tool(
                &scope,
                &delegation_offered_file_ids,
                effective_model_settings.compat_omit_strict,
            ));
            task_offer_scope = Some(scope);
        }
    }
    // Offer the synthetic wait tool when waiting is enabled globally or when
    // an MCP server explicitly allows one of the discovered tools to defer a
    // continuation. The tool is only useful alongside MCP tools, and MCP wins
    // if a server already exposes the reserved name.
    let wait_tool_enabled = !generation_mcp_tools.is_empty()
        && (mcp.config.mcp_servers_global.enable_wait
            || generation_mcp_tools.iter().any(|managed_tool| {
                mcp.config
                    .mcp_servers
                    .get(&managed_tool.server_id)
                    .is_some_and(|config| is_tool_allowed_to_wait(&managed_tool.tool.name, config))
            }));
    if wait_tool_enabled {
        let name_taken_by_mcp_tool = generation_mcp_tools
            .iter()
            .any(|tool| tool.tool.name == crate::services::mcp_wait::WAIT_TOOL_NAME);
        if name_taken_by_mcp_tool {
            tracing::warn!(
                "Not offering the wait tool: an MCP tool already uses the name '{}'",
                crate::services::mcp_wait::WAIT_TOOL_NAME
            );
        } else {
            chat_request_tools.push(crate::services::mcp_wait::build_wait_tool(
                mcp.config.mcp_servers_global.max_wait_seconds,
                effective_model_settings.compat_omit_strict,
            ));
        }
    }
    if !chat_request_tools.is_empty() {
        chat_request.tools = Some(chat_request_tools);
    } else {
        tracing::trace!("Not adding empty list of tools, as that may lead to hallucinated tools");
    }
    if is_openai_responses_provider_kind(&chat_provider_config.provider_kind) {
        chat_request = chat_request.with_store(false);
        if !did_prior_assistant_chat_provider_change {
            let reasoning_replay_messages = collect_reasoning_replay_messages(
                message_repo,
                &user_input.just_submitted_user_message_id,
                chat_provider_id.as_str(),
                effective_model_settings.compat_no_replay_summary,
            )
            .await?;
            if !reasoning_replay_messages.is_empty() {
                insert_openai_responses_reasoning_replay_messages(
                    &mut chat_request,
                    reasoning_replay_messages,
                );
            }
        }
    }
    let chat_options = build_chat_options_for_completion(
        &effective_model_settings,
        &chat_provider_config.model_capabilities,
    );

    // Create generation parameters with the determined chat provider ID
    let generation_parameters = GenerationParameters {
        generation_chat_provider_id: Some(chat_provider_id),
        request_context: Some(generation_request_context.clone()),
        selected_facets: build_selected_facets(
            &app_state.config.facets,
            &effective_selected_facet_ids,
        ),
        action_facet_id: user_input.action_facet.as_ref().map(|af| af.id.clone()),
        action_facet_args: user_input.action_facet.as_ref().map(|af| af.args.clone()),
        initiator: None,
    };

    // Return the unresolved version for saving to DB (to avoid duplicating file contents)
    // The resolved version is already used in chat_request
    Ok(PreparedChatRequest {
        generation_input_messages,
        generation_parameters,
        generation_request_context,
        mcp_servers_unavailable,
        mcp_servers_needing_auth,
        mcp_servers_disabled_by_user,
        mcp_tools_disabled_by_user,
        available_mcp_tools: generation_mcp_tools.clone(),
        offered_client_tools,
        chat_request,
        chat_options,
        delegation_targets: user_input.delegation_targets.clone(),
        delegation_offered_file_ids,
        task_offer_scope,
    })
}

fn append_text_delta_part(content: &mut Vec<ContentPart>, new_text: String) -> usize {
    let content_index = content.len().saturating_sub(1);
    if let Some(ContentPart::Text(text_part)) = content.last_mut() {
        text_part.text.push_str(&new_text);
        content_index
    } else {
        let content_index = content.len();
        content.push(ContentPart::Text(ContentPartText { text: new_text }));
        content_index
    }
}

fn append_reasoning_delta_part(content: &mut Vec<ContentPart>, new_text: String) -> usize {
    let content_index = content.len().saturating_sub(1);
    if let Some(ContentPart::Reasoning(reasoning_part)) = content.last_mut() {
        reasoning_part.text.push_str(&new_text);
        content_index
    } else {
        let content_index = content.len();
        content.push(ContentPart::Reasoning(ContentPartReasoning {
            text: new_text,
            ..Default::default()
        }));
        content_index
    }
}

fn insert_reasoning_part_before_text(content: &mut Vec<ContentPart>, text: String) -> usize {
    let insertion_index = content
        .iter()
        .position(|part| matches!(part, ContentPart::Text(_)))
        .unwrap_or(content.len());

    content.insert(
        insertion_index,
        ContentPart::Reasoning(ContentPartReasoning {
            text,
            ..Default::default()
        }),
    );
    insertion_index
}

struct HallucinationSuppressionState {
    enabled: bool,
    whitespace_delta_threshold: usize,
    successive_whitespace_text_deltas: usize,
}

impl HallucinationSuppressionState {
    fn new(config: HallucinationSuppressionConfig) -> Self {
        Self {
            enabled: config.enabled,
            whitespace_delta_threshold: config.whitespace_delta_threshold,
            successive_whitespace_text_deltas: 0,
        }
    }

    fn observe_text_delta(&mut self, content: &str) -> bool {
        if !self.enabled || content.is_empty() {
            return false;
        }

        if content.chars().all(char::is_whitespace) {
            self.successive_whitespace_text_deltas += 1;
        } else {
            self.successive_whitespace_text_deltas = 0;
        }

        self.successive_whitespace_text_deltas >= self.whitespace_delta_threshold
    }
}

fn hallucination_loop_error_event(message_id: Uuid) -> MessageSubmitStreamingResponseError {
    MessageSubmitStreamingResponseError {
        message_id: Some(message_id),
        error: GenerationErrorType::HallucinationLoop {
            error_description: HALLUCINATION_LOOP_ERROR_DESCRIPTION.to_string(),
        },
    }
}

fn log_chat_completion_generation_error(
    chat_provider_id: &str,
    message_id: Uuid,
    error: &GenerationErrorType,
) {
    tracing::error!(
        chat_provider_id,
        message_id = %message_id,
        error = ?error,
        "Chat completion generation failed"
    );
}

fn langfuse_model_name(app_state: &AppState, chat_provider_id: Option<&str>) -> String {
    let provider_id = match chat_provider_id {
        Some(provider_id) => Some(provider_id),
        None => match app_state.config.determine_chat_provider(None, None) {
            Ok(provider_id) => Some(provider_id),
            Err(error) => {
                warn_and_capture_error("resolve Langfuse model chat provider", &error);
                None
            }
        },
    };

    provider_id
        .map(|provider_id| {
            app_state
                .config
                .get_chat_provider(provider_id)
                .model_name_langfuse()
                .to_string()
        })
        .unwrap_or_else(|| "unknown".to_string())
}

fn langfuse_turn_name(base_name: Option<&str>, turn: usize) -> String {
    base_name
        .map(|name| format!("{name} (turn {turn})"))
        .unwrap_or_else(|| format!("chat_completion_turn_{turn}"))
}

#[allow(clippy::too_many_arguments)]
async fn persist_otel_generation_error(
    tracing_client: Option<&TracingLangfuseClient>,
    turn_observation_id: &str,
    chat_request: &ChatRequest,
    output_content: &[ContentPart],
    error: &GenerationErrorType,
    model_name: &str,
    generation_name: &str,
    turn_start_time: Option<SystemTime>,
    assistant_id: Option<Uuid>,
    tool_names: &HashSet<String>,
    platform: &str,
) {
    let Some(client) = tracing_client.filter(|client| client.uses_otel()) else {
        return;
    };
    let Some(start_time) = turn_start_time else {
        return;
    };
    let mut tool_names: Vec<String> = tool_names.iter().cloned().collect();
    tool_names.sort();

    if let Err(error) = create_otel_error_generation_from_chat(
        client,
        turn_observation_id.to_string(),
        chat_request,
        output_content,
        error,
        model_name.to_string(),
        generation_name.to_string(),
        start_time,
        SystemTime::now(),
        assistant_id,
        &tool_names,
        Some(platform),
    )
    .await
    {
        tracing::warn!(
            error = %error,
            observation_id = %turn_observation_id,
            "Failed to persist Langfuse OTEL generation error"
        );
    }
}

#[allow(clippy::too_many_arguments)]
async fn persist_otel_tool_call(
    tracing_client: Option<&TracingLangfuseClient>,
    tool_call: &genai::chat::ToolCall,
    output: Option<JsonValue>,
    start_time: Option<SystemTime>,
    end_time: Option<SystemTime>,
    parent_observation_id: Option<String>,
    assistant_id: Option<Uuid>,
    platform: &str,
    error: Option<&str>,
) {
    let Some(client) = tracing_client.filter(|client| client.uses_otel()) else {
        return;
    };
    let (Some(start_time), Some(end_time)) = (start_time, end_time) else {
        return;
    };
    let (observation_id, _) = generate_langfuse_ids();

    if let Err(trace_error) = create_otel_tool_call_span(
        client,
        observation_id,
        &tool_call.call_id,
        &tool_call.fn_name,
        tool_call.fn_arguments.clone(),
        output,
        start_time,
        end_time,
        assistant_id,
        Some(platform),
        parent_observation_id,
        error,
    )
    .await
    {
        tracing::warn!(
            error = %trace_error,
            tool_call_id = %tool_call.call_id,
            tool_name = %tool_call.fn_name,
            "Failed to persist Langfuse OTEL tool-call span"
        );
    }
}

/// Persist the assistant row's parts mid-turn, so a reader — or a crash —
/// sees the delegated slots as they really are instead of an empty message
/// until the turn ends.
///
/// Deliberately best-effort. At launch the child is already running, so
/// failing the turn here would orphan it; at settle the end-of-turn writer is
/// still the authoritative write. Either way the turn is worth more than the
/// early copy of it.
async fn commit_message_content_mid_turn(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    assistant_message_id: Uuid,
    content: &[ContentPart],
    stage: &str,
) {
    if let Err(error) = crate::models::message::update_message_content(
        &app_state.db,
        policy,
        subject,
        &assistant_message_id,
        without_preparing_tools(content),
    )
    .await
    {
        tracing::warn!(
            message_id = %assistant_message_id,
            stage,
            error = %error,
            "Failed to commit delegated task slot mid-turn"
        );
    }
}

/// Turn one delegation outcome into everything the turn owes for it: the
/// settled part, the events, the Langfuse span and the response the model
/// gets back.
///
/// Shared by the two routes because the outcome shape is shared. A reserved
/// `slot` settles in place; without one the part is appended where it always
/// was. The content write and its durable commit happen before the events,
/// because sending to the client can fail the turn and a reserved slot must
/// never be left reading "working" for a child that has finished.
#[allow(clippy::too_many_arguments)]
async fn settle_delegation_slot<
    MSG: SendAsSseEvent + From<MessageSubmitStreamingResponseToolCallUpdate>,
>(
    outcome: Result<crate::services::delegation::DelegationDispatchOutcome, String>,
    tool_call: &genai::chat::ToolCall,
    reserved: Option<usize>,
    tool_call_started: String,
    otel_tool_call_start_time: Option<SystemTime>,
    otel_parent_observation_id: Option<String>,
    content: &mut Vec<ContentPart>,
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    assistant_message_id: Uuid,
    assistant_id: Option<Uuid>,
    streaming_task: Option<&Arc<StreamingTask>>,
    tracing_client: Option<&TracingLangfuseClient>,
    platform: &str,
    tx: &Sender<Result<Event, Report>>,
) -> Result<genai::chat::ToolResponse, Report> {
    let (status, bg_status, message_status, output_value, response_text) = match outcome {
        Ok(crate::services::delegation::DelegationDispatchOutcome::Completed {
            envelope,
            trace,
        }) => {
            let response_text = envelope.model_response_text();
            let output_value = envelope.output_value(&trace);
            if envelope.status == crate::services::delegation::DelegationRunStatus::Completed {
                (
                    ToolCallStatus::Success,
                    BgToolCallStatus::Success,
                    MessageToolCallStatus::Success,
                    output_value,
                    response_text,
                )
            } else {
                (
                    ToolCallStatus::Error,
                    BgToolCallStatus::Error,
                    MessageToolCallStatus::Error,
                    output_value,
                    response_text,
                )
            }
        }
        // A background launch settles the part as a Success — a
        // dispatch is not an error — with two deliberately
        // different shapes. The UI output carries NO "status",
        // and the "background" marker is what its background
        // presentation keys off. The model gets an explicit
        // "dispatched" status plus the note so its final prose
        // reports work that was started, not an answer it never
        // received.
        //
        // The status was originally omitted because the frontend
        // rendered anything other than "completed" as a failure.
        // It no longer does — it reads the full vocabulary and
        // treats "dispatched" as settled — but the omission
        // stands on its own: a dispatch outcome is not a child
        // status, and every shipped part already has this shape.
        Ok(crate::services::delegation::DelegationDispatchOutcome::Dispatched {
            assistant_id,
            assistant_name,
            delegate_chat_id,
            run_mode,
        }) => {
            // A bare task child has no assistant to name. The
            // keys are omitted rather than sent null, so a reader
            // never has to tell "absent" from "present and null".
            let identity = |value: &mut serde_json::Value| {
                if let Some(object) = value.as_object_mut() {
                    if let Some(assistant_id) = assistant_id {
                        object.insert("assistant_id".to_string(), json!(assistant_id));
                    }
                    if let Some(assistant_name) = assistant_name.as_ref() {
                        object.insert("assistant_name".to_string(), json!(assistant_name));
                    }
                }
            };
            // The background shape is left byte-identical - every shipped
            // part has it, and the frontend's dispatch pill keys on
            // `background`, which is true of both detached modes. `async`
            // adds exactly one key, because a reader has to be able to tell
            // a run whose answer is coming back from one whose never will.
            // It is inert on replay: `frame_delegation_result` returns
            // before touching an object with no string `result`.
            let is_async = run_mode == crate::models::message::ProvenanceRunMode::Async;
            let mut ui_output = json!({
                "delegate_chat_id": delegate_chat_id,
                "child_run_id": delegate_chat_id,
                "background": true,
            });
            if is_async && let Some(object) = ui_output.as_object_mut() {
                object.insert("run_mode".to_string(), json!("async"));
            }
            identity(&mut ui_output);
            let mut model_output = json!({
                "status": "dispatched",
                "delegate_chat_id": delegate_chat_id,
                "child_run_id": delegate_chat_id,
                // The background note ("will not be returned") is false for
                // async, and a model that believed it would never plan on the
                // answer arriving.
                "note": if is_async {
                    "the result will be delivered into this conversation when the task finishes"
                } else {
                    "the result will not be returned to this conversation"
                },
            });
            if is_async && let Some(object) = model_output.as_object_mut() {
                object.insert("run_mode".to_string(), json!("async"));
            }
            identity(&mut model_output);
            (
                ToolCallStatus::Success,
                BgToolCallStatus::Success,
                MessageToolCallStatus::Success,
                ui_output,
                model_output.to_string(),
            )
        }
        // A suspended child only reaches here from a route that does not
        // carry parked requests up — the mention route, whose children are
        // refused at the gate and so never park. Settling it as an
        // `input_required` envelope keeps the slot coherent for a reader
        // rather than leaving the turn to guess.
        Ok(crate::services::delegation::DelegationDispatchOutcome::Suspended {
            child_chat_id,
            assistant_id: child_assistant_id,
            assistant_name,
            trace,
            ..
        }) => {
            let envelope = crate::services::delegation::suspended_envelope(
                child_chat_id,
                child_assistant_id,
                assistant_name,
                tool_call.call_id.clone(),
            );
            (
                ToolCallStatus::Error,
                BgToolCallStatus::Error,
                MessageToolCallStatus::Error,
                envelope.output_value(&trace),
                envelope.model_response_text(),
            )
        }
        // Cancelled before it ever started, so the envelope's required
        // child ids would be a fiction. Their absence is the signal that
        // nothing ran.
        Ok(crate::services::delegation::DelegationDispatchOutcome::NeverStarted { reason }) => {
            let output_value = json!({
                "status": "cancelled",
                "reason": reason,
                "parent_tool_call_id": tool_call.call_id,
            });
            (
                ToolCallStatus::Error,
                BgToolCallStatus::Error,
                MessageToolCallStatus::Error,
                output_value.clone(),
                output_value.to_string(),
            )
        }
        Err(error) => (
            ToolCallStatus::Error,
            BgToolCallStatus::Error,
            MessageToolCallStatus::Error,
            json!({ "status": "error", "error": error }),
            format!("Delegation refused: {error}"),
        ),
    };
    let tool_error = matches!(status, ToolCallStatus::Error).then(|| response_text.clone());
    // Settle the execution slot or the earlier argument-generation slot;
    // providers without argument chunks still append here.
    let settled_index =
        reserved.unwrap_or_else(|| tool_call_content_index(content, &tool_call.call_id));
    let settled = ContentPart::ToolUse(ToolUse {
        tool_call_id: tool_call.call_id.clone(),
        status: message_status,
        tool_name: tool_call.fn_name.clone(),
        input: Some(tool_call.fn_arguments.clone()),
        progress_message: None,
        progress: None,
        total: None,
        output: Some(output_value.clone()),
        started_at: Some(tool_call_started),
        ended_at: Some(now_timestamp()),
    });
    // Written before the events below, because sending to the
    // client can fail the turn and a reserved slot must never be
    // left reading "working" for a child that has finished.
    match reserved {
        Some(index) => content[index] = settled,
        None if settled_index < content.len() => content[settled_index] = settled,
        None => content.push(settled),
    }
    if reserved.is_some() {
        commit_message_content_mid_turn(
            app_state,
            policy,
            subject,
            assistant_message_id,
            content,
            "task settle",
        )
        .await;
    }
    let update_event = MessageSubmitStreamingResponseToolCallUpdate {
        message_id: assistant_message_id,
        content_index: settled_index,
        tool_call_id: tool_call.call_id.clone(),
        tool_name: tool_call.fn_name.clone(),
        input: Some(tool_call.fn_arguments.clone()),
        status,
        progress_message: None,
        progress: None,
        total: None,
        output: Some(output_value.clone()),
    };
    if let Some(task) = streaming_task {
        send_background_event(
            task,
            StreamingEvent::ToolCallUpdate {
                message_id: assistant_message_id,
                content_index: settled_index,
                tool_call_id: tool_call.call_id.clone(),
                tool_name: tool_call.fn_name.clone(),
                input: Some(tool_call.fn_arguments.clone()),
                status: bg_status,
                progress_message: None,
                progress: None,
                total: None,
                output: Some(output_value.clone()),
            },
            "broadcast delegation tool update",
        )
        .await;
    }
    let message: MSG = update_event.into();
    send_generation_event(&message, tx.clone()).await?;
    persist_otel_tool_call(
        tracing_client,
        tool_call,
        Some(output_value),
        otel_tool_call_start_time,
        Some(SystemTime::now()),
        otel_parent_observation_id,
        assistant_id,
        platform,
        tool_error.as_deref(),
    )
    .await;
    Ok(genai::chat::ToolResponse {
        call_id: tool_call.call_id.clone(),
        content: response_text,
    })
}

/// One awaited child that stopped to ask.
///
/// Held until the batch has finished so the requests can be carried up in ONE
/// part: "parked" means "the last part is a `tool_approval_request`", so a
/// second part would make the row unreadable to every check that relies on it.
struct ParkedChild {
    /// The origin call the child answers. Its id is the approval id, because
    /// that is the slot a decision settles.
    tool_call: genai::chat::ToolCall,
    child_chat_id: Uuid,
    child_message_id: Uuid,
    /// The child's own request, copied so the card renders without reading
    /// another chat. The child's row stays the executable truth.
    request: ContentPartToolApprovalRequest,
}

/// The one `delegated_task` approval part a parked batch leaves behind.
///
/// The flat fields describe the first item only, for readers that predate
/// `approvals`; `mcp_server_id` is empty because no server is being asked
/// about, and a card MUST branch on `kind` before reading any of them.
fn delegated_task_approval_part(
    parked: &[ParkedChild],
    pending_tool_calls: Vec<crate::models::message::PendingToolCall>,
    allow_always: bool,
) -> ContentPartToolApprovalRequest {
    let approvals: Vec<ApprovalItem> = parked
        .iter()
        .map(|child| {
            // The child parked on exactly one call - its gate stops the batch
            // at the first gated one - so the first item is that call.
            let gated = child.request.approval_items().into_iter().next();
            let (child_tool_call_id, child_tool_name, child_input) = gated
                .map(|item| (item.tool_call_id, item.tool_name, item.input))
                .unwrap_or_else(|| {
                    (
                        child.request.tool_call_id.clone(),
                        child.request.tool_name.clone(),
                        child.request.input.clone(),
                    )
                });
            ApprovalItem {
                approval_id: child.tool_call.call_id.clone(),
                tool_call_id: child.tool_call.call_id.clone(),
                tool_name: child.tool_call.fn_name.clone(),
                input: child.tool_call.fn_arguments.clone(),
                child: Some(crate::models::message::ChildApprovalRef {
                    child_chat_id: child.child_chat_id,
                    child_message_id: child.child_message_id,
                    child_tool_call_id,
                    tool_name: child_tool_name,
                    mcp_server_id: child.request.mcp_server_id.clone(),
                    input: child_input,
                    annotations: child.request.annotations.clone(),
                    preset: child.request.preset.clone(),
                    requested_at: child.request.requested_at.clone(),
                }),
            }
        })
        .collect();
    let head = &parked[0];
    ContentPartToolApprovalRequest {
        tool_call_id: head.tool_call.call_id.clone(),
        tool_name: erato_config::config::DELEGATE_TASK_TOOL_NAME.to_string(),
        mcp_server_id: String::new(),
        input: head.tool_call.fn_arguments.clone(),
        annotations: head.request.annotations.clone(),
        preset: head.request.preset.clone(),
        allow_always,
        requested_at: now_timestamp(),
        kind: crate::models::message::ToolApprovalKind::DelegatedTask,
        approvals,
        pending_tool_calls,
    }
}

/// The `task_plan` approval part a gated batch leaves behind.
///
/// One item per gated task call, so the user can approve part of a plan and
/// drop the rest; `child` is absent on every one of them because no child
/// exists yet — that is the whole point of asking before dispatch. The rest of
/// the batch, task calls the policy did not target included, rides along as
/// `pending_tool_calls` and runs once the decision is in.
fn task_plan_approval_part(
    batch_id: usize,
    gated: &[genai::chat::ToolCall],
    pending_tool_calls: Vec<crate::models::message::PendingToolCall>,
) -> ContentPartToolApprovalRequest {
    let approvals: Vec<ApprovalItem> = gated
        .iter()
        .enumerate()
        .map(|(position, call)| ApprovalItem {
            approval_id: format!("plan:{batch_id}:{position}"),
            tool_call_id: call.call_id.clone(),
            tool_name: call.fn_name.clone(),
            input: call.fn_arguments.clone(),
            child: None,
        })
        .collect();
    let head = &gated[0];
    ContentPartToolApprovalRequest {
        tool_call_id: head.call_id.clone(),
        tool_name: erato_config::config::DELEGATE_TASK_TOOL_NAME.to_string(),
        mcp_server_id: String::new(),
        input: head.fn_arguments.clone(),
        // No MCP tool is being asked about, so there is nothing to annotate;
        // the values are the pessimistic MCP defaults a card would read for a
        // tool that declared none.
        annotations: crate::models::message::ToolApprovalAnnotations {
            read_only_hint: false,
            destructive_hint: true,
            idempotent_hint: false,
            open_world_hint: true,
        },
        preset: String::new(),
        // No standing "always allow" for a plan in v1: what a deployment is
        // willing to dispatch unasked is `[delegation.tasks.approval]`'s to say,
        // not a per-user setting's.
        allow_always: false,
        requested_at: now_timestamp(),
        kind: crate::models::message::ToolApprovalKind::TaskPlan,
        approvals,
        pending_tool_calls,
    }
}

/// Turn one task outcome into a part, or hold the slot open when the child
/// stopped to ask.
///
/// `None` means the slot is parked: a suspended run owes the model no response
/// yet, and the turn ends before the model is called again. The slot keeps its
/// reserved index and an `input_required` output — never `output: None`, which
/// history replay would re-emit as an empty tool response.
#[allow(clippy::too_many_arguments)]
async fn settle_or_park_delegation_slot<
    MSG: SendAsSseEvent + From<MessageSubmitStreamingResponseToolCallUpdate>,
>(
    settled: SettledTask,
    parked_children: &mut Vec<ParkedChild>,
    content: &mut Vec<ContentPart>,
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    assistant_message_id: Uuid,
    assistant_id: Option<Uuid>,
    streaming_task: Option<&Arc<StreamingTask>>,
    tracing_client: Option<&TracingLangfuseClient>,
    platform: &str,
    tx: &Sender<Result<Event, Report>>,
) -> Result<Option<(usize, genai::chat::ToolResponse)>, Report> {
    let SettledTask { meta, outcome } = settled;
    let outcome = match outcome {
        Ok(crate::services::delegation::DelegationDispatchOutcome::Suspended {
            child_chat_id,
            child_message_id,
            assistant_id: child_assistant_id,
            assistant_name,
            request,
            trace,
        }) => {
            let output = crate::services::delegation::suspended_envelope(
                child_chat_id,
                child_assistant_id,
                assistant_name,
                meta.tool_call.call_id.clone(),
            )
            .output_value(&trace);
            let slot = match content.get_mut(meta.slot) {
                Some(ContentPart::ToolUse(part)) => {
                    part.output = Some(output.clone());
                    part.ended_at = None;
                    meta.slot
                }
                // Unreachable on the task route, which reserves the slot
                // before it launches. A lost record would be worse than a
                // part out of call order, so the output is kept either way.
                _ => {
                    content.push(ContentPart::ToolUse(ToolUse {
                        tool_call_id: meta.tool_call.call_id.clone(),
                        status: MessageToolCallStatus::InProgress,
                        tool_name: meta.tool_call.fn_name.clone(),
                        input: Some(meta.tool_call.fn_arguments.clone()),
                        progress_message: None,
                        progress: None,
                        total: None,
                        output: Some(output.clone()),
                        started_at: Some(meta.tool_call_started.clone()),
                        ended_at: None,
                    }));
                    content.len() - 1
                }
            };
            commit_message_content_mid_turn(
                app_state,
                policy,
                subject,
                assistant_message_id,
                content,
                "task park",
            )
            .await;
            announce_reserved_task_slot::<MSG>(
                &meta.tool_call,
                slot,
                output,
                assistant_message_id,
                streaming_task,
                tx,
            )
            .await?;
            parked_children.push(ParkedChild {
                tool_call: meta.tool_call,
                child_chat_id,
                child_message_id,
                request: *request,
            });
            return Ok(None);
        }
        outcome => outcome,
    };
    let response = settle_delegation_slot::<MSG>(
        outcome,
        &meta.tool_call,
        Some(meta.slot),
        meta.tool_call_started,
        meta.otel_tool_call_start_time,
        meta.otel_parent_observation_id,
        content,
        app_state,
        policy,
        subject,
        assistant_message_id,
        assistant_id,
        streaming_task,
        tracing_client,
        platform,
        tx,
    )
    .await?;
    Ok(Some((meta.batch_position, response)))
}

/// Preparation and execution share an identity, but only `client_tool_call`
/// authorizes a host executor. These updates are display-only on both SSE paths.
#[allow(clippy::too_many_arguments)]
async fn send_tool_generation_update<
    MSG: SendAsSseEvent + From<MessageSubmitStreamingResponseToolCallUpdate>,
>(
    message_id: Uuid,
    content_index: usize,
    call: &genai::chat::ToolCall,
    status: ToolCallStatus,
    progress: Option<f64>,
    task: Option<&Arc<StreamingTask>>,
    tx: &Sender<Result<Event, Report>>,
) -> Result<(), Report> {
    if let Some(task) = task {
        let bg_status = match status {
            ToolCallStatus::Preparing => BgToolCallStatus::Preparing,
            ToolCallStatus::InProgress => BgToolCallStatus::InProgress,
            ToolCallStatus::Success => BgToolCallStatus::Success,
            ToolCallStatus::Error => BgToolCallStatus::Error,
        };
        send_background_event(
            task,
            StreamingEvent::ToolCallUpdate {
                message_id,
                content_index,
                tool_call_id: call.call_id.clone(),
                tool_name: call.fn_name.clone(),
                input: Some(call.fn_arguments.clone()),
                status: bg_status,
                progress_message: None,
                progress,
                total: None,
                output: None,
            },
            "broadcast tool generation progress",
        )
        .await;
    }
    let message: MSG = MessageSubmitStreamingResponseToolCallUpdate {
        message_id,
        content_index,
        tool_call_id: call.call_id.clone(),
        tool_name: call.fn_name.clone(),
        input: Some(call.fn_arguments.clone()),
        status,
        progress_message: None,
        progress,
        total: None,
        output: None,
    }
    .into();
    send_generation_event(&message, tx.clone()).await
}

/// Tell the client what a reserved task slot is doing.
///
/// The commit beside this call makes the slot durable; this makes it visible
/// without a reload. `tool_call_proposed` cannot carry it — that event has no
/// output field — so the placeholder rides the same update event the settle
/// uses, still `in_progress`, distinguished only by `output.status`.
#[allow(clippy::too_many_arguments)]
async fn announce_reserved_task_slot<
    MSG: SendAsSseEvent + From<MessageSubmitStreamingResponseToolCallUpdate>,
>(
    tool_call: &genai::chat::ToolCall,
    slot: usize,
    output: JsonValue,
    assistant_message_id: Uuid,
    streaming_task: Option<&Arc<StreamingTask>>,
    tx: &Sender<Result<Event, Report>>,
) -> Result<(), Report> {
    if let Some(task) = streaming_task {
        send_background_event(
            task,
            StreamingEvent::ToolCallUpdate {
                message_id: assistant_message_id,
                content_index: slot,
                tool_call_id: tool_call.call_id.clone(),
                tool_name: tool_call.fn_name.clone(),
                input: Some(tool_call.fn_arguments.clone()),
                status: BgToolCallStatus::InProgress,
                progress_message: None,
                progress: None,
                total: None,
                output: Some(output.clone()),
            },
            "broadcast reserved task slot",
        )
        .await;
    }
    let message: MSG = MessageSubmitStreamingResponseToolCallUpdate {
        message_id: assistant_message_id,
        content_index: slot,
        tool_call_id: tool_call.call_id.clone(),
        tool_name: tool_call.fn_name.clone(),
        input: Some(tool_call.fn_arguments.clone()),
        status: ToolCallStatus::InProgress,
        progress_message: None,
        progress: None,
        total: None,
        output: Some(output),
    }
    .into();
    send_generation_event(&message, tx.clone()).await
}

/// Waits for an abort, or forever when there is no stream to abort.
///
/// `select!` needs a future in every arm; a turn with no streaming task simply
/// never takes this one.
async fn wait_for_optional_abort(streaming_task: Option<&Arc<StreamingTask>>) {
    match streaming_task {
        Some(task) => task.wait_for_abort().await,
        None => std::future::pending::<()>().await,
    }
}

/// What a reserved task slot has to remember between its launch and its settle.
struct TaskSlotMeta {
    slot: usize,
    /// Position of the call in the batch the model emitted. The batch settles
    /// out of order; the model is answered in order.
    batch_position: usize,
    tool_call: genai::chat::ToolCall,
    tool_call_started: String,
    otel_tool_call_start_time: Option<SystemTime>,
    otel_parent_observation_id: Option<String>,
}

/// A validated task call that has not started yet, because the turn already
/// has as many runs in flight as it is allowed.
struct PendingTask {
    meta: TaskSlotMeta,
    prepared: crate::services::delegation::PreparedTask,
}

/// A task run that has finished, however it finished.
struct SettledTask {
    meta: TaskSlotMeta,
    outcome: Result<crate::services::delegation::DelegationDispatchOutcome, String>,
}

/// Boxed so that a launch failure and a real run are the same type: both go
/// into the in-flight set, and the join is the one place either becomes a part.
type InFlightTask<'a> =
    std::pin::Pin<Box<dyn std::future::Future<Output = SettledTask> + Send + 'a>>;

/// Start one validated task and hand back its wait.
///
/// Launches are sequential even when the waits are not: one call to this
/// function completes before the next begins, which is what keeps refusals in
/// call order and the launch-side counters free of races. Only the waiting
/// fans out.
///
/// A launch that fails comes back as an already-finished wait carrying the
/// refusal, so the caller has exactly one shape to handle. The returned value
/// is the placeholder output for a child that really started; `None` means the
/// slot will be settled immediately by the join.
async fn launch_prepared_task<'a>(
    app_state: &'a AppState,
    policy: &PolicyEngine,
    context: &DelegationDispatchContext<'_>,
    streaming_task: Option<&'a Arc<StreamingTask>>,
    assistant_message_id: Uuid,
    pending: PendingTask,
) -> (Option<JsonValue>, InFlightTask<'a>) {
    let PendingTask { meta, prepared } = pending;
    let crate::services::delegation::PreparedTask {
        target,
        brief,
        run_mode,
        scheduling,
    } = prepared;
    match crate::services::delegation::launch_delegation(
        app_state,
        policy,
        context,
        target,
        crate::services::delegation::LaunchRunSpec {
            run_mode: run_mode.into(),
            scheduling,
            parent_tool_call_id: Some(meta.tool_call.call_id.clone()),
            retry_of: None,
            parent_message_id: Some(assistant_message_id),
        },
        brief,
    )
    .await
    {
        Ok(crate::services::delegation::LaunchOutcome::Launched(launched)) => {
            let output = crate::services::delegation::task_placeholder_output(&launched);
            let parent =
                streaming_task.map(|task| crate::services::delegation::DelegationParentStream {
                    task,
                    message_id: assistant_message_id,
                    content_index: meta.slot,
                });
            (
                Some(output),
                Box::pin(async move {
                    let outcome = crate::services::delegation::await_delegation(
                        app_state,
                        launched,
                        parent,
                        &meta.tool_call,
                    )
                    .await;
                    SettledTask {
                        meta,
                        outcome: Ok(outcome),
                    }
                }),
            )
        }
        // An `async` task takes this arm: the dispatch settles its own slot at
        // once and needs no wait, because its answer comes home later as its
        // own row rather than as this call's result.
        Ok(crate::services::delegation::LaunchOutcome::Dispatched {
            assistant_id,
            assistant_name,
            delegate_chat_id,
            run_mode,
        }) => (
            None,
            Box::pin(std::future::ready(SettledTask {
                meta,
                outcome: Ok(
                    crate::services::delegation::DelegationDispatchOutcome::Dispatched {
                        assistant_id,
                        assistant_name,
                        delegate_chat_id,
                        run_mode,
                    },
                ),
            })),
        ),
        Err(error) => (
            None,
            Box::pin(std::future::ready(SettledTask {
                meta,
                outcome: Err(error),
            })),
        ),
    }
}

#[allow(clippy::too_many_arguments)]
#[instrument(skip_all)]
async fn stream_generate_chat_completion<
    'a,
    MSG: SendAsSseEvent
        + From<MessageSubmitStreamingResponseMessageTextDelta>
        + From<MessageSubmitStreamingResponseMessageReasoningDelta>
        + From<MessageSubmitStreamingResponseToolCallProposed>
        + From<MessageSubmitStreamingResponseToolCallUpdate>
        + From<MessageSubmitStreamingResponseClientToolCall>
        + From<MessageSubmitStreamingResponseError>,
>(
    tx: Sender<Result<Event, Report>>,
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_request: ChatRequest,
    langfuse_trace_enrichment: LangfuseTraceEnrichment,
    chat_options: ChatOptions,
    assistant_message_id: Uuid,
    user_id: String,
    chat_id: Uuid,
    chat_provider_id: Option<&str>,
    _user_groups: &[String],
    mcp_auth_context: McpRequestAuthContext<'_>,
    mcp_servers_unavailable: Vec<String>,
    mcp_servers_needing_auth: Vec<String>,
    mcp_servers_disabled_by_user: Vec<String>,
    mcp_tools_disabled_by_user: Vec<String>,
    allowed_tool_names: HashSet<String>,
    available_mcp_tools: Vec<crate::services::mcp_session_manager::ManagedTool>,
    offered_client_tools: HashMap<String, crate::services::client_tools::OfferedClientTool>,
    chat_provider_headers_context: &'a ChatProviderHeadersContext<'a>,
    streaming_task: Option<&Arc<StreamingTask>>,
    assistant_id: Option<Uuid>,
    initial_message_content: Vec<ContentPart>,
    is_delegated_run: bool,
    // Whether a delegated run of this chat may stop on an approval-gated MCP
    // call and let its origin turn ask, instead of having the call refused.
    // Always `false` for a turn that is not a delegated run at all.
    child_may_park: bool,
    delegation: Option<DelegationDispatchContext<'_>>,
    // What this run may spend on tool calls, when it is a task run. `None`
    // for every ordinary turn and for a mention run, which stay bounded by
    // `generation.max_tool_calls_per_message` as before.
    task_tool_budgets: Option<crate::services::delegation::TaskToolBudgets>,
    // Set only by the approval continuation: the calls a parked batch never
    // reached, so the first turn dispatches them instead of going straight to
    // the model. `None` for a generation that starts from a user message.
    resume: Option<ParkedTurnResume>,
) -> Result<(Vec<ContentPart>, Option<GenerationMetadata>), Report> {
    let mcp = app_state.mcp_state().await;
    // Record the real assistant message id on the streaming task. `start_task`
    // only had a placeholder id; client-tool results are routed to a task by
    // message_id (the id the client receives in `client_tool_call`), so it must
    // be the real one before any client tool can be called.
    if let Some(task) = streaming_task {
        task.set_message_id(assistant_message_id);
    }

    // Initialize Langfuse tracing if enabled
    let langfuse_enabled = app_state.config.integrations.langfuse.enabled
        && app_state.config.integrations.langfuse.tracing_enabled;

    let tracing_client = if langfuse_enabled {
        let (_, trace_id) = generate_langfuse_ids();
        let generation_name = generate_name_from_chat_request(&chat_request);

        tracing::debug!(
            "Starting Langfuse tracing for generation: trace_id={}, name={:?}",
            trace_id,
            generation_name
        );

        Some(TracingLangfuseClient::new(
            app_state.langfuse_client.clone(),
            trace_id,
            Some(user_id.clone()),
            Some(chat_id.to_string()),
        ))
    } else {
        None
    };

    let langfuse_generation_name = if langfuse_enabled {
        generate_name_from_chat_request(&chat_request)
    } else {
        None
    };
    if let Some(client) = tracing_client.as_ref().filter(|client| client.uses_otel()) {
        let initial_tool_names = HashSet::new();
        let model_tags = HashSet::from([langfuse_model_tag(&langfuse_model_name(
            app_state,
            chat_provider_id,
        ))]);
        let metadata = langfuse_trace_enrichment.trace_metadata(
            assistant_id,
            &initial_tool_names,
            &mcp_servers_unavailable,
            &mcp_servers_needing_auth,
            false,
        );
        let tags = langfuse_trace_enrichment.all_tags(&model_tags, &initial_tool_names);
        if let Err(error) =
            create_trace_from_chat(client, &chat_request, metadata, Some(tags)).await
        {
            tracing::warn!(
                error = %error,
                trace_id = %client.trace_id(),
                "Failed to persist initial Langfuse OTEL trace"
            );
        }
    }
    let langfuse_trace_id = tracing_client
        .as_ref()
        .map(|client| client.trace_id().to_string());
    let max_tool_calls_per_message = app_state.config.generation.max_tool_calls_per_message;
    // Default time the loop holds a turn open awaiting a client tool's result
    // before giving up (the backstop that prevents a never-answering client
    // from leaking the parked turn). A client tool counts as one normal
    // iteration against `max_tool_calls_per_message`, but this park time is NOT a
    // generation wall-clock budget. A per-facet `client_tool.timeout_ms` (see
    // the park below) overrides this default per tool.
    const DEFAULT_CLIENT_TOOL_PARK_TIMEOUT_MS: u64 = 60_000;
    struct PendingWait {
        /// Where the call sat in the batch, so its answer is fed back in call
        /// order like every other.
        batch_position: usize,
        tool_call: genai::chat::ToolCall,
        seconds: u64,
        deadline: tokio::time::Instant,
        tool_call_started: String,
        otel_tool_call_start_time: Option<SystemTime>,
        tool_call_parent_observation_id: Option<String>,
        error: Option<String>,
    }
    let (mut unfinished_tool_calls, approved_task_call_ids): (
        std::collections::VecDeque<genai::chat::ToolCall>,
        HashSet<String>,
    ) = resume.map_or_else(
        || (std::collections::VecDeque::new(), HashSet::new()),
        |resume| {
            (
                resume.initial_unfinished_tool_calls.into(),
                resume.approved_task_call_ids,
            )
        },
    );
    let mut current_turn = 0;
    let mut current_tool_call_count = 0;
    // Charged per class and never summed: a run that has spent its server
    // budget may still make client calls, and the other way round.
    let mut task_server_tool_calls: u32 = 0;
    let mut task_client_tool_calls: u32 = 0;
    let mut submission_attempts: HashMap<String, u32> = HashMap::new();
    // At most one successful client-action proposal per generation: the
    // client needs a single authoritative proposal, so duplicate or
    // conflicting calls after the first are answered with an error.
    let mut client_action_already_proposed = false;

    let mut current_message_content = initial_message_content;
    let mut current_turn_chat_request = chat_request.clone();
    let fallback_chat_provider_id = if chat_provider_id.is_none() {
        match app_state.config.determine_chat_provider(None, None) {
            Ok(provider_id) => Some(provider_id),
            Err(error) => {
                warn_and_capture_error("resolve hallucination-suppression chat provider", &error);
                None
            }
        }
    } else {
        None
    };
    let hallucination_suppression_config = chat_provider_id
        .or(fallback_chat_provider_id)
        .map(|provider_id| {
            app_state
                .config
                .get_chat_provider(provider_id)
                .hallucination_suppression
                .clone()
        })
        .unwrap_or_default();
    let mut hallucination_suppression =
        HallucinationSuppressionState::new(hallucination_suppression_config);
    let available_mcp_tools_by_name: HashMap<
        String,
        crate::services::mcp_session_manager::ManagedTool,
    > = available_mcp_tools
        .into_iter()
        .map(|tool| (tool.tool.name.to_string(), tool))
        .collect();

    // Track cumulative usage statistics across all turns
    let mut total_prompt_tokens = 0u32;
    let mut total_completion_tokens = 0u32;
    let mut total_total_tokens = 0u32;
    let mut total_reasoning_tokens = 0u32;
    let mut captured_reasoning_summary = String::new();
    let mut captured_reasoning_items: Vec<genai::chat::ReasoningItem> = vec![];
    let mut captured_reasoning_item_encrypted_content: Vec<String> = vec![];

    let build_generation_metadata =
        |total_prompt_tokens: u32,
         total_completion_tokens: u32,
         total_total_tokens: u32,
         total_reasoning_tokens: u32,
         langfuse_trace_id: Option<String>,
         was_aborted: bool,
         error: Option<GenerationErrorType>,
         reasoning_summary: Option<String>,
         reasoning_items: Option<Vec<genai::chat::ReasoningItem>>,
         reasoning_item_encrypted_content: Option<Vec<String>>| {
            if total_prompt_tokens > 0
                || total_completion_tokens > 0
                || total_total_tokens > 0
                || total_reasoning_tokens > 0
                || reasoning_summary.is_some()
                || reasoning_items.is_some()
                || reasoning_item_encrypted_content.is_some()
                || langfuse_trace_id.is_some()
                || was_aborted
                || error.is_some()
                || !mcp_servers_unavailable.is_empty()
                || !mcp_servers_needing_auth.is_empty()
                || !mcp_servers_disabled_by_user.is_empty()
                || !mcp_tools_disabled_by_user.is_empty()
            {
                Some(GenerationMetadata {
                    used_prompt_tokens: if total_prompt_tokens > 0 {
                        Some(total_prompt_tokens)
                    } else {
                        None
                    },
                    used_completion_tokens: if total_completion_tokens > 0 {
                        Some(total_completion_tokens)
                    } else {
                        None
                    },
                    used_total_tokens: if total_total_tokens > 0 {
                        Some(total_total_tokens)
                    } else {
                        None
                    },
                    used_reasoning_tokens: if total_reasoning_tokens > 0 {
                        Some(total_reasoning_tokens)
                    } else {
                        None
                    },
                    reasoning_summary,
                    reasoning_items,
                    reasoning_item_encrypted_content,
                    langfuse_trace_id,
                    was_aborted: was_aborted.then_some(true),
                    error,
                    mcp_servers_unavailable: (!mcp_servers_unavailable.is_empty())
                        .then(|| mcp_servers_unavailable.clone()),
                    mcp_servers_needing_auth: (!mcp_servers_needing_auth.is_empty())
                        .then(|| mcp_servers_needing_auth.clone()),
                    mcp_servers_disabled_by_user: (!mcp_servers_disabled_by_user.is_empty())
                        .then(|| mcp_servers_disabled_by_user.clone()),
                    mcp_tools_disabled_by_user: (!mcp_tools_disabled_by_user.is_empty())
                        .then(|| mcp_tools_disabled_by_user.clone()),
                    // A generation that reaches this builder has ended, so
                    // whatever a continuation owed this message it no longer
                    // does.
                    continuation_in_flight: None,
                })
            } else {
                None
            }
        };

    // Track all tool calls across all turns for Langfuse metadata
    let mut all_tool_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut all_model_tags: HashSet<String> = HashSet::new();
    let mut tool_call_parent_observation_ids: HashMap<String, String> = HashMap::new();
    let mut tool_call_started_at: HashMap<String, String> = HashMap::new();

    let completion = 'loop_call_turns: loop {
        current_turn += 1;
        tracing::debug!("Starting chat completion turn {}", current_turn);
        let chat_provider_metric_label = chat_provider_id.unwrap_or("unknown");
        let provider_request_start = Instant::now();
        let mut first_response_elapsed: Option<Duration> = None;
        let mut last_response_elapsed: Option<Duration> = None;

        // Track timing for this specific turn
        let turn_start_time = if langfuse_enabled {
            Some(SystemTime::now())
        } else {
            None
        };
        let (turn_obs_id, _) = generate_langfuse_ids();
        let turn_langfuse_model_name = langfuse_model_name(app_state, chat_provider_id);
        let turn_langfuse_generation_name =
            langfuse_turn_name(langfuse_generation_name.as_deref(), current_turn);

        if current_turn != 1 && unfinished_tool_calls.is_empty() {
            tracing::warn!(
                "Trying to progress chat completion after first iteration without open tool calls. Will likely result in error."
            )
        }
        // First work off open tool calls, in the order the model emitted them
        // — for a parallel batch of client-action proposals the FIRST one
        // must be the one that wins.
        // Paired with the call's position in the batch: task runs settle out
        // of order, and the model is answered in the order it asked.
        let batch_call_count = unfinished_tool_calls.len();
        let mut current_turn_tool_responses: Vec<(usize, genai::chat::ToolResponse)> = vec![];
        let mut pending_waits = Vec::new();
        let mut in_flight: futures::stream::FuturesUnordered<InFlightTask<'_>> =
            futures::stream::FuturesUnordered::new();
        let mut queued_tasks: std::collections::VecDeque<PendingTask> =
            std::collections::VecDeque::new();
        // Read once per batch rather than per call: the scope is fixed for the
        // turn, and a value that moved mid-batch would make the bound a lie.
        let effective_max_parallel = delegation
            .as_ref()
            .and_then(|context| context.task_scope.as_ref())
            .map_or(1, |scope| scope.effective.max_parallel.max(1) as usize);
        let mut batch_position = 0usize;
        // Set by an exit inside the pop loop. The join below still has to run
        // — leaving children in flight with their slots reading "working" is
        // worse than the exit it was trying to make.
        let mut exit_after_join = false;
        let mut exit_metadata: Option<GenerationMetadata> = None;
        // An error that ends the turn still has to let the join settle the
        // children it already started, or they run on with their slots frozen
        // at "working" and nothing ever writes their outcome.
        let mut exit_error: Option<Report> = None;
        // An approval reached mid-batch. The part must be the LAST one, and it
        // must not reach disk until the batch it interrupted has settled.
        let mut pending_approval_part: Option<ContentPartToolApprovalRequest> = None;
        // Children that stopped to ask. Collected rather than acted on, because
        // the requests are carried up in one part after the rest of the batch
        // has settled — a child that parks must not abandon its siblings.
        let mut parked_children: Vec<ParkedChild> = Vec::new();
        // The dispatch-approval gate, before the first call is popped: `plan`
        // is a statement about the batch's size, so no per-call hook could
        // answer it, and asking about a plan whose first child has already been
        // created would be asking after the fact. Nothing is reserved, launched
        // or announced ahead of it, which is why a parked plan leaves no
        // `queued` slots behind.
        if let Some(effective) = delegation
            .as_ref()
            .and_then(|context| context.task_scope.as_ref())
            .map(|scope| &scope.effective)
        {
            let batch: Vec<genai::chat::ToolCall> = unfinished_tool_calls.iter().cloned().collect();
            let gated_positions = crate::services::delegation::tasks_needing_dispatch_approval(
                effective,
                &batch,
                |call| {
                    call.fn_name == erato_config::config::DELEGATE_TASK_TOOL_NAME
                        // An MCP tool of the same name wins, exactly as it does
                        // in the dispatch branch below: the synthetic tool is
                        // never offered in that case.
                        && !available_mcp_tools_by_name.contains_key(&call.fn_name)
                        && !approved_task_call_ids.contains(&call.call_id)
                },
            );
            if !gated_positions.is_empty() {
                let gated: Vec<genai::chat::ToolCall> = gated_positions
                    .iter()
                    .map(|position| batch[*position].clone())
                    .collect();
                let pending_tool_calls = batch
                    .iter()
                    .enumerate()
                    .filter(|(position, _)| !gated_positions.contains(position))
                    .map(|(_, call)| crate::models::message::PendingToolCall {
                        call_id: call.call_id.clone(),
                        fn_name: call.fn_name.clone(),
                        fn_arguments: call.fn_arguments.clone(),
                    })
                    .collect();
                unfinished_tool_calls.clear();
                pending_approval_part = Some(task_plan_approval_part(
                    // The turn whose model call emitted this batch: the pop
                    // loop runs one turn after the call that filled it, and an
                    // id counted from the call is the one a reader can place.
                    current_turn.saturating_sub(1),
                    &gated,
                    pending_tool_calls,
                ));
                exit_metadata = build_generation_metadata(
                    total_prompt_tokens,
                    total_completion_tokens,
                    total_total_tokens,
                    total_reasoning_tokens,
                    langfuse_trace_id.clone(),
                    false,
                    None,
                    non_empty_string(&captured_reasoning_summary),
                    non_empty_vec(&captured_reasoning_items),
                    non_empty_vec(&captured_reasoning_item_encrypted_content),
                );
                exit_after_join = true;
            }
        }
        'pop_calls: while let Some(unfinished_tool_call) = unfinished_tool_calls.pop_front() {
            let batch_position = {
                let position = batch_position;
                batch_position += 1;
                position
            };
            // Settle whatever finished while the loop was busy with the last
            // call. Waiting for the join would freeze a finished child's slot
            // at "working" for as long as the rest of the batch takes — a
            // client-tool park is a minute by default, an MCP call has no
            // bound at all — and leave its progress tap filling meanwhile.
            loop {
                let Some(Some(settled)) = futures::FutureExt::now_or_never(in_flight.next()) else {
                    break;
                };
                match settle_or_park_delegation_slot::<MSG>(
                    settled,
                    &mut parked_children,
                    &mut current_message_content,
                    app_state,
                    policy,
                    subject,
                    assistant_message_id,
                    assistant_id,
                    streaming_task,
                    tracing_client.as_ref(),
                    &langfuse_trace_enrichment.platform,
                    &tx,
                )
                .await
                {
                    Ok(Some(response)) => current_turn_tool_responses.push(response),
                    // Parked: nothing to answer the model with, and the part
                    // that asks is pushed after the join.
                    Ok(None) => {}
                    // Through the join like every other exit, so the rest of
                    // the batch is still settled.
                    Err(error) => {
                        exit_error = Some(error);
                        break 'pop_calls;
                    }
                }
            }
            // A park ends the batch: the calls after it belong to the
            // continuation, and the one just popped has not been looked at yet.
            // The join below still runs, so the siblings still in flight are
            // awaited and settled before the request is carried up.
            if !parked_children.is_empty() {
                unfinished_tool_calls.push_front(unfinished_tool_call);
                break 'pop_calls;
            }
            let otel_tool_call_start_time = tracing_client
                .as_ref()
                .filter(|client| client.uses_otel())
                .map(|_| SystemTime::now());
            if streaming_task.is_some_and(|task| task.is_abort_requested()) {
                let generation_metadata = build_generation_metadata(
                    total_prompt_tokens,
                    total_completion_tokens,
                    total_total_tokens,
                    total_reasoning_tokens,
                    langfuse_trace_id.clone(),
                    true,
                    None,
                    non_empty_string(&captured_reasoning_summary),
                    non_empty_vec(&captured_reasoning_items),
                    non_empty_vec(&captured_reasoning_item_encrypted_content),
                );
                // Leave the batch, but not before the join below: children are
                // already running and their slots must not be left open.
                exit_metadata = generation_metadata;
                exit_after_join = true;
                break 'pop_calls;
            }

            // A task run is bounded by its own two budgets instead of the
            // per-message cap: it was launched with an allowance, and running
            // out of it is an ordinary outcome rather than a failure. The
            // call is refused and the run continues, so the model finishes in
            // prose with a partial — but usable and resumable — answer.
            //
            // Only a call that would actually be dispatched is charged. A name
            // the model invented is rejected further down by
            // `allowed_tool_names` and never runs, so billing it would let
            // hallucinations drain a real allowance — and, with a budget of
            // `0`, would answer an invalid name with "you are out of budget",
            // telling the model nothing about what was actually wrong with it.
            let budget_refusal = task_tool_budgets
                .filter(|_| allowed_tool_names.contains(unfinished_tool_call.fn_name.as_str()))
                .and_then(|budgets| {
                let class = crate::services::delegation::classify_task_tool_call(
                    &unfinished_tool_call.fn_name,
                    available_mcp_tools_by_name
                        .contains_key(unfinished_tool_call.fn_name.as_str()),
                );
                match class {
                    crate::services::delegation::TaskToolClass::Exempt => None,
                    crate::services::delegation::TaskToolClass::Server => {
                        if task_server_tool_calls >= budgets.server {
                            Some("This task has used all of its tool calls that run on the server; finish with what you have.")
                        } else {
                            task_server_tool_calls += 1;
                            None
                        }
                    }
                    crate::services::delegation::TaskToolClass::Client => {
                        if task_client_tool_calls >= budgets.client {
                            Some("This task has used all of its tool calls that run on your device; finish with what you have.")
                        } else {
                            task_client_tool_calls += 1;
                            None
                        }
                    }
                }
            });

            // The per-message cap is the outer backstop for every turn,
            // including a task run — the per-task budgets bound the work a
            // task may DISPATCH, but exempt and refused calls still cost a
            // round trip each, so something has to stop a model that keeps
            // proposing them.
            //
            // For a task run it must not kill the turn. The child's partial
            // answer IS the result its parent is waiting for, and a
            // `return Err` here discards it: the content is only persisted on
            // the success path, so the error path hands the parent
            // `{"status":"failed"}` with nothing in it. Ending the turn
            // gracefully keeps what the child has and reports it as the
            // partial, resumable result it is.
            if current_tool_call_count >= max_tool_calls_per_message {
                if let Some(task) = streaming_task.filter(|_| task_tool_budgets.is_some()) {
                    tracing::warn!(
                        chat_id = %chat_id,
                        max_tool_calls_per_message,
                        "Task run reached the per-message tool-call backstop; \
                         ending the turn with the answer it has"
                    );
                    task.mark_tool_budget_exhausted();
                    let generation_metadata = build_generation_metadata(
                        total_prompt_tokens,
                        total_completion_tokens,
                        total_total_tokens,
                        total_reasoning_tokens,
                        langfuse_trace_id.clone(),
                        false,
                        None,
                        non_empty_string(&captured_reasoning_summary),
                        non_empty_vec(&captured_reasoning_items),
                        non_empty_vec(&captured_reasoning_item_encrypted_content),
                    );
                    // Leave the batch, but not before the join below: children are
                    // already running and their slots must not be left open.
                    exit_metadata = generation_metadata;
                    exit_after_join = true;
                    break 'pop_calls;
                }
                // Still an error for an ordinary turn, exactly as before —
                // but raised after the join, so a batch already in flight is
                // settled rather than orphaned.
                exit_error = Some(eyre!(
                    "Maximum tool call count per message ({max_tool_calls_per_message}) exceeded"
                ));
                break 'pop_calls;
            }
            current_tool_call_count += 1;
            let tool_index =
                tool_call_content_index(&current_message_content, &unfinished_tool_call.call_id);
            let was_preparing = matches!(current_message_content.get(tool_index), Some(ContentPart::ToolUse(part)) if part.status == MessageToolCallStatus::Preparing);
            // Emit event for tool call proposed
            {
                let unfinished_tool_call = unfinished_tool_call.clone();
                let tool_call_start_time = now_timestamp();
                tool_call_started_at
                    .insert(unfinished_tool_call.call_id.clone(), tool_call_start_time);
                if was_preparing {
                    send_tool_generation_update::<MSG>(
                        assistant_message_id,
                        tool_index,
                        &unfinished_tool_call,
                        ToolCallStatus::InProgress,
                        None,
                        streaming_task,
                        &tx,
                    )
                    .await?;
                } else {
                    let proposed_call = MessageSubmitStreamingResponseToolCallProposed {
                        message_id: assistant_message_id,
                        content_index: tool_index,
                        tool_call_id: unfinished_tool_call.call_id.clone(),
                        tool_name: unfinished_tool_call.fn_name.clone(),
                        input: Some(unfinished_tool_call.fn_arguments.clone()),
                    };
                    // Forward to streaming_task if present
                    if let Some(task) = streaming_task {
                        send_background_event(
                            task,
                            StreamingEvent::ToolCallProposed {
                                message_id: assistant_message_id,
                                content_index: tool_index,
                                tool_call_id: unfinished_tool_call.call_id,
                                tool_name: unfinished_tool_call.fn_name,
                                input: Some(unfinished_tool_call.fn_arguments),
                            },
                            "broadcast proposed tool call",
                        )
                        .await;
                    }
                    let message: MSG = proposed_call.into();
                    send_generation_event(&message, tx.clone()).await?;
                }
            }

            // Budget refusal, decided above and emitted here so it lands
            // before every dispatch branch and so client tools are bounded
            // the same way MCP tools are.
            if let Some(error_message) = budget_refusal {
                if let Some(task) = streaming_task {
                    // The refusal part is indistinguishable from any other
                    // refusal, so the run says out of band that it stopped at
                    // a budget: a partial answer is a different outcome from
                    // a failed one, and only this flag can tell them apart.
                    task.mark_tool_budget_exhausted();
                }
                let tool_call_started = tool_call_started_at
                    .remove(&unfinished_tool_call.call_id)
                    .unwrap_or_else(now_timestamp);
                persist_otel_tool_call(
                    tracing_client.as_ref(),
                    &unfinished_tool_call,
                    Some(json!({ "error": error_message })),
                    otel_tool_call_start_time,
                    Some(SystemTime::now()),
                    tool_call_parent_observation_ids.remove(&unfinished_tool_call.call_id),
                    assistant_id,
                    &langfuse_trace_enrichment.platform,
                    Some(error_message),
                )
                .await;
                upsert_tool_use(
                    &mut current_message_content,
                    ToolUse {
                        tool_call_id: unfinished_tool_call.call_id.clone(),
                        status: MessageToolCallStatus::Error,
                        tool_name: unfinished_tool_call.fn_name.clone(),
                        input: Some(unfinished_tool_call.fn_arguments.clone()),
                        progress_message: None,
                        progress: None,
                        total: None,
                        output: Some(json!({ "status": "rejected", "error": error_message })),
                        started_at: Some(tool_call_started),
                        ended_at: Some(now_timestamp()),
                    },
                );
                current_turn_tool_responses.push((
                    batch_position,
                    genai::chat::ToolResponse {
                        call_id: unfinished_tool_call.call_id.clone(),
                        content: error_message.to_string(),
                    },
                ));
                continue;
            }

            if !allowed_tool_names.contains(unfinished_tool_call.fn_name.as_str()) {
                // Refuse the CALL, never the TURN — a `return Err` here kills
                // the generation (user sees an empty message); an error
                // response lets the model recover in prose.
                let error_message = format!(
                    "Proposed tool call '{}' is not allowed for this request",
                    unfinished_tool_call.fn_name
                );
                let tool_call_started = tool_call_started_at
                    .remove(&unfinished_tool_call.call_id)
                    .unwrap_or_else(now_timestamp);
                persist_otel_tool_call(
                    tracing_client.as_ref(),
                    &unfinished_tool_call,
                    Some(json!({ "error": error_message })),
                    otel_tool_call_start_time,
                    Some(SystemTime::now()),
                    tool_call_parent_observation_ids.remove(&unfinished_tool_call.call_id),
                    assistant_id,
                    &langfuse_trace_enrichment.platform,
                    Some(&error_message),
                )
                .await;
                upsert_tool_use(
                    &mut current_message_content,
                    ToolUse {
                        tool_call_id: unfinished_tool_call.call_id.clone(),
                        status: MessageToolCallStatus::Error,
                        tool_name: unfinished_tool_call.fn_name.clone(),
                        input: Some(unfinished_tool_call.fn_arguments.clone()),
                        progress_message: None,
                        progress: None,
                        total: None,
                        output: Some(json!({ "status": "error", "error": error_message })),
                        started_at: Some(tool_call_started),
                        ended_at: Some(now_timestamp()),
                    },
                );
                current_turn_tool_responses.push((
                    batch_position,
                    genai::chat::ToolResponse {
                        call_id: unfinished_tool_call.call_id.clone(),
                        content: error_message,
                    },
                ));
                continue;
            }

            // A wait is deliberately deferred until the rest of this
            // assistant turn's tool-call batch has been processed. This lets
            // a model dispatch or poll several independent MCP calls before
            // the next completion, while still making the continuation wait
            // for the requested duration.
            if unfinished_tool_call.fn_name == crate::services::mcp_wait::WAIT_TOOL_NAME
                && !available_mcp_tools_by_name
                    .contains_key(crate::services::mcp_wait::WAIT_TOOL_NAME)
            {
                let tool_call_started = tool_call_started_at
                    .remove(&unfinished_tool_call.call_id)
                    .unwrap_or_else(now_timestamp);
                let tool_call_parent_observation_id =
                    tool_call_parent_observation_ids.remove(&unfinished_tool_call.call_id);
                match crate::services::mcp_wait::parse_wait_seconds(
                    &unfinished_tool_call.fn_arguments,
                    mcp.config.mcp_servers_global.max_wait_seconds,
                ) {
                    Ok(seconds) => pending_waits.push(PendingWait {
                        batch_position,
                        tool_call: unfinished_tool_call,
                        seconds,
                        deadline: tokio::time::Instant::now() + Duration::from_secs(seconds),
                        tool_call_started,
                        otel_tool_call_start_time,
                        tool_call_parent_observation_id,
                        error: None,
                    }),
                    Err(error) => pending_waits.push(PendingWait {
                        batch_position,
                        tool_call: unfinished_tool_call,
                        seconds: 0,
                        deadline: tokio::time::Instant::now(),
                        tool_call_started,
                        otel_tool_call_start_time,
                        tool_call_parent_observation_id,
                        error: Some(error),
                    }),
                }
                continue;
            }

            // Client-action proposals are never executed server-side: validate
            // the input against the enum offered on this request, record the
            // ToolUse part for the client to consume after user confirmation,
            // and answer the model so the turn can continue. An MCP tool that
            // happens to use the same name takes precedence (the synthetic
            // tool is never offered in that case — see prepare).
            if unfinished_tool_call.fn_name
                == crate::services::client_actions::CLIENT_ACTION_TOOL_NAME
                && !available_mcp_tools_by_name
                    .contains_key(crate::services::client_actions::CLIENT_ACTION_TOOL_NAME)
            {
                let allowed_actions =
                    crate::services::client_actions::allowed_client_actions_from_tools(
                        current_turn_chat_request.tools.as_ref(),
                    );
                let tool_call_started = tool_call_started_at
                    .remove(&unfinished_tool_call.call_id)
                    .unwrap_or_else(now_timestamp);
                let tool_call_parent_observation_id =
                    tool_call_parent_observation_ids.remove(&unfinished_tool_call.call_id);
                let validated = crate::services::client_actions::validate_client_action_input(
                    &unfinished_tool_call.fn_arguments,
                    &allowed_actions,
                )
                .and_then(|action| {
                    if client_action_already_proposed {
                        Err(
                            "a client action was already proposed for this message; only one proposal is allowed and it cannot be changed"
                                .to_string(),
                        )
                    } else {
                        Ok(action)
                    }
                });
                let (status, bg_status, message_status, output_value, response_text) =
                    match validated {
                        Ok(action) => {
                            client_action_already_proposed = true;
                            (
                                ToolCallStatus::Success,
                                BgToolCallStatus::Success,
                                MessageToolCallStatus::Success,
                                json!({ "status": "proposed", "action": action }),
                                format!(
                                    "Proposed client action '{action}' to the user. The user's application will ask for confirmation and perform it. Do not call this tool again for this request and do not claim the action has been executed."
                                ),
                            )
                        }
                        Err(error) => (
                            ToolCallStatus::Error,
                            BgToolCallStatus::Error,
                            MessageToolCallStatus::Error,
                            json!({ "status": "rejected", "error": error }),
                            format!("Invalid client action proposal: {error}"),
                        ),
                    };
                let tool_error =
                    matches!(status, ToolCallStatus::Error).then(|| response_text.clone());
                let update_event = MessageSubmitStreamingResponseToolCallUpdate {
                    message_id: assistant_message_id,
                    content_index: tool_index,
                    tool_call_id: unfinished_tool_call.call_id.clone(),
                    tool_name: unfinished_tool_call.fn_name.clone(),
                    input: Some(unfinished_tool_call.fn_arguments.clone()),
                    status,
                    progress_message: None,
                    progress: None,
                    total: None,
                    output: Some(output_value.clone()),
                };
                if let Some(task) = streaming_task {
                    send_background_event(
                        task,
                        StreamingEvent::ToolCallUpdate {
                            message_id: assistant_message_id,
                            content_index: tool_index,
                            tool_call_id: unfinished_tool_call.call_id.clone(),
                            tool_name: unfinished_tool_call.fn_name.clone(),
                            input: Some(unfinished_tool_call.fn_arguments.clone()),
                            status: bg_status,
                            progress_message: None,
                            progress: None,
                            total: None,
                            output: Some(output_value.clone()),
                        },
                        "broadcast client-action tool update",
                    )
                    .await;
                }
                let message: MSG = update_event.into();
                send_generation_event(&message, tx.clone()).await?;
                upsert_tool_use(
                    &mut current_message_content,
                    ToolUse {
                        tool_call_id: unfinished_tool_call.call_id.clone(),
                        status: message_status,
                        tool_name: unfinished_tool_call.fn_name.clone(),
                        input: Some(unfinished_tool_call.fn_arguments.clone()),
                        progress_message: None,
                        progress: None,
                        total: None,
                        output: Some(output_value.clone()),
                        started_at: Some(tool_call_started),
                        ended_at: Some(now_timestamp()),
                    },
                );
                persist_otel_tool_call(
                    tracing_client.as_ref(),
                    &unfinished_tool_call,
                    Some(output_value),
                    otel_tool_call_start_time,
                    Some(SystemTime::now()),
                    tool_call_parent_observation_id,
                    assistant_id,
                    &langfuse_trace_enrichment.platform,
                    tool_error.as_deref(),
                )
                .await;
                current_turn_tool_responses.push((
                    batch_position,
                    genai::chat::ToolResponse {
                        call_id: unfinished_tool_call.call_id.clone(),
                        content: response_text,
                    },
                ));
                continue;
            }

            // Delegated assistant run: `delegate_to_assistant` executes
            // server-side as a child chat run — awaited (result envelope
            // returns into this turn) or background (the call settles at
            // launch and the child finishes on its own). Must stay BEFORE
            // the by-construction client-tool branch below, which treats
            // every offered non-MCP name as a client tool. An MCP tool with
            // the same name takes precedence (the synthetic tool is never
            // offered in that case — see prepare). Every failure refuses the
            // CALL, never the TURN.
            if crate::services::delegation::is_delegation_tool_name(&unfinished_tool_call.fn_name)
                && !available_mcp_tools_by_name.contains_key(&unfinished_tool_call.fn_name)
            {
                let is_task_route =
                    unfinished_tool_call.fn_name == erato_config::config::DELEGATE_TASK_TOOL_NAME;
                let tool_call_started = tool_call_started_at
                    .remove(&unfinished_tool_call.call_id)
                    .unwrap_or_else(now_timestamp);
                let tool_call_parent_observation_id =
                    tool_call_parent_observation_ids.remove(&unfinished_tool_call.call_id);
                let slot = tool_index;

                // The task route never settles here. A call either starts now
                // or waits for a free slot, and the join after this loop is
                // the single place every task outcome is turned into a part.
                if is_task_route {
                    let prepared = match delegation.as_ref() {
                        Some(context) => crate::services::delegation::validate_task_tool_call(
                            app_state,
                            context,
                            &unfinished_tool_call,
                        ),
                        None => Err("Delegation is not available for this request.".to_string()),
                    };
                    let prepared = match prepared {
                        Ok(prepared) => prepared,
                        Err(error) => {
                            // Refused before anything was reserved, so the
                            // refusal simply takes the next index.
                            let response = settle_delegation_slot::<MSG>(
                                Err(error),
                                &unfinished_tool_call,
                                None,
                                tool_call_started,
                                otel_tool_call_start_time,
                                tool_call_parent_observation_id,
                                &mut current_message_content,
                                app_state,
                                policy,
                                subject,
                                assistant_message_id,
                                assistant_id,
                                streaming_task,
                                tracing_client.as_ref(),
                                &langfuse_trace_enrichment.platform,
                                &tx,
                            )
                            .await?;
                            current_turn_tool_responses.push((batch_position, response));
                            continue;
                        }
                    };

                    let pending = PendingTask {
                        meta: TaskSlotMeta {
                            slot,
                            batch_position,
                            tool_call: unfinished_tool_call.clone(),
                            tool_call_started: tool_call_started.clone(),
                            otel_tool_call_start_time,
                            otel_parent_observation_id: tool_call_parent_observation_id.clone(),
                        },
                        prepared,
                    };
                    // Reserved whether or not it starts now: the slot is what
                    // keeps a batch in call order, and a queued one is already
                    // worth showing — it names no child because none exists.
                    upsert_tool_use(
                        &mut current_message_content,
                        ToolUse {
                            tool_call_id: unfinished_tool_call.call_id.clone(),
                            status: MessageToolCallStatus::InProgress,
                            tool_name: unfinished_tool_call.fn_name.clone(),
                            input: Some(unfinished_tool_call.fn_arguments.clone()),
                            progress_message: None,
                            progress: None,
                            total: None,
                            output: Some(crate::services::delegation::queued_placeholder_output()),
                            started_at: Some(tool_call_started),
                            ended_at: None,
                        },
                    );
                    let mut announced =
                        Some(crate::services::delegation::queued_placeholder_output());
                    match delegation.as_ref() {
                        Some(context) if in_flight.len() < effective_max_parallel => {
                            let (placeholder, task) = launch_prepared_task(
                                app_state,
                                policy,
                                context,
                                streaming_task,
                                assistant_message_id,
                                pending,
                            )
                            .await;
                            if let Some(output) = placeholder {
                                if let Some(ContentPart::ToolUse(part)) =
                                    current_message_content.get_mut(slot)
                                {
                                    part.output = Some(output.clone());
                                }
                                announced = Some(output);
                            } else {
                                // Settling immediately in the join; nothing
                                // worth announcing as a state of its own.
                                announced = None;
                            }
                            in_flight.push(task);
                        }
                        _ => queued_tasks.push_back(pending),
                    }
                    if let Some(output) = announced {
                        announce_reserved_task_slot::<MSG>(
                            &unfinished_tool_call,
                            slot,
                            output,
                            assistant_message_id,
                            streaming_task,
                            &tx,
                        )
                        .await?;
                    }
                    commit_message_content_mid_turn(
                        app_state,
                        policy,
                        subject,
                        assistant_message_id,
                        &current_message_content,
                        "task launch",
                    )
                    .await;
                    continue;
                }

                let outcome = match delegation.as_ref() {
                    Some(context) => {
                        let parent = streaming_task.map(|task| {
                            crate::services::delegation::DelegationParentStream {
                                task,
                                message_id: assistant_message_id,
                                content_index: slot,
                            }
                        });
                        crate::services::delegation::dispatch_delegate_tool_call(
                            app_state,
                            policy,
                            context,
                            &unfinished_tool_call,
                            parent,
                        )
                        .await
                    }
                    None => Err("Delegation is not available for this request.".to_string()),
                };
                let response = settle_delegation_slot::<MSG>(
                    outcome,
                    &unfinished_tool_call,
                    None,
                    tool_call_started,
                    otel_tool_call_start_time,
                    tool_call_parent_observation_id,
                    &mut current_message_content,
                    app_state,
                    policy,
                    subject,
                    assistant_message_id,
                    assistant_id,
                    streaming_task,
                    tracing_client.as_ref(),
                    &langfuse_trace_enrichment.platform,
                    &tx,
                )
                .await?;
                current_turn_tool_responses.push((batch_position, response));
                continue;
            }

            // Client tool (returning round-trip): the model called a tool the
            // active facet declared as a `client_tool`. It is neither an MCP
            // tool nor the client-action tool, so it must be EXECUTED ON THE
            // CLIENT. We emit a `client_tool_call`, SUSPEND this turn on a
            // per-call channel, and resume when the client POSTs the result —
            // like an MCP tool, but executed on the client. By construction
            // anything offered that is not an MCP tool, not the client action,
            // and neither delegation tool (`delegate_to_assistant`,
            // `delegate_task`) is a client tool; hallucinated names were
            // already rejected by the `allowed_tool_names` check above.
            if !available_mcp_tools_by_name.contains_key(unfinished_tool_call.fn_name.as_str()) {
                let call_id = unfinished_tool_call.call_id.clone();
                let tool_name = unfinished_tool_call.fn_name.clone();
                let content_index = tool_index;
                let tool_input = unfinished_tool_call.fn_arguments.clone();
                let tool_call_started = tool_call_started_at
                    .remove(&call_id)
                    .unwrap_or_else(now_timestamp);
                let tool_call_parent_observation_id =
                    tool_call_parent_observation_ids.remove(&call_id);

                let Some(task) = streaming_task else {
                    // No streaming task to park on (non-streaming caller):
                    // answer the model with an error so it can recover.
                    let response_text =
                        "Client tool execution is unavailable for this request.".to_string();
                    upsert_tool_use(
                        &mut current_message_content,
                        ToolUse {
                            tool_call_id: call_id.clone(),
                            status: MessageToolCallStatus::Error,
                            tool_name: tool_name.clone(),
                            input: Some(tool_input.clone()),
                            progress_message: None,
                            progress: None,
                            total: None,
                            output: Some(json!({ "status": "error", "error": response_text })),
                            started_at: Some(tool_call_started),
                            ended_at: Some(now_timestamp()),
                        },
                    );
                    persist_otel_tool_call(
                        tracing_client.as_ref(),
                        &unfinished_tool_call,
                        Some(json!({ "status": "error", "error": response_text })),
                        otel_tool_call_start_time,
                        Some(SystemTime::now()),
                        tool_call_parent_observation_id,
                        assistant_id,
                        &langfuse_trace_enrichment.platform,
                        Some(&response_text),
                    )
                    .await;
                    current_turn_tool_responses.push((
                        batch_position,
                        genai::chat::ToolResponse {
                            call_id,
                            content: response_text,
                        },
                    ));
                    continue;
                };

                let tool_policy = offered_client_tools.get(&tool_name);
                let submission = tool_policy.and_then(|policy| policy.submission.as_ref());
                let attempt = if submission.is_some() {
                    let attempt = submission_attempts.entry(tool_name.clone()).or_default();
                    *attempt += 1;
                    *attempt
                } else {
                    0
                };
                // A submission is a single final artifact, never one of several
                // parallel candidates. Reject it before invoking a host executor.
                let validation_failure = submission.and_then(|submission| {
                    if batch_call_count != 1 {
                        Some(ClientToolOutcome::ValidationFailed(vec![
                            crate::services::client_tools::ClientToolValidationIssue {
                                path: String::new(),
                                code: "submission_must_be_alone".into(),
                                message: "Call the submission tool alone after completing other tool calls.".into(),
                            }
                        ]))
                    } else { submission.validate(&tool_input) }
                });
                let outcome = if let Some(failure) = validation_failure {
                    failure
                } else {
                    // Register interest BEFORE emitting the call event, so a result
                    // POSTed immediately cannot race ahead of the registered waiter.
                    let mut result_rx = task.register_client_tool_call(call_id.clone()).await;

                    // Signal the client to execute: broadcast (submit path + resume
                    // replay) AND the typed tx stream (regenerate/edit path).
                    send_background_event(
                        task,
                        StreamingEvent::ClientToolCall {
                            message_id: assistant_message_id,
                            content_index,
                            tool_call_id: call_id.clone(),
                            tool_name: tool_name.clone(),
                            input: Some(tool_input.clone()),
                        },
                        "broadcast client tool call",
                    )
                    .await;
                    let call_event = MessageSubmitStreamingResponseClientToolCall {
                        message_id: assistant_message_id,
                        content_index,
                        tool_call_id: call_id.clone(),
                        tool_name: tool_name.clone(),
                        input: Some(tool_input.clone()),
                    };
                    let call_message: MSG = call_event.into();
                    // Best-effort on the typed stream: the client is, by design,
                    // away executing the tool and POSTing to a separate endpoint
                    // during the park, so a dropped SSE connection here must NOT
                    // abort the generation. The broadcast + resume history is the
                    // durable signal path.
                    if let Err(error) = call_message.send_event_report(tx.clone()).await {
                        warn_and_capture_error(
                            "send best-effort client tool call SSE event",
                            &error,
                        );
                    }

                    // Resolve this tool's park budget from the entry that was
                    // OFFERED to this request (a bare-name config scan would be
                    // ambiguous when namespaces reuse a name), else the default.
                    let park_timeout_ms = tool_policy
                        .and_then(|policy| policy.timeout_ms)
                        .unwrap_or(DEFAULT_CLIENT_TOOL_PARK_TIMEOUT_MS);

                    // Park until the client POSTs a result, an abort arrives, or the
                    // bounded timeout fires.
                    enum Park {
                        Delivered(ClientToolOutcome),
                        Aborted,
                        TimedOut,
                    }
                    let park = tokio::select! {
                        received = &mut result_rx => match received {
                            Ok(outcome) => Park::Delivered(outcome),
                            // Sender dropped without delivering (e.g. task replaced).
                            Err(_) => Park::TimedOut,
                        },
                        _ = task.wait_for_abort() => Park::Aborted,
                        _ = tokio::time::sleep(tokio::time::Duration::from_millis(
                            park_timeout_ms,
                        )) => Park::TimedOut,
                    };

                    // Drop the pending entry, then settle the timeout/abort-vs-
                    // delivery boundary race: if the client's result landed just as
                    // we gave up, prefer it over discarding (and over the endpoint
                    // having reported a spurious success).
                    task.remove_pending_client_tool(&call_id).await;
                    let raced_in = result_rx.try_recv().ok();

                    match park {
                        Park::Delivered(outcome) => outcome,
                        Park::TimedOut => {
                            raced_in.unwrap_or_else(|| ClientToolOutcome::Cancelled {
                                reason: "timeout".to_string(),
                            })
                        }
                        Park::Aborted => {
                            // User cancelled: discard any raced-in result and mirror
                            // the drain's abort exit.
                            persist_otel_tool_call(
                                tracing_client.as_ref(),
                                &unfinished_tool_call,
                                Some(json!({ "status": "cancelled", "reason": "aborted" })),
                                otel_tool_call_start_time,
                                Some(SystemTime::now()),
                                tool_call_parent_observation_id.clone(),
                                assistant_id,
                                &langfuse_trace_enrichment.platform,
                                Some("Client tool execution was aborted"),
                            )
                            .await;
                            let generation_metadata = build_generation_metadata(
                                total_prompt_tokens,
                                total_completion_tokens,
                                total_total_tokens,
                                total_reasoning_tokens,
                                langfuse_trace_id.clone(),
                                true,
                                None,
                                non_empty_string(&captured_reasoning_summary),
                                non_empty_vec(&captured_reasoning_items),
                                non_empty_vec(&captured_reasoning_item_encrypted_content),
                            );
                            // Leave the batch, but not before the join below: children are
                            // already running and their slots must not be left open.
                            exit_metadata = generation_metadata;
                            exit_after_join = true;
                            break 'pop_calls;
                        }
                    }
                };

                let (status, bg_status, message_status, mut output_value, mut response_text) =
                    match &outcome {
                        ClientToolOutcome::Result(result, _) => (
                            ToolCallStatus::Success,
                            BgToolCallStatus::Success,
                            MessageToolCallStatus::Success,
                            json!({ "status": "success", "result": result }),
                            result.to_string(),
                        ),
                        ClientToolOutcome::Error(error) => (
                            ToolCallStatus::Error,
                            BgToolCallStatus::Error,
                            MessageToolCallStatus::Error,
                            json!({ "status": "error", "error": error }),
                            format!("Client tool error: {error}"),
                        ),
                        ClientToolOutcome::ValidationFailed(issues) => {
                            let output = json!({ "status": "error", "error": "Submission validation failed", "validation_errors": issues });
                            (
                                ToolCallStatus::Error,
                                BgToolCallStatus::Error,
                                MessageToolCallStatus::Error,
                                output.clone(),
                                output.to_string(),
                            )
                        }
                        // Backend-produced (e.g. park timeout): a typed,
                        // tool_call_id-correlated resolution the client can tell
                        // apart from a genuine tool error (its output carries
                        // `status: "cancelled"` + a machine-readable reason),
                        // while the model still gets a recoverable error string.
                        ClientToolOutcome::Cancelled { reason } => (
                            ToolCallStatus::Error,
                            BgToolCallStatus::Error,
                            MessageToolCallStatus::Error,
                            json!({ "status": "cancelled", "reason": reason }),
                            format!(
                                "Client tool was not completed (reason: {reason}); the client did not return a result in time."
                            ),
                        ),
                    };
                if let Some(submission) = submission {
                    submission.annotate(&mut output_value, &outcome, attempt);
                    response_text = output_value.to_string();
                    if submission.finish_after(&outcome, attempt) {
                        exit_after_join = true;
                        exit_metadata = build_generation_metadata(
                            total_prompt_tokens,
                            total_completion_tokens,
                            total_total_tokens,
                            total_reasoning_tokens,
                            langfuse_trace_id.clone(),
                            false,
                            None,
                            non_empty_string(&captured_reasoning_summary),
                            non_empty_vec(&captured_reasoning_items),
                            non_empty_vec(&captured_reasoning_item_encrypted_content),
                        );
                    }
                }
                let tool_error =
                    matches!(status, ToolCallStatus::Error).then(|| response_text.clone());

                // In-band resolution: write the outcome into history so a resume
                // replay is self-consistent (the client sees the call answered
                // and does not re-execute the tool).
                send_background_event(
                    task,
                    StreamingEvent::ToolCallUpdate {
                        message_id: assistant_message_id,
                        content_index,
                        tool_call_id: call_id.clone(),
                        tool_name: tool_name.clone(),
                        input: Some(tool_input.clone()),
                        status: bg_status,
                        progress_message: None,
                        progress: None,
                        total: None,
                        output: Some(output_value.clone()),
                    },
                    "broadcast client tool result",
                )
                .await;
                let update_event = MessageSubmitStreamingResponseToolCallUpdate {
                    message_id: assistant_message_id,
                    content_index,
                    tool_call_id: call_id.clone(),
                    tool_name: tool_name.clone(),
                    input: Some(tool_input.clone()),
                    status,
                    progress_message: None,
                    progress: None,
                    total: None,
                    output: Some(output_value.clone()),
                };
                let update_message: MSG = update_event.into();
                // Best-effort (see the call event above): a dropped SSE
                // connection after the park must not abort the turn — the result
                // is already recorded to history (broadcast) and persisted below.
                if let Err(error) = update_message.send_event_report(tx.clone()).await {
                    warn_and_capture_error("send best-effort client tool result SSE event", &error);
                }

                upsert_tool_use(
                    &mut current_message_content,
                    ToolUse {
                        tool_call_id: call_id.clone(),
                        status: message_status,
                        tool_name: tool_name.clone(),
                        input: Some(tool_input),
                        progress_message: None,
                        progress: None,
                        total: None,
                        output: Some(output_value.clone()),
                        started_at: Some(tool_call_started),
                        ended_at: Some(now_timestamp()),
                    },
                );
                if let ClientToolOutcome::Result(_, file_ids) = &outcome {
                    current_message_content.extend(
                        super::file_resolution::attach_client_tool_files(
                            app_state, policy, subject, &chat_id, file_ids,
                        )
                        .await?,
                    );
                }
                persist_otel_tool_call(
                    tracing_client.as_ref(),
                    &unfinished_tool_call,
                    Some(output_value),
                    otel_tool_call_start_time,
                    Some(SystemTime::now()),
                    tool_call_parent_observation_id,
                    assistant_id,
                    &langfuse_trace_enrichment.platform,
                    tool_error.as_deref(),
                )
                .await;
                current_turn_tool_responses.push((
                    batch_position,
                    genai::chat::ToolResponse {
                        call_id,
                        content: response_text,
                    },
                ));
                continue;
            }

            let managed_tool = match available_mcp_tools_by_name
                .get(unfinished_tool_call.fn_name.as_str())
            {
                Some(managed_tool) => managed_tool.clone(),
                None => {
                    tool_call_started_at.remove(&unfinished_tool_call.call_id);
                    let error = eyre!(
                        "Failed to resolve MCP tool call '{}': tool was not in the prepared MCP tool set",
                        unfinished_tool_call.fn_name
                    );
                    return Err(error);
                }
            };
            let managed_tool_call = crate::services::mcp_manager::ManagedToolCall {
                server_id: managed_tool.server_id.clone(),
                tool_call: unfinished_tool_call.clone(),
                tool: managed_tool.tool.clone(),
            };

            // MCP approval is a durable stop, not an in-memory park. Persist
            // the request in the assistant message and let `continuestream`
            // rehydrate this point after a user decision.
            let approval_config = &mcp.config.mcp_servers_global.approval;
            // The prepared tool set drops denials only as of prepare time; a
            // denial stored during the generation must still hold here, so
            // the row is read on every call whatever the gate's state.
            let user_decision = match Uuid::parse_str(&user_id) {
                Ok(user_id) => {
                    crate::models::user_tool_approval_setting::find_active_decision(
                        &app_state.db,
                        user_id,
                        &managed_tool_call.server_id,
                        &managed_tool_call.tool.name,
                    )
                    .await?
                }
                Err(_) => None,
            };
            let refusal = match gate_mcp_tool_call(
                approval_config,
                &managed_tool_call.server_id,
                &managed_tool_call.tool,
                &unfinished_tool_call,
                user_decision,
            ) {
                McpToolCallGate::Run => None,
                McpToolCallGate::Refuse(error_message) => Some(error_message),
                McpToolCallGate::Ask(_) if is_delegated_run && !child_may_park => {
                    // A delegated run with nowhere to ask must not park: the
                    // durable stop would surface a half-done
                    // ToolApprovalRequest tail as the delegate's result.
                    // Refuse the CALL so the child completes in prose. A task
                    // child does have a surface and takes the arm below: an
                    // awaited one its slot on the origin turn, an `async` one
                    // its own card, announced to the origin by an
                    // `input_required` delivery.
                    Some(format!(
                        "The tool '{}' requires user approval, which is unavailable in a delegated run; the call was not executed.",
                        unfinished_tool_call.fn_name
                    ))
                }
                McpToolCallGate::Ask(approval_request) => {
                    let mut approval_request = *approval_request;
                    // The rest of the batch lives only in this local queue: the
                    // park abandons it, so without recording it here every call
                    // the model made after the gated one is lost for good.
                    approval_request.pending_tool_calls = unfinished_tool_calls
                        .drain(..)
                        .map(|call| crate::models::message::PendingToolCall {
                            call_id: call.call_id,
                            fn_name: call.fn_name,
                            fn_arguments: call.fn_arguments,
                        })
                        .collect();
                    // Held back rather than pushed: the join below commits the
                    // whole part list every time a task settles, and an
                    // approval part sitting at the tail makes the row look
                    // parked while the turn is still running — which is enough
                    // for a continuation to start a second generation on it.
                    // It goes on after the join, still last.
                    pending_approval_part = Some(approval_request);
                    let generation_metadata = build_generation_metadata(
                        total_prompt_tokens,
                        total_completion_tokens,
                        total_total_tokens,
                        total_reasoning_tokens,
                        langfuse_trace_id.clone(),
                        false,
                        None,
                        non_empty_string(&captured_reasoning_summary),
                        non_empty_vec(&captured_reasoning_items),
                        non_empty_vec(&captured_reasoning_item_encrypted_content),
                    );
                    // Leave the batch, but not before the join below: children are
                    // already running and their slots must not be left open.
                    exit_metadata = generation_metadata;
                    exit_after_join = true;
                    break 'pop_calls;
                }
            };
            if let Some(error_message) = refusal {
                let tool_call_started = tool_call_started_at
                    .remove(&unfinished_tool_call.call_id)
                    .unwrap_or_else(now_timestamp);
                upsert_tool_use(
                    &mut current_message_content,
                    ToolUse {
                        tool_call_id: unfinished_tool_call.call_id.clone(),
                        status: MessageToolCallStatus::Error,
                        tool_name: unfinished_tool_call.fn_name.clone(),
                        input: Some(unfinished_tool_call.fn_arguments.clone()),
                        progress_message: None,
                        progress: None,
                        total: None,
                        output: Some(json!({ "status": "rejected", "error": error_message })),
                        started_at: Some(tool_call_started),
                        ended_at: Some(now_timestamp()),
                    },
                );
                current_turn_tool_responses.push((
                    batch_position,
                    genai::chat::ToolResponse {
                        call_id: unfinished_tool_call.call_id.clone(),
                        content: error_message,
                    },
                ));
                continue;
            }
            let output_schema = managed_tool_call.tool.output_schema.clone();
            let tool_call_span_start_time = if langfuse_enabled {
                Some(SystemTime::now())
            } else {
                None
            };
            let tool_call_parent_observation_id =
                tool_call_parent_observation_ids.remove(&unfinished_tool_call.call_id);
            let (progress_tx, progress_rx) = tokio::sync::mpsc::unbounded_channel();
            let call = mcp.servers.call_tool_with_progress(
                chat_id,
                managed_tool_call,
                &mcp_auth_context,
                Some(progress_tx),
            );
            let tool_call_result = await_mcp_tool_with_progress::<MSG>(
                call,
                progress_rx,
                MessageSubmitStreamingResponseToolCallUpdate {
                    message_id: assistant_message_id,
                    content_index: tool_index,
                    tool_call_id: unfinished_tool_call.call_id.clone(),
                    tool_name: unfinished_tool_call.fn_name.clone(),
                    input: None,
                    status: ToolCallStatus::InProgress,
                    progress_message: None,
                    progress: None,
                    total: None,
                    output: None,
                },
                streaming_task,
                tx.clone(),
            )
            .await;
            let tool_call_end_time = if langfuse_enabled {
                Some(SystemTime::now())
            } else {
                None
            };
            if let (Some(client), Some(start_time), Some(end_time), Some(parent_observation_id)) = (
                tracing_client.as_ref().filter(|client| !client.uses_otel()),
                tool_call_span_start_time,
                tool_call_end_time,
                tool_call_parent_observation_id.clone(),
            ) {
                let client = client.clone();
                let request = current_turn_chat_request.clone();
                let span_name = Some(format!("tool_call: {}", unfinished_tool_call.fn_name));
                let tool_names = vec![unfinished_tool_call.fn_name.clone()];
                let trace_platform = langfuse_trace_enrichment.platform.clone();
                let assistant_id_for_langfuse = assistant_id;
                tokio::spawn(async move {
                    let (span_obs_id, _) = generate_langfuse_ids();
                    if let Err(err) = create_tool_call_span_from_chat(
                        &client,
                        span_obs_id,
                        &request,
                        span_name,
                        Some(start_time),
                        Some(end_time),
                        None,
                        assistant_id_for_langfuse,
                        &tool_names,
                        Some(&trace_platform),
                        Some(parent_observation_id),
                    )
                    .await
                    {
                        tracing::warn!("Failed to send Langfuse span for tool call: {}", err);
                    }
                });
            }
            match tool_call_result {
                Ok(tool_call_result) => {
                    let tool_call_started = tool_call_started_at
                        .remove(&unfinished_tool_call.call_id)
                        .unwrap_or_else(|| {
                            tracing::warn!(
                                "Missing tool call start timestamp for {}",
                                unfinished_tool_call.call_id
                            );
                            now_timestamp()
                        });

                    if let Some(content_filter_error) =
                        parse_content_filter_error_from_mcp_tool_result(&tool_call_result)
                    {
                        let tool_error = serde_json::to_string(&content_filter_error)
                            .unwrap_or_else(|error| {
                                tracing::warn!(
                                    error = ?error,
                                    "Failed to serialize MCP content-filter error"
                                );
                                "MCP tool result was filtered".to_string()
                            });
                        persist_otel_tool_call(
                            tracing_client.as_ref(),
                            &unfinished_tool_call,
                            serialize_json_value(
                                &tool_call_result,
                                "serialize filtered MCP tool result",
                            ),
                            tool_call_span_start_time,
                            tool_call_end_time,
                            tool_call_parent_observation_id.clone(),
                            assistant_id,
                            &langfuse_trace_enrichment.platform,
                            Some(&tool_error),
                        )
                        .await;
                        let error_payload = Some(content_filter_error.clone());
                        let error_event = MessageSubmitStreamingResponseError {
                            message_id: Some(assistant_message_id),
                            error: content_filter_error,
                        };
                        log_chat_completion_generation_error(
                            chat_provider_metric_label,
                            assistant_message_id,
                            &error_event.error,
                        );
                        persist_otel_generation_error(
                            tracing_client.as_ref(),
                            &turn_obs_id,
                            &current_turn_chat_request,
                            &current_message_content,
                            &error_event.error,
                            &turn_langfuse_model_name,
                            &turn_langfuse_generation_name,
                            turn_start_time,
                            assistant_id,
                            &all_tool_names,
                            &langfuse_trace_enrichment.platform,
                        )
                        .await;

                        if let Some(task) = streaming_task
                            && let Some(error_json) = serialize_json_value(
                                MessageSubmitStreamingResponseMessage::Error(error_event.clone()),
                                "serialize MCP content-filter error event",
                            )
                        {
                            send_background_event(
                                task,
                                StreamingEvent::Error {
                                    error: Some(error_json),
                                },
                                "broadcast MCP content-filter error",
                            )
                            .await;
                        }

                        let message: MSG = error_event.into();
                        send_generation_event(&message, tx.clone()).await?;
                        let generation_metadata = build_generation_metadata(
                            total_prompt_tokens,
                            total_completion_tokens,
                            total_total_tokens,
                            total_reasoning_tokens,
                            langfuse_trace_id.clone(),
                            false,
                            error_payload,
                            non_empty_string(&captured_reasoning_summary),
                            non_empty_vec(&captured_reasoning_items),
                            non_empty_vec(&captured_reasoning_item_encrypted_content),
                        );
                        // Leave the batch, but not before the join below: children are
                        // already running and their slots must not be left open.
                        exit_metadata = generation_metadata;
                        exit_after_join = true;
                        break 'pop_calls;
                    }

                    let post_processed = match post_process_mcp_tool_result(
                        app_state,
                        policy,
                        subject,
                        chat_id,
                        &unfinished_tool_call,
                        output_schema.as_ref(),
                        &tool_call_result,
                    )
                    .await
                    {
                        Ok(result) => result,
                        Err(err) => {
                            let tool_error = format!("Failed to process MCP tool output: {err}");
                            let output_value = json!({
                                "status": "error",
                                "error": tool_error,
                            });
                            persist_otel_tool_call(
                                tracing_client.as_ref(),
                                &unfinished_tool_call,
                                serialize_json_value(
                                    &tool_call_result,
                                    "serialize failed MCP tool result",
                                ),
                                tool_call_span_start_time,
                                tool_call_end_time,
                                tool_call_parent_observation_id.clone(),
                                assistant_id,
                                &langfuse_trace_enrichment.platform,
                                Some(&tool_error),
                            )
                            .await;
                            let update_event = MessageSubmitStreamingResponseToolCallUpdate {
                                message_id: assistant_message_id,
                                content_index: tool_index,
                                tool_call_id: unfinished_tool_call.call_id.clone(),
                                tool_name: unfinished_tool_call.fn_name.clone(),
                                input: Some(unfinished_tool_call.fn_arguments.clone()),
                                status: ToolCallStatus::Error,
                                progress_message: None,
                                progress: None,
                                total: None,
                                output: Some(output_value.clone()),
                            };
                            if let Some(task) = streaming_task {
                                send_background_event(
                                    task,
                                    StreamingEvent::ToolCallUpdate {
                                        message_id: assistant_message_id,
                                        content_index: tool_index,
                                        tool_call_id: unfinished_tool_call.call_id.clone(),
                                        tool_name: unfinished_tool_call.fn_name.clone(),
                                        input: Some(unfinished_tool_call.fn_arguments.clone()),
                                        status: BgToolCallStatus::Error,
                                        progress_message: None,
                                        progress: None,
                                        total: None,
                                        output: Some(output_value.clone()),
                                    },
                                    "broadcast failed MCP tool output processing",
                                )
                                .await;
                            }
                            let message: MSG = update_event.into();
                            send_generation_event(&message, tx.clone()).await?;
                            let tool_call_started = tool_call_started_at
                                .remove(&unfinished_tool_call.call_id)
                                .unwrap_or_else(now_timestamp);
                            upsert_tool_use(
                                &mut current_message_content,
                                ToolUse {
                                    tool_call_id: unfinished_tool_call.call_id.clone(),
                                    status: MessageToolCallStatus::Error,
                                    tool_name: unfinished_tool_call.fn_name.clone(),
                                    input: Some(unfinished_tool_call.fn_arguments.clone()),
                                    progress_message: None,
                                    progress: None,
                                    total: None,
                                    output: Some(output_value),
                                    started_at: Some(tool_call_started),
                                    ended_at: Some(now_timestamp()),
                                },
                            );
                            current_turn_tool_responses.push((
                                batch_position,
                                genai::chat::ToolResponse {
                                    call_id: unfinished_tool_call.call_id.clone(),
                                    content: tool_error,
                                },
                            ));
                            continue;
                        }
                    };
                    let tool_response = post_processed.tool_response;
                    let output_value = post_processed.output_value;
                    let file_content_parts = post_processed.file_content_parts;

                    persist_otel_tool_call(
                        tracing_client.as_ref(),
                        &unfinished_tool_call,
                        output_value.clone(),
                        tool_call_span_start_time,
                        tool_call_end_time,
                        tool_call_parent_observation_id.clone(),
                        assistant_id,
                        &langfuse_trace_enrichment.platform,
                        None,
                    )
                    .await;

                    // Emit event for tool call update
                    {
                        let finished_tool_call = unfinished_tool_call.clone();
                        let output_value_for_event = output_value.clone();
                        let proposed_call = MessageSubmitStreamingResponseToolCallUpdate {
                            message_id: assistant_message_id,
                            content_index: tool_index,
                            tool_call_id: finished_tool_call.call_id.clone(),
                            tool_name: finished_tool_call.fn_name.clone(),
                            input: Some(finished_tool_call.fn_arguments.clone()),
                            status: ToolCallStatus::Success,
                            progress_message: None,
                            progress: None,
                            total: None,
                            output: output_value_for_event.clone(),
                        };
                        // Forward to streaming_task if present
                        if let Some(task) = streaming_task {
                            send_background_event(
                                task,
                                StreamingEvent::ToolCallUpdate {
                                    message_id: assistant_message_id,
                                    content_index: tool_index,
                                    tool_call_id: finished_tool_call.call_id,
                                    tool_name: finished_tool_call.fn_name,
                                    input: Some(finished_tool_call.fn_arguments),
                                    status: BgToolCallStatus::Success,
                                    progress_message: None,
                                    progress: None,
                                    total: None,
                                    output: output_value_for_event,
                                },
                                "broadcast completed MCP tool call",
                            )
                            .await;
                        }
                        let message: MSG = proposed_call.into();
                        send_generation_event(&message, tx.clone()).await?;
                    }
                    // Add to current message content
                    {
                        let finished_tool_call = unfinished_tool_call.clone();
                        upsert_tool_use(
                            &mut current_message_content,
                            ToolUse {
                                tool_call_id: finished_tool_call.call_id,
                                status: MessageToolCallStatus::Success,
                                tool_name: finished_tool_call.fn_name,
                                input: Some(finished_tool_call.fn_arguments),
                                progress_message: None,
                                progress: None,
                                total: None,
                                output: output_value.clone(),
                                started_at: Some(tool_call_started.clone()),
                                ended_at: Some(now_timestamp()),
                            },
                        );
                        if !file_content_parts.is_empty() {
                            current_message_content.extend(file_content_parts);
                        }
                    }

                    current_turn_tool_responses.push((batch_position, tool_response))
                }
                Err(err) => {
                    let tool_error = format!("Failed to call MCP tool: {err}");
                    let output_value = json!({
                        "status": "error",
                        "error": tool_error,
                    });
                    persist_otel_tool_call(
                        tracing_client.as_ref(),
                        &unfinished_tool_call,
                        Some(output_value.clone()),
                        tool_call_span_start_time,
                        tool_call_end_time,
                        tool_call_parent_observation_id.clone(),
                        assistant_id,
                        &langfuse_trace_enrichment.platform,
                        Some(&tool_error),
                    )
                    .await;
                    let update_event = MessageSubmitStreamingResponseToolCallUpdate {
                        message_id: assistant_message_id,
                        content_index: tool_index,
                        tool_call_id: unfinished_tool_call.call_id.clone(),
                        tool_name: unfinished_tool_call.fn_name.clone(),
                        input: Some(unfinished_tool_call.fn_arguments.clone()),
                        status: ToolCallStatus::Error,
                        progress_message: None,
                        progress: None,
                        total: None,
                        output: Some(output_value.clone()),
                    };
                    if let Some(task) = streaming_task {
                        send_background_event(
                            task,
                            StreamingEvent::ToolCallUpdate {
                                message_id: assistant_message_id,
                                content_index: tool_index,
                                tool_call_id: unfinished_tool_call.call_id.clone(),
                                tool_name: unfinished_tool_call.fn_name.clone(),
                                input: Some(unfinished_tool_call.fn_arguments.clone()),
                                status: BgToolCallStatus::Error,
                                progress_message: None,
                                progress: None,
                                total: None,
                                output: Some(output_value.clone()),
                            },
                            "broadcast failed MCP tool call",
                        )
                        .await;
                    }
                    let message: MSG = update_event.into();
                    send_generation_event(&message, tx.clone()).await?;
                    let tool_call_started = tool_call_started_at
                        .remove(&unfinished_tool_call.call_id)
                        .unwrap_or_else(now_timestamp);
                    upsert_tool_use(
                        &mut current_message_content,
                        ToolUse {
                            tool_call_id: unfinished_tool_call.call_id.clone(),
                            status: MessageToolCallStatus::Error,
                            tool_name: unfinished_tool_call.fn_name.clone(),
                            input: Some(unfinished_tool_call.fn_arguments.clone()),
                            progress_message: None,
                            progress: None,
                            total: None,
                            output: Some(output_value),
                            started_at: Some(tool_call_started),
                            ended_at: Some(now_timestamp()),
                        },
                    );
                    current_turn_tool_responses.push((
                        batch_position,
                        genai::chat::ToolResponse {
                            call_id: unfinished_tool_call.call_id.clone(),
                            content: tool_error,
                        },
                    ));
                    continue;
                }
            };
        }

        // Join the fanned-out tasks. Launches were sequential and in call
        // order; the waits are not, so this is where a batch stops being a
        // queue and becomes a set. Every task outcome of the turn is turned
        // into a part here and nowhere else.
        //
        // An abort stops further launches but does NOT stop the join: each
        // child answers its own abort with a `cancelled` envelope, and
        // dropping the waits would leave those slots reading "working" for
        // runs that are over.
        // Two ways to stop: the user pressed stop, or the batch decided to
        // leave early. Either way nothing further launches — starting work the
        // turn has already decided not to report would be worse than useless —
        // and the queued slots settle instead.
        let mut aborting = false;
        let mut leaving = exit_after_join || exit_error.is_some();
        while !in_flight.is_empty() || !queued_tasks.is_empty() {
            if !aborting && streaming_task.is_some_and(|task| task.is_abort_requested()) {
                aborting = true;
                leaving = true;
                // An abort noticed in here must end the turn too. Settling the
                // slots correctly and then carrying on to the model would
                // answer a question the user has already withdrawn.
                if !exit_after_join && exit_error.is_none() {
                    exit_after_join = true;
                    exit_metadata = build_generation_metadata(
                        total_prompt_tokens,
                        total_completion_tokens,
                        total_total_tokens,
                        total_reasoning_tokens,
                        langfuse_trace_id.clone(),
                        true,
                        None,
                        non_empty_string(&captured_reasoning_summary),
                        non_empty_vec(&captured_reasoning_items),
                        non_empty_vec(&captured_reasoning_item_encrypted_content),
                    );
                }
            }
            if leaving {
                // A queued call never started, so its slot settles with no
                // child at all — that absence is how a reader tells it from a
                // run that was cancelled partway.
                while let Some(pending) = queued_tasks.pop_front() {
                    let response = settle_delegation_slot::<MSG>(
                        Ok(
                            crate::services::delegation::DelegationDispatchOutcome::NeverStarted {
                                reason:
                                    crate::services::delegation::DelegationRunReason::ParentAbort,
                            },
                        ),
                        &pending.meta.tool_call,
                        Some(pending.meta.slot),
                        pending.meta.tool_call_started,
                        pending.meta.otel_tool_call_start_time,
                        pending.meta.otel_parent_observation_id,
                        &mut current_message_content,
                        app_state,
                        policy,
                        subject,
                        assistant_message_id,
                        assistant_id,
                        streaming_task,
                        tracing_client.as_ref(),
                        &langfuse_trace_enrichment.platform,
                        &tx,
                    )
                    .await?;
                    current_turn_tool_responses.push((pending.meta.batch_position, response));
                }
            }

            // With nothing in flight both select arms below can be disabled at
            // once, which is a panic rather than a wait. Decide here instead.
            if in_flight.is_empty() {
                if queued_tasks.is_empty() {
                    break;
                }
                // Nothing is running and nothing started the rest of the
                // batch. Settle them on the next pass rather than spin.
                leaving = true;
                continue;
            }
            let settled = tokio::select! {
                settled = in_flight.next(), if !in_flight.is_empty() => settled,
                () = wait_for_optional_abort(streaming_task), if !aborting => {
                    aborting = true;
                    continue;
                }
            };
            let Some(settled) = settled else {
                // Nothing left in flight; anything still queued is released on
                // the next pass, which is only reachable while aborting.
                continue;
            };
            if let Some(response) = settle_or_park_delegation_slot::<MSG>(
                settled,
                &mut parked_children,
                &mut current_message_content,
                app_state,
                policy,
                subject,
                assistant_message_id,
                assistant_id,
                streaming_task,
                tracing_client.as_ref(),
                &langfuse_trace_enrichment.platform,
                &tx,
            )
            .await?
            {
                current_turn_tool_responses.push(response);
            }

            // One finished, so one may start — in call order, and only while
            // the turn is still going anywhere.
            while !leaving && in_flight.len() < effective_max_parallel {
                // Re-read the abort here, not just at the top of the join: a
                // stop that lands while a child is settling must stop the NEXT
                // launch, not the one after it. The top of the loop then does
                // the full handling on its next pass.
                if streaming_task.is_some_and(|task| task.is_abort_requested()) {
                    leaving = true;
                    break;
                }
                let Some(pending) = queued_tasks.pop_front() else {
                    break;
                };
                let Some(context) = delegation.as_ref() else {
                    queued_tasks.push_front(pending);
                    break;
                };
                let slot = pending.meta.slot;
                let announce_call = pending.meta.tool_call.clone();
                let (placeholder, task) = launch_prepared_task(
                    app_state,
                    policy,
                    context,
                    streaming_task,
                    assistant_message_id,
                    pending,
                )
                .await;
                if let Some(output) = placeholder {
                    if let Some(ContentPart::ToolUse(part)) = current_message_content.get_mut(slot)
                    {
                        part.output = Some(output.clone());
                    }
                    announce_reserved_task_slot::<MSG>(
                        &announce_call,
                        slot,
                        output,
                        assistant_message_id,
                        streaming_task,
                        &tx,
                    )
                    .await?;
                }
                in_flight.push(task);
                commit_message_content_mid_turn(
                    app_state,
                    policy,
                    subject,
                    assistant_message_id,
                    &current_message_content,
                    "task launch",
                )
                .await;
            }
        }

        // Park-after-settle: every sibling has finished and its slot is in
        // place, so the children's requests can now be carried up as the one
        // part that ends the turn.
        //
        // Skipped when something else already ended the turn. An abort means
        // the user withdrew the question, and a gated call of this turn's own
        // already owns the single approval part — one part carries one kind, so
        // a parked child cannot be folded into an `mcp_tool` card. In both
        // cases the child keeps its `input_required` slot and stays answerable
        // from its own chat.
        if !parked_children.is_empty() {
            if pending_approval_part.is_none() && exit_error.is_none() && !exit_after_join {
                let pending_tool_calls = unfinished_tool_calls
                    .drain(..)
                    .map(|call| crate::models::message::PendingToolCall {
                        call_id: call.call_id,
                        fn_name: call.fn_name,
                        fn_arguments: call.fn_arguments,
                    })
                    .collect();
                pending_approval_part = Some(delegated_task_approval_part(
                    &parked_children,
                    pending_tool_calls,
                    mcp.config.mcp_servers_global.approval.allow_always,
                ));
                exit_metadata = build_generation_metadata(
                    total_prompt_tokens,
                    total_completion_tokens,
                    total_total_tokens,
                    total_reasoning_tokens,
                    langfuse_trace_id.clone(),
                    false,
                    None,
                    non_empty_string(&captured_reasoning_summary),
                    non_empty_vec(&captured_reasoning_items),
                    non_empty_vec(&captured_reasoning_item_encrypted_content),
                );
                exit_after_join = true;
            } else {
                tracing::warn!(
                    chat_id = %chat_id,
                    parked = parked_children.len(),
                    "A task child parked on a turn that cannot carry its request; \
                     it stays answerable from its own chat"
                );
            }
        }

        // After the join, so every settled slot is already in place and the
        // approval is genuinely the last part — which is what the six
        // last-part checks and the continuation both rely on.
        if let Some(approval_request) = pending_approval_part.take() {
            current_message_content.push(ContentPart::ToolApprovalRequest(approval_request));
        }

        if let Some(error) = exit_error {
            return Err(error);
        }
        if exit_after_join {
            break 'loop_call_turns Ok((current_message_content, exit_metadata));
        }

        if !pending_waits.is_empty() {
            let latest_wait_deadline = pending_waits
                .iter()
                .map(|pending_wait| pending_wait.deadline)
                .max()
                .unwrap_or_else(tokio::time::Instant::now);
            if latest_wait_deadline > tokio::time::Instant::now() {
                if let Some(task) = streaming_task {
                    tokio::select! {
                        _ = tokio::time::sleep_until(latest_wait_deadline) => {}
                        _ = task.wait_for_abort() => {
                            let generation_metadata = build_generation_metadata(
                                total_prompt_tokens,
                                total_completion_tokens,
                                total_total_tokens,
                                total_reasoning_tokens,
                                langfuse_trace_id.clone(),
                                true,
                                None,
                                non_empty_string(&captured_reasoning_summary),
                                non_empty_vec(&captured_reasoning_items),
                                non_empty_vec(&captured_reasoning_item_encrypted_content),
                            );
                            break 'loop_call_turns Ok((current_message_content, generation_metadata));
                        }
                    }
                } else {
                    tokio::time::sleep_until(latest_wait_deadline).await;
                }
            }

            for pending_wait in pending_waits {
                let (status, bg_status, message_status, output_value, response_text) =
                    match pending_wait.error {
                        Some(error) => (
                            ToolCallStatus::Error,
                            BgToolCallStatus::Error,
                            MessageToolCallStatus::Error,
                            json!({ "status": "error", "error": error }),
                            format!("Could not wait: {error}"),
                        ),
                        None => (
                            ToolCallStatus::Success,
                            BgToolCallStatus::Success,
                            MessageToolCallStatus::Success,
                            json!({
                                "status": "success",
                                "waited_seconds": pending_wait.seconds,
                            }),
                            format!("Waited for {} seconds.", pending_wait.seconds),
                        ),
                    };
                let tool_error =
                    matches!(status, ToolCallStatus::Error).then(|| response_text.clone());
                let update_event = MessageSubmitStreamingResponseToolCallUpdate {
                    message_id: assistant_message_id,
                    content_index: tool_call_content_index(
                        &current_message_content,
                        &pending_wait.tool_call.call_id,
                    ),
                    tool_call_id: pending_wait.tool_call.call_id.clone(),
                    tool_name: pending_wait.tool_call.fn_name.clone(),
                    input: Some(pending_wait.tool_call.fn_arguments.clone()),
                    status,
                    progress_message: None,
                    progress: None,
                    total: None,
                    output: Some(output_value.clone()),
                };
                if let Some(task) = streaming_task {
                    send_background_event(
                        task,
                        StreamingEvent::ToolCallUpdate {
                            message_id: assistant_message_id,
                            content_index: tool_call_content_index(
                                &current_message_content,
                                &pending_wait.tool_call.call_id,
                            ),
                            tool_call_id: pending_wait.tool_call.call_id.clone(),
                            tool_name: pending_wait.tool_call.fn_name.clone(),
                            input: Some(pending_wait.tool_call.fn_arguments.clone()),
                            status: bg_status,
                            progress_message: None,
                            progress: None,
                            total: None,
                            output: Some(output_value.clone()),
                        },
                        "broadcast completed wait tool call",
                    )
                    .await;
                }
                let message: MSG = update_event.into();
                send_generation_event(&message, tx.clone()).await?;
                upsert_tool_use(
                    &mut current_message_content,
                    ToolUse {
                        tool_call_id: pending_wait.tool_call.call_id.clone(),
                        status: message_status,
                        tool_name: pending_wait.tool_call.fn_name.clone(),
                        input: Some(pending_wait.tool_call.fn_arguments.clone()),
                        progress_message: None,
                        progress: None,
                        total: None,
                        output: Some(output_value.clone()),
                        started_at: Some(pending_wait.tool_call_started),
                        ended_at: Some(now_timestamp()),
                    },
                );
                persist_otel_tool_call(
                    tracing_client.as_ref(),
                    &pending_wait.tool_call,
                    Some(output_value),
                    pending_wait.otel_tool_call_start_time,
                    Some(SystemTime::now()),
                    pending_wait.tool_call_parent_observation_id,
                    assistant_id,
                    &langfuse_trace_enrichment.platform,
                    tool_error.as_deref(),
                )
                .await;
                current_turn_tool_responses.push((
                    pending_wait.batch_position,
                    genai::chat::ToolResponse {
                        call_id: pending_wait.tool_call.call_id,
                        content: response_text,
                    },
                ));
            }
        }

        if !current_turn_tool_responses.is_empty() {
            // The batch finishes out of order — a fanned-out task, a wait —
            // but the model is answered in the order it asked, so its calls
            // line up with the answers to them.
            current_turn_tool_responses.sort_by_key(|(position, _)| *position);
            current_turn_chat_request.messages.push(GenAiChatMessage {
                role: ChatRole::Tool,
                content: MessageContent::from_parts(
                    current_turn_tool_responses
                        .iter()
                        .map(|(_, response)| {
                            genai::chat::ContentPart::ToolResponse(response.clone())
                        })
                        .collect::<Vec<_>>(),
                ),
                options: None,
            });
        }

        let provider_guardrails = app_state.config.chat_provider_guardrails(chat_provider_id);
        match scan_chat_request_for_prompt_injection(
            &current_turn_chat_request,
            &app_state.config.guardrails,
            &provider_guardrails,
        ) {
            Ok(Some(offense)) => {
                let error_event = MessageSubmitStreamingResponseError {
                    message_id: Some(assistant_message_id),
                    error: GenerationErrorType::ContentFilter {
                        error_description: PROMPT_INJECTION_FILTER_ERROR_DESCRIPTION.to_string(),
                        filter_details: Some(prompt_injection_filter_details(offense)),
                    },
                };
                log_chat_completion_generation_error(
                    chat_provider_metric_label,
                    assistant_message_id,
                    &error_event.error,
                );
                report_chat_provider_generation_error(
                    chat_provider_metric_label,
                    &error_event.error,
                );
                persist_otel_generation_error(
                    tracing_client.as_ref(),
                    &turn_obs_id,
                    &current_turn_chat_request,
                    &current_message_content,
                    &error_event.error,
                    &turn_langfuse_model_name,
                    &turn_langfuse_generation_name,
                    turn_start_time,
                    assistant_id,
                    &all_tool_names,
                    &langfuse_trace_enrichment.platform,
                )
                .await;
                let error_payload = Some(error_event.error.clone());

                if let Some(task) = streaming_task
                    && let Some(error_json) = serialize_json_value(
                        MessageSubmitStreamingResponseMessage::Error(error_event.clone()),
                        "serialize guardrail error event",
                    )
                {
                    send_background_event(
                        task,
                        StreamingEvent::Error {
                            error: Some(error_json),
                        },
                        "broadcast prompt-guardrail error",
                    )
                    .await;
                }

                let message: MSG = error_event.into();
                send_generation_event(&message, tx.clone()).await?;
                let generation_metadata = build_generation_metadata(
                    total_prompt_tokens,
                    total_completion_tokens,
                    total_total_tokens,
                    total_reasoning_tokens,
                    langfuse_trace_id.clone(),
                    false,
                    error_payload,
                    non_empty_string(&captured_reasoning_summary),
                    non_empty_vec(&captured_reasoning_items),
                    non_empty_vec(&captured_reasoning_item_encrypted_content),
                );
                break 'loop_call_turns Ok((current_message_content, generation_metadata));
            }
            Ok(None) => {}
            Err(err) => {
                let error = err.wrap_err("Failed to run prompt injection guardrail");
                return Err(error);
            }
        }

        let genai_client = app_state
            .genai_for_chat_provider_id_with_headers_context(
                chat_provider_id,
                Some(chat_provider_headers_context),
            )
            .wrap_err("Unable to choose chat provider")?;
        // The guard below is belt-and-braces: genai builds the request lazily
        // and does not connect until the stream is first polled, so today it
        // returns without any I/O and the first real wait is the stream
        // loop's. It costs nothing and covers an adapter that connects
        // eagerly.
        let provider_idle_budget = match app_state
            .config
            .generation_status
            .provider_idle_timeout_secs
        {
            0 => None,
            secs => Some(Duration::from_secs(secs)),
        };
        let connect = crate::latency::stage(
            "provider.connect",
            genai_client.exec_chat_stream(
                "PLACEHOLDER_MODEL",
                current_turn_chat_request.clone(),
                Some(&chat_options),
            ),
        );
        let connected = match provider_idle_budget {
            Some(budget) => match tokio::time::timeout(budget, connect).await {
                Ok(result) => result.map_err(ProviderStreamFailure::Provider),
                Err(_) => Err(ProviderStreamFailure::Idle { after: budget }),
            },
            None => connect.await.map_err(ProviderStreamFailure::Provider),
        };
        let chat_stream = match connected {
            Ok(stream) => stream,
            Err(failure) => {
                let error_event = failure.into_error_event(assistant_message_id).await;
                log_chat_completion_generation_error(
                    chat_provider_metric_label,
                    assistant_message_id,
                    &error_event.error,
                );
                report_chat_provider_generation_error(
                    chat_provider_metric_label,
                    &error_event.error,
                );
                persist_otel_generation_error(
                    tracing_client.as_ref(),
                    &turn_obs_id,
                    &current_turn_chat_request,
                    &current_message_content,
                    &error_event.error,
                    &turn_langfuse_model_name,
                    &turn_langfuse_generation_name,
                    turn_start_time,
                    assistant_id,
                    &all_tool_names,
                    &langfuse_trace_enrichment.platform,
                )
                .await;
                let error_payload = Some(error_event.error.clone());

                if let Some(task) = streaming_task
                    && let Some(error_json) = serialize_json_value(
                        MessageSubmitStreamingResponseMessage::Error(error_event.clone()),
                        "serialize provider-start error event",
                    )
                {
                    send_background_event(
                        task,
                        StreamingEvent::Error {
                            error: Some(error_json),
                        },
                        "broadcast provider-start error",
                    )
                    .await;
                }

                let message: MSG = error_event.into();
                send_generation_event(&message, tx.clone()).await?;
                let generation_metadata = build_generation_metadata(
                    total_prompt_tokens,
                    total_completion_tokens,
                    total_total_tokens,
                    total_reasoning_tokens,
                    langfuse_trace_id.clone(),
                    false,
                    error_payload,
                    non_empty_string(&captured_reasoning_summary),
                    non_empty_vec(&captured_reasoning_items),
                    non_empty_vec(&captured_reasoning_item_encrypted_content),
                );
                break 'loop_call_turns Ok((current_message_content, generation_metadata));
            }
        };

        let mut inner_stream = chat_stream.stream;
        let turn_content_start_index = current_message_content.len();
        let mut argument_streams = ToolArgumentStreams::default();
        let mut current_turn_streamed_text = String::new();
        let mut current_turn_streamed_reasoning = String::new();
        // Await until stream end
        let mut stream_end: Option<StreamEnd> = None;
        loop {
            let next_result = if let Some(task) = streaming_task {
                tokio::select! {
                    _ = task.wait_for_abort() => {
                        let aborted_content = current_message_content.clone();

                        if let (Some(client), Some(turn_start)) = (&tracing_client, turn_start_time) {
                            let turn_end_time = SystemTime::now();
                            let model_name = turn_langfuse_model_name.clone();
                            all_model_tags.insert(langfuse_model_tag(&model_name));
                            let generation_name = turn_langfuse_generation_name.clone();
                            let client = client.clone();
                            let request = current_turn_chat_request.clone();
                            let content = aborted_content.clone();
                            let accumulated_tool_names: Vec<String> =
                                all_tool_names.iter().cloned().collect();
                            let assistant_id_for_langfuse = assistant_id;
                            let trace_enrichment = langfuse_trace_enrichment.clone();
                            let trace_tool_names = all_tool_names.clone();
                            let trace_model_tags = all_model_tags.clone();
                            let trace_mcp_servers_unavailable =
                                mcp_servers_unavailable.clone();
                            let trace_mcp_servers_needing_auth =
                                mcp_servers_needing_auth.clone();
                            let trace_tags =
                                trace_enrichment.all_tags(&trace_model_tags, &trace_tool_names);
                            let uses_otel = client.uses_otel();
                            let send_trace = async move {
                                let result = if current_turn == 1 || uses_otel {
                                    create_trace_with_generation_from_chat(
                                        &client,
                                        turn_obs_id,
                                        &request,
                                        &content,
                                        None,
                                        Some(model_name),
                                        Some(generation_name),
                                        Some(turn_start),
                                        Some(turn_end_time),
                                        None,
                                        assistant_id_for_langfuse,
                                        &accumulated_tool_names,
                                        Some(&trace_enrichment.platform),
                                        Some(trace_tags.clone()),
                                        None, // parent_observation_id
                                    )
                                    .await
                                } else {
                                    TracedGenerationBuilder::new(turn_obs_id)
                                        .with_model(model_name)
                                        .with_start_time(turn_start)
                                        .with_end_time(turn_end_time)
                                        .with_name(generation_name)
                                        .build_and_send(
                                            &client,
                                            &request,
                                        &content,
                                        None,
                                        assistant_id_for_langfuse,
                                        &accumulated_tool_names,
                                        Some(&trace_enrichment.platform),
                                    )
                                    .await
                                };

                                if let Err(err) = result {
                                    tracing::warn!(
                                        "Failed to send Langfuse aborted trace for turn {}: {}",
                                        current_turn,
                                        err
                                    );
                                } else {
                                    if let Some(metadata) = trace_enrichment.trace_metadata(
                                        assistant_id_for_langfuse,
                                        &trace_tool_names,
                                        &trace_mcp_servers_unavailable,
                                        &trace_mcp_servers_needing_auth,
                                        true,
                                    ) && let Err(err) =
                                        client.update_trace_metadata(metadata).await
                                    {
                                        tracing::warn!(
                                            "Failed to update Langfuse aborted metadata for turn {}: {}",
                                            current_turn,
                                            err
                                        );
                                    }

                                    let trace_tags = trace_enrichment
                                        .all_tags(&trace_model_tags, &trace_tool_names);
                                    if let Err(err) = client.update_trace_tags(trace_tags).await {
                                        tracing::warn!(
                                            "Failed to update Langfuse aborted tags for turn {}: {}",
                                            current_turn,
                                            err
                                        );
                                    }
                                }
                            };

                            if uses_otel {
                                send_trace.await;
                            } else {
                                tokio::spawn(send_trace);
                            }
                        }

                        let generation_metadata = build_generation_metadata(
                            total_prompt_tokens,
                            total_completion_tokens,
                            total_total_tokens,
                            total_reasoning_tokens,
                            langfuse_trace_id.clone(),
                            true,
                            None,
                        non_empty_string(&captured_reasoning_summary),
                        non_empty_vec(&captured_reasoning_items),
                        non_empty_vec(&captured_reasoning_item_encrypted_content),
                        );
                        break 'loop_call_turns Ok((aborted_content, generation_metadata));
                    }
                    result = next_provider_stream_item(&mut inner_stream, provider_idle_budget) => {
                        result
                    }
                }
            } else {
                next_provider_stream_item(&mut inner_stream, provider_idle_budget).await
            };

            let Some(result) = next_result else {
                break;
            };

            match result {
                Ok(message) => match message {
                    ChatStreamEvent::Chunk(StreamChunk { content }) => {
                        let elapsed = provider_request_start.elapsed();
                        first_response_elapsed.get_or_insert(elapsed);
                        if hallucination_suppression.observe_text_delta(&content) {
                            let error_event = hallucination_loop_error_event(assistant_message_id);
                            log_chat_completion_generation_error(
                                chat_provider_metric_label,
                                assistant_message_id,
                                &error_event.error,
                            );
                            report_chat_provider_generation_error(
                                chat_provider_metric_label,
                                &error_event.error,
                            );
                            persist_otel_generation_error(
                                tracing_client.as_ref(),
                                &turn_obs_id,
                                &current_turn_chat_request,
                                &current_message_content,
                                &error_event.error,
                                &turn_langfuse_model_name,
                                &turn_langfuse_generation_name,
                                turn_start_time,
                                assistant_id,
                                &all_tool_names,
                                &langfuse_trace_enrichment.platform,
                            )
                            .await;
                            if let Some(elapsed) = first_response_elapsed {
                                report_chat_provider_time_to_first_token(
                                    chat_provider_metric_label,
                                    elapsed,
                                );
                            }
                            let error_payload = Some(error_event.error.clone());

                            if let Some(task) = streaming_task
                                && let Some(error_json) = serialize_json_value(
                                    MessageSubmitStreamingResponseMessage::Error(
                                        error_event.clone(),
                                    ),
                                    "serialize hallucination-loop error event",
                                )
                            {
                                send_background_event(
                                    task,
                                    StreamingEvent::Error {
                                        error: Some(error_json),
                                    },
                                    "broadcast hallucination-loop error",
                                )
                                .await;
                            }

                            let message: MSG = error_event.into();
                            send_generation_event(&message, tx.clone()).await?;
                            let generation_metadata = build_generation_metadata(
                                total_prompt_tokens,
                                total_completion_tokens,
                                total_total_tokens,
                                total_reasoning_tokens,
                                langfuse_trace_id.clone(),
                                true,
                                error_payload,
                                non_empty_string(&captured_reasoning_summary),
                                non_empty_vec(&captured_reasoning_items),
                                non_empty_vec(&captured_reasoning_item_encrypted_content),
                            );
                            break 'loop_call_turns Ok((
                                current_message_content,
                                generation_metadata,
                            ));
                        }
                        current_turn_streamed_text.push_str(&content);
                        let content_index =
                            append_text_delta_part(&mut current_message_content, content.clone());
                        let delta = MessageSubmitStreamingResponseMessageTextDelta {
                            message_id: assistant_message_id,
                            content_index,
                            new_text: content.clone(),
                        };
                        // Forward to streaming_task if present
                        if let Some(task) = streaming_task {
                            send_background_event(
                                task,
                                StreamingEvent::TextDelta {
                                    message_id: assistant_message_id,
                                    content_index,
                                    new_text: content,
                                },
                                "broadcast text delta",
                            )
                            .await;
                        }
                        let message: MSG = delta.into();
                        send_generation_event(&message, tx.clone()).await?;
                    }
                    ChatStreamEvent::ReasoningChunk(StreamChunk { content }) => {
                        captured_reasoning_summary.push_str(&content);
                        current_turn_streamed_reasoning.push_str(&content);
                        let content_index = append_reasoning_delta_part(
                            &mut current_message_content,
                            content.clone(),
                        );
                        if let Some(ContentPart::Reasoning(reasoning_part)) =
                            current_message_content.get_mut(content_index)
                        {
                            let now = now_timestamp();
                            reasoning_part.started_at.get_or_insert_with(|| now.clone());
                            reasoning_part.ended_at = Some(now);
                        }
                        let delta = MessageSubmitStreamingResponseMessageReasoningDelta {
                            message_id: assistant_message_id,
                            content_index,
                            new_text: content.clone(),
                        };
                        if let Some(task) = streaming_task {
                            send_background_event(
                                task,
                                StreamingEvent::ReasoningDelta {
                                    message_id: assistant_message_id,
                                    content_index,
                                    new_text: content,
                                },
                                "broadcast reasoning delta",
                            )
                            .await;
                        }
                        let message: MSG = delta.into();
                        send_generation_event(&message, tx.clone()).await?;
                    }
                    ChatStreamEvent::ToolCallChunk(chunk) => {
                        first_response_elapsed
                            .get_or_insert_with(|| provider_request_start.elapsed());
                        if let Some(progress) = argument_streams.observe(
                            &chunk.tool_call,
                            &mut current_message_content,
                            Instant::now(),
                        ) {
                            if progress.first {
                                if let Some(task) = streaming_task {
                                    send_background_event(
                                        task,
                                        StreamingEvent::ToolCallProposed {
                                            message_id: assistant_message_id,
                                            content_index: progress.index,
                                            tool_call_id: chunk.tool_call.call_id.clone(),
                                            tool_name: chunk.tool_call.fn_name.clone(),
                                            input: None,
                                        },
                                        "broadcast preparing tool call",
                                    )
                                    .await;
                                }
                                let message: MSG = MessageSubmitStreamingResponseToolCallProposed {
                                    message_id: assistant_message_id,
                                    content_index: progress.index,
                                    tool_call_id: chunk.tool_call.call_id.clone(),
                                    tool_name: chunk.tool_call.fn_name.clone(),
                                    input: None,
                                }
                                .into();
                                send_generation_event(&message, tx.clone()).await?;
                            }
                            let preview_call = genai::chat::ToolCall {
                                fn_arguments: progress.preview,
                                ..chunk.tool_call
                            };
                            send_tool_generation_update::<MSG>(
                                assistant_message_id,
                                progress.index,
                                &preview_call,
                                ToolCallStatus::Preparing,
                                Some(progress.bytes as f64),
                                streaming_task,
                                &tx,
                            )
                            .await?;
                        }
                    }
                    ChatStreamEvent::ThoughtSignatureChunk(StreamChunk { content }) => {
                        if !content.is_empty() {
                            captured_reasoning_item_encrypted_content.push(content);
                        }
                    }
                    ChatStreamEvent::End(end) => {
                        if first_response_elapsed.is_some() {
                            last_response_elapsed = Some(provider_request_start.elapsed());
                        }
                        stream_end = Some(end);
                    }
                    ChatStreamEvent::Start => {}
                },
                Err(failure) => {
                    if let ProviderStreamFailure::Provider(err) = &failure
                        && let genai::Error::JsonValueExt(_) = err
                    {
                        tracing::warn!(
                            error = ?err,
                            message_id = %assistant_message_id,
                            "Ignoring malformed auxiliary JSON value in chat stream"
                        );
                        continue;
                    }

                    if let ProviderStreamFailure::Idle { after } = &failure {
                        // An abort racing the deadline must read as the user's
                        // stop, not as a provider fault: the two arms can be
                        // ready in the same poll, and only one of them is
                        // something to report.
                        if let Some(task) = streaming_task
                            && task.is_abort_requested()
                        {
                            continue;
                        }
                        tracing::error!(
                            message_id = %assistant_message_id,
                            idle_secs = after.as_secs(),
                            "Provider stream went idle past its budget; failing the generation"
                        );
                    }

                    let error_event = failure.into_error_event(assistant_message_id).await;
                    log_chat_completion_generation_error(
                        chat_provider_metric_label,
                        assistant_message_id,
                        &error_event.error,
                    );
                    report_chat_provider_generation_error(
                        chat_provider_metric_label,
                        &error_event.error,
                    );
                    persist_otel_generation_error(
                        tracing_client.as_ref(),
                        &turn_obs_id,
                        &current_turn_chat_request,
                        &current_message_content,
                        &error_event.error,
                        &turn_langfuse_model_name,
                        &turn_langfuse_generation_name,
                        turn_start_time,
                        assistant_id,
                        &all_tool_names,
                        &langfuse_trace_enrichment.platform,
                    )
                    .await;
                    let error_payload = Some(error_event.error.clone());

                    if let Some(task) = streaming_task
                        && let Some(error_json) = serialize_json_value(
                            MessageSubmitStreamingResponseMessage::Error(error_event.clone()),
                            "serialize provider-stream error event",
                        )
                    {
                        send_background_event(
                            task,
                            StreamingEvent::Error {
                                error: Some(error_json),
                            },
                            "broadcast provider-stream error",
                        )
                        .await;
                    }

                    let message: MSG = error_event.into();
                    send_generation_event(&message, tx.clone()).await?;
                    let generation_metadata = build_generation_metadata(
                        total_prompt_tokens,
                        total_completion_tokens,
                        total_total_tokens,
                        total_reasoning_tokens,
                        langfuse_trace_id.clone(),
                        false,
                        error_payload,
                        non_empty_string(&captured_reasoning_summary),
                        non_empty_vec(&captured_reasoning_items),
                        non_empty_vec(&captured_reasoning_item_encrypted_content),
                    );
                    break 'loop_call_turns Ok((current_message_content, generation_metadata));
                }
            }
        }
        if let Some(stream_end) = stream_end {
            if let Some(elapsed) = first_response_elapsed {
                report_chat_provider_time_to_first_token(chat_provider_metric_label, elapsed);
            }
            if let Some(elapsed) = last_response_elapsed {
                report_chat_provider_time_to_last_token(chat_provider_metric_label, elapsed);
            }
            let mut current_turn_captured_reasoning_summary = String::new();
            if let Some(reasoning_content) = stream_end.captured_reasoning_content.as_ref() {
                captured_reasoning_summary = reasoning_content.clone();
                current_turn_captured_reasoning_summary = reasoning_content.clone();
            }
            if let Some(reasoning_items) = stream_end.captured_reasoning_items.as_ref() {
                captured_reasoning_items.extend(reasoning_items.clone());
                let reasoning_items_summary = reasoning_items
                    .iter()
                    .filter_map(|item| item.summary_text())
                    .collect::<Vec<_>>()
                    .join("\n");
                if captured_reasoning_summary.is_empty() {
                    captured_reasoning_summary = reasoning_items_summary.clone();
                }
                if current_turn_captured_reasoning_summary.is_empty() {
                    current_turn_captured_reasoning_summary = reasoning_items_summary;
                }
            }
            if let Some(thought_signatures) = stream_end.captured_thought_signatures() {
                for thought_signature in thought_signatures {
                    if !thought_signature.is_empty()
                        && !captured_reasoning_item_encrypted_content
                            .iter()
                            .any(|item| item == thought_signature)
                    {
                        captured_reasoning_item_encrypted_content
                            .push(thought_signature.to_string());
                    }
                }
            }

            if current_turn_streamed_reasoning.is_empty()
                && !current_turn_captured_reasoning_summary.is_empty()
            {
                let now = now_timestamp();
                let content_index = insert_reasoning_part_before_text(
                    &mut current_message_content,
                    current_turn_captured_reasoning_summary.clone(),
                );
                if let Some(ContentPart::Reasoning(reasoning_part)) =
                    current_message_content.get_mut(content_index)
                {
                    reasoning_part.started_at = Some(now.clone());
                    reasoning_part.ended_at = Some(now);
                }
                let delta = MessageSubmitStreamingResponseMessageReasoningDelta {
                    message_id: assistant_message_id,
                    content_index,
                    new_text: current_turn_captured_reasoning_summary.clone(),
                };
                if let Some(task) = streaming_task {
                    send_background_event(
                        task,
                        StreamingEvent::ReasoningDelta {
                            message_id: assistant_message_id,
                            content_index,
                            new_text: current_turn_captured_reasoning_summary.clone(),
                        },
                        "broadcast captured reasoning summary",
                    )
                    .await;
                }
                let message: MSG = delta.into();
                send_generation_event(&message, tx.clone()).await?;
            }

            #[allow(clippy::collapsible_match)]
            #[allow(clippy::single_match)]
            if let Some(captured_texts) = stream_end.captured_texts() {
                if current_turn_streamed_text.is_empty() {
                    for captured_text in captured_texts {
                        current_message_content.push(ContentPart::Text(ContentPartText {
                            text: captured_text.into(),
                        }));
                    }
                }
            } else if !current_turn_streamed_text.is_empty() {
                // Text chunks have already been appended to current_message_content.
            }

            // Accumulate usage statistics from this turn
            if let Some(usage) = stream_end.captured_usage.as_ref() {
                if let Some(prompt_tokens) = usage.prompt_tokens {
                    total_prompt_tokens += prompt_tokens as u32;
                }
                if let Some(completion_tokens) = usage.completion_tokens {
                    total_completion_tokens += completion_tokens as u32;
                }
                if let Some(total_tokens) = usage.total_tokens {
                    total_total_tokens += total_tokens as u32;
                }
                // Extract reasoning tokens from completion_tokens_details
                if let Some(details) = &usage.completion_tokens_details
                    && let Some(reasoning_tokens) = details.reasoning_tokens
                {
                    total_reasoning_tokens += reasoning_tokens as u32;
                }
            }

            // Send Langfuse tracing for this turn if enabled
            if let (Some(client), Some(turn_start)) = (&tracing_client, turn_start_time) {
                let turn_end_time = SystemTime::now();
                let model_name = turn_langfuse_model_name.clone();
                all_model_tags.insert(langfuse_model_tag(&model_name));

                // Get the content generated in this turn
                let turn_content = &current_message_content[turn_content_start_index..];

                // Use the usage information from this turn's stream_end
                let turn_usage = stream_end.captured_usage.as_ref();

                let generation_name = turn_langfuse_generation_name.clone();
                // Extract tool names from this turn's captured tool calls
                let turn_tool_names: Vec<String> = stream_end
                    .captured_tool_calls()
                    .map(|calls| calls.iter().map(|call| call.fn_name.clone()).collect())
                    .unwrap_or_default();
                if let Some(calls) = stream_end.captured_tool_calls() {
                    for call in calls {
                        tool_call_parent_observation_ids
                            .insert(call.call_id.clone(), turn_obs_id.clone());
                    }
                }

                // Clone client and data for async task
                let client = client.clone();
                let request = current_turn_chat_request.clone();
                let content = turn_content.to_vec();
                let usage = turn_usage.cloned();
                let trace_platform = langfuse_trace_enrichment.platform.clone();
                let turn_tool_name_set: HashSet<String> = turn_tool_names.iter().cloned().collect();
                let trace_tool_name_set: HashSet<String> =
                    all_tool_names.union(&turn_tool_name_set).cloned().collect();
                let trace_tags =
                    langfuse_trace_enrichment.all_tags(&all_model_tags, &trace_tool_name_set);
                let mut accumulated_tool_names: Vec<String> =
                    trace_tool_name_set.into_iter().collect();
                accumulated_tool_names.sort();

                let assistant_id_for_langfuse = assistant_id;
                let uses_otel = client.uses_otel();
                let send_trace = async move {
                    let result = if current_turn == 1 || uses_otel {
                        create_trace_with_generation_from_chat(
                            &client,
                            turn_obs_id,
                            &request,
                            &content,
                            usage.as_ref(),
                            Some(model_name),
                            Some(generation_name),
                            Some(turn_start),
                            Some(turn_end_time),
                            None, // completion_start_time
                            assistant_id_for_langfuse,
                            if uses_otel {
                                &accumulated_tool_names
                            } else {
                                &turn_tool_names
                            },
                            Some(&trace_platform),
                            Some(trace_tags),
                            None,
                        )
                        .await
                    } else {
                        TracedGenerationBuilder::new(turn_obs_id)
                            .with_model(model_name)
                            .with_start_time(turn_start)
                            .with_end_time(turn_end_time)
                            .with_name(generation_name)
                            .build_and_send(
                                &client,
                                &request,
                                &content,
                                usage.as_ref(),
                                assistant_id_for_langfuse,
                                &turn_tool_names,
                                Some(&trace_platform),
                            )
                            .await
                    };

                    if let Err(err) = result {
                        tracing::warn!(
                            "Failed to send Langfuse trace for turn {}: {}",
                            current_turn,
                            err
                        );
                    } else {
                        tracing::debug!(
                            "Successfully sent Langfuse trace for turn {}",
                            current_turn
                        );
                    }
                };

                if uses_otel {
                    send_trace.await;
                } else {
                    tokio::spawn(send_trace);
                }
            }

            if let Some(captured_tool_calls) = stream_end.captured_tool_calls() {
                if !captured_tool_calls.is_empty() {
                    // Track tool names for Langfuse metadata
                    for tool_call in captured_tool_calls.iter() {
                        all_tool_names.insert(tool_call.fn_name.clone());
                    }

                    // OpenAI Responses API rejects reasoning items without a `summary` field.
                    // Two issues to handle here:
                    //   1. genai's StreamEnd duplicates each captured reasoning event as both a
                    //      full ReasoningItem and a bare ThoughtSignature (encrypted_content only).
                    //      The ThoughtSignature serializes without `summary` — drop it.
                    //   2. The captured ReasoningItem itself may have `summary: vec![]` when the
                    //      model emitted no summary chunks. genai's `skip_serializing_if =
                    //      "Vec::is_empty"` then omits the field. Inject a placeholder summary
                    //      so it serializes (mirrors build_openai_responses_reasoning_replay_parts).
                    let assistant_turn_content = stream_end
                        .captured_content
                        .as_ref()
                        .map(|captured_content| {
                            MessageContent::from_parts(
                                captured_content
                                    .parts()
                                    .iter()
                                    .filter(|p| {
                                        !matches!(p, genai::chat::ContentPart::ThoughtSignature(_))
                                    })
                                    .cloned()
                                    .map(|part| match part {
                                        genai::chat::ContentPart::ReasoningItem(mut item)
                                            if item.summary.is_empty() =>
                                        {
                                            item.summary.push(reasoning_summary_part(Some(
                                                current_turn_captured_reasoning_summary.as_str(),
                                            )));
                                            genai::chat::ContentPart::ReasoningItem(item)
                                        }
                                        other => other,
                                    })
                                    .collect::<Vec<_>>(),
                            )
                        })
                        .unwrap_or_else(|| {
                            MessageContent::from_tool_calls(
                                captured_tool_calls.clone().into_iter().cloned().collect(),
                            )
                        });

                    current_turn_chat_request.messages.push(GenAiChatMessage {
                        role: ChatRole::Assistant,
                        content: assistant_turn_content,
                        options: None,
                    });
                    unfinished_tool_calls.extend(
                        captured_tool_calls
                            .clone()
                            .into_iter()
                            .map(ToOwned::to_owned),
                    );
                } else {
                    // Update Langfuse trace with final output and metadata if enabled
                    if let Some(ref client) = tracing_client
                        && let Some(output_json) = content_parts_json_or_log(
                            &current_message_content,
                            "serialize final Langfuse trace output",
                        )
                    {
                        let client = client.clone();
                        let trace_id = client.trace_id().to_string();
                        let assistant_id_for_trace = assistant_id;
                        let trace_enrichment = langfuse_trace_enrichment.clone();
                        let trace_tool_names = all_tool_names.clone();
                        let trace_model_tags = all_model_tags.clone();
                        let trace_mcp_servers_unavailable = mcp_servers_unavailable.clone();
                        let trace_mcp_servers_needing_auth = mcp_servers_needing_auth.clone();
                        tokio::spawn(async move {
                            // Update trace output
                            if let Err(e) = client.update_trace_output(output_json).await {
                                tracing::warn!(
                                    trace_id = %trace_id,
                                    error = %e,
                                    "Failed to update Langfuse trace with output"
                                );
                            } else {
                                tracing::debug!(
                                    trace_id = %trace_id,
                                    "Successfully updated Langfuse trace with output"
                                );
                            }

                            // Update trace metadata with assistant_id and tool calls
                            if let Some(metadata) = trace_enrichment.trace_metadata(
                                assistant_id_for_trace,
                                &trace_tool_names,
                                &trace_mcp_servers_unavailable,
                                &trace_mcp_servers_needing_auth,
                                false,
                            ) {
                                if let Err(e) = client.update_trace_metadata(metadata).await {
                                    tracing::warn!(
                                        trace_id = %trace_id,
                                        error = %e,
                                        "Failed to update Langfuse trace with metadata"
                                    );
                                } else {
                                    tracing::debug!(
                                        trace_id = %trace_id,
                                        "Successfully updated Langfuse trace with metadata"
                                    );
                                }
                            }

                            let trace_tags =
                                trace_enrichment.all_tags(&trace_model_tags, &trace_tool_names);
                            if let Err(e) = client.update_trace_tags(trace_tags).await {
                                tracing::warn!(
                                    trace_id = %trace_id,
                                    error = %e,
                                    "Failed to update Langfuse trace with tags"
                                );
                            } else {
                                tracing::debug!(
                                    trace_id = %trace_id,
                                    "Successfully updated Langfuse trace with tags"
                                );
                            }
                        });
                    }

                    let generation_metadata = build_generation_metadata(
                        total_prompt_tokens,
                        total_completion_tokens,
                        total_total_tokens,
                        total_reasoning_tokens,
                        langfuse_trace_id.clone(),
                        false,
                        None,
                        non_empty_string(&captured_reasoning_summary),
                        non_empty_vec(&captured_reasoning_items),
                        non_empty_vec(&captured_reasoning_item_encrypted_content),
                    );
                    break 'loop_call_turns Ok((current_message_content, generation_metadata));
                }
            } else {
                // Update Langfuse trace with final output if enabled
                if let Some(ref client) = tracing_client
                    && let Some(output_json) = content_parts_json_or_log(
                        &current_message_content,
                        "serialize final Langfuse trace output",
                    )
                {
                    let client = client.clone();
                    let trace_id = client.trace_id().to_string();
                    let trace_tags =
                        langfuse_trace_enrichment.all_tags(&all_model_tags, &all_tool_names);
                    let trace_metadata = langfuse_trace_enrichment.trace_metadata(
                        assistant_id,
                        &all_tool_names,
                        &mcp_servers_unavailable,
                        &mcp_servers_needing_auth,
                        false,
                    );
                    tokio::spawn(async move {
                        if let Err(e) = client.update_trace_output(output_json).await {
                            tracing::warn!(
                                trace_id = %trace_id,
                                error = %e,
                                "Failed to update Langfuse trace with output"
                            );
                        } else {
                            tracing::debug!(
                                trace_id = %trace_id,
                                "Successfully updated Langfuse trace with output"
                            );
                        }

                        if let Some(metadata) = trace_metadata
                            && let Err(e) = client.update_trace_metadata(metadata).await
                        {
                            tracing::warn!(
                                trace_id = %trace_id,
                                error = %e,
                                "Failed to update Langfuse trace with metadata"
                            );
                        }

                        if let Err(e) = client.update_trace_tags(trace_tags).await {
                            tracing::warn!(
                                trace_id = %trace_id,
                                error = %e,
                                "Failed to update Langfuse trace with tags"
                            );
                        }
                    });
                }

                let generation_metadata = build_generation_metadata(
                    total_prompt_tokens,
                    total_completion_tokens,
                    total_total_tokens,
                    total_reasoning_tokens,
                    langfuse_trace_id.clone(),
                    false,
                    None,
                    non_empty_string(&captured_reasoning_summary),
                    non_empty_vec(&captured_reasoning_items),
                    non_empty_vec(&captured_reasoning_item_encrypted_content),
                );
                break 'loop_call_turns Ok((current_message_content, generation_metadata));
            }
        } else {
            if let Some(error_event) = fetch_non_streaming_error(
                app_state,
                current_turn_chat_request.clone(),
                &chat_options,
                assistant_message_id,
                chat_provider_id,
                chat_provider_headers_context,
            )
            .await?
            {
                log_chat_completion_generation_error(
                    chat_provider_metric_label,
                    assistant_message_id,
                    &error_event.error,
                );
                report_chat_provider_generation_error(
                    chat_provider_metric_label,
                    &error_event.error,
                );
                persist_otel_generation_error(
                    tracing_client.as_ref(),
                    &turn_obs_id,
                    &current_turn_chat_request,
                    &current_message_content,
                    &error_event.error,
                    &turn_langfuse_model_name,
                    &turn_langfuse_generation_name,
                    turn_start_time,
                    assistant_id,
                    &all_tool_names,
                    &langfuse_trace_enrichment.platform,
                )
                .await;
                let error_payload = Some(error_event.error.clone());

                if let Some(task) = streaming_task
                    && let Some(error_json) = serialize_json_value(
                        MessageSubmitStreamingResponseMessage::Error(error_event.clone()),
                        "serialize non-streaming provider error event",
                    )
                {
                    send_background_event(
                        task,
                        StreamingEvent::Error {
                            error: Some(error_json),
                        },
                        "broadcast non-streaming provider error",
                    )
                    .await;
                }

                let message: MSG = error_event.into();
                send_generation_event(&message, tx.clone()).await?;
                let generation_metadata = build_generation_metadata(
                    total_prompt_tokens,
                    total_completion_tokens,
                    total_total_tokens,
                    total_reasoning_tokens,
                    langfuse_trace_id.clone(),
                    false,
                    error_payload,
                    non_empty_string(&captured_reasoning_summary),
                    non_empty_vec(&captured_reasoning_items),
                    non_empty_vec(&captured_reasoning_item_encrypted_content),
                );
                break 'loop_call_turns Ok((current_message_content, generation_metadata));
            }

            break 'loop_call_turns Err(eyre!(
                "Non-streaming chat generation failed without a parseable provider error"
            ));
        }
    };
    completion.map(|(content, metadata)| (without_preparing_tools(&content), metadata))
}

/// Mark the task's outcome as parked when the finalized message stops on an
/// approval request (always its last part). The outcome lands on the chat's
/// generation state via `remove_task`, and any other generation taking the
/// lease overwrites it — so a marker left by a superseded parked message
/// self-heals without dedicated clearing.
fn mark_task_awaiting_approval_if_parked(
    task: &Arc<StreamingTask>,
    final_content_parts: &[ContentPart],
) {
    if matches!(
        final_content_parts.last(),
        Some(ContentPart::ToolApprovalRequest(_))
    ) {
        task.mark_awaiting_approval();
    }
}

// New background task version
#[allow(clippy::too_many_arguments)]
async fn bg_stream_update_assistant_message_completion(
    task: &Arc<StreamingTask>,
    app_state: &AppState,
    policy: &PolicyEngine,
    final_content_parts: Vec<ContentPart>,
    me_user: &MeProfile,
    assistant_message_id: Uuid,
) -> Result<(), Report> {
    let _persistence_timer = crate::latency::StageTimer::new("generation.final_persistence");
    let updated_assistant_message = crate::models::message::update_message_content(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &assistant_message_id,
        final_content_parts.clone(),
    )
    .await
    .wrap_err("Failed to update assistant message content")?;

    mark_task_awaiting_approval_if_parked(task, &final_content_parts);

    let updated_assistant_message_wrapped =
        ChatMessage::from_model(updated_assistant_message.clone())
            .wrap_err("Failed to convert updated assistant message")?;
    let hydrated_final_content_parts = crate::models::message::regenerate_image_urls_in_content(
        &app_state.db,
        final_content_parts.clone(),
        &app_state.file_storage_providers,
    )
    .await
    .wrap_err("Failed to hydrate image URLs")?;
    let mut updated_assistant_message_wrapped = updated_assistant_message_wrapped;
    updated_assistant_message_wrapped.content = hydrated_final_content_parts.clone();

    task.send_event(StreamingEvent::AssistantMessageCompleted {
        message_id: updated_assistant_message.id,
        content: hydrated_final_content_parts,
        message: updated_assistant_message_wrapped,
    })
    .await
    .map_err(Report::msg)?;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn stream_update_assistant_message_completion<
    MSG: SendAsSseEvent + From<MessageSubmitStreamingResponseMessageComplete>,
>(
    tx: Sender<Result<Event, Report>>,
    task: &Arc<StreamingTask>,
    app_state: &AppState,
    policy: &PolicyEngine,
    final_content_parts: Vec<ContentPart>,
    me_user: &MeProfile,
    assistant_message_id: Uuid,
) -> Result<(), Report> {
    let _persistence_timer = crate::latency::StageTimer::new("generation.final_persistence");
    // Update the assistant message in the database
    let updated_assistant_message = crate::models::message::update_message_content(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &assistant_message_id,
        final_content_parts.clone(),
    )
    .await
    .wrap_err("Failed to update assistant message content")?;

    mark_task_awaiting_approval_if_parked(task, &final_content_parts);

    let mut updated_assistant_message_wrapped =
        ChatMessage::from_model(updated_assistant_message.clone())
            .wrap_err("Failed to convert updated assistant message")?;
    let hydrated_final_content_parts = crate::models::message::regenerate_image_urls_in_content(
        &app_state.db,
        final_content_parts.clone(),
        &app_state.file_storage_providers,
    )
    .await
    .wrap_err("Failed to hydrate image URLs")?;
    updated_assistant_message_wrapped.content = hydrated_final_content_parts.clone();

    let message_completed_event: MSG = MessageSubmitStreamingResponseMessageComplete {
        message_id: updated_assistant_message.id, // This is assistant_message_id
        content: hydrated_final_content_parts,
        message: updated_assistant_message_wrapped,
    }
    .into();
    message_completed_event
        .send_event_report(tx.clone())
        .in_current_span()
        .await?;

    Ok(())
}

// TODO: Allow specifying different model for summary, so we don't use reasoning models for it.
/// Generate a summary of the chat, based on the first message to the chat.
#[instrument(skip_all)]
pub async fn generate_chat_summary(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    chat: &chats::Model,
    generation_input_messages: &GenerationInputMessages,
) -> Result<(), Report> {
    tracing::info!(
        "[SUMMARY] Starting generation for chat_id={}, user_id={}, has_assistant={}",
        chat.id,
        me_user.id,
        // The envelope is no longer a proxy for "has an assistant": a bare task
        // child carries provenance and a task spec with no assistant bound.
        chat.assistant_id.is_some()
    );

    // Resolve TextFilePointer entries that have completed audio transcripts so that
    // audio-only first messages are not silently skipped during summary extraction.
    let resolved_input_messages =
        resolve_audio_transcripts_for_summary(&app_state.db, generation_input_messages.clone())
            .await;

    let Some(first_user_message_text) =
        summary_user_message_text_from_generation_input(&resolved_input_messages)
    else {
        tracing::info!(
            "[SUMMARY] Skipping summary generation for chat_id={} because the composed input has no user text message",
            chat.id
        );
        return Ok(());
    };

    tracing::debug!(
        "[SUMMARY] First message content (chat_id={}): '{}'",
        chat.id,
        first_user_message_text
            .chars()
            .take(100)
            .collect::<String>()
    );

    let summary_system_prompt = app_state
        .get_summary_system_prompt(
            app_state
                .config
                .chat_providers
                .as_ref()
                .map(|chat_providers| &chat_providers.summary),
            Some(&me_user.preferred_language),
            me_user.preference_nickname.as_deref(),
            me_user.preference_job_title.as_deref(),
            me_user.preference_assistant_custom_instructions.as_deref(),
            me_user
                .preference_assistant_additional_information
                .as_deref(),
        )
        .await?;

    let chat_request = build_chat_summary_request(&summary_system_prompt, first_user_message_text);
    let max_tokens = app_state.max_tokens_for_summary();

    // HACK: Hacky way to recognize reasoning models right now. Shouldbe replaced with capabilities mechanism in the future.
    let ChatProviderConfigWithId {
        chat_provider_config,
        chat_provider_id,
        ..
    } = app_state.chat_provider_for_summary().wrap_err_with(|| {
        format!(
            "[SUMMARY] Failed to get chat provider for summary (chat_id={})",
            chat.id
        )
    })?;
    let chat_options = build_chat_options_for_summary(
        &chat_provider_config.model_settings,
        &chat_provider_config.model_capabilities,
        max_tokens,
    );

    let langfuse_trace = if app_state.config.integrations.langfuse.enabled
        && app_state.config.integrations.langfuse.tracing_enabled
        && app_state
            .config
            .integrations
            .langfuse
            .summary_tracing_enabled
    {
        let (observation_id, trace_id) = generate_langfuse_ids();
        let model_name = app_state
            .config
            .get_chat_provider(&chat_provider_id)
            .model_name_langfuse()
            .to_string();
        let generation_name = generate_name_from_chat_request(&chat_request)
            .unwrap_or_else(|| "chat_summary".to_string());

        let mut base_tags = vec![format!("frontend-platform-{}", DEFAULT_ERATO_PLATFORM)];
        base_tags.push("summary-generation".to_string());
        if chat.assistant_id.is_some() {
            base_tags.push("assistant".to_string());
        }

        let trace_enrichment = LangfuseTraceEnrichment {
            base_tags,
            filenames: vec![],
            platform: DEFAULT_ERATO_PLATFORM.to_string(),
        };

        Some((
            TracingLangfuseClient::new(
                app_state.langfuse_client.clone(),
                trace_id,
                Some(me_user.id.clone()),
                Some(chat.id.to_string()),
            ),
            observation_id,
            model_name,
            generation_name,
            trace_enrichment,
        ))
    } else {
        None
    };

    tracing::debug!(
        "[SUMMARY] Using provider '{}' for summary generation (chat_id={})",
        chat_provider_config.model_name,
        chat.id
    );

    let langfuse_start_time = if langfuse_trace.is_some() {
        Some(SystemTime::now())
    } else {
        None
    };

    tracing::debug!("[SUMMARY] Calling genai API (chat_id={})", chat.id);
    let chat_provider_headers_context =
        ChatProviderHeadersContext::new(&me_user.id, &me_user.id_token_claims);
    let summary_completion = app_state
        .genai_for_chat_provider_config_with_headers_context(
            chat_provider_config,
            Some(&chat_provider_headers_context),
        )?
        .exec_chat(
            "PLACEHOLDER_MODEL",
            chat_request.clone(),
            Some(&chat_options),
        )
        .await
        .wrap_err_with(|| {
            format!(
                "[SUMMARY] Failed to generate chat summary via API (chat_id={})",
                chat.id
            )
        })?;

    let summary_completion_end_time = SystemTime::now();
    let summary = summary_completion
        .first_text()
        .ok_or_else(|| {
            eyre!(
                "[SUMMARY] No text content in summary response (chat_id={})",
                chat.id
            )
        })?
        .to_string();

    if let Some((tracing_client, observation_id, model_name, generation_name, enrichment)) =
        langfuse_trace
    {
        let summary_chat_id = chat.id;
        let summary_output = vec![ContentPart::Text(ContentPartText {
            text: summary.clone(),
        })];
        let output_json =
            crate::services::genai_langfuse::convert_content_parts_to_json(&summary_output)
                .wrap_err_with(|| {
                    format!(
                        "[SUMMARY] Failed to convert Langfuse summary output to JSON (chat_id={})",
                        chat.id
                    )
                })?;

        if let Some(start_time) = langfuse_start_time {
            let tool_names: HashSet<String> = HashSet::new();
            let mut model_tags: HashSet<String> = HashSet::new();
            model_tags.insert(langfuse_model_tag(&model_name));

            let trace_metadata =
                enrichment.trace_metadata(chat.assistant_id, &tool_names, &[], &[], false);
            let trace_tags = enrichment.all_tags(&model_tags, &tool_names);
            let assistant_id_for_langfuse = chat.assistant_id;
            let platform = enrichment.platform.clone();
            let request = chat_request.clone();

            tokio::spawn(async move {
                let create_trace_result = create_trace_with_generation_from_chat(
                    &tracing_client,
                    observation_id,
                    &request,
                    &summary_output,
                    None,
                    Some(model_name),
                    Some(generation_name),
                    Some(start_time),
                    Some(summary_completion_end_time),
                    None,
                    assistant_id_for_langfuse,
                    &Vec::new(),
                    Some(&platform),
                    Some(trace_tags.clone()),
                    None,
                )
                .await;

                if let Err(err) = create_trace_result {
                    tracing::warn!(
                        "[SUMMARY] Failed to send Langfuse trace for chat summary (chat_id={}, error={})",
                        summary_chat_id,
                        err
                    );
                } else {
                    if let Some(metadata) = trace_metadata
                        && let Err(err) = tracing_client.update_trace_metadata(metadata).await
                    {
                        tracing::warn!(
                            "[SUMMARY] Failed to update Langfuse summary trace metadata (chat_id={}, error={})",
                            summary_chat_id,
                            err
                        );
                    }

                    if let Err(err) = tracing_client.update_trace_tags(trace_tags).await {
                        tracing::warn!(
                            "[SUMMARY] Failed to update Langfuse summary trace tags (chat_id={}, error={})",
                            summary_chat_id,
                            err
                        );
                    }

                    if let Err(err) = tracing_client.update_trace_output(output_json).await {
                        tracing::warn!(
                            "[SUMMARY] Failed to update Langfuse summary trace output (chat_id={}, error={})",
                            summary_chat_id,
                            err
                        );
                    }
                }
            });
        }
    }

    tracing::info!(
        "[SUMMARY] Generated summary for chat_id={}: '{}'",
        chat.id,
        summary
    );

    // Update the chat with the generated summary
    crate::models::chat::update_chat_summary(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &chat.id,
        summary.clone(),
    )
    .await
    .wrap_err_with(|| {
        format!(
            "[SUMMARY] Failed to update chat summary in database (chat_id={})",
            chat.id
        )
    })?;

    tracing::info!(
        "[SUMMARY] Successfully saved summary to database for chat_id={}",
        chat.id
    );

    Ok(())
}

fn summary_user_message_text_from_generation_input(
    generation_input_messages: &GenerationInputMessages,
) -> Option<&str> {
    generation_input_messages
        .messages
        .iter()
        .rev()
        .find_map(|message| {
            if !matches!(message.role, MessageRole::User) {
                return None;
            }

            match &message.content {
                ContentPart::Text(ContentPartText { text }) => {
                    let text = text.trim();
                    (!text.is_empty()).then_some(text)
                }
                ContentPart::Reasoning(_)
                | ContentPart::ToolUse(_)
                | ContentPart::ToolApprovalRequest(_)
                | ContentPart::ToolApproval(_)
                | ContentPart::ToolRejection(_)
                | ContentPart::TextFilePointer(_)
                | ContentPart::ImageFilePointer(_)
                | ContentPart::Image(_)
                | ContentPart::ActionFacetMarker(_)
                | ContentPart::DelegationPreambleMarker(_)
                | ContentPart::TaskResult(_) => None,
            }
        })
}

/// Resolves `TextFilePointer` content parts to their completed audio transcript text so that
/// the summary generation path can extract meaningful text even when the first user turn
/// contains only an audio attachment (no typed text).
///
/// Only entries with a *completed* audio transcript are replaced in place; all other content
/// parts (including file pointers whose transcript is not yet ready, missing uploads, or DB
/// errors) are left untouched. Parametrized over `FileUploadLookup` so this can be unit-tested
/// against an in-memory stub.
async fn resolve_audio_transcripts_for_summary(
    file_lookup: &impl crate::models::file_upload::FileUploadLookup,
    mut generation_input_messages: GenerationInputMessages,
) -> GenerationInputMessages {
    for message in &mut generation_input_messages.messages {
        let ContentPart::TextFilePointer(ptr) = &message.content else {
            continue;
        };
        let file_upload_id = ptr.file_upload_id;

        let promoted_text = match file_lookup.find_file_upload(file_upload_id).await {
            Ok(Some(file)) => crate::models::file_upload::get_audio_transcript_if_ready(&file)
                .map(|transcript| (file.filename, transcript)),
            Ok(None) => {
                tracing::debug!(
                    "[SUMMARY] File upload {} not found, keeping TextFilePointer unchanged",
                    file_upload_id
                );
                None
            }
            Err(err) => {
                tracing::error!(
                    "[SUMMARY] DB error fetching file upload {} for summary resolution: {}",
                    file_upload_id,
                    err
                );
                None
            }
        };

        if let Some((filename, transcript)) = promoted_text {
            tracing::info!(
                "[SUMMARY] Resolved audio transcript for file_upload_id={} to use in summary extraction",
                file_upload_id
            );
            let text = crate::server::api::v1beta::file_resolution::format_successful_file_content(
                &filename,
                file_upload_id,
                &transcript,
            );
            message.content = ContentPart::Text(ContentPartText { text });
        }
    }

    generation_input_messages
}

fn build_chat_summary_request(
    summary_system_prompt: &str,
    first_user_message_text: &str,
) -> ChatRequest {
    ChatRequest::default()
        .append_message(GenAiChatMessage::system(summary_system_prompt))
        .append_message(GenAiChatMessage::user(first_user_message_text))
}

#[derive(Debug, Clone)]
pub struct FileContentsForGeneration {
    pub id: Uuid,
    pub filename: String,
    pub content: FileContent,
}

#[derive(Debug, Clone)]
pub enum FileContent {
    /// Parsed text content (ready to use)
    Text(String),
    /// Raw image bytes with MIME type (encode to base64 on-demand)
    Image {
        raw_bytes: Vec<u8>,
        mime_type: String,
    },
}

impl FileContentsForGeneration {
    /// Helper to encode image to base64 if this is an image file
    pub fn as_base64_image(&self) -> Option<ContentPartImage> {
        match &self.content {
            FileContent::Text(_) => None,
            FileContent::Image {
                raw_bytes,
                mime_type,
            } => {
                use base64::{Engine as _, engine::general_purpose};
                let base64_data = general_purpose::STANDARD.encode(raw_bytes);
                Some(ContentPartImage {
                    content_type: mime_type.clone(),
                    base64_data,
                })
            }
        }
    }
}

// Remove null characters from a string, so that it may be saved in Postgres.
// See https://github.com/EratoLab/erato/issues/145
pub fn remove_null_characters(s: &str) -> String {
    s.chars().filter(|&c| c != '\0').collect()
}

/// Get assistant files and convert them to FileContentsForGeneration format
///
/// This function downloads and extracts text from files associated with an assistant.
/// Unlike process_input_files, this doesn't require a sender for streaming events.
///
/// For SharePoint files, an access token must be provided to fetch the file contents.
#[allow(dead_code)]
async fn get_assistant_files_for_generation(
    app_state: &AppState,
    assistant_files: &[crate::models::assistant::FileInfo],
    access_token: Option<&str>,
) -> Result<Vec<FileContentsForGeneration>, Report> {
    use crate::services::file_processing_cached;
    use crate::services::file_storage::SharepointContext;

    // Build the context for Sharepoint (will be ignored by other providers)
    let sharepoint_ctx = access_token.map(|token| SharepointContext {
        access_token: token,
    });

    // Process all files in parallel
    let futures = assistant_files.iter().map(|file_info| {
        let file_id = file_info.id;
        let filename = file_info.filename.clone();
        let file_storage_path = file_info.file_storage_path.clone();
        let file_storage_provider_id = file_info.file_storage_provider_id.clone();
        let sharepoint_ctx_ref = sharepoint_ctx.as_ref();

        async move {
            // Get the file storage provider
            let file_storage = app_state
                .file_storage_providers
                .get(&file_storage_provider_id)
                .ok_or_eyre("File storage provider not found")?;

            // Get file contents using cache
            let file_contents = file_processing_cached::get_file_cached(
                app_state,
                &file_id,
                file_storage,
                &file_storage_path,
                &filename,
                sharepoint_ctx_ref,
            )
            .await?;

            let text = match file_contents.content {
                FileContent::Text(text) => text,
                FileContent::Image { .. } => {
                    return Err(eyre::eyre!(
                        "Assistant file {} was expected to be text but resolved as image",
                        file_id
                    ));
                }
            };

            tracing::debug!(
                "Successfully processed assistant file {}: {} (text length: {})",
                filename,
                file_id,
                text.len()
            );

            Ok::<_, Report>(FileContentsForGeneration {
                id: file_id,
                filename,
                content: FileContent::Text(text),
            })
        }
    });

    let results = futures::future::join_all(futures).await;

    // Collect successful results
    let mut converted_files = vec![];
    for result in results {
        match result {
            Ok(file_contents) => converted_files.push(file_contents),
            Err(err) => {
                tracing::warn!(
                    "Failed to process assistant file - Error: {}. Skipping this file.",
                    err
                );
                // Don't fail the entire request if one file fails to parse
            }
        }
    }

    Ok(converted_files)
}

/// Everything that decides which MCP tools a generation may call.
pub(crate) struct GenerationMcpToolInputs<'a> {
    pub effective_selected_facet_ids: &'a [String],
    pub action_facet_id: Option<&'a str>,
    pub assistant_config: Option<&'a crate::models::assistant::AssistantWithFiles>,
    pub subject: &'a Subject,
    pub user_groups: &'a [String],
    pub user_id: Option<Uuid>,
    /// The chat's write toggle. Off, only tools whose server marks them
    /// read-only survive; an unannotated tool is not read-only.
    pub write_tools_enabled: bool,
    /// Servers the user switched off for the chat; their tools are dropped.
    pub disabled_server_ids: &'a [String],
    /// `server/tool` patterns of tools the user switched off for the chat;
    /// matching tools are dropped.
    pub disabled_tool_patterns: &'a [String],
}

pub(crate) struct GenerationMcpToolSet {
    /// The tools offered to the model, with the assistant, facet, policy and
    /// per-user denial filters applied.
    pub tools: Vec<crate::services::mcp_session_manager::ManagedTool>,
    /// Tool names MCP claimed before the per-user denial. Synthetic and
    /// client tools yield to MCP on a name clash, so a user denying an MCP
    /// tool must not promote the same-named client tool it was shadowing —
    /// the collision checks read this snapshot, not `tools`.
    pub mcp_claimed_names: HashSet<String>,
    /// `(server_id, tool_name)` pairs the user has denied for themselves.
    pub denied: HashSet<(String, String)>,
    /// `(server_id, tool_name)` pairs dropped because the chat has write
    /// operations turned off.
    pub write_suppressed: HashSet<(String, String)>,
    /// Servers in scope for this generation that the user switched off for
    /// the chat, sorted; every tool of theirs was dropped.
    pub disabled_server_ids: Vec<String>,
    /// `server/tool` names of discovered tools dropped because the user
    /// switched them off for the chat, sorted. A pattern that matched
    /// nothing leaves no trace here.
    pub disabled_tools: Vec<String>,
    pub unavailable_server_ids: Vec<String>,
    pub needing_auth_server_ids: Vec<String>,
    pub missing_credential_server_ids: Vec<String>,
}

/// Resolve the MCP tool set of one generation: facet and action-facet
/// allowlists, the assistant's server restriction, the policy engine's
/// server authorization, the user's own denials, the chat's write toggle,
/// and the servers and tools the user switched off for the chat.
///
/// This is the only place that chain lives. A continued turn (after a tool
/// approval) rebuilds the set through here from the persisted generation
/// parameters, so an approval can never widen the tools beyond what the
/// original turn was offered, and a denial stored while the approval was
/// pending still holds.
async fn resolve_generation_mcp_tools(
    app_state: &AppState,
    policy: &PolicyEngine,
    mcp: &crate::distribution::runtime::McpAppState,
    chat_id: Uuid,
    inputs: GenerationMcpToolInputs<'_>,
    mcp_auth_context: &McpRequestAuthContext<'_>,
) -> Result<GenerationMcpToolSet, Report> {
    let facet_allowlist = build_mcp_tool_allowlist(
        &app_state.config.facets,
        inputs.effective_selected_facet_ids,
    );
    // The active action facet's `tool_call_allowlist` selects MCP tools too
    // (same pattern space as regular facets), so an action facet activates both
    // its client tools and MCP tools through one field.
    let facet_allowlist = if let Some(action_facet_id) = inputs.action_facet_id
        && let Some(facet_config) = app_state.config.action_facets.facets.get(action_facet_id)
    {
        merge_action_facet_into_mcp_allowlist(facet_allowlist, &facet_config.tool_call_allowlist)
    } else {
        facet_allowlist
    };
    let server_filter_from_allowlist = derive_requested_server_ids_from_allowlist(
        facet_allowlist.as_deref(),
        !app_state.config.facets.facets.is_empty(),
    );
    let assistant_server_ids = inputs
        .assistant_config
        .and_then(|assistant| assistant.mcp_server_ids.as_deref());
    let effective_server_filter =
        apply_assistant_server_filter(server_filter_from_allowlist, assistant_server_ids);
    let authorized_server_ids: HashSet<String> = policy
        .filter_authorized_mcp_server_ids(
            inputs.subject,
            inputs.user_groups,
            &mcp.config.mcp_servers.keys().cloned().collect::<Vec<_>>(),
        )
        .await?
        .into_iter()
        .collect();
    tracing::trace!(
        subject = ?inputs.subject,
        user_groups = ?inputs.user_groups,
        requested_server_filter = ?effective_server_filter,
        authorized_server_ids = ?authorized_server_ids,
        "Computed authorized MCP server IDs for chat request"
    );
    let effective_server_filter = Some(match effective_server_filter {
        Some(server_ids) => server_ids
            .intersection(&authorized_server_ids)
            .cloned()
            .collect(),
        None => authorized_server_ids,
    });
    tracing::trace!(
        subject = ?inputs.subject,
        final_effective_server_filter = ?effective_server_filter,
        "Final MCP server filter for chat request"
    );

    // Only discover tools for servers potentially needed in this request.
    let tool_discovery = mcp
        .servers
        .discover_tools_for_server_ids(chat_id, effective_server_filter.as_ref(), mcp_auth_context)
        .await;
    let filtered_mcp_tools =
        filter_mcp_tools_by_assistant(tool_discovery.tools, inputs.assistant_config);
    let generation_mcp_tools =
        filter_mcp_tools_by_allowlist(filtered_mcp_tools, facet_allowlist.as_deref());
    let mcp_claimed_names: HashSet<String> = generation_mcp_tools
        .iter()
        .map(|tool| tool.tool.name.to_string())
        .collect();

    // Read even when discovery came back empty: a continuation must still
    // recognise a denied tool whose server is down right now.
    let denied: HashSet<(String, String)> = match inputs.user_id {
        Some(user_id) => {
            crate::models::user_tool_approval_setting::list_denied(&app_state.db, user_id)
                .await?
                .into_iter()
                .map(|setting| (setting.mcp_server_id, setting.tool_name))
                .collect()
        }
        None => HashSet::new(),
    };
    let tools = if denied.is_empty() {
        generation_mcp_tools
    } else {
        generation_mcp_tools
            .into_iter()
            .filter(|tool| {
                !denied.iter().any(|(server_id, name)| {
                    *server_id == tool.server_id && name == &*tool.tool.name
                })
            })
            .collect()
    };
    let (tools, write_suppressed) =
        filter_mcp_tools_by_write_access(tools, inputs.write_tools_enabled);
    // Only servers this generation would otherwise have consulted count as
    // disabled: an id outside the policy, assistant and facet scope, or one
    // not configured at all, is never reported.
    let mut disabled_server_ids: Vec<String> = inputs
        .disabled_server_ids
        .iter()
        .filter(|server_id| {
            effective_server_filter
                .as_ref()
                .is_some_and(|in_scope| in_scope.contains(*server_id))
        })
        .cloned()
        .collect();
    disabled_server_ids.sort();
    disabled_server_ids.dedup();
    let tools = filter_mcp_tools_by_disabled_servers(tools, &disabled_server_ids);
    let (tools, disabled_tools) =
        filter_mcp_tools_by_disabled_patterns(tools, inputs.disabled_tool_patterns);

    Ok(GenerationMcpToolSet {
        tools,
        mcp_claimed_names,
        denied,
        write_suppressed,
        disabled_server_ids,
        disabled_tools,
        unavailable_server_ids: tool_discovery.unavailable_server_ids,
        needing_auth_server_ids: tool_discovery.needing_auth_server_ids,
        missing_credential_server_ids: tool_discovery.missing_credential_server_ids,
    })
}

/// With writes off, keep only tools whose server marks them read-only. The
/// hint is normalized the way the approval gate reads it, so a tool without
/// annotations counts as a write and is dropped; the dropped pairs are
/// returned so a continuation can name the reason it refuses one.
fn filter_mcp_tools_by_write_access(
    tools: Vec<crate::services::mcp_session_manager::ManagedTool>,
    write_tools_enabled: bool,
) -> (
    Vec<crate::services::mcp_session_manager::ManagedTool>,
    HashSet<(String, String)>,
) {
    if write_tools_enabled {
        return (tools, HashSet::new());
    }
    let mut write_suppressed = HashSet::new();
    let tools = tools
        .into_iter()
        .filter(|tool| {
            let read_only =
                crate::services::mcp_tool_approval::normalize_tool_annotations(&tool.tool)
                    .read_only_hint;
            if !read_only {
                write_suppressed.insert((tool.server_id.clone(), tool.tool.name.to_string()));
            }
            read_only
        })
        .collect();
    (tools, write_suppressed)
}

/// Drop every tool of a server the user switched off for the chat. Strictly
/// subtractive: it runs last, so it can only narrow what the policy, the
/// assistant and the facets already allow.
fn filter_mcp_tools_by_disabled_servers(
    tools: Vec<crate::services::mcp_session_manager::ManagedTool>,
    disabled_server_ids: &[String],
) -> Vec<crate::services::mcp_session_manager::ManagedTool> {
    if disabled_server_ids.is_empty() {
        return tools;
    }
    tools
        .into_iter()
        .filter(|tool| !disabled_server_ids.contains(&tool.server_id))
        .collect()
}

/// Drop every tool one of the chat's disabled `server/tool` patterns names,
/// in the facet allowlist grammar. Strictly subtractive, and tolerant of a
/// server changing its tool set: a pattern for a tool that no longer exists
/// matches nothing, and a tool added since stays offered unless a pattern
/// covers it. The dropped tools' qualified names are returned, sorted, so a
/// generation can say what it withheld.
fn filter_mcp_tools_by_disabled_patterns(
    tools: Vec<crate::services::mcp_session_manager::ManagedTool>,
    disabled_tool_patterns: &[String],
) -> (
    Vec<crate::services::mcp_session_manager::ManagedTool>,
    Vec<String>,
) {
    if disabled_tool_patterns.is_empty() {
        return (tools, Vec::new());
    }
    let mut disabled_tools = Vec::new();
    let tools = tools
        .into_iter()
        .filter(|tool| {
            let disabled = mcp_tool_matches_disabled_patterns(
                &tool.server_id,
                &tool.tool.name,
                disabled_tool_patterns,
            );
            if disabled {
                disabled_tools.push(format!("{}/{}", tool.server_id, tool.tool.name));
            }
            !disabled
        })
        .collect();
    disabled_tools.sort();
    disabled_tools.dedup();
    (tools, disabled_tools)
}

/// Whether a chat's disabled-tool patterns name this tool. Read directly by
/// a continuation as well, so a parked tool stays refused even when its
/// server cannot be reached to rediscover it.
fn mcp_tool_matches_disabled_patterns(
    server_id: &str,
    tool_name: &str,
    disabled_tool_patterns: &[String],
) -> bool {
    is_qualified_tool_allowed(server_id, tool_name, disabled_tool_patterns)
}

/// Filter MCP tools based on assistant configuration
///
/// If the assistant has specific mcp_server_ids configured, only tools from those servers are returned.
/// If the assistant has no mcp_server_ids configured (None), all tools are returned.
/// If no assistant is configured, all tools are returned.
fn filter_mcp_tools_by_assistant(
    all_tools: Vec<crate::services::mcp_session_manager::ManagedTool>,
    assistant_config: Option<&crate::models::assistant::AssistantWithFiles>,
) -> Vec<crate::services::mcp_session_manager::ManagedTool> {
    // If no assistant or assistant has no specific MCP server restrictions, return all tools
    if let Some(assistant) = assistant_config
        && let Some(ref allowed_server_ids) = assistant.mcp_server_ids
    {
        // Filter tools to only those from allowed servers
        return all_tools
            .into_iter()
            .filter(|tool| allowed_server_ids.contains(&tool.server_id))
            .collect();
    }

    // No restrictions, return all tools
    all_tools
}

/// Derive a set of MCP server IDs that may be needed for this request.
///
/// Returns:
/// - `None` when all servers may be needed (no server-level pruning possible)
/// - `Some(set)` when only a subset of servers is potentially relevant
fn derive_requested_server_ids_from_allowlist(
    allowlist: Option<&[String]>,
    facets_configured: bool,
) -> Option<HashSet<String>> {
    if !facets_configured {
        return None;
    }

    let allowlist = allowlist?;

    if allowlist.is_empty() {
        return None;
    }

    let mut server_ids = HashSet::new();
    for pattern in allowlist {
        if pattern == "*" {
            return None;
        }

        if let Some(prefix) = pattern.strip_suffix("/*") {
            if !prefix.is_empty() {
                server_ids.insert(prefix.to_string());
            }
            continue;
        }

        if !pattern.contains('/') {
            server_ids.insert(pattern.to_string());
            continue;
        }

        if let Some((server_id, _tool_name)) = pattern.split_once('/')
            && !server_id.is_empty()
        {
            server_ids.insert(server_id.to_string());
        }
    }

    if server_ids.is_empty() {
        None
    } else {
        Some(server_ids)
    }
}

/// Applies assistant MCP server restrictions on top of derived server filters.
fn apply_assistant_server_filter(
    derived_server_filter: Option<HashSet<String>>,
    assistant_server_ids: Option<&[String]>,
) -> Option<HashSet<String>> {
    let Some(assistant_server_ids) = assistant_server_ids else {
        return derived_server_filter;
    };

    let assistant_set: HashSet<String> = assistant_server_ids.iter().cloned().collect();
    match derived_server_filter {
        Some(derived) => Some(derived.intersection(&assistant_set).cloned().collect()),
        None => Some(assistant_set),
    }
}

/// How a reserved `erato/<name>` tool came to be selected. The distinction
/// only matters for diagnostics: an operator who spelled the tool out exactly
/// is told loudly when an MCP tool takes the name from it, while one who
/// selected it through a wildcard gets a plain warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReservedSelection {
    /// Not selected; the tool is not offered.
    No,
    /// Selected through a wildcard (`*`, `erato`, or `erato/*`).
    Pattern,
    /// Selected by its exact `erato/<name>` pattern.
    Exact,
}

/// Whether the effective client-tool allowlist selects a reserved built-in.
///
/// Reserved tools ride the client-tool collector rather than the MCP one on
/// purpose: `build_mcp_tool_allowlist` treats `None` as "everything allowed",
/// so a deployment with no MCP allowlisting would offer every built-in by
/// default. The client-tool allowlist is opt-in — empty selects nothing.
pub(crate) fn reserved_tool_selected(
    bare_name: &str,
    client_tool_allowlist: &[String],
) -> ReservedSelection {
    if client_tool_allowlist.is_empty() {
        return ReservedSelection::No;
    }
    let exact = format!(
        "{}/{}",
        erato_config::config::RESERVED_TOOL_NAMESPACE,
        bare_name
    );
    if client_tool_allowlist.contains(&exact) {
        return ReservedSelection::Exact;
    }
    if is_qualified_tool_allowed(
        erato_config::config::RESERVED_TOOL_NAMESPACE,
        bare_name,
        client_tool_allowlist,
    ) {
        return ReservedSelection::Pattern;
    }
    ReservedSelection::No
}

/// Decide whether a reserved built-in tool may be offered on this turn.
///
/// One place holds all four rules so the tool that fills this slot does not
/// have to re-derive them: the feature gate, allowlist selection, the
/// MCP-wins precedence shared with the other synthetic tools, and suppression
/// inside a delegated run (a child must not spawn its own children here).
pub(crate) fn synthetic_tool_offer_slot(
    bare_name: &str,
    feature_enabled: bool,
    client_tool_allowlist: &[String],
    mcp_tools: &[crate::services::mcp_session_manager::ManagedTool],
    is_delegated_run: bool,
) -> bool {
    if !feature_enabled || is_delegated_run {
        return false;
    }
    let selection = reserved_tool_selected(bare_name, client_tool_allowlist);
    if selection == ReservedSelection::No {
        return false;
    }
    if mcp_tools.iter().any(|tool| tool.tool.name == bare_name) {
        // Same precedence as the other synthetic tools: a real MCP tool that
        // claims the name wins, and the built-in stands down.
        if selection == ReservedSelection::Exact {
            tracing::error!(
                "Not offering reserved tool '{}/{}': an MCP tool already uses the name, but an \
                 allowlist selects it explicitly — rename the MCP tool or drop the pattern.",
                erato_config::config::RESERVED_TOOL_NAMESPACE,
                bare_name
            );
        } else {
            tracing::warn!(
                "Not offering reserved tool '{}/{}': an MCP tool already uses the name.",
                erato_config::config::RESERVED_TOOL_NAMESPACE,
                bare_name
            );
        }
        return false;
    }
    true
}

/// What a `delegate_task` offer on this turn may scope a child to.
///
/// One derivation for the user path and for a continuation that re-offers the
/// tool: a facet override or a hidden-facet rule added here must not be able to
/// apply to a fresh turn and not to a resumed one, and the difference would
/// only ever surface as a child dispatched with the wrong budgets or reach.
pub(crate) async fn resolve_task_offer_scope(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    user_groups: &[String],
    effective_selected_facet_ids: &[String],
) -> Result<crate::services::delegation::TaskOfferScope, Report> {
    // Which of the SELECTED facets asked for the tool. The allowlist the slot
    // tested is the union of all of them, so it can say "selected" but never
    // "by which facet" — and the overrides that decide what a task may spend
    // are per facet.
    let planning_facet_ids: Vec<String> = effective_selected_facet_ids
        .iter()
        .filter(|facet_id| {
            app_state
                .config
                .facets
                .facets
                .get(*facet_id)
                .is_some_and(|facet| {
                    erato_config::config::allowlist_selects_reserved_tool(
                        &facet.tool_call_allowlist,
                        erato_config::config::DELEGATE_TASK_TOOL_NAME,
                    )
                })
        })
        .cloned()
        .collect();
    let effective = crate::services::delegation::effective_tasks_config(
        &app_state.config.delegation.tasks,
        &app_state.config.facets,
        &planning_facet_ids,
    );

    // What a task may be scoped to: what this turn already has, plus what the
    // planning facets and the global config say a child may reach for. Hidden
    // facets are deliberately excluded — they are always-on platform baselines
    // appended after the authorization filter, not capabilities the model
    // chooses between.
    let mut candidate_facet_ids: Vec<String> = Vec::new();
    for facet_id in effective_selected_facet_ids
        .iter()
        .filter(|facet_id| {
            app_state
                .config
                .facets
                .facets
                .get(*facet_id)
                .is_some_and(|facet| !facet.hidden)
        })
        .chain(effective.child_facet_ids.iter())
    {
        if !candidate_facet_ids.contains(facet_id) {
            candidate_facet_ids.push(facet_id.clone());
        }
    }
    let facet_enum = policy
        .filter_authorized_facet_ids(subject, user_groups, &candidate_facet_ids)
        .await?;

    Ok(crate::services::delegation::TaskOfferScope {
        facet_enum,
        effective,
    })
}

/// Expand facet tool patterns (e.g. `server/*`) into concrete discovered tool names
/// for improved facet prompt template rendering.
fn build_facet_tool_template_expansions(
    facets: &FacetsConfig,
    selected_facet_ids: &[String],
    discovered_tools: &[crate::services::mcp_session_manager::ManagedTool],
) -> HashMap<String, Vec<String>> {
    let discovered_qualified_names: Vec<String> = discovered_tools
        .iter()
        .map(|tool| format!("{}/{}", tool.server_id, tool.tool.name))
        .collect();

    let mut expansions = HashMap::new();

    for facet_id in selected_facet_ids {
        let Some(facet) = facets.facets.get(facet_id) else {
            continue;
        };
        // Reserved patterns name a built-in, not a discovered MCP tool, so
        // they would render literally (`erato/delegate_task`) in a facet's
        // prompt template. Drop them before expanding.
        let mcp_patterns: Vec<String> = facet
            .tool_call_allowlist
            .iter()
            .filter(|pattern| !erato_config::config::pattern_names_reserved_namespace(pattern))
            .cloned()
            .collect();
        let expanded =
            expand_tool_patterns_with_discovered_tools(&mcp_patterns, &discovered_qualified_names);
        // If expansion yields no concrete tools, keep original facet patterns
        // by omitting the override for this facet.
        if !expanded.is_empty() {
            expansions.insert(facet_id.clone(), expanded);
        }
    }

    expansions
}

fn expand_tool_patterns_with_discovered_tools(
    patterns: &[String],
    discovered_qualified_names: &[String],
) -> Vec<String> {
    let mut discovered_qualified_names = discovered_qualified_names.to_vec();
    discovered_qualified_names.sort();
    discovered_qualified_names.dedup();

    let mut expanded = Vec::new();
    let mut seen = HashSet::new();
    let mut push_unique = |entry: String| {
        if seen.insert(entry.clone()) {
            expanded.push(entry);
        }
    };

    for pattern in patterns {
        if pattern == "*" {
            for qualified_name in &discovered_qualified_names {
                push_unique(qualified_name.clone());
            }
            continue;
        }

        if let Some(prefix) = pattern.strip_suffix("/*") {
            for qualified_name in &discovered_qualified_names {
                if qualified_name.starts_with(&format!("{}/", prefix)) {
                    push_unique(qualified_name.clone());
                }
            }
            continue;
        }

        if !pattern.contains('/') {
            for qualified_name in &discovered_qualified_names {
                if qualified_name.starts_with(&format!("{}/", pattern)) {
                    push_unique(qualified_name.clone());
                }
            }
            continue;
        }

        push_unique(pattern.clone());
    }

    expanded
}

/// Filter MCP tools based on facet tool allowlists.
///
/// If no allowlist is provided, all tools are returned.
fn filter_mcp_tools_by_allowlist(
    all_tools: Vec<crate::services::mcp_session_manager::ManagedTool>,
    allowlist: Option<&[String]>,
) -> Vec<crate::services::mcp_session_manager::ManagedTool> {
    let Some(allowlist) = allowlist else {
        return all_tools;
    };

    if allowlist.is_empty() {
        return all_tools;
    }

    all_tools
        .into_iter()
        .filter(|tool| is_tool_allowed_by_allowlist(tool, allowlist))
        .collect()
}

fn is_tool_allowed_by_allowlist(
    tool: &crate::services::mcp_session_manager::ManagedTool,
    allowlist: &[String],
) -> bool {
    is_qualified_tool_allowed(&tool.server_id, &tool.tool.name, allowlist)
}

/// Core allowlist matcher shared by MCP tools (`server_id/tool_name`) and
/// client tools (`namespace/tool_name`). A `namespace` here is the MCP server
/// id or the client-tool namespace. Patterns: `*` (all), a bare namespace (all
/// of that namespace), `namespace/*` (prefix), or an exact `namespace/name`.
fn is_qualified_tool_allowed(namespace: &str, tool_name: &str, allowlist: &[String]) -> bool {
    let qualified_name = format!("{}/{}", namespace, tool_name);

    allowlist.iter().any(|pattern| {
        if pattern == "*" {
            return true;
        }

        if !pattern.contains('/') {
            return pattern == namespace;
        }

        if let Some(prefix) = pattern.strip_suffix("/*") {
            return qualified_name.starts_with(&format!("{}/", prefix));
        }

        pattern == &qualified_name
    })
}

/// The combined allowlist that can select top-level `client_tools` on this
/// request, using the same namespaced `tool_call_allowlist` pattern syntax as
/// MCP tools: the GLOBAL `facets.tool_call_allowlist` (applied
/// regardless of selected facets), plus any selected regular facets, plus the
/// active action facet.
///
/// This is deliberately a SEPARATE function from the MCP path
/// (`build_mcp_tool_allowlist` + `merge_action_facet_into_mcp_allowlist`), not
/// shared plumbing, because client tools invert three of its policies — sharing
/// a collector would silently regress MCP:
/// 1. **Empty policy is opposite.** Client tools are strictly opt-in: an empty
///    result offers nothing. MCP collapses empty → `None` = all-tools-allowed
///    (opt-out). Reusing the MCP path would offer ALL client tools when none
///    are allowlisted.
/// 2. **No facets-empty gate.** The MCP path short-circuits to `None` when
///    `facets.facets` is empty; client tools intentionally do not,
///    so a global allowlist can activate a client tool with no facets at all.
/// 3. **Action facet is a flat union member here.** MCP folds it in
///    additively-only-on-`Some` (never resurrects a `None`/all-allowed base),
///    whereas here it is a first-class selector — action facets are the primary
///    client-tool path and live in a separate `action_facets` map.
fn effective_client_tool_allowlist(
    facets: &crate::config::FacetsConfig,
    action_facets: &crate::config::ActionFacetsConfig,
    selected_facet_ids: &[String],
    action_facet_id: Option<&str>,
) -> Vec<String> {
    let mut allowlist: Vec<String> = facets.tool_call_allowlist.clone();
    for facet_id in selected_facet_ids {
        if let Some(facet) = facets.facets.get(facet_id) {
            allowlist.extend(facet.tool_call_allowlist.iter().cloned());
        }
    }
    if let Some(id) = action_facet_id
        && let Some(facet) = action_facets.facets.get(id)
    {
        allowlist.extend(facet.tool_call_allowlist.iter().cloned());
    }
    allowlist
}

/// Merge an active action facet's `tool_call_allowlist` into the MCP tool
/// allowlist. Additive by design: it only extends an already-active (`Some`)
/// allowlist, so an action facet *adds* selectable MCP tools without turning a
/// deployment that had no MCP allowlisting (`None` = all tools allowed) into a
/// restrictive one. Patterns naming a client-tool namespace (e.g. `outlook/*`)
/// simply match no MCP server and are harmless here.
fn merge_action_facet_into_mcp_allowlist(
    facet_allowlist: Option<Vec<String>>,
    action_facet_patterns: &[String],
) -> Option<Vec<String>> {
    let mut allowlist = facet_allowlist?;
    for pattern in action_facet_patterns {
        if !allowlist.contains(pattern) {
            allowlist.push(pattern.clone());
        }
    }
    Some(allowlist)
}

#[cfg(test)]
mod tests {
    use super::{
        ApprovalDecisionItem, ContinueStreamRequest, MAX_DISPLAY_NAME_CHARS, McpToolCallGate,
        ReservedSelection, StreamRouteError, ToolApprovalDecision, apply_assistant_server_filter,
        derive_requested_server_ids_from_allowlist, detached_generation_event_sink,
        effective_client_tool_allowlist, expand_tool_patterns_with_discovered_tools,
        filter_mcp_tools_by_disabled_patterns, filter_mcp_tools_by_disabled_servers,
        filter_mcp_tools_by_write_access, gate_mcp_tool_call,
        merge_action_facet_into_mcp_allowlist, reserved_tool_selected, resolve_submitted_decisions,
    };
    use crate::config::{McpToolApprovalConfig, McpToolApprovalPreset};
    use crate::models::message::{ApprovalItem, ToolApprovalKind};
    use crate::models::user_tool_approval_setting::UserToolDecision;
    use crate::services::mcp_tool_approval::evaluate_mcp_tool_approval;
    use genai::chat::ToolCall;
    use rmcp::model::{Tool, ToolAnnotations};
    use sea_orm::prelude::Uuid;
    use serde_json::{Map, json};
    use std::collections::HashSet;

    fn managed_tool(
        server_id: &str,
        tool: Tool,
    ) -> crate::services::mcp_session_manager::ManagedTool {
        crate::services::mcp_session_manager::ManagedTool {
            server_id: server_id.to_string(),
            tool,
        }
    }

    #[test]
    fn writes_off_keeps_only_tools_the_server_marks_read_only() {
        let read_only = Tool::new("read_one", "reads", Map::new())
            .with_annotations(ToolAnnotations::new().read_only(true));
        let write = Tool::new("write_one", "writes", Map::new())
            .with_annotations(ToolAnnotations::new().read_only(false));
        let unannotated = Tool::new("unknown_one", "undeclared", Map::new());
        let tools = vec![
            managed_tool("files", read_only.clone()),
            managed_tool("files", write.clone()),
            managed_tool("other", unannotated.clone()),
        ];

        let (kept, suppressed) = filter_mcp_tools_by_write_access(tools.clone(), true);
        assert_eq!(kept.len(), 3);
        assert!(suppressed.is_empty());

        let (kept, suppressed) = filter_mcp_tools_by_write_access(tools, false);
        let kept: Vec<&str> = kept.iter().map(|tool| &*tool.tool.name).collect();
        assert_eq!(kept, vec!["read_one"]);
        assert_eq!(
            suppressed,
            HashSet::from([
                ("files".to_string(), "write_one".to_string()),
                ("other".to_string(), "unknown_one".to_string()),
            ]),
            "a tool without annotations is not read-only under protocol defaults"
        );
    }

    #[test]
    fn disabled_servers_lose_every_tool_and_other_servers_keep_theirs() {
        let tools = vec![
            managed_tool("files", Tool::new("read_file", "reads", Map::new())),
            managed_tool("files", Tool::new("list_files", "lists", Map::new())),
            managed_tool("other", Tool::new("read_file", "reads too", Map::new())),
        ];

        let kept = filter_mcp_tools_by_disabled_servers(tools.clone(), &[]);
        assert_eq!(kept.len(), 3);

        let kept = filter_mcp_tools_by_disabled_servers(tools, &["files".to_string()]);
        let kept: Vec<(&str, &str)> = kept
            .iter()
            .map(|tool| (tool.server_id.as_str(), &*tool.tool.name))
            .collect();
        assert_eq!(
            kept,
            vec![("other", "read_file")],
            "a same-named tool on another server is untouched"
        );
    }

    #[test]
    fn disabled_tool_patterns_drop_only_the_named_tools_and_report_them() {
        let tools = vec![
            managed_tool("files", Tool::new("read_file", "reads", Map::new())),
            managed_tool("files", Tool::new("list_files", "lists", Map::new())),
            managed_tool("other", Tool::new("read_file", "reads too", Map::new())),
        ];
        let names = |tools: &[crate::services::mcp_session_manager::ManagedTool]| {
            tools
                .iter()
                .map(|tool| format!("{}/{}", tool.server_id, tool.tool.name))
                .collect::<Vec<_>>()
        };

        let (kept, dropped) = filter_mcp_tools_by_disabled_patterns(tools.clone(), &[]);
        assert_eq!(kept.len(), 3);
        assert!(dropped.is_empty());

        let (kept, dropped) =
            filter_mcp_tools_by_disabled_patterns(tools.clone(), &["files/read_file".to_string()]);
        assert_eq!(
            names(&kept),
            vec!["files/list_files", "other/read_file"],
            "an exact pattern drops one tool and spares the same name elsewhere"
        );
        assert_eq!(dropped, vec!["files/read_file"]);

        let (kept, dropped) = filter_mcp_tools_by_disabled_patterns(
            tools.clone(),
            &["files/no_such_tool".to_string(), "gone/*".to_string()],
        );
        assert_eq!(
            kept.len(),
            3,
            "a pattern for a tool that vanished is a no-op"
        );
        assert!(dropped.is_empty(), "nothing withheld, nothing reported");

        let (kept, dropped) = filter_mcp_tools_by_disabled_patterns(
            tools,
            &["files/*".to_string(), "files/read_file".to_string()],
        );
        assert_eq!(names(&kept), vec!["other/read_file"]);
        assert_eq!(
            dropped,
            vec!["files/list_files", "files/read_file"],
            "reported once each, sorted, whichever patterns matched"
        );
    }

    #[test]
    fn reserved_tool_selected_by_star_namespace_and_exact() {
        let exact = vec!["erato/delegate_task".to_string()];
        assert_eq!(
            reserved_tool_selected("delegate_task", &exact),
            ReservedSelection::Exact
        );

        for pattern in ["*", "erato", "erato/*"] {
            assert_eq!(
                reserved_tool_selected("delegate_task", &[pattern.to_string()]),
                ReservedSelection::Pattern,
                "pattern {pattern} should select the reserved tool"
            );
        }

        // A different reserved name is not selected by an exact pattern for
        // another one.
        assert_eq!(
            reserved_tool_selected("collect_tasks", &exact),
            ReservedSelection::No
        );

        // Nor is an unrelated namespace a selector.
        assert_eq!(
            reserved_tool_selected("delegate_task", &["outlook/*".to_string()]),
            ReservedSelection::No
        );
    }

    #[test]
    fn reserved_tool_not_selected_by_empty_allowlist() {
        // The client-tool collector is opt-in: an empty allowlist selects
        // nothing, unlike the MCP allowlist whose `None` means "everything".
        assert_eq!(
            reserved_tool_selected("delegate_task", &[]),
            ReservedSelection::No
        );
    }

    #[test]
    fn reserved_patterns_are_dropped_from_template_expansions() {
        // A facet that pairs the built-in with a real MCP pattern must render
        // only the MCP tools in its prompt template.
        let patterns = [
            "erato/delegate_task".to_string(),
            "web-search-mcp/*".to_string(),
        ];
        let mcp_patterns: Vec<String> = patterns
            .iter()
            .filter(|pattern| !erato_config::config::pattern_names_reserved_namespace(pattern))
            .cloned()
            .collect();
        let discovered = vec![
            "web-search-mcp/search".to_string(),
            "web-search-mcp/fetch".to_string(),
        ];

        let expanded = expand_tool_patterns_with_discovered_tools(&mcp_patterns, &discovered);

        assert_eq!(
            expanded,
            vec![
                "web-search-mcp/fetch".to_string(),
                "web-search-mcp/search".to_string()
            ]
        );
        assert!(!expanded.iter().any(|entry| entry.starts_with("erato/")));
    }

    #[test]
    fn derives_server_ids_from_allowlist_patterns() {
        let allowlist = vec![
            "server_a/*".to_string(),
            "server_b/tool_x".to_string(),
            "server_c".to_string(),
        ];
        let derived =
            derive_requested_server_ids_from_allowlist(Some(&allowlist), true).expect("derived");
        assert_eq!(derived.len(), 3);
        assert!(derived.contains("server_a"));
        assert!(derived.contains("server_b"));
        assert!(derived.contains("server_c"));
    }

    #[test]
    fn does_not_prune_servers_when_allowlist_contains_wildcard_star() {
        let allowlist = vec!["*".to_string(), "server_a/*".to_string()];
        let derived = derive_requested_server_ids_from_allowlist(Some(&allowlist), true);
        assert!(derived.is_none());
    }

    #[test]
    fn applies_assistant_server_filter_by_intersection() {
        let derived = HashSet::from(["server_a".to_string(), "server_b".to_string()]);
        let assistant_server_ids = vec!["server_b".to_string(), "server_c".to_string()];

        let result = apply_assistant_server_filter(Some(derived), Some(&assistant_server_ids))
            .expect("assistant-restricted set");
        assert_eq!(result, HashSet::from(["server_b".to_string()]));
    }

    #[test]
    fn expands_wildcards_to_discovered_tools_for_facet_templates() {
        let patterns = vec!["server_a/*".to_string(), "server_b/tool_3".to_string()];
        let discovered = vec![
            "server_a/tool_1".to_string(),
            "server_a/tool_2".to_string(),
            "server_b/tool_3".to_string(),
        ];

        let expanded = expand_tool_patterns_with_discovered_tools(&patterns, &discovered);
        assert_eq!(
            expanded,
            vec![
                "server_a/tool_1".to_string(),
                "server_a/tool_2".to_string(),
                "server_b/tool_3".to_string(),
            ]
        );
    }

    #[test]
    fn effective_client_tool_allowlist_unions_global_facets_and_action_facet() {
        use crate::config::{ActionFacetConfig, ActionFacetsConfig, FacetConfig, FacetsConfig};
        use std::collections::HashMap;

        let experimental = FacetsConfig {
            tool_call_allowlist: vec!["client/*".to_string()], // global, regardless of facet
            facets: HashMap::from([(
                "web_search".to_string(),
                FacetConfig {
                    display_name: "Web".to_string(),
                    tool_call_allowlist: vec!["some_mcp/*".to_string()],
                    ..Default::default()
                },
            )]),
            ..Default::default()
        };
        let action_facets = ActionFacetsConfig {
            facets: HashMap::from([(
                "outlook_schedule".to_string(),
                ActionFacetConfig {
                    display_name: "Sched".to_string(),
                    template: "t".to_string(),
                    tool_call_allowlist: vec!["outlook/*".to_string()],
                    ..Default::default()
                },
            )]),
            ..Default::default()
        };

        // Global allowlist alone selects client tools — no facet, no action
        // facet needed (globally active).
        assert_eq!(
            effective_client_tool_allowlist(&experimental, &action_facets, &[], None),
            vec!["client/*".to_string()]
        );

        // Union of global + selected regular facet + active action facet.
        assert_eq!(
            effective_client_tool_allowlist(
                &experimental,
                &action_facets,
                &["web_search".to_string()],
                Some("outlook_schedule"),
            ),
            vec![
                "client/*".to_string(),
                "some_mcp/*".to_string(),
                "outlook/*".to_string(),
            ]
        );

        // Unknown facet ids contribute nothing.
        assert_eq!(
            effective_client_tool_allowlist(
                &experimental,
                &action_facets,
                &["missing".to_string()],
                Some("missing"),
            ),
            vec!["client/*".to_string()]
        );
    }

    #[test]
    fn approval_request_refuses_a_name_that_display_cleaning_would_change() {
        let restrictive = McpToolApprovalConfig {
            enabled: true,
            preset: McpToolApprovalPreset::Restrictive,
            allow_always: false,
        };
        let call = |fn_name: &str| ToolCall {
            call_id: "call-1".to_string(),
            fn_name: fn_name.to_string(),
            fn_arguments: json!({}),
            thought_signatures: None,
        };

        let plain = Tool::new("publish", "publish", Map::new());
        match gate_mcp_tool_call(&restrictive, "server", &plain, &call("publish"), None) {
            McpToolCallGate::Ask(request) => assert_eq!(request.tool_name, "publish"),
            other => panic!("expected an approval request, got {other:?}"),
        }

        let overridden = "publish\u{202E}hsilbup";
        let tool = Tool::new(overridden.to_string(), "publish", Map::new());
        match gate_mcp_tool_call(&restrictive, "server", &tool, &call(overridden), None) {
            McpToolCallGate::Refuse(message) => {
                assert!(!message.contains('\u{202E}'), "{message}");
                assert!(message.contains("publishhsilbup"), "{message}");
            }
            other => panic!("expected a refusal, got {other:?}"),
        }

        let long_name = "x".repeat(MAX_DISPLAY_NAME_CHARS + 1);
        let tool = Tool::new(long_name.clone(), "long", Map::new());
        assert!(matches!(
            gate_mcp_tool_call(&restrictive, "server", &tool, &call(&long_name), None),
            McpToolCallGate::Refuse(_)
        ));
    }

    fn open_approval(approval_id: &str) -> ApprovalItem {
        ApprovalItem {
            approval_id: approval_id.to_string(),
            tool_call_id: approval_id.to_string(),
            tool_name: "publish".to_string(),
            input: json!({}),
            child: None,
        }
    }

    fn legacy_request(decision: ToolApprovalDecision) -> ContinueStreamRequest {
        ContinueStreamRequest {
            message_id: Uuid::nil(),
            decisions: Vec::new(),
            decision: Some(decision),
        }
    }

    fn batch_request(decisions: Vec<(&str, ToolApprovalDecision)>) -> ContinueStreamRequest {
        ContinueStreamRequest {
            message_id: Uuid::nil(),
            decisions: decisions
                .into_iter()
                .map(|(approval_id, decision)| ApprovalDecisionItem {
                    approval_id: approval_id.to_string(),
                    decision,
                })
                .collect(),
            decision: None,
        }
    }

    #[test]
    fn gate_records_the_asked_call_as_one_mcp_tool_approval() {
        let restrictive = McpToolApprovalConfig {
            enabled: true,
            preset: McpToolApprovalPreset::Restrictive,
            allow_always: false,
        };
        let call = ToolCall {
            call_id: "call-1".to_string(),
            fn_name: "publish".to_string(),
            fn_arguments: json!({"topic": "news"}),
            thought_signatures: None,
        };
        let tool = Tool::new("publish", "publish", Map::new());

        match gate_mcp_tool_call(&restrictive, "server", &tool, &call, None) {
            McpToolCallGate::Ask(request) => {
                assert_eq!(request.kind, ToolApprovalKind::McpTool);
                assert_eq!(request.approvals.len(), 1);
                let item = &request.approvals[0];
                assert_eq!(item.approval_id, "call-1");
                assert_eq!(item.tool_call_id, request.tool_call_id);
                assert_eq!(item.tool_name, request.tool_name);
                assert_eq!(item.input, request.input);
                assert!(item.child.is_none());
                // The queue behind the gated call belongs to the caller.
                assert!(request.pending_tool_calls.is_empty());
            }
            other => panic!("expected an approval request, got {other:?}"),
        }
    }

    #[test]
    fn continue_request_accepts_legacy_form_only_when_one_open() {
        let one = [open_approval("call-1")];
        let resolved =
            resolve_submitted_decisions(&legacy_request(ToolApprovalDecision::Approve), &one)
                .expect("one open approval takes the legacy body");
        assert_eq!(
            resolved,
            vec![("call-1".to_string(), ToolApprovalDecision::Approve)]
        );

        let two = [open_approval("call-1"), open_approval("call-2")];
        let error =
            resolve_submitted_decisions(&legacy_request(ToolApprovalDecision::Approve), &two)
                .expect_err("two open approvals cannot be answered without naming them");
        match error {
            StreamRouteError::PlainText(status, message) => {
                assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
                assert!(message.contains("approval_id"), "{message}");
            }
            other => panic!("expected a plain 400, got {other:?}"),
        }
    }

    #[test]
    fn continue_request_must_cover_every_open_approval_and_no_others() {
        let open = [open_approval("call-1"), open_approval("call-2")];

        let resolved = resolve_submitted_decisions(
            &batch_request(vec![
                ("call-2", ToolApprovalDecision::Reject),
                ("call-1", ToolApprovalDecision::Approve),
            ]),
            &open,
        )
        .expect("a body covering both is accepted");
        // Row order, not body order: the continuation settles slots in the
        // order the calls were made.
        assert_eq!(
            resolved,
            vec![
                ("call-1".to_string(), ToolApprovalDecision::Approve),
                ("call-2".to_string(), ToolApprovalDecision::Reject),
            ]
        );

        let error = resolve_submitted_decisions(
            &batch_request(vec![("call-1", ToolApprovalDecision::Approve)]),
            &open,
        )
        .expect_err("a half-answered turn is refused");
        match error {
            StreamRouteError::DecisionsMismatch(body) => {
                assert_eq!(body.code, super::DECISIONS_MISMATCH_CODE);
                assert_eq!(body.missing, vec!["call-2".to_string()]);
                assert!(body.unknown.is_empty());
            }
            other => panic!("expected a decisions mismatch, got {other:?}"),
        }

        let error = resolve_submitted_decisions(
            &batch_request(vec![
                ("call-1", ToolApprovalDecision::Approve),
                ("call-2", ToolApprovalDecision::Approve),
                ("call-9", ToolApprovalDecision::Approve),
            ]),
            &open,
        )
        .expect_err("an approval this turn never opened is refused");
        match error {
            StreamRouteError::DecisionsMismatch(body) => {
                assert!(body.missing.is_empty());
                assert_eq!(body.unknown, vec!["call-9".to_string()]);
            }
            other => panic!("expected a decisions mismatch, got {other:?}"),
        }
    }

    /// The in-process arm of `run_continuation` has no reader on its channel, so
    /// nothing but the spawned drain keeps it moving. If that task ended with the
    /// call that spawned it, a continuation started by a turn rather than by a
    /// client would stall the moment it had emitted a channel's worth of events.
    #[tokio::test]
    async fn a_detached_event_sink_outlives_its_channels_capacity() {
        let tx = detached_generation_event_sink();
        for index in 0..250u32 {
            let sent = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                tx.send(Ok(axum::response::sse::Event::default()
                    .event("test")
                    .data(index.to_string()))),
            )
            .await
            .expect("the sink keeps draining");
            assert!(sent.is_ok(), "the sink stays open at event {index}");
        }
        // A forwarded failure is logged, not fatal: the next event still lands.
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tx.send(Err(color_eyre::eyre::eyre!("a forwarded generation error"))),
        )
        .await
        .expect("an error event does not block")
        .expect("an error event does not close the sink");
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tx.send(Ok(axum::response::sse::Event::default().data("after"))),
        )
        .await
        .expect("the sink survives an error event")
        .expect("the sink stays open after an error event");
    }

    /// `withdraw` is a decision value like any other: the single-value form
    /// carries no `approval_id`, so taking it for a multi-item park would be the
    /// one body that decides calls it never named.
    #[test]
    fn a_withdrawal_of_a_multi_item_park_is_submitted_per_item() {
        let open = [open_approval("call-1"), open_approval("call-2")];
        assert!(matches!(
            resolve_submitted_decisions(&legacy_request(ToolApprovalDecision::Withdraw), &open),
            Err(StreamRouteError::PlainText(
                axum::http::StatusCode::BAD_REQUEST,
                _
            ))
        ));

        let resolved = resolve_submitted_decisions(
            &batch_request(vec![
                ("call-1", ToolApprovalDecision::Withdraw),
                ("call-2", ToolApprovalDecision::Withdraw),
            ]),
            &open,
        )
        .expect("a withdrawal naming every open approval answers the whole turn");
        assert_eq!(
            resolved,
            vec![
                ("call-1".to_string(), ToolApprovalDecision::Withdraw),
                ("call-2".to_string(), ToolApprovalDecision::Withdraw),
            ]
        );
    }

    #[test]
    fn continue_request_refuses_an_ambiguous_body() {
        let open = [open_approval("call-1")];

        let mut both = batch_request(vec![("call-1", ToolApprovalDecision::Approve)]);
        both.decision = Some(ToolApprovalDecision::Reject);
        assert!(matches!(
            resolve_submitted_decisions(&both, &open),
            Err(StreamRouteError::PlainText(
                axum::http::StatusCode::BAD_REQUEST,
                _
            ))
        ));

        let empty = ContinueStreamRequest {
            message_id: Uuid::nil(),
            decisions: Vec::new(),
            decision: None,
        };
        assert!(matches!(
            resolve_submitted_decisions(&empty, &open),
            Err(StreamRouteError::PlainText(
                axum::http::StatusCode::BAD_REQUEST,
                _
            ))
        ));

        let twice = batch_request(vec![
            ("call-1", ToolApprovalDecision::Approve),
            ("call-1", ToolApprovalDecision::Reject),
        ]);
        match resolve_submitted_decisions(&twice, &open) {
            Err(StreamRouteError::PlainText(status, message)) => {
                assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
                assert!(message.contains("decided twice"), "{message}");
            }
            other => panic!("expected a plain 400, got {other:?}"),
        }
    }

    #[test]
    fn withdraw_is_not_an_approval() {
        assert!(!ToolApprovalDecision::Withdraw.is_approval());
        assert!(ToolApprovalDecision::Approve.is_approval());
        assert!(ToolApprovalDecision::ApproveAlways.is_approval());
        assert!(!ToolApprovalDecision::Reject.is_approval());
        assert!(!ToolApprovalDecision::RejectAlways.is_approval());
    }

    #[test]
    fn approval_presets_interpret_open_world_and_missing_annotations() {
        let call = ToolCall {
            call_id: "call-1".to_string(),
            fn_name: "publish".to_string(),
            fn_arguments: json!({}),
            thought_signatures: None,
        };
        let open_world_non_destructive =
            Tool::new("publish", "publish", Map::new()).with_annotations(
                ToolAnnotations::from_raw(None, Some(false), Some(false), Some(true), Some(true)),
            );
        let unannotated = Tool::new("unknown", "unknown", Map::new());
        let permissive = McpToolApprovalConfig {
            enabled: true,
            preset: McpToolApprovalPreset::Permissive,
            allow_always: false,
        };
        let restrictive = McpToolApprovalConfig {
            preset: McpToolApprovalPreset::Restrictive,
            ..permissive.clone()
        };

        let disabled = McpToolApprovalConfig {
            enabled: false,
            ..restrictive.clone()
        };

        // The gate and the enumeration projection must read the same verdict.
        let cases = [
            (&permissive, &open_world_non_destructive, false),
            (&restrictive, &open_world_non_destructive, true),
            (&permissive, &unannotated, true),
            (&restrictive, &unannotated, true),
            (&disabled, &unannotated, false),
        ];
        for (config, tool, expected) in cases {
            let gate = gate_mcp_tool_call(config, "server", tool, &call, None);
            let verdict = evaluate_mcp_tool_approval(config, tool);
            let asks = matches!(gate, McpToolCallGate::Ask(_));
            assert_eq!(asks, expected, "{:?} {}", config, tool.name);
            assert_eq!(verdict.requires_approval, asks);
            match gate {
                McpToolCallGate::Ask(request) => {
                    assert_eq!(request.annotations, verdict.annotations)
                }
                other => assert_eq!(other, McpToolCallGate::Run),
            }
        }

        // The user's own decision escalates a policy-auto tool to ask and
        // lets a grant bypass a policy-ask tool, while the gate is on.
        let read_only_closed = Tool::new("read", "read", Map::new()).with_annotations(
            ToolAnnotations::from_raw(None, Some(true), Some(false), Some(true), Some(false)),
        );
        let ask = Some(UserToolDecision::Ask);
        assert!(matches!(
            gate_mcp_tool_call(&permissive, "server", &read_only_closed, &call, ask),
            McpToolCallGate::Ask(_)
        ));
        assert_eq!(
            gate_mcp_tool_call(&disabled, "server", &read_only_closed, &call, ask),
            McpToolCallGate::Run
        );
        let granting = McpToolApprovalConfig {
            allow_always: true,
            ..restrictive.clone()
        };
        let grant = Some(UserToolDecision::AlwaysAllow);
        assert_eq!(
            gate_mcp_tool_call(&granting, "server", &unannotated, &call, grant),
            McpToolCallGate::Run
        );
        assert!(matches!(
            gate_mcp_tool_call(&restrictive, "server", &unannotated, &call, grant),
            McpToolCallGate::Ask(_)
        ));
    }

    #[test]
    fn a_denial_is_refused_at_the_gate_under_every_policy() {
        let call = ToolCall {
            call_id: "call-1".to_string(),
            fn_name: "publish".to_string(),
            fn_arguments: json!({}),
            thought_signatures: None,
        };
        let read_only_closed = Tool::new("read", "read", Map::new()).with_annotations(
            ToolAnnotations::from_raw(None, Some(true), Some(false), Some(true), Some(false)),
        );
        let unannotated = Tool::new("unknown", "unknown", Map::new());
        let permissive = McpToolApprovalConfig {
            enabled: true,
            preset: McpToolApprovalPreset::Permissive,
            allow_always: false,
        };
        let restrictive = McpToolApprovalConfig {
            preset: McpToolApprovalPreset::Restrictive,
            ..permissive.clone()
        };
        let granting = McpToolApprovalConfig {
            allow_always: true,
            ..restrictive.clone()
        };
        let disabled = McpToolApprovalConfig {
            enabled: false,
            ..permissive.clone()
        };

        // A denial stored after the tool set was prepared reaches the gate
        // as a live row; it must never read as "run without asking", nor
        // park on a card the user has already answered.
        let denied = Some(UserToolDecision::Denied);
        for config in [&permissive, &restrictive, &granting, &disabled] {
            for tool in [&read_only_closed, &unannotated] {
                match gate_mcp_tool_call(config, "server", tool, &call, denied) {
                    McpToolCallGate::Refuse(message) => {
                        assert!(message.contains("'publish'"), "{:?} {}", config, tool.name);
                        assert!(
                            message.contains("was not executed"),
                            "{:?} {}",
                            config,
                            tool.name
                        );
                    }
                    other => panic!("{:?} {} gated as {:?}", config, tool.name, other),
                }
            }
        }
    }

    #[test]
    fn active_hidden_facet_ids_scopes_by_platform() {
        use super::active_hidden_facet_ids;
        use crate::config::{FacetConfig, FacetsConfig};
        use std::collections::HashMap;

        let hidden = |platform: Option<&str>| FacetConfig {
            display_name: "Baseline".to_string(),
            hidden: true,
            hidden_always_active_for_platform: platform.map(str::to_string),
            delegation: None,
            ..Default::default()
        };
        let config = FacetsConfig {
            facets: HashMap::from([
                ("outlook_baseline".to_string(), hidden(Some("outlook"))),
                ("teams_baseline".to_string(), hidden(Some("teams"))),
                ("global_baseline".to_string(), hidden(None)),
                (
                    "web_search".to_string(),
                    FacetConfig {
                        display_name: "Web".to_string(),
                        ..Default::default() // not hidden
                    },
                ),
            ]),
            ..Default::default()
        };

        // Outlook request: outlook (platform match) + global (no platform);
        // teams excluded, non-hidden facet excluded. Id-sorted.
        assert_eq!(
            active_hidden_facet_ids(&config, Some("outlook")),
            vec![
                "global_baseline".to_string(),
                "outlook_baseline".to_string()
            ]
        );
        // Web request: only the platform-agnostic global baseline.
        assert_eq!(
            active_hidden_facet_ids(&config, Some("web")),
            vec!["global_baseline".to_string()]
        );
        // No platform on the request: still gets the global baseline.
        assert_eq!(
            active_hidden_facet_ids(&config, None),
            vec!["global_baseline".to_string()]
        );
    }

    #[test]
    fn sanitize_drops_hidden_facets_from_user_selection() {
        use super::sanitize_selected_facet_ids;
        use crate::config::{FacetConfig, FacetsConfig};
        use std::collections::HashMap;

        let config = FacetsConfig {
            facets: HashMap::from([
                (
                    "web_search".to_string(),
                    FacetConfig {
                        display_name: "Web".to_string(),
                        ..Default::default()
                    },
                ),
                (
                    "outlook_baseline".to_string(),
                    FacetConfig {
                        display_name: "Baseline".to_string(),
                        hidden: true,
                        hidden_always_active_for_platform: Some("outlook".to_string()),
                        delegation: None,
                        ..Default::default()
                    },
                ),
            ]),
            ..Default::default()
        };

        // A user cannot force a hidden facet on by naming its id; only the
        // selectable facet survives.
        assert_eq!(
            sanitize_selected_facet_ids(
                &config,
                &["web_search".to_string(), "outlook_baseline".to_string()],
            ),
            vec!["web_search".to_string()]
        );
    }

    #[test]
    fn merge_action_facet_allowlist_leaves_none_unrestricted() {
        // No MCP allowlist active (all tools allowed): an action facet must not
        // turn that into a restrictive allowlist.
        let merged = merge_action_facet_into_mcp_allowlist(None, &["outlook/*".to_string()]);
        assert!(merged.is_none());
    }

    #[test]
    fn merge_action_facet_allowlist_extends_active_allowlist_deduped() {
        let base = Some(vec!["server_a/*".to_string(), "outlook/*".to_string()]);
        let merged = merge_action_facet_into_mcp_allowlist(
            base,
            &["outlook/*".to_string(), "server_b/tool_x".to_string()],
        );
        assert_eq!(
            merged,
            Some(vec![
                "server_a/*".to_string(),
                "outlook/*".to_string(),
                "server_b/tool_x".to_string(),
            ])
        );
    }

    #[test]
    fn merge_action_facet_allowlist_noop_for_empty_patterns() {
        let base = Some(vec!["server_a/*".to_string()]);
        let merged = merge_action_facet_into_mcp_allowlist(base.clone(), &[]);
        assert_eq!(merged, base);
    }

    // ========================================================================
    // validate_action_facet tests
    // ========================================================================

    mod validate_action_facet_tests {
        use super::super::{ACTION_FACET_ARG_MAX_SIZE, ActionFacetRequest, validate_action_facet};
        use crate::config::{ActionFacetConfig, AppConfig};
        use std::collections::HashMap;

        fn config_with_facet(id: &str, af: ActionFacetConfig) -> AppConfig {
            let mut config = AppConfig::default();
            config.action_facets.facets.insert(id.to_string(), af);
            config
        }

        #[test]
        fn none_action_facet_is_ok() {
            let config = AppConfig::default();
            assert!(validate_action_facet(&config, None, "web").is_ok());
        }

        #[test]
        fn unknown_id_is_rejected() {
            let config = AppConfig::default();
            let af = ActionFacetRequest {
                id: "nonexistent".to_string(),
                args: HashMap::new(),
            };
            let err = validate_action_facet(&config, Some(&af), "web").unwrap_err();
            assert_eq!(err.0, axum::http::StatusCode::BAD_REQUEST);
            assert!(err.1.contains("Unknown action facet"));
        }

        #[test]
        fn valid_facet_no_platform_constraint() {
            let config = config_with_facet(
                "summarize",
                ActionFacetConfig {
                    display_name: "Summarize".to_string(),
                    platform: None,
                    template: "Summarize this".to_string(),
                    allowed_args: vec![],
                    client_actions: vec![],
                    presentation: None,
                    client_actions_always_ask: vec![],
                    tool_call_allowlist: vec![],
                },
            );
            let af = ActionFacetRequest {
                id: "summarize".to_string(),
                args: HashMap::new(),
            };
            assert!(validate_action_facet(&config, Some(&af), "web").is_ok());
            assert!(validate_action_facet(&config, Some(&af), "teams").is_ok());
        }

        #[test]
        fn platform_mismatch_is_rejected() {
            let config = config_with_facet(
                "teams_reply",
                ActionFacetConfig {
                    display_name: "Teams Reply".to_string(),
                    platform: Some("teams".to_string()),
                    template: "Reply".to_string(),
                    allowed_args: vec![],
                    client_actions: vec![],
                    presentation: None,
                    client_actions_always_ask: vec![],
                    tool_call_allowlist: vec![],
                },
            );
            let af = ActionFacetRequest {
                id: "teams_reply".to_string(),
                args: HashMap::new(),
            };
            let err = validate_action_facet(&config, Some(&af), "web").unwrap_err();
            assert_eq!(err.0, axum::http::StatusCode::BAD_REQUEST);
            assert!(err.1.contains("requires platform 'teams'"));
        }

        #[test]
        fn platform_match_passes() {
            let config = config_with_facet(
                "teams_reply",
                ActionFacetConfig {
                    display_name: "Teams Reply".to_string(),
                    platform: Some("teams".to_string()),
                    template: "Reply".to_string(),
                    allowed_args: vec![],
                    client_actions: vec![],
                    presentation: None,
                    client_actions_always_ask: vec![],
                    tool_call_allowlist: vec![],
                },
            );
            let af = ActionFacetRequest {
                id: "teams_reply".to_string(),
                args: HashMap::new(),
            };
            assert!(validate_action_facet(&config, Some(&af), "teams").is_ok());
        }

        #[test]
        fn unexpected_arg_key_is_rejected() {
            let config = config_with_facet(
                "compose",
                ActionFacetConfig {
                    display_name: "Compose".to_string(),
                    platform: None,
                    template: "Write about {{topic}}".to_string(),
                    allowed_args: vec!["topic".to_string()],
                    client_actions: vec![],
                    presentation: None,
                    client_actions_always_ask: vec![],
                    tool_call_allowlist: vec![],
                },
            );
            let af = ActionFacetRequest {
                id: "compose".to_string(),
                args: HashMap::from([("rogue_key".to_string(), "value".to_string())]),
            };
            let err = validate_action_facet(&config, Some(&af), "web").unwrap_err();
            assert_eq!(err.0, axum::http::StatusCode::BAD_REQUEST);
            assert!(err.1.contains("Unexpected argument 'rogue_key'"));
        }

        #[test]
        fn allowed_arg_passes() {
            let config = config_with_facet(
                "compose",
                ActionFacetConfig {
                    display_name: "Compose".to_string(),
                    platform: None,
                    template: "Write about {{topic}}".to_string(),
                    allowed_args: vec!["topic".to_string()],
                    client_actions: vec![],
                    presentation: None,
                    client_actions_always_ask: vec![],
                    tool_call_allowlist: vec![],
                },
            );
            let af = ActionFacetRequest {
                id: "compose".to_string(),
                args: HashMap::from([("topic".to_string(), "rust".to_string())]),
            };
            assert!(validate_action_facet(&config, Some(&af), "web").is_ok());
        }

        #[test]
        fn oversized_arg_value_is_rejected() {
            let config = config_with_facet(
                "paste",
                ActionFacetConfig {
                    display_name: "Paste".to_string(),
                    platform: None,
                    template: "{{content}}".to_string(),
                    allowed_args: vec!["content".to_string()],
                    client_actions: vec![],
                    presentation: None,
                    client_actions_always_ask: vec![],
                    tool_call_allowlist: vec![],
                },
            );
            let oversized = "x".repeat(ACTION_FACET_ARG_MAX_SIZE + 1);
            let af = ActionFacetRequest {
                id: "paste".to_string(),
                args: HashMap::from([("content".to_string(), oversized)]),
            };
            let err = validate_action_facet(&config, Some(&af), "web").unwrap_err();
            assert_eq!(err.0, axum::http::StatusCode::BAD_REQUEST);
            assert!(err.1.contains("exceeds maximum size"));
        }

        #[test]
        fn arg_value_at_exact_limit_passes() {
            let config = config_with_facet(
                "paste",
                ActionFacetConfig {
                    display_name: "Paste".to_string(),
                    platform: None,
                    template: "{{content}}".to_string(),
                    allowed_args: vec!["content".to_string()],
                    client_actions: vec![],
                    presentation: None,
                    client_actions_always_ask: vec![],
                    tool_call_allowlist: vec![],
                },
            );
            let at_limit = "x".repeat(ACTION_FACET_ARG_MAX_SIZE);
            let af = ActionFacetRequest {
                id: "paste".to_string(),
                args: HashMap::from([("content".to_string(), at_limit)]),
            };
            assert!(validate_action_facet(&config, Some(&af), "web").is_ok());
        }
    }

    mod is_known_platform_tests {
        use super::super::is_known_platform;
        use crate::config::{ActionFacetConfig, AppConfig};

        fn config_with_outlook() -> AppConfig {
            let mut config = AppConfig::default();
            config.action_facets.facets.insert(
                "outlook_rewrite".to_string(),
                ActionFacetConfig {
                    display_name: "Rewrite".to_string(),
                    platform: Some("outlook".to_string()),
                    template: "Rewrite {{text}}".to_string(),
                    allowed_args: vec!["text".to_string()],
                    client_actions: vec![],
                    presentation: None,
                    client_actions_always_ask: vec![],
                    tool_call_allowlist: vec![],
                },
            );
            config
        }

        #[test]
        fn web_is_always_known() {
            let config = AppConfig::default();
            assert!(is_known_platform(&config, "web"));
        }

        #[test]
        fn web_is_known_even_with_action_facets() {
            let config = config_with_outlook();
            assert!(is_known_platform(&config, "web"));
        }

        #[test]
        fn configured_action_facet_platform_is_known() {
            let config = config_with_outlook();
            assert!(is_known_platform(&config, "outlook"));
        }

        #[test]
        fn unconfigured_platform_is_unknown() {
            let config = config_with_outlook();
            assert!(!is_known_platform(&config, "excel"));
        }

        #[test]
        fn office_runtime_values_are_not_known() {
            let config = config_with_outlook();
            assert!(!is_known_platform(&config, "OfficeOnline"));
            assert!(!is_known_platform(&config, "PC"));
            assert!(!is_known_platform(&config, "Mac"));
        }

        #[test]
        fn no_action_facets_only_web_is_known() {
            let config = AppConfig::default();
            assert!(is_known_platform(&config, "web"));
            assert!(!is_known_platform(&config, "outlook"));
        }

        #[test]
        fn action_facet_without_platform_does_not_add_known_values() {
            let mut config = AppConfig::default();
            config.action_facets.facets.insert(
                "generic".to_string(),
                ActionFacetConfig {
                    display_name: "Generic".to_string(),
                    platform: None,
                    template: "Do something".to_string(),
                    allowed_args: vec![],
                    client_actions: vec![],
                    presentation: None,
                    client_actions_always_ask: vec![],
                    tool_call_allowlist: vec![],
                },
            );
            assert!(is_known_platform(&config, "web"));
            assert!(!is_known_platform(&config, "outlook"));
        }
    }
}

// ===== UNIFIED VALIDATION HELPERS =====

/// Validates that a message exists and has the expected role.
/// Returns the parsed message schema if successful, otherwise returns an HTTP error.
async fn validate_message_role(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    message_id: &Uuid,
    expected_role: MessageRole,
    message_name: &str, // e.g., "previous_message_id", "current_message_id", "message_id"
) -> Result<MessageSchema, (axum::http::StatusCode, String)> {
    let message =
        match get_message_by_id(&app_state.db, policy, &me_user.to_subject(), message_id).await {
            Err(err) => {
                return Err((
                    axum::http::StatusCode::BAD_REQUEST,
                    format!("Failed to get {}: {}", message_name, err),
                ));
            }
            Ok(msg) => msg,
        };

    let message_parsed = match MessageSchema::validate(&message.raw_message) {
        Err(err) => {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                format!("Failed to parse {}: {}", message_name, err),
            ));
        }
        Ok(parsed) => parsed,
    };

    if message_parsed.role != expected_role {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            format!(
                "The provided `{}` must be the message ID of a message with role `{}`.",
                message_name,
                match expected_role {
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                    MessageRole::System => "system",
                    MessageRole::Tool => "tool",
                }
            ),
        ));
    }

    Ok(message_parsed)
}

/// Validation result for the regenerate endpoint
struct RegenerateValidationResult {
    #[allow(dead_code)] // current_message is validated but not directly used in the task
    current_message: messages::Model,
    previous_message: messages::Model,
}

/// Validates the regenerate endpoint requirements:
/// - current_message_id must exist and be an assistant message
/// - it must have a previous_message_id that exists and is a user message
async fn validate_regenerate_request(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    current_message_id: &Uuid,
) -> Result<RegenerateValidationResult, (axum::http::StatusCode, String)> {
    // Validate current message exists and is an assistant message
    let current_message = get_message_by_id(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        current_message_id,
    )
    .await
    .map_err(|err| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            format!("Failed to get current_message_id: {}", err),
        )
    })?;

    validate_message_role(
        app_state,
        policy,
        me_user,
        current_message_id,
        MessageRole::Assistant,
        "current_message_id",
    )
    .await?;

    // Verify current message has a previous message
    let previous_message_id = current_message.previous_message_id.ok_or((
        axum::http::StatusCode::BAD_REQUEST,
        "The current message has no previous message".to_string(),
    ))?;

    // Validate previous message exists and is a user message
    let previous_message = get_message_by_id(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &previous_message_id,
    )
    .await
    .map_err(|err| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            format!("Failed to get previous message: {}", err),
        )
    })?;

    validate_message_role(
        app_state,
        policy,
        me_user,
        &previous_message_id,
        MessageRole::User,
        "previous message of the provided current_message_id",
    )
    .await?;

    Ok(RegenerateValidationResult {
        current_message,
        previous_message,
    })
}

/// Validates the submit endpoint requirements:
/// - previous_message_id (if provided) must exist and be an assistant message
async fn validate_submit_request(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    previous_message_id: Option<&Uuid>,
    input_file_ids: &[Uuid],
) -> Result<(), (axum::http::StatusCode, String)> {
    validate_file_uploads_for_message_submit(app_state, policy, me_user, input_file_ids).await?;

    if let Some(prev_msg_id) = previous_message_id {
        validate_message_role(
            app_state,
            policy,
            me_user,
            prev_msg_id,
            MessageRole::Assistant,
            "previous_message_id",
        )
        .await?;
    }
    Ok(())
}

/// Validates the edit endpoint requirements:
/// - message_id must exist and be a user message
async fn validate_edit_request(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    message_id: &Uuid,
) -> Result<messages::Model, (axum::http::StatusCode, String)> {
    let message = get_message_by_id(&app_state.db, policy, &me_user.to_subject(), message_id)
        .await
        .map_err(|err| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                format!("Failed to get message: {}", err),
            )
        })?;

    validate_message_role(
        app_state,
        policy,
        me_user,
        message_id,
        MessageRole::User,
        "message_id",
    )
    .await?;

    Ok(message)
}

async fn validate_file_uploads_for_message_submit(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    input_file_ids: &[Uuid],
) -> Result<(), (axum::http::StatusCode, String)> {
    let max_files = app_state.config.frontend.max_files;
    if input_file_ids.len() > max_files {
        return Err((
            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            format!(
                "A message can include at most {} file attachments.",
                max_files
            ),
        ));
    }

    let mut audio_attachment_count = 0usize;

    for file_upload_id in input_file_ids {
        let file_upload = crate::models::file_upload::get_file_upload_by_id(
            &app_state.db,
            policy,
            &me_user.to_subject(),
            file_upload_id,
        )
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                format!("Unable to load input file {}: {}", file_upload_id, e),
            )
        })?;

        if file_upload.audio_transcription.is_some() {
            audio_attachment_count += 1;
        }

        if let Some(blocking_reason) =
            crate::models::file_upload::get_audio_transcription_blocking_reason(&file_upload)
        {
            return Err((axum::http::StatusCode::BAD_REQUEST, blocking_reason));
        }

        if audio_attachment_count > 1 {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                "Only one audio transcription attachment is allowed per message.".to_string(),
            ));
        }
    }

    Ok(())
}

/// Reject a write into an archived chat with 409 CONFLICT.
///
/// Every write entry point calls this after resolving its target chat, so an
/// archived chat is rejected with a clean HTTP status before any stream opens.
/// Reads (get_chat_messages), abort, client_tool_result and resume are out of
/// scope and must not call this.
pub(crate) fn reject_if_archived(
    chat: &chats::Model,
) -> Result<(), (axum::http::StatusCode, String)> {
    if chat.archived_at.is_some() {
        return Err((
            axum::http::StatusCode::CONFLICT,
            "Chat is archived and cannot receive new messages".to_string(),
        ));
    }
    Ok(())
}

/// Let a user's write land on a delegated chat, or reject it with 409 CONFLICT
/// while the run is still going.
///
/// A user can reach a delegated run mid-flight through the origin chat's
/// delegation trace, and `start_task` replaces a chat's task entry rather than
/// refusing, so an unguarded submit would leave two generations writing the
/// same chat. Submit, edit and regenerate are gated; the approval continuation
/// is not, because it resumes the parked generation instead of starting a
/// second one. Once the run finishes the chat is a normal chat the user can
/// continue — and continuing it is recorded, because a run the user works in
/// is no longer the throwaway artifact the retention pass may archive.
///
/// The in-memory task only knows about this replica, so the chat's own
/// generation lease is checked as well.
async fn accept_user_write_into_delegated_run(
    app_state: &AppState,
    chat: &chats::Model,
) -> Result<(), (axum::http::StatusCode, String)> {
    if !crate::models::chat::chat_is_delegated_run(chat) {
        return Ok(());
    }

    let local_task_running = app_state
        .background_tasks
        .get_task(&chat.id)
        .await
        .is_some_and(|task| !task.is_completed());
    let lease_running = crate::models::chat::chat_generation_is_running(
        &app_state.db,
        &chat.id,
        app_state.config.generation_status.stale_after_secs,
    )
    .await
    .map_err(|error| {
        tracing::warn!(%error, chat_id = %chat.id, "Failed to read the delegated run's generation lease");
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load chat".to_string(),
        )
    })?;
    if local_task_running || lease_running {
        return Err((
            axum::http::StatusCode::CONFLICT,
            "Delegated run is still in progress and cannot receive new messages".to_string(),
        ));
    }

    if let Err(error) = crate::models::chat::mark_delegated_run_adopted(&app_state.db, chat).await {
        tracing::warn!(%error, chat_id = %chat.id, "Failed to mark the delegated run as adopted");
    }
    Ok(())
}

#[utoipa::path(
    post,
    path = "/me/messages/submitstream",
    request_body = MessageSubmitRequest,
    responses(
        (status = OK, content_type="text/event-stream", body = MessageSubmitStreamingResponseMessage),
        (status = BAD_REQUEST, description = "When validation fails (e.g., invalid previous_message_id)"),
        (status = NOT_FOUND, description = "When the chat does not exist or is not accessible"),
        (status = CONFLICT, body = GenerationRunningError, description = "When the chat is archived, or is a delegated run that is still in progress (plain text), or the chat's generation lease is already held and delegation.tasks.enabled is on (JSON, code = generation_running)"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "When an internal server error occurs")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn message_submit_sse(
    State(app_state): State<AppState>,
    Extension(policy): Extension<PolicyEngine>,
    Extension(me_user): Extension<MeProfile>,
    headers: HeaderMap,
    Json(request): Json<MessageSubmitRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Report>>>, StreamRouteError> {
    // Validate request parameters
    validate_submit_request(
        &app_state,
        &policy,
        &me_user,
        request.previous_message_id.as_ref(),
        request.input_files_ids.as_slice(),
    )
    .await?;

    // Validate action facet before spawning background task (returns HTTP 400 on failure)
    let generation_request_context = generation_request_context_from_headers(&headers);
    let platform = generation_request_context
        .platform
        .as_deref()
        .unwrap_or(DEFAULT_ERATO_PLATFORM);
    warn_unknown_platform(&app_state.config, platform);
    validate_action_facet(&app_state.config, request.action_facet.as_ref(), platform)?;

    // Determine the chat_id first so we can use it as the background task key
    let (chat_id, chat_was_created, chat_assistant_id, chat_is_delegated) =
        if let Some(existing_chat_id) = request.existing_chat_id {
            let (chat, _) = get_or_create_chat(
                &app_state.db,
                &policy,
                &me_user.to_subject(),
                Some(&existing_chat_id),
                &me_user.id,
                None,
                None,
                None,
                None,
                None,
            )
            .await
            .map_err(|e| {
                let s = e.to_string();
                if s.contains("not found")
                    || s.contains("Access denied")
                    || s.contains("not authorized")
                {
                    (
                        axum::http::StatusCode::NOT_FOUND,
                        "Chat not found".to_string(),
                    )
                } else {
                    (
                        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to load chat".to_string(),
                    )
                }
            })?;
            reject_if_archived(&chat)?;
            accept_user_write_into_delegated_run(&app_state, &chat).await?;
            (
                existing_chat_id,
                false,
                chat.assistant_id,
                crate::models::chat::chat_is_delegated_run(&chat),
            )
        } else {
            // Need to get or create chat to determine the chat_id
            let (chat, chat_status) = get_or_create_chat_by_previous_message_id(
                &app_state.db,
                &policy,
                &me_user.to_subject(),
                request.previous_message_id.as_ref(),
                &me_user.id,
                request.assistant_id.as_ref(),
                request.title_by_user_provided.clone(),
                request.mcp_write_tools_enabled,
                request.disabled_mcp_server_ids.clone(),
                request.disabled_mcp_tools.clone(),
            )
            .await
            .map_err(|e| {
                let s = e.to_string();
                if s.contains("not found")
                    || s.contains("Access denied")
                    || s.contains("not authorized")
                {
                    (
                        axum::http::StatusCode::NOT_FOUND,
                        "Chat or previous message not found".to_string(),
                    )
                } else {
                    (
                        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to get or create chat".to_string(),
                    )
                }
            })?;

            // A brand-new chat has archived_at = None, so new-chat creation is
            // unaffected; only writes resolved onto an existing archived chat 409.
            reject_if_archived(&chat)?;
            // A previous_message_id can resolve onto a live delegated run.
            accept_user_write_into_delegated_run(&app_state, &chat).await?;

            let was_created = chat_status == ChatCreationStatus::Created;

            (
                chat.id,
                was_created,
                chat.assistant_id,
                crate::models::chat::chat_is_delegated_run(&chat),
            )
        };

    // Validate assistant mentions before spawning (returns HTTP 400 on failure).
    // The validated targets feed the delegation tool offer.
    let delegation_targets = crate::services::delegation::validate_mentioned_assistants(
        &app_state,
        &policy,
        &me_user.to_subject(),
        request.mentioned_assistant_ids.as_deref(),
        chat_assistant_id,
        chat_is_delegated,
    )
    .await?;

    // Take the chat's generation lease. message_id is set later.
    let (broadcast_rx, task) =
        acquire_user_generation_lease(&app_state, chat_id, Uuid::new_v4()).await?;

    // Clone variables for the background task
    let app_state_bg = app_state.clone();
    let policy_bg = policy.clone();
    let me_user_bg = me_user.clone();
    let task_clone = Arc::clone(&task);
    let request_clone = request.clone();

    // Time from dispatch until the generation task is first polled.
    let dispatch_wait = crate::latency::StageTimer::new("generation.dispatch_wait");
    // Spawn the background generation task
    tokio::spawn(
        async move {
            drop(dispatch_wait);
            tracing::info!("Starting background task for chat_id: {}", chat_id);
            let result = with_generation_task_lifecycle(
                &app_state_bg.background_tasks,
                &task_clone,
                chat_id,
                run_message_submit_task(
                    &task_clone,
                    &app_state_bg,
                    &policy_bg,
                    &me_user_bg,
                    &request_clone,
                    generation_request_context,
                    chat_id,
                    chat_was_created,
                    delegation_targets,
                ),
            )
            .await;

            // Re-derived rather than returned: the lifecycle reads the same
            // atomics to write the lease's terminal state, so the two cannot
            // disagree.
            let outcome = task_clone.derive_outcome(result.is_err());
            settle_tail_deliveries(
                &app_state_bg,
                &policy_bg,
                &me_user_bg,
                chat_id,
                &task_clone,
                outcome,
            )
            .await;
        }
        .in_current_span(),
    );

    // Convert broadcast receiver to SSE stream
    let event_stream = {
        use futures::StreamExt;
        let broadcast_stream = tokio_stream::wrappers::BroadcastStream::new(broadcast_rx);
        futures::StreamExt::filter_map(broadcast_stream, |result| {
            futures::future::ready(match result {
                Ok(streaming_event) => {
                    // Convert StreamingEvent to SSE Event
                    match streaming_event_to_sse(&streaming_event) {
                        Ok(sse_event) => Some(Ok(sse_event)),
                        Err(e) => Some(Err(e)),
                    }
                }
                Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
                    tracing::warn!("Client lagged behind by {} events", n);
                    None
                }
            })
        })
        .inspect(|event| {
            if let Err(err) = event {
                log_and_capture_error("submit SSE serialization", err);
            }
        })
    };

    Ok(Sse::new(event_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    ))
}

#[cfg(test)]
mod reasoning_replay_tests {
    use super::*;

    struct InMemoryResponsesChatProvider;

    impl InMemoryResponsesChatProvider {
        fn validate_reasoning_replay_request(chat_request: &ChatRequest) -> Result<(), String> {
            let has_encrypted_reasoning_replay = chat_request.messages.iter().any(|message| {
                message.content.parts().iter().any(|part| {
                    matches!(
                        part,
                        GenAiContentPart::ReasoningItem(ReasoningItem {
                            encrypted_content: Some(_),
                            ..
                        })
                    )
                })
            });

            if !has_encrypted_reasoning_replay {
                return Ok(());
            }

            let summary_only_reasoning_indexes = chat_request
                .messages
                .iter()
                .enumerate()
                .filter_map(|(index, message)| {
                    message
                        .content
                        .parts()
                        .iter()
                        .any(|part| matches!(part, GenAiContentPart::ReasoningContent(_)))
                        .then_some(index)
                })
                .collect::<Vec<_>>();

            if summary_only_reasoning_indexes.is_empty() {
                Ok(())
            } else {
                Err(format!(
                    "Responses request mixes summary-only reasoning messages with encrypted reasoning replay at message indexes {summary_only_reasoning_indexes:?}"
                ))
            }
        }
    }

    fn generation_metadata(
        reasoning_summary: Option<String>,
        reasoning_items: Option<Vec<ReasoningItem>>,
        reasoning_item_encrypted_content: Option<Vec<String>>,
    ) -> GenerationMetadata {
        GenerationMetadata {
            used_prompt_tokens: None,
            used_completion_tokens: None,
            used_total_tokens: None,
            used_reasoning_tokens: None,
            reasoning_summary,
            reasoning_items,
            reasoning_item_encrypted_content,
            langfuse_trace_id: None,
            was_aborted: None,
            error: None,
            mcp_servers_unavailable: None,
            mcp_servers_needing_auth: None,
            mcp_servers_disabled_by_user: None,
            mcp_tools_disabled_by_user: None,
            continuation_in_flight: None,
        }
    }

    fn input_text(role: MessageRole, text: &str) -> crate::models::message::InputMessage {
        crate::models::message::InputMessage {
            role,
            content: ContentPart::Text(ContentPartText {
                text: text.to_string(),
            }),
        }
    }

    fn input_reasoning(text: &str) -> crate::models::message::InputMessage {
        crate::models::message::InputMessage {
            role: MessageRole::Assistant,
            content: ContentPart::Reasoning(ContentPartReasoning {
                text: text.to_string(),
                ..Default::default()
            }),
        }
    }

    fn reasoning_replay_message(
        assistant_text: &str,
        summary: &str,
        encrypted_content: &str,
    ) -> OpenAiResponsesReasoningReplayMessage {
        OpenAiResponsesReasoningReplayMessage {
            assistant_text: assistant_text.to_string(),
            replay_message: GenAiChatMessage::assistant(MessageContent::from_parts(vec![
                GenAiContentPart::ReasoningItem(ReasoningItem {
                    summary: vec![ReasoningSummaryText::new(summary)],
                    encrypted_content: Some(encrypted_content.to_string()),
                    ..Default::default()
                }),
            ])),
        }
    }

    #[test]
    fn normal_composition_omits_persisted_reasoning_summaries_when_replaying_encrypted_reasoning() {
        let generation_input = GenerationInputMessages {
            messages: vec![
                input_text(MessageRole::System, "Use extended thinking."),
                input_text(MessageRole::User, "Solve the five-digit lock code."),
                input_reasoning("Checking unique code possibilities."),
                input_text(MessageRole::Assistant, "Code: 34512."),
                input_text(MessageRole::User, "Please double-check the result."),
                input_reasoning("Solving the digit constraints."),
                input_text(MessageRole::Assistant, "Yes, 34512 is correct."),
                input_text(MessageRole::User, "Can you please check the result?"),
            ],
        };
        let mut chat_request = generation_input.into_chat_request().with_store(false);
        strip_persisted_reasoning_messages(&mut chat_request);
        insert_openai_responses_reasoning_replay_messages(
            &mut chat_request,
            vec![
                reasoning_replay_message(
                    "Code: 34512.",
                    "Checking unique code possibilities.",
                    "encrypted-1",
                ),
                reasoning_replay_message(
                    "Yes, 34512 is correct.",
                    "Solving the digit constraints.",
                    "encrypted-2",
                ),
            ],
        );

        InMemoryResponsesChatProvider::validate_reasoning_replay_request(&chat_request)
            .expect("normal Responses reasoning replay request should be well formed");

        assert!(
            chat_request.messages.iter().all(|message| {
                !message
                    .content
                    .parts()
                    .iter()
                    .any(|part| matches!(part, GenAiContentPart::ReasoningContent(_)))
            }),
            "persisted reasoning summaries should not be sent alongside encrypted reasoning replay"
        );

        let reasoning_item_indexes = chat_request
            .messages
            .iter()
            .enumerate()
            .filter_map(|(index, message)| {
                message
                    .content
                    .parts()
                    .iter()
                    .any(|part| matches!(part, GenAiContentPart::ReasoningItem(_)))
                    .then_some(index)
            })
            .collect::<Vec<_>>();
        assert_eq!(reasoning_item_indexes, vec![2, 5]);
        assert_eq!(
            chat_request.messages[3].content.first_text(),
            Some("Code: 34512.")
        );
        assert_eq!(
            chat_request.messages[6].content.first_text(),
            Some("Yes, 34512 is correct.")
        );
    }

    #[test]
    fn changed_chat_provider_strips_persisted_reasoning_for_non_responses_requests() {
        let generation_input = GenerationInputMessages {
            messages: vec![
                input_text(MessageRole::System, "Use extended thinking."),
                input_text(MessageRole::User, "Solve the lock code."),
                input_reasoning("Persisted reasoning from a previous model."),
                input_text(MessageRole::Assistant, "Code: 34512."),
                input_text(MessageRole::User, "Please validate again."),
            ],
        };
        let mut chat_request = generation_input.into_chat_request();

        strip_persisted_reasoning_messages(&mut chat_request);

        assert!(
            chat_request.messages.iter().all(|message| {
                !message
                    .content
                    .parts()
                    .iter()
                    .any(|part| matches!(part, GenAiContentPart::ReasoningContent(_)))
            }),
            "changed provider requests must not replay persisted reasoning content"
        );
        assert_eq!(chat_request.messages.len(), 4);
        assert_eq!(
            chat_request.messages[2].content.first_text(),
            Some("Code: 34512.")
        );
    }

    #[test]
    fn compat_no_replay_summary_strips_persisted_reasoning_for_non_responses_requests() {
        assert!(should_strip_persisted_reasoning_messages(
            "openai", true, false,
        ));
        assert!(!should_strip_persisted_reasoning_messages(
            "openai", false, false,
        ));
    }

    #[test]
    fn openai_responses_reasoning_replay_is_disabled_when_chat_provider_changes() {
        let matching_parameters = GenerationParameters {
            generation_chat_provider_id: Some("responses-opus".to_string()),
            request_context: None,
            selected_facets: HashMap::new(),
            action_facet_id: None,
            action_facet_args: None,
            initiator: None,
        };
        let changed_parameters = GenerationParameters {
            generation_chat_provider_id: Some("responses-sonnet".to_string()),
            request_context: None,
            selected_facets: HashMap::new(),
            action_facet_id: None,
            action_facet_args: None,
            initiator: None,
        };

        assert!(openai_responses_reasoning_replay_model_matches(
            "responses-opus",
            Some(matching_parameters),
        ));
        assert!(!openai_responses_reasoning_replay_model_matches(
            "responses-opus",
            Some(changed_parameters),
        ));
        assert!(!openai_responses_reasoning_replay_model_matches(
            "responses-opus",
            None,
        ));
    }

    #[test]
    fn openai_responses_reasoning_replay_deduplicates_encrypted_content() {
        let parts = build_openai_responses_reasoning_replay_parts(
            generation_metadata(
                Some("summary".to_string()),
                Some(vec![ReasoningItem {
                    id: Some("rs_123".to_string()),
                    summary: vec![ReasoningSummaryText::new("summary")],
                    encrypted_content: Some("encrypted".to_string()),
                    ..Default::default()
                }]),
                Some(vec!["encrypted".to_string()]),
            ),
            false,
        );

        assert_eq!(parts.len(), 1);
        let GenAiContentPart::ReasoningItem(reasoning_item) = &parts[0] else {
            panic!("expected reasoning item");
        };
        assert_eq!(
            reasoning_item.encrypted_content.as_deref(),
            Some("encrypted")
        );
        assert_eq!(reasoning_item.summary.len(), 1);
        assert_eq!(reasoning_item.summary[0].text, "summary");
    }

    #[test]
    fn openai_responses_reasoning_replay_synthesizes_summary_for_legacy_encrypted_content() {
        let parts = build_openai_responses_reasoning_replay_parts(
            generation_metadata(
                Some("summary".to_string()),
                None,
                Some(vec!["encrypted".to_string()]),
            ),
            false,
        );

        assert_eq!(parts.len(), 1);
        let GenAiContentPart::ReasoningItem(reasoning_item) = &parts[0] else {
            panic!("expected reasoning item");
        };
        assert_eq!(
            reasoning_item.encrypted_content.as_deref(),
            Some("encrypted")
        );
        assert_eq!(reasoning_item.summary.len(), 1);
        assert_eq!(reasoning_item.summary[0].text, "summary");
    }

    #[test]
    fn openai_responses_reasoning_replay_can_skip_summary_only_replay() {
        let parts = build_openai_responses_reasoning_replay_parts(
            generation_metadata(Some("summary".to_string()), None, None),
            true,
        );

        assert!(
            parts.is_empty(),
            "compat_no_replay_summary should not replay plain reasoning summaries"
        );
    }

    #[test]
    fn openai_responses_reasoning_replay_still_replays_encrypted_content_when_summary_disabled() {
        let parts = build_openai_responses_reasoning_replay_parts(
            generation_metadata(
                Some("summary".to_string()),
                None,
                Some(vec!["encrypted".to_string()]),
            ),
            true,
        );

        assert_eq!(parts.len(), 1);
        let GenAiContentPart::ReasoningItem(reasoning_item) = &parts[0] else {
            panic!("expected reasoning item");
        };
        assert_eq!(
            reasoning_item.encrypted_content.as_deref(),
            Some("encrypted")
        );
        assert_eq!(reasoning_item.summary.len(), 1);
        assert_eq!(reasoning_item.summary[0].text, "summary");
    }

    #[test]
    fn reasoning_delta_parts_are_distinct_from_text_parts() {
        let mut content = Vec::new();

        assert_eq!(append_reasoning_delta_part(&mut content, "think".into()), 0);
        assert_eq!(append_reasoning_delta_part(&mut content, " more".into()), 0);
        assert_eq!(append_text_delta_part(&mut content, "answer".into()), 1);

        assert_eq!(
            content,
            vec![
                ContentPart::Reasoning(ContentPartReasoning {
                    text: "think more".to_string(),
                    ..Default::default()
                }),
                ContentPart::Text(ContentPartText {
                    text: "answer".to_string()
                }),
            ]
        );
    }

    #[test]
    fn text_and_reasoning_delta_parts_preserve_interleaved_order() {
        let mut content = Vec::new();

        assert_eq!(append_text_delta_part(&mut content, "hello".into()), 0);
        assert_eq!(append_reasoning_delta_part(&mut content, "think".into()), 1);
        assert_eq!(append_text_delta_part(&mut content, " again".into()), 2);

        assert_eq!(
            content,
            vec![
                ContentPart::Text(ContentPartText {
                    text: "hello".to_string()
                }),
                ContentPart::Reasoning(ContentPartReasoning {
                    text: "think".to_string(),
                    ..Default::default()
                }),
                ContentPart::Text(ContentPartText {
                    text: " again".to_string()
                }),
            ]
        );
    }

    #[test]
    fn completed_response_reasoning_is_inserted_before_streamed_text() {
        let mut content = vec![ContentPart::Text(ContentPartText {
            text: "answer".to_string(),
        })];

        assert_eq!(
            insert_reasoning_part_before_text(&mut content, "summary".into()),
            0
        );

        assert_eq!(
            content,
            vec![
                ContentPart::Reasoning(ContentPartReasoning {
                    text: "summary".to_string(),
                    ..Default::default()
                }),
                ContentPart::Text(ContentPartText {
                    text: "answer".to_string()
                }),
            ]
        );
    }

    #[test]
    fn hallucination_suppression_triggers_after_successive_whitespace_text_deltas() {
        let mut suppression = HallucinationSuppressionState::new(HallucinationSuppressionConfig {
            enabled: true,
            whitespace_delta_threshold: 3,
        });

        assert!(!suppression.observe_text_delta(" "));
        assert!(!suppression.observe_text_delta("\n"));
        assert!(suppression.observe_text_delta("\t"));
    }

    #[test]
    fn hallucination_suppression_resets_on_non_whitespace_text_delta() {
        let mut suppression = HallucinationSuppressionState::new(HallucinationSuppressionConfig {
            enabled: true,
            whitespace_delta_threshold: 2,
        });

        assert!(!suppression.observe_text_delta(" "));
        assert!(!suppression.observe_text_delta("answer"));
        assert!(!suppression.observe_text_delta("\n"));
        assert!(suppression.observe_text_delta("\t"));
    }
}

#[cfg(test)]
mod summary_generation_tests {
    use super::*;

    #[test]
    fn summary_input_uses_last_composed_user_text_message() {
        let generation_input_messages = GenerationInputMessages {
            messages: vec![
                crate::models::message::InputMessage {
                    role: MessageRole::System,
                    content: ContentPart::Text(ContentPartText {
                        text: "assistant-provided context".to_string(),
                    }),
                },
                crate::models::message::InputMessage {
                    role: MessageRole::User,
                    content: ContentPart::TextFilePointer(
                        crate::models::message::ContentPartTextFilePointer {
                            file_upload_id: Uuid::new_v4(),
                        },
                    ),
                },
                crate::models::message::InputMessage {
                    role: MessageRole::User,
                    content: ContentPart::Text(ContentPartText {
                        text: "Explain our customer support handoff".to_string(),
                    }),
                },
            ],
        };

        assert_eq!(
            summary_user_message_text_from_generation_input(&generation_input_messages),
            Some("Explain our customer support handoff")
        );
    }

    #[test]
    fn summary_input_ignores_blank_and_non_text_user_parts() {
        let generation_input_messages = GenerationInputMessages {
            messages: vec![
                crate::models::message::InputMessage {
                    role: MessageRole::User,
                    content: ContentPart::Text(ContentPartText {
                        text: " \n\t ".to_string(),
                    }),
                },
                crate::models::message::InputMessage {
                    role: MessageRole::User,
                    content: ContentPart::ActionFacetMarker(
                        crate::models::message::ContentPartActionFacetMarker {
                            facet_id: "reply_compose".to_string(),
                            args: HashMap::new(),
                        },
                    ),
                },
            ],
        };

        assert_eq!(
            summary_user_message_text_from_generation_input(&generation_input_messages),
            None
        );
    }

    /// Stub `FileUploadLookup` for testing the audio-transcript resolver without a DB.
    /// Returns whatever was inserted via `insert`, and `Ok(None)` for unknown ids.
    struct StubFileUploadLookup {
        entries: std::collections::HashMap<Uuid, crate::db::entity::file_uploads::Model>,
        error_for: Option<Uuid>,
    }

    impl StubFileUploadLookup {
        fn new() -> Self {
            Self {
                entries: std::collections::HashMap::new(),
                error_for: None,
            }
        }

        fn with(mut self, file: crate::db::entity::file_uploads::Model) -> Self {
            self.entries.insert(file.id, file);
            self
        }

        fn with_error(mut self, id: Uuid) -> Self {
            self.error_for = Some(id);
            self
        }
    }

    #[async_trait::async_trait]
    impl crate::models::file_upload::FileUploadLookup for StubFileUploadLookup {
        async fn find_file_upload(
            &self,
            id: Uuid,
        ) -> Result<Option<crate::db::entity::file_uploads::Model>, eyre::Report> {
            if self.error_for == Some(id) {
                return Err(eyre::eyre!("stub DB error"));
            }
            Ok(self.entries.get(&id).cloned())
        }
    }

    fn stub_audio_file(
        id: Uuid,
        filename: &str,
        audio_transcription: Option<&str>,
    ) -> crate::db::entity::file_uploads::Model {
        crate::db::entity::file_uploads::Model {
            id,
            owner_user_id: "test-user".to_string(),
            filename: filename.to_string(),
            file_storage_provider_id: "local".to_string(),
            file_storage_path: format!("/fixtures/{filename}"),
            audio_transcription: audio_transcription.map(str::to_string),
            external_id_ews_id: None,
            outlook_provenance: None,
            created_at: chrono::Utc::now().into(),
            updated_at: chrono::Utc::now().into(),
        }
    }

    fn user_pointer(file_upload_id: Uuid) -> crate::models::message::InputMessage {
        crate::models::message::InputMessage {
            role: MessageRole::User,
            content: ContentPart::TextFilePointer(
                crate::models::message::ContentPartTextFilePointer { file_upload_id },
            ),
        }
    }

    #[tokio::test]
    async fn resolver_promotes_completed_audio_transcript_to_text() {
        let file_id = Uuid::new_v4();
        let lookup = StubFileUploadLookup::new().with(stub_audio_file(
            file_id,
            "quarterly-update.mp3",
            Some(
                r#"{"status":"completed","transcript":"Quarterly results exceeded expectations."}"#,
            ),
        ));
        let input = GenerationInputMessages {
            messages: vec![user_pointer(file_id)],
        };

        let resolved = resolve_audio_transcripts_for_summary(&lookup, input).await;

        assert_eq!(resolved.messages.len(), 1);
        let ContentPart::Text(ContentPartText { text }) = &resolved.messages[0].content else {
            panic!(
                "expected promoted Text, got {:?}",
                resolved.messages[0].content
            );
        };
        assert!(
            text.contains("Quarterly results exceeded expectations."),
            "promoted text should contain the transcript body, got: {text}"
        );
        assert!(
            text.contains("quarterly-update.mp3"),
            "promoted text should include the filename envelope, got: {text}"
        );
        // The summary extractor must now find user text and not skip.
        assert!(
            summary_user_message_text_from_generation_input(&resolved).is_some(),
            "extractor should return text for the resolved input"
        );
    }

    #[tokio::test]
    async fn resolver_leaves_pending_transcript_pointer_untouched() {
        let file_id = Uuid::new_v4();
        let lookup = StubFileUploadLookup::new().with(stub_audio_file(
            file_id,
            "pending.mp3",
            Some(r#"{"status":"pending"}"#),
        ));
        let input = GenerationInputMessages {
            messages: vec![user_pointer(file_id)],
        };

        let resolved = resolve_audio_transcripts_for_summary(&lookup, input).await;

        assert!(matches!(
            resolved.messages[0].content,
            ContentPart::TextFilePointer(_)
        ));
        assert!(
            summary_user_message_text_from_generation_input(&resolved).is_none(),
            "pending transcript must not produce summary text"
        );
    }

    #[tokio::test]
    async fn resolver_leaves_unknown_and_errored_uploads_untouched() {
        let unknown_id = Uuid::new_v4();
        let error_id = Uuid::new_v4();
        let lookup = StubFileUploadLookup::new().with_error(error_id);
        let input = GenerationInputMessages {
            messages: vec![user_pointer(unknown_id), user_pointer(error_id)],
        };

        let resolved = resolve_audio_transcripts_for_summary(&lookup, input).await;

        for message in &resolved.messages {
            assert!(matches!(message.content, ContentPart::TextFilePointer(_)));
        }
    }

    #[tokio::test]
    async fn resolver_passes_through_non_pointer_content() {
        let file_id = Uuid::new_v4();
        let lookup = StubFileUploadLookup::new().with(stub_audio_file(
            file_id,
            "ready.mp3",
            Some(r#"{"status":"completed","transcript":"hello"}"#),
        ));
        let input = GenerationInputMessages {
            messages: vec![
                crate::models::message::InputMessage {
                    role: MessageRole::User,
                    content: ContentPart::Text(ContentPartText {
                        text: "typed by user".to_string(),
                    }),
                },
                user_pointer(file_id),
            ],
        };

        let resolved = resolve_audio_transcripts_for_summary(&lookup, input).await;

        // Typed user text is unchanged; the file pointer is promoted to Text in place.
        let ContentPart::Text(ContentPartText { text: typed }) = &resolved.messages[0].content
        else {
            panic!("typed user text should pass through unchanged");
        };
        assert_eq!(typed, "typed by user");
        assert!(matches!(resolved.messages[1].content, ContentPart::Text(_)));
    }

    #[test]
    fn summary_request_separates_instruction_from_user_message() {
        let summary_system_prompt = "Generate a summary for the topic of the following chat, based on the first message to the chat. The summary should be a short single sentence description like e.g. `Regex Search-and-Replace with Ripgrep` or `Explain a customer support flow`. Only return that sentence and nothing else.";
        let chat_request = build_chat_summary_request(
            summary_system_prompt,
            "Explain our customer support handoff",
        );

        assert_eq!(chat_request.messages.len(), 2);
        assert_eq!(chat_request.messages[0].role, ChatRole::System);
        assert_eq!(chat_request.messages[1].role, ChatRole::User);
        assert!(
            chat_request.messages[0]
                .content
                .first_text()
                .is_some_and(|text| text.contains("Generate a summary"))
        );
        assert_eq!(
            chat_request.messages[1].content.first_text(),
            Some("Explain our customer support handoff")
        );
    }
}

fn internal_generation_error(error: &Report) -> GenerationErrorType {
    GenerationErrorType::InternalError {
        // The debug representation includes eyre's full cause chain and the
        // captured backtrace/span trace when those collectors are enabled.
        error_description: format!("{error:?}"),
    }
}

fn generation_metadata_for_error(error: GenerationErrorType) -> GenerationMetadata {
    GenerationMetadata {
        used_prompt_tokens: None,
        used_completion_tokens: None,
        used_total_tokens: None,
        used_reasoning_tokens: None,
        reasoning_summary: None,
        reasoning_items: None,
        reasoning_item_encrypted_content: None,
        langfuse_trace_id: None,
        was_aborted: None,
        error: Some(error),
        mcp_servers_unavailable: None,
        mcp_servers_needing_auth: None,
        mcp_servers_disabled_by_user: None,
        mcp_tools_disabled_by_user: None,
        continuation_in_flight: None,
    }
}

#[allow(clippy::too_many_arguments)]
async fn persist_background_generation_failure(
    task: &Arc<StreamingTask>,
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    assistant_message_id: Uuid,
    chat_provider_id: &str,
    report: &Report,
) {
    let generation_error = internal_generation_error(report);
    report_chat_provider_generation_error(chat_provider_id, &generation_error);

    if let Err(error) = update_message_generation_metadata(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &assistant_message_id,
        generation_metadata_for_error(generation_error.clone()),
    )
    .await
    {
        tracing::error!(
            message_id = %assistant_message_id,
            error = ?error,
            "Failed to persist generation failure metadata"
        );
        capture_report(&error);
    }

    let error_event = MessageSubmitStreamingResponseError {
        message_id: Some(assistant_message_id),
        error: generation_error,
    };
    let error =
        match serde_json::to_value(MessageSubmitStreamingResponseMessage::Error(error_event)) {
            Ok(error) => Some(error),
            Err(error) => {
                let error =
                    Report::new(error).wrap_err("Failed to serialize generation error event");
                log_and_capture_error("persist_background_generation_failure", &error);
                None
            }
        };
    send_background_event(
        task,
        StreamingEvent::Error { error },
        "broadcast persisted generation failure",
    )
    .await;
}

#[cfg(test)]
mod generation_failure_diagnostic_tests {
    use super::*;

    #[test]
    fn internal_generation_error_keeps_context_and_root_cause() {
        let report = eyre!("provider connection closed")
            .wrap_err("Failed to read the chat completion stream")
            .wrap_err("Failed during chat completion generation");

        let GenerationErrorType::InternalError { error_description } =
            internal_generation_error(&report)
        else {
            panic!("expected an internal generation error");
        };

        assert!(error_description.contains("Failed during chat completion generation"));
        assert!(error_description.contains("Failed to read the chat completion stream"));
        assert!(error_description.contains("provider connection closed"));
    }

    #[tokio::test]
    async fn closed_sse_channel_does_not_abort_generation_event_delivery() {
        let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Report>>(1);
        drop(rx);

        let event = MessageSubmitStreamingResponseMessage::ToolCallProposed(
            MessageSubmitStreamingResponseToolCallProposed {
                message_id: Uuid::new_v4(),
                content_index: 0,
                tool_call_id: "call-1".to_string(),
                tool_name: "read_file".to_string(),
                input: Some(serde_json::json!({"path": "README.md"})),
            },
        );

        send_generation_event(&event, tx)
            .await
            .expect("a disconnected SSE client must not fail generation");
    }
}

/// Emit `ChatCreated` if this request created the chat, load the chat, and
/// persist + announce the user's message.
///
/// Split from [`run_generation_after_user_message`] because a delivered task
/// result enters the generation half with a user row this function did not
/// write: that row carries a `task_result` part rather than text, and it was
/// saved under a lease the delivery took for itself.
#[allow(clippy::too_many_arguments)]
#[instrument(skip_all, fields(%chat_id))]
pub(crate) async fn save_user_message_for_submit(
    task: &Arc<StreamingTask>,
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    request: &MessageSubmitRequest,
    chat_id: Uuid,
    chat_was_created: bool,
) -> Result<(chats::Model, messages::Model), Report> {
    tracing::info!("run_message_submit_task started for chat_id: {}", chat_id);

    // The insert is committed before navigation. Other
    // requests and replicas can authorize the new chat directly by ID.
    if chat_was_created {
        tracing::info!("Sending ChatCreated event for chat_id: {}", chat_id);
        task.send_event(StreamingEvent::ChatCreated { chat_id })
            .await
            .map_err(Report::msg)?;
    }

    tracing::info!("Fetching chat for chat_id: {}", chat_id);

    // Get the chat (we know it exists because we created/fetched it before starting the task)
    let chat = get_or_create_chat(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        Some(&chat_id),
        &me_user.id,
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .wrap_err("Failed to get chat")?
    .0;

    tracing::info!("Chat fetched successfully, id: {}", chat.id);

    // Save user message
    tracing::info!("Saving user message");
    let mentioned_assistant_ids_for_persistence = request
        .mentioned_assistant_ids
        .as_ref()
        .filter(|ids| !ids.is_empty())
        .map(|ids| {
            crate::services::delegation::dedupe_mentions(ids)
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
        });
    // Only `background` is persisted (absence means wait), and as requested,
    // not gate-downgraded: the gate applies at dispatch time, so a replay
    // under a later-enabled gate honours the user's original choice.
    let delegation_run_mode_for_persistence = request
        .delegation_run_mode
        .filter(|mode| *mode == DelegationRunMode::Background);
    let user_input_parameters = if request.action_facet.is_some()
        || mentioned_assistant_ids_for_persistence.is_some()
        || delegation_run_mode_for_persistence.is_some()
    {
        Some(crate::models::message::InputParameters {
            action_facet_id: request.action_facet.as_ref().map(|af| af.id.clone()),
            action_facet_args: request.action_facet.as_ref().map(|af| af.args.clone()),
            mentioned_assistant_ids: mentioned_assistant_ids_for_persistence,
            delegation_run_mode: delegation_run_mode_for_persistence,
            task_result: None,
        })
    } else {
        None
    };
    // A delivered task result and the turn that reacted to it sit below the
    // assistant row the client last saw, so a client that has not caught up
    // anchors above them and the submit would branch them away. Walk down past
    // the server's own rows and submit below them instead.
    //
    // Deliberately here rather than beside the lease acquisition: nothing
    // between that call and the spawn is fallible today, so a `?` there would
    // return with the lease still held and no task to release it — and under
    // the identity-guarded heartbeat that chat then refuses every later write.
    // Here it runs inside the generation lifecycle, which already owns
    // cleanup. Still after the lease, so no concurrent delivery can append a
    // row between this read and the write.
    //
    // The client's own anchor is what `validate_submit_request` checked; this
    // one is server-computed and is deliberately allowed to be a user row,
    // which is the steady state for a `silent` delivery.
    let effective_previous_message_id = match request.previous_message_id {
        Some(anchor) if app_state.config.delegation.tasks.enabled => {
            crate::models::message::resolve_system_delivered_tip(&app_state.db, &chat.id, &anchor)
                .await
                .wrap_err("Failed to resolve the system-delivered tip")?
                .or(Some(anchor))
        }
        other => other,
    };

    let saved_user_message = bg_stream_save_user_message(
        task,
        app_state,
        policy,
        me_user,
        &chat,
        effective_previous_message_id.as_ref(),
        &request.user_message,
        &request.input_files_ids,
        user_input_parameters,
    )
    .await
    .wrap_err("Failed to save user message")?;

    tracing::info!("User message saved, id: {}", saved_user_message.id);

    // Submit re-anchors onto a delivered result rather than branching it away,
    // but the walk stops at a user-authored row — and in that case this submit
    // DOES branch the delivery off the active thread, exactly as an edit or a
    // regenerate would. Reconciled here for the same reason and in the same
    // shape as those two: after the save, because the active flags are not
    // final until `submit_message` commits, and swallowed into a warning
    // because a bookkeeping failure must not fail the user's turn.
    if app_state.config.delegation.tasks.enabled
        && let Err(error) =
            crate::models::chat::requeue_or_supersede_branched_deliveries(&app_state.db, &chat.id)
                .await
    {
        tracing::warn!(%error, "Failed to reconcile deliveries after a submit");
    }

    Ok((chat, saved_user_message))
}

/// What started this generation.
///
/// Decides the `initiator` recorded on the assistant row and whether the turn
/// may plan delegated tasks of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GenerationOrigin {
    /// A person wrote the message this turn answers.
    UserTurn,
    /// A finished `async` task's result was delivered into the chat.
    TaskResultDelivery,
}

/// Everything a submit does once its user row is on disk: compose, prepare,
/// create the assistant row and run the generation.
#[allow(clippy::too_many_arguments)]
#[instrument(skip_all, fields(chat_id = %chat.id))]
pub(crate) async fn run_generation_after_user_message(
    task: &Arc<StreamingTask>,
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    request: &MessageSubmitRequest,
    generation_request_context: GenerationRequestContext,
    chat: &chats::Model,
    chat_was_created: bool,
    delegation_targets: Vec<crate::services::delegation::DelegationTarget>,
    saved_user_message: &messages::Model,
    origin: GenerationOrigin,
) -> Result<(), Report> {
    // Prepare chat request
    let me_profile_input = MeProfileChatRequestInput::from_me_profile(me_user);
    // No persisted fallback: this request just persisted its own value, so
    // the request field is the whole story here.
    let effective_delegation_run_mode = crate::services::delegation::resolve_delegation_run_mode(
        request.delegation_run_mode,
        None,
        &app_state.config.delegation,
    );
    let user_input = PromptCompositionUserInput {
        just_submitted_user_message_id: saved_user_message.id,
        requested_chat_provider_id: request.chat_provider_id.clone(),
        new_input_file_ids: request.input_files_ids.clone(),
        selected_facet_ids: request.selected_facet_ids.clone(),
        action_facet: request.action_facet.as_ref().map(|af| {
            crate::services::prompt_composition::types::ActionFacetUserInput {
                id: af.id.clone(),
                args: af.args.clone(),
            }
        }),
        delegation_targets,
        delegation_run_mode: effective_delegation_run_mode,
        // LD-A9: a reaction turn may not plan tasks of its own. The offer is
        // decided inside `prepare_chat_request`, which suppresses it only for a
        // delegated RUN — and a reaction runs in the ORIGIN chat, so nothing
        // there would have stopped it.
        suppress_task_offer: origin == GenerationOrigin::TaskResultDelivery,
    };
    let PreparedChatRequest {
        chat_request,
        chat_options,
        generation_input_messages,
        generation_parameters,
        generation_request_context,
        mcp_servers_unavailable,
        mcp_servers_needing_auth,
        mcp_servers_disabled_by_user,
        mcp_tools_disabled_by_user,
        available_mcp_tools,
        offered_client_tools,
        delegation_targets,
        delegation_offered_file_ids,
        task_offer_scope,
    } = prepare_chat_request(
        app_state,
        policy,
        chat,
        user_input,
        generation_request_context,
        &me_profile_input,
    )
    .await
    .wrap_err("Failed to prepare chat request")?;

    // Recorded on the assistant row so a later reader can tell a turn a person
    // asked for from one a delivered task result triggered. Built here rather
    // than inside `prepare_chat_request`, which knows nothing about who asked.
    // Absence still means a user, so user turns write nothing new.
    let mut generation_parameters = generation_parameters;
    if origin == GenerationOrigin::TaskResultDelivery {
        generation_parameters.initiator =
            Some(crate::models::message::GenerationInitiator::TaskResult);
    }

    // Spawn chat summary generation if needed. Use the composed prompt input
    // so summary generation sees the same first-turn structure as chat
    // completion, then extracts only the actual user text from it.
    //
    // A delivery always passes a `previous_message_id` (the row it just wrote),
    // so this gate is false for a reaction turn and no summary is generated
    // from a delivered result.
    if (chat_was_created || request.previous_message_id.is_none())
        && !crate::models::chat::chat_is_delegated_run(chat)
    {
        let app_state_clone = app_state.clone();
        let policy_clone = policy.clone();
        let me_user_clone = me_user.clone();
        let chat_clone = chat.clone();
        let summary_generation_input_messages = generation_input_messages.clone();
        let chat_summary_span = tracing::info_span!("Generating chat summary");
        tokio::spawn(
            async move {
                let summary_res = generate_chat_summary(
                    &app_state_clone,
                    &policy_clone,
                    &me_user_clone,
                    &chat_clone,
                    &summary_generation_input_messages,
                )
                .await;
                if let Err(summary) = summary_res {
                    log_and_capture_error("generate_chat_summary", &summary);
                }
                Ok::<(), Report>(())
            }
            .instrument(chat_summary_span),
        );
    }

    let langfuse_trace_enrichment = match build_langfuse_trace_enrichment(
        app_state,
        policy,
        &me_user.to_subject(),
        &generation_input_messages,
        chat.assistant_id,
        &generation_request_context,
    )
    .await
    {
        Ok(enrichment) => enrichment,
        Err(err) => {
            warn_and_capture_error("build submit Langfuse trace enrichment", &err);
            LangfuseTraceEnrichment::default()
        }
    };

    // Extract chat provider ID from generation parameters (clone to avoid borrow issues)
    let chat_provider_id = generation_parameters
        .generation_chat_provider_id
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let allowed_tool_names: HashSet<String> = chat_request
        .tools
        .as_ref()
        .map(|tools| {
            tools
                .iter()
                .map(|tool| tool.name.to_string())
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let chat_provider_headers_context =
        ChatProviderHeadersContext::new(&me_user.id, &me_user.id_token_claims);

    // Save initial empty assistant message
    let empty_assistant_message_json = json!({
        "role": "assistant",
        "content": [],
    });

    let initial_assistant_message = submit_message(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &chat.id,
        empty_assistant_message_json,
        Some(&saved_user_message.id),
        None,
        Some(generation_input_messages.clone()),
        &[],
        Some(generation_parameters),
        None,
        None,
    )
    .await
    .wrap_err("Failed to submit initial assistant message")?;

    // Emit AssistantMessageStarted event
    task.send_event(StreamingEvent::AssistantMessageStarted {
        message_id: initial_assistant_message.id,
    })
    .await
    .map_err(Report::msg)?;

    // Create a channel to intercept events from generation (needed for the generic function signature)
    let (temp_tx2, mut temp_rx2) = tokio::sync::mpsc::channel::<Result<Event, Report>>(100);

    // Consume events from the temp channel (events are now forwarded directly to StreamingTask)
    tokio::spawn(async move {
        while let Some(event) = temp_rx2.recv().await {
            // Events are consumed here to prevent channel from filling up
            // Actual forwarding to StreamingTask happens in stream_generate_chat_completion
            if let Err(error) = event {
                log_and_capture_error("background generation SSE bridge", &error);
            }
        }
    });

    let subject = me_user.to_subject();
    let mcp_auth_context = McpRequestAuthContext {
        app_state: Some(app_state),
        user_id: Uuid::parse_str(&me_user.id).ok(),
        oidc_token: Some(&me_user.oidc_token),
        access_token: me_user.access_token.as_deref(),
    };
    let generation_task = stream_generate_chat_completion::<MessageSubmitStreamingResponseMessage>(
        temp_tx2.clone(),
        app_state,
        policy,
        &subject,
        chat_request,
        langfuse_trace_enrichment,
        chat_options,
        initial_assistant_message.id,
        me_user.id.clone(),
        chat.id,
        Some(chat_provider_id.as_str()),
        &me_user.groups,
        mcp_auth_context,
        mcp_servers_unavailable,
        mcp_servers_needing_auth,
        mcp_servers_disabled_by_user,
        mcp_tools_disabled_by_user,
        allowed_tool_names,
        available_mcp_tools,
        offered_client_tools,
        &chat_provider_headers_context,
        Some(task),
        chat.assistant_id,
        vec![],
        crate::models::chat::chat_is_delegated_run(chat),
        crate::services::delegation::child_may_park_on_approval(chat, &app_state.config.delegation),
        Some(DelegationDispatchContext {
            me_user,
            targets: &delegation_targets,
            offered_file_ids: &delegation_offered_file_ids,
            origin_chat: chat,
            origin_user_message_id: saved_user_message.id,
            run_mode: effective_delegation_run_mode,
            background_dispatches: std::sync::atomic::AtomicUsize::new(0),
            task_scope: task_offer_scope.clone(),
            tasks_this_turn: std::sync::atomic::AtomicUsize::new(0),
        }),
        task_tool_budgets_for_chat(chat),
        None,
    );

    let (end_content, generation_metadata) = match generation_task.await {
        Ok(result) => result,
        Err(error) => {
            let error = error.wrap_err("Failed during chat completion generation");
            persist_background_generation_failure(
                task,
                app_state,
                policy,
                me_user,
                initial_assistant_message.id,
                &chat_provider_id,
                &error,
            )
            .await;
            return Err(error);
        }
    };

    if let Some(metadata) = generation_metadata.as_ref()
        && metadata.error.is_some()
    {
        let has_error_event = task
            .get_event_history()
            .await
            .iter()
            .any(|event| matches!(event, StreamingEvent::Error { .. }));

        if !has_error_event {
            let mut error_value = metadata
                .error
                .clone()
                .and_then(|error| serialize_json_value(error, "serialize generation error"));
            if let Some(JsonValue::Object(map)) = error_value.as_mut() {
                map.entry("message_id".to_string())
                    .or_insert(JsonValue::String(initial_assistant_message.id.to_string()));
            }
            send_background_event(
                task,
                StreamingEvent::Error { error: error_value },
                "broadcast structured generation error",
            )
            .await;
        }
    }

    let generation_was_aborted = generation_metadata
        .as_ref()
        .and_then(|metadata| metadata.was_aborted)
        .unwrap_or(false);

    // Update generation metadata
    if let Some(metadata) = generation_metadata
        && let Err(err) = update_message_generation_metadata(
            &app_state.db,
            policy,
            &me_user.to_subject(),
            &initial_assistant_message.id,
            metadata,
        )
        .await
    {
        warn_and_capture_error("update submit generation metadata", &err);
    }

    // Update assistant message with final content
    let end_content = if generation_was_aborted {
        ensure_saved_assistant_content_for_abort(end_content)
    } else {
        end_content
    };
    bg_stream_update_assistant_message_completion(
        task,
        app_state,
        policy,
        end_content,
        me_user,
        initial_assistant_message.id,
    )
    .await?;

    // Note: the stream_end event is sent by the spawning task lifecycle wrapper

    Ok(())
}

/// Run the message submission task in the background
#[allow(clippy::too_many_arguments)]
#[instrument(skip_all, fields(%chat_id))]
pub(crate) async fn run_message_submit_task(
    task: &Arc<StreamingTask>,
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    request: &MessageSubmitRequest,
    generation_request_context: GenerationRequestContext,
    chat_id: Uuid,
    chat_was_created: bool,
    delegation_targets: Vec<crate::services::delegation::DelegationTarget>,
) -> Result<(), Report> {
    let (chat, saved_user_message) = save_user_message_for_submit(
        task,
        app_state,
        policy,
        me_user,
        request,
        chat_id,
        chat_was_created,
    )
    .await?;
    run_generation_after_user_message(
        task,
        app_state,
        policy,
        me_user,
        request,
        generation_request_context,
        &chat,
        chat_was_created,
        delegation_targets,
        &saved_user_message,
        GenerationOrigin::UserTurn,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/me/messages/regeneratestream",
    request_body = RegenerateMessageRequest,
    responses(
        (status = OK, content_type="text/event-stream", body = RegenerateMessageStreamingResponseMessage),
        (status = BAD_REQUEST, description = "When validation fails (e.g., invalid message role)"),
        (status = NOT_FOUND, description = "When the chat does not exist or is not accessible"),
        (status = CONFLICT, body = GenerationRunningError, description = "When the chat is archived, or is a delegated run that is still in progress (plain text), or the chat's generation lease is already held and delegation.tasks.enabled is on (JSON, code = generation_running)"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "When an internal server error occurs")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn regenerate_message_sse(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    headers: HeaderMap,
    Json(request): Json<RegenerateMessageRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Report>>>, StreamRouteError> {
    // Validate request parameters
    let validation_result =
        validate_regenerate_request(&app_state, &policy, &me_user, &request.current_message_id)
            .await?;

    // Validate action facet before spawning background task (returns HTTP 400 on failure)
    let generation_request_context = generation_request_context_from_headers(&headers);
    let platform = generation_request_context
        .platform
        .as_deref()
        .unwrap_or(DEFAULT_ERATO_PLATFORM);
    warn_unknown_platform(&app_state.config, platform);
    validate_action_facet(&app_state.config, request.action_facet.as_ref(), platform)?;

    let chat = get_chat_by_message_id(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &request.current_message_id,
    )
    .await
    .map_err(|e| {
        let s = e.to_string();
        if s.contains("not found") || s.contains("Access denied") || s.contains("not authorized") {
            (
                axum::http::StatusCode::NOT_FOUND,
                "Chat not found".to_string(),
            )
        } else {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load chat for regeneration: {}", e),
            )
        }
    })?;
    reject_if_archived(&chat)?;
    accept_user_write_into_delegated_run(&app_state, &chat).await?;

    // Assistant mentions: an explicit request value is validated hard (400);
    // absent, fall back to the mentions persisted on the turn's user message,
    // re-validated softly for replay stability. The resolved targets feed the
    // delegation tool offer.
    let chat_is_delegated = crate::models::chat::chat_is_delegated_run(&chat);
    let delegation_targets_for_offer = match request.mentioned_assistant_ids.clone() {
        Some(ids) => {
            crate::services::delegation::validate_mentioned_assistants(
                &app_state,
                &policy,
                &me_user.to_subject(),
                Some(&ids),
                chat.assistant_id,
                chat_is_delegated,
            )
            .await?
        }
        None => {
            let persisted = crate::models::message::get_input_mentioned_assistant_ids_from_message(
                &validation_result.previous_message,
            )
            .unwrap_or_else(|error| {
                warn_and_capture_error("read regenerate fallback assistant mentions", &error);
                None
            });
            crate::services::delegation::resolve_persisted_mentions(
                &app_state,
                &policy,
                &me_user.to_subject(),
                persisted.as_deref(),
                chat.assistant_id,
                chat_is_delegated,
            )
            .await
        }
    };
    // Same replay contract as the mentions: an explicit request value wins,
    // else the mode the turn's user message persisted; the gate downgrade
    // applies here, at execution time.
    let effective_delegation_run_mode = crate::services::delegation::resolve_delegation_run_mode(
        request.delegation_run_mode,
        crate::models::message::get_input_delegation_run_mode_from_message(
            &validation_result.previous_message,
        )
        .unwrap_or_else(|error| {
            warn_and_capture_error("read regenerate fallback delegation run mode", &error);
            None
        }),
        &app_state.config.delegation,
    );

    // Create a channel for sending events
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Report>>(100);
    let (_abort_rx, task) =
        acquire_user_generation_lease(&app_state, chat.id, Uuid::new_v4()).await?;

    // Move validated messages into the task
    let previous_message = validation_result.previous_message;
    let current_message = validation_result.current_message;

    let task_for_stream = task.clone();
    let app_state_for_cleanup = app_state.clone();
    let chat_id_for_cleanup = chat.id;

    // Spawn a task to process the request and send events
    tokio::spawn(async move {
        let mut cleanup_guard = TaskCleanupGuard::new(
            app_state_for_cleanup.background_tasks.clone(),
            chat_id_for_cleanup,
            task_for_stream.generation_id,
        );
        let result: Result<(), Report> = async {
            let input_files_for_previous_message = previous_message
                .input_file_uploads
                .clone()
                .unwrap_or_default();
            let fallback_chat_provider_id = if request.chat_provider_id.is_none() {
                match get_generation_chat_provider_id_from_message(&current_message) {
                    Ok(chat_provider_id) => chat_provider_id,
                    Err(error) => {
                        warn_and_capture_error("read regenerate fallback chat provider", &error);
                        None
                    }
                }
            } else {
                None
            };
            // Mirror the chat-provider fallback for the action facet: a
            // regenerate without an explicit facet re-applies the one the
            // original generation ran under ("same input, new sample"),
            // including any client-action tool it implied. Re-validated
            // against the CURRENT config — a facet that was removed or
            // changed since is dropped (regenerate proceeds without it)
            // rather than failing the request.
            let fallback_action_facet = if request.action_facet.is_none() {
                match crate::models::message::get_generation_action_facet_from_message(
                    &current_message,
                ) {
                    Ok(action_facet) => action_facet,
                    Err(error) => {
                        warn_and_capture_error("read regenerate fallback action facet", &error);
                        None
                    }
                }
                .map(|(id, args)| ActionFacetRequest { id, args })
                .filter(|af| {
                    let platform = generation_request_context
                        .platform
                        .as_deref()
                        .unwrap_or(DEFAULT_ERATO_PLATFORM);
                    match validate_action_facet(&app_state.config, Some(af), platform) {
                        Ok(()) => true,
                        Err((_, reason)) => {
                            tracing::warn!(
                                "Dropping stored action facet '{}' on regenerate: {}",
                                af.id,
                                reason
                            );
                            false
                        }
                    }
                })
            } else {
                None
            };

            let me_profile_input = MeProfileChatRequestInput::from_me_profile(&me_user);
            let user_input = crate::services::prompt_composition::PromptCompositionUserInput {
                just_submitted_user_message_id: previous_message.id,
                requested_chat_provider_id: request
                    .chat_provider_id
                    .clone()
                    .or(fallback_chat_provider_id),
                new_input_file_ids: input_files_for_previous_message,
                selected_facet_ids: request.selected_facet_ids.clone(),
                action_facet: request
                    .action_facet
                    .as_ref()
                    .or(fallback_action_facet.as_ref())
                    .map(
                        |af| crate::services::prompt_composition::types::ActionFacetUserInput {
                            id: af.id.clone(),
                            args: af.args.clone(),
                        },
                    ),
                delegation_targets: delegation_targets_for_offer,
                delegation_run_mode: effective_delegation_run_mode,
                // A user turn may plan tasks; only a task-result reaction may not.
                suppress_task_offer: false,
            };
            let PreparedChatRequest {
                chat_request,
                chat_options,
                generation_input_messages,
                generation_parameters,
                generation_request_context,
                mcp_servers_unavailable,
                mcp_servers_needing_auth,
                mcp_servers_disabled_by_user,
                mcp_tools_disabled_by_user,
                available_mcp_tools,
                offered_client_tools,
                delegation_targets,
                delegation_offered_file_ids,
                task_offer_scope,
            } = prepare_chat_request(
                &app_state,
                &policy,
                &chat,
                user_input,
                generation_request_context.clone(),
                &me_profile_input,
            )
            .await
            .wrap_err("Failed to prepare regenerate chat request")?;

            let langfuse_trace_enrichment = match build_langfuse_trace_enrichment(
                &app_state,
                &policy,
                &me_user.to_subject(),
                &generation_input_messages,
                chat.assistant_id,
                &generation_request_context,
            )
            .await
            {
                Ok(enrichment) => enrichment,
                Err(err) => {
                    warn_and_capture_error("build regenerate Langfuse trace enrichment", &err);
                    LangfuseTraceEnrichment::default()
                }
            };

            let empty_assistant_message_json = json!({ "role": "assistant", "content": [] });
            let chat_provider_id = generation_parameters
                .generation_chat_provider_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            let allowed_tool_names: HashSet<String> = chat_request
                .tools
                .as_ref()
                .map(|tools| {
                    tools
                        .iter()
                        .map(|tool| tool.name.to_string())
                        .collect::<HashSet<_>>()
                })
                .unwrap_or_default();

            let initial_assistant_message = submit_message(
                &app_state.db,
                &policy,
                &me_user.to_subject(),
                &chat.id,
                empty_assistant_message_json,
                Some(&previous_message.id),
                Some(&request.current_message_id),
                Some(generation_input_messages.clone()),
                &[],
                Some(generation_parameters),
                None,
                None,
            )
            .await
            .wrap_err("Failed to submit initial assistant message for regenerate")?;

            // The branch write just knocked every row below the new anchor off
            // the active thread, including any `task_result` row a finished
            // task was delivered into. Re-queue the ones whose origin turn is
            // still live so they reach this branch, and close the rest.
            // After `submit_message` returns, because it owns its own
            // transaction and the active flags are not final until it commits.
            if app_state.config.delegation.tasks.enabled
                && let Err(error) = crate::models::chat::requeue_or_supersede_branched_deliveries(
                    &app_state.db,
                    &chat.id,
                )
                .await
            {
                tracing::warn!(%error, "Failed to reconcile deliveries after a regenerate");
            }

            let assistant_started_event: RegenerateMessageStreamingResponseMessage =
                MessageSubmitStreamingResponseAssistantMessageStarted {
                    message_id: initial_assistant_message.id,
                }
                .into();
            assistant_started_event
                .send_event_report(tx.clone())
                .await?;

            let subject = me_user.to_subject();
            let chat_provider_headers_context =
                ChatProviderHeadersContext::new(&me_user.id, &me_user.id_token_claims);
            let mcp_auth_context = McpRequestAuthContext {
                app_state: Some(&app_state),
                user_id: Uuid::parse_str(&me_user.id).ok(),
                oidc_token: Some(&me_user.oidc_token),
                access_token: me_user.access_token.as_deref(),
            };
            let generation_result =
                stream_generate_chat_completion::<RegenerateMessageStreamingResponseMessage>(
                    tx.clone(),
                    &app_state,
                    &policy,
                    &subject,
                    chat_request,
                    langfuse_trace_enrichment,
                    chat_options,
                    initial_assistant_message.id,
                    me_user.id.clone(),
                    chat.id,
                    Some(chat_provider_id.as_str()),
                    &me_user.groups,
                    mcp_auth_context,
                    mcp_servers_unavailable,
                    mcp_servers_needing_auth,
                    mcp_servers_disabled_by_user,
                    mcp_tools_disabled_by_user,
                    allowed_tool_names,
                    available_mcp_tools,
                    offered_client_tools,
                    &chat_provider_headers_context,
                    Some(&task_for_stream),
                    chat.assistant_id,
                    vec![],
                    crate::models::chat::chat_is_delegated_run(&chat),
                    crate::services::delegation::child_may_park_on_approval(
                        &chat,
                        &app_state.config.delegation,
                    ),
                    Some(DelegationDispatchContext {
                        me_user: &me_user,
                        targets: &delegation_targets,
                        offered_file_ids: &delegation_offered_file_ids,
                        origin_chat: &chat,
                        origin_user_message_id: previous_message.id,
                        run_mode: effective_delegation_run_mode,
                        background_dispatches: std::sync::atomic::AtomicUsize::new(0),
                        task_scope: task_offer_scope.clone(),
                        tasks_this_turn: std::sync::atomic::AtomicUsize::new(0),
                    }),
                    task_tool_budgets_for_chat(&chat),
                    None,
                )
                .await;
            let (end_content, generation_metadata) = match generation_result {
                Ok(result) => result,
                Err(error) => {
                    let error = error.wrap_err("Failed during chat completion generation");
                    persist_background_generation_failure(
                        &task_for_stream,
                        &app_state,
                        &policy,
                        &me_user,
                        initial_assistant_message.id,
                        &chat_provider_id,
                        &error,
                    )
                    .await;
                    return Err(error);
                }
            };

            let generation_was_aborted = generation_metadata
                .as_ref()
                .and_then(|metadata| metadata.was_aborted)
                .unwrap_or(false);

            if let Some(metadata) = generation_metadata
                && let Err(err) = update_message_generation_metadata(
                    &app_state.db,
                    &policy,
                    &me_user.to_subject(),
                    &initial_assistant_message.id,
                    metadata,
                )
                .await
            {
                warn_and_capture_error("update regenerate generation metadata", &err);
            }

            let end_content = if generation_was_aborted {
                ensure_saved_assistant_content_for_abort(end_content)
            } else {
                end_content
            };
            stream_update_assistant_message_completion::<RegenerateMessageStreamingResponseMessage>(
                tx.clone(),
                &task_for_stream,
                &app_state,
                &policy,
                end_content,
                &me_user,
                initial_assistant_message.id,
            )
            .await?;

            Ok(())
        }
        .await;

        let generation_failed = result.is_err();
        if let Err(error) = result {
            forward_error_report(&tx, &error).await;
            log_and_capture_error("regenerate message background task", &error);
        }

        let outcome = task_for_stream.derive_outcome(generation_failed);
        task_for_stream.mark_completed();
        cleanup_guard.disarm();
        app_state_for_cleanup
            .background_tasks
            .remove_task(&chat_id_for_cleanup, task_for_stream.generation_id, outcome)
            .await;

        settle_tail_deliveries(
            &app_state,
            &policy,
            &me_user,
            chat_id_for_cleanup,
            &task_for_stream,
            outcome,
        )
        .await;
    });

    // Convert the receiver into a stream and return it
    let receiver_stream = tokio_stream::wrappers::ReceiverStream::<Result<Event, Report>>::new(rx);

    Ok(Sse::new(receiver_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    ))
}

#[utoipa::path(
    post,
    path = "/me/messages/editstream",
    request_body = EditMessageRequest,
    responses(
        (status = OK, content_type="text/event-stream", body = EditMessageStreamingResponseMessage),
        (status = BAD_REQUEST, description = "When validation fails (e.g., invalid message role)"),
        (status = NOT_FOUND, description = "When the chat does not exist or is not accessible"),
        (status = CONFLICT, body = GenerationRunningError, description = "When the chat is archived, or is a delegated run that is still in progress (plain text), or the chat's generation lease is already held and delegation.tasks.enabled is on (JSON, code = generation_running)"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "When an internal server error occurs")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn edit_message_sse(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    headers: HeaderMap,
    Json(request): Json<EditMessageRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Report>>>, StreamRouteError> {
    // Validate request parameters
    let message_to_edit =
        validate_edit_request(&app_state, &policy, &me_user, &request.message_id).await?;
    validate_file_uploads_for_message_submit(
        &app_state,
        &policy,
        &me_user,
        request.replace_input_files_ids.as_slice(),
    )
    .await?;

    // Validate action facet before spawning background task (returns HTTP 400 on failure)
    let generation_request_context = generation_request_context_from_headers(&headers);
    let platform = generation_request_context
        .platform
        .as_deref()
        .unwrap_or(DEFAULT_ERATO_PLATFORM);
    warn_unknown_platform(&app_state.config, platform);
    validate_action_facet(&app_state.config, request.action_facet.as_ref(), platform)?;

    let chat = get_chat_by_message_id(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &request.message_id,
    )
    .await
    .map_err(|e| {
        let s = e.to_string();
        if s.contains("not found") || s.contains("Access denied") || s.contains("not authorized") {
            (
                axum::http::StatusCode::NOT_FOUND,
                "Chat not found".to_string(),
            )
        } else {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load chat for edit: {}", e),
            )
        }
    })?;
    reject_if_archived(&chat)?;
    accept_user_write_into_delegated_run(&app_state, &chat).await?;

    // Assistant mentions follow the same edit contract as the action facet:
    // an explicit request value is validated hard (400), an absent one falls
    // back to the mentions the original user message stored, re-validated
    // softly so mentions that no longer validate are dropped rather than
    // failing the edit. The resolved value is persisted onto the new sibling
    // row and feeds the delegation tool offer.
    let (resolved_mentioned_assistant_ids, delegation_targets_for_offer): (
        Option<Vec<Uuid>>,
        Vec<crate::services::delegation::DelegationTarget>,
    ) = match request.mentioned_assistant_ids.clone() {
        Some(ids) => {
            let targets = crate::services::delegation::validate_mentioned_assistants(
                &app_state,
                &policy,
                &me_user.to_subject(),
                Some(&ids),
                chat.assistant_id,
                crate::models::chat::chat_is_delegated_run(&chat),
            )
            .await?;
            (
                Some(crate::services::delegation::dedupe_mentions(&ids)),
                targets,
            )
        }
        None => {
            let persisted = crate::models::message::get_input_mentioned_assistant_ids_from_message(
                &message_to_edit,
            )
            .unwrap_or_else(|error| {
                warn_and_capture_error("read edit fallback assistant mentions", &error);
                None
            });
            match persisted {
                Some(ids) => {
                    let targets = crate::services::delegation::resolve_persisted_mentions(
                        &app_state,
                        &policy,
                        &me_user.to_subject(),
                        Some(&ids),
                        chat.assistant_id,
                        crate::models::chat::chat_is_delegated_run(&chat),
                    )
                    .await;
                    let resolved_ids = (!targets.is_empty())
                        .then(|| targets.iter().map(|target| target.id).collect());
                    (resolved_ids, targets)
                }
                None => (None, Vec::new()),
            }
        }
    };

    // Create a channel for sending events
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Report>>(100);
    let (_abort_rx, task) =
        acquire_user_generation_lease(&app_state, chat.id, Uuid::new_v4()).await?;

    // Move request data into the task
    let replace_user_message = request.replace_user_message;
    let replace_input_files_ids = request.replace_input_files_ids;
    // Resolve the effective action facet for this edit. When the edit request
    // carries no explicit facet, fall back to the one the original user
    // message stored — re-validated against the CURRENT config so a facet
    // removed/changed since is dropped (edit proceeds without it) rather than
    // failing the request. Mirrors the regenerate precedent: the user edits
    // their instruction, but the context it referred to (selected text, draft,
    // etc.) persists. Unlike regenerate — which reuses the existing user
    // message row — edit creates a NEW sibling message, so the resolved facet
    // must be persisted onto it (below) as well as fed to the generation, or
    // the UI and any subsequent edit would lose the context.
    let resolved_action_facet: Option<ActionFacetRequest> = match request.action_facet.clone() {
        Some(af) => Some(af),
        None => match crate::models::message::get_input_action_facet_from_message(&message_to_edit)
        {
            Ok(action_facet) => action_facet,
            Err(error) => {
                warn_and_capture_error("read edit fallback action facet", &error);
                None
            }
        }
        .map(|(id, args)| ActionFacetRequest { id, args })
        .filter(
            |af| match validate_action_facet(&app_state.config, Some(af), platform) {
                Ok(()) => true,
                Err((_, reason)) => {
                    tracing::warn!(
                        "Dropping stored action facet '{}' on edit: {}",
                        af.id,
                        reason
                    );
                    false
                }
            },
        ),
    };
    // The run mode follows the same edit contract as the mentions: an explicit
    // request value wins (including an explicit `wait`, which clears an
    // inherited `background`), an absent one inherits the mode the original
    // user message stored. Only `background` is persisted (absence means
    // wait), and as requested, not gate-downgraded: the gate applies at
    // dispatch time, so a replay under a later-enabled gate honours the
    // user's original choice.
    let resolved_delegation_run_mode = match request.delegation_run_mode {
        Some(mode) => Some(mode),
        None => {
            crate::models::message::get_input_delegation_run_mode_from_message(&message_to_edit)
                .unwrap_or_else(|error| {
                    warn_and_capture_error("read edit fallback delegation run mode", &error);
                    None
                })
        }
    }
    .filter(|mode| *mode == DelegationRunMode::Background);
    // What dispatch executes this turn: the resolved (requested-or-inherited)
    // value above, gate-downgraded.
    let effective_delegation_run_mode = crate::services::delegation::resolve_delegation_run_mode(
        resolved_delegation_run_mode,
        None,
        &app_state.config.delegation,
    );
    let edit_input_parameters = if resolved_action_facet.is_some()
        || resolved_mentioned_assistant_ids.is_some()
        || resolved_delegation_run_mode.is_some()
    {
        Some(crate::models::message::InputParameters {
            action_facet_id: resolved_action_facet.as_ref().map(|af| af.id.clone()),
            action_facet_args: resolved_action_facet.as_ref().map(|af| af.args.clone()),
            mentioned_assistant_ids: resolved_mentioned_assistant_ids
                .as_ref()
                .filter(|ids| !ids.is_empty())
                .map(|ids| ids.iter().map(|id| id.to_string()).collect()),
            delegation_run_mode: resolved_delegation_run_mode,
            task_result: None,
        })
    } else {
        None
    };
    let task_for_stream = task.clone();
    let app_state_for_cleanup = app_state.clone();
    let chat_id_for_cleanup = chat.id;

    // Spawn a task to process the request and send events
    tokio::spawn(async move {
        let mut cleanup_guard = TaskCleanupGuard::new(
            app_state_for_cleanup.background_tasks.clone(),
            chat_id_for_cleanup,
            task_for_stream.generation_id,
        );
        let result: Result<(), Report> = async {
            let user_message = json!({
                "role": "user",
                "content": vec![json!({
                    "content_type": "text",
                    "text": replace_user_message
                })],
                "name": me_user.id
            });

            let saved_user_message = submit_message(
                &app_state.db,
                &policy,
                &me_user.to_subject(),
                &chat.id,
                user_message,
                message_to_edit.previous_message_id.as_ref(),
                Some(&message_to_edit.id),
                None,
                &replace_input_files_ids,
                None,
                None,
                edit_input_parameters,
            )
            .await
            .wrap_err("Failed to submit edited user message")?;

            // Resolved here so the live event carries the same display pairs
            // the read API serves — the edited message highlights without a
            // refetch (the edit composer does not re-send mention names).
            let saved_user_message_wrapped = ChatMessage::from_model(saved_user_message.clone())
                .wrap_err("Failed to convert saved edited user message")?
                .with_mentioned_assistants(&app_state.db, &saved_user_message)
                .await;

            let user_message_saved: EditMessageStreamingResponseMessage =
                MessageSubmitStreamingResponseUserMessageSaved {
                    message_id: saved_user_message.id,
                    message: saved_user_message_wrapped,
                }
                .into();
            user_message_saved.send_event_report(tx.clone()).await?;

            let me_profile_input = MeProfileChatRequestInput::from_me_profile(&me_user);
            let fallback_chat_provider_id = if request.chat_provider_id.is_none() {
                match get_generation_chat_provider_id_for_replaced_user_message(
                    &app_state.db,
                    &message_to_edit.id,
                )
                .await
                {
                    Ok(chat_provider_id) => chat_provider_id,
                    Err(error) => {
                        warn_and_capture_error("read edit fallback chat provider", &error);
                        None
                    }
                }
            } else {
                None
            };
            let user_input = PromptCompositionUserInput {
                just_submitted_user_message_id: saved_user_message.id,
                requested_chat_provider_id: request
                    .chat_provider_id
                    .clone()
                    .or(fallback_chat_provider_id),
                new_input_file_ids: replace_input_files_ids,
                selected_facet_ids: request.selected_facet_ids.clone(),
                // Resolved above (request facet, else the validated stored
                // fallback); the same value is persisted via edit_input_parameters.
                action_facet: resolved_action_facet.as_ref().map(|af| {
                    crate::services::prompt_composition::types::ActionFacetUserInput {
                        id: af.id.clone(),
                        args: af.args.clone(),
                    }
                }),
                delegation_targets: delegation_targets_for_offer,
                delegation_run_mode: effective_delegation_run_mode,
                // A user turn may plan tasks; only a task-result reaction may not.
                suppress_task_offer: false,
            };
            let PreparedChatRequest {
                chat_request,
                chat_options,
                generation_input_messages,
                generation_parameters,
                generation_request_context,
                mcp_servers_unavailable,
                mcp_servers_needing_auth,
                mcp_servers_disabled_by_user,
                mcp_tools_disabled_by_user,
                available_mcp_tools,
                offered_client_tools,
                delegation_targets,
                delegation_offered_file_ids,
                task_offer_scope,
            } = prepare_chat_request(
                &app_state,
                &policy,
                &chat,
                user_input,
                generation_request_context.clone(),
                &me_profile_input,
            )
            .await
            .wrap_err("Failed to prepare edited chat request")?;

            let langfuse_trace_enrichment = match build_langfuse_trace_enrichment(
                &app_state,
                &policy,
                &me_user.to_subject(),
                &generation_input_messages,
                chat.assistant_id,
                &generation_request_context,
            )
            .await
            {
                Ok(enrichment) => enrichment,
                Err(err) => {
                    warn_and_capture_error("build edit Langfuse trace enrichment", &err);
                    LangfuseTraceEnrichment::default()
                }
            };

            let empty_assistant_message_json = json!({ "role": "assistant", "content": [] });
            let chat_provider_id = generation_parameters
                .generation_chat_provider_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            let allowed_tool_names: HashSet<String> = chat_request
                .tools
                .as_ref()
                .map(|tools| {
                    tools
                        .iter()
                        .map(|tool| tool.name.to_string())
                        .collect::<HashSet<_>>()
                })
                .unwrap_or_default();

            let initial_assistant_message = submit_message(
                &app_state.db,
                &policy,
                &me_user.to_subject(),
                &chat.id,
                empty_assistant_message_json,
                Some(&saved_user_message.id),
                None,
                Some(generation_input_messages.clone()),
                &[],
                Some(generation_parameters),
                None,
                None,
            )
            .await
            .wrap_err("Failed to submit initial assistant message for edit")?;

            // The branch write just knocked every row below the new anchor off
            // the active thread, including any `task_result` row a finished
            // task was delivered into. Re-queue the ones whose origin turn is
            // still live so they reach this branch, and close the rest.
            // After `submit_message` returns, because it owns its own
            // transaction and the active flags are not final until it commits.
            if app_state.config.delegation.tasks.enabled
                && let Err(error) = crate::models::chat::requeue_or_supersede_branched_deliveries(
                    &app_state.db,
                    &chat.id,
                )
                .await
            {
                tracing::warn!(%error, "Failed to reconcile deliveries after a edit");
            }

            let assistant_started_event: EditMessageStreamingResponseMessage =
                MessageSubmitStreamingResponseAssistantMessageStarted {
                    message_id: initial_assistant_message.id,
                }
                .into();
            assistant_started_event
                .send_event_report(tx.clone())
                .await?;

            let subject = me_user.to_subject();
            let chat_provider_headers_context =
                ChatProviderHeadersContext::new(&me_user.id, &me_user.id_token_claims);
            let mcp_auth_context = McpRequestAuthContext {
                app_state: Some(&app_state),
                user_id: Uuid::parse_str(&me_user.id).ok(),
                oidc_token: Some(&me_user.oidc_token),
                access_token: me_user.access_token.as_deref(),
            };
            let generation_result =
                stream_generate_chat_completion::<EditMessageStreamingResponseMessage>(
                    tx.clone(),
                    &app_state,
                    &policy,
                    &subject,
                    chat_request,
                    langfuse_trace_enrichment,
                    chat_options,
                    initial_assistant_message.id,
                    me_user.id.clone(),
                    chat.id,
                    Some(chat_provider_id.as_str()),
                    &me_user.groups,
                    mcp_auth_context,
                    mcp_servers_unavailable,
                    mcp_servers_needing_auth,
                    mcp_servers_disabled_by_user,
                    mcp_tools_disabled_by_user,
                    allowed_tool_names,
                    available_mcp_tools,
                    offered_client_tools,
                    &chat_provider_headers_context,
                    Some(&task_for_stream),
                    chat.assistant_id,
                    vec![],
                    crate::models::chat::chat_is_delegated_run(&chat),
                    crate::services::delegation::child_may_park_on_approval(
                        &chat,
                        &app_state.config.delegation,
                    ),
                    Some(DelegationDispatchContext {
                        me_user: &me_user,
                        targets: &delegation_targets,
                        offered_file_ids: &delegation_offered_file_ids,
                        origin_chat: &chat,
                        origin_user_message_id: saved_user_message.id,
                        run_mode: effective_delegation_run_mode,
                        background_dispatches: std::sync::atomic::AtomicUsize::new(0),
                        task_scope: task_offer_scope.clone(),
                        tasks_this_turn: std::sync::atomic::AtomicUsize::new(0),
                    }),
                    task_tool_budgets_for_chat(&chat),
                    None,
                )
                .await;
            let (end_content, generation_metadata) = match generation_result {
                Ok(result) => result,
                Err(error) => {
                    let error = error.wrap_err("Failed during chat completion generation");
                    persist_background_generation_failure(
                        &task_for_stream,
                        &app_state,
                        &policy,
                        &me_user,
                        initial_assistant_message.id,
                        &chat_provider_id,
                        &error,
                    )
                    .await;
                    return Err(error);
                }
            };

            let generation_was_aborted = generation_metadata
                .as_ref()
                .and_then(|metadata| metadata.was_aborted)
                .unwrap_or(false);

            if let Some(metadata) = generation_metadata
                && let Err(err) = update_message_generation_metadata(
                    &app_state.db,
                    &policy,
                    &me_user.to_subject(),
                    &initial_assistant_message.id,
                    metadata,
                )
                .await
            {
                warn_and_capture_error("update edit generation metadata", &err);
            }

            let end_content = if generation_was_aborted {
                ensure_saved_assistant_content_for_abort(end_content)
            } else {
                end_content
            };
            stream_update_assistant_message_completion::<EditMessageStreamingResponseMessage>(
                tx.clone(),
                &task_for_stream,
                &app_state,
                &policy,
                end_content,
                &me_user,
                initial_assistant_message.id,
            )
            .await?;

            Ok(())
        }
        .await;

        let generation_failed = result.is_err();
        if let Err(error) = result {
            forward_error_report(&tx, &error).await;
            log_and_capture_error("edit message background task", &error);
        }

        let outcome = task_for_stream.derive_outcome(generation_failed);
        task_for_stream.mark_completed();
        cleanup_guard.disarm();
        app_state_for_cleanup
            .background_tasks
            .remove_task(&chat_id_for_cleanup, task_for_stream.generation_id, outcome)
            .await;

        settle_tail_deliveries(
            &app_state,
            &policy,
            &me_user,
            chat_id_for_cleanup,
            &task_for_stream,
            outcome,
        )
        .await;
    });

    // Convert the receiver into a stream and return it
    let receiver_stream = tokio_stream::wrappers::ReceiverStream::<Result<Event, Report>>::new(rx);

    Ok(Sse::new(receiver_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    ))
}

#[utoipa::path(
    post,
    path = "/me/messages/abortstream",
    request_body = AbortStreamRequest,
    responses(
        (status = OK, body = AbortStreamResponse),
        (status = NOT_FOUND, description = "No active generation task found for this chat"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = FORBIDDEN, description = "When the user has no access to the chat"),
        (status = INTERNAL_SERVER_ERROR, description = "When an internal server error occurs")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn abort_message_stream(
    State(app_state): State<AppState>,
    Extension(policy): Extension<PolicyEngine>,
    Extension(me_user): Extension<MeProfile>,
    Json(request): Json<AbortStreamRequest>,
) -> Result<Json<AbortStreamResponse>, (axum::http::StatusCode, String)> {
    let _chat = get_or_create_chat(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        Some(&request.chat_id),
        &me_user.id,
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::FORBIDDEN,
            format!("Access denied to chat: {}", e),
        )
    })?
    .0;

    if let Some(task) = app_state.background_tasks.get_task(&request.chat_id).await {
        task.request_abort();
    } else if let Some((generation_id, _)) = app_state
        .background_tasks
        .get_shared_generation(&request.chat_id)
        .await
    {
        app_state
            .background_tasks
            .enqueue_abort(generation_id)
            .await
            .map_err(|error| {
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to request abort: {error}"),
                )
            })?;
    } else {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            "No active generation task found for this chat".to_string(),
        ));
    }

    Ok(Json(AbortStreamResponse {
        abort_requested: true,
    }))
}

#[utoipa::path(
    post,
    path = "/me/messages/clienttoolresult",
    request_body = ClientToolResultRequest,
    responses(
        (status = OK, body = ClientToolResultResponse),
        (status = NOT_FOUND, description = "No suspended generation matches this chat and message"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = FORBIDDEN, description = "When the user has no access to the chat"),
        (status = INTERNAL_SERVER_ERROR, description = "When an internal server error occurs")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn client_tool_result(
    State(app_state): State<AppState>,
    Extension(policy): Extension<PolicyEngine>,
    Extension(me_user): Extension<MeProfile>,
    Json(request): Json<ClientToolResultRequest>,
) -> Result<Json<ClientToolResultResponse>, (axum::http::StatusCode, String)> {
    // Per-chat ownership gate, identical to abort/resume — middleware alone does
    // not enforce per-chat access.
    let _chat = get_or_create_chat(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        Some(&request.chat_id),
        &me_user.id,
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::FORBIDDEN,
            format!("Access denied to chat: {}", e),
        )
    })?
    .0;

    let task = app_state.background_tasks.get_task(&request.chat_id).await;
    // Rejected submissions must retain their diagnostics without reading attachments.
    let resolve_files = request.error.is_none() && request.validation_errors.is_empty();
    let mut payload = json!({ "validation_errors": request.validation_errors });
    if let Some(error) = request.error {
        payload["error"] = json!(error);
    }
    if let Some(result) = request.result {
        payload["result"] = result;
    }

    if task.is_none() {
        let Some((generation_id, message_id)) = app_state
            .background_tasks
            .get_shared_generation(&request.chat_id)
            .await
        else {
            return Err((
                axum::http::StatusCode::NOT_FOUND,
                "No active generation task found for this chat".to_string(),
            ));
        };
        if let Some(message_id) = message_id
            && message_id != request.message_id
        {
            return Err((
                axum::http::StatusCode::NOT_FOUND,
                "No suspended generation matches this message".to_string(),
            ));
        }
        if resolve_files
            && let Some((result, file_ids)) = super::file_resolution::resolve_client_tool_files(
                &app_state,
                &policy,
                &me_user.to_subject(),
                me_user.access_token.as_deref(),
                payload.get("result").cloned(),
                &request.file_upload_ids,
            )
            .await
        {
            payload["result"] = result;
            payload["file_upload_ids"] = json!(file_ids);
        }
        app_state
            .background_tasks
            .enqueue_client_tool_result(generation_id, &request.tool_call_id, payload)
            .await
            .map_err(|error| {
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to deliver client tool result: {error}"),
                )
            })?;
        return Ok(Json(ClientToolResultResponse { delivered: true }));
    }

    let task = task.expect("task checked above");

    // Route by task identity, not chat_id alone: a concurrent submit/regenerate
    // replaces the task (new message_id), so refuse to deliver to the wrong turn.
    if task.message_id() != request.message_id {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            "No suspended generation matches this message".to_string(),
        ));
    }

    if resolve_files
        && let Some((result, file_ids)) = super::file_resolution::resolve_client_tool_files(
            &app_state,
            &policy,
            &me_user.to_subject(),
            me_user.access_token.as_deref(),
            payload.get("result").cloned(),
            &request.file_upload_ids,
        )
        .await
    {
        payload["result"] = result;
        payload["file_upload_ids"] = json!(file_ids);
    }
    let outcome = ClientToolOutcome::from_payload(&payload);

    let delivery = task
        .deliver_client_tool_result(&request.tool_call_id, outcome)
        .await;

    // An unknown/already-consumed tool_call_id (already delivered, timed out,
    // aborted) is a benign idempotent no-op — never a 4xx/5xx.
    Ok(Json(ClientToolResultResponse {
        delivered: matches!(delivery, ClientToolDelivery::Delivered),
    }))
}

/// Every "you may not have this" answer `/react` gives.
///
/// One status and one body for a disabled feature, an unknown chat, a chat
/// somebody else owns and a row that is not in it — so a prober cannot use the
/// difference to learn which chats exist.
fn react_not_found() -> StreamRouteError {
    StreamRouteError::PlainText(axum::http::StatusCode::NOT_FOUND, "Not found".to_string())
}

/// Build the typed `409` for a row that cannot be reacted to.
fn nothing_to_react(chat_id: Uuid, task_result_message_id: Uuid, reason: &str) -> StreamRouteError {
    StreamRouteError::NothingToReact(Box::new(NothingToReactError {
        code: "nothing_to_react".to_string(),
        chat_id,
        task_result_message_id,
        reason: reason.to_string(),
    }))
}

/// Preconditions 9-11 of [`react_to_task_result_sse`], and the delivery
/// envelope they validated.
///
/// Factored out because `/react` runs them twice: once before taking the
/// generation lease, so the common refusal costs nothing, and once under it,
/// because all three read state another writer can change in between.
///
/// `already_reacted` is tested BEFORE `tip_moved`, deliberately. Once a
/// reaction has run the assistant row IS the tip, so both would fire — and the
/// two mean opposite things to a client: `already_reacted` says suppress the
/// affordance, `tip_moved` says offer a re-anchor. The reverse order silently
/// degrades the UI to the wrong one of the two.
///
/// There is no `scheduling` check. `deliver_task_result` deliberately stops at
/// `delivered` for a `silent` result, which is exactly the row a person is most
/// likely to ask to answer explicitly; `/react` is a request, not a
/// re-application of the task author's policy.
async fn task_result_still_reactable(
    app_state: &AppState,
    chat_id: Uuid,
    child_chat_id: Uuid,
    task_result_message_id: Uuid,
) -> Result<crate::models::chat::ResultDelivery, StreamRouteError> {
    // 9. The child still says this exact row is the one it delivered.
    //
    //    `reacted` is accepted here and refused at step 10, not folded into
    //    this check. Both are "the row was delivered"; only step 10 knows which
    //    of the two answers a client can act on. Rejecting `reacted` here would
    //    report `not_delivered` for a row that plainly was, and 779-B would
    //    have no way to tell "suppress the affordance" from "this is not a task
    //    result at all". Everything else — `pending`, `claimed`, `superseded`,
    //    `failed`, or a delivery naming a different row — is `not_delivered`.
    //
    //    A delivery whose reaction ran but whose own bookkeeping write lost its
    //    fence presents here as `delivered` with no reaction id, and falls out
    //    at step 11 as `tip_moved` — the honest answer, because from the
    //    outside the conversation has moved on.
    let child = crate::db::entity::prelude::Chats::find_by_id(child_chat_id)
        .one(&app_state.db)
        .await
        .map_err(|error| {
            tracing::warn!(%error, %child_chat_id, "Failed to read the child chat of a task result");
            StreamRouteError::PlainText(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load chat".to_string(),
            )
        })?;
    let delivery = child
        .as_ref()
        .and_then(|child| {
            crate::models::chat::parse_chat_configuration(child)
                .ok()
                .flatten()
        })
        .and_then(|configuration| configuration.provenance)
        .and_then(|provenance| provenance.result_delivery)
        .filter(|delivery| {
            matches!(
                delivery.state,
                crate::models::chat::ResultDeliveryState::Delivered
                    | crate::models::chat::ResultDeliveryState::Reacted
            ) && delivery.message_id == Some(task_result_message_id)
        });
    let Some(delivery) = delivery else {
        return Err(nothing_to_react(
            chat_id,
            task_result_message_id,
            REACT_REASON_NOT_DELIVERED,
        ));
    };

    // 10. Nothing has answered it yet. `reacted` is the normal way a second
    //     request lands here; a `delivered` row that already names a reaction
    //     is the same answer from a bookkeeping write that half-landed.
    if delivery.state == crate::models::chat::ResultDeliveryState::Reacted
        || delivery.reaction_message_id.is_some()
    {
        return Err(nothing_to_react(
            chat_id,
            task_result_message_id,
            REACT_REASON_ALREADY_REACTED,
        ));
    }

    // 11. It is still what the conversation is sitting on. A failed read is
    //     NOT `tip_moved`: `None` means "no anchor" and `Err` means "we do not
    //     know", and telling a client the conversation moved on because of a
    //     database hiccup fires its re-anchor affordance on a lie.
    let tip = crate::models::message::get_active_thread_tip(&app_state.db, &chat_id)
        .await
        .map_err(|error| {
            tracing::warn!(%error, %chat_id, "Failed to resolve the active thread tip for a reaction");
            StreamRouteError::PlainText(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load chat".to_string(),
            )
        })?;
    if tip.map(|row| row.id) != Some(task_result_message_id) {
        return Err(nothing_to_react(
            chat_id,
            task_result_message_id,
            REACT_REASON_TIP_MOVED,
        ));
    }

    Ok(delivery)
}

/// Run the reaction turn a delivered task result is still owed.
///
/// The explicit, client-driven equivalent of the second half of
/// `deliver_task_result`: the `task_result` row is already in the conversation,
/// nothing has answered it, and the caller wants that answer run now and
/// streamed back on the same socket.
#[utoipa::path(
    post,
    path = "/me/chats/{chat_id}/react",
    params(
        ("chat_id" = String, Path, description = "The chat holding the delivered task result")
    ),
    request_body = ReactToTaskResultRequest,
    responses(
        (status = OK, content_type = "text/event-stream", body = MessageSubmitStreamingResponseMessage),
        (status = BAD_REQUEST, description = "Invalid chat ID format"),
        (status = NOT_FOUND, description = "When async task delivery is disabled, or the chat or message does not exist or is not accessible"),
        (status = CONFLICT, body = GenerationRunningError, description = "When the chat is archived (plain text), the chat's generation lease is already held (JSON, code = generation_running), or there is nothing to react to (JSON, code = nothing_to_react, body = NothingToReactError)"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "When an internal server error occurs")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn react_to_task_result_sse(
    State(app_state): State<AppState>,
    Extension(policy): Extension<PolicyEngine>,
    Extension(me_user): Extension<MeProfile>,
    Path(chat_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<ReactToTaskResultRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Report>>>, StreamRouteError> {
    // 1. The gate, the same shape `drain_pending_deliveries` uses. With async
    //    delivery off there is no such thing as a delivered task result, so
    //    the route does not exist rather than refusing with a reason.
    if !app_state.config.delegation.tasks.enabled
        || !app_state
            .config
            .delegation
            .tasks
            .run_modes
            .contains(&erato_config::config::TaskRunMode::Async)
    {
        return Err(react_not_found());
    }

    // 2. A malformed id is the client's mistake, not a missing chat.
    let chat_id = Uuid::parse_str(&chat_id).map_err(|_| {
        StreamRouteError::PlainText(
            axum::http::StatusCode::BAD_REQUEST,
            "Invalid chat ID".to_string(),
        )
    })?;
    let task_result_message_id = request.task_result_message_id;

    // 3-4. The chat, through the policy engine's own loader.
    policy
        .rebuild_data_if_needed_req(&app_state.db, &app_state.config)
        .await
        .map_err(|status| StreamRouteError::PlainText(status, "Failed to load chat".to_string()))?;
    let chat = policy
        .load_chat_model(&app_state.db, chat_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, %chat_id, "Failed to load the chat for a task result reaction");
            StreamRouteError::PlainText(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load chat".to_string(),
            )
        })?
        .ok_or_else(react_not_found)?;

    // 5. `SubmitMessage`, not `Read`: this route starts a turn, so read access
    //    to a shared chat must not be enough to reach it. Refused and "the
    //    authorizer broke" both answer 404, because a 500 here would tell a
    //    prober the chat exists.
    if let Err(error) = authorize!(
        policy,
        &me_user.to_subject(),
        &Resource::Chat(chat_id.as_hyphenated().to_string()),
        Action::SubmitMessage
    ) {
        tracing::warn!(%error, %chat_id, "Refused a task result reaction");
        return Err(react_not_found());
    }

    // 6. Archived chats take no writes, reaction or otherwise.
    reject_if_archived(&chat)?;

    // 7. Read the row directly rather than through `get_message_by_id`: that
    //    one authorizes at `Action::Read`, which is both redundant after step 5
    //    and the wrong gate for a route that writes. Comparing `chat_id`
    //    ourselves is what makes a foreign row indistinguishable from a
    //    missing one.
    let delivered_row = crate::db::entity::prelude::Messages::find_by_id(task_result_message_id)
        .one(&app_state.db)
        .await
        .map_err(|error| {
            tracing::warn!(%error, %chat_id, "Failed to read a task result row");
            StreamRouteError::PlainText(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load message".to_string(),
            )
        })?
        .filter(|row| row.chat_id == chat_id)
        .ok_or_else(react_not_found)?;

    // 8. Only the server ever writes this marker, so the `child_chat_id` on it
    //    is trustworthy in a way one taken from the request body would not be.
    let child_chat_id = delivered_row
        .input_parameters
        .as_ref()
        .and_then(|parameters| {
            serde_json::from_value::<crate::models::message::InputParameters>(parameters.clone())
                .ok()
        })
        .and_then(|parameters| parameters.task_result)
        .map(|marker| marker.child_chat_id)
        .ok_or_else(|| {
            nothing_to_react(
                chat_id,
                task_result_message_id,
                REACT_REASON_NOT_A_TASK_RESULT,
            )
        })?;

    // 9-11, cheaply, before anything is taken.
    task_result_still_reactable(&app_state, chat_id, child_chat_id, task_result_message_id).await?;

    // Both reads are best-effort by construction, and both happen BEFORE the
    // lease so that neither can put a `?` in the window between acquiring it
    // and spawning the task that releases it. The facets come from the shared
    // helper so a `/react` turn speaks with the same capabilities a
    // delivery-driven reaction does.
    let selected_facet_ids =
        crate::services::task_delivery::selected_facets_of_tip(&app_state, chat_id).await;
    let chat_provider_id = crate::models::chat::get_last_chat_provider_id(&app_state.db, &chat_id)
        .await
        .ok()
        .flatten();

    // 12. `RefuseParked`: the content this turn runs on was written by the
    //     server, and what it would displace is an approval card the same
    //     person is mid-decision on. The lease id is a fresh v4, not the row we
    //     are answering — the generation overwrites it with the assistant row's
    //     id, and that is what the `reacted` bookkeeping stores.
    let (broadcast_rx, task) =
        acquire_task_result_generation_lease(&app_state, chat_id, Uuid::new_v4()).await?;
    // Armed the instant the lease is ours. Without it a panic before the spawn
    // leaves the task un-completed in the manager's map, so the heartbeat
    // refreshes the chats row forever, `stale_after_secs` never fires, and
    // every later write into this chat 409s for the life of the process.
    let mut lease_guard = TaskCleanupGuard::new(
        app_state.background_tasks.clone(),
        chat_id,
        task.generation_id,
    );

    // 13. The same three checks again, now that nobody else can be writing.
    //     Deliberately not a `?`: this window must release the lease itself,
    //     through the lifecycle rather than by hand, so anyone already attached
    //     gets the closing frame and `remove_task` stays identity-gated.
    let delivered = match task_result_still_reactable(
        &app_state,
        chat_id,
        child_chat_id,
        task_result_message_id,
    )
    .await
    {
        Ok(delivered) => delivered,
        Err(error) => {
            lease_guard.disarm();
            let _ = with_generation_task_lifecycle(
                &app_state.background_tasks,
                &task,
                chat_id,
                async { Ok(()) },
            )
            .await;
            return Err(error);
        }
    };

    // `run_generation_after_user_message`, never `save_user_message_for_submit`:
    // the user row already exists. Saving one would emit a spurious
    // `ChatCreated` and append a second row holding the empty `user_message`
    // this synthetic request carries.
    let request = MessageSubmitRequest::for_result_delivery(
        chat_id,
        chat_provider_id,
        selected_facet_ids,
        Some(task_result_message_id),
    );
    let generation_request_context = generation_request_context_from_headers(&headers);

    let app_state_bg = app_state.clone();
    let policy_bg = policy.clone();
    let me_user_bg = me_user.clone();
    let task_bg = Arc::clone(&task);
    // The lifecycle installs its own guard inside the spawned future; keeping
    // ours armed as well would double-release.
    lease_guard.disarm();
    tokio::spawn(
        async move {
            let reaction = with_generation_task_lifecycle(
                &app_state_bg.background_tasks,
                &task_bg,
                chat_id,
                run_generation_after_user_message(
                    &task_bg,
                    &app_state_bg,
                    &policy_bg,
                    &me_user_bg,
                    &request,
                    generation_request_context,
                    &chat,
                    false,
                    Vec::new(),
                    &delivered_row,
                    // Suppresses the task offer for this turn and stamps
                    // `initiator = task_result` on the assistant row.
                    GenerationOrigin::TaskResultDelivery,
                ),
            )
            .await;
            if let Err(error) = reaction {
                tracing::warn!(%error, %chat_id, "The reaction to a delivered task result failed");
            } else if !crate::services::task_delivery::mark_delivery_reacted(
                &app_state_bg,
                child_chat_id,
                &delivered,
                // The ASSISTANT row: the generation overwrote the lease's v4
                // with it as soon as the row existed.
                task_bg.message_id(),
            )
            .await
            {
                // Benign, and must not fail anything: the reaction is on disk
                // either way and only the bookkeeping is stale. The delivery
                // path's own CAS #4 warns and carries on for the same reason.
                tracing::warn!(
                    %child_chat_id,
                    "Could not mark a delivered task result as reacted; the reaction itself is on disk"
                );
            }

            // Last, and after `remove_task`, which the lifecycle owns: a
            // delivery takes this chat's lease for itself, and `RefuseParked`
            // would refuse a lease this turn still held.
            //
            // The inward half only, unlike the user-write tails: a reaction
            // cannot be the answer to a parked card. `/react` refuses a parked
            // lease outright, so this chat cannot be a parked `async` child
            // whose delivery is still `input_required`.
            crate::services::task_delivery::drain_pending_deliveries(
                &app_state_bg,
                &policy_bg,
                &me_user_bg,
                chat_id,
            )
            .await;
        }
        .in_current_span(),
    );

    // The same stream `message_submit_sse` answers with, and for the same
    // reason: `run_generation_after_user_message` writes into no `tx` — it
    // broadcasts through the `StreamingTask`, so the lease's own receiver is
    // the only thing that carries this turn's tokens.
    let event_stream = {
        use futures::StreamExt;
        let broadcast_stream = tokio_stream::wrappers::BroadcastStream::new(broadcast_rx);
        futures::StreamExt::filter_map(broadcast_stream, |result| {
            futures::future::ready(match result {
                Ok(streaming_event) => match streaming_event_to_sse(&streaming_event) {
                    Ok(sse_event) => Some(Ok(sse_event)),
                    Err(e) => Some(Err(e)),
                },
                Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
                    tracing::warn!("Client lagged behind by {} events", n);
                    None
                }
            })
        })
        .inspect(|event| {
            if let Err(err) = event {
                log_and_capture_error("react SSE serialization", err);
            }
        })
    };

    Ok(Sse::new(event_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    ))
}

/// What a parked turn still has open.
struct ParkedApprovalState {
    request: ContentPartToolApprovalRequest,
    /// The approvals no decision part after the request answers.
    open: Vec<ApprovalItem>,
    /// Whether the row shows nothing but decisions and tool output after the
    /// request. Sufficient to admit a crash retry, not necessary: a turn that
    /// says something before its next tool call commits that text mid-turn, so
    /// a `text` part is no proof of an answer. That case is admitted by
    /// `GenerationMetadata::continuation_in_flight` instead.
    unanswered: bool,
}

/// Derive the open set from the whole row rather than from its tail part.
///
/// `last()` cannot answer this any more: a row whose continuation crashed
/// between persisting the outcome and finishing the turn carries the same
/// approval request as one nobody has decided yet, and answering the first with
/// a `400` is what makes a `continuestream` retry after a restart impossible.
fn parked_approval_state(content: &[ContentPart]) -> Option<ParkedApprovalState> {
    let (request_index, request) =
        content
            .iter()
            .enumerate()
            .rev()
            .find_map(|(index, part)| match part {
                ContentPart::ToolApprovalRequest(request) => Some((index, request.clone())),
                _ => None,
            })?;
    let items = request.approval_items();
    // Only parts AFTER the request count: an earlier park of the same turn has
    // its own decision parts, and they answer nothing this one asked.
    let settled = &content[request_index + 1..];
    let decided = |item: &ApprovalItem| {
        settled.iter().any(|part| {
            // Rows written before approvals were addressable carry no
            // `approval_id`; for them the tool call id is the identity.
            let (approval_id, tool_call_id) = match part {
                ContentPart::ToolApproval(approval) => (
                    approval.approval_id.as_deref(),
                    approval.tool_call_id.as_str(),
                ),
                ContentPart::ToolRejection(rejection) => (
                    rejection.approval_id.as_deref(),
                    rejection.tool_call_id.as_str(),
                ),
                _ => return false,
            };
            match approval_id {
                Some(approval_id) => approval_id == item.approval_id,
                None => tool_call_id == item.tool_call_id,
            }
        })
    };
    let open = items
        .iter()
        .filter(|item| !decided(item))
        .cloned()
        .collect();
    let unanswered = settled.iter().all(|part| {
        matches!(
            part,
            ContentPart::ToolApproval(_)
                | ContentPart::ToolRejection(_)
                | ContentPart::ToolUse(_)
                // A tool's file output, which answers nothing on its own.
                | ContentPart::TextFilePointer(_)
                | ContentPart::ImageFilePointer(_)
        )
    });
    Some(ParkedApprovalState {
        request,
        open,
        unanswered,
    })
}

/// Read the marker a running continuation leaves on the message it is
/// answering.
///
/// Unreadable metadata is treated as no marker: an unparseable column must not
/// be the reason a turn is resumed a second time.
fn continuation_owes_an_answer(message: &messages::Model) -> bool {
    message
        .generation_metadata
        .as_ref()
        .and_then(|metadata| {
            serde_json::from_value::<crate::models::message::GenerationMetadata>(metadata.clone())
                .ok()
        })
        .is_some_and(|metadata| metadata.continuation_in_flight == Some(true))
}

/// Claim this message for the continuation that is about to run, so a retry
/// after a crash can tell "the answer was never written" from "the answer is
/// already on the row".
///
/// Written before the decisions are: a crash between the two must leave the
/// turn retryable, and the decisions are what make the open set empty.
async fn mark_continuation_in_flight(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    message: &messages::Model,
) -> Result<(), Report> {
    let mut metadata = message
        .generation_metadata
        .as_ref()
        .and_then(|metadata| {
            serde_json::from_value::<crate::models::message::GenerationMetadata>(metadata.clone())
                .ok()
        })
        .unwrap_or_default();
    metadata.continuation_in_flight = Some(true);
    update_message_generation_metadata(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &message.id,
        metadata,
    )
    .await?;
    Ok(())
}

/// The origin turn that is currently asking this child's question, if any.
///
/// Re-read rather than trusted from the link alone: `parent_message_id` is
/// written once at dispatch and the origin moves on without it — the approval
/// is settled or withdrawn, the chat is archived, the whole row is deleted —
/// while the child keeps pointing at it. A link taken on faith would leave a
/// parked chat answerable from neither side.
async fn origin_approval_covering_child(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    chat: &chats::Model,
) -> Option<Uuid> {
    let parent_message_id = crate::models::chat::parse_chat_configuration(chat)
        .ok()
        .flatten()
        .and_then(|configuration| configuration.provenance)
        .filter(|provenance| provenance.kind == crate::models::chat::ChatProvenanceKind::Delegation)
        .and_then(|provenance| provenance.parent_message_id)?;
    let subject = me_user.to_subject();
    // A deleted or foreign origin fails this read, which is the answer: there
    // is nobody left to ask on the child's behalf.
    let parent = get_message_by_id(&app_state.db, policy, &subject, &parent_message_id)
        .await
        .ok()?;
    let origin_chat = get_chat_by_message_id(&app_state.db, policy, &subject, &parent_message_id)
        .await
        .ok()?;
    if origin_chat.archived_at.is_some() {
        return None;
    }
    let open =
        parked_approval_state(&MessageSchema::validate(&parent.raw_message).ok()?.content)?.open;
    open.iter()
        .any(|item| {
            item.child
                .as_ref()
                .is_some_and(|child| child.child_chat_id == chat.id)
        })
        .then_some(parent_message_id)
}

fn already_continued() -> StreamRouteError {
    StreamRouteError::AlreadyContinued(Box::new(AlreadyContinuedError {
        code: ALREADY_CONTINUED_CODE.to_string(),
    }))
}

/// Every open approval paired with the decision submitted for it, in the row's
/// order.
type SubmittedDecisions = Vec<(String, ToolApprovalDecision)>;

/// Pair every approval a parked turn has open with the decision submitted for
/// it, refusing any body that does not answer the turn exactly.
///
/// Returned in the row's order, not the body's: the continuation settles the
/// resolved slots, and those follow the order the model made the calls in.
fn resolve_submitted_decisions(
    request: &ContinueStreamRequest,
    open: &[ApprovalItem],
) -> Result<SubmittedDecisions, StreamRouteError> {
    if !request.decisions.is_empty() && request.decision.is_some() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "Submit either `decisions` or the legacy `decision`, not both".to_string(),
        )
            .into());
    }

    if let Some(decision) = request.decision {
        let [only_open] = open else {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                format!(
                    "This generation has {} approvals open; submit `decisions` naming an `approval_id` for each",
                    open.len()
                ),
            )
                .into());
        };
        return Ok(vec![(only_open.approval_id.clone(), decision)]);
    }

    if request.decisions.is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "No approval decision submitted".to_string(),
        )
            .into());
    }

    let mut decided: HashMap<&str, ToolApprovalDecision> = HashMap::new();
    let mut unknown: Vec<String> = Vec::new();
    for item in &request.decisions {
        let is_open = open
            .iter()
            .any(|approval| approval.approval_id == item.approval_id);
        if !is_open {
            if !unknown.contains(&item.approval_id) {
                unknown.push(item.approval_id.clone());
            }
            continue;
        }
        // Two answers for one question is a client bug, and picking either one
        // would hide it behind a tool call the user may not have wanted.
        if decided
            .insert(item.approval_id.as_str(), item.decision)
            .is_some()
        {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                format!("Approval '{}' was decided twice", item.approval_id),
            )
                .into());
        }
    }

    let missing: Vec<String> = open
        .iter()
        .filter(|approval| !decided.contains_key(approval.approval_id.as_str()))
        .map(|approval| approval.approval_id.clone())
        .collect();
    if !missing.is_empty() || !unknown.is_empty() {
        return Err(StreamRouteError::DecisionsMismatch(Box::new(
            ApprovalDecisionsError {
                code: DECISIONS_MISMATCH_CODE.to_string(),
                missing,
                unknown,
            },
        )));
    }

    Ok(open
        .iter()
        .map(|approval| {
            (
                approval.approval_id.clone(),
                decided[approval.approval_id.as_str()],
            )
        })
        .collect())
}
#[utoipa::path(
    post,
    path = "/me/messages/continuestream",
    request_body = ContinueStreamRequest,
    responses(
        (status = OK, content_type = "text/event-stream", body = MessageSubmitStreamingResponseMessage),
        (status = BAD_REQUEST, body = ApprovalDecisionsError, description = "The message has no pending approval, the decision is invalid, or the submitted decisions do not cover the open approvals (JSON, code = decisions_mismatch)"),
        (status = NOT_FOUND, description = "When the chat does not exist or is not accessible"),
        (status = CONFLICT, body = GenerationRunningError, description = "When the chat is archived (plain text), the chat's generation lease is already held and delegation.tasks.enabled is on (JSON, code = generation_running), every approval the row opened is already decided (JSON, code = already_continued, body = AlreadyContinuedError), or the chat that dispatched this delegated run is still asking the same question (JSON, code = covered_by_parent, body = CoveredByParentError)"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "When an internal server error occurs")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn continue_message_sse(
    State(app_state): State<AppState>,
    Extension(policy): Extension<PolicyEngine>,
    Extension(me_user): Extension<MeProfile>,
    Json(request): Json<ContinueStreamRequest>,
) -> Result<Sse<SseEventStreamWithKeepAlive>, StreamRouteError> {
    let mcp = app_state.mcp_state().await;
    // Check ownership and fail before opening an SSE response. The worker reads
    // the message again so the approval transition is based on current state.
    let message = get_message_by_id(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &request.message_id,
    )
    .await
    .map_err(|error| (axum::http::StatusCode::NOT_FOUND, error.to_string()))?;
    let parsed = MessageSchema::validate(&message.raw_message)
        .map_err(|error| (axum::http::StatusCode::BAD_REQUEST, error.to_string()))?;
    // The message load above authorized reads on this chat, so a missing or
    // foreign chat has already 404'd and only a database fault reaches here.
    // Read before the approval guard, because the guard needs the generation
    // state to tell a crashed continuation from a finished one.
    let chat = get_chat_by_message_id(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &request.message_id,
    )
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to load chat for the approval decision: {}", e),
        )
    })?;
    reject_if_archived(&chat)?;
    // While the chat that dispatched this run is asking the same question, its
    // card is the only one that can act on the answer: it holds the slot the
    // child's result is owed to. Two live cards would let one approval be
    // decided twice, and only one of the two decisions would reach the turn
    // that is waiting.
    if let Some(parent_message_id) =
        origin_approval_covering_child(&app_state, &policy, &me_user, &chat).await
    {
        return Err(StreamRouteError::CoveredByParent(Box::new(
            CoveredByParentError {
                code: COVERED_BY_PARENT_CODE.to_string(),
                parent_message_id,
            },
        )));
    }
    let Some(state) = parked_approval_state(&parsed.content) else {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "Message generation is not awaiting tool approval".to_string(),
        )
            .into());
    };
    let entry = if state.open.is_empty() {
        // Only a continuation that died before the model answered may run
        // again, and `chats.generation_state` alone cannot say which those are:
        // it is written by every generation on the chat, so a later turn that
        // failed would otherwise reopen a settled row and append a second
        // answer to a message that already has one. Either the row shows no
        // answer or the message still carries a continuation's claim on it.
        let crashed = (state.unanswered || continuation_owes_an_answer(&message))
            && chat.generation_state.as_deref() == Some("errored");
        if !crashed {
            return Err(already_continued());
        }
        ContinuationEntry::ResumeCrashed
    } else {
        // Validated here as well as in the worker: a body that does not answer
        // the turn should be an HTTP status, not a stream that opens and dies.
        let submitted_decisions = resolve_submitted_decisions(&request, &state.open)?;
        if submitted_decisions
            .iter()
            .any(|(_, decision)| matches!(decision, ToolApprovalDecision::ApproveAlways))
            && !mcp.config.mcp_servers_global.approval.allow_always
        {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                "Always allow is disabled by MCP approval policy".to_string(),
            )
                .into());
        }
        ContinuationEntry::Decide
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Report>>(100);
    let app_state_for_worker = app_state.clone();
    let policy_for_worker = policy.clone();
    let chat_id = message.chat_id;

    // The decision starts a new generation on the chat's lease: the state
    // leaves 'awaiting_approval' for 'running' here, and the outcome parks it
    // again when the continuation stops on a chained approval.
    //
    // Taken BEFORE the spawn, so a refusal is still an HTTP status rather than
    // a stream that opens and dies. It has to be taken at all because the
    // exemption this path used to rely on — "the continuation resumes the
    // parked generation instead of starting a second one" — stops being true
    // once a user write can take a parked lease: the card can still be mounted
    // while another turn already owns the chat.
    let (_abort_rx, task) =
        acquire_user_generation_lease(&app_state, chat_id, request.message_id).await?;

    tokio::spawn(async move {
        let mut cleanup_guard = TaskCleanupGuard::new(
            app_state_for_worker.background_tasks.clone(),
            chat_id,
            task.generation_id,
        );
        let result = run_continuation(
            &task,
            Some(tx.clone()),
            &app_state_for_worker,
            &policy_for_worker,
            &me_user,
            request,
            entry,
        )
        .await;
        let generation_failed = result.is_err();
        if let Err(error) = result {
            log_and_capture_error("continue message background task", &error);
            forward_error_report(&tx, &error).await;
        }
        let outcome = task.derive_outcome(generation_failed);
        task.mark_completed();
        cleanup_guard.disarm();
        app_state_for_worker
            .background_tasks
            .remove_task(&chat_id, task.generation_id, outcome)
            .await;

        settle_tail_deliveries(
            &app_state_for_worker,
            &policy_for_worker,
            &me_user,
            chat_id,
            &task,
            outcome,
        )
        .await;
    });

    let stream: SseEventStream = Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx));
    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    ))
}

/// Seeding a parked turn's abandoned calls through the tool-dispatch loop rather
/// than beside it is what makes them obey the same filtered tool set, approval
/// gate and budgets as any other call.
pub(crate) struct ParkedTurnResume {
    pub initial_unfinished_tool_calls: Vec<genai::chat::ToolCall>,
    /// Task calls the user has just approved on a `task_plan` card. The
    /// dispatch-approval pre-pass skips them, or the decision the user made
    /// would be asked for again the moment the turn resumes.
    pub approved_task_call_ids: HashSet<String>,
}

/// How a continuation reached the worker, decided before the generation lease
/// was taken.
///
/// A row with nothing open reaches neither variant unless its turn never
/// answered: a duplicate resume is answered `409 already_continued`, a conflict
/// rather than a malformed body, because neither the row nor the body is wrong
/// and a client that retried a request it never saw the answer to has to tell
/// that apart from a decision the server refused.
///
/// The worker cannot re-derive this: taking the lease rewrites
/// `chats.generation_state` to `running`, so by the time the row is read again
/// the fingerprint of the crashed predecessor is gone. Carrying the entry
/// decision through is what lets the worker refuse a continuation whose
/// predecessor settled the approvals, or answered the turn, while it was
/// queued. Two continuations that start together are not ordered by it — only
/// the chat's generation lease can do that, and it only does while
/// `delegation.tasks.enabled` makes it a compare-and-set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ContinuationEntry {
    /// The caller found approvals open and is submitting decisions for them.
    Decide,
    /// The caller found every approval already decided on a generation that had
    /// been swept to `errored`: the outcomes are on the row and the only thing
    /// missing is the model call.
    ResumeCrashed,
}

/// The `Sender` a continuation with no SSE client of its own writes to.
///
/// Drained for its whole life rather than dropped: the channel is bounded, so a
/// sink nobody reads would stall the generation as soon as it had emitted a
/// channel's worth of events.
fn detached_generation_event_sink() -> Sender<Result<Event, Report>> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<Event, Report>>(100);
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let Err(error) = event {
                log_and_capture_error("in-process continuation SSE bridge", &error);
            }
        }
    });
    tx
}

/// Raising it would abandon the row half-settled (see `run_continuation`).
/// Losing the preference is the smaller harm, and the part written for this
/// item says truthfully that nothing was stored.
async fn store_standing_tool_decision(
    app_state: &AppState,
    user_id: Uuid,
    server_id: &str,
    tool_name: &str,
    decision: crate::models::user_tool_approval_setting::UserToolDecision,
) -> Option<crate::db::entity::user_tool_approval_settings::Model> {
    match crate::models::user_tool_approval_setting::upsert_active(
        &app_state.db,
        user_id,
        server_id,
        tool_name,
        decision,
    )
    .await
    {
        Ok(setting) => Some(setting),
        Err(error) => {
            warn_and_capture_error("store standing tool decision from a continuation", &error);
            None
        }
    }
}

/// Run one parked child's continuation in-process, under the child's own lease.
///
/// Boxed for the same reason `run_delegated_child` is: this is
/// `run_continuation` reaching `run_continuation`, which would otherwise make
/// the future recursively sized and trip the worker-stack limit.
///
/// Wrapped in the shared generation lifecycle so the resumed run records its
/// own outcome on its own chat — including `awaiting_approval` when it stops a
/// second time, which is what makes the chained park answerable at all.
///
/// No `settle_tail_deliveries` here, unlike the tails a person's own request
/// ends on: this runs only for a child covered by an open approval part on the
/// origin turn, which is an awaited run that owns no `result_delivery` at all —
/// its answer goes back through the slot the origin turn is blocked on.
fn run_child_approval_continuation(
    app_state: AppState,
    policy: PolicyEngine,
    me_user: MeProfile,
    child_task: Arc<StreamingTask>,
    request: ContinueStreamRequest,
    child_chat_id: Uuid,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), Report>> + Send>> {
    Box::pin(async move {
        let run_timeout = Duration::from_secs(app_state.config.delegation.run_timeout_seconds);
        with_generation_task_lifecycle(
            &app_state.background_tasks,
            &child_task,
            child_chat_id,
            async {
                let run = run_continuation(
                    &child_task,
                    None,
                    &app_state,
                    &policy,
                    &me_user,
                    request,
                    ContinuationEntry::Decide,
                );
                tokio::pin!(run);
                tokio::select! {
                    result = &mut run => result,
                    // The same bound an awaited run gets, for the same reason:
                    // the origin turn is blocked on this, and the abort is
                    // cooperative so the run is still awaited to completion —
                    // that wind-down is what persists the partial answer.
                    _ = tokio::time::sleep(run_timeout) => {
                        tracing::info!(%child_chat_id, "Resumed child run hit its deadline; aborting");
                        child_task.request_abort();
                        run.await
                    }
                }
            },
        )
        .await
    })
}

/// Resume one child the user has decided about, and read the result its origin
/// slot is owed.
///
/// A decision is applied to whatever the child still has open rather than to
/// the id the parent's card recorded: the child's own row is the executable
/// truth, and a card can name a request its owner has since answered from the
/// child's own chat. Nothing open means there is nothing to run — the answer,
/// if there is one, is already on the row.
async fn resume_parked_child(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    child: &crate::models::message::ChildApprovalRef,
    parent_tool_call_id: String,
    decision: ToolApprovalDecision,
) -> Result<crate::services::delegation::DelegationResultEnvelope, String> {
    use sea_orm::EntityTrait;

    let child_chat = crate::db::entity::chats::Entity::find_by_id(child.child_chat_id)
        .one(&app_state.db)
        .await
        .map_err(|error| {
            warn_and_capture_error("read a parked child's chat", &eyre!(error.to_string()));
            "The delegated run could not be read.".to_string()
        })?
        .ok_or_else(|| "The delegated run no longer exists.".to_string())?;
    // The parent's card is a copy, so the ownership check cannot be inherited
    // from it: a row naming someone else's chat must not start a generation.
    if child_chat.owner_user_id != me_user.id {
        return Err("The delegated run belongs to another user.".to_string());
    }
    let configuration = crate::models::chat::parse_chat_configuration(&child_chat)
        .ok()
        .flatten();
    let spawned_at = configuration
        .as_ref()
        .and_then(|configuration| configuration.provenance.as_ref())
        .and_then(|provenance| provenance.rebase_cutoff)
        .unwrap_or(child_chat.created_at);

    let child_message = crate::db::entity::messages::Entity::find_by_id(child.child_message_id)
        .one(&app_state.db)
        .await
        .map_err(|error| {
            warn_and_capture_error("read a parked child's row", &eyre!(error.to_string()));
            "The delegated run's answer could not be read.".to_string()
        })?
        .filter(|row| row.chat_id == child.child_chat_id)
        .ok_or_else(|| "The delegated run's answer no longer exists.".to_string())?;
    let open = MessageSchema::validate(&child_message.raw_message)
        .ok()
        .and_then(|parsed| parked_approval_state(&parsed.content))
        .map(|state| state.open)
        .unwrap_or_default();

    let mut status = crate::services::delegation::DelegationRunStatus::Completed;
    let mut hit_tool_budget = false;
    if !open.is_empty() {
        let (_child_rx, child_task) = app_state
            .background_tasks
            .try_start_task(
                child.child_chat_id,
                child.child_message_id,
                // The park this resumes IS the parked lease, so claiming it is
                // the whole point rather than a takeover of someone's work.
                Takeover::TakeParked,
                app_state.config.generation_status.stale_after_secs,
            )
            .await
            .map_err(|_| "The delegated run is busy; try again once it is idle.".to_string())?;
        let request = ContinueStreamRequest {
            message_id: child.child_message_id,
            decisions: open
                .iter()
                .map(|item| ApprovalDecisionItem {
                    approval_id: item.approval_id.clone(),
                    decision,
                })
                .collect(),
            decision: None,
        };
        let resumed = run_child_approval_continuation(
            app_state.clone(),
            policy.clone(),
            me_user.clone(),
            child_task.clone(),
            request,
            child.child_chat_id,
        )
        .await;
        if resumed.is_err() {
            status = crate::services::delegation::DelegationRunStatus::Failed;
        }
        hit_tool_budget = child_task.tool_budget_exhausted();
    }

    Ok(crate::services::delegation::build_result_envelope(
        &app_state.db,
        child.child_chat_id,
        child.child_message_id,
        spawned_at,
        child_chat.assistant_id,
        // A task child speaks either as the origin's assistant or as the bare
        // model; neither is a delegate the origin model named, so there is no
        // name to report.
        None,
        parent_tool_call_id,
        status,
        None,
        hit_tool_budget,
        app_state.config.delegation.result_max_chars,
    )
    .await)
}

/// Overwrite the origin slot a resumed child owes, and tell the client.
///
/// Written in place rather than appended: the slot is the model's memory of the
/// call and the index every progress frame of the run addressed, so vacating it
/// would leave those frames pointing at another part. A child that parked again
/// keeps its `in_progress` status — the run is suspended, not over.
#[allow(clippy::too_many_arguments)]
async fn update_resumed_child_slot(
    content: &mut [ContentPart],
    tool_call_id: &str,
    output: JsonValue,
    still_parked: bool,
    failed: bool,
    message_id: Uuid,
    task: &Arc<StreamingTask>,
    tx: &Sender<Result<Event, Report>>,
) -> Result<(), Report> {
    let Some((index, part)) = content
        .iter_mut()
        .enumerate()
        .find_map(|(index, part)| match part {
            ContentPart::ToolUse(part) if part.tool_call_id == tool_call_id => Some((index, part)),
            _ => None,
        })
    else {
        return Ok(());
    };
    let status = if still_parked {
        MessageToolCallStatus::InProgress
    } else if failed {
        MessageToolCallStatus::Error
    } else {
        MessageToolCallStatus::Success
    };
    part.status = status.clone();
    part.output = Some(output.clone());
    part.ended_at = (!still_parked).then(now_timestamp);
    let (wire_status, bg_status) = match status {
        MessageToolCallStatus::Success => (ToolCallStatus::Success, BgToolCallStatus::Success),
        MessageToolCallStatus::Error => (ToolCallStatus::Error, BgToolCallStatus::Error),
        _ => (ToolCallStatus::InProgress, BgToolCallStatus::InProgress),
    };
    let tool_name = part.tool_name.clone();
    let input = part.input.clone();
    send_background_event(
        task,
        StreamingEvent::ToolCallUpdate {
            message_id,
            content_index: index,
            tool_call_id: tool_call_id.to_string(),
            tool_name: tool_name.clone(),
            input: input.clone(),
            status: bg_status,
            progress_message: None,
            progress: None,
            total: None,
            output: Some(output.clone()),
        },
        "broadcast resumed delegated task slot",
    )
    .await;
    let event: MessageSubmitStreamingResponseMessage =
        MessageSubmitStreamingResponseToolCallUpdate {
            message_id,
            content_index: index,
            tool_call_id: tool_call_id.to_string(),
            tool_name,
            input,
            status: wire_status,
            progress_message: None,
            progress: None,
            total: None,
            output: Some(output),
        }
        .into();
    send_generation_event(&event, tx.clone()).await
}

/// Apply the user's decisions to the children a parked turn is waiting on.
///
/// Every item settles as it is decided, for the reason given on
/// `run_continuation`.
///
/// Returns the children that stopped a second time. Their slots stay open and
/// the caller carries their new requests up as one part, the way the batch did.
#[allow(clippy::too_many_arguments)]
async fn settle_parked_children(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    user_id: Uuid,
    task: &Arc<StreamingTask>,
    tx: &Sender<Result<Event, Report>>,
    message_id: Uuid,
    open: &[ApprovalItem],
    decisions: &[(String, ToolApprovalDecision)],
    content: &mut Vec<ContentPart>,
) -> Result<Vec<ParkedChild>, Report> {
    let mut reparked: Vec<ParkedChild> = Vec::new();
    for (approval_id, decision) in decisions {
        let decision = *decision;
        let Some(item) = open.iter().find(|item| &item.approval_id == approval_id) else {
            return Err(eyre!(
                "Approval '{approval_id}' is not open on this generation"
            ));
        };
        let child = item.child.clone();

        // The standing decision belongs to the CHILD's server and tool. The
        // parent's `delegate_task` is a synthetic name no grant can name, and
        // storing it would produce a setting no gate ever consults.
        let always_allow_setting = match child.as_ref() {
            Some(child) if matches!(decision, ToolApprovalDecision::ApproveAlways) => {
                store_standing_tool_decision(
                    app_state,
                    user_id,
                    &child.mcp_server_id,
                    &child.tool_name,
                    UserToolDecision::AlwaysAllow,
                )
                .await
            }
            _ => None,
        };
        let never_allow_setting = match child.as_ref() {
            Some(child) if matches!(decision, ToolApprovalDecision::RejectAlways) => {
                store_standing_tool_decision(
                    app_state,
                    user_id,
                    &child.mcp_server_id,
                    &child.tool_name,
                    UserToolDecision::Denied,
                )
                .await
            }
            _ => None,
        };

        if decision.is_approval() {
            content.push(ContentPart::ToolApproval(ContentPartToolApproval {
                tool_call_id: item.tool_call_id.clone(),
                always_allow: always_allow_setting.is_some(),
                user_tool_approval_setting_id: always_allow_setting
                    .as_ref()
                    .map(|setting| setting.id),
                approved_at: now_timestamp(),
                approval_id: Some(item.approval_id.clone()),
                child_chat_id: child.as_ref().map(|child| child.child_chat_id),
            }));
        } else {
            content.push(ContentPart::ToolRejection(ContentPartToolRejection {
                tool_call_id: item.tool_call_id.clone(),
                never_allow: never_allow_setting.is_some(),
                user_tool_approval_setting_id: never_allow_setting
                    .as_ref()
                    .map(|setting| setting.id),
                rejected_at: now_timestamp(),
                approval_id: Some(item.approval_id.clone()),
                child_chat_id: child.as_ref().map(|child| child.child_chat_id),
                reason: matches!(decision, ToolApprovalDecision::Withdraw)
                    .then(|| REJECTION_REASON_WITHDRAWN.to_string()),
            }));
        }

        let parked_output = content.iter().find_map(|part| match part {
            ContentPart::ToolUse(part) if part.tool_call_id == item.tool_call_id => {
                part.output.clone()
            }
            _ => None,
        });
        let resumed = match child.as_ref() {
            Some(child) => {
                resume_parked_child(
                    app_state,
                    policy,
                    me_user,
                    child,
                    item.tool_call_id.clone(),
                    decision,
                )
                .await
            }
            // A `delegated_task` item with no child names nothing to resume.
            // Settling it as a failure is the only answer that leaves the row
            // consistent; raising would strand the items after it.
            None => Err("The delegated run this decision covers was not recorded.".to_string()),
        };
        let (output, still_parked, failed) = match resumed {
            Ok(envelope) => {
                let still_parked = envelope.status
                    == crate::services::delegation::DelegationRunStatus::InputRequired;
                let failed =
                    envelope.status != crate::services::delegation::DelegationRunStatus::Completed;
                (
                    crate::services::delegation::resumed_slot_output(
                        &envelope,
                        parked_output.as_ref(),
                    ),
                    still_parked,
                    failed,
                )
            }
            Err(error) => (json!({ "status": "failed", "error": error }), false, true),
        };
        if still_parked
            && let Some(child) = child.as_ref()
            && let Some(request) = crate::services::delegation::read_child_approval_request(
                &app_state.db,
                child.child_chat_id,
                child.child_message_id,
            )
            .await
        {
            reparked.push(ParkedChild {
                tool_call: genai::chat::ToolCall {
                    call_id: item.tool_call_id.clone(),
                    fn_name: item.tool_name.clone(),
                    fn_arguments: item.input.clone(),
                    thought_signatures: None,
                },
                child_chat_id: child.child_chat_id,
                child_message_id: child.child_message_id,
                request,
            });
        }
        // A client that has gone away must not stop the loop: the items before
        // this one are already settled on the row, and one left open among them
        // is one nobody can answer any more.
        if let Err(error) = update_resumed_child_slot(
            content,
            &item.tool_call_id,
            output,
            still_parked,
            failed,
            message_id,
            task,
            tx,
        )
        .await
        {
            warn_and_capture_error("announce a resumed delegated task slot", &error);
        }

        // Per item, not once after the loop: a child that has already run must
        // leave a record even if the next item fails, or its work happened on a
        // row that still reads as undecided.
        update_message_content(
            &app_state.db,
            policy,
            &me_user.to_subject(),
            &message_id,
            content.clone(),
        )
        .await?;
    }
    Ok(reparked)
}

/// Apply a user's approval decisions to a parked turn and finish it.
///
/// Takes no `Sender` of its own on purpose: a continuation may be started by an
/// HTTP client that wants the SSE stream, or in-process by a turn settling a
/// child's approval, which has no stream to write to. No caller in this release
/// takes the second arm, and the events it emits reach the chat only through the
/// streaming task's broadcast.
///
/// Every item settles, whatever happens to it, and its decision part is
/// persisted as it settles. Giving up midway would leave the row with some
/// items answered and the rest open, and a client resubmits the set it was
/// shown — which no longer matches the row, so the card cannot be answered
/// at all.
pub(crate) async fn run_continuation(
    task: &Arc<StreamingTask>,
    tx: Option<Sender<Result<Event, Report>>>,
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    request: ContinueStreamRequest,
    entry: ContinuationEntry,
) -> Result<(), Report> {
    let tx = tx.unwrap_or_else(detached_generation_event_sink);
    let mcp = app_state.mcp_state().await;
    let message = get_message_by_id(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &request.message_id,
    )
    .await?;
    let mut parsed = MessageSchema::validate(&message.raw_message)?;
    let Some(state) = parked_approval_state(&parsed.content) else {
        return Err(eyre!("Message generation is not awaiting tool approval"));
    };
    let approval_request = state.request;
    let chat = get_or_create_chat(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        Some(&message.chat_id),
        &me_user.id,
        None,
        None,
        None,
        None,
        None,
    )
    .await?
    .0;
    reject_if_archived(&chat).map_err(|(_, message)| eyre!(message))?;

    let user_id = Uuid::parse_str(&me_user.id)
        .map_err(|_| eyre!("MCP approvals require a UUID-backed user"))?;
    // Resolved again against the row as re-read here, so a body that raced
    // another continuation is refused on current state rather than on the state
    // the handler saw.
    let submitted_decisions = if state.open.is_empty() {
        // A crash retry is allowed to find nothing open — that is what it came
        // for. A continuation that was given decisions to apply is not: the
        // approvals were settled between the handler's read and this one, so
        // another continuation owns the model call and making a second one
        // would append a duplicate answer to the same row.
        if entry != ContinuationEntry::ResumeCrashed {
            return Err(eyre!(
                "Another continuation already settled this generation's approvals"
            ));
        }
        // The same admission test the handler applied, against the row as it is
        // now: a predecessor that finished in between has written the answer
        // this retry came to produce, and producing a second one would leave
        // the message with two.
        if !state.unanswered && !continuation_owes_an_answer(&message) {
            return Err(eyre!(
                "This generation has already produced its answer; nothing to resume"
            ));
        }
        Vec::new()
    } else {
        resolve_submitted_decisions(&request, &state.open).map_err(
            |error| match error {
                StreamRouteError::PlainText(_, message) => eyre!(message),
                StreamRouteError::DecisionsMismatch(body) => eyre!(
                    "The submitted decisions no longer match the open approvals (missing: {:?}, unknown: {:?})",
                    body.missing,
                    body.unknown
                ),
                _ => eyre!("The approval decision could not be applied"),
            },
        )?
    };

    mark_continuation_in_flight(app_state, policy, me_user, &message).await?;

    let generation_parameters: GenerationParameters = serde_json::from_value(
        message
            .generation_parameters
            .clone()
            .ok_or_else(|| eyre!("Interrupted message has no generation parameters"))?,
    )?;
    let mcp_auth_context = McpRequestAuthContext {
        app_state: Some(app_state),
        user_id: Some(user_id),
        oidc_token: Some(&me_user.oidc_token),
        access_token: me_user.access_token.as_deref(),
    };
    // Rebuild the tool set the parked turn was offered instead of trusting a
    // fresh, unfiltered discovery: the persisted parameters carry the facet
    // selection, the chat row carries the assistant, and the user's denials
    // are read now — so a denial stored while the approval was pending wins.
    // Discovery stays tolerant of unrelated servers being down; the strict
    // `list_tools` helper would turn those into a generation failure.
    let me_profile_input = MeProfileChatRequestInput::from_me_profile(me_user);
    let assistant_config = crate::models::chat::get_chat_assistant_configuration(
        &app_state.db,
        policy,
        &me_profile_input.subject,
        &chat,
    )
    .await?;
    let mut effective_selected_facet_ids: Vec<String> = generation_parameters
        .selected_facets
        .iter()
        .filter(|(_, selected)| **selected)
        .map(|(facet_id, _)| facet_id.clone())
        .collect();
    effective_selected_facet_ids.sort();
    let GenerationMcpToolSet {
        tools: available_mcp_tools,
        mcp_claimed_names: _,
        denied: denied_mcp_tools,
        write_suppressed: write_suppressed_mcp_tools,
        disabled_server_ids: mcp_servers_disabled_by_user,
        disabled_tools: mcp_tools_disabled_by_user,
        unavailable_server_ids: mcp_servers_unavailable,
        needing_auth_server_ids: mcp_servers_needing_auth,
        missing_credential_server_ids: mcp_servers_missing_credential,
    } = resolve_generation_mcp_tools(
        app_state,
        policy,
        &mcp,
        chat.id,
        GenerationMcpToolInputs {
            effective_selected_facet_ids: &effective_selected_facet_ids,
            action_facet_id: generation_parameters.action_facet_id.as_deref(),
            assistant_config: assistant_config.as_ref(),
            subject: &me_profile_input.subject,
            user_groups: me_profile_input.user_groups,
            user_id: Some(user_id),
            write_tools_enabled: chat.mcp_write_tools_enabled,
            disabled_server_ids: &chat.disabled_mcp_server_ids,
            disabled_tool_patterns: &chat.disabled_mcp_tools,
        },
        &mcp_auth_context,
    )
    .await?;

    // The two kinds share no settlement: an `mcp_tool` item names a tool this
    // process calls, a `delegated_task` item names a child whose own
    // continuation makes the call. Splitting the decisions here keeps each loop
    // reading only the items it can act on.
    let (mcp_decisions, child_decisions, plan_decisions): (
        SubmittedDecisions,
        SubmittedDecisions,
        SubmittedDecisions,
    ) = match approval_request.kind {
        ToolApprovalKind::McpTool => (submitted_decisions, Vec::new(), Vec::new()),
        ToolApprovalKind::DelegatedTask => (Vec::new(), submitted_decisions, Vec::new()),
        ToolApprovalKind::TaskPlan => (Vec::new(), Vec::new(), submitted_decisions),
    };

    // Why an approved call the rebuilt tool set no longer carries cannot run.
    // `None` is the one retryable answer: a denial is final whatever the
    // server's state, and so are the chat's write toggle and a server or tool
    // the user switched off, but a server that was merely unreachable — or that
    // this request carried no credential for — keeps the park as it was.
    let park_server_id = &approval_request.mcp_server_id;
    let refusal_for_unavailable_tool = |tool_name: &str| -> Option<String> {
        let excluded_pair = (park_server_id.clone(), tool_name.to_string());
        if denied_mcp_tools.contains(&excluded_pair) {
            Some(format!(
                "The user has disabled the tool '{}' in their settings; the call was not executed.",
                tool_name
            ))
        } else if write_suppressed_mcp_tools.contains(&excluded_pair) {
            Some(format!(
                "Write operations are turned off for this chat, so the tool '{}' is not available; the call was not executed.",
                tool_name
            ))
        } else if mcp_servers_disabled_by_user.contains(park_server_id) {
            Some(format!(
                "The user has turned off the server '{}' for this chat, so the tool '{}' is not available; the call was not executed.",
                park_server_id, tool_name
            ))
        } else if mcp_tool_matches_disabled_patterns(
            park_server_id,
            tool_name,
            &chat.disabled_mcp_tools,
        ) {
            Some(format!(
                "The user has turned off the tool '{}' for this chat; the call was not executed.",
                tool_name
            ))
        } else if mcp_servers_unavailable.contains(park_server_id)
            || mcp_servers_needing_auth.contains(park_server_id)
            || mcp_servers_missing_credential.contains(park_server_id)
        {
            None
        } else {
            Some(format!(
                "The tool '{}' is not available in this chat; the call was not executed.",
                tool_name
            ))
        }
    };

    // Decided before anything is written: the park only survives while the row
    // is still fully open (see `run_continuation`).
    if mcp_decisions.iter().any(|(approval_id, decision)| {
        decision.is_approval()
            && state.open.iter().any(|item| {
                &item.approval_id == approval_id
                    && !available_mcp_tools.iter().any(|tool| {
                        &tool.server_id == park_server_id && tool.tool.name == item.tool_name
                    })
                    && refusal_for_unavailable_tool(&item.tool_name).is_none()
            })
    }) {
        return Err(eyre!("Approved MCP tool is no longer available"));
    }

    // One `mcp_tool` park is one server, recorded on the request itself: the
    // gate stops the batch at the first gated call, so every item here shares
    // `approval_request.mcp_server_id`.
    for (approval_id, decision) in &mcp_decisions {
        let decision = *decision;
        let Some(item) = state
            .open
            .iter()
            .find(|item| &item.approval_id == approval_id)
        else {
            return Err(eyre!(
                "Approval '{approval_id}' is not open on this generation"
            ));
        };
        let server_id = approval_request.mcp_server_id.clone();
        let is_approved = decision.is_approval();
        let approved_tool = available_mcp_tools
            .iter()
            .find(|tool| tool.server_id == server_id && tool.tool.name == item.tool_name)
            .cloned();
        // A grant is only written for a call that actually runs: "always allow"
        // on a stale card must not overwrite a denial stored in the meantime.
        let always_allow_setting =
            if matches!(decision, ToolApprovalDecision::ApproveAlways) && approved_tool.is_some() {
                store_standing_tool_decision(
                    app_state,
                    user_id,
                    &server_id,
                    &item.tool_name,
                    crate::models::user_tool_approval_setting::UserToolDecision::AlwaysAllow,
                )
                .await
            } else {
                None
            };
        // Unconditional, unlike the grant above: a denial is worth storing even
        // for a call that can no longer run, and nothing it could overwrite is
        // more restrictive.
        let never_allow_setting = if matches!(decision, ToolApprovalDecision::RejectAlways) {
            store_standing_tool_decision(
                app_state,
                user_id,
                &server_id,
                &item.tool_name,
                crate::models::user_tool_approval_setting::UserToolDecision::Denied,
            )
            .await
        } else {
            None
        };

        if is_approved {
            parsed
                .content
                .push(ContentPart::ToolApproval(ContentPartToolApproval {
                    tool_call_id: item.tool_call_id.clone(),
                    always_allow: always_allow_setting.is_some(),
                    user_tool_approval_setting_id: always_allow_setting
                        .as_ref()
                        .map(|setting| setting.id),
                    approved_at: now_timestamp(),
                    approval_id: Some(item.approval_id.clone()),
                    child_chat_id: None,
                }));
        } else {
            parsed
                .content
                .push(ContentPart::ToolRejection(ContentPartToolRejection {
                    tool_call_id: item.tool_call_id.clone(),
                    never_allow: never_allow_setting.is_some(),
                    user_tool_approval_setting_id: never_allow_setting
                        .as_ref()
                        .map(|setting| setting.id),
                    rejected_at: now_timestamp(),
                    approval_id: Some(item.approval_id.clone()),
                    child_chat_id: None,
                    reason: matches!(decision, ToolApprovalDecision::Withdraw)
                        .then(|| REJECTION_REASON_WITHDRAWN.to_string()),
                }));
        }

        let tool_use = if !is_approved {
            ToolUse {
                tool_call_id: item.tool_call_id.clone(),
                status: MessageToolCallStatus::Error,
                tool_name: item.tool_name.clone(),
                input: Some(item.input.clone()),
                progress_message: None,
                progress: None,
                total: None,
                output: Some(
                    json!({"status": "rejected", "error": "The user denied this tool call."}),
                ),
                started_at: Some(now_timestamp()),
                ended_at: Some(now_timestamp()),
            }
        } else if let Some(managed_tool) = approved_tool {
            let call = genai::chat::ToolCall {
                call_id: item.tool_call_id.clone(),
                fn_name: item.tool_name.clone(),
                fn_arguments: item.input.clone(),
                thought_signatures: None,
            };
            let (progress_tx, progress_rx) = tokio::sync::mpsc::unbounded_channel();
            let call = mcp.servers.call_tool_with_progress(
                chat.id,
                crate::services::mcp_manager::ManagedToolCall {
                    server_id: managed_tool.server_id,
                    tool_call: call,
                    tool: managed_tool.tool,
                },
                &mcp_auth_context,
                Some(progress_tx),
            );
            let dispatched = await_mcp_tool_with_progress::<MessageSubmitStreamingResponseMessage>(
                call,
                progress_rx,
                MessageSubmitStreamingResponseToolCallUpdate {
                    message_id: message.id,
                    content_index: parsed.content.len(),
                    tool_call_id: item.tool_call_id.clone(),
                    tool_name: item.tool_name.clone(),
                    input: None,
                    status: ToolCallStatus::InProgress,
                    progress_message: None,
                    progress: None,
                    total: None,
                    output: None,
                },
                Some(task),
                tx.clone(),
            )
            .await
            .and_then(|result| serde_json::to_value(result).map_err(Report::from));
            // A call that failed, or that the user stopped, settles as an error like any
            // other, rather than abandoning the row half-settled (see `run_continuation`).
            match dispatched {
                Ok(output) => ToolUse {
                    tool_call_id: item.tool_call_id.clone(),
                    status: MessageToolCallStatus::Success,
                    tool_name: item.tool_name.clone(),
                    input: Some(item.input.clone()),
                    progress_message: None,
                    progress: None,
                    total: None,
                    output: Some(output),
                    started_at: Some(now_timestamp()),
                    ended_at: Some(now_timestamp()),
                },
                Err(error) => ToolUse {
                    tool_call_id: item.tool_call_id.clone(),
                    status: MessageToolCallStatus::Error,
                    tool_name: item.tool_name.clone(),
                    input: Some(item.input.clone()),
                    progress_message: None,
                    progress: None,
                    total: None,
                    output: Some(json!({
                        "status": "error",
                        "error": format!("Failed to call MCP tool: {error}"),
                    })),
                    started_at: Some(now_timestamp()),
                    ended_at: Some(now_timestamp()),
                },
            }
        } else {
            // A server that dropped out between the check above and this item is
            // refused rather than bailed on: the items before it are already
            // settled on the row, and one left open among them is one nobody can
            // answer any more.
            let error_message =
                refusal_for_unavailable_tool(&item.tool_name).unwrap_or_else(|| {
                    format!(
                        "The server '{}' cannot be reached, so the tool '{}' was not called.",
                        server_id, item.tool_name
                    )
                });
            ToolUse {
                tool_call_id: item.tool_call_id.clone(),
                status: MessageToolCallStatus::Error,
                tool_name: item.tool_name.clone(),
                input: Some(item.input.clone()),
                progress_message: None,
                progress: None,
                total: None,
                output: Some(json!({ "status": "rejected", "error": error_message })),
                started_at: Some(now_timestamp()),
                ended_at: Some(now_timestamp()),
            }
        };

        // Announce the gated call's outcome before contacting the model: a
        // client that seeded the call as running (or a resume replaying this
        // history) sees its status and output while the answer streams. Mirrors
        // the terminal update the main loop emits after every tool it runs.
        let succeeded = matches!(tool_use.status, MessageToolCallStatus::Success);
        let update = MessageSubmitStreamingResponseToolCallUpdate {
            message_id: message.id,
            content_index: parsed.content.len(),
            tool_call_id: tool_use.tool_call_id.clone(),
            tool_name: tool_use.tool_name.clone(),
            input: tool_use.input.clone(),
            status: if succeeded {
                ToolCallStatus::Success
            } else {
                ToolCallStatus::Error
            },
            progress_message: None,
            progress: None,
            total: None,
            output: tool_use.output.clone(),
        };
        send_background_event(
            task,
            StreamingEvent::ToolCallUpdate {
                message_id: message.id,
                content_index: parsed.content.len(),
                tool_call_id: tool_use.tool_call_id.clone(),
                tool_name: tool_use.tool_name.clone(),
                input: tool_use.input.clone(),
                status: if succeeded {
                    BgToolCallStatus::Success
                } else {
                    BgToolCallStatus::Error
                },
                progress_message: None,
                progress: None,
                total: None,
                output: tool_use.output.clone(),
            },
            "broadcast continued MCP tool call",
        )
        .await;
        let event: MessageSubmitStreamingResponseMessage = update.into();
        send_generation_event(&event, tx.clone()).await?;
        parsed.content.push(ContentPart::ToolUse(tool_use));

        // Per item, not once after the loop: a tool that ran must leave a record
        // even if the next item bails, or its side effect happened on a row that
        // still reads as undecided.
        update_message_content(
            &app_state.db,
            policy,
            &me_user.to_subject(),
            &message.id,
            parsed.content.clone(),
        )
        .await?;
    }

    // A plan item names a call that was never made, so there is nothing to
    // resume and nothing to overwrite: an approved item is re-seeded into the
    // dispatch loop exactly as an abandoned call is, and a denied one settles as
    // the refusal the model reads instead of the task's result. No child exists
    // on either path yet — that is what asking before dispatch bought.
    let mut approved_plan_calls: Vec<crate::models::message::PendingToolCall> = Vec::new();
    for (approval_id, decision) in &plan_decisions {
        let decision = *decision;
        let Some(item) = state
            .open
            .iter()
            .find(|item| &item.approval_id == approval_id)
        else {
            return Err(eyre!(
                "Approval '{approval_id}' is not open on this generation"
            ));
        };
        if decision.is_approval() {
            parsed
                .content
                .push(ContentPart::ToolApproval(ContentPartToolApproval {
                    tool_call_id: item.tool_call_id.clone(),
                    // No standing grant for a plan: `[delegation.tasks.approval]`
                    // decides what may be dispatched unasked, not a per-user
                    // setting.
                    always_allow: false,
                    user_tool_approval_setting_id: None,
                    approved_at: now_timestamp(),
                    approval_id: Some(item.approval_id.clone()),
                    child_chat_id: None,
                }));
            approved_plan_calls.push(crate::models::message::PendingToolCall {
                call_id: item.tool_call_id.clone(),
                fn_name: item.tool_name.clone(),
                fn_arguments: item.input.clone(),
            });
            continue;
        }
        parsed
            .content
            .push(ContentPart::ToolRejection(ContentPartToolRejection {
                tool_call_id: item.tool_call_id.clone(),
                never_allow: false,
                user_tool_approval_setting_id: None,
                rejected_at: now_timestamp(),
                approval_id: Some(item.approval_id.clone()),
                child_chat_id: None,
                reason: matches!(decision, ToolApprovalDecision::Withdraw)
                    .then(|| REJECTION_REASON_WITHDRAWN.to_string()),
            }));
        let tool_use = ToolUse {
            tool_call_id: item.tool_call_id.clone(),
            status: MessageToolCallStatus::Error,
            tool_name: item.tool_name.clone(),
            input: Some(item.input.clone()),
            progress_message: None,
            progress: None,
            total: None,
            // A plan denial carries no `reason`: the closed envelope vocabulary
            // has none for it, and "the user said no" is not a run outcome.
            output: Some(json!({
                "status": "rejected",
                "error": "The user declined this task.",
            })),
            started_at: Some(now_timestamp()),
            ended_at: Some(now_timestamp()),
        };
        let update = MessageSubmitStreamingResponseToolCallUpdate {
            message_id: message.id,
            content_index: parsed.content.len(),
            tool_call_id: tool_use.tool_call_id.clone(),
            tool_name: tool_use.tool_name.clone(),
            input: tool_use.input.clone(),
            status: ToolCallStatus::Error,
            progress_message: None,
            progress: None,
            total: None,
            output: tool_use.output.clone(),
        };
        send_background_event(
            task,
            StreamingEvent::ToolCallUpdate {
                message_id: message.id,
                content_index: parsed.content.len(),
                tool_call_id: tool_use.tool_call_id.clone(),
                tool_name: tool_use.tool_name.clone(),
                input: tool_use.input.clone(),
                status: BgToolCallStatus::Error,
                progress_message: None,
                progress: None,
                total: None,
                output: tool_use.output.clone(),
            },
            "broadcast declined task plan item",
        )
        .await;
        let event: MessageSubmitStreamingResponseMessage = update.into();
        send_generation_event(&event, tx.clone()).await?;
        parsed.content.push(ContentPart::ToolUse(tool_use));
    }
    if !plan_decisions.is_empty() {
        update_message_content(
            &app_state.db,
            policy,
            &me_user.to_subject(),
            &message.id,
            parsed.content.clone(),
        )
        .await?;
    }

    let reparked_children = if child_decisions.is_empty() {
        Vec::new()
    } else {
        settle_parked_children(
            app_state,
            policy,
            me_user,
            user_id,
            task,
            &tx,
            message.id,
            &state.open,
            &child_decisions,
            &mut parsed.content,
        )
        .await?
    };

    // A child that stopped a second time re-parks the turn waiting on it: one
    // new part of the same shape, and no model call — this turn has learnt
    // nothing yet that it could answer with.
    if !reparked_children.is_empty() {
        let settled_call_ids: HashSet<&str> = parsed
            .content
            .iter()
            .filter_map(|part| match part {
                ContentPart::ToolUse(tool_use) => Some(tool_use.tool_call_id.as_str()),
                _ => None,
            })
            .collect();
        let pending_tool_calls = approval_request
            .pending_tool_calls
            .iter()
            .filter(|call| !settled_call_ids.contains(call.call_id.as_str()))
            .cloned()
            .collect();
        parsed.content.push(ContentPart::ToolApprovalRequest(
            delegated_task_approval_part(
                &reparked_children,
                pending_tool_calls,
                mcp.config.mcp_servers_global.approval.allow_always,
            ),
        ));
        // Released here too, not only on the ordinary tail: the claim is what
        // readmits a crashed continuation, and a row left carrying it would be
        // resumed by the retry path instead of answered by the card it just
        // grew.
        let mut parked_metadata = message
            .generation_metadata
            .as_ref()
            .and_then(|metadata| {
                serde_json::from_value::<GenerationMetadata>(metadata.clone()).ok()
            })
            .unwrap_or_default();
        parked_metadata.continuation_in_flight = None;
        update_message_generation_metadata(
            &app_state.db,
            policy,
            &me_user.to_subject(),
            &message.id,
            parked_metadata,
        )
        .await?;
        return stream_update_assistant_message_completion::<MessageSubmitStreamingResponseMessage>(
            tx,
            task,
            app_state,
            policy,
            parsed.content,
            me_user,
            message.id,
        )
        .await;
    }

    let generation_input_messages: GenerationInputMessages = serde_json::from_value(
        message
            .generation_input_messages
            .clone()
            .ok_or_else(|| eyre!("Interrupted message has no generation input"))?,
    )?;
    let chat_provider_id = generation_parameters
        .generation_chat_provider_id
        .ok_or_else(|| eyre!("Interrupted message has no chat provider"))?;
    let generation_input_messages = resolve_file_pointers_in_generation_input(
        app_state,
        generation_input_messages,
        me_user.access_token.as_deref(),
    )
    .await?;
    let generation_input_messages =
        resolve_directive_markers_in_generation_input(app_state, generation_input_messages);
    let mut chat_request = generation_input_messages.into_chat_request();
    let provider = app_state.config.get_chat_provider(&chat_provider_id);
    let mut continuation_tools =
        convert_mcp_tools_to_genai_tools(available_mcp_tools.clone(), false);

    // Re-offer the task tool to a continuation that was offered it. A model
    // that was planning sub-tasks when one of its calls hit the approval gate
    // has to be able to go on planning them; dropping the offer mid-turn makes
    // it abandon the plan and answer around it. Only the task route — the
    // mention offer is aimed at assistants named in the user's message and is
    // deliberately not replayed (`test_continued_turn_does_not_reoffer_the_delegation_tool`).
    let compat_omit_strict = crate::services::prompt_composition::build_model_settings_for_facets(
        &provider.model_settings,
        &app_state.config.facets,
        &effective_selected_facet_ids,
    )
    .compat_omit_strict;
    let client_tool_allowlist = effective_client_tool_allowlist(
        &app_state.config.facets,
        &app_state.config.action_facets,
        &effective_selected_facet_ids,
        generation_parameters.action_facet_id.as_deref(),
    );
    let is_delegated_run = crate::models::chat::chat_is_delegated_run(&chat);
    let mut task_offer_scope: Option<crate::services::delegation::TaskOfferScope> = None;
    let mut delegation_offered_file_ids: Vec<Uuid> = Vec::new();
    // No anchor row means nothing to hang a child's provenance on, so the offer
    // is withheld rather than made and then refused at dispatch.
    let origin_user_message_id = message.previous_message_id;
    // The same suppression the user path applies through `suppress_task_offer`:
    // a turn reacting to a delivered task result is deliberately not offered
    // the tool, and a park must not be the way it gets one.
    let reacts_to_task_result = generation_parameters.initiator
        == Some(crate::models::message::GenerationInitiator::TaskResult);
    if origin_user_message_id.is_some()
        && !reacts_to_task_result
        && synthetic_tool_offer_slot(
            erato_config::config::DELEGATE_TASK_TOOL_NAME,
            app_state.config.delegation.tasks.enabled,
            &client_tool_allowlist,
            &available_mcp_tools,
            is_delegated_run,
        )
    {
        let scope = resolve_task_offer_scope(
            app_state,
            policy,
            &me_profile_input.subject,
            me_profile_input.user_groups,
            &effective_selected_facet_ids,
        )
        .await?;
        delegation_offered_file_ids = crate::models::file_upload::get_chat_file_uploads(
            &app_state.db,
            policy,
            &me_profile_input.subject,
            &chat.id,
        )
        .await?
        .into_iter()
        .map(|file| file.id)
        .collect();
        continuation_tools.push(crate::services::delegation::build_delegate_task_tool(
            &scope,
            &delegation_offered_file_ids,
            compat_omit_strict,
        ));
        task_offer_scope = Some(scope);
    }

    let wait_tool_enabled = !available_mcp_tools.is_empty()
        && (mcp.config.mcp_servers_global.enable_wait
            || available_mcp_tools.iter().any(|managed_tool| {
                mcp.config
                    .mcp_servers
                    .get(&managed_tool.server_id)
                    .is_some_and(|config| is_tool_allowed_to_wait(&managed_tool.tool.name, config))
            }));
    if wait_tool_enabled
        && !available_mcp_tools
            .iter()
            .any(|tool| tool.tool.name == crate::services::mcp_wait::WAIT_TOOL_NAME)
    {
        continuation_tools.push(crate::services::mcp_wait::build_wait_tool(
            mcp.config.mcp_servers_global.max_wait_seconds,
            false,
        ));
    }
    chat_request.tools = (!continuation_tools.is_empty()).then_some(continuation_tools);
    let allowed_tool_names: HashSet<String> = chat_request
        .tools
        .as_ref()
        .map(|tools| tools.iter().map(|tool| tool.name.to_string()).collect())
        .unwrap_or_default();

    // A crash retry can find some of the abandoned calls already dispatched, and
    // their `ToolUse` on the row is the record of it: re-seeding one would run
    // the tool a second time and hand the provider two copies of the same call.
    let settled_call_ids: HashSet<String> = parsed
        .content
        .iter()
        .filter_map(|part| match part {
            ContentPart::ToolUse(tool_use) => Some(tool_use.tool_call_id.clone()),
            _ => None,
        })
        .collect();
    // An abandoned call is not necessarily on the park's server, so the reason
    // it cannot run is looked up by tool name across the exclusions rather than
    // scoped to one server the way the gated item's is.
    let refusal_for_abandoned_call = |tool_name: &str| -> String {
        if denied_mcp_tools
            .iter()
            .any(|(_, denied)| denied == tool_name)
        {
            format!(
                "The user has disabled the tool '{}' in their settings; the call was not executed.",
                tool_name
            )
        } else if write_suppressed_mcp_tools
            .iter()
            .any(|(_, suppressed)| suppressed == tool_name)
        {
            format!(
                "Write operations are turned off for this chat, so the tool '{}' is not available; the call was not executed.",
                tool_name
            )
        } else {
            format!(
                "The tool '{}' is not available in this chat; the call was not executed.",
                tool_name
            )
        }
    };
    // The abandoned calls are replayed through the dispatch loop, which fails
    // the whole turn on a call naming a tool it was not offered. A tool the user
    // denied, disabled or switched off while the card was waiting is exactly
    // that, so it is refused here instead — in the same shape the gated item
    // gets — and never seeded.
    //
    // An approved plan item is seeded through the very same path, and FIRST: the
    // items were recorded in call order, so re-seeding them at the head is what
    // makes the batch reach the model in the order it asked, and routing them
    // here rather than around the filter means a plan approved after the task
    // tool was withdrawn is refused instead of failing the turn.
    let mut pending_tool_calls: Vec<genai::chat::ToolCall> = Vec::new();
    // The gate must not ask about these a second time, so they are named for
    // the resumed turn's pre-pass; an entry is dropped again below if the call
    // turns out not to be runnable after all.
    let mut approved_task_call_ids: HashSet<String> = approved_plan_calls
        .iter()
        .map(|call| call.call_id.clone())
        .collect();
    for call in approved_plan_calls
        .iter()
        .chain(approval_request.pending_tool_calls.iter())
        .filter(|call| !settled_call_ids.contains(&call.call_id))
    {
        if allowed_tool_names.contains(&call.fn_name) {
            pending_tool_calls.push(genai::chat::ToolCall {
                call_id: call.call_id.clone(),
                fn_name: call.fn_name.clone(),
                fn_arguments: call.fn_arguments.clone(),
                thought_signatures: None,
            });
            continue;
        }
        approved_task_call_ids.remove(&call.call_id);
        parsed.content.push(ContentPart::ToolUse(ToolUse {
            tool_call_id: call.call_id.clone(),
            status: MessageToolCallStatus::Error,
            tool_name: call.fn_name.clone(),
            input: Some(call.fn_arguments.clone()),
            progress_message: None,
            progress: None,
            total: None,
            output: Some(json!({
                "status": "rejected",
                "error": refusal_for_abandoned_call(&call.fn_name),
            })),
            started_at: Some(now_timestamp()),
            ended_at: Some(now_timestamp()),
        }));
    }

    // After the refusals above, so they are part of what the model is shown, and
    // through the same derivation the history walk uses: a hand-built copy is
    // what used to drop the calls that ran before the gated one.
    chat_request.messages.extend(
        crate::services::prompt_composition::transforms::replay_assistant_content(
            &parsed.role,
            parsed.content.clone(),
        )
        .into_iter()
        .map(crate::models::message::InputMessage::into_chat_message),
    );

    if !pending_tool_calls.is_empty() {
        chat_request.messages.push(GenAiChatMessage {
            role: ChatRole::Assistant,
            content: MessageContent::from_tool_calls(pending_tool_calls.clone()),
            options: None,
        });
    }
    let resume = (!pending_tool_calls.is_empty()).then(|| ParkedTurnResume {
        initial_unfinished_tool_calls: pending_tool_calls,
        approved_task_call_ids,
    });

    let chat_options =
        build_chat_options_for_completion(&provider.model_settings, &provider.model_capabilities);
    let headers_context = ChatProviderHeadersContext::new(&me_user.id, &me_user.id_token_claims);
    let delegation = origin_user_message_id
        .filter(|_| task_offer_scope.is_some())
        .map(|origin_user_message_id| DelegationDispatchContext {
            me_user,
            // No mention targets: only the task route is re-offered, and a
            // `delegate_to_assistant` call would have nothing to validate
            // against.
            targets: &[],
            offered_file_ids: &delegation_offered_file_ids,
            origin_chat: &chat,
            origin_user_message_id,
            // Neither a request value nor the user row's: this field only
            // reaches `delegate_to_assistant` dispatch, which `targets: &[]`
            // above refuses before it is read. The task route takes its mode
            // from the tool call's own argument.
            run_mode: crate::services::delegation::resolve_delegation_run_mode(
                None,
                None,
                &app_state.config.delegation,
            ),
            background_dispatches: std::sync::atomic::AtomicUsize::new(0),
            task_scope: task_offer_scope,
            tasks_this_turn: std::sync::atomic::AtomicUsize::new(0),
        });
    let (end_content, generation_metadata) =
        stream_generate_chat_completion::<MessageSubmitStreamingResponseMessage>(
            tx.clone(),
            app_state,
            policy,
            &me_user.to_subject(),
            chat_request,
            LangfuseTraceEnrichment::default(),
            chat_options,
            message.id,
            me_user.id.clone(),
            chat.id,
            Some(&chat_provider_id),
            &me_user.groups,
            mcp_auth_context,
            mcp_servers_unavailable,
            mcp_servers_needing_auth,
            mcp_servers_disabled_by_user,
            mcp_tools_disabled_by_user,
            allowed_tool_names,
            available_mcp_tools,
            HashMap::new(),
            &headers_context,
            Some(task),
            chat.assistant_id,
            parsed.content,
            is_delegated_run,
            crate::services::delegation::child_may_park_on_approval(
                &chat,
                &app_state.config.delegation,
            ),
            delegation,
            // The budget is per generation, like the per-message cap it sits
            // beside: a continuation starts a fresh one. Documented, not
            // fixed — the same is already true of `max_tool_calls_per_message`.
            task_tool_budgets_for_chat(&chat),
            resume,
        )
        .await?;
    // Written even when the generation reported no metadata of its own, and
    // before the content: this is what releases the claim taken above, and a
    // claim left behind on an answered turn would readmit it to the crash
    // retry. The reverse order would be worse — a content write that failed
    // after the release leaves a row with neither an answer nor a way back.
    let mut completed_metadata = generation_metadata.unwrap_or_else(|| {
        message
            .generation_metadata
            .as_ref()
            .and_then(|metadata| {
                serde_json::from_value::<crate::models::message::GenerationMetadata>(
                    metadata.clone(),
                )
                .ok()
            })
            .unwrap_or_default()
    });
    completed_metadata.continuation_in_flight = None;
    update_message_generation_metadata(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &message.id,
        completed_metadata,
    )
    .await?;
    stream_update_assistant_message_completion::<MessageSubmitStreamingResponseMessage>(
        tx,
        task,
        app_state,
        policy,
        end_content,
        me_user,
        message.id,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/me/messages/resumestream",
    request_body = ResumeStreamRequest,
    responses(
        (status = OK, content_type="text/event-stream", body = MessageSubmitStreamingResponseMessage),
        (status = NOT_FOUND, description = "No active generation task found for this chat"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "When an internal server error occurs")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn resume_message_sse(
    State(app_state): State<AppState>,
    Extension(policy): Extension<PolicyEngine>,
    Extension(me_user): Extension<MeProfile>,
    Json(request): Json<ResumeStreamRequest>,
) -> Result<Sse<SseEventStreamWithKeepAlive>, (axum::http::StatusCode, String)> {
    // Verify user has access to this chat
    let _chat = get_or_create_chat(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        Some(&request.chat_id),
        &me_user.id,
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::FORBIDDEN,
            format!("Access denied to chat: {}", e),
        )
    })?
    .0;

    let event_stream: SseEventStream =
        if let Some(task) = app_state.background_tasks.get_task(&request.chat_id).await {
            // The owner pod can use its in-memory history and broadcast channel.
            let event_history = task.get_event_history().await;
            let broadcast_rx = task.subscribe();
            use futures::stream;
            let history_stream = stream::iter(event_history.into_iter().map(Ok::<_, eyre::Report>));
            let broadcast_stream = tokio_stream::wrappers::BroadcastStream::new(broadcast_rx);
            let live_stream = futures::StreamExt::filter_map(broadcast_stream, |result| {
                futures::future::ready(match result {
                    Ok(event) => Some(Ok(event)),
                    Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
                        tracing::warn!("Resume client lagged behind by {} events", n);
                        None
                    }
                })
            });
            streaming_events_to_sse(futures::StreamExt::chain(history_stream, live_stream))
        } else if let Some((generation_id, _message_id)) = app_state
            .background_tasks
            .get_shared_generation(&request.chat_id)
            .await
        {
            // A request routed to another pod tails the shared event log instead of
            // looking for a task in that pod's process-local map.
            streaming_events_to_sse(shared_generation_event_stream(
                app_state.background_tasks.clone(),
                generation_id,
            ))
        } else {
            return Err((
                axum::http::StatusCode::NOT_FOUND,
                "No active generation task found for this chat".to_string(),
            ));
        };

    Ok(Sse::new(event_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    ))
}

#[cfg(test)]
mod client_tool_result_request_tests {
    use super::ClientToolResultRequest;

    #[test]
    fn distinguishes_null_result_from_absent() {
        let base = serde_json::json!({
            "chat_id": "00000000-0000-0000-0000-000000000000",
            "message_id": "00000000-0000-0000-0000-000000000000",
            "tool_call_id": "c1",
        });

        // Absent `result` => None ("no result").
        let absent: ClientToolResultRequest = serde_json::from_value(base.clone()).unwrap();
        assert_eq!(absent.result, None);

        // Explicit JSON null => Some(Null), a valid result (the serde gotcha).
        let mut with_null = base.clone();
        with_null["result"] = serde_json::Value::Null;
        let with_null: ClientToolResultRequest = serde_json::from_value(with_null).unwrap();
        assert_eq!(with_null.result, Some(serde_json::Value::Null));

        // A concrete value round-trips.
        let mut with_value = base;
        with_value["result"] = serde_json::json!({ "slots": 3 });
        let with_value: ClientToolResultRequest = serde_json::from_value(with_value).unwrap();
        assert_eq!(with_value.result, Some(serde_json::json!({ "slots": 3 })));
    }
}

#[cfg(test)]
mod mcp_progress_event_tests {
    use super::*;

    #[tokio::test]
    async fn cancelling_running_chat_cleans_up_progress_registration() {
        let manager = crate::services::background_tasks::BackgroundTaskManager::new(
            None,
            Default::default(),
            None,
        );
        let message_id = Uuid::new_v4();
        let (mut events, task) = manager.start_task(Uuid::new_v4(), message_id).await;
        let handler = crate::services::mcp_transports::ProgressClientHandler::default();
        let token = rmcp::model::ProgressToken(rmcp::model::NumberOrString::Number(1));
        let (progress_tx, progress_rx) = tokio::sync::mpsc::unbounded_channel();
        let registration = handler.register(token.clone(), Some(progress_tx.clone()));
        let call = async move {
            let _registration = registration;
            progress_tx
                .send(rmcp::model::ProgressNotificationParam::new(token, 1.0))
                .unwrap();
            std::future::pending::<Result<rmcp::model::CallToolResult, Report>>().await
        };
        let (tx, _rx) = tokio::sync::mpsc::channel(8);
        let future = await_mcp_tool_with_progress::<MessageSubmitStreamingResponseMessage>(
            call,
            progress_rx,
            MessageSubmitStreamingResponseToolCallUpdate {
                message_id,
                content_index: 0,
                tool_call_id: "cancelled-call".into(),
                tool_name: "read_file".into(),
                input: None,
                status: ToolCallStatus::InProgress,
                progress_message: None,
                progress: None,
                total: None,
                output: None,
            },
            Some(&task),
            tx,
        );
        tokio::pin!(future);
        tokio::select! {
            event = events.recv() => { event.unwrap(); },
            _ = &mut future => panic!("call must still be running"),
        }
        assert!(handler.has_active_calls());
        task.request_abort();
        assert!(future.await.is_err());
        assert!(!handler.has_active_calls());
    }

    #[tokio::test]
    async fn progress_is_delivered_live_and_replayed_with_tool_identity() {
        let manager = crate::services::background_tasks::BackgroundTaskManager::new(
            None,
            Default::default(),
            None,
        );
        let message_id = Uuid::new_v4();
        let (mut events, task) = manager.start_task(Uuid::new_v4(), message_id).await;
        let (progress_tx, progress_rx) = tokio::sync::mpsc::unbounded_channel();
        let (sse_tx, mut sse_rx) = tokio::sync::mpsc::channel(8);
        let (ack_tx, mut ack_rx) = tokio::sync::mpsc::channel(1);
        let call = async move {
            for step in 1..=3 {
                progress_tx
                    .send(rmcp::model::ProgressNotificationParam::new(
                        rmcp::model::ProgressToken(rmcp::model::NumberOrString::Number(1)),
                        f64::from(step),
                    ))
                    .unwrap();
                // The result cannot complete until the consumer observes each update.
                ack_rx.recv().await.unwrap();
            }
            Ok(rmcp::model::CallToolResult::default())
        };
        let future = await_mcp_tool_with_progress::<MessageSubmitStreamingResponseMessage>(
            call,
            progress_rx,
            MessageSubmitStreamingResponseToolCallUpdate {
                message_id,
                content_index: 2,
                tool_call_id: "call-progress".into(),
                tool_name: "read_file".into(),
                input: None,
                status: ToolCallStatus::InProgress,
                progress_message: None,
                progress: None,
                total: None,
                output: None,
            },
            Some(&task),
            sse_tx,
        );
        tokio::pin!(future);
        for step in 1..=3 {
            let event = tokio::select! {
                event = events.recv() => event.unwrap(),
                result = &mut future => panic!("result preceded progress: {result:?}"),
            };
            let value = serde_json::to_value(&event).unwrap();
            assert_eq!(value["tool_call_id"], "call-progress");
            assert_eq!(value["message_id"], message_id.to_string());
            assert_eq!(value["content_index"], 2);
            assert_eq!(value["progress"], f64::from(step));
            assert_eq!(value["status"], "in_progress");
            assert!(sse_rx.try_recv().unwrap().is_ok());
            assert!(streaming_event_to_sse(&event).is_ok());
            ack_tx.send(()).await.unwrap();
        }
        assert!(future.await.is_ok());
        assert_eq!(task.get_event_history().await.len(), 3);
    }
}
