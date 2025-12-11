use crate::db::entity::message_feedbacks;
use crate::db::entity::prelude::*;
use crate::policy::prelude::*;
use eyre::{Report, eyre};
use sea_orm::prelude::*;
use sea_orm::{DatabaseConnection, EntityTrait, Set};
use std::collections::HashMap;

/// Submit or update feedback for a message
///
/// This function creates a new feedback record or updates an existing one for a given message.
/// Authorization is checked to ensure the user owns the chat containing the message.
pub async fn submit_or_update_feedback(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    message_id: &Uuid,
    sentiment: String,
    comment: Option<String>,
) -> Result<message_feedbacks::Model, Report> {
    // First, get the message to find which chat it belongs to
    let message = Messages::find_by_id(*message_id)
        .one(conn)
        .await?
        .ok_or_else(|| eyre!("Message with ID {} not found", message_id))?;

    // Check that the user has permission to submit feedback for this message
    // by checking if they can read the chat containing the message
    authorize!(
        policy,
        subject,
        &Resource::Chat(message.chat_id.as_hyphenated().to_string()),
        Action::Read
    )
    .map_err(|e| eyre!("Not authorized to submit feedback for this message: {}", e))?;

    // Also check the specific submit_feedback permission
    authorize!(
        policy,
        subject,
        &Resource::MessageFeedback(message_id.as_hyphenated().to_string()),
        Action::SubmitFeedback
    )
    .map_err(|e| eyre!("Not authorized to submit feedback: {}", e))?;

    // Validate sentiment
    if sentiment != "positive" && sentiment != "negative" {
        return Err(eyre!("Sentiment must be either 'positive' or 'negative'"));
    }

    // Check if feedback already exists for this message
    let existing_feedback = MessageFeedbacks::find()
        .filter(message_feedbacks::Column::MessageId.eq(*message_id))
        .one(conn)
        .await?;

    let feedback = if let Some(existing) = existing_feedback {
        // Update existing feedback
        let mut active_feedback: message_feedbacks::ActiveModel = existing.into();
        active_feedback.sentiment = Set(sentiment);
        active_feedback.comment = Set(comment);
        active_feedback.update(conn).await?
    } else {
        // Create new feedback
        let new_feedback = message_feedbacks::ActiveModel {
            message_id: Set(*message_id),
            sentiment: Set(sentiment),
            comment: Set(comment),
            ..Default::default()
        };
        new_feedback.insert(conn).await?
    };

    Ok(feedback)
}

/// Get feedbacks for multiple messages efficiently
///
/// This function bulk fetches feedback records for a list of message IDs,
/// returning a HashMap for efficient lookup.
pub async fn get_feedbacks_for_messages(
    conn: &DatabaseConnection,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, message_feedbacks::Model>, Report> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let feedbacks = MessageFeedbacks::find()
        .filter(message_feedbacks::Column::MessageId.is_in(message_ids.iter().copied()))
        .all(conn)
        .await?;

    let mut feedback_map = HashMap::new();
    for feedback in feedbacks {
        feedback_map.insert(feedback.message_id, feedback);
    }

    Ok(feedback_map)
}
