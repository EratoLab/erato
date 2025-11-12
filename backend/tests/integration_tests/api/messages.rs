//! Message submission and streaming API tests.

use axum::http;
use axum::Router;
use axum_test::TestServer;
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use serde_json::{json, Value};
use sqlx::postgres::Postgres;
use sqlx::Pool;

use crate::test_utils::{TestRequestAuthExt, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT};
use crate::{test_app_config, test_app_state};

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
    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool).await;

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
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                if json["message_type"] == "assistant_message_completed" {
                    return Some(json);
                }
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
    // Set up the test environment
    let app_state = test_app_state(test_app_config(), pool).await;

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
    let app_state = test_app_state(test_app_config(), pool).await;
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
    let app_state = test_app_state(test_app_config(), pool).await;
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
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                if json["message_type"] == "user_message_saved" {
                    return json["message_id"].as_str().map(|s| s.to_string());
                }
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
