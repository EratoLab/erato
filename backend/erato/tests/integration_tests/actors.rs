//! Actor and background worker tests.

use crate::test_utils::{
    TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt, setup_mock_llm_server,
};
use crate::{MIGRATOR, test_app_state};
use axum_test::TestServer;
use chrono::{Duration, Utc};
use erato::actors::cleanup_worker::{CleanupWorkerArgs, cleanup_archived_chats, run_cleanup_tick};
use erato::actors::cron_jobs::CleanupTickJob;
use erato::actors::supervisor::WorkerNames;
use erato::db::entity::chats;
use erato::db::entity::{assistants, chat_file_uploads, file_uploads, messages, share_links};
use erato::models::chat::auto_archive_stale_delegated_runs;
use ractor::registry;
use ractor_actors::time::cron::Job;
use sea_orm::prelude::{DateTimeWithTimeZone, Uuid};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};

/// Test the cleanup worker logic for archived chats.
///
/// # Test Categories
/// - `uses-db`
/// - `e2e-flow`
/// - `sse-streaming`
/// - `auth-required`
///
/// # Test Behavior
/// This test verifies the background cleanup worker functionality:
/// - Creates multiple chats via API
/// - Archives chats with different timestamps
/// - Runs the cleanup worker with a retention period
/// - Verifies that only chats older than the retention period are deleted
/// - Ensures recently archived chats are preserved
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_cleanup_logic(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let server = TestServer::new(
        erato::server::router::router(app_state.clone())
            .split_for_parts()
            .0
            .with_state(app_state.clone()),
    )
    .expect("Failed to create test server");

    let mut chat_ids = Vec::new();

    for i in 0..2 {
        let response = server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({ "user_message": format!("Chat {}", i) }))
            .await;
        response.assert_status_ok();

        let body = response.as_bytes();
        let body_str = String::from_utf8_lossy(body);
        let events: Vec<String> = body_str
            .split("\n\n")
            .filter(|chunk| chunk.contains("data:"))
            .map(|chunk| chunk.to_string())
            .collect();

        let chat_id = events
            .iter()
            .find_map(|event| {
                let data = event.split("data:").nth(1).unwrap_or("").trim();
                if let Ok(json) = serde_json::from_str::<Value>(data)
                    && json["message_type"] == "chat_created"
                {
                    return json["chat_id"].as_str().map(|s| s.to_string());
                }
                None
            })
            .unwrap_or_else(|| panic!("Did not find chat_created event for chat {}", i));
        chat_ids.push(sea_orm::prelude::Uuid::parse_str(&chat_id).unwrap());
    }
    // Verify
    let remaining_chats = chats::Entity::find().all(&app_state.db).await.unwrap();
    assert_eq!(remaining_chats.len(), 2);

    // Archive chat 0 (to be deleted)
    let chat1_model = chats::ActiveModel {
        id: ActiveValue::Unchanged(chat_ids[0]),
        archived_at: ActiveValue::Set(Some((Utc::now() - Duration::days(10)).into())),
        ..Default::default()
    };
    chat1_model.update(&app_state.db).await.unwrap();

    // Archive chat 1 (to be kept)
    let chat2_model = chats::ActiveModel {
        id: ActiveValue::Unchanged(chat_ids[1]),
        archived_at: ActiveValue::Set(Some(Utc::now().into())),
        ..Default::default()
    };
    chat2_model.update(&app_state.db).await.unwrap();

    // Run cleanup
    cleanup_archived_chats(&app_state.db, 7).await.unwrap();

    // Verify
    let remaining_chats = chats::Entity::find().all(&app_state.db).await.unwrap();
    assert_eq!(remaining_chats.len(), 1);
    assert_eq!(remaining_chats[0].id, chat_ids[1]);
}

