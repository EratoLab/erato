//! Native Stop must reach the running Erato generation even before its ID
//! arrives at the Teams renderer.
use super::*;
use crate::config::AppConfig;
use crate::db::entity::prelude::Messages;
use crate::models::user::get_or_create_user;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::State,
    response::sse::{Event, Sse},
    routing::post,
};
use futures::StreamExt;
use sea_orm::EntityTrait;
use sqlx::ConnectOptions;
use std::sync::Mutex;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../sqitch/deploy");

struct Harness {
    outgoing: Arc<Mutex<Vec<Value>>>,
    base: String,
    server: tokio::task::JoinHandle<()>,
    state: AppState,
    host: Host,
    session: Session,
    chat_id: Uuid,
}

/// A personal Teams chat whose model streams until it is cancelled.
async fn harness(pool: sqlx::PgPool) -> Harness {
    let outgoing = Arc::new(Mutex::new(Vec::<Value>::new()));
    let routes = Router::new()
        .route(
            "/v1/chat/completions",
            post(|| async {
                // The model cannot finish naturally: only cancellation can settle
                // this turn. Send valid headers/data so it can enter generation.
                let first = futures::stream::once(async {
                    Ok::<_, std::convert::Infallible>(Event::default().data(json!({
                    "id":"test", "object":"chat.completion.chunk", "created":0,
                    "model":"gpt-3.5-turbo", "choices":[{"index":0,
                        "delta":{"role":"assistant","content":""}, "finish_reason":null}]
                }).to_string()))
                });
                Sse::new(first.chain(futures::stream::pending()))
            }),
        )
        .route(
            "/v3/conversations/{conversation}/activities",
            post(connector_reply),
        )
        .route(
            "/v3/conversations/{conversation}/activities/{activity}",
            post(connector_reply).put(connector_reply),
        )
        .with_state(outgoing.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, routes).await.unwrap() });
    let config: AppConfig = AppConfig::config_schema_builder(None, false)
        .unwrap()
        .set_override(
            "database_url",
            pool.connect_options().to_url_lossy().to_string(),
        )
        .unwrap()
        .set_override(
            "file_storage_providers",
            std::collections::HashMap::<String, String>::new(),
        )
        .unwrap()
        .set_override("chat_providers.providers.mock.provider_kind", "openai")
        .unwrap()
        .set_override("chat_providers.providers.mock.model_name", "gpt-3.5-turbo")
        .unwrap()
        .set_override(
            "chat_providers.providers.mock.base_url",
            format!("{base}/v1/"),
        )
        .unwrap()
        .set_override("chat_providers.priority_order", vec!["mock"])
        .unwrap()
        .set_override("model_permissions.rules.allow-mock.rule_type", "allow-all")
        .unwrap()
        .set_override(
            "model_permissions.rules.allow-mock.chat_provider_ids",
            vec!["mock"],
        )
        .unwrap()
        .build()
        .unwrap()
        .try_deserialize()
        .unwrap();
    let state = AppState::new(config).await.unwrap();
    let host = Host::new(state.clone());
    let user = get_or_create_user(&state.db, "https://issuer.example", "early-stop", None)
        .await
        .unwrap();
    let identity: GraphIdentity = serde_json::from_value(json!({
        "id":"4a1b3c5d-0000-4000-8000-00000000cafe", "displayName":"Teams User"
    }))
    .unwrap();
    let session = host
        .session(
            &user,
            &identity,
            Vec::new(),
            "graph-token".into(),
            None,
            "tenant",
        )
        .await
        .unwrap();
    let row = host
        .upsert_conversation(
            "conversation",
            ConversationKind::Personal,
            user.id,
            &base,
            "29:user",
        )
        .await
        .unwrap();
    let (chat_id, _) = host.ensure_chat(&session, &row, None).await.unwrap();
    Harness {
        outgoing,
        base,
        server,
        state,
        host,
        session,
        chat_id,
    }
}

