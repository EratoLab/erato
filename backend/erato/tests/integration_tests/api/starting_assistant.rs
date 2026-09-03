//! Starting assistant (audience pin) API endpoint integration tests.

use axum::http;
use axum_test::TestServer;
use erato::config::{
    AssistantHubCategoryConfig, AssistantHubReviewerPermissionsConfig, AssistantHubReviewerRule,
};
use erato::db::entity::prelude::ShareGrants;
use erato::db::entity::share_grants;
use erato::distribution::experience_policy::{
    AudienceSubject, ExperienceAudience, ExperiencePolicyDocument,
};
use erato::policy::engine::PolicyEngine;
use erato::state::AppState;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;
use sqlx::types::Uuid;
use std::collections::HashMap;

use crate::test_app_state;
use crate::test_utils::{
    JwtTokenBuilder, TEST_USER_ISSUER, TestRequestAuthExt, create_test_server, hermetic_app_config,
};

const REVIEWER_GROUP_ID: &str = "starting-assistant-reviewers";
const AUDIENCE_GROUP_ID: &str = "starting-assistant-audience";
const SECOND_AUDIENCE_GROUP_ID: &str = "starting-assistant-second-audience";
const STORE_CATEGORY_ID: &str = "productivity";

fn starting_assistant_app_config() -> erato::config::AppConfig {
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

fn group_subject(group_id: &str) -> AudienceSubject {
    AudienceSubject::OrganizationGroup {
        group_id: group_id.to_string(),
    }
}

fn user_subject(organization_user_id: &str) -> AudienceSubject {
    AudienceSubject::User {
        organization_user_id: organization_user_id.to_string(),
    }
}

/// Install an experience policy on the running app state, replacing any
/// previous one. Entries are `(audience_name, group_id, pinned_hub_id)` — the
/// single-group audience, still the common case. Their order controls `HashMap`
/// insertion order, deliberately independent of `priority_order`.
async fn install_policy(
    app_state: &AppState,
    entries: Vec<(&str, &str, Uuid)>,
    priority_order: Vec<&str>,
) {
    let entries = entries
        .into_iter()
        .map(|(name, group_id, hub_id)| (name, vec![group_subject(group_id)], hub_id))
        .collect();
    install_policy_with_subjects(app_state, entries, priority_order).await;
}

/// [`install_policy`] for audiences composed of several subjects — groups,
/// named individuals, the whole organization, in any mix.
async fn install_policy_with_subjects(
    app_state: &AppState,
    entries: Vec<(&str, Vec<AudienceSubject>, Uuid)>,
    priority_order: Vec<&str>,
) {
    let mut audiences = HashMap::new();
    for (name, subjects, pinned_assistant_hub_assistant_id) in entries {
        audiences.insert(
            name.to_string(),
            ExperienceAudience {
                subjects,
                pinned_assistant_hub_assistant_id,
                expires_at: None,
            },
        );
    }
    let document = ExperiencePolicyDocument {
        audiences,
        priority_order: priority_order.into_iter().map(String::from).collect(),
    };
    app_state.reloadable.write().await.experience_policy = Some(document);
}

async fn create_source_assistant(
    app_state: &AppState,
    owner_id: &str,
    name: &str,
) -> erato::db::entity::assistants::Model {
    erato::models::assistant::create_assistant(
        &app_state.db,
        &PolicyEngine::new(),
        &erato::policy::types::Subject::User(owner_id.to_string()),
        name.to_string(),
        Some("Source draft description".to_string()),
        "You are a starting-assistant test fixture.".to_string(),
        None,
        None,
        Some("mock-llm".to_string()),
        false,
    )
    .await
    .expect("failed to create source assistant")
}

/// A viewer `audience_grants` entry for a directory group.
fn group_grant(group_id: &str) -> Value {
    json!({
        "subject_type": "organization_group",
        "subject_id_type": "organization_group_id",
        "subject_id": group_id,
        "role": "viewer"
    })
}

/// A viewer `audience_grants` entry covering the whole organization.
fn organization_grant() -> Value {
    json!({
        "subject_type": "organization",
        "subject_id_type": "organization_id",
        "subject_id": "__organization__",
        "role": "viewer"
    })
}

/// Submit, review-accept, publish and mark current a hub version for the
/// given source assistant, granting the audience group viewer access. Returns
/// the submitted version JSON (including `hub_assistant_id` and the clone
/// `assistant_id`).
async fn publish_hub_version(
    server: &TestServer,
    owner_token: &str,
    reviewer_token: &str,
    source_assistant_id: &str,
    version_number: &str,
    audience_group_id: &str,
) -> Value {
    publish_hub_version_with_grants(
        server,
        owner_token,
        reviewer_token,
        source_assistant_id,
        version_number,
        vec![group_grant(audience_group_id)],
    )
    .await
}

/// [`publish_hub_version`] with arbitrary audience grants, so a published
/// assistant can be reachable by a group, a named person, or the whole
/// organization — whatever the audience being tested is composed of.
async fn publish_hub_version_with_grants(
    server: &TestServer,
    owner_token: &str,
    reviewer_token: &str,
    source_assistant_id: &str,
    version_number: &str,
    audience_grants: Vec<Value>,
) -> Value {
    let submission_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/assistants/{source_assistant_id}/versions"
        ))
        .json(&json!({
            "long_description": "A reviewed assistant pinned for an audience.",
            "category_ids": [STORE_CATEGORY_ID],
            "keywords": ["starting", "assistant"],
            "version_number": version_number,
            "version_comment": "Submission for starting-assistant tests",
            "creator_review_comment": "Ready for review",
            "audience_grants": audience_grants
        }))
        .with_bearer_token(owner_token)
        .await;
    assert_eq!(submission_response.status_code(), http::StatusCode::CREATED);
    let submitted: Value = submission_response.json();
    let version_id = submitted["version"]["version_id"]
        .as_str()
        .expect("submitted version should include version_id")
        .to_string();

    let review_response = server
        .post(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/review"
        ))
        .json(&json!({
            "accepted": true,
            "reviewer_review_comment": "Accepted"
        }))
        .with_bearer_token(reviewer_token)
        .await;
    assert_eq!(review_response.status_code(), http::StatusCode::OK);

    let publish_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/published"
        ))
        .json(&json!({ "is_published": true }))
        .with_bearer_token(owner_token)
        .await;
    assert_eq!(publish_response.status_code(), http::StatusCode::OK);

    let current_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/current"
        ))
        .with_bearer_token(owner_token)
        .await;
    assert_eq!(current_response.status_code(), http::StatusCode::OK);

    submitted["version"].clone()
}

