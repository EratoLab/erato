use crate::config::McpToolApprovalConfig;
use crate::distribution::runtime::McpAppState;
use crate::models::user_tool_approval_setting::{self, UserToolDecision, decision_of};
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::mcp_servers::authorized_server_ids;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use sqlx::types::Uuid;
use std::collections::HashSet;
use utoipa::ToSchema;

type ApiError = (StatusCode, String);

#[derive(serde::Serialize, ToSchema)]
pub struct UserToolApprovalSetting {
    pub id: Uuid,
    pub mcp_server_id: String,
    pub tool_name: String,
    pub decision: UserToolDecision,
}

impl From<crate::db::entity::user_tool_approval_settings::Model> for UserToolApprovalSetting {
    fn from(setting: crate::db::entity::user_tool_approval_settings::Model) -> Self {
        Self {
            decision: decision_of(&setting),
            id: setting.id,
            mcp_server_id: setting.mcp_server_id,
            tool_name: setting.tool_name,
        }
    }
}

#[derive(serde::Serialize, ToSchema)]
pub struct UserToolApprovalSettingsResponse {
    pub settings: Vec<UserToolApprovalSetting>,
}

#[utoipa::path(
    get,
    path = "/me/mcp-tool-approval-settings",
    responses((status = OK, body = UserToolApprovalSettingsResponse)),
    security(("bearer_auth" = []))
)]
pub async fn list_user_tool_approval_settings(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<UserToolApprovalSettingsResponse>, ApiError> {
    let user_id = parse_user_id(&me_user)?;
    let settings = user_tool_approval_setting::list_active(&app_state.db, user_id)
        .await
        .map_err(internal_error)?;
    Ok(Json(UserToolApprovalSettingsResponse {
        settings: settings.into_iter().map(Into::into).collect(),
    }))
}

#[derive(serde::Deserialize, ToSchema)]
pub struct CreateUserToolApprovalSettingRequest {
    pub mcp_server_id: String,
    pub tool_name: String,
    /// Defaults to `always_allow`, which is what pre-existing clients meant.
    #[serde(default)]
    pub decision: UserToolDecision,
}

/// Store a persistent decision for a tool from the settings surface. The
/// in-stream ApproveAlways decision remains the other writer of the same rows;
/// this endpoint exists so a grant flipped back to the policy default in
/// settings can be re-granted without waiting for the next in-chat approval
/// stop, and so a tool can be put on ask or denied outright. The
/// `allow_always` policy only guards grants: it exists to keep the product
/// from becoming more permissive, and a denial is strictly more restrictive,
/// so it works in deployments that never enable approvals at all. An ask
/// needs the approval gate to have any effect, so it is refused without one.
#[utoipa::path(
    post,
    path = "/me/mcp-tool-approval-settings",
    request_body = CreateUserToolApprovalSettingRequest,
    responses(
        (status = OK, body = UserToolApprovalSetting),
        (status = BAD_REQUEST, description = "The decision is unavailable under the MCP approval policy or the MCP server is unknown"),
        (status = FORBIDDEN, description = "The user is not authorized to access the MCP server")
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_user_tool_approval_setting(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Json(request): Json<CreateUserToolApprovalSettingRequest>,
) -> Result<Json<UserToolApprovalSetting>, ApiError> {
    let mcp = app_state.mcp_state().await;
    let approval = &mcp.config.mcp_servers_global.approval;
    ensure_decision_available(approval, request.decision)?;
    ensure_server_authorized(&mcp, &me_user, &policy, &request.mcp_server_id).await?;
    ensure_tool_name(&request.tool_name)?;
    let user_id = parse_user_id(&me_user)?;
    let setting = user_tool_approval_setting::upsert_active(
        &app_state.db,
        user_id,
        &request.mcp_server_id,
        &request.tool_name,
        request.decision,
    )
    .await
    .map_err(internal_error)?;
    Ok(Json(setting.into()))
}

#[derive(serde::Deserialize, ToSchema)]
pub struct UserToolApprovalDecisionEntry {
    pub tool_name: String,
    /// `null` deactivates the tool's decision, back to the policy default.
    #[serde(default)]
    pub decision: Option<UserToolDecision>,
}

#[derive(serde::Deserialize, ToSchema)]
pub struct ApplyUserToolApprovalSettingsBatchRequest {
    pub mcp_server_id: String,
    pub decisions: Vec<UserToolApprovalDecisionEntry>,
}

/// Apply several decisions for one server at once, e.g. a whole group of
/// tools set to one decision. Every entry is validated before anything is
/// written and the writes share one transaction, so a rejected entry leaves
/// the stored decisions untouched.
#[utoipa::path(
    put,
    path = "/me/mcp-tool-approval-settings/batch",
    request_body = ApplyUserToolApprovalSettingsBatchRequest,
    responses(
        (status = OK, body = UserToolApprovalSettingsResponse, description = "The server's active decisions after the batch"),
        (status = BAD_REQUEST, description = "An entry is invalid or unavailable under the MCP approval policy, or the MCP server is unknown"),
        (status = FORBIDDEN, description = "The user is not authorized to access the MCP server")
    ),
    security(("bearer_auth" = []))
)]
pub async fn apply_user_tool_approval_settings_batch(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Json(request): Json<ApplyUserToolApprovalSettingsBatchRequest>,
) -> Result<Json<UserToolApprovalSettingsResponse>, ApiError> {
    let mcp = app_state.mcp_state().await;
    let approval = &mcp.config.mcp_servers_global.approval;
    ensure_server_authorized(&mcp, &me_user, &policy, &request.mcp_server_id).await?;
    let mut seen: HashSet<&str> = HashSet::new();
    for entry in &request.decisions {
        ensure_tool_name(&entry.tool_name)?;
        if !seen.insert(entry.tool_name.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Tool '{}' appears more than once", entry.tool_name),
            ));
        }
        if let Some(decision) = entry.decision {
            ensure_decision_available(approval, decision)?;
        }
    }
    let user_id = parse_user_id(&me_user)?;
    let decisions: Vec<(String, Option<UserToolDecision>)> = request
        .decisions
        .into_iter()
        .map(|entry| (entry.tool_name, entry.decision))
        .collect();
    let settings = user_tool_approval_setting::apply_batch(
        &app_state.db,
        user_id,
        &request.mcp_server_id,
        &decisions,
    )
    .await
    .map_err(internal_error)?;
    Ok(Json(UserToolApprovalSettingsResponse {
        settings: settings.into_iter().map(Into::into).collect(),
    }))
}

