use crate::config::{McpServerAuthenticationConfig, McpServerConfig};
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::mcp_manager::McpRequestAuthContext;
use crate::services::mcp_oauth::{
    CompleteOauthAuthorizationParams, complete_oauth_authorization, disconnect_oauth_authorization,
    start_oauth_authorization,
};
use crate::services::mcp_session_manager::McpServerConnectionStatus;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::{Extension, Json};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum McpServerStatusValue {
    Success,
    Failure,
    NeedsAuthentication,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct McpServerStatus {
    pub id: String,
    pub authentication_mode: String,
    pub connection_status: McpServerStatusValue,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListMcpServersResponse {
    pub servers: Vec<McpServerStatus>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StartMcpServerOauthResponse {
    pub authorization_url: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CompleteMcpServerOauthResponse {
    pub connection_status: McpServerStatusValue,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DisconnectMcpServerOauthResponse {
    pub connection_status: McpServerStatusValue,
}

#[derive(Debug, Deserialize)]
pub struct McpOauthCallbackQuery {
    pub code: String,
    pub state: String,
}

#[utoipa::path(
    get,
    path = "/me/mcp_servers",
    responses(
        (status = OK, body = ListMcpServersResponse),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn list_mcp_servers(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
) -> Result<Json<ListMcpServersResponse>, StatusCode> {
    let user_id = parse_user_id(&me_user)?;
    let auth_context = auth_context(&app_state, &me_user, user_id);
    let server_ids = authorized_server_ids(&app_state, &me_user, &policy).await?;

    let mut servers = Vec::with_capacity(server_ids.len());
    for server_id in server_ids {
        let Some(config) = app_state.config.mcp_servers.get(&server_id) else {
            continue;
        };
        let connection_status = app_state
            .mcp_servers
            .probe_connection(&server_id, &auth_context)
            .await;
        servers.push(McpServerStatus {
            id: server_id,
            authentication_mode: authentication_mode_name(&config.authentication).to_string(),
            connection_status: map_status(connection_status),
        });
    }

    Ok(Json(ListMcpServersResponse { servers }))
}

#[utoipa::path(
    post,
    path = "/me/mcp_servers/{server_id}/oauth/start",
    params(
        ("server_id" = String, Path, description = "Configured MCP server ID")
    ),
    responses(
        (status = OK, body = StartMcpServerOauthResponse),
        (status = BAD_REQUEST, description = "The server is not configured for oauth2"),
        (status = FORBIDDEN, description = "The user is not authorized to access the MCP server"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn start_mcp_server_oauth(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    Path(server_id): Path<String>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
) -> Result<Json<StartMcpServerOauthResponse>, StatusCode> {
    let user_id = parse_user_id(&me_user)?;
    let config = authorized_oauth_server_config(&app_state, &me_user, &policy, &server_id).await?;
    let McpServerAuthenticationConfig::Oauth2 { oauth2 } = &config.authentication else {
        return Err(StatusCode::BAD_REQUEST);
    };

    let redirect_uri = oauth_callback_url(&headers, &server_id)?;
    let authorization_url = start_oauth_authorization(
        &app_state,
        user_id,
        &server_id,
        config,
        oauth2,
        &redirect_uri,
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(StartMcpServerOauthResponse { authorization_url }))
}

#[utoipa::path(
    get,
    path = "/me/mcp_servers/{server_id}/oauth/callback",
    params(
        ("server_id" = String, Path, description = "Configured MCP server ID"),
        ("code" = String, Query, description = "OAuth authorization code"),
        ("state" = String, Query, description = "OAuth authorization state")
    ),
    responses(
        (status = OK, body = CompleteMcpServerOauthResponse),
        (status = BAD_REQUEST, description = "The server is not configured for oauth2"),
        (status = FORBIDDEN, description = "The user is not authorized to access the MCP server"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn complete_mcp_server_oauth(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    Path(server_id): Path<String>,
    Query(query): Query<McpOauthCallbackQuery>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
) -> Result<Json<CompleteMcpServerOauthResponse>, StatusCode> {
    let user_id = parse_user_id(&me_user)?;
    let config = authorized_oauth_server_config(&app_state, &me_user, &policy, &server_id).await?;
    let McpServerAuthenticationConfig::Oauth2 { oauth2 } = &config.authentication else {
        return Err(StatusCode::BAD_REQUEST);
    };

    let redirect_uri = oauth_callback_url(&headers, &server_id)?;
    complete_oauth_authorization(CompleteOauthAuthorizationParams {
        app_state: &app_state,
        user_id,
        mcp_server_id: &server_id,
        config,
        oauth2,
        redirect_uri: &redirect_uri,
        code: &query.code,
        csrf_token: &query.state,
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let connection_status = app_state
        .mcp_servers
        .probe_connection(&server_id, &auth_context(&app_state, &me_user, user_id))
        .await;

    Ok(Json(CompleteMcpServerOauthResponse {
        connection_status: map_status(connection_status),
    }))
}

#[utoipa::path(
    delete,
    path = "/me/mcp_servers/{server_id}/oauth",
    params(
        ("server_id" = String, Path, description = "Configured MCP server ID")
    ),
    responses(
        (status = OK, body = DisconnectMcpServerOauthResponse),
        (status = BAD_REQUEST, description = "The server is not configured for oauth2"),
        (status = FORBIDDEN, description = "The user is not authorized to access the MCP server"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn disconnect_mcp_server_oauth(
    State(app_state): State<AppState>,
    Path(server_id): Path<String>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
) -> Result<Json<DisconnectMcpServerOauthResponse>, StatusCode> {
    let user_id = parse_user_id(&me_user)?;
    let config = authorized_oauth_server_config(&app_state, &me_user, &policy, &server_id).await?;
    let McpServerAuthenticationConfig::Oauth2 { .. } = &config.authentication else {
        return Err(StatusCode::BAD_REQUEST);
    };

    let active_oauth_token =
        if let McpServerAuthenticationConfig::Oauth2 { oauth2 } = &config.authentication {
            crate::services::mcp_oauth::resolve_oauth_access_token(
                &app_state, user_id, &server_id, config, oauth2,
            )
            .await
            .ok()
        } else {
            None
        };

    disconnect_oauth_authorization(&app_state, user_id, &server_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(access_token) = active_oauth_token.as_deref() {
        app_state
            .mcp_servers
            .invalidate_oauth_sessions_for_token(&server_id, access_token)
            .await;
    }

    let connection_status = app_state
        .mcp_servers
        .probe_connection(&server_id, &auth_context(&app_state, &me_user, user_id))
        .await;

    Ok(Json(DisconnectMcpServerOauthResponse {
        connection_status: map_status(connection_status),
    }))
}

fn auth_context<'a>(
    app_state: &'a AppState,
    me_user: &'a MeProfile,
    user_id: Uuid,
) -> McpRequestAuthContext<'a> {
    McpRequestAuthContext {
        app_state: Some(app_state),
        user_id: Some(user_id),
        oidc_token: Some(&me_user.oidc_token),
        access_token: me_user.access_token.as_deref(),
    }
}

fn parse_user_id(me_user: &MeProfile) -> Result<Uuid, StatusCode> {
    Uuid::parse_str(&me_user.id).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn authorized_server_ids(
    app_state: &AppState,
    me_user: &MeProfile,
    policy: &PolicyEngine,
) -> Result<Vec<String>, StatusCode> {
    let mut server_ids = policy
        .filter_authorized_mcp_server_ids(
            &me_user.to_subject(),
            &me_user.groups,
            &app_state
                .config
                .mcp_servers
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    server_ids.sort();
    Ok(server_ids)
}

async fn authorized_oauth_server_config<'a>(
    app_state: &'a AppState,
    me_user: &MeProfile,
    policy: &PolicyEngine,
    server_id: &str,
) -> Result<&'a McpServerConfig, StatusCode> {
    let authorized_ids = authorized_server_ids(app_state, me_user, policy).await?;
    if !authorized_ids.iter().any(|id| id == server_id) {
        return Err(StatusCode::FORBIDDEN);
    }
    app_state
        .config
        .mcp_servers
        .get(server_id)
        .ok_or(StatusCode::NOT_FOUND)
}

fn map_status(status: McpServerConnectionStatus) -> McpServerStatusValue {
    match status {
        McpServerConnectionStatus::Success => McpServerStatusValue::Success,
        McpServerConnectionStatus::Failure => McpServerStatusValue::Failure,
        McpServerConnectionStatus::NeedsAuthentication => McpServerStatusValue::NeedsAuthentication,
    }
}

fn authentication_mode_name(authentication: &McpServerAuthenticationConfig) -> &'static str {
    match authentication {
        McpServerAuthenticationConfig::None => "none",
        McpServerAuthenticationConfig::Forwarded { .. } => "forwarded",
        McpServerAuthenticationConfig::Fixed { .. } => "fixed",
        McpServerAuthenticationConfig::Oauth2 { .. } => "oauth2",
    }
}

fn oauth_callback_url(headers: &HeaderMap, server_id: &str) -> Result<String, StatusCode> {
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("http");
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get("host"))
        .and_then(|value| value.to_str().ok())
        .ok_or(StatusCode::BAD_REQUEST)?;
    let prefix = headers
        .get("x-forwarded-prefix")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    Ok(format!(
        "{}://{}{}?preferencesDialog=open&preferencesTab=mcpServers&mcpOauthServerId={server_id}",
        scheme,
        host,
        prefix.trim_end_matches('/'),
    ))
}
