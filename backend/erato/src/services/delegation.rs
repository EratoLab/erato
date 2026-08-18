//! In-chat delegation to @-mentioned assistants.

use crate::policy::prelude::*;
use crate::state::AppState;
use axum::http::StatusCode;
use sea_orm::prelude::Uuid;

/// Deduplicates mentioned assistant ids preserving first-mention order.
pub fn dedupe_mentions(ids: &[Uuid]) -> Vec<Uuid> {
    let mut seen = std::collections::HashSet::new();
    ids.iter().copied().filter(|id| seen.insert(*id)).collect()
}

/// A validated assistant the current turn may delegate to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DelegationTarget {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
}

/// Validates the `mentioned_assistant_ids` of a streaming request and resolves
/// them into delegation targets.
///
/// Rules, all enforced server-side: mentions require
/// `assistants.delegation.enabled`; ids are deduplicated preserving order;
/// the deduplicated count is capped by
/// `assistants.delegation.max_mentions_per_message`; the chat's own bound
/// assistant cannot be mentioned; every id must resolve through the checked
/// owner-or-viewer assistant lookup, which also rejects archived assistants.
/// The error message deliberately does not distinguish missing, archived, and
/// inaccessible assistants.
pub async fn validate_mentioned_assistants(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    mentioned_assistant_ids: Option<&[Uuid]>,
    chat_bound_assistant_id: Option<Uuid>,
) -> Result<Vec<DelegationTarget>, (StatusCode, String)> {
    let Some(ids) = mentioned_assistant_ids else {
        return Ok(Vec::new());
    };
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let delegation = &app_state.config.assistants.delegation;
    if !delegation.enabled {
        return Err((
            StatusCode::BAD_REQUEST,
            "Assistant delegation is not enabled".to_string(),
        ));
    }

    let deduped = dedupe_mentions(ids);

    if deduped.len() > delegation.max_mentions_per_message {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "At most {} assistants can be mentioned per message",
                delegation.max_mentions_per_message
            ),
        ));
    }

    let mut targets = Vec::with_capacity(deduped.len());
    for assistant_id in deduped {
        if Some(assistant_id) == chat_bound_assistant_id {
            return Err((
                StatusCode::BAD_REQUEST,
                "The chat's own assistant cannot be mentioned for delegation".to_string(),
            ));
        }
        let assistant = crate::models::assistant::get_assistant_by_id(
            &app_state.db,
            policy,
            subject,
            assistant_id,
        )
        .await
        .map_err(|error| {
            tracing::debug!(
                %assistant_id,
                %error,
                "Rejecting mentioned assistant"
            );
            (
                StatusCode::BAD_REQUEST,
                format!("Mentioned assistant {assistant_id} is not available"),
            )
        })?;
        targets.push(DelegationTarget {
            id: assistant.id,
            name: assistant.name,
            description: assistant.description,
        });
    }

    Ok(targets)
}

/// Replay-stable variant for mentions read back from a persisted user message
/// (regenerate without the request field, edit fallback): validation failures
/// drop the mentions with a warning instead of failing the turn, mirroring how
/// a stored action facet that no longer validates is dropped on replay.
pub async fn resolve_persisted_mentions(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    persisted_ids: Option<&[Uuid]>,
    chat_bound_assistant_id: Option<Uuid>,
) -> Vec<DelegationTarget> {
    match validate_mentioned_assistants(
        app_state,
        policy,
        subject,
        persisted_ids,
        chat_bound_assistant_id,
    )
    .await
    {
        Ok(targets) => targets,
        Err((_, message)) => {
            tracing::warn!("Dropping persisted assistant mentions on replay: {message}");
            Vec::new()
        }
    }
}
