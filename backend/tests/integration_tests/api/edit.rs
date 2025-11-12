//! Message editing API tests.

use axum::http;
use axum::Router;
use axum_test::TestServer;
use erato::server::router::router;
use serde_json::{json, Value};
use sqlx::postgres::Postgres;
use sqlx::Pool;

use crate::{test_app_config, test_app_state};
use crate::test_utils::{TEST_JWT_TOKEN, TestRequestAuthExt};

// Helper structure for SSE events
#[derive(Debug, Clone)]
struct Event {
    event_type: String,
    data: String,
    id: Option<String>,
    retry: Option<u32>,
}

// Helper function to collect SSE messages from a response
async fn collect_sse_messages(response: axum_test::TestResponse) -> Vec<Event> {
    let body = response.as_bytes();
    let body_str = String::from_utf8_lossy(body).to_string();
    let mut messages = Vec::new();

    // Split the SSE stream into individual events (each separated by double newlines)
    let events = body_str.split("\n\n").filter(|s| !s.is_empty());

    for event_data in events {
        let mut event = Event {
            event_type: String::new(),
            data: String::new(),
            id: None,
            retry: None,
        };

        // Parse the event lines
        for line in event_data.lines() {
            if line.starts_with("event: ") {
                event.event_type = line["event: ".len()..].to_string();
            } else if line.starts_with("data: ") {
                event.data = line["data: ".len()..].to_string();
            } else if line.starts_with("id: ") {
                event.id = Some(line["id: ".len()..].to_string());
            } else if line.starts_with("retry: ") {
                if let Ok(retry) = line["retry: ".len()..].parse::<u32>() {
                    event.retry = Some(retry);
                }
            }
        }

        // Only add the event if it has data
        if !event.data.is_empty() {
            messages.push(event);
        }
    }

    messages
}

