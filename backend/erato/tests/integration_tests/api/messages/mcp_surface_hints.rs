//! A server that opted in to surface hints is told, with a tool call from a
//! known surface, which surface the call comes from and what that surface
//! accepts, in the call's `_meta`. The model sees none of it, and other
//! servers get nothing.
use super::*;
use axum::{
    Json,
    extract::{Path, State},
    response::{IntoResponse, Response},
    routing::post,
};
use erato::ms_teams_bot::activity::ConversationKind;
use erato::ms_teams_bot::graph::GraphIdentity;
use erato::ms_teams_bot::host::Host;
use std::sync::{Arc, Mutex};

const MARKER: &str = "SURFACE-RESULT";
const HINT_KEY: &str = "chat.erato/surface";

#[derive(Clone, Default)]
struct Fixture {
    /// Route, method and params of every request the servers received.
    requests: Arc<Mutex<Vec<(String, String, Value)>>>,
}

impl Fixture {
    fn calls(&self, route: &str) -> Vec<Value> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|(at, method, _)| at == route && method == "tools/call")
            .map(|(_, _, params)| params.clone())
            .collect()
    }

    /// Every request that is no tool call, such as initialization and tool
    /// listing.
    fn others(&self) -> Vec<Value> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, method, _)| method != "tools/call")
            .map(|(_, _, params)| params.clone())
            .collect()
    }
}

/// One tool per route, `render_<route>`, served over plain JSON responses
/// for both protocol eras.
async fn mcp(
    State(fixture): State<Fixture>,
    Path(route): Path<String>,
    Json(request): Json<Value>,
) -> Response {
    if request.get("id").is_none() {
        return http::StatusCode::ACCEPTED.into_response();
    }
    let method = request["method"].as_str().unwrap().to_string();
    fixture.requests.lock().unwrap().push((
        route.clone(),
        method.clone(),
        request["params"].clone(),
    ));
    let result = match method.as_str() {
        "initialize" => json!({
            "protocolVersion": request["params"]["protocolVersion"],
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "surface-test", "version": "1"}
        }),
        "tools/list" => json!({"tools": [{
            "name": format!("render_{route}"),
            "description": "Render a diagram",
            "inputSchema": {
                "type": "object",
                "properties": {"source": {"type": "string"}},
                "required": ["source"]
            }
        }]}),
        "tools/call" => json!({"content": [{"type": "text", "text": MARKER}], "isError": false}),
        other => panic!("Unexpected MCP method: {other}"),
    };
    Json(json!({"jsonrpc": "2.0", "id": request["id"], "result": result})).into_response()
}

fn surface(surface: &str, accept: &[&str]) -> Value {
    json!({"surface": surface, "accept": accept})
}

/// The hint a server found in the call's `_meta`, in either protocol era.
fn hint(call: &Value) -> Option<Value> {
    call["_meta"].get(HINT_KEY).cloned()
}

struct Setup {
    fixture: Fixture,
    recorder: RequestBodyRecorder,
    config: erato::config::AppConfig,
    _llm: MockServer,
    mcp: tokio::task::JoinHandle<()>,
}

impl Drop for Setup {
    fn drop(&mut self) {
        self.mcp.abort();
    }
}

