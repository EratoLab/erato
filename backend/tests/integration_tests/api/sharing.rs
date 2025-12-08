//! Share grants and assistant sharing integration tests.

use axum::Router;
use axum::http;
use axum_test::TestServer;
use erato::policy::engine::PolicyEngine;
use erato::server::router::router;
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_app_state;
use crate::test_utils::{
    TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt, hermetic_app_config,
};

/// Test the full sharing flow:
/// 1. User A creates an assistant with files
/// 2. User A shares assistant with User B (viewer role)
/// 3. User B can see assistant in their list
/// 4. User B can get assistant details
/// 5. User B can create a chat based on the assistant
/// 6. User B can access files attached to the assistant
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies the complete sharing workflow from creation to usage.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_full_assistant_sharing_flow(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(hermetic_app_config(None, None), pool).await;

    // Create User A (owner)
    let user_a_subject = "user-a-subject";
    let user_a = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_a_subject,
        None,
    )
    .await
    .expect("Failed to create user A");

    // Create User B (viewer)
    let user_b_subject = TEST_USER_SUBJECT; // Will use default JWT token
    let user_b = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_b_subject,
        None,
    )
    .await
    .expect("Failed to create user B");

    // Step 1: User A creates an assistant with a file
    let assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "Shared Assistant".to_string(),
        Some("This will be shared".to_string()),
        "You are a shared assistant".to_string(),
        None,
        None,
    )
    .await
    .expect("Failed to create assistant");

    // Create a file and attach it to the assistant
    let file = erato::models::assistant::create_standalone_file_upload(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "test_file.txt".to_string(),
        "minio".to_string(),
        "test_path.txt".to_string(),
    )
    .await
    .expect("Failed to create file");

    erato::models::assistant::add_file_to_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        assistant.id,
        file.id,
    )
    .await
    .expect("Failed to add file to assistant");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Step 2: User A shares the assistant with User B
    // We need to use User A's credentials to create the share
    // For this test, we'll use the model directly since creating a custom JWT is complex
    let share_grant = erato::models::share_grant::create_share_grant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "assistant".to_string(),
        assistant.id.to_string(),
        "user".to_string(),
        "id".to_string(),
        user_b.id.to_string(),
        "viewer".to_string(),
    )
    .await
    .expect("Failed to create share grant");

    println!("Created share grant: {:?}", share_grant.id);

    // Step 3: User B can see the assistant in their list
    let list_response = server
        .get("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(list_response.status_code(), http::StatusCode::OK);
    let assistants_list: Value = list_response.json();
    let assistants_array = assistants_list.as_array().expect("Should be an array");

    // User B should see the shared assistant
    assert!(
        assistants_array
            .iter()
            .any(|a| a["id"] == assistant.id.to_string()),
        "User B should see the shared assistant in their list"
    );

    // Step 4: User B can get assistant details
    let get_response = server
        .get(&format!("/api/v1beta/assistants/{}", assistant.id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(get_response.status_code(), http::StatusCode::OK);
    let assistant_details: Value = get_response.json();
    assert_eq!(assistant_details["id"], assistant.id.to_string());
    assert_eq!(assistant_details["name"], "Shared Assistant");

    // User B should see the files
    let files_array = assistant_details["files"]
        .as_array()
        .expect("Should have files array");
    assert_eq!(files_array.len(), 1, "Should have one file");
    assert_eq!(files_array[0]["id"], file.id.to_string());

    // Step 5: User B can create a chat based on the assistant
    let create_chat_request = json!({
        "assistant_id": assistant.id.to_string()
    });

    let create_chat_response = server
        .post("/api/v1beta/me/chats")
        .json(&create_chat_request)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(create_chat_response.status_code(), http::StatusCode::OK);
    let chat_response: Value = create_chat_response.json();
    let chat_id = chat_response["chat_id"]
        .as_str()
        .expect("Should have chat_id");
    println!("Created chat: {}", chat_id);

    // Step 6: User B can access files attached to the assistant
    let file_response = server
        .get(&format!("/api/v1beta/files/{}", file.id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(file_response.status_code(), http::StatusCode::OK);
    let file_details: Value = file_response.json();
    assert_eq!(file_details["id"], file.id.to_string());
    assert_eq!(file_details["filename"], "test_file.txt");
}

/// Test that User B cannot update an assistant they only have viewer access to
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_viewer_cannot_update_assistant(pool: Pool<Postgres>) {
    let app_state = test_app_state(hermetic_app_config(None, None), pool).await;

    // Create User A (owner)
    let user_a_subject = "user-a-update-test";
    let user_a = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_a_subject,
        None,
    )
    .await
    .expect("Failed to create user A");

    // Create User B (viewer)
    let user_b_subject = TEST_USER_SUBJECT;
    let user_b = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_b_subject,
        None,
    )
    .await
    .expect("Failed to create user B");

    // User A creates an assistant
    let assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "Original Name".to_string(),
        None,
        "Original prompt".to_string(),
        None,
        None,
    )
    .await
    .expect("Failed to create assistant");

    // User A shares with User B
    erato::models::share_grant::create_share_grant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "assistant".to_string(),
        assistant.id.to_string(),
        "user".to_string(),
        "id".to_string(),
        user_b.id.to_string(),
        "viewer".to_string(),
    )
    .await
    .expect("Failed to create share grant");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // User B tries to update the assistant
    let update_request = json!({
        "name": "Hacked Name"
    });

    let response = server
        .put(&format!("/api/v1beta/assistants/{}", assistant.id))
        .json(&update_request)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    // Should be forbidden - viewers can only read, not update
    assert_eq!(response.status_code(), http::StatusCode::NOT_FOUND);
}

