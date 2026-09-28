//! Native challenge, immutable export and receipt adapter. Discovery, claim,
//! cancellation and continuation belong to the shared client-operation inbox.
use super::me_profile_middleware::MeProfile;
use crate::db::entity::client_operation_attempts::AttemptState;
use crate::services::client_operations::{OperationResult, store as operations};
use crate::services::local_delegation::{contract, signing::Signer, store, uploads};
use crate::{
    policy::{
        engine::{PolicyEngine, authorize},
        types::{Action, Resource},
    },
    state::AppState,
};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, ToSchema};
type ApiError = (StatusCode, &'static str);
fn unavailable(_: impl std::fmt::Display) -> ApiError {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "Local delegation is unavailable",
    )
}
fn conflict(_: impl std::fmt::Display) -> ApiError {
    (
        StatusCode::CONFLICT,
        "Local delegation request could not be accepted",
    )
}
fn signer(state: &AppState) -> Result<&Signer, ApiError> {
    if !state.config.client_tools.durable_operations_enabled {
        return Err(unavailable("disabled"));
    }
    state
        .local_delegation_signer
        .as_deref()
        .ok_or_else(|| unavailable("disabled"))
}
fn account(me: &MeProfile) -> Result<Uuid, ApiError> {
    Uuid::parse_str(&me.id).map_err(conflict)
}
fn origin<'a>(state: &AppState, headers: &'a HeaderMap) -> Result<&'a str, ApiError> {
    let value = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::FORBIDDEN, "Origin is required"))?;
    if !state
        .config
        .desktop_sidecar
        .allowed_origins
        .iter()
        .any(|allowed| allowed == value)
    {
        return Err((StatusCode::FORBIDDEN, "Origin is not allowed"));
    }
    Ok(value)
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ContextRequest {
    pub device_id: String,
    pub challenge: String,
}
#[derive(Serialize, ToSchema)]
pub struct AssertionResponse {
    pub assertion: String,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthorizationRequest {
    pub claim_token: Uuid,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NativeJobResponse {
    pub id: Uuid,
    pub chat_id: Uuid,
    pub message_id: Uuid,
    pub state: AttemptState,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = String, nullable = false)]
    pub receipt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(schema_with = contract::outcome_schema)]
    pub server_outcome: Option<Value>,
    #[schema(schema_with = contract::binding_schema)]
    pub binding: Value,
    #[schema(schema_with = contract::plan_schema)]
    pub plan: Value,
}
impl From<store::NativeJob> for NativeJobResponse {
    fn from(job: store::NativeJob) -> Self {
        Self {
            id: job.request.attempt_id,
            chat_id: job.request.chat_id,
            message_id: job.request.message_id,
            state: job.state,
            receipt: job.receipt,
            server_outcome: job.server_outcome,
            binding: job.binding,
            plan: job.plan,
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct AuthorizationResponse {
    pub job: NativeJobResponse,
    pub authorization: String,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CompleteRequest {
    pub claim_token: Uuid,
    pub package: ApprovedExport,
}
#[derive(Serialize, ToSchema)]
pub struct ReceiptResponse {
    pub receipt: String,
    pub result: OperationResult,
}
#[derive(Deserialize, ToSchema, IntoParams, Default)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct ReceiptQuery {
    pub after: Option<Uuid>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptsResponse {
    pub account_id: String,
    pub jobs: Vec<NativeJobResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Uuid, nullable = false)]
    pub after: Option<Uuid>,
}
#[utoipa::path(
    operation_id = "local_delegation_context",
    post, path = "/me/local-delegation/context",
    request_body = ContextRequest,
    responses((status = 200, body = AssertionResponse))
)]
pub async fn context(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    headers: HeaderMap,
    Json(request): Json<ContextRequest>,
) -> Result<Json<AssertionResponse>, ApiError> {
    let signer = signer(&state)?;
    let origin = origin(&state, &headers)?;
    policy
        .rebuild_data_if_needed_req(&state.db, &state.config)
        .await
        .map_err(unavailable)?;
    authorize!(
        policy,
        &me.to_subject(),
        &Resource::DesktopSidecarConfigurationSingleton,
        Action::Read
    )
    .map_err(|_| (StatusCode::FORBIDDEN, "Local delegation access denied"))?;
    let assertion = signer
        .context(&me.id, origin, &request.device_id, &request.challenge)
        .map_err(conflict)?;
    Ok(Json(AssertionResponse { assertion }))
}

#[utoipa::path(post, path = "/me/local-delegation/jobs/{id}/authorize", operation_id = "local_delegation_authorize",
    params(("id" = Uuid, Path)), request_body = AuthorizationRequest,
    responses((status = 200, body = AuthorizationResponse)))]
