//! Generation status API tests (chats-row persistence and GET /me/generating).

use chrono::Utc;
use erato::db::entity::chats;
use erato::db::entity::prelude::Chats;
use erato::models::user::get_or_create_user;
use erato::services::background_tasks::TaskOutcome;
use mocktail::MockSet;
use sea_orm::prelude::Uuid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ConnectionTrait, DatabaseConnection, EntityTrait, Statement,
};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::time::Duration;

use crate::test_app_state;
use crate::test_utils::{
    MockLlmConfig, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt,
    create_test_server, setup_mock_llm_server, setup_mock_llm_server_with_mocks,
};

/// Mark a chat as having a running generation with the given heartbeat age.
async fn mark_running(db: &DatabaseConnection, chat_id: Uuid, heartbeat_age_secs: u64) {
    db.execute_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        r#"
        UPDATE chats
        SET active_generation_id = $1,
            generation_state = 'running',
            generation_started_at = now() - make_interval(secs => $2::double precision),
            generation_heartbeat_at = now() - make_interval(secs => $2::double precision),
            generation_ended_at = NULL
        WHERE id = $3
        "#,
        [
            Uuid::new_v4().into(),
            (heartbeat_age_secs as f64).into(),
            chat_id.into(),
        ],
    ))
    .await
    .expect("Failed to mark chat as running");
}

async fn insert_chat(db: &DatabaseConnection, owner_user_id: &str) -> chats::Model {
    chats::ActiveModel {
        owner_user_id: ActiveValue::Set(owner_user_id.to_string()),
        ..Default::default()
    }
    .insert(db)
    .await
    .expect("Failed to insert chat")
}

