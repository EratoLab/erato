//! A tool that declares an MCP Apps view, on a server that enables
//! `mcp_apps`: the call's stored row names the view, the web app reads it
//! through its own route, and the model sees none of it.
use super::*;
use mock_mcp_server::{
    COUNTER_TOOL_NAME, COUNTER_VIEW_HTML, COUNTER_VIEW_MARKER, COUNTER_VIEW_URI, VIEW_MIME_TYPE,
    counter_view_ui_meta,
};
use std::sync::{Arc, Mutex};

const ASK: &str = "Count from three";
const RESULT: &str = "Counter started at 3.";
const SANDBOX_ORIGIN: &str = "https://mcp-apps.example.com";

struct Setup {
    state: erato::state::AppState,
    recorder: RequestBodyRecorder,
    /// Path of every `resources/read` the mock server received.
    reads: Arc<Mutex<Vec<String>>>,
    _llm: MockServer,
}

/// The mock apps server in `era`, as server `charts`. The model calls the
/// counter and the two tools whose views are refused, then answers.
async fn setup(pool: Pool<Postgres>, era: &str, enabled: bool) -> Setup {
    let reads = Arc::new(Mutex::new(Vec::new()));
    let seen = reads.clone();
    let app = mock_mcp_server::app().layer(axum::middleware::from_fn(
        move |request: axum::extract::Request, next: axum::middleware::Next| {
            let seen = seen.clone();
            async move {
                let (parts, body) = request.into_parts();
                let bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
                if serde_json::from_slice::<Value>(&bytes)
                    .is_ok_and(|message| message["method"] == "resources/read")
                {
                    seen.lock().unwrap().push(parts.uri.path().to_string());
                }
                next.run(axum::extract::Request::from_parts(parts, bytes.into()))
                    .await
            }
        },
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[ASK], &[RESULT]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_tool_calls_streaming_response(&[
                    ("call_counter", COUNTER_TOOL_NAME, json!({"start": 3})),
                    ("call_wrong_type", "show_wrong_type_view", json!({})),
                    ("call_oversized", "show_oversized_view", json!({})),
                ]),
            );
        });
    }
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[RESULT], &[]))
                .matcher(recorder);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&["Counted."]));
        });
    }
    let (mut config, llm) = setup_mock_llm_server_with_mocks(mocks).await;
    config.mcp_servers.clear();
    let mut server = mcp_server_config(
        &url,
        &format!("/mcp/{era}/apps"),
        McpServerAuthenticationConfig::None,
    );
    server.protocol_mode = serde_json::from_value(json!(era)).unwrap();
    server.mcp_apps = erato::config::McpAppsConfig {
        enabled,
        sandbox_origin: Some(SANDBOX_ORIGIN.into()),
    };
    config.mcp_servers.insert("charts".into(), server);
    config.mcp_server_permissions.rules.insert(
        "charts".into(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["charts".into()],
        },
    );
    let state = test_app_state(config, pool).await;
    get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    Setup {
        state,
        recorder,
        reads,
        _llm: llm,
    }
}

/// The model's ID of a call, the last part of the ID Erato exposes.
fn provider_call_id(part: &Value) -> String {
    let id = part["tool_call_id"].as_str().unwrap();
    id.rsplit(':').next().unwrap().to_string()
}

/// Each tool row of `content` by the model's call ID.
fn tool_rows(content: &[Value]) -> HashMap<String, Value> {
    content
        .iter()
        .filter(|part| part["content_type"] == "tool_use")
        .map(|part| (provider_call_id(part), part.clone()))
        .collect()
}

/// The terminal update of each tool call in the stream, by the model's
/// call ID.
fn final_updates(events: &[crate::test_utils::Event]) -> HashMap<String, Value> {
    events
        .iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .filter(|update| {
            update["message_type"] == "tool_call_update"
                && matches!(update["status"].as_str(), Some("success" | "error"))
        })
        .map(|update| (provider_call_id(&update), update))
        .collect()
}

/// The tool definitions the model was offered when it called the tools.
fn offered_tools(recorder: &RequestBodyRecorder) -> Value {
    recorder
        .bodies()
        .iter()
        .map(|body| serde_json::from_str::<Value>(body).unwrap())
        .find(|body| body["tools"].to_string().contains(COUNTER_TOOL_NAME))
        .expect("a request offering the counter")["tools"]
        .clone()
}

async fn submit(setup: &Setup) -> (TestServer, Vec<crate::test_utils::Event>, Uuid) {
    let server = app_server(setup.state.clone());
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"user_message": ASK}))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    (server, events, message_id)
}

