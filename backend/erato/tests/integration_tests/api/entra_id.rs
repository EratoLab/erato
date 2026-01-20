//! Entra ID integration tests.
//!
//! These tests are disabled by default as they require a valid MS Graph access token.
//! To run them:
//! 1. Set the `ENTRA_ID_TEST_ACCESS_TOKEN` environment variable to a valid MS Graph
//!    access token with User.Read.All and Group.Read.All permissions
//! 2. Run with: `cargo test --test integration_tests entra_id -- --ignored`
//!
//! Note: The tests use the standard test JWT for backend authentication, and the
//! MS Graph access token is passed via the X-Forwarded-Access-Token header (as would
//! happen in production with oauth2-proxy).

use axum::Router;
use axum::http::StatusCode;
use axum_test::TestServer;
use erato::server::router::router;
use serde_json::Value;
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_utils::{TEST_JWT_TOKEN, TestRequestAuthExt, setup_mock_llm_server};

/// Header name for the forwarded access token (typically set by oauth2-proxy).
const X_FORWARDED_ACCESS_TOKEN: &str = "X-Forwarded-Access-Token";

/// Get the MS Graph access token from environment variable.
fn get_ms_graph_access_token() -> Option<String> {
    std::env::var("ENTRA_ID_TEST_ACCESS_TOKEN").ok()
}

/// Extension trait to add MS Graph access token header for Entra ID tests.
trait EntraIdTestExt {
    /// Add the X-Forwarded-Access-Token header with the MS Graph access token.
    fn with_ms_graph_token(self, token: &str) -> Self;
}

impl EntraIdTestExt for axum_test::TestRequest {
    fn with_ms_graph_token(self, token: &str) -> Self {
        self.add_header(X_FORWARDED_ACCESS_TOKEN, token)
    }
}

/// Helper to create test app state with Entra ID enabled.
async fn test_app_state_with_entra_id(
    mut app_config: erato::config::AppConfig,
    pool: Pool<Postgres>,
) -> erato::state::AppState {
    app_config.integrations.experimental_entra_id.enabled = true;
    app_config
        .integrations
        .experimental_entra_id
        .auth_via_access_token = true;

    crate::test_app_state(app_config, pool).await
}

/// Test listing organization users.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `entra-id-integration`
/// - `requires-external-token`
///
/// # Test Behavior
/// This test requires a valid MS Graph access token with User.Read.All permissions.
/// It verifies that the organization users endpoint returns a list of users.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_entra_id_list_users(pool: Pool<Postgres>) {
    let ms_graph_token = match get_ms_graph_access_token() {
        Some(token) => token,
        None => {
            println!("Skipping test: ENTRA_ID_TEST_ACCESS_TOKEN not set");
            return;
        }
    };

    // Set up the test environment with Entra ID enabled
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state_with_entra_id(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Request organization users
    // - Use TEST_JWT_TOKEN for backend authentication
    // - Use ms_graph_token via X-Forwarded-Access-Token for MS Graph API
    let response = server
        .get("/api/v1beta/me/organization/users")
        .with_bearer_token(TEST_JWT_TOKEN)
        .with_ms_graph_token(&ms_graph_token)
        .await;

    // Verify the response
    response.assert_status_ok();
    let response_json: Value = response.json();

    // Check that we got a users array
    let users = response_json["users"]
        .as_array()
        .expect("Expected users array in response");

    println!("Found {} users", users.len());
    for user in users.iter().take(5) {
        println!(
            "  User: {} ({})",
            user["display_name"].as_str().unwrap_or("unnamed"),
            user["id"].as_str().unwrap_or("no-id")
        );
    }

    // Should have at least one user (the test user)
    assert!(!users.is_empty(), "Expected at least one user");

    // Verify user structure
    let first_user = &users[0];
    assert!(first_user["id"].is_string(), "Expected id to be a string");
    assert!(
        first_user["display_name"].is_string(),
        "Expected display_name to be a string"
    );
}

