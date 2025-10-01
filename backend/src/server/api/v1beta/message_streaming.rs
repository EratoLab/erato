use crate::db::entity_ext::{chats, messages};
use crate::models::chat::{
    get_chat_by_message_id, get_or_create_chat, get_or_create_chat_by_previous_message_id,
    ChatCreationStatus,
};
use crate::models::file_upload::get_file_upload_by_id;
use crate::models::message::{
    get_generation_input_messages_by_previous_message_id, get_message_by_id, submit_message,
    update_message_generation_metadata, ContentPart, ContentPartText, GenerationInputMessages,
    GenerationMetadata, GenerationParameters, MessageRole, MessageSchema,
    ToolCallStatus as MessageToolCallStatus, ToolUse,
};
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::server::api::v1beta::ChatMessage;
use crate::services::file_storage::FileStorage;
use crate::services::genai_langfuse::{
    create_trace_request_from_chat, generate_langfuse_ids, generate_name_from_chat_request,
    LangfuseGenerationBuilder,
};
use crate::services::mcp_manager::convert_mcp_tools_to_genai_tools;
use crate::services::sentry::capture_report;
use crate::state::AppState;
use axum::extract::State;
use axum::response::sse::Event;
use axum::response::Sse;
use axum::{Extension, Json};
use eyre::{eyre, Report};
use eyre::{OptionExt, WrapErr};
use futures::Stream;
use genai::chat::{
    ChatMessage as GenAiChatMessage, ChatOptions, ChatRequest, ChatRole, ChatStreamEvent,
    MessageContent, ReasoningEffort, StreamChunk, StreamEnd,
};
use sea_orm::prelude::Uuid;
use sea_orm::JsonValue;
use serde::Serialize;
use serde_json::json;
use std::time::{Duration, SystemTime};
use tokio::sync::mpsc::Sender;
use tokio_stream::StreamExt as _;
use tracing;
use utoipa::ToSchema;

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
    progress_message: Option<String>,
    output: Option<JsonValue>,
}

trait SendAsSseEvent {
    fn tag(&self) -> &'static str;
    fn data_json(&self) -> Result<String, Report>;

