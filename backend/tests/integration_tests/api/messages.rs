//! Message submission and streaming API tests.

use axum::Router;
use axum::http;
use axum_test::TestServer;
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_app_state;
use crate::test_utils::{
    TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt, setup_mock_llm_server,
};

/// Test message submission with SSE streaming.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that users can submit messages to a chat and receive streamed responses
/// with all expected Server-Sent Event types.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_message_submit_stream(pool: Pool<Postgres>) {
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;

    // Create app state with the database connection
    let app_state = test_app_state(app_config, pool).await;

    // Create a test user
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Prepare the request body
    let request_body = serde_json::json!({
        "user_message": "Hello, this is a test message"
    });

    // Make a request to the message submit endpoint with the mock JWT
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&request_body)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Collect all SSE events
    let body = response.as_bytes();
    let body_str = String::from_utf8_lossy(body);

    // Split the SSE stream into individual events
    let events: Vec<String> = body_str
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .map(|chunk| chunk.to_string())
        .collect();

    println!("Received {} events", events.len());
    for (i, event) in events.iter().enumerate() {
        println!("Event {}: {}", i, event);
    }

    // Helper function to check if an event of a specific type exists
    let has_event_type = |event_type: &str| {
        events.iter().any(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                json["message_type"] == event_type
            } else {
                false
            }
        })
    };

    // Count text_delta events
    let text_delta_count = events
        .iter()
        .filter(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                json["message_type"] == "text_delta"
            } else {
                false
            }
        })
        .count();

    // Assert that we received all expected event types
    assert!(
        has_event_type("chat_created"),
        "No chat_created event received"
    );
    assert!(
        has_event_type("user_message_saved"),
        "No user_message_saved event received"
    );
    assert!(
        has_event_type("assistant_message_started"),
        "No assistant_message_started event received"
    );
    assert!(text_delta_count > 0, "No text_delta events received");
    assert!(
        has_event_type("assistant_message_completed"),
        "No assistant_message_completed event received"
    );

    // Additionally, verify the content of the assistant_message_completed event
    let assistant_message_completed_event_data = events
        .iter()
        .find_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data)
                && json["message_type"] == "assistant_message_completed"
            {
                return Some(json);
            }
            None
        })
        .expect("Could not find assistant_message_completed event data");

    let content_array = assistant_message_completed_event_data["content"]
        .as_array()
        .expect("Content should be an array");
    assert!(
        !content_array.is_empty(),
        "Content array should not be empty"
    );
    let first_content_part = &content_array[0];
    assert_eq!(first_content_part["content_type"].as_str().unwrap(), "text");
    assert!(first_content_part["text"].as_str().is_some());
}

