//! Tests for the delegation backend: provenance envelope, `seed_chat_lineage`,
//! and the ContextRebase behavior of prompt composition.

use crate::test_app_state;
use crate::test_utils::{
    Event, RequestBodyRecorder, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT,
    TestRequestAuthExt, parse_sse_events, setup_mock_llm_server_with_mocks,
};
use axum::Router;
use axum::http;
use axum_test::TestServer;
use axum_test::multipart::{MultipartForm, Part};
use erato::models::chat::{
    AssistantConfiguration, ChatProvenance, ChatProvenanceKind, seed_chat_lineage,
};
use mocktail::MockSet;
use mocktail::body::BodyAction;
use mocktail::mock_builder::Then;
use sea_orm::prelude::Uuid;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;

use crate::test_utils::BodyContainsMatcher;

const ORIGIN_PROMPT_SENTINEL: &str = "ORIGIN-PROMPT-ALPHA-SENTINEL";
const DELEGATE_PROMPT_SENTINEL: &str = "DELEGATE-PROMPT-BRAVO-SENTINEL";

fn delegate_prompt() -> String {
    format!(
        "{DELEGATE_PROMPT_SENTINEL}\n{}",
        "delegate filler words for the token estimate margin ".repeat(400)
    )
}

fn mock_llm_sse_response(then: Then, actions: Vec<BodyAction>) {
    then.status(http::StatusCode::OK)
        .headers([
            ("Content-Type", "text/event-stream"),
            ("Cache-Control", "no-cache"),
            ("Connection", "keep-alive"),
        ])
        .bytes_stream_with_delays(actions);
}

fn app_server(app_state: erato::state::AppState) -> TestServer {
    let app: Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    TestServer::new(app.into_make_service()).expect("Failed to create test server")
}

async fn create_assistant(server: &TestServer, name: &str, prompt: &str) -> String {
    let response = server
        .post("/api/v1beta/assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "name": name,
            "description": "delegation test assistant",
            "prompt": prompt,
            "file_ids": []
        }))
        .await;
    response.assert_status(axum::http::StatusCode::CREATED);
    response.json::<Value>()["id"].as_str().unwrap().to_string()
}

async fn create_chat(server: &TestServer, assistant_id: Option<&str>) -> String {
    let body = match assistant_id {
        Some(id) => json!({ "assistant_id": id }),
        None => json!({}),
    };
    let response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body)
        .await;
    response.assert_status_ok();
    response.json::<Value>()["chat_id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn submit_message(
    server: &TestServer,
    chat_id: &str,
    previous_message_id: Option<&str>,
    text: &str,
    input_files_ids: Vec<String>,
) -> Vec<Event> {
    let mut body = json!({
        "existing_chat_id": chat_id,
        "user_message": text,
        "input_files_ids": input_files_ids,
    });
    if let Some(previous) = previous_message_id {
        body["previous_message_id"] = json!(previous);
    }
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body)
        .await;
    response.assert_status_ok();
    parse_sse_events(&response)
}

fn assistant_message_id_from_events(events: &[Event]) -> String {
    events
        .iter()
        .find_map(|event| {
            if let Ok(json) = serde_json::from_str::<Value>(&event.data)
                && json["message_type"] == "assistant_message_completed"
            {
                return json["message_id"].as_str().map(|s| s.to_string());
            }
            None
        })
        .expect("Expected assistant_message_completed event with message_id")
}

