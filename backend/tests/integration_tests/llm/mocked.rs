//! Tests using mocked LLM responses for streaming behavior validation.

use crate::test_utils::{
    setup_mock_llm_server, MockLlmConfig, TestRequestAuthExt, TEST_JWT_TOKEN, TEST_USER_ISSUER,
    TEST_USER_SUBJECT,
};
use crate::{test_app_state, MIGRATOR};
use axum::Router;
use axum_test::TestServer;
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use serde_json::{json, Value};
use sqlx::postgres::Postgres;
use sqlx::Pool;

/// Test message submission with a mocked LLM server.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
/// - `sse-streaming`
/// - `auth-required`
///
/// # Test Behavior
/// This test verifies the complete message streaming flow with a mocked OpenAI-compatible
/// LLM server. It validates:
/// - Mock LLM server setup and configuration
/// - SSE event stream parsing
/// - Text delta collection and assembly
/// - Event type validation (chat_created, user_message_saved, assistant_message_started, etc.)
/// - Final message content verification
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_message_submit_with_mocked_llm(pool: Pool<Postgres>) {
    // Set up the mock LLM server with custom chunks
    let mock_config = MockLlmConfig {
        chunks: ["Hello", " from", " the", " mocked", " LLM!"]
            .iter()
            .map(|&s| s.to_string())
            .collect(),
        delay_ms: 50,
        provider_id: "mock-llm".to_string(),
        model_name: "gpt-3.5-turbo".to_string(),
    };

    let (app_config, _server) = setup_mock_llm_server(Some(mock_config)).await;

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
    let test_server =
        TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Prepare the request body
    let request_body = json!({
        "user_message": "Tell me a greeting"
    });

    // Make a request to the message submit endpoint with the mock JWT
    let response = test_server
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

    // Collect all text delta content
    let text_deltas: Vec<String> = events
        .iter()
        .filter_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                if json["message_type"] == "text_delta" {
                    json["new_text"].as_str().map(|s| s.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    println!("Text deltas received: {:?}", text_deltas);

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

    // Verify that the text deltas contain the expected content from our mock
    let full_text = text_deltas.join("");
    assert!(
        full_text.contains("Hello"),
        "Expected 'Hello' in the response text, got: {}",
        full_text
    );
    assert!(
        full_text.contains("mocked"),
        "Expected 'mocked' in the response text, got: {}",
        full_text
    );
    assert!(
        full_text.contains("LLM"),
        "Expected 'LLM' in the response text, got: {}",
        full_text
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

    // Verify the final content includes our mocked text
    let final_text = first_content_part["text"].as_str().unwrap();
    assert!(
        final_text.contains("Hello") && final_text.contains("mocked") && final_text.contains("LLM"),
        "Final message should contain the mocked LLM response, got: {}",
        final_text
    );
}
