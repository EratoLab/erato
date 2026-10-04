//! Teams revisions use the same persistent branches as Web generations.

use super::*;
use crate::test_utils::{build_openai_text_streaming_response, setup_mock_llm_server_with_mocks};
use erato::ms_teams_bot::host::{Session, StartError, TeamsRequest};
use erato::state::AppState;
use mocktail::MockSet;
use mocktail::server::MockServer;
use sea_orm::prelude::Uuid;
use serde_json::json;
use std::time::Duration;

const CONVERSATION: &str = "a:revision-test";
const FILE_CONTENT: &str = "Original attachment content.";

struct Fixture {
    state: AppState,
    host: Host,
    session: Session,
    chat_id: Uuid,
    _server: MockServer,
}

async fn fixture(pool: Pool<Postgres>) -> Fixture {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");
        then.status(axum::http::StatusCode::OK)
            .headers([("Content-Type", "text/event-stream")])
            .bytes_stream_with_delays(build_openai_text_streaming_response(&[
                "Revised", " answer.",
            ]));
    });
    // Exercise actual upload/resolution without depending on a local S3 service.
    mocks.mock(|when, then| {
        when.put();
        then.status(axum::http::StatusCode::OK)
            .headers([("ETag", "\"attachment-fixture\"")]);
    });
    mocks.mock(|when, then| {
        when.get();
        then.status(axum::http::StatusCode::OK)
            .headers([("Content-Type", "text/plain")])
            .text(FILE_CONTENT);
    });
    mocks.mock(|when, then| {
        when.head();
        then.status(axum::http::StatusCode::OK).headers([
            ("Content-Type".to_string(), "text/plain".to_string()),
            ("Content-Length".to_string(), FILE_CONTENT.len().to_string()),
            ("ETag".to_string(), "\"attachment-fixture\"".to_string()),
        ]);
    });
    let (mut config, server) = setup_mock_llm_server_with_mocks(mocks).await;
    config.file_storage_providers.insert(
        "seaweedfs".into(),
        serde_json::from_value(json!({
            "provider_kind": "s3",
            "config": {
                "endpoint": server.url("/").to_string(), "bucket": "files",
                "region": "us-east-1", "access_key_id": "fixture", "secret_access_key": "fixture"
            }
        }))
        .unwrap(),
    );
    let state = test_app_state(config, pool).await;
    let host = Host::new(state.clone());
    let user = get_or_create_user(&state.db, "https://issuer.example", "revision-owner", None)
        .await
        .unwrap();
    let session = host
        .session(
            &user,
            &identity(),
            Vec::new(),
            "graph-token".into(),
            None,
            "tenant-1",
        )
        .await
        .unwrap();
    let conversation = host
        .upsert_conversation(
            CONVERSATION,
            ConversationKind::Personal,
            user.id,
            "https://smba.example/",
            "29:user",
        )
        .await
        .unwrap();
    let (chat_id, _) = host
        .ensure_chat(&session, &conversation, None)
        .await
        .unwrap();
    Fixture {
        state,
        host,
        session,
        chat_id,
        _server: server,
    }
}

