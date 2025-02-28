use axum::{http, Router};
use axum_test::TestServer;
use ctor::ctor;
use erato::config::AppConfig;
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use erato::state::AppState;
use serde_json::Value;
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