/// Test the cleanup worker logic for archived chats with file uploads.
///
/// # Test Categories
/// - `uses-db`
/// - `e2e-flow`
/// - `auth-required`
///
/// # Test Behavior
/// This test verifies that the cleanup worker can successfully delete chats that have
/// attached file uploads by properly handling the database relations:
/// - Creates a chat with attached file uploads
/// - Archives the chat with an old timestamp
/// - Runs the cleanup worker with a retention period
/// - Verifies that the chat is deleted and file upload relations are nullified
/// - Ensures file upload entries remain as orphaned records
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_cleanup_logic_with_file_uploads(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let server = TestServer::new(
        erato::server::router::router(app_state.clone())
            .split_for_parts()
            .0
            .with_state(app_state.clone()),
    )
    .expect("Failed to create test server");

    // Create a chat
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "Test chat with file" }))
        .await;
    response.assert_status_ok();

    let body = response.as_bytes();
    let body_str = String::from_utf8_lossy(body);
    let events: Vec<String> = body_str
        .split("\n\n")
        .filter(|chunk| chunk.contains("data:"))
        .map(|chunk| chunk.to_string())
        .collect();

    let chat_id = events
        .iter()
        .find_map(|event| {
            let data = event.split("data:").nth(1).unwrap_or("").trim();
            if let Ok(json) = serde_json::from_str::<Value>(data)
                && json["message_type"] == "chat_created"
            {
                return json["chat_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Did not find chat_created event");
    let chat_uuid = sea_orm::prelude::Uuid::parse_str(&chat_id).unwrap();

    // Create file uploads (independent of chat)
    let file_upload1_id = sea_orm::prelude::Uuid::new_v4();
    let file_upload1 = file_uploads::ActiveModel {
        id: ActiveValue::Set(file_upload1_id),
        owner_user_id: ActiveValue::Set("test-user".to_string()),
        filename: ActiveValue::Set("test_file1.txt".to_string()),
        file_storage_provider_id: ActiveValue::Set("local".to_string()),
        file_storage_path: ActiveValue::Set("/uploads/test_file1.txt".to_string()),
        audio_transcription: ActiveValue::Set(None),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    file_upload1.insert(&app_state.db).await.unwrap();

    let file_upload2_id = sea_orm::prelude::Uuid::new_v4();
    let file_upload2 = file_uploads::ActiveModel {
        id: ActiveValue::Set(file_upload2_id),
        owner_user_id: ActiveValue::Set("test-user".to_string()),
        filename: ActiveValue::Set("test_file2.pdf".to_string()),
        file_storage_provider_id: ActiveValue::Set("s3".to_string()),
        file_storage_path: ActiveValue::Set("/bucket/test_file2.pdf".to_string()),
        audio_transcription: ActiveValue::Set(None),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    file_upload2.insert(&app_state.db).await.unwrap();

    // Create relations in chat_file_uploads join table
    let chat_file_upload1 = chat_file_uploads::ActiveModel {
        chat_id: ActiveValue::Set(chat_uuid),
        file_upload_id: ActiveValue::Set(file_upload1_id),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    chat_file_upload1.insert(&app_state.db).await.unwrap();

    let chat_file_upload2 = chat_file_uploads::ActiveModel {
        chat_id: ActiveValue::Set(chat_uuid),
        file_upload_id: ActiveValue::Set(file_upload2_id),
        created_at: ActiveValue::Set(Utc::now().into()),
        updated_at: ActiveValue::Set(Utc::now().into()),
    };
    chat_file_upload2.insert(&app_state.db).await.unwrap();

    // Verify initial state
    let chats = chats::Entity::find().all(&app_state.db).await.unwrap();
    assert_eq!(chats.len(), 1);
    assert_eq!(chats[0].id, chat_uuid);

    // Verify file uploads exist
    let file_uploads = file_uploads::Entity::find()
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(file_uploads.len(), 2);

    // Verify join table relations exist
    let chat_file_uploads = chat_file_uploads::Entity::find()
        .filter(chat_file_uploads::Column::ChatId.eq(chat_uuid))
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(chat_file_uploads.len(), 2);

    // Archive the chat with an old timestamp (older than retention period)
    let chat_model = chats::ActiveModel {
        id: ActiveValue::Unchanged(chat_uuid),
        archived_at: ActiveValue::Set(Some((Utc::now() - Duration::days(10)).into())),
        ..Default::default()
    };
    chat_model.update(&app_state.db).await.unwrap();

    // Run cleanup (should delete the chat and join table relations, but preserve file uploads)
    cleanup_archived_chats(&app_state.db, 7).await.unwrap();

    // Verify chat is deleted
    let remaining_chats = chats::Entity::find().all(&app_state.db).await.unwrap();
    assert_eq!(
        remaining_chats.len(),
        0,
        "Chat should be deleted by cleanup worker"
    );

    // Verify join table relations are deleted
    let remaining_chat_file_uploads = chat_file_uploads::Entity::find()
        .filter(chat_file_uploads::Column::ChatId.eq(chat_uuid))
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(
        remaining_chat_file_uploads.len(),
        0,
        "Chat-file upload relations should be deleted"
    );

    // Verify file uploads are preserved (orphaned but not deleted)
    let remaining_file_uploads = file_uploads::Entity::find()
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(
        remaining_file_uploads.len(),
        2,
        "File uploads should be preserved as orphaned records"
    );
}

async fn insert_assistant(db: &DatabaseConnection, owner_user_id: Uuid) -> Uuid {
    let now: DateTimeWithTimeZone = Utc::now().into();
    let id = Uuid::new_v4();
    assistants::Entity::insert(assistants::ActiveModel {
        id: ActiveValue::Set(id),
        owner_user_id: ActiveValue::Set(owner_user_id),
        name: ActiveValue::Set("Retention Assistant".to_string()),
        description: ActiveValue::Set(None),
        prompt: ActiveValue::Set("prompt".to_string()),
        mcp_server_ids: ActiveValue::Set(None),
        default_chat_provider: ActiveValue::Set(None),
        archived_at: ActiveValue::Set(None),
        created_at: ActiveValue::Set(now),
        updated_at: ActiveValue::Set(now),
        facet_ids: ActiveValue::Set(None),
        enforce_facet_settings: ActiveValue::Set(false),
    })
    .exec(db)
    .await
    .expect("insert assistant");
    id
}

fn provenance_configuration(assistant_id: Uuid, origin_chat_id: Uuid, kind: &str) -> Value {
    json!({
        "assistant_id": assistant_id,
        "provenance": {
            "kind": kind,
            "origin_chat_id": origin_chat_id,
            "depth": 1,
        },
    })
}

fn delegation_configuration(assistant_id: Uuid, origin_chat_id: Uuid) -> Value {
    provenance_configuration(assistant_id, origin_chat_id, "delegation")
}

async fn insert_chat(
    db: &DatabaseConnection,
    owner_user_id: &str,
    assistant_configuration: Option<Value>,
    created_at: DateTimeWithTimeZone,
) -> Uuid {
    let id = Uuid::new_v4();
    chats::Entity::insert(chats::ActiveModel {
        id: ActiveValue::Set(id),
        owner_user_id: ActiveValue::Set(owner_user_id.to_string()),
        assistant_configuration: ActiveValue::Set(assistant_configuration),
        created_at: ActiveValue::Set(created_at),
        updated_at: ActiveValue::Set(created_at),
        ..Default::default()
    })
    .exec(db)
    .await
    .expect("insert chat");
    id
}

async fn insert_message(db: &DatabaseConnection, chat_id: Uuid, created_at: DateTimeWithTimeZone) {
    messages::Entity::insert(messages::ActiveModel {
        id: ActiveValue::Set(Uuid::new_v4()),
        chat_id: ActiveValue::Set(chat_id),
        raw_message: ActiveValue::Set(
            json!({"role": "user", "content": [{"content_type": "text", "text": "task"}]}),
        ),
        created_at: ActiveValue::Set(created_at),
        updated_at: ActiveValue::Set(created_at),
        is_message_in_active_thread: ActiveValue::Set(true),
        ..Default::default()
    })
    .exec(db)
    .await
    .expect("insert message");
}

async fn insert_share_link(
    db: &DatabaseConnection,
    chat_id: Uuid,
    created_at: DateTimeWithTimeZone,
) -> Uuid {
    let id = Uuid::new_v4();
    share_links::Entity::insert(share_links::ActiveModel {
        id: ActiveValue::Set(id),
        resource_type: ActiveValue::Set("chat".to_string()),
        resource_id: ActiveValue::Set(chat_id.to_string()),
        enabled: ActiveValue::Set(true),
        created_at: ActiveValue::Set(created_at),
        updated_at: ActiveValue::Set(created_at),
    })
    .exec(db)
    .await
    .expect("insert share link");
    id
}

async fn mark_adopted(db: &DatabaseConnection, chat_id: Uuid) {
    let chat = chats::Entity::find_by_id(chat_id)
        .one(db)
        .await
        .unwrap()
        .expect("chat should exist");
    erato::models::chat::mark_delegated_run_adopted(db, &chat)
        .await
        .expect("mark adopted");
}

async fn set_chat_columns(db: &DatabaseConnection, chat_id: Uuid, mut active: chats::ActiveModel) {
    active.id = ActiveValue::Unchanged(chat_id);
    active.update(db).await.expect("update chat");
}

async fn archived_at_of(db: &DatabaseConnection, chat_id: Uuid) -> Option<DateTimeWithTimeZone> {
    chats::Entity::find_by_id(chat_id)
        .one(db)
        .await
        .unwrap()
        .expect("chat should still exist")
        .archived_at
}

/// Blast radius of the delegated-run retention pipeline. The auto-archive pass
/// must reach nothing but delegated runs that went quiet, and the delete pass
/// must reach nothing but chats archived past the retention window.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_delegated_run_retention_blast_radius(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let db = &app_state.db;

    let me = erato::models::user::get_or_create_user(db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let other =
        erato::models::user::get_or_create_user(db, TEST_USER_ISSUER, "retention-other", None)
            .await
            .unwrap();
    let me_id = me.id.to_string();
    let other_id = other.id.to_string();
    let assistant = insert_assistant(db, me.id).await;

    let long_ago: DateTimeWithTimeZone = (Utc::now() - Duration::days(30)).into();
    let yesterday: DateTimeWithTimeZone = (Utc::now() - Duration::days(1)).into();
    let now: DateTimeWithTimeZone = Utc::now().into();

    let origin = insert_chat(db, &me_id, None, long_ago).await;
    insert_message(db, origin, long_ago).await;

    let shared = insert_chat(db, &me_id, None, long_ago).await;
    insert_message(db, shared, long_ago).await;
    let share_link_id = insert_share_link(db, shared, long_ago).await;

    let recently_archived = insert_chat(db, &me_id, None, long_ago).await;
    insert_message(db, recently_archived, long_ago).await;
    set_chat_columns(
        db,
        recently_archived,
        chats::ActiveModel {
            archived_at: ActiveValue::Set(Some(now)),
            ..Default::default()
        },
    )
    .await;

    let other_user_chat = insert_chat(db, &other_id, None, long_ago).await;
    insert_message(db, other_user_chat, long_ago).await;

    let assistant_chat = insert_chat(
        db,
        &me_id,
        Some(json!({ "assistant_id": assistant })),
        long_ago,
    )
    .await;
    insert_message(db, assistant_chat, long_ago).await;

    let handoff_branch = insert_chat(
        db,
        &me_id,
        Some(provenance_configuration(
            assistant,
            origin,
            "handoff_branch",
        )),
        long_ago,
    )
    .await;
    insert_message(db, handoff_branch, long_ago).await;

    let configuration = delegation_configuration(assistant, origin);
    let fresh_run = insert_chat(db, &me_id, Some(configuration.clone()), long_ago).await;
    insert_message(db, fresh_run, yesterday).await;

    let pinned_run = insert_chat(db, &me_id, Some(configuration.clone()), long_ago).await;
    insert_message(db, pinned_run, long_ago).await;
    set_chat_columns(
        db,
        pinned_run,
        chats::ActiveModel {
            is_pinned: ActiveValue::Set(true),
            ..Default::default()
        },
    )
    .await;

    let running_run = insert_chat(db, &me_id, Some(configuration.clone()), long_ago).await;
    insert_message(db, running_run, long_ago).await;
    set_chat_columns(
        db,
        running_run,
        chats::ActiveModel {
            generation_state: ActiveValue::Set(Some("running".to_string())),
            generation_started_at: ActiveValue::Set(Some(now)),
            generation_heartbeat_at: ActiveValue::Set(Some(now)),
            ..Default::default()
        },
    )
    .await;

    let parked_run = insert_chat(db, &me_id, Some(configuration.clone()), long_ago).await;
    insert_message(db, parked_run, long_ago).await;
    set_chat_columns(
        db,
        parked_run,
        chats::ActiveModel {
            generation_state: ActiveValue::Set(Some("awaiting_approval".to_string())),
            generation_started_at: ActiveValue::Set(Some(long_ago)),
            generation_ended_at: ActiveValue::Set(Some(long_ago)),
            ..Default::default()
        },
    )
    .await;

    let other_user_run = insert_chat(db, &other_id, Some(configuration.clone()), long_ago).await;
    insert_message(db, other_user_run, yesterday).await;

    // Seeded context carries the timestamps of the conversation it was copied
    // from, which are older than the run that is about to start.
    let seeded_run = insert_chat(db, &me_id, Some(configuration.clone()), now).await;
    insert_message(db, seeded_run, long_ago).await;

    let shared_run = insert_chat(db, &me_id, Some(configuration.clone()), long_ago).await;
    insert_message(db, shared_run, long_ago).await;
    let run_share_link_id = insert_share_link(db, shared_run, long_ago).await;

    let adopted_run = insert_chat(db, &me_id, Some(configuration.clone()), long_ago).await;
    insert_message(db, adopted_run, long_ago).await;
    mark_adopted(db, adopted_run).await;

    let stale_run = insert_chat(db, &me_id, Some(configuration), long_ago).await;
    insert_message(db, stale_run, long_ago).await;

    let old_archived = insert_chat(db, &me_id, None, long_ago).await;
    insert_message(db, old_archived, long_ago).await;
    set_chat_columns(
        db,
        old_archived,
        chats::ActiveModel {
            archived_at: ActiveValue::Set(Some((Utc::now() - Duration::days(40)).into())),
            ..Default::default()
        },
    )
    .await;

    let archived = auto_archive_stale_delegated_runs(db, 7, 30).await.unwrap();
    assert_eq!(archived, 1, "only the quiet delegated run may be archived");
    cleanup_archived_chats(db, 30).await.unwrap();

    let remaining: Vec<Uuid> = chats::Entity::find()
        .all(db)
        .await
        .unwrap()
        .into_iter()
        .map(|chat| chat.id)
        .collect();
    assert!(
        !remaining.contains(&old_archived),
        "a chat archived past the window must be deleted"
    );
    for (label, id) in [
        ("origin chat", origin),
        ("shared chat", shared),
        ("recently archived chat", recently_archived),
        ("another user's chat", other_user_chat),
        ("assistant chat without provenance", assistant_chat),
        ("chat spawned by a handoff", handoff_branch),
        ("delegated run inside its window", fresh_run),
        ("pinned delegated run", pinned_run),
        ("running delegated run", running_run),
        ("parked delegated run", parked_run),
        ("another user's delegated run", other_user_run),
        ("delegated run seeded with older context", seeded_run),
        ("shared delegated run", shared_run),
        ("delegated run the user wrote into", adopted_run),
        ("just-archived delegated run", stale_run),
    ] {
        assert!(remaining.contains(&id), "{label} must survive the cleanup");
    }

    for (label, id) in [
        ("origin chat", origin),
        ("shared chat", shared),
        ("another user's chat", other_user_chat),
        ("assistant chat without provenance", assistant_chat),
        ("chat spawned by a handoff", handoff_branch),
        ("delegated run inside its window", fresh_run),
        ("pinned delegated run", pinned_run),
        ("running delegated run", running_run),
        ("parked delegated run", parked_run),
        ("another user's delegated run", other_user_run),
        ("delegated run seeded with older context", seeded_run),
        ("shared delegated run", shared_run),
        ("delegated run the user wrote into", adopted_run),
    ] {
        assert!(
            archived_at_of(db, id).await.is_none(),
            "{label} must not be archived"
        );
    }
    assert!(archived_at_of(db, stale_run).await.is_some());

    for (label, id) in [
        ("a surviving chat", share_link_id),
        ("a surviving delegated run", run_share_link_id),
    ] {
        assert!(
            share_links::Entity::find_by_id(id)
                .one(db)
                .await
                .unwrap()
                .is_some(),
            "the share link of {label} must be untouched"
        );
    }
    let orphaned_messages = messages::Entity::find()
        .filter(messages::Column::ChatId.is_not_in(remaining))
        .all(db)
        .await
        .unwrap();
    assert!(orphaned_messages.is_empty());
}

/// A delegated run is auto-archived once it has been quiet for the configured
/// number of days and not before. The clock is the run's last message, so a run
/// that never wrote one ages from its creation instead, and a configured zero
/// leaves every run alone.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn test_delegated_run_auto_archive_age_boundary(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let db = &app_state.db;

    let me = erato::models::user::get_or_create_user(db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let me_id = me.id.to_string();
    let assistant = insert_assistant(db, me.id).await;

    let created: DateTimeWithTimeZone = (Utc::now() - Duration::days(30)).into();
    let origin = insert_chat(db, &me_id, None, created).await;
    let configuration = delegation_configuration(assistant, origin);

    let run = insert_chat(db, &me_id, Some(configuration.clone()), created).await;
    insert_message(db, run, (Utc::now() - Duration::days(6)).into()).await;

    assert_eq!(
        auto_archive_stale_delegated_runs(db, 7, 30).await.unwrap(),
        0
    );
    assert!(archived_at_of(db, run).await.is_none());

    messages::Entity::update_many()
        .col_expr(
            messages::Column::CreatedAt,
            sea_orm::sea_query::Expr::value(DateTimeWithTimeZone::from(
                Utc::now() - Duration::days(8),
            )),
        )
        .filter(messages::Column::ChatId.eq(run))
        .exec(db)
        .await
        .unwrap();

    // A run that crashed before writing anything ages from its creation.
    let never_ran = insert_chat(
        db,
        &me_id,
        Some(configuration),
        (Utc::now() - Duration::days(8)).into(),
    )
    .await;

    assert_eq!(
        auto_archive_stale_delegated_runs(db, 0, 30).await.unwrap(),
        0,
        "no age at all turns the pass off"
    );
    assert!(archived_at_of(db, run).await.is_none());

    assert_eq!(
        auto_archive_stale_delegated_runs(db, 7, 30).await.unwrap(),
        2
    );
    assert!(archived_at_of(db, run).await.is_some());
    assert!(archived_at_of(db, never_ran).await.is_some());
}

/// The registry `ractor` keeps is process-global and nothing ever unregisters,
/// so a supervisor that registers timed children under hardcoded literals can
/// only ever exist once per process. Tests build one `ActorManager` per test —
/// hundreds of them in one binary under `cargo test` — so an unnamed supervisor
/// must register nothing at all. Uniquifying the names instead would also start
/// a real `0 */5 * * * *` cron inside a process whose sqlx database is dropped
/// when the test ends.
///
/// # Test Categories
/// - `uses-db`
///
/// # Test Behavior
/// Builds an `AppState` (whose supervisor is unnamed) with cleanup *and* both
/// delegation routes enabled, and asserts that it added no timed worker to the
/// registry.
#[sqlx::test(migrator = "MIGRATOR")]
async fn unnamed_supervisor_starts_no_timed_workers(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    // Everything that could possibly gate the spawn is on: the only thing left
    // to keep the registry empty is the supervisor being unnamed.
    app_config.cleanup_enabled = true;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.tasks.enabled = true;

    // Compared as a diff rather than against the whole registry so that a
    // sibling test which legitimately registers a named supervisor's workers
    // cannot make this one flaky under the single-process `cargo test` runner.
    let before = registry::registered();
    let _app_state = test_app_state(app_config, pool).await;
    let added: Vec<String> = registry::registered()
        .into_iter()
        .filter(|name| !before.contains(name))
        .collect();

    for name in &added {
        assert!(
            !name.ends_with("cleanup_worker") && !name.ends_with("cleanup_worker_cron"),
            "an unnamed supervisor must start no timed children, but registered '{name}'"
        );
    }
    assert!(
        registry::where_is("cleanup_worker".to_string()).is_none(),
        "the bare literal must never be registered again: it is what made a second manager panic"
    );
    assert!(
        registry::where_is("cleanup_worker_cron".to_string()).is_none(),
        "the bare literal must never be registered again: it is what made a second manager panic"
    );
}

/// Two `AppState`s over one pool is the in-process shape of the two-replica
/// delivery tests. It is also the only assertion in this file that survives
/// nextest's process-per-test isolation, so it is the real guard on the
/// registry hazard: a duplicate registration is `SpawnErr::ActorAlreadyRegistered`,
/// which the supervisor's `.expect()` turns into a panic.
///
/// # Test Categories
/// - `uses-db`
///
/// # Test Behavior
/// Builds two managers over one pool with cleanup and delegated tasks enabled,
/// and asserts that neither panics and neither registers a timed worker.
#[sqlx::test(migrator = "MIGRATOR")]
async fn two_managers_in_one_process_do_not_panic(pool: Pool<Postgres>) {
    let (mut app_config_a, _llm_a) = setup_mock_llm_server(None).await;
    app_config_a.cleanup_enabled = true;
    app_config_a.delegation.tasks.enabled = true;
    let (mut app_config_b, _llm_b) = setup_mock_llm_server(None).await;
    app_config_b.cleanup_enabled = true;
    app_config_b.delegation.tasks.enabled = true;

    let before = registry::registered();
    let _replica_a = test_app_state(app_config_a, pool.clone()).await;
    let _replica_b = test_app_state(app_config_b, pool.clone()).await;

    let added: Vec<String> = registry::registered()
        .into_iter()
        .filter(|name| !before.contains(name))
        .collect();
    assert!(
        added.is_empty(),
        "two unnamed managers in one process must register nothing, but added {added:?}"
    );
}

/// The cron manager looks the worker up by name at tick time, so the name the
/// worker registers under and the name the job looks up are two halves of one
/// contract. If they drift the tick is not an error: `where_is` simply returns
/// `None` forever and the tick is skipped behind a `warn!`.
///
/// # Test Categories
/// - `uses-db`
///
/// # Test Behavior
/// Spawns a *named* supervisor, asserts both children registered under exactly
/// the derived names, then drives a tick through the derived worker name and
/// asserts the retention pass actually ran — which is what a swapped pair would
/// break while leaving the registry contents looking correct.
#[sqlx::test(migrator = "MIGRATOR")]
async fn named_supervisor_derives_both_worker_names(pool: Pool<Postgres>) {
    let names = WorkerNames::derived_from("worker_supervisor");
    assert_eq!(names.cleanup_worker, "worker_supervisor.cleanup_worker");
    assert_eq!(
        names.cleanup_worker_cron,
        "worker_supervisor.cleanup_worker_cron"
    );

    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    app_config.cleanup_enabled = true;
    app_config.cleanup_archived_max_age_days = 30;

    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let me = erato::models::user::get_or_create_user(&db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let long_ago: DateTimeWithTimeZone = (Utc::now() - Duration::days(40)).into();
    let old_archived = insert_chat(&db, &me.id.to_string(), None, long_ago).await;
    set_chat_columns(
        &db,
        old_archived,
        chats::ActiveModel {
            archived_at: ActiveValue::Set(Some(long_ago)),
            ..Default::default()
        },
    )
    .await;

    // Unique per test so that the single-process runner cannot collide with a
    // sibling test's supervisor.
    let supervisor_name = format!("test_sup_{}", Uuid::new_v4());
    let derived = WorkerNames::derived_from(&supervisor_name);
    let _manager = erato::actors::manager::ActorManager::new_with_name(
        db.clone(),
        app_config,
        Some(supervisor_name.clone()),
    )
    .await;

    assert!(
        registry::where_is(derived.cleanup_worker.clone()).is_some(),
        "the worker must register under the supervisor-derived name"
    );
    assert!(
        registry::where_is(derived.cleanup_worker_cron.clone()).is_some(),
        "the cron manager must register under the supervisor-derived name"
    );

    // The job's lookup key must resolve to the worker, not to the cron manager:
    // a swapped pair keeps both registry entries present and would pass the two
    // assertions above.
    let mut job = CleanupTickJob {
        worker_name: derived.cleanup_worker.clone(),
    };
    job.work().await.expect("tick job must dispatch");

    let mut deleted = false;
    for _ in 0..100 {
        if chats::Entity::find_by_id(old_archived)
            .one(&db)
            .await
            .unwrap()
            .is_none()
        {
            deleted = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    if let Some(supervisor) = registry::where_is(supervisor_name) {
        supervisor.stop(Some("test finished".to_string()));
    }

    assert!(
        deleted,
        "a tick addressed to the derived worker name must reach the cleanup worker"
    );
}

/// The relocation this PR exists for: the cleanup worker starts on a deployment
/// that has never opted into deleting data, because the delivery backstop rides
/// on its tick and a stranded result must be recoverable everywhere.
///
/// Asserted on the spawn predicate itself rather than on the sweep's effect,
/// because a sweep test passes either way — it drives `run_cleanup_tick`
/// directly and never reaches the supervisor.
///
/// # Test Categories
/// - `uses-db`
///
/// # Test Behavior
/// Spawns a named supervisor with `cleanup_enabled = false` and only the
/// assistants delegation route on, and asserts the worker registered anyway.
#[sqlx::test(migrator = "MIGRATOR")]
async fn named_supervisor_spawns_cleanup_worker_when_only_delegation_is_on(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    app_config.cleanup_enabled = false;
    app_config.delegation.assistants.enabled = true;

    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let supervisor_name = format!("test_sup_{}", Uuid::new_v4());
    let derived = WorkerNames::derived_from(&supervisor_name);
    let _manager = erato::actors::manager::ActorManager::new_with_name(
        db.clone(),
        app_config,
        Some(supervisor_name.clone()),
    )
    .await;

    let registered = registry::where_is(derived.cleanup_worker.clone()).is_some();

    // Stopped before the assertion so that a failure cannot leave a real
    // `0 */5 * * * *` cron ticking against a pool this test is about to drop.
    if let Some(supervisor) = registry::where_is(supervisor_name) {
        supervisor.stop(Some("test finished".to_string()));
    }

    assert!(
        registered,
        "the cleanup worker must start for delegation alone: the delivery backstop \
         deletes nothing and must not inherit the retention half's opt-in"
    );
}

/// Hand-stage a delegated `async` child of `origin_chat_id` whose result is
/// recorded and still owed.
///
/// Written straight into the column rather than run through a dispatch: the
/// sweep's whole reason to exist is the run whose own tail never got to finish,
/// so what it must recover is a row, not a process.
async fn stage_owed_delivery(
    db: &DatabaseConnection,
    owner_user_id: &str,
    origin_chat_id: Uuid,
) -> Uuid {
    let now: DateTimeWithTimeZone = Utc::now().into();
    let configuration = json!({
        "provenance": {
            "kind": "delegation",
            "origin_chat_id": origin_chat_id,
            "depth": 1,
            "run_mode": "async",
            "result_delivery": {
                "state": "pending",
                "delivery_id": Uuid::new_v4(),
                "status": "failed",
                "reason": "result_missing",
                "attempts": 0,
                "redeliveries": 0,
                "sequence": 0,
                "at": now,
            },
        },
        "task": {
            "scheduling": "silent",
            "parent_tool_call_id": "call_staged",
        },
    });
    insert_chat(db, owner_user_id, Some(configuration), now).await
}

async fn delivery_state_of(db: &DatabaseConnection, child_chat_id: Uuid) -> String {
    chats::Entity::find_by_id(child_chat_id)
        .one(db)
        .await
        .unwrap()
        .expect("child should exist")
        .assistant_configuration
        .expect("configuration")["provenance"]["result_delivery"]["state"]
        .as_str()
        .expect("state")
        .to_string()
}

/// The relocation, asserted on the tick rather than on the supervisor: the
/// delivery backstop runs on a deployment that never opted into deleting data,
/// and the retention half still does not.
///
/// `cleanup_enabled` defaults to `false`, so if the sweep sat behind it the
/// backstop would be missing exactly where a stranded result is most likely to
/// go unnoticed — which is every default deployment.
///
/// # Test Categories
/// - `uses-db`
///
/// # Test Behavior
/// Runs one tick with `cleanup_enabled = false` and asserts the owed result was
/// delivered while an old archived chat survived, then one with it `true` and
/// asserts the archived chat was finally deleted.
#[sqlx::test(migrator = "MIGRATOR")]
async fn cleanup_tick_sweeps_without_cleanup_enabled_and_archives_with_it(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let me = erato::models::user::get_or_create_user(&db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let me_id = me.id.to_string();

    let long_ago: DateTimeWithTimeZone = (Utc::now() - Duration::days(40)).into();
    let old_archived = insert_chat(&db, &me_id, None, long_ago).await;
    set_chat_columns(
        &db,
        old_archived,
        chats::ActiveModel {
            archived_at: ActiveValue::Set(Some(long_ago)),
            ..Default::default()
        },
    )
    .await;

    let origin = insert_chat(&db, &me_id, None, Utc::now().into()).await;
    let child = stage_owed_delivery(&db, &me_id, origin).await;

    let mut args = CleanupWorkerArgs {
        db: db.clone(),
        cleanup_enabled: false,
        cleanup_archived_max_age_days: 30,
        // Off: the retention pass must not be what decides this test.
        delegated_run_auto_archive_after_days: 0,
        generation_stale_after_secs: 30,
        result_max_chars: 4000,
    };
    run_cleanup_tick(&args).await.expect("tick must not fail");

    assert_eq!(
        delivery_state_of(&db, child).await,
        "delivered",
        "the backstop must deliver a stranded result on a deployment that never \
         opted into deleting data"
    );
    let delivered_rows = messages::Entity::find()
        .filter(messages::Column::ChatId.eq(origin))
        .all(&db)
        .await
        .unwrap();
    assert_eq!(
        delivered_rows.len(),
        1,
        "the origin must have received exactly one task result row"
    );
    assert!(
        chats::Entity::find_by_id(old_archived)
            .one(&db)
            .await
            .unwrap()
            .is_some(),
        "the retention half must stay behind its opt-in"
    );

    args.cleanup_enabled = true;
    run_cleanup_tick(&args).await.expect("tick must not fail");
    assert!(
        chats::Entity::find_by_id(old_archived)
            .one(&db)
            .await
            .unwrap()
            .is_none(),
        "with the opt-in set, the retention half must still run"
    );
}
