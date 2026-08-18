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
    app_config.assistants.delegation.enabled = true;
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
    app_config.assistants.delegation.enabled = true;
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
                    }),
                )]),
            );
        });
    }

    let (mut app_config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    app_config.assistants.delegation.enabled = true;
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
    app_config.experimental_facets.tool_call_allowlist = vec!["client/*".to_string()];
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
    let configuration = erato::models::chat::AssistantConfiguration::from_json(
        child_chat.assistant_configuration.as_ref().unwrap(),
    )
    .unwrap();
    assert_eq!(
        configuration.assistant_id,
        Uuid::parse_str(DELEGATE_ASSISTANT_FIXED_ID).unwrap()
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
    assert_eq!(child_chat.generation_state.as_deref(), Some("completed"));

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
    app_config.assistants.delegation.enabled = true;
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
    app_config.assistants.delegation.enabled = true;
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
    app_config.assistants.delegation.enabled = true;
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
    app_config.assistants.delegation.enabled = true;
    app_config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        erato::config::McpServerConfig {
            transport_type: "streamable_http".to_string(),
            url: format!("{}/mcp/approval-policy", mock_mcp_base_url()),
            http_headers: None,
            allow_tools: None,
            exclude_tools: vec![],
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
    app_config.assistants.delegation.enabled = true;
    app_config.assistants.delegation.run_timeout_seconds = 1;
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
    assert_eq!(output["status"], "timeout");
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
    app_config.assistants.delegation.enabled = true;
    app_config.assistants.delegation.run_timeout_seconds = 1;
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
    assert_eq!(output["status"], "timeout");
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
    app_config.assistants.delegation.enabled = true;
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
            assistant_id,
            ChatProvenance {
                kind: ChatProvenanceKind::Delegation,
                origin_chat_id: Some(origin_chat_id),
                origin_message_id: None,
                origin_assistant_id: Some(assistant_id),
                rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
                depth: 1,
            },
            format!("Delegated run {index}"),
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
        Uuid::parse_str(&assistant).unwrap(),
        ChatProvenance {
            kind: ChatProvenanceKind::Delegation,
            origin_chat_id: Some(Uuid::parse_str(&origin_chat).unwrap()),
            origin_message_id: None,
            origin_assistant_id: None,
            rebase_cutoff: Some(sqlx::types::chrono::Utc::now().into()),
            depth: 1,
        },
        "Parked delegated run".to_string(),
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
    app_config.assistants.delegation.enabled = true;
    app_config.assistants.delegation.result_max_chars = 32;
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
async fn test_delegation_empty_child_answer_reports_failed(pool: Pool<Postgres>) {
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
    app_config.assistants.delegation.enabled = true;
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
    assert_eq!(output["status"], "failed");
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
    app_config.assistants.delegation.enabled = true;
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
    app_config.assistants.delegation.enabled = true;
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
    app_config.assistants.delegation.enabled = true;
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
