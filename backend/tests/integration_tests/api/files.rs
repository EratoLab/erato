//! File upload and download API tests.

use axum::http;
use axum::http::StatusCode;
use axum::Router;
use axum_test::multipart::{MultipartForm, Part};
use axum_test::TestServer;
use erato::server::router::router;
use sea_orm::prelude::Uuid;
use serde_json::{json, Value};
use sqlx::postgres::Postgres;
use sqlx::Pool;

use crate::test_utils::{TestRequestAuthExt, TEST_JWT_TOKEN};
use crate::{test_app_config, test_app_state};

/// Test file upload to a chat.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-file-storage`
///
/// # Test Behavior
/// Verifies that users can upload multiple files to a chat and receive
/// proper response metadata including file IDs and download URLs.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_file_upload_endpoint(pool: Pool<Postgres>) {
    // Set up the test environment
    let app_state = test_app_state(test_app_config(), pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // First, create a chat by sending a message
    let message_request = json!({
        "previous_message_id": null,
        "user_message": "Test message to create a chat for file upload"
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

    // Parse the response to get the chat ID
    let response_text = response.text();
    let lines: Vec<&str> = response_text.lines().collect();

    // Find the chat_created event and extract the chat ID
    let mut chat_id = String::new();
    for i in 0..lines.len() - 1 {
        if lines[i] == "event: chat_created" {
            // The data is on the next line, prefixed with "data: "
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse chat_created data");

                chat_id = data_json["chat_id"]
                    .as_str()
                    .expect("Expected chat_id to be a string")
                    .to_string();

                break;
            }
        }
    }

    assert!(
        !chat_id.is_empty(),
        "Failed to extract chat_id from response"
    );

    // Create temporary JSON files for testing
    let file1_content = json!({
        "name": "test1",
        "value": 123
    })
    .to_string();

    let file2_content = json!({
        "name": "test2",
        "value": 456,
        "nested": {
            "key": "value"
        }
    })
    .to_string();

    // Convert to owned Vec<u8> to satisfy 'static lifetime requirement
    let file1_bytes = file1_content.into_bytes();
    let file2_bytes = file2_content.into_bytes();

    // Create a multipart form with two files using axum_test::multipart
    let multipart_form = MultipartForm::new()
        .add_part(
            "file1",
            Part::bytes(file1_bytes)
                .file_name("test1.json")
                .mime_type("application/json"),
        )
        .add_part(
            "file2",
            Part::bytes(file2_bytes)
                .file_name("test2.json")
                .mime_type("application/json"),
        );

    // Make the request with the chat_id as a query parameter
    let response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    // Verify the response
    response.assert_status_ok();
    let response_json: Value = response.json();

    // Check that we got a response with two files
    let files = response_json["files"].as_array().unwrap();
    assert_eq!(files.len(), 2);

    // Check that each file has an id and filename
    for file in files {
        assert!(file["id"].as_str().is_some());
        assert!(file["filename"].as_str().is_some());

        // Check that the file has a download URL
        let download_url = file["download_url"].as_str().unwrap();
        assert!(!download_url.is_empty(), "Download URL should not be empty");
        assert!(
            download_url.starts_with("http"),
            "Download URL should be a valid URL"
        );

        // Check that the filenames match one of our test files
        let filename = file["filename"].as_str().unwrap();
        assert!(filename == "test1.json" || filename == "test2.json");
    }
}

/// Test retrieving file information by ID.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-file-storage`
///
/// # Test Behavior
/// Verifies that the get file endpoint returns proper file metadata and handles
/// non-existent and invalid file IDs appropriately.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_get_file_by_id(pool: Pool<Postgres>) {
    // Set up the test environment
    let app_state = test_app_state(test_app_config(), pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // First, create a chat to attach the file to
    let create_chat_response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({}))
        .await;

    create_chat_response.assert_status_ok();

    let create_chat_json: Value = create_chat_response.json();
    let chat_id = create_chat_json["chat_id"]
        .as_str()
        .expect("Expected chat_id in response");

    // Create a file to upload
    let file_content = json!({"test": "content"}).to_string();
    let file_bytes = file_content.into_bytes();
    let filename = "test_get_file.json";

    // Create a multipart form with the file
    let multipart_form = MultipartForm::new().add_part(
        "file",
        Part::bytes(file_bytes)
            .file_name(filename)
            .mime_type("application/json"),
    );

    // Upload the file
    let upload_response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    upload_response.assert_status_ok();
    let upload_json: Value = upload_response.json();

    // Get the file ID from the upload response
    let file_id = upload_json["files"][0]["id"]
        .as_str()
        .expect("Expected file id in response");

    // Test 1: Get file with valid ID
    let get_file_response = server
        .get(&format!("/api/v1beta/files/{}", file_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    get_file_response.assert_status_ok();
    let file_json: Value = get_file_response.json();

    // Verify the response has the correct file information
    assert_eq!(file_json["id"].as_str().unwrap(), file_id);
    assert_eq!(file_json["filename"].as_str().unwrap(), filename);

    // Verify the download URL is present and valid
    let download_url = file_json["download_url"].as_str().unwrap();
    assert!(!download_url.is_empty(), "Download URL should not be empty");
    assert!(
        download_url.starts_with("http"),
        "Download URL should be a valid URL"
    );

    // Test 2: Get file with non-existent ID
    let nonexistent_id = Uuid::new_v4().to_string();
    let get_nonexistent_response = server
        .get(&format!("/api/v1beta/files/{}", nonexistent_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 404 Not Found
    assert_eq!(
        get_nonexistent_response.status_code(),
        StatusCode::NOT_FOUND
    );

    // Test 3: Get file with invalid ID format
    let invalid_id = "not-a-uuid";
    let get_invalid_response = server
        .get(&format!("/api/v1beta/files/{}", invalid_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should return 400 Bad Request
    assert_eq!(get_invalid_response.status_code(), StatusCode::BAD_REQUEST);
}

/// Test the complete chat creation, file upload, and message flow.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-file-storage`
/// - `e2e-flow`
/// - `sse-streaming`
///
/// # Test Behavior
/// Verifies the end-to-end flow of creating a chat, uploading a file, and
/// submitting a message with the file attached, ensuring all events are
/// properly emitted and the message is saved with the file reference.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_create_chat_file_upload_message_flow(pool: Pool<Postgres>) {
    // Set up the test environment
    let app_state = test_app_state(test_app_config(), pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Step 1: Create a new chat without initial message
    let create_chat_response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({}))
        .await;

    // Verify the response status is OK
    create_chat_response.assert_status_ok();

    let create_chat_json: Value = create_chat_response.json();
    let chat_id = create_chat_json["chat_id"]
        .as_str()
        .expect("Expected chat_id in response");

    assert!(
        !chat_id.is_empty(),
        "Failed to extract chat_id from response"
    );

    // Step 2: Upload a file for the chat
    // Create test file content
    let file_content = json!({
        "name": "test_document",
        "content": "This is a test file for the chat message flow."
    })
    .to_string();

    // Convert to owned Vec<u8> to satisfy 'static lifetime requirement
    let file_bytes = file_content.into_bytes();

    // Create a multipart form with the file
    let multipart_form = MultipartForm::new().add_part(
        "file",
        Part::bytes(file_bytes)
            .file_name("test_document.json")
            .mime_type("application/json"),
    );

    // Make the request with the chat_id as a query parameter
    let upload_response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    // Verify the response
    upload_response.assert_status_ok();
    let upload_json: Value = upload_response.json();

    // Check that we got a response with one file
    let files = upload_json["files"]
        .as_array()
        .expect("Expected files array in response");
    assert_eq!(files.len(), 1);

    // Get the file ID
    let file_id = files[0]["id"]
        .as_str()
        .expect("Expected file id in response");
    assert!(!file_id.is_empty());

    // Step 3: Send a message to the chat with the file attached
    let message_request = json!({
        "existing_chat_id": chat_id,
        "user_message": "Here's a test file I'm sending",
        "input_files_ids": [file_id]
    });

    let message_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    message_response.assert_status_ok();

    // Collect and analyze SSE messages
    let response_text = message_response.text();
    let lines: Vec<&str> = response_text.lines().collect();

    // Helper to parse SSE events
    let has_event = |event_type: &str| {
        lines
            .windows(2)
            .any(|w| w[0] == format!("event: {}", event_type) && w[1].starts_with("data: "))
    };

    // We should NOT see a chat_created event (since we used an existing chat)
    assert!(
        !has_event("chat_created"),
        "Should not have a chat_created event"
    );

    // We should see a user_message_saved event
    assert!(
        has_event("user_message_saved"),
        "Missing user_message_saved event"
    );

    // We should see a message_complete event for the assistant's response
    assert!(
        has_event("assistant_message_completed"),
        "Missing assistant_message_completed event"
    );

    // Step 4: Verify we can retrieve the chat messages with the API
    let messages_response = server
        .get(&format!("/api/v1beta/chats/{}/messages", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    messages_response.assert_status_ok();
    let messages_json: Value = messages_response.json();

    // Check we have both the user and assistant messages
    let message_list = messages_json["messages"]
        .as_array()
        .expect("Expected messages array");
    assert_eq!(
        message_list.len(),
        2,
        "Should have user and assistant messages"
    );
}