/// Test token usage estimation with file input.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that the token usage endpoint correctly estimates token counts
/// for messages with file attachments.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_token_usage_estimate_with_file(pool: Pool<Postgres>) {
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;

    // Set up the test environment
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a mock JWT for authentication

    // First, create a chat by sending a message
    let message_request = json!({
        "previous_message_id": null,
        "user_message": "Test message to create a chat for token usage test"
    });

    // Send the message to create a chat
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Get the message ID from the response to use as previous_message_id
    let body = response.as_bytes();
    let body_str = String::from_utf8_lossy(body);
    let lines: Vec<&str> = body_str.lines().collect();

    let mut user_message_id = String::new();
    let mut chat_id = String::new();

    for i in 0..lines.len() - 1 {
        if lines[i] == "event: user_message_saved" {
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse user_message_saved data");
                user_message_id = data_json["message_id"]
                    .as_str()
                    .expect("Expected message_id to be a string")
                    .to_string();
            }
        } else if lines[i] == "event: chat_created" {
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse chat_created data");
                chat_id = data_json["chat_id"]
                    .as_str()
                    .expect("Expected chat_id to be a string")
                    .to_string();
            }
        }
    }

    // Create a test file
    let file_content = "This is a test file for token usage estimation.\nIt contains some text that should be tokenized by the service.\nThe goal is to test that the token usage endpoint correctly counts tokens for files.";

    // Convert to owned Vec<u8> to satisfy 'static lifetime requirement
    let file_bytes = file_content.as_bytes().to_vec();

    // Create a multipart form with the file
    let multipart_form = axum_test::multipart::MultipartForm::new().add_part(
        "file",
        axum_test::multipart::Part::bytes(file_bytes)
            .file_name("test_token_count.txt")
            .mime_type("text/plain"),
    );

    // Upload the file
    let response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    // Verify the response
    response.assert_status_ok();
    let response_json: Value = response.json();

    // Get the file ID
    let file_id = response_json["files"][0]["id"]
        .as_str()
        .expect("Expected file ID")
        .to_string();

    // Now call the token usage estimate endpoint with the file
    let token_usage_request = json!({
        "previous_message_id": user_message_id,
        "user_message": "Can you analyze this text file for me?",
        "input_files_ids": [file_id]
    });

    let response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&token_usage_request)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the token usage response
    let token_usage: Value = response.json();

    // Verify the response contains the expected fields
    assert!(
        token_usage["stats"]["total_tokens"].as_u64().is_some(),
        "Missing total_tokens in response"
    );
    assert!(
        token_usage["stats"]["user_message_tokens"]
            .as_u64()
            .is_some(),
        "Missing user_message_tokens in response"
    );
    assert!(
        token_usage["stats"]["history_tokens"].as_u64().is_some(),
        "Missing history_tokens in response"
    );
    assert!(
        token_usage["stats"]["file_tokens"].as_u64().is_some(),
        "Missing file_tokens in response"
    );
    assert!(
        token_usage["stats"]["max_tokens"].as_u64().is_some(),
        "Missing max_tokens in response"
    );
    assert!(
        token_usage["stats"]["remaining_tokens"].as_u64().is_some(),
        "Missing remaining_tokens in response"
    );

    // Verify file details
    let file_details = token_usage["file_details"]
        .as_array()
        .expect("Expected file_details array");
    assert_eq!(file_details.len(), 1, "Expected 1 file in file_details");

    let file_detail = &file_details[0];
    assert_eq!(
        file_detail["id"].as_str().unwrap(),
        file_id,
        "File ID mismatch"
    );
    assert_eq!(
        file_detail["filename"].as_str().unwrap(),
        "test_token_count.txt",
        "Filename mismatch"
    );
    assert!(
        file_detail["token_count"].as_u64().is_some(),
        "Missing token_count in file details"
    );

    // Verify the token counts are reasonable
    let user_message_tokens = token_usage["stats"]["user_message_tokens"]
        .as_u64()
        .unwrap();
    let file_tokens = token_usage["stats"]["file_tokens"].as_u64().unwrap();
    let file_detail_tokens = file_detail["token_count"].as_u64().unwrap();

    // A simple user message should have at least a few tokens
    assert!(
        user_message_tokens > 0,
        "User message token count should be > 0"
    );
    assert!(
        user_message_tokens < 50,
        "User message token count should be reasonable"
    );

    // File tokens should match the file detail tokens
    assert_eq!(
        file_tokens, file_detail_tokens,
        "File tokens should match file detail tokens"
    );

    // The file should have a reasonable number of tokens based on its content
    assert!(file_tokens > 0, "File token count should be > 0");

    // Total tokens should be at least the sum of user message, history, and file tokens
    let total_tokens = token_usage["stats"]["total_tokens"].as_u64().unwrap();
    let history_tokens = token_usage["stats"]["history_tokens"].as_u64().unwrap();
    assert!(
        total_tokens >= user_message_tokens + history_tokens,
        "Total tokens should be at least the sum of component tokens"
    );

    // Max tokens should be a reasonable value
    // In CI, this will be 1000 (test-token-limit model from erato.template.toml)
    // In local dev with different config, it may vary
    let max_tokens = token_usage["stats"]["max_tokens"].as_u64().unwrap();
    assert!(max_tokens > 0, "Max tokens should be greater than 0");
    assert!(max_tokens >= 1000, "Max tokens should be at least 1000");

    // Remaining tokens should be max_tokens - total_tokens
    let remaining_tokens = token_usage["stats"]["remaining_tokens"].as_u64().unwrap();
    assert_eq!(
        remaining_tokens,
        max_tokens - total_tokens,
        "Remaining tokens should be max_tokens - total_tokens"
    );
}

