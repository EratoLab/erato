//! Assistant Hub API endpoint integration tests.

use axum::http;
use erato::config::{
    AssistantHubCategoryConfig, AssistantHubReviewerPermissionsConfig, AssistantHubReviewerRule,
};
use erato::policy::engine::PolicyEngine;
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_app_state;
use crate::test_utils::{
    JwtTokenBuilder, TEST_USER_ISSUER, TestRequestAuthExt, create_test_server, hermetic_app_config,
};

const REVIEWER_GROUP_ID: &str = "assistant-hub-reviewers";
const VIEWER_GROUP_ID: &str = "assistant-hub-viewers";
const STORE_CATEGORY_ID: &str = "productivity";

fn assistant_hub_app_config() -> erato::config::AppConfig {
    let mut app_config = hermetic_app_config(None, None);
    app_config.assistant_hub.enabled = true;
    app_config.assistant_hub.reviewers = AssistantHubReviewerPermissionsConfig {
        rules: [(
            "test-reviewers".to_string(),
            AssistantHubReviewerRule::AllowForGroupMembers {
                groups: vec![REVIEWER_GROUP_ID.to_string()],
            },
        )]
        .into(),
    };
    app_config.assistant_hub.categories.insert(
        STORE_CATEGORY_ID.to_string(),
        AssistantHubCategoryConfig {
            display_name: "Productivity".to_string(),
            icon: "Bot".to_string(),
        },
    );
    app_config
}

fn version_count(response: &Value) -> usize {
    response["versions"]
        .as_array()
        .expect("assistant hub response should contain versions array")
        .len()
}