/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "MIGRATOR")]
async fn native_stop_before_started_aborts_the_saved_backend_generation(pool: sqlx::PgPool) {
    let Harness {
        outgoing,
        base,
        server,
        state,
        host,
        session,
        chat_id,
    } = harness(pool).await;
    let request = host
        .remember_request(&session, "conversation", "question", chat_id)
        .await
        .unwrap()
        .unwrap();
    let mut source = host
        .submit(&session, chat_id, "Keep explaining DNS".into(), Vec::new())
        .await
        .unwrap();
    let (sender, updates) = mpsc::channel(100);
    // FIFO guarantees a pre-Started iteration after the Connector has reported
    // Stop. Returning early here instead of draining will fail this test.
    sender
        .send(GenerationUpdate::Status("Preparing…".into()))
        .await
        .unwrap();
    let tasks = state.background_tasks.clone();
    let forwarder = tokio::spawn(async move {
        while let Some(update) = source.recv().await {
            if let GenerationUpdate::Started {
                chat_id,
                message_id,
            } = &update
            {
                assert_eq!(
                    tasks.active_generation(chat_id).await.unwrap().message_id(),
                    Some(*message_id),
                    "the submit path must set the message ID before announcing it"
                );
            }
            sender
                .send(update)
                .await
                .expect("renderer must drain the aborted generation");
        }
    });
    let bot = TeamsBot::for_test(&base, true);
    let target = ReplyTarget {
        connector: &bot.connector,
        service_url: &base,
        conversation_id: "conversation",
        reply_to_id: None,
        mention: None,
    };
    tokio::time::timeout(
        Duration::from_secs(15),
        render_generation(
            &bot,
            &host,
            &target,
            updates,
            stream_for(&bot, &target, ConversationKind::Personal),
            Some(request.clone()),
        ),
    )
    .await
    .expect("native Stop must end the backend generation")
    .unwrap();
    tokio::time::timeout(Duration::from_secs(10), forwarder)
        .await
        .expect("renderer must drain a terminal backend event after Stop")
        .unwrap();
    let stopped = host.request_snapshot(request.id).await.unwrap().unwrap();
    assert_eq!(stopped.state, RequestState::Stopped);
    assert_eq!(stopped.action_kind, Some(ActionKind::Retry));
    let message = Messages::find_by_id(stopped.assistant_message_id.unwrap())
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        message.generation_metadata.as_ref().unwrap()["was_aborted"],
        true,
        "Stopped in Teams must mean the persisted backend generation was aborted"
    );
    tokio::time::timeout(Duration::from_secs(10), async {
        while state
            .background_tasks
            .active_generation(&chat_id)
            .await
            .is_some()
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("aborted generation releases its lease");
    let delivered = outgoing.lock().unwrap();
    assert_eq!(
        delivered
            .iter()
            .filter(|body| body["channelData"]["streamType"].is_string())
            .count(),
        1,
        "no streaming, final answer or fallback after native Stop"
    );
    assert!(delivered.iter().any(|body| {
        body["attachments"][0]["content"]["actions"]
            .as_array()
            .is_some_and(|actions| actions.iter().any(|action| action["title"] == "Retry"))
    }));
    server.abort();
}

async fn connector_reply(
    State(outgoing): State<Arc<Mutex<Vec<Value>>>>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let is_stream = body["channelData"]["streamType"].is_string();
    outgoing.lock().unwrap().push(body);
    if is_stream {
        (
            StatusCode::FORBIDDEN,
            Json(json!({"error":{
                "code":"ContentStreamNotAllowed", "message":"Content stream was cancelled by user."
            }})),
        )
    } else {
        (StatusCode::OK, Json(json!({"id":"controls"})))
    }
}

/// A newer message that was refused or failed must not hide the generation
/// that is still running from `/stop`.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "MIGRATOR")]
async fn stop_command_finds_the_running_request_behind_a_newer_failure(pool: sqlx::PgPool) {
    let harness = harness(pool).await;
    let (host, session, chat_id) = (&harness.host, &harness.session, harness.chat_id);
    let running = host
        .remember_request(session, "conversation", "question-1", chat_id)
        .await
        .unwrap();
    let mut updates = host
        .submit(session, chat_id, "Keep explaining DNS".into(), Vec::new())
        .await
        .unwrap();
    let mut tracked = running;
    while let Some(update) = updates.recv().await {
        host.track_update(&mut tracked, &update, false).await;
        if matches!(update, GenerationUpdate::Started { .. }) {
            break;
        }
    }
    let running = tracked.expect("the running request is tracked");
    let newer = host
        .remember_request(session, "conversation", "question-2", chat_id)
        .await
        .unwrap()
        .unwrap();
    host.finish_request(&newer, RequestState::Failed)
        .await
        .unwrap();

    let active = host
        .active_request(session, "conversation", chat_id)
        .await
        .unwrap()
        .expect("/stop resolves the running generation");
    assert_eq!(active.id, running.id);
    assert!(
        host.active_request(session, "another-conversation", chat_id)
            .await
            .unwrap()
            .is_none(),
        "another conversation cannot stop it"
    );
    assert!(
        host.stop_request(session, &active, active.assistant_message_id.unwrap())
            .await
            .unwrap()
    );
    tokio::time::timeout(Duration::from_secs(10), async {
        while updates.recv().await.is_some() {}
    })
    .await
    .expect("the stopped generation ends");
    harness.server.abort();
}
