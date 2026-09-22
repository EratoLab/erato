//! Authenticated rendezvous. Bodies contain cloud-known plans or approved bytes;
//! native handles, pre-consent statuses and error reports are not accepted here.
use super::me_profile_middleware::MeProfile;
use crate::services::local_delegation::{signing::Signer, store, uploads};
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
#[derive(Deserialize, ToSchema, Default)]
#[serde(deny_unknown_fields)]
pub struct PendingQuery {
    pub after: Option<Uuid>,
}

#[derive(Serialize, ToSchema)]
pub struct PendingResponse {
    pub enabled: bool,
    #[serde(rename = "accountId")]
    pub account_id: String,
    pub next: Option<Uuid>,
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
    axum::extract::Query(query): axum::extract::Query<PendingQuery>,
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
) -> Result<Json<PendingResponse>, ApiError> {
    if !state.config.desktop_sidecar.local_delegation.enabled {
        return Ok(Json(PendingResponse {
            enabled: false,
            account_id: me.id.clone(),
            next: None,
            jobs: vec![],
        }));
    }
    signer(&state)?;
    store::recover(&state.db, state.config.generation_status.stale_after_secs)
        .await
        .map_err(unavailable)?;
    policy
        .rebuild_data_if_needed_req(&state.db, &state.config)
        .await
        .map_err(unavailable)?;
    let mut jobs = Vec::new();
    let page = store::pending(&state.db, &me.id, query.after)
        .await
        .map_err(unavailable)?;
    let next = (page.len() == 128).then(|| page.last().unwrap().id);
    for job in page {
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
        account_id: me.id.clone(),
        next,
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
#[utoipa::path(post,path="/me/local-delegation/jobs/{id}/complete",params(("id"=Uuid,Path)),request_body(content=Object,description="Exact native-approved export validated against desktop-sidecar-protocol ApprovedLocalExport"),responses((status=200,body=ReceiptResponse)))]
pub async fn complete(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(id): Path<Uuid>,
    Json(package): Json<Value>,
) -> Result<Json<ReceiptResponse>, ApiError> {
    let signer = signer(&state)?;
    let job = authorize_job(&state, &policy, &me, id).await?;
    if let Some(receipt) = store::accepted_receipt(&state.db, id, &me.id, &package)
        .await
        .map_err(conflict)?
    {
        return Ok(Json(ReceiptResponse { receipt }));
    }
    authorize!(
        &policy,
        &me.to_subject(),
        &Resource::Chat(job.chat_id.to_string()),
        Action::Update
    )
    .map_err(|_| (StatusCode::FORBIDDEN, "Attachment access denied"))?;
    let files = uploads::stage(&state, &job, &package)
        .await
        .map_err(conflict)?;
    let receipt = store::accept_files(&state.db, id, &me.id, &package, files, |claims| {
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
    let job = authorize_job(&state, &policy, &me, id).await?;
    let cancelled_generation = store::cancel(&state.db, id, &me.id)
        .await
        .map_err(conflict)?;
    // The durable terminal state rejects late writes; the existing local task
    // signal promptly stops this single replica's active model request.
    if let Some(task) = state.background_tasks.get_task(&job.chat_id).await
        && cancelled_generation == Some(task.generation_id)
    {
        task.request_abort();
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post,path="/me/local-delegation/jobs/{id}/resume",params(("id"=Uuid,Path)),responses((status=202)))]
pub async fn resume(
    State(state): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    signer(&state)?;
    authorize_job(&state, &policy, &me, id).await?;
    store::recover(&state.db, state.config.generation_status.stale_after_secs)
        .await
        .map_err(unavailable)?;
    super::message_streaming::local_jobs::launch(state, policy, me, id)
        .await
        .map_err(conflict)?;
    Ok(StatusCode::ACCEPTED)
}