async fn upload_file_to_chat(server: &TestServer, chat_id: &str) -> String {
    let form = MultipartForm::new().add_part(
        "file",
        Part::bytes(b"seeded lineage file contents".to_vec())
            .file_name("seed.txt")
            .mime_type("text/plain"),
    );
    let response = server
        .post(&format!("/api/v1beta/me/files?chat_id={chat_id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(form)
        .await;
    response.assert_status_ok();
    response.json::<Value>()["files"][0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn write_delegation_provenance(
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
    delegate_assistant_id: Uuid,
    origin_chat_id: Uuid,
    origin_assistant_id: Option<Uuid>,
) {
    let configuration = AssistantConfiguration {
        assistant_id: delegate_assistant_id,
        provenance: Some(ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(origin_chat_id),
            origin_message_id: None,
            origin_assistant_id,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
        }),
    };
    let chat = erato::db::entity::chats::Entity::find_by_id(chat_id)
        .one(db)
        .await
        .unwrap()
        .expect("chat should exist");
    let mut active: erato::db::entity::chats::ActiveModel = chat.into();
    active.assistant_configuration = ActiveValue::Set(Some(configuration.to_json().unwrap()));
    active.update(db).await.expect("provenance update");
}

async fn estimate_total(
    server: &TestServer,
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
) -> u64 {
    let head = chat_messages_by_created_at(db, chat_id)
        .await
        .last()
        .unwrap()
        .id
        .to_string();
    let response = server
        .post("/api/v1beta/token_usage/estimate")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "chat_previous_message_id": head,
            "new_message_content": "estimate me",
        }))
        .await;
    response.assert_status_ok();
    response.json::<Value>()["stats"]["total_tokens"]
        .as_u64()
        .unwrap()
}

async fn chat_messages_by_created_at(
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
) -> Vec<erato::db::entity::messages::Model> {
    erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(db)
        .await
        .unwrap()
}

