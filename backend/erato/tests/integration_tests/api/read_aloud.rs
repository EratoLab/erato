//! Read aloud endpoint tests (`POST /me/messages/{message_id}/speech`).

use axum::{Router, body::Body, response::Response, routing::post};
use axum_test::TestServer;
use erato::config::{AppConfig, AudioReadAloudConfig};
use erato::state::AppState;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::oneshot;

use crate::test_app_state;
use crate::test_utils::{
    JwtTokenBuilder, MockLlmConfig, TEST_JWT_TOKEN, TEST_USER_ISSUER, TestRequestAuthExt,
    create_test_server, parse_sse_events, setup_mock_llm_server,
};

struct MockSpeech {
    url: String,
    requests: Arc<AtomicUsize>,
    /// Resolves when the first stalled request is dropped by its caller.
    stalled_request_dropped: oneshot::Receiver<()>,
    server: tokio::task::JoinHandle<()>,
}

struct NotifyOnDrop(Option<oneshot::Sender<()>>);
impl Drop for NotifyOnDrop {
    fn drop(&mut self) {
        if let Some(sender) = self.0.take() {
            let _ = sender.send(());
        }
    }
}

/// An audio.cpp-style speech server: the first `answered` requests return PCM, later ones never
/// answer.
async fn mock_speech(answered: usize) -> MockSpeech {
    let requests = Arc::new(AtomicUsize::new(0));
    let (dropped_tx, stalled_request_dropped) = oneshot::channel();
    let dropped_tx = Arc::new(std::sync::Mutex::new(Some(dropped_tx)));
    let counter = requests.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/audio/speech",
                post(move || {
                    let counter = counter.clone();
                    let dropped_tx = dropped_tx.clone();
                    async move {
                        if counter.fetch_add(1, Ordering::SeqCst) >= answered {
                            let _guard = NotifyOnDrop(dropped_tx.lock().unwrap().take());
                            std::future::pending::<()>().await;
                        }
                        Response::builder()
                            .header("content-type", "audio/pcm")
                            .body(Body::from(vec![1, 2, 3, 4]))
                            .unwrap()
                    }
                }),
            ),
        )
        .await
        .unwrap();
    });
    MockSpeech {
        url: format!("http://{address}"),
        requests,
        stalled_request_dropped,
        server,
    }
}

fn enable_read_aloud(app_config: &mut AppConfig, speech_url: &str) {
    app_config.speech_providers.provider.insert(
        "voice".into(),
        serde_json::from_value(json!({
            "provider_kind": "audio_cpp", "model_name": "local", "voice": "voice",
            "base_url": speech_url
        }))
        .unwrap(),
    );
    app_config.audio_read_aloud = AudioReadAloudConfig {
        enabled: true,
        speech_provider: Some("voice".into()),
    };
}

/// Sends one user message and returns the id of the finished assistant reply.
async fn assistant_message(server: &TestServer, token: &str) -> String {
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(token)
        .json(&json!({ "user_message": "Please answer" }))
        .await;
    response.assert_status_ok();
    parse_sse_events(&response)
        .iter()
        .find_map(|event| {
            let json: Value = serde_json::from_str(&event.data).ok()?;
            (json["message_type"] == "assistant_message_completed")
                .then(|| json["message_id"].as_str().map(str::to_string))
                .flatten()
        })
        .expect("assistant_message_completed event")
}

/// Serves the app on a real socket, for tests that read a response while it is still streaming.
async fn serve(app_state: AppState) -> (String, tokio::task::JoinHandle<()>) {
    let app: Router = erato::server::router::router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        axum::serve(listener, app.into_make_service())
            .await
            .unwrap();
    });
    (format!("http://{address}"), handle)
}