/// Test message editing with streaming response.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `e2e-flow`
///
/// # Test Behavior
/// Verifies that users can edit a message and receive a new streamed response,
/// with the original message being marked as inactive in the active thread.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_edit_message_stream(pool: Pool<Postgres>) {
    // Set up the test environment
    let app_state = test_app_state(test_app_config(), pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // First, create an initial chat with a message
    let first_message = "What is the capital of France?";
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "user_message": first_message,
            "previous_message_id": null,
            "input_files_ids": []
        }))
        .await;

    let messages = collect_sse_messages(response).await;
    assert!(!messages.is_empty());

    // Extract the assistant message ID from the message_complete event
    let _assistant_message_id = messages
        .iter()
        .find_map(|msg| {
            if let Ok(json) = serde_json::from_str::<Value>(&msg.data) {
                if json["message_type"] == "assistant_message_completed" {
                    return Some(json["message_id"].as_str().unwrap().to_string());
                }
            }
            None
        })
        .expect("No assistant_message_completed event found");
    let initial_user_message_id = messages
        .iter()
        .find_map(|msg| {
            if let Ok(json) = serde_json::from_str::<Value>(&msg.data) {
                if json["message_type"] == "user_message_saved" {
                    return Some(json["message_id"].as_str().unwrap().to_string());
                }
            }
            None
        })
        .expect("No user_message_saved event found");

    // Now edit the message with a new user message
    let edited_message = "What is the capital of Spain?";
    let response = server
        .post("/api/v1beta/me/messages/editstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "message_id": initial_user_message_id,
            "replace_user_message": edited_message,
            "replace_input_files_ids": []
        }))
        .await;

    let edit_messages = collect_sse_messages(response).await;
    assert!(!edit_messages.is_empty());

    // Verify we got a user_message_saved event
    let _user_message_saved = edit_messages
        .iter()
        .find(|msg| {
            if let Ok(json) = serde_json::from_str::<Value>(&msg.data) {
                json["message_type"] == "user_message_saved"
            } else {
                false
            }
        })
        .expect("No user_message_saved event found");

    // Verify we got a message_complete event
    let message_complete = edit_messages
        .iter()
        .find(|msg| {
            if let Ok(json) = serde_json::from_str::<Value>(&msg.data) {
                json["message_type"] == "assistant_message_completed"
            } else {
                false
            }
        })
        .expect("No assistant_message_completed event found");

    // Get all messages for the chat to verify the edit worked correctly
    let chat_id = serde_json::from_str::<Value>(&message_complete.data)
        .unwrap()
        .get("message")
        .unwrap()
        .get("chat_id")
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();

    let response = server
        .get(&format!("/api/v1beta/chats/{}/messages", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    let json: Value = response.json();
    let messages = json["messages"].as_array().unwrap();

    // Get all active messages
    let active_messages: Vec<&Value> = messages
        .iter()
        .filter(|msg| msg["is_message_in_active_thread"].as_bool().unwrap())
        .collect();

    // Verify we have exactly two active messages (the edited user message and the new assistant message)
    assert_eq!(active_messages.len(), 2);

    // Verify the active user message is the edited message
    let active_user_message = active_messages
        .iter()
        .find(|msg| msg["role"].as_str().unwrap() == "user")
        .expect("No active user message found");
    assert_eq!(
        active_user_message["content"]
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
        edited_message
    );

    // Verify the original message is marked as inactive
    let original_message = messages
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
        .expect("Original message not found");
    assert!(!original_message["is_message_in_active_thread"]
        .as_bool()
        .unwrap());

    // Verify the new assistant message has no sibling
    let new_assistant_message = active_messages
        .iter()
        .find(|msg| msg["role"].as_str().unwrap() == "assistant")
        .expect("No active assistant message found");
    assert_eq!(new_assistant_message["sibling_message_id"].as_str(), None);
}

/// Test that editing a message preserves lineage in multi-message conversations.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `e2e-flow`
///
/// # Test Behavior
/// Verifies that editing a message in the middle of a conversation properly
/// truncates only the messages after the edit point while preserving earlier
/// messages in the conversation thread.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_edit_message_preserves_lineage_in_multi_message_conversation(
    pool: Pool<Postgres>,
) {
    // Test for the specific bug where editing a message in a multi-message conversation
    // incorrectly truncates messages that should remain active
    let app_state = test_app_state(test_app_config(), pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a 3-message conversation: User1 -> Assistant1 -> User2 -> Assistant2

    // Message 1: User asks about France
    let response1 = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "user_message": "What is the capital of France?",
            "previous_message_id": null,
            "input_files_ids": []
        }))
        .await;

    let messages1 = collect_sse_messages(response1).await;
    let assistant_message_1_id = messages1
        .iter()
        .find_map(|msg| {
            if let Ok(json) = serde_json::from_str::<Value>(&msg.data) {
                if json["message_type"] == "assistant_message_completed" {
                    return Some(json["message_id"].as_str().unwrap().to_string());
                }
            }
            None
        })
        .expect("No assistant_message_completed event found for message 1");

    // Message 2: User asks about Germany
    let response2 = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "user_message": "What is the capital of Germany?",
            "previous_message_id": assistant_message_1_id,
            "input_files_ids": []
        }))
        .await;

    let messages2 = collect_sse_messages(response2).await;
    let _assistant_message_2_id = messages2
        .iter()
        .find_map(|msg| {
            if let Ok(json) = serde_json::from_str::<Value>(&msg.data) {
                if json["message_type"] == "assistant_message_completed" {
                    return Some(json["message_id"].as_str().unwrap().to_string());
                }
            }
            None
        })
        .expect("No assistant_message_completed event found for message 2");
    let user_message_2_id = messages2
        .iter()
        .find_map(|msg| {
            if let Ok(json) = serde_json::from_str::<Value>(&msg.data) {
                if json["message_type"] == "user_message_saved" {
                    return Some(json["message_id"].as_str().unwrap().to_string());
                }
            }
            None
        })
        .expect("No user_message_saved event found");

    // Now edit the second user message (about Germany) to ask about Spain instead
    let response3 = server
        .post("/api/v1beta/me/messages/editstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "message_id": user_message_2_id,
            "replace_user_message": "What is the capital of Spain?",
            "replace_input_files_ids": []
        }))
        .await;

    let edit_messages = collect_sse_messages(response3).await;
    let final_assistant_message_id = edit_messages
        .iter()
        .find_map(|msg| {
            if let Ok(json) = serde_json::from_str::<Value>(&msg.data) {
                if json["message_type"] == "assistant_message_completed" {
                    return Some(json["message"]["chat_id"].as_str().unwrap().to_string());
                }
            }
            None
        })
        .expect("No final assistant message found");

    // Get all messages to verify lineage preservation
    let response = server
        .get(&format!(
            "/api/v1beta/chats/{}/messages",
            final_assistant_message_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    let json: Value = response.json();
    let messages = json["messages"].as_array().unwrap();

    // Get all active messages
    let active_messages: Vec<&Value> = messages
        .iter()
        .filter(|msg| msg["is_message_in_active_thread"].as_bool().unwrap())
        .collect();

    // CRITICAL TEST: We should have exactly 4 active messages:
    // 1. User message about France
    // 2. Assistant response about France
    // 3. Edited user message about Spain (replacing Germany question)
    // 4. New assistant response about Spain
    assert_eq!(
        active_messages.len(),
        4,
        "Expected 4 active messages after editing middle message, but got {}. Active messages: {:?}",
        active_messages.len(),
        active_messages.iter().map(|m| format!("{}:{}", m["role"], m["content"][0]["text"])).collect::<Vec<_>>()
    );

    // Verify the first conversation (France) is preserved
    let france_user_msg = active_messages.iter().find(|msg| {
        msg["role"].as_str() == Some("user")
            && msg["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("France")
    });
    assert!(
        france_user_msg.is_some(),
        "France user message should still be active"
    );

    let france_assistant_msg = active_messages.iter().find(|msg| {
        msg["role"].as_str() == Some("assistant")
            && msg["previous_message_id"].as_str() == france_user_msg.unwrap()["id"].as_str()
    });
    assert!(
        france_assistant_msg.is_some(),
        "France assistant message should still be active"
    );

    // Verify the edited message (Spain) replaced the Germany message
    let spain_user_msg = active_messages.iter().find(|msg| {
        msg["role"].as_str() == Some("user")
            && msg["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("Spain")
    });
    assert!(
        spain_user_msg.is_some(),
        "Spain user message should be active"
    );

    // Verify NO Germany messages are active (they should be replaced/truncated)
    let germany_messages = active_messages
        .iter()
        .filter(|msg| {
            msg["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("Germany")
        })
        .count();
    assert_eq!(
        germany_messages, 0,
        "No Germany messages should remain active after edit"
    );

    // Verify lineage: Spain message should link to France assistant message
    assert_eq!(
        spain_user_msg.unwrap()["previous_message_id"].as_str(),
        Some(assistant_message_1_id.as_str()),
        "Spain message should be linked to France assistant message"
    );
}
