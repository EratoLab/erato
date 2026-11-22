//! Assistant Hub API endpoint integration tests.

use axum::http;
use axum_test::{TestResponse, TestServer};
use erato::config::{
    AssistantHubActionPermissionsConfig, AssistantHubActionRole, AssistantHubCategoryConfig,
    AssistantHubReviewerPermissionsConfig, AssistantHubReviewerRule,
};
use erato::models::share_grant::{
    ORGANIZATION_SUBJECT_ID, ORGANIZATION_SUBJECT_ID_TYPE, ORGANIZATION_SUBJECT_TYPE,
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

async fn set_published(
    server: &TestServer,
    token: &str,
    version_id: &str,
    is_published: bool,
) -> TestResponse {
    server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/published"
        ))
        .json(&json!({ "is_published": is_published }))
        .with_bearer_token(token)
        .await
}

async fn make_current(server: &TestServer, token: &str, version_id: &str) -> TestResponse {
    server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/current"
        ))
        .with_bearer_token(token)
        .await
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_assistant_hub_publication_permissions(pool: Pool<Postgres>) {
    use AssistantHubActionRole::{Editors, Reviewers};
    use http::StatusCode;

    const MY_VERSIONS: &str = "/api/v1beta/assistant-hub/my/versions";
    const REVIEW_VERSIONS: &str = "/api/v1beta/assistant-hub/review/versions";
    const EDITORS_GROUP: &str = "source-assistant-editors";

    let mut state = test_app_state(assistant_hub_app_config(), pool).await;
    let default_server = create_test_server(state.clone());
    let owner = JwtTokenBuilder::new().subject("publication-owner").build();
    let editor = JwtTokenBuilder::new()
        .subject("publication-editor")
        .groups(vec![EDITORS_GROUP.to_string()])
        .build();
    let reviewer = JwtTokenBuilder::new()
        .subject("publication-reviewer")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();
    let other = JwtTokenBuilder::new().subject("publication-viewer").build();

    let source = default_server
        .post("/api/v1beta/assistants")
        .json(&json!({
            "name": "Publication permissions fixture",
            "prompt": "Help out.",
            "share_grants": [{
                "subject_type": "organization_group",
                "subject_id_type": "organization_group_id",
                "subject_id": EDITORS_GROUP,
                "role": "editor"
            }, {
                "subject_type": "organization",
                "subject_id_type": "organization_id",
                "subject_id": "__organization__",
                "role": "viewer"
            }]
        }))
        .with_bearer_token(&owner)
        .await;
    source.assert_status(StatusCode::CREATED);
    let source: Value = source.json();
    let source_id = source["id"].as_str().expect("created assistant ID");

    let mut version_ids = Vec::new();
    for version_number in ["1.0.0", "2.0.0", "3.0.0"] {
        let submission = default_server
            .post(&format!(
                "/api/v1beta/assistant-hub/assistants/{source_id}/versions"
            ))
            .json(&json!({
                "long_description": "Fixture for reviewing and publishing three versions",
                "category_ids": [],
                "keywords": [],
                "version_number": version_number
            }))
            .with_bearer_token(&owner)
            .await;
        submission.assert_status(StatusCode::CREATED);
        let submission: Value = submission.json();
        version_ids.push(
            submission["version"]["version_id"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    let [first, second, pending] = version_ids.as_slice() else {
        unreachable!()
    };
    let pending_review = format!("/api/v1beta/assistant-hub/versions/{pending}/review");
    for version_id in [first, second] {
        default_server
            .post(&format!(
                "/api/v1beta/assistant-hub/versions/{version_id}/review"
            ))
            .json(&json!({ "accepted": true }))
            .with_bearer_token(&reviewer)
            .await
            .assert_status_ok();
    }

    for (token, is_owner, count) in [(&owner, true, 3), (&editor, false, 2)] {
        let list = default_server
            .get(MY_VERSIONS)
            .with_bearer_token(token)
            .await;
        list.assert_status_ok();
        let list: Value = list.json();
        assert_eq!(version_count(&list), count);
        let versions = list["versions"].as_array().unwrap();
        let first = versions
            .iter()
            .find(|version| version["version_id"] == *first)
            .unwrap();
        assert_eq!(first["is_submission_owner"], is_owner);
        assert_eq!(first["can_publish"], true);
        assert_eq!(first["can_unpublish"], false);
        assert_eq!(first["can_make_current"], false);
    }
    for token in [&editor, &other] {
        default_server
            .get(REVIEW_VERSIONS)
            .with_bearer_token(token)
            .await
            .assert_status(StatusCode::FORBIDDEN);
        default_server
            .post(&pending_review)
            .json(&json!({ "accepted": false }))
            .with_bearer_token(token)
            .await
            .assert_status(StatusCode::FORBIDDEN);
    }
    let other_versions: Value = default_server
        .get(MY_VERSIONS)
        .with_bearer_token(&other)
        .await
        .json();
    assert_eq!(version_count(&other_versions), 0);
    set_published(&default_server, &other, first, true)
        .await
        .assert_status(StatusCode::FORBIDDEN);
    set_published(&default_server, &owner, first, true)
        .await
        .assert_status_ok();
    set_published(&default_server, &editor, second, true)
        .await
        .assert_status_ok();
    make_current(&default_server, &other, first)
        .await
        .assert_status(StatusCode::FORBIDDEN);
    set_published(&default_server, &other, second, false)
        .await
        .assert_status(StatusCode::FORBIDDEN);
    make_current(&default_server, &editor, first)
        .await
        .assert_status_ok();
    make_current(&default_server, &reviewer, second)
        .await
        .assert_status_ok();

    state.config.assistant_hub.action_permissions = AssistantHubActionPermissionsConfig {
        publish: vec![Reviewers],
        unpublish: vec![Reviewers],
        make_current: vec![Reviewers],
    };
    let reviewer_only = create_test_server(state.clone());
    for token in [&owner, &editor] {
        set_published(&reviewer_only, token, first, false)
            .await
            .assert_status(StatusCode::FORBIDDEN);
        make_current(&reviewer_only, token, first)
            .await
            .assert_status(StatusCode::FORBIDDEN);
    }
    make_current(&reviewer_only, &reviewer, first)
        .await
        .assert_status_ok();
    set_published(&reviewer_only, &reviewer, first, false)
        .await
        .assert_status_ok();
    for token in [&owner, &editor] {
        set_published(&reviewer_only, token, first, true)
            .await
            .assert_status(StatusCode::FORBIDDEN);
    }
    set_published(&reviewer_only, &reviewer, first, true)
        .await
        .assert_status_ok();
    set_published(&reviewer_only, &reviewer, first, false)
        .await
        .assert_status_ok();

    state.config.assistant_hub.action_permissions = AssistantHubActionPermissionsConfig {
        publish: vec![Editors],
        unpublish: vec![Reviewers],
        make_current: vec![],
    };
    let mixed = create_test_server(state);
    mixed
        .get(REVIEW_VERSIONS)
        .with_bearer_token(&reviewer)
        .await
        .assert_status_ok();
    mixed
        .post(&pending_review)
        .json(&json!({ "accepted": true }))
        .with_bearer_token(&reviewer)
        .await
        .assert_status_ok();
    set_published(&mixed, &reviewer, first, true)
        .await
        .assert_status(StatusCode::FORBIDDEN);
    let publication = set_published(&mixed, &editor, first, true).await;
    publication.assert_status_ok();
    let publication: Value = publication.json();
    assert_eq!(publication["version"]["is_current_published_version"], true);
    assert_eq!(publication["version"]["can_unpublish"], false);
    make_current(&mixed, &editor, second)
        .await
        .assert_status(StatusCode::FORBIDDEN);
    make_current(&mixed, &reviewer, second)
        .await
        .assert_status(StatusCode::FORBIDDEN);
    let repeated_publication = set_published(&mixed, &editor, second, true).await;
    repeated_publication.assert_status_ok();
    let repeated_publication: Value = repeated_publication.json();
    assert_eq!(
        repeated_publication["version"]["is_current_published_version"],
        false
    );
    set_published(&mixed, &editor, first, false)
        .await
        .assert_status(StatusCode::FORBIDDEN);
    set_published(&mixed, &reviewer, first, false)
        .await
        .assert_status_ok();
}

fn assert_average_score(value: &Value, expected: f64) {
    let actual = value
        .as_f64()
        .expect("review_average_score should be a number");
    assert!(
        (actual - expected).abs() < f64::EPSILON,
        "expected average score {expected}, got {actual}"
    );
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
        Some("## Welcome to this version".into()),
        Some(vec![erato::models::assistant::AssistantStarterPrompt {
            name: "Start".into(),
            prompt: "Help me".into(),
        }]),
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
    let snapshot: serde_json::Value = first_response.json();
    assert_eq!(
        snapshot["version"]["assistant"]["welcome_message"],
        "## Welcome to this version"
    );
    assert_eq!(
        snapshot["version"]["assistant"]["starter_prompts"],
        json!([{"name":"Start", "prompt":"Help me"}])
    );

    // Submitted versions retain their own assistant content when the draft changes.
    let edited = server
        .put(&format!("/api/v1beta/assistants/{}", source_assistant.id))
        .json(&json!({"welcome_message": "Changed draft", "starter_prompts": []}))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(edited.status_code(), http::StatusCode::OK);
    use sea_orm::EntityTrait;
    let snapshot_id =
        sqlx::types::Uuid::parse_str(snapshot["version"]["assistant"]["id"].as_str().unwrap())
            .unwrap();
    let frozen = erato::db::entity::assistants::Entity::find_by_id(snapshot_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        frozen.welcome_message.as_deref(),
        Some("## Welcome to this version")
    );
    assert_eq!(
        frozen.starter_prompts,
        json!([{"name":"Start", "prompt":"Help me"}])
    );

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
        None,
        None,
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
    let first_published: Value = first_publish_response.json();
    assert_eq!(
        first_published["version"]["is_current_published_version"],
        true
    );

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
    let second_published: Value = second_publish_response.json();
    assert_eq!(second_published["version"]["featured"], true);
    assert_eq!(
        second_published["version"]["is_current_published_version"],
        true
    );

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

/// Verifies assistant hub user reviews:
/// each user can create one review per hub assistant and update it, ratings are
/// summarized in the list response, comments are visible only to the reviewer
/// and assistant creator, and the review version follows the latest update.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_assistant_hub_user_reviews_are_upserted_summarized_and_visibility_filtered(
    pool: Pool<Postgres>,
) {
    let app_state = test_app_state(assistant_hub_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_subject = "assistant-hub-review-owner";
    let first_viewer_subject = "assistant-hub-review-viewer-one";
    let second_viewer_subject = "assistant-hub-review-viewer-two";
    let reviewer_subject = "assistant-hub-review-admin";

    let owner_token = JwtTokenBuilder::new()
        .subject(owner_subject)
        .email("assistant-hub-review-owner@example.com")
        .build();
    let first_viewer_token = JwtTokenBuilder::new()
        .subject(first_viewer_subject)
        .email("assistant-hub-review-viewer-one@example.com")
        .build();
    let second_viewer_token = JwtTokenBuilder::new()
        .subject(second_viewer_subject)
        .email("assistant-hub-review-viewer-two@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject(reviewer_subject)
        .email("assistant-hub-review-admin@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        owner_subject,
        Some("assistant-hub-review-owner@example.com"),
    )
    .await
    .expect("failed to create owner");
    let first_viewer = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        first_viewer_subject,
        Some("assistant-hub-review-viewer-one@example.com"),
    )
    .await
    .expect("failed to create first viewer");
    let second_viewer = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        second_viewer_subject,
        Some("assistant-hub-review-viewer-two@example.com"),
    )
    .await
    .expect("failed to create second viewer");

    let source_assistant = erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(owner.id.to_string()),
        "Reviewed Hub Assistant".to_string(),
        Some("Source review description".to_string()),
        "You are a reviewed assistant hub test fixture.".to_string(),
        None,
        None,
        Some("mock-llm".to_string()),
        false,
        None,
        None,
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
            "keywords": ["reviews", "first"],
            "version_number": "1.0.0",
            "version_comment": "Initial hub publication",
            "creator_review_comment": "Ready for review",
            "audience_grants": [
                {
                    "subject_type": "user",
                    "subject_id_type": "id",
                    "subject_id": first_viewer.id.to_string(),
                    "role": "viewer"
                },
                {
                    "subject_type": "user",
                    "subject_id_type": "id",
                    "subject_id": second_viewer.id.to_string(),
                    "role": "viewer"
                }
            ]
        }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(
        first_submission_response.status_code(),
        http::StatusCode::CREATED
    );
    let first_submission: Value = first_submission_response.json();
    let hub_assistant_id = first_submission["version"]["hub_assistant_id"]
        .as_str()
        .expect("submitted version should include hub_assistant_id")
        .to_string();
    let first_version_id = first_submission["version"]["version_id"]
        .as_str()
        .expect("submitted version should include version_id")
        .to_string();

    assert_eq!(
        server
            .post(&format!(
                "/api/v1beta/assistant-hub/versions/{first_version_id}/review"
            ))
            .json(&json!({
                "accepted": true,
                "reviewer_review_comment": "Accepted for publication"
            }))
            .with_bearer_token(&reviewer_token)
            .await
            .status_code(),
        http::StatusCode::OK
    );
    assert_eq!(
        server
            .put(&format!(
                "/api/v1beta/assistant-hub/versions/{first_version_id}/published"
            ))
            .json(&json!({ "is_published": true }))
            .with_bearer_token(&owner_token)
            .await
            .status_code(),
        http::StatusCode::OK
    );
    assert_eq!(
        server
            .put(&format!(
                "/api/v1beta/assistant-hub/versions/{first_version_id}/current"
            ))
            .with_bearer_token(&owner_token)
            .await
            .status_code(),
        http::StatusCode::OK
    );

    let first_review_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/assistants/{hub_assistant_id}/review"
        ))
        .json(&json!({
            "score": 8,
            "comment": "Useful first impression"
        }))
        .with_bearer_token(&first_viewer_token)
        .await;
    assert_eq!(first_review_response.status_code(), http::StatusCode::OK);

    let first_review_update_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/assistants/{hub_assistant_id}/review"
        ))
        .json(&json!({
            "score": 6,
            "comment": "Updated first impression"
        }))
        .with_bearer_token(&first_viewer_token)
        .await;
    assert_eq!(
        first_review_update_response.status_code(),
        http::StatusCode::OK
    );

    let second_review_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/assistants/{hub_assistant_id}/review"
        ))
        .json(&json!({
            "score": 10,
            "comment": null
        }))
        .with_bearer_token(&second_viewer_token)
        .await;
    assert_eq!(second_review_response.status_code(), http::StatusCode::OK);

    let listed_response = server
        .get("/api/v1beta/assistant-hub/assistants")
        .with_bearer_token(&first_viewer_token)
        .await;
    assert_eq!(listed_response.status_code(), http::StatusCode::OK);
    let listed: Value = listed_response.json();
    assert_eq!(listed["versions"][0]["review_count"], 2);
    assert_average_score(&listed["versions"][0]["review_average_score"], 8.0);

    let first_viewer_reviews_response = server
        .get(&format!(
            "/api/v1beta/assistant-hub/assistants/{hub_assistant_id}/reviews"
        ))
        .with_bearer_token(&first_viewer_token)
        .await;
    assert_eq!(
        first_viewer_reviews_response.status_code(),
        http::StatusCode::OK
    );
    let first_viewer_reviews: Value = first_viewer_reviews_response.json();
    assert_eq!(first_viewer_reviews["reviews"].as_array().unwrap().len(), 1);
    assert_eq!(
        first_viewer_reviews["reviews"][0]["comment"],
        "Updated first impression"
    );

    let owner_reviews_response = server
        .get(&format!(
            "/api/v1beta/assistant-hub/assistants/{hub_assistant_id}/reviews"
        ))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(owner_reviews_response.status_code(), http::StatusCode::OK);
    let owner_reviews: Value = owner_reviews_response.json();
    assert_eq!(owner_reviews["reviews"].as_array().unwrap().len(), 2);
    assert!(
        owner_reviews["reviews"]
            .as_array()
            .expect("reviews response should contain reviews")
            .iter()
            .any(|review| review["score"] == 10 && review["comment"].is_null())
    );

    let second_submission_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/assistants/{}/versions",
            source_assistant.id
        ))
        .json(&json!({
            "long_description": "A second reviewed assistant hub version.",
            "category_ids": [STORE_CATEGORY_ID],
            "keywords": ["reviews", "second"],
            "version_number": "2.0.0",
            "version_comment": "Second hub publication",
            "creator_review_comment": "Ready for another review",
            "audience_grants": [
                {
                    "subject_type": "user",
                    "subject_id_type": "id",
                    "subject_id": first_viewer.id.to_string(),
                    "role": "viewer"
                },
                {
                    "subject_type": "user",
                    "subject_id_type": "id",
                    "subject_id": second_viewer.id.to_string(),
                    "role": "viewer"
                }
            ]
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

    assert_eq!(
        server
            .post(&format!(
                "/api/v1beta/assistant-hub/versions/{second_version_id}/review"
            ))
            .json(&json!({
                "accepted": true,
                "reviewer_review_comment": "Accepted for publication"
            }))
            .with_bearer_token(&reviewer_token)
            .await
            .status_code(),
        http::StatusCode::OK
    );
    assert_eq!(
        server
            .put(&format!(
                "/api/v1beta/assistant-hub/versions/{second_version_id}/published"
            ))
            .json(&json!({ "is_published": true }))
            .with_bearer_token(&owner_token)
            .await
            .status_code(),
        http::StatusCode::OK
    );
    assert_eq!(
        server
            .put(&format!(
                "/api/v1beta/assistant-hub/versions/{second_version_id}/current"
            ))
            .with_bearer_token(&owner_token)
            .await
            .status_code(),
        http::StatusCode::OK
    );

    let second_version_review_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/assistants/{hub_assistant_id}/review"
        ))
        .json(&json!({
            "score": 9,
            "comment": "Still helpful on version two"
        }))
        .with_bearer_token(&first_viewer_token)
        .await;
    assert_eq!(
        second_version_review_response.status_code(),
        http::StatusCode::OK
    );
    let second_version_review: Value = second_version_review_response.json();
    assert_eq!(second_version_review["review"]["version_number"], "2.0.0");

    let updated_listing_response = server
        .get("/api/v1beta/assistant-hub/assistants")
        .with_bearer_token(&first_viewer_token)
        .await;
    assert_eq!(updated_listing_response.status_code(), http::StatusCode::OK);
    let updated_listing: Value = updated_listing_response.json();
    assert_eq!(updated_listing["versions"][0]["review_count"], 2);
    assert_average_score(&updated_listing["versions"][0]["review_average_score"], 9.5);

    let owner_reviews_after_version_update_response = server
        .get(&format!(
            "/api/v1beta/assistant-hub/assistants/{hub_assistant_id}/reviews"
        ))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(
        owner_reviews_after_version_update_response.status_code(),
        http::StatusCode::OK
    );
    let owner_reviews_after_version_update: Value =
        owner_reviews_after_version_update_response.json();
    let review_versions: Vec<&str> = owner_reviews_after_version_update["reviews"]
        .as_array()
        .expect("reviews response should contain reviews")
        .iter()
        .map(|review| review["version_number"].as_str().unwrap())
        .collect();
    assert!(review_versions.contains(&"1.0.0"));
    assert!(review_versions.contains(&"2.0.0"));
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
    assert_assistant_hub_publication_for_audience(pool, PublicationAudience::User).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_assistant_hub_publication_for_organization_when_direct_picker_is_disabled(
    pool: Pool<Postgres>,
) {
    assert_assistant_hub_publication_for_audience(pool, PublicationAudience::Organization).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_assistant_hub_publication_with_forced_organization_audience(pool: Pool<Postgres>) {
    assert_assistant_hub_publication_for_audience(pool, PublicationAudience::ForcedOrganization)
        .await;
}

enum PublicationAudience {
    User,
    Organization,
    ForcedOrganization,
}

async fn assert_assistant_hub_publication_for_audience(
    pool: Pool<Postgres>,
    audience: PublicationAudience,
) {
    let mut config = assistant_hub_app_config();
    if !matches!(audience, PublicationAudience::User) {
        config.assistants.enable_direct_organization_sharing = false;
    }
    let mut app_state = test_app_state(config, pool).await;
    let mut server = create_test_server(app_state.clone());

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
        None,
        None,
    )
    .await
    .expect("failed to create source assistant");

    let config_response = server
        .get("/api/v1beta/assistant-hub/config")
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(config_response.status_code(), http::StatusCode::OK);
    assert_eq!(
        config_response.json::<Value>()["force_whole_organization_audience"],
        false
    );

    let submit = async |server: &axum_test::TestServer, version_number: &str, grants: Value| {
        let response = server
            .post(&format!(
                "/api/v1beta/assistant-hub/assistants/{}/versions",
                source_assistant.id
            ))
            .json(&json!({
                "long_description": "A reviewed assistant for the integration test hub.",
                "category_ids": [STORE_CATEGORY_ID],
                "keywords": ["published", "hub"],
                "version_number": version_number,
                "creator_review_comment": "Ready for review",
                "audience_grants": grants,
            }))
            .with_bearer_token(&owner_token)
            .await;
        assert_eq!(response.status_code(), http::StatusCode::CREATED);
        response.json::<Value>()["version"].clone()
    };
    let assert_grant = async |server: &axum_test::TestServer, version: &Value, expected: &Value| {
        let assistant_id = version["assistant_id"].as_str().unwrap();
        let response = server
            .get(&format!(
                "/api/v1beta/share-grants?resource_type=assistant&resource_id={assistant_id}"
            ))
            .with_bearer_token(&owner_token)
            .await;
        assert_eq!(response.status_code(), http::StatusCode::OK);
        let body: Value = response.json();
        let grants = body["grants"].as_array().expect("grants array");
        assert_eq!(grants.len(), 1);
        for field in ["subject_type", "subject_id_type", "subject_id", "role"] {
            assert_eq!(grants[0][field], expected[field], "{field}");
        }
    };

    let user_grant = json!({
        "subject_type": "user",
        "subject_id_type": "id",
        "subject_id": viewer.id,
        "role": "viewer",
    });
    let organization_grant = json!({
        "subject_type": ORGANIZATION_SUBJECT_TYPE,
        "subject_id_type": ORGANIZATION_SUBJECT_ID_TYPE,
        "subject_id": ORGANIZATION_SUBJECT_ID,
        "role": "viewer",
    });
    let submitted = match audience {
        PublicationAudience::User => {
            let version = submit(&server, "1.0.0", json!([user_grant])).await;
            assert_grant(&server, &version, &user_grant).await;
            version
        }
        PublicationAudience::Organization => {
            let version = submit(&server, "1.0.0", json!([organization_grant])).await;
            assert_grant(&server, &version, &organization_grant).await;
            version
        }
        PublicationAudience::ForcedOrganization => {
            let legacy_grant = json!({
                "subject_type": "user",
                "subject_id_type": "id",
                "subject_id": owner.id,
                "role": "viewer",
            });
            let legacy = submit(&server, "1.0.0", json!([legacy_grant])).await;

            app_state
                .config
                .assistant_hub
                .force_whole_organization_audience = true;
            app_state
                .config
                .assistant_hub
                .default_share_with_whole_organization = false;
            server = create_test_server(app_state);
            let config_response = server
                .get("/api/v1beta/assistant-hub/config")
                .with_bearer_token(&owner_token)
                .await;
            assert_eq!(config_response.status_code(), http::StatusCode::OK);
            let config: Value = config_response.json();
            assert_eq!(config["force_whole_organization_audience"], true);
            assert_eq!(config["default_share_with_whole_organization"], false);

            let empty_audience = submit(&server, "2.0.0", json!([])).await;
            assert_grant(&server, &empty_audience, &organization_grant).await;

            let mut editor_grant = organization_grant.clone();
            editor_grant["role"] = json!("editor");
            let conflicting = submit(&server, "3.0.0", json!([legacy_grant, editor_grant])).await;
            assert_grant(&server, &conflicting, &organization_grant).await;
            assert_grant(&server, &legacy, &legacy_grant).await;
            conflicting
        }
    };
    let version_id = submitted["version_id"]
        .as_str()
        .expect("submitted version should include version_id")
        .to_string();
    let version_assistant_id = submitted["assistant_id"]
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

    let viewer_before_publish_response = server
        .get("/api/v1beta/assistant-hub/assistants")
        .with_bearer_token(&viewer_token)
        .await;
    assert_eq!(
        viewer_before_publish_response.status_code(),
        http::StatusCode::OK
    );
    assert_eq!(version_count(&viewer_before_publish_response.json()), 0);

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
    assert_eq!(published["version"]["is_current_published_version"], true);

    let viewer_after_publish_response = server
        .get("/api/v1beta/assistant-hub/assistants")
        .with_bearer_token(&viewer_token)
        .await;
    assert_eq!(
        viewer_after_publish_response.status_code(),
        http::StatusCode::OK
    );
    let listed: Value = viewer_after_publish_response.json();
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

    let unpublish_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/published"
        ))
        .json(&json!({ "is_published": false }))
        .with_bearer_token(&reviewer_token)
        .await;
    assert_eq!(unpublish_response.status_code(), http::StatusCode::OK);
    let unpublished: Value = unpublish_response.json();
    assert_eq!(unpublished["version"]["is_published"], false);
    assert_eq!(
        unpublished["version"]["is_current_published_version"],
        false
    );

    let owner_versions_response = server
        .get("/api/v1beta/assistant-hub/my/versions")
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(owner_versions_response.status_code(), http::StatusCode::OK);
    let owner_versions: Value = owner_versions_response.json();
    assert_eq!(owner_versions["versions"][0]["is_published"], false);

    let viewer_after_unpublish_response = server
        .get("/api/v1beta/assistant-hub/assistants")
        .with_bearer_token(&viewer_token)
        .await;
    assert_eq!(
        viewer_after_unpublish_response.status_code(),
        http::StatusCode::OK
    );
    assert_eq!(
        version_count(&viewer_after_unpublish_response.json()),
        0,
        "unpublishing by a reviewer should remove the assistant from the hub"
    );
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
        None,
        None,
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
