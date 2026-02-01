use crate::config::ExperimentalFacetsConfig;
use crate::db::entity::prelude::*;
use crate::db::entity_ext::{chats, messages};
use crate::models::chat::{
    ChatCreationStatus, get_chat_by_message_id, get_or_create_chat,
    get_or_create_chat_by_previous_message_id,
};
use crate::models::message::{
    ContentPart, ContentPartImage, ContentPartImageFilePointer, ContentPartText,
    GenerationErrorType, GenerationInputMessages, GenerationMetadata, GenerationParameters,
    MessageRole, MessageSchema, ToolCallStatus as MessageToolCallStatus, ToolUse,
    get_message_by_id, submit_message, update_message_generation_metadata,
};
use crate::policy::engine::PolicyEngine;
use crate::policy::types::Subject;
use crate::server::api::v1beta::ChatMessage;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::server::api::v1beta::message_streaming_file_extraction::post_process_mcp_tool_result;
use crate::services::background_tasks::{
    StreamingEvent, StreamingTask, ToolCallStatus as BgToolCallStatus,
};
use crate::services::genai::{build_chat_options_for_completion, build_chat_options_for_summary};
use crate::services::genai_langfuse::{
    TracedGenerationBuilder, create_trace_with_generation_from_chat, generate_langfuse_ids,
    generate_name_from_chat_request,
};
use crate::services::langfuse::TracingLangfuseClient;
use crate::services::mcp_manager::convert_mcp_tools_to_genai_tools;
use crate::services::prompt_composition::{
    AppStateFileResolver, AppStatePromptProvider, DatabaseMessageRepository,
    PromptCompositionUserInput, compose_prompt_messages,
};
use crate::services::prompt_composition::{
    build_mcp_tool_allowlist, build_model_settings_for_facets,
};
use crate::services::sentry::capture_report;
use crate::state::{AppState, ChatProviderConfigWithId};
use axum::extract::State;
use axum::response::Sse;
use axum::response::sse::Event;
use axum::{Extension, Json};
use eyre::{OptionExt, WrapErr};
use eyre::{Report, eyre};
use futures::Stream;
use genai::chat::{
    ChatMessage as GenAiChatMessage, ChatOptions, ChatRequest, ChatRole, ChatStreamEvent,
    MessageContent, StreamChunk, StreamEnd,
};
use sea_orm::EntityTrait;
use sea_orm::JsonValue;
use sea_orm::prelude::Uuid;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::sync::mpsc::Sender;
use tokio_stream::StreamExt as _;
use tracing;
use tracing::{Instrument, instrument};
use utoipa::ToSchema;

/// Input parameters extracted from MeProfile for chat request preparation.
/// This type acts as a safeguard to only expose the specific attributes
/// needed during chat generation, rather than passing the full MeProfile.
#[derive(Debug, Clone)]
pub struct MeProfileChatRequestInput<'a> {
    pub user_groups: &'a [String],
    pub organization_user_id: Option<&'a str>,
    pub organization_group_ids: &'a [String],
    pub access_token: Option<&'a str>,
    pub preferred_language: &'a str,
}

