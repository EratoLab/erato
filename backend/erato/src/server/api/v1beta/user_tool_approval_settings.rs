use crate::models::user_tool_approval_setting;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::{Extension, Json};
use sqlx::types::Uuid;
use utoipa::ToSchema;

#[derive(serde::Serialize, ToSchema)]
pub struct UserToolApprovalSetting {
    pub id: Uuid,
    pub mcp_server_id: String,
    pub tool_name: String,
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
) -> Result<Json<UserToolApprovalSettingsResponse>, (axum::http::StatusCode, String)> {
    let user_id = Uuid::parse_str(&me_user.id).map_err(|_| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            "MCP approval settings require a UUID-backed user".to_string(),
        )
    })?;
    let settings = user_tool_approval_setting::list_active(&app_state.db, user_id)
        .await
        .map_err(|error| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                error.to_string(),
            )
        })?;
    Ok(Json(UserToolApprovalSettingsResponse {
        settings: settings
            .into_iter()
            .map(|setting| UserToolApprovalSetting {
                id: setting.id,
                mcp_server_id: setting.mcp_server_id,
                tool_name: setting.tool_name,
            })
            .collect(),
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
) -> Result<axum::http::StatusCode, (axum::http::StatusCode, String)> {
    let user_id = Uuid::parse_str(&me_user.id).map_err(|_| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            "MCP approval settings require a UUID-backed user".to_string(),
        )
    })?;
    let deactivated = user_tool_approval_setting::deactivate(&app_state.db, user_id, setting_id)
        .await
        .map_err(|error| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                error.to_string(),
            )
        })?;
    deactivated
        .then_some(axum::http::StatusCode::NO_CONTENT)
        .ok_or_else(|| {
            (
                axum::http::StatusCode::NOT_FOUND,
                "Approval setting not found".to_string(),
            )
        })
}
