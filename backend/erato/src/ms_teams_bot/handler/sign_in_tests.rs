//! Exercise the real message and auth handlers against a local token service
//! and Connector. `/new` completes through the ordinary authenticated message
//! path without requiring a live Graph or model endpoint.
use super::*;
use crate::config::AppConfig;
use crate::models::user::{get_or_create_user, record_entra_object_id};
use crate::ms_teams_bot::{
    TeamsBotSettings, connector::Connector, inbound_auth::InboundAuth, user_token::UserTokenClient,
};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use sqlx::ConnectOptions;
use std::sync::atomic::{AtomicBool, Ordering};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../sqitch/deploy");
const OID: &str = "4a1b3c5d-0000-4000-8000-00000000cafe";

#[derive(Clone)]
struct TokenService {
    signed_in: Arc<AtomicBool>,
    exchange_succeeds: Arc<AtomicBool>,
    outgoing: mpsc::UnboundedSender<Value>,
}

async fn get_token(State(state): State<TokenService>) -> (StatusCode, Json<Value>) {
    if state.signed_in.load(Ordering::SeqCst) {
        (StatusCode::OK, Json(json!({"token": "graph-token"})))
    } else {
        (StatusCode::NOT_FOUND, Json(json!({})))
    }
}

async fn exchange(State(state): State<TokenService>) -> (StatusCode, Json<Value>) {
    if !state.exchange_succeeds.load(Ordering::SeqCst) {
        return (StatusCode::PRECONDITION_FAILED, Json(json!({})));
    }
    state.signed_in.store(true, Ordering::SeqCst);
    get_token(State(state)).await
}

async fn send(State(state): State<TokenService>, Json(activity): Json<Value>) -> Json<Value> {
    // Enforce the production Connector requirement that exposed the bug.
    if activity.get("attachments").is_some() {
        assert_eq!(activity["recipient"]["id"], "29:user");
    }
    state.outgoing.send(activity).unwrap();
    Json(json!({"id": "sent-activity"}))
}

async fn next_message(receiver: &mut mpsc::UnboundedReceiver<Value>) -> Value {
    tokio::time::timeout(Duration::from_secs(10), receiver.recv())
        .await
        .expect("the original request should resume without another user message")
        .unwrap()
}

/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn handlers_resume_sso_and_interactive_sign_in_without_duplicate_replies(pool: sqlx::PgPool) {
    let (outgoing, mut received) = mpsc::unbounded_channel();
    let token_service = TokenService {
        signed_in: Arc::new(AtomicBool::new(false)),
        exchange_succeeds: Arc::new(AtomicBool::new(true)),
        outgoing,
    };
    let routes = Router::new()
        .route("/api/usertoken/GetToken", get(get_token))
        .route("/api/usertoken/exchange", post(exchange))
        .route(
            "/api/botsignin/GetSignInResource",
            get(|| async {
                Json(
                    json!({"signInLink": "https://token.botframework.com/signin",
                "tokenExchangeResource": {"id": "exchange-1", "uri": "api://bot"}}),
                )
            }),
        )
        .route("/v3/conversations/{conversation}/activities", post(send))
        .with_state(token_service.clone());
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
        .build()
        .unwrap()
        .try_deserialize()
        .unwrap();
    let state = AppState::new(config).await.unwrap();
    let user = get_or_create_user(&state.db, "https://issuer.example", "test-user", None)
        .await
        .unwrap();
    record_entra_object_id(&state.db, &user, OID).await.unwrap();
    let host = Host::new(state);
    let http = reqwest::Client::new();
    let bot = Arc::new(TeamsBot {
        settings: TeamsBotSettings {
            tenant_id: "tenant".into(),
            public_base_url: None,
            assistant_id: None,
            context_message_count: 0,
            streaming: false,
            security_groups_only: false,
        },
        inbound: InboundAuth::with_static_keys("bot".into(), Vec::new()),
        connector: Connector::with_test_token(http),
        user_tokens: UserTokenClient::new(&base, "graph-sso".into(), "bot".into()),
        identities: moka::future::Cache::new(10),
    });
    bot.identities
        .insert(
            OID.into(),
            (
                GraphIdentity {
                    id: OID.into(),
                    display_name: Some("Teams User".into()),
                    mail: None,
                    user_principal_name: None,
                    preferred_language: None,
                },
                Vec::new(),
            ),
        )
        .await;

    // Silent SSO, failed SSO followed by interactive sign-in, and token-response
    // events all resume through the same single-consumer continuation.
    for mode in ["sso", "fallback", "event"] {
        token_service.signed_in.store(false, Ordering::SeqCst);
        token_service
            .exchange_succeeds
            .store(mode == "sso", Ordering::SeqCst);
        let activity: Activity = serde_json::from_value(json!({
            "type": "message", "id": mode, "text": "/new", "serviceUrl": base,
            "from": {"id": "29:user", "aadObjectId": OID}, "recipient": {"id": "28:bot"},
            "conversation": {"id": "a:personal", "conversationType": "personal", "tenantId": "tenant"}
        })).unwrap();
        on_message(bot.clone(), host.clone(), activity.clone()).await;
        let card = next_message(&mut received).await;
        assert!(card.get("text").is_none());
        assert_eq!(
            card["attachments"][0]["content"]["tokenExchangeResource"]["id"],
            "exchange-1"
        );
        let mut invoke = activity.clone();
        invoke.kind = "invoke".into();
        invoke.name = Some("signin/tokenExchange".into());
        invoke.value =
            Some(json!({"id": "exchange-1", "connectionName": "wrong", "token": "sso-token"}));
        assert_eq!(
            on_invoke(&bot, &host, &invoke).await.0,
            StatusCode::BAD_REQUEST
        );
        invoke.value.as_mut().unwrap()["connectionName"] = json!("graph-sso");
        let status = on_invoke(&bot, &host, &invoke).await.0;
        if mode == "sso" {
            assert_eq!(status, StatusCode::OK);
        } else {
            assert_eq!(status, StatusCode::PRECONDITION_FAILED);
            assert!(
                received.try_recv().is_err(),
                "failed exchange must not resume the request"
            );
            token_service.signed_in.store(true, Ordering::SeqCst);
            invoke.value = Some(json!({"connectionName": "graph-sso", "state": "magic-code"}));
            invoke.name = Some("signin/verifyState".into());
            if mode == "fallback" {
                assert_eq!(on_invoke(&bot, &host, &invoke).await.0, StatusCode::OK);
            } else {
                invoke.kind = "event".into();
                invoke.name = Some("tokens/response".into());
                on_token_response(bot.clone(), host.clone(), invoke.clone()).await;
            }
        }
        let reply = next_message(&mut received).await;
        assert_eq!(
            reply["text"],
            "Started a new chat. Send your next message when you are ready."
        );
        // Duplicate callback plus a retried original activity must stay silent.
        if mode == "event" {
            on_token_response(bot.clone(), host.clone(), invoke).await;
        } else {
            assert_eq!(on_invoke(&bot, &host, &invoke).await.0, StatusCode::OK);
        }
        on_message(bot.clone(), host.clone(), activity).await;
        assert!(received.try_recv().is_err());
    }
    server.abort();
}
