#![allow(clippy::manual_strip)]

use axum::http::StatusCode;
use axum::{http, Router};
use axum_test::multipart::MultipartForm;
use axum_test::multipart::Part;
use axum_test::{TestResponse, TestServer};
use ctor::ctor;
use erato::config::{AppConfig, FileStorageProviderConfig, StorageProviderSpecificConfigMerged};
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use erato::services::file_storage::FileStorage;
use erato::state::AppState;
use sea_orm::prelude::Uuid;
use serde_json::{json, Value};
use sqlx::postgres::Postgres;
use sqlx::Pool;
use std::collections::HashMap;
use test_log::test;

// Struct to represent SSE events
struct Event {
    event_type: String,
    data: String,
    id: Option<String>,
    retry: Option<u32>,
}

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
    let mut file_storage_providers = HashMap::new();

    let provider = FileStorage::from_config(&FileStorageProviderConfig {
        display_name: None,
        provider_kind: "s3".to_string(),
        config: StorageProviderSpecificConfigMerged {
            endpoint: Some("http://localhost:9000".to_string()),
            bucket: Some("erato-storage".to_string()),
            region: Some("us-east-1".to_string()),
            access_key_id: Some("erato-app-user".to_string()),
            secret_access_key: Some("erato-app-password".to_string()),
            ..StorageProviderSpecificConfigMerged::default()
        },
    })
    .unwrap();
    file_storage_providers.insert("local_minio".to_owned(), provider);

    AppState {
        db,
        policy: AppState::build_policy().unwrap(),
        genai_client: AppState::build_genai_client(app_config.chat_provider).unwrap(),
        default_file_storage_provider: None,
        file_storage_providers,
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
            .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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

    // Archive one of the chats
    let chat_to_archive = &chat_ids[0];
    let archive_response = server
        .post(&format!("/api/v1beta/chats/{}/archive", chat_to_archive))
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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

    // Now query with include_archived=true, should return both chats
    let response = server
        .get("/api/v1beta/me/recent_chats?include_archived=true")
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

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_file_upload_endpoint(pool: Pool<Postgres>) {
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

    // First, create a chat by sending a message
    let message_request = json!({
        "previous_message_id": null,
        "user_message": "Test message to create a chat for file upload"
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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_edit_message_stream(pool: Pool<Postgres>) {
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

    // First, create an initial chat with a message
    let first_message = "What is the capital of France?";
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
    let assistant_message_id = messages
        .iter()
        .find_map(|msg| {
            if let Ok(json) = serde_json::from_str::<Value>(&msg.data) {
                if json["message_type"] == "message_complete" {
                    return Some(json["message_id"].as_str().unwrap().to_string());
                }
            }
            None
        })
        .expect("No message_complete event found");

    // Now edit the message with a new user message
    let edited_message = "What is the capital of Spain?";
    let response = server
        .post("/api/v1beta/me/messages/editstream")
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "message_id": assistant_message_id,
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
                json["message_type"] == "message_complete"
            } else {
                false
            }
        })
        .expect("No message_complete event found");

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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        active_user_message["full_text"].as_str().unwrap(),
        edited_message
    );

    // Verify the original message is marked as inactive
    let original_message = messages
        .iter()
        .find(|msg| msg["full_text"].as_str().unwrap() == first_message)
        .expect("Original message not found");
    assert!(!original_message["is_message_in_active_thread"]
        .as_bool()
        .unwrap());

    // Verify the new assistant message has the original message as a sibling
    let new_assistant_message = active_messages
        .iter()
        .find(|msg| msg["role"].as_str().unwrap() == "assistant")
        .expect("No active assistant message found");
    assert_eq!(
        new_assistant_message["sibling_message_id"]
            .as_str()
            .unwrap(),
        assistant_message_id
    );
}

