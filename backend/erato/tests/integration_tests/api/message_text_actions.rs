//! Explain on marked message text: a stateless side call.

use axum::http::StatusCode;
use axum_test::TestServer;
use erato::db::entity::{chats, messages};
use erato::models::user::get_or_create_user;
use erato::state::AppState;
use mocktail::prelude::{MockServer, MockSet};
use sea_orm::{EntityTrait, PaginatorTrait};
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};

use crate::{
    test_app_state,
    test_utils::{
        JwtTokenBuilder, RequestBodyRecorder, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT,
        TestRequestAuthExt, build_openai_text_streaming_response, parse_sse_events,
        setup_mock_llm_server_with_mocks,
    },
};

const ANSWER_CHUNKS: [&str; 3] = [
    "A committed-use discount",
    " is a deal",
    " with the provider.",
];

async fn setup(
    pool: Pool<Postgres>,
    explain_enabled: bool,
) -> (
    TestServer,
    AppState,
    MockServer,
    RequestBodyRecorder,
    String,
) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let recorded = recorder.clone();
    mocks.mock(move |when, then| {
        when.post().path("/v1/chat/completions").matcher(recorded);
        then.status(StatusCode::OK)
            .headers([("Content-Type", "text/event-stream")])
            .bytes_stream_with_delays(build_openai_text_streaming_response(&ANSWER_CHUNKS));
    });
    let (mut config, mock_server) = setup_mock_llm_server_with_mocks(mocks).await;
    config.message_text_actions.explain.enabled = explain_enabled;
    config.message_text_actions.explain.chat_provider_id = Some("mock-llm".into());
    let state = test_app_state(config, pool).await;
    get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let app = erato::server::router::router(state.clone())
        .split_for_parts()
        .0
        .with_state(state.clone());
    let server = TestServer::new(app.into_make_service()).unwrap();

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"user_message": "What are committed-use discounts?"}))
        .await;
    response.assert_status_ok();
    let message_id = parse_sse_events(&response)
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .find(|data| data["message_type"] == "assistant_message_completed")
        .and_then(|data| data["message_id"].as_str().map(str::to_owned))
        .expect("assistant message id");

    (server, state, mock_server, recorder, message_id)
}

async fn row_counts(state: &AppState) -> (u64, u64) {
    (
        chats::Entity::find().count(&state.db).await.unwrap(),
        messages::Entity::find().count(&state.db).await.unwrap(),
    )
}

fn explain_path(message_id: &str) -> String {
    format!("/api/v1beta/me/messages/{message_id}/explain")
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn explain_is_absent_while_disabled(pool: Pool<Postgres>) {
    let (server, _state, _mock, recorder, message_id) = setup(pool, false).await;
    let calls_before = recorder.bodies().len();

    let response = server
        .post(&explain_path(&message_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"selected_text": "committed-use discount"}))
        .await;

    response.assert_status(StatusCode::NOT_FOUND);
    assert_eq!(recorder.bodies().len(), calls_before);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn explain_streams_an_answer_and_writes_nothing(pool: Pool<Postgres>) {
    let (server, state, _mock, recorder, message_id) = setup(pool, true).await;
    let counts_before = row_counts(&state).await;

    let response = server
        .post(&explain_path(&message_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"selected_text": "committed-use discount", "language": "de"}))
        .await;

    response.assert_status_ok();
    let events: Vec<Value> = parse_sse_events(&response)
        .iter()
        .map(|event| serde_json::from_str(&event.data).unwrap())
        .collect();
    let text: String = events
        .iter()
        .filter(|event| event["message_type"] == "text_delta")
        .map(|event| event["text"].as_str().unwrap())
        .collect();
    assert_eq!(text, ANSWER_CHUNKS.concat());
    assert_eq!(events.last().unwrap()["message_type"], "completed");

    let request: Value = serde_json::from_str(recorder.bodies().last().unwrap()).unwrap();
    assert!(request.get("tools").is_none());
    let sent = request["messages"].as_array().unwrap();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0]["role"], "system");
    assert!(
        sent[0]["content"]
            .as_str()
            .unwrap()
            .contains("Answer in German.")
    );
    let opening = sent[1]["content"].as_str().unwrap();
    assert!(opening.contains("<passage>\ncommitted-use discount\n</passage>"));
    // The message the passage comes from is the mocked answer of the chat.
    assert!(opening.contains(&ANSWER_CHUNKS.concat()));

    let follow_up = server
        .post(&explain_path(&message_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "selected_text": "committed-use discount",
            "turns": [
                {"role": "assistant", "text": "It is a deal with the provider."},
                {"role": "user", "text": "What if we need less?"}
            ]
        }))
        .await;
    follow_up.assert_status_ok();
    let request: Value = serde_json::from_str(recorder.bodies().last().unwrap()).unwrap();
    let sent = request["messages"].as_array().unwrap();
    assert_eq!(sent.len(), 4);
    assert_eq!(sent[2]["role"], "assistant");
    assert_eq!(sent[3]["role"], "user");
    assert_eq!(sent[3]["content"], "What if we need less?");

    assert_eq!(row_counts(&state).await, counts_before);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn explain_needs_read_access_to_the_chat(pool: Pool<Postgres>) {
    let (server, state, _mock, recorder, message_id) = setup(pool, true).await;
    get_or_create_user(&state.db, TEST_USER_ISSUER, "explain-other-user", None)
        .await
        .unwrap();
    let other_user_token = JwtTokenBuilder::new()
        .issuer(TEST_USER_ISSUER)
        .subject("explain-other-user")
        .build();
    let calls_before = recorder.bodies().len();

    server
        .post(&explain_path(&message_id))
        .with_bearer_token(&other_user_token)
        .json(&json!({"selected_text": "committed-use discount"}))
        .await
        .assert_status(StatusCode::FORBIDDEN);
    server
        .post(&explain_path("7f1c5a50-0a5e-4d0c-9a53-0d6b3d1f6f11"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"selected_text": "committed-use discount"}))
        .await
        .assert_status(StatusCode::NOT_FOUND);
    server
        .post(&explain_path(&message_id))
        .json(&json!({"selected_text": "committed-use discount"}))
        .await
        .assert_status(StatusCode::UNAUTHORIZED);

    assert_eq!(recorder.bodies().len(), calls_before);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn explain_enforces_its_limits(pool: Pool<Postgres>) {
    let (server, _state, _mock, recorder, message_id) = setup(pool, true).await;
    let calls_before = recorder.bodies().len();
    let turn = |role: &str| json!({"role": role, "text": "x"});
    let too_many_turns: Vec<Value> = (0..22)
        .map(|index| turn(if index % 2 == 0 { "assistant" } else { "user" }))
        .collect();

    for body in [
        json!({"selected_text": "x".repeat(4_001)}),
        json!({"selected_text": "   "}),
        json!({"selected_text": "term", "turns": too_many_turns}),
        json!({"selected_text": "term", "turns": [turn("assistant")]}),
        json!({"selected_text": "term", "turns": [{"role": "user", "text": "x".repeat(8_001)}]}),
    ] {
        server
            .post(&explain_path(&message_id))
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&body)
            .await
            .assert_status(StatusCode::BAD_REQUEST);
    }

    assert_eq!(recorder.bodies().len(), calls_before);
}