#[utoipa::path(
    delete,
    path = "/me/mcp-tool-approval-settings/{setting_id}",
    params(("setting_id" = Uuid, Path, description = "Approval setting ID")),
    responses((status = NO_CONTENT), (status = NOT_FOUND)),
    security(("bearer_auth" = []))
)]
pub async fn deactivate_user_tool_approval_setting(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(setting_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let user_id = parse_user_id(&me_user)?;
    let deactivated = user_tool_approval_setting::deactivate(&app_state.db, user_id, setting_id)
        .await
        .map_err(internal_error)?;
    deactivated
        .then_some(StatusCode::NO_CONTENT)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                "Approval setting not found".to_string(),
            )
        })
}

fn ensure_decision_available(
    approval: &McpToolApprovalConfig,
    decision: UserToolDecision,
) -> Result<(), ApiError> {
    match decision {
        UserToolDecision::AlwaysAllow if !approval.allow_always => Err((
            StatusCode::BAD_REQUEST,
            "Always allow is disabled by MCP approval policy".to_string(),
        )),
        UserToolDecision::Ask if !approval.enabled => Err((
            StatusCode::BAD_REQUEST,
            "Asking before a tool runs needs MCP approvals to be enabled".to_string(),
        )),
        _ => Ok(()),
    }
}

/// An unknown server is a bad request (parity with the earlier contract),
/// a configured one the policy withholds from the caller is forbidden.
async fn ensure_server_authorized(
    mcp: &McpAppState,
    me_user: &MeProfile,
    policy: &PolicyEngine,
    mcp_server_id: &str,
) -> Result<(), ApiError> {
    if !mcp.config.mcp_servers.contains_key(mcp_server_id) {
        return Err((StatusCode::BAD_REQUEST, "Unknown MCP server".to_string()));
    }
    let authorized = authorized_server_ids(mcp, me_user, policy)
        .await
        .map_err(|status| (status, "Failed to evaluate MCP server access".to_string()))?;
    if !authorized.iter().any(|id| id == mcp_server_id) {
        return Err((
            StatusCode::FORBIDDEN,
            "Not authorized to access the MCP server".to_string(),
        ));
    }
    Ok(())
}

fn ensure_tool_name(tool_name: &str) -> Result<(), ApiError> {
    if tool_name.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Tool name must not be empty".to_string(),
        ));
    }
    Ok(())
}

fn parse_user_id(me_user: &MeProfile) -> Result<Uuid, ApiError> {
    Uuid::parse_str(&me_user.id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "MCP approval settings require a UUID-backed user".to_string(),
        )
    })
}

fn internal_error(error: eyre::Report) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}