/// Reads the response until `needle` shows up in the body, without waiting for its end.
async fn read_until(response: &mut reqwest::Response, needle: &str) -> String {
    let mut body = String::new();
    tokio::time::timeout(Duration::from_secs(10), async {
        while !body.contains(needle) {
            let chunk = response
                .chunk()
                .await
                .expect("stream chunk")
                .unwrap_or_else(|| panic!("stream ended before `{needle}`: {body}"));
            body.push_str(&String::from_utf8_lossy(&chunk));
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for `{needle}`: {body}"));
    body
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn read_aloud_is_absent_while_the_feature_is_off(pool: Pool<Postgres>) {
    let (mut app_config, _llm) = setup_mock_llm_server(None).await;
    let speech = mock_speech(usize::MAX).await;
    // A configured voice alone does not switch the feature on, and conversational audio-back
    // using the same voice does not either.
    enable_read_aloud(&mut app_config, &speech.url);
    app_config.audio_read_aloud.enabled = false;
    app_config.audio_conversational.speech_provider = Some("voice".into());
    let app_state = test_app_state(app_config, pool).await;
    let server = create_test_server(app_state);
    let message_id = assistant_message(&server, TEST_JWT_TOKEN).await;

    let response = server
        .post(&format!("/api/v1beta/me/messages/{message_id}/speech"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    response.assert_status_not_found();
    assert_eq!(speech.requests.load(Ordering::SeqCst), 0);
    speech.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn read_aloud_speaks_a_finished_assistant_message_with_conversational_mode_off(
    pool: Pool<Postgres>,
) {
    let (mut app_config, _llm) = setup_mock_llm_server(None).await;
    let speech = mock_speech(usize::MAX).await;
    enable_read_aloud(&mut app_config, &speech.url);
    assert!(!app_config.audio_conversational.transcription.enabled);
    let app_state = test_app_state(app_config, pool).await;
    let server = create_test_server(app_state.clone());
    let message_id = assistant_message(&server, TEST_JWT_TOKEN).await;

    let response = server
        .post(&format!("/api/v1beta/me/messages/{message_id}/speech"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;

    response.assert_status_ok();
    let events: Vec<Value> = parse_sse_events(&response)
        .iter()
        .map(|event| serde_json::from_str(&event.data).unwrap())
        .collect();
    assert_eq!(
        events,
        [
            json!({
                "message_type": "audio_delta", "sequence": 0, "audio": "AQIDBA==",
                "sample_rate": 24000
            }),
            json!({ "message_type": "done" }),
        ]
    );

    // Nothing is stored: the message carries no audio afterwards.
    let stored = erato::db::entity::messages::Entity::find_by_id(
        uuid::Uuid::parse_str(&message_id).unwrap(),
    )
    .one(&app_state.db)
    .await
    .unwrap()
    .unwrap();
    assert!(
        !stored
            .raw_message
            .to_string()
            .contains("audio_file_pointer")
    );
    speech.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn read_aloud_gives_no_audio_without_read_access_or_for_user_messages(pool: Pool<Postgres>) {
    let (mut app_config, _llm) = setup_mock_llm_server(None).await;
    let speech = mock_speech(usize::MAX).await;
    enable_read_aloud(&mut app_config, &speech.url);
    let app_state = test_app_state(app_config, pool).await;
    let stranger_subject = "read-aloud-stranger";
    erato::models::user::get_or_create_user(
        &app_state.db,
        TEST_USER_ISSUER,
        stranger_subject,
        None,
    )
    .await
    .unwrap();
    let stranger_token = JwtTokenBuilder::new()
        .subject(stranger_subject)
        .email("stranger@example.com")
        .name("stranger")
        .build();
    let server = create_test_server(app_state.clone());
    let message_id = assistant_message(&server, TEST_JWT_TOKEN).await;

    server
        .post(&format!("/api/v1beta/me/messages/{message_id}/speech"))
        .with_bearer_token(&stranger_token)
        .await
        .assert_status_not_found();
    server
        .post(&format!(
            "/api/v1beta/me/messages/{}/speech",
            uuid::Uuid::new_v4()
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_not_found();

    let chat_id = erato::db::entity::messages::Entity::find_by_id(
        uuid::Uuid::parse_str(&message_id).unwrap(),
    )
    .one(&app_state.db)
    .await
    .unwrap()
    .unwrap()
    .chat_id;
    let user_message = erato::db::entity::messages::Entity::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
        .all(&app_state.db)
        .await
        .unwrap()
        .into_iter()
        .find(|message| message.raw_message["role"] == "user")
        .expect("user message");
    server
        .post(&format!(
            "/api/v1beta/me/messages/{}/speech",
            user_message.id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_bad_request();

    assert_eq!(speech.requests.load(Ordering::SeqCst), 0);
    speech.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn read_aloud_of_a_long_answer_starts_before_synthesis_finishes_and_stops_on_disconnect(
    pool: Pool<Postgres>,
) {
    // About 5,400 characters: three passages of at most 2,000.
    let chunks = vec!["A long answer keeps going. ".to_string(); 200];
    let (mut app_config, _llm) = setup_mock_llm_server(Some(MockLlmConfig {
        chunks,
        delay_ms: 0,
        ..Default::default()
    }))
    .await;
    // Only the first passage is ever synthesised; the second request hangs.
    let speech = mock_speech(1).await;
    enable_read_aloud(&mut app_config, &speech.url);
    let app_state = test_app_state(app_config, pool).await;
    let server = create_test_server(app_state.clone());
    let message_id = assistant_message(&server, TEST_JWT_TOKEN).await;
    let (base_url, app) = serve(app_state).await;

    let mut response = reqwest::Client::new()
        .post(format!(
            "{base_url}/api/v1beta/me/messages/{message_id}/speech"
        ))
        .bearer_auth(TEST_JWT_TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body = read_until(&mut response, "\n\n").await;
    assert!(body.contains("event: audio_delta"), "{body}");
    assert!(body.contains("\"sequence\":0"), "{body}");

    // The second passage is requested and still pending when the browser goes away.
    tokio::time::timeout(Duration::from_secs(5), async {
        while speech.requests.load(Ordering::SeqCst) < 2 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("second passage requested");
    drop(response);

    tokio::time::timeout(Duration::from_secs(10), speech.stalled_request_dropped)
        .await
        .expect("disconnect cancels the pending provider request")
        .unwrap();
    assert_eq!(speech.requests.load(Ordering::SeqCst), 2);
    app.abort();
    speech.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn read_aloud_rejects_a_message_that_is_still_generating(pool: Pool<Postgres>) {
    let (mut app_config, _llm) = setup_mock_llm_server(Some(MockLlmConfig {
        chunks: vec!["Slow. ".to_string(); 20],
        delay_ms: 150,
        ..Default::default()
    }))
    .await;
    let speech = mock_speech(usize::MAX).await;
    enable_read_aloud(&mut app_config, &speech.url);
    let app_state = test_app_state(app_config, pool).await;
    let (base_url, app) = serve(app_state).await;
    let client = reqwest::Client::new();

    let mut generation = client
        .post(format!("{base_url}/api/v1beta/me/messages/submitstream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": "Please answer slowly" }))
        .send()
        .await
        .unwrap();
    let body = read_until(&mut generation, "\"message_type\":\"text_delta\"").await;
    let message_id = body
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .filter_map(|data| serde_json::from_str::<Value>(data).ok())
        .find(|json| json["message_type"] == "assistant_message_started")
        .and_then(|json| json["message_id"].as_str().map(str::to_string))
        .expect("assistant_message_started event");

    let while_generating = client
        .post(format!(
            "{base_url}/api/v1beta/me/messages/{message_id}/speech"
        ))
        .bearer_auth(TEST_JWT_TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(while_generating.status(), 409);

    read_until(&mut generation, "assistant_message_completed").await;
    while generation.chunk().await.unwrap().is_some() {}
    let finished = client
        .post(format!(
            "{base_url}/api/v1beta/me/messages/{message_id}/speech"
        ))
        .bearer_auth(TEST_JWT_TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(finished.status(), 200);
    assert!(finished.text().await.unwrap().contains("event: done"));
    app.abort();
    speech.server.abort();
}
