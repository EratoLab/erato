//! Assistant API endpoint integration tests.

use axum::http;
use axum::Router;
use axum_test::TestServer;
use erato::policy::engine::PolicyEngine;
use erato::server::router::router;
use serde_json::{json, Value};
use sqlx::postgres::Postgres;
use sqlx::Pool;

use crate::test_utils::{TestRequestAuthExt, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT};
use crate::{test_app_config, test_app_state};

/// Test creating an assistant via the model directly (bypassing API).
///
/// # Test Categories
/// - `uses-db`
///
/// # Test Behavior
/// Verifies that the assistant model function works correctly.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_create_assistant_model_directly(pool: Pool<Postgres>) {
    println!("Starting assistant model test");

    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool).await;

    // Create a test user - use TEST_USER_SUBJECT to match TEST_JWT_TOKEN
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let user = erato::models::user::get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    println!("Created user with ID: {}", user.id);

    // Test creating an assistant directly via the model
    // Note: Subject should now contain the user UUID (as per MeProfile.to_subject() behavior)
    let subject_for_assistant = erato::policy::types::Subject::User(user.id.to_string());

    let assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &subject_for_assistant,
        "Test Assistant".to_string(),
        Some("A test assistant".to_string()),
        "You are a helpful test assistant.".to_string(),
        Some(vec!["server1".to_string(), "server2".to_string()]),
        Some("openai".to_string()),
    )
    .await;

    match assistant {
        Ok(created) => {
            println!("Successfully created assistant with ID: {}", created.id);
            assert_eq!(created.name, "Test Assistant");
            assert_eq!(created.description, Some("A test assistant".to_string()));
            assert_eq!(created.prompt, "You are a helpful test assistant.");
        }
        Err(e) => {
            panic!("Failed to create assistant: {}", e);
        }
    }
}

/// Test retrieving all assistants for the authenticated user.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that the list_assistants endpoint returns all non-archived assistants
/// for the authenticated user.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_list_assistants_endpoint(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool).await;

    // Create a test user - use TEST_USER_SUBJECT to match TEST_JWT_TOKEN
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let user = erato::models::user::get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    // Create multiple assistants via the model directly
    // Note: Subject should now contain the user UUID (as per MeProfile.to_subject() behavior)
    let assistant1 = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user.id.to_string()),
        "Assistant 1".to_string(),
        Some("First test assistant".to_string()),
        "You are assistant 1".to_string(),
        Some(vec!["server1".to_string()]),
        Some("openai".to_string()),
    )
    .await
    .expect("Failed to create assistant 1");

    let _assistant2 = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user.id.to_string()),
        "Assistant 2".to_string(),
        Some("Second test assistant".to_string()),
        "You are assistant 2".to_string(),
        Some(vec!["server2".to_string()]),
        Some("anthropic".to_string()),
    )
    .await
    .expect("Failed to create assistant 2");

    // Archive one assistant to test filtering
    erato::models::assistant::archive_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user.id.to_string()),
        assistant1.id,
    )
    .await
    .expect("Failed to archive assistant");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Test listing assistants
    let response = server
        .get("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 200 OK
    if response.status_code() != http::StatusCode::OK {
        eprintln!("Response status: {}", response.status_code());
        eprintln!("Response headers: {:?}", response.headers());
        let body = response.text();
        eprintln!("Response body: '{}'", body);
        eprintln!("Body length: {}", body.len());
        panic!("Expected 200 OK but got {}", response.status_code());
    }
    assert_eq!(response.status_code(), http::StatusCode::OK);

    let assistants_response: Value = response.json();
    let assistants = assistants_response
        .as_array()
        .expect("Response should be an array");

    // Should only return non-archived assistants (assistant2 only)
    assert_eq!(assistants.len(), 1);
    assert_eq!(assistants[0]["name"], "Assistant 2");
    assert_eq!(assistants[0]["description"], "Second test assistant");
}

