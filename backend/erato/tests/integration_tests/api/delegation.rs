//! Tests for the delegation backend: provenance envelope, `seed_chat_lineage`,
//! and the ContextRebase behavior of prompt composition.

use crate::test_app_state;
use crate::test_utils::{
    Event, JwtTokenBuilder, RequestBodyRecorder, TEST_JWT_TOKEN, TEST_USER_ISSUER,
    TEST_USER_SUBJECT, TestRequestAuthExt, archive_chat_via_api, parse_sse_events,
    setup_mock_llm_server_with_mocks, unarchive_chat_via_api,
};
use axum::Router;
use axum::http;
use axum_test::TestServer;
use axum_test::multipart::{MultipartForm, Part};
use erato::models::chat::{
    ChatConfiguration, ChatProvenance, ChatProvenanceKind, seed_chat_lineage,
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
    let configuration = ChatConfiguration {
        assistant_id: Some(delegate_assistant_id),
        provenance: Some(ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(origin_chat_id),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        }),
        task: None,
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
    assert_eq!(
        stats.lineage_tip_id,
        target_rows.last().map(|row| row.id),
        "the reported tip is the head the target chat continues from"
    );

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
    let parsed = ChatConfiguration::from_json(&legacy_json).unwrap();
    assert_eq!(parsed.assistant_id, Some(assistant_id));
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
        ChatConfiguration::from_json(delegated_row.assistant_configuration.as_ref().unwrap())
            .unwrap();
    let provenance = round_tripped.provenance.unwrap();
    assert_eq!(provenance.kind, ChatProvenanceKind::Delegation);
    assert_eq!(provenance.origin_chat_id, Some(plain_chat_id));
    assert_eq!(provenance.depth, 1);
}
async fn submit_with_mentions(
    server: &TestServer,
    chat_id: Option<&str>,
    text: &str,
    mentioned_assistant_ids: &[&str],
) -> axum_test::TestResponse {
    let mut body = json!({
        "user_message": text,
        "mentioned_assistant_ids": mentioned_assistant_ids,
    });
    if let Some(chat_id) = chat_id {
        body["existing_chat_id"] = json!(chat_id);
    }
    server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body)
        .await
}

async fn submit_with_mentions_with_previous(
    server: &TestServer,
    chat_id: &str,
    previous_message_id: Option<&str>,
    text: &str,
    mentioned_assistant_ids: &[&str],
) -> axum_test::TestResponse {
    let mut body = json!({
        "existing_chat_id": chat_id,
        "user_message": text,
        "mentioned_assistant_ids": mentioned_assistant_ids,
    });
    if let Some(previous) = previous_message_id {
        body["previous_message_id"] = json!(previous);
    }
    server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body)
        .await
}

fn delegation_enabled_config() -> erato::config::AppConfig {
    let mut app_config = crate::test_utils::hermetic_app_config(None, None);
    app_config.delegation.assistants.enabled = true;
    app_config
}

async fn delegation_enabled_state_with_llm(
    pool: Pool<Postgres>,
) -> (erato::state::AppState, mocktail::server::MockServer) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["mentioned answer"]),
        );
    });
    let (mut app_config, server) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    (app_state, server)
}

/// Validation matrix for `mentioned_assistant_ids`: server-side gate, mention
/// cap, archived target, self-mention, and inaccessible target all 400.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_mention_validation_matrix(pool: Pool<Postgres>) {
    let app_state = test_app_state(delegation_enabled_config(), pool).await;
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());

    // Over the default cap of 3.
    let mut many = Vec::new();
    for index in 0..4 {
        many.push(create_assistant(&server, &format!("Cap Assistant {index}"), "prompt").await);
    }
    let many_refs: Vec<&str> = many.iter().map(String::as_str).collect();
    let response = submit_with_mentions(&server, None, "over cap", &many_refs).await;
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Archived target.
    let archived = create_assistant(&server, "Archived Assistant", "prompt").await;
    server
        .post(&format!("/api/v1beta/assistants/{archived}/archive"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({}))
        .await
        .assert_status_ok();
    let response = submit_with_mentions(&server, None, "archived", &[&archived]).await;
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Self-mention on an assistant-bound chat.
    let bound = create_assistant(&server, "Bound Assistant", "prompt").await;
    let bound_chat = create_chat(&server, Some(&bound)).await;
    let response = submit_with_mentions(&server, Some(&bound_chat), "self", &[&bound]).await;
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Inaccessible target (another user's assistant, no grant).
    let other_user = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "delegation-other-user",
        None,
    )
    .await
    .unwrap();
    let foreign = erato::models::assistant::create_assistant(
        &app_state.db,
        &erato::policy::engine::PolicyEngine::new(),
        &erato::policy::types::Subject::User(other_user.id.to_string()),
        "Foreign Assistant".to_string(),
        None,
        "foreign prompt".to_string(),
        None,
        None,
        None,
        false,
    )
    .await
    .unwrap();
    let response = submit_with_mentions(&server, None, "foreign", &[&foreign.id.to_string()]).await;
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Unknown id.
    let response = submit_with_mentions(
        &server,
        None,
        "unknown",
        &["00000000-0000-0000-0000-00000000dead"],
    )
    .await;
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);
}

/// With the delegation gate off, a submit carrying mentions is rejected even
/// when the mentioned assistant would otherwise be valid.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_mentions_rejected_when_delegation_disabled(pool: Pool<Postgres>) {
    let app_state = test_app_state(crate::test_utils::hermetic_app_config(None, None), pool).await;
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());

    let assistant = create_assistant(&server, "Gated Assistant", "prompt").await;
    let response = submit_with_mentions(&server, None, "gate off", &[&assistant]).await;
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);

    // Regenerate with an explicit mention field is gated the same way.
    let regenerate_response = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "current_message_id": Uuid::new_v4(),
            "mentioned_assistant_ids": [assistant],
        }))
        .await;
    // The unknown message id 400s first; the point is the request shape parses.
    regenerate_response.assert_status(axum::http::StatusCode::BAD_REQUEST);
}

/// A shared assistant (viewer grant) is an accepted mention; the mentions
/// round-trip into the user message's `input_parameters`, deduplicated.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_shared_viewer_mention_accepted_and_persisted(pool: Pool<Postgres>) {
    let (app_state, _llm) = delegation_enabled_state_with_llm(pool).await;
    let server = app_server(app_state.clone());

    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let other_user = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "delegation-sharing-owner",
        None,
    )
    .await
    .unwrap();
    let shared = erato::models::assistant::create_assistant(
        &app_state.db,
        &erato::policy::engine::PolicyEngine::new(),
        &erato::policy::types::Subject::User(other_user.id.to_string()),
        "Shared Assistant".to_string(),
        None,
        "shared prompt".to_string(),
        None,
        None,
        None,
        false,
    )
    .await
    .unwrap();
    erato::models::share_grant::create_share_grant(
        &app_state.db,
        &erato::policy::engine::PolicyEngine::new(),
        &erato::policy::types::Subject::User(other_user.id.to_string()),
        "assistant".to_string(),
        shared.id.to_string(),
        "user".to_string(),
        "id".to_string(),
        me.id.to_string(),
        "viewer".to_string(),
    )
    .await
    .unwrap();

    let shared_id = shared.id.to_string();
    // Duplicate mention: accepted and persisted deduplicated.
    let response =
        submit_with_mentions(&server, None, "shared mention", &[&shared_id, &shared_id]).await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = crate::test_utils::extract_chat_id(&events).unwrap();

    let rows = chat_messages_by_created_at(&app_state.db, Uuid::parse_str(&chat_id).unwrap()).await;
    let user_row = rows
        .iter()
        .find(|row| row.raw_message["role"] == "user")
        .expect("user message row");
    let persisted =
        erato::models::message::get_input_mentioned_assistant_ids_from_message(user_row)
            .unwrap()
            .expect("mentions persisted");
    assert_eq!(persisted, vec![shared.id]);
}

/// Regenerate without the field re-reads the persisted mentions; edit without
/// the field carries them onto the new sibling row.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_regenerate_and_edit_replay_persisted_mentions(pool: Pool<Postgres>) {
    let (app_state, _llm) = delegation_enabled_state_with_llm(pool).await;
    let server = app_server(app_state.clone());

    let target = create_assistant(&server, "Replay Target", "prompt").await;
    let response = submit_with_mentions(&server, None, "mention on submit", &[&target]).await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = crate::test_utils::extract_chat_id(&events).unwrap();
    let assistant_message_id = assistant_message_id_from_events(&events);

    // Regenerate without the field: the persisted mentions replay (200).
    let regenerate_response = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "current_message_id": assistant_message_id }))
        .await;
    regenerate_response.assert_status_ok();

    // Edit without the field: mentions carry onto the new sibling row.
    let rows = chat_messages_by_created_at(&app_state.db, Uuid::parse_str(&chat_id).unwrap()).await;
    let original_user_row = rows
        .iter()
        .find(|row| row.raw_message["role"] == "user")
        .expect("user message row");
    let edit_response = server
        .post("/api/v1beta/me/messages/editstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": original_user_row.id,
            "replace_user_message": "edited mention message",
        }))
        .await;
    edit_response.assert_status_ok();

    let rows = chat_messages_by_created_at(&app_state.db, Uuid::parse_str(&chat_id).unwrap()).await;
    let edited_row = rows
        .iter()
        .find(|row| row.raw_message["content"][0]["text"] == "edited mention message")
        .expect("edited sibling row");
    let persisted =
        erato::models::message::get_input_mentioned_assistant_ids_from_message(edited_row)
            .unwrap()
            .expect("mentions carried onto the edited row");
    assert_eq!(persisted, vec![Uuid::parse_str(&target).unwrap()]);

    // Edit with an explicit invalid mention still 400s.
    let bad_edit = server
        .post("/api/v1beta/me/messages/editstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": original_user_row.id,
            "replace_user_message": "bad mention",
            "mentioned_assistant_ids": ["00000000-0000-0000-0000-00000000dead"],
        }))
        .await;
    bad_edit.assert_status(axum::http::StatusCode::BAD_REQUEST);
}

/// The messages read API resolves persisted mentions into `{id, name}` pairs
/// on the user message, ids that no longer resolve are omitted, and both
/// assistant messages and mention-less user messages carry no key at all. The
/// SSE `user_message_saved` payload carries the same pairs, so the just-sent
/// message can highlight without waiting for a refetch.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_messages_read_resolves_mentioned_assistants(pool: Pool<Postgres>) {
    let (app_state, _llm) = delegation_enabled_state_with_llm(pool).await;
    let server = app_server(app_state.clone());

    let alpha = create_assistant(&server, "Mention Alpha", "prompt").await;
    let beta = create_assistant(&server, "Mention Beta", "prompt").await;

    let response = submit_with_mentions(
        &server,
        None,
        "ask @Mention Alpha and @Mention Beta",
        &[&alpha, &beta],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = crate::test_utils::extract_chat_id(&events).unwrap();

    let expected_pairs = json!([
        { "id": alpha, "name": "Mention Alpha" },
        { "id": beta, "name": "Mention Beta" }
    ]);

    // The live event already carries the resolved pairs.
    let saved_event = events
        .iter()
        .find_map(|event| {
            let json = serde_json::from_str::<Value>(&event.data).ok()?;
            (json["message_type"] == "user_message_saved").then_some(json)
        })
        .expect("user_message_saved event");
    assert_eq!(
        saved_event["message"]["mentioned_assistants"],
        expected_pairs
    );

    let list_messages = |chat_id: String| {
        let server = &server;
        async move {
            let response = server
                .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
                .with_bearer_token(TEST_JWT_TOKEN)
                .await;
            response.assert_status_ok();
            response.json::<Value>()["messages"].clone()
        }
    };

    let messages = list_messages(chat_id.clone()).await;
    let user_message = messages
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["role"] == "user")
        .expect("user message");
    assert_eq!(user_message["mentioned_assistants"], expected_pairs);
    let assistant_message = messages
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["role"] == "assistant")
        .expect("assistant message");
    assert!(
        assistant_message.get("mentioned_assistants").is_none(),
        "assistant messages must not carry the key"
    );

    // An id that no longer resolves is omitted while the rest keep resolving.
    let chat_uuid = Uuid::parse_str(&chat_id).unwrap();
    let rows = chat_messages_by_created_at(&app_state.db, chat_uuid).await;
    let user_row = rows
        .iter()
        .find(|row| row.raw_message["role"] == "user")
        .expect("user message row");
    let mut input_parameters = user_row.input_parameters.clone().unwrap();
    input_parameters["mentioned_assistant_ids"]
        .as_array_mut()
        .unwrap()
        .push(json!("00000000-0000-0000-0000-00000000dead"));
    let mut active: erato::db::entity::messages::ActiveModel = user_row.clone().into();
    active.input_parameters = ActiveValue::Set(Some(input_parameters));
    active.update(&app_state.db).await.unwrap();

    let messages = list_messages(chat_id.clone()).await;
    let user_message = messages
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["role"] == "user")
        .expect("user message");
    assert_eq!(user_message["mentioned_assistants"], expected_pairs);

    // A mention-less user message carries no key at all.
    let plain_chat = create_chat(&server, None).await;
    submit_message(&server, &plain_chat, None, "no mentions here", vec![]).await;
    let messages = list_messages(plain_chat).await;
    let plain_user_message = messages
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["role"] == "user")
        .expect("plain user message");
    assert!(plain_user_message.get("mentioned_assistants").is_none());
}

/// The requested run mode round-trips into the user message's
/// `input_parameters`: `background` is persisted verbatim even though
/// `allow_background` is off — the gate applies at dispatch, not at
/// persistence — while an absent or explicit `wait` leaves no key behind.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_submit_persists_requested_background_run_mode(pool: Pool<Postgres>) {
    async fn user_row_of(
        server: &TestServer,
        db: &sea_orm::DatabaseConnection,
        body: Value,
    ) -> erato::db::entity::messages::Model {
        let response = server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&body)
            .await;
        response.assert_status_ok();
        let events = parse_sse_events(&response);
        let chat_id = crate::test_utils::extract_chat_id(&events).unwrap();
        chat_messages_by_created_at(db, Uuid::parse_str(&chat_id).unwrap())
            .await
            .into_iter()
            .find(|row| row.raw_message["role"] == "user")
            .expect("user message row")
    }

    let (app_state, _llm) = delegation_enabled_state_with_llm(pool).await;
    let server = app_server(app_state.clone());
    let target = create_assistant(&server, "Run Mode Target", "prompt").await;

    // Background with a mention: both persist.
    let row = user_row_of(
        &server,
        &app_state.db,
        json!({
            "user_message": "background with mention",
            "mentioned_assistant_ids": [target],
            "delegation_run_mode": "background",
        }),
    )
    .await;
    let input_params = row.input_parameters.as_ref().expect("input parameters");
    assert_eq!(input_params["delegation_run_mode"], "background");
    assert_eq!(
        erato::models::message::get_input_delegation_run_mode_from_message(&row).unwrap(),
        Some(erato::models::message::DelegationRunMode::Background)
    );

    // Background without a mention: the mode persists on its own.
    let row = user_row_of(
        &server,
        &app_state.db,
        json!({
            "user_message": "background without mention",
            "delegation_run_mode": "background",
        }),
    )
    .await;
    let input_params = row.input_parameters.as_ref().expect("input parameters");
    assert_eq!(input_params["delegation_run_mode"], "background");
    assert!(input_params.get("mentioned_assistant_ids").is_none());

    // Field absent: no run mode key next to the persisted mentions.
    let row = user_row_of(
        &server,
        &app_state.db,
        json!({
            "user_message": "absent field",
            "mentioned_assistant_ids": [target],
        }),
    )
    .await;
    let input_params = row.input_parameters.as_ref().expect("input parameters");
    assert!(input_params.get("delegation_run_mode").is_none());

    // Explicit wait: persisted as absent, same as the default.
    let row = user_row_of(
        &server,
        &app_state.db,
        json!({
            "user_message": "explicit wait",
            "mentioned_assistant_ids": [target],
            "delegation_run_mode": "wait",
        }),
    )
    .await;
    let input_params = row.input_parameters.as_ref().expect("input parameters");
    assert!(input_params.get("delegation_run_mode").is_none());
}

/// Edit replays the persisted run mode onto the new sibling row when the
/// request doesn't re-send it, and an explicit `wait` on the edit clears the
/// inherited `background` instead of falling back to it.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_edit_inherits_and_explicit_wait_clears_run_mode(pool: Pool<Postgres>) {
    let (app_state, _llm) = delegation_enabled_state_with_llm(pool).await;
    let server = app_server(app_state.clone());
    let target = create_assistant(&server, "Run Mode Edit Target", "prompt").await;

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "background origin",
            "mentioned_assistant_ids": [target],
            "delegation_run_mode": "background",
        }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = Uuid::parse_str(&crate::test_utils::extract_chat_id(&events).unwrap()).unwrap();
    let rows = chat_messages_by_created_at(&app_state.db, chat_id).await;
    let original_user_row = rows
        .iter()
        .find(|row| row.raw_message["role"] == "user")
        .expect("user message row");

    // Edit without the field: background carries onto the new sibling row.
    let edit_response = server
        .post("/api/v1beta/me/messages/editstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": original_user_row.id,
            "replace_user_message": "edited, mode inherited",
        }))
        .await;
    edit_response.assert_status_ok();
    let rows = chat_messages_by_created_at(&app_state.db, chat_id).await;
    let edited_row = rows
        .iter()
        .find(|row| row.raw_message["content"][0]["text"] == "edited, mode inherited")
        .expect("edited sibling row");
    assert_eq!(
        erato::models::message::get_input_delegation_run_mode_from_message(edited_row).unwrap(),
        Some(erato::models::message::DelegationRunMode::Background)
    );

    // Edit with an explicit wait: the inherited background is cleared while
    // the mentions still replay.
    let edit_response = server
        .post("/api/v1beta/me/messages/editstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": original_user_row.id,
            "replace_user_message": "edited, mode cleared",
            "delegation_run_mode": "wait",
        }))
        .await;
    edit_response.assert_status_ok();
    let rows = chat_messages_by_created_at(&app_state.db, chat_id).await;
    let cleared_row = rows
        .iter()
        .find(|row| row.raw_message["content"][0]["text"] == "edited, mode cleared")
        .expect("cleared sibling row");
    let input_params = cleared_row
        .input_parameters
        .as_ref()
        .expect("input parameters");
    assert!(input_params.get("delegation_run_mode").is_none());
    assert_eq!(
        erato::models::message::get_input_mentioned_assistant_ids_from_message(cleared_row)
            .unwrap()
            .expect("mentions carried onto the cleared row"),
        vec![Uuid::parse_str(&target).unwrap()]
    );
}

/// Regenerate accepts the run mode field on the wire: a request carrying
/// `delegation_run_mode` round-trips with a 200.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_regenerate_accepts_run_mode_field(pool: Pool<Postgres>) {
    let (app_state, _llm) = delegation_enabled_state_with_llm(pool).await;
    let server = app_server(app_state.clone());

    let target = create_assistant(&server, "Run Mode Regen Target", "prompt").await;
    let response = submit_with_mentions(&server, None, "regen origin", &[&target]).await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let assistant_message_id = assistant_message_id_from_events(&events);

    let regenerate_response = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "current_message_id": assistant_message_id,
            "delegation_run_mode": "background",
        }))
        .await;
    regenerate_response.assert_status_ok();
}

const DELEGATE_ASSISTANT_FIXED_ID: &str = "00000000-0000-4000-8000-00000000d001";

async fn insert_fixed_delegate_assistant(
    db: &sea_orm::DatabaseConnection,
    owner_user_id: Uuid,
    prompt: &str,
    mcp_server_ids: Option<Vec<String>>,
) -> Uuid {
    let id = Uuid::parse_str(DELEGATE_ASSISTANT_FIXED_ID).unwrap();
    let now: sea_orm::prelude::DateTimeWithTimeZone = sqlx::types::chrono::Utc::now().into();
    let assistant = erato::db::entity::assistants::ActiveModel {
        id: ActiveValue::Set(id),
        owner_user_id: ActiveValue::Set(owner_user_id),
        name: ActiveValue::Set("Fixed Delegate".to_string()),
        description: ActiveValue::Set(Some("A delegate assistant with a fixed id".to_string())),
        prompt: ActiveValue::Set(prompt.to_string()),
        mcp_server_ids: ActiveValue::Set(mcp_server_ids),
        default_chat_provider: ActiveValue::Set(None),
        archived_at: ActiveValue::Set(None),
        created_at: ActiveValue::Set(now),
        updated_at: ActiveValue::Set(now),
        facet_ids: ActiveValue::Set(None),
        enforce_facet_settings: ActiveValue::Set(false),
    };
    erato::db::entity::assistants::Entity::insert(assistant)
        .exec(db)
        .await
        .expect("insert fixed delegate assistant");
    id
}

/// The terminal `tool_call_update` for a tool; in-progress frames carry the
/// live trace, never the result.
fn find_tool_call_update_output(events: &[Event], tool_name: &str) -> Value {
    events
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .find(|json| {
            json["message_type"] == "tool_call_update"
                && json["tool_name"] == tool_name
                && json["status"] != "in_progress"
        })
        .map(|json| json["output"].clone())
        .expect("expected a terminal tool_call_update for the tool")
}

fn extract_full_text_answer(events: &[Event]) -> String {
    crate::test_utils::extract_full_text(events)
}

/// The live frames the delegated child's progress produced on the parent's
/// tool part, oldest first.
fn delegation_progress_frames(events: &[Event]) -> Vec<Value> {
    events
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .filter(|json| {
            json["message_type"] == "tool_call_update"
                && json["tool_name"] == "delegate_to_assistant"
                && json["status"] == "in_progress"
        })
        .collect()
}

/// `sequence` is both identity and ordering: every frame carries the whole
/// trace, and a sequence keeps its step across frames rather than being
/// renumbered.
fn assert_trace_sequences_stable(traces: &[Value]) {
    let mut id_by_sequence: std::collections::HashMap<u64, String> =
        std::collections::HashMap::new();
    let mut previous_len = 0;
    for trace in traces {
        let steps = trace["steps"].as_array().expect("localTrace.steps");
        assert!(steps.len() >= previous_len, "frames must be cumulative");
        previous_len = steps.len();
        for (index, step) in steps.iter().enumerate() {
            let sequence = step["sequence"].as_u64().expect("step sequence");
            assert_eq!(sequence as usize, index, "sequences are dense and ordered");
            let id = step["id"].as_str().expect("step id").to_string();
            let known = id_by_sequence.entry(sequence).or_insert_with(|| id.clone());
            assert_eq!(*known, id, "sequence {sequence} changed step");
        }
    }
}

async fn delegated_child_chat(
    db: &sea_orm::DatabaseConnection,
    origin_chat_id: Uuid,
) -> erato::db::entity::chats::Model {
    erato::db::entity::chats::Entity::find()
        .filter(erato::db::entity::chats::Column::OriginChatId.eq(origin_chat_id))
        .one(db)
        .await
        .unwrap()
        .expect("expected a delegated child chat")
}

/// The event types a chat's generation left in the shared stream, in order —
/// what a resume landing on another replica replays.
async fn shared_generation_event_types(
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
) -> Vec<String> {
    use sea_orm::{ConnectionTrait, Statement};
    db.query_all_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        r#"SELECT event ->> 'message_type' AS message_type
           FROM temp_chat_generation_events
           JOIN temp_chat_generations USING (generation_id)
           WHERE chat_id = $1
           ORDER BY event_id"#,
        [chat_id.into()],
    ))
    .await
    .unwrap()
    .iter()
    .map(|row| row.try_get::<String>("", "message_type").unwrap())
    .collect()
}

/// Happy path: the parent turn calls `delegate_to_assistant`, the child run
/// completes, the parent receives the envelope and finishes. Also proves the
/// child's request head carries the delegate prompt + preamble (not the
/// origin head) and that globally allowlisted client tools are suppressed in
/// the child while offered to the parent.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegation_happy_path_runs_child_and_returns_envelope(pool: Pool<Postgres>) {
    let parent_first_recorder = RequestBodyRecorder::new();
    let child_recorder = RequestBodyRecorder::new();
    let parent_final_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    {
        let recorder = child_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["CHILD-TASK-BRIEF"],
                    &["delegate_chat_id"],
                ))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&[
                    "CHILD-ANSWER forty-two",
                ]),
            );
        });
    }
    {
        let recorder = parent_final_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&["delegate_chat_id"], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&[
                    "PARENT-FINAL-ANSWER using the delegate result",
                ]),
            );
        });
    }
    {
        let recorder = parent_first_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["parent question alpha"],
                    &["CHILD-TASK-BRIEF", "delegate_chat_id"],
                ))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                    "call_delegate_1",
                    "delegate_to_assistant",
                    json!({
                        "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                        "task": "CHILD-TASK-BRIEF: summarize the numbers",
                        "expected_output": "EXPECTED-OUTPUT-SENTINEL: one number per line",
                        "constraints": "CONSTRAINTS-SENTINEL: use only the attached figures",
                    }),
                )]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    // A globally allowlisted client tool: offered to the parent request,
    // suppressed in the delegated child run.
    app_config.client_tools.tools.insert(
        "probe".to_string(),
        erato::config::ClientToolConfig {
            name: "probe_client_tool".to_string(),
            namespace: None,
            description: "A probe client tool".to_string(),
            parameters: r#"{"type":"object","properties":{}}"#.to_string(),
            timeout_ms: None,
        },
    );
    app_config.facets.tool_call_allowlist = vec!["client/*".to_string()];
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, &delegate_prompt(), None).await;
    let server = app_server(app_state.clone());

    let origin_assistant = create_assistant(
        &server,
        "Origin Assistant",
        &format!("{ORIGIN_PROMPT_SENTINEL} answer with the delegate's help."),
    )
    .await;
    let parent_chat = create_chat(&server, Some(&origin_assistant)).await;
    // Writes off and a server and a tool switched off on the parent:
    // delegation is not a write, so the run still happens, and the child
    // must start with the same toggle and the same disabled lists.
    server
        .put(&format!("/api/v1beta/me/chats/{parent_chat}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "mcp_write_tools_enabled": false,
            "disabled_mcp_server_ids": ["files"],
            "disabled_mcp_tools": ["crm/send_invoice"],
        }))
        .await
        .assert_status_ok();

    let response = submit_with_mentions(
        &server,
        Some(&parent_chat),
        "parent question alpha",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    // Envelope on the SSE tool_call_update.
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "completed");
    assert_eq!(output["assistant_name"], "Fixed Delegate");
    assert_eq!(output["truncated"], false);
    assert!(
        output["result"]
            .as_str()
            .unwrap()
            .contains("CHILD-ANSWER forty-two")
    );
    let delegate_chat_id = Uuid::parse_str(output["delegate_chat_id"].as_str().unwrap()).unwrap();

    // The child streamed its progress onto the parent's tool part while it
    // ran: cumulative frames, no terminal status, then the same trace on the
    // terminal frame.
    let progress_frames = delegation_progress_frames(&events);
    assert!(
        !progress_frames.is_empty(),
        "expected live delegation progress frames"
    );
    let mut traces: Vec<Value> = progress_frames
        .iter()
        .map(|frame| {
            let frame_output = &frame["output"];
            assert_eq!(
                frame_output["delegate_chat_id"],
                delegate_chat_id.to_string()
            );
            assert_eq!(frame_output["assistant_name"], "Fixed Delegate");
            assert!(
                frame_output.get("status").is_none(),
                "the running shape carries no status"
            );
            let trace = frame_output["localTrace"].clone();
            assert!(!trace["steps"].as_array().unwrap().is_empty());
            trace
        })
        .collect();
    traces.push(output["localTrace"].clone());
    assert_trace_sequences_stable(&traces);

    let answer_step = output["localTrace"]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["id"] == "answer")
        .expect("the delegate's answer step");
    assert_eq!(answer_step["status"], "ok");
    assert!(answer_step["durationMs"].is_number());
    assert!(answer_step["startedAtOffsetMs"].is_number());
    assert!(output["localTrace"]["totalDurationMs"].is_number());
    assert!(
        !serde_json::to_string(&output["localTrace"])
            .unwrap()
            .contains("CHILD-ANSWER"),
        "the trace must not carry the delegate's text"
    );

    // The parent's final answer reacted to the result.
    assert!(extract_full_text_answer(&events).contains("PARENT-FINAL-ANSWER"));

    // Persisted tool_use part carries the envelope.
    let assistant_message_id = assistant_message_id_from_events(&events);
    let messages_response = server
        .get(&format!("/api/v1beta/chats/{parent_chat}/messages"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    messages_response.assert_status_ok();
    let messages_json = messages_response.json::<Value>();
    let parent_assistant_message = messages_json["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["id"] == assistant_message_id.as_str())
        .expect("parent assistant message");
    let tool_use = parent_assistant_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| part["content_type"] == "tool_use")
        .expect("tool_use part");
    assert_eq!(tool_use["tool_name"], "delegate_to_assistant");
    assert_eq!(tool_use["status"], "success");
    assert_eq!(tool_use["output"]["status"], "completed");
    assert_eq!(
        tool_use["output"]["delegate_chat_id"],
        delegate_chat_id.to_string()
    );
    assert_eq!(tool_use["output"]["localTrace"], output["localTrace"]);

    // Child chat: bound to the delegate, full provenance, title = brief.
    let child_chat =
        delegated_child_chat(&app_state.db, Uuid::parse_str(&parent_chat).unwrap()).await;
    assert_eq!(child_chat.id, delegate_chat_id);
    assert_eq!(child_chat.owner_user_id, me.id.to_string());
    assert_eq!(
        child_chat.title_by_user_provided.as_deref(),
        Some("CHILD-TASK-BRIEF: summarize the numbers")
    );
    assert!(
        !child_chat.mcp_write_tools_enabled,
        "the child inherits the parent's write toggle"
    );
    assert_eq!(
        child_chat.disabled_mcp_server_ids,
        vec!["files".to_string()],
        "the child inherits the parent's disabled servers"
    );
    assert_eq!(
        child_chat.disabled_mcp_tools,
        vec!["crm/send_invoice".to_string()],
        "the child inherits the parent's disabled tools"
    );
    let configuration = erato::models::chat::ChatConfiguration::from_json(
        child_chat.assistant_configuration.as_ref().unwrap(),
    )
    .unwrap();
    assert_eq!(
        configuration.assistant_id,
        Some(Uuid::parse_str(DELEGATE_ASSISTANT_FIXED_ID).unwrap())
    );
    let provenance = configuration.provenance.unwrap();
    assert_eq!(provenance.kind, ChatProvenanceKind::Delegation);
    assert_eq!(
        provenance.origin_chat_id,
        Some(Uuid::parse_str(&parent_chat).unwrap())
    );
    assert!(provenance.origin_message_id.is_some());
    assert_eq!(provenance.depth, 1);
    assert!(provenance.rebase_cutoff.is_some());
    // The structured brief lives in the envelope, not only in the parent's
    // tool-call input — that copy sits in a chat the child cannot read. It is
    // carried by the task spec, and the route it came from is recorded with it.
    let task = configuration
        .task
        .expect("a delegated run carries a task spec");
    assert_eq!(
        task.expected_output.as_deref(),
        Some("EXPECTED-OUTPUT-SENTINEL: one number per line")
    );
    assert_eq!(
        task.constraints.as_deref(),
        Some("CONSTRAINTS-SENTINEL: use only the attached figures")
    );
    assert_eq!(task.route, erato::models::chat::DelegateRoute::Assistant);
    assert_eq!(child_chat.generation_state.as_deref(), Some("completed"));
    assert_eq!(
        shared_generation_event_types(&app_state.db, child_chat.id)
            .await
            .last()
            .map(String::as_str),
        Some("stream_end"),
        "a resume tailing the child's shared stream has to see it close"
    );

    // The child's stored first message is the brief a person would read, with
    // none of the run directive in it.
    let child_messages_response = server
        .get(&format!("/api/v1beta/chats/{}/messages", child_chat.id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    child_messages_response.assert_status_ok();
    let child_messages_json = child_messages_response.json::<Value>();
    let child_user_message = child_messages_json["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["role"] == "user")
        .expect("the child's user message");
    let child_answer_message_id = child_messages_json["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["role"] == "assistant")
        .expect("the child's answer")["id"]
        .as_str()
        .unwrap()
        .to_string();
    let child_user_text = child_user_message["content"][0]["text"].as_str().unwrap();
    assert_eq!(child_user_text, "CHILD-TASK-BRIEF: summarize the numbers");
    for machinery in [
        "system-reminder",
        "delegating conversation",
        "Expected output:",
        "Constraints:",
    ] {
        assert!(
            !serde_json::to_string(child_user_message)
                .unwrap()
                .contains(machinery),
            "the stored child message must not carry '{machinery}'"
        );
    }

    // The child's request head: delegate prompt + preamble, no origin head.
    let child_bodies = child_recorder.bodies();
    assert_eq!(child_bodies.len(), 1);
    let child_body: Value = serde_json::from_str(&child_bodies[0]).unwrap();
    let child_messages = child_body["messages"].as_array().unwrap();
    assert_eq!(child_messages[0]["role"], "system");
    assert!(
        child_messages[0]["content"]
            .as_str()
            .unwrap()
            .contains(DELEGATE_PROMPT_SENTINEL)
    );
    assert!(!child_bodies[0].contains(ORIGIN_PROMPT_SENTINEL));
    assert!(child_bodies[0].contains("delegating conversation"));
    assert!(child_bodies[0].contains("system-reminder"));
    // …and the composed request is where the structured brief reaches the
    // model, rendered from the envelope rather than replayed from the message.
    let child_directive = child_messages
        .iter()
        .find(|message| {
            message["content"]
                .as_str()
                .is_some_and(|content| content.contains("<system-reminder>"))
        })
        .expect("the composed run directive");
    assert_eq!(child_directive["role"], "user");
    let child_directive_text = child_directive["content"].as_str().unwrap();
    assert!(child_directive_text.contains("EXPECTED-OUTPUT-SENTINEL: one number per line"));
    assert!(child_directive_text.contains("CONSTRAINTS-SENTINEL: use only the attached figures"));
    assert!(!child_directive_text.contains("CHILD-TASK-BRIEF"));

    // Client-tool suppression: offered to the parent, absent in the child.
    // The recorder also sees the parent's chat-summary request (no tools), so
    // pick the completion request by its tool offer.
    let parent_bodies = parent_first_recorder.bodies();
    let parent_completion_body = parent_bodies
        .iter()
        .find(|body| body.contains("delegate_to_assistant"))
        .expect("parent completion request with the delegation tool offer");
    assert!(parent_completion_body.contains("probe_client_tool"));
    assert!(!child_bodies[0].contains("probe_client_tool"));
    // The delegation tool itself is never offered to the child.
    assert!(!child_bodies[0].contains("delegate_to_assistant"));

    // The trace is UI-only. A follow-up turn replays the stored tool part, so
    // it is the request that would expose the trace to the origin model.
    let follow_up_events = submit_message(
        &server,
        &parent_chat,
        Some(&assistant_message_id),
        "parent follow-up question",
        vec![],
    )
    .await;
    assert!(extract_full_text_answer(&follow_up_events).contains("PARENT-FINAL-ANSWER"));
    for body in parent_final_recorder.bodies() {
        assert!(
            body.contains("delegate_chat_id"),
            "the model does see the compact envelope"
        );
        assert!(
            !body.contains("localTrace"),
            "the trace must never reach the origin model"
        );
    }

    // Taking the run over ends the run directive: the owner is who the
    // delegate is answering now, so it is neither re-derived for this turn nor
    // replayed out of the first turn's snapshot.
    let child_follow_up = submit_message(
        &server,
        &child_chat.id.to_string(),
        Some(&child_answer_message_id),
        "owner follow-up inside the run",
        vec![],
    )
    .await;
    assert!(extract_full_text_answer(&child_follow_up).contains("CHILD-ANSWER"));
    let child_follow_up_body = child_recorder
        .bodies()
        .into_iter()
        .find(|body| body.contains("owner follow-up inside the run"))
        .expect("the adopted run's request");
    for machinery in [
        "system-reminder",
        "delegating conversation",
        "EXPECTED-OUTPUT-SENTINEL",
        "CONSTRAINTS-SENTINEL",
    ] {
        assert!(
            !child_follow_up_body.contains(machinery),
            "an adopted run must not carry '{machinery}'"
        );
    }
    assert!(
        child_follow_up_body.contains("CHILD-TASK-BRIEF"),
        "the brief itself still replays — it is a real message"
    );
}

/// A call naming an assistant that was not offered refuses the call and the
/// turn recovers in prose.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegation_unoffered_target_refused_turn_recovers(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["Delegation refused"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[
                "PARENT-UNOFFERED-RECOVERED",
            ]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["unoffered question"],
                &["Delegation refused"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_bad",
                "delegate_to_assistant",
                json!({
                    "assistant_id": "00000000-0000-4000-8000-00000000dead",
                    "task": "should never run",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "delegate prompt", None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions(
        &server,
        None,
        "unoffered question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "error");
    assert!(
        output["error"]
            .as_str()
            .unwrap()
            .contains("not offered for delegation")
    );
    assert!(extract_full_text_answer(&events).contains("PARENT-UNOFFERED-RECOVERED"));

    // No child chat was created.
    let chat_id = crate::test_utils::extract_chat_id(&events).unwrap();
    let children = erato::db::entity::chats::Entity::find()
        .filter(
            erato::db::entity::chats::Column::OriginChatId.eq(Uuid::parse_str(&chat_id).unwrap()),
        )
        .all(&app_state.db)
        .await
        .unwrap();
    assert!(children.is_empty());
}

const FIXED_FILE_ID: &str = "00000000-0000-4000-8000-00000000f001";

async fn insert_fixed_parent_file(
    db: &sea_orm::DatabaseConnection,
    owner_user_id: &str,
    parent_chat_id: Uuid,
) -> Uuid {
    let id = Uuid::parse_str(FIXED_FILE_ID).unwrap();
    let now: sea_orm::prelude::DateTimeWithTimeZone = sqlx::types::chrono::Utc::now().into();
    let file = erato::db::entity::file_uploads::ActiveModel {
        id: ActiveValue::Set(id),
        filename: ActiveValue::Set("fixture.txt".to_string()),
        file_storage_provider_id: ActiveValue::Set("seaweedfs".to_string()),
        file_storage_path: ActiveValue::Set("delegation-test/missing-fixture.txt".to_string()),
        created_at: ActiveValue::Set(now),
        updated_at: ActiveValue::Set(now),
        owner_user_id: ActiveValue::Set(owner_user_id.to_string()),
        audio_transcription: ActiveValue::Set(None),
    };
    erato::db::entity::file_uploads::Entity::insert(file)
        .exec(db)
        .await
        .expect("insert fixture file");
    let join_row = erato::db::entity::chat_file_uploads::ActiveModel {
        chat_id: ActiveValue::Set(parent_chat_id),
        file_upload_id: ActiveValue::Set(id),
        ..Default::default()
    };
    erato::db::entity::chat_file_uploads::Entity::insert(join_row)
        .exec(db)
        .await
        .expect("insert fixture join row");
    id
}

/// `file_ids`: a named parent attachment is copied to the child chat; a file
/// id that is not a parent attachment refuses the call and the turn recovers.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegation_file_ids_copied_and_foreign_file_refused(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-FILE-TASK"],
                &["delegate_chat_id", "Delegation refused"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["CHILD-FILE-ANSWER"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["delegate_chat_id"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-FILE-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["Delegation refused"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-FILE-RECOVERED"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["attachedfile question"],
                &["CHILD-FILE-TASK", "delegate_chat_id", "Delegation refused"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_file",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-FILE-TASK read the attachment",
                    "file_ids": [FIXED_FILE_ID],
                }),
            )]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["foreignfile question"],
                &["delegate_chat_id", "Delegation refused"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_foreign",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-FOREIGN-TASK must not run",
                    "file_ids": ["00000000-0000-4000-8000-00000000feed"],
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "delegate prompt", None).await;
    let server = app_server(app_state.clone());

    // Named parent attachment is passed by reference.
    let parent_chat = create_chat(&server, None).await;
    let parent_chat_id = Uuid::parse_str(&parent_chat).unwrap();
    let file_id = insert_fixed_parent_file(&app_state.db, &me.id.to_string(), parent_chat_id).await;

    let response = submit_with_mentions(
        &server,
        Some(&parent_chat),
        "attachedfile question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "completed");
    assert!(extract_full_text_answer(&events).contains("PARENT-FILE-FINAL"));

    let child_chat = delegated_child_chat(&app_state.db, parent_chat_id).await;
    let child_join_row =
        erato::db::entity::chat_file_uploads::Entity::find_by_id((child_chat.id, file_id))
            .one(&app_state.db)
            .await
            .unwrap();
    assert!(
        child_join_row.is_some(),
        "file join row copied to the child"
    );
    let child_rows = chat_messages_by_created_at(&app_state.db, child_chat.id).await;
    let child_user_row = child_rows
        .iter()
        .find(|row| row.raw_message["role"] == "user")
        .unwrap();
    assert_eq!(
        child_user_row.input_file_uploads.as_deref(),
        Some(&[file_id][..])
    );

    // Foreign file id: refused, no child chat, turn recovers.
    let foreign_chat = create_chat(&server, None).await;
    let response = submit_with_mentions(
        &server,
        Some(&foreign_chat),
        "foreignfile question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "error");
    assert!(
        output["error"]
            .as_str()
            .unwrap()
            .contains("is not an attachment of this chat")
    );
    assert!(extract_full_text_answer(&events).contains("PARENT-FILE-RECOVERED"));
    let children = erato::db::entity::chats::Entity::find()
        .filter(
            erato::db::entity::chats::Column::OriginChatId
                .eq(Uuid::parse_str(&foreign_chat).unwrap()),
        )
        .all(&app_state.db)
        .await
        .unwrap();
    assert!(children.is_empty());
}

/// `include_conversation_context`: the child is seeded with the origin
/// lineage and its first request carries the delegate head over the seeded
/// history (ContextRebase applied inside the delegated run).
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegation_context_seeding_rebases_child(pool: Pool<Postgres>) {
    let child_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    {
        let recorder = child_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["CHILD-CTX-TASK"],
                    &["delegate_chat_id"],
                ))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["CHILD-CTX-ANSWER"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["delegate_chat_id"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-CTX-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["please delegate with context"],
                &["CHILD-CTX-TASK", "delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_ctx",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-CTX-TASK continue from the context",
                    "include_conversation_context": true,
                }),
            )]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["seed context alpha"],
                &[
                    "please delegate with context",
                    "CHILD-CTX-TASK",
                    "delegate_chat_id",
                ],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["ORIGIN-CONTEXT-ANSWER"]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, &delegate_prompt(), None).await;
    let server = app_server(app_state.clone());

    let origin_assistant = create_assistant(
        &server,
        "Origin Assistant",
        &format!("{ORIGIN_PROMPT_SENTINEL} answer tersely."),
    )
    .await;
    let parent_chat = create_chat(&server, Some(&origin_assistant)).await;
    let first_events =
        submit_message(&server, &parent_chat, None, "seed context alpha", vec![]).await;
    let first_assistant_message = assistant_message_id_from_events(&first_events);

    let response = submit_with_mentions_with_previous(
        &server,
        &parent_chat,
        Some(&first_assistant_message),
        "please delegate with context",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "completed");
    assert!(extract_full_text_answer(&events).contains("PARENT-CTX-FINAL"));

    let parent_chat_id = Uuid::parse_str(&parent_chat).unwrap();
    let child_chat = delegated_child_chat(&app_state.db, parent_chat_id).await;
    // Seeded copies (the replay anchor's lineage: seed user + seed answer),
    // then the task-brief user message and the child's answer.
    let child_rows = chat_messages_by_created_at(&app_state.db, child_chat.id).await;
    assert_eq!(child_rows.len(), 4);

    let child_bodies = child_recorder.bodies();
    assert_eq!(child_bodies.len(), 1);
    let child_body: Value = serde_json::from_str(&child_bodies[0]).unwrap();
    let child_messages = child_body["messages"].as_array().unwrap();
    assert_eq!(child_messages[0]["role"], "system");
    assert!(
        child_messages[0]["content"]
            .as_str()
            .unwrap()
            .contains(DELEGATE_PROMPT_SENTINEL)
    );
    assert!(!child_bodies[0].contains(ORIGIN_PROMPT_SENTINEL));
    assert!(child_bodies[0].contains("seed context alpha"));
    assert!(child_bodies[0].contains("ORIGIN-CONTEXT-ANSWER"));
}

fn mock_mcp_base_url() -> String {
    std::env::var("TEST_MOCK_MCP_SERVER_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:44321".to_string())
}

/// A delegate whose MCP tool is approval-gated under the `restrictive` preset
/// has the gated call refused in-run: the child completes in prose, the
/// envelope is `completed`, and the child chat is NOT parked awaiting
/// approval.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegation_refuses_approval_gated_mcp_in_child(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // Child turn 2: the refusal tool response arrived; answer in prose.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["approval, which is unavailable in a delegated run"],
                &["delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[
                "CHILD-MCP-DONE without the gated tool",
            ]),
        );
    });
    // Child turn 1: narrate, then call the approval-gated MCP tool.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-MCP-TASK"],
                &["delegate_chat_id", "approval, which is unavailable"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_narrated_tool_calls_streaming_response(
                "Let me publish the probe.",
                &[("call_probe", "publish_approval_probe", json!({}))],
            ),
        );
    });
    // Parent final turn.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["delegate_chat_id"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-MCP-FINAL"]),
        );
    });
    // Parent turn 1: delegate.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["mcp delegation question"],
                &["CHILD-MCP-TASK", "delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_mcp",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-MCP-TASK publish the probe",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        erato::config::McpServerConfig {
            transport_type: "streamable_http".to_string(),
            url: format!("{}/mcp/approval-policy", mock_mcp_base_url()),
            http_headers: None,
            allow_tools: None,
            exclude_tools: vec![],
            wait_tools: vec![],
            authentication: erato::config::McpServerAuthenticationConfig::None,
            max_session_idle_seconds: None,
        },
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(
        &app_state.db,
        me.id,
        "delegate with mcp",
        Some(vec!["mock_mcp_approval".to_string()]),
    )
    .await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions(
        &server,
        None,
        "mcp delegation question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "completed");
    assert!(
        output["result"]
            .as_str()
            .unwrap()
            .contains("CHILD-MCP-DONE")
    );
    assert!(extract_full_text_answer(&events).contains("PARENT-MCP-FINAL"));

    // The child's tool call is a step of its own, named after the tool. The
    // text announcing it is not a step: the answer is the run that ends the
    // generation, so it comes last and starts after the work it reports on.
    let steps = output["localTrace"]["steps"].as_array().unwrap();
    assert_eq!(steps.len(), 2);
    assert_eq!(steps[0]["id"], "publish_approval_probe");
    assert_eq!(steps[1]["id"], "answer");
    assert_eq!(steps[1]["status"], "ok");
    assert!(steps.iter().all(|step| step["status"] != "running"));
    assert!(
        steps[1]["startedAtOffsetMs"].as_u64().unwrap()
            >= steps[0]["startedAtOffsetMs"].as_u64().unwrap()
    );

    let chat_id = crate::test_utils::extract_chat_id(&events).unwrap();
    let child_chat = delegated_child_chat(&app_state.db, Uuid::parse_str(&chat_id).unwrap()).await;
    // Not parked: the durable approval stop was pre-empted by the refusal.
    assert_eq!(child_chat.generation_state.as_deref(), Some("completed"));

    let child_rows = chat_messages_by_created_at(&app_state.db, child_chat.id).await;
    let child_assistant_row = child_rows
        .iter()
        .find(|row| row.raw_message["role"] == "assistant")
        .unwrap();
    let content = child_assistant_row.raw_message["content"]
        .as_array()
        .unwrap();
    assert!(
        content
            .iter()
            .all(|part| part["content_type"] != "tool_approval_request"),
        "the child must not carry an approval request part"
    );
    let gated_tool_use = content
        .iter()
        .find(|part| {
            part["content_type"] == "tool_use" && part["tool_name"] == "publish_approval_probe"
        })
        .expect("gated MCP call recorded as a refused tool_use");
    assert_eq!(gated_tool_use["status"], "error");
    assert!(
        gated_tool_use["output"]["error"]
            .as_str()
            .unwrap()
            .contains("approval")
    );
}

/// A slow child run hits `run_timeout_seconds`: the envelope reports
/// `timeout`, the parent turn completes, and the child is not left running.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegation_timeout_aborts_child_and_parent_completes(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // Child: stall for far longer than the run timeout.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-SLOW-TASK"],
                &["delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            vec![
                BodyAction::Delay(std::time::Duration::from_secs(30)),
                BodyAction::Bytes("data: [DONE]\n\n".into()),
            ],
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["delegate_chat_id"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-TIMEOUT-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["slow delegation question"],
                &["CHILD-SLOW-TASK", "delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_slow",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-SLOW-TASK take your time",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.run_timeout_seconds = 1;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "slow delegate", None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions(
        &server,
        None,
        "slow delegation question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    // A deadline is a cause, not an outcome: the run was cancelled, and the
    // reason says by what.
    assert_eq!(output["status"], "cancelled");
    assert_eq!(output["reason"], "timeout");
    assert!(extract_full_text_answer(&events).contains("PARENT-TIMEOUT-FINAL"));

    let chat_id = crate::test_utils::extract_chat_id(&events).unwrap();
    let child_chat = delegated_child_chat(&app_state.db, Uuid::parse_str(&chat_id).unwrap()).await;
    // The child was aborted; give its cleanup a moment, then require a
    // terminal state (never a live lease).
    for _ in 0..50 {
        let row = erato::db::entity::chats::Entity::find_by_id(child_chat.id)
            .one(&app_state.db)
            .await
            .unwrap()
            .unwrap();
        if row.generation_state.as_deref() != Some("running") {
            assert!(matches!(
                row.generation_state.as_deref(),
                Some("completed") | Some("errored")
            ));
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    panic!("child chat still running after timeout");
}

/// A child that gets somewhere before it stalls still hands the parent the
/// trace of how far it got: the step it was on settles as `degraded` and both
/// the terminal frame and the persisted part carry it.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegation_timeout_persists_partial_trace(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // Child: answer a first chunk, then stall past the run timeout.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-PARTIAL-TASK"],
                &["delegate_chat_id"],
            ));
        let mut actions =
            crate::test_utils::build_openai_text_streaming_response(&["CHILD-PARTIAL-TEXT"]);
        actions.insert(2, BodyAction::Delay(std::time::Duration::from_secs(30)));
        mock_llm_sse_response(then, actions);
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["delegate_chat_id"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-PARTIAL-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["partial delegation question"],
                &["CHILD-PARTIAL-TASK", "delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_partial",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-PARTIAL-TASK start and stall",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.run_timeout_seconds = 1;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "stalling delegate", None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions(
        &server,
        None,
        "partial delegation question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    let progress_frames = delegation_progress_frames(&events);
    assert!(
        progress_frames.iter().any(|frame| {
            frame["output"]["localTrace"]["steps"][0]["status"] == "running"
                && frame["output"]["localTrace"]["steps"][0]["id"] == "answer"
        }),
        "the open step must have been streamed while it was still open"
    );

    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "cancelled");
    assert_eq!(output["reason"], "timeout");
    let steps = output["localTrace"]["steps"].as_array().unwrap();
    assert_eq!(steps.len(), 1);
    assert_eq!(steps[0]["id"], "answer");
    assert!(steps[0]["startedAtOffsetMs"].is_number());
    assert_ne!(
        steps[0]["status"], "running",
        "a closed trace never leaves a step spinning"
    );
    assert!(output["localTrace"]["totalDurationMs"].is_number());
    assert!(extract_full_text_answer(&events).contains("PARENT-PARTIAL-FINAL"));

    let assistant_message_id = assistant_message_id_from_events(&events);
    let chat_id = crate::test_utils::extract_chat_id(&events).unwrap();
    let messages_response = server
        .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    messages_response.assert_status_ok();
    let tool_use = messages_response.json::<Value>()["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["id"] == assistant_message_id.as_str())
        .expect("parent assistant message")["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| part["content_type"] == "tool_use")
        .expect("tool_use part")
        .clone();
    assert_eq!(tool_use["output"]["localTrace"], output["localTrace"]);

    let child_chat = delegated_child_chat(&app_state.db, Uuid::parse_str(&chat_id).unwrap()).await;
    for _ in 0..50 {
        let row = erato::db::entity::chats::Entity::find_by_id(child_chat.id)
            .one(&app_state.db)
            .await
            .unwrap()
            .unwrap();
        if row.generation_state.as_deref() != Some("running") {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    panic!("child chat still running after timeout");
}

/// Aborting the parent mid-delegation forwards the abort to the child and the
/// envelope reports `cancelled`.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegation_abort_forwarding_cancels_child(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-ABORT-TASK"],
                &["delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            vec![
                BodyAction::Delay(std::time::Duration::from_secs(30)),
                BodyAction::Bytes("data: [DONE]\n\n".into()),
            ],
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["abort delegation question"],
                &["CHILD-ABORT-TASK", "delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_abort",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-ABORT-TASK wait for it",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "abortable delegate", None).await;

    // Real TCP server so the abort can run concurrently with the stream.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();
    let app: Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{server_addr}");

    // Known parent chat id so the abort can target it.
    let create_response = client
        .post(format!("{base_url}/api/v1beta/me/chats"))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert!(create_response.status().is_success());
    let parent_chat = create_response.json::<Value>().await.unwrap()["chat_id"]
        .as_str()
        .unwrap()
        .to_string();
    let parent_chat_id = Uuid::parse_str(&parent_chat).unwrap();

    let submit_client = client.clone();
    let submit_base = base_url.clone();
    let submit_chat = parent_chat.clone();
    let submit_handle = tokio::spawn(async move {
        let response = submit_client
            .post(format!("{submit_base}/api/v1beta/me/messages/submitstream"))
            .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
            .json(&json!({
                "existing_chat_id": submit_chat,
                "user_message": "abort delegation question",
                "mentioned_assistant_ids": [DELEGATE_ASSISTANT_FIXED_ID],
            }))
            .send()
            .await
            .expect("submit request");
        assert!(response.status().is_success());
        response.text().await.expect("submit body")
    });

    // Wait until the delegated child chat exists (the child run is in flight).
    let mut child_exists = false;
    for _ in 0..100 {
        let children = erato::db::entity::chats::Entity::find()
            .filter(erato::db::entity::chats::Column::OriginChatId.eq(parent_chat_id))
            .all(&app_state.db)
            .await
            .unwrap();
        if !children.is_empty() {
            child_exists = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(child_exists, "delegated child chat never appeared");

    let abort_response = client
        .post(format!("{base_url}/api/v1beta/me/messages/abortstream"))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .json(&json!({ "chat_id": parent_chat }))
        .send()
        .await
        .unwrap();
    assert!(abort_response.status().is_success());

    let body = tokio::time::timeout(std::time::Duration::from_secs(20), submit_handle)
        .await
        .expect("parent stream should close after abort")
        .unwrap();
    assert!(
        body.contains("\"status\":\"cancelled\""),
        "expected a cancelled envelope in the parent stream"
    );
}

async fn submit_with_mentions_and_run_mode(
    server: &TestServer,
    chat_id: Option<&str>,
    text: &str,
    mentioned_assistant_ids: &[&str],
    run_mode: &str,
) -> axum_test::TestResponse {
    let mut body = json!({
        "user_message": text,
        "mentioned_assistant_ids": mentioned_assistant_ids,
        "delegation_run_mode": run_mode,
    });
    if let Some(chat_id) = chat_id {
        body["existing_chat_id"] = json!(chat_id);
    }
    server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body)
        .await
}

/// Waits until the delegated child persisted an assistant answer containing
/// `needle` and its generation reached a terminal `completed` state.
async fn wait_for_child_completion(
    db: &sea_orm::DatabaseConnection,
    child_chat_id: Uuid,
    needle: &str,
) {
    for _ in 0..100 {
        let answered = chat_messages_by_created_at(db, child_chat_id)
            .await
            .iter()
            .any(|row| {
                row.raw_message["role"] == "assistant"
                    && row.raw_message["content"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .any(|part| {
                            part["text"]
                                .as_str()
                                .is_some_and(|text| text.contains(needle))
                        })
            });
        let state = erato::db::entity::chats::Entity::find_by_id(child_chat_id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .generation_state;
        if answered && state.as_deref() == Some("completed") {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    panic!("delegated child chat {child_chat_id} never completed with its answer");
}

fn provenance_of(chat: &erato::db::entity::chats::Model) -> ChatProvenance {
    erato::models::chat::ChatConfiguration::from_json(
        chat.assistant_configuration.as_ref().unwrap(),
    )
    .unwrap()
    .provenance
    .unwrap()
}

/// Background dispatch settles the tool at launch: the parent turn completes
/// while the child still runs, the model hears `dispatched` plus the
/// no-result note, and the UI part is a status-less Success carrying the
/// `background` marker instead of a result or trace. The child gets the
/// background preamble and lands its answer in its own chat afterwards.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_background_dispatch_returns_at_launch(pool: Pool<Postgres>) {
    let parent_first_recorder = RequestBodyRecorder::new();
    let parent_final_recorder = RequestBodyRecorder::new();
    let child_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    // Child: slow enough that the parent demonstrably finishes first.
    {
        let recorder = child_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["CHILD-BG-TASK"],
                    &["dispatched"],
                ))
                .matcher(recorder);
            let mut actions =
                crate::test_utils::build_openai_text_streaming_response(&["CHILD-BG-ANSWER done"]);
            actions.insert(0, BodyAction::Delay(std::time::Duration::from_secs(3)));
            mock_llm_sse_response(then, actions);
        });
    }
    // Parent turn 2: the dispatched tool response arrived.
    {
        let recorder = parent_final_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&["dispatched"], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&[
                    "PARENT-BG-FINAL the delegate was started",
                ]),
            );
        });
    }
    // Parent turn 1: delegate.
    {
        let recorder = parent_first_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["bg parent question"],
                    &["CHILD-BG-TASK", "dispatched"],
                ))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                    "call_delegate_bg",
                    "delegate_to_assistant",
                    json!({
                        "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                        "task": "CHILD-BG-TASK take your time",
                    }),
                )]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.allow_background = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, &delegate_prompt(), None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions_and_run_mode(
        &server,
        None,
        "bg parent question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
        "background",
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    // The two output shapes diverge: the UI part is a status-less Success
    // with the background marker and no result or trace.
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert!(output.get("status").is_none(), "no status on the UI output");
    assert_eq!(output["background"], true);
    assert_eq!(output["assistant_name"], "Fixed Delegate");
    assert!(output.get("result").is_none());
    assert!(output.get("localTrace").is_none());
    let delegate_chat_id = Uuid::parse_str(output["delegate_chat_id"].as_str().unwrap()).unwrap();
    assert!(
        delegation_progress_frames(&events).is_empty(),
        "a background run streams no progress onto the parent"
    );
    assert!(extract_full_text_answer(&events).contains("PARENT-BG-FINAL"));

    // The parent completed while the child is still running.
    let child_chat = erato::db::entity::chats::Entity::find_by_id(delegate_chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("delegated child chat");
    assert_eq!(child_chat.generation_state.as_deref(), Some("running"));
    assert_eq!(
        provenance_of(&child_chat).run_mode,
        Some(erato::models::message::ProvenanceRunMode::Background)
    );

    // The model heard a launch, never the answer.
    let parent_final_bodies = parent_final_recorder.bodies();
    let dispatch_body = parent_final_bodies
        .iter()
        .find(|body| body.contains("dispatched"))
        .expect("parent turn with the dispatched tool response");
    assert!(dispatch_body.contains("the result will not be returned to this conversation"));
    assert!(!dispatch_body.contains("CHILD-BG-ANSWER"));

    // The offer promised no returning answer…
    let parent_first_bodies = parent_first_recorder.bodies();
    let offer_body = parent_first_bodies
        .iter()
        .find(|body| body.contains("delegate_to_assistant"))
        .expect("parent completion request with the delegation tool offer");
    assert!(offer_body.contains("will NOT come back to this conversation"));

    // …and the child's preamble matches: it works in the background.
    let mut child_bodies = child_recorder.bodies();
    for _ in 0..100 {
        if !child_bodies.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        child_bodies = child_recorder.bodies();
    }
    let child_body = child_bodies.first().expect("child completion request");
    assert!(child_body.contains("working in the background"));
    assert!(!child_body.contains("returned to the delegating conversation"));

    // The persisted parent tool part froze at the launch shape.
    let assistant_message_id = assistant_message_id_from_events(&events);
    let chat_id = crate::test_utils::extract_chat_id(&events).unwrap();
    let messages_response = server
        .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    messages_response.assert_status_ok();
    let tool_use = messages_response.json::<Value>()["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["id"] == assistant_message_id.as_str())
        .expect("parent assistant message")["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| part["content_type"] == "tool_use")
        .expect("tool_use part")
        .clone();
    assert_eq!(tool_use["status"], "success");
    assert!(tool_use["output"].get("status").is_none());
    assert_eq!(tool_use["output"]["background"], true);
    assert_eq!(
        tool_use["output"]["delegate_chat_id"],
        delegate_chat_id.to_string()
    );
    assert!(tool_use["output"].get("localTrace").is_none());

    // The child still finishes on its own and its answer lives in its chat.
    wait_for_child_completion(&app_state.db, delegate_chat_id, "CHILD-BG-ANSWER").await;
}

/// Stopping the parent generation does not stop a background child: the abort
/// is not forwarded, and the child runs to completion on its own.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_parent_abort_leaves_background_child_running(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // Child: slow, but well within what the test waits for.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-BG-ABORT-TASK"],
                &["dispatched"],
            ));
        let mut actions = crate::test_utils::build_openai_text_streaming_response(&[
            "CHILD-BG-ABORT-ANSWER intact",
        ]);
        actions.insert(0, BodyAction::Delay(std::time::Duration::from_secs(4)));
        mock_llm_sse_response(then, actions);
    });
    // Parent turn 2: stall long enough for the abort to land mid-turn.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["dispatched"], &[]));
        mock_llm_sse_response(
            then,
            vec![
                BodyAction::Delay(std::time::Duration::from_secs(30)),
                BodyAction::Bytes("data: [DONE]\n\n".into()),
            ],
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["bg abort question"],
                &["CHILD-BG-ABORT-TASK", "dispatched"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_bg_abort",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-BG-ABORT-TASK keep going",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.allow_background = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "background delegate", None).await;

    // Real TCP server so the abort can run concurrently with the stream.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();
    let app: Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{server_addr}");

    let create_response = client
        .post(format!("{base_url}/api/v1beta/me/chats"))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert!(create_response.status().is_success());
    let parent_chat = create_response.json::<Value>().await.unwrap()["chat_id"]
        .as_str()
        .unwrap()
        .to_string();
    let parent_chat_id = Uuid::parse_str(&parent_chat).unwrap();

    let submit_client = client.clone();
    let submit_base = base_url.clone();
    let submit_chat = parent_chat.clone();
    let submit_handle = tokio::spawn(async move {
        let response = submit_client
            .post(format!("{submit_base}/api/v1beta/me/messages/submitstream"))
            .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
            .json(&json!({
                "existing_chat_id": submit_chat,
                "user_message": "bg abort question",
                "mentioned_assistant_ids": [DELEGATE_ASSISTANT_FIXED_ID],
                "delegation_run_mode": "background",
            }))
            .send()
            .await
            .expect("submit request");
        assert!(response.status().is_success());
        response.text().await.expect("submit body")
    });

    // Wait until the delegated child chat exists (the child run is in flight).
    let mut child_chat_id = None;
    for _ in 0..100 {
        let children = erato::db::entity::chats::Entity::find()
            .filter(erato::db::entity::chats::Column::OriginChatId.eq(parent_chat_id))
            .all(&app_state.db)
            .await
            .unwrap();
        if let Some(child) = children.first() {
            child_chat_id = Some(child.id);
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let child_chat_id = child_chat_id.expect("delegated child chat never appeared");

    let abort_response = client
        .post(format!("{base_url}/api/v1beta/me/messages/abortstream"))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .json(&json!({ "chat_id": parent_chat }))
        .send()
        .await
        .unwrap();
    assert!(abort_response.status().is_success());

    tokio::time::timeout(std::time::Duration::from_secs(20), submit_handle)
        .await
        .expect("parent stream should close after abort")
        .unwrap();

    // The child was not aborted with the parent: its full answer arrives.
    wait_for_child_completion(&app_state.db, child_chat_id, "CHILD-BG-ABORT-ANSWER").await;
}

/// With `allow_background` off, a background request downgrades to the awaited
/// path: full result envelope, `completed` status, result text present.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_background_request_downgrades_to_awaited_when_gate_off(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-GATE-TASK"],
                &["delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["CHILD-GATE-ANSWER now"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["delegate_chat_id"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-GATE-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["gate off question"],
                &["CHILD-GATE-TASK", "delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_gate",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-GATE-TASK answer now",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "gated delegate", None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions_and_run_mode(
        &server,
        None,
        "gate off question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
        "background",
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "completed");
    assert!(output.get("background").is_none());
    assert!(
        output["result"]
            .as_str()
            .unwrap()
            .contains("CHILD-GATE-ANSWER")
    );
    assert!(extract_full_text_answer(&events).contains("PARENT-GATE-FINAL"));

    let chat_id = crate::test_utils::extract_chat_id(&events).unwrap();
    let child_chat = delegated_child_chat(&app_state.db, Uuid::parse_str(&chat_id).unwrap()).await;
    assert!(provenance_of(&child_chat).run_mode.is_none());
}

/// Regenerating the backgrounded turn without re-sending the field replays the
/// persisted mode end-to-end: the new dispatch is background again.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_regenerate_replays_background_dispatch(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-BG-REGEN-TASK"],
                &["dispatched"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["CHILD-BG-REGEN-ANSWER"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["dispatched"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-BG-REGEN-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["bg regen question"],
                &["CHILD-BG-REGEN-TASK", "dispatched"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_bg_regen",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-BG-REGEN-TASK run again",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.allow_background = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "regen delegate", None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions_and_run_mode(
        &server,
        None,
        "bg regen question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
        "background",
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let first_output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(first_output["background"], true);
    let first_child_id =
        Uuid::parse_str(first_output["delegate_chat_id"].as_str().unwrap()).unwrap();
    wait_for_child_completion(&app_state.db, first_child_id, "CHILD-BG-REGEN-ANSWER").await;

    let assistant_message_id = assistant_message_id_from_events(&events);
    let regenerate_response = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "current_message_id": assistant_message_id }))
        .await;
    regenerate_response.assert_status_ok();
    let regen_events = parse_sse_events(&regenerate_response);

    let regen_output = find_tool_call_update_output(&regen_events, "delegate_to_assistant");
    assert!(regen_output.get("status").is_none());
    assert_eq!(regen_output["background"], true);
    let second_child_id =
        Uuid::parse_str(regen_output["delegate_chat_id"].as_str().unwrap()).unwrap();
    assert_ne!(second_child_id, first_child_id);

    let second_child = erato::db::entity::chats::Entity::find_by_id(second_child_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("second delegated child chat");
    assert_eq!(
        provenance_of(&second_child).run_mode,
        Some(erato::models::message::ProvenanceRunMode::Background)
    );
    wait_for_child_completion(&app_state.db, second_child_id, "CHILD-BG-REGEN-ANSWER").await;
}

/// Regenerating a backgrounded turn with an explicit `wait` in the request
/// overrides the persisted mode end-to-end: the new dispatch is awaited, so
/// the full result envelope lands on the tool part instead of a frozen
/// background offer.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_regenerate_request_wait_overrides_persisted_background(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-WAIT-REGEN-TASK"],
                &["delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["CHILD-WAIT-REGEN-ANSWER"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["dispatched"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[
                "PARENT-WAIT-REGEN-BG-FINAL",
            ]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-WAIT-REGEN-ANSWER"],
                &["dispatched"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-WAIT-REGEN-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["wait regen question"],
                &["CHILD-WAIT-REGEN-TASK", "dispatched"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_wait_regen",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-WAIT-REGEN-TASK answer now",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.allow_background = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "wait regen delegate", None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions_and_run_mode(
        &server,
        None,
        "wait regen question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
        "background",
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let first_output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(first_output["background"], true);
    let first_child_id =
        Uuid::parse_str(first_output["delegate_chat_id"].as_str().unwrap()).unwrap();
    wait_for_child_completion(&app_state.db, first_child_id, "CHILD-WAIT-REGEN-ANSWER").await;

    let assistant_message_id = assistant_message_id_from_events(&events);
    let regenerate_response = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "current_message_id": assistant_message_id,
            "delegation_run_mode": "wait",
        }))
        .await;
    regenerate_response.assert_status_ok();
    let regen_events = parse_sse_events(&regenerate_response);

    let regen_output = find_tool_call_update_output(&regen_events, "delegate_to_assistant");
    assert_eq!(regen_output["status"], "completed");
    assert!(regen_output.get("background").is_none());
    assert!(
        regen_output["result"]
            .as_str()
            .unwrap()
            .contains("CHILD-WAIT-REGEN-ANSWER")
    );
    assert!(extract_full_text_answer(&regen_events).contains("PARENT-WAIT-REGEN-FINAL"));

    let second_child_id =
        Uuid::parse_str(regen_output["delegate_chat_id"].as_str().unwrap()).unwrap();
    assert_ne!(second_child_id, first_child_id);
    let second_child = erato::db::entity::chats::Entity::find_by_id(second_child_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("second delegated child chat");
    assert!(provenance_of(&second_child).run_mode.is_none());
}

/// Waits until the chat's generation left the `running` state and returns the
/// terminal state it landed on.
async fn wait_for_child_terminal(
    db: &sea_orm::DatabaseConnection,
    child_chat_id: Uuid,
) -> Option<String> {
    for _ in 0..100 {
        let state = erato::db::entity::chats::Entity::find_by_id(child_chat_id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .generation_state;
        if state.as_deref() != Some("running") {
            return state;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    panic!("delegated child chat {child_chat_id} never left the running state");
}

/// Every terminal `tool_call_update` for a tool, in stream order.
fn terminal_tool_call_updates(events: &[Event], tool_name: &str) -> Vec<Value> {
    events
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .filter(|json| {
            json["message_type"] == "tool_call_update"
                && json["tool_name"] == tool_name
                && json["status"] != "in_progress"
        })
        .collect()
}

/// A background run has no dispatch loop watching it, so the deadline is
/// enforced from inside the child task itself: the run self-aborts, the
/// cooperative wind-down persists the partial answer, and the generation
/// reaches a terminal state — while the parent, long since finished at
/// launch, is untouched.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_background_run_timeout_self_aborts_detached_child(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // Child: a first chunk, then a stall far past the run timeout.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-TIMEBOX-TASK"],
                &["dispatched"],
            ));
        let mut actions =
            crate::test_utils::build_openai_text_streaming_response(&["CHILD-TIMEBOX-PARTIAL"]);
        actions.insert(2, BodyAction::Delay(std::time::Duration::from_secs(30)));
        mock_llm_sse_response(then, actions);
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["dispatched"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-TIMEBOX-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["timebox parent question"],
                &["CHILD-TIMEBOX-TASK", "dispatched"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_timebox",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-TIMEBOX-TASK start and stall",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.allow_background = true;
    app_config.delegation.run_timeout_seconds = 1;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, &delegate_prompt(), None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions_and_run_mode(
        &server,
        None,
        "timebox parent question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
        "background",
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    // The parent settled at launch and never hears about the timeout.
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert!(output.get("status").is_none());
    assert_eq!(output["background"], true);
    assert!(extract_full_text_answer(&events).contains("PARENT-TIMEBOX-FINAL"));
    let delegate_chat_id = Uuid::parse_str(output["delegate_chat_id"].as_str().unwrap()).unwrap();

    // The child self-aborted on its deadline: terminal generation state, and
    // the partial answer it had streamed is persisted in its own chat.
    let terminal = wait_for_child_terminal(&app_state.db, delegate_chat_id).await;
    assert!(
        matches!(terminal.as_deref(), Some("completed") | Some("errored")),
        "got terminal state {terminal:?}"
    );
    let partial_persisted = chat_messages_by_created_at(&app_state.db, delegate_chat_id)
        .await
        .iter()
        .any(|row| {
            row.raw_message["role"] == "assistant"
                && row.raw_message["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|part| {
                        part["text"]
                            .as_str()
                            .is_some_and(|text| text.contains("CHILD-TIMEBOX-PARTIAL"))
                    })
        });
    assert!(
        partial_persisted,
        "the aborted child must keep its partial answer"
    );
}

async fn insert_shared_generation(
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
    generation_id: Uuid,
    started_age_secs: i64,
) {
    use sea_orm::{ConnectionTrait, Statement};
    db.execute_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        r#"INSERT INTO temp_chat_generations
               (generation_id, chat_id, owner_pod, state, started_at, heartbeat_at)
           VALUES ($1, $2, 'other-pod', 'running',
                   now() - make_interval(secs => $3::double precision), now())"#,
        [
            generation_id.into(),
            chat_id.into(),
            (started_age_secs as f64).into(),
        ],
    ))
    .await
    .expect("insert shared generation");
}

async fn pending_abort_count(db: &sea_orm::DatabaseConnection, generation_id: Uuid) -> i64 {
    use sea_orm::{ConnectionTrait, Statement};
    db.query_one_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        r#"SELECT COUNT(*) AS "count"
           FROM temp_chat_generation_commands
           WHERE generation_id = $1 AND command_type = 'abort' AND consumed_at IS NULL"#,
        [generation_id.into()],
    ))
    .await
    .unwrap()
    .unwrap()
    .try_get::<i64>("", "count")
    .unwrap()
}

/// The maintenance backstop aborts a delegated run whose generation row
/// outlived the deadline on a pod that is wedged rather than dead — and only
/// those: a delegated run within its deadline, an overdue plain chat and an
/// overdue ADOPTED run are all left alone, and a still-pending abort is not
/// stacked onto.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_timeout_backstop_aborts_only_overdue_delegated_runs(pool: Pool<Postgres>) {
    // Delegation stays disabled so the app's own maintenance loop never runs
    // the backstop; the test drives the factored function directly.
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

    let assistant = create_assistant(&server, "Backstop Assistant", "prompt").await;
    let assistant_id = Uuid::parse_str(&assistant).unwrap();
    let origin_chat = Uuid::parse_str(&create_chat(&server, Some(&assistant)).await).unwrap();

    let overdue_delegated = Uuid::parse_str(&create_chat(&server, Some(&assistant)).await).unwrap();
    let fresh_delegated = Uuid::parse_str(&create_chat(&server, Some(&assistant)).await).unwrap();
    let overdue_plain = Uuid::parse_str(&create_chat(&server, Some(&assistant)).await).unwrap();
    let overdue_adopted = Uuid::parse_str(&create_chat(&server, Some(&assistant)).await).unwrap();
    for chat_id in [overdue_delegated, fresh_delegated, overdue_adopted] {
        write_delegation_provenance(&app_state.db, chat_id, assistant_id, origin_chat, None).await;
    }
    let adopted_chat = erato::db::entity::chats::Entity::find_by_id(overdue_adopted)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("adopted chat");
    erato::models::chat::mark_delegated_run_adopted(&app_state.db, &adopted_chat)
        .await
        .unwrap();

    let overdue_delegated_generation = Uuid::new_v4();
    let fresh_delegated_generation = Uuid::new_v4();
    let overdue_plain_generation = Uuid::new_v4();
    let overdue_adopted_generation = Uuid::new_v4();
    insert_shared_generation(
        &app_state.db,
        overdue_delegated,
        overdue_delegated_generation,
        700,
    )
    .await;
    insert_shared_generation(
        &app_state.db,
        fresh_delegated,
        fresh_delegated_generation,
        10,
    )
    .await;
    insert_shared_generation(&app_state.db, overdue_plain, overdue_plain_generation, 700).await;
    insert_shared_generation(
        &app_state.db,
        overdue_adopted,
        overdue_adopted_generation,
        700,
    )
    .await;

    let enqueued =
        erato::services::background_tasks::BackgroundTaskManager::enqueue_overdue_delegated_run_aborts(
            &app_state.db,
            620.0,
        )
        .await
        .unwrap();
    assert_eq!(enqueued, 1);
    assert_eq!(
        pending_abort_count(&app_state.db, overdue_delegated_generation).await,
        1
    );
    assert_eq!(
        pending_abort_count(&app_state.db, fresh_delegated_generation).await,
        0
    );
    assert_eq!(
        pending_abort_count(&app_state.db, overdue_plain_generation).await,
        0
    );
    assert_eq!(
        pending_abort_count(&app_state.db, overdue_adopted_generation).await,
        0
    );

    // The pending abort is not duplicated while nothing consumes it.
    let enqueued_again =
        erato::services::background_tasks::BackgroundTaskManager::enqueue_overdue_delegated_run_aborts(
            &app_state.db,
            620.0,
        )
        .await
        .unwrap();
    assert_eq!(enqueued_again, 0);
    assert_eq!(
        pending_abort_count(&app_state.db, overdue_delegated_generation).await,
        1
    );
}

/// The owner-wide concurrency cap: with one background run in flight a second
/// launch is refused as a call refusal the model recovers from in prose, and
/// once the first run reaches a terminal state the freed slot admits a new
/// launch.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_background_concurrency_cap_refuses_and_frees(pool: Pool<Postgres>) {
    let refusal_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    // Child 1: slow enough to still be running when the second launch is tried.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-CAP-ONE-TASK"],
                &["dispatched"],
            ));
        let mut actions =
            crate::test_utils::build_openai_text_streaming_response(&["CHILD-CAP-ONE-ANSWER done"]);
        actions.insert(0, BodyAction::Delay(std::time::Duration::from_secs(8)));
        mock_llm_sse_response(then, actions);
    });
    // Child 3: immediate.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-CAP-THREE-TASK"],
                &["dispatched"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[
                "CHILD-CAP-THREE-ANSWER done",
            ]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["cap question one", "dispatched"],
                &[],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-CAP-ONE-FINAL"]),
        );
    });
    {
        let recorder = refusal_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["cap question two", "Delegation refused"],
                    &[],
                ))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["PARENT-CAP-TWO-FINAL"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["cap question three", "dispatched"],
                &[],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-CAP-THREE-FINAL"]),
        );
    });
    for (question, call_id, task) in [
        (
            "cap question one",
            "call_cap_one",
            "CHILD-CAP-ONE-TASK take your time",
        ),
        (
            "cap question two",
            "call_cap_two",
            "CHILD-CAP-TWO-TASK never launches",
        ),
        (
            "cap question three",
            "call_cap_three",
            "CHILD-CAP-THREE-TASK quick",
        ),
    ] {
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &[question],
                    &["dispatched", "Delegation refused"],
                ));
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                    call_id,
                    "delegate_to_assistant",
                    json!({
                        "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                        "task": task,
                    }),
                )]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.allow_background = true;
    app_config.delegation.max_concurrent_background_runs = 1;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, &delegate_prompt(), None).await;
    let server = app_server(app_state.clone());

    // First launch takes the only slot.
    let response = submit_with_mentions_and_run_mode(
        &server,
        None,
        "cap question one",
        &[DELEGATE_ASSISTANT_FIXED_ID],
        "background",
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["background"], true);
    let first_child_id = Uuid::parse_str(output["delegate_chat_id"].as_str().unwrap()).unwrap();

    // Second launch while the first still runs: refused, turn completes.
    let response = submit_with_mentions_and_run_mode(
        &server,
        None,
        "cap question two",
        &[DELEGATE_ASSISTANT_FIXED_ID],
        "background",
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "error");
    assert!(
        output["error"]
            .as_str()
            .unwrap()
            .contains("background runs in flight")
    );
    assert!(extract_full_text_answer(&events).contains("PARENT-CAP-TWO-FINAL"));
    let refusal_bodies = refusal_recorder.bodies();
    assert!(refusal_bodies.iter().any(|body| body.contains(
        "Delegation refused: You already have 1 background runs in flight; wait for one to finish."
    )));

    // The refused call left no delegated chat behind.
    assert!(
        erato::db::entity::chats::Entity::find()
            .filter(erato::db::entity::chats::Column::OwnerUserId.eq(me.id.to_string()))
            .all(&app_state.db)
            .await
            .unwrap()
            .iter()
            .filter(|chat| chat.origin_chat_id.is_some())
            .count()
            == 1
    );

    // Once the first run finishes, the slot frees up.
    wait_for_child_completion(&app_state.db, first_child_id, "CHILD-CAP-ONE-ANSWER").await;
    let response = submit_with_mentions_and_run_mode(
        &server,
        None,
        "cap question three",
        &[DELEGATE_ASSISTANT_FIXED_ID],
        "background",
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["background"], true);
    let third_child_id = Uuid::parse_str(output["delegate_chat_id"].as_str().unwrap()).unwrap();
    wait_for_child_completion(&app_state.db, third_child_id, "CHILD-CAP-THREE-ANSWER").await;
}

/// The per-message counter refuses a second background launch within one turn
/// even before the first is visible as a running generation — with a wording
/// of its own, and without failing the turn.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_per_message_background_cap_refuses_second_launch_in_one_turn(pool: Pool<Postgres>) {
    let refusal_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-TURNCAP-A-TASK"],
                &["dispatched"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["CHILD-TURNCAP-ANSWER done"]),
        );
    });
    {
        let recorder = refusal_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&["most allowed per message"], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["PARENT-TURNCAP-FINAL"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["turncap parent question"],
                &[
                    "CHILD-TURNCAP-A-TASK",
                    "dispatched",
                    "most allowed per message",
                ],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[
                (
                    "call_turncap_a",
                    "delegate_to_assistant",
                    json!({
                        "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                        "task": "CHILD-TURNCAP-A-TASK first launch",
                    }),
                ),
                (
                    "call_turncap_b",
                    "delegate_to_assistant",
                    json!({
                        "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                        "task": "CHILD-TURNCAP-B-TASK second launch",
                    }),
                ),
            ]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.allow_background = true;
    app_config.delegation.max_concurrent_background_runs = 1;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, &delegate_prompt(), None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions_and_run_mode(
        &server,
        None,
        "turncap parent question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
        "background",
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    let updates = terminal_tool_call_updates(&events, "delegate_to_assistant");
    assert_eq!(updates.len(), 2, "got: {updates:?}");
    let launched = updates
        .iter()
        .find(|update| update["tool_call_id"] == "call_turncap_a")
        .expect("first call's terminal update");
    assert_eq!(launched["status"], "success");
    assert_eq!(launched["output"]["background"], true);
    let refused = updates
        .iter()
        .find(|update| update["tool_call_id"] == "call_turncap_b")
        .expect("second call's terminal update");
    assert_eq!(refused["status"], "error");
    assert!(
        refused["output"]["error"]
            .as_str()
            .unwrap()
            .contains("most allowed per message")
    );

    assert!(extract_full_text_answer(&events).contains("PARENT-TURNCAP-FINAL"));
    let refusal_bodies = refusal_recorder.bodies();
    assert!(
        refusal_bodies
            .iter()
            .any(|body| body.contains("Delegation refused: This turn already launched 1"))
    );
}

async fn rebuilt_policy(app_state: &erato::state::AppState) -> erato::policy::engine::PolicyEngine {
    let policy = erato::policy::engine::PolicyEngine::new();
    policy
        .rebuild_data_if_needed(&app_state.db, &app_state.config)
        .await
        .expect("policy rebuild");
    policy
}

async fn recent_chats(server: &TestServer, query: &str) -> Value {
    let response = server
        .get(&format!("/api/v1beta/me/recent_chats{query}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    response.json::<Value>()
}

fn listed_chat_ids(listing: &Value) -> Vec<String> {
    listing["chats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|chat| chat["id"].as_str().unwrap().to_string())
        .collect()
}

/// Spawns a delegated run from `origin_chat_id` via the model layer and gives
/// it one message, since listings join each chat's latest message.
async fn spawn_listed_delegated_run(
    app_state: &erato::state::AppState,
    me_user_id: &str,
    assistant_id: Uuid,
    origin_chat_id: Uuid,
    title: &str,
) -> String {
    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &rebuilt_policy(app_state).await,
        &erato::policy::types::Subject::User(me_user_id.to_string()),
        me_user_id,
        Some(assistant_id),
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(origin_chat_id),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: Some(assistant_id),
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        },
        None,
        title.to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .unwrap();
    erato::models::message::submit_message(
        &app_state.db,
        &rebuilt_policy(app_state).await,
        &erato::policy::types::Subject::User(me_user_id.to_string()),
        &child.id,
        json!({
            "role": "user",
            "content": [{"content_type": "text", "text": "delegated task"}],
            "name": me_user_id,
        }),
        None,
        None,
        None,
        &[],
        None,
        None,
        None,
    )
    .await
    .unwrap();
    child.id.to_string()
}

/// Listing matrix: delegated runs are hidden everywhere by default, visible
/// with `include_delegated=true` (carrying provenance fields), tolerate a
/// deleted origin, and compose with the type filter. Delegated runs do not
/// inflate the frequent-assistants ranking.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_listing_hides_delegated_runs_and_exposes_provenance(pool: Pool<Postgres>) {
    let app_state = test_app_state(delegation_enabled_config(), pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());

    let assistant = create_assistant(&server, "Listing Assistant", "prompt").await;
    let assistant_id = Uuid::parse_str(&assistant).unwrap();

    // A regular assistant chat (the origin) and a plain chat.
    let origin_chat = create_chat(&server, Some(&assistant)).await;
    let origin_chat_id = Uuid::parse_str(&origin_chat).unwrap();
    let plain_chat = create_chat(&server, None).await;

    // Three delegated runs against the same assistant, spawned from the
    // origin chat, via the model layer.
    let mut delegated_ids = Vec::new();
    for index in 0..3 {
        let child = erato::models::chat::create_delegated_chat(
            &app_state.db,
            &rebuilt_policy(&app_state).await,
            &erato::policy::types::Subject::User(me.id.to_string()),
            &me.id.to_string(),
            Some(assistant_id),
            ChatProvenance {
                kind: ChatProvenanceKind::Delegation,
                origin_chat_id: Some(origin_chat_id),
                origin_message_id: None,
                parent_message_id: None,
                origin_assistant_id: Some(assistant_id),
                rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
                depth: 1,
                adopted_at: None,
                legacy_expected_output: None,
                legacy_constraints: None,
                // One of each detached mode plus an awaited run, so the
                // listing's run-mode passthrough is exercised in every
                // direction it has.
                run_mode: match index {
                    0 => Some(erato::models::message::ProvenanceRunMode::Background),
                    1 => Some(erato::models::message::ProvenanceRunMode::Async),
                    _ => None,
                },
                result_delivery: None,
                retry_of: None,
            },
            None,
            format!("Delegated run {index}"),
            true,
            Vec::new(),
            Vec::new(),
        )
        .await
        .unwrap();
        // Listings join the latest message, so each chat needs one.
        erato::models::message::submit_message(
            &app_state.db,
            &rebuilt_policy(&app_state).await,
            &erato::policy::types::Subject::User(me.id.to_string()),
            &child.id,
            json!({
                "role": "user",
                "content": [{"content_type": "text", "text": format!("task {index}")}],
                "name": me.id.to_string(),
            }),
            None,
            None,
            None,
            &[],
            None,
            None,
            None,
        )
        .await
        .unwrap();
        delegated_ids.push(child.id.to_string());
    }
    app_state.global_policy_engine.invalidate_data().await;
    // Give the non-delegated chats messages too so they are listable.
    for chat in [&origin_chat, &plain_chat] {
        erato::models::message::submit_message(
            &app_state.db,
            &rebuilt_policy(&app_state).await,
            &erato::policy::types::Subject::User(me.id.to_string()),
            &Uuid::parse_str(chat).unwrap(),
            json!({
                "role": "user",
                "content": [{"content_type": "text", "text": "hello"}],
                "name": me.id.to_string(),
            }),
            None,
            None,
            None,
            &[],
            None,
            None,
            None,
        )
        .await
        .unwrap();
    }

    // Hidden by default.
    let listing = recent_chats(&server, "").await;
    let ids = listed_chat_ids(&listing);
    assert!(ids.contains(&origin_chat));
    assert!(ids.contains(&plain_chat));
    for delegated in &delegated_ids {
        assert!(
            !ids.contains(delegated),
            "delegated run leaked into listing"
        );
    }

    // Visible on demand, with provenance fields.
    let listing = recent_chats(&server, "?include_delegated=true").await;
    let ids = listed_chat_ids(&listing);
    for delegated in &delegated_ids {
        assert!(ids.contains(delegated));
    }
    let delegated_entry = listing["chats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chat| chat["id"] == delegated_ids[0].as_str())
        .unwrap();
    assert_eq!(delegated_entry["provenance_kind"], "delegation");
    assert_eq!(delegated_entry["origin_chat_id"], origin_chat.as_str());
    assert_eq!(delegated_entry["origin_assistant_id"], assistant.as_str());
    assert!(
        delegated_entry["origin_chat_title"]
            .as_str()
            .is_some_and(|title| !title.is_empty())
    );
    // The detached run carries its run mode; an awaited run stores none and
    // the listing must preserve that absence, since clients read presence of
    // `background` as "this run has a life of its own".
    assert_eq!(delegated_entry["provenance_run_mode"], "background");
    let async_entry = listing["chats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chat| chat["id"] == delegated_ids[1].as_str())
        .unwrap();
    assert_eq!(
        async_entry["provenance_run_mode"], "async",
        "an async run is detached too, and a client reading only `background` \
         would treat it as awaited"
    );
    let awaited_entry = listing["chats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chat| chat["id"] == delegated_ids[2].as_str())
        .unwrap();
    assert!(
        !awaited_entry
            .as_object()
            .unwrap()
            .contains_key("provenance_run_mode")
    );

    // Composes with the type filter: delegated runs are assistant-bound.
    let listing = recent_chats(&server, "?include_delegated=true&type=assistant").await;
    let ids = listed_chat_ids(&listing);
    for delegated in &delegated_ids {
        assert!(ids.contains(delegated));
    }
    assert!(!ids.contains(&plain_chat));
    let listing = recent_chats(&server, "?type=assistant").await;
    let ids = listed_chat_ids(&listing);
    assert!(ids.contains(&origin_chat));
    for delegated in &delegated_ids {
        assert!(!ids.contains(delegated));
    }

    // Origin deleted: dangling ids tolerated, title absent.
    erato::db::entity::messages::Entity::delete_many()
        .filter(erato::db::entity::messages::Column::ChatId.eq(origin_chat_id))
        .exec(&app_state.db)
        .await
        .unwrap();
    erato::db::entity::chats::Entity::delete_by_id(origin_chat_id)
        .exec(&app_state.db)
        .await
        .unwrap();
    let listing = recent_chats(&server, "?include_delegated=true").await;
    let delegated_entry = listing["chats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chat| chat["id"] == delegated_ids[0].as_str())
        .unwrap();
    assert_eq!(delegated_entry["provenance_kind"], "delegation");
    assert!(delegated_entry["origin_chat_title"].is_null());

    // Frequent assistants: the three delegated runs must not count. The
    // origin chat is deleted by now, so the assistant must not rank at all.
    let response = server
        .get("/api/v1beta/me/frequent_assistants")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let frequent = response.json::<Value>();
    let usage: Option<i64> = frequent["assistants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == assistant.as_str())
        .and_then(|item| item["usage_count"].as_i64());
    assert_eq!(usage, None, "delegated runs must not feed the ranking");
}

/// Stage one delegated child of `origin_chat_id`, straight into the row.
///
/// The provenance JSON is what populates `chats.origin_chat_id`: the column is
/// `GENERATED ALWAYS AS (assistant_configuration #>> '{provenance,origin_chat_id}')
/// STORED`, so writing the envelope is the only way to set it — assigning the
/// column directly is a Postgres error.
///
/// Serialized from the real `ChatProvenance` / `ResultDelivery` structs rather
/// than hand-written JSON, and driven by the real enums rather than by string
/// literals. That is what stops the test agreeing with itself: the listing's
/// `EXISTS` compares the stored JSON against `ChatProvenanceKind::as_str`,
/// `ProvenanceRunMode::as_str` and `ResultDeliveryState::as_str`, which are a
/// separate hand-written mapping from the serde spellings these fixtures get.
/// A drift on either side — the enum's wire spelling, or the nesting of
/// `result_delivery` under `provenance` the SQL path `{provenance,
/// result_delivery,state}` assumes — now fails the test instead of passing it.
async fn stage_in_flight_child(
    db: &sea_orm::DatabaseConnection,
    owner_user_id: &str,
    origin_chat_id: Uuid,
    run_mode: erato::models::message::ProvenanceRunMode,
    delivery_state: Option<erato::models::chat::ResultDeliveryState>,
) -> Uuid {
    let id = Uuid::new_v4();
    let now: sea_orm::prelude::DateTimeWithTimeZone = sqlx::types::chrono::Utc::now().into();
    let provenance = ChatProvenance {
        kind: ChatProvenanceKind::Delegation,
        origin_chat_id: Some(origin_chat_id),
        origin_message_id: None,
        parent_message_id: None,
        origin_assistant_id: None,
        rebase_cutoff: None,
        depth: 1,
        adopted_at: None,
        legacy_expected_output: None,
        legacy_constraints: None,
        run_mode: Some(run_mode),
        result_delivery: delivery_state.map(|state| erato::models::chat::ResultDelivery {
            state,
            delivery_id: Uuid::new_v4(),
            result_message_id: None,
            status: "completed".to_string(),
            reason: None,
            claimed_by: None,
            claimed_at: None,
            message_id: None,
            reaction_message_id: None,
            attempts: 0,
            redeliveries: 0,
            redelivery_of: None,
            sequence: 0,
            at: now,
        }),
        retry_of: None,
    };
    let provenance = serde_json::to_value(&provenance).expect("serialize provenance");
    erato::db::entity::chats::Entity::insert(erato::db::entity::chats::ActiveModel {
        id: ActiveValue::Set(id),
        owner_user_id: ActiveValue::Set(owner_user_id.to_string()),
        assistant_configuration: ActiveValue::Set(Some(json!({ "provenance": provenance }))),
        created_at: ActiveValue::Set(now),
        updated_at: ActiveValue::Set(now),
        ..Default::default()
    })
    .exec(db)
    .await
    .expect("stage delegated child");
    id
}

/// Set a staged child's generation lease directly.
///
/// `heartbeat_age_secs` of `None` leaves the heartbeat NULL, which is what a
/// chat parked on a tool approval really looks like.
async fn set_child_lease(
    db: &sea_orm::DatabaseConnection,
    child_chat_id: Uuid,
    state: &str,
    heartbeat_age_secs: Option<u64>,
) {
    use sea_orm::ConnectionTrait;
    db.execute_raw(sea_orm::Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        r#"
        UPDATE chats
        SET generation_state = $1,
            generation_started_at = now(),
            generation_heartbeat_at = CASE
                WHEN $2::double precision IS NULL THEN NULL
                ELSE now() - make_interval(secs => $2::double precision)
            END
        WHERE id = $3
        "#,
        [
            state.into(),
            heartbeat_age_secs.map(|secs| secs as f64).into(),
            child_chat_id.into(),
        ],
    ))
    .await
    .expect("set child lease");
}

/// Read the origin row's `delegated_runs_in_flight` out of a fresh listing.
///
/// Always off the ORIGIN row: the listing hides delegated children by default,
/// and the flag is the origin's answer about its children, never a child's own.
async fn origin_in_flight(server: &TestServer, origin_chat_id: &str) -> bool {
    let listing = recent_chats(server, "").await;
    listing["chats"]
        .as_array()
        .expect("chats array")
        .iter()
        .find(|chat| chat["id"] == origin_chat_id)
        .expect("origin chat listed")["delegated_runs_in_flight"]
        .as_bool()
        .expect("delegated_runs_in_flight is a required bool")
}

/// `RecentChat.delegated_runs_in_flight` is true exactly while an async
/// delegated child still owes the origin something.
///
/// Two independent arms, and the point of the test is that each is really
/// load-bearing: an unfinished lease (running with a fresh heartbeat, or
/// parked on an approval — which has NO heartbeat at all), or a delivery
/// sitting in `pending` / `claimed`. `delivered` is excluded on purpose: a
/// `silent` result parks there until the user's next turn and the origin is
/// not waiting on it, which is exactly the acceptance criterion. An archived
/// child still holding `pending` stays true — `task_delivery`'s sweep is
/// where that resolves, and filtering archived rows here would make that code
/// dead and hide a genuinely stuck delivery.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn recent_chats_reports_delegated_runs_in_flight(pool: Pool<Postgres>) {
    use erato::models::chat::ResultDeliveryState as DeliveryState;
    use erato::models::message::ProvenanceRunMode as RunMode;

    let app_state = test_app_state(delegation_enabled_config(), pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let me_user_id = me.id.to_string();
    let server = app_server(app_state.clone());

    // `get_recent_chats` joins each chat's latest message with an INNER JOIN
    // LATERAL, so an origin without a message never appears at all.
    let origin_chat = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin_chat).unwrap();
    erato::models::message::submit_message(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me_user_id.clone()),
        &origin_chat_id,
        json!({
            "role": "user",
            "content": [{"content_type": "text", "text": "kick off a task"}],
            "name": me_user_id,
        }),
        None,
        None,
        None,
        &[],
        None,
        None,
        None,
    )
    .await
    .unwrap();
    app_state.global_policy_engine.invalidate_data().await;

    // (a) No children at all.
    assert!(
        !origin_in_flight(&server, &origin_chat).await,
        "an origin with no delegated children owes nothing"
    );

    // (b) Async child running with a fresh heartbeat.
    let child = stage_in_flight_child(
        &app_state.db,
        &me_user_id,
        origin_chat_id,
        RunMode::Async,
        None,
    )
    .await;
    set_child_lease(&app_state.db, child, "running", Some(1)).await;
    assert!(
        origin_in_flight(&server, &origin_chat).await,
        "a live async child is in flight"
    );

    // (b2) The EXISTS correlates on `child.origin_chat_id = chats.id`. Every
    //      other case here asserts on the one origin that really does own the
    //      child, so none of them can see that correlation go missing: a
    //      predicate reduced to "this user has ANY async run in flight"
    //      satisfies all of them. It is not a harmless reduction — the flag
    //      seeds `awaitingDeliveryChatIds` from every row on the page, so one
    //      live child anywhere would pin the poller at its fast cadence and
    //      invalidate every cached listing variant on each run-end edge. A
    //      second origin that owns nothing is what pins it.
    let bystander_chat = create_chat(&server, None).await;
    let bystander_chat_id = Uuid::parse_str(&bystander_chat).unwrap();
    erato::models::message::submit_message(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me_user_id.clone()),
        &bystander_chat_id,
        json!({
            "role": "user",
            "content": [{"content_type": "text", "text": "an unrelated chat"}],
            "name": me_user_id,
        }),
        None,
        None,
        None,
        &[],
        None,
        None,
        None,
    )
    .await
    .unwrap();
    app_state.global_policy_engine.invalidate_data().await;
    assert!(
        !origin_in_flight(&server, &bystander_chat).await,
        "a chat that owns no delegated child owes nothing, even while another \
         of this user's origins has one in flight"
    );

    // (c) Parked on a tool approval. The heartbeat is NULL here, which is why
    //     the predicate needs the `awaiting_approval` arm at all: delete that
    //     arm and this assertion flips.
    //
    //     The COALESCE(..., FALSE) beside it is NOT pinned by this case, and
    //     saying otherwise would be a trap for the next reader. It sits as a
    //     top-level conjunct of the EXISTS, where NULL and FALSE both simply
    //     fail to qualify the row, and case (c) cannot reach it anyway because
    //     `awaiting_approval` already makes the first disjunct TRUE. It is kept
    //     for explicitness. (The sibling COALESCE in the retry gate IS
    //     load-bearing, because `NULL NOT IN (...)` is NULL.)
    set_child_lease(&app_state.db, child, "awaiting_approval", None).await;
    assert!(
        origin_in_flight(&server, &origin_chat).await,
        "a child parked on a tool approval is still in flight"
    );

    // (d) Stale heartbeat and no delivery recorded: nothing is owed and
    //     nothing is running.
    set_child_lease(&app_state.db, child, "running", Some(86_400)).await;
    assert!(
        !origin_in_flight(&server, &origin_chat).await,
        "a run whose lease went stale with no delivery owes nothing"
    );

    // (e)-(k) The delivery arm, with the lease provably finished so it is the
    //         only thing under test. Every variant of the ladder, not a
    //         sample of it.
    set_child_lease(&app_state.db, child, "completed", None).await;
    for state in [
        DeliveryState::Pending,
        DeliveryState::Claimed,
        DeliveryState::Delivered,
        DeliveryState::Reacted,
        DeliveryState::Superseded,
        DeliveryState::Failed,
    ] {
        // Matched rather than tabulated so that a seventh delivery state is a
        // compile error here instead of a silent omission: whoever adds one
        // has to decide whether the origin is still waiting on it.
        let expected = match state {
            DeliveryState::Pending | DeliveryState::Claimed => true,
            // The acceptance criterion: a `silent` result sits in `delivered`
            // until the user's next turn, and the origin is not waiting on it.
            DeliveryState::Delivered
            | DeliveryState::Reacted
            | DeliveryState::Superseded
            | DeliveryState::Failed => false,
        };
        let staged = stage_in_flight_child(
            &app_state.db,
            &me_user_id,
            origin_chat_id,
            RunMode::Async,
            Some(state),
        )
        .await;
        set_child_lease(&app_state.db, staged, "completed", None).await;
        assert_eq!(
            origin_in_flight(&server, &origin_chat).await,
            expected,
            "delivery state {} should read in_flight={expected}",
            state.as_str()
        );
        erato::db::entity::chats::Entity::delete_by_id(staged)
            .exec(&app_state.db)
            .await
            .expect("drop staged child");
    }

    // (h) A `background` run is out of scope: it never records a delivery, so
    //     scoping the predicate to `async` is what keeps the origin from
    //     waiting forever on a result that is not coming.
    let background = stage_in_flight_child(
        &app_state.db,
        &me_user_id,
        origin_chat_id,
        RunMode::Background,
        None,
    )
    .await;
    set_child_lease(&app_state.db, background, "running", Some(1)).await;
    assert!(
        !origin_in_flight(&server, &origin_chat).await,
        "a live background run owes the origin nothing"
    );
    erato::db::entity::chats::Entity::delete_by_id(background)
        .exec(&app_state.db)
        .await
        .expect("drop background child");

    // (l) An archived child still holding `pending`. Deliberately still true:
    //     the backstop sweep supersedes it with `child_archived`, and that is
    //     the code path this flag's staying-on is meant to drive.
    let archived = stage_in_flight_child(
        &app_state.db,
        &me_user_id,
        origin_chat_id,
        RunMode::Async,
        Some(DeliveryState::Pending),
    )
    .await;
    set_child_lease(&app_state.db, archived, "completed", None).await;
    let mut active: erato::db::entity::chats::ActiveModel =
        erato::db::entity::chats::Entity::find_by_id(archived)
            .one(&app_state.db)
            .await
            .unwrap()
            .expect("archived child")
            .into();
    active.archived_at = ActiveValue::Set(Some(sqlx::types::chrono::Utc::now().into()));
    active.update(&app_state.db).await.expect("archive child");
    assert!(
        origin_in_flight(&server, &origin_chat).await,
        "an archived child still owing a delivery keeps the origin's indicator on"
    );
}

/// The `origin_chat_id` filter narrows a listing to the runs spawned from one
/// chat. It composes with `include_delegated` rather than overriding it (the
/// filter alone matches nothing for delegated children), with the type
/// filter, with search, and with pagination — where `total_count` must
/// reflect the filtered set. An origin without children and another user
/// asking for the same origin both see an empty page; malformed ids are
/// rejected.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_listing_filters_by_origin_chat(pool: Pool<Postgres>) {
    let app_state = test_app_state(delegation_enabled_config(), pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let me_user_id = me.id.to_string();
    let server = app_server(app_state.clone());

    let assistant = create_assistant(&server, "Origin Filter Assistant", "prompt").await;
    let assistant_id = Uuid::parse_str(&assistant).unwrap();

    let origin_a = create_chat(&server, Some(&assistant)).await;
    let origin_a_id = Uuid::parse_str(&origin_a).unwrap();
    let origin_b = create_chat(&server, Some(&assistant)).await;
    let origin_b_id = Uuid::parse_str(&origin_b).unwrap();
    let childless = create_chat(&server, Some(&assistant)).await;

    let child_a1 = spawn_listed_delegated_run(
        &app_state,
        &me_user_id,
        assistant_id,
        origin_a_id,
        "Alpha one",
    )
    .await;
    let child_a2 = spawn_listed_delegated_run(
        &app_state,
        &me_user_id,
        assistant_id,
        origin_a_id,
        "Alpha two",
    )
    .await;
    let child_b = spawn_listed_delegated_run(
        &app_state,
        &me_user_id,
        assistant_id,
        origin_b_id,
        "Bravo run",
    )
    .await;
    app_state.global_policy_engine.invalidate_data().await;

    let mut a_children = vec![child_a1.clone(), child_a2.clone()];
    a_children.sort();

    // Exactly origin A's children; B's child is excluded.
    let listing = recent_chats(
        &server,
        &format!("?origin_chat_id={origin_a}&include_delegated=true"),
    )
    .await;
    let mut ids = listed_chat_ids(&listing);
    ids.sort();
    assert_eq!(ids, a_children);
    assert_eq!(listing["stats"]["total_count"], 2);
    let listing = recent_chats(
        &server,
        &format!("?origin_chat_id={origin_b}&include_delegated=true"),
    )
    .await;
    assert_eq!(listed_chat_ids(&listing), vec![child_b]);

    // Without include_delegated the delegated-run condition still applies,
    // so the origin filter alone matches nothing.
    let listing = recent_chats(&server, &format!("?origin_chat_id={origin_a}")).await;
    assert!(listed_chat_ids(&listing).is_empty());
    assert_eq!(listing["stats"]["total_count"], 0);

    // Composes with the type filter.
    let listing = recent_chats(
        &server,
        &format!("?origin_chat_id={origin_a}&include_delegated=true&type=assistant"),
    )
    .await;
    assert_eq!(listed_chat_ids(&listing).len(), 2);
    let listing = recent_chats(
        &server,
        &format!("?origin_chat_id={origin_a}&include_delegated=true&type=chat"),
    )
    .await;
    assert!(listed_chat_ids(&listing).is_empty());

    // Composes with search; the full page forces the count query with both
    // the search and origin parameters bound.
    let listing = recent_chats(
        &server,
        &format!("?origin_chat_id={origin_a}&include_delegated=true&q=Alpha"),
    )
    .await;
    assert_eq!(listed_chat_ids(&listing).len(), 2);
    let listing = recent_chats(
        &server,
        &format!("?origin_chat_id={origin_a}&include_delegated=true&q=Alpha&limit=1"),
    )
    .await;
    assert_eq!(listed_chat_ids(&listing).len(), 1);
    assert_eq!(listing["stats"]["total_count"], 2);
    assert_eq!(listing["stats"]["has_more"], true);

    // Pagination: pages are disjoint and total_count reflects the filtered
    // set, not the whole history.
    let first = recent_chats(
        &server,
        &format!("?origin_chat_id={origin_a}&include_delegated=true&limit=1&offset=0"),
    )
    .await;
    let second = recent_chats(
        &server,
        &format!("?origin_chat_id={origin_a}&include_delegated=true&limit=1&offset=1"),
    )
    .await;
    assert_eq!(first["stats"]["total_count"], 2);
    assert_eq!(first["stats"]["has_more"], true);
    assert_eq!(second["stats"]["total_count"], 2);
    assert_eq!(second["stats"]["has_more"], false);
    let mut paged: Vec<String> = [&first, &second]
        .into_iter()
        .flat_map(listed_chat_ids)
        .collect();
    paged.sort();
    assert_eq!(paged, a_children);

    // An origin without children yields an empty page with clean stats.
    let listing = recent_chats(
        &server,
        &format!("?origin_chat_id={childless}&include_delegated=true"),
    )
    .await;
    assert!(listed_chat_ids(&listing).is_empty());
    assert_eq!(listing["stats"]["total_count"], 0);
    assert_eq!(listing["stats"]["has_more"], false);

    // Listings are owner-scoped: another user asking for this origin id
    // sees nothing.
    let other_subject = "origin-filter-other-user";
    let other_token = JwtTokenBuilder::new()
        .subject(other_subject)
        .email("origin-filter-other@example.com")
        .build();
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        other_subject,
        Some("origin-filter-other@example.com"),
    )
    .await
    .unwrap();
    let response = server
        .get(&format!(
            "/api/v1beta/me/recent_chats?origin_chat_id={origin_a}&include_delegated=true"
        ))
        .with_bearer_token(&other_token)
        .await;
    response.assert_status_ok();
    let listing = response.json::<Value>();
    assert!(listed_chat_ids(&listing).is_empty());
    assert_eq!(listing["stats"]["total_count"], 0);

    // Malformed ids are rejected up front.
    let response = server
        .get("/api/v1beta/me/recent_chats?origin_chat_id=not-a-uuid")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);
}

fn listed_chat<'a>(listing: &'a Value, chat_id: &str) -> &'a Value {
    listing["chats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chat| chat["id"] == chat_id)
        .unwrap_or_else(|| panic!("chat {chat_id} missing from listing"))
}

/// Appends an assistant answer to a delegated child the way a generation's
/// wind-down persists one, with the given metadata.
async fn append_assistant_answer(
    app_state: &erato::state::AppState,
    me_user_id: &str,
    chat_id: Uuid,
    text: &str,
    generation_metadata: Option<erato::models::message::GenerationMetadata>,
) {
    erato::models::message::submit_message(
        &app_state.db,
        &rebuilt_policy(app_state).await,
        &erato::policy::types::Subject::User(me_user_id.to_string()),
        &chat_id,
        json!({
            "role": "assistant",
            "content": [{"content_type": "text", "text": text}],
        }),
        None,
        None,
        None,
        &[],
        None,
        generation_metadata,
        None,
    )
    .await
    .unwrap();
}

fn answer_metadata(
    error: Option<erato::models::message::GenerationErrorType>,
    was_aborted: bool,
) -> erato::models::message::GenerationMetadata {
    erato::models::message::GenerationMetadata {
        used_prompt_tokens: None,
        used_completion_tokens: None,
        used_total_tokens: None,
        used_reasoning_tokens: None,
        reasoning_summary: None,
        reasoning_items: None,
        reasoning_item_encrypted_content: None,
        langfuse_trace_id: None,
        was_aborted: was_aborted.then_some(true),
        error,
        mcp_servers_unavailable: None,
        mcp_servers_needing_auth: None,
        mcp_servers_disabled_by_user: None,
        mcp_tools_disabled_by_user: None,
        continuation_in_flight: None,
    }
}

/// A background run's completion is derived from the child chat itself, so
/// it survives the retention window that clears the generation columns: a
/// client fetching the listing fresh — never having observed the run as
/// running — still reads `completed` well after the fact. While the run is
/// live the field stays absent alongside the running signal — asserted
/// opportunistically, since the child may finish before the listing first
/// shows it — and chats that are not delegated runs never carry it.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegated_run_outcome_survives_retention(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // Child: slow enough that the listing observes it live first.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-OUTCOME-TASK"],
                &["dispatched"],
            ));
        let mut actions =
            crate::test_utils::build_openai_text_streaming_response(&["CHILD-OUTCOME-ANSWER done"]);
        actions.insert(0, BodyAction::Delay(std::time::Duration::from_secs(3)));
        mock_llm_sse_response(then, actions);
    });
    // Parent turn 2: the dispatched tool response arrived.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["dispatched"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[
                "PARENT-OUTCOME-FINAL launched",
            ]),
        );
    });
    // Parent turn 1: delegate in the background.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["outcome parent question"],
                &["CHILD-OUTCOME-TASK", "dispatched"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_outcome",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-OUTCOME-TASK take your time",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.allow_background = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, &delegate_prompt(), None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions_and_run_mode(
        &server,
        None,
        "outcome parent question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
        "background",
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    let delegate_chat_id = output["delegate_chat_id"].as_str().unwrap().to_string();
    let origin_chat_id = crate::test_utils::extract_chat_id(&events).unwrap();
    let origin_query = format!("?origin_chat_id={origin_chat_id}&include_delegated=true");

    // The child appears in the listing only once its brief is saved, and the
    // brief is written inside the detached child task with nothing ordering
    // it before the parent stream's end — poll for the row. Should the child
    // have finished by the time it surfaces, the live-phase claims are
    // unobservable and only the terminal shape can be checked; the retention
    // assertions below are this test's actual point.
    let mut live_row = None;
    for _ in 0..66 {
        let listing = recent_chats(&server, &origin_query).await;
        if let Some(row) = listing["chats"]
            .as_array()
            .unwrap()
            .iter()
            .find(|chat| chat["id"] == delegate_chat_id.as_str())
        {
            live_row = Some(row.clone());
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    let live_row = live_row.expect("child chat missing from listing");
    if live_row["delegated_run_outcome"].is_null() {
        assert!(live_row["active_generation_started_at"].is_string());
    } else {
        assert_eq!(live_row["delegated_run_outcome"], "completed");
    }

    // A chat that is not a delegated run never carries an outcome.
    let listing = recent_chats(&server, "").await;
    assert!(listed_chat(&listing, &origin_chat_id)["delegated_run_outcome"].is_null());

    wait_for_child_completion(
        &app_state.db,
        Uuid::parse_str(&delegate_chat_id).unwrap(),
        "CHILD-OUTCOME-ANSWER",
    )
    .await;

    // Within the retention window the chat still holds its terminal state.
    let listing = recent_chats(&server, &origin_query).await;
    let row = listed_chat(&listing, &delegate_chat_id);
    assert_eq!(row["delegated_run_outcome"], "completed");
    assert!(row["active_generation_started_at"].is_null());

    // Run the maintenance cleanup by hand as if the window had passed: the
    // generation columns are cleared and the shared rows deleted.
    use sea_orm::{ConnectionTrait, Statement};
    app_state
        .db
        .execute_raw(Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            r#"UPDATE chats
               SET active_generation_id = NULL,
                   generation_state = NULL,
                   generation_started_at = NULL,
                   generation_heartbeat_at = NULL,
                   generation_ended_at = NULL
               WHERE generation_state IN ('completed', 'errored')"#,
        ))
        .await
        .unwrap();
    app_state
        .db
        .execute_raw(Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            "DELETE FROM temp_chat_generations WHERE state IN ('completed', 'errored')",
        ))
        .await
        .unwrap();

    // A fresh fetch still reports the completion.
    let listing = recent_chats(&server, &origin_query).await;
    let row = listed_chat(&listing, &delegate_chat_id);
    assert_eq!(row["delegated_run_outcome"], "completed");
    assert!(row["active_generation_started_at"].is_null());
}

/// The derived outcome classifies dead runs as `failed`: a brief that was
/// never answered, the empty assistant row a hard-killed run settles into
/// once retention clears its generation columns, a seeded parent answer
/// whose timestamps predate the chat (killed between seeding and the brief
/// save), an answer carrying a generation error, and a clean answer on a
/// chat still marked `errored`. A user-stopped run keeps its partial answer
/// and reads `completed`, consistent with an abort counting as completion
/// for the task outcome.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegated_run_outcome_reports_failures(pool: Pool<Postgres>) {
    let app_state = test_app_state(delegation_enabled_config(), pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let me_user_id = me.id.to_string();
    let server = app_server(app_state.clone());

    let assistant = create_assistant(&server, "Outcome Assistant", "prompt").await;
    let assistant_id = Uuid::parse_str(&assistant).unwrap();
    let origin = create_chat(&server, Some(&assistant)).await;
    let origin_id = Uuid::parse_str(&origin).unwrap();

    // Never answered, all generation columns clear: the post-reap shape.
    let unanswered = spawn_listed_delegated_run(
        &app_state,
        &me_user_id,
        assistant_id,
        origin_id,
        "Unanswered",
    )
    .await;

    // Answered, but the generation recorded an error.
    let errored_answer = spawn_listed_delegated_run(
        &app_state,
        &me_user_id,
        assistant_id,
        origin_id,
        "Errored answer",
    )
    .await;
    append_assistant_answer(
        &app_state,
        &me_user_id,
        Uuid::parse_str(&errored_answer).unwrap(),
        "half an answer",
        Some(answer_metadata(
            Some(erato::models::message::GenerationErrorType::ProviderError {
                error_description: "upstream fell over".to_string(),
                status_code: Some(502),
            }),
            false,
        )),
    )
    .await;

    // Stopped by the user mid-answer: partial text, no error.
    let aborted =
        spawn_listed_delegated_run(&app_state, &me_user_id, assistant_id, origin_id, "Aborted")
            .await;
    append_assistant_answer(
        &app_state,
        &me_user_id,
        Uuid::parse_str(&aborted).unwrap(),
        "partial answer",
        Some(answer_metadata(None, true)),
    )
    .await;

    // Clean answer, but the chat is still marked `errored`: while the state
    // exists it wins over the answer shape.
    let errored_state = spawn_listed_delegated_run(
        &app_state,
        &me_user_id,
        assistant_id,
        origin_id,
        "Errored state",
    )
    .await;
    append_assistant_answer(
        &app_state,
        &me_user_id,
        Uuid::parse_str(&errored_state).unwrap(),
        "an answer",
        None,
    )
    .await;
    use sea_orm::{ConnectionTrait, Statement};
    app_state
        .db
        .execute_raw(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"UPDATE chats
               SET generation_state = 'errored', generation_ended_at = now()
               WHERE id = $1"#,
            [Uuid::parse_str(&errored_state).unwrap().into()],
        ))
        .await
        .unwrap();

    // The husk a hard-killed run leaves: submit created the assistant row
    // before generation started, nothing ever filled it, and retention
    // cleared the 'errored' state the reaper had set.
    let killed =
        spawn_listed_delegated_run(&app_state, &me_user_id, assistant_id, origin_id, "Killed")
            .await;
    erato::models::message::submit_message(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me_user_id.to_string()),
        &Uuid::parse_str(&killed).unwrap(),
        json!({
            "role": "assistant",
            "content": [],
        }),
        None,
        None,
        None,
        &[],
        None,
        None,
        None,
    )
    .await
    .unwrap();

    // Killed between seeding and the brief save: the only message is a
    // seeded copy of a parent answer, which keeps the copied conversation's
    // timestamps and so predates the chat itself.
    let seeded_only = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me_user_id.to_string()),
        &me_user_id,
        Some(assistant_id),
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(origin_id),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: Some(assistant_id),
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        },
        None,
        "Seeded only".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .unwrap()
    .id
    .to_string();
    let seeded_only_id = Uuid::parse_str(&seeded_only).unwrap();
    append_assistant_answer(
        &app_state,
        &me_user_id,
        seeded_only_id,
        "an answer the parent already had",
        None,
    )
    .await;
    app_state
        .db
        .execute_raw(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"UPDATE messages
               SET created_at = (SELECT created_at - interval '1 hour' FROM chats WHERE id = $1)
               WHERE chat_id = $1"#,
            [seeded_only_id.into()],
        ))
        .await
        .unwrap();

    app_state.global_policy_engine.invalidate_data().await;

    let listing = recent_chats(
        &server,
        &format!("?origin_chat_id={origin}&include_delegated=true"),
    )
    .await;
    assert_eq!(
        listed_chat(&listing, &unanswered)["delegated_run_outcome"],
        "failed"
    );
    assert_eq!(
        listed_chat(&listing, &killed)["delegated_run_outcome"],
        "failed"
    );
    assert_eq!(
        listed_chat(&listing, &seeded_only)["delegated_run_outcome"],
        "failed"
    );
    assert_eq!(
        listed_chat(&listing, &errored_answer)["delegated_run_outcome"],
        "failed"
    );
    assert_eq!(
        listed_chat(&listing, &aborted)["delegated_run_outcome"],
        "completed"
    );
    assert_eq!(
        listed_chat(&listing, &errored_state)["delegated_run_outcome"],
        "failed"
    );
}

/// A delegated chat parked in `awaiting_approval` still surfaces through
/// `/me/generating` and carries `pending_tool_approval_at` when listed —
/// hiding delegated runs must never make a stranded child unreachable.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_parked_delegated_chat_stays_reachable(pool: Pool<Postgres>) {
    let app_state = test_app_state(delegation_enabled_config(), pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());

    let assistant = create_assistant(&server, "Parked Assistant", "prompt").await;
    let origin_chat = create_chat(&server, Some(&assistant)).await;
    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me.id.to_string()),
        &me.id.to_string(),
        Some(Uuid::parse_str(&assistant).unwrap()),
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(Uuid::parse_str(&origin_chat).unwrap()),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: None,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        },
        None,
        "Parked delegated run".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .unwrap();
    app_state.global_policy_engine.invalidate_data().await;
    erato::models::message::submit_message(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me.id.to_string()),
        &child.id,
        json!({
            "role": "user",
            "content": [{"content_type": "text", "text": "parked task"}],
            "name": me.id.to_string(),
        }),
        None,
        None,
        None,
        &[],
        None,
        None,
        None,
    )
    .await
    .unwrap();

    // Park the child the way the durable stop does.
    use sea_orm::{ConnectionTrait, Statement};
    app_state
        .db
        .execute_raw(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"UPDATE chats
               SET generation_state = 'awaiting_approval',
                   generation_started_at = now() - interval '1 minute',
                   generation_ended_at = now()
               WHERE id = $1"#,
            [child.id.into()],
        ))
        .await
        .unwrap();

    // Reachable via /me/generating despite listings hiding it.
    let response = server
        .get("/api/v1beta/me/generating")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let generating = response.json::<Value>();
    let entry = generating["chats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chat| chat["chat_id"] == child.id.to_string())
        .expect("parked delegated chat must appear in /me/generating");
    assert_eq!(entry["state"], "action_required");

    // Hidden from the default listing, but the opted-in listing carries the
    // pending approval timestamp.
    let listing = recent_chats(&server, "").await;
    assert!(!listed_chat_ids(&listing).contains(&child.id.to_string()));
    let listing = recent_chats(&server, "?include_delegated=true").await;
    let entry = listing["chats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chat| chat["id"] == child.id.to_string())
        .expect("delegated chat listed with include_delegated");
    assert!(entry["pending_tool_approval_at"].is_string());
}

/// A child answer longer than `result_max_chars` is truncated and flagged.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegation_result_truncated_at_cap(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-LONG-TASK"],
                &["delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[
                "CHILD-LONG-ANSWER with ünïcödé and plenty of filler to exceed the configured cap",
            ]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["delegate_chat_id"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-LONG-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["long answer question"],
                &["CHILD-LONG-TASK", "delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_long",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-LONG-TASK produce a long answer",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.delegation.result_max_chars = 32;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "long delegate", None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions(
        &server,
        None,
        "long answer question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "completed");
    assert_eq!(output["truncated"], true);
    let result = output["result"].as_str().unwrap();
    assert_eq!(result.chars().count(), 32);
    assert!(result.starts_with("CHILD-LONG-ANSWER with ünïcödé"));
}

/// A child run that completes without producing an answer is reported as
/// `failed`, never as an empty `completed` result.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegation_empty_child_answer_completes_with_no_answer(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-EMPTY-TASK"],
                &["delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[""]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["delegate_chat_id"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-EMPTY-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["empty answer question"],
                &["CHILD-EMPTY-TASK", "delegate_chat_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_empty",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "CHILD-EMPTY-TASK say nothing",
                }),
            )]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "empty delegate", None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions(
        &server,
        None,
        "empty answer question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    // "The delegate had nothing to add" is a result the origin model can
    // reason about; reporting it as a failure invited a retry that would say
    // nothing again.
    assert_eq!(output["status"], "completed");
    assert_eq!(output["reason"], "no_answer");
    assert!(output["result"].is_null());
    assert!(extract_full_text_answer(&events).contains("PARENT-EMPTY-FINAL"));
}

/// Mentions submitted into a chat that is itself a delegated run validate,
/// but the delegation tool is never offered there — depth stays at one.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_no_delegation_offer_inside_a_delegated_run(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["depth guard answer"]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "depth delegate", None).await;
    let server = app_server(app_state.clone());

    // A chat that is itself a delegated run, bound to another assistant.
    let bound_assistant = create_assistant(&server, "Bound Assistant", "bound prompt").await;
    let origin_chat = create_chat(&server, Some(&bound_assistant)).await;
    let delegated_chat = create_chat(&server, Some(&bound_assistant)).await;
    write_delegation_provenance(
        &app_state.db,
        Uuid::parse_str(&delegated_chat).unwrap(),
        Uuid::parse_str(&bound_assistant).unwrap(),
        Uuid::parse_str(&origin_chat).unwrap(),
        None,
    )
    .await;

    // Mentions inside a delegated run are rejected outright (depth stays 1).
    let response = submit_with_mentions(
        &server,
        Some(&delegated_chat),
        "mention inside a delegated run",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);

    // A plain submit into the delegated run works and offers no delegation
    // tool (nor any client tools).
    let events = submit_message(
        &server,
        &delegated_chat,
        None,
        "plain message inside a delegated run",
        vec![],
    )
    .await;
    assert!(extract_full_text_answer(&events).contains("depth guard answer"));
    for body in recorder.bodies() {
        assert!(
            !body.contains("delegate_to_assistant"),
            "the delegation tool must never be offered inside a delegated run"
        );
    }
}

/// Regenerating a mention-carrying turn re-offers the delegation tool from
/// the persisted mentions; an empty task argument is refused and the turn
/// recovers.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_regenerate_reoffers_tool_and_empty_task_refused(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    // Empty-task call on the regenerated turn → refusal → recovery in prose.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["Delegation refused"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["REGEN-RECOVERED"]),
        );
    });
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["regen offer question"],
                    &["Delegation refused"],
                ))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                    "call_delegate_regen",
                    "delegate_to_assistant",
                    json!({
                        "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                        "task": "   ",
                    }),
                )]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "regen delegate", None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions(
        &server,
        None,
        "regen offer question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    // The submit turn already refused the empty task and recovered.
    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "error");
    assert!(
        output["error"]
            .as_str()
            .unwrap()
            .contains("must not be empty")
    );
    let assistant_message_id = assistant_message_id_from_events(&events);

    // Regenerate WITHOUT the field: the persisted mentions must re-offer the
    // tool (recorder sees a second offering request).
    let offers_before = recorder
        .bodies()
        .iter()
        .filter(|body| body.contains("delegate_to_assistant"))
        .count();
    let regenerate_response = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "current_message_id": assistant_message_id }))
        .await;
    regenerate_response.assert_status_ok();
    let offers_after = recorder
        .bodies()
        .iter()
        .filter(|body| {
            let parsed: Value = serde_json::from_str(body).unwrap_or_default();
            parsed["tools"].as_array().is_some_and(|tools| {
                tools
                    .iter()
                    .any(|tool| tool["function"]["name"] == "delegate_to_assistant")
            })
        })
        .count();
    assert!(
        offers_after > offers_before.min(offers_after - 1),
        "regenerate must re-offer the delegation tool from persisted mentions"
    );
    assert!(
        offers_after >= 2,
        "submit and regenerate should both offer the tool"
    );
}

/// Archiving the delegate between submit-time validation and dispatch is
/// caught by the dispatch-time re-resolution: the call is refused, no child
/// chat is created, and the turn recovers.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delegation_dispatch_refuses_target_archived_after_validation(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["Delegation refused"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["ARCHIVE-RECOVERED"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["archive race question"],
                &["Delegation refused"],
            ));
        // Stall long enough for the test to archive the delegate mid-turn.
        let mut actions = vec![BodyAction::Delay(std::time::Duration::from_secs(2))];
        actions.extend(
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_archived",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "should be refused",
                }),
            )]),
        );
        mock_llm_sse_response(then, actions);
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "archived delegate", None).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();
    let app: Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{server_addr}");
    let submit_client = client.clone();
    let submit_base = base_url.clone();
    let submit_handle = tokio::spawn(async move {
        let response = submit_client
            .post(format!("{submit_base}/api/v1beta/me/messages/submitstream"))
            .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
            .json(&json!({
                "user_message": "archive race question",
                "mentioned_assistant_ids": [DELEGATE_ASSISTANT_FIXED_ID],
            }))
            .send()
            .await
            .expect("submit request");
        assert!(response.status().is_success());
        response.text().await.expect("submit body")
    });

    // Validation has passed once the submit is accepted; archive the delegate
    // while the parent model is still "thinking".
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let archive_response = client
        .post(format!(
            "{base_url}/api/v1beta/assistants/{DELEGATE_ASSISTANT_FIXED_ID}/archive"
        ))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert!(archive_response.status().is_success());

    let body = tokio::time::timeout(std::time::Duration::from_secs(20), submit_handle)
        .await
        .expect("parent stream should complete")
        .unwrap();
    assert!(body.contains("no longer available"));
    assert!(body.contains("ARCHIVE-RECOVERED"));

    let children = erato::db::entity::chats::Entity::find()
        .filter(erato::db::entity::chats::Column::OriginChatId.is_not_null())
        .all(&app_state.db)
        .await
        .unwrap();
    assert!(children.is_empty(), "no child chat for a refused dispatch");
}

async fn spawn_delegated_run(
    app_state: &erato::state::AppState,
    owner_user_id: &str,
    assistant_id: Uuid,
    origin_chat_id: Uuid,
    title: &str,
) -> Uuid {
    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &rebuilt_policy(app_state).await,
        &erato::policy::types::Subject::User(owner_user_id.to_string()),
        owner_user_id,
        Some(assistant_id),
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(origin_chat_id),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: None,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        },
        None,
        title.to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("create delegated chat");
    app_state.global_policy_engine.invalidate_data().await;
    insert_chat_message(&app_state.db, child.id, title).await;
    child.id
}

async fn spawn_handoff_branch(
    app_state: &erato::state::AppState,
    owner_user_id: &str,
    assistant_id: Uuid,
    origin_chat_id: Uuid,
) -> Uuid {
    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &rebuilt_policy(app_state).await,
        &erato::policy::types::Subject::User(owner_user_id.to_string()),
        owner_user_id,
        Some(assistant_id),
        ChatProvenance {
            kind: ChatProvenanceKind::HandoffBranch,
            origin_chat_id: Some(origin_chat_id),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: None,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        },
        None,
        "Handoff branch".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("create handoff chat");
    app_state.global_policy_engine.invalidate_data().await;
    insert_chat_message(&app_state.db, child.id, "handoff branch").await;
    child.id
}

async fn backdate_chat_creation(db: &sea_orm::DatabaseConnection, chat_id: Uuid, secs: i64) {
    erato::db::entity::chats::ActiveModel {
        id: ActiveValue::Unchanged(chat_id),
        created_at: ActiveValue::Set(
            (sqlx::types::chrono::Utc::now() - chrono::Duration::seconds(secs)).into(),
        ),
        ..Default::default()
    }
    .update(db)
    .await
    .expect("backdate chat");
}

async fn insert_chat_message(db: &sea_orm::DatabaseConnection, chat_id: Uuid, text: &str) {
    let now: sea_orm::prelude::DateTimeWithTimeZone = sqlx::types::chrono::Utc::now().into();
    erato::db::entity::messages::Entity::insert(erato::db::entity::messages::ActiveModel {
        id: ActiveValue::Set(Uuid::new_v4()),
        chat_id: ActiveValue::Set(chat_id),
        raw_message: ActiveValue::Set(
            json!({"role": "user", "content": [{"content_type": "text", "text": text}]}),
        ),
        created_at: ActiveValue::Set(now),
        updated_at: ActiveValue::Set(now),
        is_message_in_active_thread: ActiveValue::Set(true),
        ..Default::default()
    })
    .exec(db)
    .await
    .expect("insert message");
}

async fn set_generation_lease(
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
    state: Option<&str>,
    heartbeat_age_secs: i64,
) {
    let now = sqlx::types::chrono::Utc::now();
    erato::db::entity::chats::ActiveModel {
        id: ActiveValue::Unchanged(chat_id),
        generation_state: ActiveValue::Set(state.map(str::to_string)),
        generation_started_at: ActiveValue::Set(state.map(|_| now.into())),
        generation_heartbeat_at: ActiveValue::Set(
            state.map(|_| (now - chrono::Duration::seconds(heartbeat_age_secs)).into()),
        ),
        ..Default::default()
    }
    .update(db)
    .await
    .expect("set generation lease");
}

async fn pin_chat(db: &sea_orm::DatabaseConnection, chat_id: Uuid) {
    erato::db::entity::chats::ActiveModel {
        id: ActiveValue::Unchanged(chat_id),
        is_pinned: ActiveValue::Set(true),
        ..Default::default()
    }
    .update(db)
    .await
    .expect("pin chat");
}

async fn is_pinned_of(db: &sea_orm::DatabaseConnection, chat_id: Uuid) -> bool {
    erato::db::entity::chats::Entity::find_by_id(chat_id)
        .one(db)
        .await
        .unwrap()
        .expect("chat should still exist")
        .is_pinned
}

async fn archived_at_of(db: &sea_orm::DatabaseConnection, chat_id: Uuid) -> Option<String> {
    erato::db::entity::chats::Entity::find_by_id(chat_id)
        .one(db)
        .await
        .unwrap()
        .expect("chat should still exist")
        .archived_at
        .map(|value| value.to_string())
}

/// Archiving a chat archives the delegated runs it spawned and theirs in turn
/// and clears their pins, but leaves alone a run whose generation has not
/// finished or has not started yet, never leaves the owner, and never reaches
/// another provenance kind.
/// Unarchiving the origin restores only the origin. A run that survives its
/// origin still reads with a dangling origin.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_archive_cascades_to_idle_delegated_runs(pool: Pool<Postgres>) {
    let app_state = test_app_state(delegation_enabled_config(), pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let other = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "delegation-archive-other",
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());

    let assistant = create_assistant(&server, "Cascade Assistant", "prompt").await;
    let assistant_id = Uuid::parse_str(&assistant).unwrap();
    let parent = create_chat(&server, Some(&assistant)).await;
    let parent_id = Uuid::parse_str(&parent).unwrap();
    insert_chat_message(&app_state.db, parent_id, "parent question").await;

    let me_id = me.id.to_string();
    let idle = spawn_delegated_run(&app_state, &me_id, assistant_id, parent_id, "idle run").await;
    let grandchild =
        spawn_delegated_run(&app_state, &me_id, assistant_id, idle, "nested run").await;
    for finished in [idle, grandchild] {
        backdate_chat_creation(&app_state.db, finished, 600).await;
    }
    let handoff = spawn_handoff_branch(&app_state, &me_id, assistant_id, parent_id).await;
    backdate_chat_creation(&app_state.db, handoff, 600).await;
    // Dispatch creates the chat a moment before it claims the lease.
    let dispatching = spawn_delegated_run(
        &app_state,
        &me_id,
        assistant_id,
        parent_id,
        "dispatching run",
    )
    .await;
    let running =
        spawn_delegated_run(&app_state, &me_id, assistant_id, parent_id, "running run").await;
    set_generation_lease(&app_state.db, running, Some("running"), 0).await;
    let parked =
        spawn_delegated_run(&app_state, &me_id, assistant_id, parent_id, "parked run").await;
    set_generation_lease(&app_state.db, parked, Some("awaiting_approval"), 0).await;
    let crashed =
        spawn_delegated_run(&app_state, &me_id, assistant_id, parent_id, "crashed run").await;
    set_generation_lease(&app_state.db, crashed, Some("running"), 600).await;
    let foreign = spawn_delegated_run(
        &app_state,
        &other.id.to_string(),
        assistant_id,
        parent_id,
        "foreign run",
    )
    .await;

    pin_chat(&app_state.db, idle).await;

    archive_chat_via_api(&server, &parent).await;

    assert!(!is_pinned_of(&app_state.db, idle).await);

    for (label, id) in [
        ("the archived chat", parent_id),
        ("an idle delegated run", idle),
        ("a nested delegated run", grandchild),
        ("a run whose generation died", crashed),
    ] {
        assert!(
            archived_at_of(&app_state.db, id).await.is_some(),
            "{label} must be archived"
        );
    }
    for (label, id) in [
        ("a running delegated run", running),
        ("a delegated run awaiting approval", parked),
        (
            "a delegated run that is still being dispatched",
            dispatching,
        ),
        ("a chat spawned by a handoff", handoff),
        ("another user's delegated run", foreign),
    ] {
        assert!(
            archived_at_of(&app_state.db, id).await.is_none(),
            "{label} must not be archived"
        );
    }

    unarchive_chat_via_api(&server, &parent).await;
    assert!(archived_at_of(&app_state.db, parent_id).await.is_none());
    assert!(
        archived_at_of(&app_state.db, idle).await.is_some(),
        "a delegated run stays archived when its origin is unarchived"
    );

    // The origin goes away — by the cleanup worker later, or as here — while
    // the run that was still going survives it.
    erato::db::entity::messages::Entity::delete_many()
        .filter(erato::db::entity::messages::Column::ChatId.eq(parent_id))
        .exec(&app_state.db)
        .await
        .unwrap();
    erato::db::entity::chats::Entity::delete_by_id(parent_id)
        .exec(&app_state.db)
        .await
        .unwrap();

    let listing = recent_chats(&server, "?include_delegated=true").await;
    let entry = listing["chats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chat| chat["id"] == running.to_string())
        .expect("the surviving run stays listable");
    assert_eq!(entry["provenance_kind"], "delegation");
    assert_eq!(entry["origin_chat_id"], parent_id.to_string());
    assert!(entry["origin_chat_title"].is_null());
}

/// A dispatch that fails after creating the child chat but before its run
/// starts leaves nothing behind.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_pre_run_dispatch_failure_leaves_no_child_chat(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["Delegation refused"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-RECOVERED"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["seeding question"],
                &["Delegation refused"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delegate_seed",
                "delegate_to_assistant",
                json!({
                    "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                    "task": "should never run",
                    "include_conversation_context": true,
                }),
            )]),
        );
    });
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["first answer"]),
        );
    });

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "delegate prompt", None).await;
    let server = app_server(app_state.clone());

    let parent_chat = create_chat(&server, None).await;
    let parent_chat_id = Uuid::parse_str(&parent_chat).unwrap();
    let first_events = submit_message(&server, &parent_chat, None, "first question", vec![]).await;
    let first_head = assistant_message_id_from_events(&first_events);

    // Seeding copies the turn above, then links the files its messages name.
    // Naming a file that does not exist makes that link fail, which is a
    // dispatch failure after the child chat was created and before its run
    // starts.
    let user_row = chat_messages_by_created_at(&app_state.db, parent_chat_id)
        .await
        .into_iter()
        .find(|row| row.raw_message["role"] == "user")
        .expect("user message row");
    let mut user_active: erato::db::entity::messages::ActiveModel = user_row.into();
    user_active.input_file_uploads = ActiveValue::Set(Some(vec![Uuid::new_v4()]));
    user_active
        .update(&app_state.db)
        .await
        .expect("point the message at a missing file");

    let response = submit_with_mentions_with_previous(
        &server,
        &parent_chat,
        Some(&first_head),
        "seeding question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    let output = find_tool_call_update_output(&events, "delegate_to_assistant");
    assert_eq!(output["status"], "error");
    assert!(
        output["error"]
            .as_str()
            .unwrap()
            .contains("conversation context")
    );
    assert!(extract_full_text_answer(&events).contains("PARENT-RECOVERED"));

    let children = erato::db::entity::chats::Entity::find()
        .filter(erato::db::entity::chats::Column::OriginChatId.eq(parent_chat_id))
        .all(&app_state.db)
        .await
        .unwrap();
    assert!(
        children.is_empty(),
        "the child chat must not be left behind"
    );

    let chat_ids: Vec<Uuid> = erato::db::entity::chats::Entity::find()
        .all(&app_state.db)
        .await
        .unwrap()
        .into_iter()
        .map(|chat| chat.id)
        .collect();
    let orphaned = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::ChatId.is_not_in(chat_ids.clone()))
        .all(&app_state.db)
        .await
        .unwrap();
    assert!(
        orphaned.is_empty(),
        "seeded messages must not be left behind"
    );

    let running_tasks: Vec<Uuid> = app_state
        .background_tasks
        .tasks
        .read()
        .await
        .keys()
        .copied()
        .collect();
    assert!(
        running_tasks
            .iter()
            .all(|chat_id| chat_ids.contains(chat_id)),
        "the child's generation must not outlive its chat"
    );
}

/// A write into a delegated run that is still going is rejected, whether the
/// run is known from this process or only from the chat's generation lease, and
/// whether it names the chat or a message in it. Once it has finished, the chat
/// takes messages like any other, and taking it over is recorded.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_submit_into_live_delegated_run_conflicts(pool: Pool<Postgres>) {
    let (app_state, _llm) = delegation_enabled_state_with_llm(pool).await;
    let server = app_server(app_state.clone());
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();

    let assistant = create_assistant(&server, "Live Run Assistant", "prompt").await;
    let origin = create_chat(&server, Some(&assistant)).await;
    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me.id.to_string()),
        &me.id.to_string(),
        Some(Uuid::parse_str(&assistant).unwrap()),
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(Uuid::parse_str(&origin).unwrap()),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: None,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        },
        None,
        "Continuable run".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .unwrap();
    app_state.global_policy_engine.invalidate_data().await;
    let child_chat = child.id.to_string();

    // The run has finished: continuing it is the whole point of the chat.
    let events = submit_message(&server, &child_chat, None, "follow-up one", vec![]).await;
    let assistant_message_id = assistant_message_id_from_events(&events);
    let user_message_id = chat_messages_by_created_at(&app_state.db, child.id)
        .await
        .into_iter()
        .find(|row| row.raw_message["role"] == "user")
        .expect("user message row")
        .id;

    // The lease says a run is in flight, and every write path refuses.
    set_generation_lease(&app_state.db, child.id, Some("running"), 0).await;
    let conflict = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "existing_chat_id": child_chat, "user_message": "interloper" }))
        .await;
    conflict.assert_status(axum::http::StatusCode::CONFLICT);
    let conflict = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "previous_message_id": assistant_message_id,
            "user_message": "interloper",
        }))
        .await;
    conflict.assert_status(axum::http::StatusCode::CONFLICT);
    let conflict = server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "current_message_id": assistant_message_id }))
        .await;
    conflict.assert_status(axum::http::StatusCode::CONFLICT);
    let conflict = server
        .post("/api/v1beta/me/messages/editstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": user_message_id,
            "replace_user_message": "interloping edit",
        }))
        .await;
    conflict.assert_status(axum::http::StatusCode::CONFLICT);

    // A run whose process died stops heartbeating, and stops holding the chat.
    set_generation_lease(&app_state.db, child.id, Some("running"), 600).await;
    let accepted = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "existing_chat_id": child_chat, "user_message": "after a dead run" }))
        .await;
    accepted.assert_status_ok();

    // A run this process is driving is refused even without a lease to read.
    set_generation_lease(&app_state.db, child.id, None, 0).await;
    let (_receiver, task) = app_state
        .background_tasks
        .start_task(child.id, Uuid::new_v4())
        .await;
    set_generation_lease(&app_state.db, child.id, None, 0).await;
    let conflict = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "existing_chat_id": child_chat, "user_message": "interloper" }))
        .await;
    conflict.assert_status(axum::http::StatusCode::CONFLICT);

    task.mark_completed();
    app_state
        .background_tasks
        .remove_task(
            &child.id,
            task.generation_id,
            erato::services::background_tasks::TaskOutcome::Completed,
        )
        .await;
    set_generation_lease(&app_state.db, child.id, None, 0).await;

    let accepted = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "existing_chat_id": child_chat, "user_message": "follow-up two" }))
        .await;
    accepted.assert_status_ok();

    let adopted_at = erato::db::entity::chats::Entity::find_by_id(child.id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("child chat")
        .assistant_configuration
        .expect("assistant configuration")["provenance"]["adopted_at"]
        .clone();
    assert!(
        adopted_at.is_string(),
        "a run the user wrote into is recorded as adopted"
    );
}

/// A mention-carrying turn that parks on an MCP approval loses the delegation
/// offer when it is continued: `continuestream` rebuilds the tool set from MCP
/// discovery alone. A delegate call the model makes anyway is refused per-CALL
/// by the unoffered-tool guard — which runs before the dispatch branch and its
/// own "not available" fallback — so nothing is delegated and the turn recovers
/// in prose.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_continued_turn_does_not_reoffer_the_delegation_tool(pool: Pool<Postgres>) {
    const TOOL_RESULT: &str = "approval probe published";
    const REFUSAL: &str = "not allowed for this request";
    let parked_turn_recorder = RequestBodyRecorder::new();
    let continuation_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    // Continuation turn 2: the refusal arrived, answer in prose.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[REFUSAL], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[
                "CONTINUED-RECOVERED-ANSWER",
            ]),
        );
    });
    // Continuation turn 1: delegate anyway, without the offer.
    {
        let recorder = continuation_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[TOOL_RESULT], &[REFUSAL]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                    "call_delegate_after_approval",
                    "delegate_to_assistant",
                    json!({
                        "assistant_id": DELEGATE_ASSISTANT_FIXED_ID,
                        "task": "CONTINUED-TASK-BRIEF",
                    }),
                )]),
            );
        });
    }
    // The parked turn: call the approval-gated tool.
    {
        let recorder = parked_turn_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[], &[TOOL_RESULT, REFUSAL]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                    "call_probe",
                    "publish_approval_probe",
                    json!({}),
                )]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.assistants.enabled = true;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        erato::config::McpServerConfig {
            transport_type: "streamable_http".to_string(),
            url: format!("{}/mcp/approval-policy", mock_mcp_base_url()),
            http_headers: None,
            allow_tools: None,
            exclude_tools: vec![],
            wait_tools: vec![],
            authentication: erato::config::McpServerAuthenticationConfig::None,
            max_session_idle_seconds: None,
        },
    );
    app_config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    app_config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    let app_state = test_app_state(app_config, pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    insert_fixed_delegate_assistant(&app_state.db, me.id, "delegate prompt", None).await;
    let server = app_server(app_state.clone());

    let response = submit_with_mentions(
        &server,
        None,
        "mention approval question",
        &[DELEGATE_ASSISTANT_FIXED_ID],
    )
    .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);

    let chat_id =
        Uuid::parse_str(&crate::test_utils::extract_chat_id(&events).expect("chat id")).unwrap();
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(
        erato::db::entity::chats::Entity::find_by_id(chat_id)
            .one(&app_state.db)
            .await
            .unwrap()
            .unwrap()
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );

    // The parked turn was offered the delegation tool.
    let parked_bodies = parked_turn_recorder.bodies();
    assert!(
        parked_bodies
            .iter()
            .any(|body| body.contains("delegate_to_assistant")),
        "the mention-carrying turn offers the delegation tool"
    );

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert!(extract_full_text_answer(&continued_events).contains("CONTINUED-RECOVERED-ANSWER"));

    let continuation_bodies = continuation_recorder.bodies();
    assert_eq!(continuation_bodies.len(), 1);
    assert!(continuation_bodies[0].contains("publish_approval_probe"));
    assert!(
        !continuation_bodies[0].contains("delegate_to_assistant"),
        "the continuation must not re-offer the delegation tool"
    );

    let refused = erato::db::entity::messages::Entity::find_by_id(assistant_message_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("the continued assistant message")
        .raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| part["tool_name"] == "delegate_to_assistant")
        .expect("the refused delegate call")
        .clone();
    assert_eq!(refused["status"], "error");
    assert!(
        refused["output"]["error"]
            .as_str()
            .is_some_and(|error| error.contains(REFUSAL)),
        "Got: {}",
        refused["output"]
    );

    assert!(
        erato::db::entity::chats::Entity::find()
            .filter(erato::db::entity::chats::Column::OriginChatId.eq(chat_id))
            .one(&app_state.db)
            .await
            .unwrap()
            .is_none(),
        "a continued turn must not be able to spawn a delegated run"
    );
}

/// A delegated run is hidden from the listing, so opening one by link has no
/// row to read from: the chat-detail route is where a surface learns what the
/// run is and what it was dispatched with.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_chat_detail_carries_provenance_and_run_parameters(pool: Pool<Postgres>) {
    let (app_state, _llm) = delegation_enabled_state_with_llm(pool).await;
    let server = app_server(app_state.clone());
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();

    let assistant = create_assistant(&server, "Detail Delegate", "prompt").await;
    let origin = create_chat(&server, Some(&assistant)).await;
    server
        .put(&format!("/api/v1beta/me/chats/{origin}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "title_by_user_provided": "Quarterly planning" }))
        .await
        .assert_status_ok();

    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me.id.to_string()),
        &me.id.to_string(),
        Some(Uuid::parse_str(&assistant).unwrap()),
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(Uuid::parse_str(&origin).unwrap()),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: Some(Uuid::parse_str(&assistant).unwrap()),
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        },
        Some(erato::models::chat::TaskSpec {
            expected_output: Some("One number per line.".to_string()),
            constraints: Some("Only the attached figures.".to_string()),
            ..erato::models::chat::TaskSpec::default()
        }),
        "Summarize the numbers".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .unwrap();
    app_state.global_policy_engine.invalidate_data().await;

    let response = server
        .get(&format!("/api/v1beta/me/chats/{}", child.id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let detail = response.json::<Value>();
    assert_eq!(detail["id"], child.id.to_string());
    assert_eq!(detail["title_resolved"], "Summarize the numbers");
    assert_eq!(detail["provenance_kind"], "delegation");
    assert_eq!(detail["origin_chat_id"], origin);
    assert_eq!(detail["origin_chat_title"], "Quarterly planning");
    assert_eq!(detail["origin_assistant_id"], assistant);
    assert_eq!(detail["assistant_id"], assistant);
    assert_eq!(detail["assistant_name"], "Detail Delegate");
    assert_eq!(detail["expected_output"], "One number per line.");
    assert_eq!(detail["constraints"], "Only the attached figures.");
    assert!(detail.get("adopted_at").is_none());
    assert!(detail.get("archived_at").is_none());
    assert_eq!(detail["can_edit"], true);

    // The origin chat itself says nothing about provenance, so a header keyed
    // off these fields renders on the run and nowhere else.
    let origin_detail = server
        .get(&format!("/api/v1beta/me/chats/{origin}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    origin_detail.assert_status_ok();
    let origin_detail = origin_detail.json::<Value>();
    assert!(origin_detail.get("provenance_kind").is_none());
    assert!(origin_detail.get("expected_output").is_none());

    // A chat the user cannot reach is a 404, not an empty shell to render.
    server
        .get(&format!("/api/v1beta/me/chats/{}", Uuid::new_v4()))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status(axum::http::StatusCode::NOT_FOUND);
}

/// Adoption writes the one key it means and leaves a pre-`task` row otherwise
/// as it found it, and that row still reads canonically.
///
/// Nothing migrates these rows eagerly, and adoption is not the exception: it
/// touches `{provenance,adopted_at}` only, so the legacy brief stays where it
/// was written. The lift that makes an old row readable lives at the parse
/// point instead, which is where this asserts it — and which is why a narrow
/// write costs nothing here.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn adoption_of_a_legacy_row_writes_only_the_adoption(pool: Pool<Postgres>) {
    let (app_state, _llm) = delegation_enabled_state_with_llm(pool).await;
    let server = app_server(app_state.clone());

    let assistant = create_assistant(&server, "Legacy Delegate", "prompt").await;
    let origin = create_chat(&server, Some(&assistant)).await;
    let child = create_chat(&server, Some(&assistant)).await;
    let child_id = Uuid::parse_str(&child).unwrap();

    // Seed the row exactly as it would have been written before `task` existed.
    let legacy = json!({
        "assistant_id": assistant,
        "provenance": {
            "kind": "delegation",
            "origin_chat_id": origin,
            "depth": 1,
            "expected_output": "One number per line.",
            "constraints": "Only the attached figures.",
        }
    });
    let mut active: erato::db::entity::chats::ActiveModel =
        erato::db::entity::chats::Entity::find_by_id(child_id)
            .one(&app_state.db)
            .await
            .unwrap()
            .expect("seeded child")
            .into();
    active.assistant_configuration = sea_orm::ActiveValue::Set(Some(legacy));
    sea_orm::ActiveModelTrait::update(active, &app_state.db)
        .await
        .unwrap();

    let seeded = erato::db::entity::chats::Entity::find_by_id(child_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("seeded child");
    erato::models::chat::mark_delegated_run_adopted(&app_state.db, &seeded)
        .await
        .unwrap();

    let adopted = erato::db::entity::chats::Entity::find_by_id(child_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("child");
    let stored = adopted.assistant_configuration.clone().expect("envelope");

    assert!(stored["provenance"]["adopted_at"].is_string());
    assert_eq!(
        stored["provenance"]["expected_output"], "One number per line.",
        "adoption must not rewrite anything but its own key: {stored}"
    );
    assert_eq!(
        stored["provenance"]["constraints"],
        "Only the attached figures."
    );
    assert!(stored.get("task").is_none());
    assert_eq!(stored["assistant_id"], assistant);

    let parsed = erato::models::chat::parse_chat_configuration(&adopted)
        .expect("parse")
        .expect("envelope");
    let task = parsed
        .task
        .expect("the legacy brief must lift into the task spec");
    assert_eq!(
        task.expected_output.as_deref(),
        Some("One number per line.")
    );
    assert_eq!(
        task.constraints.as_deref(),
        Some("Only the attached figures.")
    );
    let provenance = parsed.provenance.expect("provenance");
    assert!(provenance.adopted_at.is_some());
    assert_eq!(
        parsed.assistant_id.map(|id| id.to_string()),
        Some(assistant)
    );
}

/// A task child dispatched on the bare model has no assistant. The row must
/// insert without tripping the `assistant_id` foreign key, resolve to "no
/// assistant" rather than erroring, and still carry its brief and origin
/// everywhere the delegated-run surfaces read them.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn bare_child_row_has_null_assistant_and_resolves_no_assistant(pool: Pool<Postgres>) {
    let (app_state, _llm) = delegation_enabled_state_with_llm(pool).await;
    let server = app_server(app_state.clone());
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();

    let assistant = create_assistant(&server, "Origin Assistant", "prompt").await;
    let origin = create_chat(&server, Some(&assistant)).await;

    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me.id.to_string()),
        &me.id.to_string(),
        // No assistant: this is the bare-model task child.
        None,
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(Uuid::parse_str(&origin).unwrap()),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: Some(Uuid::parse_str(&assistant).unwrap()),
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        },
        Some(erato::models::chat::TaskSpec {
            expected_output: Some("A single number.".to_string()),
            constraints: Some("Use only the attached figures.".to_string()),
            route: erato::models::chat::DelegateRoute::Task,
            ..erato::models::chat::TaskSpec::default()
        }),
        "Count the figures".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .unwrap();
    // The recent-chats listing INNER JOINs the latest message, so a chat with
    // no messages never appears there at all. Give the run its brief the way a
    // real dispatch does.
    erato::models::message::submit_message(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me.id.to_string()),
        &child.id,
        json!({
            "role": "user",
            "content": [{"content_type": "text", "text": "count the figures"}],
            "name": me.id.to_string(),
        }),
        None,
        None,
        None,
        &[],
        None,
        None,
        None,
    )
    .await
    .unwrap();
    app_state.global_policy_engine.invalidate_data().await;

    // The generated column stays NULL, so the foreign key was never evaluated,
    // while the generated origin column is still populated.
    assert!(child.assistant_id.is_none());
    assert_eq!(
        child.origin_chat_id,
        Some(Uuid::parse_str(&origin).unwrap())
    );

    // Resolving the assistant is a clean "none", not an error about a missing
    // assistant row.
    let resolved = erato::models::chat::get_chat_assistant_configuration(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me.id.to_string()),
        &child,
    )
    .await
    .unwrap();
    assert!(resolved.is_none());

    // The detail route omits the assistant but still carries the brief.
    let response = server
        .get(&format!("/api/v1beta/me/chats/{}", child.id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let detail = response.json::<Value>();
    assert!(detail.get("assistant_id").is_none());
    assert!(detail.get("assistant_name").is_none());
    assert_eq!(detail["provenance_kind"], "delegation");
    assert_eq!(detail["origin_chat_id"], origin);
    assert_eq!(detail["expected_output"], "A single number.");
    assert_eq!(detail["constraints"], "Use only the attached figures.");

    // And the listing shows it with no assistant name rather than skipping it.
    let listing = recent_chats(&server, "?include_delegated=true").await;
    let row = listing["chats"]
        .as_array()
        .expect("chats array")
        .iter()
        .find(|row| row["id"] == child.id.to_string())
        .expect("the bare child is listed");
    assert!(row.get("assistant_name").is_none() || row["assistant_name"].is_null());
}

/// The archive cascade can archive a run its owner never touched, and taking
/// a run over is durable — both are states the header has to be able to read.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_chat_detail_reports_adopted_and_archived_runs(pool: Pool<Postgres>) {
    let (app_state, _llm) = delegation_enabled_state_with_llm(pool).await;
    let server = app_server(app_state.clone());
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();

    let assistant = create_assistant(&server, "Adopted Delegate", "prompt").await;
    let origin = create_chat(&server, Some(&assistant)).await;
    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me.id.to_string()),
        &me.id.to_string(),
        Some(Uuid::parse_str(&assistant).unwrap()),
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(Uuid::parse_str(&origin).unwrap()),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: None,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: None,
            result_delivery: None,
            retry_of: None,
        },
        None,
        "Adoptable run".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .unwrap();
    app_state.global_policy_engine.invalidate_data().await;

    // Writing into the finished run adopts it.
    submit_message(
        &server,
        &child.id.to_string(),
        None,
        "the owner takes it over",
        vec![],
    )
    .await;

    // Archiving the origin cascades onto the run.
    server
        .post(&format!("/api/v1beta/chats/{origin}/archive"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({}))
        .await
        .assert_status_ok();

    let detail = server
        .get(&format!("/api/v1beta/me/chats/{}", child.id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    detail.assert_status_ok();
    let detail = detail.json::<Value>();
    assert_eq!(detail["provenance_kind"], "delegation");
    assert!(detail["adopted_at"].is_string());
    assert!(detail["archived_at"].is_string());
}

/// Build an app state with the task route enabled and a planning facet that
/// selects `erato/delegate_task`. Submits name the facet through
/// [`submit_with_facets`]; `default_selected_facets` is a frontend hint and
/// selects nothing server-side.
async fn task_enabled_state(
    pool: Pool<Postgres>,
    mocks: MockSet,
    planning_allowlist: &[&str],
) -> (erato::state::AppState, mocktail::server::MockServer) {
    task_state(pool, mocks, planning_allowlist, |_| {}).await
}

/// As above, with a last word on the config before the state is built.
async fn task_state(
    pool: Pool<Postgres>,
    mocks: MockSet,
    planning_allowlist: &[&str],
    tweak: impl FnOnce(&mut erato::config::AppConfig),
) -> (erato::state::AppState, mocktail::server::MockServer) {
    let (mut app_config, server) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.delegation.tasks.enabled = true;
    app_config.facets.facets.insert(
        "plan".to_string(),
        erato::config::FacetConfig {
            display_name: "Plan & delegate".to_string(),
            icon: None,
            additional_system_prompt: None,
            tool_call_allowlist: planning_allowlist.iter().map(|s| s.to_string()).collect(),
            model_settings: Default::default(),
            disable_facet_prompt_template: true,
            hidden: false,
            hidden_always_active_for_platform: None,
            delegation: None,
        },
    );
    tweak(&mut app_config);
    let app_state = test_app_state(app_config, pool).await;
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    (app_state, server)
}

/// Submit a message with an explicit facet selection.
async fn submit_with_facets(
    server: &TestServer,
    chat_id: &str,
    text: &str,
    selected_facet_ids: &[&str],
) -> Vec<Event> {
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": chat_id,
            "user_message": text,
            "input_files_ids": [],
            "selected_facet_ids": selected_facet_ids,
        }))
        .await;
    response.assert_status_ok();
    parse_sse_events(&response)
}

/// The task tool appears only when the feature is on AND a selected facet's
/// allowlist asks for it. Both halves are load-bearing: the feature gate
/// alone would hand the tool to every deployment that flips the flag, and the
/// allowlist alone would hand it out before the feature is meant to exist.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn task_tool_is_offered_only_when_enabled_and_selected(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["offer probe answer"]),
            );
        });
    }

    // Enabled, and a selected facet asks for the tool.
    let (app_state, _llm) =
        task_enabled_state(pool, mocks, &["erato/delegate_task", "web-search-mcp/*"]).await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    submit_with_facets(&server, &chat, "offer probe question", &["plan"]).await;

    assert!(
        recorder
            .bodies()
            .iter()
            .any(|body| body.contains("delegate_task")),
        "the task tool must be offered when enabled and selected"
    );
}

/// A turn that was planning tasks when one of its calls hit the approval gate
/// keeps the task offer when it is resumed. Dropping it mid-turn leaves the
/// model with a half-made plan and no way to finish it, so it answers around
/// the work it was told to delegate. The mention offer stays unreplayed — that
/// one is aimed at assistants the user named in a message this continuation is
/// not part of.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn task_route_continuation_reoffers_delegate_task(pool: Pool<Postgres>) {
    task_route_continuation_task_offer(pool, false).await;
}

/// A turn reacting to a delivered task result is deliberately never offered the
/// task tool — a delivery reaction that could dispatch a child of its own turns
/// one delivery into a chain nobody asked for. Parking it on an approval must
/// not be the way it gets the offer back, so the continuation reproduces the
/// suppression the user path applies, not just the slot check.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn task_result_reaction_continuation_withholds_delegate_task(pool: Pool<Postgres>) {
    task_route_continuation_task_offer(pool, true).await;
}

/// A planning turn that also has to pass an MCP approval gate: the tool set the
/// park is taken from, and the one the continuation is offered again.
fn gate_mock_mcp_tools_on_approval(config: &mut erato::config::AppConfig) {
    config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        erato::config::McpServerConfig {
            transport_type: "streamable_http".to_string(),
            url: format!("{}/mcp/approval-policy", mock_mcp_base_url()),
            http_headers: None,
            allow_tools: None,
            exclude_tools: vec![],
            wait_tools: vec![],
            authentication: erato::config::McpServerAuthenticationConfig::None,
            max_session_idle_seconds: None,
        },
    );
    config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
}

async fn task_route_continuation_task_offer(pool: Pool<Postgres>, reacts_to_task_result: bool) {
    const TOOL_RESULT: &str = "approval probe published";
    let continuation_recorder = RequestBodyRecorder::new();

    let mut mocks = MockSet::new();
    {
        let recorder = continuation_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[TOOL_RESULT], &[]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["PLAN-CONTINUED-ANSWER"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[TOOL_RESULT]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_probe",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        gate_mock_mcp_tools_on_approval,
    )
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, "plan and publish the probe", &["plan"]).await;
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    if reacts_to_task_result {
        // The reaction route parks the same way; what it cannot do in a test is
        // arrive here, so the one field the offer decision reads is seeded.
        let row = erato::db::entity::prelude::Messages::find_by_id(assistant_message_id)
            .one(&app_state.db)
            .await
            .unwrap()
            .unwrap();
        let mut parameters = row.generation_parameters.clone().unwrap();
        parameters["initiator"] = json!("task_result");
        let mut active: erato::db::entity::messages::ActiveModel = row.into();
        active.generation_parameters = ActiveValue::Set(Some(parameters));
        active
            .update(&app_state.db)
            .await
            .expect("the reaction initiator persists");
    }

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert!(extract_full_text_answer(&continued_events).contains("PLAN-CONTINUED-ANSWER"));

    let bodies = continuation_recorder.bodies();
    assert_eq!(bodies.len(), 1);
    assert_eq!(
        bodies[0].contains("delegate_task"),
        !reacts_to_task_result,
        "the task route keeps its offer across the park; a delivery reaction does not"
    );
    assert!(
        !bodies[0].contains("delegate_to_assistant"),
        "the mention offer is still not replayed"
    );
}

/// Offering the tool is half of it: the continuation also has to be able to
/// DISPATCH one. The re-offered turn runs with a dispatch context built here
/// rather than inherited from the user path, so a model that takes the offer
/// would be the first thing to discover a context that cannot serve it — and
/// the anchor it carries is the user row of the parked turn, not the tip of the
/// conversation, because that is what a child's provenance is measured against.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn task_route_continuation_dispatches_delegate_task(pool: Pool<Postgres>) {
    const TOOL_RESULT: &str = "approval probe published";
    const USER_MESSAGE: &str = "plan and publish the probe";
    const BRIEF: &str = "RESUMED-BRIEF-SENTINEL: count the figures";
    const CHILD_ANSWER: &str = "RESUMED-CHILD-ANSWER";

    let mut mocks = MockSet::new();
    // The child's own turn: it never sees the conversation that planned it.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[BRIEF], &[USER_MESSAGE]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[CHILD_ANSWER]),
        );
    });
    // The parent, once the child has answered.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[CHILD_ANSWER, USER_MESSAGE], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-AFTER-CHILD"]),
        );
    });
    // The continuation: it takes the re-offered tool.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[TOOL_RESULT, USER_MESSAGE],
                &[CHILD_ANSWER],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_resumed_task",
                "delegate_task",
                json!({
                    "task": BRIEF,
                    "expected_output": "A single number.",
                    "facet_ids": ["plan"],
                }),
            )]),
        );
    });
    // The parked turn.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[USER_MESSAGE], &[TOOL_RESULT]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_probe",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        gate_mock_mcp_tools_on_approval,
    )
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let chat_id = Uuid::parse_str(&chat).unwrap();
    let events = submit_with_facets(&server, &chat, USER_MESSAGE, &["plan"]).await;
    let assistant_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let parked = erato::db::entity::prelude::Messages::find_by_id(assistant_message_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("the parked assistant row");
    let origin_user_message_id = parked
        .previous_message_id
        .expect("the parked turn has a user row to anchor a child to");

    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": assistant_message_id,
            "decision": "approve",
        }))
        .await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    let output = find_tool_call_update_output(&continued_events, "delegate_task");
    assert_eq!(
        output["status"], "completed",
        "the resumed turn's dispatch must actually run: {output}"
    );
    assert!(
        output["result"]
            .as_str()
            .is_some_and(|text| text.contains(CHILD_ANSWER)),
        "the child's answer comes back on the tool part: {output}"
    );
    assert!(extract_full_text_answer(&continued_events).contains("PARENT-AFTER-CHILD"));

    let child_chat = delegated_child_chat(&app_state.db, chat_id).await;
    let configuration = child_chat
        .assistant_configuration
        .expect("the child carries a configuration");
    assert_eq!(configuration["task"]["route"], "task");
    assert_eq!(
        configuration["provenance"]["origin_chat_id"],
        json!(chat_id)
    );
    assert_eq!(
        configuration["provenance"]["origin_message_id"],
        json!(origin_user_message_id),
        "a child dispatched by a resumed turn is anchored at that turn's user row: {configuration}"
    );
}

/// The same turn, with the feature off: nothing is offered even though the
/// facet still names the tool.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn task_tool_is_not_offered_while_the_feature_is_off(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["gate off answer"]),
            );
        });
    }
    // The gate is off, the facet selection stays in place.
    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "web-search-mcp/*"],
        |config| config.delegation.tasks.enabled = false,
    )
    .await;

    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    submit_with_facets(&server, &chat, "gate off question", &["plan"]).await;

    for body in recorder.bodies() {
        assert!(
            !body.contains("delegate_task"),
            "the task tool must not be offered while the feature is off"
        );
    }
}

/// Enabled, but no selected facet asks for the tool: still not offered. A
/// deployment turning the feature on does not thereby hand the tool to every
/// conversation.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn task_tool_is_not_offered_without_an_allowlist_selecting_it(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["unselected answer"]),
            );
        });
    }
    // The facet exists and is selected, but its allowlist names other tools.
    let (app_state, _llm) = task_enabled_state(pool, mocks, &["web-search-mcp/*"]).await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    submit_with_facets(&server, &chat, "unselected question", &["plan"]).await;

    for body in recorder.bodies() {
        assert!(
            !body.contains("delegate_task"),
            "the task tool must not be offered unless an allowlist selects it"
        );
    }
}

/// The happy path: the model plans a sub-task, the child runs it, and the
/// answer comes back into the same turn as the tool's result. The child is a
/// real chat the user can open, and it is offered neither delegation tool —
/// depth stays at one.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_task_run_returns_its_answer_into_the_origin_turn(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let child_recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    // The child's turn: recognised by the brief, answers in prose. The
    // parent's continuation also carries the brief — it replays the tool
    // call's own input — so the parent's user message is what tells them
    // apart: a task child never sees the conversation that planned it.
    {
        let child_recorder = child_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["TASK-BRIEF-SENTINEL"],
                    &["task parent question"],
                ))
                .matcher(child_recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["CHILD-TASK-ANSWER"]),
            );
        });
    }
    // The parent's continuation, once the result is in.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-TASK-ANSWER", "task parent question"],
                &[],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-TASK-FINAL"]),
        );
    });
    // The parent's first turn: plans the sub-task.
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["task parent question"],
                    &["TASK-BRIEF-SENTINEL", "CHILD-TASK-ANSWER"],
                ))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                    "call_task_1",
                    "delegate_task",
                    json!({
                        "task": "TASK-BRIEF-SENTINEL: count the figures",
                        "expected_output": "A single number.",
                        // Scope the child to the PLANNING facet itself. Without
                        // this the child has no allowlist and the task tool is
                        // withheld for that reason, so the depth assertion
                        // below would be made against a case that never
                        // exercised the depth guard at all.
                        "facet_ids": ["plan"],
                    }),
                )]),
            );
        });
    }

    let (app_state, _llm) =
        task_enabled_state(pool, mocks, &["erato/delegate_task", "web-search-mcp/*"]).await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, "task parent question", &["plan"]).await;

    let output = find_tool_call_update_output(&events, "delegate_task");
    assert_eq!(output["status"], "completed");
    assert!(
        output["result"]
            .as_str()
            .is_some_and(|text| text.contains("CHILD-TASK-ANSWER")),
        "the child's answer must come back on the tool part: {output}"
    );
    // The two ids the frontend and later parts of the level key off.
    assert!(output["child_run_id"].is_string());
    assert_eq!(output["parent_tool_call_id"], "call_task_1");
    assert!(extract_full_text_answer(&events).contains("PARENT-TASK-FINAL"));

    // The child is a real chat, marked as a task run, and never offered a
    // delegation tool of its own.
    let child_chat = delegated_child_chat(&app_state.db, Uuid::parse_str(&chat).unwrap()).await;
    let configuration = child_chat
        .assistant_configuration
        .expect("child configuration");
    assert_eq!(configuration["task"]["route"], "task");
    // Delegated work does not nest: the child is offered neither route, even
    // though it carries the very facet whose allowlist selects the task tool.
    // The count is asserted first — a filter that matched nothing would make
    // the loop vacuous and quietly certify nothing at all.
    let child_bodies = child_recorder.bodies();
    assert_eq!(
        child_bodies.len(),
        1,
        "expected exactly one recorded child turn, got {}",
        child_bodies.len()
    );
    for body in &child_bodies {
        assert!(
            body.contains("TASK-BRIEF-SENTINEL"),
            "the recorded turn should be the child's"
        );
        assert!(
            !body.contains("delegate_task"),
            "a task child must not be offered the task tool"
        );
        assert!(
            !body.contains("delegate_to_assistant"),
            "a task child must not be offered the mention tool"
        );
    }
}

/// A capability the offer did not list is refused, whatever the model writes
/// in the arguments. The schema's enum is advisory — a model can emit
/// anything — so the list is what decides, not the shape of the call.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_task_cannot_ask_for_a_capability_that_was_not_offered(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // Recovery turn, once the refusal is in.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["was not offered"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["TASK-REFUSAL-RECOVERED"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["unoffered facet question"],
                &["was not offered"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_task_bad",
                "delegate_task",
                json!({
                    "task": "should never run",
                    "facet_ids": ["a_facet_nobody_offered"],
                }),
            )]),
        );
    });

    let (app_state, _llm) =
        task_enabled_state(pool, mocks, &["erato/delegate_task", "web-search-mcp/*"]).await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, "unoffered facet question", &["plan"]).await;

    let output = find_tool_call_update_output(&events, "delegate_task");
    assert_eq!(output["status"], "error");
    // The CALL is refused, never the turn.
    assert!(extract_full_text_answer(&events).contains("TASK-REFUSAL-RECOVERED"));
}

/// `max_tasks_per_turn` counts ATTEMPTS, not successful dispatches. A model
/// that keeps retrying a refused call must run out of budget, or nothing
/// bounds it but wall-clock: the built-in tools are exempt from the per-task
/// budgets, so a refused call is otherwise free.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_refused_task_still_spends_one_of_the_turns_attempts(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["the most allowed"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["TASK-CAP-RECOVERED"]),
        );
    });
    // Both calls are empty-task refusals, so neither dispatches anything —
    // yet the second must still be turned away by the per-turn cap.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["attempt cap question"],
                &["the most allowed"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[
                ("call_task_a", "delegate_task", json!({ "task": "   " })),
                ("call_task_b", "delegate_task", json!({ "task": "   " })),
            ]),
        );
    });

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "web-search-mcp/*"],
        |config| config.delegation.tasks.max_tasks_per_turn = 1,
    )
    .await;

    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, "attempt cap question", &["plan"]).await;

    let refusals: Vec<String> = events
        .iter()
        .filter_map(|event| serde_json::from_str::<serde_json::Value>(event.data.as_str()).ok())
        .filter(|frame| frame["tool_name"] == "delegate_task")
        .filter_map(|frame| {
            frame["output"]["error"]
                .as_str()
                .map(std::string::ToString::to_string)
        })
        .collect();
    assert!(
        refusals
            .iter()
            .any(|error| error.contains("the most allowed")),
        "the second attempt must be refused by the per-turn cap: {refusals:?}"
    );
    assert!(extract_full_text_answer(&events).contains("TASK-CAP-RECOVERED"));
}

/// A task child that runs out of SERVER tool calls refuses the call and
/// finishes in prose, and its envelope says the answer is partial rather than
/// pretending the run went cleanly — or that it failed.
///
/// The child is given a real MCP tool and a server budget of zero, so the
/// refusal can only come from the budget: the call is turned away before
/// anything is dispatched.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_task_that_spends_its_server_budget_finishes_with_a_partial_answer(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // The child, once its call has been refused: wraps up in prose.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["all of its tool calls that run on the server"],
                &["budget parent question"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["CHILD-PARTIAL-ANSWER"]),
        );
    });
    // The child's first turn: reaches for a server tool it cannot afford.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["BUDGET-BRIEF-SENTINEL"],
                &[
                    "budget parent question",
                    "all of its tool calls that run on the server",
                ],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_child_mcp",
                "publish_approval_probe",
                json!({}),
            )]),
        );
    });
    // The parent's continuation.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CHILD-PARTIAL-ANSWER", "budget parent question"],
                &[],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-BUDGET-FINAL"]),
        );
    });
    // The parent plans the task.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["budget parent question"],
                &["BUDGET-BRIEF-SENTINEL", "CHILD-PARTIAL-ANSWER"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_task_budget",
                "delegate_task",
                json!({ "task": "BUDGET-BRIEF-SENTINEL: look it up" }),
            )]),
        );
    });

    // No server tool calls at all: the cheapest way to prove the budget is
    // consulted before anything is dispatched. Approval stays off so the
    // refusal can only be the budget.
    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_budget/*"],
        |config| {
            config.delegation.tasks.max_server_tool_calls_per_task = 0;
            config.mcp_servers.insert(
                "mock_mcp_budget".to_string(),
                erato::config::McpServerConfig {
                    transport_type: "streamable_http".to_string(),
                    url: format!("{}/mcp/approval-policy", mock_mcp_base_url()),
                    http_headers: None,
                    allow_tools: None,
                    exclude_tools: vec![],
                    wait_tools: vec![],
                    authentication: erato::config::McpServerAuthenticationConfig::None,
                    max_session_idle_seconds: None,
                },
            );
            config.mcp_server_permissions.rules.insert(
                "allow-mock-mcp-budget".to_string(),
                erato::config::McpServerPermissionRule::AllowAll {
                    mcp_server_ids: vec!["mock_mcp_budget".to_string()],
                },
            );
        },
    )
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, "budget parent question", &["plan"]).await;

    let output = find_tool_call_update_output(&events, "delegate_task");
    // Completed, not cancelled: the text is real and the child chat is
    // adoptable — calling it a failure would tell the model to discard it.
    assert_eq!(output["status"], "completed");
    assert_eq!(output["reason"], "cap_exceeded");
    assert!(
        output["result"]
            .as_str()
            .is_some_and(|text| text.contains("CHILD-PARTIAL-ANSWER")),
        "the partial answer must still come back: {output}"
    );
    assert!(extract_full_text_answer(&events).contains("PARENT-BUDGET-FINAL"));
}

/// A task that is still running is already on disk, at the slot it will settle
/// into. Without the commit at launch the assistant row stays `"content": []`
/// until the turn ends, so anyone opening the chat mid-run — a reload, a second
/// device, the sidebar — sees a message with no sign of work that is underway.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_running_task_is_persisted_at_its_slot_before_it_finishes(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // The child stalls, so the parent's turn is parked on the await while the
    // test reads the row.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["SLOW-TASK-BRIEF"], &[]));
        mock_llm_sse_response(
            then,
            vec![
                BodyAction::Delay(std::time::Duration::from_secs(30)),
                BodyAction::Bytes("data: [DONE]\n\n".into()),
            ],
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["slow task question"],
                &["SLOW-TASK-BRIEF"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_slow_task",
                "delegate_task",
                json!({ "task": "SLOW-TASK-BRIEF: take your time", "facet_ids": ["plan"] }),
            )]),
        );
    });

    let (app_state, _llm) = task_state(pool, mocks, &["erato/delegate_task"], |config| {
        // Short enough that the parent turn ends on its own once the row has
        // been read, rather than the test waiting out a 30 s stall.
        config.delegation.run_timeout_seconds = 5;
    })
    .await;

    // Real TCP server so the read can run concurrently with the stream.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();
    let app: Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{server_addr}");
    let create_response = client
        .post(format!("{base_url}/api/v1beta/me/chats"))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert!(create_response.status().is_success());
    let chat_id = create_response.json::<serde_json::Value>().await.unwrap()["chat_id"]
        .as_str()
        .unwrap()
        .to_string();

    let streaming = tokio::spawn({
        let client = client.clone();
        let base_url = base_url.clone();
        let chat_id = chat_id.clone();
        async move {
            client
                .post(format!("{base_url}/api/v1beta/me/messages/submitstream"))
                .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
                .json(&json!({
                    "existing_chat_id": chat_id,
                    "user_message": "slow task question",
                    "input_files_ids": [],
                    "selected_facet_ids": ["plan"],
                }))
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap()
        }
    });

    // Poll the durable row while the child is stalled.
    let mut placeholder = None;
    for _ in 0..40 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let messages = client
            .get(format!("{base_url}/api/v1beta/chats/{chat_id}/messages"))
            .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
            .send()
            .await
            .unwrap()
            .json::<serde_json::Value>()
            .await
            .unwrap();
        let found = messages["messages"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|message| message["content"].as_array().into_iter().flatten())
            .find(|part| part["content_type"] == "tool_use" && part["tool_name"] == "delegate_task")
            .cloned();
        if let Some(part) = found
            && part["status"] == "in_progress"
        {
            placeholder = Some(part);
            break;
        }
    }

    let placeholder = placeholder.expect("the running task must be on disk before it settles");
    assert_eq!(
        placeholder["output"]["status"], "working",
        "a reserved slot always carries a status, or history replay sees a call with no answer: {placeholder}"
    );
    assert!(
        placeholder["output"]["child_run_id"].is_string(),
        "the placeholder names the child it is waiting on: {placeholder}"
    );

    streaming.await.unwrap();

    // The same slot now holds the outcome, and nothing was appended beside it.
    let messages = client
        .get(format!("{base_url}/api/v1beta/chats/{chat_id}/messages"))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap();
    let task_parts: Vec<serde_json::Value> = messages["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|message| message["content"].as_array().into_iter().flatten())
        .filter(|part| part["content_type"] == "tool_use" && part["tool_name"] == "delegate_task")
        .cloned()
        .collect();
    assert_eq!(
        task_parts.len(),
        1,
        "the slot is overwritten, never appended beside: {task_parts:?}"
    );
    assert_ne!(
        task_parts[0]["status"], "in_progress",
        "no slot may be left running once the turn is over: {:?}",
        task_parts[0]
    );
    assert_eq!(task_parts[0]["output"]["status"], "cancelled");
    assert_eq!(task_parts[0]["output"]["reason"], "timeout");
}

/// The index a task call announces is the index it settles at. The frontend
/// splices a proposal in at `content_index` and then matches updates by
/// `tool_call_id`, so a settle that appended instead of overwriting would
/// leave the running placeholder on screen next to its own result.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_task_settles_at_the_index_it_announced(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["INDEX-TASK-BRIEF"], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["INDEX-CHILD-ANSWER"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["INDEX-CHILD-ANSWER"],
                &["INDEX-TASK-BRIEF"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["INDEX-PARENT-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["index task question"],
                &["INDEX-TASK-BRIEF", "INDEX-CHILD-ANSWER"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_index_task",
                "delegate_task",
                json!({ "task": "INDEX-TASK-BRIEF: answer it", "facet_ids": ["plan"] }),
            )]),
        );
    });

    let (app_state, _llm) = task_enabled_state(pool, mocks, &["erato/delegate_task"]).await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, "index task question", &["plan"]).await;

    let index_of = |kind: &str| -> Option<u64> {
        events
            .iter()
            .filter_map(|event| serde_json::from_str::<serde_json::Value>(&event.data).ok())
            .find(|value| value["message_type"] == kind && value["tool_name"] == "delegate_task")
            .and_then(|value| value["content_index"].as_u64())
    };
    let proposed = index_of("tool_call_proposed").expect("the call is announced");
    let updated = index_of("tool_call_update").expect("the call settles");
    assert_eq!(
        proposed, updated,
        "a task call must settle at the slot it reserved"
    );

    let rows = chat_messages_by_created_at(&app_state.db, Uuid::parse_str(&chat).unwrap()).await;
    let assistant_row = rows
        .iter()
        .rev()
        .find(|row| row.raw_message["role"] == "assistant")
        .expect("assistant message row");
    let persisted = assistant_row.raw_message["content"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let task_indices: Vec<usize> = persisted
        .iter()
        .enumerate()
        .filter(|(_, part)| part["tool_name"] == "delegate_task")
        .map(|(index, _)| index)
        .collect();
    assert_eq!(
        task_indices,
        vec![proposed as usize],
        "exactly one persisted part, at the announced index: {persisted:?}"
    );
}

/// Two tasks in one batch run at the same time, and the model is answered in
/// the order it asked. The second child finishes first, which is only possible
/// if the first was not blocking it — and its answer still comes second.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn two_tasks_of_one_batch_overlap_and_answer_in_call_order(pool: Pool<Postgres>) {
    let continuation = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    // The slow child. Its answer is first in call order and last in time.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            // The child never sees the conversation that planned it, which is
            // what tells its turn apart from the parent's continuation — the
            // continuation replays the brief too.
            .matcher(BodyContainsMatcher::new(
                &["SLOW-BRIEF"],
                &["fan out question"],
            ));
        let mut actions = crate::test_utils::build_openai_text_streaming_response(&["ANSWER-SLOW"]);
        actions.insert(0, BodyAction::Delay(std::time::Duration::from_secs(3)));
        mock_llm_sse_response(then, actions);
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["QUICK-BRIEF"],
                &["fan out question"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["ANSWER-QUICK"]),
        );
    });
    {
        let continuation = continuation.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["ANSWER-SLOW", "ANSWER-QUICK"],
                    &[],
                ))
                .matcher(continuation);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["BATCH-FINAL"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["fan out question"],
                &["SLOW-BRIEF", "ANSWER-SLOW"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[
                (
                    "call_slow",
                    "delegate_task",
                    json!({ "task": "SLOW-BRIEF: take your time", "facet_ids": ["plan"] }),
                ),
                (
                    "call_quick",
                    "delegate_task",
                    json!({ "task": "QUICK-BRIEF: be quick", "facet_ids": ["plan"] }),
                ),
            ]),
        );
    });

    let (app_state, _llm) = task_enabled_state(pool, mocks, &["erato/delegate_task"]).await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, "fan out question", &["plan"]).await;

    // Both settled, and the quick one settled first — impossible unless the
    // slow one was being waited on at the same time rather than before.
    let settle_order: Vec<String> = events
        .iter()
        .filter_map(|event| serde_json::from_str::<serde_json::Value>(&event.data).ok())
        .filter(|value| {
            value["message_type"] == "tool_call_update"
                && value["tool_name"] == "delegate_task"
                // Progress frames ride the same event; only the settle counts.
                && value["status"] != "in_progress"
        })
        .filter_map(|value| value["tool_call_id"].as_str().map(str::to_string))
        .collect();
    assert_eq!(
        settle_order,
        vec!["call_quick".to_string(), "call_slow".to_string()],
        "the quick task must settle while the slow one is still running"
    );

    // ... and the model is still answered in the order it asked.
    let body = continuation
        .bodies()
        .into_iter()
        .next()
        .expect("the parent's continuation is recorded");
    let slow_at = body
        .find("ANSWER-SLOW")
        .expect("the slow answer is replayed");
    let quick_at = body
        .find("ANSWER-QUICK")
        .expect("the quick answer is replayed");
    assert!(
        slow_at < quick_at,
        "tool answers must reach the model in call order, not completion order"
    );
    assert!(extract_full_text_answer(&events).contains("BATCH-FINAL"));
}

/// A batch larger than `max_parallel` starts what it may and shows the rest as
/// queued. A queued slot names no child, because none exists yet.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_batch_beyond_max_parallel_waits_for_a_free_slot(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["WAVE-BRIEF"], &[]));
        mock_llm_sse_response(
            then,
            vec![
                BodyAction::Delay(std::time::Duration::from_secs(30)),
                BodyAction::Bytes("data: [DONE]\n\n".into()),
            ],
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["wave question"],
                &["WAVE-BRIEF"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[
                (
                    "call_wave_1",
                    "delegate_task",
                    json!({ "task": "WAVE-BRIEF one", "facet_ids": ["plan"] }),
                ),
                (
                    "call_wave_2",
                    "delegate_task",
                    json!({ "task": "WAVE-BRIEF two", "facet_ids": ["plan"] }),
                ),
                (
                    "call_wave_3",
                    "delegate_task",
                    json!({ "task": "WAVE-BRIEF three", "facet_ids": ["plan"] }),
                ),
            ]),
        );
    });

    let (app_state, _llm) = task_state(pool, mocks, &["erato/delegate_task"], |config| {
        config.delegation.tasks.max_parallel = 1;
        config.delegation.run_timeout_seconds = 4;
    })
    .await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();
    let app: Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{server_addr}");
    let create_response = client
        .post(format!("{base_url}/api/v1beta/me/chats"))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert!(create_response.status().is_success());
    let chat_id = create_response.json::<serde_json::Value>().await.unwrap()["chat_id"]
        .as_str()
        .unwrap()
        .to_string();

    let streaming = tokio::spawn({
        let client = client.clone();
        let base_url = base_url.clone();
        let chat_id = chat_id.clone();
        async move {
            client
                .post(format!("{base_url}/api/v1beta/me/messages/submitstream"))
                .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
                .json(&json!({
                    "existing_chat_id": chat_id,
                    "user_message": "wave question",
                    "input_files_ids": [],
                    "selected_facet_ids": ["plan"],
                }))
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap()
        }
    });

    let task_parts = |body: serde_json::Value| -> Vec<serde_json::Value> {
        body["messages"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|message| message["content"].as_array().into_iter().flatten())
            .filter(|part| {
                part["content_type"] == "tool_use" && part["tool_name"] == "delegate_task"
            })
            .cloned()
            .collect()
    };

    let mut observed = None;
    for _ in 0..40 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let parts = task_parts(
            client
                .get(format!("{base_url}/api/v1beta/chats/{chat_id}/messages"))
                .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
                .send()
                .await
                .unwrap()
                .json::<serde_json::Value>()
                .await
                .unwrap(),
        );
        if parts.len() == 3
            && parts
                .iter()
                .any(|part| part["output"]["status"] == "working")
        {
            observed = Some(parts);
            break;
        }
    }

    let parts = observed.expect("all three slots are reserved while the first runs");
    let working = parts
        .iter()
        .filter(|part| part["output"]["status"] == "working")
        .count();
    let queued = parts
        .iter()
        .filter(|part| part["output"]["status"] == "queued")
        .count();
    assert_eq!(working, 1, "only one task may run at a time: {parts:?}");
    assert_eq!(queued, 2, "the rest of the batch waits: {parts:?}");
    assert!(
        parts
            .iter()
            .filter(|part| part["output"]["status"] == "queued")
            .all(|part| part["output"]["child_run_id"].is_null()),
        "a queued slot names no child, because none exists: {parts:?}"
    );

    streaming.await.unwrap();

    let parts = task_parts(
        client
            .get(format!("{base_url}/api/v1beta/chats/{chat_id}/messages"))
            .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
            .send()
            .await
            .unwrap()
            .json::<serde_json::Value>()
            .await
            .unwrap(),
    );
    assert_eq!(parts.len(), 3, "one slot per call, still: {parts:?}");
    assert!(
        parts.iter().all(|part| part["status"] != "in_progress"),
        "every slot settles before the turn ends: {parts:?}"
    );
    let child_ids: std::collections::HashSet<String> = parts
        .iter()
        .filter_map(|part| part["output"]["child_run_id"].as_str().map(str::to_string))
        .collect();
    assert_eq!(
        child_ids.len(),
        3,
        "each queued call eventually got its own child: {parts:?}"
    );
}

/// Stopping a turn settles every slot, including the ones that never started.
/// A cancelled run names the child it cancelled; a call that never got a slot
/// names nothing, and that absence is how the two are told apart.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn stopping_a_batch_settles_the_queued_calls_without_a_child(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["STOP-BRIEF"],
                &["stop batch question"],
            ));
        mock_llm_sse_response(
            then,
            vec![
                BodyAction::Delay(std::time::Duration::from_secs(30)),
                BodyAction::Bytes("data: [DONE]\n\n".into()),
            ],
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["stop batch question"],
                &["STOP-BRIEF"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[
                (
                    "call_stop_1",
                    "delegate_task",
                    json!({ "task": "STOP-BRIEF one", "facet_ids": ["plan"] }),
                ),
                (
                    "call_stop_2",
                    "delegate_task",
                    json!({ "task": "STOP-BRIEF two", "facet_ids": ["plan"] }),
                ),
            ]),
        );
    });

    let (app_state, _llm) = task_state(pool, mocks, &["erato/delegate_task"], |config| {
        config.delegation.tasks.max_parallel = 1;
    })
    .await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();
    let app: Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{server_addr}");
    let create_response = client
        .post(format!("{base_url}/api/v1beta/me/chats"))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert!(create_response.status().is_success());
    let chat_id = create_response.json::<serde_json::Value>().await.unwrap()["chat_id"]
        .as_str()
        .unwrap()
        .to_string();

    let streaming = tokio::spawn({
        let client = client.clone();
        let base_url = base_url.clone();
        let chat_id = chat_id.clone();
        async move {
            client
                .post(format!("{base_url}/api/v1beta/me/messages/submitstream"))
                .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
                .json(&json!({
                    "existing_chat_id": chat_id,
                    "user_message": "stop batch question",
                    "input_files_ids": [],
                    "selected_facet_ids": ["plan"],
                }))
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap()
        }
    });

    // Wait until the first child is genuinely running, so the abort lands on a
    // batch with one run in flight and one still queued.
    for _ in 0..40 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let running = client
            .get(format!("{base_url}/api/v1beta/chats/{chat_id}/messages"))
            .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
            .send()
            .await
            .unwrap()
            .json::<serde_json::Value>()
            .await
            .unwrap()["messages"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|message| message["content"].as_array().into_iter().flatten())
            .any(|part| part["output"]["status"] == "working");
        if running {
            break;
        }
    }

    let abort_response = client
        .post(format!("{base_url}/api/v1beta/me/messages/abortstream"))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .json(&json!({ "chat_id": chat_id }))
        .send()
        .await
        .unwrap();
    assert!(abort_response.status().is_success());

    tokio::time::timeout(std::time::Duration::from_secs(30), streaming)
        .await
        .expect("the turn ends after the abort")
        .unwrap();

    let parts: Vec<serde_json::Value> = client
        .get(format!("{base_url}/api/v1beta/chats/{chat_id}/messages"))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap()["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|message| message["content"].as_array().into_iter().flatten())
        .filter(|part| part["content_type"] == "tool_use" && part["tool_name"] == "delegate_task")
        .cloned()
        .collect();

    assert_eq!(parts.len(), 2, "both calls keep their slots: {parts:?}");
    assert!(
        parts.iter().all(|part| part["status"] != "in_progress"),
        "a stopped turn leaves nothing running: {parts:?}"
    );
    for part in &parts {
        assert_eq!(part["output"]["status"], "cancelled", "{part}");
        assert_eq!(part["output"]["reason"], "parent_abort", "{part}");
    }
    let started = parts
        .iter()
        .filter(|part| !part["output"]["child_run_id"].is_null())
        .count();
    assert_eq!(
        started, 1,
        "exactly one call got a child before the stop: {parts:?}"
    );
}

/// A turn that runs out of tool calls while tasks are in flight still settles
/// them. The cap ends the turn with an error, as it always has — but the
/// children it already started are its responsibility, and abandoning them
/// leaves their slots reading "working" with nothing left to ever write the
/// outcome.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_batch_cut_short_by_the_tool_call_cap_still_settles_its_children(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["CAP-BRIEF"],
                &["cap batch question"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["CAP-CHILD-ANSWER"]),
        );
    });
    // Two task calls and a third call that trips the cap, all in one batch.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["cap batch question"],
                &["CAP-BRIEF"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[
                (
                    "call_cap_1",
                    "delegate_task",
                    json!({ "task": "CAP-BRIEF one", "facet_ids": ["plan"] }),
                ),
                (
                    "call_cap_2",
                    "delegate_task",
                    json!({ "task": "CAP-BRIEF two", "facet_ids": ["plan"] }),
                ),
            ]),
        );
    });

    let (app_state, _llm) = task_state(pool, mocks, &["erato/delegate_task"], |config| {
        // One call allowed: the first task is launched, the second trips the
        // cap and ends the turn while the first is still in flight.
        config.generation.max_tool_calls_per_message = 1;
    })
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let _events = submit_with_facets(&server, &chat, "cap batch question", &["plan"]).await;

    let rows = chat_messages_by_created_at(&app_state.db, Uuid::parse_str(&chat).unwrap()).await;
    let parts: Vec<serde_json::Value> = rows
        .iter()
        .flat_map(|row| row.raw_message["content"].as_array().into_iter().flatten())
        .filter(|part| part["tool_name"] == "delegate_task")
        .cloned()
        .collect();

    assert!(
        !parts.is_empty(),
        "the launched task keeps its slot even though the turn failed"
    );
    assert!(
        parts.iter().all(|part| part["status"] != "in_progress"),
        "no child may be abandoned mid-flight by the cap: {parts:?}"
    );
    assert!(
        parts
            .iter()
            .all(|part| part["output"]["status"] != "working"),
        "a slot left reading 'working' has nothing left to settle it: {parts:?}"
    );
}

/// An approval that interrupts a batch must not reach disk until the batch has
/// settled. Every task that settles rewrites the whole message, so an approval
/// part parked at the tail makes the durable row look like a parked turn while
/// children are still running — and a continuation reading that row would start
/// a second generation on it.
///
/// The invariant is about the INTERMEDIATE state, so this reads the row while
/// the turn is still going.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_approval_never_reaches_disk_beside_a_running_task(pool: Pool<Postgres>) {
    const TOOL: &str = "read_approval_fixture";
    let mut mocks = MockSet::new();
    // Two children with different lifetimes: the quick one settles — and so
    // commits the whole message — while the slow one is still running. That
    // commit is what would publish a held-back approval part too early.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["APPROVAL-BRIEF-QUICK"],
                &["approval batch question"],
            ));
        let mut actions =
            crate::test_utils::build_openai_text_streaming_response(&["APPROVAL-QUICK-ANSWER"]);
        actions.insert(0, BodyAction::Delay(std::time::Duration::from_secs(1)));
        mock_llm_sse_response(then, actions);
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["APPROVAL-BRIEF-SLOW"],
                &["approval batch question"],
            ));
        let mut actions =
            crate::test_utils::build_openai_text_streaming_response(&["APPROVAL-SLOW-ANSWER"]);
        actions.insert(0, BodyAction::Delay(std::time::Duration::from_secs(6)));
        mock_llm_sse_response(then, actions);
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["approval batch question"],
                &["APPROVAL-BRIEF-QUICK"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[
                (
                    "call_appr_quick",
                    "delegate_task",
                    json!({ "task": "APPROVAL-BRIEF-QUICK", "facet_ids": ["plan"] }),
                ),
                (
                    "call_appr_slow",
                    "delegate_task",
                    json!({ "task": "APPROVAL-BRIEF-SLOW", "facet_ids": ["plan"] }),
                ),
                ("call_appr_mcp", TOOL, json!({})),
            ]),
        );
    });

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        |config| {
            config
                .mcp_servers
                .insert("mock_mcp_approval".to_string(), approval_fixture_server());
            config.mcp_server_permissions.rules.insert(
                "allow-mock-mcp".to_string(),
                erato::config::McpServerPermissionRule::AllowAll {
                    mcp_server_ids: vec!["mock_mcp_approval".to_string()],
                },
            );
            config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
                enabled: true,
                preset: erato::config::McpToolApprovalPreset::Permissive,
                allow_always: false,
            };
        },
    )
    .await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_addr = listener.local_addr().unwrap();
    let app: Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let client = reqwest::Client::new();
    let base_url = format!("http://{server_addr}");
    let create_response = client
        .post(format!("{base_url}/api/v1beta/me/chats"))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert!(create_response.status().is_success());
    let chat_id = create_response.json::<serde_json::Value>().await.unwrap()["chat_id"]
        .as_str()
        .unwrap()
        .to_string();

    // The fixture tool is closed-world and read-only, so no preset asks about
    // it on its own. The user's own "ask" decision is what parks it.
    let ask = client
        .post(format!(
            "{base_url}/api/v1beta/me/mcp-tool-approval-settings"
        ))
        .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
        .json(&json!({
            "mcp_server_id": "mock_mcp_approval",
            "tool_name": TOOL,
            "decision": "ask",
        }))
        .send()
        .await
        .unwrap();
    assert!(ask.status().is_success(), "seeding the ask decision failed");

    let streaming = tokio::spawn({
        let client = client.clone();
        let base_url = base_url.clone();
        let chat_id = chat_id.clone();
        async move {
            client
                .post(format!("{base_url}/api/v1beta/me/messages/submitstream"))
                .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
                .json(&json!({
                    "existing_chat_id": chat_id,
                    "user_message": "approval batch question",
                    "input_files_ids": [],
                    "selected_facet_ids": ["plan"],
                }))
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap()
        }
    });

    // Watch the durable row for the forbidden pair: an approval part present
    // while a task slot is still running.
    let mut saw_running_task = false;
    let mut saw_approval = false;
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let body = client
            .get(format!("{base_url}/api/v1beta/chats/{chat_id}/messages"))
            .header("Authorization", format!("Bearer {TEST_JWT_TOKEN}"))
            .send()
            .await
            .unwrap()
            .json::<serde_json::Value>()
            .await
            .unwrap();
        for message in body["messages"].as_array().into_iter().flatten() {
            let parts: Vec<&serde_json::Value> = message["content"]
                .as_array()
                .into_iter()
                .flatten()
                .collect();
            let running = parts.iter().any(|part| {
                part["tool_name"] == "delegate_task" && part["output"]["status"] == "working"
            });
            let approval = parts
                .iter()
                .any(|part| part["content_type"] == "tool_approval_request");
            saw_running_task |= running;
            saw_approval |= approval;
            assert!(
                !(running && approval),
                "a parked shape must never be published while a task is still running: {parts:?}"
            );
        }
    }

    let _ = tokio::time::timeout(std::time::Duration::from_secs(30), streaming).await;
    assert!(
        saw_running_task,
        "the test never observed a running task, so it certified nothing"
    );
    assert!(
        saw_approval,
        "the test never observed an approval part, so it certified nothing"
    );
}

/// The mock MCP server's approval-policy endpoint, as an erato server config.
fn approval_fixture_server() -> erato::config::McpServerConfig {
    let base_url = std::env::var("TEST_MOCK_MCP_SERVER_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:44321".to_string());
    erato::config::McpServerConfig {
        transport_type: "streamable_http".to_string(),
        url: format!("{base_url}/mcp/approval-policy"),
        http_headers: None,
        allow_tools: None,
        exclude_tools: vec![],
        wait_tools: vec![],
        authentication: erato::config::McpServerAuthenticationConfig::None,
        max_session_idle_seconds: None,
    }
}

/// An `async` task detaches: the slot settles at launch, and the origin turn
/// finishes without the child's answer.
///
/// This is the whole difference between `async` and `wait` at dispatch time.
/// Revert the run-mode threading in `launch_prepared_task` and the turn blocks
/// on the child instead, with the awaited envelope on the part — which is
/// exactly the case a reader could not tell apart from a slow `wait` call.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn async_task_dispatch_settles_the_slot_and_detaches(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // The child's own turn, recognised by the brief.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["ASYNC-BRIEF-SENTINEL"],
                &["async task question"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["ASYNC-CHILD-ANSWER"]),
        );
    });
    // The parent's continuation. It sees the dispatch note, never the answer.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["async task question", "dispatched"],
                &[],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-ASYNC-FINAL"]),
        );
    });
    // The parent's first turn: plans the sub-task and asks for `async`.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["async task question"],
                &["ASYNC-BRIEF-SENTINEL", "dispatched"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_async_1",
                "delegate_task",
                json!({
                    "task": "ASYNC-BRIEF-SENTINEL: count the figures",
                    "run_mode": "async",
                }),
            )]),
        );
    });

    let (app_state, _llm) = task_state(pool, mocks, &["erato/delegate_task"], |config| {
        config.delegation.tasks.run_modes = vec![
            erato_config::config::TaskRunMode::Wait,
            erato_config::config::TaskRunMode::Async,
        ];
        // This turn asks for `async`, which the shipped default `async_only`
        // would park before it ran; the policy has tests of its own.
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Never;
    })
    .await;

    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, "async task question", &["plan"]).await;

    let output = find_tool_call_update_output(&events, "delegate_task");
    assert_eq!(
        output["background"], true,
        "an async dispatch keeps the detached marker the frontend pill reads: {output}"
    );
    assert_eq!(
        output["run_mode"], "async",
        "a reader must be able to tell a run whose answer is coming back from one whose never will: {output}"
    );
    assert!(output["child_run_id"].is_string());
    assert!(
        output["result"].is_null() && output["status"].is_null(),
        "the part is frozen at the launch shape; the answer is not in this turn: {output}"
    );
    assert!(extract_full_text_answer(&events).contains("PARENT-ASYNC-FINAL"));

    // The child is a real run, and it is recorded as the detached mode it is.
    let child_chat = delegated_child_chat(&app_state.db, Uuid::parse_str(&chat).unwrap()).await;
    let configuration = child_chat
        .assistant_configuration
        .expect("child configuration");
    assert_eq!(configuration["provenance"]["run_mode"], "async");
    assert_eq!(
        configuration["task"]["parent_tool_call_id"], "call_async_1",
        "the origin call is persisted at launch, for a delivery that may never see this turn"
    );
}

/// A mode the deployment does not offer is refused, not quietly downgraded.
///
/// The schema's `enum` is advisory — a model can write anything — so the offer
/// is re-checked at dispatch. Downgrading instead would leave the model
/// believing it had detached work that in fact ran inline, which it cannot
/// observe and cannot correct.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn async_run_mode_is_refused_when_it_is_not_offered(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // The parent recovers in prose once the refusal comes back.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["unoffered mode question", "not available"],
                &[],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["ASYNC-REFUSAL-RECOVERED"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["unoffered mode question"],
                &["not available"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_unoffered",
                "delegate_task",
                json!({
                    "task": "NEVER-DISPATCHED: count the figures",
                    "run_mode": "async",
                }),
            )]),
        );
    });

    // Default `run_modes`: wait only.
    let (app_state, _llm) = task_enabled_state(pool, mocks, &["erato/delegate_task"]).await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, "unoffered mode question", &["plan"]).await;

    let output = find_tool_call_update_output(&events, "delegate_task");
    let error = output["error"]
        .as_str()
        .unwrap_or_else(|| panic!("the call must be refused: {output}"));
    assert!(
        error.contains("not available") && error.contains("wait"),
        "the refusal must name what IS available so the model can retry correctly: {error}"
    );
    assert!(extract_full_text_answer(&events).contains("ASYNC-REFUSAL-RECOVERED"));

    // A refusal is a refused CALL, not a refused turn — and nothing was created.
    let children = erato::db::entity::prelude::Chats::find()
        .filter(erato::db::entity::chats::Column::OriginChatId.eq(Uuid::parse_str(&chat).unwrap()))
        .all(&app_state.db)
        .await
        .expect("query");
    assert!(
        children.is_empty(),
        "a refused mode must not leave a child run behind"
    );
}

/// The concurrency cap counts both detached modes.
///
/// The cap exists to bound concurrent load, and an `async` run costs exactly
/// what a `background` one does. Leaving the SQL at `= 'background'` would
/// make async runs uncapped — the one mode a model can start on its own
/// initiative, repeatedly, within a single turn.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn count_running_background_delegated_runs_counts_async_runs(pool: Pool<Postgres>) {
    use sea_orm::ConnectionTrait;

    let app_state = test_app_state(delegation_enabled_config(), pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin_chat = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin_chat).unwrap();

    for run_mode in [
        erato::models::message::ProvenanceRunMode::Background,
        erato::models::message::ProvenanceRunMode::Async,
        // An awaited run is not detached and must not be counted.
        erato::models::message::ProvenanceRunMode::Wait,
    ] {
        let child = erato::models::chat::create_delegated_chat(
            &app_state.db,
            &rebuilt_policy(&app_state).await,
            &erato::policy::types::Subject::User(me.id.to_string()),
            &me.id.to_string(),
            None,
            ChatProvenance {
                kind: ChatProvenanceKind::Delegation,
                origin_chat_id: Some(origin_chat_id),
                origin_message_id: None,
                parent_message_id: None,
                origin_assistant_id: None,
                rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
                depth: 1,
                adopted_at: None,
                legacy_expected_output: None,
                legacy_constraints: None,
                run_mode: (run_mode != erato::models::message::ProvenanceRunMode::Wait)
                    .then_some(run_mode),
                result_delivery: None,
                retry_of: None,
            },
            None,
            format!("{run_mode:?} run"),
            true,
            Vec::new(),
            Vec::new(),
        )
        .await
        .unwrap();

        // Live generation with a fresh heartbeat: what "in flight" means here.
        app_state
            .db
            .execute_raw(sea_orm::Statement::from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                r#"
                UPDATE chats
                SET active_generation_id = $1,
                    generation_state = 'running',
                    generation_started_at = now(),
                    generation_heartbeat_at = now(),
                    generation_ended_at = NULL
                WHERE id = $2
                "#,
                [Uuid::new_v4().into(), child.id.into()],
            ))
            .await
            .expect("mark running");
    }

    let in_flight = erato::models::chat::count_running_background_delegated_runs(
        &app_state.db,
        &me.id.to_string(),
        app_state.config.generation_status.stale_after_secs,
    )
    .await
    .expect("count");
    assert_eq!(
        in_flight, 2,
        "both detached modes consume a slot; the awaited run does not"
    );
}

/// `async` is not a mode a client may ask for.
///
/// The request wire keeps two variants on purpose, so the only way into the
/// third is the server choosing it for a delegated run. Widening
/// `DelegationRunMode` instead of adding a separate persisted type would let a
/// submit body start a turn in a mode the request path cannot execute.
///
/// Asserts the status the server actually returns: axum's stock `Json`
/// extractor answers a deserialization failure with 422, and nothing in this
/// service remaps it.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_async_delegation_run_mode_on_a_submit_request_is_unprocessable(pool: Pool<Postgres>) {
    let app_state = test_app_state(delegation_enabled_config(), pool).await;
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "user_message": "run this detached",
            "delegation_run_mode": "async",
        }))
        .await;
    assert_eq!(
        response.status_code(),
        axum::http::StatusCode::UNPROCESSABLE_ENTITY,
        "an unknown run mode must not reach the turn"
    );

    let chats = erato::db::entity::prelude::Chats::find()
        .all(&app_state.db)
        .await
        .expect("query");
    assert!(
        chats.is_empty(),
        "a rejected request must not have created a chat"
    );
}

/// Wait for a child's recorded delivery to reach one of the given states.
async fn wait_for_delivery_state(
    db: &sea_orm::DatabaseConnection,
    child_chat_id: Uuid,
    wanted: &[&str],
) -> String {
    for _ in 0..100 {
        if let Some(chat) = erato::db::entity::chats::Entity::find_by_id(child_chat_id)
            .one(db)
            .await
            .unwrap()
            && let Some(state) = chat
                .assistant_configuration
                .as_ref()
                .and_then(|configuration| {
                    configuration["provenance"]["result_delivery"]["state"].as_str()
                })
            && wanted.contains(&state)
        {
            return state.to_string();
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    let observed = erato::db::entity::chats::Entity::find_by_id(child_chat_id)
        .one(db)
        .await
        .unwrap()
        .and_then(|chat| chat.assistant_configuration)
        .map(|configuration| configuration["provenance"]["result_delivery"].clone());
    panic!("delivery for child {child_chat_id} never reached {wanted:?}; observed {observed:?}");
}

/// The rows of a chat's active thread, oldest first.
async fn active_thread_rows(
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
) -> Vec<erato::db::entity::messages::Model> {
    chat_messages_by_created_at(db, chat_id)
        .await
        .into_iter()
        .filter(|row| row.is_message_in_active_thread)
        .collect()
}

/// The whole point of the level: a task the turn did not wait for comes back.
///
/// End to end through the real routes — dispatch, detached child, delivery,
/// reaction — because each half is individually plausible and only the seam
/// between them is the feature. Skip the child tail's drain and this is the
/// only test that notices: the run finishes, its answer sits in its own chat,
/// and the conversation that asked for it never hears.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn async_child_completion_delivers_task_result_and_reacts(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    // The reaction turn: recognised by the delivered answer plus the origin
    // conversation around it. Registered first so it wins over the parent's
    // continuation, whose matcher is a subset of this one's context.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["ASYNC-CHILD-ANSWER", "delivery question"],
                &[],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["REACTION-TO-RESULT"]),
        );
    });
    // The child's own turn.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["DELIVERY-BRIEF-SENTINEL"],
                &["delivery question"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["ASYNC-CHILD-ANSWER"]),
        );
    });
    // The parent's continuation, once the dispatch has settled its slot.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["delivery question", "dispatched"],
                &["ASYNC-CHILD-ANSWER"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-DISPATCH-FINAL"]),
        );
    });
    // The parent's first turn: plans the sub-task as `async`.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["delivery question"],
                &[
                    "DELIVERY-BRIEF-SENTINEL",
                    "dispatched",
                    "ASYNC-CHILD-ANSWER",
                ],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_delivery_1",
                "delegate_task",
                json!({
                    "task": "DELIVERY-BRIEF-SENTINEL: count the figures",
                    "run_mode": "async",
                }),
            )]),
        );
    });

    let (app_state, _llm) = task_state(pool, mocks, &["erato/delegate_task"], |config| {
        config.delegation.tasks.run_modes = vec![
            erato_config::config::TaskRunMode::Wait,
            erato_config::config::TaskRunMode::Async,
        ];
        // This turn asks for `async`, which the shipped default `async_only`
        // would park before it ran; the policy has tests of its own.
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Never;
    })
    .await;

    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let chat_id = Uuid::parse_str(&chat).unwrap();
    let events = submit_with_facets(&server, &chat, "delivery question", &["plan"]).await;
    assert!(extract_full_text_answer(&events).contains("PARENT-DISPATCH-FINAL"));

    let child_chat = delegated_child_chat(&app_state.db, chat_id).await;
    wait_for_child_completion(&app_state.db, child_chat.id, "ASYNC-CHILD-ANSWER").await;
    let state = wait_for_delivery_state(&app_state.db, child_chat.id, &["reacted"]).await;
    assert_eq!(state, "reacted");

    // The result is a user-role row on the active thread, carrying the child's
    // answer as a `task_result` part rather than as text.
    let rows = active_thread_rows(&app_state.db, chat_id).await;
    let result_row = rows
        .iter()
        .find(|row| {
            row.input_parameters
                .as_ref()
                .is_some_and(|parameters| !parameters["task_result"].is_null())
        })
        .expect("a task_result row must be on the origin's active thread");
    assert_eq!(result_row.raw_message["role"], "user");
    let part = &result_row.raw_message["content"][0];
    assert_eq!(part["content_type"], "task_result");
    assert_eq!(part["child_chat_id"], child_chat.id.to_string());
    assert_eq!(part["parent_tool_call_id"], "call_delivery_1");
    assert_eq!(part["status"], "completed");
    assert!(
        part["summary"]
            .as_str()
            .is_some_and(|summary| summary.contains("ASYNC-CHILD-ANSWER")),
        "the child's answer must ride the part: {part}"
    );

    // …and the model reacted to it, on a row that says who started the turn.
    let reaction = rows
        .iter()
        .find(|row| {
            row.generation_parameters
                .as_ref()
                .is_some_and(|parameters| parameters["initiator"] == "task_result")
        })
        .expect("the delivery must have run a reaction turn");
    assert!(
        reaction.raw_message["content"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|part| part["text"]
                .as_str()
                .is_some_and(|text| text.contains("REACTION-TO-RESULT"))),
        "the reaction must be the model's answer to the result: {:?}",
        reaction.raw_message
    );
    assert!(
        rows.iter().position(|row| row.id == result_row.id)
            < rows.iter().position(|row| row.id == reaction.id),
        "the reaction must come after the result it answers"
    );
}

/// A task-enabled state that also offers `async`.
async fn task_enabled_state_with_async(
    pool: Pool<Postgres>,
) -> (erato::state::AppState, mocktail::server::MockServer) {
    task_state(pool, MockSet::new(), &["erato/delegate_task"], |config| {
        config.delegation.tasks.run_modes = vec![
            erato_config::config::TaskRunMode::Wait,
            erato_config::config::TaskRunMode::Async,
        ];
    })
    .await
}

/// The principal a delivery runs under.
///
/// Written out rather than deserialized: the profile has no `Default` and few
/// serde defaults, so a JSON stub would break on the next field added without
/// saying which one.
async fn me_profile(
    _app_state: &erato::state::AppState,
    user: &erato::db::entity::users::Model,
) -> erato::MeProfile {
    erato::MeProfile {
        profile: erato::UserProfile {
            id: user.id.to_string(),
            email: None,
            name: None,
            picture: None,
            preferred_language: "en".to_string(),
            groups: Vec::new(),
            organization_user_id: None,
            organization_group_ids: Vec::new(),
            preference_nickname: None,
            preference_job_title: None,
            preference_assistant_custom_instructions: None,
            preference_assistant_additional_information: None,
            preference_default_chat_provider: None,
            preference_starting_hub_assistant_id: None,
            preference_starting_assistant_id: None,
            preference_starting_assistant_cleared: false,
        },
        oidc_token: TEST_JWT_TOKEN.to_string(),
        id_token_claims: json!({}),
        access_token: None,
    }
}

/// Hand-seed a delegated `async` child of `origin_chat_id` whose result is
/// recorded and owed.
///
/// The recording half is exercised end to end by the test above; these tests
/// need to reach one specific branch of the delivery half without also running
/// a child, so they write the state that branch reads.
async fn seed_child_owing_a_result(
    app_state: &erato::state::AppState,
    owner_user_id: &str,
    origin_chat_id: Uuid,
    answer: Option<&str>,
    scheduling: erato_config::config::TaskScheduling,
) -> Uuid {
    let (child_id, answer_message_id) =
        seed_child_before_recording(app_state, owner_user_id, origin_chat_id, answer, scheduling)
            .await;
    erato::services::task_delivery::record_pending_delivery(
        app_state,
        child_id,
        answer_message_id,
        false,
        false,
        false,
    )
    .await
    .expect("the run must record a delivery it owes");
    child_id
}

/// As [`seed_child_owing_a_result`], stopping short of recording the delivery.
///
/// Returns the child and the answer row the record step will describe, so a
/// caller can drive the two halves apart — and read the child in between.
async fn seed_child_before_recording(
    app_state: &erato::state::AppState,
    owner_user_id: &str,
    origin_chat_id: Uuid,
    answer: Option<&str>,
    scheduling: erato_config::config::TaskScheduling,
) -> (Uuid, Uuid) {
    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &rebuilt_policy(app_state).await,
        &erato::policy::types::Subject::User(owner_user_id.to_string()),
        owner_user_id,
        None,
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(origin_chat_id),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: None,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: Some(erato::models::message::ProvenanceRunMode::Async),
            result_delivery: None,
            retry_of: None,
        },
        Some(erato::models::chat::TaskSpec {
            expected_output: None,
            constraints: None,
            facet_ids: Vec::new(),
            max_server_tool_calls_per_task: None,
            max_client_tool_calls_per_task: None,
            persona: Default::default(),
            scheduling,
            parent_tool_call_id: Some("call_seeded".to_string()),
            route: erato::models::chat::DelegateRoute::Task,
        }),
        "Seeded async run".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("child chat");
    app_state.global_policy_engine.invalidate_data().await;

    // The child's own answer row, when the test wants one. `None` stands in for
    // a run whose answer is gone.
    let answer_message_id = match answer {
        Some(text) => {
            let user_row = erato::models::message::submit_message(
                &app_state.db,
                &rebuilt_policy(app_state).await,
                &erato::policy::types::Subject::User(owner_user_id.to_string()),
                &child.id,
                json!({
                    "role": "user",
                    "content": [{"content_type": "text", "text": "seeded brief"}],
                    "name": owner_user_id,
                }),
                None,
                None,
                None,
                &[],
                None,
                None,
                None,
            )
            .await
            .expect("child user row");
            erato::models::message::submit_message(
                &app_state.db,
                &rebuilt_policy(app_state).await,
                &erato::policy::types::Subject::User(owner_user_id.to_string()),
                &child.id,
                json!({
                    "role": "assistant",
                    "content": [{"content_type": "text", "text": text}],
                }),
                Some(&user_row.id),
                None,
                None,
                &[],
                None,
                None,
                None,
            )
            .await
            .expect("child answer row")
            .id
        }
        None => Uuid::new_v4(),
    };

    (child.id, answer_message_id)
}

/// Read a child's stored delivery envelope.
async fn delivery_of(app_state: &erato::state::AppState, child_chat_id: Uuid) -> Value {
    erato::db::entity::chats::Entity::find_by_id(child_chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .unwrap()
        .assistant_configuration
        .expect("configuration")["provenance"]["result_delivery"]
        .clone()
}

/// An archived origin closes the delivery instead of writing into it.
///
/// Archiving is the user saying they are done with that conversation. Appending
/// a result to it afterwards would resurrect it in the listing over work they
/// stopped caring about, so the delivery is closed and says why.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn archived_origin_supersedes_the_delivery(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("SEEDED-ANSWER"),
        erato_config::config::TaskScheduling::WhenIdle,
    )
    .await;

    archive_chat_via_api(&server, &origin).await;
    app_state.global_policy_engine.invalidate_data().await;

    let outcome = erato::services::task_delivery::deliver_task_result(
        &app_state,
        &rebuilt_policy(&app_state).await,
        &me_profile(&app_state, &me).await,
        child_id,
    )
    .await;
    assert_eq!(
        outcome,
        erato::services::task_delivery::DeliveryOutcome::Closed
    );

    let delivery = delivery_of(&app_state, child_id).await;
    assert_eq!(delivery["state"], "superseded");
    assert_eq!(delivery["reason"], "origin_archived");
    assert!(
        active_thread_rows(&app_state.db, origin_chat_id)
            .await
            .iter()
            .all(|row| row
                .input_parameters
                .as_ref()
                .is_none_or(|parameters| parameters["task_result"].is_null())),
        "nothing may be appended to an archived chat"
    );
}

/// A run whose answer row is gone delivers a failure, not an empty success.
///
/// `build_result_envelope` maps a missing answer to `completed` / `no_answer`,
/// which is right for the awaited path — the delegate genuinely said nothing —
/// and wrong here, where the row is gone because the process died. Telling the
/// origin model the task finished with nothing to say invites it to move on
/// from work that never reported.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_child_without_an_answer_row_delivers_failed_result_missing(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        None,
        erato_config::config::TaskScheduling::Silent,
    )
    .await;

    let recorded = delivery_of(&app_state, child_id).await;
    assert_eq!(recorded["status"], "failed");
    assert_eq!(recorded["reason"], "result_missing");
    assert!(
        recorded["result_message_id"].is_null(),
        "there is no answer row to point at"
    );

    let outcome = erato::services::task_delivery::deliver_task_result(
        &app_state,
        &rebuilt_policy(&app_state).await,
        &me_profile(&app_state, &me).await,
        child_id,
    )
    .await;
    assert_eq!(
        outcome,
        erato::services::task_delivery::DeliveryOutcome::Delivered,
        "a failed task is still news the origin model needs"
    );

    let rows = active_thread_rows(&app_state.db, origin_chat_id).await;
    let part = rows
        .iter()
        .find_map(|row| {
            row.input_parameters
                .as_ref()
                .filter(|parameters| !parameters["task_result"].is_null())
                .map(|_| row.raw_message["content"][0].clone())
        })
        .expect("the failure must still reach the conversation");
    assert_eq!(part["status"], "failed");
    assert_eq!(part["reason"], "result_missing");
}

/// A `silent` result is stored, not answered.
///
/// The model asked for a result it did not want interrupted by; the user's own
/// next message composes it through history instead. A reaction here would be
/// the conversation talking to itself.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn silent_scheduling_delivers_without_a_reaction(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("SILENT-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;

    let before = active_thread_rows(&app_state.db, origin_chat_id)
        .await
        .len();
    let outcome = erato::services::task_delivery::deliver_task_result(
        &app_state,
        &rebuilt_policy(&app_state).await,
        &me_profile(&app_state, &me).await,
        child_id,
    )
    .await;
    assert_eq!(
        outcome,
        erato::services::task_delivery::DeliveryOutcome::Delivered
    );

    let delivery = delivery_of(&app_state, child_id).await;
    assert_eq!(
        delivery["state"], "delivered",
        "a silent delivery stops at delivered; nothing reacted"
    );

    let rows = active_thread_rows(&app_state.db, origin_chat_id).await;
    assert_eq!(
        rows.len(),
        before + 1,
        "exactly one row - the result - and no reaction turn"
    );
    assert!(
        rows.iter()
            .all(|row| row.raw_message["role"] != "assistant"),
        "a silent delivery must not produce an assistant turn"
    );
}

/// Re-delivering after a crash appends the same result once, not twice.
///
/// A process that dies between the claim and the state write leaves a `claimed`
/// envelope and a row already on disk. The backstop forces such a claim back to
/// `pending`, and without the duplicate probe the retry would append the
/// child's answer a second time — in the conversation, where the user sees it.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn delivery_reclaim_after_a_crash_does_not_duplicate_the_task_result(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("RECLAIM-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;

    let policy = rebuilt_policy(&app_state).await;
    let me_profile = me_profile(&app_state, &me).await;
    assert_eq!(
        erato::services::task_delivery::deliver_task_result(
            &app_state,
            &policy,
            &me_profile,
            child_id
        )
        .await,
        erato::services::task_delivery::DeliveryOutcome::Delivered
    );

    // The crash: the envelope is forced back to `pending` under the same
    // delivery id, exactly as a stale-claim requeue leaves it.
    let mut delivery = delivery_of(&app_state, child_id).await;
    delivery["state"] = json!("pending");
    let chat = erato::db::entity::chats::Entity::find_by_id(child_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .unwrap();
    let mut configuration = chat.assistant_configuration.clone().unwrap();
    configuration["provenance"]["result_delivery"] = delivery;
    let mut active: erato::db::entity::chats::ActiveModel = chat.into();
    active.assistant_configuration = ActiveValue::Set(Some(configuration));
    active.update(&app_state.db).await.unwrap();

    assert_eq!(
        erato::services::task_delivery::deliver_task_result(
            &app_state,
            &policy,
            &me_profile,
            child_id
        )
        .await,
        erato::services::task_delivery::DeliveryOutcome::Delivered
    );

    let result_rows = active_thread_rows(&app_state.db, origin_chat_id)
        .await
        .into_iter()
        .filter(|row| {
            row.input_parameters
                .as_ref()
                .is_some_and(|parameters| !parameters["task_result"].is_null())
        })
        .count();
    assert_eq!(
        result_rows, 1,
        "the delivery id is the idempotency key; a retry must find its own row"
    );
}

/// A busy origin defers the delivery rather than queueing behind the user.
///
/// The lease is admission control now, so a delivery that ignored it would put
/// two writers in one chat. Deferring costs nothing: the claim goes back to
/// `pending`, and the origin turn's own tail drains it on the way out.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn delivery_defers_while_the_origin_lease_is_held(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("DEFERRED-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;

    // Someone is already generating in the origin chat.
    let (_rx, holder) = app_state
        .background_tasks
        .try_start_task(
            origin_chat_id,
            Uuid::new_v4(),
            erato::services::background_tasks::Takeover::TakeParked,
            app_state.config.generation_status.stale_after_secs,
        )
        .await
        .expect("the origin lease must be free to start with");

    let policy = rebuilt_policy(&app_state).await;
    let me_profile = me_profile(&app_state, &me).await;
    assert_eq!(
        erato::services::task_delivery::deliver_task_result(
            &app_state,
            &policy,
            &me_profile,
            child_id
        )
        .await,
        erato::services::task_delivery::DeliveryOutcome::Deferred
    );
    let delivery = delivery_of(&app_state, child_id).await;
    assert_eq!(
        delivery["state"], "pending",
        "a deferred delivery goes back in the queue, it is not lost"
    );
    assert!(
        delivery["claimed_by"].is_null(),
        "a released claim must not look held"
    );
    assert_eq!(
        delivery["attempts"], 1,
        "the attempt is still counted, so a delivery that can never land is visible"
    );
    assert!(
        active_thread_rows(&app_state.db, origin_chat_id)
            .await
            .is_empty(),
        "nothing may be written into a chat someone else is generating in"
    );

    // Once the turn ends, the same delivery lands.
    app_state
        .background_tasks
        .remove_task(
            &origin_chat_id,
            holder.generation_id,
            erato::services::background_tasks::TaskOutcome::Completed,
        )
        .await;
    erato::services::task_delivery::drain_pending_deliveries(
        &app_state,
        &policy,
        &me_profile,
        origin_chat_id,
    )
    .await;
    assert_eq!(
        delivery_of(&app_state, child_id).await["state"],
        "delivered"
    );
}

/// LD-A9: a reaction turn may not plan tasks of its own.
///
/// The offer is normally withheld from a delegated RUN, and a reaction runs in
/// the ORIGIN chat, where that rule does not reach. Without the explicit
/// suppression a reaction could dispatch another async task, whose result would
/// trigger another reaction — a loop nothing in the system bounds.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_reaction_turn_does_not_offer_delegate_task(pool: Pool<Postgres>) {
    let reaction_recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let reaction_recorder = reaction_recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &["LOOPGUARD-CHILD-ANSWER", "loopguard question"],
                    &[],
                ))
                .matcher(reaction_recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["LOOPGUARD-REACTION"]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["LOOPGUARD-BRIEF"],
                &["loopguard question"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["LOOPGUARD-CHILD-ANSWER"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["loopguard question", "dispatched"],
                &["LOOPGUARD-CHILD-ANSWER"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["LOOPGUARD-PARENT-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["loopguard question"],
                &["LOOPGUARD-BRIEF", "dispatched", "LOOPGUARD-CHILD-ANSWER"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_loopguard",
                "delegate_task",
                json!({ "task": "LOOPGUARD-BRIEF: count", "run_mode": "async" }),
            )]),
        );
    });

    let (app_state, _llm) = task_state(pool, mocks, &["erato/delegate_task"], |config| {
        config.delegation.tasks.run_modes = vec![
            erato_config::config::TaskRunMode::Wait,
            erato_config::config::TaskRunMode::Async,
        ];
        // This turn asks for `async`, which the shipped default `async_only`
        // would park before it ran; the policy has tests of its own.
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Never;
    })
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let chat_id = Uuid::parse_str(&chat).unwrap();
    submit_with_facets(&server, &chat, "loopguard question", &["plan"]).await;

    let child_chat = delegated_child_chat(&app_state.db, chat_id).await;
    wait_for_child_completion(&app_state.db, child_chat.id, "LOOPGUARD-CHILD-ANSWER").await;
    wait_for_delivery_state(&app_state.db, child_chat.id, &["reacted"]).await;

    let bodies = reaction_recorder.bodies();
    assert!(
        !bodies.is_empty(),
        "the reaction turn must have reached the provider"
    );
    // Asserted against the OFFER, not the raw body: the reaction replays the
    // turn that planned the task, so the name appears in its history — and has
    // to, or the model could not see what it already did.
    for body in &bodies {
        let request: Value = serde_json::from_str(body).expect("request body is JSON");
        let offered: Vec<String> = request["tools"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|tool| tool["function"]["name"].as_str())
            .map(str::to_string)
            .collect();
        assert!(
            !offered.iter().any(|name| name == "delegate_task"),
            "a reaction turn must not be offered the task tool; offered: {offered:?}"
        );
    }
    // The planning turn WAS offered it, so this is a suppression and not a
    // configuration that never offered the tool at all.
    assert!(
        active_thread_rows(&app_state.db, chat_id)
            .await
            .iter()
            .any(|row| row.raw_message["content"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|part| part["content_type"] == "tool_use")),
        "the origin turn must have actually planned a task"
    );
}

/// The owner opening the child chat must not erase what it still owes.
///
/// The first user write into a delegated run marks it adopted by rewriting the
/// whole `assistant_configuration` column from a row this process read earlier.
/// A recorded delivery written in between would go with it, and the result
/// would be lost silently — the run looks finished and nothing is owed.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn adopted_child_still_delivers_the_recorded_result(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("ADOPTED-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;

    // The owner writes into the child chat themselves.
    let child = erato::db::entity::chats::Entity::find_by_id(child_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .unwrap();
    erato::models::chat::mark_delegated_run_adopted(&app_state.db, &child)
        .await
        .expect("adoption");

    let delivery = delivery_of(&app_state, child_id).await;
    assert_eq!(
        delivery["state"], "pending",
        "adoption must not erase a delivery the origin is still owed: {delivery}"
    );

    // And it still lands.
    erato::services::task_delivery::drain_pending_deliveries(
        &app_state,
        &rebuilt_policy(&app_state).await,
        &me_profile(&app_state, &me).await,
        origin_chat_id,
    )
    .await;
    assert_eq!(
        delivery_of(&app_state, child_id).await["state"],
        "delivered"
    );
}

/// Adoption from a row read before the delivery existed must still not erase
/// it.
///
/// This is the interleaving the owner can actually produce, and the one the
/// test above does not reach because it re-reads the child after the delivery
/// is already there. The request loads the child to decide it may write, the
/// run's tail records the result it owes, and adoption lands last carrying a
/// picture of the row from before any of that. `record_pending_delivery` has
/// returned by then and nothing retries it, so a delivery lost here is lost for
/// good: the run reads as owing nothing and the origin never hears back.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn adoption_from_a_pre_delivery_snapshot_keeps_the_record(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let (child_id, answer_message_id) = seed_child_before_recording(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("STALE-SNAPSHOT-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;

    // What the user's write path is holding when it reaches the adoption call.
    let stale = erato::db::entity::chats::Entity::find_by_id(child_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        stale
            .assistant_configuration
            .as_ref()
            .expect("configuration")["provenance"]["result_delivery"]
            .is_null(),
        "the snapshot must predate the delivery or this is not the race under test"
    );

    erato::services::task_delivery::record_pending_delivery(
        &app_state,
        child_id,
        answer_message_id,
        false,
        false,
        false,
    )
    .await
    .expect("the run must record a delivery it owes");

    erato::models::chat::mark_delegated_run_adopted(&app_state.db, &stale)
        .await
        .expect("adoption");

    let delivery = delivery_of(&app_state, child_id).await;
    assert_eq!(
        delivery["state"], "pending",
        "a stale adoption snapshot must not erase the delivery: {delivery}"
    );

    let adopted = erato::db::entity::chats::Entity::find_by_id(child_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .unwrap()
        .assistant_configuration
        .expect("configuration");
    assert!(
        adopted["provenance"]["adopted_at"].is_string(),
        "the adoption itself must still be recorded: {adopted}"
    );
}

/// Two processes racing one delivery produce one row, and only one of them
/// believes it delivered.
///
/// The claim is the compare-and-set that decides. Drop its `state = 'pending'`
/// predicate and both callers proceed: the row count stays at one, because the
/// duplicate probe catches it downstream, so the outcomes are the only
/// observable that moves — which is what this asserts.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn delivery_claim_is_single_winner_under_concurrency(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("RACED-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;

    let policy = rebuilt_policy(&app_state).await;
    let me_profile = me_profile(&app_state, &me).await;
    let (first, second) = tokio::join!(
        erato::services::task_delivery::deliver_task_result(
            &app_state,
            &policy,
            &me_profile,
            child_id
        ),
        erato::services::task_delivery::deliver_task_result(
            &app_state,
            &policy,
            &me_profile,
            child_id
        ),
    );

    let mut outcomes = [first, second];
    outcomes.sort_by_key(|outcome| format!("{outcome:?}"));
    assert_eq!(
        outcomes,
        [
            erato::services::task_delivery::DeliveryOutcome::Delivered,
            erato::services::task_delivery::DeliveryOutcome::Skipped,
        ],
        "exactly one caller may take a delivery; the loser must not also report success"
    );

    let result_rows = active_thread_rows(&app_state.db, origin_chat_id)
        .await
        .into_iter()
        .filter(|row| {
            row.input_parameters
                .as_ref()
                .is_some_and(|parameters| !parameters["task_result"].is_null())
        })
        .count();
    assert_eq!(result_rows, 1, "one delivery, one row");
}

/// A chat parked on a tool approval belongs to the person who has to answer it.
///
/// `RefuseParked` is the whole difference from a user write, which may abandon
/// an approval the user has stopped answering. A delivery may not: dropping a
/// result under a mounted approval card moves the card the user is looking at,
/// and nobody asked for that.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn delivery_refuses_a_parked_origin_and_lands_once_it_is_free(pool: Pool<Postgres>) {
    use sea_orm::ConnectionTrait;

    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("PARKED-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;

    // The origin is parked on an approval nobody has answered.
    app_state
        .db
        .execute_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"
            UPDATE chats
            SET active_generation_id = $1,
                generation_state = 'awaiting_approval',
                generation_started_at = now(),
                generation_heartbeat_at = NULL,
                generation_ended_at = NULL
            WHERE id = $2
            "#,
            [Uuid::new_v4().into(), origin_chat_id.into()],
        ))
        .await
        .expect("park the origin");

    let policy = rebuilt_policy(&app_state).await;
    let me_profile = me_profile(&app_state, &me).await;
    assert_eq!(
        erato::services::task_delivery::deliver_task_result(
            &app_state,
            &policy,
            &me_profile,
            child_id
        )
        .await,
        erato::services::task_delivery::DeliveryOutcome::Deferred
    );
    assert_eq!(delivery_of(&app_state, child_id).await["state"], "pending");
    assert!(
        active_thread_rows(&app_state.db, origin_chat_id)
            .await
            .is_empty(),
        "nothing may be written under a mounted approval card"
    );

    // The approval is answered and the chat goes idle; the same delivery lands.
    app_state
        .db
        .execute_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"
            UPDATE chats
            SET generation_state = 'completed', generation_ended_at = now()
            WHERE id = $1
            "#,
            [origin_chat_id.into()],
        ))
        .await
        .expect("unpark the origin");

    erato::services::task_delivery::drain_pending_deliveries(
        &app_state,
        &policy,
        &me_profile,
        origin_chat_id,
    )
    .await;
    assert_eq!(
        delivery_of(&app_state, child_id).await["state"],
        "delivered"
    );
}

/// Two processes, one delivery: the claim decides, and only one believes it won.
///
/// The single-process version of this races two tasks through one manager,
/// which the in-memory map alone could settle. Two managers on one pool is the
/// case the compare-and-set exists for — a second replica, or the ~25 seconds
/// of every rolling deploy when the old and new pods both hold the database.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn delivery_claim_is_single_winner_across_two_managers(pool: Pool<Postgres>) {
    let (app_config_a, _llm_a) = crate::test_utils::setup_mock_llm_server(None).await;
    let mut app_config_a = app_config_a;
    app_config_a.delegation.tasks.enabled = true;
    app_config_a.delegation.tasks.run_modes = vec![
        erato_config::config::TaskRunMode::Wait,
        erato_config::config::TaskRunMode::Async,
    ];
    let (app_config_b, _llm_b) = crate::test_utils::setup_mock_llm_server(None).await;
    let mut app_config_b = app_config_b;
    app_config_b.delegation.tasks.enabled = true;
    app_config_b.delegation.tasks.run_modes = app_config_a.delegation.tasks.run_modes.clone();

    // Two AppStates over one pool: two managers, two in-memory task maps, one
    // database. Neither can see the other's map.
    let replica_a = test_app_state(app_config_a, pool.clone()).await;
    let replica_b = test_app_state(app_config_b, pool.clone()).await;

    let me = erato::models::user::get_or_create_user(
        &replica_a.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(replica_a.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &replica_a,
        &me.id.to_string(),
        origin_chat_id,
        Some("TWO-MANAGER-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;
    replica_b.global_policy_engine.invalidate_data().await;

    let policy_a = rebuilt_policy(&replica_a).await;
    let policy_b = rebuilt_policy(&replica_b).await;
    let profile = me_profile(&replica_a, &me).await;
    let (first, second) = tokio::join!(
        erato::services::task_delivery::deliver_task_result(
            &replica_a, &policy_a, &profile, child_id
        ),
        erato::services::task_delivery::deliver_task_result(
            &replica_b, &policy_b, &profile, child_id
        ),
    );

    let mut outcomes = [first, second];
    outcomes.sort_by_key(|outcome| format!("{outcome:?}"));
    assert_eq!(
        outcomes,
        [
            erato::services::task_delivery::DeliveryOutcome::Delivered,
            erato::services::task_delivery::DeliveryOutcome::Skipped,
        ],
        "across replicas the claim must still admit exactly one winner"
    );
    let result_rows = active_thread_rows(&replica_a.db, origin_chat_id)
        .await
        .into_iter()
        .filter(|row| {
            row.input_parameters
                .as_ref()
                .is_some_and(|parameters| !parameters["task_result"].is_null())
        })
        .count();
    assert_eq!(result_rows, 1, "one delivery, one row, two replicas");
}

/// The regenerate and edit tails drain too.
///
/// All five call sites were wired, and until now only three were tested —
/// deleting either of these two left the whole suite green. A delivery owed to
/// a chat whose user then regenerates or edits would simply wait for some other
/// turn to come along.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_regenerate_and_edit_tails_drain_pending_deliveries(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post().path("/v1/chat/completions");
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["TAIL-DRAIN-ANSWER"]),
        );
    });
    let (app_state, _llm) = task_state(pool, mocks, &["erato/delegate_task"], |config| {
        config.delegation.tasks.run_modes = vec![
            erato_config::config::TaskRunMode::Wait,
            erato_config::config::TaskRunMode::Async,
        ];
    })
    .await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());

    // A real turn, so there is an assistant row to regenerate and a user row to edit.
    let chat = create_chat(&server, None).await;
    let chat_id = Uuid::parse_str(&chat).unwrap();
    let events = submit_with_facets(&server, &chat, "tail drain question", &[]).await;
    let assistant_message_id = events
        .iter()
        .find_map(|event| {
            serde_json::from_str::<Value>(&event.data)
                .ok()
                .filter(|json| json["message_type"] == "assistant_message_completed")
                .and_then(|json| {
                    json["message_id"]
                        .as_str()
                        .and_then(|id| Uuid::parse_str(id).ok())
                })
        })
        .expect("an assistant row to regenerate");
    let user_message_id = erato::db::entity::prelude::Messages::find_by_id(assistant_message_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .unwrap()
        .previous_message_id
        .expect("the user turn");

    for (label, request) in [
        (
            "regenerate",
            (
                "/api/v1beta/me/messages/regeneratestream",
                json!({ "current_message_id": assistant_message_id.to_string() }),
            ),
        ),
        (
            "edit",
            (
                "/api/v1beta/me/messages/editstream",
                json!({
                    "message_id": user_message_id.to_string(),
                    "replace_user_message": "tail drain question, edited",
                }),
            ),
        ),
    ] {
        let child_id = seed_child_owing_a_result(
            &app_state,
            &me.id.to_string(),
            chat_id,
            Some("TAIL-DRAIN-RESULT"),
            erato_config::config::TaskScheduling::Silent,
        )
        .await;
        assert_eq!(
            delivery_of(&app_state, child_id).await["state"],
            "pending",
            "{label}: the delivery must start owed"
        );

        let (path, body) = request;
        let response = server
            .post(path)
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&body)
            .await;
        response.assert_status_ok();

        assert_eq!(
            delivery_of(&app_state, child_id).await["state"],
            "delivered",
            "{label}: its tail must drain what the chat is owed"
        );
    }
}

// ---------------------------------------------------------------------------
// The backstop sweep (ERMAIN-781-A)
// ---------------------------------------------------------------------------

/// One pass of the backstop sweep, with the deployment's own bounds.
async fn sweep_once(
    app_state: &erato::state::AppState,
) -> erato::services::task_delivery::SweepOutcome {
    erato::services::task_delivery::sweep_task_result_deliveries(
        &app_state.db,
        app_state.config.delegation.result_max_chars,
        app_state.config.generation_status.stale_after_secs,
    )
    .await
}

/// A child's stored delivery envelope, as the struct the delivery code writes.
async fn delivery_struct(
    app_state: &erato::state::AppState,
    child_chat_id: Uuid,
) -> erato::models::chat::ResultDelivery {
    serde_json::from_value(delivery_of(app_state, child_chat_id).await).expect("delivery envelope")
}

/// Overwrite a child's stored delivery envelope.
///
/// Goes through `serde_json::to_value` on the real struct rather than patching
/// the JSON by hand, so a staged `claimed_at` is byte-for-byte the string the
/// delivery path would have written — which is what makes the sweep's
/// `::timestamptz` cast a real round-trip assertion rather than a test fixture
/// agreeing with itself.
async fn write_delivery(
    app_state: &erato::state::AppState,
    child_chat_id: Uuid,
    delivery: &erato::models::chat::ResultDelivery,
) {
    let chat = erato::db::entity::chats::Entity::find_by_id(child_chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("child chat");
    let mut configuration = chat.assistant_configuration.clone().expect("configuration");
    configuration["provenance"]["result_delivery"] =
        serde_json::to_value(delivery).expect("serialize delivery");
    let mut active: erato::db::entity::chats::ActiveModel = chat.into();
    active.assistant_configuration = ActiveValue::Set(Some(configuration));
    active.update(&app_state.db).await.expect("write delivery");
}

/// The rows of a chat that carry a delivered task result.
async fn task_result_rows(
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
) -> Vec<erato::db::entity::messages::Model> {
    chat_messages_by_created_at(db, chat_id)
        .await
        .into_iter()
        .filter(|row| {
            row.input_parameters
                .as_ref()
                .is_some_and(|parameters| !parameters["task_result"].is_null())
        })
        .collect()
}

/// Hand-stage delegated `async` children owing a result to `origin_chat_id`.
///
/// Written straight into the column rather than dispatched. What the sweep has
/// to recover is a row left behind by a run whose own process is gone, so a row
/// is the honest fixture — and the batch tests below stage two hundred of them,
/// which as real dispatches would measure dispatch throughput instead of the
/// sweep's bound.
async fn stage_owed_children(
    db: &sea_orm::DatabaseConnection,
    owner_user_id: &str,
    origin_chat_id: Uuid,
    count: usize,
    staged_at: sea_orm::prelude::DateTimeWithTimeZone,
) -> Vec<Uuid> {
    let mut ids = Vec::with_capacity(count);
    let mut rows = Vec::with_capacity(count);
    for _ in 0..count {
        let id = Uuid::new_v4();
        ids.push(id);
        rows.push(erato::db::entity::chats::ActiveModel {
            id: ActiveValue::Set(id),
            owner_user_id: ActiveValue::Set(owner_user_id.to_string()),
            assistant_configuration: ActiveValue::Set(Some(json!({
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
                        "at": staged_at,
                    },
                },
                "task": {"scheduling": "silent", "parent_tool_call_id": "call_staged"},
            }))),
            created_at: ActiveValue::Set(staged_at),
            updated_at: ActiveValue::Set(staged_at),
            ..Default::default()
        });
    }
    erato::db::entity::chats::Entity::insert_many(rows)
        .exec(db)
        .await
        .expect("stage owed children");
    ids
}

/// A plain chat row to deliver into, without going through the API.
async fn insert_plain_chat(
    db: &sea_orm::DatabaseConnection,
    owner_user_id: &str,
    created_at: sea_orm::prelude::DateTimeWithTimeZone,
) -> Uuid {
    let id = Uuid::new_v4();
    erato::db::entity::chats::Entity::insert(erato::db::entity::chats::ActiveModel {
        id: ActiveValue::Set(id),
        owner_user_id: ActiveValue::Set(owner_user_id.to_string()),
        created_at: ActiveValue::Set(created_at),
        updated_at: ActiveValue::Set(created_at),
        ..Default::default()
    })
    .exec(db)
    .await
    .expect("insert chat");
    id
}

/// T6. A claim whose holder died comes back and is delivered in the SAME pass.
///
/// Splitting the two phases across ticks would make the worst case for a
/// stranded result ten minutes rather than five, for no gain. This is also the
/// one place the `claimed_at` round-trip is asserted: the staleness clock reads
/// a timestamp Rust serialized with `jsonb #>> … ::timestamptz`, and a
/// disagreement about that format would silently make every claim look ancient
/// (or none of them).
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn sweep_requeues_stale_claimed_to_pending(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let stranded = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("STRANDED-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;
    let live = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("LIVE-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;

    // The replica that claimed `stranded` is gone; the one holding `live` is
    // working on it right now. Only the clock tells them apart.
    let stale_after = app_state.config.generation_status.stale_after_secs as i64;
    for (child, age_secs, token) in [
        (stranded, stale_after * 10, "dead-replica-claim"),
        (live, 0, "live-replica-claim"),
    ] {
        let mut delivery = delivery_struct(&app_state, child).await;
        delivery.state = erato::models::chat::ResultDeliveryState::Claimed;
        delivery.claimed_by = Some(token.to_string());
        delivery.claimed_at =
            Some((sqlx::types::chrono::Utc::now() - chrono::Duration::seconds(age_secs)).into());
        delivery.attempts = 1;
        write_delivery(&app_state, child, &delivery).await;
    }

    let outcome = sweep_once(&app_state).await;
    assert_eq!(
        outcome.requeued, 1,
        "exactly the stale claim comes back; a claim someone is still working \
         must not be seized. If this is 0 or 2 the `::timestamptz` cast is not \
         reading what Rust wrote."
    );
    assert_eq!(
        outcome.delivered, 1,
        "the requeued claim is delivered in the same pass, not the next tick"
    );

    let recovered = delivery_struct(&app_state, stranded).await;
    assert_eq!(
        recovered.state,
        erato::models::chat::ResultDeliveryState::Delivered
    );
    assert_ne!(
        recovered.claimed_by.as_deref(),
        Some("dead-replica-claim"),
        "the seizure must mint a new fencing token, or the dead holder's own \
         compare-and-set would still match"
    );

    let untouched = delivery_struct(&app_state, live).await;
    assert_eq!(
        untouched.state,
        erato::models::chat::ResultDeliveryState::Claimed
    );
    assert_eq!(untouched.claimed_by.as_deref(), Some("live-replica-claim"));
}

/// T7. The sweep delivers, and stops. No lease, no turn, no reaction.
///
/// It runs under nobody's request: there is no attached stream to announce to,
/// no profile to speak as and no policy engine to authorize with. Reacting to
/// the row is `/react` or the user's own next message.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn sweep_appends_task_result_and_marks_delivered_without_reaction(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    // `when_idle` on purpose: the live path would answer this one, and the
    // sweep deliberately does not.
    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("SWEPT-ANSWER"),
        erato_config::config::TaskScheduling::WhenIdle,
    )
    .await;

    let outcome = sweep_once(&app_state).await;
    assert_eq!(outcome.delivered, 1);

    let rows = task_result_rows(&app_state.db, origin_chat_id).await;
    assert_eq!(rows.len(), 1, "one delivery, one row");
    let row = &rows[0];
    assert_eq!(row.raw_message["role"], "user");
    assert_eq!(row.raw_message["content"][0]["content_type"], "task_result");
    assert_eq!(
        row.raw_message["content"][0]["summary"], "SWEPT-ANSWER",
        "the summary comes from the awaited path's own envelope builder"
    );
    assert_eq!(
        row.input_parameters.as_ref().expect("marker")["task_result"]["scheduling"],
        "when_idle"
    );

    let delivery = delivery_struct(&app_state, child_id).await;
    assert_eq!(
        delivery.state,
        erato::models::chat::ResultDeliveryState::Delivered,
        "`delivered`, never `reacted`: nothing reacted"
    );
    assert_eq!(delivery.message_id, Some(row.id));

    let origin_chat = erato::db::entity::chats::Entity::find_by_id(origin_chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        origin_chat.generation_state.is_none(),
        "the sweep takes no generation lease"
    );
    assert!(
        chat_messages_by_created_at(&app_state.db, origin_chat_id)
            .await
            .iter()
            .all(|row| row.raw_message["role"] != "assistant"),
        "no turn ran, so no assistant row may exist"
    );
}

/// T8. The crash-after-insert shape: the row is in the conversation but the
/// delivery never got marked. A second pass must reuse the row, not write it
/// again — in the user's own conversation.
///
/// Deliberately not "run the sweep twice": after the first pass the state is
/// `delivered`, so the second pass never scans the row and the test would pass
/// with the duplicate probe deleted.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn sweep_skips_a_delivery_whose_row_already_exists(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("ONCE-ONLY-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;

    assert_eq!(sweep_once(&app_state).await.delivered, 1);
    let first = task_result_rows(&app_state.db, origin_chat_id).await;
    assert_eq!(first.len(), 1);

    // The crash: the row committed, the state write did not. Forced back under
    // the same delivery id, exactly as a stale-claim requeue leaves it.
    let mut delivery = delivery_struct(&app_state, child_id).await;
    delivery.state = erato::models::chat::ResultDeliveryState::Pending;
    delivery.claimed_by = None;
    delivery.claimed_at = None;
    write_delivery(&app_state, child_id, &delivery).await;

    assert_eq!(sweep_once(&app_state).await.delivered, 1);
    let second = task_result_rows(&app_state.db, origin_chat_id).await;
    assert_eq!(
        second.len(),
        1,
        "the delivery id is the idempotency key; a re-sweep must find its own row"
    );
    assert_eq!(second[0].id, first[0].id);
    assert_eq!(
        delivery_struct(&app_state, child_id).await.state,
        erato::models::chat::ResultDeliveryState::Delivered
    );
}

/// T10. Fairness. A deferred child that wrote nothing keeps its old
/// `updated_at`, sorts to the front of every future pass, and — because the
/// scan is bounded — hides everything behind it forever.
///
/// An origin parked on an approval never ages out, so "it will clear eventually"
/// is not an answer.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn sweep_rotates_deferred_children_behind_fresh_pending_ones(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let me_id = me.id.to_string();
    let limit = erato::services::task_delivery::SWEEP_BATCH_LIMIT as usize;

    let old: sea_orm::prelude::DateTimeWithTimeZone =
        (sqlx::types::chrono::Utc::now() - chrono::Duration::hours(2)).into();
    let newer: sea_orm::prelude::DateTimeWithTimeZone =
        (sqlx::types::chrono::Utc::now() - chrono::Duration::hours(1)).into();

    // A whole batch owed to one origin that is parked on an approval it will
    // never get an answer to.
    let blocked_origin = insert_plain_chat(&app_state.db, &me_id, old).await;
    set_generation_lease(&app_state.db, blocked_origin, Some("awaiting_approval"), 0).await;
    stage_owed_children(&app_state.db, &me_id, blocked_origin, limit, old).await;

    // And one behind them, owed to an origin that is free.
    let free_origin = insert_plain_chat(&app_state.db, &me_id, newer).await;
    let fresh = stage_owed_children(&app_state.db, &me_id, free_origin, 1, newer).await[0];

    let first = sweep_once(&app_state).await;
    assert_eq!(first.deferred, limit as u64);
    assert_eq!(
        first.delivered, 0,
        "the batch limit must hide the fresh child on the first pass"
    );

    let second = sweep_once(&app_state).await;
    assert_eq!(
        second.delivered, 1,
        "the deferred batch must rotate to the back, or the child behind it \
         is starved on every pass forever"
    );
    assert_eq!(
        delivery_struct(&app_state, fresh).await.state,
        erato::models::chat::ResultDeliveryState::Delivered
    );
}

/// T11. The free-lease subquery. A result must never land under a running turn
/// or on top of an approval card the user is looking at.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn sweep_leaves_pending_when_origin_lease_is_fresh_or_awaiting_approval(
    pool: Pool<Postgres>,
) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let me_id = me.id.to_string();
    let now: sea_orm::prelude::DateTimeWithTimeZone = sqlx::types::chrono::Utc::now().into();

    let mut children = Vec::new();
    for state in ["running", "awaiting_approval"] {
        let origin = insert_plain_chat(&app_state.db, &me_id, now).await;
        set_generation_lease(&app_state.db, origin, Some(state), 0).await;
        let child = stage_owed_children(&app_state.db, &me_id, origin, 1, now).await[0];
        children.push((origin, child));
    }

    let outcome = sweep_once(&app_state).await;
    assert_eq!(outcome.deferred, 2);
    assert_eq!(outcome.delivered, 0);

    for (origin, child) in &children {
        let delivery = delivery_struct(&app_state, *child).await;
        assert_eq!(
            delivery.state,
            erato::models::chat::ResultDeliveryState::Pending,
            "a deferred delivery goes back in the queue, it is not lost"
        );
        assert_eq!(
            delivery.attempts, 1,
            "the attempt is counted, so a delivery that can never land is visible"
        );
        assert!(
            task_result_rows(&app_state.db, *origin).await.is_empty(),
            "nothing may be written into a chat that is busy"
        );
    }

    // Once the origins are free the same deliveries land.
    for (origin, _) in &children {
        set_generation_lease(&app_state.db, *origin, None, 0).await;
    }
    assert_eq!(sweep_once(&app_state).await.delivered, 2);
}

/// T12. Archiving is the user saying they are done with that conversation.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn sweep_supersedes_archived_origin(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let me_id = me.id.to_string();
    let now: sea_orm::prelude::DateTimeWithTimeZone = sqlx::types::chrono::Utc::now().into();

    let origin = insert_plain_chat(&app_state.db, &me_id, now).await;
    erato::db::entity::chats::ActiveModel {
        id: ActiveValue::Unchanged(origin),
        archived_at: ActiveValue::Set(Some(now)),
        ..Default::default()
    }
    .update(&app_state.db)
    .await
    .expect("archive origin");
    let child = stage_owed_children(&app_state.db, &me_id, origin, 1, now).await[0];

    let outcome = sweep_once(&app_state).await;
    assert_eq!(outcome.superseded, 1);

    let delivery = delivery_struct(&app_state, child).await;
    assert_eq!(
        delivery.state,
        erato::models::chat::ResultDeliveryState::Superseded
    );
    assert_eq!(delivery.reason.as_deref(), Some("origin_archived"));
    assert!(
        task_result_rows(&app_state.db, origin).await.is_empty(),
        "nothing may be appended to an archived chat"
    );
}

/// T13. An archived CHILD is terminal too, and this is the only place that case
/// is resolved.
///
/// The archive cascade skips runs whose generation has not finished, so an
/// archived child is a finished one — but its delivery can still read `pending`,
/// and the "does this origin still have runs in flight" query deliberately does
/// not exclude archived children. Left `pending` it would pin that indicator on
/// forever.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn sweep_supersedes_an_archived_child(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let me_id = me.id.to_string();
    let now: sea_orm::prelude::DateTimeWithTimeZone = sqlx::types::chrono::Utc::now().into();

    let origin = insert_plain_chat(&app_state.db, &me_id, now).await;
    let child = stage_owed_children(&app_state.db, &me_id, origin, 1, now).await[0];
    erato::db::entity::chats::ActiveModel {
        id: ActiveValue::Unchanged(child),
        archived_at: ActiveValue::Set(Some(now)),
        ..Default::default()
    }
    .update(&app_state.db)
    .await
    .expect("archive child");

    let outcome = sweep_once(&app_state).await;
    assert_eq!(outcome.superseded, 1);

    let delivery = delivery_struct(&app_state, child).await;
    assert_eq!(
        delivery.state,
        erato::models::chat::ResultDeliveryState::Superseded
    );
    assert_eq!(delivery.reason.as_deref(), Some("child_archived"));
    assert!(
        task_result_rows(&app_state.db, origin).await.is_empty(),
        "an archived run's result is not delivered"
    );
}

/// T14. The security test of this PR. The sweep holds no `PolicyEngine`, so the
/// `submit_message` rule — which is ownership-only — is evaluated by hand, and
/// this is the only coverage of that rule in the whole delivery stack.
///
/// Writing into a chat whose owner differs from the run's is the ERMAIN-485
/// class. The refusal appending nothing is the point.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn sweep_owner_mismatch_marks_failed(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let stranger = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        "someone-else-entirely",
        None,
    )
    .await
    .unwrap();
    let now: sea_orm::prelude::DateTimeWithTimeZone = sqlx::types::chrono::Utc::now().into();

    let foreign_origin = insert_plain_chat(&app_state.db, &stranger.id.to_string(), now).await;
    let child =
        stage_owed_children(&app_state.db, &me.id.to_string(), foreign_origin, 1, now).await[0];

    let outcome = sweep_once(&app_state).await;
    assert_eq!(outcome.failed, 1);

    let delivery = delivery_struct(&app_state, child).await;
    assert_eq!(
        delivery.state,
        erato::models::chat::ResultDeliveryState::Failed
    );
    assert_eq!(delivery.reason.as_deref(), Some("owner_mismatch"));
    assert!(
        task_result_rows(&app_state.db, foreign_origin)
            .await
            .is_empty(),
        "a result must never land in a chat belonging to someone else"
    );
}

/// T15. A run whose answer row is gone is still delivered, as a failure.
///
/// The run's preamble promised the origin model a result. Silence is the worse
/// failure: it invites the model to move on from work that never reported.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn sweep_delivers_a_failed_result_missing_row_when_the_child_answer_is_gone(
    pool: Pool<Postgres>,
) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        None,
        erato_config::config::TaskScheduling::Silent,
    )
    .await;

    let outcome = sweep_once(&app_state).await;
    assert_eq!(
        outcome.delivered, 1,
        "a failed task is still news the origin model needs"
    );
    assert_eq!(outcome.failed, 0, "the delivery did not fail; the run did");

    let rows = task_result_rows(&app_state.db, origin_chat_id).await;
    assert_eq!(rows.len(), 1);
    let part = &rows[0].raw_message["content"][0];
    assert_eq!(part["status"], "failed");
    assert_eq!(part["reason"], "result_missing");
    assert_eq!(part["summary"], "", "there is no answer to summarize");
    assert!(
        rows[0].input_parameters.as_ref().expect("marker")["task_result"]["result_message_id"]
            .is_null(),
        "there is no answer row to point at"
    );
    assert_eq!(
        delivery_struct(&app_state, child_id).await.state,
        erato::models::chat::ResultDeliveryState::Delivered
    );
}

/// T16. One pass is bounded; a deeper backlog is the next tick's, five minutes
/// later. A tick that tried to drain an unbounded queue would hold a pool
/// connection for as long as the backlog is deep.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn sweep_bounds_a_pass_to_the_batch_limit(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let me_id = me.id.to_string();
    let limit = erato::services::task_delivery::SWEEP_BATCH_LIMIT as usize;
    let now: sea_orm::prelude::DateTimeWithTimeZone = sqlx::types::chrono::Utc::now().into();

    let origin = insert_plain_chat(&app_state.db, &me_id, now).await;
    let staged = stage_owed_children(&app_state.db, &me_id, origin, limit + 3, now).await;

    let first = sweep_once(&app_state).await;
    assert_eq!(
        first.delivered, limit as u64,
        "a pass must stop at the batch limit"
    );

    let mut still_pending = 0;
    for child in &staged {
        if delivery_struct(&app_state, *child).await.state
            == erato::models::chat::ResultDeliveryState::Pending
        {
            still_pending += 1;
        }
    }
    assert_eq!(
        still_pending, 3,
        "the overflow stays `pending`; it is deferred work, not lost work"
    );

    let second = sweep_once(&app_state).await;
    assert_eq!(second.delivered, 3, "the rest is the next tick's work");
}

// ---------------------------------------------------------------------------
// POST /me/chats/{chat_id}/react (ERMAIN-781-B)
// ---------------------------------------------------------------------------

/// A task-enabled, async-enabled state whose LLM answers everything with one
/// sentence, plus the recorder that captured the request bodies.
///
/// `/react` runs the origin chat's normal generation machinery, so every one of
/// these tests that gets past the preconditions needs a model to answer; the
/// recorder is what lets the reaction's own request be told apart from the
/// conversation around it.
async fn react_state(
    pool: Pool<Postgres>,
    answer: &'static str,
) -> (
    erato::state::AppState,
    mocktail::server::MockServer,
    RequestBodyRecorder,
) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&[answer]),
            );
        });
    }
    let (app_state, llm) = task_state(pool, mocks, &["erato/delegate_task"], |config| {
        config.delegation.tasks.run_modes = vec![
            erato_config::config::TaskRunMode::Wait,
            erato_config::config::TaskRunMode::Async,
        ];
    })
    .await;
    (app_state, llm, recorder)
}

/// Leave the origin chat holding exactly the state `/react` exists for: a
/// `task_result` row on the active thread, its delivery `delivered`, and
/// nothing having answered it.
///
/// Staged through 781-A's backstop sweep rather than by hand. The sweep is
/// DB-only and stops at `delivered` for a `silent` result, which is precisely
/// the row a client asks to react to — so this also exercises the A-to-B seam
/// for free, and a fixture that agreed with itself would not.
///
/// Returns the child chat's id and the delivered `task_result` row's id.
async fn stage_delivered_result(
    app_state: &erato::state::AppState,
    owner_user_id: &str,
    origin_chat_id: Uuid,
    answer: &str,
) -> (Uuid, Uuid) {
    let child_id = seed_child_owing_a_result(
        app_state,
        owner_user_id,
        origin_chat_id,
        Some(answer),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;
    assert_eq!(
        sweep_once(app_state).await.delivered,
        1,
        "the sweep must have delivered the seeded result"
    );
    let delivery = delivery_struct(app_state, child_id).await;
    assert_eq!(
        delivery.state,
        erato::models::chat::ResultDeliveryState::Delivered
    );
    (
        child_id,
        delivery.message_id.expect("the delivery names its row"),
    )
}

/// POST `/me/chats/{chat_id}/react` as the given bearer.
async fn post_react_as(
    server: &TestServer,
    token: &str,
    chat_id: Uuid,
    task_result_message_id: Uuid,
) -> axum_test::TestResponse {
    server
        .post(&format!("/api/v1beta/me/chats/{chat_id}/react"))
        .with_bearer_token(token)
        .json(&json!({ "task_result_message_id": task_result_message_id }))
        .await
}

/// POST `/me/chats/{chat_id}/react` as the test user.
async fn post_react(
    server: &TestServer,
    chat_id: Uuid,
    task_result_message_id: Uuid,
) -> axum_test::TestResponse {
    post_react_as(server, TEST_JWT_TOKEN, chat_id, task_result_message_id).await
}

/// The test user, created.
async fn test_user(app_state: &erato::state::AppState) -> erato::db::entity::users::Model {
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap()
}

/// T1. The route runs the reaction turn the live delivery path would have run,
/// and records that it did.
///
/// Three properties in one turn, because they are one decision: the turn is
/// composed from the delivered result (the `task_result` part reaches the
/// model), it is stamped as a reaction rather than as a person's turn
/// (`initiator = task_result`, which is what 782 will read), and the delivery
/// ladder is advanced to `reacted` against that very assistant row. Nothing
/// else in the tree writes that last transition on this path, so without it the
/// route is silently re-runnable forever.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn react_runs_reaction_under_request_profile_and_marks_reacted(pool: Pool<Postgres>) {
    let (app_state, _llm, recorder) = react_state(pool, "REACT-ANSWER").await;
    let me = test_user(&app_state).await;
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let (child_id, result_row_id) = stage_delivered_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        "REACTABLE-ANSWER",
    )
    .await;

    let response = post_react(&server, origin_chat_id, result_row_id).await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    assert!(
        extract_full_text_answer(&events).contains("REACT-ANSWER"),
        "the route must stream the reaction turn, not an empty socket: {events:?}"
    );

    // `StreamEnd` is broadcast BEFORE `remove_task`, so the bookkeeping can
    // still be in flight when the stream closes. Poll, never chain off the end
    // of the stream.
    let state = wait_for_delivery_state(&app_state.db, child_id, &["reacted"]).await;
    assert_eq!(state, "reacted");

    let rows = active_thread_rows(&app_state.db, origin_chat_id).await;
    let reaction = rows
        .iter()
        .find(|row| {
            row.generation_parameters
                .as_ref()
                .is_some_and(|parameters| parameters["initiator"] == "task_result")
        })
        .expect("the reaction row must say a task result started the turn");
    assert_eq!(
        delivery_struct(&app_state, child_id)
            .await
            .reaction_message_id,
        Some(reaction.id),
        "the delivery must point at the assistant row that answered it, not at \
         the lease's pre-generation id"
    );
    assert!(
        rows.iter().position(|row| row.id == result_row_id)
            < rows.iter().position(|row| row.id == reaction.id),
        "the reaction must come after the result it answers"
    );
    assert!(
        recorder
            .bodies()
            .iter()
            .any(|body| body.contains("REACTABLE-ANSWER")),
        "the delivered result must be composed into the reaction's own request"
    );
}

/// T2. A second `/react` on an answered row is refused, and appends nothing.
///
/// `already_reacted` rather than `tip_moved`: once the reaction has run the
/// assistant row IS the tip, so both preconditions would fire, and the two tell
/// a client opposite things — suppress the affordance, or offer a re-anchor.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn react_409_nothing_to_react_when_already_reacted(pool: Pool<Postgres>) {
    let (app_state, _llm, _recorder) = react_state(pool, "REACT-ONCE").await;
    let me = test_user(&app_state).await;
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let (child_id, result_row_id) = stage_delivered_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        "ONCE-ANSWER",
    )
    .await;

    post_react(&server, origin_chat_id, result_row_id)
        .await
        .assert_status_ok();
    wait_for_delivery_state(&app_state.db, child_id, &["reacted"]).await;
    let after_first = active_thread_rows(&app_state.db, origin_chat_id)
        .await
        .len();

    let second = post_react(&server, origin_chat_id, result_row_id).await;
    assert_eq!(second.status_code(), axum::http::StatusCode::CONFLICT);
    let body: Value = second.json();
    assert_eq!(body["code"], "nothing_to_react");
    assert_eq!(body["reason"], "already_reacted");
    assert_eq!(body["chat_id"], origin_chat_id.to_string());
    assert_eq!(body["task_result_message_id"], result_row_id.to_string());
    assert_eq!(
        active_thread_rows(&app_state.db, origin_chat_id)
            .await
            .len(),
        after_first,
        "a refused second reaction must not write a second assistant row"
    );
}

/// T3. A result the conversation has moved past is refused with `tip_moved`.
///
/// Appending a reaction behind a newer user row would put the model's answer to
/// a finished task in the middle of a branch nobody is reading.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn react_409_nothing_to_react_when_the_tip_moved(pool: Pool<Postgres>) {
    let (app_state, _llm, _recorder) = react_state(pool, "MOVED-ON").await;
    let me = test_user(&app_state).await;
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let (_child_id, result_row_id) = stage_delivered_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        "STALE-ANSWER",
    )
    .await;

    // A second task finished before anyone pressed the affordance on the
    // first, so its row is now what the conversation is sitting on. Staged this
    // way rather than with a typed user message because a delivered result is
    // a USER row, and the submit route refuses to anchor a new message on one.
    stage_delivered_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        "NEWER-ANSWER",
    )
    .await;

    let response = post_react(&server, origin_chat_id, result_row_id).await;
    assert_eq!(response.status_code(), axum::http::StatusCode::CONFLICT);
    let body: Value = response.json();
    assert_eq!(body["code"], "nothing_to_react");
    assert_eq!(body["reason"], "tip_moved");
}

/// T4. A held generation lease refuses the reaction rather than displacing it.
///
/// `RefuseParked`, not the user helper's `TakeParked`: the content this turn
/// runs on was written by the server, and what it would displace is a decision
/// the person is in the middle of. The body is 776's, and `started_at` is
/// passed through exactly as the lease reported it — it is already RFC 3339, so
/// re-formatting it here would be a second opinion about the wire shape.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn react_409_generation_running_when_lease_held(pool: Pool<Postgres>) {
    let (app_state, _llm, _recorder) = react_state(pool, "NEVER-RUNS").await;
    let me = test_user(&app_state).await;
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let (child_id, result_row_id) = stage_delivered_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        "HELD-ANSWER",
    )
    .await;

    // Somebody else is generating in this chat right now, with a fresh
    // heartbeat, so the lease is not stale.
    crate::api::generating::mark_running(&app_state.db, origin_chat_id, 0).await;

    let response = post_react(&server, origin_chat_id, result_row_id).await;
    assert_eq!(response.status_code(), axum::http::StatusCode::CONFLICT);
    let body: Value = response.json();
    assert_eq!(body["code"], "generation_running");
    assert_eq!(body["chat_id"], origin_chat_id.to_string());
    assert!(
        body["started_at"]
            .as_str()
            .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
            .is_some(),
        "the holder's start time must reach the client as the RFC 3339 string \
         the lease already had: {body}"
    );
    assert_eq!(
        delivery_struct(&app_state, child_id).await.state,
        erato::models::chat::ResultDeliveryState::Delivered,
        "a refused reaction must leave the ladder where it found it"
    );
}

/// T4b. A chat parked on a tool approval stays parked.
///
/// The half of the lease decision a held `running` lease cannot pin: with
/// `Takeover::TakeParked` — what the user-initiated sibling passes — this
/// request would succeed, because a parked chat is claimable by a person
/// asking for the turn. `/react` asks for a SYSTEM turn over content the
/// server wrote, and displacing a decision somebody is in the middle of is not
/// its call to make, so it refuses and leaves the card where it is.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn react_409_leaves_a_chat_parked_on_an_approval(pool: Pool<Postgres>) {
    let (app_state, _llm, recorder) = react_state(pool, "MUST-NOT-RUN").await;
    let me = test_user(&app_state).await;
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let (child_id, result_row_id) = stage_delivered_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        "PARKED-ANSWER",
    )
    .await;

    // The person is mid-decision on a tool approval in this very chat.
    crate::api::generating::mark_awaiting_approval(&app_state.db, origin_chat_id).await;

    let response = post_react(&server, origin_chat_id, result_row_id).await;
    assert_eq!(response.status_code(), axum::http::StatusCode::CONFLICT);
    let body: Value = response.json();
    assert_eq!(body["code"], "generation_running");

    let origin_row = erato::db::entity::chats::Entity::find_by_id(origin_chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("origin chat");
    assert_eq!(
        origin_row.generation_state.as_deref(),
        Some("awaiting_approval"),
        "the approval the person is answering must survive the refused reaction"
    );
    assert_eq!(
        delivery_struct(&app_state, child_id).await.state,
        erato::models::chat::ResultDeliveryState::Delivered,
        "a refused reaction must leave the ladder where it found it"
    );
    assert!(
        recorder.bodies().is_empty(),
        "the refused request must not have reached a model at all"
    );
}

/// T5. A chat the caller does not own answers 404, and runs nothing.
///
/// **The security test of this PR** — the ERMAIN-485 class. The caller here can
/// genuinely read the conversation, through an enabled share link, and still
/// may not start a turn in it: the route authorizes `SubmitMessage` on its own
/// rather than inheriting whatever gate some read helper happens to apply.
/// Refused and "the authorizer broke" are both 404, never 403, so a prober
/// cannot use the status to learn that the chat exists.
///
/// The read the share link grants is `Action::SharedRead` — "any logged-in
/// user, while the link is enabled and the chat is not archived" — so that is
/// the action this fixture discriminates against, and authorizing it here
/// instead of `SubmitMessage` makes this test answer 200. `Action::Read` is
/// denied to a non-owner too, so downgrading to it would NOT be caught here:
/// `SharedRead` is the privilege a reader actually holds, and the one a
/// mutation has to reach for.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn react_404_for_a_chat_the_user_may_only_read(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post().path("/v1/chat/completions").matcher(recorder);
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&["MUST-NOT-RUN"]),
            );
        });
    }
    let (app_state, _llm) = task_state(pool, mocks, &["erato/delegate_task"], |config| {
        config.delegation.tasks.run_modes = vec![
            erato_config::config::TaskRunMode::Wait,
            erato_config::config::TaskRunMode::Async,
        ];
        config.chat_sharing.enabled = true;
    })
    .await;

    // The chat, and the delivered result in it, belong to somebody else.
    let owner_subject = "react-foreign-chat-owner";
    let owner = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        owner_subject,
        None,
    )
    .await
    .unwrap();
    let _reader = test_user(&app_state).await;
    let owner_token = JwtTokenBuilder::new()
        .subject(owner_subject)
        .email("owner@example.com")
        .name("owner")
        .build();
    let server = app_server(app_state.clone());

    let origin_response = server
        .post("/api/v1beta/me/chats")
        .with_bearer_token(&owner_token)
        .json(&json!({}))
        .await;
    origin_response.assert_status_ok();
    let origin = origin_response.json::<Value>()["chat_id"]
        .as_str()
        .unwrap()
        .to_string();
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let (child_id, result_row_id) = stage_delivered_result(
        &app_state,
        &owner.id.to_string(),
        origin_chat_id,
        "FOREIGN-ANSWER",
    )
    .await;

    // The owner shares it for reading. That is read access, and nothing more.
    server
        .put("/api/v1beta/share-links")
        .with_bearer_token(&owner_token)
        .add_header(http::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "resource_type": "chat",
            "resource_id": origin,
            "enabled": true,
        }))
        .await
        .assert_status_ok();
    app_state.global_policy_engine.invalidate_data().await;

    let response = post_react(&server, origin_chat_id, result_row_id).await;
    assert_eq!(
        response.status_code(),
        axum::http::StatusCode::NOT_FOUND,
        "a reader must not be able to start a turn in somebody else's chat, \
         and must not learn from the status that it exists"
    );
    assert_eq!(
        delivery_struct(&app_state, child_id).await.state,
        erato::models::chat::ResultDeliveryState::Delivered
    );
    assert!(
        recorder.bodies().is_empty(),
        "the refused request must not have reached a model at all"
    );
}

/// T5b. A row that lives in another chat is as unreachable as a row that does
/// not exist anywhere.
///
/// Precondition 7 compares the row's own `chat_id` with the one in the path
/// before anything else looks at the row. Without that comparison the route
/// answers 404 only for an id no row has, and a typed 409 `nothing_to_react`
/// for any id that exists anywhere in the `messages` table — an existence
/// oracle over every chat in the deployment, and, for a genuinely delivered
/// result, a read of that foreign row's child chat on top of it. The path id
/// is the only thing that scopes the lookup, so this pins the comparison
/// itself with two chats of the caller's own; the ownership half of the same
/// story is T5's.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn react_404_for_a_task_result_row_in_another_chat(pool: Pool<Postgres>) {
    let (app_state, _llm, recorder) = react_state(pool, "MUST-NOT-RUN").await;
    let me = test_user(&app_state).await;
    let server = app_server(app_state.clone());

    // The chat that genuinely holds a delivered result.
    let holder = create_chat(&server, None).await;
    let holder_chat_id = Uuid::parse_str(&holder).unwrap();
    let (child_id, result_row_id) = stage_delivered_result(
        &app_state,
        &me.id.to_string(),
        holder_chat_id,
        "OTHER-CHAT-ANSWER",
    )
    .await;

    // A second chat of the same person's, with nothing delivered into it.
    let target = create_chat(&server, None).await;
    let target_chat_id = Uuid::parse_str(&target).unwrap();

    let response = post_react(&server, target_chat_id, result_row_id).await;
    assert_eq!(
        response.status_code(),
        axum::http::StatusCode::NOT_FOUND,
        "a row that is not in this chat must be answered exactly like a row \
         that does not exist, never with a 409 that confirms it exists"
    );

    let target_row = erato::db::entity::chats::Entity::find_by_id(target_chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("target chat");
    assert_eq!(
        target_row.generation_state, None,
        "the comparison runs before the lease, so nothing may have been taken"
    );
    assert!(
        recorder.bodies().is_empty(),
        "the refused request must not have reached a model at all"
    );
    assert_eq!(
        delivery_struct(&app_state, child_id).await.state,
        erato::models::chat::ResultDeliveryState::Delivered,
        "and the other chat's delivery must be left exactly as it was"
    );
}

/// T6. With async delivery off, the route does not exist — even over a row that
/// genuinely is delivered.
///
/// The gate is the first precondition, before the lease, so a deployment that
/// turns the feature off cannot have turns started through this door by a
/// client that remembers it. The row is staged by a deployment that had the
/// feature on, because that is the real migration story: the flag goes off
/// while delivered results are already on disk.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn react_404_when_async_delivery_is_off(pool: Pool<Postgres>) {
    let (staging_state, _staging_llm, _staging_recorder) =
        react_state(pool.clone(), "STAGING-ONLY").await;
    let me = test_user(&staging_state).await;
    let staging_server = app_server(staging_state.clone());
    let origin = create_chat(&staging_server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();
    let (child_id, result_row_id) = stage_delivered_result(
        &staging_state,
        &me.id.to_string(),
        origin_chat_id,
        "GATED-ANSWER",
    )
    .await;

    // The same database, served by a deployment that offers `wait` only.
    let (gated_state, _llm) =
        task_state(pool, MockSet::new(), &["erato/delegate_task"], |config| {
            config.delegation.tasks.run_modes = vec![erato_config::config::TaskRunMode::Wait];
        })
        .await;
    let server = app_server(gated_state.clone());

    let response = post_react(&server, origin_chat_id, result_row_id).await;
    assert_eq!(response.status_code(), axum::http::StatusCode::NOT_FOUND);

    let origin_row = erato::db::entity::chats::Entity::find_by_id(origin_chat_id)
        .one(&gated_state.db)
        .await
        .unwrap()
        .expect("origin chat");
    assert_eq!(
        origin_row.generation_state, None,
        "the gate must refuse before the lease is taken, not after"
    );
    assert_eq!(
        delivery_struct(&gated_state, child_id).await.state,
        erato::models::chat::ResultDeliveryState::Delivered
    );
}

/// T7. The fifth tail: `/react` drains what the origin is still owed.
///
/// A second result recorded while the origin was busy would otherwise wait for
/// the five-minute sweep, or for the person's next message. It is one call at
/// the end of the spawned future, placed after the lifecycle's `remove_task`
/// because the delivery takes this chat's lease for itself and `RefuseParked`
/// would refuse one this turn still held.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn react_tail_drains_further_pending_deliveries(pool: Pool<Postgres>) {
    let (app_state, _llm, _recorder) = react_state(pool, "DRAINING-REACTION").await;
    let me = test_user(&app_state).await;
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let (_first_child, result_row_id) = stage_delivered_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        "FIRST-ANSWER",
    )
    .await;
    // Recorded while the origin was busy, so nothing has delivered it yet.
    // `silent`, so the drain stops at `delivered` and needs no second model
    // turn of its own.
    let second_child = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some("SECOND-ANSWER"),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;
    assert_eq!(
        delivery_struct(&app_state, second_child).await.state,
        erato::models::chat::ResultDeliveryState::Pending
    );

    post_react(&server, origin_chat_id, result_row_id)
        .await
        .assert_status_ok();

    let state = wait_for_delivery_state(&app_state.db, second_child, &["delivered"]).await;
    assert_eq!(
        state, "delivered",
        "the reaction's tail must drain what the chat is still owed"
    );
    assert_eq!(
        task_result_rows(&app_state.db, origin_chat_id).await.len(),
        2,
        "both results must be in the conversation"
    );
}

/// T8. A result the reaction turn answered is still in the conversation two
/// turns later.
///
/// The composition walk drops every user row but the one just submitted, so
/// without its dedicated `task_result` arm a delivered result would reach the
/// model on exactly one turn and then vanish from the chat that contains it.
/// That arm is 777/780's; this test pins it end to end over the row `/react`
/// itself produced, because the reaction row is what a client anchors its next
/// message on, and that anchor is the seam this PR creates. If this fails the
/// bug is upstream, not in the route.
///
/// It deliberately asserts nothing about the delivery state after the fold.
/// Nothing in the tree advances `delivered -> reacted` from the composition
/// walk — it reads the row and writes no bookkeeping — so on a chat where no
/// reaction ever ran the ladder simply stays at `delivered`.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn reacted_result_survives_into_the_next_user_turn(pool: Pool<Postgres>) {
    let (app_state, _llm, recorder) = react_state(pool, "FOLDED-TURN-ANSWER").await;
    let me = test_user(&app_state).await;
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let (child_id, result_row_id) = stage_delivered_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        "FOLDED-ANSWER",
    )
    .await;

    post_react(&server, origin_chat_id, result_row_id)
        .await
        .assert_status_ok();
    wait_for_delivery_state(&app_state.db, child_id, &["reacted"]).await;
    let reaction_id = delivery_struct(&app_state, child_id)
        .await
        .reaction_message_id
        .expect("the reaction row");

    // The person carries on from the reaction, exactly as a client does.
    submit_message(
        &server,
        &origin,
        Some(&reaction_id.to_string()),
        "so what do you think",
        Vec::new(),
    )
    .await;

    assert!(
        recorder.bodies().iter().any(|body| {
            body.contains("so what do you think") && body.contains("FOLDED-ANSWER")
        }),
        "the delivered result must still be composed into the turn after the \
         one that answered it"
    );
    let rows = active_thread_rows(&app_state.db, origin_chat_id).await;
    assert!(
        rows.iter().any(|row| row.id == result_row_id),
        "the delivered result stays on the active thread"
    );
    assert_eq!(
        task_result_rows(&app_state.db, origin_chat_id).await.len(),
        1,
        "the later turn composes the result, it does not re-deliver it"
    );
}

/// What a model is told about a run that stopped to ask.
///
/// The operator's result template introduces a finished result — the shipped
/// default says so in as many words — so a notification composed through it
/// would read as the task's answer and invite the model to report work that has
/// not happened. The reaction turn is where that prose reaches a model, and it
/// is also where the user learns that a decision is waiting and where it is
/// taken, so the substitution has to survive the whole composition and not only
/// the renderer's own unit test.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_parked_result_is_composed_as_a_question_not_as_an_answer(pool: Pool<Postgres>) {
    const SO_FAR: &str = "WHAT-THE-RUN-HAD-REACHED";

    let (app_state, _llm, recorder) = react_state(pool, "REACTION-TO-A-PARKED-RUN").await;
    let me = test_user(&app_state).await;
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some(SO_FAR),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;
    let mut parked = delivery_struct(&app_state, child_id).await;
    parked.status = "input_required".to_string();
    parked.reason = Some("approval_pending".to_string());
    write_delivery(&app_state, child_id, &parked).await;
    assert_eq!(sweep_once(&app_state).await.delivered, 1);
    let result_row_id = delivery_struct(&app_state, child_id)
        .await
        .message_id
        .expect("the delivery names its row");

    post_react(&server, origin_chat_id, result_row_id)
        .await
        .assert_status_ok();

    let composed = recorder
        .bodies()
        .into_iter()
        .find(|body| body.contains(SO_FAR))
        .expect("the reaction turn composed the parked result");
    assert!(
        !composed.contains("has finished and its result is below"),
        "the operator's finished-result template must not introduce a park: {composed}"
    );
    assert!(
        composed.contains("NOT finished"),
        "the model has to be told the task has not reported: {composed}"
    );
    assert!(
        composed.contains(&child_id.to_string()),
        "and where the decision is taken: {composed}"
    );
}

// ---------------------------------------------------------------------------
// ERMAIN-783: retrying a failed delegated task run.
// ---------------------------------------------------------------------------

/// A hand-seeded failed task run, and the origin turn that dispatched it.
struct SeededFailedRun {
    origin_user_message_id: Uuid,
    child_chat_id: Uuid,
}

/// The `TaskSpec` a seeded run carries unless a test says otherwise.
fn retry_task_spec() -> erato::models::chat::TaskSpec {
    erato::models::chat::TaskSpec {
        expected_output: Some("a number".to_string()),
        constraints: Some("be brief".to_string()),
        facet_ids: Vec::new(),
        max_server_tool_calls_per_task: Some(7),
        max_client_tool_calls_per_task: Some(3),
        persona: erato_config::config::TaskPersona::Bare,
        scheduling: erato_config::config::TaskScheduling::WhenIdle,
        parent_tool_call_id: Some(RETRY_CALL_ID.to_string()),
        route: erato::models::chat::DelegateRoute::Task,
    }
}

const RETRY_CALL_ID: &str = "call_retry_me";
const RETRY_BRIEF_SENTINEL: &str = "RETRY-BRIEF-SENTINEL";

/// Seed an origin turn whose assistant row carries a `delegate_task` call, plus
/// the child that call dispatched.
///
/// Hand-written rather than driven through a real turn because these tests need
/// to reach one specific state of a FINISHED run - failed, completed, reaped -
/// without also running the origin's model twice to get there.
async fn seed_failed_task_run(
    app_state: &erato::state::AppState,
    owner_user_id: &str,
    origin_chat_id: Uuid,
    spec: erato::models::chat::TaskSpec,
    write_origin_call: bool,
) -> SeededFailedRun {
    let policy = rebuilt_policy(app_state).await;
    let subject = erato::policy::types::Subject::User(owner_user_id.to_string());

    let origin_user_row = erato::models::message::submit_message(
        &app_state.db,
        &policy,
        &subject,
        &origin_chat_id,
        json!({
            "role": "user",
            "content": [{"content_type": "text", "text": "count the figures"}],
            "name": owner_user_id,
        }),
        None,
        None,
        None,
        &[],
        None,
        None,
        None,
    )
    .await
    .expect("origin user row");

    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &policy,
        &subject,
        owner_user_id,
        None,
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(origin_chat_id),
            origin_message_id: Some(origin_user_row.id),
            parent_message_id: None,
            origin_assistant_id: None,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: Some(erato::models::message::ProvenanceRunMode::Async),
            result_delivery: None,
            retry_of: None,
        },
        Some(spec),
        "Seeded failed run".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("child chat");

    // The child's own brief row. Without a message the chat is invisible to the
    // listing's lateral join and so, deliberately, unretryable too.
    erato::models::message::submit_message(
        &app_state.db,
        &policy,
        &subject,
        &child.id,
        json!({
            "role": "user",
            "content": [{"content_type": "text", "text": format!("{RETRY_BRIEF_SENTINEL}: count the figures")}],
            "name": owner_user_id,
        }),
        None,
        None,
        None,
        &[],
        None,
        None,
        None,
    )
    .await
    .expect("child brief row");

    if write_origin_call {
        erato::models::message::submit_message(
            &app_state.db,
            &policy,
            &subject,
            &origin_chat_id,
            json!({
                "role": "assistant",
                "content": [{
                    "content_type": "tool_use",
                    "tool_call_id": RETRY_CALL_ID,
                    "status": "success",
                    "tool_name": "delegate_task",
                    "progress_message": null,
                    "input": {
                        "task": format!("{RETRY_BRIEF_SENTINEL}: count the figures"),
                        "expected_output": "a number",
                        "constraints": "be brief",
                        // Deliberately at odds with the run that was launched:
                        // a retry must inherit the CHILD's parameters, not the
                        // model's original request.
                        "run_mode": "wait",
                        "scheduling": "silent",
                        "facet_ids": ["never-offered"],
                    },
                    "output": {
                        "status": "working",
                        "child_run_id": child.id,
                        "delegate_chat_id": child.id,
                    },
                }],
            }),
            Some(&origin_user_row.id),
            None,
            None,
            &[],
            None,
            None,
            None,
        )
        .await
        .expect("origin tool call row");
    }

    app_state.global_policy_engine.invalidate_data().await;
    SeededFailedRun {
        origin_user_message_id: origin_user_row.id,
        child_chat_id: child.id,
    }
}

/// POST the retry route.
async fn retry_run(
    server: &TestServer,
    origin_chat_id: &str,
    child_chat_id: Uuid,
    body: Value,
) -> axum_test::TestResponse {
    server
        .post(&format!(
            "/api/v1beta/me/chats/{origin_chat_id}/delegated_runs/{child_chat_id}/retry"
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body)
        .await
}

/// The mock a retried child's own turn answers with.
fn retry_child_mocks() -> MockSet {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[RETRY_BRIEF_SENTINEL], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["RETRIED-CHILD-ANSWER"]),
        );
    });
    mocks
}

/// Wait until a chat has a message of its own.
///
/// The recent-chats listing inner-joins each chat's latest message, so a run
/// whose detached generation has not yet written its brief row is invisible
/// there - by design, and the same reason the retry gate treats it as still
/// working.
async fn wait_for_first_message(db: &sea_orm::DatabaseConnection, chat_id: Uuid) {
    for _ in 0..100 {
        if !chat_messages_by_created_at(db, chat_id).await.is_empty() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    panic!("chat {chat_id} never got a message of its own");
}

/// The configuration envelope of the run started to replace `retried`.
async fn retry_child_configuration(
    app_state: &erato::state::AppState,
    new_child_chat_id: Uuid,
) -> Value {
    erato::db::entity::chats::Entity::find_by_id(new_child_chat_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("the retry child must exist")
        .assistant_configuration
        .expect("the retry child must carry a configuration")
}

/// The happy path, end to end: a failed task run is re-dispatched as a NEW
/// async child that records what it replaces, and the failed run is left
/// exactly as it was.
///
/// The last half is the one worth stating. Writing `retry_of` onto the run
/// being retried would have been the smaller change, and it would have erased
/// the only durable record that the first attempt failed.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_failed_task_dispatches_a_new_async_child_with_retry_of(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_state(
        pool,
        retry_child_mocks(),
        &["erato/delegate_task"],
        |config| {
            config.delegation.tasks.run_modes = vec![
                erato_config::config::TaskRunMode::Wait,
                erato_config::config::TaskRunMode::Async,
            ];
        },
    )
    .await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_id = Uuid::parse_str(&origin).unwrap();
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        origin_id,
        retry_task_spec(),
        true,
    )
    .await;

    let before = retry_child_configuration(&app_state, seeded.child_chat_id).await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::ACCEPTED);
    let new_child_id = Uuid::parse_str(response.json::<Value>()["child_chat_id"].as_str().unwrap())
        .expect("the response names the new run");
    assert_ne!(
        new_child_id, seeded.child_chat_id,
        "a retry starts a new run; it does not restart the old one"
    );

    let configuration = retry_child_configuration(&app_state, new_child_id).await;
    assert_eq!(
        configuration["provenance"]["retry_of"],
        json!(seeded.child_chat_id),
        "the NEW child records what it replaces: {configuration}"
    );
    assert_eq!(
        configuration["provenance"]["run_mode"], "async",
        "a retry is always detached; nothing is waiting on this turn"
    );
    assert_eq!(
        configuration["provenance"]["origin_chat_id"],
        json!(origin_id)
    );
    assert_eq!(
        configuration["provenance"]["origin_message_id"],
        json!(seeded.origin_user_message_id),
        "the replacement is anchored at the turn that made the original call, not at whatever the conversation's tip is now: {configuration}"
    );

    // The brief travelled. Read off the chat row, which dispatch writes
    // synchronously from the brief, rather than off the child's first message:
    // that one is written by the detached generation at its own pace, and
    // racing it would make this assertion about timing instead of about the
    // brief.
    let new_child_row = erato::db::entity::chats::Entity::find_by_id(new_child_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("the retry child must exist");
    assert!(
        new_child_row
            .title_by_user_provided
            .as_deref()
            .is_some_and(|title| title.contains(RETRY_BRIEF_SENTINEL)),
        "the retry runs the ORIGINAL brief, recovered from the origin's own recorded call: {:?}",
        new_child_row.title_by_user_provided
    );

    let after = retry_child_configuration(&app_state, seeded.child_chat_id).await;
    assert_eq!(
        before["provenance"], after["provenance"],
        "the retried run's own envelope is never touched - its failure stays on the record"
    );
}

/// A retry inherits the OLD RUN's budgets and persona, through a synthetic
/// offer scope built for the occasion.
///
/// `task_scope: None` would compile and dispatch. It would also leave both
/// per-task budgets `None` on the child, which switches off the graceful cap
/// arm in `task_tool_budgets_for_chat` - so the retry would fail harder than
/// the run it was started to replace.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_uses_the_synthetic_scope_budgets_and_persona(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_state(
        pool,
        retry_child_mocks(),
        &["erato/delegate_task"],
        |config| {
            config.delegation.tasks.run_modes = vec![
                erato_config::config::TaskRunMode::Wait,
                erato_config::config::TaskRunMode::Async,
            ];
            // Deliberately different from the seeded run's own budgets, so a
            // retry that fell back to the config would be visible.
            config.delegation.tasks.max_server_tool_calls_per_task = 99;
            config.delegation.tasks.max_client_tool_calls_per_task = 99;
        },
    )
    .await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        Uuid::parse_str(&origin).unwrap(),
        retry_task_spec(),
        true,
    )
    .await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::ACCEPTED);
    let new_child_id =
        Uuid::parse_str(response.json::<Value>()["child_chat_id"].as_str().unwrap()).unwrap();

    let configuration = retry_child_configuration(&app_state, new_child_id).await;
    assert_eq!(
        configuration["task"]["max_server_tool_calls_per_task"], 7,
        "the retry is bounded by what the ORIGINAL run was allowed: {configuration}"
    );
    assert_eq!(
        configuration["task"]["max_client_tool_calls_per_task"], 3,
        "both budgets travel, and neither falls back to the config: {configuration}"
    );
    assert_eq!(
        configuration["task"]["persona"], "bare",
        "a run that spoke as the bare model must not come back wearing the origin's assistant"
    );
    assert_eq!(configuration["task"]["route"], "task");
}

/// A run dispatched `silent` comes back `silent`.
///
/// Scheduling reaches the child's `TaskSpec` through `LaunchRunSpec`, NOT
/// through the offer scope - the scope's copy is read only when validating a
/// model's own argument, which this path never does. Setting it in the wrong
/// place compiles, dispatches, and quietly turns a silent run into one that
/// interrupts the user with an unrequested reaction turn.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_carries_the_runs_scheduling(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_state(
        pool,
        retry_child_mocks(),
        &["erato/delegate_task"],
        |config| {
            config.delegation.tasks.run_modes = vec![
                erato_config::config::TaskRunMode::Wait,
                erato_config::config::TaskRunMode::Async,
            ];
        },
    )
    .await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let spec = erato::models::chat::TaskSpec {
        scheduling: erato_config::config::TaskScheduling::Silent,
        ..retry_task_spec()
    };
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        Uuid::parse_str(&origin).unwrap(),
        spec,
        true,
    )
    .await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::ACCEPTED);
    let new_child_id =
        Uuid::parse_str(response.json::<Value>()["child_chat_id"].as_str().unwrap()).unwrap();

    let configuration = retry_child_configuration(&app_state, new_child_id).await;
    assert_eq!(
        configuration["task"]["scheduling"], "silent",
        "the retry runs the way the original run was asked to run: {configuration}"
    );
    assert_eq!(
        configuration["task"]["parent_tool_call_id"], RETRY_CALL_ID,
        "the replacement names the same origin call, so a delivery or the backstop sweep can find it without walking the chat"
    );
}

/// A facet the owner has lost since dispatch is DROPPED, not refused.
///
/// The run is still worth retrying without it; refusing would leave the user
/// with a failed run and no way forward. The re-authorization itself is not
/// optional - without it a retry would re-grant a capability the deployment has
/// since taken away.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_reauthorizes_facets_for_the_owner(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_state(
        pool,
        retry_child_mocks(),
        &["erato/delegate_task"],
        |config| {
            config.delegation.tasks.run_modes = vec![
                erato_config::config::TaskRunMode::Wait,
                erato_config::config::TaskRunMode::Async,
            ];
            for facet_id in ["kept", "withdrawn"] {
                config.facets.facets.insert(
                    facet_id.to_string(),
                    erato::config::FacetConfig {
                        display_name: facet_id.to_string(),
                        icon: None,
                        additional_system_prompt: None,
                        tool_call_allowlist: Vec::new(),
                        model_settings: Default::default(),
                        disable_facet_prompt_template: true,
                        hidden: false,
                        hidden_always_active_for_platform: None,
                        delegation: None,
                    },
                );
            }
            // What a capability withdrawn since dispatch looks like from here:
            // the facet still exists, but this owner is no longer in the group
            // that may reach it.
            config.facet_permissions.rules.insert(
                "allow-kept".to_string(),
                erato::config::FacetPermissionRule::AllowAll {
                    facet_ids: vec!["kept".to_string(), "plan".to_string()],
                },
            );
            config.facet_permissions.rules.insert(
                "allow-withdrawn-to-a-group-the-owner-left".to_string(),
                erato::config::FacetPermissionRule::AllowForGroupMembers {
                    facet_ids: vec!["withdrawn".to_string()],
                    groups: vec!["a-group-this-user-is-not-in".to_string()],
                },
            );
        },
    )
    .await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let spec = erato::models::chat::TaskSpec {
        facet_ids: vec!["kept".to_string(), "withdrawn".to_string()],
        ..retry_task_spec()
    };
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        Uuid::parse_str(&origin).unwrap(),
        spec,
        true,
    )
    .await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::ACCEPTED);
    let new_child_id =
        Uuid::parse_str(response.json::<Value>()["child_chat_id"].as_str().unwrap()).unwrap();

    let configuration = retry_child_configuration(&app_state, new_child_id).await;
    let facets = configuration["task"]["facet_ids"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(
        facets.contains(&json!("kept")),
        "a facet the owner still has survives the retry: {configuration}"
    );
    assert!(
        !facets.contains(&json!("withdrawn")),
        "a facet the owner has lost is dropped, not re-granted: {configuration}"
    );
}

/// A run that produced an answer is not retryable, and says so by name.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_of_a_completed_child_is_409_not_retryable(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        Uuid::parse_str(&origin).unwrap(),
        retry_task_spec(),
        true,
    )
    .await;
    append_assistant_answer(
        &app_state,
        &me.id.to_string(),
        seeded.child_chat_id,
        "the answer the run was asked for",
        None,
    )
    .await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::CONFLICT);
    let body = response.json::<Value>();
    assert_eq!(body["code"], "not_retryable");
    assert_eq!(
        body["state"], "completed",
        "the reason is named, so a client can hide the control rather than guess: {body}"
    );
    assert_eq!(body["chat_id"], json!(seeded.child_chat_id));
}

/// One live retry per failed run.
///
/// This is the whole bound on a retry storm, and it is read from the database
/// rather than remembered by the client - a reload must not reopen the button.
///
/// The replacement is hand-seeded rather than dispatched, so what is under test
/// is the predicate and not how fast a mocked child answers.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_while_a_retry_child_is_working_is_409(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_id = Uuid::parse_str(&origin).unwrap();
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        origin_id,
        retry_task_spec(),
        true,
    )
    .await;

    // A replacement already working.
    let replacement = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &rebuilt_policy(&app_state).await,
        &erato::policy::types::Subject::User(me.id.to_string()),
        &me.id.to_string(),
        None,
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(origin_id),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: None,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: Some(erato::models::message::ProvenanceRunMode::Async),
            result_delivery: None,
            retry_of: Some(seeded.child_chat_id),
        },
        Some(retry_task_spec()),
        "The replacement".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("replacement chat");
    set_generation_lease(&app_state.db, replacement.id, Some("running"), 0).await;
    app_state.global_policy_engine.invalidate_data().await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::CONFLICT);
    let body = response.json::<Value>();
    assert_eq!(body["code"], "not_retryable");
    assert_eq!(
        body["state"], "retry_in_flight",
        "a second retry while the first is working is refused by name: {body}"
    );
}

/// A retry counts against the owner's concurrent detached-run cap, and is
/// refused with the cap's own discriminator rather than a generic launch
/// refusal.
///
/// Asserting the state - not just the status - is what makes this test mean
/// something: delete the handler's pre-check and the launch seam still refuses,
/// but the answer degrades to `launch_refused` and the client loses the one
/// reason it can explain to a user.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_counts_against_the_background_concurrency_cap(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_state(pool, MockSet::new(), &["erato/delegate_task"], |config| {
        config.delegation.tasks.run_modes = vec![
            erato_config::config::TaskRunMode::Wait,
            erato_config::config::TaskRunMode::Async,
        ];
        config.delegation.max_concurrent_background_runs = 1;
    })
    .await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_id = Uuid::parse_str(&origin).unwrap();
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        origin_id,
        retry_task_spec(),
        true,
    )
    .await;

    // Another detached run of the same owner, live: the one slot is taken.
    let occupant = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        origin_id,
        retry_task_spec(),
        false,
    )
    .await;
    set_generation_lease(&app_state.db, occupant.child_chat_id, Some("running"), 0).await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::CONFLICT);
    let body = response.json::<Value>();
    assert_eq!(body["code"], "not_retryable");
    assert_eq!(
        body["state"], "concurrency_cap",
        "the cap is reported as the cap, not as a generic launch refusal: {body}"
    );
}

/// The failure this endpoint exists for: a child reaped after a replica crash.
///
/// Nothing else can recover it. No result was written and no delivery record
/// exists, so the backstop sweep - which scans `pending` and `claimed`
/// deliveries - has nothing to requeue, and the origin's dispatch slot still
/// reads "dispatched". The runs-list badge is the only signal left, and this is
/// the request it makes.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_of_a_reaped_child_after_a_replica_crash_is_allowed(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_state(
        pool,
        retry_child_mocks(),
        &["erato/delegate_task"],
        |config| {
            config.delegation.tasks.run_modes = vec![
                erato_config::config::TaskRunMode::Wait,
                erato_config::config::TaskRunMode::Async,
            ];
        },
    )
    .await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        Uuid::parse_str(&origin).unwrap(),
        retry_task_spec(),
        true,
    )
    .await;
    // A run the reaper marked errored, its heartbeat long cold: exactly what a
    // replica that died mid-run leaves behind.
    set_generation_lease(&app_state.db, seeded.child_chat_id, Some("errored"), 86_400).await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::ACCEPTED);
}

/// Only a planned task run is retryable. A run started by an @-mention is not.
///
/// A mention run is bound to an assistant this route would have to re-resolve
/// and re-authorize; re-dispatching it as a bare task would silently drop that
/// binding and answer as somebody else.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_of_a_mention_route_child_is_409_not_a_task_run(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let spec = erato::models::chat::TaskSpec {
        route: erato::models::chat::DelegateRoute::Assistant,
        ..retry_task_spec()
    };
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        Uuid::parse_str(&origin).unwrap(),
        spec,
        true,
    )
    .await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::CONFLICT);
    let body = response.json::<Value>();
    assert_eq!(body["state"], "not_a_task_run", "{body}");
}

/// Without the origin's own record of the call, a retry refuses.
///
/// There is deliberately no reconstruction from the child's own rows: those are
/// the run's OUTPUT, not the request that produced it, and a re-dispatch built
/// from them would quietly lose the brief's lineage while looking like a
/// success.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_without_the_origin_tool_call_is_409_brief_unavailable(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        Uuid::parse_str(&origin).unwrap(),
        retry_task_spec(),
        // The origin turn's tool call is gone - edited away, or never persisted
        // because the replica died before the turn ended.
        false,
    )
    .await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::CONFLICT);
    let body = response.json::<Value>();
    assert_eq!(body["state"], "brief_unavailable", "{body}");
}

/// A replacement run, seeded exactly as the retry route creates one: parented
/// to the same origin, carrying the inherited spec and the inherited
/// `parent_tool_call_id`, naming the run it replaces - and named NOWHERE in the
/// origin, because nothing backfills the origin's frozen tool part.
///
/// Returns the new run's id. With only a user message of its own and no lease,
/// the listing's outcome expression reads it as `failed`.
async fn seed_retry_child(
    app_state: &erato::state::AppState,
    owner_user_id: &str,
    origin_chat_id: Uuid,
    retry_of: Uuid,
) -> Uuid {
    let policy = rebuilt_policy(app_state).await;
    let subject = erato::policy::types::Subject::User(owner_user_id.to_string());

    let child = erato::models::chat::create_delegated_chat(
        &app_state.db,
        &policy,
        &subject,
        owner_user_id,
        None,
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(origin_chat_id),
            origin_message_id: None,
            parent_message_id: None,
            origin_assistant_id: None,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
            adopted_at: None,
            legacy_expected_output: None,
            legacy_constraints: None,
            run_mode: Some(erato::models::message::ProvenanceRunMode::Async),
            result_delivery: None,
            retry_of: Some(retry_of),
        },
        Some(retry_task_spec()),
        "Seeded replacement run".to_string(),
        true,
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("replacement chat");

    erato::models::message::submit_message(
        &app_state.db,
        &policy,
        &subject,
        &child.id,
        json!({
            "role": "user",
            "content": [{"content_type": "text", "text": format!("{RETRY_BRIEF_SENTINEL}: count the figures")}],
            "name": owner_user_id,
        }),
        None,
        None,
        None,
        &[],
        None,
        None,
        None,
    )
    .await
    .expect("replacement brief row");

    app_state.global_policy_engine.invalidate_data().await;
    child.id
}

/// A replacement that failed is itself retryable, and its brief is recovered
/// through the chain.
///
/// This is the second occurrence of the very failure the endpoint exists for: a
/// replica crash reaps the run, the user retries, and the replacement is reaped
/// too. The origin names only the FIRST child - `launch_delegation` writes
/// nothing back into the origin, and the assistant message holding the
/// `tool_use` part was frozen at the end of its turn - so probing the origin
/// for the replacement finds nothing at all.
///
/// Without the walk back through `provenance.retry_of` this answers
/// `brief_unavailable` every time, and the crash-recovery story is
/// single-use. Worse, the client offers exactly that dead button: the runs bar
/// swaps the FIRST child's control for a "Retried" link as soon as a
/// replacement exists, so the replacement's own control is the only one left.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_of_a_retry_child_recovers_the_brief_through_the_chain(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_state(
        pool,
        retry_child_mocks(),
        &["erato/delegate_task"],
        |config| {
            config.delegation.tasks.run_modes = vec![
                erato_config::config::TaskRunMode::Wait,
                erato_config::config::TaskRunMode::Async,
            ];
        },
    )
    .await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_id = Uuid::parse_str(&origin).unwrap();
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        origin_id,
        retry_task_spec(),
        true,
    )
    .await;
    let replacement = seed_retry_child(
        &app_state,
        &me.id.to_string(),
        origin_id,
        seeded.child_chat_id,
    )
    .await;
    // The replacement died the same way the run it replaced did.
    set_generation_lease(&app_state.db, replacement, Some("errored"), 86_400).await;

    let response = retry_run(&server, &origin, replacement, json!({"kind": "task"})).await;
    response.assert_status(http::StatusCode::ACCEPTED);
    let new_child_id = Uuid::parse_str(response.json::<Value>()["child_chat_id"].as_str().unwrap())
        .expect("the response names the new run");

    let configuration = retry_child_configuration(&app_state, new_child_id).await;
    assert_eq!(
        configuration["provenance"]["retry_of"],
        json!(replacement),
        "the new run replaces the run that was retried, not the root of the chain: {configuration}"
    );

    let new_child_row = erato::db::entity::chats::Entity::find_by_id(new_child_id)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("the retry child must exist");
    assert!(
        new_child_row
            .title_by_user_provided
            .as_deref()
            .is_some_and(|title| title.contains(RETRY_BRIEF_SENTINEL)),
        "the brief came from the origin call that started the CHAIN: {:?}",
        new_child_row.title_by_user_provided
    );
}

/// A child retried through a chat that is not its origin is a 404, even when
/// the caller owns both chats.
///
/// Parentage is not decoration: without the check the replacement would be
/// created under the wrong origin, and its result delivered into a
/// conversation that never asked for it.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_from_a_foreign_origin_is_404(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let other_origin = create_chat(&server, None).await;
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        Uuid::parse_str(&origin).unwrap(),
        retry_task_spec(),
        true,
    )
    .await;

    let response = retry_run(
        &server,
        &other_origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::NOT_FOUND);
}

/// While the origin chat's own generation holds its lease, a retry is refused
/// with the generation-running body - JSON, and discriminated on `code`, not
/// the plain text every other conflict on this route uses.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_while_the_origin_generation_is_running_is_409_generation_running(
    pool: Pool<Postgres>,
) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_id = Uuid::parse_str(&origin).unwrap();
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        origin_id,
        retry_task_spec(),
        true,
    )
    .await;
    set_generation_lease(&app_state.db, origin_id, Some("running"), 0).await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::CONFLICT);
    let body = response.json::<Value>();
    assert_eq!(
        body["code"], "generation_running",
        "this conflict is the chat's lease, not the run's state, and the client tells them apart on code: {body}"
    );
    assert_eq!(body["chat_id"], json!(origin_id));
}

/// `kind` accepts exactly one value today, and the serde enum IS the rejection
/// mechanism for every other one.
///
/// Retrying a stuck result *delivery* is described by the contract but not
/// built, so `"delivery"` must be an unknown variant - a 422 a client can act
/// on - rather than a value the route accepts and then refuses with a 409 that
/// reads like a transient condition. Add a `Delivery` variant without the rest
/// of that work and this test is what notices.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_with_an_unknown_kind_is_422(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        Uuid::parse_str(&origin).unwrap(),
        retry_task_spec(),
        true,
    )
    .await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "delivery"}),
    )
    .await;
    response.assert_status(http::StatusCode::UNPROCESSABLE_ENTITY);
}

/// An archived origin takes no new runs.
///
/// Not in any plan document, and the hole it closes is silent: the archive
/// cascade reaches an origin's delegated descendants, so a retry from an
/// archived chat would create a child the cascade archives moments later, whose
/// delivery the sweep then supersedes as `origin_archived`. A retry that can
/// never land, reported to the user as accepted.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn retry_from_an_archived_origin_is_refused(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        Uuid::parse_str(&origin).unwrap(),
        retry_task_spec(),
        true,
    )
    .await;
    archive_chat_via_api(&server, &origin).await;
    app_state.global_policy_engine.invalidate_data().await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::CONFLICT);
}

/// `retry_of` reaches the client on the listing row, which is what lets the
/// "already retried" swap survive a reload.
///
/// Component state cannot do this job: it comes back empty on remount, and the
/// retry button with it.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn recent_chats_exposes_retry_of(pool: Pool<Postgres>) {
    let (app_state, _llm) = task_state(
        pool,
        retry_child_mocks(),
        &["erato/delegate_task"],
        |config| {
            config.delegation.tasks.run_modes = vec![
                erato_config::config::TaskRunMode::Wait,
                erato_config::config::TaskRunMode::Async,
            ];
        },
    )
    .await;
    let me = erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        TEST_USER_SUBJECT,
        None,
    )
    .await
    .unwrap();
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let seeded = seed_failed_task_run(
        &app_state,
        &me.id.to_string(),
        Uuid::parse_str(&origin).unwrap(),
        retry_task_spec(),
        true,
    )
    .await;

    let response = retry_run(
        &server,
        &origin,
        seeded.child_chat_id,
        json!({"kind": "task"}),
    )
    .await;
    response.assert_status(http::StatusCode::ACCEPTED);
    let new_child_id = response.json::<Value>()["child_chat_id"]
        .as_str()
        .unwrap()
        .to_string();

    wait_for_first_message(&app_state.db, Uuid::parse_str(&new_child_id).unwrap()).await;
    let listing = recent_chats(
        &server,
        &format!("?origin_chat_id={origin}&include_delegated=true&limit=50"),
    )
    .await;
    let retried = listed_chat(&listing, &new_child_id);
    assert_eq!(
        retried["retry_of"],
        json!(seeded.child_chat_id.to_string()),
        "the replacement row names what it replaced: {retried}"
    );
    let failed = listed_chat(&listing, &seeded.child_chat_id.to_string());
    assert!(
        failed["retry_of"].is_null(),
        "the failed run itself records nothing - only the replacement does: {failed}"
    );
}

// ---------------------------------------------------------------------------
// A task child that stops on an approval, and the origin turn that asks for it.
// ---------------------------------------------------------------------------

/// The gated MCP tool a child reaches. Open-world, so the restrictive preset
/// asks about it without any per-user decision being seeded.
const PARKED_TOOL: &str = "publish_approval_probe";
/// What the mock MCP server answers once the call is allowed to run.
const PARKED_TOOL_RESULT: &str = "approval probe published";
/// The refusal a denied call gets, which the child then answers around.
const CHILD_DENIAL_TEXT: &str = "The user denied this tool call.";
const PARK_USER_MESSAGE: &str = "plan a gated sub-task";
const GATED_BRIEF: &str = "GATED-CHILD-BRIEF: publish the probe";

/// The child's first turn: reach for the gated tool. Excluded on the envelope
/// key, which only the parent's replayed tool responses carry.
fn mock_child_reaches_the_gate(mocks: &mut MockSet, brief: &'static str, call_id: &'static str) {
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[brief],
                &["child_run_id", PARKED_TOOL_RESULT, CHILD_DENIAL_TEXT],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                call_id,
                PARKED_TOOL,
                json!({}),
            )]),
        );
    });
}

/// The origin's first turn: plan exactly one sub-task.
fn mock_parent_plans_one_task(
    mocks: &mut MockSet,
    user_message: &'static str,
    brief: &'static str,
    call_id: &'static str,
) {
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[user_message], &[brief]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                call_id,
                "delegate_task",
                json!({ "task": brief, "facet_ids": ["plan"] }),
            )]),
        );
    });
}

async fn message_row(
    db: &sea_orm::DatabaseConnection,
    message_id: Uuid,
) -> erato::db::entity::messages::Model {
    erato::db::entity::messages::Entity::find_by_id(message_id)
        .one(db)
        .await
        .unwrap()
        .expect("expected the assistant message")
}

async fn generation_state(db: &sea_orm::DatabaseConnection, chat_id: Uuid) -> String {
    erato::db::entity::chats::Entity::find_by_id(chat_id)
        .one(db)
        .await
        .unwrap()
        .unwrap()
        .generation_state
        .unwrap_or_default()
}

fn content_of(row: &erato::db::entity::messages::Model) -> Vec<Value> {
    row.raw_message["content"].as_array().cloned().unwrap()
}

fn slot_for(content: &[Value], tool_call_id: &str) -> Value {
    content
        .iter()
        .find(|part| part["content_type"] == "tool_use" && part["tool_call_id"] == tool_call_id)
        .unwrap_or_else(|| panic!("no slot for {tool_call_id}: {content:?}"))
        .clone()
}

/// The child's own parked assistant row — the request the continuation decides
/// against, as opposed to the copy the origin renders.
async fn child_parked_row(
    db: &sea_orm::DatabaseConnection,
    child_chat_id: Uuid,
) -> erato::db::entity::messages::Model {
    chat_messages_by_created_at(db, child_chat_id)
        .await
        .into_iter()
        .rfind(|row| row.raw_message["role"] == "assistant")
        .expect("expected the child's assistant row")
}

/// Drive one card, on whichever surface holds it.
async fn post_continuestream(
    server: &TestServer,
    message_id: Uuid,
    decision: &str,
) -> axum_test::TestResponse {
    server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "message_id": message_id, "decision": decision }))
        .await
}

/// A task child that reaches an approval-gated MCP call stops instead of
/// having the call refused, and the turn that dispatched it asks on its behalf:
/// ONE `delegated_task` part, one item per parked child, the child's own call
/// copied onto it so the card renders without reading another chat.
///
/// Both rows end `awaiting_approval`. The copy is the surface; the child's own
/// request stays the executable truth the continuation decides against.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn task_child_parks_and_parent_surfaces_one_delegated_task_approval(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_child_reaches_the_gate(&mut mocks, GATED_BRIEF, "call_child_probe");
    mock_parent_plans_one_task(&mut mocks, PARK_USER_MESSAGE, GATED_BRIEF, "call_task_one");

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        gate_mock_mcp_tools_on_approval,
    )
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PARK_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let child_chat = delegated_child_chat(&app_state.db, parent_chat_id).await;

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let request = content.last().expect("expected a persisted content part");
    assert_eq!(
        request["content_type"], "tool_approval_request",
        "the request must be the LAST part, or the six last-part checks stop \
         seeing a parked row: {content:?}"
    );
    assert_eq!(request["kind"], "delegated_task");
    assert_eq!(request["tool_name"], "delegate_task");
    assert_eq!(
        request["mcp_server_id"], "",
        "no MCP server is being asked about on this card"
    );

    let approvals = request["approvals"].as_array().unwrap();
    assert_eq!(
        approvals.len(),
        1,
        "one item per parked child: {approvals:?}"
    );
    assert_eq!(
        approvals[0]["approval_id"], "call_task_one",
        "the approval is named after the origin call it covers"
    );
    assert_eq!(approvals[0]["tool_call_id"], "call_task_one");
    let child_ref = &approvals[0]["child"];
    assert_eq!(child_ref["child_chat_id"], json!(child_chat.id));
    assert_eq!(child_ref["child_tool_call_id"], "call_child_probe");
    assert_eq!(child_ref["tool_name"], PARKED_TOOL);
    assert_eq!(child_ref["mcp_server_id"], "mock_mcp_approval");
    assert_eq!(child_ref["preset"], "restrictive");
    assert!(child_ref["annotations"].is_object());
    assert!(
        request["pending_tool_calls"].as_array().unwrap().is_empty(),
        "nothing followed the task call in this batch"
    );

    assert_eq!(
        generation_state(&app_state.db, parent_chat_id).await,
        "awaiting_approval"
    );
    assert_eq!(
        generation_state(&app_state.db, child_chat.id).await,
        "awaiting_approval"
    );
    let child_content = content_of(&child_parked_row(&app_state.db, child_chat.id).await);
    assert_eq!(
        child_content.last().unwrap()["content_type"],
        "tool_approval_request",
        "the child keeps its own request: that row, not the copy, is what a \
         continuation decides against"
    );
    assert!(
        extract_full_text_answer(&events).is_empty(),
        "a parked turn answers nothing"
    );
}

/// The parked child's slot keeps its reserved index and reads as an envelope
/// that is waiting, never as an empty one: history replay re-emits every stored
/// `ToolUse` as a call plus its response, so a `null` output would replay as a
/// tool that answered nothing at all.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn envelope_reports_input_required_for_parked_child(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_child_reaches_the_gate(&mut mocks, GATED_BRIEF, "call_child_probe");
    mock_parent_plans_one_task(&mut mocks, PARK_USER_MESSAGE, GATED_BRIEF, "call_task_one");

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        gate_mock_mcp_tools_on_approval,
    )
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PARK_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let child_chat = delegated_child_chat(&app_state.db, parent_chat_id).await;

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let slot = slot_for(&content, "call_task_one");
    assert_eq!(
        slot["status"], "in_progress",
        "the run is suspended, not over: {slot}"
    );
    assert!(
        slot["ended_at"].is_null(),
        "a suspended run has not ended: {slot}"
    );
    assert!(!slot["output"].is_null(), "never output: null: {slot}");
    assert_eq!(slot["output"]["status"], "input_required");
    assert_eq!(slot["output"]["reason"], "approval_pending");
    assert_eq!(slot["output"]["child_run_id"], json!(child_chat.id));
    assert_eq!(slot["output"]["delegate_chat_id"], json!(child_chat.id));
    assert_eq!(slot["output"]["parent_tool_call_id"], "call_task_one");
    assert!(
        slot["output"]["result"].is_null(),
        "there is no result yet: {slot}"
    );
}

/// Every delegated run of `origin_chat_id`, oldest first. A batch has more than
/// one, so the single-child helper cannot answer for it.
async fn delegated_child_chats(
    db: &sea_orm::DatabaseConnection,
    origin_chat_id: Uuid,
) -> Vec<erato::db::entity::chats::Model> {
    erato::db::entity::chats::Entity::find()
        .filter(erato::db::entity::chats::Column::OriginChatId.eq(origin_chat_id))
        .order_by_asc(erato::db::entity::chats::Column::CreatedAt)
        .all(db)
        .await
        .unwrap()
}

async fn wait_for_generation_state(
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
    expected: &str,
) {
    for _ in 0..150 {
        if generation_state(db, chat_id).await == expected {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    panic!(
        "chat {chat_id} never reached '{expected}' (it is '{}')",
        generation_state(db, chat_id).await
    );
}

/// A batch where one child parks and another finishes first: the sibling's slot
/// is settled, not abandoned, and only the parked child is on the card.
///
/// The alternative — leaving the batch the moment one child asks — would strand
/// the siblings' slots at "working" for runs that are over, and the model would
/// never learn what they found.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn batch_of_two_tasks_one_parks_other_settles_before_park(pool: Pool<Postgres>) {
    const PLAIN_BRIEF: &str = "PLAIN-CHILD-BRIEF: just answer";
    const BATCH_USER_MESSAGE: &str = "plan two sub-tasks";

    let mut mocks = MockSet::new();
    mock_child_reaches_the_gate(&mut mocks, GATED_BRIEF, "call_child_probe");
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[PLAIN_BRIEF], &["child_run_id"]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PLAIN-CHILD-ANSWER"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[BATCH_USER_MESSAGE],
                &[GATED_BRIEF, PLAIN_BRIEF],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[
                (
                    "call_task_plain",
                    "delegate_task",
                    json!({ "task": PLAIN_BRIEF, "facet_ids": ["plan"] }),
                ),
                (
                    "call_task_gated",
                    "delegate_task",
                    json!({ "task": GATED_BRIEF, "facet_ids": ["plan"] }),
                ),
            ]),
        );
    });

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        gate_mock_mcp_tools_on_approval,
    )
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, BATCH_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    assert_eq!(
        delegated_child_chats(&app_state.db, parent_chat_id)
            .await
            .len(),
        2,
        "both children ran"
    );

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let plain = slot_for(&content, "call_task_plain");
    assert_eq!(
        plain["status"], "success",
        "the sibling is settled, not abandoned: {plain}"
    );
    assert_eq!(plain["output"]["status"], "completed");
    assert!(
        plain["output"]["result"]
            .as_str()
            .unwrap()
            .contains("PLAIN-CHILD-ANSWER")
    );
    let gated = slot_for(&content, "call_task_gated");
    assert_eq!(gated["output"]["status"], "input_required");

    let request = content.last().unwrap();
    assert_eq!(request["content_type"], "tool_approval_request");
    let approvals = request["approvals"].as_array().unwrap();
    assert_eq!(
        approvals.len(),
        1,
        "only the child that asked is on the card: {approvals:?}"
    );
    assert_eq!(approvals[0]["approval_id"], "call_task_gated");
    assert_eq!(
        generation_state(&app_state.db, parent_chat_id).await,
        "awaiting_approval"
    );
}

/// Approving the copy resumes the child that actually holds the request: the
/// gated call runs in the child, the child answers, and the origin's slot is
/// overwritten in place with the result envelope the model then reads.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approve_resumes_child_and_parent_settles_slot(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_child_reaches_the_gate(&mut mocks, GATED_BRIEF, "call_child_probe");
    mock_child_answers_after_the_gate(&mut mocks);
    mock_parent_plans_one_task(&mut mocks, PARK_USER_MESSAGE, GATED_BRIEF, "call_task_one");
    mock_parent_final_answer(&mut mocks, PARK_USER_MESSAGE);

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        gate_mock_mcp_tools_on_approval,
    )
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PARK_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let child_chat = delegated_child_chat(&app_state.db, parent_chat_id).await;

    let continued = post_continuestream(&server, parent_message_id, "approve").await;
    continued.assert_status_ok();
    let continued_events = parse_sse_events(&continued);
    assert!(
        extract_full_text_answer(&continued_events).contains("PARENT-GATED-FINAL"),
        "the origin turn finishes once its child has reported"
    );

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let slot = slot_for(&content, "call_task_one");
    assert_eq!(
        slot["status"], "success",
        "the reserved slot is overwritten in place: {slot}"
    );
    assert_eq!(slot["output"]["status"], "completed");
    assert!(slot["output"]["reason"].is_null());
    assert!(
        slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains("CHILD-GATED-DONE")
    );
    assert!(
        slot["output"]["localTrace"].is_object(),
        "the trace the park left behind survives the settle: {slot}"
    );
    let decision = content
        .iter()
        .find(|part| part["content_type"] == "tool_approval")
        .expect("the decision is recorded on the origin row");
    assert_eq!(decision["approval_id"], "call_task_one");
    assert_eq!(decision["child_chat_id"], json!(child_chat.id));
    assert_eq!(decision["always_allow"], false);

    // The gated call really ran, in the chat that asked about it.
    let child_content = content_of(&child_parked_row(&app_state.db, child_chat.id).await);
    let child_call = child_content
        .iter()
        .find(|part| part["content_type"] == "tool_use" && part["tool_name"] == PARKED_TOOL)
        .expect("the child's gated call");
    assert_eq!(child_call["status"], "success");
    assert!(
        serde_json::to_string(&child_call["output"])
            .unwrap()
            .contains(PARKED_TOOL_RESULT)
    );
    assert_eq!(
        generation_state(&app_state.db, child_chat.id).await,
        "completed"
    );
    assert_eq!(
        generation_state(&app_state.db, parent_chat_id).await,
        "completed"
    );
}

/// Denying does not kill the child: the refusal reaches it as an ordinary tool
/// response, it finishes around it in prose, and THAT partial answer is what
/// the origin slot reports. Killing the run instead would throw away work the
/// user only meant to withhold one call from.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn deny_child_finishes_in_prose_and_parent_continues(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_child_reaches_the_gate(&mut mocks, GATED_BRIEF, "call_child_probe");
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[GATED_BRIEF, CHILD_DENIAL_TEXT],
                &["child_run_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[
                "CHILD-DENIED-ANSWER without the probe",
            ]),
        );
    });
    mock_parent_plans_one_task(&mut mocks, PARK_USER_MESSAGE, GATED_BRIEF, "call_task_one");
    mock_parent_final_answer(&mut mocks, PARK_USER_MESSAGE);

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        gate_mock_mcp_tools_on_approval,
    )
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PARK_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let child_chat = delegated_child_chat(&app_state.db, parent_chat_id).await;

    let continued = post_continuestream(&server, parent_message_id, "reject").await;
    continued.assert_status_ok();
    assert!(
        extract_full_text_answer(&parse_sse_events(&continued)).contains("PARENT-GATED-FINAL"),
        "the origin turn completes on a denial like any other result"
    );

    let child_content = content_of(&child_parked_row(&app_state.db, child_chat.id).await);
    let refused = child_content
        .iter()
        .find(|part| part["content_type"] == "tool_use" && part["tool_name"] == PARKED_TOOL)
        .expect("the denial is recorded as the child's own tool result");
    assert_eq!(refused["status"], "error");
    assert!(
        refused["output"]["error"]
            .as_str()
            .unwrap()
            .contains("denied")
    );
    assert!(
        child_content
            .iter()
            .any(|part| part["content_type"] == "text"
                && part["text"]
                    .as_str()
                    .unwrap()
                    .contains("CHILD-DENIED-ANSWER")),
        "the child answers around the call it was refused: {child_content:?}"
    );

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let rejection = content
        .iter()
        .find(|part| part["content_type"] == "tool_rejection")
        .expect("the denial is recorded on the origin row too");
    assert_eq!(rejection["approval_id"], "call_task_one");
    assert_eq!(rejection["child_chat_id"], json!(child_chat.id));
    assert!(
        rejection["reason"].is_null(),
        "a denial is not a withdrawal: {rejection}"
    );
    let slot = slot_for(&content, "call_task_one");
    assert_eq!(slot["output"]["status"], "completed");
    assert!(
        slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains("CHILD-DENIED-ANSWER"),
        "the partial answer is the result, not a failure: {slot}"
    );
    assert_eq!(
        generation_state(&app_state.db, child_chat.id).await,
        "completed"
    );
}

/// The child's second turn, once the call it asked about has run.
fn mock_child_answers_after_the_gate(mocks: &mut MockSet) {
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[GATED_BRIEF, PARKED_TOOL_RESULT],
                &["child_run_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[
                "CHILD-GATED-DONE with the probe",
            ]),
        );
    });
}

/// The origin's turn once its child has reported. Keyed on the envelope, which
/// only a settled or parked delegation slot puts in the request.
fn mock_parent_final_answer(mocks: &mut MockSet, user_message: &'static str) {
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[user_message, "child_run_id"],
                &[],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-GATED-FINAL"]),
        );
    });
}

/// A child that reaches a second gate after being resumed re-parks the turn
/// that was waiting for it: a new card, the same shape, and no model call —
/// the origin has learnt nothing yet that it could answer with.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn chained_child_approval_reparks_parent(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_child_reaches_the_gate(&mut mocks, GATED_BRIEF, "call_child_probe");
    // The resumed child asks for the same gated tool again. Nothing was stored
    // by a plain `approve`, so the gate asks a second time.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[GATED_BRIEF, PARKED_TOOL_RESULT],
                &["child_run_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_child_probe_again",
                PARKED_TOOL,
                json!({}),
            )]),
        );
    });
    mock_parent_plans_one_task(&mut mocks, PARK_USER_MESSAGE, GATED_BRIEF, "call_task_one");

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        gate_mock_mcp_tools_on_approval,
    )
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PARK_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let child_chat = delegated_child_chat(&app_state.db, parent_chat_id).await;

    post_continuestream(&server, parent_message_id, "approve")
        .await
        .assert_status_ok();

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let requests: Vec<&Value> = content
        .iter()
        .filter(|part| part["content_type"] == "tool_approval_request")
        .collect();
    assert_eq!(
        requests.len(),
        2,
        "the chained park is its own request part: {content:?}"
    );
    let second = content.last().unwrap();
    assert_eq!(
        second["content_type"], "tool_approval_request",
        "the new request is last, so the row still reads as parked: {content:?}"
    );
    assert_eq!(second["kind"], "delegated_task");
    let approvals = second["approvals"].as_array().unwrap();
    assert_eq!(approvals.len(), 1);
    assert_eq!(
        approvals[0]["approval_id"], "call_task_one",
        "the same origin call is still the one being covered"
    );
    assert_eq!(
        approvals[0]["child"]["child_tool_call_id"], "call_child_probe_again",
        "the copy names the NEW call, not the one already answered"
    );
    let slot = slot_for(&content, "call_task_one");
    assert_eq!(slot["output"]["status"], "input_required");
    assert!(slot["ended_at"].is_null());
    assert_eq!(
        generation_state(&app_state.db, parent_chat_id).await,
        "awaiting_approval"
    );
    assert_eq!(
        generation_state(&app_state.db, child_chat.id).await,
        "awaiting_approval"
    );
}

/// "Always allow" on a delegated-task card is a standing decision about the
/// CHILD's server and tool. The origin's `delegate_task` is a synthetic name no
/// gate ever consults, so a grant stored against it would be a setting that
/// silently does nothing.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approve_always_upserts_on_child_server_and_tool(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_child_reaches_the_gate(&mut mocks, GATED_BRIEF, "call_child_probe");
    mock_child_answers_after_the_gate(&mut mocks);
    mock_parent_plans_one_task(&mut mocks, PARK_USER_MESSAGE, GATED_BRIEF, "call_task_one");
    mock_parent_final_answer(&mut mocks, PARK_USER_MESSAGE);

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        |config| {
            gate_mock_mcp_tools_on_approval(config);
            config.mcp_servers_global.approval.allow_always = true;
        },
    )
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PARK_USER_MESSAGE, &["plan"]).await;
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    post_continuestream(&server, parent_message_id, "approve_always")
        .await
        .assert_status_ok();

    let settings = erato::db::entity::user_tool_approval_settings::Entity::find()
        .all(&app_state.db)
        .await
        .unwrap();
    let stored: Vec<(String, String, String)> = settings
        .iter()
        .filter(|setting| setting.active)
        .map(|setting| {
            (
                setting.mcp_server_id.clone(),
                setting.tool_name.clone(),
                setting.decision.clone(),
            )
        })
        .collect();
    assert_eq!(
        stored,
        vec![(
            "mock_mcp_approval".to_string(),
            PARKED_TOOL.to_string(),
            "always_allow".to_string()
        )],
        "the grant names the child's pair, and nothing else is stored"
    );

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let decision = content
        .iter()
        .find(|part| part["content_type"] == "tool_approval")
        .unwrap();
    assert_eq!(decision["always_allow"], true);
    assert!(decision["user_tool_approval_setting_id"].is_string());
}

/// Park one child of a fresh origin chat, and hand back the four ids the two
/// surfaces are addressed by.
async fn park_one_child(
    server: &TestServer,
    app_state: &erato::state::AppState,
) -> (Uuid, Uuid, Uuid, Uuid) {
    let chat = create_chat(server, None).await;
    let events = submit_with_facets(server, &chat, PARK_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let child_chat = delegated_child_chat(&app_state.db, parent_chat_id).await;
    let child_message_id = child_parked_row(&app_state.db, child_chat.id).await.id;
    (
        parent_chat_id,
        parent_message_id,
        child_chat.id,
        child_message_id,
    )
}

/// While the chat that dispatched a run is asking the same question, the child's
/// own card is refused: the origin holds the slot the answer is owed to, and two
/// live cards would let one approval be decided twice with only one of the two
/// decisions reaching the turn that is waiting.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn child_card_continuestream_returns_409_covered_by_parent_while_open(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_child_reaches_the_gate(&mut mocks, GATED_BRIEF, "call_child_probe");
    mock_parent_plans_one_task(&mut mocks, PARK_USER_MESSAGE, GATED_BRIEF, "call_task_one");

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        gate_mock_mcp_tools_on_approval,
    )
    .await;
    let server = app_server(app_state.clone());
    let (_parent_chat_id, parent_message_id, child_chat_id, child_message_id) =
        park_one_child(&server, &app_state).await;

    let refused = post_continuestream(&server, child_message_id, "approve").await;
    refused.assert_status(http::StatusCode::CONFLICT);
    let body = refused.json::<Value>();
    assert_eq!(body["code"], "covered_by_parent");
    assert_eq!(
        body["parent_message_id"],
        json!(parent_message_id),
        "the client is told where the question actually is: {body}"
    );
    assert_eq!(
        generation_state(&app_state.db, child_chat_id).await,
        "awaiting_approval",
        "the refusal must not disturb the child"
    );
}

/// The refusal holds only while the origin still owns the question. Once its
/// approval is settled or withdrawn, or the origin chat is archived, the child
/// is an ordinary parked chat again — otherwise a run could be answered from
/// neither side.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn child_card_answerable_again_after_parent_settled_withdrawn_or_origin_archived(
    pool: Pool<Postgres>,
) {
    let mut mocks = MockSet::new();
    mock_child_reaches_the_gate(&mut mocks, GATED_BRIEF, "call_child_probe");
    mock_child_answers_after_the_gate(&mut mocks);
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[GATED_BRIEF, CHILD_DENIAL_TEXT],
                &["child_run_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["CHILD-DENIED-ANSWER"]),
        );
    });
    mock_parent_plans_one_task(&mut mocks, PARK_USER_MESSAGE, GATED_BRIEF, "call_task_one");
    mock_parent_final_answer(&mut mocks, PARK_USER_MESSAGE);

    let (app_state, _llm) = task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        gate_mock_mcp_tools_on_approval,
    )
    .await;
    let server = app_server(app_state.clone());

    // (a) The origin answered its card, so nothing covers the child any more.
    let (_, settled_parent, _, settled_child) = park_one_child(&server, &app_state).await;
    post_continuestream(&server, settled_parent, "approve")
        .await
        .assert_status_ok();
    let answered = post_continuestream(&server, settled_child, "approve").await;
    answered.assert_status(http::StatusCode::CONFLICT);
    assert_eq!(
        answered.json::<Value>()["code"],
        "already_continued",
        "an answered child is an ordinary settled row, not a covered one"
    );

    // (b) The origin took the question back.
    let (_, withdrawn_parent, _, withdrawn_child) = park_one_child(&server, &app_state).await;
    post_continuestream(&server, withdrawn_parent, "withdraw")
        .await
        .assert_status_ok();
    let after_withdraw = post_continuestream(&server, withdrawn_child, "approve").await;
    after_withdraw.assert_status(http::StatusCode::CONFLICT);
    assert_eq!(
        after_withdraw.json::<Value>()["code"],
        "already_continued",
        "a withdrawal settles the copy, so it covers nothing"
    );

    // (c) The origin chat is gone from the user's view. The parked child is
    //     spared by the archive cascade, so it must stay answerable on its own.
    let (archived_origin, _, orphan_chat, orphan_message) =
        park_one_child(&server, &app_state).await;
    archive_chat_via_api(&server, &archived_origin.to_string()).await;
    post_continuestream(&server, orphan_message, "approve")
        .await
        .assert_status_ok();
    wait_for_generation_state(&app_state.db, orphan_chat, "completed").await;
    let orphan_content = content_of(&child_parked_row(&app_state.db, orphan_chat).await);
    let call = orphan_content
        .iter()
        .find(|part| part["content_type"] == "tool_use" && part["tool_name"] == PARKED_TOOL)
        .expect("the orphaned child's gated call");
    assert_eq!(
        call["status"], "success",
        "an orphaned parked chat is answered by its owner: {call}"
    );
}

// ---------------------------------------------------------------------------
// An `async` child that parks (D20 "Async child that parks").
// ---------------------------------------------------------------------------

const ASYNC_PARK_BRIEF: &str = "ASYNC-GATED-BRIEF: publish the probe";
const ASYNC_PARK_USER_MESSAGE: &str = "plan an async gated sub-task";
const ASYNC_PARK_CALL_ID: &str = "call_task_async";
const ASYNC_CHILD_WITH_PROBE: &str = "ASYNC-CHILD-DONE with the probe";
const ASYNC_CHILD_WITHOUT_PROBE: &str = "ASYNC-CHILD-DONE without the probe";
const ASYNC_ABANDON_MESSAGE: &str = "never mind the probe, just summarise";
const ASYNC_CHILD_ABANDONED: &str = "ASYNC-CHILD-DONE after the card was abandoned";

/// Every turn the tests below can reach: the origin dispatches one `async`
/// task, the child walks into the gate, and — whichever way the card is
/// answered — it finishes in prose. Both continuations are registered in all of
/// them, because a mock nobody matches costs nothing and one fixture per
/// decision would be the same five turns twice.
fn mock_async_gated_task(mocks: &mut MockSet) {
    // The child's continuations first: their context is a superset of its
    // opening turn's, so registering them later would lose to it.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[ASYNC_PARK_BRIEF, PARKED_TOOL_RESULT],
                &["child_run_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[ASYNC_CHILD_WITH_PROBE]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[ASYNC_PARK_BRIEF, CHILD_DENIAL_TEXT],
                &["child_run_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[ASYNC_CHILD_WITHOUT_PROBE]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[ASYNC_PARK_BRIEF],
                &[PARKED_TOOL_RESULT, CHILD_DENIAL_TEXT, "child_run_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_async_probe",
                PARKED_TOOL,
                json!({}),
            )]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[ASYNC_PARK_USER_MESSAGE, "dispatched"],
                &[],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-ASYNC-FINAL"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[ASYNC_PARK_USER_MESSAGE],
                &[ASYNC_PARK_BRIEF, "dispatched"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                ASYNC_PARK_CALL_ID,
                "delegate_task",
                json!({
                    "task": ASYNC_PARK_BRIEF,
                    "facet_ids": ["plan"],
                    "run_mode": "async",
                }),
            )]),
        );
    });
}

/// The resumed child walks into a gate a second time. Registered before
/// [`mock_async_gated_task`], whose continuation mock answers the same context
/// in prose.
fn mock_async_child_parks_again(mocks: &mut MockSet) {
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[ASYNC_PARK_BRIEF, PARKED_TOOL_RESULT],
                &["child_run_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[(
                "call_async_probe_again",
                PARKED_TOOL,
                json!({}),
            )]),
        );
    });
}

/// The child's turn after its owner writes into the parked chat instead of
/// answering the card. Registered before [`mock_async_gated_task`], whose
/// opening-turn mock would otherwise match this context too.
fn mock_async_child_abandoned_turn(mocks: &mut MockSet) {
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[ASYNC_PARK_BRIEF, ASYNC_ABANDON_MESSAGE],
                &["child_run_id"],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&[ASYNC_CHILD_ABANDONED]),
        );
    });
}

/// A deployment that offers `async` tasks and gates the mock MCP server.
///
/// `silent` scheduling throughout: a reaction turn is another generation with
/// another mock to satisfy, and everything asserted below is about the delivery
/// records and the rows they append, which a silent result writes just the same.
/// The reaction itself is covered where the delivery path is.
async fn async_park_state(
    pool: Pool<Postgres>,
    mocks: MockSet,
) -> (erato::state::AppState, mocktail::server::MockServer) {
    task_state(
        pool,
        mocks,
        &["erato/delegate_task", "mock_mcp_approval/*"],
        |config| {
            gate_mock_mcp_tools_on_approval(config);
            config.delegation.tasks.run_modes = vec![
                erato_config::config::TaskRunMode::Wait,
                erato_config::config::TaskRunMode::Async,
            ];
            // This turn asks for `async`, which the shipped default
            // `async_only` would park before it ran; the policy has tests of
            // its own.
            config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Never;
            config.delegation.tasks.scheduling = erato_config::config::TaskScheduling::Silent;
        },
    )
    .await
}

/// Dispatch one `async` task that parks, and hand back the origin chat, the
/// child chat and the child's own parked row.
async fn park_one_async_child(
    server: &TestServer,
    app_state: &erato::state::AppState,
) -> (Uuid, Uuid, Uuid) {
    let chat = create_chat(server, None).await;
    let events = submit_with_facets(server, &chat, ASYNC_PARK_USER_MESSAGE, &["plan"]).await;
    assert!(extract_full_text_answer(&events).contains("PARENT-ASYNC-FINAL"));
    let origin_chat_id = Uuid::parse_str(&chat).unwrap();
    let child_chat = delegated_child_chat(&app_state.db, origin_chat_id).await;
    wait_for_generation_state(&app_state.db, child_chat.id, "awaiting_approval").await;
    let child_message_id = child_parked_row(&app_state.db, child_chat.id).await.id;
    (origin_chat_id, child_chat.id, child_message_id)
}

/// The child's delivery envelope once it is `delivered` at `sequence`.
async fn wait_for_delivered_sequence(
    app_state: &erato::state::AppState,
    child_chat_id: Uuid,
    sequence: u64,
) -> Value {
    for _ in 0..150 {
        let delivery = delivery_of(app_state, child_chat_id).await;
        if delivery["sequence"].as_u64() == Some(sequence)
            && delivery["state"].as_str() == Some("delivered")
        {
            return delivery;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    panic!(
        "the delivery of child {child_chat_id} never reached sequence {sequence}; it is {:?}",
        delivery_of(app_state, child_chat_id).await
    );
}

/// An `async` child parks on a gated call like any other task child, but it has
/// no turn waiting on it — so its own card is the surface, and what reaches the
/// conversation that asked for the task is a `task_result { input_required }`
/// row saying where the question is.
///
/// The origin must NOT grow an approval part of its own: the turn that
/// dispatched the run finished long ago, and a card there would be a second
/// place to answer one question.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn async_child_parks_and_origin_receives_input_required_task_result(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_async_gated_task(&mut mocks);
    let (app_state, _llm) = async_park_state(pool, mocks).await;
    let server = app_server(app_state.clone());

    let (origin_chat_id, child_chat_id, child_message_id) =
        park_one_async_child(&server, &app_state).await;

    let child_content = content_of(&message_row(&app_state.db, child_message_id).await);
    assert_eq!(
        child_content.last().map(|part| &part["content_type"]),
        Some(&json!("tool_approval_request")),
        "the child must park on its own card: {child_content:?}"
    );

    let delivery = wait_for_delivered_sequence(&app_state, child_chat_id, 0).await;
    assert_eq!(delivery["status"], "input_required");
    assert_eq!(delivery["reason"], "approval_pending");

    let results = task_result_rows(&app_state.db, origin_chat_id).await;
    assert_eq!(results.len(), 1, "one notification, not one per park");
    let part = &results[0].raw_message["content"][0];
    assert_eq!(part["content_type"], "task_result");
    assert_eq!(part["status"], "input_required");
    assert_eq!(part["reason"], "approval_pending");
    assert_eq!(part["sequence"], 0);
    assert_eq!(
        part["child_chat_id"],
        json!(child_chat_id),
        "the card points at the chat the question is on: {part}"
    );
    assert_eq!(part["parent_tool_call_id"], ASYNC_PARK_CALL_ID);

    let origin_rows = active_thread_rows(&app_state.db, origin_chat_id).await;
    assert!(
        origin_rows
            .iter()
            .flat_map(|row| row.raw_message["content"]
                .as_array()
                .cloned()
                .unwrap_or_default())
            .all(|part| part["content_type"] != "tool_approval_request"),
        "the origin must not raise a card of its own for a detached run"
    );
}

/// Answering the child's card is what makes the run's real answer reach the
/// origin, and nothing else can: the decision runs through `continuestream` on
/// the CHILD chat, while the delivery that carried the notification is finished
/// and its claim only takes `pending` rows. The child-side tail therefore
/// re-arms the delivery, and the origin ends up with two results — the question
/// and the answer — told apart by `sequence`.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn deciding_on_async_child_rearms_delivery_and_delivers_final_result_with_sequence_1(
    pool: Pool<Postgres>,
) {
    let mut mocks = MockSet::new();
    mock_async_gated_task(&mut mocks);
    let (app_state, _llm) = async_park_state(pool, mocks).await;
    let server = app_server(app_state.clone());

    let (origin_chat_id, child_chat_id, child_message_id) =
        park_one_async_child(&server, &app_state).await;
    let notification = wait_for_delivered_sequence(&app_state, child_chat_id, 0).await;

    post_continuestream(&server, child_message_id, "approve")
        .await
        .assert_status_ok();
    wait_for_generation_state(&app_state.db, child_chat_id, "completed").await;

    let final_delivery = wait_for_delivered_sequence(&app_state, child_chat_id, 1).await;
    assert_eq!(final_delivery["status"], "completed");
    assert_ne!(
        final_delivery["delivery_id"], notification["delivery_id"],
        "a re-armed delivery is a new one, or the origin's duplicate probe \
         would recognise it and append nothing"
    );

    let results = task_result_rows(&app_state.db, origin_chat_id).await;
    assert_eq!(
        results.len(),
        2,
        "two rows per run that parked: {results:?}"
    );
    let sequences: Vec<Value> = results
        .iter()
        .map(|row| row.raw_message["content"][0]["sequence"].clone())
        .collect();
    assert_eq!(sequences, vec![json!(0), json!(1)]);
    let answer = &results[1].raw_message["content"][0];
    assert_eq!(answer["status"], "completed");
    assert_eq!(
        answer["redeliveries"], 0,
        "the answer is a second result, not the notification delivered again —          a client badging it as one would tell the reader they have seen it: {answer}"
    );
    assert!(
        answer["summary"]
            .as_str()
            .is_some_and(|summary| summary.contains(ASYNC_CHILD_WITH_PROBE)),
        "the second row carries the answer the decision unblocked: {answer}"
    );

    let call = slot_for(
        &content_of(&message_row(&app_state.db, child_message_id).await),
        "call_async_probe",
    );
    assert_eq!(
        call["status"], "success",
        "the approved call ran on the child: {call}"
    );
}

/// Denying the call is not killing the run. The child gets the denial as the
/// tool's answer and finishes in prose, so what the origin is finally told is
/// `completed` — a run that reported, without the tool — and not a failure the
/// model would be invited to retry.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn denied_async_child_delivers_completed_in_prose(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_async_gated_task(&mut mocks);
    let (app_state, _llm) = async_park_state(pool, mocks).await;
    let server = app_server(app_state.clone());

    let (origin_chat_id, child_chat_id, child_message_id) =
        park_one_async_child(&server, &app_state).await;
    wait_for_delivered_sequence(&app_state, child_chat_id, 0).await;

    post_continuestream(&server, child_message_id, "reject")
        .await
        .assert_status_ok();
    wait_for_generation_state(&app_state.db, child_chat_id, "completed").await;

    let final_delivery = wait_for_delivered_sequence(&app_state, child_chat_id, 1).await;
    assert_eq!(final_delivery["status"], "completed");
    assert!(
        final_delivery["reason"].is_null(),
        "a denial is an ordinary tool answer and carries no reason: {final_delivery}"
    );

    let child_content = content_of(&message_row(&app_state.db, child_message_id).await);
    let call = slot_for(&child_content, "call_async_probe");
    assert_eq!(
        call["status"], "error",
        "the denied call did not run: {call}"
    );

    let results = task_result_rows(&app_state.db, origin_chat_id).await;
    assert_eq!(results.len(), 2);
    let answer = &results[1].raw_message["content"][0];
    assert_eq!(answer["status"], "completed");
    assert!(
        answer["summary"]
            .as_str()
            .is_some_and(|summary| summary.contains(ASYNC_CHILD_WITHOUT_PROBE)),
        "the denied run still reports what it managed to do: {answer}"
    );
}

/// The card is not the only way a parked run moves on. A person who writes into
/// the run's own chat abandons the card and gets an answer that way, and the
/// conversation that asked for the task is owed that answer just as much — so
/// the re-arm lives in the tail every user-driven generation shares, not in the
/// continuation alone. This drives the `message_submit` tail; `edit` and
/// `regenerate` reach the same helper.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn writing_into_a_parked_async_child_also_rearms_its_delivery(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_async_child_abandoned_turn(&mut mocks);
    mock_async_gated_task(&mut mocks);
    let (app_state, _llm) = async_park_state(pool, mocks).await;
    let server = app_server(app_state.clone());

    let (origin_chat_id, child_chat_id, child_message_id) =
        park_one_async_child(&server, &app_state).await;
    wait_for_delivered_sequence(&app_state, child_chat_id, 0).await;

    let events = submit_message(
        &server,
        &child_chat_id.to_string(),
        Some(&child_message_id.to_string()),
        ASYNC_ABANDON_MESSAGE,
        vec![],
    )
    .await;
    assert!(extract_full_text_answer(&events).contains(ASYNC_CHILD_ABANDONED));

    let final_delivery = wait_for_delivered_sequence(&app_state, child_chat_id, 1).await;
    assert_eq!(final_delivery["status"], "completed");

    let results = task_result_rows(&app_state.db, origin_chat_id).await;
    assert_eq!(results.len(), 2, "the answer is owed too: {results:?}");
    let answer = &results[1].raw_message["content"][0];
    assert_eq!(answer["sequence"], 1);
    assert_eq!(
        answer["redeliveries"], 0,
        "a re-arm is a new result, not this one delivered again: {answer}"
    );
    assert!(
        answer["summary"]
            .as_str()
            .is_some_and(|summary| summary.contains(ASYNC_CHILD_ABANDONED)),
        "what the run said after the card was abandoned: {answer}"
    );
}

/// A run that parks a second time owes nothing further. The notification the
/// conversation already holds still describes the situation — the task stopped
/// to ask — so the `sequence` bump stays spent on the answer and the origin does
/// not collect one row per gate a long run walks into.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_async_child_that_parks_again_delivers_no_second_notification(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_async_child_parks_again(&mut mocks);
    mock_async_gated_task(&mut mocks);
    let (app_state, _llm) = async_park_state(pool, mocks).await;
    let server = app_server(app_state.clone());

    let (origin_chat_id, child_chat_id, child_message_id) =
        park_one_async_child(&server, &app_state).await;
    let notification = wait_for_delivered_sequence(&app_state, child_chat_id, 0).await;

    post_continuestream(&server, child_message_id, "approve")
        .await
        .assert_status_ok();
    let parks = |content: &[Value]| {
        content
            .iter()
            .filter(|part| part["content_type"] == "tool_approval_request")
            .count()
    };
    for _ in 0..150 {
        if parks(&content_of(
            &message_row(&app_state.db, child_message_id).await,
        )) == 2
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let content = content_of(&message_row(&app_state.db, child_message_id).await);
    assert_eq!(
        parks(&content),
        2,
        "the resumed run walked into a second gate: {content:?}"
    );

    // Nothing is owed, so there is no state to wait for: poll long enough that a
    // re-armed delivery would have been written and drained.
    for _ in 0..10 {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        assert_eq!(
            delivery_of(&app_state, child_chat_id).await["delivery_id"],
            notification["delivery_id"],
            "the notification is still the only delivery this run has owed"
        );
        assert_eq!(
            task_result_rows(&app_state.db, origin_chat_id).await.len(),
            1,
            "one row for a run that is still asking, not one per question"
        );
    }
}

/// A notification the origin has not taken yet is replaced, not waited for.
///
/// The window is not a race: an origin parked on an approval of its own defers
/// every delivery and puts the claim back, so the notification sits `pending`
/// for as long as that lasts — and the run's own chat is reachable from the runs
/// list all the while. A re-arm that insisted on `delivered` would give up
/// there, and nothing else would ever carry the answer; worse, the one row the
/// origin eventually got would carry the finished answer under `input_required`,
/// telling its model to wait for a result that could never come.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_rearm_replaces_a_notification_the_origin_never_took(pool: Pool<Postgres>) {
    const PARKED_ANSWER: &str = "SEEDED-ANSWER-AFTER-THE-DECISION";

    let (app_state, _llm) = task_enabled_state_with_async(pool).await;
    let me = test_user(&app_state).await;
    let server = app_server(app_state.clone());
    let origin = create_chat(&server, None).await;
    let origin_chat_id = Uuid::parse_str(&origin).unwrap();

    let child_id = seed_child_owing_a_result(
        &app_state,
        &me.id.to_string(),
        origin_chat_id,
        Some(PARKED_ANSWER),
        erato_config::config::TaskScheduling::Silent,
    )
    .await;
    let mut notification = delivery_struct(&app_state, child_id).await;
    let answer_row_id = notification
        .result_message_id
        .expect("the seeded delivery names the run's answer row");
    notification.status = "input_required".to_string();
    notification.reason = Some("approval_pending".to_string());
    write_delivery(&app_state, child_id, &notification).await;

    let drained = erato::services::task_delivery::rearm_delivery_after_child_decision(
        &app_state,
        child_id,
        answer_row_id,
        erato::services::background_tasks::TaskOutcome::Completed,
        false,
    )
    .await;
    assert_eq!(
        drained,
        Some(origin_chat_id),
        "the re-arm must hand back the origin for the caller to drain"
    );

    let rearmed = delivery_struct(&app_state, child_id).await;
    assert_eq!(
        rearmed.state,
        erato::models::chat::ResultDeliveryState::Pending
    );
    assert_eq!(rearmed.status, "completed");
    assert_eq!(rearmed.sequence, 1);
    assert_ne!(rearmed.delivery_id, notification.delivery_id);

    assert_eq!(sweep_once(&app_state).await.delivered, 1);
    let results = task_result_rows(&app_state.db, origin_chat_id).await;
    assert_eq!(
        results.len(),
        1,
        "the question was never delivered, so the answer is all the origin is \
         ever told: {results:?}"
    );
    let part = &results[0].raw_message["content"][0];
    assert_eq!(part["status"], "completed");
    assert_eq!(part["sequence"], 1);
    assert!(
        part["summary"]
            .as_str()
            .is_some_and(|summary| summary.contains(PARKED_ANSWER)),
        "and what it is told is the answer, not the question: {part}"
    );
}

// ---------------------------------------------------------------------------
// Dispatch-approval policy (`[delegation.tasks.approval]`).
// ---------------------------------------------------------------------------

const PLAN_USER_MESSAGE: &str = "plan the two-step research";
const PLAN_BRIEF_A: &str = "PLAN-BRIEF-A: gather the figures";
const PLAN_BRIEF_B: &str = "PLAN-BRIEF-B: summarise the figures";
/// The refusal a denied plan item settles as, which the model then answers
/// around. Not a `reason`: the envelope vocabulary has none for "the user said
/// no", and a declined task is not a run outcome.
const PLAN_DENIAL_TEXT: &str = "The user declined this task.";

/// A planning state with the dispatch-approval policy set explicitly. Every
/// test here is about the policy, so none of them leans on the shipped default.
async fn plan_policy_state(
    pool: Pool<Postgres>,
    mocks: MockSet,
    tweak: impl FnOnce(&mut erato::config::AppConfig),
) -> (erato::state::AppState, mocktail::server::MockServer) {
    task_state(pool, mocks, &["erato/delegate_task"], tweak).await
}

/// The origin's first turn: plan two sub-tasks in one batch, in this order.
fn mock_parent_plans_two_tasks(mocks: &mut MockSet, run_mode: Option<&'static str>) {
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[PLAN_USER_MESSAGE],
                &[PLAN_BRIEF_A, PLAN_BRIEF_B],
            ));
        let arguments = |brief: &str| match run_mode {
            Some(mode) => {
                json!({ "task": brief, "facet_ids": ["plan"], "run_mode": mode })
            }
            None => json!({ "task": brief, "facet_ids": ["plan"] }),
        };
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[
                ("call_plan_a", "delegate_task", arguments(PLAN_BRIEF_A)),
                ("call_plan_b", "delegate_task", arguments(PLAN_BRIEF_B)),
            ]),
        );
    });
}

/// Each child answers its own brief. Excluded on the envelope key, which only
/// the origin's replayed tool responses carry.
fn mock_plan_children_answer(mocks: &mut MockSet) {
    for (brief, answer) in [
        (PLAN_BRIEF_A, "CHILD-A-DONE"),
        (PLAN_BRIEF_B, "CHILD-B-DONE"),
    ] {
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[brief], &["child_run_id"]));
            mock_llm_sse_response(
                then,
                crate::test_utils::build_openai_text_streaming_response(&[answer]),
            );
        });
    }
}

/// The origin's turn once the decision has been applied. Keyed on a needle the
/// settled batch puts in the request and the planning turn cannot have.
fn mock_parent_answers_after_the_plan(mocks: &mut MockSet, needle: &'static str) {
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[PLAN_USER_MESSAGE, needle], &[]));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_text_streaming_response(&["PARENT-PLAN-FINAL"]),
        );
    });
}

/// Decide a card item by item. The legacy single-`decision` body cannot express
/// a plan of more than one task, because it names no approval.
async fn post_continuestream_decisions(
    server: &TestServer,
    message_id: Uuid,
    decisions: &[(&str, &str)],
) -> axum_test::TestResponse {
    let decisions: Vec<Value> = decisions
        .iter()
        .map(|(approval_id, decision)| json!({ "approval_id": approval_id, "decision": decision }))
        .collect();
    server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "message_id": message_id, "decisions": decisions }))
        .await
}

/// The part every one of these tests reads: the plan card at the tail of the
/// origin row.
fn plan_request(content: &[Value]) -> Value {
    let request = content.last().expect("expected a persisted content part");
    assert_eq!(
        request["content_type"], "tool_approval_request",
        "the request must be the LAST part, or the six last-part checks stop \
         seeing a parked row: {content:?}"
    );
    request.clone()
}

/// The whole point of asking BEFORE dispatch: at the moment the card appears
/// nothing has been created — no child chat, no run, not even a queued
/// placeholder — so declining costs the deployment nothing at all. A gate
/// anywhere inside the pop loop would already have launched the first task.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn plan_policy_parks_before_any_child_is_created(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_parent_plans_two_tasks(&mut mocks, None);

    let (app_state, _llm) = plan_policy_state(pool, mocks, |config| {
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Plan;
    })
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PLAN_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    assert!(
        delegated_child_chats(&app_state.db, parent_chat_id)
            .await
            .is_empty(),
        "no child row may exist before the decision"
    );

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    assert!(
        content
            .iter()
            .all(|part| part["content_type"] != "tool_use"),
        "a parked plan leaves no queued or working slots behind: {content:?}"
    );
    let request = plan_request(&content);
    assert_eq!(request["kind"], "task_plan");
    assert_eq!(request["tool_name"], "delegate_task");
    assert_eq!(
        request["mcp_server_id"], "",
        "no MCP server is being asked about on this card"
    );
    assert_eq!(
        request["allow_always"], false,
        "a plan has no standing grant in v1"
    );

    let approvals = request["approvals"].as_array().unwrap();
    assert_eq!(approvals.len(), 2, "one item per task: {approvals:?}");
    assert_eq!(approvals[0]["approval_id"], "plan:1:0");
    assert_eq!(approvals[1]["approval_id"], "plan:1:1");
    assert_eq!(approvals[0]["tool_call_id"], "call_plan_a");
    assert_eq!(approvals[1]["tool_call_id"], "call_plan_b");
    assert_eq!(approvals[0]["tool_name"], "delegate_task");
    assert_eq!(approvals[0]["input"]["task"], PLAN_BRIEF_A);
    assert!(
        approvals.iter().all(|item| item["child"].is_null()),
        "there is no child to name yet: {approvals:?}"
    );
    assert!(
        request["pending_tool_calls"].as_array().unwrap().is_empty(),
        "the whole batch was task calls the policy targeted"
    );

    assert_eq!(
        generation_state(&app_state.db, parent_chat_id).await,
        "awaiting_approval"
    );
    assert!(
        extract_full_text_answer(&events).is_empty(),
        "a parked turn answers nothing"
    );
}

/// Approving the plan dispatches the calls it recorded, through the normal
/// `delegate_task` path and in the order the model asked for them — so the
/// per-turn cap, the concurrency bound and the queue-within-batch all apply to
/// an approved plan exactly as they do to an unasked one.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approve_plan_dispatches_recorded_calls_in_order(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_parent_plans_two_tasks(&mut mocks, None);
    mock_plan_children_answer(&mut mocks);
    mock_parent_answers_after_the_plan(&mut mocks, "CHILD-B-DONE");

    let (app_state, _llm) = plan_policy_state(pool, mocks, |config| {
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Plan;
    })
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PLAN_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    let continued = post_continuestream_decisions(
        &server,
        parent_message_id,
        &[("plan:1:0", "approve"), ("plan:1:1", "approve")],
    )
    .await;
    continued.assert_status_ok();
    assert!(
        extract_full_text_answer(&parse_sse_events(&continued)).contains("PARENT-PLAN-FINAL"),
        "the turn finishes once both tasks have reported"
    );

    assert_eq!(
        delegated_child_chats(&app_state.db, parent_chat_id)
            .await
            .len(),
        2,
        "both approved tasks ran"
    );

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let dispatched: Vec<&str> = content
        .iter()
        .filter(|part| part["content_type"] == "tool_use")
        .map(|part| part["tool_call_id"].as_str().unwrap())
        .collect();
    assert_eq!(
        dispatched,
        vec!["call_plan_a", "call_plan_b"],
        "the model is answered in the order it asked: {content:?}"
    );
    for (tool_call_id, answer) in [
        ("call_plan_a", "CHILD-A-DONE"),
        ("call_plan_b", "CHILD-B-DONE"),
    ] {
        let slot = slot_for(&content, tool_call_id);
        assert_eq!(slot["status"], "success", "{slot}");
        assert_eq!(slot["output"]["status"], "completed");
        assert!(slot["output"]["result"].as_str().unwrap().contains(answer));
    }
    let decisions: Vec<&str> = content
        .iter()
        .filter(|part| part["content_type"] == "tool_approval")
        .map(|part| part["approval_id"].as_str().unwrap())
        .collect();
    assert_eq!(decisions, vec!["plan:1:0", "plan:1:1"]);
    assert_eq!(
        generation_state(&app_state.db, parent_chat_id).await,
        "completed"
    );
}

/// Declining the whole plan settles each task as its own refusal and creates
/// nothing. Ending the turn instead would leave the chat on a card the user has
/// already answered, and refusing the calls as a batch would leave the model
/// unable to tell which of its tasks it was told not to run.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn deny_plan_emits_refusal_per_task_and_no_children(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_parent_plans_two_tasks(&mut mocks, None);
    mock_parent_answers_after_the_plan(&mut mocks, PLAN_DENIAL_TEXT);

    let (app_state, _llm) = plan_policy_state(pool, mocks, |config| {
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Plan;
    })
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PLAN_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    let continued = post_continuestream_decisions(
        &server,
        parent_message_id,
        &[("plan:1:0", "reject"), ("plan:1:1", "reject")],
    )
    .await;
    continued.assert_status_ok();
    assert!(
        extract_full_text_answer(&parse_sse_events(&continued)).contains("PARENT-PLAN-FINAL"),
        "a denial is not a kill: the turn still answers"
    );

    assert!(
        delegated_child_chats(&app_state.db, parent_chat_id)
            .await
            .is_empty(),
        "a declined plan creates nothing"
    );

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    for tool_call_id in ["call_plan_a", "call_plan_b"] {
        let slot = slot_for(&content, tool_call_id);
        assert_eq!(slot["status"], "error", "{slot}");
        assert_eq!(slot["output"]["status"], "rejected");
        assert_eq!(slot["output"]["error"], PLAN_DENIAL_TEXT);
        assert!(
            slot["output"]["reason"].is_null(),
            "a plan denial carries no reason: {slot}"
        );
    }
    let rejections: Vec<&Value> = content
        .iter()
        .filter(|part| part["content_type"] == "tool_rejection")
        .collect();
    assert_eq!(rejections.len(), 2);
    assert!(
        rejections.iter().all(|part| part["reason"].is_null()),
        "only a withdraw carries a reason: {rejections:?}"
    );
    assert!(
        rejections.iter().all(|part| part["never_allow"] == false),
        "a plan has no standing denial either: {rejections:?}"
    );
}

/// A plan can be pruned rather than only accepted or refused whole — which is
/// what one item per task buys, and the reason the card is not a single
/// approval covering the batch.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn partial_plan_approval_dispatches_only_approved(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_parent_plans_two_tasks(&mut mocks, None);
    mock_plan_children_answer(&mut mocks);
    mock_parent_answers_after_the_plan(&mut mocks, "CHILD-A-DONE");

    let (app_state, _llm) = plan_policy_state(pool, mocks, |config| {
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Plan;
    })
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PLAN_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    let continued = post_continuestream_decisions(
        &server,
        parent_message_id,
        &[("plan:1:0", "approve"), ("plan:1:1", "reject")],
    )
    .await;
    continued.assert_status_ok();
    assert!(extract_full_text_answer(&parse_sse_events(&continued)).contains("PARENT-PLAN-FINAL"));

    let children = delegated_child_chats(&app_state.db, parent_chat_id).await;
    assert_eq!(children.len(), 1, "only the approved task ran");

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let approved = slot_for(&content, "call_plan_a");
    assert_eq!(approved["output"]["status"], "completed");
    assert!(
        approved["output"]["result"]
            .as_str()
            .unwrap()
            .contains("CHILD-A-DONE")
    );
    let declined = slot_for(&content, "call_plan_b");
    assert_eq!(declined["output"]["status"], "rejected");
    assert_eq!(declined["output"]["error"], PLAN_DENIAL_TEXT);
}

/// Taking the question back is a decision, not an escape: every open item is
/// denied with `reason: "withdrawn"` and the turn finishes in prose, rather
/// than leaving the chat parked on a card the user has dismissed.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn withdraw_plan_denies_every_item_and_turn_continues(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_parent_plans_two_tasks(&mut mocks, None);
    mock_parent_answers_after_the_plan(&mut mocks, PLAN_DENIAL_TEXT);

    let (app_state, _llm) = plan_policy_state(pool, mocks, |config| {
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Plan;
    })
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PLAN_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    let continued = post_continuestream_decisions(
        &server,
        parent_message_id,
        &[("plan:1:0", "withdraw"), ("plan:1:1", "withdraw")],
    )
    .await;
    continued.assert_status_ok();
    assert!(
        extract_full_text_answer(&parse_sse_events(&continued)).contains("PARENT-PLAN-FINAL"),
        "deny is not kill, and withdraw is a deny"
    );

    assert!(
        delegated_child_chats(&app_state.db, parent_chat_id)
            .await
            .is_empty()
    );
    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let rejections: Vec<&Value> = content
        .iter()
        .filter(|part| part["content_type"] == "tool_rejection")
        .collect();
    assert_eq!(rejections.len(), 2);
    assert!(
        rejections.iter().all(|part| part["reason"] == "withdrawn"),
        "every item carries the withdraw reason: {rejections:?}"
    );
    assert_eq!(
        generation_state(&app_state.db, parent_chat_id).await,
        "completed"
    );
}

/// The default mode asks about the calls that detach and lets the awaited ones
/// of the same batch run: an awaited task reports into the turn that asked for
/// it, so the user sees what it did, while a detached one runs on after the
/// turn has ended. The `wait` call therefore rides along in
/// `pending_tool_calls` and dispatches once the decision is in.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn async_only_policy_asks_only_for_async_calls(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[PLAN_USER_MESSAGE],
                &[PLAN_BRIEF_A, PLAN_BRIEF_B],
            ));
        mock_llm_sse_response(
            then,
            crate::test_utils::build_openai_tool_calls_streaming_response(&[
                (
                    "call_plan_a",
                    "delegate_task",
                    json!({ "task": PLAN_BRIEF_A, "facet_ids": ["plan"] }),
                ),
                (
                    "call_plan_b",
                    "delegate_task",
                    json!({ "task": PLAN_BRIEF_B, "facet_ids": ["plan"], "run_mode": "async" }),
                ),
            ]),
        );
    });
    mock_plan_children_answer(&mut mocks);
    mock_parent_answers_after_the_plan(&mut mocks, "CHILD-A-DONE");

    let (app_state, _llm) = plan_policy_state(pool, mocks, |config| {
        config.delegation.tasks.run_modes = vec![
            erato_config::config::TaskRunMode::Wait,
            erato_config::config::TaskRunMode::Async,
        ];
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::AsyncOnly;
        // The detached result is stored rather than answered, so nothing but the
        // decision drives the assertions below.
        config.delegation.tasks.scheduling = erato_config::config::TaskScheduling::Silent;
    })
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PLAN_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let request = plan_request(&content);
    assert_eq!(request["kind"], "task_plan");
    let approvals = request["approvals"].as_array().unwrap();
    assert_eq!(
        approvals.len(),
        1,
        "only the detached call is asked about: {approvals:?}"
    );
    assert_eq!(approvals[0]["tool_call_id"], "call_plan_b");
    let pending: Vec<&str> = request["pending_tool_calls"]
        .as_array()
        .unwrap()
        .iter()
        .map(|call| call["call_id"].as_str().unwrap())
        .collect();
    assert_eq!(
        pending,
        vec!["call_plan_a"],
        "the awaited call of the same batch waits for the decision rather than \
         being asked about"
    );
    assert!(
        delegated_child_chats(&app_state.db, parent_chat_id)
            .await
            .is_empty(),
        "not even the ungated call runs before the decision: a plan card must \
         not leave queued slots behind"
    );

    let continued =
        post_continuestream_decisions(&server, parent_message_id, &[("plan:1:0", "reject")]).await;
    continued.assert_status_ok();
    assert!(extract_full_text_answer(&parse_sse_events(&continued)).contains("PARENT-PLAN-FINAL"));

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    assert_eq!(
        slot_for(&content, "call_plan_b")["output"]["status"],
        "rejected"
    );
    let awaited = slot_for(&content, "call_plan_a");
    assert_eq!(
        awaited["output"]["status"], "completed",
        "the rest of the batch runs after the decision: {awaited}"
    );
}

/// The default is the unconditional literal, so this is where "equivalent to
/// `never`" is actually established: with the default `run_modes` there is no
/// detached call to ask about and the gate never fires.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn async_only_is_inert_when_run_modes_excludes_async(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_parent_plans_two_tasks(&mut mocks, None);
    mock_plan_children_answer(&mut mocks);
    mock_parent_answers_after_the_plan(&mut mocks, "CHILD-B-DONE");

    // No tweak at all: the shipped defaults are what this test is about.
    let (app_state, _llm) = plan_policy_state(pool, mocks, |_| {}).await;
    assert_eq!(
        app_state.config.delegation.tasks.approval.mode,
        erato_config::config::TaskApprovalMode::AsyncOnly
    );
    assert_eq!(
        app_state.config.delegation.tasks.run_modes,
        vec![erato_config::config::TaskRunMode::Wait]
    );

    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PLAN_USER_MESSAGE, &["plan"]).await;
    assert!(
        extract_full_text_answer(&events).contains("PARENT-PLAN-FINAL"),
        "the turn runs to its answer without asking"
    );

    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    assert!(
        content
            .iter()
            .all(|part| part["content_type"] != "tool_approval_request"),
        "nothing was asked: {content:?}"
    );
    assert_eq!(
        delegated_child_chats(&app_state.db, parent_chat_id)
            .await
            .len(),
        2,
        "both tasks were dispatched unasked"
    );
}

/// `always` is the mode a deployment picks when it wants a person in the loop
/// for every delegated task, so it must fire on a batch of one awaited call —
/// the case `plan` deliberately lets through.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn always_policy_asks_for_a_single_wait_task(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_parent_plans_one_task(&mut mocks, PLAN_USER_MESSAGE, PLAN_BRIEF_A, "call_plan_a");

    let (app_state, _llm) = plan_policy_state(pool, mocks, |config| {
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Always;
        // High enough that `plan` would not have asked: the modes are
        // independent, and this one does not read the threshold at all.
        config.delegation.tasks.approval.plan_min_tasks = 5;
    })
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PLAN_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let request = plan_request(&content);
    assert_eq!(request["kind"], "task_plan");
    let approvals = request["approvals"].as_array().unwrap();
    assert_eq!(approvals.len(), 1);
    assert_eq!(approvals[0]["approval_id"], "plan:1:0");
    assert_eq!(approvals[0]["tool_call_id"], "call_plan_a");
    assert!(
        delegated_child_chats(&app_state.db, parent_chat_id)
            .await
            .is_empty()
    );
    assert_eq!(
        generation_state(&app_state.db, parent_chat_id).await,
        "awaiting_approval"
    );
}

/// A planning facet may run under a stricter policy than the deployment
/// default, which is the shape a dedicated "plan & delegate" facet needs: the
/// global setting stays permissive for ordinary chats.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn facet_override_beats_global_policy(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_parent_plans_one_task(&mut mocks, PLAN_USER_MESSAGE, PLAN_BRIEF_A, "call_plan_a");

    let (app_state, _llm) = plan_policy_state(pool, mocks, |config| {
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Never;
        let facet = config
            .facets
            .facets
            .get_mut("plan")
            .expect("the planning facet");
        facet.delegation = Some(erato_config::config::FacetDelegationOverrides {
            max_tasks_per_turn: None,
            max_server_tool_calls_per_task: None,
            max_client_tool_calls_per_task: None,
            max_parallel: None,
            persona: None,
            child_facet_ids: None,
            run_modes: None,
            scheduling: None,
            approval: Some(erato_config::config::FacetDelegationApprovalOverrides {
                mode: Some(erato_config::config::TaskApprovalMode::Always),
                plan_min_tasks: None,
            }),
        });
    })
    .await;
    let server = app_server(app_state.clone());
    let chat = create_chat(&server, None).await;
    let events = submit_with_facets(&server, &chat, PLAN_USER_MESSAGE, &["plan"]).await;
    let parent_chat_id = Uuid::parse_str(&chat).unwrap();
    let parent_message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    let content = content_of(&message_row(&app_state.db, parent_message_id).await);
    let request = plan_request(&content);
    assert_eq!(
        request["kind"], "task_plan",
        "the facet's `always` wins over the deployment's `never`"
    );
    assert!(
        delegated_child_chats(&app_state.db, parent_chat_id)
            .await
            .is_empty()
    );
}
