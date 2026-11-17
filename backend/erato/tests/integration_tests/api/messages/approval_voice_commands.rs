//! Voice commands on a waiting approval
//! (`POST /me/messages/{message_id}/approval-voice-command`): only for the
//! user's own chat while the approval waits, and "unclear" whenever no model
//! answers.

use super::reminder_tools::{
    answer_turn, next_friday, parked, reminder, setup_with_config, tool_turn,
};
use super::*;
use erato::config::McpToolApprovalPreset;
use erato::services::scheduled_items;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

/// A cancel of a reminder, parked for approval in a chat of its own.
async fn parked_cancel(
    state: &erato::state::AppState,
    server: &TestServer,
    llm: &MockServer,
    user_id: Uuid,
) -> (Uuid, Value) {
    let item = scheduled_items::create_checked(
        state,
        user_id,
        reminder("Angebot nachfassen", next_friday(), 10),
        json!({"via": "web"}),
    )
    .await
    .unwrap()
    .unwrap();
    {
        let mut mocks = llm.mocks();
        tool_turn(
            &mut mocks,
            &["Angebot nachfassen"],
            (
                "call_cancel",
                "cancel_reminder",
                json!({"reminder_id": item.id}),
            ),
        );
        answer_turn(&mut mocks, "call_cancel", "Erledigt.");
    }
    let chat_id = seed_origin_chat(&state.db).await;
    server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "existing_chat_id": chat_id,
            "user_message": "Lösch Angebot nachfassen",
        }))
        .await
        .assert_status_ok();
    parked(state, chat_id).await
}

fn pieces(request: &str) -> Value {
    json!([
        {"id": "p1", "role": "what", "state": "heard"},
        {"id": "p2", "role": "detail", "field": "Datum", "state": "heard"},
        {"id": "p3", "role": "consequence", "state": "heard"},
        {"id": "p4", "role": "request", "state": request},
    ])
}

async fn say(
    server: &TestServer,
    token: &str,
    message_id: Uuid,
    transcript: &str,
    pieces: Value,
) -> axum_test::TestResponse {
    server
        .post(&format!(
            "/api/v1beta/me/messages/{message_id}/approval-voice-command"
        ))
        .with_bearer_token(token)
        .json(&json!({
            "transcript": transcript,
            "language": "de",
            "pieces": pieces,
            "current_piece_id": "p3",
        }))
        .await
}

