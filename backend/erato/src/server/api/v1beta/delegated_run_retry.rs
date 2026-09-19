//! Retry a failed delegated task run.
//!
//! The failure this route exists for is the one that leaves no trace anywhere
//! else: a child reaped after a replica crash writes no result and no delivery
//! record, so the backstop sweep - which scans deliveries in `pending` or
//! `claimed` - finds nothing to requeue, and the origin's dispatch slot still
//! reads "dispatched". The only signal left is the runs-list badge, which is
//! why the client affordance on that list is the one that must never be cut.
//!
//! A retry starts a NEW async child carrying the original brief, the old
//! child's budgets, persona and scheduling, and its facets re-authorized for
//! the owner. Nothing about the failed run is rewritten: its provenance keeps
//! the failure on the record, and only the new child records `retry_of`.

use crate::models::chat::DelegateRoute;
use crate::models::message::ProvenanceRunMode;
use crate::policy::engine::{PolicyEngine, authorize};
use crate::policy::types::{Action, Resource};
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::server::api::v1beta::message_streaming::GenerationRunningError;
use crate::services::delegation::{
    DelegationTargetSpec, EffectiveTasksConfig, LaunchOutcome, LaunchRunSpec, TaskOfferScope,
};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use sea_orm::prelude::Uuid;

/// What a client asks to have retried.
///
/// Exactly ONE variant, deliberately. The Foundations contract also describes
/// retrying a stuck result *delivery*, but that half is not built, so
/// `"delivery"` must be an unknown serde variant - a `422` the client can act
/// on - rather than a value this route accepts and then refuses with a `409`
/// that would read like a transient condition. Adding a variant here without
/// the rest of the work is what `retry_with_an_unknown_kind_is_422` exists to
/// catch.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RetryKind {
    Task,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RetryDelegatedRunRequest {
    pub kind: RetryKind,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RetryDelegatedRunResponse {
    /// The new child run started to replace the failed one.
    pub child_chat_id: String,
}

/// Why a run cannot be retried. A closed vocabulary, because the client
/// switches on it to choose between hiding the control, linking to the run
/// that already replaced this one, and showing a reason.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotRetryableState {
    /// A replacement for this run is already working.
    RetryInFlight,
    /// The run finished with an answer; there is nothing to retry.
    Completed,
    /// The run has not settled yet, so it has not failed either.
    Working,
    /// The run came from an @-mention, not from a planned task.
    NotATaskRun,
    /// The origin's own record of the call is gone, so the brief cannot be
    /// rebuilt.
    BriefUnavailable,
    /// The owner is already at the concurrent detached-run limit.
    ConcurrencyCap,
    /// The launch itself refused; `message` carries its reason.
    LaunchRefused,
}