async fn get_starting_assistant(server: &TestServer, token: &str) -> Value {
    let response = server
        .get("/api/v1beta/me/starting-assistant")
        .with_bearer_token(token)
        .await;
    response.assert_status_ok();
    response.json()
}

/// The pin stores the stable hub id, so after a republish the endpoint must
/// serve the new clone's `assistants.id` without any change to the policy
/// document.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_tracks_current_published_version_across_republish(
    pool: Pool<Postgres>,
) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_token = JwtTokenBuilder::new()
        .subject("starting-assistant-owner")
        .email("starting-assistant-owner@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-reviewer")
        .email("starting-assistant-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();
    let viewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-viewer")
        .email("starting-assistant-viewer@example.com")
        .groups(vec![AUDIENCE_GROUP_ID.to_string()])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "starting-assistant-owner",
        Some("starting-assistant-owner@example.com"),
    )
    .await
    .expect("failed to create owner");
    let source_assistant = create_source_assistant(
        &app_state,
        &owner.id.to_string(),
        "Pinned Starting Assistant",
    )
    .await;

    let v1 = publish_hub_version(
        &server,
        &owner_token,
        &reviewer_token,
        &source_assistant.id.to_string(),
        "1.0.0",
        AUDIENCE_GROUP_ID,
    )
    .await;
    let hub_assistant_id = v1["hub_assistant_id"]
        .as_str()
        .expect("version should include hub_assistant_id")
        .to_string();
    let v1_assistant_id = v1["assistant_id"].as_str().unwrap().to_string();

    install_policy(
        &app_state,
        vec![(
            "pilot",
            AUDIENCE_GROUP_ID,
            hub_assistant_id.parse().unwrap(),
        )],
        vec!["pilot"],
    )
    .await;

    let body = get_starting_assistant(&server, &viewer_token).await;
    let pinned = body["starting_assistant"]
        .as_object()
        .expect("starting_assistant should be present for the audience member");
    assert_eq!(pinned["assistant_id"], v1_assistant_id.as_str());
    assert_eq!(pinned["assistant_hub_assistant_id"], hub_assistant_id);
    assert_eq!(pinned["audience"], "pilot");

    // Republish: v2 mints a fresh clone `assistants.id` under the SAME hub id.
    let v2 = publish_hub_version(
        &server,
        &owner_token,
        &reviewer_token,
        &source_assistant.id.to_string(),
        "2.0.0",
        AUDIENCE_GROUP_ID,
    )
    .await;
    assert_eq!(v2["hub_assistant_id"], hub_assistant_id);
    let v2_assistant_id = v2["assistant_id"].as_str().unwrap().to_string();
    assert_ne!(
        v1_assistant_id, v2_assistant_id,
        "republish should mint a fresh clone assistants.id"
    );

    // The policy document was NOT touched — the endpoint must now serve the
    // v2 clone id because the pin stores the stable hub id.
    let body = get_starting_assistant(&server, &viewer_token).await;
    let pinned = body["starting_assistant"]
        .as_object()
        .expect("starting_assistant should still be present after republish");
    assert_eq!(pinned["assistant_id"], v2_assistant_id.as_str());
    assert_eq!(pinned["assistant_hub_assistant_id"], hub_assistant_id);
}

