//! Chat listing and retrieval API tests.

use axum::http;
use axum::Router;
use axum_test::TestServer;
use erato::db::entity::{chats, messages};
use erato::server::router::router;
use sea_orm::{prelude::Uuid, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde_json::{json, Value};
use sqlx::postgres::Postgres;
use sqlx::Pool;

use crate::test_app_state;
use crate::test_utils::{
    setup_mock_llm_server, TestRequestAuthExt, TEST_JWT_TOKEN, TEST_USER_ISSUER,
};

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
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

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
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

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
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

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

/// Test creating a chat based on an assistant and verifying assistant configuration is applied.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that:
/// - A chat can be created with an assistant_id
/// - The assistant_configuration is stored in the chat
/// - Assistant prompt and files are applied when sending the first message
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_create_chat_with_assistant(pool: Pool<Postgres>) {
    // Set up the test environment
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());

    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Step 1: Upload a file as standalone (not associated with any chat)
    let file_content = json!({
        "name": "test_document",
        "content": "This is a test file for the assistant."
    })
    .to_string();

    let file_bytes = file_content.into_bytes();

    let multipart_form = axum_test::multipart::MultipartForm::new().add_part(
        "file",
        axum_test::multipart::Part::bytes(file_bytes)
            .file_name("test_document.json")
            .mime_type("application/json"),
    );

    let upload_response = server
        .post("/api/v1beta/me/files")
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(multipart_form)
        .await;

    upload_response.assert_status_ok();
    let upload_json: Value = upload_response.json();

    // Get the file ID from the upload response
    let file_id = upload_json["files"][0]["id"]
        .as_str()
        .expect("Expected file id in upload response");

    // Step 2: Create an assistant with the uploaded file
    let assistant_request = json!({
        "name": "Test Assistant",
        "description": "An assistant for testing",
        "prompt": "You are a helpful test assistant.",
        "mcp_server_ids": null,
        "default_chat_provider": null,
        "file_ids": [file_id]
    });

    let assistant_response = server
        .post("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&assistant_request)
        .await;

    assistant_response.assert_status(http::StatusCode::CREATED);
    let assistant_json: Value = assistant_response.json();
    let assistant_id = assistant_json["id"]
        .as_str()
        .expect("Expected id in assistant response");

    // Step 3: Create a chat based on the assistant
    let create_chat_request = json!({
        "assistant_id": assistant_id
    });

    let create_chat_response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&create_chat_request)
        .await;

    create_chat_response.assert_status_ok();
    let create_chat_json: Value = create_chat_response.json();
    let chat_id = create_chat_json["chat_id"]
        .as_str()
        .expect("Expected chat_id in response");

    // Step 4: Verify the assistant has the file associated
    let get_assistant_response = server
        .get(&format!("/api/v1beta/assistants/{}", assistant_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    get_assistant_response.assert_status_ok();
    let get_assistant_json: Value = get_assistant_response.json();
    let assistant_files = get_assistant_json["files"]
        .as_array()
        .expect("Expected files array in assistant");

    assert_eq!(
        assistant_files.len(),
        1,
        "Assistant should have one file associated"
    );
    assert_eq!(
        assistant_files[0]["id"].as_str().unwrap(),
        file_id,
        "Assistant file ID should match uploaded file"
    );

    // Step 5: Verify the chat has assistant_configuration stored
    // We can verify this by checking the database directly
    let chat_uuid = Uuid::parse_str(chat_id).expect("Invalid chat UUID");
    let chat_record = chats::Entity::find_by_id(chat_uuid)
        .one(&app_state.db)
        .await
        .expect("Failed to fetch chat")
        .expect("Chat not found");

    assert!(
        chat_record.assistant_configuration.is_some(),
        "assistant_configuration should be set"
    );

    let config = chat_record.assistant_configuration.unwrap();
    let stored_assistant_id = config["assistant_id"]
        .as_str()
        .expect("assistant_id should be in configuration");
    assert_eq!(
        stored_assistant_id, assistant_id,
        "Stored assistant_id should match"
    );

    // Step 6: Send a message to the chat
    let message_request = json!({
        "existing_chat_id": chat_id,
        "user_message": "Hello, test assistant!"
    });

    let message_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    message_response.assert_status_ok();

    // Step 7: Verify the response includes proper events
    let response_text = message_response.text();
    let lines: Vec<&str> = response_text.lines().collect();

    // Helper to check if an event exists
    let has_event = |event_type: &str| {
        lines
            .windows(2)
            .any(|w| w[0] == format!("event: {}", event_type) && w[1].starts_with("data: "))
    };

    // Should have user_message_saved event
    assert!(
        has_event("user_message_saved"),
        "Missing user_message_saved event"
    );

    // Should have assistant_message_completed event
    assert!(
        has_event("assistant_message_completed"),
        "Missing assistant_message_completed event"
    );

    // Step 8: Verify that the generation_input_messages includes the assistant prompt
    // We can check this by querying the messages table
    let message_record = messages::Entity::find()
        .filter(messages::Column::ChatId.eq(chat_uuid))
        .filter(messages::Column::GenerationInputMessages.is_not_null())
        .order_by_desc(messages::Column::CreatedAt)
        .one(&app_state.db)
        .await
        .expect("Failed to fetch message with generation inputs")
        .expect("Message not found");

    let gen_inputs = message_record
        .generation_input_messages
        .expect("Should have generation_input_messages");
    let gen_inputs_str = serde_json::to_string(&gen_inputs).unwrap();

    // Verify the assistant prompt is in the generation inputs
    assert!(
        gen_inputs_str.contains("You are a helpful test assistant."),
        "Assistant prompt should be in generation inputs"
    );
}

/// Test the frequent_assistants endpoint that returns assistants ordered by usage frequency.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that the frequent_assistants endpoint returns assistants ordered by how many
/// times they were used to create chats within the specified time period.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_frequent_assistants_endpoint(pool: Pool<Postgres>) {
    // Set up the test environment
    // Set up mock LLM server
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    // Create a test user
    let issuer = TEST_USER_ISSUER;
    let subject = "test-subject-for-frequent-assistants";
    let _user = erato::models::user::get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create three assistants
    let assistant1_request = json!({
        "name": "Assistant 1",
        "description": "First test assistant",
        "prompt": "You are assistant 1.",
        "mcp_server_ids": null,
        "default_chat_provider": null,
        "file_ids": []
    });

    let assistant1_response = server
        .post("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&assistant1_request)
        .await;
    assistant1_response.assert_status(http::StatusCode::CREATED);
    let assistant1_json: Value = assistant1_response.json();
    let assistant1_id = assistant1_json["id"].as_str().unwrap();

    let assistant2_request = json!({
        "name": "Assistant 2",
        "description": "Second test assistant",
        "prompt": "You are assistant 2.",
        "mcp_server_ids": null,
        "default_chat_provider": null,
        "file_ids": []
    });

    let assistant2_response = server
        .post("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&assistant2_request)
        .await;
    assistant2_response.assert_status(http::StatusCode::CREATED);
    let assistant2_json: Value = assistant2_response.json();
    let assistant2_id = assistant2_json["id"].as_str().unwrap();

    let assistant3_request = json!({
        "name": "Assistant 3",
        "description": "Third test assistant",
        "prompt": "You are assistant 3.",
        "mcp_server_ids": null,
        "default_chat_provider": null,
        "file_ids": []
    });

    let assistant3_response = server
        .post("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&assistant3_request)
        .await;
    assistant3_response.assert_status(http::StatusCode::CREATED);
    let assistant3_json: Value = assistant3_response.json();
    let assistant3_id = assistant3_json["id"].as_str().unwrap();

    // Create chats with different assistants at different frequencies
    // Assistant 2: 3 chats (most frequent)
    for _ in 0..3 {
        let create_chat_request = json!({
            "assistant_id": assistant2_id
        });
        let response = server
            .post("/api/v1beta/me/chats")
            .with_bearer_token(TEST_JWT_TOKEN)
            .add_header(http::header::CONTENT_TYPE, "application/json")
            .json(&create_chat_request)
            .await;
        response.assert_status_ok();
    }

    // Assistant 1: 2 chats (second most frequent)
    for _ in 0..2 {
        let create_chat_request = json!({
            "assistant_id": assistant1_id
        });
        let response = server
            .post("/api/v1beta/me/chats")
            .with_bearer_token(TEST_JWT_TOKEN)
            .add_header(http::header::CONTENT_TYPE, "application/json")
            .json(&create_chat_request)
            .await;
        response.assert_status_ok();
    }

    // Assistant 3: 1 chat (least frequent)
    let create_chat_request = json!({
        "assistant_id": assistant3_id
    });
    let response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&create_chat_request)
        .await;
    response.assert_status_ok();

    // Now query the frequent_assistants endpoint
    let frequent_response = server
        .get("/api/v1beta/me/frequent_assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    frequent_response.assert_status_ok();
    let frequent_json: Value = frequent_response.json();

    // Verify the response structure
    assert!(
        frequent_json["assistants"].is_array(),
        "Response should have an assistants array"
    );
    let assistants = frequent_json["assistants"].as_array().unwrap();

    // Should have 3 assistants
    assert_eq!(
        assistants.len(),
        3,
        "Should return all 3 assistants that were used"
    );

    // Verify they are ordered by usage_count (descending)
    assert_eq!(
        assistants[0]["id"].as_str().unwrap(),
        assistant2_id,
        "Most frequent assistant should be first"
    );
    assert_eq!(
        assistants[0]["usage_count"].as_i64().unwrap(),
        3,
        "Assistant 2 should have usage_count of 3"
    );

    assert_eq!(
        assistants[1]["id"].as_str().unwrap(),
        assistant1_id,
        "Second most frequent assistant should be second"
    );
    assert_eq!(
        assistants[1]["usage_count"].as_i64().unwrap(),
        2,
        "Assistant 1 should have usage_count of 2"
    );

    assert_eq!(
        assistants[2]["id"].as_str().unwrap(),
        assistant3_id,
        "Least frequent assistant should be third"
    );
    assert_eq!(
        assistants[2]["usage_count"].as_i64().unwrap(),
        1,
        "Assistant 3 should have usage_count of 1"
    );

    // Verify assistant details are included
    assert_eq!(
        assistants[0]["name"].as_str().unwrap(),
        "Assistant 2",
        "Assistant name should be included"
    );
    assert_eq!(
        assistants[0]["prompt"].as_str().unwrap(),
        "You are assistant 2.",
        "Assistant prompt should be included"
    );

    // Test with limit parameter
    let limited_response = server
        .get("/api/v1beta/me/frequent_assistants?limit=2")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    limited_response.assert_status_ok();
    let limited_json: Value = limited_response.json();

    let limited_assistants = limited_json["assistants"].as_array().unwrap();
    assert_eq!(
        limited_assistants.len(),
        2,
        "Should only return 2 assistants when limit=2"
    );
    assert_eq!(
        limited_assistants[0]["id"].as_str().unwrap(),
        assistant2_id,
        "First should still be the most frequent"
    );
}
