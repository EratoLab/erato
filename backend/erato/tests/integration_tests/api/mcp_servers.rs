//! MCP server enumeration API tests.

use axum::http;
use erato::config::{
    McpServerAuthenticationConfig, McpServerConfig, McpServerOauth2AuthenticationConfig,
    McpServerPermissionRule, McpToolApprovalConfig, McpToolApprovalPreset,
};
use erato::models::user::get_or_create_user;
use erato::models::user_tool_approval_setting::upsert_active;
use erato::services::mcp_manager::McpRequestAuthContext;
use mocktail::server::{MockServer, MockServerConfig};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::env;
use std::net::{IpAddr, Ipv4Addr};

use crate::test_app_state;
use crate::test_utils::{
    JwtTokenBuilder, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt,
    create_test_server, setup_mock_llm_server,
};

fn mock_mcp_base_url() -> String {
    env::var("TEST_MOCK_MCP_SERVER_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:44321".to_string())
}

fn mcp_server_config(
    base_url: &str,
    path: &str,
    authentication: McpServerAuthenticationConfig,
) -> McpServerConfig {
    McpServerConfig {
        transport_type: "streamable_http".to_string(),
        url: format!("{base_url}{path}"),
        http_headers: None,
        allow_tools: None,
        exclude_tools: vec![],
        wait_tools: vec![],
        authentication,
        max_session_idle_seconds: None,
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_list_mcp_server_tools_projects_effective_values(pool: Pool<Postgres>) {
    let mock_mcp_base_url = mock_mcp_base_url();
    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;

    let mut research = mcp_server_config(
        &mock_mcp_base_url,
        "/mcp/deep-research",
        McpServerAuthenticationConfig::None,
    );
    research.wait_tools = vec!["deep_research_poll".to_string()];
    app_config
        .mcp_servers
        .insert("research".to_string(), research);
    app_config.mcp_servers_global.approval = McpToolApprovalConfig {
        enabled: true,
        preset: McpToolApprovalPreset::Restrictive,
        allow_always: true,
    };

    let app_state = test_app_state(app_config, pool).await;
    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    upsert_active(&app_state.db, user.id, "research", "deep_research_poll")
        .await
        .expect("Failed to store always-allow setting");
    let server = create_test_server(app_state);

    let response = server
        .get("/api/v1beta/me/mcp_servers/research/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let body: Value = response.json();

    assert_eq!(body["server_id"], "research");
    assert_eq!(body["status"], "SUCCESS");
    let tools = body["tools"].as_array().expect("tools array");
    let names: Vec<&str> = tools
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["deep_research_dispatch", "deep_research_poll"]);

    let dispatch = &tools[0];
    assert_eq!(dispatch["title"], "deep_research_dispatch");
    assert!(
        dispatch["description"]
            .as_str()
            .unwrap()
            .contains("Dispatch")
    );
    assert_eq!(
        dispatch["annotations"],
        json!({
            "read_only_hint": false,
            "destructive_hint": false,
            "idempotent_hint": false,
            "open_world_hint": true,
            "annotated": true
        })
    );
    assert_eq!(dispatch["approval"], "ask");
    assert_eq!(dispatch["user_decision"], "ask");
    assert_eq!(dispatch["is_wait_tool"], false);

    let poll = &tools[1];
    assert_eq!(poll["annotations"]["read_only_hint"], true);
    assert_eq!(poll["annotations"]["annotated"], true);
    assert_eq!(poll["approval"], "auto");
    assert_eq!(poll["user_decision"], "always");
    assert_eq!(poll["is_wait_tool"], true);

    let missing = server
        .get("/api/v1beta/me/mcp_servers/not-configured/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    missing.assert_status(http::StatusCode::NOT_FOUND);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_list_mcp_server_tools_is_gated_by_policy(pool: Pool<Postgres>) {
    let mock_mcp_base_url = mock_mcp_base_url();
    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;

    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-premium".to_string(),
        McpServerPermissionRule::AllowForGroupMembers {
            mcp_server_ids: vec!["files".to_string()],
            groups: vec!["premium".to_string()],
        },
    );

    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = create_test_server(app_state);

    let forbidden = server
        .get("/api/v1beta/me/mcp_servers/files/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    forbidden.assert_status(http::StatusCode::FORBIDDEN);

    let premium_token = JwtTokenBuilder::new()
        .groups(vec!["premium".to_string()])
        .build();
    let allowed = server
        .get("/api/v1beta/me/mcp_servers/files/tools")
        .with_bearer_token(&premium_token)
        .await;
    allowed.assert_status_ok();
    let body: Value = allowed.json();
    assert_eq!(body["status"], "SUCCESS");
    let names: Vec<&str> = body["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["list_files", "read_file"]);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_list_mcp_server_tools_reports_unconnected_oauth_server(pool: Pool<Postgres>) {
    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;

    // The OAuth mock only serves authorization-server metadata: token
    // resolution finds it and fails with AuthorizationRequired because no
    // credentials are stored for the user, before any MCP request is made.
    let mockserver_config = MockServerConfig {
        listen_addr: IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
        ..Default::default()
    };
    let oauth_server = MockServer::new_http("mcp-oauth-tools-mock").with_config(mockserver_config);
    oauth_server
        .start()
        .await
        .expect("Failed to start OAuth metadata mock server");
    let oauth_server_base_url = oauth_server.url("").to_string();
    let oauth_server_base_url = oauth_server_base_url.trim_end_matches('/');
    oauth_server.mocks().mock(|when, then| {
        when.get()
            .path("/.well-known/oauth-authorization-server/oauth");
        then.status(http::StatusCode::OK)
            .headers([("Content-Type", "application/json")])
            .json(json!({
                "issuer": format!("{oauth_server_base_url}/oauth"),
                "authorization_endpoint": "http://127.0.0.1:1/authorize",
                "token_endpoint": "http://127.0.0.1:1/token",
            }));
    });

    app_config.mcp_servers.insert(
        "oauth-pending".to_string(),
        mcp_server_config(
            oauth_server_base_url,
            "/oauth",
            McpServerAuthenticationConfig::Oauth2 {
                oauth2: McpServerOauth2AuthenticationConfig {
                    resource: None,
                    client_id: Some("test-oauth-client".to_string()),
                    client_secret: None,
                    scopes: vec![],
                    client_name: None,
                },
            },
        ),
    );

    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = create_test_server(app_state);

    let response = server
        .get("/api/v1beta/me/mcp_servers/oauth-pending/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let body: Value = response.json();
    assert_eq!(body["status"], "NEEDS_AUTHENTICATION");
    assert_eq!(body["tools"], json!([]));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_list_mcp_server_tools_reuses_the_enumeration_session(pool: Pool<Postgres>) {
    let mock_mcp_base_url = mock_mcp_base_url();
    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;

    app_config.mcp_servers.insert(
        "files".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/file",
            McpServerAuthenticationConfig::None,
        ),
    );

    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let mcp = app_state.mcp_state().await;
    let server = create_test_server(app_state);

    assert_eq!(mcp.servers.active_session_count("files").await, 0);

    let first = server
        .get("/api/v1beta/me/mcp_servers/files/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    first.assert_status_ok();
    assert_eq!(mcp.servers.active_session_count("files").await, 1);

    // The list probe opens and tears down its own session under a different
    // key; the enumeration session must survive it.
    mcp.servers
        .probe_connection("files", &McpRequestAuthContext::default())
        .await;
    assert_eq!(mcp.servers.active_session_count("files").await, 1);

    let second = server
        .get("/api/v1beta/me/mcp_servers/files/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    second.assert_status_ok();
    assert_eq!(mcp.servers.active_session_count("files").await, 1);
    let first_body: Value = first.json();
    let second_body: Value = second.json();
    assert_eq!(first_body["tools"], second_body["tools"]);
}
