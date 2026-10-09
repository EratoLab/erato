use axum::http::StatusCode;
use axum_test::TestServer;
use erato::db::entity::{chats, messages};
use erato::models::message::{compaction_marker, get_generation_chat_provider_id_from_message};
use erato::services::background_tasks::{Takeover, TaskOutcome};
use erato::state::AppState;
use mocktail::prelude::{MockServer, MockSet};
use sea_orm::prelude::Uuid;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter};
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};

use crate::{
    test_app_state,
    test_utils::{
        BodyContainsMatcher, RequestBodyRecorder, TEST_JWT_TOKEN, TestRequestAuthExt,
        build_openai_text_streaming_response, parse_sse_events, setup_mock_llm_server_with_mocks,
    },
};

async fn setup(
    pool: Pool<Postgres>,
    summary: &str,
) -> (
    TestServer,
    AppState,
    MockServer,
    RequestBodyRecorder,
    Uuid,
    Uuid,
) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let result = summary.to_owned();
    let recorded = recorder.clone();
    mocks.mock(move |when, then| {
        when.post().path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["Compact the conversation"], &[])).matcher(recorded);
        then.status(StatusCode::OK).json(json!({"id":"compaction","object":"chat.completion","created":1,"model":"mock-model","choices":[{"index":0,"message":{"role":"assistant","content":result},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}));
    });
    let recorded = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &["Compact the conversation"]))
            .matcher(recorded);
        then.status(StatusCode::OK)
            .headers([("Content-Type", "text/event-stream")])
            .bytes_stream_with_delays(build_openai_text_streaming_response(&[
                "Original assistant answer.",
            ]));
    });
    let (mut config, mock_server) = setup_mock_llm_server_with_mocks(mocks).await;
    let provider = config.chat_providers.as_ref().unwrap().providers["mock-llm"].clone();
    config
        .chat_providers
        .as_mut()
        .unwrap()
        .providers
        .insert("compaction-provider".into(), provider);
    config.chat_history_compaction.enabled = true;
    config.chat_history_compaction.chat_provider_id = Some("compaction-provider".into());
    let state = test_app_state(config, pool).await;
    let app = erato::server::router::router(state.clone())
        .split_for_parts()
        .0
        .with_state(state.clone());
    let server = TestServer::new(app.into_make_service()).unwrap();
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"user_message":"ORIGINAL-USER-SENTINEL","input_files_ids":[]}))
        .await;
    response.assert_status_ok();
    let tip = parse_sse_events(&response)
        .into_iter()
        .find_map(|event| {
            let value: Value = serde_json::from_str(&event.data).ok()?;
            (value["message_type"] == "assistant_message_completed")
                .then(|| Uuid::parse_str(value["message_id"].as_str().unwrap()).unwrap())
        })
        .expect("assistant completed");
    let row = messages::Entity::find_by_id(tip)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    (server, state, mock_server, recorder, row.chat_id, tip)
}