/// Three servers on one fixture: `stateless` and `legacy` opted in, each in
/// its protocol era, and `plain` did not. The model calls the given tools,
/// then answers once their results are in.
async fn setup(tool_calls: &[&str]) -> Setup {
    let fixture = Fixture::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new()
        .route("/{route}", post(mcp))
        .with_state(fixture.clone());
    let mcp = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let recorder = RequestBodyRecorder::new();
    let calls = tool_calls
        .iter()
        .map(|name| {
            (
                format!("call_{name}"),
                (*name).to_string(),
                json!({"source": "a -> b"}),
            )
        })
        .collect::<Vec<_>>();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[], &[MARKER]))
                .matcher(recorder);
            let calls = calls
                .iter()
                .map(|(id, name, arguments)| (id.as_str(), name.as_str(), arguments.clone()))
                .collect::<Vec<_>>();
            mock_llm_sse_response(then, build_openai_tool_calls_streaming_response(&calls));
        });
    }
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[MARKER], &[]))
                .matcher(recorder);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&["Rendered."]));
        });
    }
    let (mut config, llm) = setup_mock_llm_server_with_mocks(mocks).await;
    config.mcp_servers.clear();
    for (id, mode, opted_in) in [
        ("stateless", erato::config::McpProtocolMode::Stateless, true),
        ("legacy", erato::config::McpProtocolMode::Legacy, true),
        ("plain", erato::config::McpProtocolMode::Stateless, false),
    ] {
        let mut server =
            mcp_server_config(&url, &format!("/{id}"), McpServerAuthenticationConfig::None);
        server.protocol_mode = mode;
        server.surface_hints = opted_in;
        config.mcp_servers.insert(id.into(), server);
    }
    config.mcp_server_permissions.rules.insert(
        "surface".into(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["stateless".into(), "legacy".into(), "plain".into()],
        },
    );
    Setup {
        fixture,
        recorder,
        config,
        _llm: llm,
        mcp,
    }
}

/// Nothing a server or the model received carries the hint outside the tool
/// call metadata it belongs in.
fn assert_hint_only_in_call_metadata(setup: &Setup) {
    for params in setup.fixture.others() {
        assert!(!params.to_string().contains(HINT_KEY), "{params}");
    }
    for route in ["stateless", "legacy", "plain"] {
        for call in setup.fixture.calls(route) {
            assert_eq!(call["arguments"], json!({"source": "a -> b"}), "{call}");
        }
    }
    let bodies = setup.recorder.bodies();
    assert!(!bodies.is_empty());
    for body in bodies {
        assert!(!body.contains(HINT_KEY), "{body}");
        assert!(!body.contains("image/svg+xml"), "{body}");
    }
}

async fn stored_platform(state: &erato::state::AppState, message_id: Uuid) -> Value {
    let row = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let parameters: GenerationParameters =
        serde_json::from_value(row.generation_parameters.unwrap()).unwrap();
    json!(
        parameters
            .request_context
            .and_then(|context| context.platform)
    )
}

/// From the Teams tab, the stateless and the legacy server both find the hint
/// in the call's `_meta`, with the tab's built-in list, again when the answer
/// is regenerated; the server that did not opt in gets nothing.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn opted_in_servers_are_told_the_surface_in_both_protocol_eras(pool: Pool<Postgres>) {
    let setup = setup(&["render_stateless", "render_legacy", "render_plain"]).await;
    let state = test_app_state(setup.config.clone(), pool).await;
    get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let server = app_server(state.clone());

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Platform", "teams")
        .json(&json!({"user_message": "Draw the flow"}))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    let tab = surface("teams", &["image/svg+xml", "image/png"]);
    let stateless = setup.fixture.calls("stateless");
    assert_eq!(stateless.len(), 1, "{stateless:?}");
    assert_eq!(hint(&stateless[0]), Some(tab.clone()));

    let legacy = setup.fixture.calls("legacy");
    assert_eq!(legacy.len(), 1, "{legacy:?}");
    assert_eq!(hint(&legacy[0]), Some(tab.clone()));

    let plain = setup.fixture.calls("plain");
    assert_eq!(plain.len(), 1, "{plain:?}");
    assert_eq!(hint(&plain[0]), None, "{}", plain[0]);

    assert_hint_only_in_call_metadata(&setup);
    assert_eq!(stored_platform(&state, message_id).await, json!("teams"));

    server
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Platform", "teams")
        .json(&json!({"current_message_id": message_id}))
        .await
        .assert_status_ok();
    let legacy = setup.fixture.calls("legacy");
    assert_eq!(legacy.len(), 2, "{legacy:?}");
    assert_eq!(hint(&legacy[1]), Some(tab));
    assert_hint_only_in_call_metadata(&setup);
}

