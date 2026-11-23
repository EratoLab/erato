//! Turn instructions (`turn_instructions.<type>`): the `spoken_reply` type on
//! turns whose reply is read back, and the spoken and written parts of such a
//! reply (`audio_conversational.reply_speech`).

use axum::http::StatusCode;
use axum::{Router, body::Body, response::Response, routing::post};
use axum_test::TestServer;
use erato::db::entity::messages::Entity as Messages;
use erato_config::reply_speech::ReplySpeechWording;
use mocktail::prelude::MockSet;
use sea_orm::EntityTrait;
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::{
    test_app_state,
    test_utils::{
        BodyContainsMatcher, RequestBodyRecorder, TEST_JWT_TOKEN, TestRequestAuthExt,
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
    submit_with_events(server, body).await.0
}

/// Like [`submit`], with the stream's events.
async fn submit_with_events(server: &TestServer, body: Value) -> (String, Vec<Value>) {
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body)
        .await;
    response.assert_status_ok();
    let events: Vec<Value> = parse_sse_events(&response)
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .collect();
    let id = events
        .iter()
        .find(|data| data["message_type"] == "assistant_message_completed")
        .and_then(|data| data["message_id"].as_str().map(str::to_owned))
        .expect("assistant message id");
    (id, events)
}

fn speaking_config(config: &mut erato::config::AppConfig, speech_url: String) {
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
}

