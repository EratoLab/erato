//! Per-user MCP tool decision API tests.

use axum::http;
use erato::config::{
    McpServerAuthenticationConfig, McpServerConfig, McpServerPermissionRule, McpToolApprovalConfig,
    McpToolApprovalPreset,
};
use erato::models::user::get_or_create_user;
use erato::models::user_tool_approval_setting::{
    UserToolDecision, find_active_decision, list_active, list_denied, upsert_active,
};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_app_state;
use crate::test_utils::{
    JwtTokenBuilder, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt,
    create_test_server, setup_mock_llm_server,
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
/// accepted in a deployment that never enables approvals, while a grant and
/// an ask are still refused there. The in-stream gate reader must not
/// mistake the denial row for a grant.
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

    let ask = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "tool_name": "read_file",
            "decision": "ask",
        }))
        .await;
    ask.assert_status(http::StatusCode::BAD_REQUEST);

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

    assert_eq!(
        find_active_decision(&db, user.id, "files", "read_file")
            .await
            .unwrap(),
        Some(UserToolDecision::Denied),
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
    assert_eq!(
        find_active_decision(&db, user.id, "files", "read_file")
            .await
            .unwrap(),
        None
    );
    let listed = server
        .get("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    let listed: Value = listed.json();
    assert_eq!(listed["settings"], json!([]));
}

/// One row per `(user, server, tool)`: changing the decision rewrites that
/// row instead of leaving a grant, an ask and a denial side by side.
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
    assert_eq!(
        find_active_decision(db, user.id, "files", "read_file")
            .await
            .unwrap(),
        Some(UserToolDecision::AlwaysAllow)
    );

    let ask = upsert_active(db, user.id, "files", "read_file", UserToolDecision::Ask)
        .await
        .unwrap();
    assert_eq!(ask.id, grant.id);
    assert_eq!(ask.decision, "ask");
    assert_eq!(
        find_active_decision(db, user.id, "files", "read_file")
            .await
            .unwrap(),
        Some(UserToolDecision::Ask)
    );
    assert!(list_denied(db, user.id).await.unwrap().is_empty());

    let denial = upsert_active(db, user.id, "files", "read_file", UserToolDecision::Denied)
        .await
        .unwrap();
    assert_eq!(denial.id, grant.id);
    assert_eq!(denial.decision, "denied");
    assert_eq!(
        find_active_decision(db, user.id, "files", "read_file")
            .await
            .unwrap(),
        Some(UserToolDecision::Denied)
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
    assert_eq!(
        find_active_decision(db, user.id, "files", "read_file")
            .await
            .unwrap(),
        Some(UserToolDecision::AlwaysAllow)
    );
    assert!(list_denied(db, user.id).await.unwrap().is_empty());
}

/// The batch writes several decisions for one server in one go and answers
/// with the server's decisions afterwards; `null` returns a tool to the
/// policy default. One entry the policy refuses fails the whole batch and
/// leaves the stored decisions untouched.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_batch_applies_decisions_atomically(pool: Pool<Postgres>) {
    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;
    app_config
        .mcp_servers
        .insert("files".to_string(), files_server_config());
    app_config.mcp_servers_global.approval = McpToolApprovalConfig {
        enabled: true,
        preset: McpToolApprovalPreset::Permissive,
        allow_always: false,
    };

    let app_state = test_app_state(app_config, pool).await;
    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = create_test_server(app_state);

    // A grant is unavailable under this policy: nothing of the batch lands.
    let refused = server
        .put("/api/v1beta/me/mcp-tool-approval-settings/batch")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "decisions": [
                { "tool_name": "read_file", "decision": "denied" },
                { "tool_name": "list_files", "decision": "always_allow" },
            ],
        }))
        .await;
    refused.assert_status(http::StatusCode::BAD_REQUEST);
    assert!(list_active(&db, user.id).await.unwrap().is_empty());

    // So is a duplicate tool, an empty name and an unknown server.
    let duplicate = server
        .put("/api/v1beta/me/mcp-tool-approval-settings/batch")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "decisions": [
                { "tool_name": "read_file", "decision": "denied" },
                { "tool_name": "read_file", "decision": "ask" },
            ],
        }))
        .await;
    duplicate.assert_status(http::StatusCode::BAD_REQUEST);
    let empty_name = server
        .put("/api/v1beta/me/mcp-tool-approval-settings/batch")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "decisions": [
                { "tool_name": "read_file", "decision": "denied" },
                { "tool_name": " ", "decision": "ask" },
            ],
        }))
        .await;
    empty_name.assert_status(http::StatusCode::BAD_REQUEST);
    let unknown_server = server
        .put("/api/v1beta/me/mcp-tool-approval-settings/batch")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "nope",
            "decisions": [{ "tool_name": "read_file", "decision": "denied" }],
        }))
        .await;
    unknown_server.assert_status(http::StatusCode::BAD_REQUEST);
    assert!(list_active(&db, user.id).await.unwrap().is_empty());

    let applied = server
        .put("/api/v1beta/me/mcp-tool-approval-settings/batch")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "decisions": [
                { "tool_name": "read_file", "decision": "denied" },
                { "tool_name": "list_files", "decision": "ask" },
                { "tool_name": "never_stored", "decision": null },
            ],
        }))
        .await;
    applied.assert_status_ok();
    let applied: Value = applied.json();
    let decisions: Vec<(&str, &str)> = applied["settings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|setting| {
            (
                setting["tool_name"].as_str().unwrap(),
                setting["decision"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        decisions,
        vec![("list_files", "ask"), ("read_file", "denied")]
    );
    assert!(
        applied["settings"]
            .as_array()
            .unwrap()
            .iter()
            .all(|setting| setting["mcp_server_id"] == "files")
    );

    // `null` deactivates a stored decision and an omitted tool keeps its own.
    let cleared = server
        .put("/api/v1beta/me/mcp-tool-approval-settings/batch")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "decisions": [{ "tool_name": "read_file" }],
        }))
        .await;
    cleared.assert_status_ok();
    let cleared: Value = cleared.json();
    assert_eq!(cleared["settings"].as_array().unwrap().len(), 1);
    assert_eq!(cleared["settings"][0]["tool_name"], "list_files");
    assert_eq!(cleared["settings"][0]["decision"], "ask");
    assert_eq!(
        find_active_decision(&db, user.id, "files", "read_file")
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        find_active_decision(&db, user.id, "files", "list_files")
            .await
            .unwrap(),
        Some(UserToolDecision::Ask)
    );

    // The response only covers the addressed server.
    upsert_active(&db, user.id, "other", "tool", UserToolDecision::Denied)
        .await
        .unwrap();
    let reapplied = server
        .put("/api/v1beta/me/mcp-tool-approval-settings/batch")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "decisions": [{ "tool_name": "read_file", "decision": "ask" }],
        }))
        .await;
    reapplied.assert_status_ok();
    let reapplied: Value = reapplied.json();
    let names: Vec<&str> = reapplied["settings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|setting| setting["tool_name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["list_files", "read_file"]);
    assert_eq!(list_active(&db, user.id).await.unwrap().len(), 3);
}

