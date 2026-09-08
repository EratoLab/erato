//! Wire-level fixtures exercise the actual SSE and Streamable HTTP clients.
use super::*;
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response, Sse, sse::Event},
    routing::{get, post},
};
use serde_json::{Value, json};
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};
use tokio_stream::wrappers::UnboundedReceiverStream;

type Events = UnboundedSender<Result<Event, std::convert::Infallible>>;
#[derive(Clone, Default)]
struct WireServer(
    Arc<tokio::sync::Mutex<Option<Events>>>,
    Arc<std::sync::atomic::AtomicUsize>,
);

async fn sse_connect(State(state): State<WireServer>) -> Response {
    let (tx, rx) = unbounded_channel();
    tx.send(Ok(Event::default().event("endpoint").data("/messages")))
        .unwrap();
    *state.0.lock().await = Some(tx);
    Sse::new(UnboundedReceiverStream::new(rx)).into_response()
}

async fn emit(request: Value, tx: Events, attempts: Arc<std::sync::atomic::AtomicUsize>) {
    let result = match request["method"].as_str().unwrap_or_default() {
        "initialize" => {
            json!({"protocolVersion": request["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "progress-test", "version": "1"}})
        }
        "tools/list" => {
            json!({"tools": [{"name": "read_file", "inputSchema": {"type": "object"}}]})
        }
        "tools/call" => {
            let marker = request["params"]["arguments"]["marker"].as_str().unwrap();
            let token = request["params"]["_meta"]["progressToken"].clone();
            assert!(!token.is_null(), "SDK must request progress");
            if marker == "error"
                || (marker == "retry"
                    && attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0)
            {
                let message = if marker == "retry" {
                    "session invalid"
                } else {
                    "tool failed"
                };
                let _ = tx.send(Ok(Event::default().event("message").data(json!({"jsonrpc":"2.0", "id":request["id"], "error":{"code":-32603,"message":message}}).to_string())));
                return;
            }
            if marker != "silent" {
                for step in 1..=3 {
                    let mut params = json!({"progressToken": token, "progress": step});
                    if step != 2 {
                        params["total"] = json!(3);
                        params["message"] = json!(format!("{marker} step {step}"));
                    }
                    if tx.send(Ok(Event::default().event("message").data(json!({"jsonrpc":"2.0", "method":"notifications/progress", "params":params}).to_string()))).is_err() { return; }
                    if marker != "burst" {
                        tokio::time::sleep(Duration::from_millis(30)).await;
                    }
                }
            }
            json!({"content": [{"type":"text", "text":"done"}]})
        }
        _ => return,
    };
    let _ = tx.send(Ok(Event::default().event("message").data(
        json!({"jsonrpc":"2.0", "id":request["id"], "result":result}).to_string(),
    )));
}

async fn sse_post(State(state): State<WireServer>, Json(request): Json<Value>) -> StatusCode {
    let tx = state.0.lock().await.clone().unwrap();
    tokio::spawn(emit(request, tx, state.1));
    StatusCode::ACCEPTED
}

async fn http_post(State(state): State<WireServer>, Json(request): Json<Value>) -> Response {
    if request.get("id").is_none() {
        return StatusCode::ACCEPTED.into_response();
    }
    let (tx, rx) = unbounded_channel();
    tokio::spawn(emit(request, tx, state.1));
    Sse::new(UnboundedReceiverStream::new(rx)).into_response()
}

async fn exercise(manager: &McpSessionManager, chat: Uuid, server: &str) {
    let (tx, mut rx) = unbounded_channel();
    let mut params = CallToolRequestParams::default();
    params.name = "read_file".into();
    let marker = Uuid::new_v4().to_string();
    params.arguments = json!({"marker": marker}).as_object().cloned();
    let auth = McpRequestAuthContext::default();
    let call = manager.call_tool_with_progress(chat, server, params, &auth, Some(tx));
    tokio::pin!(call);
    for step in 1..=3 {
        let update = tokio::select! {
            update = rx.recv() => update.unwrap(),
            result = &mut call => panic!("tool completed before progress {step}: {result:?}"),
        };
        assert_eq!(update.progress, f64::from(step));
        assert_eq!(update.total, if step == 2 { None } else { Some(3.0) });
        assert_eq!(
            update.message,
            if step == 2 {
                None
            } else {
                Some(format!("{marker} step {step}"))
            }
        );
    }
    assert!(call.await.is_ok());
    assert!(rx.recv().await.is_none());
}

#[tokio::test]
async fn progress_arrives_before_results_over_both_transports() {
    let app = Router::new()
        .route("/sse", get(sse_connect))
        .route("/messages", post(sse_post))
        .route("/mcp", post(http_post))
        .with_state(WireServer::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut config = AppConfig::default();
    for (id, transport, path) in [
        ("sse", "sse", "sse"),
        ("http-a", "streamable_http", "mcp"),
        ("http-b", "streamable_http", "mcp"),
    ] {
        let mut entry = super::tests::server_config(None, vec![]);
        entry.transport_type = transport.to_owned();
        entry.url = format!("http://{address}/{path}");
        config.mcp_servers.insert(id.to_owned(), entry);
    }
    let manager = McpSessionManager::new(&config);
    let chat_a = Uuid::new_v4();
    let chat_b = Uuid::new_v4();
    tokio::time::timeout(Duration::from_secs(10), async {
        // Same chat across servers, different chats on one server, and two
        // simultaneous calls in a shared session all have independent routes.
        tokio::join!(
            exercise(&manager, chat_a, "sse"),
            exercise(&manager, chat_a, "http-a"),
            exercise(&manager, chat_a, "http-a"),
            exercise(&manager, chat_b, "http-a"),
            exercise(&manager, chat_a, "http-b"),
        );
    })
    .await
    .unwrap();
    for marker in ["error", "silent", "retry", "burst"] {
        let (tx, mut rx) = unbounded_channel();
        let mut params = CallToolRequestParams::default();
        params.name = "read_file".into();
        params.arguments = json!({"marker": marker}).as_object().cloned();
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            manager.call_tool_with_progress(
                chat_a,
                "http-b",
                params,
                &McpRequestAuthContext::default(),
                Some(tx),
            ),
        )
        .await
        .unwrap();
        assert_eq!(result.is_err(), marker == "error");
        let mut updates = Vec::new();
        while let Some(update) = rx.recv().await {
            updates.push(update);
        }
        assert_eq!(
            updates.len(),
            if matches!(marker, "retry" | "burst") {
                3
            } else {
                0
            }
        );
    }
    for session in manager.sessions.read().await.values() {
        assert!(!session._service.service().has_active_calls());
    }
    server.abort();
}

#[tokio::test]
#[ignore = "requires mock-mcp-server; set MCP_PROGRESS_TEST_URL to its /mcp/progress endpoint"]
async fn existing_progress_mock_delivers_three_updates_before_result() {
    let mut config = AppConfig::default();
    let mut server = super::tests::server_config(None, vec![]);
    server.url = std::env::var("MCP_PROGRESS_TEST_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:44321/mcp/progress".into());
    config.mcp_servers.insert("progress".into(), server);
    let manager = McpSessionManager::new(&config);
    let (tx, mut rx) = unbounded_channel();
    let mut params = CallToolRequestParams::default();
    params.name = "read_file".into();
    params.arguments = json!({"path":"docs/readme.txt"}).as_object().cloned();
    let auth = McpRequestAuthContext::default();
    let call = manager.call_tool_with_progress(Uuid::new_v4(), "progress", params, &auth, Some(tx));
    tokio::pin!(call);
    tokio::time::timeout(Duration::from_secs(30), async {
        for step in 1..=3 {
            let update = tokio::select! {
                update = rx.recv() => update.unwrap(),
                result = &mut call => panic!("mock completed before progress {step}: {result:?}"),
            };
            assert_eq!(update.progress, f64::from(step));
            assert_eq!(update.total, Some(3.0));
            assert_eq!(update.message, Some(format!("Reading file step {step}/3")));
        }
        let result = call.await.unwrap();
        assert!(
            serde_json::to_string(&result)
                .unwrap()
                .contains("This is a mock README file.")
        );
    })
    .await
    .unwrap();
    assert!(rx.recv().await.is_none());
}