/// The stored parts of a message as `(content_type, text)`, audio left out.
async fn stored_parts(state: &erato::state::AppState, id: &str) -> Vec<(String, String)> {
    let message = Messages::find_by_id(id.parse::<Uuid>().unwrap())
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    message.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|part| part["content_type"] != "audio_file_pointer")
        .map(|part| {
            (
                part["content_type"].as_str().unwrap().to_string(),
                part["text"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect()
}

const SPLIT_REPLY: &[&str] = &[
    "<spo",
    "ken>Morgen um ",
    "zwei.</spo",
    "ken>\n\n| Tag | Zeit |\n|---|---|\n| Mo | 14:00 |",
];

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_natural_reply_is_spoken_short_and_kept_complete_in_the_chat(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let recorded = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["Wann ist der Termin?"],
                &["Und danach?"],
            ))
            .matcher(recorded);
        then.status(StatusCode::OK)
            .headers([("Content-Type", "text/event-stream")])
            .bytes_stream_with_delays(build_openai_text_streaming_response(SPLIT_REPLY));
    });
    let recorded = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["Und danach?"], &[]))
            .matcher(recorded);
        then.status(StatusCode::OK)
            .headers([("Content-Type", "text/event-stream")])
            .bytes_stream_with_delays(build_openai_text_streaming_response(&["Nichts mehr."]));
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    let (speech_url, speech) = mock_speech().await;
    speaking_config(&mut config, speech_url);
    config.audio_conversational.reply_speech.wording = ReplySpeechWording::Natural;
    let state = test_app_state(config, pool).await;
    let server = create_test_server(state.clone());

    let (spoken_id, events) = submit_with_events(
        &server,
        json!({ "user_message": "Wann ist der Termin?", "conversational_audio_back": true }),
    )
    .await;
    let of_type = |kind: &str| -> String {
        events
            .iter()
            .filter(|event| event["message_type"] == kind)
            .map(|event| event["new_text"].as_str().unwrap_or_default())
            .collect()
    };
    assert_eq!(of_type("spoken_delta"), "Morgen um zwei.");
    assert_eq!(
        of_type("text_delta"),
        "| Tag | Zeit |\n|---|---|\n| Mo | 14:00 |"
    );
    let spoken_end = events
        .iter()
        .position(|event| event["message_type"] == "spoken_end")
        .expect("spoken_end");
    let first_audio = events
        .iter()
        .position(|event| event["message_type"] == "audio_delta")
        .expect("audio");
    assert!(first_audio < spoken_end, "the end follows the part's audio");
    assert_eq!(
        stored_parts(&state, &spoken_id).await,
        [
            ("spoken".to_string(), "Morgen um zwei.".to_string()),
            (
                "text".to_string(),
                "| Tag | Zeit |\n|---|---|\n| Mo | 14:00 |".to_string()
            ),
        ]
    );

    // A typed turn after it gets no protocol and sees only the written
    // answer, so it has no format to copy.
    let typed_id = submit(
        &server,
        json!({ "user_message": "Und danach?", "previous_message_id": spoken_id }),
    )
    .await;
    assert_eq!(
        stored_parts(&state, &typed_id).await,
        [("text".to_string(), "Nichts mehr.".to_string())]
    );
    let bodies = recorder.bodies();
    let protocol = "Begin your reply with <spoken>";
    assert!(
        bodies
            .iter()
            .any(|body| body.contains("Wann ist der Termin?")
                && !body.contains("Und danach?")
                && body.contains(protocol))
    );
    let typed: Vec<&String> = bodies
        .iter()
        .filter(|body| body.contains("Und danach?"))
        .collect();
    assert!(!typed.is_empty());
    for body in typed {
        assert!(!body.contains(protocol) && !body.contains("<spoken>"));
        assert!(body.contains("| Mo | 14:00 |"));
    }
    speech.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_precise_reply_keeps_the_spoken_reply_style_and_is_read_as_written(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let recorded = recorder.clone();
    mocks.mock(move |when, then| {
        when.post().path("/v1/chat/completions").matcher(recorded);
        then.status(StatusCode::OK)
            .headers([("Content-Type", "text/event-stream")])
            .bytes_stream_with_delays(build_openai_text_streaming_response(&[
                "Der Termin ist ",
                "morgen um 14:00.",
            ]));
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    let (speech_url, speech) = mock_speech().await;
    speaking_config(&mut config, speech_url);
    config.turn_instructions.spoken_reply.prompt = Some(INSTRUCTION.into());
    config.audio_conversational.reply_speech.wording = ReplySpeechWording::Precise;
    let state = test_app_state(config, pool).await;
    let server = create_test_server(state.clone());

    let (id, events) = submit_with_events(
        &server,
        json!({ "user_message": "Wann?", "conversational_audio_back": true }),
    )
    .await;
    assert!(
        events
            .iter()
            .any(|event| event["message_type"] == "audio_delta")
    );
    assert!(
        !events
            .iter()
            .any(|event| event["message_type"] == "spoken_delta")
    );
    assert_eq!(
        stored_parts(&state, &id).await,
        [(
            "text".to_string(),
            "Der Termin ist morgen um 14:00.".to_string()
        )]
    );
    let bodies = recorder.bodies();
    assert!(bodies.iter().any(|body| body.contains(INSTRUCTION)));
    assert!(bodies.iter().all(|body| !body.contains("<spoken>")));
    speech.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_users_choice_and_an_audience_lock_apply_at_turn_time(pool: Pool<Postgres>) {
    use erato::distribution::experience_policy::{
        AudienceReplySpeech, AudienceSubject, ExperienceAudience, ExperiencePolicyDocument,
    };
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let recorded = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &["Erste Frage"],
                &["Zweite Frage"],
            ))
            .matcher(recorded);
        then.status(StatusCode::OK)
            .headers([("Content-Type", "text/event-stream")])
            .bytes_stream_with_delays(build_openai_text_streaming_response(&["Gelesen."]));
    });
    let recorded = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["Zweite Frage"], &[]))
            .matcher(recorded);
        then.status(StatusCode::OK)
            .headers([("Content-Type", "text/event-stream")])
            .bytes_stream_with_delays(build_openai_text_streaming_response(SPLIT_REPLY));
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    let (speech_url, speech) = mock_speech().await;
    speaking_config(&mut config, speech_url);
    config.audio_conversational.reply_speech.wording = ReplySpeechWording::Natural;
    let state = test_app_state(config, pool).await;
    let server = create_test_server(state.clone());
    server
        .put("/api/v1beta/me/profile/preferences")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "preference_reply_speech_wording": "precise" }))
        .await
        .assert_status_ok();

    let own = submit(
        &server,
        json!({ "user_message": "Erste Frage", "conversational_audio_back": true }),
    )
    .await;
    assert_eq!(
        stored_parts(&state, &own).await,
        [("text".to_string(), "Gelesen.".to_string())]
    );

    state.reloadable.write().await.experience_policy = Some(ExperiencePolicyDocument {
        audiences: [(
            "Vertrieb".to_string(),
            ExperienceAudience {
                id: Some("aud-sales".into()),
                subjects: vec![AudienceSubject::Organization],
                pinned_assistant_hub_assistant_id: Uuid::new_v4(),
                expires_at: None,
                provenance: None,
                approval_speech: None,
                wait_lines: None,
                reply_speech: Some(AudienceReplySpeech {
                    wording: Some(ReplySpeechWording::Natural),
                    user_choice: Some(false),
                    show_in_chat: None,
                }),
                spoken_language: None,
            },
        )]
        .into(),
        priority_order: vec!["Vertrieb".into()],
        setting_orders: [("reply_speech".to_string(), vec!["aud-sales".to_string()])].into(),
    });
    let locked = submit(
        &server,
        json!({
            "user_message": "Zweite Frage",
            "previous_message_id": own,
            "conversational_audio_back": true,
        }),
    )
    .await;
    assert_eq!(stored_parts(&state, &locked).await[0].0, "spoken");

    let protocol = "Begin your reply with <spoken>";
    for body in recorder.bodies() {
        assert_eq!(
            body.contains(protocol),
            body.contains("Zweite Frage"),
            "{body}"
        );
    }
    speech.abort();
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

