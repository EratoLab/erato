//! User preferences database tests: the tri-state starting-assistant override
//! must survive a real round-trip as three distinguishable persisted states,
//! on both the insert and the update path.

use erato::db::entity::assistant_hub_assistants;
use erato::models::assistant::create_assistant;
use erato::models::user::get_or_create_user;
use erato::models::user_preference::{
    UpdateUserPreferencesInput, get_user_preferences, upsert_user_preferences,
};
use erato::policy::engine::PolicyEngine;
use erato::policy::types::Subject;
use sea_orm::prelude::Uuid;
use sea_orm::{ActiveModelTrait, ActiveValue, DatabaseConnection};
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::MIGRATOR;

async fn create_user(conn: &DatabaseConnection, subject: &str) -> Uuid {
    get_or_create_user(conn, "test-issuer", subject, None)
        .await
        .expect("failed to create user")
        .id
}

/// Insert a minimal `assistant_hub_assistants` row so a pick can satisfy the
/// foreign key.
async fn create_hub_assistant(conn: &DatabaseConnection, owner_id: Uuid) -> Uuid {
    let assistant = create_assistant(
        conn,
        &PolicyEngine::new(),
        &Subject::User(owner_id.to_string()),
        "Tri-state fixture assistant".to_string(),
        None,
        "You are a user-preferences test fixture.".to_string(),
        None,
        None,
        None,
        false,
    )
    .await
    .expect("failed to create source assistant");

    let hub_row = assistant_hub_assistants::ActiveModel {
        id: ActiveValue::Set(Uuid::new_v4()),
        source_assistant_id: ActiveValue::Set(assistant.id),
        owner_user_id: ActiveValue::Set(owner_id),
        featured: ActiveValue::Set(false),
        ..Default::default()
    };
    hub_row
        .insert(conn)
        .await
        .expect("failed to insert hub assistant row")
        .id
}

