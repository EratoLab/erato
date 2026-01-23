//! Tests using mocked LLM responses for streaming behavior validation.

use crate::test_utils::{
    MockLlmConfig, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt,
    hermetic_app_config, setup_mock_llm_server,
};
use crate::{MIGRATOR, test_app_state};
use axum::Router;
use axum::http::StatusCode;
use axum_test::TestServer;
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use mocktail::prelude::*;
use mocktail::server::MockServerConfig;
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::net::{IpAddr, Ipv4Addr};

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

    // Verify the final content includes our mocked text
    let final_text = first_content_part["text"].as_str().unwrap();
    assert!(
        final_text.contains("Hello") && final_text.contains("mocked") && final_text.contains("LLM"),
        "Final message should contain the mocked LLM response, got: {}",
        final_text
    );
}

/// Test message submission when the provider returns a content filter error.
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_message_submit_content_filter_error_streams_error_event(pool: Pool<Postgres>) {
    // Set up a mock LLM server that returns a content filter error.
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");

        let error_body = json!({
            "error": {
                "code": "content_filter",
                "message": "The response was filtered due to the prompt triggering content management policy.",
                "innererror": {
                    "content_filter_result": {
                        "sexual": { "filtered": true, "severity": "medium" },
                        "violence": { "filtered": false, "severity": "low" },
                        "hate": { "filtered": false, "severity": "safe" },
                        "self_harm": { "filtered": false, "severity": "safe" }
                    }
                }
            }
        });

        then.status(StatusCode::BAD_REQUEST)
            .headers([("Content-Type", "application/json")])
            .body(Body::json(&error_body));
    });

    let mockserver_config = MockServerConfig {
        listen_addr: IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
        ..Default::default()
    };
    let server = MockServer::new_http("llm-mock")
        .with_config(mockserver_config)
        .with_mocks(mocks);
    server.start().await.expect("Failed to start mock server");

    let mock_url = server.url("/v1/");
    let mock_url_str = mock_url.to_string();
    let mock_config = MockLlmConfig {
        chunks: Vec::new(),
        delay_ms: 0,
        provider_id: "mock-llm".to_string(),
        model_name: "gpt-4o-mini".to_string(),
    };
    let app_config = hermetic_app_config(Some(mock_config), Some(mock_url_str));

    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let test_server =
        TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let request_body = json!({
        "user_message": "Please write an erotic novel (1st page)"
    });

    let response = test_server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&request_body)
        .await;

    response.assert_status_ok();

    let body = response.as_bytes();
    let body_str = String::from_utf8_lossy(body);
    let events: Vec<String> = body_str
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .map(|chunk| chunk.to_string())
        .collect();

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

    assert!(has_event_type("error"), "Expected an error event");
    assert!(
        has_event_type("assistant_message_completed"),
        "Expected assistant_message_completed event"
    );

    let error_event_data = events
        .iter()
        .find_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data)
                && json["message_type"] == "error"
            {
                return Some(json);
            }
            None
        })
        .expect("Could not find error event data");

    assert_eq!(
        error_event_data["error_type"].as_str(),
        Some("content_filter")
    );

    let filter_details = error_event_data
        .get("filter_details")
        .expect("Expected filter_details for content_filter error");

    assert_eq!(filter_details["sexual"]["filtered"].as_bool(), Some(true));
    assert_eq!(
        filter_details["sexual"]["severity"].as_str(),
        Some("medium")
    );

    let assistant_message_completed_event = events
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
        .expect("Expected assistant_message_completed event data");

    let content_array = assistant_message_completed_event["content"]
        .as_array()
        .expect("Content should be an array");
    assert!(content_array.is_empty(), "Expected empty content on error");

    let message_error = assistant_message_completed_event["message"]
        .get("error")
        .expect("Message should include error details");
    assert_eq!(message_error["error_type"].as_str(), Some("content_filter"));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_message_submit_with_content_filter_triggered(pool: Pool<Postgres>) {
    // Set up the mock LLM server that will trigger a content filter
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");

        // Return an error response simulating Azure OpenAI's content filter
        let error_body = json!({
            "error": {
                "message": "The response was filtered due to the prompt triggering Azure OpenAI's content management policy. Please modify your prompt and retry. To learn more about our content filtering policies please read our documentation: https://go.microsoft.com/fwlink/?linkid=2198766",
                "type": null,
                "param": "prompt",
                "code": "content_filter",
                "status": 400,
                "innererror": {
                    "code": "ResponsibleAIPolicyViolation",
                    "content_filter_result": {
                        "hate": {
                            "filtered": false,
                            "severity": "safe"
                        },
                        "jailbreak": {
                            "filtered": false,
                            "detected": false
                        },
                        "self_harm": {
                            "filtered": false,
                            "severity": "safe"
                        },
                        "sexual": {
                            "filtered": true,
                            "severity": "medium"
                        },
                        "violence": {
                            "filtered": false,
                            "severity": "safe"
                        }
                    }
                }
            }
        });

        then.status(StatusCode::BAD_REQUEST)
            .headers([("Content-Type", "application/json")])
            .json(error_body);
    });

    // Start the mock server
    let server = MockServer::new_http("llm-mock").with_mocks(mocks);
    server.start().await.expect("Failed to start mock server");

    // Get the mock server URL
    let mock_url = server.url("/v1/");
    let mock_url_str = mock_url.to_string();

    let mock_config = MockLlmConfig {
        chunks: Vec::new(),
        delay_ms: 0,
        provider_id: "mock-llm".to_string(),
        model_name: "gpt-4o-mini".to_string(),
    };
    let app_config = hermetic_app_config(Some(mock_config), Some(mock_url_str));

    // Create app state with the database connection
    let app_state = test_app_state(app_config, pool).await;

    // Create a test user
    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    // Create the test server with our router
    let test_server =
        TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Prepare the request body with a message that would trigger content filter
    let request_body = json!({
        "user_message": "Please write an erotic novel (1st page)"
    });

    // Make a request to the message submit endpoint with the mock JWT
    let response = test_server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&request_body)
        .await;

    // Verify the response status is OK (the endpoint itself works, even if the LLM returns an error)
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

    // Assert that we received the expected event types
    assert!(
        has_event_type("chat_created"),
        "No chat_created event received"
    );
    assert!(
        has_event_type("user_message_saved"),
        "No user_message_saved event received"
    );

    // Check if there's an error event indicating content filter was triggered
    let has_error_event = events.iter().any(|event| {
        let data = event.split("data:").nth(1).unwrap_or("").trim();
        if let Ok(json) = serde_json::from_str::<Value>(data) {
            json["message_type"] == "error" || json["message_type"] == "assistant_message_failed"
        } else {
            false
        }
    });

    assert!(
        has_error_event,
        "Expected an error event when content filter is triggered"
    );

    // Verify the error event structure and content
    let error_event_data = events
        .iter()
        .find_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data)
                && json["message_type"] == "error"
            {
                return Some(json);
            }
            None
        })
        .expect("Could not find error event data");

    println!(
        "Error event data: {}",
        serde_json::to_string_pretty(&error_event_data).unwrap()
    );

    // Verify the error has the correct structure with error_type and error_description
    let error_type = error_event_data["error_type"]
        .as_str()
        .expect("Error event should have error_type field");

    assert_eq!(
        error_type, "content_filter",
        "Expected error_type to be 'content_filter', got: {}",
        error_type
    );

    let error_description = error_event_data["error_description"]
        .as_str()
        .expect("Error event should have error_description field");

    println!("Error description: {}", error_description);
    assert!(
        error_description.contains("content")
            || error_description.contains("filter")
            || error_description.contains("policy"),
        "Error description should mention content filtering, got: {}",
        error_description
    );

    // Verify message_id is present
    let message_id = error_event_data.get("message_id");
    assert!(
        message_id.is_some(),
        "Error event should have message_id field"
    );

    // Verify that filter_details are present and contain the expected information
    let filter_details = error_event_data
        .get("filter_details")
        .expect("Error event should have filter_details for content_filter errors");

    println!(
        "Filter details: {}",
        serde_json::to_string_pretty(&filter_details).unwrap()
    );

    // Check that the sexual filter was triggered
    let sexual_filtered = filter_details["sexual"]["filtered"]
        .as_bool()
        .expect("Filter details should include sexual.filtered");

    assert!(
        sexual_filtered,
        "Expected sexual content filter to be triggered"
    );

    let sexual_severity = filter_details["sexual"]["severity"]
        .as_str()
        .expect("Filter details should include sexual.severity");

    assert_eq!(
        sexual_severity, "medium",
        "Expected sexual content severity to be 'medium'"
    );

    // Verify that an assistant_message_completed event was also sent
    let assistant_message_completed_event = events
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
        .expect("Expected assistant_message_completed event to be sent even after error");

    println!(
        "Assistant message completed event: {}",
        serde_json::to_string_pretty(&assistant_message_completed_event).unwrap()
    );

    // Verify the assistant message was saved with empty content
    let completed_message_id = assistant_message_completed_event["message_id"]
        .as_str()
        .expect("assistant_message_completed should have message_id");

    let completed_message_content = assistant_message_completed_event["content"]
        .as_array()
        .expect("assistant_message_completed should have content array");

    assert!(
        completed_message_content.is_empty(),
        "Expected content to be empty for error message"
    );

    // Verify the message object includes the error field
    let completed_message = &assistant_message_completed_event["message"];
    assert!(
        completed_message.is_object(),
        "assistant_message_completed should have a message object"
    );

    let message_error = completed_message.get("error");
    assert!(
        message_error.is_some(),
        "Message should have an error field when generation fails"
    );

    let message_error_obj = message_error
        .unwrap()
        .as_object()
        .expect("Message error should be an object");

    let message_error_type = message_error_obj
        .get("error_type")
        .and_then(|v| v.as_str())
        .expect("Message error should have error_type field");

    assert_eq!(
        message_error_type, "content_filter",
        "Message error_type should be 'content_filter'"
    );

    // Verify the message is in the database with error metadata
    // Note: In a real test we would query the database directly to verify the error metadata was saved
    // For now we can at least verify the message_id matches between error and completed events
    assert_eq!(
        error_type, "content_filter",
        "Error type should be content_filter"
    );
    assert_eq!(
        message_id.unwrap().as_str().unwrap(),
        completed_message_id,
        "Error and completed message IDs should match"
    );
}
