//! Authenticated rendezvous. Bodies contain cloud-known plans or approved bytes;
//! native handles, pre-consent statuses and error reports are not accepted here.
use super::me_profile_middleware::MeProfile;
use crate::services::local_delegation::{signing::Signer, store};
use crate::{
    policy::{
        engine::{PolicyEngine, authorize},
        types::{Action, Resource},
    },
    state::AppState,
};
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
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
fn signer(state: &AppState) -> Result<Signer, ApiError> {
    Signer::new(&state.config.desktop_sidecar.local_delegation).map_err(unavailable)
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
async fn authorize_job(
    state: &AppState,
    policy: &PolicyEngine,
    me: &MeProfile,
    id: Uuid,
) -> Result<store::PendingJob, ApiError> {
    let job = store::get(&state.db, id, &me.id).await.map_err(conflict)?;
    policy
        .rebuild_data_if_needed_req(&state.db, &state.config)
        .await
        .map_err(unavailable)?;
    authorize!(
        policy,
        &me.to_subject(),
        &Resource::Chat(job.chat_id.to_string()),
        Action::SubmitMessage
    )
    .map_err(|_| (StatusCode::FORBIDDEN, "Local delegation access denied"))?;
    Ok(job)
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
pub struct ClaimRequest {
    pub device_id: String,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobResponse {
    pub id: Uuid,
    pub chat_id: Uuid,
    pub message_id: Uuid,
    pub state: String,
    pub receipt: Option<String>,
    pub server_outcome: Option<Value>,
    pub binding: Option<Value>,
    pub plan: Value,
}
impl From<store::PendingJob> for JobResponse {
    fn from(job: store::PendingJob) -> Self {
        Self {
            id: job.id,
            chat_id: job.chat_id,
            message_id: job.message_id,
            state: job.state,
            receipt: job.receipt,
            server_outcome: job.server_outcome,
            binding: job.binding,
            plan: job.plan,
        }
    }
}
#[derive(Serialize, ToSchema)]
pub struct PendingResponse {
    pub enabled: bool,
    pub jobs: Vec<JobResponse>,
}
#[derive(Serialize, ToSchema)]
pub struct ClaimResponse {
    pub job: JobResponse,
    pub authorization: String,
}
#[derive(Serialize, ToSchema)]
pub struct ReceiptResponse {
    pub receipt: String,
}
#[utoipa::path(post,path="/me/local-delegation/context",request_body=ContextRequest,responses((status=200,body=AssertionResponse)))]
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
#[utoipa::path(get,path="/me/local-delegation/jobs",responses((status=200,body=PendingResponse)))]
pub async fn pending(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
) -> Result<Json<PendingResponse>, ApiError> {
    if !state.config.desktop_sidecar.local_delegation.enabled {
        return Ok(Json(PendingResponse {
            enabled: false,
            jobs: vec![],
        }));
    }
    signer(&state)?;
    store::recover(&state.db).await.map_err(unavailable)?;
    policy
        .rebuild_data_if_needed_req(&state.db, &state.config)
        .await
        .map_err(unavailable)?;
    let mut jobs = Vec::new();
    for job in store::pending(&state.db, &me.id)
        .await
        .map_err(unavailable)?
    {
        if authorize!(
            policy,
            &me.to_subject(),
            &Resource::Chat(job.chat_id.to_string()),
            Action::SubmitMessage
        )
        .is_ok()
        {
            jobs.push(job.into());
        }
    }
    Ok(Json(PendingResponse {
        enabled: true,
        jobs,
    }))
}
#[utoipa::path(post,path="/me/local-delegation/jobs/{id}/claim",params(("id"=Uuid,Path)),request_body=ClaimRequest,responses((status=200,body=ClaimResponse)))]
pub async fn claim(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<ClaimRequest>,
) -> Result<Json<ClaimResponse>, ApiError> {
    let signer = signer(&state)?;
    let origin = origin(&state, &headers)?;
    authorize_job(&state, &policy, &me, id).await?;
    let job = store::bind_device(
        &state.db,
        id,
        &me.id,
        &signer.origin,
        &request.device_id,
        origin,
    )
    .await
    .map_err(conflict)?;
    let authorization = signer
        .job(
            &me.id,
            origin,
            job.binding.as_ref().ok_or_else(|| conflict("unbound"))?,
        )
        .map_err(unavailable)?;
    Ok(Json(ClaimResponse {
        job: job.into(),
        authorization,
    }))
}
#[utoipa::path(post,path="/me/local-delegation/jobs/{id}/complete",params(("id"=Uuid,Path)),request_body=Value,responses((status=200,body=ReceiptResponse)))]
pub async fn complete(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(id): Path<Uuid>,
    Json(package): Json<Value>,
) -> Result<Json<ReceiptResponse>, ApiError> {
    let signer = signer(&state)?;
    authorize_job(&state, &policy, &me, id).await?;
    let receipt = store::accept(&state.db, id, &me.id, &package, |claims| {
        signer.sign("receipt-claims", claims)
    })
    .await
    .map_err(conflict)?;
    Ok(Json(ReceiptResponse { receipt }))
}
#[utoipa::path(post,path="/me/local-delegation/jobs/{id}/cancel",params(("id"=Uuid,Path)),responses((status=204)))]
pub async fn cancel(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    signer(&state)?;
    authorize_job(&state, &policy, &me, id).await?;
    store::cancel(&state.db, id, &me.id)
        .await
        .map_err(conflict)?;
    Ok(StatusCode::NO_CONTENT)
}
