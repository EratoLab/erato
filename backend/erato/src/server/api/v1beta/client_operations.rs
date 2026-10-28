//! Authenticated inbox for registered client operations. No replica addresses,
//! executor content telemetry, or stored authentication credentials.
use super::me_profile_middleware::MeProfile;
use crate::services::background_tasks::Takeover;
use crate::services::client_operations::executor_stream::{
    ExecutorStreamEvent, PresenceClaim, PresenceGuard,
};
use crate::services::client_operations::{
    ExecutorBinding, OperationRequest, OperationResult, store,
};
use crate::{policy::engine::PolicyEngine, state::AppState};
use axum::response::sse::{Event, KeepAlive};
use axum::response::{IntoResponse, Response, Sse};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

type ApiError = (StatusCode, String);
fn error(error: eyre::Report) -> ApiError {
    if error.downcast_ref::<sea_orm::DbErr>().is_some() {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Operation persistence failed".into(),
        )
    } else if error.to_string() == "Invalid operation result" {
        (StatusCode::BAD_REQUEST, "Invalid operation result".into())
    } else if error.to_string() == "Operation not found" {
        (StatusCode::NOT_FOUND, "Operation not found".into())
    } else {
        (StatusCode::CONFLICT, error.to_string())
    }
}
fn account(state: &AppState, me: &MeProfile) -> Result<Uuid, ApiError> {
    if !state.config.client_tools.durable_operations_enabled {
        return Err((StatusCode::NOT_FOUND, "Operation not found".into()));
    }
    Uuid::parse_str(&me.id).map_err(|_| (StatusCode::UNAUTHORIZED, "Invalid account".into()))
}

/// Revalidate an open operation before handing work to an executor or accepting
/// its first result. Historical committed results survive later withdrawal.
pub(super) async fn authorize_open_operation(
    state: &AppState,
    policy: &PolicyEngine,
    me: &MeProfile,
    request: &OperationRequest,
) -> Result<bool, eyre::Report> {
    use crate::models::message::{GenerationParameters, get_message_by_id};
    use crate::services::client_operations::OperationOfferContext;
    let message =
        get_message_by_id(&state.db, policy, &me.to_subject(), &request.message_id).await?;
    let chat = crate::models::chat::get_chat_by_message_id(
        &state.db,
        policy,
        &me.to_subject(),
        &message.id,
    )
    .await?;
    if me.id != request.account_id.to_string()
        || chat.id != request.chat_id
        || chat.archived_at.is_some()
        || !message.is_message_in_active_thread
    {
        return Ok(false);
    }
    let parameters: GenerationParameters = serde_json::from_value(
        message
            .generation_parameters
            .ok_or_else(|| eyre::eyre!("Missing generation parameters"))?,
    )?;
    let Some(saved) = parameters
        .client_tools
        .values()
        .find(|tool| tool.qualified_name() == request.operation_id)
    else {
        return Ok(false);
    };
    let Some(kind) = state.client_operations.for_request(request) else {
        return Ok(false);
    };
    if kind.consent() != request.consent {
        return Ok(false);
    }
    let facets: Vec<String> = parameters
        .selected_facets
        .iter()
        .filter(|(_, enabled)| **enabled)
        .map(|(id, _)| id.clone())
        .collect();
    let allowlist = super::message_streaming::effective_client_tool_allowlist(
        &state.config.facets,
        &state.config.action_facets,
        &facets,
        parameters.action_facet_id.as_deref(),
    );
    let context = parameters.request_context.unwrap_or_default();
    if saved.namespace_or_default() == erato_config::config::RESERVED_TOOL_NAMESPACE {
        if !erato_config::config::allowlist_selects_reserved_tool(&allowlist, &saved.name) {
            return Ok(false);
        }
        let offer = kind.tool_offer(&OperationOfferContext {
            config: &state.config,
            chat: &chat,
            account_id: Some(request.account_id),
            request_context: &context,
            allowlist: &allowlist,
            other_tools: parameters
                .client_tools
                .values()
                .any(|tool| tool.qualified_name() != request.operation_id),
        });
        return Ok(offer.is_some_and(|offer| {
            offer.definition.qualified_name() == request.operation_id
                && offer.binding == request.binding
        }));
    }
    if crate::models::chat::chat_is_delegated_run(&chat) {
        return Ok(false);
    }
    // A configured tool's call is never offered or dispatched under Never, so a
    // Never saved after it parked withdraws it. Ask and Always keep the call.
    if me.profile.client_tool_decisions.get(&request.operation_id)
        == Some(&crate::models::user_preference::ClientToolDecision::NeverAllow)
    {
        return Ok(false);
    }
    Ok(state.config.client_tools.tools.values().any(|tool| {
        tool.qualified_name() == request.operation_id
            && super::message_streaming::is_qualified_tool_allowed(
                tool.namespace_or_default(),
                &tool.name,
                &allowlist,
            )
            && crate::services::client_tools::client_tool_is_available(
                tool,
                &context.registered_client_tools,
            )
    }))
}