/// Test the running-to-completed lifecycle of a submit turn.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// While a submit turn is in flight, the chats row is 'running',
/// GET /me/generating returns a running entry, and GET /me/recent_chats
/// carries `active_generation_started_at`. Once the turn finishes, the row
/// flips to 'completed' with an end time, /me/generating reports the terminal
/// entry within the retention window, and the recent-chats marker disappears.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_generating_chats_running_then_completed(pool: Pool<Postgres>) {
    // ~4 seconds of generation so the turn is provably in flight mid-test
    let chunks: Vec<String> = (1..=20).map(|i| format!("Message {:02}", i)).collect();
    let mock_config = MockLlmConfig {
        chunks,
        delay_ms: 200,
        ..Default::default()
    };
    let (app_config, _server) = setup_mock_llm_server(Some(mock_config)).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    // Real TCP server so requests can run concurrently with the stream
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();
    let app: axum::Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    let server_handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{}", server_addr);

    let client_clone = client.clone();
    let base_url_clone = base_url.clone();
    let submit_handle = tokio::spawn(async move {
        let response = client_clone
            .post(format!(
                "{}/api/v1beta/me/messages/submitstream",
                base_url_clone
            ))
            .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
            .header("Content-Type", "application/json")
            .json(&json!({
                "user_message": "Generate numbered messages"
            }))
            .send()
            .await
            .expect("Failed to send submit request");
        assert!(response.status().is_success());
        response.text().await.expect("Failed to read submit body")
    });

    // Let the turn get going (total generation takes ~4s)
    tokio::time::sleep(Duration::from_secs(2)).await;

    let chat_id = {
        let tasks = app_state.background_tasks.tasks.read().await;
        tasks.keys().next().copied()
    }
    .expect("Expected an active background task");

    // The chats row carries the running lease
    let chat = Chats::find_by_id(chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("Chat row should exist");
    assert_eq!(chat.generation_state.as_deref(), Some("running"));
    assert!(chat.active_generation_id.is_some());
    assert!(chat.generation_started_at.is_some());
    assert!(chat.generation_heartbeat_at.is_some());
    assert!(chat.generation_ended_at.is_none());

    // GET /me/generating returns the running entry
    let body: Value = client
        .get(format!("{}/api/v1beta/me/generating", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .send()
        .await
        .expect("Failed to fetch /me/generating")
        .json()
        .await
        .expect("Failed to parse /me/generating body");
    let entries = body["chats"].as_array().expect("chats array");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["chat_id"], chat_id.to_string());
    assert_eq!(entries[0]["state"], "running");
    assert!(entries[0]["started_at"].is_string());
    assert!(entries[0].get("ended_at").is_none());

    // GET /me/recent_chats carries the running marker
    let body: Value = client
        .get(format!("{}/api/v1beta/me/recent_chats", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .send()
        .await
        .expect("Failed to fetch /me/recent_chats")
        .json()
        .await
        .expect("Failed to parse /me/recent_chats body");
    let recent = body["chats"].as_array().expect("chats array");
    let entry = recent
        .iter()
        .find(|c| c["id"] == chat_id.to_string())
        .expect("Chat should be in the recent list");
    assert!(entry["active_generation_started_at"].is_string());

    // Wait for the turn to finish (cleanup runs before the stream closes)
    let _ = submit_handle.await.expect("Submit task panicked");

    let chat = Chats::find_by_id(chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("Chat row should exist");
    assert_eq!(chat.generation_state.as_deref(), Some("completed"));
    assert!(chat.generation_ended_at.is_some());

    // Within the retention window the terminal entry is still reported
    let body: Value = client
        .get(format!("{}/api/v1beta/me/generating", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .send()
        .await
        .expect("Failed to fetch /me/generating")
        .json()
        .await
        .expect("Failed to parse /me/generating body");
    let entries = body["chats"].as_array().expect("chats array");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["state"], "completed");
    assert!(entries[0]["ended_at"].is_string());

    // The recent-chats marker only exists while running
    let body: Value = client
        .get(format!("{}/api/v1beta/me/recent_chats", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .send()
        .await
        .expect("Failed to fetch /me/recent_chats")
        .json()
        .await
        .expect("Failed to parse /me/recent_chats body");
    let recent = body["chats"].as_array().expect("chats array");
    let entry = recent
        .iter()
        .find(|c| c["id"] == chat_id.to_string())
        .expect("Chat should be in the recent list");
    assert!(entry.get("active_generation_started_at").is_none());

    server_handle.abort();
}

/// Test that terminal entries expire from /me/generating after the retention window.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// With a 1-second terminal retention override, a completed turn is reported
/// right after it finishes and disappears once the retention window has passed.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_generating_chats_terminal_retention_expiry(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    app_config.generation_status.terminal_retention_secs = 1;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let server = create_test_server(app_state.clone());

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "Hello" }))
        .await;
    response.assert_status_ok();

    let generating = server
        .get("/api/v1beta/me/generating")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    generating.assert_status_ok();
    let body: Value = generating.json();
    let entries = body["chats"].as_array().expect("chats array");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["state"], "completed");

    tokio::time::sleep(Duration::from_millis(1500)).await;

    let generating = server
        .get("/api/v1beta/me/generating")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    generating.assert_status_ok();
    let body: Value = generating.json();
    assert!(
        body["chats"].as_array().expect("chats array").is_empty(),
        "Terminal entry should expire after the retention window"
    );
}

/// Test that a failing provider turn ends up as an errored generation.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// A mock LLM that rejects the completion request pre-stream makes the turn
/// fail; the chats row records 'errored' and /me/generating reports it.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_generating_chats_errored_turn(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");
        then.status(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
            .json(json!({
                "error": {
                    "message": "mock provider failure",
                    "type": "server_error"
                }
            }));
    });
    let (app_config, _server) = setup_mock_llm_server_with_mocks(mocks).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let server = create_test_server(app_state.clone());

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "This turn will fail" }))
        .await;
    response.assert_status_ok();

    let chat = Chats::find()
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("Chat row should exist");
    assert_eq!(chat.generation_state.as_deref(), Some("errored"));
    assert!(chat.generation_ended_at.is_some());

    let generating = server
        .get("/api/v1beta/me/generating")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    generating.assert_status_ok();
    let body: Value = generating.json();
    let entries = body["chats"].as_array().expect("chats array");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["chat_id"], chat.id.to_string());
    assert_eq!(entries[0]["state"], "errored");
    assert!(entries[0]["ended_at"].is_string());
}

