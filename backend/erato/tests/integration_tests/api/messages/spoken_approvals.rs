//! Conversational audio and approvals: the card a spoken turn stops on is
//! spoken (`POST /me/messages/{message_id}/approval-speech`), and the answer
//! after the decision is read back like the turn before it.

use super::reminder_tools::{
    answer_turn, extract_answer, next_friday, parked, reminder, setup_with_config, tool_turn,
};
use super::*;
use erato::config::McpToolApprovalPreset;
use erato::services::scheduled_items;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

const INSTRUCTION: &str = "Answer as speech.";

/// Records the request and never matches, so the mocks after it answer.
#[derive(Debug, Clone, PartialEq, PartialOrd)]
struct Spy(RequestBodyRecorder);

impl mocktail::matchers::Matcher for Spy {
    fn name(&self) -> &str {
        "spy"
    }

    fn matches(&self, request: &mocktail::prelude::Request) -> bool {
        mocktail::matchers::Matcher::matches(&self.0, request);
        false
    }
}

/// An audio.cpp-style voice that answers every request with the same PCM.
async fn mock_speech() -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
    let requests = Arc::new(AtomicUsize::new(0));
    let counter = requests.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = Router::new().route(
        "/audio/speech",
        axum::routing::post(move || {
            counter.fetch_add(1, Ordering::SeqCst);
            async {
                axum::response::Response::builder()
                    .header("content-type", "audio/pcm")
                    .body(axum::body::Body::from(vec![1, 2, 3, 4]))
                    .unwrap()
            }
        }),
    );
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}"), requests, server)
}

fn speak_with(config: &mut erato::config::AppConfig, speech_url: &str) {
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
}

/// Sends a message to `chat_id`, read back or typed.
async fn send(server: &TestServer, chat_id: Uuid, text: &str, spoken: bool) -> Vec<Value> {
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": chat_id,
            "user_message": text,
            "conversational_audio_back": spoken,
        }))
        .await;
    response.assert_status_ok();
    events(&response)
}

fn events(response: &axum_test::TestResponse) -> Vec<Value> {
    parse_sse_events(response)
        .into_iter()
        .filter_map(|event| serde_json::from_str(&event.data).ok())
        .collect()
}

fn has_audio(events: &[Value]) -> bool {
    events
        .iter()
        .any(|event| event["message_type"] == "audio_delta")
}

async fn speak_card(
    server: &TestServer,
    token: &str,
    message_id: Uuid,
    pieces: Value,
) -> axum_test::TestResponse {
    server
        .post(&format!(
            "/api/v1beta/me/messages/{message_id}/approval-speech"
        ))
        .with_bearer_token(token)
        .json(&json!({ "pieces": pieces }))
        .await
}

/// A reminder cancel the model asks for in a chat of its own, answered with
/// `answer` once the user decides.
async fn cancel_in_new_chat(
    state: &erato::state::AppState,
    llm: &MockServer,
    user_id: Uuid,
    name: &str,
    call: &str,
    answer: &'static str,
) -> Uuid {
    let item = scheduled_items::create_checked(
        state,
        user_id,
        reminder(name, next_friday(), 10),
        json!({"via": "web"}),
    )
    .await
    .unwrap()
    .unwrap();
    {
        let mut mocks = llm.mocks();
        tool_turn(
            &mut mocks,
            &[name],
            (call, "cancel_reminder", json!({"reminder_id": item.id})),
        );
        answer_turn(&mut mocks, call, answer);
    }
    seed_origin_chat(&state.db).await
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_open_approval_is_spoken_piece_by_piece_and_nothing_else_is(pool: Pool<Postgres>) {
    let (speech_url, speech_requests, speech) = mock_speech().await;
    let (state, server, user_id, _, llm) = setup_with_config(
        pool,
        MockSet::new(),
        true,
        "de-DE",
        Some(McpToolApprovalPreset::Permissive),
        |config| speak_with(config, &speech_url),
    )
    .await;
    let chat_id = cancel_in_new_chat(
        &state,
        &llm,
        user_id,
        "Angebot nachfassen",
        "call_cancel",
        "Erledigt.",
    )
    .await;
    send(&server, chat_id, "Lösch Angebot nachfassen", true).await;
    let (message_id, request) = parked(&state, chat_id).await;
    let spoken_before = speech_requests.load(Ordering::SeqCst);

    let response = speak_card(
        &server,
        TEST_JWT_TOKEN,
        message_id,
        json!([
            "Auf dem Bildschirm wartet eine Entscheidung.",
            "Bitte auf dem Bildschirm bestätigen."
        ]),
    )
    .await;
    response.assert_status_ok();
    assert_eq!(
        events(&response),
        [
            json!({"message_type": "audio_delta", "sequence": 0, "audio": "AQIDBA==", "sample_rate": 24000, "piece": 0}),
            json!({"message_type": "piece_done", "piece": 0}),
            json!({"message_type": "audio_delta", "sequence": 1, "audio": "AQIDBA==", "sample_rate": 24000, "piece": 1}),
            json!({"message_type": "piece_done", "piece": 1}),
            json!({"message_type": "done"}),
        ]
    );
    assert_eq!(speech_requests.load(Ordering::SeqCst), spoken_before + 2);

    // Nothing is stored on the message.
    let stored = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        !stored
            .raw_message
            .to_string()
            .contains("audio_file_pointer")
    );

    // Caps: pieces, piece length, total length; and something to say.
    let refused = [
        (json!(vec!["Eins."; 17]), 413),
        (json!(["a".repeat(401)]), 413),
        (json!(vec!["b".repeat(400); 6]), 413),
        (json!([]), 400),
        (json!(["Gut.", "  "]), 400),
    ];
    for (pieces, status) in refused {
        let response = speak_card(&server, TEST_JWT_TOKEN, message_id, pieces.clone()).await;
        assert_eq!(response.status_code().as_u16(), status, "{pieces}");
    }

    // Another user's request answers as if the message did not exist.
    let stranger = JwtTokenBuilder::new()
        .subject("spoken-approvals-stranger")
        .email("stranger@example.com")
        .name("stranger")
        .build();
    speak_card(&server, &stranger, message_id, json!(["Hallo."]))
        .await
        .assert_status_not_found();

    // Once decided, the stop has nothing left to speak about.
    let decided = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": message_id,
            "decisions": [{"approval_id": request["approvals"][0]["approval_id"], "decision": "approve"}],
        }))
        .await;
    decided.assert_status_ok();
    speak_card(&server, TEST_JWT_TOKEN, message_id, json!(["Hallo."]))
        .await
        .assert_status(axum::http::StatusCode::CONFLICT);
    speech.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_card_is_not_spoken_without_conversational_speech(pool: Pool<Postgres>) {
    let (speech_url, speech_requests, speech) = mock_speech().await;
    let (state, server, user_id, _, llm) = setup_with_config(
        pool,
        MockSet::new(),
        true,
        "de-DE",
        Some(McpToolApprovalPreset::Permissive),
        |config| {
            speak_with(config, &speech_url);
            // A voice for read aloud alone does not speak cards.
            config.audio_conversational.transcription.enabled = false;
            config.audio_read_aloud.enabled = true;
            config.audio_read_aloud.speech_provider = Some("voice".into());
        },
    )
    .await;
    let chat_id = cancel_in_new_chat(
        &state,
        &llm,
        user_id,
        "Angebot nachfassen",
        "call_cancel",
        "Erledigt.",
    )
    .await;
    send(&server, chat_id, "Lösch Angebot nachfassen", false).await;
    let (message_id, _) = parked(&state, chat_id).await;

    speak_card(&server, TEST_JWT_TOKEN, message_id, json!(["Hallo."]))
        .await
        .assert_status_not_found();
    assert_eq!(speech_requests.load(Ordering::SeqCst), 0);
    speech.abort();
}