/// Verifies that an assistant cannot submit two hub versions with the same
/// version number.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_assistant_hub_rejects_duplicate_version_number(pool: Pool<Postgres>) {
    let app_state = test_app_state(assistant_hub_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_subject = "assistant-hub-duplicate-version-owner";
    let owner_token = JwtTokenBuilder::new()
        .subject(owner_subject)
        .email("assistant-hub-duplicate-version-owner@example.com")
        .build();
    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        owner_subject,
        Some("assistant-hub-duplicate-version-owner@example.com"),
    )
    .await
    .expect("failed to create owner");

    let source_assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(owner.id.to_string()),
        "Duplicate Version Hub Assistant".to_string(),
        Some("Source draft description".to_string()),
        "You are a duplicate version assistant hub test fixture.".to_string(),
        None,
        None,
        Some("mock-llm".to_string()),
        false,
    )
    .await
    .expect("failed to create source assistant");

    let submission_body = json!({
        "long_description": "A reviewed assistant for duplicate version testing.",
        "category_ids": [STORE_CATEGORY_ID],
        "keywords": ["duplicate", "version"],
        "version_number": "1.0.0",
        "version_comment": "Initial submission",
        "creator_review_comment": "Ready for review",
        "audience_grants": []
    });

    let first_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/assistants/{}/versions",
            source_assistant.id
        ))
        .json(&submission_body)
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(first_response.status_code(), http::StatusCode::CREATED);

    let duplicate_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/assistants/{}/versions",
            source_assistant.id
        ))
        .json(&json!({
            "long_description": "A second submission using the same version number.",
            "category_ids": [STORE_CATEGORY_ID],
            "keywords": ["duplicate", "version"],
            "version_number": " 1.0.0 ",
            "version_comment": "Duplicate submission",
            "creator_review_comment": "Ready for review again",
            "audience_grants": []
        }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(
        duplicate_response.status_code(),
        http::StatusCode::BAD_REQUEST
    );

    let my_versions_response = server
        .get("/api/v1beta/assistant-hub/my/versions")
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(my_versions_response.status_code(), http::StatusCode::OK);
    let my_versions: Value = my_versions_response.json();
    assert_eq!(version_count(&my_versions), 1);
    assert_eq!(my_versions["versions"][0]["version_number"], "1.0.0");
}

/// Verifies that featuring is held on the hub assistant, not on an
/// individual immutable version, so the flag carries forward when a newer
/// version becomes current.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_assistant_hub_featured_status_carries_across_versions(pool: Pool<Postgres>) {
    let app_state = test_app_state(assistant_hub_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_subject = "assistant-hub-featured-owner";
    let reviewer_subject = "assistant-hub-featured-reviewer";

    let owner_token = JwtTokenBuilder::new()
        .subject(owner_subject)
        .email("assistant-hub-featured-owner@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject(reviewer_subject)
        .email("assistant-hub-featured-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        owner_subject,
        Some("assistant-hub-featured-owner@example.com"),
    )
    .await
    .expect("failed to create owner");

    let source_assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(owner.id.to_string()),
        "Featured Hub Assistant".to_string(),
        Some("Source draft description".to_string()),
        "You are a featured assistant hub test fixture.".to_string(),
        None,
        None,
        Some("mock-llm".to_string()),
        false,
    )
    .await
    .expect("failed to create source assistant");

    let first_submission_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/assistants/{}/versions",
            source_assistant.id
        ))
        .json(&json!({
            "long_description": "A first reviewed assistant hub version.",
            "category_ids": [STORE_CATEGORY_ID],
            "keywords": ["featured", "first"],
            "version_number": "1.0.0",
            "version_comment": "Initial hub publication",
            "creator_review_comment": "Ready for review",
            "audience_grants": []
        }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(
        first_submission_response.status_code(),
        http::StatusCode::CREATED
    );
    let first_submission: Value = first_submission_response.json();
    let first_version_id = first_submission["version"]["version_id"]
        .as_str()
        .expect("submitted version should include version_id")
        .to_string();

    let first_review_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/versions/{first_version_id}/review"
        ))
        .json(&json!({
            "accepted": true,
            "reviewer_review_comment": "Accepted for publication"
        }))
        .with_bearer_token(&reviewer_token)
        .await;
    assert_eq!(first_review_response.status_code(), http::StatusCode::OK);

    let first_publish_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{first_version_id}/published"
        ))
        .json(&json!({ "is_published": true }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(first_publish_response.status_code(), http::StatusCode::OK);

    let first_current_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{first_version_id}/current"
        ))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(first_current_response.status_code(), http::StatusCode::OK);

    let featured_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{first_version_id}/featured"
        ))
        .json(&json!({ "featured": true }))
        .with_bearer_token(&reviewer_token)
        .await;
    assert_eq!(featured_response.status_code(), http::StatusCode::OK);
    let featured: Value = featured_response.json();
    assert_eq!(featured["version"]["featured"], true);

    let second_submission_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/assistants/{}/versions",
            source_assistant.id
        ))
        .json(&json!({
            "long_description": "A second reviewed assistant hub version.",
            "category_ids": [STORE_CATEGORY_ID],
            "keywords": ["featured", "second"],
            "version_number": "1.1.0",
            "version_comment": "Follow-up hub publication",
            "creator_review_comment": "Ready for second review",
            "audience_grants": []
        }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(
        second_submission_response.status_code(),
        http::StatusCode::CREATED
    );
    let second_submission: Value = second_submission_response.json();
    let second_version_id = second_submission["version"]["version_id"]
        .as_str()
        .expect("submitted version should include version_id")
        .to_string();

    let second_review_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/versions/{second_version_id}/review"
        ))
        .json(&json!({
            "accepted": true,
            "reviewer_review_comment": "Accepted for publication"
        }))
        .with_bearer_token(&reviewer_token)
        .await;
    assert_eq!(second_review_response.status_code(), http::StatusCode::OK);

    let second_publish_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{second_version_id}/published"
        ))
        .json(&json!({ "is_published": true }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(second_publish_response.status_code(), http::StatusCode::OK);

    let second_current_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{second_version_id}/current"
        ))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(second_current_response.status_code(), http::StatusCode::OK);
    let second_current: Value = second_current_response.json();
    assert_eq!(second_current["version"]["featured"], true);

    let owner_listing_response = server
        .get("/api/v1beta/assistant-hub/assistants")
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(owner_listing_response.status_code(), http::StatusCode::OK);
    let listed: Value = owner_listing_response.json();
    let versions = listed["versions"]
        .as_array()
        .expect("assistant hub response should contain versions array");
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0]["version_id"], second_version_id);
    assert_eq!(versions[0]["version_number"], "1.1.0");
    assert_eq!(versions[0]["featured"], true);
}