/// Revoking the AUDIENCE's share grant must clear the pin even for a user who
/// retains personal access to the pinned assistant.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_absent_when_audience_grant_revoked(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_token = JwtTokenBuilder::new()
        .subject("starting-assistant-revoke-owner")
        .email("starting-assistant-revoke-owner@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-revoke-reviewer")
        .email("starting-assistant-revoke-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();
    let viewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-revoke-viewer")
        .email("starting-assistant-revoke-viewer@example.com")
        .groups(vec![AUDIENCE_GROUP_ID.to_string()])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "starting-assistant-revoke-owner",
        Some("starting-assistant-revoke-owner@example.com"),
    )
    .await
    .expect("failed to create owner");
    let viewer = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "starting-assistant-revoke-viewer",
        Some("starting-assistant-revoke-viewer@example.com"),
    )
    .await
    .expect("failed to create viewer");

    let source_assistant = create_source_assistant(
        &app_state,
        &owner.id.to_string(),
        "Revocable Starting Assistant",
    )
    .await;

    let version = publish_hub_version(
        &server,
        &owner_token,
        &reviewer_token,
        &source_assistant.id.to_string(),
        "1.0.0",
        AUDIENCE_GROUP_ID,
    )
    .await;
    let hub_assistant_id: Uuid = version["hub_assistant_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let clone_assistant_id = version["assistant_id"].as_str().unwrap().to_string();
    let group_grant = ShareGrants::find()
        .filter(share_grants::Column::ResourceType.eq("assistant"))
        .filter(share_grants::Column::ResourceId.eq(clone_assistant_id.clone()))
        .filter(share_grants::Column::SubjectType.eq("organization_group"))
        .filter(share_grants::Column::SubjectId.eq(AUDIENCE_GROUP_ID))
        .one(&app_state.db)
        .await
        .expect("failed to query the audience grant")
        .expect("publishing should have created the audience grant");
    let group_grant_id = group_grant.id.to_string();

    install_policy(
        &app_state,
        vec![("pilot", AUDIENCE_GROUP_ID, hub_assistant_id)],
        vec!["pilot"],
    )
    .await;

    // Sanity: the pin applies before the revocation.
    let body = get_starting_assistant(&server, &viewer_token).await;
    assert!(
        body["starting_assistant"].is_object(),
        "pin should apply before the audience grant is revoked"
    );

    // Grant the viewer PERSONAL access to the clone assistant, then revoke
    // the audience grant. The personal grant must not keep the pin alive.
    let personal_grant_response = server
        .post("/api/v1beta/share-grants")
        .json(&json!({
            "resource_type": "assistant",
            "resource_id": clone_assistant_id,
            "subject_type": "user",
            "subject_id_type": "id",
            "subject_id": viewer.id.to_string(),
            "role": "viewer"
        }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(
        personal_grant_response.status_code(),
        http::StatusCode::CREATED
    );

    let delete_response = server
        .delete(&format!("/api/v1beta/share-grants/{group_grant_id}"))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(delete_response.status_code(), http::StatusCode::NO_CONTENT);

    // The viewer still sees the assistant in the hub through the personal
    // grant — proving the absent pin below comes from the audience check,
    // not from lost access.
    let hub_response = server
        .get("/api/v1beta/assistant-hub/assistants")
        .with_bearer_token(&viewer_token)
        .await;
    hub_response.assert_status_ok();
    let hub_body: Value = hub_response.json();
    assert_eq!(hub_body["versions"].as_array().unwrap().len(), 1);

    let body = get_starting_assistant(&server, &viewer_token).await;
    assert!(
        body.get("starting_assistant").is_none(),
        "revoking the audience grant must clear the pin despite personal access"
    );
}

/// A pin naming a hub assistant that does not exist (or is not published)
/// degrades to the welcome screen with status 200.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_absent_for_stale_hub_id(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let viewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-stale-viewer")
        .email("starting-assistant-stale-viewer@example.com")
        .groups(vec![AUDIENCE_GROUP_ID.to_string()])
        .build();

    install_policy(
        &app_state,
        vec![("pilot", AUDIENCE_GROUP_ID, Uuid::new_v4())],
        vec!["pilot"],
    )
    .await;

    let body = get_starting_assistant(&server, &viewer_token).await;
    assert!(
        body.get("starting_assistant").is_none(),
        "an unresolvable hub id must degrade to no pin, not an error"
    );
}

/// A user in two audiences gets the one earlier in `priority_order`, stable
/// across repeated requests and across `HashMap` insertion orders; reversing
/// `priority_order` flips the winner.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_two_audiences_priority_order_decides(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_token = JwtTokenBuilder::new()
        .subject("starting-assistant-order-owner")
        .email("starting-assistant-order-owner@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-order-reviewer")
        .email("starting-assistant-order-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();
    // The viewer belongs to BOTH audiences.
    let viewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-order-viewer")
        .email("starting-assistant-order-viewer@example.com")
        .groups(vec![
            AUDIENCE_GROUP_ID.to_string(),
            SECOND_AUDIENCE_GROUP_ID.to_string(),
        ])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "starting-assistant-order-owner",
        Some("starting-assistant-order-owner@example.com"),
    )
    .await
    .expect("failed to create owner");

    let first_source = create_source_assistant(
        &app_state,
        &owner.id.to_string(),
        "First Audience Assistant",
    )
    .await;
    let second_source = create_source_assistant(
        &app_state,
        &owner.id.to_string(),
        "Second Audience Assistant",
    )
    .await;

    let first_version = publish_hub_version(
        &server,
        &owner_token,
        &reviewer_token,
        &first_source.id.to_string(),
        "1.0.0",
        AUDIENCE_GROUP_ID,
    )
    .await;
    let second_version = publish_hub_version(
        &server,
        &owner_token,
        &reviewer_token,
        &second_source.id.to_string(),
        "1.0.0",
        SECOND_AUDIENCE_GROUP_ID,
    )
    .await;

    let first_hub_id: Uuid = first_version["hub_assistant_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let second_hub_id: Uuid = second_version["hub_assistant_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let first_assistant_id = first_version["assistant_id"].as_str().unwrap().to_string();
    let second_assistant_id = second_version["assistant_id"].as_str().unwrap().to_string();

    // Rebuild the policy with the audiences inserted into the HashMap in both
    // orders: the winner must always be the first entry of priority_order.
    for entries in [
        vec![
            ("alpha", AUDIENCE_GROUP_ID, first_hub_id),
            ("beta", SECOND_AUDIENCE_GROUP_ID, second_hub_id),
        ],
        vec![
            ("beta", SECOND_AUDIENCE_GROUP_ID, second_hub_id),
            ("alpha", AUDIENCE_GROUP_ID, first_hub_id),
        ],
    ] {
        install_policy(&app_state, entries.clone(), vec!["alpha", "beta"]).await;
        // Repeat the request: the winner must be stable run over run.
        for _ in 0..3 {
            let body = get_starting_assistant(&server, &viewer_token).await;
            let pinned = &body["starting_assistant"];
            assert_eq!(pinned["audience"], "alpha");
            assert_eq!(pinned["assistant_id"], first_assistant_id.as_str());
        }

        // Reversing priority_order must flip the winner: precedence lives in
        // the ordered key alone, never in map iteration order.
        install_policy(&app_state, entries, vec!["beta", "alpha"]).await;
        let body = get_starting_assistant(&server, &viewer_token).await;
        let pinned = &body["starting_assistant"];
        assert_eq!(pinned["audience"], "beta");
        assert_eq!(pinned["assistant_id"], second_assistant_id.as_str());
    }
}

/// No policy, and policy without a matching audience, both yield an absent
/// pin with status 200.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_absent_without_policy_or_membership(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let outsider_token = JwtTokenBuilder::new()
        .subject("starting-assistant-outsider")
        .email("starting-assistant-outsider@example.com")
        .groups(vec!["some-unrelated-group".to_string()])
        .build();

    // No policy loaded at all (reloadable default).
    let body = get_starting_assistant(&server, &outsider_token).await;
    assert!(body.get("starting_assistant").is_none());

    // A policy exists but the user is in none of its audiences.
    install_policy(
        &app_state,
        vec![("pilot", AUDIENCE_GROUP_ID, Uuid::new_v4())],
        vec!["pilot"],
    )
    .await;
    let body = get_starting_assistant(&server, &outsider_token).await;
    assert!(body.get("starting_assistant").is_none());
}