/// The answer after a decision is read back when the continuation asks for
/// it, and the spoken-reply instruction of the turn it continues still
/// applies: the continuation reuses that turn's stored prompt.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_answer_after_a_decision_is_spoken_like_the_turn_it_continues(pool: Pool<Postgres>) {
    let (speech_url, _, speech) = mock_speech().await;
    let (state, server, user_id, _, llm) = setup_with_config(
        pool,
        MockSet::new(),
        true,
        "de-DE",
        Some(McpToolApprovalPreset::Permissive),
        |config| speak_with(config, &speech_url),
    )
    .await;
    let spoken_chat = cancel_in_new_chat(
        &state,
        &llm,
        user_id,
        "Gesprochen",
        "call_spoken",
        "Gesprochen erledigt.",
    )
    .await;
    let typed_chat = cancel_in_new_chat(
        &state,
        &llm,
        user_id,
        "Getippt",
        "call_typed",
        "Getippt erledigt.",
    )
    .await;
    // Sees every model request first and answers none.
    let recorder = RequestBodyRecorder::new();
    let spy = Spy(recorder.clone());
    llm.mocks().mock_with_options(0, None, move |when, then| {
        when.post().path("/v1/chat/completions").matcher(spy);
        then.status(http::StatusCode::INTERNAL_SERVER_ERROR);
    });

    let decide = |chat_id: Uuid, spoken: bool| {
        let state = state.clone();
        let server = &server;
        async move {
            let (message_id, request) = parked(&state, chat_id).await;
            let response = server
                .post("/api/v1beta/me/messages/continuestream")
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({
                    "message_id": message_id,
                    "decisions": [{"approval_id": request["approvals"][0]["approval_id"], "decision": "approve"}],
                    "conversational_audio_back": spoken,
                }))
                .await;
            response.assert_status_ok();
            events(&response)
        }
    };

    send(&server, spoken_chat, "Lösch Gesprochen", true).await;
    let continued = decide(spoken_chat, true).await;
    assert_eq!(extract_answer(&continued), "Gesprochen erledigt.");
    assert!(has_audio(&continued), "{continued:?}");

    send(&server, typed_chat, "Lösch Getippt", false).await;
    let continued = decide(typed_chat, false).await;
    assert_eq!(extract_answer(&continued), "Getippt erledigt.");
    assert!(!has_audio(&continued), "{continued:?}");

    let bodies = recorder.bodies();
    let continuation = |call: &str| -> Vec<String> {
        bodies
            .iter()
            .filter(|body| body.contains(call) && body.contains("\"role\":\"tool\""))
            .cloned()
            .collect()
    };
    let spoken = continuation("call_spoken");
    let typed = continuation("call_typed");
    assert!(!spoken.is_empty() && !typed.is_empty());
    assert!(spoken.iter().all(|body| body.contains(INSTRUCTION)));
    assert!(typed.iter().all(|body| !body.contains(INSTRUCTION)));
    speech.abort();
}
