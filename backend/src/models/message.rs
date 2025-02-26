use crate::db::entity::messages;
use crate::db::entity::prelude::*;
use crate::policy::prelude::*;
use eyre::{eyre, Report};
use sea_orm::prelude::*;
use sea_orm::{ActiveValue, DatabaseConnection, EntityTrait};
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
pub async fn submit_message(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: &Uuid,
    raw_message: JsonValue,
    previous_message_id: Option<&Uuid>,
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

    // Determine the order_index for the new message
    let order_index = if let Some(prev_msg_id) = previous_message_id {
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

        // Increment the order_index
        previous_message.order_index + 1
    } else {
        0
    };

    // Create and insert the new message
    let new_message = messages::ActiveModel {
        chat_id: ActiveValue::Set(*chat_id),
        order_index: ActiveValue::Set(order_index),
        raw_message: ActiveValue::Set(raw_message),
        ..Default::default()
    };

    let created_message = messages::Entity::insert(new_message)
        .exec_with_returning(conn)
        .await?;

    Ok(created_message)
}
