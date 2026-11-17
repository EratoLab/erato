//! What the user said while an approval card waits, as one meaning from a
//! closed list. The answer names no words to speak and decides nothing.

use super::me_profile_middleware::{MeProfile, normalize_supported_language};
use super::message_streaming::parked_approval_state;
use crate::models::chat::get_chat_by_message_id;
use crate::models::message::{MessageSchema, get_message_by_id};
use crate::policy::engine::PolicyEngine;
use crate::services::approval_voice_commands::{
    CardPiece, DEFAULT_PROMPT, InputProblem, VoiceCommand, VoiceCommandInput, VoiceModel,
    check_input, classify,
};
use crate::services::delegation::TaskModelPermissions;
use crate::services::sentry::log_internal_server_error;
use crate::state::AppState;
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use std::time::{Duration, Instant};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Deserialize, ToSchema)]
pub struct ApprovalVoiceCommandRequest {
    /// What the user said, as transcribed. At most 300 characters.
    pub transcript: String,
    /// The language of the words as a tag such as `de`; the user's language
    /// when omitted.
    #[serde(default)]
    #[schema(nullable = false)]
    pub language: Option<String>,
    /// The spoken card's pieces in the order they are said, at most 16.
    pub pieces: Vec<CardPiece>,
    /// The piece being spoken, or the last one spoken.
    #[serde(default)]
    #[schema(nullable = false)]
    pub current_piece_id: Option<String>,
}

/// Match what the user said while an approval card waits to one meaning.
///
/// Built-in rules answer the plain words; a configured model may answer the
/// rest, seeing the words and the pieces' roles and field names. The answer
/// carries no text, approves nothing and is not stored. `approve` and
/// `reject` are reported so the caller can say that decisions are made on
/// screen.
#[utoipa::path(
    post,
    path = "/me/messages/{message_id}/approval-voice-command",
    params(("message_id" = Uuid, Path, description = "The assistant message whose approval waits")),
    request_body = ApprovalVoiceCommandRequest,
    responses(
        (status = OK, body = VoiceCommand),
        (status = BAD_REQUEST, description = "Empty words, a piece id twice or empty, or a current piece that is not on the card"),
        (status = NOT_FOUND, description = "Voice commands are off, or the message does not exist or is not in a chat of the user"),
        (status = CONFLICT, description = "The message has no approval waiting for a decision"),
        (status = PAYLOAD_TOO_LARGE, description = "Words over 300 characters, more than 16 pieces, a piece id over 64 or a field name over 100 characters")
    ),
    security(("bearer_auth" = []))
)]
pub async fn interpret_approval_voice_command(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(message_id): Path<Uuid>,
    Json(request): Json<ApprovalVoiceCommandRequest>,
) -> Result<Json<VoiceCommand>, StatusCode> {
    let config = &app_state.config.approval_voice_commands;
    if !config.enabled {
        return Err(StatusCode::NOT_FOUND);
    }
    let language = normalize_supported_language(request.language.as_deref())
        .or_else(|| normalize_supported_language(me_user.preference_language.as_deref()))
        .unwrap_or(&me_user.preferred_language)
        .to_string();
    let input = VoiceCommandInput {
        transcript: &request.transcript,
        language: &language,
        pieces: &request.pieces,
        current_piece_id: request.current_piece_id.as_deref(),
    };
    check_input(&input).map_err(|problem| match problem {
        InputProblem::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        InputProblem::Invalid => StatusCode::BAD_REQUEST,
    })?;

    policy
        .rebuild_data_if_needed_req(&app_state.db, &app_state.config)
        .await?;
    let not_found = |error: eyre::Report| {
        let text = error.to_string().to_lowercase();
        if text.contains("not found") || text.contains("not authorized") {
            StatusCode::NOT_FOUND
        } else {
            log_internal_server_error(error)
        }
    };
    let subject = me_user.to_subject();
    let message = get_message_by_id(&app_state.db, &policy, &subject, &message_id)
        .await
        .map_err(not_found)?;
    // A chat shared for reading is not one the reader decides in.
    let chat = get_chat_by_message_id(&app_state.db, &policy, &subject, &message_id)
        .await
        .map_err(not_found)?;
    if chat.owner_user_id != me_user.id {
        return Err(StatusCode::NOT_FOUND);
    }
    let parsed =
        MessageSchema::validate(&message.raw_message).map_err(log_internal_server_error)?;
    if parked_approval_state(&parsed.content).is_none_or(|state| state.decidable().is_empty()) {
        return Err(StatusCode::CONFLICT);
    }

    let timeout = Duration::from_millis(u64::from(config.model_timeout_ms));
    let prompt = config
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .unwrap_or(DEFAULT_PROMPT);
    let provider = match app_state.chat_provider_for_approval_voice_commands() {
        Some(Ok(provider)) => {
            let permitted = tokio::time::timeout(
                timeout,
                TaskModelPermissions::for_user(&app_state, &policy, &subject, &me_user.groups),
            )
            .await;
            match permitted {
                Ok(Ok(permissions)) if permissions.may_use(&provider.chat_provider_id) => {
                    Some(provider)
                }
                Ok(Ok(_)) => {
                    tracing::info!(
                        "Voice commands use the rules only: the user's model permissions do not include their provider"
                    );
                    None
                }
                Ok(Err(error)) => {
                    tracing::warn!(%error, "Voice commands use the rules only: reading the user's model permissions failed");
                    None
                }
                Err(_) => {
                    tracing::warn!(
                        "Voice commands use the rules only: reading the user's model permissions timed out"
                    );
                    None
                }
            }
        }
        Some(Err(error)) => {
            tracing::warn!(%error, "Voice commands use the rules only: their provider is not usable");
            None
        }
        None => None,
    };
    let client = match &provider {
        Some(provider) => Some(
            app_state
                .genai_for_chat_provider_config_with_headers_context(
                    provider.chat_provider_config.clone(),
                    None,
                )
                .map_err(log_internal_server_error)?,
        ),
        None => None,
    };
    let model = provider
        .as_ref()
        .zip(client.as_deref())
        .map(|(provider, client)| VoiceModel {
            client,
            config: &provider.chat_provider_config,
            prompt,
            timeout,
        });

    let start = Instant::now();
    let classified = classify(&input, model).await;
    // The user's words stay out of the log.
    tracing::info!(
        %message_id,
        meaning = classified.command.meaning.wire_name(),
        outcome = classified.outcome,
        elapsed_ms = start.elapsed().as_millis() as u64,
        "Matched a voice command on a waiting approval"
    );
    Ok(Json(classified.command))
}
