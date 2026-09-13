//! Per-user MCP tool decision API tests.

use axum::http;
use erato::config::{McpServerAuthenticationConfig, McpServerConfig, McpToolApprovalConfig};
use erato::models::user::get_or_create_user;
use erato::models::user_tool_approval_setting::{
    UserToolDecision, find_active_always_allow, list_denied, upsert_active,
};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_app_state;
use crate::test_utils::{
    TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt, create_test_server,
    setup_mock_llm_server,
};

fn files_server_config() -> McpServerConfig {
    McpServerConfig {
        transport_type: "streamable_http".to_string(),
        url: "http://127.0.0.1:44321/mcp/file".to_string(),
        http_headers: None,
        allow_tools: None,
        exclude_tools: vec![],
        wait_tools: vec![],
        authentication: McpServerAuthenticationConfig::None,
        max_session_idle_seconds: None,
    }
}

/// A denial is strictly more restrictive than the approval policy, so it is
/// accepted in a deployment that never enables approvals, while a grant is
/// still refused there. The in-stream gate reader must not mistake the
/// denial row for a grant.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_denial_is_stored_without_an_approval_policy(pool: Pool<Postgres>) {
    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;
    app_config
        .mcp_servers
        .insert("files".to_string(), files_server_config());
    app_config.mcp_servers_global.approval = McpToolApprovalConfig {
        enabled: false,
        allow_always: false,
        ..Default::default()
    };

    let app_state = test_app_state(app_config, pool).await;
    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = create_test_server(app_state);

    let grant = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "mcp_server_id": "files", "tool_name": "read_file" }))
        .await;
    grant.assert_status(http::StatusCode::BAD_REQUEST);

    let denied = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "tool_name": "read_file",
            "decision": "denied",
        }))
        .await;
    denied.assert_status_ok();
    let denied: Value = denied.json();
    assert_eq!(denied["mcp_server_id"], "files");
    assert_eq!(denied["tool_name"], "read_file");
    assert_eq!(denied["decision"], "denied");
    let setting_id = denied["id"].as_str().expect("setting id").to_string();

    let listed = server
        .get("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    listed.assert_status_ok();
    let listed: Value = listed.json();
    assert_eq!(
        listed["settings"],
        json!([{
            "id": setting_id,
            "mcp_server_id": "files",
            "tool_name": "read_file",
            "decision": "denied",
        }])
    );

    assert!(
        find_active_always_allow(&db, user.id, "files", "read_file")
            .await
            .unwrap()
            .is_none(),
        "a denial must never read as an always-allow grant"
    );
    assert_eq!(list_denied(&db, user.id).await.unwrap().len(), 1);

    let unknown_server = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "nope",
            "tool_name": "read_file",
            "decision": "denied",
        }))
        .await;
    unknown_server.assert_status(http::StatusCode::BAD_REQUEST);

    let removed = server
        .delete(&format!(
            "/api/v1beta/me/mcp-tool-approval-settings/{setting_id}"
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    removed.assert_status(http::StatusCode::NO_CONTENT);
    assert!(list_denied(&db, user.id).await.unwrap().is_empty());
    let listed = server
        .get("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    let listed: Value = listed.json();
    assert_eq!(listed["settings"], json!([]));
}

/// One row per `(user, server, tool)`: changing the decision rewrites that
/// row instead of leaving a grant and a denial side by side.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_upsert_rewrites_the_decision_in_place(pool: Pool<Postgres>) {
    let (app_config, _llm_server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = &app_state.db;

    let grant = upsert_active(
        db,
        user.id,
        "files",
        "read_file",
        UserToolDecision::AlwaysAllow,
    )
    .await
    .unwrap();
    assert!(
        find_active_always_allow(db, user.id, "files", "read_file")
            .await
            .unwrap()
            .is_some()
    );

    let denial = upsert_active(db, user.id, "files", "read_file", UserToolDecision::Denied)
        .await
        .unwrap();
    assert_eq!(denial.id, grant.id);
    assert_eq!(denial.decision, "denied");
    assert!(
        find_active_always_allow(db, user.id, "files", "read_file")
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(list_denied(db, user.id).await.unwrap().len(), 1);

    let regrant = upsert_active(
        db,
        user.id,
        "files",
        "read_file",
        UserToolDecision::AlwaysAllow,
    )
    .await
    .unwrap();
    assert_eq!(regrant.id, grant.id);
    assert!(
        find_active_always_allow(db, user.id, "files", "read_file")
            .await
            .unwrap()
            .is_some()
    );
    assert!(list_denied(db, user.id).await.unwrap().is_empty());
}
