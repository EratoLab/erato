//! Common test utilities and helpers for integration tests.
//!
//! This module provides reusable helper functions to reduce code duplication
//! across integration tests.

#![allow(dead_code)]

use axum::Router;
use axum_test::{TestResponse, TestServer};
use erato::config::AppConfig;
use erato::state::AppState;
use mocktail::prelude::*;
use mocktail::server::MockServerConfig;
use serde_json::{Value, json};
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;
use tempfile::{Builder, NamedTempFile};

// ============================================================================
// Configuration Helpers
// ============================================================================

/// Creates a temporary TOML configuration file with the given content.
///
/// The file will be automatically cleaned up when the returned `NamedTempFile`
/// is dropped.
///
/// # Arguments
/// * `content` - The TOML configuration content to write to the file
///
/// # Returns
/// A `NamedTempFile` containing the configuration. Use `.path()` to get the file path.
///
/// # Example
/// ```no_run
/// let temp_file = create_temp_config_file(r#"
///     [chat_provider]
///     provider_kind = "openai"
///     model_name = "gpt-4"
/// "#);
/// let config_path = temp_file.path();
/// ```
pub fn create_temp_config_file(content: &str) -> NamedTempFile {
    let mut temp_file = Builder::new()
        .suffix(".toml")
        .tempfile()
        .expect("Failed to create temporary file");

    temp_file
        .write_all(content.as_bytes())
        .expect("Failed to write to temporary file");

    temp_file.flush().expect("Failed to flush temporary file");

    temp_file
}

/// Builds an `AppConfig` from a configuration file path with optional overrides.
///
/// This helper standardizes the common pattern of creating a config builder,
/// applying overrides, and deserializing the config.
///
/// # Arguments
/// * `config_path` - Optional path to a configuration file
/// * `overrides` - A slice of (key, value) tuples to override in the config
///
/// # Returns
/// A fully initialized `AppConfig`
///
/// # Example
/// ```no_run
/// let config = build_app_config_with_overrides(
///     Some("/path/to/config.toml"),
///     &[("database_url", "postgres://localhost/test")]
/// );
/// ```
pub fn build_app_config_with_overrides(
    config_path: Option<&str>,
    overrides: &[(&str, &str)],
) -> AppConfig {
    let config_paths = config_path.map(|p| vec![p.to_string()]);

    let mut builder = AppConfig::config_schema_builder(config_paths, false)
        .expect("Failed to create config builder");

    for (key, value) in overrides {
        builder = builder
            .set_override(*key, *value)
            .unwrap_or_else(|_| panic!("Failed to set override {}={}", key, value));
    }

    let config_schema = builder.build().expect("Failed to build config schema");
    config_schema
        .try_deserialize()
        .expect("Failed to deserialize config")
}

/// Builds an `AppConfig` from a temporary TOML file with a database URL override.
///
/// This is a convenience wrapper around `build_app_config_with_overrides` for the
/// common case of loading config from a temp file with just a database URL override.
///
/// # Arguments
/// * `temp_file` - Reference to the temporary config file
/// * `database_url` - The database URL to use (defaults to a test database if not provided)
///
/// # Returns
/// A fully initialized `AppConfig`
pub fn build_app_config_from_temp_file(
    temp_file: &NamedTempFile,
    database_url: Option<&str>,
) -> AppConfig {
    let temp_path = temp_file.path().to_str().unwrap();
    let db_url = database_url.unwrap_or("postgres://user:pass@localhost:5432/test");

    build_app_config_with_overrides(Some(temp_path), &[("database_url", db_url)])
}

// ============================================================================
// Authentication Helpers
// ============================================================================