/// Capture the actual translated events and update the durable request mapping
/// just as the handler does. A missing StreamEnd would leave this receiver open.
async fn record_generation(
    fixture: &Fixture,
    request: &TeamsRequest,
    mut updates: mpsc::Receiver<GenerationUpdate>,
) -> (TeamsRequest, Vec<GenerationUpdate>, Completion) {
    let mut recorded = Vec::new();
    let mut finished = None;
    tokio::time::timeout(Duration::from_secs(20), async {
        while let Some(update) = updates.recv().await {
            match &update {
                GenerationUpdate::UserMessageSaved(message_id) => {
                    fixture
                        .host
                        .record_user_message(request, *message_id)
                        .await
                        .unwrap();
                }
                GenerationUpdate::Started {
                    chat_id,
                    message_id,
                } => {
                    assert_eq!(*chat_id, fixture.chat_id);
                    fixture
                        .host
                        .record_generation(request, *message_id)
                        .await
                        .unwrap();
                }
                GenerationUpdate::Completed(done) => finished = Some(done.clone()),
                GenerationUpdate::Failed(error) => panic!("revision generation failed: {error}"),
                _ => {}
            }
            recorded.push(update);
        }
    })
    .await
    .expect("revision feed reaches its terminal event");
    let finished = finished.expect("revision completed");
    // StreamEnd precedes lease cleanup. The UI reports Busy during that brief
    // interval; wait for cleanup before testing the next successful revision.
    tokio::time::timeout(Duration::from_secs(10), async {
        while fixture
            .state
            .background_tasks
            .active_generation(&fixture.chat_id)
            .await
            .is_some()
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("completed generation releases its lease");
    let request = fixture
        .host
        .finish_request(request, "completed")
        .await
        .unwrap();
    assert_eq!(request.assistant_message_id, Some(finished.message_id));
    assert_eq!(finished.chat_id, fixture.chat_id);
    assert_eq!(finished.text, "Revised answer.");
    let started = recorded
        .iter()
        .position(|update| matches!(update, GenerationUpdate::Started { .. }))
        .unwrap();
    let first_text = recorded
        .iter()
        .position(|update| matches!(update, GenerationUpdate::Text(_)))
        .unwrap();
    let completed = recorded
        .iter()
        .position(|update| matches!(update, GenerationUpdate::Completed(_)))
        .unwrap();
    assert!(
        started < first_text && first_text < completed,
        "IDs precede text, and completion follows text"
    );
    (request, recorded, finished)
}

async fn initial_generation(fixture: &Fixture, file_ids: Vec<Uuid>) -> (TeamsRequest, Completion) {
    let request = fixture
        .host
        .remember_request(
            &fixture.session,
            CONVERSATION,
            "question-1",
            fixture.chat_id,
        )
        .await
        .unwrap()
        .unwrap();
    let updates = fixture
        .host
        .submit(
            &fixture.session,
            fixture.chat_id,
            "Original question".into(),
            file_ids,
        )
        .await
        .unwrap();
    let (request, _, completed) = record_generation(fixture, &request, updates).await;
    (request, completed)
}

/// Retrying creates a replacement assistant sibling; editing creates a new user
/// sibling and answer while retaining attachments. Neither appends a new turn.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "MIGRATOR")]
async fn retry_and_edit_preserve_branch_semantics_files_and_stream_events(pool: Pool<Postgres>) {
    let fixture = fixture(pool).await;
    let file_id = fixture
        .host
        .store_file(
            &fixture.session,
            fixture.chat_id,
            "original.txt",
            Some("text/plain"),
            FILE_CONTENT.as_bytes().to_vec(),
        )
        .await
        .unwrap();
    let (request, original) = initial_generation(&fixture, vec![file_id]).await;
    let original_user = request
        .user_message_id
        .expect("original user ID was broadcast");

    let retry = fixture
        .host
        .revise_request(&fixture.session, &request, "retry")
        .await
        .unwrap();
    let (request, retry_events, retried) = record_generation(&fixture, &request, retry).await;
    assert!(
        !retry_events
            .iter()
            .any(|event| matches!(event, GenerationUpdate::UserMessageSaved(_))),
        "retry reuses the original question"
    );
    assert_eq!(request.user_message_id, Some(original_user));
    assert_ne!(retried.message_id, original.message_id);
    let retried_row = Messages::find_by_id(retried.message_id)
        .one(&fixture.state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(retried_row.previous_message_id, Some(original_user));
    assert_eq!(retried_row.sibling_message_id, Some(original.message_id));

    let edit = fixture
        .host
        .propose_edit(request.id, "Edited question", chrono::Utc::now())
        .await
        .unwrap()
        .unwrap();
    let edits = fixture
        .host
        .revise_request(&fixture.session, &edit, "edit")
        .await
        .unwrap();
    let (request, edit_events, edited) = record_generation(&fixture, &request, edits).await;
    let edited_user = request
        .user_message_id
        .expect("edited user ID was broadcast");
    assert_ne!(edited_user, original_user);
    let user_saved = edit_events
        .iter()
        .position(|event| matches!(event, GenerationUpdate::UserMessageSaved(_)))
        .unwrap();
    let assistant_started = edit_events
        .iter()
        .position(|event| matches!(event, GenerationUpdate::Started { .. }))
        .unwrap();
    assert!(user_saved < assistant_started);
    let edited_user_row = Messages::find_by_id(edited_user)
        .one(&fixture.state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(edited_user_row.sibling_message_id, Some(original_user));
    assert_eq!(edited_user_row.previous_message_id, None);
    assert_eq!(edited_user_row.input_file_uploads, Some(vec![file_id]));
    assert_eq!(
        edited_user_row.raw_message["content"][0]["text"],
        "Edited question"
    );
    let original_user_row = Messages::find_by_id(original_user)
        .one(&fixture.state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(original_user_row.input_file_uploads, Some(vec![file_id]));
    assert_eq!(
        original_user_row.raw_message["content"][0]["text"],
        "Original question"
    );
    let rows = Messages::find()
        .filter(messages::Column::ChatId.eq(fixture.chat_id))
        .all(&fixture.state.db)
        .await
        .unwrap();
    assert_eq!(rows.len(), 5);
    let active: Vec<_> = rows
        .iter()
        .filter(|row| row.is_message_in_active_thread)
        .map(|row| row.id)
        .collect();
    assert_eq!(active.len(), 2);
    assert!(active.contains(&edited_user) && active.contains(&edited.message_id));
    assert_eq!(
        rows.iter()
            .find(|row| row.id == edited.message_id)
            .unwrap()
            .previous_message_id,
        Some(edited_user)
    );
}

/// A foreign user cannot revise another user's mapped conversation, and an old
/// request cannot branch away a newer question in the same conversation.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "MIGRATOR")]
async fn revisions_reject_foreign_users_and_superseded_questions(pool: Pool<Postgres>) {
    let fixture = fixture(pool).await;
    let (request, _) = initial_generation(&fixture, Vec::new()).await;
    let other_user = get_or_create_user(
        &fixture.state.db,
        "https://issuer.example",
        "other-user",
        None,
    )
    .await
    .unwrap();
    let other_identity: GraphIdentity = serde_json::from_value(json!({
        "id": "4a1b3c5d-0000-4000-8000-00000000beef", "displayName": "Other user", "mail": "other@example.com"
    })).unwrap();
    let other_session = fixture
        .host
        .session(
            &other_user,
            &other_identity,
            Vec::new(),
            "other-token".into(),
            None,
            "tenant-1",
        )
        .await
        .unwrap();
    let edited = fixture
        .host
        .propose_edit(request.id, "Should not be applied", chrono::Utc::now())
        .await
        .unwrap()
        .unwrap();
    for kind in ["retry", "edit"] {
        assert!(matches!(
            fixture
                .host
                .revise_request(&other_session, &edited, kind)
                .await,
            Err(StartError::Rejected(_))
        ));
    }
    let rows = Messages::find()
        .filter(messages::Column::ChatId.eq(fixture.chat_id))
        .all(&fixture.state.db)
        .await
        .unwrap();
    assert_eq!(rows.len(), 2, "unauthorized revisions write no messages");

    let next = fixture
        .host
        .submit(
            &fixture.session,
            fixture.chat_id,
            "Newer question".into(),
            Vec::new(),
        )
        .await
        .unwrap();
    completion(next).await;
    for kind in ["retry", "edit"] {
        assert!(matches!(
            fixture
                .host
                .revise_request(&fixture.session, &edited, kind)
                .await,
            Err(StartError::Rejected(_))
        ));
    }
    let rows = Messages::find()
        .filter(messages::Column::ChatId.eq(fixture.chat_id))
        .all(&fixture.state.db)
        .await
        .unwrap();
    assert_eq!(rows.len(), 4);
    assert!(rows.iter().all(|row| row.is_message_in_active_thread));
}

/// Duplicate callbacks, edit ordering and interleaved claims are database
/// invariants, including when two bot replicas handle the buttons.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "MIGRATOR")]
async fn request_actions_are_one_use_and_newer_edits_win(pool: Pool<Postgres>) {
    let fixture = fixture(pool).await;
    let (request, _) = initial_generation(&fixture, Vec::new()).await;
    assert!(!request.native_stop_available);
    let request = fixture
        .host
        .record_native_stop(&request, true)
        .await
        .unwrap();
    assert!(
        fixture
            .host
            .request_snapshot(request.id)
            .await
            .unwrap()
            .unwrap()
            .native_stop_available,
        "edit callbacks read the native Stop mode from shared state"
    );
    assert!(
        fixture
            .host
            .remember_request(
                &fixture.session,
                CONVERSATION,
                "question-1",
                fixture.chat_id
            )
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        fixture
            .host
            .request_for_user(&fixture.session, "another-conversation", request.id)
            .await
            .unwrap()
            .is_none()
    );
    let stopped = fixture
        .host
        .finish_request(&request, "stopped")
        .await
        .unwrap();
    let token = stopped.action_token.unwrap();
    let (one, two) = tokio::join!(
        fixture.host.claim_request_action(&stopped, token, "retry"),
        fixture.host.claim_request_action(&stopped, token, "retry"),
    );
    let claimed = match (one.unwrap(), two.unwrap()) {
        (Some(claimed), None) | (None, Some(claimed)) => claimed,
        _ => panic!("exactly one callback owns the action"),
    };
    assert_eq!(claimed.state, "preparing");
    assert_ne!(claimed.run_id, stopped.run_id);
    assert!(
        fixture
            .host
            .record_native_stop(&stopped, false)
            .await
            .is_err(),
        "an old renderer cannot change a new run's Stop controls"
    );
    let now = chrono::Utc::now();
    let edited = fixture
        .host
        .propose_edit(request.id, "Newest question", now)
        .await
        .unwrap()
        .unwrap();
    assert!(
        fixture
            .host
            .propose_edit(
                request.id,
                "Stale question",
                now - chrono::Duration::seconds(1)
            )
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        fixture
            .host
            .propose_edit(request.id, "Duplicate callback", now)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        fixture
            .host
            .claim_request_action(&edited, edited.action_token.unwrap(), "edit")
            .await
            .unwrap()
            .is_none(),
        "a new edit cannot start while the earlier action owns preparation"
    );
    fixture
        .host
        .restore_request_action(&claimed, token, "stopped")
        .await
        .unwrap();
    let ready = fixture
        .host
        .request_snapshot(request.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(ready.pending_edit.as_deref(), Some("Newest question"));
    assert_eq!(ready.action_token, edited.action_token);
    let next = fixture
        .host
        .claim_request_action(&ready, ready.action_token.unwrap(), "edit")
        .await
        .unwrap()
        .unwrap();
    fixture
        .host
        .restore_request_action(&claimed, token, "stopped")
        .await
        .unwrap();
    let current = fixture
        .host
        .request_snapshot(request.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(current.run_id, next.run_id);
    assert_eq!(current.state, "preparing");
    assert_eq!(
        current.action_token, None,
        "old claimant cannot revive its token"
    );
    assert!(
        fixture
            .host
            .finish_request(&request, "completed")
            .await
            .is_err(),
        "old renderer cannot finalize a new run"
    );
    assert!(
        fixture
            .host
            .record_generation(&request, request.assistant_message_id.unwrap())
            .await
            .is_err()
    );
    fixture.host.record_tool_started(&request).await.unwrap();
    assert!(
        !fixture
            .host
            .request_snapshot(request.id)
            .await
            .unwrap()
            .unwrap()
            .tools_started
    );
    fixture.host.reset_request_action(&next).await.unwrap();
    let current = fixture
        .host
        .request_snapshot(request.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        current.assistant_message_id, None,
        "a preparation failure cannot retry the old question"
    );
    let failed = fixture
        .host
        .finish_request(&current, "failed")
        .await
        .unwrap();
    assert_eq!(failed.action_token, None);
}

/// The stored answer protects Retry even if progress observation was delayed;
/// a stale Stop payload is also unable to mutate an unrelated response.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "MIGRATOR")]
async fn retry_refuses_persisted_tool_effects_and_expired_actions(pool: Pool<Postgres>) {
    use sea_orm::{ActiveModelTrait, ActiveValue::Set, ConnectionTrait, DbBackend, Statement};
    let fixture = fixture(pool).await;
    let (request, done) = initial_generation(&fixture, Vec::new()).await;
    let content = json!({"role":"assistant", "content":[{"content_type":"tool_use", "tool_call_id":"call-1", "status":"success", "tool_name":"publish", "input":{}, "output":{"published":true}}]});
    erato::models::message::MessageSchema::validate(&content)
        .expect("fixture is a valid persisted tool result");
    messages::ActiveModel {
        id: Set(done.message_id),
        raw_message: Set(content),
        ..Default::default()
    }
    .update(&fixture.state.db)
    .await
    .unwrap();
    assert!(
        !request.tools_started,
        "simulates a missed progress observer"
    );
    let retry = fixture
        .host
        .revise_request(&fixture.session, &request, "retry")
        .await;
    assert!(
        matches!(&retry, Err(StartError::Rejected(message)) if message.contains("Tools may already have run")),
        "persisted tool effects must refuse retry: {retry:?}"
    );
    let stopped = fixture
        .host
        .finish_request(&request, "stopped")
        .await
        .unwrap();
    fixture
        .state
        .db
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE ms_teams_requests SET action_expires_at=now()-interval '1 second' WHERE id=$1",
            vec![request.id.into()],
        ))
        .await
        .unwrap();
    assert!(
        fixture
            .host
            .claim_request_action(&stopped, stopped.action_token.unwrap(), "retry")
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        !fixture
            .host
            .stop_request(&fixture.session, &request, Uuid::new_v4())
            .await
            .unwrap()
    );
    assert_eq!(
        fixture
            .host
            .request_snapshot(request.id)
            .await
            .unwrap()
            .unwrap()
            .state,
        "stopped"
    );
}

/// A newer turn can arrive between the initial Teams control check and lease
/// acquisition. The shared start must recheck, reject, and release its lease.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "MIGRATOR")]
async fn newer_turn_during_revision_validation_rejects_without_leaking_lease(pool: Pool<Postgres>) {
    use sea_orm::{
        ActiveValue::Set, ConnectionTrait, DbBackend, IntoActiveModel, Statement, TransactionTrait,
    };

    let fixture = fixture(pool).await;
    let (request, original) = initial_generation(&fixture, Vec::new()).await;
    let original_user = Messages::find_by_id(request.user_message_id.unwrap())
        .one(&fixture.state.db)
        .await
        .unwrap()
        .unwrap();
    let original_assistant = Messages::find_by_id(original.message_id)
        .one(&fixture.state.db)
        .await
        .unwrap()
        .unwrap();

    // This is the lock try_start_task uses. Holding it pauses precisely between
    // Teams' initial current-question check and the new post-lease check.
    let lease_lock = fixture.state.db.begin().await.unwrap();
    lease_lock
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
            [fixture.chat_id.to_string().into()],
        ))
        .await
        .unwrap();
    let holder_pid: i32 = lease_lock
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            "SELECT pg_backend_pid() AS pid".to_string(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "pid")
        .unwrap();

    let advance_thread = async {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let blocked: bool = fixture.state.db.query_one_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
                    [holder_pid.into()],
                )).await.unwrap().unwrap().try_get("", "blocked").unwrap();
                if blocked { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.expect("revision reached the lease lock");

        // Simulate a newer turn committed by another surface during validation.
        let user_id = Uuid::new_v4();
        let assistant_id = Uuid::new_v4();
        let now = chrono::Utc::now().fixed_offset();
        let mut user = original_user.into_active_model();
        user.id = Set(user_id);
        user.previous_message_id = Set(Some(original.message_id));
        user.sibling_message_id = Set(None);
        user.created_at = Set(now);
        user.updated_at = Set(now);
        user.raw_message = Set(
            json!({"role":"user", "content":[{"content_type":"text", "text":"Newer question"}]}),
        );
        Messages::insert(user)
            .exec(&fixture.state.db)
            .await
            .unwrap();
        let mut assistant = original_assistant.into_active_model();
        assistant.id = Set(assistant_id);
        assistant.previous_message_id = Set(Some(user_id));
        assistant.sibling_message_id = Set(None);
        assistant.created_at = Set(now + chrono::Duration::microseconds(1));
        assistant.updated_at = Set(now);
        Messages::insert(assistant)
            .exec(&fixture.state.db)
            .await
            .unwrap();
        lease_lock.commit().await.unwrap();
    };
    let (revision, ()) = tokio::join!(
        fixture
            .host
            .revise_request(&fixture.session, &request, "retry"),
        advance_thread,
    );
    assert!(
        matches!(revision, Err(StartError::Rejected(ref reason)) if reason.contains("latest question"))
    );
    assert!(
        fixture
            .state
            .background_tasks
            .get_task(&fixture.chat_id)
            .await
            .is_none()
    );
    let chat = Chats::find_by_id(fixture.chat_id)
        .one(&fixture.state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(chat.generation_state.as_deref(), Some("completed"));
    let rows = Messages::find()
        .filter(messages::Column::ChatId.eq(fixture.chat_id))
        .all(&fixture.state.db)
        .await
        .unwrap();
    assert_eq!(
        rows.len(),
        4,
        "rejected revision creates no branch or assistant row"
    );
    assert!(rows.iter().all(|row| row.is_message_in_active_thread));
}
