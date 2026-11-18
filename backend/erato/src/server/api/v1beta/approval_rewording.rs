//! The natural reading of a waiting approval card: the client sends the
//! card's precise pieces, and gets each one back either as the precise text
//! or as a wording that passed the rule check. It decides nothing, stores
//! nothing and never touches the chat stream.

use super::approval_access::check_waiting_approval_of_user;
use super::me_profile_middleware::MeProfile;
use crate::config::ApprovalSpeechStyle;
use crate::policy::engine::PolicyEngine;
use crate::services::approval_rewording::{
    DEFAULT_PROMPT, InputProblem, Outcome, RewordInput, RewordModel, RewordPiece, Reworded,
    check::allowed_words, check_input, precise, reword,
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
pub struct ApprovalRewordingRequest {
    /// The language the pieces are in, as a tag such as `de`.
    pub language: String,
    /// The spoken card's pieces in the order they are said, at most 16, each
    /// at most 400 and all together at most 2000 characters, each with at
    /// most 24 facts of at most 200 characters.
    pub pieces: Vec<RewordPiece>,
}

/// Reword a waiting approval card the way a native speaker would say it.
///
/// Answers every piece, in the request's order and with its id: a checked
/// wording, or the precise text when the piece may not be reworded (the
/// consequence, the request to decide), the wording fails the check, or the
/// model is too slow or fails. Only for users whose reading style is
/// natural.
#[utoipa::path(
    post,
    path = "/me/messages/{message_id}/approval-rewording",
    params(("message_id" = Uuid, Path, description = "The assistant message whose approval waits")),
    request_body = ApprovalRewordingRequest,
    responses(
        (status = OK, body = Reworded),
        (status = BAD_REQUEST, description = "No pieces, a piece id twice or empty, or a language that is not a tag"),
        (status = NOT_FOUND, description = "The user's reading style is precise, or the message does not exist or is not in a chat of the user"),
        (status = CONFLICT, description = "The message has no approval waiting for a decision"),
        (status = PAYLOAD_TOO_LARGE, description = "More than 16 pieces, a piece over 400 characters, more than 2000 characters in all, or too many or too long facts")
    ),
    security(("bearer_auth" = []))
)]
pub async fn reword_approval(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(message_id): Path<Uuid>,
    Json(request): Json<ApprovalRewordingRequest>,
) -> Result<Json<Reworded>, StatusCode> {
    let config = &app_state.config.approval_speech;
    if config.style_for(me_user.preference_approval_speech_style) != ApprovalSpeechStyle::Natural {
        return Err(StatusCode::NOT_FOUND);
    }
    let input = RewordInput {
        language: request.language.trim(),
        pieces: &request.pieces,
    };
    check_input(&input).map_err(|problem| match problem {
        InputProblem::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        InputProblem::Invalid => StatusCode::BAD_REQUEST,
    })?;

    check_waiting_approval_of_user(&app_state, &policy, &me_user, &message_id).await?;

    let start = Instant::now();
    let deadline =
        tokio::time::Instant::now() + Duration::from_millis(u64::from(config.model_timeout_ms));
    let outcome = ask_model(&app_state, &policy, &me_user, &input, deadline).await?;
    // The pieces hold the call's values; they stay out of the log.
    tracing::info!(
        %message_id,
        outcome = outcome.outcome,
        natural = outcome.reworded.pieces.iter().filter(|piece| piece.natural).count(),
        rejected = outcome.rejected.len(),
        rejections = ?outcome.rejected.iter().map(|(_, rejection)| rejection.kind()).collect::<Vec<_>>(),
        elapsed_ms = start.elapsed().as_millis() as u64,
        "Reworded a waiting approval card"
    );
    Ok(Json(outcome.reworded))
}

/// The model's checked wordings, or the precise card without one. Reading
/// the user's model permissions and the model call share one deadline.
async fn ask_model(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    input: &RewordInput<'_>,
    deadline: tokio::time::Instant,
) -> Result<Outcome, StatusCode> {
    let provider = match app_state.chat_provider_for_approval_speech() {
        Some(Ok(provider)) => provider,
        Some(Err(error)) => {
            tracing::warn!(%error, "Approval cards are read precisely: their provider is not usable");
            return Ok(precise(input, "no_model"));
        }
        None => return Ok(precise(input, "no_model")),
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
                "Approval cards are read precisely: the user's model permissions do not include their provider"
            );
            return Ok(precise(input, "not_permitted"));
        }
        Ok(Err(error)) => {
            tracing::warn!(%error, "Approval cards are read precisely: reading the user's model permissions failed");
            return Ok(precise(input, "permissions_failed"));
        }
        Err(_) => return Ok(precise(input, "timeout")),
    }
    let client = app_state
        .genai_for_chat_provider_config_with_headers_context(
            provider.chat_provider_config.clone(),
            None,
        )
        .map_err(log_internal_server_error)?;
    let config = &app_state.config.approval_speech;
    let prompt = config
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .unwrap_or(DEFAULT_PROMPT);
    let language = crate::services::approval_rewording::check::primary(input.language);
    let configured = config
        .words
        .get(language)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let allowed = allowed_words(language, configured);
    let model = RewordModel {
        client: client.as_ref(),
        config: &provider.chat_provider_config,
        prompt,
        allowed: &allowed,
        timeout: deadline.saturating_duration_since(tokio::time::Instant::now()),
    };
    Ok(reword(input, &model).await)
}