/// Standard mock JWT token used across integration tests.
///
/// This token has the following claims:
/// - iss: http://0.0.0.0:5556
/// - sub: CiQwOGE4Njg0Yi1kYjg4LTRiNzMtOTBhOS0zY2QxNjYxZjU0NjYSBWxvY2Fs
/// - email: admin@example.com
/// - name: admin
pub const TEST_JWT_TOKEN: &str = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjMzNTUwZjNkZWE2MDFhNjlmODM1MmVkNDA3OTRhYTlmYWMzNDhhODAifQ.eyJpc3MiOiJodHRwOi8vMC4wLjAuMDo1NTU2Iiwic3ViIjoiQ2lRd09HRTROamcwWWkxa1lqZzRMVFJpTnpNdE9UQmhPUzB6WTJReE5qWXhaalUwTmpZU0JXeHZZMkZzIiwiYXVkIjoiZXhhbXBsZS1hcHAiLCJleHAiOjE3NDA2MDkzNTAsImlhdCI6MTc0MDUyMjk1MCwiYXRfaGFzaCI6IldVVjNiUWNEbFN4M2Vod3o2QTZkYnciLCJjX2hhc2giOiJHcHVSdW52Y25rTjR3bGY4Q1RYamh3IiwiZW1haWwiOiJhZG1pbkBleGFtcGxlLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiYWRtaW4ifQ.h8Fo6PAl2dG3xosBd6a6U6QAWalJvpX62-F3rJaS4hft7qnh9Sv_xDB2Cp1cjj-vS0e4xveDNuMGGnGKeUAk496q4xtuhwU9oUMoAsRQwnCXdp--_ngIG7QZK80h4jhvfutOc6Gltn0TTr-N5i8Yb9tW-ubVE68_-uX3lkx771MyJxgg9sL1YY7eKKEWx7UlRZEHmY6F134fY-ZFegrEnkESxi2qLTRo5hWSSIYmNlCSwStmNBBSPIOLl_Gu4wvqfPER5qXWgYn5dkISPZmcGVqyQuOBQkGOrAKMefvWP_Y97KHOwE9Od4au-Pgg7kuTA7Ywateg1VCdxLM3FMK-Sw";

/// Standard test user issuer (matches the TEST_JWT_TOKEN).
pub const TEST_USER_ISSUER: &str = "http://0.0.0.0:5556";

/// Standard test user subject (matches the TEST_JWT_TOKEN).
pub const TEST_USER_SUBJECT: &str = "CiQwOGE4Njg0Yi1kYjg4LTRiNzMtOTBhOS0zY2QxNjYxZjU0NjYSBWxvY2Fs";

// ============================================================================
// Test Server Helpers
// ============================================================================

/// Creates a test server from the given app state.
///
/// This standardizes the common pattern of creating a router, splitting it,
/// and wrapping it in a test server.
///
/// # Arguments
/// * `app_state` - The application state to use for the test server
///
/// # Returns
/// A `TestServer` ready for making test requests
pub fn create_test_server(app_state: AppState) -> TestServer {
    let app: Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    TestServer::new(app.into_make_service()).expect("Failed to create test server")
}

/// Extension trait for adding authorization headers to test requests.
pub trait TestRequestAuthExt {
    /// Adds a Bearer token authorization header and Content-Type header to the request.
    ///
    /// # Arguments
    /// * `token` - The bearer token to use for authentication
    ///
    /// # Returns
    /// The request builder with both authorization and content-type headers added
    ///
    /// # Example
    /// ```no_run
    /// use crate::test_utils::{TEST_JWT_TOKEN, TestRequestAuthExt};
    ///
    /// let response = server
    ///     .post("/api/v1beta/me/profile")
    ///     .with_bearer_token(TEST_JWT_TOKEN)
    ///     .await;
    /// ```
    fn with_bearer_token(self, token: &str) -> Self;
}

impl TestRequestAuthExt for axum_test::TestRequest {
    fn with_bearer_token(self, token: &str) -> Self {
        self.add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token),
        )
        .add_header(axum::http::header::CONTENT_TYPE, "application/json")
    }
}

// ============================================================================
// SSE (Server-Sent Events) Helpers
// ============================================================================