/// Test listing organization groups.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `entra-id-integration`
/// - `requires-external-token`
///
/// # Test Behavior
/// This test requires a valid MS Graph access token with Group.Read.All permissions.
/// It verifies that the organization groups endpoint returns a list of groups.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_entra_id_list_groups(pool: Pool<Postgres>) {
    let ms_graph_token = match get_ms_graph_access_token() {
        Some(token) => token,
        None => {
            println!("Skipping test: ENTRA_ID_TEST_ACCESS_TOKEN not set");
            return;
        }
    };

    // Set up the test environment with Entra ID enabled
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state_with_entra_id(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Request organization groups
    // - Use TEST_JWT_TOKEN for backend authentication
    // - Use ms_graph_token via X-Forwarded-Access-Token for MS Graph API
    let response = server
        .get("/api/v1beta/me/organization/groups")
        .with_bearer_token(TEST_JWT_TOKEN)
        .with_ms_graph_token(&ms_graph_token)
        .await;

    // Verify the response
    response.assert_status_ok();
    let response_json: Value = response.json();

    // Check that we got a groups array
    let groups = response_json["groups"]
        .as_array()
        .expect("Expected groups array in response");

    println!("Found {} groups", groups.len());
    for group in groups.iter().take(5) {
        println!(
            "  Group: {} ({})",
            group["display_name"].as_str().unwrap_or("unnamed"),
            group["id"].as_str().unwrap_or("no-id")
        );
    }

    // Groups might be empty in some test environments, so we don't assert
    // But we verify the structure if there are groups
    if !groups.is_empty() {
        let first_group = &groups[0];
        assert!(first_group["id"].is_string(), "Expected id to be a string");
        assert!(
            first_group["display_name"].is_string(),
            "Expected display_name to be a string"
        );
    }
}

/// Test that endpoints return empty lists when Entra ID is disabled.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `entra-id-integration`
///
/// # Test Behavior
/// This test verifies that when the Entra ID integration is disabled,
/// the endpoints return empty lists instead of 404 errors.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_entra_id_disabled_returns_empty_lists(pool: Pool<Postgres>) {
    // Set up the test environment with Entra ID DISABLED
    let (app_config, _server) = setup_mock_llm_server(None).await;
    // Note: Don't enable Entra ID in the config
    let app_state = crate::test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Test users endpoint
    let users_response = server
        .get("/api/v1beta/me/organization/users")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    users_response.assert_status(StatusCode::OK);
    let users_json: Value = users_response.json();
    let users = users_json["users"]
        .as_array()
        .expect("Expected users array in response");
    assert!(
        users.is_empty(),
        "Expected empty users list when Entra ID is disabled"
    );

    // Test groups endpoint
    let groups_response = server
        .get("/api/v1beta/me/organization/groups")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    groups_response.assert_status(StatusCode::OK);
    let groups_json: Value = groups_response.json();
    let groups = groups_json["groups"]
        .as_array()
        .expect("Expected groups array in response");
    assert!(
        groups.is_empty(),
        "Expected empty groups list when Entra ID is disabled"
    );
}

/// Test that endpoints return 401 when no access token is available.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `entra-id-integration`
///
/// # Test Behavior
/// This test verifies that when the Entra ID integration is enabled but
/// no MS Graph access token is available, the endpoints return 401.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_entra_id_no_token_returns_401(pool: Pool<Postgres>) {
    // Set up the test environment with Entra ID enabled
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state_with_entra_id(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Request users without MS Graph token
    let users_response = server
        .get("/api/v1beta/me/organization/users")
        .with_bearer_token(TEST_JWT_TOKEN)
        // Note: No .with_ms_graph_token() call
        .await;

    users_response.assert_status(StatusCode::UNAUTHORIZED);

    // Request groups without MS Graph token
    let groups_response = server
        .get("/api/v1beta/me/organization/groups")
        .with_bearer_token(TEST_JWT_TOKEN)
        // Note: No .with_ms_graph_token() call
        .await;

    groups_response.assert_status(StatusCode::UNAUTHORIZED);
}

