//! Message feedback API tests.

use axum::Router;
use axum_test::TestServer;
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use serde_json::json;
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_app_state;
use crate::test_utils::{
    JwtTokenBuilder, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt,
    setup_mock_llm_server,
};

/// Helper function to create a chat with a message and return the chat_id and assistant message_id.
async fn create_chat_with_message(server: &TestServer) -> (String, String) {
    // Create a chat with a message
    let request_body = json!({
        "user_message": "Test message for feedback"
    });

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&request_body)
        .await;

    response.assert_status_ok();

    let body = response.as_bytes();
    let body_str = String::from_utf8_lossy(body);
    let lines: Vec<&str> = body_str.lines().collect();

    let mut chat_id = String::new();
    let mut message_id = String::new();

    for i in 0..lines.len() - 1 {
        if lines[i] == "event: chat_created" {
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: serde_json::Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse chat_created data");
                chat_id = data_json["chat_id"]
                    .as_str()
                    .expect("Expected chat_id to be a string")
                    .to_string();
            }
        } else if lines[i] == "event: assistant_message_completed" {
            let data_line = lines[i + 1];
            if data_line.starts_with("data: ") {
                let data_json: serde_json::Value = serde_json::from_str(&data_line[6..])
                    .expect("Failed to parse assistant_message_completed data");
                message_id = data_json["message_id"]
                    .as_str()
                    .expect("Expected message_id to be a string")
                    .to_string();
            }
        }
    }

    assert!(!chat_id.is_empty(), "No chat_id found in response");
    assert!(
        !message_id.is_empty(),
        "No assistant message_id found in response"
    );

    (chat_id, message_id)
}

/// Test submitting positive feedback for a message.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that users can submit positive feedback with a comment for a message.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_submit_positive_feedback(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Create a message to give feedback on
    let (_chat_id, message_id) = create_chat_with_message(&server).await;

    // Submit positive feedback
    let feedback_body = json!({
        "sentiment": "positive",
        "comment": "This answer was very helpful!"
    });

    let response = server
        .put(&format!("/api/v1beta/messages/{}/feedback", message_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&feedback_body)
        .await;

    response.assert_status_ok();

    let feedback: serde_json::Value = response.json();
    assert_eq!(feedback["sentiment"], "positive");
    assert_eq!(feedback["comment"], "This answer was very helpful!");
    assert!(feedback["id"].is_string());
    assert!(feedback["created_at"].is_string());
    assert!(feedback["updated_at"].is_string());
}

/// Test submitting negative feedback without a comment.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that users can submit negative feedback without providing a comment.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_submit_negative_feedback_no_comment(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let (_chat_id, message_id) = create_chat_with_message(&server).await;

    // Submit negative feedback without comment
    let feedback_body = json!({
        "sentiment": "negative"
    });

    let response = server
        .put(&format!("/api/v1beta/messages/{}/feedback", message_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&feedback_body)
        .await;

    response.assert_status_ok();

    let feedback: serde_json::Value = response.json();
    assert_eq!(feedback["sentiment"], "negative");
    assert!(feedback["comment"].is_null());
}

