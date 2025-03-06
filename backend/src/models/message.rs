use crate::db::entity::messages;
use crate::db::entity::prelude::*;
use crate::models::pagination;
use crate::policy::prelude::*;
use eyre::{eyre, Report};
use sea_orm::prelude::*;
use sea_orm::{
    ActiveValue, DatabaseConnection, EntityTrait, QueryOrder, QuerySelect, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::fmt;

/// Role of the message author
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

impl fmt::Display for MessageRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MessageRole::System => write!(f, "system"),
            MessageRole::User => write!(f, "user"),
            MessageRole::Assistant => write!(f, "assistant"),
        }
    }
}

/// Content of a message, which can be either a string or an array of strings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    String(String),
    Array(Vec<String>),
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
    pub content: MessageContent,

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
        match &self.content {
            MessageContent::String(content) => content.to_string(),
            MessageContent::Array(contents) => contents.join(" "),
        }
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
    generation_input_messages: Option<JsonValue>,
) -> Result<messages::Model, Report> {
    // Validate the message format
    MessageSchema::validate(&raw_message)?;

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