/// An audience whose only subject is the whole organization applies to every
/// authenticated caller, including one carrying no `groups` claim at all —
/// "this applies to everyone", not "everyone not matched above".
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_organization_audience_matches_a_user_with_no_groups(
    pool: Pool<Postgres>,
) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_token = JwtTokenBuilder::new()
        .subject("org-audience-owner")
        .email("org-audience-owner@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject("org-audience-reviewer")
        .email("org-audience-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();
    // No `.groups(..)` at all: the claim is absent, not merely empty.
    let grouplessviewer_token = JwtTokenBuilder::new()
        .subject("org-audience-groupless")
        .email("org-audience-groupless@example.com")
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "org-audience-owner",
        Some("org-audience-owner@example.com"),
    )
    .await
    .expect("failed to create owner");
    let source_assistant =
        create_source_assistant(&app_state, &owner.id.to_string(), "Org Wide Assistant").await;

    let version = publish_hub_version_with_grants(
        &server,
        &owner_token,
        &reviewer_token,
        &source_assistant.id.to_string(),
        "1.0.0",
        vec![organization_grant()],
    )
    .await;
    let hub_assistant_id: Uuid = version["hub_assistant_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let assistant_id = version["assistant_id"].as_str().unwrap().to_string();

    install_policy_with_subjects(
        &app_state,
        vec![(
            "everyone",
            vec![AudienceSubject::Organization],
            hub_assistant_id,
        )],
        vec!["everyone"],
    )
    .await;

    let body = get_starting_assistant(&server, &grouplessviewer_token).await;
    let pinned = body["starting_assistant"]
        .as_object()
        .expect("an organization audience should reach a caller with no groups");
    assert_eq!(pinned["audience"], "everyone");
    assert_eq!(pinned["assistant_id"], assistant_id.as_str());
}

/// A `user` subject names exactly one person, by the directory id the token
/// carries in `oid` — so a colleague with no matching claim gets nothing, and
/// no group has to be created for a one-person audience.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_user_subject_matches_only_that_user(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    const ALICE_OID: &str = "5f0b6a7c-1111-4222-8333-alice0000001";
    const BOB_OID: &str = "5f0b6a7c-1111-4222-8333-bob000000002";

    let owner_token = JwtTokenBuilder::new()
        .subject("user-subject-owner")
        .email("user-subject-owner@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject("user-subject-reviewer")
        .email("user-subject-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();
    let alice_token = JwtTokenBuilder::new()
        .subject("user-subject-alice")
        .email("user-subject-alice@example.com")
        .organization_user_id(ALICE_OID)
        .build();
    let bob_token = JwtTokenBuilder::new()
        .subject("user-subject-bob")
        .email("user-subject-bob@example.com")
        .organization_user_id(BOB_OID)
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "user-subject-owner",
        Some("user-subject-owner@example.com"),
    )
    .await
    .expect("failed to create owner");
    let source_assistant =
        create_source_assistant(&app_state, &owner.id.to_string(), "Named Person Assistant").await;

    // Granted org-wide, so reachability is identical for both callers and the
    // only thing under test is whether the audience matched them.
    let version = publish_hub_version_with_grants(
        &server,
        &owner_token,
        &reviewer_token,
        &source_assistant.id.to_string(),
        "1.0.0",
        vec![organization_grant()],
    )
    .await;
    let hub_assistant_id: Uuid = version["hub_assistant_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();

    install_policy_with_subjects(
        &app_state,
        vec![(
            "alice-only",
            vec![user_subject(ALICE_OID)],
            hub_assistant_id,
        )],
        vec!["alice-only"],
    )
    .await;

    let body = get_starting_assistant(&server, &alice_token).await;
    assert_eq!(
        body["starting_assistant"]["audience"], "alice-only",
        "the named person should get the pin"
    );

    let body = get_starting_assistant(&server, &bob_token).await;
    assert!(
        body.get("starting_assistant").is_none(),
        "a user subject must not spill over to anyone else"
    );
}

/// An audience spanning several groups reaches a member of any of them, and the
/// eligibility check follows the subject that actually matched: being in a
/// second group of the same audience is no help when that group was never
/// granted the assistant.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_multi_group_audience_checks_the_matched_subject(
    pool: Pool<Postgres>,
) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_token = JwtTokenBuilder::new()
        .subject("multi-subject-owner")
        .email("multi-subject-owner@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject("multi-subject-reviewer")
        .email("multi-subject-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();
    let granted_member_token = JwtTokenBuilder::new()
        .subject("multi-subject-granted")
        .email("multi-subject-granted@example.com")
        .groups(vec![AUDIENCE_GROUP_ID.to_string()])
        .build();
    let ungranted_member_token = JwtTokenBuilder::new()
        .subject("multi-subject-ungranted")
        .email("multi-subject-ungranted@example.com")
        .groups(vec![SECOND_AUDIENCE_GROUP_ID.to_string()])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "multi-subject-owner",
        Some("multi-subject-owner@example.com"),
    )
    .await
    .expect("failed to create owner");
    let source_assistant =
        create_source_assistant(&app_state, &owner.id.to_string(), "Multi Group Assistant").await;

    // Only the FIRST group is granted the assistant, though both are in the
    // audience.
    let version = publish_hub_version(
        &server,
        &owner_token,
        &reviewer_token,
        &source_assistant.id.to_string(),
        "1.0.0",
        AUDIENCE_GROUP_ID,
    )
    .await;
    let hub_assistant_id: Uuid = version["hub_assistant_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();

    install_policy_with_subjects(
        &app_state,
        vec![(
            "rollout",
            vec![
                group_subject(AUDIENCE_GROUP_ID),
                group_subject(SECOND_AUDIENCE_GROUP_ID),
            ],
            hub_assistant_id,
        )],
        vec!["rollout"],
    )
    .await;

    let body = get_starting_assistant(&server, &granted_member_token).await;
    assert_eq!(
        body["starting_assistant"]["audience"], "rollout",
        "a member of the granted group should get the pin"
    );

    let body = get_starting_assistant(&server, &ungranted_member_token).await;
    assert!(
        body.get("starting_assistant").is_none(),
        "matching the audience through a group that cannot see the assistant must not pin it"
    );
}

/// The endpoint sits behind the `/me` authentication middleware.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_requires_authentication(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let response = server.get("/api/v1beta/me/starting-assistant").await;
    assert_eq!(response.status_code(), http::StatusCode::UNAUTHORIZED);
}

async fn put_preferences(server: &TestServer, token: &str, body: Value) -> Value {
    let response = server
        .put("/api/v1beta/me/profile/preferences")
        .json(&body)
        .with_bearer_token(token)
        .await;
    response.assert_status_ok();
    response.json()
}

/// An explicit clear must suppress an applicable audience pin, and un-clearing
/// must inherit it again, so "cleared" and "never set" are observably
/// different states.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_cleared_suppresses_audience_pin(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_token = JwtTokenBuilder::new()
        .subject("starting-assistant-clear-owner")
        .email("starting-assistant-clear-owner@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-clear-reviewer")
        .email("starting-assistant-clear-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();
    let viewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-clear-viewer")
        .email("starting-assistant-clear-viewer@example.com")
        .groups(vec![AUDIENCE_GROUP_ID.to_string()])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "starting-assistant-clear-owner",
        Some("starting-assistant-clear-owner@example.com"),
    )
    .await
    .expect("failed to create owner");
    let source_assistant = create_source_assistant(
        &app_state,
        &owner.id.to_string(),
        "Clearable Starting Assistant",
    )
    .await;
    let version = publish_hub_version(
        &server,
        &owner_token,
        &reviewer_token,
        &source_assistant.id.to_string(),
        "1.0.0",
        AUDIENCE_GROUP_ID,
    )
    .await;
    let hub_assistant_id: Uuid = version["hub_assistant_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();

    install_policy(
        &app_state,
        vec![("pilot", AUDIENCE_GROUP_ID, hub_assistant_id)],
        vec!["pilot"],
    )
    .await;

    // Never set: the audience pin applies, and reports its source.
    let body = get_starting_assistant(&server, &viewer_token).await;
    let pinned = &body["starting_assistant"];
    assert_eq!(pinned["source"], "audience_pin");
    assert_eq!(pinned["audience"], "pilot");

    // Explicitly cleared: the pin must be suppressed even though the policy
    // still names this user's audience.
    let profile = put_preferences(
        &server,
        &viewer_token,
        json!({
            "preference_starting_assistant_cleared": true
        }),
    )
    .await;
    assert_eq!(profile["preference_starting_assistant_cleared"], true);

    let body = get_starting_assistant(&server, &viewer_token).await;
    assert!(
        body.get("starting_assistant").is_none(),
        "an explicit clear must stick against an applicable audience pin"
    );

    // The clear survives to GET /me/profile as well (middleware plumbing).
    let profile_response = server
        .get("/api/v1beta/me/profile")
        .with_bearer_token(&viewer_token)
        .await;
    profile_response.assert_status_ok();
    let profile: Value = profile_response.json();
    assert_eq!(profile["preference_starting_assistant_cleared"], true);

    // Un-clearing returns to inherit: the pin applies again.
    put_preferences(
        &server,
        &viewer_token,
        json!({
            "preference_starting_assistant_cleared": false
        }),
    )
    .await;
    let body = get_starting_assistant(&server, &viewer_token).await;
    assert_eq!(body["starting_assistant"]["source"], "audience_pin");
}

/// The user's own pick beats the audience pin, and withdrawing the pick with
/// an explicit `null` returns to inheriting the pin (NOT to a cleared state).
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_own_pick_beats_audience_pin(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_token = JwtTokenBuilder::new()
        .subject("starting-assistant-pick-owner")
        .email("starting-assistant-pick-owner@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-pick-reviewer")
        .email("starting-assistant-pick-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();
    let viewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-pick-viewer")
        .email("starting-assistant-pick-viewer@example.com")
        .groups(vec![AUDIENCE_GROUP_ID.to_string()])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "starting-assistant-pick-owner",
        Some("starting-assistant-pick-owner@example.com"),
    )
    .await
    .expect("failed to create owner");

    let pinned_source =
        create_source_assistant(&app_state, &owner.id.to_string(), "Pinned For Audience").await;
    let picked_source =
        create_source_assistant(&app_state, &owner.id.to_string(), "User Picked Assistant").await;

    let pinned_version = publish_hub_version(
        &server,
        &owner_token,
        &reviewer_token,
        &pinned_source.id.to_string(),
        "1.0.0",
        AUDIENCE_GROUP_ID,
    )
    .await;
    let picked_version = publish_hub_version(
        &server,
        &owner_token,
        &reviewer_token,
        &picked_source.id.to_string(),
        "1.0.0",
        AUDIENCE_GROUP_ID,
    )
    .await;

    let pinned_hub_id: Uuid = pinned_version["hub_assistant_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let picked_hub_id = picked_version["hub_assistant_id"].as_str().unwrap();
    let picked_assistant_id = picked_version["assistant_id"].as_str().unwrap();

    install_policy(
        &app_state,
        vec![("pilot", AUDIENCE_GROUP_ID, pinned_hub_id)],
        vec!["pilot"],
    )
    .await;

    // Own pick wins over the applicable audience pin.
    let profile = put_preferences(
        &server,
        &viewer_token,
        json!({
            "preference_starting_hub_assistant_id": picked_hub_id
        }),
    )
    .await;
    assert_eq!(
        profile["preference_starting_hub_assistant_id"],
        picked_hub_id
    );

    let body = get_starting_assistant(&server, &viewer_token).await;
    let resolved = &body["starting_assistant"];
    assert_eq!(resolved["source"], "user_pick");
    assert_eq!(resolved["assistant_id"], picked_assistant_id);
    assert_eq!(resolved["assistant_hub_assistant_id"], picked_hub_id);
    assert!(
        resolved.get("audience").is_none(),
        "an own pick carries no audience"
    );

    // Withdrawing the pick (explicit null) inherits the audience pin again —
    // distinct from clearing, which would suppress it.
    put_preferences(
        &server,
        &viewer_token,
        json!({
            "preference_starting_hub_assistant_id": null
        }),
    )
    .await;
    let body = get_starting_assistant(&server, &viewer_token).await;
    let resolved = &body["starting_assistant"];
    assert_eq!(resolved["source"], "audience_pin");
    assert_eq!(
        resolved["assistant_hub_assistant_id"],
        pinned_hub_id.to_string()
    );
}

/// The own pick must resolve in a deployment with no experience policy loaded
/// at all, and must degrade to the welcome screen — never fall through, never
/// error — once the picked version is withdrawn.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_own_pick_without_policy_and_after_withdrawal(
    pool: Pool<Postgres>,
) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_token = JwtTokenBuilder::new()
        .subject("starting-assistant-solo-owner")
        .email("starting-assistant-solo-owner@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-solo-reviewer")
        .email("starting-assistant-solo-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();
    let viewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-solo-viewer")
        .email("starting-assistant-solo-viewer@example.com")
        .groups(vec![AUDIENCE_GROUP_ID.to_string()])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "starting-assistant-solo-owner",
        Some("starting-assistant-solo-owner@example.com"),
    )
    .await
    .expect("failed to create owner");
    let source_assistant =
        create_source_assistant(&app_state, &owner.id.to_string(), "Solo Picked Assistant").await;
    let version = publish_hub_version(
        &server,
        &owner_token,
        &reviewer_token,
        &source_assistant.id.to_string(),
        "1.0.0",
        AUDIENCE_GROUP_ID,
    )
    .await;
    let hub_id = version["hub_assistant_id"].as_str().unwrap();
    let version_id = version["version_id"].as_str().unwrap();

    // Deliberately NO install_policy: the pick must not depend on it.
    put_preferences(
        &server,
        &viewer_token,
        json!({
            "preference_starting_hub_assistant_id": hub_id
        }),
    )
    .await;

    let body = get_starting_assistant(&server, &viewer_token).await;
    let resolved = &body["starting_assistant"];
    assert_eq!(
        resolved["source"], "user_pick",
        "an own pick must resolve with no policy document loaded"
    );

    // Withdraw the picked version: the pick degrades to the welcome screen.
    let unpublish_response = server
        .put(&format!(
            "/api/v1beta/assistant-hub/versions/{version_id}/published"
        ))
        .json(&json!({ "is_published": false }))
        .with_bearer_token(&owner_token)
        .await;
    assert_eq!(unpublish_response.status_code(), http::StatusCode::OK);

    let body = get_starting_assistant(&server, &viewer_token).await;
    assert!(
        body.get("starting_assistant").is_none(),
        "a withdrawn pick must degrade to the welcome screen with status 200"
    );
}