async fn meaning(server: &TestServer, message_id: Uuid, transcript: &str, pieces: Value) -> Value {
    let response = say(server, TEST_JWT_TOKEN, message_id, transcript, pieces).await;
    response.assert_status_ok();
    response.json::<Value>()
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn voice_commands_answer_only_the_owner_while_the_approval_waits(pool: Pool<Postgres>) {
    let (state, server, user_id, _, llm) = setup_with_config(
        pool,
        MockSet::new(),
        true,
        "de-DE",
        Some(McpToolApprovalPreset::Permissive),
        |config| config.approval_voice_commands.enabled = true,
    )
    .await;
    let (message_id, request) = parked_cancel(&state, &server, &llm, user_id).await;

    // The rules answer without a model; what they do not match is unclear.
    assert_eq!(
        meaning(&server, message_id, "weiter", pieces("heard")).await,
        json!({"meaning": "skip", "piece_id": null, "source": "rules"})
    );
    assert_eq!(
        meaning(&server, message_id, "wie war das Datum?", pieces("heard")).await,
        json!({"meaning": "repeat", "piece_id": "p2", "source": "rules"})
    );
    assert_eq!(
        meaning(
            &server,
            message_id,
            "das war mir jetzt zu viel",
            pieces("heard")
        )
        .await,
        json!({"meaning": "unclear", "piece_id": null, "source": "none"})
    );
    // A yes counts once the card has asked; before that it is listening.
    assert_eq!(
        meaning(&server, message_id, "ja", pieces("not_said")).await["meaning"],
        "noise"
    );
    assert_eq!(
        meaning(&server, message_id, "ja", pieces("heard")).await["meaning"],
        "approve"
    );

    // Bad input.
    for (transcript, body_pieces, current, status) in [
        ("   ", pieces("heard"), "p3", 400),
        ("weiter", pieces("heard"), "p9", 400),
        (
            "weiter",
            json!([{"id": "p1", "role": "what", "state": "heard"}, {"id": "p1", "role": "item", "state": "heard"}]),
            "p1",
            400,
        ),
        (&"weiter ".repeat(50), pieces("heard"), "p3", 413),
    ] {
        let response = server
            .post(&format!(
                "/api/v1beta/me/messages/{message_id}/approval-voice-command"
            ))
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({
                "transcript": transcript,
                "pieces": body_pieces,
                "current_piece_id": current,
            }))
            .await;
        assert_eq!(response.status_code().as_u16(), status, "{transcript:?}");
    }

    // Another user's request answers as if the message did not exist.
    let stranger = JwtTokenBuilder::new()
        .subject("voice-commands-stranger")
        .email("stranger@example.com")
        .name("stranger")
        .build();
    say(&server, &stranger, message_id, "weiter", pieces("heard"))
        .await
        .assert_status_not_found();

    // Nothing is stored on the message.
    let before = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap()
        .raw_message;
    meaning(&server, message_id, "nochmal", pieces("heard")).await;
    let after = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap()
        .raw_message;
    assert_eq!(before, after);

    // Once decided, no approval waits.
    server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": message_id,
            "decisions": [{"approval_id": request["approvals"][0]["approval_id"], "decision": "approve"}],
        }))
        .await
        .assert_status_ok();
    say(
        &server,
        TEST_JWT_TOKEN,
        message_id,
        "weiter",
        pieces("heard"),
    )
    .await
    .assert_status(axum::http::StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn voice_commands_are_off_unless_enabled(pool: Pool<Postgres>) {
    let (state, server, user_id, _, llm) = setup_with_config(
        pool,
        MockSet::new(),
        true,
        "de-DE",
        Some(McpToolApprovalPreset::Permissive),
        |_| {},
    )
    .await;
    let (message_id, _) = parked_cancel(&state, &server, &llm, user_id).await;
    say(
        &server,
        TEST_JWT_TOKEN,
        message_id,
        "weiter",
        pieces("heard"),
    )
    .await
    .assert_status_not_found();
}

/// A provider that answers every request with an error, and counts them.
async fn failing_provider() -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
    let requests = Arc::new(AtomicUsize::new(0));
    let counter = requests.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = Router::new().fallback(move || {
        counter.fetch_add(1, Ordering::SeqCst);
        async { axum::http::StatusCode::INTERNAL_SERVER_ERROR }
    });
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}/v1/"), requests, server)
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_failing_provider_leaves_the_words_unclear(pool: Pool<Postgres>) {
    let (requests, asked) = with_failing_provider(pool, true).await;
    assert!(asked >= 1);
    assert_eq!(requests, asked);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_provider_the_user_may_not_use_is_never_asked(pool: Pool<Postgres>) {
    let (requests, _) = with_failing_provider(pool, false).await;
    assert_eq!(requests, 0);
}

/// Words the rules leave, then words they match, with a provider that always
/// fails. Returns the provider's requests after each.
async fn with_failing_provider(pool: Pool<Postgres>, permitted: bool) -> (usize, usize) {
    let (base_url, requests, provider) = failing_provider().await;
    let (state, server, user_id, _, llm) = setup_with_config(
        pool,
        MockSet::new(),
        true,
        "de-DE",
        Some(McpToolApprovalPreset::Permissive),
        |config| {
            let providers = config.chat_providers.as_mut().unwrap();
            let mut failing = providers.providers["mock-llm"].clone();
            failing.base_url = Some(base_url);
            providers.providers.insert("failing".into(), failing);
            if permitted {
                config.model_permissions.rules.insert(
                    "allow-failing".into(),
                    erato::config::ModelPermissionRule::AllowAll {
                        chat_provider_ids: vec!["failing".into()],
                    },
                );
            }
            config.approval_voice_commands.enabled = true;
            config.approval_voice_commands.chat_provider_id = Some("failing".into());
        },
    )
    .await;
    let (message_id, _) = parked_cancel(&state, &server, &llm, user_id).await;

    assert_eq!(
        meaning(
            &server,
            message_id,
            "das war mir jetzt zu viel",
            pieces("heard")
        )
        .await,
        json!({"meaning": "unclear", "piece_id": null, "source": "none"})
    );
    let asked = requests.load(Ordering::SeqCst);
    // Words the rules match never reach the provider.
    assert_eq!(
        meaning(&server, message_id, "weiter", pieces("heard")).await["meaning"],
        "skip"
    );
    provider.abort();
    (requests.load(Ordering::SeqCst), asked)
}