pub(super) async fn authorize_or_withdraw(
    state: &AppState,
    policy: &PolicyEngine,
    me: &MeProfile,
    row: &crate::db::entity::client_operation_attempts::Model,
) -> Result<(), ApiError> {
    let request = serde_json::from_value(row.request.clone())
        .map_err(eyre::Report::from)
        .map_err(error)?;
    if !authorize_open_operation(state, policy, me, &request)
        .await
        .map_err(error)?
    {
        store::withdraw(&state.db, request.account_id, request.attempt_id)
            .await
            .map_err(error)?;
        return Err((
            StatusCode::CONFLICT,
            "Operation authorization withdrawn".into(),
        ));
    }
    Ok(())
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClientOperationView {
    pub request: OperationRequest,
    pub state: store::AttemptState,
}
#[derive(Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListClientOperationsQuery {
    pub after: Option<Uuid>,
}
#[derive(Serialize, ToSchema)]
pub struct ListClientOperationsResponse {
    pub account_id: String,
    pub enabled: bool,
    /// Whether `GET /me/client-operations/stream` serves executor streams.
    pub executor_stream_enabled: bool,
    pub operations: Vec<ClientOperationView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub after: Option<Uuid>,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ClaimClientOperationRequest {
    pub binding: ExecutorBinding,
    #[serde(default)]
    pub user_confirmed: bool,
}
#[derive(Serialize, ToSchema)]
pub struct ClaimClientOperationResponse {
    pub claim_token: Uuid,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CompleteClientOperationRequest {
    pub claim_token: Uuid,
    pub result: OperationResult,
}
#[derive(Serialize, ToSchema)]
pub struct ClientOperationResponse {
    pub state: store::AttemptState,
}

#[utoipa::path(get, path = "/me/client-operations", operation_id = "listClientOperations",
    params(ListClientOperationsQuery), responses((status = OK, body = ListClientOperationsResponse)), security(("bearer_auth" = [])))]
pub async fn list_client_operations(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Query(query): Query<ListClientOperationsQuery>,
) -> Result<Json<ListClientOperationsResponse>, ApiError> {
    if !state.config.client_tools.durable_operations_enabled {
        return Ok(Json(ListClientOperationsResponse {
            account_id: me.id.clone(),
            enabled: false,
            executor_stream_enabled: state.config.client_tools.executor_stream_enabled,
            operations: Vec::new(),
            after: None,
        }));
    }
    let rows = store::list(&state.db, account(&state, &me)?, query.after)
        .await
        .map_err(error)?;
    let after = (rows.len() == 100).then(|| rows.last().expect("nonempty page").attempt_id);
    let operations = rows
        .into_iter()
        .map(|row| {
            Ok(ClientOperationView {
                request: serde_json::from_value(row.request).map_err(eyre::Report::from)?,
                state: row.state,
            })
        })
        .collect::<Result<_, eyre::Report>>()
        .map_err(error)?;
    Ok(Json(ListClientOperationsResponse {
        account_id: me.id.clone(),
        enabled: true,
        executor_stream_enabled: state.config.client_tools.executor_stream_enabled,
        operations,
        after,
    }))
}

#[utoipa::path(post, path = "/me/client-operations/{attempt_id}/claim", operation_id = "claimClientOperation",
    params(("attempt_id" = Uuid, Path)), request_body = ClaimClientOperationRequest,
    responses((status = OK, body = ClaimClientOperationResponse), (status = CONFLICT)), security(("bearer_auth" = [])))]