/// A pick that is not a uuid is rejected with 422 instead of being silently
/// dropped or stored mangled.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_pick_rejects_invalid_uuid(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let token = JwtTokenBuilder::new()
        .subject("starting-assistant-invalid-pick")
        .email("starting-assistant-invalid-pick@example.com")
        .build();

    let response = server
        .put("/api/v1beta/me/profile/preferences")
        .json(&json!({ "preference_starting_hub_assistant_id": "not-a-uuid" }))
        .with_bearer_token(&token)
        .await;
    assert_eq!(
        response.status_code(),
        http::StatusCode::UNPROCESSABLE_ENTITY
    );
}

/// A well-formed uuid naming a hub assistant that does not exist — what the
/// picker's list-then-save race produces — must get the same 422 as a
/// malformed uuid, not a foreign key violation swallowed into a 500.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_pick_rejects_nonexistent_hub_assistant(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let token = JwtTokenBuilder::new()
        .subject("starting-assistant-nonexistent-pick")
        .email("starting-assistant-nonexistent-pick@example.com")
        .build();

    let response = server
        .put("/api/v1beta/me/profile/preferences")
        .json(&json!({ "preference_starting_hub_assistant_id": Uuid::new_v4().to_string() }))
        .with_bearer_token(&token)
        .await;
    assert_eq!(
        response.status_code(),
        http::StatusCode::UNPROCESSABLE_ENTITY
    );
}