/// Test updating existing feedback.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that submitting feedback twice updates the existing feedback record.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_update_feedback(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let (_chat_id, message_id) = create_chat_with_message(&server).await;

    // Submit initial positive feedback
    let feedback_body = json!({
        "sentiment": "positive",
        "comment": "Initial comment"
    });

    let response = server
        .put(&format!("/api/v1beta/messages/{}/feedback", message_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&feedback_body)
        .await;

    response.assert_status_ok();
    let first_feedback: serde_json::Value = response.json();
    let feedback_id = first_feedback["id"].as_str().unwrap();

    // Update to negative feedback with new comment
    let updated_feedback_body = json!({
        "sentiment": "negative",
        "comment": "Changed my mind, not helpful"
    });

    let response = server
        .put(&format!("/api/v1beta/messages/{}/feedback", message_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&updated_feedback_body)
        .await;

    response.assert_status_ok();
    let updated_feedback: serde_json::Value = response.json();

    // Verify the feedback was updated (same ID)
    assert_eq!(updated_feedback["id"].as_str().unwrap(), feedback_id);
    assert_eq!(updated_feedback["sentiment"], "negative");
    assert_eq!(updated_feedback["comment"], "Changed my mind, not helpful");
}

/// Test that feedback is included when retrieving messages.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that the /chats/{chat_id}/messages endpoint includes feedback data.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_feedback_included_in_messages_list(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let (chat_id, message_id) = create_chat_with_message(&server).await;

    // Submit feedback
    let feedback_body = json!({
        "sentiment": "positive",
        "comment": "Great answer!"
    });

    server
        .put(&format!("/api/v1beta/messages/{}/feedback", message_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&feedback_body)
        .await
        .assert_status_ok();

    // Retrieve messages and check feedback is included
    let response = server
        .get(&format!("/api/v1beta/chats/{}/messages", chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    response.assert_status_ok();
    let messages_response: serde_json::Value = response.json();
    let messages = messages_response["messages"].as_array().unwrap();

    // Find the message with our feedback
    let message_with_feedback = messages
        .iter()
        .find(|m| m["id"] == message_id)
        .expect("Message not found");

    assert!(message_with_feedback["feedback"].is_object());
    assert_eq!(message_with_feedback["feedback"]["sentiment"], "positive");
    assert_eq!(
        message_with_feedback["feedback"]["comment"],
        "Great answer!"
    );
}

/// Test that users cannot submit feedback for messages in chats they don't own.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `authorization`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that authorization prevents users from submitting feedback for other users' messages.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_feedback_authorization(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    // Create two users
    let user1_subject = TEST_USER_SUBJECT;
    let _user1 = get_or_create_user(&app_state.db, TEST_USER_ISSUER, user1_subject, None)
        .await
        .expect("Failed to create user 1");

    let user2_subject = "user-2-subject";
    let _user2 = get_or_create_user(&app_state.db, TEST_USER_ISSUER, user2_subject, None)
        .await
        .expect("Failed to create user 2");

    // Build JWT token for user 2
    let user2_token = JwtTokenBuilder::new()
        .issuer(TEST_USER_ISSUER)
        .subject(user2_subject)
        .build();

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // User 1 creates a message
    let (_chat_id, message_id) = create_chat_with_message(&server).await;

    // User 2 tries to submit feedback for user 1's message
    let feedback_body = json!({
        "sentiment": "positive",
        "comment": "Trying to submit feedback"
    });

    let response = server
        .put(&format!("/api/v1beta/messages/{}/feedback", message_id))
        .with_bearer_token(&user2_token) // Different user
        .json(&feedback_body)
        .await;

    // Should be forbidden
    response.assert_status(axum::http::StatusCode::FORBIDDEN);
}

/// Test that submitting feedback for non-existent message returns 404.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that attempting to submit feedback for a non-existent message returns 404.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_feedback_for_nonexistent_message(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Try to submit feedback for a non-existent message
    let fake_message_id = "00000000-0000-0000-0000-000000000000";
    let feedback_body = json!({
        "sentiment": "positive",
        "comment": "This won't work"
    });

    let response = server
        .put(&format!(
            "/api/v1beta/messages/{}/feedback",
            fake_message_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&feedback_body)
        .await;

    response.assert_status(axum::http::StatusCode::NOT_FOUND);
}

/// Test that invalid sentiment values are rejected.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Verifies that only 'positive' and 'negative' sentiment values are accepted.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_invalid_sentiment_rejected(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);

    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let (_chat_id, message_id) = create_chat_with_message(&server).await;

    // Try to submit feedback with invalid sentiment
    let feedback_body = json!({
        "sentiment": "neutral", // Invalid value
        "comment": "This should fail"
    });

    let response = server
        .put(&format!("/api/v1beta/messages/{}/feedback", message_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&feedback_body)
        .await;

    // Should be unprocessable entity (422) due to deserialization failure
    response.assert_status(axum::http::StatusCode::UNPROCESSABLE_ENTITY);
}
