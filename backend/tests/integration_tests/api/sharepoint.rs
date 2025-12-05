//! Sharepoint/OneDrive integration tests.
//!
//! These tests are disabled by default as they require a valid MS Graph access token.
//! To run them:
//! 1. Set the `SHAREPOINT_TEST_ACCESS_TOKEN` environment variable to a valid MS Graph
//!    access token with Files.Read permissions
//! 2. Run with: `cargo test --test integration_tests sharepoint -- --ignored`
//!
//! Note: The tests use the standard test JWT for backend authentication, and the
//! MS Graph access token is passed via the X-Forwarded-Access-Token header (as would
//! happen in production with oauth2-proxy).

use axum::Router;
use axum::http;
use axum::http::StatusCode;
use axum_test::TestServer;
use erato::server::router::router;
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_app_state_with_sharepoint;
use crate::test_utils::{TEST_JWT_TOKEN, TestRequestAuthExt, setup_mock_llm_server};

/// Header name for the forwarded access token (typically set by oauth2-proxy).
const X_FORWARDED_ACCESS_TOKEN: &str = "X-Forwarded-Access-Token";

/// Get the MS Graph access token from environment variable.
fn get_ms_graph_access_token() -> Option<String> {
    std::env::var("SHAREPOINT_TEST_ACCESS_TOKEN").ok()
}

/// Extension trait to add MS Graph access token header for Sharepoint tests.
trait SharepointTestExt {
    /// Add the X-Forwarded-Access-Token header with the MS Graph access token.
    fn with_ms_graph_token(self, token: &str) -> Self;
}

impl SharepointTestExt for axum_test::TestRequest {
    fn with_ms_graph_token(self, token: &str) -> Self {
        self.add_header(X_FORWARDED_ACCESS_TOKEN, token)
    }
}

