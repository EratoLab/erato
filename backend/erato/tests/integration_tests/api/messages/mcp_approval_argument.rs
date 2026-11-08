//! A server's consent argument is Erato's to fill: hidden from the model, asked
//! for on every call, and sent as the user's actual decision.
use super::*;
use axum::{
    Json,
    extract::State,
    response::{IntoResponse, Response},
    routing::post,
};
use std::sync::{Arc, Mutex};

const MARKER: &str = "CONSENT-RESULT";
const ARGUMENT: &str = "hasUserApproved";

#[derive(Clone, Default)]
struct Fixture {
    /// `tools/call` params as the server received them.
    calls: Arc<Mutex<Vec<Value>>>,
}

async fn mcp(State(fixture): State<Fixture>, Json(request): Json<Value>) -> Response {
    if request.get("id").is_none() {
        return http::StatusCode::ACCEPTED.into_response();
    }
    let mut result = match request["method"].as_str().unwrap() {
        "server/discover" => {
            json!({"supportedVersions": ["2026-07-28"], "capabilities": {"tools": {}}})
        }
        "initialize" => json!({
            "protocolVersion": request["params"]["protocolVersion"],
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "consent-test", "version": "1"}
        }),
        // Read-only and closed-world on purpose: without the consent argument
        // the permissive preset would run this tool without asking.
        "tools/list" => json!({"tools": [{
            "name": "delete_record",
            "description": "Delete a record",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "recordId": {"type": "string"},
                    "hasUserApproved": {"type": "boolean"}
                },
                "required": ["recordId", "hasUserApproved"]
            },
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false}
        }]}),
        "tools/call" => {
            fixture
                .calls
                .lock()
                .unwrap()
                .push(request["params"].clone());
            json!({"content": [{"type": "text", "text": MARKER}], "isError": false})
        }
        other => panic!("Unexpected MCP method: {other}"),
    };
    result["resultType"] = json!("complete");
    if request["method"] != "tools/call" {
        result["ttlMs"] = json!(30_000);
        result["cacheScope"] = json!("private");
    }
    Json(json!({"jsonrpc": "2.0", "id": request["id"], "result": result})).into_response()
}

/// The paths of a stored display's readable argument view.
fn shown_argument_paths(display: &Value) -> Vec<String> {
    fn walk(node: &Value, out: &mut Vec<String>) {
        out.push(node["path"].as_str().unwrap().to_string());
        for child in node["children"].as_array().into_iter().flatten() {
            walk(child, out);
        }
    }
    let mut paths = Vec::new();
    walk(&display["label"]["arguments"], &mut paths);
    paths
}

fn stored_tool_row(raw_message: &Value) -> Value {
    raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| part["content_type"] == "tool_use" && part["tool_name"] == "delete_record")
        .unwrap_or_else(|| panic!("tool row stored: {raw_message}"))
        .clone()
}

async fn setup(
    gate_enabled: bool,
) -> (
    Fixture,
    RequestBodyRecorder,
    erato::config::AppConfig,
    MockServer,
    tokio::task::JoinHandle<()>,
) {
    let fixture = Fixture::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new()
        .route("/mcp", post(mcp))
        .with_state(fixture.clone());
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[], &[MARKER]))
                .matcher(recorder);
            // The model claims a consent it was never given.
            mock_llm_sse_response(
                then,
                build_openai_tool_calls_streaming_response(&[(
                    "call_delete",
                    "delete_record",
                    json!({"recordId": "r1", "hasUserApproved": true}),
                )]),
            );
        });
    }
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[MARKER], &[]));
        mock_llm_sse_response(then, build_openai_text_streaming_response(&["Deleted."]));
    });
    let (mut config, llm) = setup_mock_llm_server_with_mocks(mocks).await;
    config.mcp_servers.clear();
    let mut server = mcp_server_config(&url, "/mcp", McpServerAuthenticationConfig::None);
    server.protocol_mode = erato::config::McpProtocolMode::Stateless;
    server.approval_argument = Some(ARGUMENT.to_string());
    config.mcp_servers.insert("dv".into(), server);
    config.mcp_server_permissions.rules.insert(
        "dv".into(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["dv".into()],
        },
    );
    // Permissive with standing grants on: the consent argument overrides both.
    config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: gate_enabled,
        preset: erato::config::McpToolApprovalPreset::Permissive,
        allow_always: true,
    };
    (fixture, recorder, config, llm, handle)
}