// Helper function to collect SSE messages from a TestResponse
async fn collect_sse_messages(response: TestResponse) -> Vec<Event> {
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

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_create_chat_file_upload_message_flow(pool: Pool<Postgres>) {
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

    // Step 1: Create a new chat without initial message
    let create_chat_response = server
        .post("/api/v1beta/me/chats")
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&message_request)
        .await;

    message_response.assert_status_ok();

    // Collect and analyze SSE messages
    let messages = collect_sse_messages(message_response).await;

    // Verify key events in the message stream

    // We should NOT see a chat_created event (since we used an existing chat)
    let has_chat_created = messages.iter().any(|e| e.event_type == "chat_created");
    assert!(!has_chat_created, "Should not have a chat_created event");

    // We should see a user_message_saved event
    let has_user_message_saved = messages.iter().any(|e| {
        if e.event_type == "user_message_saved" {
            if let Ok(json) = serde_json::from_str::<Value>(&e.data) {
                return json["message_type"] == "user_message_saved";
            }
        }
        false
    });
    assert!(has_user_message_saved, "Missing user_message_saved event");

    // We should see a message_complete event for the assistant's response
    let has_message_complete = messages.iter().any(|e| {
        if e.event_type == "message_complete" {
            if let Ok(json) = serde_json::from_str::<Value>(&e.data) {
                return json["message_type"] == "message_complete";
            }
        }
        false
    });
    assert!(has_message_complete, "Missing message_complete event");

    // Step 4: Verify we can retrieve the chat messages with the API
    let messages_response = server
        .get(&format!("/api/v1beta/chats/{}/messages", chat_id))
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_get_file_by_id(pool: Pool<Postgres>) {
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

    // First, create a chat to attach the file to
    let create_chat_response = server
        .post("/api/v1beta/me/chats")
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
        .await;

    // Should return 400 Bad Request
    assert_eq!(get_invalid_response.status_code(), StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn test_token_usage_estimate_with_file(pool: Pool<Postgres>) {
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

    // First, create a chat by sending a message
    let message_request = json!({
        "previous_message_id": null,
        "user_message": "Test message to create a chat for token usage test"
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

    // Get the message ID from the response to use as previous_message_id
    let messages = collect_sse_messages(response).await;
    let user_message_id = messages
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

    // Get the chat ID from the response
    let chat_id = messages
        .iter()
        .find_map(|msg| {
            if let Ok(json) = serde_json::from_str::<Value>(&msg.data) {
                if json["message_type"] == "chat_created" {
                    return Some(json["chat_id"].as_str().unwrap().to_string());
                }
            }
            None
        })
        .expect("No chat_created event found");

    // Create a test file
    let file_content = "This is a test file for token usage estimation.\nIt contains some text that should be tokenized by the service.\nThe goal is to test that the token usage endpoint correctly counts tokens for files.";

    // Convert to owned Vec<u8> to satisfy 'static lifetime requirement
    let file_bytes = file_content.as_bytes().to_vec();

    // Create a multipart form with the file
    let multipart_form = MultipartForm::new().add_part(
        "file",
        Part::bytes(file_bytes)
            .file_name("test_token_count.txt")
            .mime_type("text/plain"),
    );

    // Upload the file
    let response = server
        .post(&format!("/api/v1beta/me/files?chat_id={}", chat_id))
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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
        .add_header(http::header::AUTHORIZATION, format!("Bearer {}", mock_jwt))
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

    // Max tokens should be a reasonable value (the test expects 10000 from the implementation)
    let max_tokens = token_usage["stats"]["max_tokens"].as_u64().unwrap();
    assert_eq!(max_tokens, 10000, "Max tokens should be 10000");

    // Remaining tokens should be max_tokens - total_tokens
    let remaining_tokens = token_usage["stats"]["remaining_tokens"].as_u64().unwrap();
    assert_eq!(
        remaining_tokens,
        max_tokens - total_tokens,
        "Remaining tokens should be max_tokens - total_tokens"
    );
}