/// Test that an aborted turn counts as completed, not errored.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Aborting a running submit turn via POST /me/messages/abortstream is a
/// user-initiated stop: the chats row ends 'completed'.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_generating_chats_abort_marks_completed(pool: Pool<Postgres>) {
    let chunks: Vec<String> = (1..=10).map(|i| format!("Message {:02}", i)).collect();
    let mock_config = MockLlmConfig {
        chunks,
        delay_ms: 300,
        ..Default::default()
    };
    let (app_config, _server) = setup_mock_llm_server(Some(mock_config)).await;
    let app_state = test_app_state(app_config, pool).await;

    let _user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();
    let app: axum::Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    let server_handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{}", server_addr);

    let client_clone = client.clone();
    let base_url_clone = base_url.clone();
    let submit_handle = tokio::spawn(async move {
        let response = client_clone
            .post(format!(
                "{}/api/v1beta/me/messages/submitstream",
                base_url_clone
            ))
            .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
            .header("Content-Type", "application/json")
            .json(&json!({ "user_message": "Generate numbered messages" }))
            .send()
            .await
            .expect("Failed to send submit request");
        assert!(response.status().is_success());
        response.text().await.expect("Failed to read submit body")
    });

    tokio::time::sleep(Duration::from_secs(1)).await;

    let chat_id = {
        let tasks = app_state.background_tasks.tasks.read().await;
        tasks.keys().next().copied()
    }
    .expect("Expected an active background task");

    let abort_response = client
        .post(format!("{}/api/v1beta/me/messages/abortstream", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .header("Content-Type", "application/json")
        .json(&json!({ "chat_id": chat_id.to_string() }))
        .send()
        .await
        .expect("Failed to send abort request");
    assert!(abort_response.status().is_success());

    // Wait for the turn to wind down after the abort
    let _ = submit_handle.await.expect("Submit task panicked");

    let chat = Chats::find_by_id(chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("Chat row should exist");
    assert_eq!(
        chat.generation_state.as_deref(),
        Some("completed"),
        "An aborted turn must not surface as errored"
    );
    assert!(chat.generation_ended_at.is_some());

    let body: Value = client
        .get(format!("{}/api/v1beta/me/generating", base_url))
        .header("Authorization", format!("Bearer {}", TEST_JWT_TOKEN))
        .send()
        .await
        .expect("Failed to fetch /me/generating")
        .json()
        .await
        .expect("Failed to parse /me/generating body");
    let entries = body["chats"].as_array().expect("chats array");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["state"], "completed");

    server_handle.abort();
}

/// Test the reaper's immediate startup pass.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// A chats row left 'running' with a stale heartbeat (e.g. by a killed
/// process) is flipped to 'errored' by the reap pass that runs right at
/// manager construction — long before the first periodic interval (set to
/// 300s here) could fire — and /me/generating reports it as errored.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_generating_chats_reaper_startup_pass(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    app_config.generation_status.heartbeat_interval_secs = 300;
    app_config.generation_status.stale_after_secs = 1;

    // Seed the stale running row BEFORE the manager (and its startup pass) exists
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
    let user = get_or_create_user(&db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let stale_chat = insert_chat(&db, &user.id.to_string()).await;
    mark_running(&db, stale_chat.id, 600).await;

    let app_state = test_app_state(app_config, pool).await;

    let mut reaped = false;
    for _ in 0..50 {
        let chat = Chats::find_by_id(stale_chat.id)
            .one(&app_state.db)
            .await
            .unwrap()
            .expect("Chat row should exist");
        if chat.generation_state.as_deref() == Some("errored") {
            assert!(chat.generation_ended_at.is_some());
            reaped = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(
        reaped,
        "The startup reap pass should flip the stale running row to errored"
    );

    let server = create_test_server(app_state.clone());
    let generating = server
        .get("/api/v1beta/me/generating")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    generating.assert_status_ok();
    let body: Value = generating.json();
    let entries = body["chats"].as_array().expect("chats array");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["chat_id"], stale_chat.id.to_string());
    assert_eq!(entries[0]["state"], "errored");
}

/// Test the reaper's periodic pass.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// A running row whose heartbeat goes stale AFTER the manager started is
/// flipped to 'errored' by a periodic reap tick (1s interval override).
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_generating_chats_reaper_periodic_pass(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    app_config.generation_status.heartbeat_interval_secs = 1;
    app_config.generation_status.stale_after_secs = 1;
    let app_state = test_app_state(app_config, pool).await;

    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let stale_chat = insert_chat(&app_state.db, &user.id.to_string()).await;
    mark_running(&app_state.db, stale_chat.id, 600).await;
    app_state.global_policy_engine.invalidate_data().await;

    let mut reaped = false;
    for _ in 0..50 {
        let chat = Chats::find_by_id(stale_chat.id)
            .one(&app_state.db)
            .await
            .unwrap()
            .expect("Chat row should exist");
        if chat.generation_state.as_deref() == Some("errored") {
            assert!(chat.generation_ended_at.is_some());
            reaped = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(
        reaped,
        "A periodic reap pass should flip the stale running row to errored"
    );

    let server = create_test_server(app_state.clone());
    let generating = server
        .get("/api/v1beta/me/generating")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    generating.assert_status_ok();
    let body: Value = generating.json();
    let entries = body["chats"].as_array().expect("chats array");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["state"], "errored");
}

/// Test that terminal writes and in-map removal are gated on the generation id.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// When a chat's task is replaced by a newer generation, a stale wrapper
/// removing with the OLD generation id must neither evict the new task from
/// the map nor overwrite the running chats row.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_generating_lease_identity_gates_terminal_writes(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let chat = insert_chat(&app_state.db, &user.id.to_string()).await;

    let (_rx1, task1) = app_state
        .background_tasks
        .start_task(chat.id, Uuid::new_v4())
        .await;
    let (_rx2, task2) = app_state
        .background_tasks
        .start_task(chat.id, Uuid::new_v4())
        .await;

    // A stale wrapper finishing late must not touch the replacement generation
    app_state
        .background_tasks
        .remove_task(&chat.id, task1.generation_id, TaskOutcome::Errored)
        .await;

    let current = app_state
        .background_tasks
        .get_task(&chat.id)
        .await
        .expect("The replacement task should still be tracked");
    assert_eq!(current.generation_id, task2.generation_id);

    let row = Chats::find_by_id(chat.id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("Chat row should exist");
    assert_eq!(row.generation_state.as_deref(), Some("running"));
    assert_eq!(row.active_generation_id, Some(task2.generation_id));
    assert!(row.generation_ended_at.is_none());

    // The current generation finishes normally
    app_state
        .background_tasks
        .remove_task(&chat.id, task2.generation_id, TaskOutcome::Completed)
        .await;
    assert!(
        app_state
            .background_tasks
            .get_task(&chat.id)
            .await
            .is_none()
    );

    let row = Chats::find_by_id(chat.id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("Chat row should exist");
    assert_eq!(row.generation_state.as_deref(), Some("completed"));
    assert!(row.generation_ended_at.is_some());
}

/// Test that /me/generating only returns the caller's non-archived chats.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
///
/// # Test Behavior
/// Running chats owned by another user and archived running chats of the
/// caller are excluded; the caller's own running chat is returned with its
/// resolved title.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_generating_chats_excludes_other_users_and_archived(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;

    let me = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .expect("Failed to create user");
    let other = get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "other-user-for-generating",
        None,
    )
    .await
    .expect("Failed to create other user");

    let my_chat = chats::ActiveModel {
        owner_user_id: ActiveValue::Set(me.id.to_string()),
        title_by_summary: ActiveValue::Set(Some("My running chat".to_string())),
        ..Default::default()
    }
    .insert(&app_state.db)
    .await
    .expect("Failed to insert chat");
    mark_running(&app_state.db, my_chat.id, 0).await;

    let other_chat = insert_chat(&app_state.db, &other.id.to_string()).await;
    mark_running(&app_state.db, other_chat.id, 0).await;

    let archived_chat = chats::ActiveModel {
        owner_user_id: ActiveValue::Set(me.id.to_string()),
        archived_at: ActiveValue::Set(Some(Utc::now().into())),
        ..Default::default()
    }
    .insert(&app_state.db)
    .await
    .expect("Failed to insert archived chat");
    mark_running(&app_state.db, archived_chat.id, 0).await;

    app_state.global_policy_engine.invalidate_data().await;

    let server = create_test_server(app_state.clone());
    let generating = server
        .get("/api/v1beta/me/generating")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    generating.assert_status_ok();
    let body: Value = generating.json();
    let entries = body["chats"].as_array().expect("chats array");
    assert_eq!(
        entries.len(),
        1,
        "Only the caller's non-archived running chat should be returned"
    );
    assert_eq!(entries[0]["chat_id"], my_chat.id.to_string());
    assert_eq!(entries[0]["state"], "running");
    assert_eq!(entries[0]["title"], "My running chat");
}