/// The model never sees the argument, the user is asked although the tool is
/// read-only, the card offers no standing grant, and the server receives the
/// user's answer rather than the model's claim.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn consent_argument_is_hidden_asked_for_and_filled(pool: Pool<Postgres>) {
    let (fixture, recorder, config, _llm, handle) = setup(true).await;
    let state = test_app_state(config, pool).await;
    get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let server = app_server(state.clone());

    let listing = server
        .get("/api/v1beta/me/mcp_servers/dv/tools")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    listing.assert_status_ok();
    let listing: Value = listing.json();
    let tool = &listing["tools"][0];
    assert_eq!(tool["name"], "delete_record", "{listing}");
    assert_eq!(tool["policy"], "ask", "{tool}");
    assert_eq!(tool["effective"], "ask", "{tool}");

    let initial = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"user_message": "Delete record r1"}))
        .await;
    initial.assert_status_ok();
    let events = parse_sse_events(&initial);
    let message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();

    // Other generations (the chat title, for one) share the mock, so look
    // for the request that offered the tool rather than the first one.
    let bodies = recorder.bodies();
    let declared = bodies
        .iter()
        .filter_map(|body| serde_json::from_str::<Value>(body).ok())
        .find_map(|body| {
            body["tools"].as_array().and_then(|tools| {
                tools
                    .iter()
                    .find(|tool| tool["function"]["name"] == "delete_record")
                    .cloned()
            })
        })
        .unwrap_or_else(|| panic!("tool offered to the model: {bodies:?}"));
    let parameters = &declared["function"]["parameters"];
    assert!(
        parameters["properties"].get(ARGUMENT).is_none(),
        "{parameters}"
    );
    assert_eq!(parameters["required"], json!(["recordId"]), "{parameters}");

    assert!(
        fixture.calls.lock().unwrap().is_empty(),
        "approval must precede execution"
    );
    let row = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let request = row.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| part["content_type"] == "tool_approval_request")
        .expect("parked on an approval request")
        .clone();
    assert_eq!(request["allow_always"], false, "{request}");
    // The model's claim is in the stored input, but the card does not list it
    // as something the call writes.
    assert_eq!(request["input"][ARGUMENT], true, "{request}");
    assert_eq!(
        shown_argument_paths(&request["display"]),
        ["", "/recordId"],
        "{request}"
    );
    assert_eq!(request["approvals"][0]["display"], request["display"]);

    server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"message_id": message_id, "decision": "approve"}))
        .await
        .assert_status_ok();
    let calls = fixture.calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert_eq!(calls[0]["name"], "delete_record");
    assert_eq!(calls[0]["arguments"]["recordId"], "r1");
    assert_eq!(calls[0]["arguments"][ARGUMENT], true, "{calls:?}");
    let row = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let tool = stored_tool_row(&row.raw_message);
    assert_eq!(tool["status"], "success", "{tool}");
    assert_eq!(
        shown_argument_paths(&tool["display"]),
        ["", "/recordId"],
        "{tool}"
    );
    handle.abort();
}

/// With the gate off nobody can be asked: the call runs, and the server is
/// told so instead of receiving the model's claim.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn without_the_gate_the_server_receives_false(pool: Pool<Postgres>) {
    let (fixture, _recorder, config, _llm, handle) = setup(false).await;
    let state = test_app_state(config, pool).await;
    get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let server = app_server(state.clone());

    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"user_message": "Delete record r1"}))
        .await;
    response.assert_status_ok();
    let calls = fixture.calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert_eq!(calls[0]["arguments"]["recordId"], "r1");
    assert_eq!(calls[0]["arguments"][ARGUMENT], false, "{calls:?}");
    let message_id = Uuid::parse_str(&assistant_message_id_from_events(&parse_sse_events(
        &response,
    )))
    .unwrap();
    let row = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let tool = stored_tool_row(&row.raw_message);
    assert_eq!(tool["input"][ARGUMENT], true, "{tool}");
    assert_eq!(
        shown_argument_paths(&tool["display"]),
        ["", "/recordId"],
        "{tool}"
    );
    handle.abort();
}