impl<'a> MeProfileChatRequestInput<'a> {
    /// Create a new MeProfileChatRequestInput from a MeProfile reference.
    pub fn from_me_profile(me_profile: &'a MeProfile) -> Self {
        Self {
            user_groups: &me_profile.groups,
            organization_user_id: me_profile.organization_user_id.as_deref(),
            organization_group_ids: &me_profile.organization_group_ids,
            access_token: me_profile.access_token.as_deref(),
            preferred_language: &me_profile.preferred_language,
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
pub struct MessageSubmitStreamingResponseToolCallProposed {
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
    InProgress,
    Success,
    Error,
}

#[derive(Serialize, ToSchema)]
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

    async fn send_event(&self, tx: Sender<Result<Event, Report>>) -> Result<(), ()> {
        match self.data_json() {
            Ok(json) => {
                tracing::trace!(
                    tag = self.tag(),
                    data_json = json.as_str(),
                    "Sending response event"
                );
                if let Err(err) = tx
                    .send(Ok(Event::default().event(self.tag()).data(json)))
                    .await
                {
                    let _ = tx
                        .send(Err(eyre!(
                            "Failed to send {tag} event: {}",
                            err,
                            tag = self.tag()
                        )))
                        .await;
                    return Err(());
                }
            }
            Err(err) => {
                let _ = tx
                    .send(Err(eyre!(
                        "Failed to serialize {tag} event: {}",
                        err,
                        tag = self.tag()
                    )))
                    .await;
                return Err(());
            }
        }
        Ok(())
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
    chat_provider_id: Option<String>,
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// Optional assistant ID to associate with the chat when creating a new chat.
    /// If provided with an existing_chat_id, this field is ignored.
    assistant_id: Option<Uuid>,
    /// IDs of facets selected by the user for this generation.
    #[serde(default)]
    selected_facet_ids: Vec<String>,
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
    #[serde(rename = "tool_call_proposed")]
    /// Sent when the LLM proposes a tool call to be part of the assistant message.
    ToolCallProposed(MessageSubmitStreamingResponseToolCallProposed),
    #[serde(rename = "tool_call_update")]
    /// Sent to update the status of a tool call execution by the backend.
    ToolCallUpdate(MessageSubmitStreamingResponseToolCallUpdate),
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
            Self::ToolCallProposed(_) => "tool_call_proposed",
            Self::ToolCallUpdate(_) => "tool_call_update",
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

impl From<MessageSubmitStreamingResponseToolCallProposed>
    for MessageSubmitStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseToolCallProposed) -> Self {
        MessageSubmitStreamingResponseMessage::ToolCallProposed(value)
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
    if let Some(code) = error_obj.get("code").and_then(|c| c.as_str())
        && code == "content_filter"
    {
        let error_message = error_obj
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Content was filtered by the provider's content policy");

        let filter_details = error_obj
            .get("innererror")
            .and_then(|ie| ie.get("content_filter_result"))
            .cloned();

        return Some(MessageSubmitStreamingResponseError {
            message_id: Some(message_id),
            error: GenerationErrorType::ContentFilter {
                error_description: error_message.to_string(),
                filter_details,
            },
        });
    }

    Some(MessageSubmitStreamingResponseError {
        message_id: Some(message_id),
        error: GenerationErrorType::ProviderError {
            error_description: error_obj
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Provider returned an error response")
                .to_string(),
            status_code,
        },
    })
}

/// Parse an error from the LLM streaming response and create an appropriate error type.
async fn parse_streaming_error(
    err: genai::Error,
    message_id: Uuid,
) -> MessageSubmitStreamingResponseError {
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

    MessageSubmitStreamingResponseError {
        message_id: Some(message_id),
        error: GenerationErrorType::InternalError {
            error_description: "An unexpected error occurred during generation".to_string(),
        },
    }
}

async fn fetch_non_streaming_error(
    app_state: &AppState,
    chat_request: ChatRequest,
    chat_options: &ChatOptions,
    message_id: Uuid,
    chat_provider_id: Option<&str>,
    user_groups: &[String],
) -> Option<MessageSubmitStreamingResponseError> {
    let client = app_state
        .genai_for_chatcompletion(chat_provider_id, user_groups)
        .ok()?;
    match client
        .exec_chat("PLACEHOLDER_MODEL", chat_request, Some(chat_options))
        .await
    {
        Err(err) => Some(parse_streaming_error(err, message_id).await),
        Ok(_) => None,
    }
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
            output,
        } => {
            let status_str = match status {
                BgToolCallStatus::InProgress => "in_progress",
                BgToolCallStatus::Success => "success",
                BgToolCallStatus::Error => "error",
            };
            let data = serde_json::to_string(&serde_json::json!({
                "message_type": "tool_call_update",
                "message_id": message_id.to_string(),
                "content_index": content_index,
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "input": input,
                "status": status_str,
                "progress_message": progress_message,
                "output": output
            }))?;
            ("tool_call_update", data)
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

#[derive(serde::Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct RegenerateMessageRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of the message that should have a replacement response generated.
    current_message_id: Uuid,
    #[schema(example = "primary")]
    /// The ID of the chat provider to use for generation. If not provided, will use the highest priority model for the user.
    chat_provider_id: Option<String>,
    /// IDs of facets selected by the user for this generation.
    #[serde(default)]
    selected_facet_ids: Vec<String>,
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
    #[serde(rename = "tool_call_proposed")]
    /// Sent when the LLM proposes a tool call to be part of the assistant message.
    ToolCallProposed(MessageSubmitStreamingResponseToolCallProposed),
    #[serde(rename = "tool_call_update")]
    /// Sent to update the status of a tool call execution by the backend.
    ToolCallUpdate(MessageSubmitStreamingResponseToolCallUpdate),
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
            Self::ToolCallProposed(_) => "tool_call_proposed",
            Self::ToolCallUpdate(_) => "tool_call_update",
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

impl From<MessageSubmitStreamingResponseToolCallProposed>
    for RegenerateMessageStreamingResponseMessage
{
    fn from(value: MessageSubmitStreamingResponseToolCallProposed) -> Self {
        RegenerateMessageStreamingResponseMessage::ToolCallProposed(value)
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
    chat_provider_id: Option<String>,
    /// IDs of facets selected by the user for this generation.
    #[serde(default)]
    selected_facet_ids: Vec<String>,
}

#[derive(serde::Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ResumeStreamRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of the chat to resume streaming for.
    chat_id: Uuid,
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
    #[serde(rename = "tool_call_proposed")]
    /// Sent when the LLM proposes a tool call to be part of the assistant message.
    ToolCallProposed(MessageSubmitStreamingResponseToolCallProposed),
    #[serde(rename = "tool_call_update")]
    /// Sent to update the status of a tool call execution by the backend.
    ToolCallUpdate(MessageSubmitStreamingResponseToolCallUpdate),
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
            Self::ToolCallProposed(_) => "tool_call_proposed",
            Self::ToolCallUpdate(_) => "tool_call_update",
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

impl From<MessageSubmitStreamingResponseToolCallProposed> for EditMessageStreamingResponseMessage {
    fn from(value: MessageSubmitStreamingResponseToolCallProposed) -> Self {
        EditMessageStreamingResponseMessage::ToolCallProposed(value)
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
) -> Result<messages::Model, String> {
    let user_message_json = json!({
        "role": "user",
        "content": vec![json!({
            "content_type": "text",
            "text": user_message.to_owned()})],
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
    )
    .await
    .map_err(|e| format!("Failed to submit user message: {}", e))?;

    let saved_user_message_wrapped = ChatMessage::from_model(saved_user_message.clone())
        .map_err(|e| format!("Failed to convert user message: {}", e))?;

    task.send_event(StreamingEvent::UserMessageSaved {
        message_id: saved_user_message.id,
        message: saved_user_message_wrapped,
    })
    .await?;

    Ok(saved_user_message)
}

/// Download and store a generated image from URL or base64 data
async fn download_and_store_generated_image(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &crate::policy::types::Subject,
    chat_id: &Uuid,
    binary: genai::chat::Binary,
) -> Result<(Uuid, String), Report> {
    use crate::models::file_upload::create_file_upload;

    // Download or decode the image
    let image_bytes = match binary.source {
        genai::chat::BinarySource::Url(url) => {
            // Download from URL
            let response = reqwest::get(&url)
                .await
                .wrap_err("Failed to download generated image")?;

            response
                .bytes()
                .await
                .wrap_err("Failed to read image bytes")?
                .to_vec()
        }
        genai::chat::BinarySource::Base64(base64_data) => {
            // Decode base64
            use base64::{Engine as _, engine::general_purpose};
            general_purpose::STANDARD
                .decode(base64_data.as_ref())
                .wrap_err("Failed to decode base64 image data")?
        }
    };

    // Generate a unique filename with timestamp
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("generated_image_{}.png", timestamp);

    // Get the default file storage provider (filters out integration providers like SharePoint)
    let file_storage_provider_id = app_state.default_file_storage_provider_id();
    let file_storage = app_state.default_file_storage_provider();

    // Store the image
    let file_storage_path = format!("generated_images/{}", filename);
    let mut writer = file_storage
        .upload_file_writer(&file_storage_path, Some("image/png"))
        .await
        .wrap_err("Failed to create writer for generated image")?;

    writer
        .write(image_bytes)
        .await
        .wrap_err("Failed to write generated image bytes")?;

    writer
        .close()
        .await
        .wrap_err("Failed to close generated image writer")?;

    // Create file_upload record
    let file_upload = create_file_upload(
        &app_state.db,
        policy,
        subject,
        chat_id,
        filename.clone(),
        file_storage_provider_id.clone(),
        file_storage_path.clone(),
    )
    .await?;

    // Generate presigned download URL
    let download_url = file_storage
        .generate_presigned_download_url(&file_storage_path, None)
        .await
        .wrap_err("Failed to generate download URL for generated image")?;

    Ok((file_upload.id, download_url))
}

/// Format an error message for files that cannot be retrieved
fn format_file_error_message(filename: &str, file_id: Uuid, is_parsing_error: bool) -> String {
    let mut content = String::new();
    content.push_str("File:\n");
    content.push_str(&format!("file name: {}\n", filename));
    content.push_str(&format!("file_id: erato_file_id:{}\n", file_id));

    if is_parsing_error {
        content.push_str(
            "No file contents available as the file was not parseable. This info should be returned to the user."
        );
    } else {
        content.push_str(
            "Unable to retrieve file contents due to an unknown error. Please contact support if this issue persists."
        );
    }

    content
}

/// Format successful file content with metadata header
fn format_successful_file_content(filename: &str, file_id: Uuid, text: &str) -> String {
    let mut content = String::new();
    content.push_str("File:\n");
    content.push_str(&format!("file name: {}\n", filename));
    content.push_str(&format!("file_id: erato_file_id:{}\n", file_id));
    content.push_str("File contents\n");
    content.push_str("---\n");
    content.push_str(text);
    content.push_str("\n---");

    content
}

/// Resolve TextFilePointer and ImageFilePointer content parts in generation input messages by extracting file contents JIT.
/// This prevents storing duplicate file contents in the database.
async fn resolve_file_pointers_in_generation_input(
    app_state: &AppState,
    generation_input_messages: GenerationInputMessages,
    access_token: Option<&str>,
) -> Result<GenerationInputMessages, Report> {
    use crate::services::file_storage::SharepointContext;

    // Build the context for Sharepoint (will be ignored by other providers)
    let sharepoint_ctx = access_token.map(|token| SharepointContext {
        access_token: token,
    });

    let mut resolved_messages = Vec::new();

    for input_message in generation_input_messages.messages {
        let resolved_content = match input_message.content {
            ContentPart::TextFilePointer(ref file_pointer) => {
                // Extract file content from the pointer JIT using cached version
                let file_upload_id = file_pointer.file_upload_id;
                let is_image_pointer = false;

                resolve_file_pointer(
                    app_state,
                    file_upload_id,
                    is_image_pointer,
                    sharepoint_ctx.as_ref(),
                )
                .await
            }
            ContentPart::ImageFilePointer(ref file_pointer) => {
                // Extract file content from the pointer JIT using cached version
                let file_upload_id = file_pointer.file_upload_id;
                let is_image_pointer = true;

                resolve_file_pointer(
                    app_state,
                    file_upload_id,
                    is_image_pointer,
                    sharepoint_ctx.as_ref(),
                )
                .await
            }
            // Pass through other content parts unchanged
            other => other,
        };

        resolved_messages.push(crate::models::message::InputMessage {
            role: input_message.role,
            content: resolved_content,
        });
    }

    Ok(GenerationInputMessages {
        messages: resolved_messages,
    })
}

/// Helper function to resolve a file pointer (text or image) to its actual content
async fn resolve_file_pointer(
    app_state: &AppState,
    file_upload_id: Uuid,
    is_image_pointer: bool,
    sharepoint_ctx: Option<&crate::services::file_storage::SharepointContext<'_>>,
) -> ContentPart {
    use crate::services::file_processing_cached::get_file_cached;

    // Get the file upload record - use entity directly since we're reading from generation_input_messages
    // which already went through authorization when it was created
    let file_upload_result = FileUploads::find_by_id(file_upload_id)
        .one(&app_state.db)
        .await;

    match file_upload_result {
        Ok(Some(file)) => {
            // Get the file storage provider
            let file_storage = app_state
                .file_storage_providers
                .get(&file.file_storage_provider_id);

            if let Some(file_storage) = file_storage {
                // Use unified get_file_cached
                match get_file_cached(
                    app_state,
                    &file_upload_id,
                    file_storage,
                    &file.file_storage_path,
                    &file.filename,
                    sharepoint_ctx,
                )
                .await
                {
                    Ok(file_contents) => {
                        // Route based on expected pointer type and actual content
                        match (&file_contents.content, is_image_pointer) {
                            (FileContent::Text(text), false) => {
                                // TextFilePointer → Text content (expected case)
                                tracing::debug!(
                                    "Successfully extracted text from file pointer {}: {} (text length: {})",
                                    file.filename,
                                    file_upload_id,
                                    text.len()
                                );

                                let content = format_successful_file_content(
                                    &file.filename,
                                    file_upload_id,
                                    text,
                                );
                                ContentPart::Text(ContentPartText { text: content })
                            }
                            (FileContent::Image { .. }, true) => {
                                // ImageFilePointer → Image content (expected case)
                                if let Some(image) = file_contents.as_base64_image() {
                                    tracing::debug!(
                                        "Successfully encoded image: {} ({} bytes, {})",
                                        file.filename,
                                        image.base64_data.len(),
                                        image.content_type
                                    );
                                    ContentPart::Image(image)
                                } else {
                                    unreachable!(
                                        "as_base64_image should always succeed for Image variant"
                                    )
                                }
                            }
                            (FileContent::Text(_), true) => {
                                // ImageFilePointer → Text content (mismatch)
                                tracing::warn!(
                                    "ImageFilePointer resolved to text file: {}",
                                    file_upload_id
                                );
                                let content = format_file_error_message(
                                    &file.filename,
                                    file_upload_id,
                                    false,
                                );
                                ContentPart::Text(ContentPartText { text: content })
                            }
                            (FileContent::Image { .. }, false) => {
                                // TextFilePointer → Image content (mismatch)
                                tracing::warn!(
                                    "TextFilePointer resolved to image file: {}",
                                    file_upload_id
                                );
                                let content = format_file_error_message(
                                    &file.filename,
                                    file_upload_id,
                                    false,
                                );
                                ContentPart::Text(ContentPartText { text: content })
                            }
                        }
                    }
                    Err(err) => {
                        // Check if it's a parsing error by examining the error message
                        let is_parsing_error =
                            err.to_string().contains("parse") || err.to_string().contains("Parse");

                        tracing::warn!(
                            "Failed to get file contents for {}: {} - Error: {}, using placeholder text",
                            file.filename,
                            file_upload_id,
                            err
                        );
                        let content = format_file_error_message(
                            &file.filename,
                            file_upload_id,
                            is_parsing_error,
                        );
                        ContentPart::Text(ContentPartText { text: content })
                    }
                }
            } else {
                tracing::warn!(
                    "File storage provider {} not found for file {}, using placeholder text",
                    file.file_storage_provider_id,
                    file_upload_id
                );
                let content = format_file_error_message(&file.filename, file_upload_id, false);
                ContentPart::Text(ContentPartText { text: content })
            }
        }
        Ok(None) => {
            tracing::warn!(
                "File upload {} referenced in file pointer not found, using placeholder text",
                file_upload_id
            );
            let content = format_file_error_message("Unknown", file_upload_id, false);
            ContentPart::Text(ContentPartText { text: content })
        }
        Err(err) => {
            tracing::error!(
                "Database error fetching file upload {}: {}, using placeholder text",
                file_upload_id,
                err
            );
            let content = format_file_error_message("Unknown", file_upload_id, false);
            ContentPart::Text(ContentPartText { text: content })
        }
    }
}

pub struct PreparedChatRequest {
    // Our internal abstract structure of the message chain
    generation_input_messages: GenerationInputMessages,
    // Our internal abstract representation of generation parameters
    generation_parameters: GenerationParameters,
    // Prepared `genai` `ChatRequest` (messages + available tools)
    chat_request: ChatRequest,
    // Prepared `genai` `ChatOptions` (e.g. reasoning effort)
    chat_options: ChatOptions,
}

fn build_selected_facets(
    config: &ExperimentalFacetsConfig,
    selected_facet_ids: &[String],
) -> HashMap<String, bool> {
    let selected_set: HashSet<&String> = selected_facet_ids.iter().collect();
    config
        .facets
        .keys()
        .map(|id| (id.clone(), selected_set.contains(id)))
        .collect()
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
        };

        // Get assistant configuration to check for default provider
        let assistant_config = crate::models::chat::get_chat_assistant_configuration(
            &app_state.db,
            policy,
            &subject,
            chat,
        )
        .await?;

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
        } = app_state.chat_provider_for_chatcompletion(
            effective_chat_provider_id,
            me_profile_input.user_groups,
        )?;

        // Use the new prompt composition service
        let generation_input_messages = compose_prompt_messages(
            &message_repo,
            &file_resolver,
            &prompt_provider,
            chat,
            &user_input,
            &chat_provider_config,
            &app_state.config.experimental_facets,
            Some(me_profile_input.preferred_language),
        )
        .await?;

        // Resolve TextFilePointer to Text by extracting file contents JIT
        let resolved_generation_input_messages = resolve_file_pointers_in_generation_input(
            app_state,
            generation_input_messages.clone(),
            me_profile_input.access_token,
        )
        .await?;

        // Get all MCP server tools and filter by assistant configuration and facets
        let all_mcp_server_tools = app_state.mcp_servers.list_tools(chat.id).await;
        let filtered_mcp_tools =
            filter_mcp_tools_by_assistant(all_mcp_server_tools, assistant_config.as_ref());
        let facet_allowlist = build_mcp_tool_allowlist(
            &app_state.config.experimental_facets,
            &user_input.selected_facet_ids,
        );
        let generation_mcp_tools =
            filter_mcp_tools_by_allowlist(filtered_mcp_tools, facet_allowlist.as_deref());

        // Build genai ChatRequest (messages + tools) + ChatOptions
        let mut chat_request = resolved_generation_input_messages
            .clone()
            .into_chat_request();
        let chat_request_tools = convert_mcp_tools_to_genai_tools(generation_mcp_tools);
        if !chat_request_tools.is_empty() {
            chat_request.tools = Some(chat_request_tools);
        } else {
            tracing::trace!(
                "Not adding empty list of tools, as that may lead to hallucinated tools"
            );
        }
        let effective_model_settings = build_model_settings_for_facets(
            &chat_provider_config.model_settings,
            &app_state.config.experimental_facets,
            &user_input.selected_facet_ids,
        );
        let chat_options = build_chat_options_for_completion(&effective_model_settings);

        // Create generation parameters with the determined chat provider ID
        let generation_parameters = GenerationParameters {
            generation_chat_provider_id: Some(chat_provider_id),
            selected_facets: build_selected_facets(
                &app_state.config.experimental_facets,
                &user_input.selected_facet_ids,
            ),
        };

        // Return the unresolved version for saving to DB (to avoid duplicating file contents)
        // The resolved version is already used in chat_request
        Ok(PreparedChatRequest {
            generation_input_messages,
            generation_parameters,
            chat_request,
            chat_options,
        })
    })
}

#[allow(clippy::too_many_arguments)]
#[instrument(skip_all)]
async fn stream_generate_chat_completion<
    MSG: SendAsSseEvent
        + From<MessageSubmitStreamingResponseMessageTextDelta>
        + From<MessageSubmitStreamingResponseToolCallProposed>
        + From<MessageSubmitStreamingResponseToolCallUpdate>
        + From<MessageSubmitStreamingResponseError>,
>(
    tx: Sender<Result<Event, Report>>,
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_request: ChatRequest,
    chat_options: ChatOptions,
    assistant_message_id: Uuid,
    user_id: String,
    chat_id: Uuid,
    chat_provider_id: Option<&str>,
    user_groups: &[String],
    streaming_task: Option<&Arc<StreamingTask>>,
    assistant_id: Option<Uuid>,
) -> Result<(Vec<ContentPart>, Option<GenerationMetadata>), ()> {
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
    let langfuse_trace_id = tracing_client
        .as_ref()
        .map(|client| client.trace_id().to_string());
    let max_tool_call_iterations = 15;
    let mut unfinished_tool_calls: Vec<genai::chat::ToolCall> = vec![];
    let mut current_turn = 0;
    let mut current_tool_call_count = 0;

    let mut current_message_content: Vec<ContentPart> = vec![];
    let mut current_turn_chat_request = chat_request.clone();

    // Track cumulative usage statistics across all turns
    let mut total_prompt_tokens = 0u32;
    let mut total_completion_tokens = 0u32;
    let mut total_total_tokens = 0u32;
    let mut total_reasoning_tokens = 0u32;

    let build_generation_metadata =
        |total_prompt_tokens: u32,
         total_completion_tokens: u32,
         total_total_tokens: u32,
         total_reasoning_tokens: u32,
         langfuse_trace_id: Option<String>,
         error: Option<GenerationErrorType>| {
            if total_prompt_tokens > 0
                || total_completion_tokens > 0
                || total_total_tokens > 0
                || total_reasoning_tokens > 0
                || langfuse_trace_id.is_some()
                || error.is_some()
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
                    langfuse_trace_id,
                    error,
                })
            } else {
                None
            }
        };