/// Test retrieving a specific assistant by ID.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that the get_assistant endpoint returns the requested assistant
/// when it exists and belongs to the user.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_get_assistant_endpoint(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool).await;

    // Create a test user - use TEST_USER_SUBJECT to match TEST_JWT_TOKEN
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let user = erato::models::user::get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    // Create an assistant via the model directly
    // Note: Subject should now contain the user UUID (as per MeProfile.to_subject() behavior)
    let assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user.id.to_string()),
        "Test Assistant".to_string(),
        Some("A test assistant".to_string()),
        "You are a helpful assistant".to_string(),
        Some(vec!["server1".to_string()]),
        Some("openai".to_string()),
    )
    .await
    .expect("Failed to create assistant");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Test getting the assistant
    let response = server
        .get(&format!("/api/v1beta/assistants/{}", assistant.id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 200 OK
    assert_eq!(response.status_code(), http::StatusCode::OK);

    let assistant_response: Value = response.json();
    assert_eq!(assistant_response["id"], json!(assistant.id.to_string()));
    assert_eq!(assistant_response["name"], "Test Assistant");
    assert_eq!(assistant_response["description"], "A test assistant");
    assert_eq!(assistant_response["prompt"], "You are a helpful assistant");
    assert_eq!(assistant_response["files"], json!([])); // Should have empty files array
}

/// Test updating an existing assistant.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that the update_assistant endpoint updates the specified fields
/// of an existing assistant.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_update_assistant_endpoint(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool).await;

    // Create a test user - use TEST_USER_SUBJECT to match TEST_JWT_TOKEN
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let user = erato::models::user::get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    // Create an assistant via the model directly
    // Note: Subject should now contain the user UUID (as per MeProfile.to_subject() behavior)
    let assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user.id.to_string()),
        "Original Assistant".to_string(),
        Some("Original description".to_string()),
        "Original prompt".to_string(),
        Some(vec!["server1".to_string()]),
        Some("openai".to_string()),
    )
    .await
    .expect("Failed to create assistant");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Test updating the assistant with partial data
    let update_request = json!({
        "name": "Updated Assistant",
        "prompt": "Updated prompt"
    });

    let response = server
        .put(&format!("/api/v1beta/assistants/{}", assistant.id))
        .json(&update_request)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 200 OK
    assert_eq!(response.status_code(), http::StatusCode::OK);

    let assistant_response: Value = response.json();
    assert_eq!(assistant_response["id"], json!(assistant.id.to_string()));
    assert_eq!(assistant_response["name"], "Updated Assistant");
    assert_eq!(assistant_response["description"], "Original description"); // Should remain unchanged
    assert_eq!(assistant_response["prompt"], "Updated prompt");
    assert_eq!(assistant_response["mcp_server_ids"], json!(["server1"])); // Should remain unchanged
}

/// Test archiving an assistant.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that the archive_assistant endpoint archives the specified assistant
/// and it no longer appears in the assistants list.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_archive_assistant_endpoint(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool).await;

    // Create a test user - use TEST_USER_SUBJECT to match TEST_JWT_TOKEN
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let user = erato::models::user::get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    // Create an assistant via the model directly
    // Note: Subject should now contain the user UUID (as per MeProfile.to_subject() behavior)
    let assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user.id.to_string()),
        "To Archive Assistant".to_string(),
        Some("This will be archived".to_string()),
        "This assistant will be archived".to_string(),
        None,
        None,
    )
    .await
    .expect("Failed to create assistant");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Verify assistant appears in list before archiving
    let list_response = server
        .get("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(list_response.status_code(), http::StatusCode::OK);
    let list_before: Value = list_response.json();
    assert_eq!(list_before.as_array().unwrap().len(), 1);

    // Test archiving the assistant
    let response = server
        .post(&format!("/api/v1beta/assistants/{}/archive", assistant.id))
        .json(&json!({}))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 200 OK
    assert_eq!(response.status_code(), http::StatusCode::OK);

    // Verify the response includes archived_at timestamp
    let archive_response: Value = response.json();
    assert_eq!(archive_response["id"], json!(assistant.id.to_string()));
    assert!(archive_response["archived_at"].is_string());

    // Verify assistant no longer appears in list after archiving
    let list_response = server
        .get("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(list_response.status_code(), http::StatusCode::OK);
    let list_after: Value = list_response.json();
    assert_eq!(list_after.as_array().unwrap().len(), 0);
}

/// Test assistant authorization (users can only access their own assistants).
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that users cannot access assistants created by other users.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_assistant_authorization(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool).await;

    // Create two test users
    let user1_subject = "test-subject-1-for-auth";
    let user1 = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user1_subject,
        None,
    )
    .await
    .expect("Failed to create user 1");

    let user2_subject = "test-subject-2-for-auth";
    let _user2 = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user2_subject,
        None,
    )
    .await
    .expect("Failed to create user 2");

    // Create an assistant for user 1
    // Note: Subject should now contain the user UUID (as per MeProfile.to_subject() behavior)
    let assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user1.id.to_string()),
        "User 1 Assistant".to_string(),
        None,
        "You are user 1's assistant".to_string(),
        None,
        None,
    )
    .await
    .expect("Failed to create assistant");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Test that user 2 cannot access user 1's assistant
    let response = server
        .get(&format!("/api/v1beta/assistants/{}", assistant.id))
        .with_bearer_token(TEST_JWT_TOKEN) // This uses the default test subject, which is different from user1_subject
        .await;

    // Should return 404 Not Found (access denied is masked as not found for security)
    assert_eq!(response.status_code(), http::StatusCode::NOT_FOUND);

    // Test that user 2 cannot update user 1's assistant
    let update_request = json!({
        "name": "Hacked Assistant"
    });

    let response = server
        .put(&format!("/api/v1beta/assistants/{}", assistant.id))
        .json(&update_request)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 404 Not Found
    assert_eq!(response.status_code(), http::StatusCode::NOT_FOUND);

    // Test that user 2 cannot archive user 1's assistant
    let response = server
        .post(&format!("/api/v1beta/assistants/{}/archive", assistant.id))
        .json(&json!({}))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 404 Not Found
    assert_eq!(response.status_code(), http::StatusCode::NOT_FOUND);
}

