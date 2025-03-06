#![allow(clippy::manual_strip)]

use axum::{http, Router};
use axum_test::TestServer;
use ctor::ctor;
use erato::config::AppConfig;
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use erato::state::AppState;
use serde_json::{json, Value};
use sqlx::postgres::Postgres;
use sqlx::Pool;
use test_log::test;

mod db;
mod migrations;

// Using a (possibly brittle?) life-before-main method to set the DATABASE_URL before any tests run.
#[ctor]
fn set_test_db_url() {
    std::env::set_var(
        "DATABASE_URL",
        "postgres://eratouser:eratopw@127.0.0.1:5432/erato",
    )
}

// TODO: More proper way would be via SqitchMigration but we can't build them in a static way yet.
// pub static MIGRATOR: sqlx::migrate::Migrator = Migrator::new(SqitchMigrationSource::new(PathBuf::from("./sqitch/sqitch_summary.json")));
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./sqitch/deploy");

pub fn test_app_config() -> AppConfig {
    let mut builder = AppConfig::config_schema_builder().unwrap();
    builder = builder
        .set_override("chat_provider.provider_kind", "ollama")
        .unwrap();
    builder = builder
        .set_override("chat_provider.model_name", "smollm2:135m")
        .unwrap();
    builder = builder
        .set_override("chat_provider.base_url", "http://localhost:12434/v1/")
        .unwrap();

    let config_schema = builder.build().unwrap();
    config_schema.try_deserialize().unwrap()
}

