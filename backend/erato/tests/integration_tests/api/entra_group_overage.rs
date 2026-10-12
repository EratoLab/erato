//! Graph overage resolution is authorization input, including organization shares.

use axum::{
    Json, Router,
    http::{HeaderMap, StatusCode},
    routing::get,
};
use erato::config::{McpServerConfig, McpServerPermissionRule};
use erato::models::{
    assistant::create_assistant, share_grant::create_share_grant, user::get_or_create_user,
};
use erato::policy::prelude::{PolicyEngine, Subject};
use erato::services::entra_group_overage::EntraGroupOverageResolver;
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use crate::test_app_state;
use crate::test_utils::{
    JwtTokenBuilder, TEST_USER_ISSUER, TestRequestAuthExt, create_test_server, hermetic_app_config,
};

const ISSUER: &str = "https://login.microsoftonline.com/test-tenant/v2.0";
const OBJECT_ID: &str = "11111111-1111-1111-1111-111111111111";
const GROUP_ID: &str = "22222222-2222-2222-2222-222222222222";

struct Server {
    base: String,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn serve(router: Router) -> Server {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    Server { base, task }
}

fn overage_token() -> JwtTokenBuilder {
    JwtTokenBuilder::new()
        .issuer(ISSUER)
        .organization_user_id(OBJECT_ID)
        .claim("_claim_names", json!({"groups": "src1"}))
        .claim(
            "_claim_sources",
            json!({"src1": {"endpoint": "http://untrusted.invalid/groups"}}),
        )
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_group_overage_restores_mcp_permissions_and_organization_share_grants(
    pool: Pool<Postgres>,
) {
    let calls = Arc::new(AtomicUsize::new(0));
    let graph = serve(
        Router::new()
            .route(
                "/v1.0/me",
                get({
                    let calls = calls.clone();
                    move |headers: HeaderMap| {
                        calls.fetch_add(1, Ordering::SeqCst);
                        async move {
                            assert_eq!(headers["authorization"], "Bearer graph-access-token");
                            Json(json!({"id": OBJECT_ID}))
                        }
                    }
                }),
            )
            .route(
                "/v1.0/me/transitiveMemberOf",
                get({
                    let calls = calls.clone();
                    move || {
                        calls.fetch_add(1, Ordering::SeqCst);
                        async { Json(json!({"value": [{"id": GROUP_ID}]})) }
                    }
                }),
            ),
    )
    .await;
    let mcp = serve(mock_mcp_server::app()).await;
    let mut config = hermetic_app_config(None, None);
    assert!(config.integrations.entra_id.group_overage.enabled);
    assert!(!config.integrations.entra_id.enabled);
    let mcp_config: McpServerConfig = serde_json::from_value(json!({
        "transport_type": "streamable_http", "url": format!("{}/mcp/file", mcp.base), "authentication": {"mode": "none"}
    })).unwrap();
    config.mcp_servers.insert("files".to_owned(), mcp_config);
    config.mcp_server_permissions.rules.insert(
        "premium".to_owned(),
        McpServerPermissionRule::AllowForGroupMembers {
            mcp_server_ids: vec!["files".to_owned()],
            groups: vec![GROUP_ID.to_owned()],
        },
    );
    let mut state = test_app_state(config, pool).await;
    state.entra_group_overage = Some(Arc::new(
        EntraGroupOverageResolver::with_graph_base_url(&format!("{}/v1.0", graph.base)).unwrap(),
    ));

    let owner = get_or_create_user(&state.db, TEST_USER_ISSUER, "overage-share-owner", None)
        .await
        .unwrap();
    let owner_subject = Subject::User(owner.id.to_string());
    let policy = PolicyEngine::new();
    let assistant = create_assistant(
        &state.db,
        &policy,
        &owner_subject,
        "Shared assistant".into(),
        None,
        "You are helpful.".into(),
        None,
        None,
        None,
        false,
    )
    .await
    .unwrap();
    create_share_grant(
        &state.db,
        &policy,
        &owner_subject,
        "assistant".into(),
        assistant.id.to_string(),
        "organization_group".into(),
        "organization_group_id".into(),
        GROUP_ID.into(),
        "viewer".into(),
    )
    .await
    .unwrap();
    let server = create_test_server(state.clone());
    let token = overage_token().build();
    let profile = server
        .get("/api/v1beta/me/profile")
        .with_bearer_token(&token)
        .add_header("X-Forwarded-Access-Token", "graph-access-token")
        .await;
    profile.assert_status_ok();
    let body: Value = profile.json();
    assert_eq!(body["groups"], json!([GROUP_ID]));
    assert_eq!(body["organization_group_ids"], json!([GROUP_ID]));
    let tools = server
        .get("/api/v1beta/me/mcp_servers/files/tools")
        .with_bearer_token(&token)
        .add_header("X-Forwarded-Access-Token", "graph-access-token")
        .await;
    tools.assert_status_ok();
    let tools_body: Value = tools.json();
    assert_eq!(tools_body["status"], "SUCCESS");
    assert_eq!(tools_body["tools"].as_array().unwrap().len(), 2);
    server
        .get(&format!("/api/v1beta/assistants/{}", assistant.id))
        .with_bearer_token(&token)
        .add_header("X-Forwarded-Access-Token", "graph-access-token")
        .await
        .assert_status_ok();
    assert_eq!(
        calls.load(Ordering::SeqCst),
        2,
        "requests share verified cached memberships"
    );

    let ordinary_token = JwtTokenBuilder::new()
        .issuer(ISSUER)
        .organization_user_id(OBJECT_ID)
        .groups(vec!["other".into()])
        .build();
    server
        .get("/api/v1beta/me/mcp_servers/files/tools")
        .with_bearer_token(&ordinary_token)
        .add_header("X-Forwarded-Access-Token", "graph-access-token")
        .await
        .assert_status(StatusCode::FORBIDDEN);
    server
        .get("/api/v1beta/me/mcp_servers/files/tools")
        .with_bearer_token(&token)
        .await
        .assert_status(StatusCode::FORBIDDEN);

    // Explicit disable must ignore even a populated resolver cache.
    state.config.integrations.entra_id.group_overage.enabled = false;
    let disabled = create_test_server(state);
    disabled
        .get(&format!("/api/v1beta/assistants/{}", assistant.id))
        .with_bearer_token(&token)
        .add_header("X-Forwarded-Access-Token", "graph-access-token")
        .await
        .assert_status(StatusCode::NOT_FOUND);
    disabled
        .get("/api/v1beta/me/mcp_servers/files/tools")
        .with_bearer_token(&token)
        .add_header("X-Forwarded-Access-Token", "graph-access-token")
        .await
        .assert_status(StatusCode::FORBIDDEN);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_group_overage_failures_preserve_login_and_deny_group_permissions(
    pool: Pool<Postgres>,
) {
    let calls = Arc::new(AtomicUsize::new(0));
    let graph = serve(Router::new().fallback({
        let calls = calls.clone();
        move || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { StatusCode::SERVICE_UNAVAILABLE }
        }
    }))
    .await;
    let mut config = hermetic_app_config(None, None);
    config.mcp_servers.insert("files".into(), serde_json::from_value(json!({
        "transport_type": "streamable_http", "url": "http://127.0.0.1:1/mcp/file", "authentication": {"mode": "none"}
    })).unwrap());
    config.mcp_server_permissions.rules.insert(
        "premium".into(),
        McpServerPermissionRule::AllowForGroupMembers {
            mcp_server_ids: vec!["files".into()],
            groups: vec![GROUP_ID.into()],
        },
    );
    let mut state = test_app_state(config, pool).await;
    state.entra_group_overage = Some(Arc::new(
        EntraGroupOverageResolver::with_graph_base_url(&format!("{}/v1.0", graph.base)).unwrap(),
    ));
    let server = create_test_server(state);
    for token in [
        overage_token().build(),
        overage_token().claim("oid", Value::Null).build(),
    ] {
        let profile = server
            .get("/api/v1beta/me/profile")
            .with_bearer_token(&token)
            .add_header("X-Forwarded-Access-Token", "graph-access-token")
            .await;
        profile.assert_status_ok();
        let body: Value = profile.json();
        assert_eq!(body["groups"], json!([]));
        assert_eq!(body["organization_group_ids"], json!([]));
        server
            .get("/api/v1beta/me/mcp_servers/files/tools")
            .with_bearer_token(&token)
            .add_header("X-Forwarded-Access-Token", "graph-access-token")
            .await
            .assert_status(StatusCode::FORBIDDEN);
    }
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "failures are cached; missing oid never calls Graph"
    );
}