/// Verifies the full Assistant Hub publication flow:
/// submit immutable version with an audience grant, accept it, publish it,
/// mark it as current, and then list it as an audience viewer.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_published_current_assistant_hub_version_is_listed_for_audience_viewer(
    pool: Pool<Postgres>,
) {
    let app_state = test_app_state(assistant_hub_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_subject = "assistant-hub-owner";
    let viewer_subject = "assistant-hub-viewer";
    let reviewer_subject = "assistant-hub-reviewer";

    let owner_token = JwtTokenBuilder::new()
        .subject(owner_subject)
        .email("assistant-hub-owner@example.com")
        .build();
    let viewer_token = JwtTokenBuilder::new()
        .subject(viewer_subject)
        .email("assistant-hub-viewer@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject(reviewer_subject)
        .email("assistant-hub-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        owner_subject,
        Some("assistant-hub-owner@example.com"),
    )
    .await
    .expect("failed to create owner");
    let viewer = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        viewer_subject,
        Some("assistant-hub-viewer@example.com"),
    )
    .await
    .expect("failed to create viewer");

    let source_assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(owner.id.to_string()),
        "Published Hub Assistant".to_string(),
        Some("Source draft description".to_string()),
        "You are a published assistant hub test fixture.".to_string(),
        None,
        None,
        Some("mock-llm".to_string()),
        false,
    )
    .await
    .expect("failed to create source assistant");

    let submission_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/assistants/{}/versions",
            source_assistant.id
        ))
        .json(&json!({
            "long_description": "A reviewed assistant for the integration test hub.",
            "category_ids": [STORE_CATEGORY_ID],
            "keywords": ["published", "hub"],
            "version_number": "1.0.0",
            "version_comment": "Initial hub publication",
            "creator_review_comment": "Ready for review",
            "audience_grants": [{
                "subject_type": "user",
                "subject_id_type": "id",
                "subject_id": viewer.id.to_string(),
                "role": "viewer"
            }]
        }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(submission_response.status_code(), http::StatusCode::CREATED);
    let submitted: Value = submission_response.json();
    let version_id = submitted["version"]["version_id"]
        .as_str()
        .expect("submitted version should include version_id")
        .to_string();
    let version_assistant_id = submitted["version"]["assistant_id"]
        .as_str()
        .expect("submitted version should include assistant_id")
        .to_string();

    let viewer_before_review_response = server
        .get("/api/v1beta/assistant-hub/assistants")
        .with_bearer_token(&viewer_token)
        .await;
    assert_eq!(
        viewer_before_review_response.status_code(),
        http::StatusCode::OK
    );
    assert_eq!(version_count(&viewer_before_review_response.json()), 0);

    let review_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/review"
        ))
        .json(&json!({
            "accepted": true,
            "reviewer_review_comment": "Accepted for publication"
        }))
        .with_bearer_token(&reviewer_token)
        .await;
    assert_eq!(review_response.status_code(), http::StatusCode::OK);

    let publish_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/published"
        ))
        .json(&json!({ "is_published": true }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(publish_response.status_code(), http::StatusCode::OK);
    let published: Value = publish_response.json();
    assert_eq!(published["version"]["is_published"], true);
    assert_eq!(published["version"]["is_current_published_version"], false);

    let viewer_after_publish_response = server
        .get("/api/v1beta/assistant-hub/assistants")
        .with_bearer_token(&viewer_token)
        .await;
    assert_eq!(
        viewer_after_publish_response.status_code(),
        http::StatusCode::OK
    );
    assert_eq!(
        version_count(&viewer_after_publish_response.json()),
        0,
        "published versions are intentionally hidden until marked current"
    );

    let current_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/current"
        ))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(current_response.status_code(), http::StatusCode::OK);
    let current: Value = current_response.json();
    assert_eq!(current["version"]["is_published"], true);
    assert_eq!(current["version"]["is_current_published_version"], true);

    let viewer_after_current_response = server
        .get("/api/v1beta/assistant-hub/assistants")
        .with_bearer_token(&viewer_token)
        .await;
    assert_eq!(
        viewer_after_current_response.status_code(),
        http::StatusCode::OK
    );
    let listed: Value = viewer_after_current_response.json();
    let versions = listed["versions"]
        .as_array()
        .expect("assistant hub response should contain versions array");
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0]["version_id"], version_id);
    assert_eq!(versions[0]["assistant_id"], version_assistant_id);
    assert_eq!(versions[0]["assistant"]["name"], "Published Hub Assistant");
    assert_eq!(versions[0]["status"], "review_accepted");
    assert_eq!(versions[0]["is_published"], true);
    assert_eq!(versions[0]["is_current_published_version"], true);
}