pub async fn claim_client_operation(
    State(state): State<AppState>,
    Extension(policy): Extension<PolicyEngine>,
    Extension(me): Extension<MeProfile>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<ClaimClientOperationRequest>,
) -> Result<Json<ClaimClientOperationResponse>, ApiError> {
    let row = store::get(&state.db, account(&state, &me)?, id)
        .await
        .map_err(error)?;
    authorize_or_withdraw(&state, &policy, &me, &row).await?;
    let registered = crate::services::client_tools::registered_client_tools(&headers);
    let token = store::claim(
        &state.db,
        &state.client_operations,
        account(&state, &me)?,
        id,
        &request.binding,
        &registered,
        request.user_confirmed,
    )
    .await
    .map_err(error)?;
    let row = store::get(&state.db, account(&state, &me)?, id)
        .await
        .map_err(error)?;
    let expires_at = row
        .claim_expires_at
        .ok_or_else(|| (StatusCode::CONFLICT, "Operation claim missing".into()))?
        .with_timezone(&chrono::Utc);
    Ok(Json(ClaimClientOperationResponse {
        claim_token: token,
        expires_at,
    }))
}

#[utoipa::path(post, path = "/me/client-operations/{attempt_id}/result", operation_id = "completeClientOperation",
    params(("attempt_id" = Uuid, Path)), request_body = CompleteClientOperationRequest,
    responses((status = OK, body = ClientOperationResponse), (status = CONFLICT)), security(("bearer_auth" = [])))]
pub async fn complete_client_operation(
    State(state): State<AppState>,
    Extension(policy): Extension<PolicyEngine>,
    Extension(me): Extension<MeProfile>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<CompleteClientOperationRequest>,
) -> Result<Json<ClientOperationResponse>, ApiError> {
    let account_id = account(&state, &me)?;
    if id != request.result.attempt_id {
        return Err((StatusCode::CONFLICT, "Operation identity mismatch".into()));
    }
    let registered = crate::services::client_tools::registered_client_tools(&headers);
    let name = request
        .result
        .operation_id
        .rsplit('/')
        .next()
        .unwrap_or_default();
    if !registered.iter().any(|candidate| candidate == name) {
        return Err((StatusCode::CONFLICT, "Executor unavailable".into()));
    }
    let row = store::get(&state.db, account_id, id).await.map_err(error)?;
    if matches!(
        row.state,
        store::AttemptState::Pending | store::AttemptState::Claimed
    ) {
        authorize_or_withdraw(&state, &policy, &me, &row).await?;
    }
    store::accept(
        &state.db,
        &state.client_operations,
        account_id,
        Some(request.claim_token),
        &request.result,
    )
    .await
    .map_err(error)?;
    let row = store::get(&state.db, account_id, id).await.map_err(error)?;
    Ok(Json(ClientOperationResponse { state: row.state }))
}

#[utoipa::path(post, path = "/me/client-operations/{attempt_id}/cancel", operation_id = "cancelClientOperation",
    params(("attempt_id" = Uuid, Path)), responses((status = OK, body = ClientOperationResponse), (status = CONFLICT)), security(("bearer_auth" = [])))]
pub async fn cancel_client_operation(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Path(id): Path<Uuid>,
) -> Result<Json<ClientOperationResponse>, ApiError> {
    store::cancel(&state.db, account(&state, &me)?, id, false)
        .await
        .map_err(error)?;
    Ok(Json(ClientOperationResponse {
        state: store::AttemptState::Ready,
    }))
}

#[utoipa::path(post, path = "/me/client-operations/{attempt_id}/continue", operation_id = "continueClientOperation",
    params(("attempt_id" = Uuid, Path)), responses((status = OK, content((ClientOperationResponse = "application/json"), (super::message_streaming::MessageSubmitStreamingResponseMessage = "text/event-stream"))), (status = CONFLICT)), security(("bearer_auth" = [])))]