/// Seeds a target chat from a deep source lineage and verifies the copies:
/// rewired lineage, active thread, preserved payloads/timestamps, and the
/// distinct file join rows on the target chat.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_seed_chat_lineage_copies_deep_lineage_and_files(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["seed answer"]),
        );
    });
    let (app_config, _server) = setup_mock_llm_server_with_mocks(mocks).await;
    let app_state = test_app_state(app_config, pool).await;
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());

    let source_chat = create_chat(&server, None).await;
    let file_id = upload_file_to_chat(&server, &source_chat).await;

    // Six turns = 12 rows, beyond the 10-row replay-anchor cap.
    let mut previous: Option<String> = None;
    for turn in 0..6 {
        let files = if turn == 2 {
            vec![file_id.clone()]
        } else {
            vec![]
        };
        let events = submit_message(
            &server,
            &source_chat,
            previous.as_deref(),
            &format!("seed turn {turn}"),
            files,
        )
        .await;
        previous = Some(assistant_message_id_from_events(&events));
    }
    let source_head = Uuid::parse_str(previous.as_deref().unwrap()).unwrap();

    let target_chat = create_chat(&server, None).await;
    let target_chat_id = Uuid::parse_str(&target_chat).unwrap();
    let stats = seed_chat_lineage(&app_state.db, &target_chat_id, &source_head)
        .await
        .expect("seeding should succeed");
    assert_eq!(stats.messages_copied, 12);
    assert_eq!(stats.files_linked, 1);

    let source_chat_id = Uuid::parse_str(&source_chat).unwrap();
    let source_rows = chat_messages_by_created_at(&app_state.db, source_chat_id).await;
    let target_rows = chat_messages_by_created_at(&app_state.db, target_chat_id).await;
    assert_eq!(source_rows.len(), 12);
    assert_eq!(target_rows.len(), 12);

    let mut expected_previous: Option<Uuid> = None;
    for (source_row, target_row) in source_rows.iter().zip(target_rows.iter()) {
        assert_ne!(target_row.id, source_row.id);
        assert_eq!(target_row.chat_id, target_chat_id);
        assert_eq!(target_row.previous_message_id, expected_previous);
        assert_eq!(target_row.sibling_message_id, None);
        assert!(target_row.is_message_in_active_thread);
        assert_eq!(target_row.raw_message, source_row.raw_message);
        assert_eq!(target_row.created_at, source_row.created_at);
        assert_eq!(
            target_row.generation_input_messages,
            source_row.generation_input_messages
        );
        assert_eq!(target_row.input_file_uploads, source_row.input_file_uploads);
        expected_previous = Some(target_row.id);
    }

    // The API view agrees (all rows, none filtered as inactive branches).
    let response = server
        .get(&format!("/api/v1beta/chats/{target_chat}/messages"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    assert_eq!(
        response.json::<Value>()["messages"]
            .as_array()
            .unwrap()
            .len(),
        12
    );

    let join_row = erato::db::entity::chat_file_uploads::Entity::find_by_id((
        target_chat_id,
        Uuid::parse_str(&file_id).unwrap(),
    ))
    .one(&app_state.db)
    .await
    .unwrap();
    assert!(join_row.is_some(), "file join row copied to target chat");
}

/// A seeded chat with a delegation provenance cutoff gets the NEW assistant's
/// head on its first generation (old system plane stripped, history verbatim),
/// and replays normally on the second generation once its own snapshot exists.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_context_rebase_injects_new_head_then_self_retires(pool: Pool<Postgres>) {
    let first_turn_recorder = RequestBodyRecorder::new();
    let second_turn_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    {
        let recorder = first_turn_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["child question one"],
                    &["child question two"],
                ))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["child answer one"]),
            );
        });
    }
    {
        let recorder = second_turn_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&["child question two"], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["child answer two"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[],
                &["child question one", "child question two"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["origin answer"]),
        );
    });

    let (app_config, _server) = setup_mock_llm_server_with_mocks(mocks).await;
    let app_state = test_app_state(app_config, pool).await;
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());

    let origin_assistant = create_assistant(
        &server,
        "Origin Assistant",
        &format!("{ORIGIN_PROMPT_SENTINEL} answer tersely."),
    )
    .await;
    let delegate_assistant =
        create_assistant(&server, "Delegate Assistant", &delegate_prompt()).await;

    let origin_chat = create_chat(&server, Some(&origin_assistant)).await;
    let origin_events =
        submit_message(&server, &origin_chat, None, "origin question alpha", vec![]).await;
    let origin_head = assistant_message_id_from_events(&origin_events);

    let delegate_chat = create_chat(&server, Some(&delegate_assistant)).await;
    let delegate_chat_id = Uuid::parse_str(&delegate_chat).unwrap();
    write_delegation_provenance(
        &app_state.db,
        delegate_chat_id,
        Uuid::parse_str(&delegate_assistant).unwrap(),
        Uuid::parse_str(&origin_chat).unwrap(),
        Some(Uuid::parse_str(&origin_assistant).unwrap()),
    )
    .await;
    seed_chat_lineage(
        &app_state.db,
        &delegate_chat_id,
        &Uuid::parse_str(&origin_head).unwrap(),
    )
    .await
    .unwrap();

    let seeded_rows = chat_messages_by_created_at(&app_state.db, delegate_chat_id).await;
    let seeded_head = seeded_rows.last().unwrap().id.to_string();

    let first_events = submit_message(
        &server,
        &delegate_chat,
        Some(&seeded_head),
        "child question one",
        vec![],
    )
    .await;
    let first_assistant_message = assistant_message_id_from_events(&first_events);

    let first_bodies = first_turn_recorder.bodies();
    assert_eq!(first_bodies.len(), 1);
    let first_body: Value = serde_json::from_str(&first_bodies[0]).unwrap();
    let first_messages = first_body["messages"].as_array().unwrap();
    let first_message_content = first_messages[0]["content"].as_str().unwrap_or_default();
    assert_eq!(first_messages[0]["role"], "system");
    assert!(
        first_message_content.contains(DELEGATE_PROMPT_SENTINEL),
        "rebased head must carry the delegate assistant's prompt"
    );
    assert!(
        !first_bodies[0].contains(ORIGIN_PROMPT_SENTINEL),
        "the origin assistant's system plane must be stripped"
    );
    assert!(first_bodies[0].contains("origin question alpha"));
    assert!(first_bodies[0].contains("origin answer"));
    assert_eq!(first_bodies[0].matches(DELEGATE_PROMPT_SENTINEL).count(), 1);

    submit_message(
        &server,
        &delegate_chat,
        Some(&first_assistant_message),
        "child question two",
        vec![],
    )
    .await;

    // Self-retirement: the second generation replays the delegate chat's own
    // fresh snapshot instead of re-running the rebase.
    let second_bodies = second_turn_recorder.bodies();
    assert_eq!(second_bodies.len(), 1);
    assert_eq!(
        second_bodies[0].matches(DELEGATE_PROMPT_SENTINEL).count(),
        1
    );
    assert!(!second_bodies[0].contains(ORIGIN_PROMPT_SENTINEL));
    assert!(second_bodies[0].contains("child answer one"));
}

