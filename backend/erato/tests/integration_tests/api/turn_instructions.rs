//! Turn instructions (`turn_instructions.<type>`): the `spoken_reply` type on
//! turns whose reply is read back.

use axum::http::StatusCode;
use axum::{Router, body::Body, response::Response, routing::post};
use axum_test::TestServer;
use mocktail::prelude::MockSet;
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};

use crate::{
    test_app_state,
    test_utils::{
        RequestBodyRecorder, TEST_JWT_TOKEN, TestRequestAuthExt,
        build_openai_text_streaming_response, create_test_server, parse_sse_events,
        setup_mock_llm_server_with_mocks,
    },
};

const INSTRUCTION: &str = "Answer as speech.";

async fn mock_speech() -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = Router::new().route(
        "/audio/speech",
        post(|| async {
            Response::builder()
                .header("content-type", "audio/pcm")
                .body(Body::from(vec![1, 2, 3, 4]))
                .unwrap()
        }),
    );
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}"), server)
}

/// Sends one user message and returns the id of the finished assistant reply.
async fn submit(server: &TestServer, body: Value) -> String {
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body)
        .await;
    response.assert_status_ok();
    parse_sse_events(&response)
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .find(|data| data["message_type"] == "assistant_message_completed")
        .and_then(|data| data["message_id"].as_str().map(str::to_owned))
        .expect("assistant message id")
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn spoken_reply_reaches_the_model_only_on_a_turn_that_is_read_back(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let recorded = recorder.clone();
    mocks.mock(move |when, then| {
        when.post().path("/v1/chat/completions").matcher(recorded);
        then.status(StatusCode::OK)
            .headers([("Content-Type", "text/event-stream")])
            .bytes_stream_with_delays(build_openai_text_streaming_response(&["Sure."]));
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    let (speech_url, speech) = mock_speech().await;
    config.speech_providers.provider.insert(
        "voice".into(),
        serde_json::from_value(json!({
            "provider_kind": "audio_cpp", "model_name": "local", "voice": "voice",
            "base_url": speech_url
        }))
        .unwrap(),
    );
    config.audio_conversational.transcription.enabled = true;
    config.audio_conversational.speech_provider = Some("voice".into());
    config.turn_instructions.spoken_reply.prompt = Some(INSTRUCTION.into());
    let server = create_test_server(test_app_state(config, pool).await);

    let first = submit(&server, json!({ "user_message": "Typed first" })).await;
    let second = submit(
        &server,
        json!({
            "user_message": "Spoken second",
            "previous_message_id": first,
            "conversational_audio_back": true,
        }),
    )
    .await;
    // Audio-back requested, but this turn is typed again.
    submit(
        &server,
        json!({ "user_message": "Typed third", "previous_message_id": second }),
    )
    .await;

    let bodies = recorder.bodies();
    let turn = |text: &str, later: &[&str]| -> Vec<String> {
        bodies
            .iter()
            .filter(|body| body.contains(text) && !later.iter().any(|text| body.contains(text)))
            .cloned()
            .collect()
    };
    let typed_first = turn("Typed first", &["Spoken second", "Typed third"]);
    let spoken = turn("Spoken second", &["Typed third"]);
    let typed_third = turn("Typed third", &[]);
    assert!(!typed_first.is_empty() && !spoken.is_empty() && !typed_third.is_empty());
    for body in typed_first.iter().chain(&typed_third) {
        assert!(!body.contains(INSTRUCTION), "typed turn got it: {body}");
    }
    for body in &spoken {
        let instruction = body.find(INSTRUCTION).expect("spoken turn lacks it");
        assert!(body.find("Typed first").unwrap() < instruction);
        assert!(instruction < body.find("Spoken second").unwrap());
    }
    speech.abort();
}
