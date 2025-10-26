use crate::{test_app_state, MIGRATOR};
use axum::http;
use axum::Router;
use axum_test::TestServer;
use erato::config::AppConfig;
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use mocktail::prelude::*;
use serde_json::{json, Value};
use sqlx::postgres::Postgres;
use sqlx::Pool;
use std::time::Duration;

/// Helper function to build an OpenAI-compatible SSE streaming chunk
fn build_openai_chat_chunk(content: &str, finish_reason: Option<&str>) -> String {
    let delta = if content.is_empty() {
        json!({
            "content": content,
            "role": "assistant"
        })
    } else {
        json!({
            "content": content
        })
    };

    let chunk = json!({
        "id": "chatcmpl-mock-123",
        "object": "chat.completion.chunk",
        "created": 1234567890,
        "model": "gpt-3.5-turbo",
        "choices": [{
            "index": 0,
            "delta": delta,
            "finish_reason": finish_reason
        }]
    });

    format!("data: {}\n\n", chunk)
}

/// Helper function to build a delayed streaming response with multiple chunks
fn build_delayed_streaming_response(chunks: Vec<&str>, delay_ms: u64) -> Vec<BodyAction> {
    let mut actions = Vec::new();

    // First chunk is typically an empty role message
    actions.push(BodyAction::Bytes(build_openai_chat_chunk("", None).into()));

    // Add each content chunk with delay
    for (i, chunk) in chunks.iter().enumerate() {
        if i > 0 {
            actions.push(BodyAction::Delay(Duration::from_millis(delay_ms)));
        }
        actions.push(BodyAction::Bytes(
            build_openai_chat_chunk(chunk, None).into(),
        ));
    }

    // Add a small delay before the final chunk
    actions.push(BodyAction::Delay(Duration::from_millis(delay_ms)));

    // Final chunk with finish_reason
    actions.push(BodyAction::Bytes(
        build_openai_chat_chunk("", Some("stop")).into(),
    ));

    // OpenAI sends a final [DONE] message
    actions.push(BodyAction::Bytes("data: [DONE]\n\n".into()));

    actions
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_message_submit_with_mocked_llm(pool: Pool<Postgres>) {
    // Set up the mock LLM server
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");

        // Create a simple streaming response with a few chunks
        let chunks = vec!["Hello", " from", " the", " mocked", " LLM!"];
        let streaming_actions = build_delayed_streaming_response(chunks, 50);

        then.status(http::StatusCode::OK)
            .headers([
                ("Content-Type", "text/event-stream"),
                ("Cache-Control", "no-cache"),
                ("Connection", "keep-alive"),
            ])
            .bytes_stream_with_delays(streaming_actions);
    });

    // Start the mock server
    let server = MockServer::new_http("llm-mock").with_mocks(mocks);
    server.start().await.expect("Failed to start mock server");

    // Get the mock server URL
    let mock_url = server.url("/v1/");
    let mock_url_str = mock_url.to_string();

    // Create app config with the mock server URL
    let app_config = AppConfig::config_schema_builder(None, true)
        .unwrap()
        .set_override("chat_providers.providers.mock-llm.provider_kind", "openai")
        .unwrap()
        .set_override(
            "chat_providers.providers.mock-llm.model_name",
            "gpt-3.5-turbo",
        )
        .unwrap()
        .set_override("chat_providers.providers.mock-llm.base_url", mock_url_str)
        .unwrap()
        .set_override("chat_providers.priority_order", vec!["mock-llm"])
        .unwrap()
        // Add model permissions to allow the mock-llm provider for all users
        .set_override(
            "model_permissions.rules.allow-mock-llm.rule_type",
            "allow-all",
        )
        .unwrap()
        .set_override(
            "model_permissions.rules.allow-mock-llm.chat_provider_ids",
            vec!["mock-llm"],
        )
        .unwrap()
        .build()
        .unwrap()
        .try_deserialize()
        .unwrap();

    // Create app state with the database connection
    let app_state = test_app_state(app_config, pool).await;

    // Create a test user
    let issuer = "http://0.0.0.0:5556";
    let subject = "CiQwOGE4Njg0Yi1kYjg4LTRiNzMtOTBhOS0zY2QxNjYxZjU0NjYSBWxvY2Fs";
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

    // Create a mock JWT token
    let mock_jwt = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjMzNTUwZjNkZWE2MDFhNjlmODM1MmVkNDA3OTRhYTlmYWMzNDhhODAifQ.eyJpc3MiOiJodHRwOi8vMC4wLjAuMDo1NTU2Iiwic3ViIjoiQ2lRd09HRTROamcwWWkxa1lqZzRMVFJpTnpNdE9UQmhPUzB6WTJReE5qWXhaalUwTmpZU0JXeHZZMkZzIiwiYXVkIjoiZXhhbXBsZS1hcHAiLCJleHAiOjE3NDA2MDkzNTAsImlhdCI6MTc0MDUyMjk1MCwiYXRfaGFzaCI6IldVVjNiUWNEbFN4M2Vod3o2QTZkYnciLCJjX2hhc2giOiJHcHVSdW52Y25rTjR3bGY4Q1RYamh3IiwiZW1haWwiOiJhZG1pbkBleGFtcGxlLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiYWRtaW4ifQ.h8Fo6PAl2dG3xosBd6a6U6QAWalJvpX62-F3rJaS4hft7qnh9Sv_xDB2Cp1cjj-vS0e4xveDNuMGGnGKeUAk496q4xtuhwU9oUMoAsRQwnCXdp--_ngIG7QZK80h4jhvfutOc6Gltn0TTr-N5i8Yb9tW-ubVE68_-uX3lkx771MyJxgg9sL1YY7eKKEWx7UlRZEHmY6F134fY-ZFegrEnkESxi2qLTRo5hWSSIYmNlCSwStmNBBSPIOLl_Gu4wvqfPER5qXWgYn5dkISPZmcGVqyQuOBQkGOrAKMefvWP_Y97KHOwE9Od4au-Pgg7kuTA7Ywateg1VCdxLM3FMK-Sw";

    // Prepare the request body
    let request_body = json!({
        "user_message": "Tell me a greeting"
    });

    // Make a request to the message submit endpoint with the mock JWT
    let response = test_server
        .post("/api/v1beta/me/messages/submitstream")
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