pub fn test_app_state(app_config: AppConfig, pool: Pool<Postgres>) -> AppState {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    AppState {
        db,
        policy: AppState::build_policy().unwrap(),
        genai_client: AppState::build_genai_client(app_config.chat_provider).unwrap(),
    }
}
// This is the main entry point for integration tests
// Add more test modules here as needed
#[test]
fn dummy() {
    // This test exists to make sure the test binary is built
    // Individual tests should go in their respective modules
    // assert!(true);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_db_connection(pool: Pool<Postgres>) {
    dbg!(&pool.connect_options());
    // Basic test to ensure we can execute a query
    let result = sqlx::query_scalar::<_, i32>("SELECT 1 FROM messages;")
        .fetch_all(&pool)
        .await
        .expect("Failed to execute test query");

    assert_eq!(result, Vec::<i32>::new());
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_user_without_email(pool: Pool<Postgres>) {
    // Convert the sqlx pool to a sea-orm DatabaseConnection
    let conn = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);

    // Test data
    let issuer = "test-issuer";
    let subject = "test-subject";

    // First call - create a user without an email
    let user1 = get_or_create_user(&conn, issuer, subject, None)
        .await
        .expect("Failed to create user without email");

    // Verify the user was created with the correct data
    assert_eq!(user1.issuer, issuer);
    assert_eq!(user1.subject, subject);
    assert_eq!(user1.email, None);

    // Second call - should return the same user
    let user2 = get_or_create_user(&conn, issuer, subject, None)
        .await
        .expect("Failed to get existing user");

    // Verify the user has the same ID (i.e., it's the same user)
    assert_eq!(user1.id, user2.id);
    assert_eq!(user2.issuer, issuer);
    assert_eq!(user2.subject, subject);
    assert_eq!(user2.email, None);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_profile_endpoint(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool);

    // Create a test user
    let issuer = "http://0.0.0.0:5556";
    let subject = "CiQwOGE4Njg0Yi1kYjg4LTRiNzMtOTBhOS0zY2QxNjYxZjU0NjYSBWxvY2Fs";
    let user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a mock JWT token
    // In a real scenario, this would be a properly signed JWT
    // For testing, we just need a token that contains the necessary claims
    let mock_jwt = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjMzNTUwZjNkZWE2MDFhNjlmODM1MmVkNDA3OTRhYTlmYWMzNDhhODAifQ.eyJpc3MiOiJodHRwOi8vMC4wLjAuMDo1NTU2Iiwic3ViIjoiQ2lRd09HRTROamcwWWkxa1lqZzRMVFJpTnpNdE9UQmhPUzB6WTJReE5qWXhaalUwTmpZU0JXeHZZMkZzIiwiYXVkIjoiZXhhbXBsZS1hcHAiLCJleHAiOjE3NDA2MDkzNTAsImlhdCI6MTc0MDUyMjk1MCwiYXRfaGFzaCI6IldVVjNiUWNEbFN4M2Vod3o2QTZkYnciLCJjX2hhc2giOiJHcHVSdW52Y25rTjR3bGY4Q1RYamh3IiwiZW1haWwiOiJhZG1pbkBleGFtcGxlLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiYWRtaW4ifQ.h8Fo6PAl2dG3xosBd6a6U6QAWalJvpX62-F3rJaS4hft7qnh9Sv_xDB2Cp1cjj-vS0e4xveDNuMGGnGKeUAk496q4xtuhwU9oUMoAsRQwnCXdp--_ngIG7QZK80h4jhvfutOc6Gltn0TTr-N5i8Yb9tW-ubVE68_-uX3lkx771MyJxgg9sL1YY7eKKEWx7UlRZEHmY6F134fY-ZFegrEnkESxi2qLTRo5hWSSIYmNlCSwStmNBBSPIOLl_Gu4wvqfPER5qXWgYn5dkISPZmcGVqyQuOBQkGOrAKMefvWP_Y97KHOwE9Od4au-Pgg7kuTA7Ywateg1VCdxLM3FMK-Sw";

    // Make a request to the profile endpoint with the mock JWT
    let response = server
        .get("/api/v1beta/me/profile")
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
        .await;

    // Verify the response status is OK
    response.assert_status_ok();

    // Parse the response body as a JSON Value instead of UserProfile
    let profile: Value = response.json();

    // Verify the profile contains the expected data
    assert_eq!(profile["id"].as_str().unwrap(), user.id.to_string());
    assert_eq!(
        profile["email"],
        Value::String("admin@example.com".to_string())
    );
    assert_eq!(profile["preferred_language"].as_str().unwrap(), "en");
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_message_submit_stream(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(test_app_config(), pool);

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
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a mock JWT token (same as in test_profile_endpoint)
    let mock_jwt = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjMzNTUwZjNkZWE2MDFhNjlmODM1MmVkNDA3OTRhYTlmYWMzNDhhODAifQ.eyJpc3MiOiJodHRwOi8vMC4wLjAuMDo1NTU2Iiwic3ViIjoiQ2lRd09HRTROamcwWWkxa1lqZzRMVFJpTnpNdE9UQmhPUzB6WTJReE5qWXhaalUwTmpZU0JXeHZZMkZzIiwiYXVkIjoiZXhhbXBsZS1hcHAiLCJleHAiOjE3NDA2MDkzNTAsImlhdCI6MTc0MDUyMjk1MCwiYXRfaGFzaCI6IldVVjNiUWNEbFN4M2Vod3o2QTZkYnciLCJjX2hhc2giOiJHcHVSdW52Y25rTjR3bGY4Q1RYamh3IiwiZW1haWwiOiJhZG1pbkBleGFtcGxlLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiYWRtaW4ifQ.h8Fo6PAl2dG3xosBd6a6U6QAWalJvpX62-F3rJaS4hft7qnh9Sv_xDB2Cp1cjj-vS0e4xveDNuMGGnGKeUAk496q4xtuhwU9oUMoAsRQwnCXdp--_ngIG7QZK80h4jhvfutOc6Gltn0TTr-N5i8Yb9tW-ubVE68_-uX3lkx771MyJxgg9sL1YY7eKKEWx7UlRZEHmY6F134fY-ZFegrEnkESxi2qLTRo5hWSSIYmNlCSwStmNBBSPIOLl_Gu4wvqfPER5qXWgYn5dkISPZmcGVqyQuOBQkGOrAKMefvWP_Y97KHOwE9Od4au-Pgg7kuTA7Ywateg1VCdxLM3FMK-Sw";

    // Prepare the request body
    let request_body = serde_json::json!({
        "user_message": "Hello, this is a test message"
    });

    // Make a request to the message submit endpoint with the mock JWT
    let response = server
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

    // Assert that we received all expected event types
    assert!(
        has_event_type("chat_created"),
        "No chat_created event received"
    );
    assert!(
        has_event_type("user_message_saved"),
        "No user_message_saved event received"
    );
    assert!(text_delta_count > 0, "No text_delta events received");
    assert!(
        has_event_type("message_complete"),
        "No message_complete event received"
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_recent_chats_endpoint(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_config = test_app_config();
    let app_state = test_app_state(app_config, pool);

    // Create a test user
    let issuer = "http://0.0.0.0:5556";
    let subject = "test-subject-for-recent-chats";
    let _user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a mock JWT token
    let mock_jwt = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjMzNTUwZjNkZWE2MDFhNjlmODM1MmVkNDA3OTRhYTlmYWMzNDhhODAifQ.eyJpc3MiOiJodHRwOi8vMC4wLjAuMDo1NTU2Iiwic3ViIjoiQ2lRd09HRTROamcwWWkxa1lqZzRMVFJpTnpNdE9UQmhPUzB6WTJReE5qWXhaalUwTmpZU0JXeHZZMkZzIiwiYXVkIjoiZXhhbXBsZS1hcHAiLCJleHAiOjE3NDA2MDkzNTAsImlhdCI6MTc0MDUyMjk1MCwiYXRfaGFzaCI6IldVVjNiUWNEbFN4M2Vod3o2QTZkYnciLCJjX2hhc2giOiJHcHVSdW52Y25rTjR3bGY4Q1RYamh3IiwiZW1haWwiOiJhZG1pbkBleGFtcGxlLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiYWRtaW4ifQ.h8Fo6PAl2dG3xosBd6a6U6QAWalJvpX62-F3rJaS4hft7qnh9Sv_xDB2Cp1cjj-vS0e4xveDNuMGGnGKeUAk496q4xtuhwU9oUMoAsRQwnCXdp--_ngIG7QZK80h4jhvfutOc6Gltn0TTr-N5i8Yb9tW-ubVE68_-uX3lkx771MyJxgg9sL1YY7eKKEWx7UlRZEHmY6F134fY-ZFegrEnkESxi2qLTRo5hWSSIYmNlCSwStmNBBSPIOLl_Gu4wvqfPER5qXWgYn5dkISPZmcGVqyQuOBQkGOrAKMefvWP_Y97KHOwE9Od4au-Pgg7kuTA7Ywateg1VCdxLM3FMK-Sw";

    // Create two chats by submitting messages
    for i in 1..=2 {
        // Submit a message to create a new chat
        let message_request = json!({
            "previous_message_id": null,
            "user_message": format!("Test message for chat {}", i)
        });

        // Send the message to create a chat
        let response = server
            .post("/api/v1beta/me/messages/submitstream")
            .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
            .add_header(http::header::CONTENT_TYPE, "application/json")
            .json(&message_request)
            .await;

        // Verify the response status is OK
        response.assert_status_ok();
    }

    // Now query the recent_chats endpoint
    let response = server
        .get("/api/v1beta/me/recent_chats")
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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

    // Verify each chat has the expected fields
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
    }
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_chat_messages_endpoint(pool: Pool<Postgres>) {
    // Set up the test environment
    let app_config = test_app_config();
    let app_state = test_app_state(app_config, pool);

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a mock JWT for authentication
    let mock_jwt = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjMzNTUwZjNkZWE2MDFhNjlmODM1MmVkNDA3OTRhYTlmYWMzNDhhODAifQ.eyJpc3MiOiJodHRwOi8vMC4wLjAuMDo1NTU2Iiwic3ViIjoiQ2lRd09HRTROamcwWWkxa1lqZzRMVFJpTnpNdE9UQmhPUzB6WTJReE5qWXhaalUwTmpZU0JXeHZZMkZzIiwiYXVkIjoiZXhhbXBsZS1hcHAiLCJleHAiOjE3NDA2MDkzNTAsImlhdCI6MTc0MDUyMjk1MCwiYXRfaGFzaCI6IldVVjNiUWNEbFN4M2Vod3o2QTZkYnciLCJjX2hhc2giOiJHcHVSdW52Y25rTjR3bGY4Q1RYamh3IiwiZW1haWwiOiJhZG1pbkBleGFtcGxlLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiYWRtaW4ifQ.h8Fo6PAl2dG3xosBd6a6U6QAWalJvpX62-F3rJaS4hft7qnh9Sv_xDB2Cp1cjj-vS0e4xveDNuMGGnGKeUAk496q4xtuhwU9oUMoAsRQwnCXdp--_ngIG7QZK80h4jhvfutOc6Gltn0TTr-N5i8Yb9tW-ubVE68_-uX3lkx771MyJxgg9sL1YY7eKKEWx7UlRZEHmY6F134fY-ZFegrEnkESxi2qLTRo5hWSSIYmNlCSwStmNBBSPIOLl_Gu4wvqfPER5qXWgYn5dkISPZmcGVqyQuOBQkGOrAKMefvWP_Y97KHOwE9Od4au-Pgg7kuTA7Ywateg1VCdxLM3FMK-Sw";

    // Create a chat by sending a message
    let first_message = "First test message";
    let message_request = json!({
        "previous_message_id": null,
        "user_message": first_message
    });

    // Send the first message to create a chat
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        if lines[i] == "event: message_complete" {
            // The data is on the next line, prefixed with "data: "
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse message_complete data");

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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;
    dbg!("Second message sent");

    // Verify the response status is OK
    response.assert_status_ok();

    // Now query the chat messages endpoint
    let response = server
        .get(&format!("/api/v1beta/chats/{}/messages", chat_id))
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
    let user_message_texts: Vec<&str> = user_messages
        .iter()
        .map(|msg| msg["full_text"].as_str().unwrap_or(""))
        .collect();

    assert!(
        user_message_texts.contains(&first_message),
        "First user message not found"
    );
    assert!(
        user_message_texts.contains(&second_message),
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
            message.get("full_text").is_some(),
            "Message is missing 'full_text' field"
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

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_chat_messages_with_regeneration(pool: Pool<Postgres>) {
    // Set up the test environment
    let app_config = test_app_config();
    let app_state = test_app_state(app_config, pool);

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a mock JWT for authentication
    let mock_jwt = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjMzNTUwZjNkZWE2MDFhNjlmODM1MmVkNDA3OTRhYTlmYWMzNDhhODAifQ.eyJpc3MiOiJodHRwOi8vMC4wLjAuMDo1NTU2Iiwic3ViIjoiQ2lRd09HRTROamcwWWkxa1lqZzRMVFJpTnpNdE9UQmhPUzB6WTJReE5qWXhaalUwTmpZU0JXeHZZMkZzIiwiYXVkIjoiZXhhbXBsZS1hcHAiLCJleHAiOjE3NDA2MDkzNTAsImlhdCI6MTc0MDUyMjk1MCwiYXRfaGFzaCI6IldVVjNiUWNEbFN4M2Vod3o2QTZkYnciLCJjX2hhc2giOiJHcHVSdW52Y25rTjR3bGY4Q1RYamh3IiwiZW1haWwiOiJhZG1pbkBleGFtcGxlLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiYWRtaW4ifQ.h8Fo6PAl2dG3xosBd6a6U6QAWalJvpX62-F3rJaS4hft7qnh9Sv_xDB2Cp1cjj-vS0e4xveDNuMGGnGKeUAk496q4xtuhwU9oUMoAsRQwnCXdp--_ngIG7QZK80h4jhvfutOc6Gltn0TTr-N5i8Yb9tW-ubVE68_-uX3lkx771MyJxgg9sL1YY7eKKEWx7UlRZEHmY6F134fY-ZFegrEnkESxi2qLTRo5hWSSIYmNlCSwStmNBBSPIOLl_Gu4wvqfPER5qXWgYn5dkISPZmcGVqyQuOBQkGOrAKMefvWP_Y97KHOwE9Od4au-Pgg7kuTA7Ywateg1VCdxLM3FMK-Sw";

    // Step 1: Send a message to a new chat
    let first_message = "First test message for regeneration test";
    let message_request = json!({
        "previous_message_id": null,
        "user_message": first_message
    });

    // Send the first message to create a chat
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        if lines[i] == "event: message_complete" {
            // The data is on the next line, prefixed with "data: "
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse message_complete data");

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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        if lines[i] == "event: message_complete" {
            // The data is on the next line, prefixed with "data: "
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse message_complete data");

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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        active_user_messages[0]["full_text"].as_str().unwrap_or(""),
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
    let first_user_message = messages
        .iter()
        .find(|msg| msg["full_text"].as_str().unwrap_or("") == first_message)
        .expect("First user message not found in messages list");

    assert!(
        first_user_message["is_message_in_active_thread"]
            .as_bool()
            .unwrap_or(false),
        "First user message should be in the active thread"
    );

    // Verify that the second user message is not in the active thread
    let second_user_message = messages
        .iter()
        .find(|msg| msg["full_text"].as_str().unwrap_or("") == second_message)
        .expect("Second user message not found in messages list");

    assert!(
        !second_user_message["is_message_in_active_thread"]
            .as_bool()
            .unwrap_or(true),
        "Second user message should not be in the active thread"
    );
}
