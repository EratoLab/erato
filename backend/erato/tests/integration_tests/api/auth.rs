//! Authentication and user profile API tests.

use axum::Router;
use axum_test::TestServer;
use erato::models::user::get_or_create_user;
use erato::server::router::router;
use serde_json::Value;
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_app_state;
use crate::test_utils::{
    TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt, hermetic_app_config,
};

/// Test the user profile endpoint with JWT authentication.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
///
/// # Test Behavior
/// Verifies that authenticated users can retrieve their profile information.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_profile_endpoint(pool: Pool<Postgres>) {
    // Create app state with the database connection
    let app_state = test_app_state(hermetic_app_config(None, None), pool).await;

    // Create a test user
    let issuer = TEST_USER_ISSUER;
    let subject = TEST_USER_SUBJECT;
    let user = get_or_create_user(&app_state.db, issuer, subject, None)
        .await
        .expect("Failed to create user");

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    // Create the test server with our router
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    // Make a request to the profile endpoint with the mock JWT
    let response = server
        .get("/api/v1beta/me/profile")
        .with_bearer_token(TEST_JWT_TOKEN)
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

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_profile_preferences_update_and_delete(pool: Pool<Postgres>) {
    let app_state = test_app_state(hermetic_app_config(None, None), pool).await;

    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    let update_response = server
        .put("/api/v1beta/me/profile/preferences")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&serde_json::json!({
            "preference_nickname": "Max",
            "preference_job_title": "Engineer",
            "preference_assistant_custom_instructions": "Use concise answers.",
            "preference_assistant_additional_information": "Prefers examples."
        }))
        .await;

    update_response.assert_status_ok();
    let updated: Value = update_response.json();
    assert_eq!(updated["preference_nickname"].as_str().unwrap(), "Max");
    assert_eq!(
        updated["preference_job_title"].as_str().unwrap(),
        "Engineer"
    );
    assert_eq!(
        updated["preference_assistant_custom_instructions"]
            .as_str()
            .unwrap(),
        "Use concise answers."
    );
    assert_eq!(
        updated["preference_assistant_additional_information"]
            .as_str()
            .unwrap(),
        "Prefers examples."
    );

    let clear_response = server
        .put("/api/v1beta/me/profile/preferences")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&serde_json::json!({
            "preference_nickname": null
        }))
        .await;
    clear_response.assert_status_ok();

    let profile_response = server
        .get("/api/v1beta/me/profile")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    profile_response.assert_status_ok();
    let profile: Value = profile_response.json();

    assert_eq!(profile.get("preference_nickname"), None);
    assert_eq!(
        profile["preference_job_title"].as_str().unwrap(),
        "Engineer"
    );
}