    // Track all tool calls across all turns for Langfuse metadata
    let mut all_tool_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    'loop_call_turns: loop {
        current_turn += 1;
        tracing::debug!("Starting chat completion turn {}", current_turn);

        // Track timing for this specific turn
        let turn_start_time = if langfuse_enabled {
            Some(SystemTime::now())
        } else {
            None
        };

        if current_turn != 1 && unfinished_tool_calls.is_empty() {
            tracing::warn!(
                "Trying to progress chat completion after first iteration without open tool calls. Will likely result in error."
            )
        }
        // First work off open tool calls
        let mut current_turn_tool_responses = vec![];
        while let Some(unfinished_tool_call) = unfinished_tool_calls.pop() {
            if current_tool_call_count >= max_tool_call_iterations {
                // TODO: Send error that tool call was aborted due to too many iterations
                return Err(());
            } else {
                current_tool_call_count += 1;
            }
            // Emit event for tool call proposed
            {
                let unfinished_tool_call = unfinished_tool_call.clone();
                let proposed_call = MessageSubmitStreamingResponseToolCallProposed {
                    message_id: assistant_message_id,
                    content_index: current_message_content.len(),
                    tool_call_id: unfinished_tool_call.call_id.clone(),
                    tool_name: unfinished_tool_call.fn_name.clone(),
                    input: Some(unfinished_tool_call.fn_arguments.clone()),
                };
                // Forward to streaming_task if present
                if let Some(task) = streaming_task {
                    let _ = task
                        .send_event(StreamingEvent::ToolCallProposed {
                            message_id: assistant_message_id,
                            content_index: current_message_content.len(),
                            tool_call_id: unfinished_tool_call.call_id,
                            tool_name: unfinished_tool_call.fn_name,
                            input: Some(unfinished_tool_call.fn_arguments),
                        })
                        .await;
                }
                let message: MSG = proposed_call.into();
                message.send_event(tx.clone()).await?;
            }

            let managed_tool_call = app_state
                .mcp_servers
                .convert_tool_call_to_managed_tool_call(chat_id, unfinished_tool_call.clone())
                .await
                .unwrap();
            let output_schema = managed_tool_call.tool.output_schema.clone();
            match app_state
                .mcp_servers
                .call_tool(chat_id, managed_tool_call)
                .await
            {
                Ok(tool_call_result) => {
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
                            let _ = tx
                                .send(Err(err).wrap_err("Failed to process MCP tool output"))
                                .await;
                            return Err(());
                        }
                    };
                    let tool_response = post_processed.tool_response;
                    let output_value = post_processed.output_value;
                    let image_content_parts = post_processed.image_content_parts;

                    // Emit event for tool call update
                    {
                        let finished_tool_call = unfinished_tool_call.clone();
                        let output_value_for_event = output_value.clone();
                        let proposed_call = MessageSubmitStreamingResponseToolCallUpdate {
                            message_id: assistant_message_id,
                            content_index: current_message_content.len(),
                            tool_call_id: finished_tool_call.call_id.clone(),
                            tool_name: finished_tool_call.fn_name.clone(),
                            input: Some(finished_tool_call.fn_arguments.clone()),
                            status: ToolCallStatus::Success,
                            progress_message: None,
                            output: output_value_for_event.clone(),
                        };
                        // Forward to streaming_task if present
                        if let Some(task) = streaming_task {
                            let _ = task
                                .send_event(StreamingEvent::ToolCallUpdate {
                                    message_id: assistant_message_id,
                                    content_index: current_message_content.len(),
                                    tool_call_id: finished_tool_call.call_id,
                                    tool_name: finished_tool_call.fn_name,
                                    input: Some(finished_tool_call.fn_arguments),
                                    status: BgToolCallStatus::Success,
                                    progress_message: None,
                                    output: output_value_for_event,
                                })
                                .await;
                        }
                        let message: MSG = proposed_call.into();
                        message.send_event(tx.clone()).await?;
                    }
                    // Add to current message content
                    {
                        let finished_tool_call = unfinished_tool_call.clone();
                        current_message_content.push(ContentPart::ToolUse(ToolUse {
                            tool_call_id: finished_tool_call.call_id,
                            status: MessageToolCallStatus::Success,
                            tool_name: finished_tool_call.fn_name,
                            input: Some(finished_tool_call.fn_arguments),
                            progress_message: None,
                            output: output_value.clone(),
                        }));
                        if !image_content_parts.is_empty() {
                            current_message_content.extend(image_content_parts);
                        }
                    }

                    current_turn_tool_responses.push(tool_response)
                }
                Err(err) => {
                    // TODO: Send event and message_content
                    let _ = tx.send(Err(err).wrap_err("Failed to call tool")).await;
                    return Err(());
                }
            };
        }
        if !current_turn_tool_responses.is_empty() {
            current_turn_chat_request.messages.push(GenAiChatMessage {
                role: ChatRole::Tool,
                content: MessageContent::from_parts(
                    current_turn_tool_responses
                        .clone()
                        .into_iter()
                        .map(genai::chat::ContentPart::ToolResponse)
                        .collect::<Vec<_>>(),
                ),
                options: None,
            });
        }

        let chat_stream = match app_state
            .genai_for_chatcompletion(chat_provider_id, user_groups)
            .expect("Unable to choose chat provider")
            .exec_chat_stream(
                "PLACEHOLDER_MODEL",
                current_turn_chat_request.clone(),
                Some(&chat_options),
            )
            .await
        {
            Ok(stream) => stream,
            Err(err) => {
                let error_event = parse_streaming_error(err, assistant_message_id).await;
                let error_payload = Some(error_event.error.clone());

                if let Some(task) = streaming_task
                    && let Ok(error_json) = serde_json::to_value(
                        MessageSubmitStreamingResponseMessage::Error(error_event.clone()),
                    )
                {
                    let _ = task
                        .send_event(StreamingEvent::Error {
                            error: Some(error_json),
                        })
                        .await;
                }

                let message: MSG = error_event.into();
                message.send_event(tx.clone()).await?;
                let generation_metadata = build_generation_metadata(
                    total_prompt_tokens,
                    total_completion_tokens,
                    total_total_tokens,
                    total_reasoning_tokens,
                    langfuse_trace_id.clone(),
                    error_payload,
                );
                break 'loop_call_turns Ok((current_message_content, generation_metadata));
            }
        };

        let mut inner_stream = chat_stream.stream;
        // Await until stream end
        let mut stream_end: Option<StreamEnd> = None;
        while let Some(result) = inner_stream.next().await {
            match result {
                Ok(message) => match message {
                    ChatStreamEvent::Chunk(StreamChunk { content }) => {
                        let delta = MessageSubmitStreamingResponseMessageTextDelta {
                            message_id: assistant_message_id,
                            content_index: current_message_content.len(),
                            new_text: content.clone(),
                        };
                        // Forward to streaming_task if present
                        if let Some(task) = streaming_task {
                            let _ = task
                                .send_event(StreamingEvent::TextDelta {
                                    message_id: assistant_message_id,
                                    content_index: current_message_content.len(),
                                    new_text: content,
                                })
                                .await;
                        }
                        let message: MSG = delta.into();
                        message.send_event(tx.clone()).await?;
                    }
                    ChatStreamEvent::End(end) => {
                        stream_end = Some(end);
                    }
                    ChatStreamEvent::Start => {}
                    _ => {}
                },
                Err(err) => {
                    if let genai::Error::JsonValueExt(_) = err {
                        continue;
                    }

                    let error_event = parse_streaming_error(err, assistant_message_id).await;
                    let error_payload = Some(error_event.error.clone());

                    if let Some(task) = streaming_task
                        && let Ok(error_json) = serde_json::to_value(
                            MessageSubmitStreamingResponseMessage::Error(error_event.clone()),
                        )
                    {
                        let _ = task
                            .send_event(StreamingEvent::Error {
                                error: Some(error_json),
                            })
                            .await;
                    }

                    let message: MSG = error_event.into();
                    message.send_event(tx.clone()).await?;
                    let generation_metadata = build_generation_metadata(
                        total_prompt_tokens,
                        total_completion_tokens,
                        total_total_tokens,
                        total_reasoning_tokens,
                        langfuse_trace_id.clone(),
                        error_payload,
                    );
                    break 'loop_call_turns Ok((current_message_content, generation_metadata));
                }
            }
        }
        if let Some(stream_end) = stream_end {
            // Track the content generated in this turn for Langfuse tracing
            let turn_content_start_index = current_message_content.len();

            #[allow(clippy::collapsible_match)]
            #[allow(clippy::single_match)]
            if let Some(captured_texts) = stream_end.captured_texts() {
                for captured_text in captured_texts {
                    current_message_content.push(ContentPart::Text(ContentPartText {
                        text: captured_text.into(),
                    }));
                }
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
                // Get the model name for Langfuse reporting using the actual chat provider used
                let model_name = if let Some(provider_id) = chat_provider_id {
                    app_state
                        .config
                        .get_chat_provider(provider_id)
                        .model_name_langfuse()
                        .to_string()
                } else {
                    // Fallback to determining provider if not specified
                    match app_state.config.determine_chat_provider(None, None) {
                        Ok(provider_id) => app_state
                            .config
                            .get_chat_provider(provider_id)
                            .model_name_langfuse()
                            .to_string(),
                        Err(_) => "unknown".to_string(),
                    }
                };

                // Generate a unique observation ID for this turn
                let (turn_obs_id, _) = generate_langfuse_ids();

                // Get the content generated in this turn
                let turn_content = &current_message_content[turn_content_start_index..];

                // Use the usage information from this turn's stream_end
                let turn_usage = stream_end.captured_usage.as_ref();

                // Determine generation name
                let generation_name = if let Some(ref name) = langfuse_generation_name {
                    Some(format!("{} (turn {})", name, current_turn))
                } else {
                    Some(format!("chat_completion_turn_{}", current_turn))
                };

                // Extract tool names from this turn's captured tool calls
                let turn_tool_names: Vec<String> = stream_end
                    .captured_tool_calls()
                    .map(|calls| calls.iter().map(|call| call.fn_name.clone()).collect())
                    .unwrap_or_default();

                // Clone client and data for async task
                let client = client.clone();
                let request = current_turn_chat_request.clone();
                let content = turn_content.to_vec();
                let usage = turn_usage.cloned();

                // Send trace/observation asynchronously
                let assistant_id_for_langfuse = assistant_id;
                tokio::spawn(async move {
                    let result = if current_turn == 1 {
                        // For first turn, create both trace and generation in a single batch
                        create_trace_with_generation_from_chat(
                            &client,
                            turn_obs_id,
                            &request,
                            &content,
                            usage.as_ref(),
                            Some(model_name),
                            generation_name,
                            Some(turn_start),
                            Some(turn_end_time),
                            None, // completion_start_time
                            assistant_id_for_langfuse,
                            &turn_tool_names,
                        )
                        .await
                    } else {
                        // For subsequent turns, only create the generation observation
                        TracedGenerationBuilder::new(turn_obs_id)
                            .with_model(model_name)
                            .with_start_time(turn_start)
                            .with_end_time(turn_end_time)
                            .with_name(generation_name.unwrap_or_else(|| {
                                format!("chat_completion_turn_{}", current_turn)
                            }))
                            .build_and_send(
                                &client,
                                &request,
                                &content,
                                usage.as_ref(),
                                assistant_id_for_langfuse,
                                &turn_tool_names,
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
                });
            }

            if let Some(captured_tool_calls) = stream_end.captured_tool_calls() {
                if !captured_tool_calls.is_empty() {
                    // Track tool names for Langfuse metadata
                    for tool_call in captured_tool_calls.iter() {
                        all_tool_names.insert(tool_call.fn_name.clone());
                    }

                    current_turn_chat_request.messages.push(GenAiChatMessage {
                        role: ChatRole::Assistant,
                        content: MessageContent::from_tool_calls(
                            captured_tool_calls.clone().into_iter().cloned().collect(),
                        ),
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
                        && let Ok(output_json) =
                            crate::services::genai_langfuse::convert_content_parts_to_json(
                                &current_message_content,
                            )
                    {
                        let client = client.clone();
                        let trace_id = client.trace_id().to_string();
                        let accumulated_tool_names: Vec<String> =
                            all_tool_names.iter().cloned().collect();
                        let assistant_id_for_trace = assistant_id;
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
                            if let Some(metadata) = crate::services::genai_langfuse::create_metadata_with_assistant_and_tools(
                                assistant_id_for_trace,
                                &accumulated_tool_names,
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
                        });
                    }

                    let generation_metadata = build_generation_metadata(
                        total_prompt_tokens,
                        total_completion_tokens,
                        total_total_tokens,
                        total_reasoning_tokens,
                        langfuse_trace_id.clone(),
                        None,
                    );
                    break 'loop_call_turns Ok((current_message_content, generation_metadata));
                }
            } else {
                // Update Langfuse trace with final output if enabled
                if let Some(ref client) = tracing_client
                    && let Ok(output_json) =
                        crate::services::genai_langfuse::convert_content_parts_to_json(
                            &current_message_content,
                        )
                {
                    let client = client.clone();
                    let trace_id = client.trace_id().to_string();
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
                    });
                }

                let generation_metadata = build_generation_metadata(
                    total_prompt_tokens,
                    total_completion_tokens,
                    total_total_tokens,
                    total_reasoning_tokens,
                    langfuse_trace_id.clone(),
                    None,
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
                user_groups,
            )
            .await
            {
                let error_payload = Some(error_event.error.clone());

                if let Some(task) = streaming_task
                    && let Ok(error_json) = serde_json::to_value(
                        MessageSubmitStreamingResponseMessage::Error(error_event.clone()),
                    )
                {
                    let _ = task
                        .send_event(StreamingEvent::Error {
                            error: Some(error_json),
                        })
                        .await;
                }

                let message: MSG = error_event.into();
                message.send_event(tx.clone()).await?;
                let generation_metadata = build_generation_metadata(
                    total_prompt_tokens,
                    total_completion_tokens,
                    total_total_tokens,
                    total_reasoning_tokens,
                    langfuse_trace_id.clone(),
                    error_payload,
                );
                break 'loop_call_turns Ok((current_message_content, generation_metadata));
            }

            break 'loop_call_turns Err(());
        }
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
) -> Result<(), String> {
    let updated_assistant_message = crate::models::message::update_message_content(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &assistant_message_id,
        final_content_parts.clone(),
    )
    .await
    .map_err(|e| format!("Failed to update assistant message content: {}", e))?;

    let updated_assistant_message_wrapped =
        ChatMessage::from_model(updated_assistant_message.clone())
            .map_err(|e| format!("Failed to convert updated assistant message: {}", e))?;

    task.send_event(StreamingEvent::AssistantMessageCompleted {
        message_id: updated_assistant_message.id,
        content: final_content_parts.clone(),
        message: updated_assistant_message_wrapped,
    })
    .await?;

    app_state.global_policy_engine.invalidate_data().await;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn stream_update_assistant_message_completion<
    MSG: SendAsSseEvent + From<MessageSubmitStreamingResponseMessageComplete>,
>(
    tx: Sender<Result<Event, Report>>,
    app_state: &AppState,
    policy: &PolicyEngine,
    final_content_parts: Vec<ContentPart>,
    me_user: &MeProfile,
    assistant_message_id: Uuid,
) -> Result<(), ()> {
    // Update the assistant message in the database
    let updated_assistant_message = match crate::models::message::update_message_content(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &assistant_message_id,
        final_content_parts.clone(),
    )
    .await
    {
        Ok(msg) => msg,
        Err(err) => {
            let _ = tx
                .send(Err(err).wrap_err("Failed to update assistant message content"))
                .await;
            return Err(());
        }
    };

    let updated_assistant_message_wrapped =
        match ChatMessage::from_model(updated_assistant_message.clone()) {
            Ok(msg) => msg,
            Err(err) => {
                let _ = tx
                    .send(Err(err).wrap_err("Failed to convert updated assistant message"))
                    .await;
                return Err(());
            }
        };

    let message_completed_event: MSG = MessageSubmitStreamingResponseMessageComplete {
        message_id: updated_assistant_message.id, // This is assistant_message_id
        content: final_content_parts.clone(),
        message: updated_assistant_message_wrapped,
    }
    .into();
    message_completed_event
        .send_event(tx.clone())
        .in_current_span()
        .await?;

    app_state.global_policy_engine.invalidate_data().await;

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
    first_message: &messages::Model,
) -> Result<(), Report> {
    tracing::info!(
        "[SUMMARY] Starting generation for chat_id={}, user_id={}, has_assistant={}",
        chat.id,
        me_user.id,
        chat.assistant_configuration.is_some()
    );

    let first_message_content = MessageSchema::validate(&first_message.raw_message)?;
    let first_message_content_text = first_message_content.full_text();

    tracing::debug!(
        "[SUMMARY] First message content (chat_id={}): '{}'",
        chat.id,
        first_message_content_text
            .chars()
            .take(100)
            .collect::<String>()
    );

    let prompt = format!(
        "Generate a summary for the topic of the following chat, based on the first message to the chat. The summary should be a short single sentence description like e.g. `Regex Search-and-Replace with Ripgrep` or `Explain a customer support flow`. Only return that sentence and nothing else. The chat message : {}",
        first_message_content_text
    );

    let mut chat_request: ChatRequest = Default::default();
    chat_request = chat_request.append_message(GenAiChatMessage::user(prompt));
    let max_tokens = app_state.max_tokens_for_summary();

    // HACK: Hacky way to recognize reasoning models right now. Shouldbe replaced with capabilities mechanism in the future.
    let ChatProviderConfigWithId {
        chat_provider_config,
        ..
    } = app_state.chat_provider_for_summary().wrap_err_with(|| {
        format!(
            "[SUMMARY] Failed to get chat provider for summary (chat_id={})",
            chat.id
        )
    })?;
    let chat_options =
        build_chat_options_for_summary(&chat_provider_config.model_settings, max_tokens);

    tracing::debug!(
        "[SUMMARY] Using provider '{}' for summary generation (chat_id={})",
        chat_provider_config.model_name,
        chat.id
    );

    tracing::debug!("[SUMMARY] Calling genai API (chat_id={})", chat.id);
    let summary_completion = app_state
        .genai_for_summary()?
        .exec_chat("PLACEHOLDER_MODEL", chat_request, Some(&chat_options))
        .await
        .wrap_err_with(|| {
            format!(
                "[SUMMARY] Failed to generate chat summary via API (chat_id={})",
                chat.id
            )
        })?;

    let summary = summary_completion
        .first_text()
        .ok_or_else(|| {
            eyre!(
                "[SUMMARY] No text content in summary response (chat_id={})",
                chat.id
            )
        })?
        .to_string();

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
            let text = file_processing_cached::get_file_contents_cached(
                app_state,
                &file_id,
                file_storage,
                &file_storage_path,
                sharepoint_ctx_ref,
            )
            .await?;

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
    let qualified_name = format!("{}/{}", tool.server_id, tool.tool.name);

    allowlist.iter().any(|pattern| {
        if pattern == "*" {
            return true;
        }

        if !pattern.contains('/') {
            return pattern == &tool.server_id;
        }

        if let Some(prefix) = pattern.strip_suffix("/*") {
            return qualified_name.starts_with(&format!("{}/", prefix));
        }

        pattern == &qualified_name
    })
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
) -> Result<(), (axum::http::StatusCode, String)> {
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

#[utoipa::path(
    post,
    path = "/me/messages/submitstream",
    request_body = MessageSubmitRequest,
    responses(
        (status = OK, content_type="text/event-stream", body = MessageSubmitStreamingResponseMessage),
        (status = BAD_REQUEST, description = "When validation fails (e.g., invalid previous_message_id)"),
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
    Json(request): Json<MessageSubmitRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Report>>>, (axum::http::StatusCode, String)> {
    // Validate request parameters
    validate_submit_request(
        &app_state,
        &policy,
        &me_user,
        request.previous_message_id.as_ref(),
    )
    .await?;

    // Determine the chat_id first so we can use it as the background task key
    let (chat_id, chat_was_created) = if let Some(existing_chat_id) = request.existing_chat_id {
        (existing_chat_id, false)
    } else {
        // Need to get or create chat to determine the chat_id
        let (chat, chat_status) = get_or_create_chat_by_previous_message_id(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            request.previous_message_id.as_ref(),
            &me_user.id,
            request.assistant_id.as_ref(),
        )
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get or create chat: {}", e),
            )
        })?;

        let was_created = chat_status == ChatCreationStatus::Created;
        if was_created {
            app_state.global_policy_engine.invalidate_data().await;
        }

        (chat.id, was_created)
    };

    // Start or get background task for this chat
    let (broadcast_rx, task) = app_state
        .background_tasks
        .start_task(chat_id, Uuid::new_v4()) // message_id will be set later
        .await;

    // Clone variables for the background task
    let app_state_bg = app_state.clone();
    let policy_bg = policy.clone();
    let me_user_bg = me_user.clone();
    let task_clone = Arc::clone(&task);
    let request_clone = request.clone();

    // Spawn the background generation task
    tokio::spawn(
        async move {
            tracing::info!("Starting background task for chat_id: {}", chat_id);
            let result = run_message_submit_task(
                &task_clone,
                &app_state_bg,
                &policy_bg,
                &me_user_bg,
                &request_clone,
                chat_id,
                chat_was_created,
            )
            .await;

            match result {
                Ok(()) => {
                    tracing::info!(
                        "Background task completed successfully for chat_id: {}",
                        chat_id
                    );
                }
                Err(e) => {
                    tracing::error!("Background task failed for chat_id {}: {}", chat_id, e);
                    // Send error event if possible
                    // For now, just log it
                }
            }

            // Send final stream_end event
            let _ = task_clone.send_event(StreamingEvent::StreamEnd).await;
            // Mark task as completed
            task_clone.mark_completed();
            app_state_bg.background_tasks.remove_task(&chat_id).await;
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
                capture_report(err);
            }
        })
    };

    Ok(Sse::new(event_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    ))
}

