use crate::db::entity::messages;
use crate::db::entity::prelude::*;
use crate::policy::prelude::*;
use eyre::{eyre, Report};
use sea_orm::prelude::*;
use sea_orm::{ActiveValue, DatabaseConnection, EntityTrait, QueryOrder};
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

    // If this is a sibling message, we need to update the active thread status
    // of the existing sibling to make it inactive
    if let Some(sibling_id) = sibling_message_id {
        let update = messages::ActiveModel {
            id: ActiveValue::Set(*sibling_id),
            is_message_in_active_thread: ActiveValue::Set(false),
            ..Default::default()
        };

        // Update the sibling message to be inactive in the thread
        messages::Entity::update(update)
            .filter(messages::Column::Id.eq(*sibling_id))
            .exec(conn)
            .await?;
    }

    // Create and insert the new message
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
        .exec_with_returning(conn)
        .await?;

    Ok(created_message)
}

/// Get all messages for a chat.
///
/// This function retrieves all messages for a given chat ID, after checking that
/// the subject has read permission for the chat.
pub async fn get_chat_messages(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
) -> Result<Vec<messages::Model>, Report> {
    // Authorize that the subject can read this chat
    authorize!(
        policy,
        subject,
        &Resource::Chat(chat_id.as_hyphenated().to_string()),
        Action::Read
    )?;

    // Query all messages for this chat, ordered by creation time
    let messages = Messages::find()
        .filter(messages::Column::ChatId.eq(*chat_id))
        .order_by_asc(messages::Column::CreatedAt)
        .all(conn)
        .await?;

    Ok(messages)
}