/// A private assistant — one its owner never published to the hub — can be the
/// start screen, and resolving it must not depend on the assistant hub being
/// enabled at all.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_private_pick_resolves_with_the_hub_disabled(pool: Pool<Postgres>) {
    let mut app_config = hermetic_app_config(None, None);
    app_config.assistant_hub.enabled = false;
    let app_state = test_app_state(app_config, pool).await;
    let server = create_test_server(app_state.clone());

    let token = JwtTokenBuilder::new()
        .subject("starting-assistant-private-owner")
        .email("starting-assistant-private-owner@example.com")
        .build();
    let user = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "starting-assistant-private-owner",
        Some("starting-assistant-private-owner@example.com"),
    )
    .await
    .expect("failed to create user");
    let private_assistant =
        create_source_assistant(&app_state, &user.id.to_string(), "My Own Assistant").await;

    let profile = put_preferences(
        &server,
        &token,
        json!({
            "preference_starting_assistant_id": private_assistant.id.to_string()
        }),
    )
    .await;
    assert_eq!(
        profile["preference_starting_assistant_id"],
        private_assistant.id.to_string()
    );

    let body = get_starting_assistant(&server, &token).await;
    let resolved = &body["starting_assistant"];
    assert_eq!(resolved["source"], "user_pick");
    assert_eq!(resolved["assistant_id"], private_assistant.id.to_string());
    assert!(
        resolved.get("assistant_hub_assistant_id").is_none(),
        "an assistant that was never published to the hub has no hub id to report"
    );
}

