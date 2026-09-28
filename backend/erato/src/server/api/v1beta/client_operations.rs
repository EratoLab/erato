//! Authenticated inbox for registered client operations. No replica addresses,
//! executor content telemetry, or stored authentication credentials.
use super::me_profile_middleware::MeProfile;
use crate::services::background_tasks::Takeover;
use crate::services::client_operations::{
    ExecutorBinding, OperationRequest, OperationResult, store,
};
use crate::{policy::engine::PolicyEngine, state::AppState};
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
    params(("attempt_id" = Uuid, Path)), responses((status = OK, body = ClientOperationResponse), (status = CONFLICT)), security(("bearer_auth" = [])))]
pub async fn continue_client_operation(
    State(state): State<AppState>,
    Extension(policy): Extension<PolicyEngine>,
    Extension(me): Extension<MeProfile>,
    Path(id): Path<Uuid>,
) -> Result<Json<ClientOperationResponse>, ApiError> {
    let account_id = account(&state, &me)?;
    let mut row = store::get(&state.db, account_id, id).await.map_err(error)?;
    if row.state == store::AttemptState::Completed {
        return Ok(Json(ClientOperationResponse { state: row.state }));
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
    let (_events, task) = state
        .background_tasks
        .try_start_task(
            row.chat_id,
            row.message_id,
            Takeover::TakeParked,
            state.config.generation_status.stale_after_secs,
        )
        .await
        .map_err(|_| (StatusCode::CONFLICT, "Generation is already running".into()))?;
    tokio::spawn(async move {
        let result = super::message_streaming::with_generation_task_lifecycle(
            &state.background_tasks,
            &task,
            row.chat_id,
            super::message_streaming::run_client_operation_continuation(
                &task, &state, &policy, &me, id,
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
    Ok(Json(ClientOperationResponse {
        state: store::AttemptState::Continuing,
    }))
}