/// Test message submission with invalid previous_message_id (non-existent UUID).
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that submitting a message with a non-existent previous_message_id
/// returns a 500 error (internal server error from SSE stream).
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_message_submit_with_nonexistent_previous_message_id(pool: Pool<Postgres>) {
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Use a random UUID that doesn't exist
    let non_existent_id = "00000000-0000-0000-0000-000000000001";

    let request_body = json!({
        "previous_message_id": non_existent_id,
        "user_message": "This should fail"
    });

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&request_body)
        .await;

    // The response should now return 400 Bad Request due to validation
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Check that the error message is about non-existent message
    let error_text = response.text();
    assert!(
        error_text.contains("not found") || error_text.contains("Failed to get previous message"),
        "Expected error message about non-existent previous message, got: {}",
        error_text
    );
}

/// Test message submission with previous_message_id of wrong role (user after user).
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that submitting a user message with a previous_message_id pointing to
/// another user message (instead of an assistant message) returns an error.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_message_submit_with_wrong_role_previous_message(pool: Pool<Postgres>) {
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // First, submit a message to create a chat with a user message
    let first_request = json!({
        "user_message": "First message"
    });

    let first_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&first_request)
        .await;

    first_response.assert_status_ok();

    // Extract the user message ID from the response
    let body = first_response.as_bytes();
    let body_str = String::from_utf8_lossy(body);
    let events: Vec<String> = body_str
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .map(|chunk| chunk.to_string())
        .collect();

    let user_message_id = events
        .iter()
        .find_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data)
                && json["message_type"] == "user_message_saved"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected to find user_message_saved event");

    // Now try to submit a second user message with the first user message as previous
    let second_request = json!({
        "previous_message_id": user_message_id,
        "user_message": "This should fail - user after user"
    });

    let second_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&second_request)
        .await;

    // The response should now return 400 Bad Request due to validation
    second_response.assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Check that the error message is about wrong role
    let error_text = second_response.text();
    assert!(
        error_text.contains("assistant") || error_text.contains("role"),
        "Expected error message about wrong role, got: {}",
        error_text
    );
}

/// Test resume streaming endpoint basic behavior.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
///
/// # Test Behavior
/// Verifies that the resume endpoint exists and returns appropriate errors
/// when no active task is found.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_resume_stream_endpoint_basic(pool: Pool<Postgres>) {
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;

    // Create app state with the database connection
    let app_state = test_app_state(app_config, pool).await;

    // Create a test user
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Generate a random chat ID
    let chat_id = sea_orm::prelude::Uuid::new_v4();

    // Prepare the request body
    let request_body = json!({
        "chat_id": chat_id.to_string()
    });

    // Make a request to the resume endpoint with a non-existent chat
    let response = server
        .post("/api/v1beta/me/messages/resumestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&request_body)
        .await;

    // Should return 403 Forbidden when trying to access a non-existent chat
    // (authorization check happens before task lookup)
    response.assert_status(axum::http::StatusCode::FORBIDDEN);

    let error_text = response.text();
    assert!(
        error_text.contains("Access denied") || error_text.contains("not found"),
        "Expected error about access denied, got: {}",
        error_text
    );
}