/// Represents a parsed Server-Sent Event (SSE).
#[derive(Debug, Clone)]
pub struct Event {
    pub event_type: String,
    pub data: String,
    pub id: Option<String>,
    pub retry: Option<u32>,
}

/// Parses SSE events from a test response.
///
/// This helper function extracts and parses all SSE events from a response body.
///
/// # Arguments
/// * `response` - The test response containing SSE data
///
/// # Returns
/// A vector of parsed `Event` objects
pub fn parse_sse_events(response: &TestResponse) -> Vec<Event> {
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
            } else if line.starts_with("retry: ")
                && let Ok(retry) = line["retry: ".len()..].parse::<u32>()
            {
                event.retry = Some(retry);
            }
        }

        // Only add the event if it has data
        if !event.data.is_empty() {
            messages.push(event);
        }
    }

    messages
}

/// Checks if events contain a specific message type.
///
/// # Arguments
/// * `events` - Slice of parsed events
/// * `message_type` - The message type to search for (e.g., "chat_created")
///
/// # Returns
/// `true` if an event with the specified message type exists
pub fn has_event_type(events: &[Event], message_type: &str) -> bool {
    events.iter().any(|event| {
        if let Ok(json) = serde_json::from_str::<Value>(&event.data) {
            json["message_type"] == message_type
        } else {
            false
        }
    })
}

/// Extracts the chat ID from SSE events.
///
/// # Arguments
/// * `events` - Slice of parsed events
///
/// # Returns
/// The chat ID as a String, or None if no chat_created event is found
pub fn extract_chat_id(events: &[Event]) -> Option<String> {
    events.iter().find_map(|event| {
        if let Ok(json) = serde_json::from_str::<Value>(&event.data)
            && json["message_type"] == "chat_created"
        {
            return json["chat_id"].as_str().map(|s| s.to_string());
        }
        None
    })
}

/// Collects all text deltas from SSE events.
///
/// # Arguments
/// * `events` - Slice of parsed events
///
/// # Returns
/// A vector of text delta strings in the order they were received
pub fn extract_text_deltas(events: &[Event]) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data) {
                if json["message_type"] == "text_delta" {
                    json["new_text"].as_str().map(|s| s.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect()
}

/// Joins all text deltas into a single string.
///
/// # Arguments
/// * `events` - Slice of parsed events
///
/// # Returns
/// The complete text assembled from all text_delta events
pub fn extract_full_text(events: &[Event]) -> String {
    extract_text_deltas(events).join("")
}

// ============================================================================
// Mock LLM Server Helpers
// ============================================================================

/// Helper function to build an OpenAI-compatible SSE streaming chunk.
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

/// Configuration for a mock LLM server.
pub struct MockLlmConfig {
    /// The chunks to send in the streaming response
    pub chunks: Vec<String>,
    /// Delay between chunks in milliseconds
    pub delay_ms: u64,
    /// The provider ID to use in the config (defaults to "mock-llm")
    pub provider_id: String,
    /// The model name to use in the config (defaults to "gpt-3.5-turbo")
    pub model_name: String,
}

impl Default for MockLlmConfig {
    fn default() -> Self {
        Self {
            chunks: ["Hello", " from", " the", " mocked", " LLM!"]
                .iter()
                .map(|&s| s.to_string())
                .collect(),
            delay_ms: 50,
            provider_id: "mock-llm".to_string(),
            model_name: "gpt-3.5-turbo".to_string(),
        }
    }
}

/// Sets up a mock LLM server and returns an AppConfig configured to use it.
///
/// This utility function creates a mock OpenAI-compatible server that streams responses
/// with the specified chunks and delays. It configures the app to use this mock server
/// for all chat provider operations.
///
/// # Arguments
/// * `config` - Optional mock configuration (uses default if not provided)
///
/// # Returns
/// A tuple containing the AppConfig and the MockServer (keep the server alive during your test)
///
/// # Example
/// ```no_run
/// use crate::test_utils::setup_mock_llm_server;
///
/// let (app_config, _server) = setup_mock_llm_server(None);
/// // Use app_config in your test
/// ```
pub async fn setup_mock_llm_server(config: Option<MockLlmConfig>) -> (AppConfig, MockServer) {
    let config = config.unwrap_or_default();

    // Convert String chunks to &str for the build function
    let chunk_refs: Vec<&str> = config.chunks.iter().map(|s| s.as_str()).collect();

    // Set up the mock LLM server
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");

        // Create a streaming response with the configured chunks
        let streaming_actions = build_delayed_streaming_response(chunk_refs, config.delay_ms);

        then.status(axum::http::StatusCode::OK)
            .headers([
                ("Content-Type", "text/event-stream"),
                ("Cache-Control", "no-cache"),
                ("Connection", "keep-alive"),
            ])
            .bytes_stream_with_delays(streaming_actions);
    });

    // Start the mock server
    let mockserver_config = MockServerConfig {
        listen_addr: IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
        ..Default::default()
    };
    let server = MockServer::new_http("llm-mock")
        .with_config(mockserver_config)
        .with_mocks(mocks);

    // Start the server first
    server.start().await.expect("Failed to start mock server");

    // Get the mock server URL
    let mock_url = server.url("/v1/");
    let mock_url_str = mock_url.to_string();

    // Create app config with the mock server URL
    let app_config = hermetic_app_config(Some(config), Some(mock_url_str));

    (app_config, server)
}