/// The pre-send token estimate threads the rebase cutoff through the same
/// composition pipeline as generation: a rebased chat is estimated with the
/// delegate assistant's head, a seeded chat without provenance is not.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_token_estimate_threads_rebase_cutoff(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["origin answer"]),
        );
    });
    let (app_config, _server) = setup_mock_llm_server_with_mocks(mocks).await;
    let app_state = test_app_state(app_config, pool).await;
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());

    let origin_assistant = create_assistant(
        &server,
        "Origin Assistant",
        &format!("{ORIGIN_PROMPT_SENTINEL} answer tersely."),
    )
    .await;
    let delegate_assistant =
        create_assistant(&server, "Delegate Assistant", &delegate_prompt()).await;

    let origin_chat = create_chat(&server, Some(&origin_assistant)).await;
    let origin_events =
        submit_message(&server, &origin_chat, None, "origin question alpha", vec![]).await;
    let origin_head = Uuid::parse_str(&assistant_message_id_from_events(&origin_events)).unwrap();

    // Rebased chat: delegate assistant + provenance cutoff + seeded lineage.
    let rebased_chat = create_chat(&server, Some(&delegate_assistant)).await;
    let rebased_chat_id = Uuid::parse_str(&rebased_chat).unwrap();
    write_delegation_provenance(
        &app_state.db,
        rebased_chat_id,
        Uuid::parse_str(&delegate_assistant).unwrap(),
        Uuid::parse_str(&origin_chat).unwrap(),
        None,
    )
    .await;
    seed_chat_lineage(&app_state.db, &rebased_chat_id, &origin_head)
        .await
        .unwrap();

    // Control chat: same delegate assistant and seeded lineage, no provenance.
    let control_chat = create_chat(&server, Some(&delegate_assistant)).await;
    let control_chat_id = Uuid::parse_str(&control_chat).unwrap();
    seed_chat_lineage(&app_state.db, &control_chat_id, &origin_head)
        .await
        .unwrap();

    let rebased_total = estimate_total(&server, &app_state.db, rebased_chat_id).await;
    let control_total = estimate_total(&server, &app_state.db, control_chat_id).await;

    // The delegate prompt is ~400 repetitions of a 7-word filler; requiring a
    // 300-token gap proves the estimator applied the rebase head injection.
    assert!(
        rebased_total > control_total + 300,
        "rebased estimate ({rebased_total}) should exceed the non-rebased estimate ({control_total}) by the delegate prompt size"
    );
}

/// Legacy `assistant_configuration` rows (no provenance) still parse and the
/// generated `origin_chat_id` column stays NULL for them; rows carrying a
/// provenance envelope surface the origin chat id through the column.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_provenance_generated_column_and_legacy_rows(pool: Pool<Postgres>) {
    let app_config = crate::test_utils::hermetic_app_config(None, None);
    let app_state = test_app_state(app_config, pool).await;
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());

    let assistant = create_assistant(&server, "Plain Assistant", "You are a test assistant.").await;
    let assistant_id = Uuid::parse_str(&assistant).unwrap();

    let legacy_json = json!({ "assistant_id": assistant_id });
    let parsed = AssistantConfiguration::from_json(&legacy_json).unwrap();
    assert_eq!(parsed.assistant_id, assistant_id);
    assert!(parsed.provenance.is_none());

    let plain_chat = create_chat(&server, Some(&assistant)).await;
    let plain_chat_id = Uuid::parse_str(&plain_chat).unwrap();
    let plain_row = erato::db::entity::chats::Entity::find_by_id(plain_chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(plain_row.origin_chat_id, None);

    let delegated_chat = create_chat(&server, Some(&assistant)).await;
    let delegated_chat_id = Uuid::parse_str(&delegated_chat).unwrap();
    write_delegation_provenance(
        &app_state.db,
        delegated_chat_id,
        assistant_id,
        plain_chat_id,
        Some(assistant_id),
    )
    .await;
    let delegated_row = erato::db::entity::chats::Entity::find_by_id(delegated_chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(delegated_row.origin_chat_id, Some(plain_chat_id));

    let round_tripped =
        AssistantConfiguration::from_json(delegated_row.assistant_configuration.as_ref().unwrap())
            .unwrap();
    let provenance = round_tripped.provenance.unwrap();
    assert_eq!(provenance.kind, ChatProvenanceKind::Delegation);
    assert_eq!(provenance.origin_chat_id, Some(plain_chat_id));
    assert_eq!(provenance.depth, 1);
}
