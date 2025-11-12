//! Chat listing and retrieval API tests.

use axum::http;
use axum::Router;
use axum_test::TestServer;
use erato::server::router::router;
use serde_json::{json, Value};
use sqlx::postgres::Postgres;
use sqlx::Pool;

use crate::test_utils::{TestRequestAuthExt, TEST_JWT_TOKEN, TEST_USER_ISSUER};
use crate::{test_app_config, test_app_state};

/// Test retrieving recent chats for the authenticated user.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that the recent_chats endpoint returns a list of chats with proper pagination
/// stats and filtering (including archived chats when requested).
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_recent_chats_endpoint(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool).await;

    // Create a test user
    let issuer = TEST_USER_ISSUER;
    let subject = "test-subject-for-recent-chats";
    let _user = erato::models::user::get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create two chats by submitting messages
    let mut chat_ids = Vec::new();
    for i in 1..=2 {
        // Submit a message to create a new chat
        let message_request = json!({
            "previous_message_id": null,
            "user_message": format!("Test message for chat {}", i)
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
        for i in 0..lines.len() - 1 {
            if lines[i] == "event: chat_created" {
                let data_line = lines[i + 1];
                if data_line.starts_with("data: ") {
                    let data_json: Value = serde_json::from_str(&data_line[6..])
                        .expect("Failed to parse chat_created data");

                    let chat_id = data_json["chat_id"]
                        .as_str()
                        .expect("Expected chat_id to be a string")
                        .to_string();

                    chat_ids.push(chat_id);
                    break;
                }
            }
        }
    }

    // Make sure we got both chat IDs
    assert_eq!(chat_ids.len(), 2, "Expected to find 2 chat IDs");

    // Now query the recent_chats endpoint
    let response = server
        .get("/api/v1beta/me/recent_chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the response body as JSON
    let response_body: Value = response.json();

    // Extract the chats array
    let chats = response_body
        .get("chats")
        .expect("Response missing 'chats' field")
        .as_array()
        .expect("'chats' field is not an array");

    // Extract the stats object
    let stats = response_body
        .get("stats")
        .expect("Response missing 'stats' field");

    // Verify the stats fields
    assert!(
        stats.get("total_count").is_some(),
        "Stats missing 'total_count' field"
    );
    assert!(
        stats.get("current_offset").is_some(),
        "Stats missing 'current_offset' field"
    );
    assert!(
        stats.get("returned_count").is_some(),
        "Stats missing 'returned_count' field"
    );
    assert!(
        stats.get("has_more").is_some(),
        "Stats missing 'has_more' field"
    );

    // Verify stats values
    assert_eq!(
        stats.get("returned_count").unwrap().as_i64().unwrap(),
        2,
        "Expected returned_count to be 2"
    );

    // Verify we have exactly 2 chats
    assert_eq!(chats.len(), 2, "Expected 2 chats, got {}", chats.len());

    // Verify each chat has the expected fields, including can_edit
    for chat in chats {
        assert!(chat.get("id").is_some(), "Chat is missing 'id' field");
        assert!(
            chat.get("title_by_summary").is_some(),
            "Chat is missing 'title_by_summary' field"
        );
        assert!(
            chat.get("last_message_at").is_some(),
            "Chat is missing 'last_message_at' field"
        );
        assert!(
            chat.get("can_edit").is_some(),
            "Chat is missing 'can_edit' field"
        );
        assert!(
            chat.get("can_edit").unwrap().as_bool().is_some(),
            "'can_edit' should be a boolean",
        );
        assert!(
            chat.get("can_edit").unwrap().as_bool().unwrap(),
            "'can_edit' should be true for owner in /me/recent_chats",
        );
    }

    // Archive one of the chats
    let chat_to_archive = &chat_ids[0];
    let archive_response = server
        .post(&format!("/api/v1beta/chats/{}/archive", chat_to_archive))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({}))
        .await;

    // Verify the archive response status is OK
    archive_response.assert_status_ok();

    // Parse the archive response
    let archive_body: Value = archive_response.json();
    assert_eq!(
        archive_body.get("chat_id").unwrap().as_str().unwrap(),
        chat_to_archive,
        "Archive response should include the archived chat ID"
    );
    assert!(
        archive_body.get("archived_at").is_some(),
        "Archive response should include the archived_at timestamp"
    );

    // Now query the recent_chats endpoint again, should only return the non-archived chat
    let response = server
        .get("/api/v1beta/me/recent_chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the response body as JSON
    let response_body: Value = response.json();

    // Extract the chats array
    let chats = response_body
        .get("chats")
        .expect("Response missing 'chats' field")
        .as_array()
        .expect("'chats' field is not an array");

    // Verify we now have exactly 1 chat
    assert_eq!(
        chats.len(),
        1,
        "Expected 1 non-archived chat, got {}",
        chats.len()
    );

    // Verify this is the correct chat (the non-archived one)
    assert_eq!(
        chats[0].get("id").unwrap().as_str().unwrap(),
        chat_ids[1],
        "The remaining chat should be the one we didn't archive"
    );

    // And can_edit should remain true for the owner
    assert!(
        chats[0].get("can_edit").is_some(),
        "Remaining chat should include 'can_edit'",
    );
    assert!(
        chats[0].get("can_edit").unwrap().as_bool().unwrap(),
        "'can_edit' should be true for the owner",
    );

    // Now query with include_archived=true, should return both chats
    let response = server
        .get("/api/v1beta/me/recent_chats?include_archived=true")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the response body as JSON
    let response_body: Value = response.json();

    // Extract the chats array
    let chats = response_body
        .get("chats")
        .expect("Response missing 'chats' field")
        .as_array()
        .expect("'chats' field is not an array");

    // Verify we have both chats again
    assert_eq!(
        chats.len(),
        2,
        "Expected 2 chats when including archived, got {}",
        chats.len()
    );

    // Collect the chat IDs from the response
    let response_chat_ids: Vec<String> = chats
        .iter()
        .map(|chat| chat.get("id").unwrap().as_str().unwrap().to_string())
        .collect();

    // Verify both chat IDs are included
    assert!(
        response_chat_ids.contains(&chat_ids[0]),
        "Response should include the archived chat ID"
    );
    assert!(
        response_chat_ids.contains(&chat_ids[1]),
        "Response should include the non-archived chat ID"
    );

    // Verify 'can_edit' exists and is true for both chats for the owner
    for chat in chats {
        assert!(
            chat.get("can_edit").is_some(),
            "Chat is missing 'can_edit' field"
        );
        assert!(chat.get("can_edit").unwrap().as_bool().unwrap());
    }
}

/// Test retrieving all messages from a specific chat.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that the chat messages endpoint returns all messages in a chat
/// with proper structure, role separation, and pagination stats.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_chat_messages_endpoint(pool: Pool<Postgres>) {
    // Set up the test environment
    let app_state = test_app_state(test_app_config(), pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a chat by sending a message
    let first_message = "First test message";
    let message_request = json!({
        "previous_message_id": null,
        "user_message": first_message
    });

    // Send the first message to create a chat
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the response to get the chat ID and message ID
    let response_text = response.text();
    dbg!(&response_text);
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
    dbg!(&lines);

    assert!(
        !chat_id.is_empty(),
        "Failed to extract chat_id from response"
    );

    // Find the message_complete event and extract the message ID
    let mut first_message_id = String::new();
    for i in 0..lines.len() - 1 {
        if lines[i] == "event: assistant_message_completed" {
            // The data is on the next line, prefixed with "data: "
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse assistant_message_completed data");

                first_message_id = data_json["message_id"]
                    .as_str()
                    .expect("Expected message_id to be a string")
                    .to_string();

                break;
            }
        }
    }

    assert!(
        !first_message_id.is_empty(),
        "Failed to extract message_id from response"
    );

    // Send a second message to the same chat
    let second_message = "Second test message";
    let message_request = json!({
        "previous_message_id": first_message_id,
        "user_message": second_message
    });

    // Send the second message
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;
    dbg!("Second message sent");

    // Verify the response status is OK
    response.assert_status_ok();

    // Now query the chat messages endpoint
    let response = server
        .get(&format!("/api/v1beta/chats/{}/messages", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the response body as JSON
    let response_body: Value = response.json();

    // Extract the messages array
    let messages = response_body
        .get("messages")
        .expect("Response missing 'messages' field")
        .as_array()
        .expect("'messages' field is not an array");

    // Extract the stats object
    let stats = response_body
        .get("stats")
        .expect("Response missing 'stats' field");

    // Verify the stats fields
    assert!(
        stats.get("total_count").is_some(),
        "Stats missing 'total_count' field"
    );
    assert!(
        stats.get("current_offset").is_some(),
        "Stats missing 'current_offset' field"
    );
    assert!(
        stats.get("returned_count").is_some(),
        "Stats missing 'returned_count' field"
    );
    assert!(
        stats.get("has_more").is_some(),
        "Stats missing 'has_more' field"
    );

    // Verify stats values
    assert_eq!(
        stats.get("total_count").unwrap().as_i64().unwrap(),
        stats.get("returned_count").unwrap().as_i64().unwrap(),
        "total_count should match returned_count since we're fetching all messages"
    );

    // Verify we have exactly 4 messages (2 user messages + 2 assistant responses)
    assert_eq!(
        messages.len(),
        4,
        "Expected 4 messages, got {}",
        messages.len()
    );

    // Verify the messages have the expected structure and content
    let user_messages = messages
        .iter()
        .filter(|msg| msg["role"].as_str().unwrap_or("") == "user")
        .collect::<Vec<_>>();

    let assistant_messages = messages
        .iter()
        .filter(|msg| msg["role"].as_str().unwrap_or("") == "assistant")
        .collect::<Vec<_>>();

    // Verify we have 2 user messages and 2 assistant messages
    assert_eq!(
        user_messages.len(),
        2,
        "Expected 2 user messages, got {}",
        user_messages.len()
    );
    assert_eq!(
        assistant_messages.len(),
        2,
        "Expected 2 assistant messages, got {}",
        assistant_messages.len()
    );

    // Verify the content of the user messages
    let user_message_texts: Vec<String> = user_messages
        .iter()
        .map(|msg| {
            msg["content"]
                .as_array()
                .unwrap_or(&Vec::new())
                .iter()
                .filter_map(|part| {
                    if part["content_type"].as_str() == Some("text") {
                        part["text"].as_str().map(String::from)
                    } else {
                        None
                    }
                })
                .collect::<Vec<String>>()
                .join(" ")
        })
        .collect();

    assert!(
        user_message_texts.contains(&first_message.to_string()),
        "First user message not found"
    );
    assert!(
        user_message_texts.contains(&second_message.to_string()),
        "Second user message not found"
    );

    // Verify each message has the expected fields
    for message in messages.iter() {
        assert!(message.get("id").is_some(), "Message is missing 'id' field");
        assert!(
            message.get("chat_id").is_some(),
            "Message is missing 'chat_id' field"
        );
        assert!(
            message.get("role").is_some(),
            "Message is missing 'role' field"
        );
        assert!(
            message.get("content").is_some(),
            "Message is missing 'content' field"
        );
        assert!(
            message["content"].is_array(),
            "Message content should be an array"
        );
        assert!(
            message.get("created_at").is_some(),
            "Message is missing 'created_at' field"
        );
        assert!(
            message.get("updated_at").is_some(),
            "Message is missing 'updated_at' field"
        );
        assert!(
            message.get("is_message_in_active_thread").is_some(),
            "Message is missing 'is_message_in_active_thread' field"
        );
    }
}

/// Test message regeneration and thread management.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
///
/// # Test Behavior
/// Verifies that regenerating an assistant message creates a new response while
/// preserving the active thread lineage and marking old responses as inactive.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_chat_messages_with_regeneration(pool: Pool<Postgres>) {
    // Set up the test environment
    let app_state = test_app_state(test_app_config(), pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Step 1: Send a message to a new chat
    let first_message = "First test message for regeneration test";
    let message_request = json!({
        "previous_message_id": null,
        "user_message": first_message
    });

    // Send the first message to create a chat
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the response to get the chat ID and message ID
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

    // Find the user_message_saved event and extract the user message ID
    let mut user_message_id = String::new();
    for i in 0..lines.len() - 1 {
        if lines[i] == "event: user_message_saved" {
            // The data is on the next line, prefixed with "data: "
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse user_message_saved data");

                user_message_id = data_json["message_id"]
                    .as_str()
                    .expect("Expected message_id to be a string")
                    .to_string();

                break;
            }
        }
    }

    assert!(
        !user_message_id.is_empty(),
        "Failed to extract user message_id from response"
    );

    // Find the message_complete event and extract the assistant message ID
    let mut assistant_message_id = String::new();
    for i in 0..lines.len() - 1 {
        if lines[i] == "event: assistant_message_completed" {
            // The data is on the next line, prefixed with "data: "
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse assistant_message_completed data");

                assistant_message_id = data_json["message_id"]
                    .as_str()
                    .expect("Expected message_id to be a string")
                    .to_string();

                break;
            }
        }
    }

    assert!(
        !assistant_message_id.is_empty(),
        "Failed to extract assistant message_id from response"
    );

    // Step 2: Send a follow-up message to the chat
    let second_message = "Second test message for regeneration test";
    let message_request = json!({
        "previous_message_id": assistant_message_id,
        "user_message": second_message
    });

    // Send the second message
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Step 3: Use the regenerate message endpoint with the assistant message from the first message
    let regenerate_request = json!({
        "current_message_id": assistant_message_id
    });

    let response = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&regenerate_request)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the response to get the regenerated message ID
    let response_text = response.text();
    let lines: Vec<&str> = response_text.lines().collect();

    // Find the message_complete event and extract the regenerated message ID
    let mut regenerated_message_id = String::new();
    for i in 0..lines.len() - 1 {
        if lines[i] == "event: assistant_message_completed" {
            // The data is on the next line, prefixed with "data: "
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse assistant_message_completed data");

                regenerated_message_id = data_json["message_id"]
                    .as_str()
                    .expect("Expected message_id to be a string")
                    .to_string();

                break;
            }
        }
    }

    assert!(
        !regenerated_message_id.is_empty(),
        "Failed to extract regenerated message_id from response"
    );

    // Step 4: List messages and check that there are only two active messages
    let response = server
        .get(&format!("/api/v1beta/chats/{}/messages", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the response body as JSON
    let response_body: Value = response.json();

    // Extract the messages array
    let messages = response_body
        .get("messages")
        .expect("Response missing 'messages' field")
        .as_array()
        .expect("'messages' field is not an array");

    // Extract the stats object
    let stats = response_body
        .get("stats")
        .expect("Response missing 'stats' field");

    // Verify the stats fields
    assert!(
        stats.get("total_count").is_some(),
        "Stats missing 'total_count' field"
    );
    assert!(
        stats.get("current_offset").is_some(),
        "Stats missing 'current_offset' field"
    );
    assert!(
        stats.get("returned_count").is_some(),
        "Stats missing 'returned_count' field"
    );
    assert!(
        stats.get("has_more").is_some(),
        "Stats missing 'has_more' field"
    );

    // Verify stats values
    assert_eq!(
        stats.get("total_count").unwrap().as_i64().unwrap(),
        stats.get("returned_count").unwrap().as_i64().unwrap(),
        "total_count should match returned_count since we're fetching all messages"
    );

    // Verify we have exactly 5 messages in total (2 user messages + 3 assistant responses, but only 2 active)
    assert_eq!(
        messages.len(),
        5,
        "Expected 5 total messages, got {}",
        messages.len()
    );

    // Verify we have exactly 2 active messages (1 user message + 1 assistant response)
    let active_messages = messages
        .iter()
        .filter(|msg| {
            msg["is_message_in_active_thread"]
                .as_bool()
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    assert_eq!(
        active_messages.len(),
        2,
        "Expected 2 active messages, got {}",
        active_messages.len()
    );

    // Verify the active messages have the expected roles
    let active_user_messages = active_messages
        .iter()
        .filter(|msg| msg["role"].as_str().unwrap_or("") == "user")
        .collect::<Vec<_>>();

    let active_assistant_messages = active_messages
        .iter()
        .filter(|msg| msg["role"].as_str().unwrap_or("") == "assistant")
        .collect::<Vec<_>>();

    assert_eq!(
        active_user_messages.len(),
        1,
        "Expected 1 active user message, got {}",
        active_user_messages.len()
    );
    assert_eq!(
        active_assistant_messages.len(),
        1,
        "Expected 1 active assistant message, got {}",
        active_assistant_messages.len()
    );

    // Verify the active user message is the first message
    assert_eq!(
        active_user_messages[0]["content"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .filter_map(|part| {
                if part["content_type"].as_str() == Some("text") {
                    part["text"].as_str().map(String::from)
                } else {
                    None
                }
            })
            .collect::<Vec<String>>()
            .join(" "),
        first_message,
        "Active user message does not match the first message"
    );

    // Verify the active assistant message is the regenerated message
    assert_eq!(
        active_assistant_messages[0]["id"].as_str().unwrap_or(""),
        regenerated_message_id,
        "Active assistant message is not the regenerated message"
    );

    // Verify that the regenerated message has the original message listed as sibling message
    assert_eq!(
        active_assistant_messages[0]["sibling_message_id"]
            .as_str()
            .unwrap_or(""),
        assistant_message_id,
        "Regenerated message does not have the original message as sibling"
    );

    // Verify that the original assistant message is not in the active thread
    let original_assistant_message = messages
        .iter()
        .find(|msg| msg["id"].as_str().unwrap_or("") == assistant_message_id)
        .expect("Original assistant message not found in messages list");

    assert!(
        !original_assistant_message["is_message_in_active_thread"]
            .as_bool()
            .unwrap_or(true),
        "Original assistant message should not be in the active thread"
    );

    // Verify that the first user message is in the active thread
    let first_user_message_content = messages
        .iter()
        .find(|msg| {
            let text_content = msg["content"]
                .as_array()
                .unwrap_or(&Vec::new())
                .iter()
                .filter_map(|part| {
                    if part["content_type"].as_str() == Some("text") {
                        part["text"].as_str().map(String::from)
                    } else {
                        None
                    }
                })
                .collect::<Vec<String>>()
                .join(" ");
            text_content == first_message
        })
        .expect("First user message not found in messages list");

    assert!(
        first_user_message_content["is_message_in_active_thread"]
            .as_bool()
            .unwrap_or(false),
        "First user message should be in the active thread"
    );

    // Verify that the second user message is not in the active thread
    let second_user_message_content = messages
        .iter()
        .find(|msg| {
            let text_content = msg["content"]
                .as_array()
                .unwrap_or(&Vec::new())
                .iter()
                .filter_map(|part| {
                    if part["content_type"].as_str() == Some("text") {
                        part["text"].as_str().map(String::from)
                    } else {
                        None
                    }
                })
                .collect::<Vec<String>>()
                .join(" ");
            text_content == second_message
        })
        .expect("Second user message not found in messages list");

    assert!(
        !second_user_message_content["is_message_in_active_thread"]
            .as_bool()
            .unwrap_or(true),
        "Second user message should not be in the active thread"
    );
}