/// Run the message submission task in the background
async fn run_message_submit_task(
    task: &Arc<StreamingTask>,
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    request: &MessageSubmitRequest,
    chat_id: Uuid,
    chat_was_created: bool,
) -> Result<(), String> {
    tracing::info!("run_message_submit_task started for chat_id: {}", chat_id);

    // Rebuild policy data FIRST if a new chat was created (before trying to fetch the chat)
    if chat_was_created {
        tracing::info!("Rebuilding policy data for newly created chat");
        policy.rebuild_data(&app_state.db).await.map_err(|e| {
            let err_msg = format!("Failed to rebuild policy data after chat creation: {}", e);
            tracing::error!("{}", err_msg);
            err_msg
        })?;
    }

    // Send ChatCreated event if the chat was just created
    if chat_was_created {
        tracing::info!("Sending ChatCreated event for chat_id: {}", chat_id);
        task.send_event(StreamingEvent::ChatCreated { chat_id })
            .await?;
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
    )
    .await
    .map_err(|e| {
        let err_msg = format!("Failed to get chat: {}", e);
        tracing::error!("{}", err_msg);
        err_msg
    })?
    .0;

    tracing::info!("Chat fetched successfully, id: {}", chat.id);

    // Save user message
    tracing::info!("Saving user message");
    let saved_user_message = bg_stream_save_user_message(
        task,
        app_state,
        policy,
        me_user,
        &chat,
        request.previous_message_id.as_ref(),
        &request.user_message,
        &request.input_files_ids,
    )
    .await
    .map_err(|e| {
        let err_msg = format!("Failed to save user message: {}", e);
        tracing::error!("{}", err_msg);
        err_msg
    })?;

    tracing::info!("User message saved, id: {}", saved_user_message.id);

    // Spawn chat summary generation if needed
    if chat_was_created || request.previous_message_id.is_none() {
        let app_state_clone = app_state.clone();
        let policy_clone = policy.clone();
        let me_user_clone = me_user.clone();
        let chat_clone = chat.clone();
        let saved_user_message_clone = saved_user_message.clone();
        let chat_summary_span = tracing::info_span!("Generating chat summary");
        tokio::spawn(
            async move {
                let summary_res = generate_chat_summary(
                    &app_state_clone,
                    &policy_clone,
                    &me_user_clone,
                    &chat_clone,
                    &saved_user_message_clone,
                )
                .await;
                if let Err(ref summary) = summary_res {
                    capture_report(summary);
                }
                Ok::<(), Report>(())
            }
            .instrument(chat_summary_span),
        );
    }

    // Prepare chat request
    let me_profile_input = MeProfileChatRequestInput::from_me_profile(me_user);
    let user_input = PromptCompositionUserInput {
        just_submitted_user_message_id: saved_user_message.id,
        requested_chat_provider_id: request.chat_provider_id.clone(),
        new_input_file_ids: request.input_files_ids.clone(),
        selected_facet_ids: request.selected_facet_ids.clone(),
    };
    let PreparedChatRequest {
        chat_request,
        chat_options,
        generation_input_messages,
        generation_parameters,
    } = prepare_chat_request(app_state, policy, &chat, user_input, &me_profile_input)
        .await
        .map_err(|e| format!("Failed to prepare chat request: {}", e))?;

    // Extract chat provider ID from generation parameters (clone to avoid borrow issues)
    let chat_provider_id = generation_parameters
        .generation_chat_provider_id
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    // Get the chat provider configuration to check if image generation is enabled
    let ChatProviderConfigWithId {
        chat_provider_config,
        ..
    } = app_state
        .chat_provider_for_chatcompletion(Some(&chat_provider_id), &me_user.groups)
        .map_err(|e| format!("Failed to get chat provider config: {}", e))?;

    // Check if image generation is enabled for this model
    let effective_model_settings = build_model_settings_for_facets(
        &chat_provider_config.model_settings,
        &app_state.config.experimental_facets,
        &request.selected_facet_ids,
    );
    if effective_model_settings.generate_images {
        tracing::info!("Image generation mode enabled, generating image instead of text");

        // Extract the user's prompt from the last user message
        let user_prompt = generation_input_messages
            .messages
            .iter()
            .rev()
            .find(|msg| msg.role == MessageRole::User)
            .and_then(|msg| match &msg.content {
                ContentPart::Text(text) => Some(text.text.clone()),
                _ => None,
            })
            .ok_or_else(|| {
                "No text content found in user message for image generation".to_string()
            })?;

        tracing::debug!("Generating image with prompt: {}", user_prompt);

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
        )
        .await
        .map_err(|e| format!("Failed to submit initial assistant message: {}", e))?;

        // Emit AssistantMessageStarted event
        task.send_event(StreamingEvent::AssistantMessageStarted {
            message_id: initial_assistant_message.id,
        })
        .await?;

        // Generate the image using rust-genai
        let image_request = genai::chat::ImageRequest::from_prompt(&user_prompt)
            .with_size("1024x1024")
            .with_quality("standard");

        let genai_client = app_state
            .genai_for_chatcompletion(Some(&chat_provider_id), &me_user.groups)
            .map_err(|e| format!("Failed to get genai client: {}", e))?;

        let image_response = genai_client
            .exec_image_generation(&chat_provider_config.model_name, image_request, None)
            .await
            .map_err(|e| format!("Failed to generate image: {}", e))?;

        // Get the first generated image
        let generated_image = image_response
            .images
            .first()
            .ok_or_else(|| "No images were generated".to_string())?;

        // Extract the binary
        let binary = match generated_image {
            genai::chat::ContentPart::Binary(binary) => binary.clone(),
            _ => return Err("Unexpected content part type from image generation".to_string()),
        };

        // Download and store the image
        let (file_upload_id, download_url) = download_and_store_generated_image(
            app_state,
            policy,
            &me_user.to_subject(),
            &chat.id,
            binary,
        )
        .await
        .map_err(|e| format!("Failed to download and store generated image: {}", e))?;

        tracing::info!(
            "Successfully generated and stored image: file_upload_id={}, download_url={}",
            file_upload_id,
            download_url
        );

        // Create content with the image pointer
        let end_content = vec![ContentPart::ImageFilePointer(ContentPartImageFilePointer {
            file_upload_id,
            download_url,
        })];

        // Update assistant message with the image
        bg_stream_update_assistant_message_completion(
            task,
            app_state,
            policy,
            end_content,
            me_user,
            initial_assistant_message.id,
        )
        .await?;

        tracing::info!("run_message_submit_task completed successfully for image generation");
        return Ok(());
    }

    // Normal text generation flow
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
    )
    .await
    .map_err(|e| format!("Failed to submit initial assistant message: {}", e))?;

    // Emit AssistantMessageStarted event
    task.send_event(StreamingEvent::AssistantMessageStarted {
        message_id: initial_assistant_message.id,
    })
    .await?;

    // Create a channel to intercept events from generation (needed for the generic function signature)
    let (temp_tx2, mut temp_rx2) = tokio::sync::mpsc::channel::<Result<Event, Report>>(100);

    // Consume events from the temp channel (events are now forwarded directly to StreamingTask)
    tokio::spawn(async move {
        while temp_rx2.recv().await.is_some() {
            // Events are consumed here to prevent channel from filling up
            // Actual forwarding to StreamingTask happens in stream_generate_chat_completion
        }
    });

    let subject = me_user.to_subject();
    let generation_task = stream_generate_chat_completion::<MessageSubmitStreamingResponseMessage>(
        temp_tx2.clone(),
        app_state,
        policy,
        &subject,
        chat_request,
        chat_options,
        initial_assistant_message.id,
        me_user.id.clone(),
        chat.id,
        Some(chat_provider_id.as_str()),
        &me_user.groups,
        Some(task),
        chat.assistant_id,
    );

    let (end_content, generation_metadata) = generation_task
        .await
        .map_err(|_| "Failed during chat completion generation".to_string())?;

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
                .and_then(|error| serde_json::to_value(error).ok());
            if let Some(JsonValue::Object(map)) = error_value.as_mut() {
                map.entry("message_id".to_string())
                    .or_insert(JsonValue::String(initial_assistant_message.id.to_string()));
            }
            let _ = task
                .send_event(StreamingEvent::Error { error: error_value })
                .await;
        }
    }

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
        tracing::warn!("Failed to update generation metadata: {}", err);
    }

    // Update assistant message with final content
    bg_stream_update_assistant_message_completion(
        task,
        app_state,
        policy,
        end_content,
        me_user,
        initial_assistant_message.id,
    )
    .await?;

    // Note: stream_end event is sent in the spawning wrapper in message_submit_sse

    Ok(())
}

