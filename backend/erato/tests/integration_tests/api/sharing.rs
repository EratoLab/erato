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
    JwtTokenBuilder, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt,
    extract_chat_id, has_event_type, hermetic_app_config, parse_sse_events, setup_mock_llm_server,
};

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_chat_share_link_enable_disable_flow(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    app_config.chat_sharing.enabled = true;
    let app_state = test_app_state(app_config, pool).await;

    let owner_subject = "chat-share-owner";
    let recipient_subject = "chat-share-recipient";

    let _owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        owner_subject,
        None,
    )
    .await
    .expect("Failed to create owner user");

    let _recipient = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        recipient_subject,
        None,
    )
    .await
    .expect("Failed to create recipient user");

    let owner_token = JwtTokenBuilder::new()
        .subject(owner_subject)
        .email("owner@example.com")
        .name("owner")
        .build();
    let recipient_token = JwtTokenBuilder::new()
        .subject(recipient_subject)
        .email("recipient@example.com")
        .name("recipient")
        .build();

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let submit_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(&owner_token)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "previous_message_id": null,
            "user_message": "Please respond with a short hello",
        }))
        .await;
    submit_response.assert_status_ok();

    let events = parse_sse_events(&submit_response);
    let chat_id = extract_chat_id(&events).expect("Expected chat_created event");

    let before_share_response = server
        .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
        .with_bearer_token(&recipient_token)
        .await;
    assert_eq!(
        before_share_response.status_code(),
        http::StatusCode::INTERNAL_SERVER_ERROR
    );

    let get_link_before_enable = server
        .get(&format!(
            "/api/v1beta/share-links?resource_type=chat&resource_id={chat_id}"
        ))
        .with_bearer_token(&owner_token)
        .await;
    get_link_before_enable.assert_status_ok();
    let before_enable_json: Value = get_link_before_enable.json();
    assert!(before_enable_json["share_link"].is_null());

    let enable_response = server
        .put("/api/v1beta/share-links")
        .with_bearer_token(&owner_token)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "resource_type": "chat",
            "resource_id": chat_id,
            "enabled": true,
        }))
        .await;
    enable_response.assert_status_ok();
    let enabled_json: Value = enable_response.json();
    let share_link_id = enabled_json["share_link"]["id"]
        .as_str()
        .expect("Missing share link id")
        .to_string();
    assert_eq!(enabled_json["share_link"]["enabled"], true);

    let resolve_response = server
        .get(&format!("/api/v1beta/share-links/{share_link_id}"))
        .with_bearer_token(&recipient_token)
        .await;
    resolve_response.assert_status_ok();
    let resolve_json: Value = resolve_response.json();
    assert_eq!(resolve_json["share_link"]["resource_type"], "chat");
    assert_eq!(resolve_json["share_link"]["resource_id"], chat_id);

    let shared_messages_response = server
        .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
        .with_bearer_token(&recipient_token)
        .await;
    shared_messages_response.assert_status_ok();
    let shared_messages_json: Value = shared_messages_response.json();
    assert!(
        shared_messages_json["messages"]
            .as_array()
            .expect("messages should be array")
            .len()
            >= 2
    );

    let disable_response = server
        .put("/api/v1beta/share-links")
        .with_bearer_token(&owner_token)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "resource_type": "chat",
            "resource_id": chat_id,
            "enabled": false,
        }))
        .await;
    disable_response.assert_status_ok();
    let disabled_json: Value = disable_response.json();
    assert_eq!(disabled_json["share_link"]["id"], share_link_id);
    assert_eq!(disabled_json["share_link"]["enabled"], false);

    let get_link_after_disable = server
        .get(&format!(
            "/api/v1beta/share-links?resource_type=chat&resource_id={chat_id}"
        ))
        .with_bearer_token(&owner_token)
        .await;
    get_link_after_disable.assert_status_ok();
    let after_disable_json: Value = get_link_after_disable.json();
    assert_eq!(after_disable_json["share_link"]["id"], share_link_id);
    assert_eq!(after_disable_json["share_link"]["enabled"], false);

    let resolve_after_disable = server
        .get(&format!("/api/v1beta/share-links/{share_link_id}"))
        .with_bearer_token(&recipient_token)
        .await;
    assert_eq!(
        resolve_after_disable.status_code(),
        http::StatusCode::NOT_FOUND
    );
}

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
        None,
        false,
    )
    .await
    .expect("Failed to create assistant");

    // Create a file and attach it to the assistant
    let file = erato::models::assistant::create_standalone_file_upload(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "test_file.txt".to_string(),
        "seaweedfs".to_string(),
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

/// Test that archiving a shared assistant removes it from the recipient's overview
/// but does not break access to an already-created chat.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_archived_shared_assistant_hidden_but_existing_chat_accessible(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let user_a_subject = "user-a-archive-shared-assistant";
    let user_a = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_a_subject,
        None,
    )
    .await
    .expect("Failed to create user A");

    let user_b_subject = TEST_USER_SUBJECT;
    let user_b = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_b_subject,
        None,
    )
    .await
    .expect("Failed to create user B");

    let assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "Shared Assistant To Archive".to_string(),
        Some("Shared assistant that will be archived".to_string()),
        "You are a shared assistant".to_string(),
        None,
        None,
        None,
        false,
    )
    .await
    .expect("Failed to create assistant");

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
        .with_state(app_state.clone());
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let create_chat_response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "assistant_id": assistant.id.to_string() }))
        .await;

    assert_eq!(create_chat_response.status_code(), http::StatusCode::OK);
    let create_chat_json: Value = create_chat_response.json();
    let chat_id = create_chat_json["chat_id"]
        .as_str()
        .expect("Expected chat_id")
        .to_string();

    let message_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": chat_id,
            "user_message": "Please answer before the assistant is archived"
        }))
        .await;

    assert_eq!(message_response.status_code(), http::StatusCode::OK);
    let events = parse_sse_events(&message_response);
    assert!(
        has_event_type(&events, "assistant_message_completed"),
        "Expected a completed assistant response before archiving",
    );

    erato::models::assistant::archive_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        assistant.id,
    )
    .await
    .expect("Failed to archive assistant");

    let shared_assistants_response = server
        .get("/api/v1beta/assistants?sharing_relation=shared_with_user")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(
        shared_assistants_response.status_code(),
        http::StatusCode::OK
    );
    let shared_assistants_json: Value = shared_assistants_response.json();
    let shared_assistants = shared_assistants_json
        .as_array()
        .expect("Expected assistants array");
    assert!(
        !shared_assistants
            .iter()
            .any(|item| item["id"] == assistant.id.to_string()),
        "Archived shared assistant should not remain visible in the recipient overview",
    );

    let messages_response = server
        .get(&format!("/api/v1beta/chats/{}/messages", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    assert_eq!(messages_response.status_code(), http::StatusCode::OK);
    let messages_json: Value = messages_response.json();
    let messages = messages_json["messages"]
        .as_array()
        .expect("Expected messages array for archived shared assistant chat");
    assert!(
        messages.len() >= 2,
        "Existing chat should still be readable after the shared assistant is archived",
    );
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
        None,
        false,
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
        None,
        false,
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
        None,
        false,
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

/// Test sharing an assistant with a different user using organization_user_id
///
/// This test verifies that when an assistant is shared with a user using their
/// organization_user_id (like Azure AD's "oid" claim) instead of their internal
/// user UUID, the sharing mechanism works correctly.
///
/// This is important for enterprise scenarios where admins may want to share
/// resources using organization identifiers rather than internal database IDs.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_share_assistant_with_organization_user_id(pool: Pool<Postgres>) {
    // Set up mock LLM server for end-to-end chat testing
    let (app_config, _mock_server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    // Create User A (owner)
    let user_a_subject = "user-a-org-share-test";
    let user_a = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_a_subject,
        None,
    )
    .await
    .expect("Failed to create user A");

    // Create User B (who will receive the share)
    // Use TEST_USER_SUBJECT so we can make API calls with TEST_JWT_TOKEN
    let user_b_subject = TEST_USER_SUBJECT;
    let user_b = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        user_b_subject,
        None,
    )
    .await
    .expect("Failed to create user B");

    // Simulate User B having an organization_user_id (like Azure AD's "oid" claim)
    // In production, this would come from the JWT token's "oid" claim
    let user_b_org_id = "org-user-id-12345";

    // Create a custom JWT token for User B that includes the organization_user_id
    let user_b_jwt_token = JwtTokenBuilder::new()
        .issuer(TEST_USER_ISSUER)
        .subject(user_b_subject)
        .email("user-b@example.com")
        .name("User B")
        .organization_user_id(user_b_org_id)
        .build();

    // User A creates an assistant
    let assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "Shared with Org User ID".to_string(),
        Some("Testing organization_user_id sharing".to_string()),
        "Test prompt".to_string(),
        None,
        None,
        None,
        false,
    )
    .await
    .expect("Failed to create assistant");

    // User A shares the assistant with User B using organization_user_id
    let _share_grant_org = erato::models::share_grant::create_share_grant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "assistant".to_string(),
        assistant.id.to_string(),
        "user".to_string(),
        "organization_user_id".to_string(), // Using org ID type instead of "id"
        user_b_org_id.to_string(),          // Using org user ID, not user_b.id
        "viewer".to_string(),
    )
    .await
    .expect("Failed to create share grant with organization_user_id");

    // Also create a share grant with regular ID for API testing
    // (since TEST_JWT_TOKEN doesn't include the organization_user_id claim)
    let _share_grant_regular = erato::models::share_grant::create_share_grant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_a.id.to_string()),
        "assistant".to_string(),
        assistant.id.to_string(),
        "user".to_string(),
        "id".to_string(),      // Using regular ID type
        user_b.id.to_string(), // Using regular user ID
        "viewer".to_string(),
    )
    .await
    .expect("Failed to create share grant with regular ID");

    // Test 1: Without organization_user_id, only the regular ID share grant should be found
    let shared_resources_without_org_id =
        erato::models::share_grant::get_resources_shared_with_subject_and_groups(
            &app_state.db,
            &user_b.id.to_string(), // User's UUID
            None,                   // No organization_user_id provided
            "assistant",
            &[], // No organization groups
        )
        .await
        .expect("Failed to get shared resources");

    assert_eq!(
        shared_resources_without_org_id.len(),
        1,
        "Without organization_user_id, User B should see the assistant via the regular ID share grant"
    );

    // Test 2: With organization_user_id, BOTH share grants SHOULD be found
    let shared_resources_with_org_id =
        erato::models::share_grant::get_resources_shared_with_subject_and_groups(
            &app_state.db,
            &user_b.id.to_string(), // User's UUID
            Some(user_b_org_id),    // Organization user ID provided
            "assistant",
            &[], // No organization groups
        )
        .await
        .expect("Failed to get shared resources with org ID");

    assert_eq!(
        shared_resources_with_org_id.len(),
        2,
        "With organization_user_id, User B should see the assistant via BOTH share grants"
    );
    // All grants should point to the same assistant
    assert!(
        shared_resources_with_org_id
            .iter()
            .all(|g| g.resource_id == assistant.id.to_string()),
        "All shared resources should be the same assistant"
    );

    // Test 3: Using Subject without organization_user_id should still work due to regular ID share grant
    let result_without_org_id = erato::models::assistant::get_assistant_by_id(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(user_b.id.to_string()),
        assistant.id,
    )
    .await;

    assert!(
        result_without_org_id.is_ok(),
        "Without organization_user_id in Subject, User B should still access via regular ID share grant"
    );

    // Test 4: Using Subject WITH organization_user_id should successfully access the assistant
    let result_with_org_id = erato::models::assistant::get_assistant_by_id(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::UserWithOrganizationInfo {
            id: user_b.id.to_string(),
            organization_user_id: Some(user_b_org_id.to_string()),
            organization_group_ids: vec![],
        },
        assistant.id,
    )
    .await;

    assert!(
        result_with_org_id.is_ok(),
        "With organization_user_id in Subject, User B should be able to access the assistant: {:?}",
        result_with_org_id.err()
    );

    let accessed_assistant = result_with_org_id.unwrap();
    assert_eq!(
        accessed_assistant.id, assistant.id,
        "The accessed assistant should match the shared one"
    );

    // Test 5: Verify that User B can actually start a chat with the shared assistant
    // This tests the full end-to-end flow including message streaming

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a chat with the shared assistant using User B's token with org ID
    let create_chat_request = json!({
        "assistant_id": assistant.id.to_string()
    });

    let create_chat_response = server
        .post("/api/v1beta/me/chats")
        .json(&create_chat_request)
        .with_bearer_token(&user_b_jwt_token)
        .await;

    assert_eq!(
        create_chat_response.status_code(),
        http::StatusCode::OK,
        "User B should be able to create a chat with the shared assistant"
    );

    let chat_response: Value = create_chat_response.json();
    let chat_id = chat_response["chat_id"]
        .as_str()
        .expect("Should have chat_id");

    println!("Created chat: {}", chat_id);

    // Send a message to the chat using User B's token with org ID
    let message_request = json!({
        "existing_chat_id": chat_id,
        "user_message": "Hello, this is a test message"
    });

    let message_response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(&user_b_jwt_token)
        .json(&message_request)
        .await;

    if message_response.status_code() != http::StatusCode::OK {
        let error_body = message_response.text();
        eprintln!("Message response error: {}", error_body);
    }

    assert_eq!(
        message_response.status_code(),
        http::StatusCode::OK,
        "User B should be able to send messages in the chat with the shared assistant"
    );

    // Parse the SSE events to verify we got a proper response
    let events = parse_sse_events(&message_response);
    assert!(
        has_event_type(&events, "chat_created") || has_event_type(&events, "text_delta"),
        "Should receive chat events from the LLM"
    );
}