pub fn hermetic_app_config(
    mock_llm_config: Option<MockLlmConfig>,
    mock_url_str: Option<String>,
) -> AppConfig {
    let mut app_config = AppConfig::config_schema_builder(None, false).unwrap();
    if let Some(mock_llm_config) = mock_llm_config {
        app_config = app_config
            .set_override(
                format!(
                    "chat_providers.providers.{}.provider_kind",
                    mock_llm_config.provider_id
                ),
                "openai",
            )
            .unwrap()
            .set_override(
                format!(
                    "chat_providers.providers.{}.model_name",
                    mock_llm_config.provider_id
                ),
                mock_llm_config.model_name,
            )
            .unwrap()
            .set_override(
                format!(
                    "chat_providers.providers.{}.base_url",
                    mock_llm_config.provider_id
                ),
                mock_url_str,
            )
            .unwrap()
            .set_override(
                "chat_providers.priority_order",
                vec![mock_llm_config.provider_id.as_str()],
            )
            .unwrap()
            // Add model permissions to allow the mock-llm provider for all users
            .set_override(
                format!(
                    "model_permissions.rules.allow-{}.rule_type",
                    mock_llm_config.provider_id
                ),
                "allow-all",
            )
            .unwrap()
            .set_override(
                format!(
                    "model_permissions.rules.allow-{}.chat_provider_ids",
                    mock_llm_config.provider_id
                ),
                vec![mock_llm_config.provider_id.as_str()],
            )
            .unwrap();
    }

    app_config = app_config
        // Set file storage provider override to match the template in erato.template.toml
        .set_override("file_storage_providers.minio.provider_kind", "s3")
        .unwrap()
        .set_override(
            "file_storage_providers.minio.config.endpoint",
            "http://127.0.0.1:9000",
        )
        .unwrap()
        .set_override(
            "file_storage_providers.minio.config.bucket",
            "erato-storage",
        )
        .unwrap()
        .set_override("file_storage_providers.minio.config.region", "us-east-1")
        .unwrap()
        .set_override(
            "file_storage_providers.minio.config.access_key_id",
            "erato-app-user",
        )
        .unwrap()
        .set_override(
            "file_storage_providers.minio.config.secret_access_key",
            "erato-app-password",
        )
        .unwrap()
        .set_override("experimental_assistants.enabled", true)
        .unwrap();

    app_config.build().unwrap().try_deserialize().unwrap()
}