#[utoipa::path(
    post,
    path = "/me/messages/regeneratestream",
    request_body = RegenerateMessageRequest,
    responses(
        (status = OK, content_type="text/event-stream", body = RegenerateMessageStreamingResponseMessage),
        (status = BAD_REQUEST, description = "When validation fails (e.g., invalid message role)"),
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
    Json(request): Json<RegenerateMessageRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Report>>>, (axum::http::StatusCode, String)> {
    // Validate request parameters
    let validation_result =
        validate_regenerate_request(&app_state, &policy, &me_user, &request.current_message_id)
            .await?;

    // Create a channel for sending events
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Report>>(100);

    // Move validated messages into the task
    let previous_message = validation_result.previous_message;

    // Clone IDs for the async task
    let current_message_id = request.current_message_id;

    // Spawn a task to process the request and send events
    tokio::spawn(async move {
        let chat_res = get_chat_by_message_id(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &current_message_id,
        )
        .await;
        if let Err(err) = chat_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let chat = chat_res.unwrap();

        let input_files_for_previous_message = previous_message
            .input_file_uploads
            .clone()
            .unwrap_or_default();

        let me_profile_input = MeProfileChatRequestInput::from_me_profile(&me_user);
        let user_input = crate::services::prompt_composition::PromptCompositionUserInput {
            just_submitted_user_message_id: previous_message.id,
            requested_chat_provider_id: request.chat_provider_id.clone(),
            new_input_file_ids: input_files_for_previous_message,
            selected_facet_ids: request.selected_facet_ids.clone(),
        };
        let prepare_chat_request_res =
            prepare_chat_request(&app_state, &policy, &chat, user_input, &me_profile_input).await;
        if let Err(err) = prepare_chat_request_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let PreparedChatRequest {
            chat_request,
            chat_options,
            generation_input_messages,
            generation_parameters,
        } = prepare_chat_request_res.unwrap();

        // ---- SAVE INITIAL EMPTY ASSISTANT MESSAGE (for regeneration) ----
        let empty_assistant_message_json = json!({ "role": "assistant", "content": [] });

        // Extract chat provider ID from generation parameters (clone to avoid borrow issues)
        let chat_provider_id = generation_parameters
            .generation_chat_provider_id
            .clone()
            .unwrap_or_else(|| "unknown".to_string());

        let initial_assistant_message = match submit_message(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &chat.id,
            empty_assistant_message_json,
            Some(&previous_message.id), // Previous is the user message
            Some(&request.current_message_id), // Sibling is the message being regenerated
            Some(generation_input_messages.clone()),
            &[],
            Some(generation_parameters), // Save generation parameters with chat provider ID
            None, // Generation metadata will be added later when stream completes
        )
        .await
        {
            Ok(msg) => msg,
            Err(err) => {
                let _ = tx
                    .send(
                        Err(err)
                            .wrap_err("Failed to submit initial assistant message for regenerate"),
                    )
                    .await;
                return Err(());
            }
        };

        // ---- EMIT AssistantMessageStarted ----
        let assistant_started_event: RegenerateMessageStreamingResponseMessage =
            MessageSubmitStreamingResponseAssistantMessageStarted {
                message_id: initial_assistant_message.id,
            }
            .into();
        if let Err(()) = assistant_started_event.send_event(tx.clone()).await {
            return Err(());
        }
        // ---- END EMIT ----

        let subject = me_user.to_subject();
        let (end_content, generation_metadata) =
            stream_generate_chat_completion::<RegenerateMessageStreamingResponseMessage>(
                tx.clone(),
                &app_state,
                &policy,
                &subject,
                chat_request,
                chat_options,
                initial_assistant_message.id, // Pass assistant_message_id
                me_user.id.clone(),           // Pass user_id
                chat.id,                      // Pass chat_id
                Some(chat_provider_id.as_str()), // Pass chat_provider_id
                &me_user.groups,              // Pass user_groups
                None,                         // No background task for regenerate
                chat.assistant_id,            // Pass assistant_id for Langfuse tracking
            )
            .await?;

        // Update the assistant message with generation metadata if available
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
            tracing::warn!("Failed to update generation metadata: {}", err);
            // Don't fail the entire request if metadata update fails
        }

        stream_update_assistant_message_completion::<RegenerateMessageStreamingResponseMessage>(
            tx.clone(),
            &app_state,
            &policy,
            end_content,
            &me_user,
            initial_assistant_message.id,
        )
        .await?;

        Ok::<(), ()>(())
    });

    // Convert the receiver into a stream and return it
    let receiver_stream = tokio_stream::wrappers::ReceiverStream::<Result<Event, Report>>::new(rx);
    let inspected_stream = futures::StreamExt::inspect(receiver_stream, |event| {
        if let Err(err) = event {
            capture_report(err);
        }
    });

    Ok(Sse::new(inspected_stream).keep_alive(
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
    Json(request): Json<EditMessageRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Report>>>, (axum::http::StatusCode, String)> {
    // Validate request parameters
    let message_to_edit =
        validate_edit_request(&app_state, &policy, &me_user, &request.message_id).await?;

    // Create a channel for sending events
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Report>>(100);

    // Move request data into the task
    let request_message_id = request.message_id;
    let replace_user_message = request.replace_user_message;
    let replace_input_files_ids = request.replace_input_files_ids;

    // Spawn a task to process the request and send events
    tokio::spawn(async move {
        let chat_res = get_chat_by_message_id(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &request_message_id,
        )
        .await;
        if let Err(err) = chat_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let chat = chat_res.unwrap();

        // Create a new user message with the replaced content
        let user_message = json!({
            "role": "user",
            "content": vec![json!({
                "content_type": "text",
                "text": replace_user_message
            })],
            "name": me_user.id
        });

        let saved_user_message = match submit_message(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &chat.id,
            user_message,
            // Previous message is inherited from message to edit
            message_to_edit.previous_message_id.as_ref(),
            // Sibling is the message to edit
            Some(&message_to_edit.id),
            None,
            // TODO: Verify input file replacement behaviour in tests
            &replace_input_files_ids,
            None, // User messages don't have generation parameters
            None, // User messages don't have generation metadata
        )
        .await
        {
            Ok(msg) => msg,
            Err(err) => {
                let _ = tx
                    .send(Err(err).wrap_err("Failed to submit user message"))
                    .await;
                return Err(());
            }
        };

        // Send user message saved event
        let saved_user_message_wrapped = match ChatMessage::from_model(saved_user_message.clone()) {
            Ok(msg) => msg,
            Err(err) => {
                let _ = tx
                    .send(Err(err).wrap_err("Failed to convert saved user message"))
                    .await;
                return Err(());
            }
        };

        let user_message_saved: EditMessageStreamingResponseMessage =
            MessageSubmitStreamingResponseUserMessageSaved {
                message_id: saved_user_message.id,
                message: saved_user_message_wrapped,
            }
            .into();
        if let Err(()) = user_message_saved.send_event(tx.clone()).await {
            return Err(());
        }

        let me_profile_input = MeProfileChatRequestInput::from_me_profile(&me_user);
        let user_input = PromptCompositionUserInput {
            just_submitted_user_message_id: saved_user_message.id,
            requested_chat_provider_id: request.chat_provider_id.clone(),
            new_input_file_ids: replace_input_files_ids,
            selected_facet_ids: request.selected_facet_ids.clone(),
        };
        let prepare_chat_request_res =
            prepare_chat_request(&app_state, &policy, &chat, user_input, &me_profile_input).await;
        if let Err(err) = prepare_chat_request_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let PreparedChatRequest {
            chat_request,
            chat_options,
            generation_input_messages,
            generation_parameters,
        } = prepare_chat_request_res.unwrap();

        // ---- SAVE INITIAL EMPTY ASSISTANT MESSAGE (for edit) ----
        let empty_assistant_message_json = json!({ "role": "assistant", "content": [] });

        // Extract chat provider ID from generation parameters (clone to avoid borrow issues)
        let chat_provider_id = generation_parameters
            .generation_chat_provider_id
            .clone()
            .unwrap_or_else(|| "unknown".to_string());

        let initial_assistant_message = match submit_message(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &chat.id,
            empty_assistant_message_json,
            Some(&saved_user_message.id), // Previous is the new user message
            // No sibling
            None,
            Some(generation_input_messages.clone()),
            &[],
            Some(generation_parameters), // Save generation parameters with chat provider ID
            None, // Generation metadata will be added later when stream completes
        )
        .await
        {
            Ok(msg) => msg,
            Err(err) => {
                let _ = tx
                    .send(Err(err).wrap_err("Failed to submit initial assistant message for edit"))
                    .await;
                return Err(());
            }
        };

        // ---- EMIT AssistantMessageStarted ----
        let assistant_started_event: EditMessageStreamingResponseMessage =
            MessageSubmitStreamingResponseAssistantMessageStarted {
                message_id: initial_assistant_message.id,
            }
            .into();
        if let Err(()) = assistant_started_event.send_event(tx.clone()).await {
            return Err(());
        }
        // ---- END EMIT ----

        let subject = me_user.to_subject();
        let (end_content, generation_metadata) =
            stream_generate_chat_completion::<EditMessageStreamingResponseMessage>(
                tx.clone(),
                &app_state,
                &policy,
                &subject,
                chat_request,
                chat_options,
                initial_assistant_message.id, // Pass assistant_message_id
                me_user.id.clone(),           // Pass user_id
                chat.id,                      // Pass chat_id
                Some(chat_provider_id.as_str()), // Pass chat_provider_id
                &me_user.groups,              // Pass user_groups
                None,                         // No background task for edit
                chat.assistant_id,            // Pass assistant_id for Langfuse tracking
            )
            .await?;

        // Update the assistant message with generation metadata if available
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
            tracing::warn!("Failed to update generation metadata: {}", err);
            // Don't fail the entire request if metadata update fails
        }

        stream_update_assistant_message_completion::<EditMessageStreamingResponseMessage>(
            tx.clone(),
            &app_state,
            &policy,
            end_content,
            &me_user,
            initial_assistant_message.id,
        )
        .await?;

        Ok::<(), ()>(())
    });

    // Convert the receiver into a stream and return it
    let receiver_stream = tokio_stream::wrappers::ReceiverStream::<Result<Event, Report>>::new(rx);
    let inspected_stream = futures::StreamExt::inspect(receiver_stream, |event| {
        if let Err(err) = event {
            capture_report(err);
        }
    });

    Ok(Sse::new(inspected_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    ))
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
) -> Result<Sse<impl Stream<Item = Result<Event, Report>>>, (axum::http::StatusCode, String)> {
    // Verify user has access to this chat
    let _chat = get_or_create_chat(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        Some(&request.chat_id),
        &me_user.id,
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

    // Get the background task for this chat
    let task = app_state
        .background_tasks
        .get_task(&request.chat_id)
        .await
        .ok_or((
            axum::http::StatusCode::NOT_FOUND,
            "No active generation task found for this chat".to_string(),
        ))?;

    // Get the event history
    let event_history = task.get_event_history().await;

    // Subscribe to live events
    let broadcast_rx = task.subscribe();

    // Create a stream that first replays history, then switches to live events
    use futures::stream::{self, StreamExt};

    // Convert history to a stream
    let history_stream = stream::iter(event_history.into_iter().map(Ok::<_, eyre::Report>));

    // Convert broadcast receiver to stream
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

    // Chain history and live streams
    let combined_stream = futures::StreamExt::chain(history_stream, live_stream);

    // Convert StreamingEvents to SSE Events
    let event_stream = futures::StreamExt::filter_map(combined_stream, |result| {
        futures::future::ready(match result {
            Ok(streaming_event) => match streaming_event_to_sse(&streaming_event) {
                Ok(sse_event) => Some(Ok(sse_event)),
                Err(e) => Some(Err(e)),
            },
            Err(e) => Some(Err(e)),
        })
    })
    .inspect(|event| {
        if let Err(err) = event {
            capture_report(err);
        }
    });

    Ok(Sse::new(event_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    ))
}