fn body(tip: Uuid, operation: Uuid) -> Value {
    json!({"expected_tip_message_id":tip,"operation_id":operation,"target_chat_provider_id":"mock-llm","selected_facet_ids":[]})
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn compact_checkpoint_is_idempotent_and_next_provider_request_uses_only_replacement(
    pool: Pool<Postgres>,
) {
    let (server, state, _mock, recorder, chat, tip) =
        setup(pool, r#"{"summary":"DURABLE-SUMMARY-SENTINEL","files":[]}"#).await;
    let endpoint = format!("/api/v1beta/me/chats/{chat}/compact");
    let operation = Uuid::new_v4();
    let response = server
        .post(&endpoint)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(tip, operation))
        .await;
    response.assert_status_ok();
    let first: Value = response.json();
    let retry = server
        .post(&endpoint)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(tip, operation))
        .await;
    retry.assert_status_ok();
    assert_eq!(retry.json::<Value>(), first);
    server
        .put(&format!("/api/v1beta/messages/{operation}/feedback"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"sentiment": "positive"}))
        .await
        .assert_status(StatusCode::BAD_REQUEST);
    let row = messages::Entity::find_by_id(operation)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.previous_message_id, Some(tip));
    assert!(compaction_marker(&row).unwrap().is_some());
    assert_eq!(
        get_generation_chat_provider_id_from_message(&row)
            .unwrap()
            .as_deref(),
        Some("mock-llm")
    );
    assert_eq!(
        row.generation_parameters.as_ref().unwrap()["generation_chat_provider_id"],
        "compaction-provider"
    );
    assert_eq!(
        row.generation_metadata.as_ref().unwrap()["used_total_tokens"],
        120
    );
    let snapshot = row.generation_input_messages.unwrap().to_string();
    assert!(snapshot.contains("DURABLE-SUMMARY"));
    assert!(!snapshot.contains("ORIGINAL-USER"));
    assert!(!snapshot.contains("compaction_marker"));
    let estimate = server.post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"previous_message_id":operation,"user_message":"","chat_provider_id":"mock-llm"})).await;
    estimate.assert_status_ok();
    assert_eq!(
        estimate.json::<Value>()["stats"]["total_tokens"],
        first["compaction"]["after_tokens"]
    );
    assert!(
        messages::Entity::find_by_id(tip)
            .one(&state.db)
            .await
            .unwrap()
            .unwrap()
            .is_message_in_active_thread
    );
    let next=server.post("/api/v1beta/me/messages/submitstream").with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"user_message":"NEXT-USER-SENTINEL","previous_message_id":operation,"input_files_ids":[]})).await;
    next.assert_status_ok();
    let requests = recorder.bodies();
    let next = requests
        .iter()
        .rev()
        .find(|s| s.contains("NEXT-USER-SENTINEL"))
        .unwrap();
    assert!(next.contains("DURABLE-SUMMARY-SENTINEL"));
    assert!(!next.contains("ORIGINAL-USER-SENTINEL"));
    assert!(!next.contains("Original assistant answer"));
    assert!(!next.contains("compaction_marker"));
    assert_eq!(
        requests
            .iter()
            .filter(|s| s.contains("Compact the conversation"))
            .count(),
        1
    );
    let stale = server
        .post(&endpoint)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(tip, Uuid::new_v4()))
        .await;
    stale.assert_status(StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn invalid_summary_leaves_history_unchanged_and_releases_lease(pool: Pool<Postgres>) {
    let (server, state, _mock, _, chat, tip) = setup(pool, "invalid JSON").await;
    let operation = Uuid::new_v4();
    let response = server
        .post(&format!("/api/v1beta/me/chats/{chat}/compact"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(tip, operation))
        .await;
    response.assert_status(StatusCode::BAD_GATEWAY);
    assert!(
        messages::Entity::find_by_id(operation)
            .one(&state.db)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        erato::models::message::get_active_thread_tip(&state.db, &chat)
            .await
            .unwrap()
            .unwrap()
            .id,
        tip
    );
    let finished = chats::Entity::find_by_id(chat)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(finished.generation_state.as_deref(), Some("errored"));
    // Terminal rows retain their generation ID for status polling. Admission
    // proves the lease was released without incorrectly requiring a null ID.
    let (_, task) = state
        .background_tasks
        .try_start_task(chat, Uuid::new_v4(), Takeover::RefuseParked, 120)
        .await
        .unwrap();
    task.mark_completed();
    state
        .background_tasks
        .remove_task(&chat, task.generation_id, TaskOutcome::Completed)
        .await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn active_generation_archived_chat_and_foreign_tip_are_rejected_without_provider_call(
    pool: Pool<Postgres>,
) {
    let (server, state, _mock, recorder, chat, tip) =
        setup(pool, r#"{"summary":"summary","files":[]}"#).await;
    let endpoint = format!("/api/v1beta/me/chats/{chat}/compact");
    let (_, task) = state
        .background_tasks
        .try_start_task(chat, Uuid::new_v4(), Takeover::RefuseParked, 120)
        .await
        .unwrap();
    let replica = erato::services::background_tasks::BackgroundTaskManager::new(
        Some(state.db.clone()),
        state.config.generation_status.clone(),
        None,
    )
    .with_lease_identity_guard(true);
    assert!(
        replica
            .try_start_task(chat, Uuid::new_v4(), Takeover::RefuseParked, 120)
            .await
            .is_err()
    );
    server
        .post(&endpoint)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(tip, Uuid::new_v4()))
        .await
        .assert_status(StatusCode::CONFLICT);
    task.mark_completed();
    state
        .background_tasks
        .remove_task(&chat, task.generation_id, TaskOutcome::Completed)
        .await;
    server
        .post(&endpoint)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(Uuid::new_v4(), Uuid::new_v4()))
        .await
        .assert_status(StatusCode::CONFLICT);
    let row = chats::Entity::find_by_id(chat)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let mut row: chats::ActiveModel = row.into();
    row.archived_at = Set(Some(chrono::Utc::now().into()));
    row.update(&state.db).await.unwrap();
    server
        .post(&endpoint)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(tip, Uuid::new_v4()))
        .await
        .assert_status(StatusCode::FORBIDDEN);
    assert!(
        !recorder
            .bodies()
            .iter()
            .any(|s| s.contains("Compact the conversation"))
    );
    assert_eq!(
        messages::Entity::find()
            .filter(messages::Column::ChatId.eq(chat))
            .all(&state.db)
            .await
            .unwrap()
            .len(),
        2
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn compaction_model_overflow_and_disabled_feature_do_not_append_or_call_provider(
    pool: Pool<Postgres>,
) {
    let (_server, mut state, _mock, recorder, chat, tip) =
        setup(pool, r#"{"summary":"summary","files":[]}"#).await;
    state
        .config
        .chat_providers
        .as_mut()
        .unwrap()
        .providers
        .get_mut("compaction-provider")
        .unwrap()
        .model_capabilities
        .context_size_tokens = 128;
    let app = erato::server::router::router(state.clone())
        .split_for_parts()
        .0
        .with_state(state.clone());
    let server = TestServer::new(app.into_make_service()).unwrap();
    let endpoint = format!("/api/v1beta/me/chats/{chat}/compact");
    server
        .post(&endpoint)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(tip, Uuid::new_v4()))
        .await
        .assert_status(StatusCode::BAD_REQUEST);
    state.config.chat_history_compaction.enabled = false;
    let app = erato::server::router::router(state.clone())
        .split_for_parts()
        .0
        .with_state(state.clone());
    let disabled = TestServer::new(app.into_make_service()).unwrap();
    disabled
        .post(&endpoint)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(tip, Uuid::new_v4()))
        .await
        .assert_status(StatusCode::NOT_FOUND);
    assert!(
        !recorder
            .bodies()
            .iter()
            .any(|s| s.contains("Compact the conversation"))
    );
    assert_eq!(
        messages::Entity::find()
            .filter(messages::Column::ChatId.eq(chat))
            .all(&state.db)
            .await
            .unwrap()
            .len(),
        2
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn repeated_compaction_uses_effective_summary_and_disabled_feature_keeps_checkpoint_replay(
    pool: Pool<Postgres>,
) {
    let (server, mut state, _mock, recorder, chat, tip) =
        setup(pool, r#"{"summary":"REPLACEMENT-SUMMARY","files":[]}"#).await;
    let endpoint = format!("/api/v1beta/me/chats/{chat}/compact");
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    server
        .post(&endpoint)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(tip, first))
        .await
        .assert_status_ok();
    let response = server
        .post(&endpoint)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(first, second))
        .await;
    response.assert_status_ok();
    let recorded = recorder.bodies();
    let requests: Vec<_> = recorded
        .iter()
        .filter(|s| s.contains("Compact the conversation"))
        .collect();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].contains("ORIGINAL-USER-SENTINEL"));
    assert!(!requests[1].contains("ORIGINAL-USER-SENTINEL"));
    assert!(requests[1].contains("REPLACEMENT-SUMMARY"));
    state.config.chat_history_compaction.enabled = false;
    let app = erato::server::router::router(state.clone())
        .split_for_parts()
        .0
        .with_state(state);
    let disabled = TestServer::new(app.into_make_service()).unwrap();
    let estimate = disabled
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(
            &json!({"previous_message_id":second,"user_message":"","chat_provider_id":"mock-llm"}),
        )
        .await;
    estimate.assert_status_ok();
    assert_eq!(
        estimate.json::<Value>()["stats"]["total_tokens"],
        response.json::<Value>()["compaction"]["after_tokens"]
    );
}