/// Test resume streaming returns 404 for existing chat with no active task.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that when calling resume on a chat that exists (user has access)
/// but has no active background task, the endpoint returns 404 Not Found.
/// This tests the scenario where generation has completed and the task
/// has been cleaned up.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_resume_stream_no_active_task(pool: Pool<Postgres>) {
    use std::time::Duration;

    // Set up mock LLM server with fast response (minimal delay)
    let (app_config, _server) = setup_mock_llm_server(None).await;

    // Create app state with the database connection
    let app_state = test_app_state(app_config, pool).await;

    // Create a test user
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    // Start a real server so we can make concurrent requests
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();

    let app: axum::Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());

    // Spawn the server
    let server_handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    // Give the server a moment to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{}", server_addr);

    // First, create a chat by submitting a message
    // We need to get the chat_id before the task is cleaned up
    let submit_response = client
        .post(format!("{}/api/v1beta/me/messages/submitstream", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .header("Content-Type", "application/json")
        .json(&json!({
            "user_message": "Hello, create a chat for testing"
        }))
        .send()
        .await
        .expect("Failed to send submit request");

    assert!(
        submit_response.status().is_success(),
        "Submit request should succeed"
    );

    // Read the response to get the chat_id
    let body = submit_response
        .text()
        .await
        .expect("Failed to read response");

    // Extract chat_id from the chat_created event
    let chat_id = body
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .find_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data)
                && json["message_type"] == "chat_created"
            {
                return json["chat_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected to find chat_created event with chat_id");

    println!("Created chat with ID: {}", chat_id);

    // Now manually remove the task from the manager to simulate cleanup
    // (normally this happens after 60 seconds, but we force it for testing)
    let chat_uuid: sea_orm::prelude::Uuid = chat_id.parse().expect("Invalid UUID");
    app_state.background_tasks.remove_task(&chat_uuid).await;

    // Verify the task is no longer in the manager
    let task = app_state.background_tasks.get_task(&chat_uuid).await;
    assert!(task.is_none(), "Task should have been removed from manager");

    // Now try to resume - should get 404 because task no longer exists
    let resume_response = client
        .post(format!("{}/api/v1beta/me/messages/resumestream", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .header("Content-Type", "application/json")
        .json(&json!({
            "chat_id": chat_id
        }))
        .send()
        .await
        .expect("Failed to send resume request");

    // Should return 404 Not Found
    assert_eq!(
        resume_response.status(),
        reqwest::StatusCode::NOT_FOUND,
        "Expected 404 for existing chat with no active task"
    );

    let error_text = resume_response.text().await.unwrap_or_default();
    assert!(
        error_text.contains("No active generation task") || error_text.contains("not found"),
        "Expected error about no active task, got: {}",
        error_text
    );

    println!("✅ Correctly returned 404 for existing chat with no active task");

    // Clean up - abort the server
    server_handle.abort();
}

/// Test resume streaming with full event replay and continuation.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// As specified in ERMAIN-46:
/// 1. Sets up a mocked LLM that streams numbered messages ("Message 01", "Message 02", etc.)
/// 2. Starts a generation request
/// 3. Calls resume endpoint while generation is ongoing
/// 4. Verifies that resume endpoint replays all historical events and continues streaming
///
/// This tests the key requirement that a brittle client can disconnect and resume
/// multiple times during a long-running generation.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_resume_stream_full_replay(pool: Pool<Postgres>) {
    use crate::test_utils::MockLlmConfig;
    use std::time::Duration;

    // Create numbered messages for the mock LLM
    // Use 20 messages with 200ms delays = ~4 seconds total
    // This gives us time to call resume while generation is still running
    let chunks: Vec<String> = (1..=20).map(|i| format!("Message {:02}", i)).collect();
    let expected_chunks = chunks.clone();

    let mock_config = MockLlmConfig {
        chunks,
        delay_ms: 200, // 200ms between chunks for ~4 seconds total
        provider_id: "mock-llm".to_string(),
        model_name: "gpt-3.5-turbo".to_string(),
    };

    // Set up mock LLM server with numbered messages
    let (app_config, _server) = setup_mock_llm_server(Some(mock_config)).await;

    // Create app state with the database connection
    let app_state = test_app_state(app_config, pool).await;

    // Create a test user
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    // We need to make concurrent requests. Since axum_test waits for full response,
    // we'll use a real TCP server with reqwest for more control.

    // Start the actual server
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();

    let app: axum::Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());

    // Spawn the server
    let server_handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    // Give the server a moment to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{}", server_addr);

    // Start the first message submission request in a separate task
    let client_clone = client.clone();
    let base_url_clone = base_url.clone();
    let first_request_handle = tokio::spawn(async move {
        let response = client_clone
            .post(format!(
                "{}/api/v1beta/me/messages/submitstream",
                base_url_clone
            ))
            .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
            .header("Content-Type", "application/json")
            .json(&json!({
                "user_message": "Generate numbered messages"
            }))
            .send()
            .await
            .expect("Failed to send first request");

        assert!(
            response.status().is_success(),
            "First request should succeed"
        );

        // Read the full response body
        response.text().await.expect("Failed to read response body")
    });

    // Wait a bit for the first request to start and generate some events
    // (wait for about half the generation time so we catch it mid-stream)
    tokio::time::sleep(Duration::from_secs(2)).await;

    // Extract chat_id from background tasks directly
    // Since we can't easily parse the streaming response mid-flight,
    // we'll get the chat_id from the manager
    let chat_id = {
        let tasks = app_state.background_tasks.tasks.read().await;
        tasks.keys().next().copied()
    };

    let chat_id = chat_id.expect("Expected to find an active background task");
    println!("Found active task for chat_id: {}", chat_id);

    // Now call the resume endpoint while the first request is still running
    let resume_response = client
        .post(format!("{}/api/v1beta/me/messages/resumestream", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .header("Content-Type", "application/json")
        .json(&json!({
            "chat_id": chat_id.to_string()
        }))
        .send()
        .await
        .expect("Failed to send resume request");

    assert!(
        resume_response.status().is_success(),
        "Resume request should succeed, got: {} - {}",
        resume_response.status(),
        resume_response.text().await.unwrap_or_default()
    );

    // Read the resume response body (this will wait for the stream to complete)
    let resume_body = resume_response
        .text()
        .await
        .expect("Failed to read resume response body");

    // Parse events from resume response
    let resume_events: Vec<String> = resume_body
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .map(|chunk| chunk.to_string())
        .collect();

    println!("Resume request received {} events", resume_events.len());

    // Wait for the first request to complete
    let first_body = first_request_handle
        .await
        .expect("First request task panicked");

    // Parse events from the first request
    let first_events: Vec<String> = first_body
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .map(|chunk| chunk.to_string())
        .collect();

    println!("First request received {} events", first_events.len());

    // Helper to extract text deltas from events
    let extract_text_deltas = |events: &[String]| -> Vec<String> {
        events
            .iter()
            .filter_map(|event| {
                let data = event.split("data:").nth(1).unwrap_or("").trim();
                if let Ok(json) = serde_json::from_str::<Value>(data)
                    && json["message_type"] == "text_delta"
                {
                    return json["new_text"].as_str().map(|s| s.to_string());
                }
                None
            })
            .collect()
    };

    // Helper to check for event type
    let has_event_type = |events: &[String], event_type: &str| -> bool {
        events.iter().any(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                json["message_type"] == event_type
            } else {
                false
            }
        })
    };

    // Extract text deltas from both responses
    let first_text_deltas = extract_text_deltas(&first_events);
    let resume_text_deltas = extract_text_deltas(&resume_events);

    println!("First request text deltas: {:?}", first_text_deltas);
    println!("Resume request text deltas: {:?}", resume_text_deltas);

    // Build full text from deltas
    let first_full_text: String = first_text_deltas.iter().cloned().collect();
    let resume_full_text: String = resume_text_deltas.iter().cloned().collect();

    println!("First full text: {}", first_full_text);
    println!("Resume full text: {}", resume_full_text);

    // Verify first request received all chunks
    for chunk in &expected_chunks {
        assert!(
            first_full_text.contains(chunk),
            "First request should contain '{}', got: {}",
            chunk,
            first_full_text
        );
    }

    // KEY TEST: Resume request should have ALL historical events
    // This means the resume response should contain AT LEAST as many events
    // as were generated before we called resume (which was after ~2 seconds)
    // Plus any events that came after

    // The resume response should have replayed all historical events
    // Since we called resume mid-stream, it should have:
    // 1. All events from history (before resume was called)
    // 2. All events after resume was called (live streaming)

    // Verify resume response has all the expected event types
    assert!(
        has_event_type(&resume_events, "chat_created"),
        "Resume missing chat_created event"
    );
    assert!(
        has_event_type(&resume_events, "user_message_saved"),
        "Resume missing user_message_saved event"
    );
    assert!(
        has_event_type(&resume_events, "assistant_message_started"),
        "Resume missing assistant_message_started event"
    );
    assert!(
        has_event_type(&resume_events, "text_delta"),
        "Resume missing text_delta events"
    );

    // The resume response should have received ALL chunks
    // This is the key test - replay + continuation should give complete results
    for chunk in &expected_chunks {
        assert!(
            resume_full_text.contains(chunk),
            "Resume request should contain '{}', got: {}",
            chunk,
            resume_full_text
        );
    }

    // Verify both responses have the same chat_id
    let extract_chat_id = |events: &[String]| -> Option<String> {
        events.iter().find_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data)
                && json["message_type"] == "chat_created"
            {
                return json["chat_id"].as_str().map(|s| s.to_string());
            }
            None
        })
    };

    let first_chat_id = extract_chat_id(&first_events);
    let resume_chat_id = extract_chat_id(&resume_events);

    assert_eq!(
        first_chat_id, resume_chat_id,
        "Chat IDs should match between first and resume requests"
    );

    println!("✅ Resume streaming test passed!");
    println!(
        "   - First request received all {} messages",
        expected_chunks.len()
    );
    println!(
        "   - Resume request replayed + continued to receive all {} messages",
        expected_chunks.len()
    );
    println!("   - All event types verified in both responses");

    // Clean up - abort the server
    server_handle.abort();
}
