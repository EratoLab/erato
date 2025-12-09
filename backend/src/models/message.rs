use crate::db::entity::messages;
use crate::db::entity::prelude::*;
use crate::models::pagination;
use crate::policy::prelude::*;
use crate::server::api::v1beta::message_streaming::FileContentsForGeneration;
use eyre::{Report, eyre};
use sea_orm::prelude::*;
use sea_orm::{
    ActiveValue, DatabaseConnection, EntityTrait, QueryOrder, QuerySelect, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, to_value};
use std::fmt;
use utoipa::ToSchema;

/// Parameters used for generating a message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationParameters {
    /// The chat provider ID that was used to generate the message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation_chat_provider_id: Option<String>,
}

/// Metadata about the generation process, including usage statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

/// Role of the message author
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

#[derive(Serialize, Deserialize, ToSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    InProgress,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ToolUse {
    pub tool_call_id: String,
    pub status: ToolCallStatus,
    pub tool_name: String,
    pub progress_message: Option<String>,
    pub input: Option<JsonValue>,
    pub output: Option<JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
#[serde(tag = "content_type")]
pub enum ContentPart {
    Text(ContentPartText),
    ToolUse(ToolUse),
    TextFilePointer(ContentPartTextFilePointer),
    ImageFilePointer(ContentPartImageFilePointer),
    Image(ContentPartImage),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartText {
    pub text: String,
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
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ContentPartImage {
    pub content_type: String,
    pub base64_data: String,
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
        serde_json::from_value(json.clone()).map_err(|e| eyre!("Invalid message format: {}", e))
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
                ContentPart::ToolUse(_) => None,
                ContentPart::TextFilePointer(_) => None,
                ContentPart::ImageFilePointer(_) => None,
                ContentPart::Image(_) => None,
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
) -> Result<messages::Model, Report> {
    // Validate the message format
    MessageSchema::validate(&raw_message)?;
    let generation_input_messages: Option<JsonValue> =
        generation_input_messages.map(to_value).transpose()?;
    let generation_parameters_json: Option<JsonValue> =
        generation_parameters.map(to_value).transpose()?;
    let generation_metadata_json: Option<JsonValue> =
        generation_metadata.map(to_value).transpose()?;

    // Authorize that the subject can submit messages to this chat
    authorize!(
        policy,
        subject,
        &Resource::Chat(chat_id.as_hyphenated().to_string()),
        Action::SubmitMessage
    )?;

    if let Some(prev_msg_id) = previous_message_id {
        // Find the previous message
        let previous_message = Messages::find_by_id(*prev_msg_id)
            .one(conn)
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
            .one(conn)
            .await?
            .ok_or_else(|| eyre!("Sibling message with ID {} not found", sibling_id))?;

        // Verify that the sibling message belongs to the same chat
        if sibling_message.chat_id != *chat_id {
            return Err(eyre!(
                "Sibling message does not belong to the specified chat"
            ));
        }
    }

    // Begin a transaction
    let txn = conn
        .begin()
        .await
        .map_err(|e| eyre!("Failed to begin transaction: {}", e))?;

    // Step 1: Set is_message_in_active_thread to false for all messages in the chat
    let update_all = messages::ActiveModel {
        is_message_in_active_thread: ActiveValue::Set(false),
        ..Default::default()
    };

    messages::Entity::update_many()
        .set(update_all)
        .filter(messages::Column::ChatId.eq(*chat_id))
        .exec(&txn)
        .await
        .map_err(|e| eyre!("Failed to update all messages: {}", e))?;

    // Step 2: If there's a previous message, recursively set is_message_in_active_thread to true
    // for all messages in the lineage
    if let Some(prev_msg_id) = previous_message_id {
        let mut current_msg_id = *prev_msg_id;

        // Keep track of visited message IDs to avoid infinite loops
        let mut visited_ids = std::collections::HashSet::new();

        while !visited_ids.contains(&current_msg_id) {
            visited_ids.insert(current_msg_id);

            // Set the current message to active
            let update = messages::ActiveModel {
                id: ActiveValue::Set(current_msg_id),
                is_message_in_active_thread: ActiveValue::Set(true),
                ..Default::default()
            };

            messages::Entity::update(update)
                .filter(messages::Column::Id.eq(current_msg_id))
                .exec(&txn)
                .await
                .map_err(|e| eyre!("Failed to update message {}: {}", current_msg_id, e))?;

            // Get the previous message ID
            let message = Messages::find_by_id(current_msg_id)
                .one(&txn)
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
        ..Default::default()
    };

    let created_message = messages::Entity::insert(new_message)
        .exec_with_returning(&txn)
        .await
        .map_err(|e| eyre!("Failed to insert new message: {}", e))?;

    // Commit the transaction
    txn.commit()
        .await
        .map_err(|e| eyre!("Failed to commit transaction: {}", e))?;

    Ok(created_message)
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

    // Set default pagination values
    let limit = limit.unwrap_or(100);
    let offset = offset.unwrap_or(0);

    // Query messages for this chat with pagination, ordered by creation time
    let messages = Messages::find()
        .filter(messages::Column::ChatId.eq(*chat_id))
        .order_by_desc(messages::Column::CreatedAt)
        .limit(limit)
        .offset(offset)
        .all(conn)
        .await?;

    // Use our pagination utility to efficiently calculate the total count
    let (total_count, has_more) =
        pagination::calculate_total_count(offset, limit, messages.len(), || async {
            Messages::find()
                .filter(messages::Column::ChatId.eq(*chat_id))
                .count(conn)
                .await
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

    parsed_raw_message.content = new_content_parts;
    let updated_raw_message = parsed_raw_message.to_json()?;

    let active_model = messages::ActiveModel {
        id: ActiveValue::Set(*message_id),
        raw_message: ActiveValue::Set(updated_raw_message),
        ..Default::default() // Only update raw_message, preserve other fields
    };

    messages::Entity::update(active_model)
        .filter(messages::Column::Id.eq(*message_id))
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
        .filter(messages::Column::Id.eq(*message_id))
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
            ContentPart::ToolUse(_) => String::new(),
            ContentPart::TextFilePointer(_) => String::new(),
            ContentPart::ImageFilePointer(_) => String::new(),
            ContentPart::Image(_) => String::new(),
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
            base_history = Some(GenerationInputMessages::validate(gen_input_json)?);
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
                // Placeholder URL - will be resolved to base64 when sending to LLM
                download_url: String::new(),
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