fn identity() -> GraphIdentity {
    serde_json::from_value(json!({
        "id": "4a1b3c5d-0000-4000-8000-00000000beef",
        "displayName": "Teams User",
        "mail": "teams.user@example.com",
    }))
    .unwrap()
}

/// The Teams bot reports its own surface, which accepts no SVG, so a server
/// can tell it apart from the tab.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_teams_bot_is_told_apart_from_the_tab(pool: Pool<Postgres>) {
    let setup = setup(&["render_stateless", "render_legacy", "render_plain"]).await;
    let state = test_app_state(setup.config.clone(), pool).await;
    let user = get_or_create_user(&state.db, "https://issuer.example", "surface-bot", None)
        .await
        .unwrap();
    let host = Host::new(state.clone());
    let session = host
        .session(
            &user,
            &identity(),
            Vec::new(),
            "graph-token".into(),
            None,
            "tenant-1",
        )
        .await
        .unwrap();
    let row = host
        .upsert_conversation(
            "a:personal-surface",
            ConversationKind::Personal,
            user.id,
            "https://smba.example/",
            "29:user",
        )
        .await
        .unwrap();
    let (chat_id, _) = host.ensure_chat(&session, &row, None).await.unwrap();
    let mut updates = host
        .submit(&session, chat_id, "Draw the flow".into(), Vec::new())
        .await
        .unwrap();
    while updates.recv().await.is_some() {}

    let bot = surface("teams-bot", &["image/png"]);
    let stateless = setup.fixture.calls("stateless");
    assert_eq!(stateless.len(), 1, "{stateless:?}");
    assert_eq!(hint(&stateless[0]), Some(bot.clone()));
    let legacy = setup.fixture.calls("legacy");
    assert_eq!(legacy.len(), 1, "{legacy:?}");
    assert_eq!(hint(&legacy[0]), Some(bot));
    let plain = setup.fixture.calls("plain");
    assert_eq!(plain.len(), 1, "{plain:?}");
    assert_eq!(hint(&plain[0]), None, "{}", plain[0]);
    assert_hint_only_in_call_metadata(&setup);

    let answer = Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
        .order_by_desc(erato::db::entity::messages::Column::CreatedAt)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored_platform(&state, answer.id).await, json!("teams-bot"));
}

/// A configured list replaces the built-in one, and a call the user approves
/// later carries the surface of the turn that asked, whichever client the
/// decision comes from.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_approved_call_keeps_the_surface_of_the_turn_that_asked(pool: Pool<Postgres>) {
    let mut setup = setup(&["render_legacy"]).await;
    setup.config.mcp_servers_global.surfaces.insert(
        "outlook".into(),
        erato::config::McpSurfaceConfig {
            accept: vec!["image/png".into()],
        },
    );
    // The tool declares no hints, so the permissive preset asks first.
    setup.config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Permissive,
        allow_always: false,
    };
    let state = test_app_state(setup.config.clone(), pool).await;
    get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let server = app_server(state.clone());

    let initial = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Platform", "outlook")
        .json(&json!({"user_message": "Draw the flow"}))
        .await;
    initial.assert_status_ok();
    let message_id = Uuid::parse_str(&assistant_message_id_from_events(&parse_sse_events(
        &initial,
    )))
    .unwrap();
    assert!(setup.fixture.calls("legacy").is_empty(), "approval first");

    // Decided from the web app.
    server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"message_id": message_id, "decision": "approve"}))
        .await
        .assert_status_ok();
    let legacy = setup.fixture.calls("legacy");
    assert_eq!(legacy.len(), 1, "{legacy:?}");
    assert_eq!(hint(&legacy[0]), Some(surface("outlook", &["image/png"])));
    assert_hint_only_in_call_metadata(&setup);
}
