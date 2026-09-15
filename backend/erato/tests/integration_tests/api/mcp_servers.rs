//! MCP server enumeration API tests.

use axum::http;
use erato::config::{
    McpServerAuthenticationConfig, McpServerConfig, McpServerOauth2AuthenticationConfig,
    McpServerPermissionRule, McpToolApprovalConfig, McpToolApprovalPreset,
};
use erato::models::user::get_or_create_user;
use erato::models::user_tool_approval_setting::{UserToolDecision, upsert_active};
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
    upsert_active(
        &app_state.db,
        user.id,
        "research",
        "deep_research_poll",
        UserToolDecision::AlwaysAllow,
    )
    .await
    .expect("Failed to store always-allow setting");
    upsert_active(
        &app_state.db,
        user.id,
        "research",
        "deep_research_dispatch",
        UserToolDecision::Denied,
    )
    .await
    .expect("Failed to store denied setting");
    let server = create_test_server(app_state);

    let response = server
        .get("/api/v1beta/me/mcp_servers/research/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let body: Value = response.json();

    assert_eq!(body["server_id"], "research");
    assert_eq!(body["status"], "SUCCESS");
    assert_eq!(body["allow_always"], true);
    assert_eq!(body["ask_available"], true);
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
    assert_eq!(dispatch["policy"], "ask");
    assert_eq!(dispatch["user_decision"], "denied");
    assert_eq!(dispatch["effective"], "denied");
    assert_eq!(dispatch["is_wait_tool"], false);

    let poll = &tools[1];
    assert_eq!(poll["annotations"]["read_only_hint"], true);
    assert_eq!(poll["annotations"]["annotated"], true);
    assert_eq!(poll["policy"], "auto");
    assert_eq!(poll["user_decision"], "always_allow");
    assert_eq!(poll["effective"], "allow");
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
    // The default policy honors no persistent grants and cannot ask.
    assert_eq!(body["allow_always"], false);
    assert_eq!(body["ask_available"], false);
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

/// The enumeration carries the policy verdict, the stored decision and the
/// effective state as three separate facts, so a client never re-derives
/// one from the others: a stored decision the policy does not honor is still
/// reported as stored, while `effective` says what will actually happen.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_list_mcp_server_tools_separates_policy_decision_and_effect(pool: Pool<Postgres>) {
    let mock_mcp_base_url = mock_mcp_base_url();
    let approval_server = || {
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        )
    };
    let app_state_with = |approval: McpToolApprovalConfig, pool: Pool<Postgres>| async move {
        let (mut app_config, llm_server) = setup_mock_llm_server(None).await;
        app_config
            .mcp_servers
            .insert("approval".to_string(), approval_server());
        app_config.mcp_servers_global.approval = approval;
        (test_app_state(app_config, pool).await, llm_server)
    };
    let projection = |body: &Value, name: &str| -> (String, String, String) {
        let tool = body["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == name)
            .unwrap_or_else(|| panic!("{name} listed"));
        (
            tool["policy"].as_str().unwrap().to_string(),
            tool["user_decision"].as_str().unwrap().to_string(),
            tool["effective"].as_str().unwrap().to_string(),
        )
    };
    let row = |policy: &str, decision: &str, effective: &str| {
        (
            policy.to_string(),
            decision.to_string(),
            effective.to_string(),
        )
    };

    // The fixture is read-only and closed-world (auto under both presets);
    // the probe is open-world (asks under the restrictive preset).
    let (app_state, _llm_server) = app_state_with(
        McpToolApprovalConfig {
            enabled: true,
            preset: McpToolApprovalPreset::Restrictive,
            allow_always: true,
        },
        pool.clone(),
    )
    .await;
    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = create_test_server(app_state);

    let body: Value = server
        .get("/api/v1beta/me/mcp_servers/approval/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(body["allow_always"], true);
    assert_eq!(body["ask_available"], true);
    assert_eq!(
        projection(&body, "read_approval_fixture"),
        row("auto", "none", "allow")
    );
    assert_eq!(
        projection(&body, "publish_approval_probe"),
        row("ask", "none", "ask")
    );

    upsert_active(
        &db,
        user.id,
        "approval",
        "read_approval_fixture",
        UserToolDecision::Ask,
    )
    .await
    .unwrap();
    upsert_active(
        &db,
        user.id,
        "approval",
        "publish_approval_probe",
        UserToolDecision::AlwaysAllow,
    )
    .await
    .unwrap();
    let body: Value = server
        .get("/api/v1beta/me/mcp_servers/approval/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(
        projection(&body, "read_approval_fixture"),
        row("auto", "ask", "ask")
    );
    assert_eq!(
        projection(&body, "publish_approval_probe"),
        row("ask", "always_allow", "allow")
    );

    // Grants are inert without `allow_always`, but still reported as stored.
    let (app_state, _llm_server) = app_state_with(
        McpToolApprovalConfig {
            enabled: true,
            preset: McpToolApprovalPreset::Restrictive,
            allow_always: false,
        },
        pool.clone(),
    )
    .await;
    let no_grants = create_test_server(app_state);
    let body: Value = no_grants
        .get("/api/v1beta/me/mcp_servers/approval/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(body["allow_always"], false);
    assert_eq!(body["ask_available"], true);
    assert_eq!(
        projection(&body, "read_approval_fixture"),
        row("auto", "ask", "ask")
    );
    assert_eq!(
        projection(&body, "publish_approval_probe"),
        row("ask", "always_allow", "ask")
    );

    // With the gate off nothing asks and an ask is inert; a denial holds.
    upsert_active(
        &db,
        user.id,
        "approval",
        "publish_approval_probe",
        UserToolDecision::Denied,
    )
    .await
    .unwrap();
    let (app_state, _llm_server) = app_state_with(
        McpToolApprovalConfig {
            enabled: false,
            preset: McpToolApprovalPreset::Restrictive,
            allow_always: false,
        },
        pool,
    )
    .await;
    let disabled = create_test_server(app_state);
    let body: Value = disabled
        .get("/api/v1beta/me/mcp_servers/approval/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(body["allow_always"], false);
    assert_eq!(body["ask_available"], false);
    assert_eq!(
        projection(&body, "read_approval_fixture"),
        row("auto", "ask", "allow")
    );
    assert_eq!(
        projection(&body, "publish_approval_probe"),
        row("auto", "denied", "denied")
    );

    // Back on the gated server the denial holds as well.
    let body: Value = server
        .get("/api/v1beta/me/mcp_servers/approval/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(
        projection(&body, "publish_approval_probe"),
        row("ask", "denied", "denied")
    );
}

/// Vendor text reaches the client as inert, bounded plain text: markup stays
/// literal, bidi and control characters are gone, and an oversized
/// description is cut at the cap and flagged.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_list_mcp_server_tools_sanitizes_vendor_text(pool: Pool<Postgres>) {
    // The in-process mock keeps the fixture next to the assertion instead of
    // depending on the shared mock server's build.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock MCP listener");
    let mock_mcp_base_url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(axum::serve(listener, mock_mcp_server::app()).into_future());

    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;
    app_config.mcp_servers.insert(
        "untrusted".to_string(),
        mcp_server_config(
            &mock_mcp_base_url,
            "/mcp/untrusted-text",
            McpServerAuthenticationConfig::None,
        ),
    );
    let app_state = test_app_state(app_config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let server = create_test_server(app_state);

    let response = server
        .get("/api/v1beta/me/mcp_servers/untrusted/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let body: Value = response.json();
    assert_eq!(body["status"], "SUCCESS");
    let tools = body["tools"].as_array().expect("tools array");
    assert_eq!(tools.len(), 3);
    let untrusted = tools
        .iter()
        .find(|tool| tool["name"] == mock_mcp_server::UNTRUSTED_TEXT_TOOL_NAME)
        .expect("untrusted tool listed");
    let plain = tools
        .iter()
        .find(|tool| tool["name"] == mock_mcp_server::PLAIN_TEXT_TOOL_NAME)
        .expect("plain tool listed");

    let title = untrusted["title"].as_str().unwrap();
    assert_eq!(
        title,
        format!("{} eltit", mock_mcp_server::UNTRUSTED_TEXT_MARKUP)
    );

    let description = untrusted["description"].as_str().unwrap();
    assert!(
        description.starts_with(&format!(
            "{} reversed\n\nbody follows\n",
            mock_mcp_server::UNTRUSTED_TEXT_MARKUP
        )),
        "{description:?}"
    );
    assert!(!description.contains(['\u{202E}', '\u{202C}', '\u{7}']));
    assert_eq!(description.chars().count(), 4_000);
    assert!(description.ends_with('ä'));
    assert_eq!(untrusted["description_truncated"], true);

    assert_eq!(plain["description"], "Reads a plainly described fixture");
    assert_eq!(plain["description_truncated"], false);

    // The name is the key a client posts back, so it leaves verbatim even
    // where cleaning would change it; only the title is the cleaned form.
    let hostile = tools
        .iter()
        .find(|tool| tool["name"] == mock_mcp_server::HOSTILE_NAME_TOOL_NAME)
        .expect("tool with a hostile name listed under its declared name");
    assert_eq!(hostile["title"], "readfile");
    assert_eq!(hostile["user_decision"], "none");

    let decision = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "untrusted",
            "tool_name": mock_mcp_server::HOSTILE_NAME_TOOL_NAME,
            "decision": "denied",
        }))
        .await;
    decision.assert_status_ok();

    let response = server
        .get("/api/v1beta/me/mcp_servers/untrusted/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let body: Value = response.json();
    let hostile = body["tools"]
        .as_array()
        .expect("tools array")
        .iter()
        .find(|tool| tool["name"] == mock_mcp_server::HOSTILE_NAME_TOOL_NAME)
        .expect("tool with a hostile name still listed")
        .clone();
    assert_eq!(hostile["user_decision"], "denied");
    assert_eq!(hostile["effective"], "denied");
}
