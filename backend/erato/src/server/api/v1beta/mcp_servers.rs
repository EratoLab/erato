use crate::config::{McpServerAuthenticationConfig, McpServerConfig};
use crate::distribution::runtime::McpAppState;
use crate::models::user_tool_approval_setting::{UserToolDecision, decision_of};
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::mcp_manager::McpRequestAuthContext;
use crate::services::mcp_oauth::{
    CompleteOauthAuthorizationParams, complete_oauth_authorization, disconnect_oauth_authorization,
    start_oauth_authorization,
};
use crate::services::mcp_session_manager::{McpServerConnectionStatus, is_tool_allowed_to_wait};
use crate::services::mcp_tool_approval::evaluate_mcp_tool_approval;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::{Extension, Json};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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

/// MCP tool hints with absent values normalized to the protocol defaults.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct McpServerToolAnnotations {
    pub read_only_hint: bool,
    pub destructive_hint: bool,
    pub idempotent_hint: bool,
    pub open_world_hint: bool,
    /// Whether the server declared any hints at all. Defaults are the
    /// pessimistic reading, so an unannotated tool is not read-only.
    pub annotated: bool,
}

/// What the configured approval policy does before running the tool.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum McpServerToolApproval {
    Auto,
    Ask,
}

/// The requesting user's persistent decision for the tool.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum McpServerToolUserDecision {
    Ask,
    Always,
    Denied,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct McpServerTool {
    pub name: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub annotations: McpServerToolAnnotations,
    pub approval: McpServerToolApproval,
    pub user_decision: McpServerToolUserDecision,
    pub is_wait_tool: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListMcpServerToolsResponse {
    pub server_id: String,
    pub status: McpServerStatusValue,
    /// Empty unless `status` is `SUCCESS`; sorted by title.
    pub tools: Vec<McpServerTool>,
}

#[derive(Debug, Deserialize)]
pub struct McpOauthCallbackQuery {
    pub code: String,
    pub state: String,
    pub iss: Option<String>,
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
    let mcp = app_state.mcp_state().await;
    let user_id = parse_user_id(&me_user)?;
    let auth_context = auth_context(&app_state, &me_user, user_id);
    let server_ids = authorized_server_ids(&mcp, &me_user, &policy).await?;

    let mut servers = Vec::with_capacity(server_ids.len());
    for server_id in server_ids {
        let Some(config) = mcp.config.mcp_servers.get(&server_id) else {
            continue;
        };
        let connection_status = mcp
            .servers
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
    get,
    path = "/me/mcp_servers/{server_id}/tools",
    params(
        ("server_id" = String, Path, description = "Configured MCP server ID")
    ),
    responses(
        (status = OK, body = ListMcpServerToolsResponse),
        (status = FORBIDDEN, description = "The user is not authorized to access the MCP server"),
        (status = NOT_FOUND, description = "The server is not configured"),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn list_mcp_server_tools(
    State(app_state): State<AppState>,
    Path(server_id): Path<String>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
) -> Result<Json<ListMcpServerToolsResponse>, StatusCode> {
    let mcp = app_state.mcp_state().await;
    let user_id = parse_user_id(&me_user)?;
    let config = authorized_server_config(&mcp, &me_user, &policy, &server_id).await?;
    let auth_context = auth_context(&app_state, &me_user, user_id);

    let enumeration = mcp.servers.enumerate_tools(&server_id, &auth_context).await;

    let global = &mcp.config.mcp_servers_global;
    // The gate only honors persistent grants while `allow_always` is on, so a
    // stored grant must not read as "always" when it would still ask. A denial
    // is enforced regardless of the approval policy.
    let mut always_allowed_tools: HashSet<String> = HashSet::new();
    let mut denied_tools: HashSet<String> = HashSet::new();
    for setting in crate::models::user_tool_approval_setting::list_active(&app_state.db, user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        if setting.mcp_server_id != server_id {
            continue;
        }
        match decision_of(&setting) {
            UserToolDecision::Denied => {
                denied_tools.insert(setting.tool_name);
            }
            UserToolDecision::AlwaysAllow if global.approval.allow_always => {
                always_allowed_tools.insert(setting.tool_name);
            }
            UserToolDecision::AlwaysAllow => {}
        }
    }

    let mut tools: Vec<McpServerTool> = enumeration
        .tools
        .iter()
        .map(|tool| {
            let verdict = evaluate_mcp_tool_approval(&global.approval, tool);
            let name = tool.name.to_string();
            McpServerTool {
                title: tool
                    .title
                    .clone()
                    .or_else(|| {
                        tool.annotations
                            .as_ref()
                            .and_then(|annotations| annotations.title.clone())
                    })
                    .unwrap_or_else(|| name.clone()),
                description: tool.description.as_ref().map(|value| value.to_string()),
                annotations: McpServerToolAnnotations {
                    read_only_hint: verdict.annotations.read_only_hint,
                    destructive_hint: verdict.annotations.destructive_hint,
                    idempotent_hint: verdict.annotations.idempotent_hint,
                    open_world_hint: verdict.annotations.open_world_hint,
                    annotated: verdict.annotated,
                },
                approval: if verdict.requires_approval {
                    McpServerToolApproval::Ask
                } else {
                    McpServerToolApproval::Auto
                },
                user_decision: if denied_tools.contains(&name) {
                    McpServerToolUserDecision::Denied
                } else if always_allowed_tools.contains(&name) {
                    McpServerToolUserDecision::Always
                } else {
                    McpServerToolUserDecision::Ask
                },
                is_wait_tool: global.enable_wait || is_tool_allowed_to_wait(&name, &config),
                name,
            }
        })
        .collect();
    sort_tools_by_title(&mut tools);

    Ok(Json(ListMcpServerToolsResponse {
        server_id,
        status: map_status(enumeration.status),
        tools,
    }))
}

fn sort_tools_by_title(tools: &mut [McpServerTool]) {
    tools.sort_by(|a, b| a.title.cmp(&b.title).then_with(|| a.name.cmp(&b.name)));
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
    let mcp = app_state.mcp_state().await;
    let user_id = parse_user_id(&me_user)?;
    let config = authorized_oauth_server_config(&mcp, &me_user, &policy, &server_id).await?;
    let McpServerAuthenticationConfig::Oauth2 { oauth2 } = &config.authentication else {
        return Err(StatusCode::BAD_REQUEST);
    };

    let redirect_uri = oauth_callback_url(&headers)?;
    let authorization_url = start_oauth_authorization(
        &app_state,
        user_id,
        &server_id,
        &config,
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
        ("state" = String, Query, description = "OAuth authorization state"),
        ("iss" = Option<String>, Query, description = "OAuth authorization response issuer")
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
    let mcp = app_state.mcp_state().await;
    let user_id = parse_user_id(&me_user)?;
    let config = authorized_oauth_server_config(&mcp, &me_user, &policy, &server_id).await?;
    let McpServerAuthenticationConfig::Oauth2 { oauth2 } = &config.authentication else {
        return Err(StatusCode::BAD_REQUEST);
    };

    let redirect_uri = oauth_callback_url(&headers)?;
    complete_oauth_authorization(CompleteOauthAuthorizationParams {
        app_state: &app_state,
        user_id,
        mcp_server_id: &server_id,
        config: &config,
        oauth2,
        redirect_uri: &redirect_uri,
        code: &query.code,
        csrf_token: &query.state,
        issuer: query.iss.as_deref(),
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let connection_status = mcp
        .servers
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
    let mcp = app_state.mcp_state().await;
    let user_id = parse_user_id(&me_user)?;
    let config = authorized_oauth_server_config(&mcp, &me_user, &policy, &server_id).await?;
    let McpServerAuthenticationConfig::Oauth2 { .. } = &config.authentication else {
        return Err(StatusCode::BAD_REQUEST);
    };

    let active_oauth_token =
        if let McpServerAuthenticationConfig::Oauth2 { oauth2 } = &config.authentication {
            crate::services::mcp_oauth::resolve_oauth_access_token(
                &app_state, user_id, &server_id, &config, oauth2,
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
        mcp.servers
            .invalidate_oauth_sessions_for_token(&server_id, access_token)
            .await;
    }

    let connection_status = mcp
        .servers
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
    mcp: &McpAppState,
    me_user: &MeProfile,
    policy: &PolicyEngine,
) -> Result<Vec<String>, StatusCode> {
    let mut server_ids = policy
        .filter_authorized_mcp_server_ids(
            &me_user.to_subject(),
            &me_user.groups,
            &mcp.config.mcp_servers.keys().cloned().collect::<Vec<_>>(),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    server_ids.sort();
    Ok(server_ids)
}

async fn authorized_oauth_server_config(
    mcp: &McpAppState,
    me_user: &MeProfile,
    policy: &PolicyEngine,
    server_id: &str,
) -> Result<McpServerConfig, StatusCode> {
    let authorized_ids = authorized_server_ids(mcp, me_user, policy).await?;
    if !authorized_ids.iter().any(|id| id == server_id) {
        return Err(StatusCode::FORBIDDEN);
    }
    mcp.config
        .mcp_servers
        .get(server_id)
        .cloned()
        .ok_or(StatusCode::NOT_FOUND)
}

/// Unlike the OAuth helper, an unconfigured id is reported as missing rather
/// than forbidden: the policy can never grant a server that does not exist.
async fn authorized_server_config(
    mcp: &McpAppState,
    me_user: &MeProfile,
    policy: &PolicyEngine,
    server_id: &str,
) -> Result<McpServerConfig, StatusCode> {
    let config = mcp
        .config
        .mcp_servers
        .get(server_id)
        .cloned()
        .ok_or(StatusCode::NOT_FOUND)?;
    let authorized_ids = authorized_server_ids(mcp, me_user, policy).await?;
    if !authorized_ids.iter().any(|id| id == server_id) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(config)
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

fn oauth_callback_url(headers: &HeaderMap) -> Result<String, StatusCode> {
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
        "{}://{}{}",
        scheme,
        host,
        prefix.trim_end_matches('/'),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_row(name: &str, title: &str) -> McpServerTool {
        McpServerTool {
            name: name.to_string(),
            title: title.to_string(),
            description: None,
            annotations: McpServerToolAnnotations {
                read_only_hint: false,
                destructive_hint: true,
                idempotent_hint: false,
                open_world_hint: true,
                annotated: false,
            },
            approval: McpServerToolApproval::Auto,
            user_decision: McpServerToolUserDecision::Ask,
            is_wait_tool: false,
        }
    }

    #[test]
    fn tools_sort_by_title_before_name() {
        let mut tools = vec![
            tool_row("a_tool", "Zebra"),
            tool_row("z_tool", "Apple"),
            tool_row("m_tool", "Apple"),
        ];
        sort_tools_by_title(&mut tools);
        let order: Vec<&str> = tools.iter().map(|tool| tool.name.as_str()).collect();
        assert_eq!(order, vec!["m_tool", "z_tool", "a_tool"]);
    }

    #[test]
    fn oauth_callback_uses_application_root() {
        let mut headers = HeaderMap::new();
        headers.insert("host", "localhost:4180".parse().unwrap());
        assert_eq!(
            oauth_callback_url(&headers).unwrap(),
            "http://localhost:4180"
        );
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        headers.insert("x-forwarded-host", "erato.example.com".parse().unwrap());
        assert_eq!(
            oauth_callback_url(&headers).unwrap(),
            "https://erato.example.com"
        );
        headers.insert("x-forwarded-prefix", "/erato/".parse().unwrap());
        assert_eq!(
            oauth_callback_url(&headers).unwrap(),
            "https://erato.example.com/erato"
        );
    }

    #[test]
    fn oauth_callback_requires_host() {
        assert_eq!(
            oauth_callback_url(&HeaderMap::new()),
            Err(StatusCode::BAD_REQUEST)
        );
    }
}