/// Test error cases for assistant endpoints.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that error cases are handled properly (invalid JSON, missing fields, etc.).
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_assistant_error_cases(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool).await;

    // Create a test user - use TEST_USER_SUBJECT to match TEST_JWT_TOKEN
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = erato::models::user::get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Test creating assistant with missing required fields
    let invalid_request = json!({
        "description": "Missing name and prompt"
    });

    let response = server
        .post("/api/v1beta/assistants")
        .json(&invalid_request)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 422 Unprocessable Entity (validation error for missing required fields)
    assert_eq!(
        response.status_code(),
        http::StatusCode::UNPROCESSABLE_ENTITY
    );

    // Test accessing non-existent assistant
    let fake_id = sqlx::types::Uuid::new_v4();
    let response = server
        .get(&format!("/api/v1beta/assistants/{}", fake_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 404 Not Found
    assert_eq!(response.status_code(), http::StatusCode::NOT_FOUND);

    // Test updating non-existent assistant
    let update_request = json!({
        "name": "Updated Name"
    });

    let response = server
        .put(&format!("/api/v1beta/assistants/{}", fake_id))
        .json(&update_request)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 404 Not Found
    assert_eq!(response.status_code(), http::StatusCode::NOT_FOUND);

    // Test archiving non-existent assistant
    let response = server
        .post(&format!("/api/v1beta/assistants/{}/archive", fake_id))
        .json(&json!({}))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 404 Not Found
    assert_eq!(response.status_code(), http::StatusCode::NOT_FOUND);

    // Test invalid UUID format
    let response = server
        .get("/api/v1beta/assistants/invalid-uuid")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 400 Bad Request or 404 Not Found depending on implementation
    assert!(
        response.status_code() == http::StatusCode::BAD_REQUEST
            || response.status_code() == http::StatusCode::NOT_FOUND
    );
}

/// Test creating an assistant via the API endpoint.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `api-endpoint`
///
/// # Test Behavior
/// Verifies that the create_assistant API endpoint successfully creates an assistant
/// with all the provided data and returns the correct response.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_create_assistant_endpoint(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool).await;

    // Create a test user - use TEST_USER_SUBJECT to match TEST_JWT_TOKEN
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = erato::models::user::get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Test creating an assistant via the API
    let create_request = json!({
        "name": "API Test Assistant",
        "description": "An assistant created via the API endpoint",
        "prompt": "You are a helpful test assistant created via the API.",
        "mcp_server_ids": ["server1", "server2"],
        "default_chat_provider": "openai"
    });

    let response = server
        .post("/api/v1beta/assistants")
        .json(&create_request)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 201 CREATED
    assert_eq!(response.status_code(), http::StatusCode::CREATED);

    let create_response: Value = response.json();

    // Verify the assistant data directly (flattened response due to #[serde(flatten)])
    assert_eq!(create_response["name"], "API Test Assistant");
    assert_eq!(
        create_response["description"],
        "An assistant created via the API endpoint"
    );
    assert_eq!(
        create_response["prompt"],
        "You are a helpful test assistant created via the API."
    );
    assert_eq!(create_response["default_chat_provider"], "openai");

    // Verify mcp_server_ids is an array with the expected values
    assert!(create_response["mcp_server_ids"].is_array());
    let mcp_servers = create_response["mcp_server_ids"].as_array().unwrap();
    assert_eq!(mcp_servers.len(), 2);
    assert!(mcp_servers.contains(&json!("server1")));
    assert!(mcp_servers.contains(&json!("server2")));

    // Verify the assistant has an ID and timestamps
    assert!(create_response["id"].is_string());
    assert!(create_response["created_at"].is_string());
    assert!(create_response["updated_at"].is_string());
    assert!(create_response["archived_at"].is_null());

    // Store the assistant ID for further testing
    let assistant_id = create_response["id"].as_str().unwrap();

    // Verify we can retrieve the created assistant
    let get_response = server
        .get(&format!("/api/v1beta/assistants/{}", assistant_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(get_response.status_code(), http::StatusCode::OK);

    let get_response_json: Value = get_response.json();
    assert_eq!(get_response_json["name"], "API Test Assistant");
    assert_eq!(get_response_json["id"], assistant_id);
    // Verify files field exists (should be empty since we didn't add any files)
    assert!(get_response_json["files"].is_array());
    assert_eq!(get_response_json["files"].as_array().unwrap().len(), 0);
}
