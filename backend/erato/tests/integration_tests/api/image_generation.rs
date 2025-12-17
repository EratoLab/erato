//! Image generation API tests.

use axum::Router;
use axum_test::TestServer;
use erato::config::AppConfig;
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use mocktail::prelude::*;
use mocktail::server::MockServerConfig;
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::net::{IpAddr, Ipv4Addr};

use crate::test_app_state;
use crate::test_utils::{TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt};

/// Configuration for a mock image generation server.
pub struct MockImageGenConfig {
    /// The base64-encoded image to return
    pub image_base64: String,
    /// The provider ID to use in the config
    pub provider_id: String,
    /// The model name to use in the config
    pub model_name: String,
}

impl Default for MockImageGenConfig {
    fn default() -> Self {
        // Read the test image file
        let test_image_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/integration_tests/test_files/image_1.png"
        );
        let test_image_bytes = std::fs::read(test_image_path)
            .expect("Failed to read test image - make sure image_1.png exists");
        use base64::{Engine as _, engine::general_purpose};
        let image_base64 = general_purpose::STANDARD.encode(&test_image_bytes);

        Self {
            image_base64,
            provider_id: "image-gen".to_string(),
            model_name: "dall-e-3".to_string(),
        }
    }
}

/// Sets up a mock image generation server and returns an AppConfig configured to use it.
pub async fn setup_mock_image_gen_server(
    config: Option<MockImageGenConfig>,
) -> (AppConfig, MockServer) {
    let config = config.unwrap_or_default();

    // Clone the base64 string for the closure
    let image_base64 = config.image_base64.clone();

    // Set up the mock image generation server
    let mut mocks = MockSet::new();
    mocks.mock(move |when, then| {
        when.post().path("/v1/images/generations");

        // Mock response matching OpenAI's image generation API
        let response_body = json!({
            "created": 1234567890u64,
            "data": [
                {
                    "b64_json": image_base64,
                    "revised_prompt": "A test image"
                }
            ]
        });

        then.status(axum::http::StatusCode::OK)
            .headers([("Content-Type", "application/json")])
            .body(Body::json(&response_body));
    });

    // Start the mock server
    let mockserver_config = MockServerConfig {
        listen_addr: IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
        ..Default::default()
    };
    let server = MockServer::new_http("image-gen-mock")
        .with_config(mockserver_config)
        .with_mocks(mocks);

    server.start().await.expect("Failed to start mock server");

    // Get the mock server URL
    let mock_url = server.url("/v1/");
    let mock_url_str = mock_url.to_string();

    // Create app config using the hermetic pattern
    let mut app_config_builder = AppConfig::config_schema_builder(None, false).unwrap();

    app_config_builder = app_config_builder
        // Chat provider config with image generation enabled
        .set_override(
            format!(
                "chat_providers.providers.{}.provider_kind",
                config.provider_id
            ),
            "openai",
        )
        .unwrap()
        .set_override(
            format!("chat_providers.providers.{}.model_name", config.provider_id),
            config.model_name,
        )
        .unwrap()
        .set_override(
            format!("chat_providers.providers.{}.base_url", config.provider_id),
            mock_url_str,
        )
        .unwrap()
        .set_override(
            format!("chat_providers.providers.{}.api_key", config.provider_id),
            "test-api-key",
        )
        .unwrap()
        .set_override(
            format!(
                "chat_providers.providers.{}.model_settings.generate_images",
                config.provider_id
            ),
            true,
        )
        .unwrap()
        .set_override(
            "chat_providers.priority_order",
            vec![config.provider_id.as_str()],
        )
        .unwrap()
        // Add model permissions to allow the image-gen provider for all users
        .set_override(
            format!(
                "model_permissions.rules.allow-{}.rule_type",
                config.provider_id
            ),
            "allow-all",
        )
        .unwrap()
        .set_override(
            format!(
                "model_permissions.rules.allow-{}.chat_provider_ids",
                config.provider_id
            ),
            vec![config.provider_id.as_str()],
        )
        .unwrap()
        // File storage provider (minio) - same as other tests
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

    let app_config = app_config_builder
        .build()
        .unwrap()
        .try_deserialize()
        .unwrap();

    (app_config, server)
}

/// Test image generation with mocked OpenAI endpoint.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that when a chat provider has `generate_images` enabled, it generates
/// an image instead of text and stores it as a file_upload.
///
/// Note: This test requires minio to be running on localhost:9000.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_image_generation(pool: Pool<Postgres>) {
    // Set up mock image generation server
    let (app_config, _mock_server) = setup_mock_image_gen_server(None).await;

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
        .with_state(app_state.clone());

    // Create the test server with our router
    let test_server =
        TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Prepare the request body with a prompt for image generation
    let request_body = json!({
        "user_message": "Generate a beautiful sunset over mountains"
    });

    // Make a request to the message submit endpoint
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

    // Verify we received the expected events
    assert!(
        has_event_type("chat_created"),
        "Should have chat_created event"
    );
    assert!(
        has_event_type("user_message_saved"),
        "Should have user_message_saved event"
    );
    assert!(
        has_event_type("assistant_message_started"),
        "Should have assistant_message_started event"
    );
    assert!(
        has_event_type("assistant_message_completed"),
        "Should have assistant_message_completed event"
    );

    // Extract the assistant_message_completed event
    let completed_event = events
        .iter()
        .find(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                json["message_type"] == "assistant_message_completed"
            } else {
                false
            }
        })
        .expect("Should have assistant_message_completed event");

    let completed_data = completed_event.split("data:").nth(1).unwrap_or("").trim();
    let completed_json: Value = serde_json::from_str(completed_data).expect("Failed to parse JSON");

    println!(
        "Completed event JSON: {}",
        serde_json::to_string_pretty(&completed_json).unwrap()
    );

    // Verify the content contains an ImageFilePointer
    let content = completed_json["content"]
        .as_array()
        .expect("Content should be an array");
    assert!(!content.is_empty(), "Content should not be empty");

    let image_content = &content[0];
    assert_eq!(
        image_content["content_type"], "image_file_pointer",
        "Content should be an image_file_pointer"
    );

    // Verify the ImageFilePointer has both file_upload_id and download_url
    assert!(
        image_content["file_upload_id"].is_string(),
        "ImageFilePointer should have file_upload_id"
    );
    assert!(
        image_content["download_url"].is_string(),
        "ImageFilePointer should have download_url"
    );

    let download_url = image_content["download_url"]
        .as_str()
        .expect("download_url should be a string");
    assert!(!download_url.is_empty(), "download_url should not be empty");

    println!(
        "Image generated successfully with download_url: {}",
        download_url
    );
}