/// Body of the `409` answers that mean "not this run".
///
/// Distinct from [`GenerationRunningError`] for the reason 781-B's
/// `NothingToReactError` is: that one says "not now", this one says "not this
/// run". `code` is what the client discriminates on.
#[derive(Debug, Serialize, ToSchema)]
pub struct NotRetryableError {
    /// Always `not_retryable`.
    pub code: String,
    pub state: NotRetryableState,
    /// The child run the client asked to retry.
    pub chat_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Error type of the retry route, shaped after `StreamRouteError`.
#[derive(Debug)]
pub enum RetryRouteError {
    PlainText(StatusCode, String),
    NotRetryable(Box<NotRetryableError>),
    GenerationRunning(Box<GenerationRunningError>),
}

impl From<(StatusCode, String)> for RetryRouteError {
    fn from((status, message): (StatusCode, String)) -> Self {
        RetryRouteError::PlainText(status, message)
    }
}

impl IntoResponse for RetryRouteError {
    fn into_response(self) -> axum::response::Response {
        match self {
            RetryRouteError::PlainText(status, message) => (status, message).into_response(),
            // Both JSON bodies share `409` deliberately: both are "the server
            // will not start this run". The client tells them apart on `code`,
            // which is why neither is plain text.
            RetryRouteError::NotRetryable(body) => (StatusCode::CONFLICT, Json(*body)).into_response(),
            RetryRouteError::GenerationRunning(body) => {
                (StatusCode::CONFLICT, Json(*body)).into_response()
            }
        }
    }
}

/// One status and one body for a disabled feature, an unknown chat, a chat
/// somebody else owns and a child that is not parented to it - so a prober
/// cannot use the difference to learn which chats exist.
fn retry_not_found() -> RetryRouteError {
    RetryRouteError::PlainText(StatusCode::NOT_FOUND, "Not found".to_string())
}

fn not_retryable(chat_id: Uuid, state: NotRetryableState) -> RetryRouteError {
    RetryRouteError::NotRetryable(Box::new(NotRetryableError {
        code: "not_retryable".to_string(),
        state,
        chat_id,
        message: None,
    }))
}

fn not_retryable_with_message(
    chat_id: Uuid,
    state: NotRetryableState,
    message: String,
) -> RetryRouteError {
    RetryRouteError::NotRetryable(Box::new(NotRetryableError {
        code: "not_retryable".to_string(),
        state,
        chat_id,
        message: Some(message),
    }))
}

/// Re-dispatch a failed delegated task run as a new async child.
#[utoipa::path(
    post,
    path = "/me/chats/{chat_id}/delegated_runs/{child_chat_id}/retry",
    params(
        ("chat_id" = String, Path, description = "The origin chat the run was dispatched from"),
        ("child_chat_id" = String, Path, description = "The failed delegated run to retry")
    ),
    request_body = RetryDelegatedRunRequest,
    responses(
        (status = ACCEPTED, body = RetryDelegatedRunResponse, description = "A replacement run was dispatched"),
        (status = BAD_REQUEST, description = "Invalid chat ID format"),
        (status = NOT_FOUND, description = "When async tasks are disabled, or the origin chat or the run does not exist or is not accessible"),
        (status = CONFLICT, body = NotRetryableError, description = "When the origin chat is archived (plain text), the origin's generation lease is held (JSON, code = generation_running, body = GenerationRunningError), or the run cannot be retried (JSON, code = not_retryable)"),
        (status = UNPROCESSABLE_ENTITY, description = "When `kind` is not a kind this server retries"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided"),
        (status = INTERNAL_SERVER_ERROR, description = "When an internal server error occurs")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn retry_delegated_run(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path((chat_id, child_chat_id)): Path<(String, String)>,
    Json(request): Json<RetryDelegatedRunRequest>,
) -> Result<(StatusCode, Json<RetryDelegatedRunResponse>), RetryRouteError> {
    // One variant today; the match is what a new one would have to answer to.
    match request.kind {
        RetryKind::Task => {}
    }

    // 1. The gate, the same predicate `/react` and `frontend_environment` use.
    //    With async tasks off there is no such thing as a retryable run, so the
    //    route does not exist rather than refusing with a reason.
    if !app_state.config.delegation.tasks.enabled
        || !app_state
            .config
            .delegation
            .tasks
            .run_modes
            .contains(&erato_config::config::TaskRunMode::Async)
    {
        return Err(retry_not_found());
    }

    // 2. A malformed id is the client's mistake, not a missing chat.
    let chat_id = Uuid::parse_str(&chat_id).map_err(|_| {
        RetryRouteError::PlainText(StatusCode::BAD_REQUEST, "Invalid chat ID".to_string())
    })?;
    let child_chat_id = Uuid::parse_str(&child_chat_id).map_err(|_| {
        RetryRouteError::PlainText(StatusCode::BAD_REQUEST, "Invalid chat ID".to_string())
    })?;

    // 3-4. The origin chat, through the policy engine's own loader.
    policy
        .rebuild_data_if_needed_req(&app_state.db, &app_state.config)
        .await
        .map_err(|status| RetryRouteError::PlainText(status, "Failed to load chat".to_string()))?;
    let origin_chat = policy
        .load_chat_model(&app_state.db, chat_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, %chat_id, "Failed to load the origin chat for a run retry");
            RetryRouteError::PlainText(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load chat".to_string(),
            )
        })?
        .ok_or_else(retry_not_found)?;

    // 5. `SubmitMessage`, not `Read` and not `Update`: this route starts a
    //    turn, so read access to a shared chat must not be enough to reach it.
    //    The same choice `/react` made one release earlier for the same
    //    question. Refused and "the authorizer broke" both answer 404, because
    //    a 500 here would tell a prober the chat exists.
    if let Err(error) = authorize!(
        policy,
        &me_user.to_subject(),
        &Resource::Chat(chat_id.as_hyphenated().to_string()),
        Action::SubmitMessage
    ) {
        tracing::warn!(%error, %chat_id, "Refused a delegated run retry");
        return Err(retry_not_found());
    }

    // 6. An archived origin takes no new runs. Without this the archive
    //    cascade would archive the replacement moments after it started, and
    //    the delivery sweep would then supersede its result as
    //    `origin_archived` - a retry that could never land.
    crate::server::api::v1beta::message_streaming::reject_if_archived(&origin_chat)?;

    // 7. The child, and its parentage. A child of another origin - or of
    //    another owner - must be indistinguishable from a missing one.
    let child_chat = policy
        .load_chat_model(&app_state.db, child_chat_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, %child_chat_id, "Failed to load the delegated run to retry");
            RetryRouteError::PlainText(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load chat".to_string(),
            )
        })?
        .ok_or_else(retry_not_found)?;
    if child_chat.owner_user_id != origin_chat.owner_user_id {
        return Err(retry_not_found());
    }
    let child_configuration = crate::models::chat::parse_chat_configuration(&child_chat)
        .map_err(|error| {
            tracing::warn!(%error, %child_chat_id, "Unreadable configuration on a delegated run");
            RetryRouteError::PlainText(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load chat".to_string(),
            )
        })?
        .ok_or_else(retry_not_found)?;
    let provenance = child_configuration
        .provenance
        .as_ref()
        .ok_or_else(retry_not_found)?;
    if provenance.origin_chat_id != Some(chat_id) {
        return Err(retry_not_found());
    }

    // 8. Only a planned task run can be retried. A mention run is bound to an
    //    assistant this route would have to re-resolve and re-authorize, and
    //    re-dispatching it as a bare task would silently drop that binding.
    let spec = child_configuration
        .task
        .as_ref()
        .filter(|spec| spec.route == DelegateRoute::Task)
        .ok_or_else(|| not_retryable(child_chat_id, NotRetryableState::NotATaskRun))?;

    // 9. The outcome gate, read with the recent-chats listing's own
    //    expression, so the badge that offered the control and the gate that
    //    honours it can never disagree.
    let stale_after_secs = app_state.config.generation_status.stale_after_secs;
    let outcome = crate::models::chat::delegated_run_outcome_for_chat(
        &app_state.db,
        &child_chat_id,
        stale_after_secs,
    )
    .await
    .map_err(|error| {
        tracing::warn!(%error, %child_chat_id, "Failed to read a delegated run's outcome");
        RetryRouteError::PlainText(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load chat".to_string(),
        )
    })?;
    match outcome.as_deref() {
        Some("failed") => {}
        Some(_) => return Err(not_retryable(child_chat_id, NotRetryableState::Completed)),
        // No answer yet: live, parked on an approval, or a chat with no
        // messages at all - which the listing hides for the same reason.
        None => return Err(not_retryable(child_chat_id, NotRetryableState::Working)),
    }

    // 10. One live retry per failed run. This is the whole bound on a retry
    //     storm, and it is read from the database rather than from the client
    //     so that a reload cannot reopen the button.
    if crate::models::chat::find_working_retry_child(&app_state.db, &child_chat_id, stale_after_secs)
        .await
        .map_err(|error| {
            tracing::warn!(%error, %child_chat_id, "Failed to look for a working retry child");
            RetryRouteError::PlainText(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load chat".to_string(),
            )
        })?
        .is_some()
    {
        return Err(not_retryable(child_chat_id, NotRetryableState::RetryInFlight));
    }

    // 11. The ORIGIN's lease, read-only. NO lease is taken here, deliberately,
    //     and that is the asymmetry with every other write route: this request
    //     does not write into the origin chat, it starts a child. Holding the
    //     origin's lease for the length of a dispatch would block the user's
    //     own next turn over work that is not happening in their chat. The read
    //     still matters, because a turn that is mid-flight may be about to
    //     write into this very conversation.
    if crate::models::chat::chat_generation_is_running(&app_state.db, &chat_id, stale_after_secs)
        .await
        .map_err(|error| {
            tracing::warn!(%error, %chat_id, "Failed to read the origin chat's generation state");
            RetryRouteError::PlainText(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load chat".to_string(),
            )
        })?
    {
        return Err(RetryRouteError::GenerationRunning(Box::new(
            GenerationRunningError {
                code: "generation_running".to_string(),
                chat_id,
                initiator: "user".to_string(),
                started_at: origin_chat
                    .generation_started_at
                    .map(|started| started.to_rfc3339()),
            },
        )));
    }

    // 12. The concurrency cap, pre-checked. This duplicates the check inside
    //     `launch_delegation` and is racy by one request against it - two
    //     retries arriving together can both pass here. That is accepted,
    //     because it is the only way to answer with the `concurrency_cap`
    //     discriminator at all: the launch seam returns a bare `Err(String)`
    //     for every refusal alike, and the seam remains the authority that
    //     actually enforces the cap.
    let cap = app_state.config.delegation.max_concurrent_background_runs;
    if cap > 0 {
        let in_flight = crate::models::chat::count_running_background_delegated_runs(
            &app_state.db,
            &origin_chat.owner_user_id,
            stale_after_secs,
        )
        .await
        .map_err(|error| {
            tracing::warn!(%error, "Failed to count in-flight detached delegated runs");
            RetryRouteError::PlainText(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load chat".to_string(),
            )
        })?;
        if in_flight >= cap as u64 {
            return Err(not_retryable(
                child_chat_id,
                NotRetryableState::ConcurrencyCap,
            ));
        }
    }

    // 13. The brief, from the origin model's own persisted call. A missing
    //     call is a real refusal: there is deliberately no reconstruction from
    //     the child's own rows, which are the run's output rather than the
    //     request that produced it.
    let recovered = crate::models::message::find_delegation_tool_call(
        &app_state.db,
        &chat_id,
        &child_chat_id,
        spec.parent_tool_call_id.as_deref(),
    )
    .await
    .map_err(|error| {
        tracing::warn!(%error, %child_chat_id, "Failed to recover the origin delegation call");
        RetryRouteError::PlainText(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load chat".to_string(),
        )
    })?
    .ok_or_else(|| not_retryable(child_chat_id, NotRetryableState::BriefUnavailable))?;
    let brief = crate::services::delegation::brief_from_persisted_task_args(&recovered.input)
        .map_err(|error| {
            tracing::warn!(%error, %child_chat_id, "Unusable recorded delegation arguments");
            not_retryable(child_chat_id, NotRetryableState::BriefUnavailable)
        })?;

    // 14. Facets, re-authorized for the owner as of now. A facet the owner has
    //     lost since dispatch is DROPPED, not refused: the run is still worth
    //     retrying without it, and refusing would leave the user with a failed
    //     run and no way forward.
    let mut facet_ids = spec.facet_ids.clone();
    if !facet_ids.is_empty() {
        let authorized = policy
            .filter_authorized_facet_ids(&me_user.to_subject(), &me_user.groups, &facet_ids)
            .await
            .map_err(|error| {
                tracing::warn!(%error, "Failed to re-authorize a retried run's facets");
                RetryRouteError::PlainText(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load chat".to_string(),
                )
            })?;
        facet_ids.retain(|facet_id| authorized.contains(facet_id));
    }

    // The origin chat's attachments as they stand now, so a brief that named
    // files can still be dispatched. `launch_delegation` validates each named
    // id against this list, exactly as it does on the live path - a file
    // detached since dispatch refuses the launch rather than silently changing
    // the brief, which is the behaviour the live path already has.
    let offered_file_ids: Vec<Uuid> = crate::models::file_upload::get_chat_file_uploads(
        &app_state.db,
        &policy,
        &me_user.to_subject(),
        &chat_id,
    )
    .await
    .map_err(|error| {
        tracing::warn!(%error, %chat_id, "Failed to list the origin chat's attachments");
        RetryRouteError::PlainText(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load chat".to_string(),
        )
    })?
    .into_iter()
    .map(|file| file.id)
    .collect();

    // 15. The synthetic scope. `task_scope: None` is not an option: the launch
    //     reads the per-task budgets off it, and `None` there makes the child's
    //     budgets `None` too, which turns the graceful cap arm off and makes
    //     the retry fail HARDER than the run it replaces. Only `persona` and
    //     the two budgets are read on this path; the rest is written to satisfy
    //     the type, with the old run's values where it has them.
    let tasks = &app_state.config.delegation.tasks;
    let task_scope = TaskOfferScope {
        facet_enum: facet_ids.clone(),
        effective: EffectiveTasksConfig {
            max_tasks_per_turn: 1,
            max_parallel: 1,
            max_server_tool_calls_per_task: spec
                .max_server_tool_calls_per_task
                .unwrap_or(tasks.max_server_tool_calls_per_task),
            max_client_tool_calls_per_task: spec
                .max_client_tool_calls_per_task
                .unwrap_or(tasks.max_client_tool_calls_per_task),
            persona: spec.persona,
            // Set for honesty; the value that actually reaches the child's
            // `TaskSpec` is the one on `LaunchRunSpec` below.
            scheduling: spec.scheduling,
            run_modes: vec![erato_config::config::TaskRunMode::Async],
            child_facet_ids: facet_ids.clone(),
        },
    };

    let context = crate::server::api::v1beta::message_streaming::DelegationDispatchContext {
        me_user: &me_user,
        // Empty: targets are the mention route's, and a task run names none.
        targets: &[],
        offered_file_ids: &offered_file_ids,
        origin_chat: &origin_chat,
        // The user message of the turn that made the original call, so the
        // replacement is anchored where the original was rather than to the
        // conversation's current tip.
        origin_user_message_id: recovered
            .previous_message_id
            .unwrap_or(recovered.message_id),
        // Unread on the task route: `DelegationRunMode` has no `Async` variant
        // and this field is consumed only by the mention route, which a retry
        // never reaches. The run's async-ness lives on `LaunchRunSpec` below.
        run_mode: crate::models::message::DelegationRunMode::Background,
        background_dispatches: std::sync::atomic::AtomicUsize::new(0),
        task_scope: Some(task_scope),
        tasks_this_turn: std::sync::atomic::AtomicUsize::new(0),
    };

    let launched = crate::services::delegation::launch_delegation(
        &app_state,
        &policy,
        &context,
        DelegationTargetSpec::Task {
            facet_ids: facet_ids.clone(),
        },
        LaunchRunSpec {
            run_mode: ProvenanceRunMode::Async,
            // From the OLD RUN, not from the config default: a run dispatched
            // `silent` must come back silent, or the retry produces exactly the
            // unrequested reaction turn the original avoided.
            scheduling: spec.scheduling,
            parent_tool_call_id: spec
                .parent_tool_call_id
                .clone()
                .or_else(|| Some(recovered.tool_call_id.clone())),
            retry_of: Some(child_chat_id),
        },
        brief,
    )
    .await;

    match launched {
        Ok(LaunchOutcome::Dispatched {
            delegate_chat_id, ..
        }) => Ok((
            StatusCode::ACCEPTED,
            Json(RetryDelegatedRunResponse {
                child_chat_id: delegate_chat_id.to_string(),
            }),
        )),
        // An awaited outcome on a detached request is a bug in the launch
        // seam, not a user-visible condition. The run is stopped rather than
        // left alive, because nothing on this path will ever await it and an
        // orphaned child would hold a concurrency slot until it timed out.
        Ok(LaunchOutcome::Launched(launched)) => {
            tracing::error!(
                %child_chat_id,
                new_child_chat_id = %launched.child_chat_id,
                "A retry dispatched as async came back awaited; aborting the child"
            );
            launched.child_task.request_abort();
            Err(RetryRouteError::PlainText(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to start the retry".to_string(),
            ))
        }
        Err(message) => Err(not_retryable_with_message(
            child_chat_id,
            NotRetryableState::LaunchRefused,
            message,
        )),
    }
}