/// Test listing share grants for a resource
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_list_share_grants(pool: Pool<Postgres>) {
    let app_state = test_app_state(hermetic_app_config(None, None), pool).await;

    // Create User A (owner) - using TEST_USER_SUBJECT so we can use JWT
    let user_a_subject = TEST_USER_SUBJECT;
    let user_a = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_a_subject,
        None,
    )
    .await
    .expect("Failed to create user A");

    // Create User B (viewer)
    let user_b_subject = "user-b-list-test";
    let user_b = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_b_subject,
        None,
    )
    .await
    .expect("Failed to create user B");

    // User A creates an assistant
    let assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "Test Assistant".to_string(),
        None,
        "Test prompt".to_string(),
        None,
        None,
    )
    .await
    .expect("Failed to create assistant");

    // Create a share grant
    let grant = erato::models::share_grant::create_share_grant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "assistant".to_string(),
        assistant.id.to_string(),
        "user".to_string(),
        "id".to_string(),
        user_b.id.to_string(),
        "viewer".to_string(),
    )
    .await
    .expect("Failed to create share grant");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // List share grants for the assistant
    let response = server
        .get(&format!(
            "/api/v1beta/share-grants?resource_type=assistant&resource_id={}",
            assistant.id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(response.status_code(), http::StatusCode::OK);
    let grants_response: Value = response.json();
    let grants_array = grants_response["grants"]
        .as_array()
        .expect("Should have grants array");

    assert_eq!(grants_array.len(), 1, "Should have one grant");
    assert_eq!(grants_array[0]["id"], grant.id.to_string());
    assert_eq!(grants_array[0]["subject_id"], user_b.id.to_string());
    assert_eq!(grants_array[0]["role"], "viewer");
}

/// Test deleting a share grant
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delete_share_grant(pool: Pool<Postgres>) {
    let app_state = test_app_state(hermetic_app_config(None, None), pool).await;

    // Create User A (owner) - using TEST_USER_SUBJECT so we can use JWT
    let user_a_subject = TEST_USER_SUBJECT;
    let user_a = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_a_subject,
        None,
    )
    .await
    .expect("Failed to create user A");

    // Create User B (viewer)
    let user_b_subject = "user-b-delete-test";
    let user_b = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_b_subject,
        None,
    )
    .await
    .expect("Failed to create user B");

    // User A creates an assistant
    let assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "Test Assistant".to_string(),
        None,
        "Test prompt".to_string(),
        None,
        None,
    )
    .await
    .expect("Failed to create assistant");

    // Create a share grant
    let grant = erato::models::share_grant::create_share_grant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "assistant".to_string(),
        assistant.id.to_string(),
        "user".to_string(),
        "id".to_string(),
        user_b.id.to_string(),
        "viewer".to_string(),
    )
    .await
    .expect("Failed to create share grant");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Delete the share grant
    let response = server
        .delete(&format!("/api/v1beta/share-grants/{}", grant.id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(response.status_code(), http::StatusCode::NO_CONTENT);

    // Verify the grant was deleted by trying to list grants
    let list_response = server
        .get(&format!(
            "/api/v1beta/share-grants?resource_type=assistant&resource_id={}",
            assistant.id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    let grants_response: Value = list_response.json();
    let grants_array = grants_response["grants"]
        .as_array()
        .expect("Should have grants array");
    assert_eq!(grants_array.len(), 0, "Grant should be deleted");
}
