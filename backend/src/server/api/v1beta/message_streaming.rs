use crate::db::entity_ext::{chats, messages};
use crate::models::chat::{
    get_chat_by_message_id, get_or_create_chat, get_or_create_chat_by_previous_message_id,
    ChatCreationStatus,
};
use crate::models::file_upload::get_file_upload_by_id;
use crate::models::message::{
    get_generation_input_messages_by_previous_message_id, get_message_by_id, submit_message,
    ContentPart, ContentPartText, GenerationInputMessages, MessageSchema,
    ToolCallStatus as MessageToolCallStatus, ToolUse,
};
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::server::api::v1beta::ChatMessage;
use crate::services::file_storage::FileStorage;
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
use std::time::Duration;
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
) -> Result<(ChatRequest, ChatOptions, GenerationInputMessages), Report> {
    // TODO: Initial system message?
    let generation_input_messages = get_generation_input_messages_by_previous_message_id(
        &app_state.db,
        app_state.system_prompt.clone(),
        previous_message_id,
        Some(10),
        new_input_files,
    )
    .await?;
    let mut chat_request = generation_input_messages.clone().into_chat_request();
    let chat_options = ChatOptions::default()
        .with_capture_content(true)
        .with_capture_tool_calls(true);

    let mcp_server_tools = app_state.mcp_servers.list_tools().await;

    let tools = convert_mcp_tools_to_genai_tools(mcp_server_tools);
    if !tools.is_empty() {
        chat_request.tools = Some(tools);
    } else {
        tracing::trace!("Not adding empty list of tools, as that may lead to hallucinated tools");
    }

    Ok((chat_request, chat_options, generation_input_messages))
}

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
) -> Result<Vec<ContentPart>, ()> {
    let max_tool_call_iterations = 15;
    let mut unfinished_tool_calls: Vec<genai::chat::ToolCall> = vec![];
    let mut current_turn = 0;
    let mut current_tool_call_count = 0;

    let mut current_message_content: Vec<ContentPart> = vec![];
    let mut current_turn_chat_request = chat_request.clone();
    'loop_call_turns: loop {
        current_turn += 1;
        tracing::debug!("Starting chat completion turn {}", current_turn);

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
            .genai_for_chatcompletion(None)
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
            #[allow(clippy::collapsible_match)]
            #[allow(clippy::single_match)]
            if let Some(captured_texts) = stream_end.captured_texts() {
                for captured_text in captured_texts {
                    current_message_content.push(ContentPart::Text(ContentPartText {
                        text: captured_text.into(),
                    }));
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
                    break 'loop_call_turns Ok(current_message_content);
                }
            } else {
                break 'loop_call_turns Ok(current_message_content);
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
    let mut chat_options = ChatOptions::default()
        .with_capture_content(true)
        // NOTE: Desired tokens are more like ~30, but we have some buffer in case a reasoning model is used
        .with_max_tokens(300);

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

        let end = stream_generate_chat_completion::<MessageSubmitStreamingResponseMessage>(
            tx.clone(),
            &app_state,
            chat_request,
            chat_options,
            initial_assistant_message.id, // Pass assistant_message_id
        )
        .await?;

        stream_update_assistant_message_completion::<MessageSubmitStreamingResponseMessage>(
            tx.clone(),
            &app_state,
            &policy,
            end,
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

        let end = stream_generate_chat_completion::<RegenerateMessageStreamingResponseMessage>(
            tx.clone(),
            &app_state,
            chat_request,
            chat_options,
            initial_assistant_message.id, // Pass assistant_message_id
        )
        .await?;

        stream_update_assistant_message_completion::<RegenerateMessageStreamingResponseMessage>(
            tx.clone(),
            &app_state,
            &policy,
            end,
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

        // Get the previous message (user message) to get the chat + required message content
        let previous_message_res = get_message_by_id(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &message_to_edit
                .previous_message_id
                .expect("Expected previous message ID"),
        )
        .await;
        if let Err(err) = previous_message_res {
            let _ = tx.send(Err(err)).await;
            return Err(());
        }
        let previous_message = previous_message_res.unwrap();

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
            previous_message.previous_message_id.as_ref(),
            Some(&previous_message.id),
            None,
            &request.replace_input_files_ids,
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
        let initial_assistant_message = match submit_message(
            &app_state.db,
            &policy,
            &me_user.to_subject(),
            &chat.id,
            empty_assistant_message_json,
            Some(&saved_user_message.id), // Previous is the new user message
            Some(&request.message_id), // Sibling is the original assistant message being replaced
            Some(generation_input_messages.clone()),
            &[],
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

        let end = stream_generate_chat_completion::<EditMessageStreamingResponseMessage>(
            tx.clone(),
            &app_state,
            chat_request,
            chat_options,
            initial_assistant_message.id, // Pass assistant_message_id
        )
        .await?;

        stream_update_assistant_message_completion::<EditMessageStreamingResponseMessage>(
            tx.clone(),
            &app_state,
            &policy,
            end,
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