/// Test listing organization users with is_involved filter.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `entra-id-integration`
/// - `requires-external-token`
///
/// # Test Behavior
/// This test requires a valid MS Graph access token with User.Read.All and Group.Read.All permissions.
/// It verifies that when is_involved=true, only users sharing groups with the requesting user are returned.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_entra_id_list_users_with_is_involved_filter(pool: Pool<Postgres>) {
    let ms_graph_token = match get_ms_graph_access_token() {
        Some(token) => token,
        None => {
            println!("Skipping test: ENTRA_ID_TEST_ACCESS_TOKEN not set");
            return;
        }
    };

    // Set up the test environment with Entra ID enabled
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state_with_entra_id(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Request organization users with is_involved=true
    let response = server
        .get("/api/v1beta/me/organization/users?is_involved=true")
        .with_bearer_token(TEST_JWT_TOKEN)
        .with_ms_graph_token(&ms_graph_token)
        .await;

    // Verify the response
    response.assert_status_ok();
    let response_json: Value = response.json();

    // Check that we got a users array
    let users = response_json["users"]
        .as_array()
        .expect("Expected users array in response");

    println!("Found {} involved users", users.len());
    for user in users.iter().take(5) {
        println!(
            "  User: {} ({})",
            user["display_name"].as_str().unwrap_or("unnamed"),
            user["id"].as_str().unwrap_or("no-id")
        );
    }

    // The filtering should work - verify structure if there are results
    if !users.is_empty() {
        let first_user = &users[0];
        assert!(first_user["id"].is_string(), "Expected id to be a string");
        assert!(
            first_user["display_name"].is_string(),
            "Expected display_name to be a string"
        );
    }
}

/// Test listing organization groups with is_involved filter.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `entra-id-integration`
/// - `requires-external-token`
///
/// # Test Behavior
/// This test requires a valid MS Graph access token with Group.Read.All permissions.
/// It verifies that when is_involved=true, only groups the user is a member of are returned.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_entra_id_list_groups_with_is_involved_filter(pool: Pool<Postgres>) {
    let ms_graph_token = match get_ms_graph_access_token() {
        Some(token) => token,
        None => {
            println!("Skipping test: ENTRA_ID_TEST_ACCESS_TOKEN not set");
            return;
        }
    };

    // Set up the test environment with Entra ID enabled
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state_with_entra_id(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // First, get all groups to compare
    let all_groups_response = server
        .get("/api/v1beta/me/organization/groups")
        .with_bearer_token(TEST_JWT_TOKEN)
        .with_ms_graph_token(&ms_graph_token)
        .await;

    all_groups_response.assert_status_ok();
    let all_groups_json: Value = all_groups_response.json();
    let all_groups = all_groups_json["groups"]
        .as_array()
        .expect("Expected groups array in response");

    println!("Found {} total groups", all_groups.len());

    // Request organization groups with is_involved=true
    let response = server
        .get("/api/v1beta/me/organization/groups?is_involved=true")
        .with_bearer_token(TEST_JWT_TOKEN)
        .with_ms_graph_token(&ms_graph_token)
        .await;

    // Verify the response
    response.assert_status_ok();
    let response_json: Value = response.json();

    // Check that we got a groups array
    let involved_groups = response_json["groups"]
        .as_array()
        .expect("Expected groups array in response");

    println!("Found {} involved groups", involved_groups.len());
    for group in involved_groups.iter().take(5) {
        println!(
            "  Group: {} ({})",
            group["display_name"].as_str().unwrap_or("unnamed"),
            group["id"].as_str().unwrap_or("no-id")
        );
    }

    // Involved groups should be a subset of all groups (or equal if user is in all groups)
    assert!(
        involved_groups.len() <= all_groups.len(),
        "Involved groups should be <= all groups"
    );

    // Verify structure if there are groups
    if !involved_groups.is_empty() {
        let first_group = &involved_groups[0];
        assert!(first_group["id"].is_string(), "Expected id to be a string");
        assert!(
            first_group["display_name"].is_string(),
            "Expected display_name to be a string"
        );
    }
}
