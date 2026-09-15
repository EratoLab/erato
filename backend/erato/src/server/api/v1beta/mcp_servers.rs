use crate::config::{McpServerAuthenticationConfig, McpServerConfig};
use crate::distribution::runtime::McpAppState;
use crate::models::user_tool_approval_setting::{UserToolDecision, decision_of};
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::display_text::{
    MAX_DISPLAY_DESCRIPTION_CHARS, MAX_DISPLAY_NAME_CHARS, sanitize_display_text,
};
use crate::services::mcp_manager::McpRequestAuthContext;
use crate::services::mcp_oauth::{
    CompleteOauthAuthorizationParams, complete_oauth_authorization, disconnect_oauth_authorization,
    start_oauth_authorization,
};
use crate::services::mcp_session_manager::{McpServerConnectionStatus, is_tool_allowed_to_wait};
use crate::services::mcp_tool_approval::{
    McpToolEffectiveState, effective_mcp_tool_state, evaluate_mcp_tool_approval,
};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::{Extension, Json};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
pub enum McpServerToolPolicy {
    Auto,
    Ask,
}

/// The requesting user's stored decision for the tool, whether or not the
/// policy currently honors it.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum McpServerToolUserDecision {
    None,
    AlwaysAllow,
    Ask,
    Denied,
}

impl From<Option<UserToolDecision>> for McpServerToolUserDecision {
    fn from(decision: Option<UserToolDecision>) -> Self {
        match decision {
            None => McpServerToolUserDecision::None,
            Some(UserToolDecision::AlwaysAllow) => McpServerToolUserDecision::AlwaysAllow,
            Some(UserToolDecision::Ask) => McpServerToolUserDecision::Ask,
            Some(UserToolDecision::Denied) => McpServerToolUserDecision::Denied,
        }
    }
}

