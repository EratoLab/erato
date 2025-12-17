use crate::db::entity::message_feedbacks;
use crate::db::entity::prelude::*;
use crate::models::message::GenerationMetadata;
use crate::policy::prelude::*;
use crate::services::langfuse::{CreateScoreRequest, LangfuseClient};
use eyre::{Report, eyre};
use sea_orm::prelude::*;
use sea_orm::{DatabaseConnection, EntityTrait, Set};
use std::collections::HashMap;

/// Submit or update feedback for a message
///
/// This function creates a new feedback record or updates an existing one for a given message.
/// Authorization is checked to ensure the user owns the chat containing the message.
/// If Langfuse feedback forwarding is enabled, the feedback is also sent to Langfuse as a score.
#[allow(clippy::too_many_arguments)]
pub async fn submit_or_update_feedback(
    conn: &DatabaseConnection,
    policy: &PolicyEngine,
    subject: &Subject,
    message_id: &Uuid,
    sentiment: String,
    comment: Option<String>,
    langfuse_client: &LangfuseClient,
    enable_feedback: bool,
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
        active_feedback.sentiment = Set(sentiment.clone());
        active_feedback.comment = Set(comment.clone());
        active_feedback.update(conn).await?
    } else {
        // Create new feedback
        let new_feedback = message_feedbacks::ActiveModel {
            message_id: Set(*message_id),
            sentiment: Set(sentiment.clone()),
            comment: Set(comment.clone()),
            ..Default::default()
        };
        new_feedback.insert(conn).await?
    };

    // Forward feedback to Langfuse if enabled
    if enable_feedback {
        // Try to get the Langfuse trace_id from the message's generation_metadata
        let langfuse_trace_id = message
            .generation_metadata
            .as_ref()
            .and_then(|metadata_json| {
                serde_json::from_value::<GenerationMetadata>(metadata_json.clone()).ok()
            })
            .and_then(|metadata| metadata.langfuse_trace_id);

        if let Some(trace_id) = langfuse_trace_id {
            let sentiment_value = if sentiment == "positive" { 1.0 } else { 0.0 };
            // Generate deterministic score ID based on trace_id so updates override previous feedback
            let score_id = format!("{}-user-feedback", trace_id);
            let environment = langfuse_client.environment().map(|s| s.to_string());

            let score_request = CreateScoreRequest {
                id: score_id,
                trace_id,
                name: "user-feedback".to_string(),
                value: sentiment_value,
                comment: comment.clone(),
                data_type: "NUMERIC".to_string(),
                environment,
            };

            // Send score asynchronously - don't fail the feedback submission if Langfuse fails
            let langfuse_client_clone = langfuse_client.clone();
            tokio::spawn(async move {
                if let Err(e) = langfuse_client_clone.create_score(score_request).await {
                    tracing::warn!(
                        error = %e,
                        "Failed to forward feedback to Langfuse"
                    );
                } else {
                    tracing::debug!("Successfully forwarded feedback to Langfuse");
                }
            });
        } else {
            tracing::debug!(
                message_id = %message_id,
                "No Langfuse trace_id found in message metadata, skipping feedback forwarding"
            );
        }
    }

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