/// Test listing all drives accessible to the user.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sharepoint-integration`
/// - `requires-external-token`
///
/// # Test Behavior
/// This test requires a valid MS Graph access token with Files.Read permissions.
/// It verifies that the all-drives endpoint returns a list of drives.
// #[ignore = "Requires SHAREPOINT_TEST_ACCESS_TOKEN environment variable with valid MS Graph token"]
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_sharepoint_all_drives(pool: Pool<Postgres>) {
    let ms_graph_token = match get_ms_graph_access_token() {
        Some(token) => token,
        None => {
            println!("Skipping test: SHAREPOINT_TEST_ACCESS_TOKEN not set");
            return;
        }
    };

    // Set up the test environment with Sharepoint enabled
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state_with_sharepoint(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Request all drives
    // - Use TEST_JWT_TOKEN for backend authentication
    // - Use ms_graph_token via X-Forwarded-Access-Token for MS Graph API
    let response = server
        .get("/api/v1beta/integrations/sharepoint/all-drives")
        .with_bearer_token(TEST_JWT_TOKEN)
        .with_ms_graph_token(&ms_graph_token)
        .await;

    // Verify the response
    response.assert_status_ok();
    let response_json: Value = response.json();

    // Check that we got a drives array
    let drives = response_json["drives"]
        .as_array()
        .expect("Expected drives array in response");

    println!("Found {} drives", drives.len());
    for drive in drives {
        println!(
            "  Drive: {} ({})",
            drive["name"].as_str().unwrap_or("unnamed"),
            drive["id"].as_str().unwrap_or("no-id")
        );
    }

    // Should have at least one drive (the user's OneDrive)
    assert!(!drives.is_empty(), "Expected at least one drive");
}

/// Test the full Sharepoint file flow:
/// 1. Create a chat
/// 2. List drives
/// 3. Find a .docx file
/// 4. Link the file to the chat
/// 5. Send a message with the file
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sharepoint-integration`
/// - `requires-external-token`
/// - `e2e-flow`
// #[ignore = "Requires SHAREPOINT_TEST_ACCESS_TOKEN environment variable with valid MS Graph token"]
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_sharepoint_full_flow(pool: Pool<Postgres>) {
    let ms_graph_token = match get_ms_graph_access_token() {
        Some(token) => token,
        None => {
            println!("Skipping test: SHAREPOINT_TEST_ACCESS_TOKEN not set");
            return;
        }
    };

    // Set up the test environment with Sharepoint enabled
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state_with_sharepoint(app_config, pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Step 1: Create a new chat
    let create_chat_response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .with_ms_graph_token(&ms_graph_token)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({}))
        .await;

    create_chat_response.assert_status_ok();
    let chat_json: Value = create_chat_response.json();
    let chat_id = chat_json["chat_id"]
        .as_str()
        .expect("Expected chat_id in response");
    println!("Created chat: {}", chat_id);

    // Step 2: List all drives
    let drives_response = server
        .get("/api/v1beta/integrations/sharepoint/all-drives")
        .with_bearer_token(TEST_JWT_TOKEN)
        .with_ms_graph_token(&ms_graph_token)
        .await;

    drives_response.assert_status_ok();
    let drives_json: Value = drives_response.json();
    let drives = drives_json["drives"]
        .as_array()
        .expect("Expected drives array");

    assert!(
        !drives.is_empty(),
        "Expected at least one drive to be accessible. \
        Make sure the MS Graph token has Files.Read permissions."
    );

    let first_drive_id = drives[0]["id"].as_str().expect("Expected drive id");
    println!("Using drive: {}", first_drive_id);

    // Step 3: Browse the drive to find a .docx file
    println!(
        "Step 3: Searching for a .docx file in drive {}",
        first_drive_id
    );
    let mut found_file: Option<(String, String, String)> = None; // (item_id, filename, drive_id)

    // Try to find a .docx file by browsing the drive root
    println!("Fetching drive root items...");
    let root_response = server
        .get(&format!(
            "/api/v1beta/integrations/sharepoint/drives/{}",
            first_drive_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .with_ms_graph_token(&ms_graph_token)
        .await;

    println!(
        "Drive root response status: {}",
        root_response.status_code()
    );

    if root_response.status_code() == StatusCode::OK {
        let root_json: Value = root_response.json();
        if let Some(items) = root_json["items"].as_array() {
            println!("Found {} items at drive root", items.len());
            for item in items {
                let name = item["name"].as_str().unwrap_or("<unnamed>");
                let is_folder = item["is_folder"].as_bool().unwrap_or(true);
                let item_id = item["id"].as_str().unwrap_or("<no-id>");

                println!(
                    "  Root item: {} (id={}, is_folder={})",
                    name, item_id, is_folder
                );

                if !is_folder && name.ends_with(".docx") {
                    println!("  -> Found .docx file at root: {}", name);
                    found_file = Some((
                        item_id.to_string(),
                        name.to_string(),
                        first_drive_id.to_string(),
                    ));
                    break;
                }
            }
        } else {
            println!("No items array in root response");
        }
    } else {
        println!(
            "Failed to fetch drive root: {}",
            root_response.status_code()
        );
    }

    // If no .docx found at root, check first level folders
    if found_file.is_none() {
        println!("No .docx found at root, checking first-level folders...");

        let root_response = server
            .get(&format!(
                "/api/v1beta/integrations/sharepoint/drives/{}",
                first_drive_id
            ))
            .with_bearer_token(TEST_JWT_TOKEN)
            .with_ms_graph_token(&ms_graph_token)
            .await;

        if root_response.status_code() == StatusCode::OK {
            let root_json: Value = root_response.json();
            if let Some(items) = root_json["items"].as_array() {
                let folders: Vec<_> = items
                    .iter()
                    .filter(|item| item["is_folder"].as_bool().unwrap_or(false))
                    .collect();
                println!("Found {} folders to search", folders.len());

                for item in items {
                    let is_folder = item["is_folder"].as_bool().unwrap_or(false);
                    if is_folder {
                        let folder_name = item["name"].as_str().unwrap_or("<unnamed>");
                        let folder_id = item["id"].as_str().expect("Expected folder id");
                        println!("Searching folder: {} (id={})", folder_name, folder_id);

                        // List folder children
                        let children_response = server
                            .get(&format!(
                                "/api/v1beta/integrations/sharepoint/drives/{}/items/{}/children",
                                first_drive_id, folder_id
                            ))
                            .with_bearer_token(TEST_JWT_TOKEN)
                            .with_ms_graph_token(&ms_graph_token)
                            .await;

                        println!(
                            "  Folder children response status: {}",
                            children_response.status_code()
                        );

                        if children_response.status_code() == StatusCode::OK {
                            let children_json: Value = children_response.json();
                            if let Some(children) = children_json["items"].as_array() {
                                println!(
                                    "  Found {} items in folder {}",
                                    children.len(),
                                    folder_name
                                );
                                for child in children {
                                    let name = child["name"].as_str().unwrap_or("<unnamed>");
                                    let is_child_folder =
                                        child["is_folder"].as_bool().unwrap_or(true);
                                    let child_id = child["id"].as_str().unwrap_or("<no-id>");

                                    println!(
                                        "    Item: {} (id={}, is_folder={})",
                                        name, child_id, is_child_folder
                                    );

                                    if !is_child_folder && name.ends_with(".docx") {
                                        println!("    -> Found .docx file: {}", name);
                                        found_file = Some((
                                            child_id.to_string(),
                                            name.to_string(),
                                            first_drive_id.to_string(),
                                        ));
                                        break;
                                    }
                                }
                            } else {
                                println!("  No items array in folder response");
                            }
                        } else {
                            println!(
                                "  Failed to fetch folder children: {}",
                                children_response.status_code()
                            );
                        }

                        if found_file.is_some() {
                            break;
                        }
                    }
                }
            }
        }
    }

    if found_file.is_none() {
        println!("No .docx file found after searching root and first-level folders");
    }

    let (item_id, filename, drive_id) = found_file.expect(
        "No .docx file found in drive. \
        Please ensure there is at least one .docx file in your OneDrive \
        (either at root or in a first-level folder) for this test to work.",
    );

    println!("Found file: {} ({})", filename, item_id);

    // Step 4: Link the file to the chat using the unified /me/files/link endpoint
    let link_response = server
        .post("/api/v1beta/me/files/link")
        .with_bearer_token(TEST_JWT_TOKEN)
        .with_ms_graph_token(&ms_graph_token)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "source": "sharepoint",
            "chat_id": chat_id,
            "provider_metadata": {
                "drive_id": drive_id,
                "item_id": item_id
            }
        }))
        .await;

    link_response.assert_status_ok();
    let link_json: Value = link_response.json();
    let files = link_json["files"]
        .as_array()
        .expect("Expected files array in response");
    assert!(!files.is_empty(), "Expected at least one file in response");
    let file_id = files[0]["id"]
        .as_str()
        .expect("Expected id in file response");
    println!("Linked file with ID: {}", file_id);

    // Step 5: Send a message with the file attached
    let message_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .with_ms_graph_token(&ms_graph_token)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "existing_chat_id": chat_id,
            "user_message": "Please summarize this document",
            "input_files_ids": [file_id]
        }))
        .await;

    message_response.assert_status_ok();

    // Parse SSE response
    let response_text = message_response.text();
    let lines: Vec<&str> = response_text.lines().collect();

    // Check for expected events
    let has_event = |event_type: &str| {
        lines
            .windows(2)
            .any(|w| w[0] == format!("event: {}", event_type) && w[1].starts_with("data: "))
    };

    assert!(
        has_event("user_message_saved"),
        "Missing user_message_saved event"
    );

    // The assistant should respond (using mock server)
    assert!(
        has_event("assistant_message_completed"),
        "Missing assistant_message_completed event - this indirectly verifies file content extraction succeeded"
    );

    println!("Full Sharepoint flow completed successfully!");
}