/// Verifies that Assistant Hub publication also works for an organization
/// group audience, matching the Entra group-based sharing model.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_published_current_assistant_hub_version_is_listed_for_group_audience_viewer(
    pool: Pool<Postgres>,
) {
    let app_state = test_app_state(assistant_hub_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_subject = "assistant-hub-group-owner";
    let group_viewer_subject = "assistant-hub-group-viewer";
    let reviewer_subject = "assistant-hub-group-reviewer";

    let owner_token = JwtTokenBuilder::new()
        .subject(owner_subject)
        .email("assistant-hub-group-owner@example.com")
        .build();
    let group_viewer_token = JwtTokenBuilder::new()
        .subject(group_viewer_subject)
        .email("assistant-hub-group-viewer@example.com")
        .groups(vec![VIEWER_GROUP_ID.to_string()])
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject(reviewer_subject)
        .email("assistant-hub-group-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        owner_subject,
        Some("assistant-hub-group-owner@example.com"),
    )
    .await
    .expect("failed to create owner");

    let source_assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(owner.id.to_string()),
        "Group Published Hub Assistant".to_string(),
        Some("Source draft description".to_string()),
        "You are a group-published assistant hub test fixture.".to_string(),
        None,
        None,
        Some("mock-llm".to_string()),
        false,
    )
    .await
    .expect("failed to create source assistant");

    let submission_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/assistants/{}/versions",
            source_assistant.id
        ))
        .json(&json!({
            "long_description": "A reviewed assistant for a group audience.",
            "category_ids": [STORE_CATEGORY_ID],
            "keywords": ["published", "group"],
            "version_number": "1.0.0",
            "version_comment": "Initial group publication",
            "creator_review_comment": "Ready for group review",
            "audience_grants": [{
                "subject_type": "organization_group",
                "subject_id_type": "organization_group_id",
                "subject_id": VIEWER_GROUP_ID,
                "role": "viewer"
            }]
        }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(submission_response.status_code(), http::StatusCode::CREATED);
    let submitted: Value = submission_response.json();
    let version_id = submitted["version"]["version_id"]
        .as_str()
        .expect("submitted version should include version_id")
        .to_string();
    let hub_assistant_id = submitted["version"]["hub_assistant_id"]
        .as_str()
        .expect("submitted version should include hub_assistant_id")
        .to_string();

    let review_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/review"
        ))
        .json(&json!({
            "accepted": true,
            "reviewer_review_comment": "Accepted for group publication"
        }))
        .with_bearer_token(&reviewer_token)
        .await;
    assert_eq!(review_response.status_code(), http::StatusCode::OK);

    let publish_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/published"
        ))
        .json(&json!({ "is_published": true }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(publish_response.status_code(), http::StatusCode::OK);

    let current_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/current"
        ))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(current_response.status_code(), http::StatusCode::OK);

    let group_viewer_response = server
        .get("/api/v1beta/assistant-hub/assistants")
        .with_bearer_token(&group_viewer_token)
        .await;
    assert_eq!(group_viewer_response.status_code(), http::StatusCode::OK);
    let listed: Value = group_viewer_response.json();
    let versions = listed["versions"]
        .as_array()
        .expect("assistant hub response should contain versions array");
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0]["version_id"], version_id);
    assert_eq!(versions[0]["hub_assistant_id"], hub_assistant_id);
    assert_eq!(
        versions[0]["assistant"]["name"],
        "Group Published Hub Assistant"
    );
    assert_eq!(versions[0]["status"], "review_accepted");
    assert_eq!(versions[0]["is_published"], true);
    assert_eq!(versions[0]["is_current_published_version"], true);
}
