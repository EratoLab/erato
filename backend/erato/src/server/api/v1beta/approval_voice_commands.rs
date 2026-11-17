//! What the user said while an approval card waits, as one meaning from a
//! closed list. The answer names no words to speak and decides nothing.

use super::approval_access::check_waiting_approval_of_user;
use super::me_profile_middleware::{MeProfile, normalize_supported_language};
use crate::policy::engine::PolicyEngine;
use crate::services::approval_voice_commands::{
    CardPiece, Classified, DEFAULT_PROMPT, InputProblem, VoiceCommand, VoiceCommandInput,
    VoiceModel, check_input, classify_by_model, classify_by_rules, classify_without_model,
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
/// screen, and only once the card's request piece was heard (or the card has
/// none): a yes or no before that, or beside a backchannel ("mhm, ja"), is
/// `noise`.
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

    check_waiting_approval_of_user(&app_state, &policy, &me_user, &message_id).await?;

    let start = Instant::now();
    let classified = match classify_by_rules(&input) {
        Some(classified) => classified,
        None => {
            let deadline = tokio::time::Instant::now()
                + Duration::from_millis(u64::from(config.model_timeout_ms));
            ask_model(&app_state, &policy, &me_user, &input, deadline).await?
        }
    };
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

/// The model's answer, or "unclear" without one. Reading the user's model
/// permissions and the model call share one deadline.
async fn ask_model(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    input: &VoiceCommandInput<'_>,
    deadline: tokio::time::Instant,
) -> Result<Classified, StatusCode> {
    let provider = match app_state.chat_provider_for_approval_voice_commands() {
        Some(Ok(provider)) => provider,
        Some(Err(error)) => {
            tracing::warn!(%error, "Voice commands use the rules only: their provider is not usable");
            return Ok(classify_without_model("no_model"));
        }
        None => return Ok(classify_without_model("no_model")),
    };
    let subject = me_user.to_subject();
    let permitted = tokio::time::timeout_at(
        deadline,
        TaskModelPermissions::for_user(app_state, policy, &subject, &me_user.groups),
    )
    .await;
    match permitted {
        Ok(Ok(permissions)) if permissions.may_use(&provider.chat_provider_id) => {}
        Ok(Ok(_)) => {
            tracing::info!(
                "Voice commands use the rules only: the user's model permissions do not include their provider"
            );
            return Ok(classify_without_model("not_permitted"));
        }
        Ok(Err(error)) => {
            tracing::warn!(%error, "Voice commands use the rules only: reading the user's model permissions failed");
            return Ok(classify_without_model("permissions_failed"));
        }
        Err(_) => return Ok(classify_without_model("timeout")),
    }
    let client = app_state
        .genai_for_chat_provider_config_with_headers_context(
            provider.chat_provider_config.clone(),
            None,
        )
        .map_err(log_internal_server_error)?;
    let prompt = app_state
        .config
        .approval_voice_commands
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .unwrap_or(DEFAULT_PROMPT);
    let model = VoiceModel {
        client: client.as_ref(),
        config: &provider.chat_provider_config,
        prompt,
        timeout: deadline.saturating_duration_since(tokio::time::Instant::now()),
    };
    Ok(classify_by_model(input, &model).await)
}