async fn shows_the_counter_view_in(era: &str, pool: Pool<Postgres>) {
    let setup = setup(pool, era, true).await;
    let (server, events, message_id) = submit(&setup).await;
    let view = json!({"server_id": "charts", "uri": COUNTER_VIEW_URI});

    // The stream and the stored row name the view beside the call's input
    // and output; the calls whose views are refused still succeed, without.
    let updates = final_updates(&events);
    assert_eq!(updates["call_counter"]["status"], "success", "{era}");
    assert_eq!(updates["call_counter"]["result_details"]["view"], view);
    let content = message_content(&setup.state, message_id).await;
    let rows = tool_rows(&content);
    let counter = &rows["call_counter"];
    assert_eq!(counter["status"], "success");
    assert_eq!(counter["input"], json!({"start": 3}));
    assert_eq!(counter["output"], json!(RESULT));
    assert_eq!(counter["result_details"], json!({"view": view}));
    for refused in ["call_wrong_type", "call_oversized"] {
        assert_eq!(rows[refused]["status"], "success", "{era} {refused}");
        assert_eq!(rows[refused]["output"], json!("Counter started at 0."));
        assert!(rows[refused].get("result_details").is_none(), "{era}");
        assert!(updates[refused].get("result_details").is_none(), "{era}");
    }
    // Static outputs are untouched: no file part was added.
    assert_eq!(
        content
            .iter()
            .filter(|part| part["content_type"] != "tool_use" && part["content_type"] != "text")
            .count(),
        0,
        "{content:?}"
    );

    // Nothing of the view reached the model, neither in the tools it was
    // offered nor in the results it read back.
    let bodies = setup.recorder.bodies();
    assert!(bodies.iter().any(|body| body.contains(RESULT)), "{era}");
    for body in &bodies {
        for hidden in [COUNTER_VIEW_MARKER, "ui://", VIEW_MIME_TYPE, "resourceUri"] {
            assert!(!body.contains(hidden), "{era}: {hidden} in {body}");
        }
    }

    // A reopened chat still names the view.
    let row = Messages::find_by_id(message_id)
        .one(&setup.state.db)
        .await
        .unwrap()
        .unwrap();
    let reopened: Value = server
        .get(&format!("/api/v1beta/chats/{}/messages", row.chat_id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    let reopened = reopened["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["id"] == message_id.to_string())
        .unwrap()
        .clone();
    assert_eq!(
        tool_rows(reopened["content"].as_array().unwrap())["call_counter"]["result_details"]["view"],
        view
    );

    // The web app reads the view through its route, from the cache: the
    // counter was read once, each refused view once.
    let response = server
        .get("/api/v1beta/me/mcp_servers/charts/app_view")
        .add_query_param("uri", COUNTER_VIEW_URI)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    assert_eq!(
        response.json::<Value>(),
        json!({
            "uri": COUNTER_VIEW_URI,
            "html": COUNTER_VIEW_HTML,
            "ui": counter_view_ui_meta(),
            "sandbox_origin": SANDBOX_ORIGIN,
        })
    );
    assert_eq!(setup.reads.lock().unwrap().len(), 3, "{era}");
    for uri in ["ui://mock/undeclared", "ui://mock/wrong-type"] {
        server
            .get("/api/v1beta/me/mcp_servers/charts/app_view")
            .add_query_param("uri", uri)
            .with_bearer_token(TEST_JWT_TOKEN)
            .await
            .assert_status(http::StatusCode::BAD_GATEWAY);
    }
    server
        .get("/api/v1beta/me/mcp_servers/charts/app_view")
        .add_query_param("uri", COUNTER_VIEW_URI)
        .await
        .assert_status(http::StatusCode::UNAUTHORIZED);
}

/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_legacy_tool_call_names_its_view_and_the_model_never_sees_it(pool: Pool<Postgres>) {
    shows_the_counter_view_in("legacy", pool).await;
}

/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_stateless_tool_call_names_its_view_and_the_model_never_sees_it(pool: Pool<Postgres>) {
    shows_the_counter_view_in("stateless", pool).await;
}

/// With `mcp_apps` off, the same calls run as they always have: no view is
/// read, no row names one, the route offers none, and the model is offered
/// the same tool definitions as with it on.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
/// - `uses-mock-mcp`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn with_mcp_apps_off_nothing_changes(pool: Pool<Postgres>) {
    let off = setup(pool.clone(), "stateless", false).await;
    let (server, events, message_id) = submit(&off).await;
    for (call, update) in final_updates(&events) {
        assert_eq!(update["status"], "success", "{call}");
        assert!(update.get("result_details").is_none(), "{call}: {update}");
    }
    let content = message_content(&off.state, message_id).await;
    let rows = tool_rows(&content);
    assert_eq!(rows.len(), 3);
    for row in rows.values() {
        assert!(row.get("result_details").is_none(), "{row}");
    }
    assert!(off.reads.lock().unwrap().is_empty());
    server
        .get("/api/v1beta/me/mcp_servers/charts/app_view")
        .add_query_param("uri", COUNTER_VIEW_URI)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status(http::StatusCode::NOT_FOUND);

    let on = setup(pool, "stateless", true).await;
    submit(&on).await;
    assert_eq!(offered_tools(&off.recorder), offered_tools(&on.recorder));
    assert!(
        offered_tools(&on.recorder)
            .as_array()
            .is_some_and(|tools| tools.len() == 4)
    );
}