/// The insert path (first-ever write for a user) must persist a clear: a user
/// without a preferences row who dismisses their audience pin must not see it
/// come back.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_cleared_is_distinguishable_from_never_set_on_insert(pool: Pool<Postgres>) {
    let conn = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);

    let never_set_user = create_user(&conn, "tri-state-never-set").await;
    let cleared_user = create_user(&conn, "tri-state-cleared").await;

    // "Never set" via a row created by an unrelated patch (insert path).
    upsert_user_preferences(
        &conn,
        &never_set_user,
        UpdateUserPreferencesInput {
            nickname: Some(Some("Sam".to_string())),
            ..Default::default()
        },
    )
    .await
    .expect("failed to upsert unrelated preference");

    // "Cleared" as the very first write (insert path).
    upsert_user_preferences(
        &conn,
        &cleared_user,
        UpdateUserPreferencesInput {
            starting_assistant_cleared: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("failed to clear starting assistant");

    let never_set = get_user_preferences(&conn, &never_set_user)
        .await
        .unwrap()
        .expect("never-set user should have a row");
    assert_eq!(never_set.starting_hub_assistant_id, None);
    assert!(!never_set.starting_assistant_cleared);

    let cleared = get_user_preferences(&conn, &cleared_user)
        .await
        .unwrap()
        .expect("cleared user should have a row");
    assert_eq!(cleared.starting_hub_assistant_id, None);
    assert!(
        cleared.starting_assistant_cleared,
        "an explicit clear must survive the database round-trip distinctly from never-set"
    );
}

/// A pick as the very first write (insert path) round-trips, and clearing
/// afterwards (update path) nulls the pick while keeping the clear.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_pick_then_clear_round_trip(pool: Pool<Postgres>) {
    let conn = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);

    let user_id = create_user(&conn, "tri-state-pick").await;
    let hub_id = create_hub_assistant(&conn, user_id).await;

    // Insert path: the pick is the first-ever preference write.
    upsert_user_preferences(
        &conn,
        &user_id,
        UpdateUserPreferencesInput {
            starting_hub_assistant_id: Some(Some(hub_id)),
            ..Default::default()
        },
    )
    .await
    .expect("failed to store pick");

    let picked = get_user_preferences(&conn, &user_id)
        .await
        .unwrap()
        .expect("row should exist after pick");
    assert_eq!(picked.starting_hub_assistant_id, Some(hub_id));
    assert!(!picked.starting_assistant_cleared);

    // Update path: clearing must null the pick (and satisfy the CHECK
    // constraint on the way).
    upsert_user_preferences(
        &conn,
        &user_id,
        UpdateUserPreferencesInput {
            starting_assistant_cleared: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("failed to clear after pick");

    let cleared = get_user_preferences(&conn, &user_id)
        .await
        .unwrap()
        .expect("row should still exist");
    assert_eq!(
        cleared.starting_hub_assistant_id, None,
        "clearing must remove the pick"
    );
    assert!(cleared.starting_assistant_cleared);

    // Picking again un-clears (update path).
    upsert_user_preferences(
        &conn,
        &user_id,
        UpdateUserPreferencesInput {
            starting_hub_assistant_id: Some(Some(hub_id)),
            ..Default::default()
        },
    )
    .await
    .expect("failed to re-pick");

    let repicked = get_user_preferences(&conn, &user_id)
        .await
        .unwrap()
        .expect("row should still exist");
    assert_eq!(repicked.starting_hub_assistant_id, Some(hub_id));
    assert!(
        !repicked.starting_assistant_cleared,
        "a new pick must un-clear"
    );
}

/// Unrelated preference patches must not disturb the tri-state, and a request
/// carrying both a pick and a clear resolves to cleared without tripping the
/// real CHECK constraint.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_unrelated_patches_and_conflicting_request(pool: Pool<Postgres>) {
    let conn = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);

    let user_id = create_user(&conn, "tri-state-unrelated").await;
    let hub_id = create_hub_assistant(&conn, user_id).await;

    upsert_user_preferences(
        &conn,
        &user_id,
        UpdateUserPreferencesInput {
            starting_assistant_cleared: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("failed to clear");

    // An unrelated patch (nickname) must leave the clear untouched.
    upsert_user_preferences(
        &conn,
        &user_id,
        UpdateUserPreferencesInput {
            nickname: Some(Some("Alex".to_string())),
            ..Default::default()
        },
    )
    .await
    .expect("failed to patch nickname");

    let prefs = get_user_preferences(&conn, &user_id)
        .await
        .unwrap()
        .expect("row should exist");
    assert_eq!(prefs.nickname.as_deref(), Some("Alex"));
    assert_eq!(prefs.starting_hub_assistant_id, None);
    assert!(
        prefs.starting_assistant_cleared,
        "an unrelated patch must not reset the clear"
    );

    // Conflicting request: pick + clear together resolves to cleared.
    upsert_user_preferences(
        &conn,
        &user_id,
        UpdateUserPreferencesInput {
            starting_hub_assistant_id: Some(Some(hub_id)),
            starting_assistant_cleared: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("conflicting request should not violate the CHECK constraint");

    let prefs = get_user_preferences(&conn, &user_id)
        .await
        .unwrap()
        .expect("row should exist");
    assert_eq!(prefs.starting_hub_assistant_id, None);
    assert!(prefs.starting_assistant_cleared);
}

/// Insert an `assistants` row a private pick can point at.
async fn create_plain_assistant(conn: &DatabaseConnection, owner_id: Uuid) -> Uuid {
    create_assistant(
        conn,
        &PolicyEngine::new(),
        &Subject::User(owner_id.to_string()),
        "Private fixture assistant".to_string(),
        None,
        "You are a private user-preferences test fixture.".to_string(),
        None,
        None,
        None,
        false,
    )
    .await
    .expect("failed to create private assistant")
    .id
}

/// The two pick kinds are alternatives, and the exclusion has to hold against
/// the real `..._single_pick_check` constraint — on the insert path as well as
/// the update path, and in both swap directions.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_the_two_pick_kinds_are_mutually_exclusive(pool: Pool<Postgres>) {
    let conn = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);

    let user_id = create_user(&conn, "two-kinds-swapper").await;
    let hub_id = create_hub_assistant(&conn, user_id).await;
    let assistant_id = create_plain_assistant(&conn, user_id).await;

    // Insert path with both kinds at once: the hub pick wins, and the write
    // must not trip the constraint.
    upsert_user_preferences(
        &conn,
        &user_id,
        UpdateUserPreferencesInput {
            starting_hub_assistant_id: Some(Some(hub_id)),
            starting_assistant_id: Some(Some(assistant_id)),
            ..Default::default()
        },
    )
    .await
    .expect("conflicting picks should not violate the CHECK constraint");

    let prefs = get_user_preferences(&conn, &user_id)
        .await
        .unwrap()
        .expect("row should exist");
    assert_eq!(prefs.starting_hub_assistant_id, Some(hub_id));
    assert_eq!(prefs.starting_assistant_id, None);

    // Update path: the private pick replaces the hub pick.
    upsert_user_preferences(
        &conn,
        &user_id,
        UpdateUserPreferencesInput {
            starting_assistant_id: Some(Some(assistant_id)),
            ..Default::default()
        },
    )
    .await
    .expect("failed to swap to the private pick");

    let prefs = get_user_preferences(&conn, &user_id)
        .await
        .unwrap()
        .expect("row should exist");
    assert_eq!(prefs.starting_hub_assistant_id, None);
    assert_eq!(prefs.starting_assistant_id, Some(assistant_id));
    assert!(!prefs.starting_assistant_cleared);

    // And back.
    upsert_user_preferences(
        &conn,
        &user_id,
        UpdateUserPreferencesInput {
            starting_hub_assistant_id: Some(Some(hub_id)),
            ..Default::default()
        },
    )
    .await
    .expect("failed to swap back to the hub pick");

    let prefs = get_user_preferences(&conn, &user_id)
        .await
        .unwrap()
        .expect("row should exist");
    assert_eq!(prefs.starting_hub_assistant_id, Some(hub_id));
    assert_eq!(prefs.starting_assistant_id, None);

    // A clear removes whichever kind is stored.
    upsert_user_preferences(
        &conn,
        &user_id,
        UpdateUserPreferencesInput {
            starting_assistant_cleared: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("failed to clear");

    let prefs = get_user_preferences(&conn, &user_id)
        .await
        .unwrap()
        .expect("row should exist");
    assert_eq!(prefs.starting_hub_assistant_id, None);
    assert_eq!(prefs.starting_assistant_id, None);
    assert!(prefs.starting_assistant_cleared);
}
