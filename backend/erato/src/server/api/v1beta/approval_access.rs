//! Who may act on a waiting approval by voice: the owner of the chat, while
//! the approval still waits for a decision.

use super::me_profile_middleware::MeProfile;
use super::message_streaming::parked_approval_state;
use crate::models::chat::get_chat_by_message_id;
use crate::models::message::{MessageSchema, get_message_by_id};
use crate::policy::engine::PolicyEngine;
use crate::services::sentry::log_internal_server_error;
use crate::state::AppState;
use axum::http::StatusCode;
use uuid::Uuid;

/// `Ok` for a message in the user's own chat with an approval waiting. A
/// message the user may not read, or one in a chat they do not own, answers
/// 404; one with nothing left to decide answers 409.
pub(crate) async fn check_waiting_approval_of_user(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    message_id: &Uuid,
) -> Result<(), StatusCode> {
    check_approval_of_user(app_state, policy, me_user, message_id, false).await
}

/// Like [`check_waiting_approval_of_user`], and also `Ok` once a change
/// request on the message was answered without a new card: the voice then
/// says that nothing was run. Only for speaking, never for acting on a card.
pub(crate) async fn check_spoken_approval_of_user(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    message_id: &Uuid,
) -> Result<(), StatusCode> {
    check_approval_of_user(app_state, policy, me_user, message_id, true).await
}

async fn check_approval_of_user(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    message_id: &Uuid,
    after_change_request: bool,
) -> Result<(), StatusCode> {
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
    let message = get_message_by_id(&app_state.db, policy, &subject, message_id)
        .await
        .map_err(not_found)?;
    // A chat shared for reading is not one the reader decides in.
    let chat = get_chat_by_message_id(&app_state.db, policy, &subject, message_id)
        .await
        .map_err(not_found)?;
    if chat.owner_user_id != me_user.id {
        return Err(StatusCode::NOT_FOUND);
    }
    let parsed =
        MessageSchema::validate(&message.raw_message).map_err(log_internal_server_error)?;
    let waiting =
        parked_approval_state(&parsed.content).is_some_and(|state| !state.decidable().is_empty());
    let change_answered = after_change_request
        && crate::services::approval_change_requests::answered_without_card(&parsed.content);
    if !waiting && !change_answered {
        return Err(StatusCode::CONFLICT);
    }
    Ok(())
}