/// The two pick kinds are alternatives: setting one must remove the other, in
/// both directions, and a clear must remove whichever is stored.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_pick_kinds_replace_each_other(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let owner_token = JwtTokenBuilder::new()
        .subject("starting-assistant-swap-owner")
        .email("starting-assistant-swap-owner@example.com")
        .build();
    let reviewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-swap-reviewer")
        .email("starting-assistant-swap-reviewer@example.com")
        .groups(vec![REVIEWER_GROUP_ID.to_string()])
        .build();
    let viewer_token = JwtTokenBuilder::new()
        .subject("starting-assistant-swap-viewer")
        .email("starting-assistant-swap-viewer@example.com")
        .groups(vec![AUDIENCE_GROUP_ID.to_string()])
        .build();

    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "starting-assistant-swap-owner",
        Some("starting-assistant-swap-owner@example.com"),
    )
    .await
    .expect("failed to create owner");
    let viewer = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "starting-assistant-swap-viewer",
        Some("starting-assistant-swap-viewer@example.com"),
    )
    .await
    .expect("failed to create viewer");

    let source_assistant = create_source_assistant(
        &app_state,
        &owner.id.to_string(),
        "Published Swap Assistant",
    )
    .await;
    let version = publish_hub_version(
        &server,
        &owner_token,
        &reviewer_token,
        &source_assistant.id.to_string(),
        "1.0.0",
        AUDIENCE_GROUP_ID,
    )
    .await;
    let hub_id = version["hub_assistant_id"].as_str().unwrap().to_string();
    let private_assistant =
        create_source_assistant(&app_state, &viewer.id.to_string(), "Private Swap Assistant").await;

    // The dialog sends both id fields on every save, so each step below carries
    // an explicit null for the kind it is not choosing.
    let profile = put_preferences(
        &server,
        &viewer_token,
        json!({
            "preference_starting_hub_assistant_id": hub_id,
            "preference_starting_assistant_id": null
        }),
    )
    .await;
    assert_eq!(profile["preference_starting_hub_assistant_id"], hub_id);
    assert!(profile.get("preference_starting_assistant_id").is_none());
    assert_eq!(
        get_starting_assistant(&server, &viewer_token).await["starting_assistant"]["assistant_hub_assistant_id"],
        hub_id
    );

    let profile = put_preferences(
        &server,
        &viewer_token,
        json!({
            "preference_starting_hub_assistant_id": null,
            "preference_starting_assistant_id": private_assistant.id.to_string()
        }),
    )
    .await;
    assert!(
        profile
            .get("preference_starting_hub_assistant_id")
            .is_none()
    );
    assert_eq!(
        profile["preference_starting_assistant_id"],
        private_assistant.id.to_string()
    );
    let body = get_starting_assistant(&server, &viewer_token).await;
    assert_eq!(
        body["starting_assistant"]["assistant_id"],
        private_assistant.id.to_string()
    );

    // And back, so neither direction leaves a stale companion behind.
    let profile = put_preferences(
        &server,
        &viewer_token,
        json!({
            "preference_starting_hub_assistant_id": hub_id,
            "preference_starting_assistant_id": null
        }),
    )
    .await;
    assert_eq!(profile["preference_starting_hub_assistant_id"], hub_id);
    assert!(profile.get("preference_starting_assistant_id").is_none());

    let profile = put_preferences(
        &server,
        &viewer_token,
        json!({
            "preference_starting_assistant_cleared": true
        }),
    )
    .await;
    assert_eq!(profile["preference_starting_assistant_cleared"], true);
    assert!(
        profile
            .get("preference_starting_hub_assistant_id")
            .is_none()
    );
    assert!(profile.get("preference_starting_assistant_id").is_none());
    assert!(
        get_starting_assistant(&server, &viewer_token)
            .await
            .get("starting_assistant")
            .is_none()
    );
}