/// Both writers check the policy engine's server authorization, not only
/// that the server is configured: a user the policy withholds a server from
/// cannot store decisions for it.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_decisions_require_an_authorized_server(pool: Pool<Postgres>) {
    let (mut app_config, _llm_server) = setup_mock_llm_server(None).await;
    app_config
        .mcp_servers
        .insert("files".to_string(), files_server_config());
    app_config.mcp_server_permissions.rules.insert(
        "allow-premium".to_string(),
        McpServerPermissionRule::AllowForGroupMembers {
            mcp_server_ids: vec!["files".to_string()],
            groups: vec!["premium".to_string()],
        },
    );

    let app_state = test_app_state(app_config, pool).await;
    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let db = app_state.db.clone();
    let server = create_test_server(app_state);

    let single = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "tool_name": "read_file",
            "decision": "denied",
        }))
        .await;
    single.assert_status(http::StatusCode::FORBIDDEN);
    let batch = server
        .put("/api/v1beta/me/mcp-tool-approval-settings/batch")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_server_id": "files",
            "decisions": [{ "tool_name": "read_file", "decision": "denied" }],
        }))
        .await;
    batch.assert_status(http::StatusCode::FORBIDDEN);
    assert!(list_active(&db, user.id).await.unwrap().is_empty());

    let premium_token = JwtTokenBuilder::new()
        .groups(vec!["premium".to_string()])
        .build();
    let single = server
        .post("/api/v1beta/me/mcp-tool-approval-settings")
        .with_bearer_token(&premium_token)
        .json(&json!({
            "mcp_server_id": "files",
            "tool_name": "read_file",
            "decision": "denied",
        }))
        .await;
    single.assert_status_ok();
    let batch = server
        .put("/api/v1beta/me/mcp-tool-approval-settings/batch")
        .with_bearer_token(&premium_token)
        .json(&json!({
            "mcp_server_id": "files",
            "decisions": [{ "tool_name": "list_files", "decision": "denied" }],
        }))
        .await;
    batch.assert_status_ok();
    let batch: Value = batch.json();
    assert_eq!(batch["settings"].as_array().unwrap().len(), 2);
}