/// One tool as the server declares it. `title` and `description` are vendor
/// text passed through `sanitize_display_text`; a client shows them as plain
/// text and never interprets them. `name` is the tool's identity, not display
/// text: a client sends it back unchanged when it stores a decision or
/// switches the tool off for a chat, and every gate compares it byte for byte
/// with the name the server declares.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct McpServerTool {
    /// The name the server declares, verbatim; the key a client echoes back.
    pub name: String,
    /// Display text: the server's title, else its annotation title, else the
    /// name, each cleaned; the first that survives cleaning.
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Whether the description was cut at the display cap.
    pub description_truncated: bool,
    pub annotations: McpServerToolAnnotations,
    /// The policy's own verdict, before any user decision.
    pub policy: McpServerToolPolicy,
    pub user_decision: McpServerToolUserDecision,
    /// What happens on the next call; a client renders this rather than
    /// re-deriving it from the other two.
    pub effective: McpToolEffectiveState,
    pub is_wait_tool: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListMcpServerToolsResponse {
    pub server_id: String,
    pub status: McpServerStatusValue,
    /// Whether the approval policy honors persistent "always allow" grants;
    /// a settings surface offers that decision only when this is set, the
    /// same way the in-chat approval card does.
    pub allow_always: bool,
    /// Whether a stored "ask" decision is honored: it needs the approval
    /// gate, so with approvals disabled the decision is stored but inert.
    pub ask_available: bool,
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
    let user_decisions: HashMap<String, UserToolDecision> =
        crate::models::user_tool_approval_setting::list_active_for_server(
            &app_state.db,
            user_id,
            &server_id,
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .iter()
        .map(|setting| (setting.tool_name.clone(), decision_of(setting)))
        .collect();

    let mut tools: Vec<McpServerTool> = enumeration
        .tools
        .iter()
        .map(|tool| {
            let name = tool.name.as_ref();
            project_mcp_server_tool(
                &global.approval,
                tool,
                user_decisions.get(name).copied(),
                global.enable_wait || is_tool_allowed_to_wait(name, &config),
            )
        })
        .collect();
    sort_tools_by_title(&mut tools);

    Ok(Json(ListMcpServerToolsResponse {
        server_id,
        status: map_status(enumeration.status),
        allow_always: global.approval.allow_always,
        ask_available: global.approval.enabled,
        tools,
    }))
}

/// Project one declared tool for a client. Decisions, the wait list and the
/// call gates are all keyed by the name the server uses, so `name` leaves
/// here untouched and only the display text is cleaned.
fn project_mcp_server_tool(
    approval: &crate::config::McpToolApprovalConfig,
    tool: &rmcp::model::Tool,
    user_decision: Option<UserToolDecision>,
    is_wait_tool: bool,
) -> McpServerTool {
    let verdict = evaluate_mcp_tool_approval(approval, tool);
    let name = tool.name.to_string();
    let title = [
        tool.title.as_deref(),
        tool.annotations
            .as_ref()
            .and_then(|annotations| annotations.title.as_deref()),
    ]
    .into_iter()
    .flatten()
    .map(|candidate| sanitize_display_text(candidate, MAX_DISPLAY_NAME_CHARS).text)
    .find(|candidate| !candidate.is_empty())
    .unwrap_or_else(|| sanitize_display_text(&name, MAX_DISPLAY_NAME_CHARS).text);
    let description = tool
        .description
        .as_deref()
        .map(|value| sanitize_display_text(value, MAX_DISPLAY_DESCRIPTION_CHARS))
        .filter(|value| !value.text.is_empty());
    McpServerTool {
        title,
        description_truncated: description.as_ref().is_some_and(|value| value.truncated),
        description: description.map(|value| value.text),
        annotations: McpServerToolAnnotations {
            read_only_hint: verdict.annotations.read_only_hint,
            destructive_hint: verdict.annotations.destructive_hint,
            idempotent_hint: verdict.annotations.idempotent_hint,
            open_world_hint: verdict.annotations.open_world_hint,
            annotated: verdict.annotated,
        },
        policy: if verdict.requires_approval {
            McpServerToolPolicy::Ask
        } else {
            McpServerToolPolicy::Auto
        },
        user_decision: user_decision.into(),
        effective: effective_mcp_tool_state(approval, &verdict, user_decision),
        is_wait_tool,
        name,
    }
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

pub(crate) async fn authorized_server_ids(
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
            description_truncated: false,
            annotations: McpServerToolAnnotations {
                read_only_hint: false,
                destructive_hint: true,
                idempotent_hint: false,
                open_world_hint: true,
                annotated: false,
            },
            policy: McpServerToolPolicy::Auto,
            user_decision: McpServerToolUserDecision::None,
            effective: McpToolEffectiveState::Allow,
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

    fn projected(name: &str, title: Option<&str>) -> McpServerTool {
        let mut tool = rmcp::model::Tool::new(
            name.to_string(),
            "reads a fixture",
            rmcp::model::JsonObject::new(),
        );
        tool.title = title.map(str::to_string);
        let approval = crate::config::McpToolApprovalConfig {
            enabled: true,
            preset: crate::config::McpToolApprovalPreset::Restrictive,
            allow_always: true,
        };
        project_mcp_server_tool(&approval, &tool, Some(UserToolDecision::Denied), false)
    }

    #[test]
    fn projection_keeps_the_declared_name_as_the_key() {
        let hostile = "read\u{200E}file";
        let tool = projected(hostile, None);
        assert_eq!(tool.name, hostile);
        assert_eq!(tool.title, "readfile");
        assert!(matches!(
            tool.user_decision,
            McpServerToolUserDecision::Denied
        ));

        let long_name = "x".repeat(MAX_DISPLAY_NAME_CHARS + 1);
        let tool = projected(&long_name, None);
        assert_eq!(tool.name, long_name);
        assert_eq!(tool.title.chars().count(), MAX_DISPLAY_NAME_CHARS);
    }

    #[test]
    fn projection_falls_back_to_the_name_when_the_title_cleans_to_nothing() {
        assert_eq!(projected("read_file", Some("\u{202E}")).title, "read_file");
        assert_eq!(projected("read_file", Some("")).title, "read_file");
        assert_eq!(
            projected("read_file", Some(" Read file ")).title,
            "Read file"
        );
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