pub async fn continue_client_operation(
    State(state): State<AppState>,
    Extension(policy): Extension<PolicyEngine>,
    Extension(me): Extension<MeProfile>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let account_id = account(&state, &me)?;
    let mut row = store::get(&state.db, account_id, id).await.map_err(error)?;
    if row.state == store::AttemptState::Completed {
        return Ok(Json(ClientOperationResponse { state: row.state }).into_response());
    }
    if matches!(
        row.state,
        store::AttemptState::Pending | store::AttemptState::Claimed
    ) && row.expires_at <= chrono::Utc::now()
    {
        store::cancel(&state.db, account_id, id, true)
            .await
            .map_err(error)?;
        row = store::get(&state.db, account_id, id).await.map_err(error)?;
    }
    if !matches!(
        row.state,
        store::AttemptState::Ready | store::AttemptState::Continuing
    ) {
        return Err((
            StatusCode::CONFLICT,
            "Operation has no result to continue".into(),
        ));
    }
    let attached = headers
        .get("accept")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/event-stream"));
    let context = attached
        .then(|| super::message_streaming::generation_request_context_from_headers(&headers));
    let request: OperationRequest =
        serde_json::from_value(row.request.clone()).map_err(|error| self::error(error.into()))?;
    if let Some(context) = &context
        && (request.consent != crate::services::client_operations::ConsentPolicy::None
            || context.executor.as_ref() != Some(&request.binding)
            || !context.registered_client_tools.iter().any(|tool| {
                tool == &request.operation_id
                    || Some(tool.as_str()) == request.operation_id.rsplit('/').next()
            }))
    {
        return Err((
            StatusCode::CONFLICT,
            "Attached continuation requires the original executor and client tool".into(),
        ));
    }
    let (events, task) = state
        .background_tasks
        .try_start_task(
            row.chat_id,
            row.message_id,
            Takeover::TakeParked,
            state.config.generation_status.stale_after_secs,
        )
        .await
        .map_err(|_| (StatusCode::CONFLICT, "Generation is already running".into()))?;
    let guard = attached.then(|| task.client_stream_guard());
    if attached && let Err(error) = task.register_client_operation(request).await {
        state
            .background_tasks
            .remove_task(
                &row.chat_id,
                task.generation_id,
                crate::services::background_tasks::TaskOutcome::AwaitingApproval,
            )
            .await;
        return Err(self::error(error));
    }
    tokio::spawn(async move {
        let result = super::message_streaming::with_generation_task_lifecycle(
            &state.background_tasks,
            &task,
            row.chat_id,
            super::message_streaming::run_client_operation_continuation(
                &task, &state, &policy, &me, id, context,
            ),
        )
        .await;
        if let Err(error) = &result {
            tracing::warn!(error = %error, "Client operation continuation failed");
        }
        super::message_streaming::settle_tail_deliveries(
            &state,
            &policy,
            &me,
            row.chat_id,
            &task,
            task.derive_outcome(result.is_err()),
        )
        .await;
    });
    if let Some(guard) = guard {
        let events = super::message_streaming::live_streaming_events(events);
        Ok(
            Sse::new(super::message_streaming::owned_streaming_events_to_sse(
                events, guard,
            ))
            .keep_alive(
                axum::response::sse::KeepAlive::new().interval(std::time::Duration::from_secs(1)),
            )
            .into_response(),
        )
    } else {
        Ok(Json(ClientOperationResponse {
            state: store::AttemptState::Continuing,
        })
        .into_response())
    }
}

/// One stream per executor binding. It receives live client tool calls from any
/// of the account's chats that no stream of the calling chat can take, and
/// announces new durable operations for the binding. The first stream of a
/// binding serves it; a later one waits until the first closes. A pane sends
/// the same `X-Erato-Executor-Instance` on every reconnect of its stream: a
/// later stream of the holder's instance takes the binding over at once, and
/// the older one ends.
#[utoipa::path(get, path = "/me/client-operations/stream", operation_id = "clientOperationStream",
    responses((status = OK, content_type = "text/event-stream", body = ExecutorStreamEvent),
        (status = BAD_REQUEST, description = "No valid X-Erato-Executor binding or no X-Erato-Client-Tools"),
        (status = NOT_FOUND, description = "Executor streams are disabled")),
    security(("bearer_auth" = [])))]
pub async fn executor_stream(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if !state.config.client_tools.executor_stream_enabled {
        return Err((StatusCode::NOT_FOUND, "Not found".into()));
    }
    let account_id = Uuid::parse_str(&me.id)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "Invalid account".into()))?;
    let binding = ExecutorBinding::from_headers(&headers).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "A valid X-Erato-Executor binding is required".into(),
        )
    })?;
    let client_tools = crate::services::client_tools::registered_client_tools(&headers);
    if client_tools.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "X-Erato-Client-Tools must name at least one tool".into(),
        ));
    }
    let claim = PresenceClaim {
        account_id,
        binding,
        instance_id: headers
            .get("X-Erato-Executor-Instance")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| Uuid::parse_str(value).ok()),
        connected_at: chrono::Utc::now(),
        client_tools,
        child_client_tools: crate::services::client_tools::child_client_tools(&headers),
    };
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    let guard = PresenceGuard::start(
        state.db.clone(),
        state.executor_streams.clone(),
        claim,
        sender,
    )
    .await;
    let events = futures::stream::unfold((receiver, guard), |(mut receiver, guard)| async move {
        let event = receiver.recv().await?;
        let sse = Event::default()
            .event(event.message_type())
            .json_data(&event);
        Some((sse, (receiver, guard)))
    });
    Ok(Sse::new(events)
        .keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(1)))
        .into_response())
}