/// ERMAIN-1326: the language a turn was spoken in is stored on the user
/// message, named to the model on that turn only, and is the chat's language
/// from then on. A value that is no language code is dropped.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_spoken_turn_keeps_its_language_and_names_it_to_the_model(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let recorded = recorder.clone();
    mocks.mock(move |when, then| {
        when.post().path("/v1/chat/completions").matcher(recorded);
        then.status(StatusCode::OK)
            .headers([("Content-Type", "text/event-stream")])
            .bytes_stream_with_delays(build_openai_text_streaming_response(&["Gern."]));
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    let (speech_url, speech) = mock_speech().await;
    speaking_config(&mut config, speech_url);
    let state = test_app_state(config, pool).await;
    let server = create_test_server(state.clone());

    let spoken = submit(
        &server,
        json!({
            "user_message": "Zeig mir die Angebote",
            "conversational_audio_back": true,
            "spoken_language": "de-DE",
        }),
    )
    .await;
    let typed = submit(
        &server,
        json!({
            "user_message": "Typed afterwards",
            "previous_message_id": spoken,
            "spoken_language": "<script>",
        }),
    )
    .await;

    let user_message_of = |answer: String| {
        let state = state.clone();
        async move {
            let answer = Messages::find_by_id(answer.parse::<Uuid>().unwrap())
                .one(&state.db)
                .await
                .unwrap()
                .unwrap();
            Messages::find_by_id(answer.previous_message_id.unwrap())
                .one(&state.db)
                .await
                .unwrap()
                .unwrap()
        }
    };
    let spoken_user = user_message_of(spoken.clone()).await;
    assert_eq!(
        erato::services::spoken_language::of_input_parameters(
            spoken_user.input_parameters.as_ref()
        )
        .as_deref(),
        Some("de")
    );
    let typed_user = user_message_of(typed).await;
    assert_eq!(
        erato::services::spoken_language::of_input_parameters(typed_user.input_parameters.as_ref()),
        None
    );
    assert_eq!(
        erato::services::spoken_language::of_chat(
            &state.db,
            spoken_user.chat_id,
            &typed_user_owner(&state, spoken_user.chat_id).await
        )
        .await
        .unwrap()
        .as_deref(),
        Some("de")
    );
    assert_eq!(
        erato::services::spoken_language::of_turn(&state.db, spoken.parse().unwrap())
            .await
            .unwrap()
            .as_deref(),
        Some("de")
    );

    let sentence = "The user spoke German in this turn.";
    let bodies = recorder.bodies();
    let spoken_bodies: Vec<_> = bodies
        .iter()
        .filter(|body| body.contains("Zeig mir die Angebote") && !body.contains("Typed afterwards"))
        .collect();
    // The chat title is asked for with the same words, without instructions.
    let named: Vec<_> = spoken_bodies
        .iter()
        .filter(|body| body.contains(sentence))
        .collect();
    assert!(
        !named.is_empty(),
        "no request names the language: {spoken_bodies:?}"
    );
    for body in named {
        assert!(body.find(sentence).unwrap() < body.find("Zeig mir die Angebote").unwrap());
    }
    for body in bodies
        .iter()
        .filter(|body| body.contains("Typed afterwards"))
    {
        assert!(!body.contains(sentence), "a later turn replays it: {body}");
    }
    speech.abort();
}

async fn typed_user_owner(state: &erato::state::AppState, chat_id: Uuid) -> String {
    erato::db::entity::chats::Entity::find_by_id(chat_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap()
        .owner_user_id
}

/// Showing what the voice said is the user's own choice, saved through the
/// preferences and read back resolved; `null` follows the organisation again.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_user_shows_and_hides_what_the_voice_said(pool: Pool<Postgres>) {
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(MockSet::new()).await;
    config.audio_conversational.reply_speech.user_choice = false;
    let server = create_test_server(test_app_state(config, pool).await);
    let style = || async {
        server
            .get("/api/v1beta/me/reply-speech-style")
            .with_bearer_token(TEST_JWT_TOKEN)
            .await
            .json::<Value>()
    };
    let save = |value: Value| {
        let server = &server;
        async move {
            server
                .put("/api/v1beta/me/profile/preferences")
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({ "preference_reply_speech_show_in_chat": value }))
                .await
                .json::<Value>()
        }
    };

    let first = style().await;
    assert_eq!(first["show_in_chat"], false);
    assert_eq!(first["show_in_chat_source"], "deployment");

    // The wording lock does not reach it: it changes only what this user sees.
    let profile = save(json!(true)).await;
    assert_eq!(profile["preference_reply_speech_show_in_chat"], true);
    let shown = style().await;
    assert_eq!(shown["show_in_chat"], true);
    assert_eq!(shown["show_in_chat_source"], "user");
    assert_eq!(shown["user_choice"], false);

    let profile = save(Value::Null).await;
    assert!(
        profile
            .get("preference_reply_speech_show_in_chat")
            .is_none()
    );
    let back = style().await;
    assert_eq!(back["show_in_chat"], false);
    assert_eq!(back["show_in_chat_source"], "deployment");
}