/// A private pick is an access check, not a lookup: naming somebody else's
/// unshared assistant stores fine (the row exists) but must degrade to the
/// welcome screen rather than handing over an assistant the caller cannot see.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_private_pick_requires_access(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let stranger_token = JwtTokenBuilder::new()
        .subject("starting-assistant-stranger")
        .email("starting-assistant-stranger@example.com")
        .build();
    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "starting-assistant-foreign-owner",
        Some("starting-assistant-foreign-owner@example.com"),
    )
    .await
    .expect("failed to create owner");
    let foreign_assistant = create_source_assistant(
        &app_state,
        &owner.id.to_string(),
        "Somebody Else's Assistant",
    )
    .await;

    put_preferences(
        &server,
        &stranger_token,
        json!({
            "preference_starting_assistant_id": foreign_assistant.id.to_string()
        }),
    )
    .await;

    assert!(
        get_starting_assistant(&server, &stranger_token)
            .await
            .get("starting_assistant")
            .is_none(),
        "a pick the caller cannot access must degrade to the welcome screen"
    );
}

/// A well-formed uuid naming an assistant that does not exist gets the same
/// 422 as the hub-id equivalent, not a foreign key violation swallowed into a
/// 500.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_starting_assistant_private_pick_rejects_nonexistent_assistant(pool: Pool<Postgres>) {
    let app_state = test_app_state(starting_assistant_app_config(), pool).await;
    let server = create_test_server(app_state.clone());

    let token = JwtTokenBuilder::new()
        .subject("starting-assistant-nonexistent-private-pick")
        .email("starting-assistant-nonexistent-private-pick@example.com")
        .build();

    let response = server
        .put("/api/v1beta/me/profile/preferences")
        .json(&json!({ "preference_starting_assistant_id": Uuid::new_v4().to_string() }))
        .with_bearer_token(&token)
        .await;
    assert_eq!(
        response.status_code(),
        http::StatusCode::UNPROCESSABLE_ENTITY
    );
}