    async fn send_event(&self, tx: Sender<Result<Event, Report>>) -> Result<(), ()> {
        match self.data_json() {
            Ok(json) => {
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

#[derive(serde::Deserialize, ToSchema)]
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

#[derive(serde::Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct RegenerateMessageRequest {
    #[schema(example = "00000000-0000-0000-0000-000000000000")]
    /// The ID of the message that should have a replacement response generated.
    current_message_id: Uuid,
    #[schema(example = "primary")]
    /// The ID of the chat provider to use for generation. If not provided, will use the highest priority model for the user.
    chat_provider_id: Option<String>,
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
}

impl SendAsSseEvent for RegenerateMessageStreamingResponseMessage {
    fn tag(&self) -> &'static str {
        match self {
            Self::AssistantMessageStarted(_) => "assistant_message_started",
            Self::AssistantMessageCompleted(_) => "assistant_message_completed",
            Self::TextDelta(_) => "text_delta",
            Self::ToolCallProposed(_) => "tool_call_proposed",
            Self::ToolCallUpdate(_) => "tool_call_update",
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

async fn stream_get_or_create_chat<
    MSG: SendAsSseEvent + From<MessageSubmitStreamingResponseChatCreated>,
>(
    tx: Sender<Result<Event, Report>>,
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    previous_message_id: Option<&Uuid>,
    existing_chat_id: Option<&Uuid>,
) -> Result<(chats::Model, ChatCreationStatus), ()> {
    // If existing_chat_id is provided, use it directly
    if let Some(existing_chat_id) = existing_chat_id {
        // Get or create the chat using the existing chat ID
        let result = get_or_create_chat(
            &app_state.db,
            policy,
            &me_user.to_subject(),
            Some(existing_chat_id),
            &me_user.0.id,
        )
        .await;

        match result {
            Ok((chat, chat_status)) => {
                // Even though we're using an existing chat, we don't need to emit a chat_created event
                // as the client already knows about it
                Ok((chat, chat_status))
            }
            Err(err) => {
                let _ = tx
                    .send(Err(err).wrap_err("Failed to get existing chat"))
                    .await;
                Err(())
            }
        }
    } else {
        // Get or create the chat using the previous message ID
        let result = get_or_create_chat_by_previous_message_id(
            &app_state.db,
            policy,
            &me_user.to_subject(),
            previous_message_id,
            &me_user.0.id,
        )
        .await;

        // Send chat created event if the chat was newly created
        match result {
            Ok((chat, chat_status)) => {
                if chat_status == ChatCreationStatus::Created {
                    let inner_msg = MessageSubmitStreamingResponseChatCreated { chat_id: chat.id };
                    let chat_created: MSG = inner_msg.into();
                    chat_created.send_event(tx.clone()).await?;
                }
                Ok((chat, chat_status))
            }
            Err(err) => {
                let _ = tx
                    .send(Err(err).wrap_err("Failed to get or create chat"))
                    .await;
                Err(())
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn stream_save_user_message<
    MSG: SendAsSseEvent + From<MessageSubmitStreamingResponseUserMessageSaved>,
>(
    tx: Sender<Result<Event, Report>>,
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    chat: &chats::Model,
    previous_message_id: Option<&Uuid>,
    user_message: &str,
    input_files_ids: &[Uuid],
) -> Result<messages::Model, ()> {
    // Create and save the user's message
    let user_message = json!({
        "role": "user",
        "content": vec![json!({
            "content_type": "text",
            "text": user_message.to_owned()})],
        "name": me_user.0.id
    });

    let saved_user_message = match submit_message(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &chat.id,
        user_message,
        previous_message_id,
        // TODO: Add support for sibling message regenerate
        None,
        None,
        input_files_ids,
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

    let saved_user_message_wrapped = match ChatMessage::from_model(saved_user_message.clone()) {
        Ok(msg) => msg,
        Err(err) => {
            let _ = tx
                .send(Err(err).wrap_err("Failed to submit user message"))
                .await;
            return Err(());
        }
    };

    // Send user message saved event
    let user_message_saved: MSG = MessageSubmitStreamingResponseUserMessageSaved {
        message_id: saved_user_message.id,
        message: saved_user_message_wrapped,
    }
    .into();
    user_message_saved.send_event(tx.clone()).await?;
    Ok(saved_user_message)
}

async fn prepare_chat_request(
    app_state: &AppState,
    previous_message_id: &Uuid,
    new_input_files: Vec<FileContentsForGeneration>,
    user_groups: &[String],
    requested_chat_provider_id: Option<&str>,
) -> Result<(ChatRequest, ChatOptions, GenerationInputMessages), Report> {
    // Resolve system prompt dynamically based on chat provider configuration
    let chat_provider_config =
        app_state.chat_provider_for_chatcompletion(requested_chat_provider_id, user_groups)?;
    let system_prompt = app_state.get_system_prompt(&chat_provider_config).await?;

    let generation_input_messages = get_generation_input_messages_by_previous_message_id(
        &app_state.db,
        system_prompt,
        previous_message_id,
        Some(10),
        new_input_files,
    )
    .await?;
    let mut chat_request = generation_input_messages.clone().into_chat_request();
    let chat_options = ChatOptions::default()
        .with_capture_content(true)
        .with_capture_tool_calls(true)
        .with_capture_usage(true);

    let mcp_server_tools = app_state.mcp_servers.list_tools().await;

    let tools = convert_mcp_tools_to_genai_tools(mcp_server_tools);
    if !tools.is_empty() {
        chat_request.tools = Some(tools);
    } else {
        tracing::trace!("Not adding empty list of tools, as that may lead to hallucinated tools");
    }

    Ok((chat_request, chat_options, generation_input_messages))
}

#[allow(clippy::too_many_arguments)]
async fn stream_generate_chat_completion<
    MSG: SendAsSseEvent
        + From<MessageSubmitStreamingResponseMessageTextDelta>
        + From<MessageSubmitStreamingResponseToolCallProposed>
        + From<MessageSubmitStreamingResponseToolCallUpdate>,
>(
    tx: Sender<Result<Event, Report>>,
    app_state: &AppState,
    chat_request: ChatRequest,
    chat_options: ChatOptions,
    assistant_message_id: Uuid,
    user_id: String,
    chat_id: Uuid,
    chat_provider_id: Option<&str>,
    user_groups: &[String],
) -> Result<(Vec<ContentPart>, Option<GenerationMetadata>), ()> {
    // Initialize Langfuse tracing if enabled
    let langfuse_enabled = app_state.config.integrations.langfuse.enabled
        && app_state.config.integrations.langfuse.tracing_enabled;

    let (langfuse_observation_id, langfuse_trace_id, langfuse_generation_name) = if langfuse_enabled
    {
        let (obs_id, trace_id) = generate_langfuse_ids();
        let generation_name = generate_name_from_chat_request(&chat_request);

        tracing::debug!(
            "Starting Langfuse tracing for generation: obs_id={}, trace_id={}, name={:?}",
            obs_id,
            trace_id,
            generation_name
        );

        (Some(obs_id), Some(trace_id), generation_name)
    } else {
        (None, None, None)
    };
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
            tracing::warn!("Trying to progress chat completion after first iteration without open tool calls. Will likely result in error.")
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
                    tool_call_id: unfinished_tool_call.call_id,
                    tool_name: unfinished_tool_call.fn_name,
                    input: Some(unfinished_tool_call.fn_arguments),
                };
                let message: MSG = proposed_call.into();
                message.send_event(tx.clone()).await?;
            }

            let managed_tool_call = app_state
                .mcp_servers
                .convert_tool_call_to_managed_tool_call(unfinished_tool_call.clone())
                .await
                .unwrap();
            match app_state.mcp_servers.call_tool(managed_tool_call).await {
                Ok(tool_call_result) => {
                    // Emit event for tool call proposed
                    {
                        let finished_tool_call = unfinished_tool_call.clone();
                        let proposed_call = MessageSubmitStreamingResponseToolCallUpdate {
                            message_id: assistant_message_id,
                            content_index: current_message_content.len(),
                            tool_call_id: finished_tool_call.call_id,
                            tool_name: finished_tool_call.fn_name,
                            input: Some(finished_tool_call.fn_arguments),
                            status: ToolCallStatus::Success,
                            progress_message: None,
                            // TODO: Not sure if that should always be JSON?
                            output: serde_json::from_str(&tool_call_result.content)
                                .ok()
                                .or(Some(JsonValue::String(tool_call_result.content.clone()))),
                        };
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
                            output: serde_json::from_str(&tool_call_result.content)
                                .ok()
                                .or(Some(JsonValue::String(tool_call_result.content.clone()))),
                        }));
                    }

                    current_turn_tool_responses.push(tool_call_result)
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
                content: MessageContent::ToolResponses(current_turn_tool_responses.clone()),
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
                let _ = tx
                    .send(Err(err).wrap_err("Failed to start chat stream with LLM provider"))
                    .await;
                return Err(());
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
                            new_text: content,
                        };
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
                    } else {
                        let _ = tx.send(Err(err).wrap_err("Error from chat stream")).await;
                        return Err(());
                    }
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
                if let Some(details) = &usage.completion_tokens_details {
                    if let Some(reasoning_tokens) = details.reasoning_tokens {
                        total_reasoning_tokens += reasoning_tokens as u32;
                    }
                }
            }

            // Send Langfuse tracing for this turn if enabled
            if langfuse_enabled {
                if let (Some(obs_id), Some(trace_id), Some(turn_start)) = (
                    langfuse_observation_id.as_ref(),
                    langfuse_trace_id.as_ref(),
                    turn_start_time,
                ) {
                    let turn_end_time = SystemTime::now();
                    let model_name = match app_state.config.determine_chat_provider(None, None) {
                        Ok(provider_id) => app_state
                            .config
                            .get_chat_provider(provider_id)
                            .model_name
                            .clone(),
                        Err(_) => "unknown".to_string(),
                    };

                    // Generate a unique observation ID for this turn
                    let turn_obs_id = format!("{}_turn_{}", obs_id, current_turn);

                    // Get the content generated in this turn
                    let turn_content = &current_message_content[turn_content_start_index..];

                    // Build the Langfuse generation request for this turn
                    let mut builder = LangfuseGenerationBuilder::new(turn_obs_id, trace_id.clone())
                        .with_model(model_name)
                        .with_start_time(turn_start)
                        .with_end_time(turn_end_time);

                    if let Some(ref name) = langfuse_generation_name {
                        builder = builder.with_name(format!("{} (turn {})", name, current_turn));
                    } else {
                        builder =
                            builder.with_name(format!("chat_completion_turn_{}", current_turn));
                    }

                    // Use the usage information from this turn's stream_end
                    let turn_usage = stream_end.captured_usage.as_ref();

                    match builder.build(&current_turn_chat_request, turn_content, turn_usage) {
                        Ok(langfuse_generation_request) => {
                            // Create trace request for the first turn, or use existing trace for subsequent turns
                            let trace_request_result = if current_turn == 1 {
                                create_trace_request_from_chat(
                                    langfuse_trace_id.clone().unwrap(),
                                    &current_turn_chat_request,
                                    Some(user_id.clone()),
                                    Some(chat_id.to_string()),
                                )
                            } else {
                                // For subsequent turns, we don't need to create a new trace
                                Ok(crate::services::langfuse::CreateTraceRequest {
                                    id: langfuse_trace_id.clone().unwrap(),
                                    name: None,
                                    user_id: None,
                                    session_id: None,
                                    input: None,
                                    output: None,
                                    metadata: None,
                                    tags: None,
                                    public: None,
                                })
                            };

                            match trace_request_result {
                                Ok(trace_request) => {
                                    let langfuse_client = app_state.langfuse_client.clone();
                                    tokio::spawn(async move {
                                        // For first turn, create trace and generation together
                                        // For subsequent turns, just create the generation
                                        let result = if current_turn == 1 {
                                            langfuse_client
                                                .create_trace_with_generation(
                                                    trace_request,
                                                    langfuse_generation_request,
                                                )
                                                .await
                                        } else {
                                            langfuse_client
                                                .finish_generation(langfuse_generation_request)
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
                                Err(err) => {
                                    tracing::warn!(
                                        "Failed to create Langfuse trace request for turn {}: {}",
                                        current_turn,
                                        err
                                    );
                                }
                            }
                        }
                        Err(err) => {
                            tracing::warn!(
                                "Failed to build Langfuse generation request for turn {}: {}",
                                current_turn,
                                err
                            );
                        }
                    }
                }
            }

            if let Some(captured_tool_calls) = stream_end.captured_tool_calls() {
                if !captured_tool_calls.is_empty() {
                    current_turn_chat_request.messages.push(GenAiChatMessage {
                        role: ChatRole::Assistant,
                        content: MessageContent::ToolCalls(
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
                    // Create generation metadata from accumulated usage
                    let generation_metadata = if total_prompt_tokens > 0
                        || total_completion_tokens > 0
                        || total_total_tokens > 0
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
                        })
                    } else {
                        None
                    };
                    break 'loop_call_turns Ok((current_message_content, generation_metadata));
                }
            } else {
                // Create generation metadata from accumulated usage
                let generation_metadata = if total_prompt_tokens > 0
                    || total_completion_tokens > 0
                    || total_total_tokens > 0
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
                    })
                } else {
                    None
                };
                break 'loop_call_turns Ok((current_message_content, generation_metadata));
            }
        } else {
            // TODO: Send error that stream ended without sending stream_end event
            break 'loop_call_turns Err(());
        }
    }
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
    message_completed_event.send_event(tx.clone()).await?;

    policy.invalidate_data().await;

    Ok(())
}

// TODO: Allow specifying different model for summary, so we don't use reasoning models for it.
/// Generate a summary of the chat, based on the first message to the chat.
pub async fn generate_chat_summary(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    chat: &chats::Model,
    first_message: &messages::Model,
) -> Result<(), Report> {
    let first_message_content = MessageSchema::validate(&first_message.raw_message)?;
    let first_message_content_text = first_message_content.full_text();

    let prompt = format!(
        "Generate a summary for the topic of the following chat, based on the first message to the chat. The summary should be a short single sentence description like e.g. `Regex Search-and-Replace with Ripgrep` or `Explain a customer support flow`. Only return that sentence and nothing else. The chat message : {}",
        first_message_content_text
    );

    let mut chat_request: ChatRequest = Default::default();
    chat_request = chat_request.append_message(GenAiChatMessage::user(prompt));
    let max_tokens = app_state.max_tokens_for_summary();
    let mut chat_options = ChatOptions::default()
        .with_capture_content(true)
        // NOTE: Desired tokens are more like ~30, but we have some buffer in case a reasoning model is used
        .with_max_tokens(max_tokens);

    // HACK: Hacky way to recognize reasoning models right now. Shouldbe replaced with capabilities mechanism in the future.
    let chat_provider = app_state.chat_provider_for_summary()?;
    if chat_provider.model_name.starts_with("o1-")
        || chat_provider.model_name.starts_with("o2-")
        || chat_provider.model_name.starts_with("o3-")
        || chat_provider.model_name.starts_with("o4-")
    {
        chat_options = chat_options.with_reasoning_effort(ReasoningEffort::Low);
    }

    let summary_completion = app_state
        .genai_for_summary()?
        .exec_chat("PLACEHOLDER_MODEL", chat_request, Some(&chat_options))
        .await
        .context("Failed to generate chat summary")?;

    let summary = summary_completion
        .first_text()
        .ok_or_else(|| eyre!("No captured content in chat stream end event, or not of type Text"))?
        .to_string();

    // Update the chat with the generated summary
    crate::models::chat::update_chat_summary(
        &app_state.db,
        policy,
        &me_user.to_subject(),
        &chat.id,
        summary,
    )
    .await
    .wrap_err("Failed to update chat summary")?;

    Ok(())
}

#[derive(Debug, Clone)]
pub struct FileContentsForGeneration {
    pub id: Uuid,
    pub filename: String,
    pub contents_as_text: String,
}

// Remove null characters from a string, so that it may be saved in Postgres.
// See https://github.com/EratoLab/erato/issues/145
pub fn remove_null_characters(s: &str) -> String {
    s.chars().filter(|&c| c != '\0').collect()
}

/// Process files attached to a message and extract their text content
async fn process_input_files(
    tx: Sender<Result<Event, Report>>,
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    input_files_ids: &[Uuid],
) -> Result<Vec<FileContentsForGeneration>, ()> {
    let mut converted_files = vec![];
    for file_id in input_files_ids {
        // Get the file upload record
        let file_upload = match get_file_upload_by_id(
            &app_state.db,
            policy,
            &me_user.to_subject(),
            file_id,
        )
        .await
        {
            Ok(file) => file,
            Err(err) => {
                let _ = tx
                    .send(
                        Err(err).wrap_err(format!("Failed to get file upload with ID {}", file_id)),
                    )
                    .await;
                return Err(());
            }
        };

        // Get the file storage provider
        let file_storage: &FileStorage = match app_state
            .file_storage_providers
            .get(&file_upload.file_storage_provider_id)
            .ok_or_eyre("File storage provider not found")
        {
            Ok(provider) => provider,
            Err(err) => {
                let _ = tx
                    .send(Err(err).wrap_err(format!(
                        "Failed to get file storage provider: {}",
                        file_upload.file_storage_provider_id
                    )))
                    .await;
                return Err(());
            }
        };

        // Read the file content
        let file_bytes = match file_storage
            .read_file_to_bytes(&file_upload.file_storage_path)
            .await
        {
            Ok(bytes) => bytes,
            Err(err) => {
                let _ = tx
                    .send(Err(err).wrap_err(format!(
                        "Failed to read file from storage: {}",
                        file_upload.file_storage_path
                    )))
                    .await;
                return Err(());
            }
        };

        // Use parser_core to extract text from the file
        match parser_core::parse(&file_bytes) {
            Ok(text_with_possible_escapes) => {
                let text = remove_null_characters(&text_with_possible_escapes);
                tracing::debug!(
                    "Successfully parsed file {}: {} (text length: {})",
                    file_upload.filename,
                    file_id,
                    text.len()
                );
                tracing::debug!("Extracted text content: {}", text);
                converted_files.push(FileContentsForGeneration {
                    id: *file_id,
                    filename: file_upload.filename,
                    contents_as_text: text,
                });
            }
            Err(err) => {
                tracing::warn!(
                    "Failed to parse file {}: {} - Error: {}",
                    file_upload.filename,
                    file_id,
                    err
                );
            }
        }
    }
    Ok(converted_files)
}

#[utoipa::path(
    post,
    path = "/me/messages/submitstream",
    request_body = MessageSubmitRequest,
    responses(
        (status = OK, content_type="text/event-stream", body = MessageSubmitStreamingResponseMessage),
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
) -> Sse<impl Stream<Item = Result<Event, Report>>> {
    // Create a channel for sending events
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Report>>(100);

    // Spawn a task to process the request and send events
    tokio::spawn(async move {
        let (chat, chat_status) =
            stream_get_or_create_chat::<MessageSubmitStreamingResponseMessage>(
                tx.clone(),
                &app_state,
                &policy,
                &me_user,
                request.previous_message_id.as_ref(),
                request.existing_chat_id.as_ref(),
            )
            .await?;

        if chat_status == ChatCreationStatus::Created {
            let policy_rebuild = policy.rebuild_data(&app_state.db).await;
            if let Err(err) = policy_rebuild {
                let _ = tx
                    .send(Err(err).wrap_err("Failed to rebuild policy data"))
                    .await;
                return Err(());
            }
        }

        let saved_user_message = stream_save_user_message::<MessageSubmitStreamingResponseMessage>(
            tx.clone(),
            &app_state,
            &policy,
            &me_user,
            &chat,
            request.previous_message_id.as_ref(),
            &request.user_message,
            &request.input_files_ids,
        )
        .await?;

        if chat_status == ChatCreationStatus::Created
            || (chat_status == ChatCreationStatus::Existing
                && request.previous_message_id.is_none())
        {
            let app_state_clone = app_state.clone();
            let policy_clone = policy.clone();
            let me_user_clone = me_user.clone();
            let chat_clone = chat.clone();
            let saved_user_message_clone = saved_user_message.clone();
            tokio::spawn(async move {
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
            });
        }

        let files_for_generation = process_input_files(
            tx.clone(),
            &app_state,
            &policy,
            &me_user,
            &request.input_files_ids,
        )
        .await?;
        let prepare_chat_request_res = prepare_chat_request(
            &app_state,
            &saved_user_message.id,
            files_for_generation.clone(),
            &me_user.0.groups,
            request.chat_provider_id.as_deref(),
        )
        .await;
        if let Err(err) = prepare_chat_request_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let (chat_request, chat_options, generation_input_messages) =
            prepare_chat_request_res.unwrap();

        // ---- SAVE INITIAL EMPTY ASSISTANT MESSAGE ----
        let empty_assistant_message_json = json!({
            "role": "assistant",
            "content": [], // Empty content
        });

        // Determine the chat provider ID that will be used for generation
        // Use the user's allowlist to filter available providers
        let chat_provider_allowlist =
            app_state.determine_chat_provider_allowlist_for_user(&me_user.0.groups);
        let allowlist_refs: Option<Vec<&str>> = chat_provider_allowlist
            .as_ref()
            .map(|list| list.iter().map(|s| s.as_str()).collect());

        let chat_provider_id = app_state
            .config
            .determine_chat_provider(
                allowlist_refs.as_deref(),
                request.chat_provider_id.as_deref(),
            )
            .unwrap_or("unknown")
            .to_string();
        let generation_parameters = GenerationParameters {
            generation_chat_provider_id: Some(chat_provider_id.clone()),
        };

        let initial_assistant_message = match submit_message(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &chat.id,
            empty_assistant_message_json,
            Some(&saved_user_message.id), // Previous is the user message
            None,                         // No sibling for a new message
            Some(generation_input_messages.clone()), // Save generation inputs
            &[],                          // Assistant messages don't have input files themselves
            Some(generation_parameters),  // Save generation parameters with chat provider ID
            None, // Generation metadata will be added later when stream completes
        )
        .await
        {
            Ok(msg) => msg,
            Err(err) => {
                let _ = tx
                    .send(Err(err).wrap_err("Failed to submit initial assistant message"))
                    .await;
                return Err(());
            }
        };

        // ---- EMIT AssistantMessageStarted ----
        let assistant_started_event: MessageSubmitStreamingResponseMessage =
            MessageSubmitStreamingResponseAssistantMessageStarted {
                message_id: initial_assistant_message.id,
            }
            .into();
        if let Err(()) = assistant_started_event.send_event(tx.clone()).await {
            return Err(()); // Propagate error if send_event failed
        }
        // ---- END EMIT AssistantMessageStarted ----

        let (end_content, generation_metadata) =
            stream_generate_chat_completion::<MessageSubmitStreamingResponseMessage>(
                tx.clone(),
                &app_state,
                chat_request,
                chat_options,
                initial_assistant_message.id, // Pass assistant_message_id
                me_user.0.id.clone(),         // Pass user_id
                chat.id,                      // Pass chat_id
                Some(chat_provider_id.as_str()), // Pass chat_provider_id
                &me_user.0.groups,            // Pass user_groups
            )
            .await?;

        // Update the assistant message with generation metadata if available
        if let Some(metadata) = generation_metadata {
            if let Err(err) = update_message_generation_metadata(
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
        }

        stream_update_assistant_message_completion::<MessageSubmitStreamingResponseMessage>(
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

    Sse::new(inspected_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    )
}

#[utoipa::path(
    post,
    path = "/me/messages/regeneratestream",
    request_body = RegenerateMessageRequest,
    responses(
        (status = OK, content_type="text/event-stream", body = RegenerateMessageStreamingResponseMessage),
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
) -> Sse<impl Stream<Item = Result<Event, Report>>> {
    // Create a channel for sending events
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Report>>(100);

    // Spawn a task to process the request and send events
    tokio::spawn(async move {
        // Get the current message in order to get previous message ID
        let current_message_res = get_message_by_id(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &request.current_message_id,
        )
        .await;
        if let Err(err) = current_message_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let current_message = current_message_res.unwrap();
        // Verify that the current message is a assistant message
        // TODO: Parse raw_message and verify
        // if current_message.role != "assistant" {
        //     let _ = tx.send(Err(eyre!("Current message is not an assistant message"))).await;
        //     return Err(());
        // }

        // Get the previous message in order to get the chat + required message content
        let previous_message_res = get_message_by_id(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &current_message
                .previous_message_id
                .expect("Expected previous message ID"),
        )
        .await;
        if let Err(err) = previous_message_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let previous_message = previous_message_res.unwrap();
        // Verify that the previous message is a user message
        // TODO: Parse raw_message and verify
        // if previous_message.role != "user" {
        //     let _ = tx.send(Err(eyre!("Previous message is not a user message"))).await;
        //     return Err(());
        // }

        let chat_res = get_chat_by_message_id(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &request.current_message_id,
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
        let files_for_generation = process_input_files(
            tx.clone(),
            &app_state,
            &policy,
            &me_user,
            &input_files_for_previous_message,
        )
        .await?;

        let prepare_chat_request_res = prepare_chat_request(
            &app_state,
            &previous_message.id,
            files_for_generation.clone(),
            &me_user.0.groups,
            request.chat_provider_id.as_deref(),
        )
        .await;
        if let Err(err) = prepare_chat_request_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let (chat_request, chat_options, generation_input_messages) =
            prepare_chat_request_res.unwrap();

        // ---- SAVE INITIAL EMPTY ASSISTANT MESSAGE (for regeneration) ----
        let empty_assistant_message_json = json!({ "role": "assistant", "content": [] });

        // Determine the chat provider ID that will be used for generation
        // Use the user's allowlist to filter available providers
        let chat_provider_allowlist =
            app_state.determine_chat_provider_allowlist_for_user(&me_user.0.groups);
        let allowlist_refs: Option<Vec<&str>> = chat_provider_allowlist
            .as_ref()
            .map(|list| list.iter().map(|s| s.as_str()).collect());

        let chat_provider_id = app_state
            .config
            .determine_chat_provider(
                allowlist_refs.as_deref(),
                request.chat_provider_id.as_deref(),
            )
            .unwrap_or("unknown")
            .to_string();
        let generation_parameters = GenerationParameters {
            generation_chat_provider_id: Some(chat_provider_id.clone()),
        };

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

        let (end_content, generation_metadata) =
            stream_generate_chat_completion::<RegenerateMessageStreamingResponseMessage>(
                tx.clone(),
                &app_state,
                chat_request,
                chat_options,
                initial_assistant_message.id, // Pass assistant_message_id
                me_user.0.id.clone(),         // Pass user_id
                chat.id,                      // Pass chat_id
                Some(chat_provider_id.as_str()), // Pass chat_provider_id
                &me_user.0.groups,            // Pass user_groups
            )
            .await?;

        // Update the assistant message with generation metadata if available
        if let Some(metadata) = generation_metadata {
            if let Err(err) = update_message_generation_metadata(
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

    Sse::new(inspected_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    )
}

#[utoipa::path(
    post,
    path = "/me/messages/editstream",
    request_body = EditMessageRequest,
    responses(
        (status = OK, content_type="text/event-stream", body = EditMessageStreamingResponseMessage),
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
) -> Sse<impl Stream<Item = Result<Event, Report>>> {
    // Create a channel for sending events
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Report>>(100);

    // Spawn a task to process the request and send events
    tokio::spawn(async move {
        // Get the message to edit to get its chat and previous message
        let message_to_edit_res = get_message_by_id(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &request.message_id,
        )
        .await;
        if let Err(err) = message_to_edit_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let message_to_edit = message_to_edit_res.unwrap();
        let message_to_edit_inner_res = MessageSchema::validate(&message_to_edit.raw_message);
        if let Err(err) = message_to_edit_inner_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let message_to_edit_inner = message_to_edit_inner_res.unwrap();
        if message_to_edit_inner.role != MessageRole::User {
            let _ = tx.send(Err(eyre!("The provided `message_id` must be the message ID of a message with role `user`."))).await;
            return Err(());
        }

        let chat_res = get_chat_by_message_id(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &request.message_id,
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
                "text": request.replace_user_message
            })],
            "name": me_user.0.id
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
            &request.replace_input_files_ids,
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

        let files_for_generation = process_input_files(
            tx.clone(),
            &app_state,
            &policy,
            &me_user,
            &request.replace_input_files_ids,
        )
        .await?;
        let prepare_chat_request_res = prepare_chat_request(
            &app_state,
            &saved_user_message.id,
            files_for_generation.clone(),
            &me_user.0.groups,
            request.chat_provider_id.as_deref(),
        )
        .await;
        if let Err(err) = prepare_chat_request_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let (chat_request, chat_options, generation_input_messages) =
            prepare_chat_request_res.unwrap();

        // ---- SAVE INITIAL EMPTY ASSISTANT MESSAGE (for edit) ----
        let empty_assistant_message_json = json!({ "role": "assistant", "content": [] });

        // Determine the chat provider ID that will be used for generation
        // Use the user's allowlist to filter available providers
        let chat_provider_allowlist =
            app_state.determine_chat_provider_allowlist_for_user(&me_user.0.groups);
        let allowlist_refs: Option<Vec<&str>> = chat_provider_allowlist
            .as_ref()
            .map(|list| list.iter().map(|s| s.as_str()).collect());

        let chat_provider_id = app_state
            .config
            .determine_chat_provider(
                allowlist_refs.as_deref(),
                request.chat_provider_id.as_deref(),
            )
            .unwrap_or("unknown")
            .to_string();
        let generation_parameters = GenerationParameters {
            generation_chat_provider_id: Some(chat_provider_id.clone()),
        };

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

        let (end_content, generation_metadata) =
            stream_generate_chat_completion::<EditMessageStreamingResponseMessage>(
                tx.clone(),
                &app_state,
                chat_request,
                chat_options,
                initial_assistant_message.id, // Pass assistant_message_id
                me_user.0.id.clone(),         // Pass user_id
                chat.id,                      // Pass chat_id
                Some(chat_provider_id.as_str()), // Pass chat_provider_id
                &me_user.0.groups,            // Pass user_groups
            )
            .await?;

        // Update the assistant message with generation metadata if available
        if let Some(metadata) = generation_metadata {
            if let Err(err) = update_message_generation_metadata(
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

    Sse::new(inspected_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(1))
            .text("keep-alive-text"),
    )
}