pub async fn authorize_native(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<AuthorizationRequest>,
) -> Result<Json<AuthorizationResponse>, ApiError> {
    let signer = signer(&state)?;
    let origin = origin(&state, &headers)?;
    let row = operations::get(&state.db, account(&me)?, id)
        .await
        .map_err(conflict)?;
    super::client_operations::authorize_or_withdraw(&state, &policy, &me, &row)
        .await
        .map_err(|_| conflict("withdrawn"))?;
    let job = store::bind(
        &state.db,
        account(&me)?,
        id,
        request.claim_token,
        &signer.origin,
        origin,
    )
    .await
    .map_err(conflict)?;
    let authorization = signer
        .job(&me.id, origin, &job.binding)
        .map_err(unavailable)?;
    Ok(Json(AuthorizationResponse {
        job: job.into(),
        authorization,
    }))
}

#[utoipa::path(post, path = "/me/local-delegation/jobs/{id}/export-context", operation_id = "local_delegation_export_context",
    params(("id" = Uuid, Path)), responses((status = 200, body = AuthorizationResponse)))]
pub async fn export_context(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<AuthorizationResponse>, ApiError> {
    let signer = signer(&state)?;
    let job = store::get(&state.db, account(&me)?, id)
        .await
        .map_err(conflict)?;
    let origin = origin(&state, &headers)?;
    if job.origin != origin || (job.receipt.is_none() && job.server_outcome.is_none()) {
        return Err(conflict("No durable outcome"));
    }
    let authorization = signer
        .job(&me.id, origin, &job.binding)
        .map_err(unavailable)?;
    Ok(Json(AuthorizationResponse {
        job: job.into(),
        authorization,
    }))
}

#[utoipa::path(get, path = "/me/local-delegation/exports", operation_id = "local_delegation_receipts",
    params(ReceiptQuery), responses((status = 200, body = ReceiptsResponse)))]
pub async fn receipts(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Query(query): Query<ReceiptQuery>,
) -> Result<Json<ReceiptsResponse>, ApiError> {
    signer(&state)?;
    let jobs = store::receipts(&state.db, account(&me)?, query.after)
        .await
        .map_err(unavailable)?;
    let after = (jobs.len() == 100).then(|| jobs.last().expect("nonempty").request.attempt_id);
    Ok(Json(ReceiptsResponse {
        account_id: me.id.clone(),
        jobs: jobs.into_iter().map(Into::into).collect(),
        after,
    }))
}

#[utoipa::path(post, path = "/me/local-delegation/jobs/{id}/complete", operation_id = "local_delegation_complete",
    params(("id" = Uuid, Path)), request_body = CompleteRequest,
    responses((status = 200, body = ReceiptResponse)))]
pub async fn complete(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<CompleteRequest>,
) -> Result<Json<ReceiptResponse>, ApiError> {
    let signer = signer(&state)?;
    let owner = account(&me)?;
    let row = operations::get(&state.db, owner, id)
        .await
        .map_err(conflict)?;
    let job = store::get(&state.db, owner, id).await.map_err(conflict)?;
    if row.claim_token != Some(request.claim_token) || job.origin != origin(&state, &headers)? {
        return Err(conflict("claim mismatch"));
    }
    let package = request.package.0;
    if let Some((receipt, result)) =
        store::accepted_receipt(&state.db, owner, id, request.claim_token, &package)
            .await
            .map_err(conflict)?
    {
        return Ok(Json(ReceiptResponse { receipt, result }));
    }
    super::client_operations::authorize_or_withdraw(&state, &policy, &me, &row)
        .await
        .map_err(|_| conflict("withdrawn"))?;
    policy
        .rebuild_data_if_needed_req(&state.db, &state.config)
        .await
        .map_err(unavailable)?;
    authorize!(
        &policy,
        &me.to_subject(),
        &Resource::Chat(job.request.chat_id.to_string()),
        Action::Update
    )
    .map_err(|_| (StatusCode::FORBIDDEN, "Attachment access denied"))?;
    let files = uploads::stage(&state, &job, &package)
        .await
        .map_err(conflict)?;
    let (receipt, result) = store::accept_files(
        &state.db,
        &state.client_operations,
        signer,
        store::ApprovedUpload {
            owner,
            id,
            token: request.claim_token,
            package: &package,
            files,
        },
    )
    .await
    .map_err(conflict)?;
    Ok(Json(ReceiptResponse { receipt, result }))
}

#[derive(Deserialize)]
#[serde(transparent)]
pub struct ApprovedExport(Value);
impl utoipa::PartialSchema for ApprovedExport {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        contract::openapi_schema("approved-export")
    }
}
impl ToSchema for ApprovedExport {}
