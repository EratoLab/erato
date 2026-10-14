use super::*;
use crate::config::{AppConfig, McpRuntimeConfig};
use crate::services::mcp_session_manager::{McpServerConnectionStatus, McpSessionManager};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response, Sse, sse::Event},
    routing::post,
};
use sea_orm::prelude::Uuid;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, AtomicUsize, Ordering};

#[derive(Default)]
struct Wire {
    calls: AtomicUsize,
    lists: AtomicUsize,
    discoveries: AtomicUsize,
    public: AtomicBool,
    ttl: AtomicU64,
    status: AtomicU16,
    discovery_status: AtomicU16,
    discovery_code: AtomicU64,
    paginated: AtomicBool,
    active: AtomicUsize,
}

async fn wire(
    State(state): State<Arc<Wire>>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Response {
    assert_eq!(headers["mcp-protocol-version"], VERSION);
    assert_eq!(headers["mcp-method"], request["method"].as_str().unwrap());
    assert_eq!(
        request["params"]["_meta"]["io.modelcontextprotocol/protocolVersion"],
        VERSION
    );
    assert_eq!(
        request["params"]["_meta"]["io.modelcontextprotocol/clientCapabilities"],
        json!({})
    );
    assert!(!headers.contains_key("mcp-session-id"));
    assert!(!headers.contains_key("last-event-id"));
    let result = match request["method"].as_str().unwrap() {
        "server/discover" => {
            state.discoveries.fetch_add(1, Ordering::SeqCst);
            let status = state.discovery_status.load(Ordering::SeqCst);
            if status != 0 {
                let code = state.discovery_code.load(Ordering::SeqCst) as i64;
                return (StatusCode::from_u16(status).unwrap(), Json(json!({"jsonrpc":"2.0", "id": request["id"], "error":{"code":-code, "message":"rejected"}}))).into_response();
            }
            json!({"resultType":"complete", "supportedVersions":[VERSION], "capabilities":{"tools":{}}, "ttlMs":30_000, "cacheScope":"private"})
        }
        "tools/list" => {
            state.lists.fetch_add(1, Ordering::SeqCst);
            let status = state.status.load(Ordering::SeqCst);
            if status != 0 {
                return (StatusCode::from_u16(status).unwrap(), "fixture unavailable")
                    .into_response();
            }
            let name = if request["params"].get("cursor").is_some() {
                "second"
            } else {
                "read_file"
            };
            let mut result = json!({"resultType":"complete", "tools":[{"name":name, "inputSchema":{"type":"object", "properties":{"nested":{"type":"object", "properties":{"region":{"type":"string", "x-mcp-header":"Region"}}}}}}]});
            if state.ttl.load(Ordering::SeqCst) != u64::MAX {
                result["ttlMs"] = json!(state.ttl.load(Ordering::SeqCst));
            }
            result["cacheScope"] = json!(if state.public.load(Ordering::SeqCst) {
                "public"
            } else {
                "private"
            });
            if state.paginated.load(Ordering::SeqCst) && name == "read_file" {
                result["nextCursor"] = json!("page2");
            }
            result
        }
        "tools/call" => {
            state.calls.fetch_add(1, Ordering::SeqCst);
            assert_eq!(headers["mcp-name"], "read_file");
            // rmcp's parameter-header schema cache belongs to the transport.
            assert!(!headers.contains_key("mcp-param-region"));
            let progress = json!({"jsonrpc":"2.0", "method":"notifications/progress", "params":{"progressToken":request["params"]["_meta"]["progressToken"], "progress":1, "total":2}});
            let result = json!({"jsonrpc":"2.0", "id":request["id"], "result":{"resultType":"complete", "content":[{"type":"text","text":"done"}]}});
            let marker = request["params"]["arguments"]["marker"]
                .as_str()
                .unwrap_or("");
            if marker == "broken" {
                return Sse::new(futures::stream::iter(vec![
                    Ok::<_, std::convert::Infallible>(Event::default().data(progress.to_string())),
                ]))
                .into_response();
            }
            if marker == "pending" {
                struct Active(Arc<Wire>);
                impl Drop for Active {
                    fn drop(&mut self) {
                        self.0.active.fetch_sub(1, Ordering::SeqCst);
                    }
                }
                state.active.fetch_add(1, Ordering::SeqCst);
                let stream = futures::stream::unfold(
                    (Some(progress), Active(state.clone())),
                    |(first, guard)| async move {
                        if let Some(first) = first {
                            Some((
                                Ok::<_, std::convert::Infallible>(
                                    Event::default().data(first.to_string()),
                                ),
                                (None, guard),
                            ))
                        } else {
                            std::future::pending().await
                        }
                    },
                );
                return Sse::new(stream).into_response();
            }
            return Sse::new(futures::stream::iter(vec![
                Ok::<_, std::convert::Infallible>(Event::default().data(progress.to_string())),
                Ok(Event::default().data(result.to_string())),
            ]))
            .into_response();
        }
        other => panic!("Unexpected modern method: {other}"),
    };
    Json(json!({"jsonrpc":"2.0", "id":request["id"], "result":result})).into_response()
}

struct Server {
    url: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn serve(app: Router) -> Server {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Server { url, task }
}
fn config(url: &str) -> McpServerConfig {
    serde_json::from_value(json!({"transport_type":"streamable_http", "url":url})).unwrap()
}
fn manager(config: McpServerConfig) -> McpSessionManager {
    let mut app = AppConfig::default();
    app.mcp_servers.insert("files".into(), config);
    McpSessionManager::new(&app)
}
fn call_params(marker: &str) -> CallToolRequestParams {
    let mut params = CallToolRequestParams::default();
    params.name = "read_file".into();
    params.arguments = json!({"marker":marker, "nested":{"region":"ümlaut"}})
        .as_object()
        .cloned();
    params
}
async fn fixture() -> (Arc<Wire>, Server, Arc<HttpServer>) {
    let wire = Arc::new(Wire::default());
    wire.ttl.store(30_000, Ordering::SeqCst);
    let server = serve(
        Router::new()
            .route("/", post(self::wire))
            .with_state(wire.clone()),
    )
    .await;
    let runtime = Arc::new(HttpServer::new(config(&server.url)).unwrap());
    (wire, server, runtime)
}
async fn context(runtime: &Arc<HttpServer>, token: &str) -> HttpRequest {
    let auth = McpRequestAuthContext {
        access_token: Some(token),
        ..Default::default()
    };
    runtime.request_context("files", &auth).await.unwrap()
}
fn forwarded_config(url: &str) -> McpServerConfig {
    serde_json::from_value(json!({"transport_type":"streamable_http", "url":url,
        "authentication":{"mode":"forwarded", "forwarded":{"credential":"access_token"}}}))
    .unwrap()
}

#[tokio::test]
async fn modern_calls_keep_no_sessions_with_rmcp_startup_progress_limits() {
    let (wire, server, _) = fixture().await;
    let manager = manager(config(&server.url));
    for _ in 0..2 {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let result = manager
            .call_tool_with_progress(
                Uuid::new_v4(),
                "files",
                call_params(""),
                &Default::default(),
                Some(tx),
            )
            .await
            .unwrap();
        assert_eq!(result.content.len(), 1);
        assert!(rx.recv().await.is_none());
        assert_eq!(manager.active_session_count("files").await, 0);
    }
    assert_eq!(wire.discoveries.load(Ordering::SeqCst), 1);
    assert_eq!(wire.lists.load(Ordering::SeqCst), 1);
    assert_eq!(wire.calls.load(Ordering::SeqCst), 2);
    assert_eq!(
        manager.probe_connection("files", &Default::default()).await,
        McpServerConnectionStatus::Success
    );
    assert_eq!(
        wire.lists.load(Ordering::SeqCst),
        2,
        "probes must make a live request"
    );
}

#[tokio::test]
async fn public_lists_share_across_credentials_but_private_lists_do_not() {
    for public in [true, false] {
        let (wire, server, _) = fixture().await;
        wire.public.store(public, Ordering::SeqCst);
        let runtime = Arc::new(HttpServer::new(forwarded_config(&server.url)).unwrap());
        let first = context(&runtime, "first").await;
        let second = context(&runtime, "second").await;
        first.list_tools(false).await.unwrap();
        second.list_tools(false).await.unwrap();
        assert_eq!(
            wire.lists.load(Ordering::SeqCst),
            if public { 1 } else { 2 }
        );
        assert!(
            runtime
                .request_context("files", &Default::default())
                .await
                .is_err(),
            "public cache must not bypass credential resolution"
        );
    }
}

#[tokio::test]
async fn ttl_default_zero_expiry_and_failures_do_not_poison_catalogs() {
    let (wire, _server, runtime) = fixture().await;
    wire.ttl.store(u64::MAX, Ordering::SeqCst);
    let request = context(&runtime, "").await;
    request.list_tools(false).await.unwrap();
    let expires = request
        .partition
        .lock()
        .await
        .tools
        .as_ref()
        .unwrap()
        .expires;
    assert!(
        (Duration::from_secs(29)..=DEFAULT_TTL).contains(&expires.duration_since(Instant::now()))
    );
    wire.status.store(500, Ordering::SeqCst);
    assert!(request.list_tools(true).await.is_err());
    assert_eq!(
        request.list_tools(false).await.unwrap().len(),
        1,
        "still-fresh cache survives refresh failure"
    );
    request
        .partition
        .lock()
        .await
        .tools
        .as_mut()
        .unwrap()
        .expires = Instant::now();
    assert!(
        request.list_tools(false).await.is_err(),
        "expired metadata must not be served on error"
    );
    assert_eq!(
        request
            .partition
            .lock()
            .await
            .tools
            .as_ref()
            .unwrap()
            .tools
            .len(),
        1
    );
    wire.status.store(0, Ordering::SeqCst);
    request.list_tools(true).await.unwrap();
    wire.ttl.store(0, Ordering::SeqCst);
    request.list_tools(true).await.unwrap();
    let before = wire.lists.load(Ordering::SeqCst);
    request.list_tools(false).await.unwrap();
    request.list_tools(false).await.unwrap();
    assert_eq!(wire.lists.load(Ordering::SeqCst), before + 2);
}

#[tokio::test]
async fn paginated_catalogs_are_complete_and_concurrent_refreshes_coalesce() {
    let (wire, _server, runtime) = fixture().await;
    wire.paginated.store(true, Ordering::SeqCst);
    let requests = futures::future::join_all((0..12).map(|_| context(&runtime, ""))).await;
    let results = futures::future::join_all(requests.iter().map(|r| r.list_tools(false))).await;
    for result in results {
        assert_eq!(result.unwrap().len(), 2);
    }
    assert_eq!(wire.lists.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn auth_failures_cannot_be_hidden_by_public_cache() {
    let (wire, _server, runtime) = fixture().await;
    wire.public.store(true, Ordering::SeqCst);
    let request = context(&runtime, "").await;
    request.list_tools(false).await.unwrap();
    wire.status.store(401, Ordering::SeqCst);
    assert!(request.list_tools(true).await.is_err());
    assert!(request.list_tools(false).await.is_err());
    wire.status.store(0, Ordering::SeqCst);
    request.list_tools(false).await.unwrap();
}

#[tokio::test]
async fn modern_errors_and_rate_limits_never_select_legacy() {
    for (status, code) in [
        (400, 32022),
        (400, 32020),
        (401, 32600),
        (403, 32600),
        (429, 32600),
        (500, 32600),
        (401, 32601),
        (403, 32601),
        (429, 32601),
        (500, 32601),
    ] {
        let (wire, _server, runtime) = fixture().await;
        wire.discovery_status.store(status, Ordering::SeqCst);
        wire.discovery_code.store(code, Ordering::SeqCst);
        assert!(context(&runtime, "").await.is_stateless().await.is_err());
    }
}

#[tokio::test]
async fn discovery_accepts_legacy_http_validation_error_formats() {
    for status in [400, 404, 405, 415, 422] {
        for body in [
            "Expected initialize request",
            r#"{"detail":"Expected initialize request"}"#,
            r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid request"}}"#,
        ] {
            let server = serve(Router::new().route(
                "/",
                post(move || async move { (StatusCode::from_u16(status).unwrap(), body) }),
            ))
            .await;
            let runtime = Arc::new(HttpServer::new(config(&server.url)).unwrap());
            assert!(
                !context(&runtime, "").await.is_stateless().await.unwrap(),
                "{status}: {body}"
            );
        }
    }
}

#[tokio::test]
async fn discovery_negotiates_only_explicitly_supported_legacy_versions() {
    for (status, supported, legacy) in [
        (400, json!(["2024-11-05"]), true),
        (200, json!(["2025-03-26", "2025-06-18"]), true),
        (400, json!([VERSION, "2025-11-25"]), false),
        (400, json!(["2099-01-01"]), false),
        (400, Value::Null, false),
        (401, json!(["2024-11-05"]), false),
        (403, json!(["2024-11-05"]), false),
        (429, json!(["2024-11-05"]), false),
        (503, json!(["2024-11-05"]), false),
    ] {
        let server = serve(Router::new().route("/", post(move |Json(request): Json<Value>| {
            let supported = supported.clone();
            async move {
                (StatusCode::from_u16(status).unwrap(), Json(json!({
                    "jsonrpc":"2.0", "id":request["id"],
                    "error":{"code":-32022, "message":"Unsupported protocol version", "data":{"supported":supported}}
                })))
            }
        }))).await;
        let runtime = Arc::new(HttpServer::new(config(&server.url)).unwrap());
        let result = context(&runtime, "").await.is_stateless().await;
        if legacy {
            assert!(!result.unwrap());
        } else {
            let error = result.unwrap_err();
            assert_eq!(
                error.downcast_ref::<RequestError>().unwrap().status,
                Some(status)
            );
        }
    }
}

#[tokio::test]
async fn discovery_sse_errors_do_not_time_out_into_legacy() {
    for error in [false, true] {
        let server = serve(Router::new().route("/", post(move |Json(request): Json<Value>| async move {
            let message = if error {
                json!({"jsonrpc":"2.0", "id":request["id"], "error":{"code":-32020,"message":"Header mismatch"}})
            } else {
                json!({"jsonrpc":"2.0", "id":request["id"], "result":{"supportedVersions":[VERSION]}})
            };
            // Leave the stream open: discovery must finish on the response,
            // including errors, without waiting for the timeout and downgrading.
            Sse::new(futures::stream::once(async move {
                Ok::<_, std::convert::Infallible>(Event::default().data(message.to_string()))
            }).chain(futures::stream::pending()))
        }))).await;
        let runtime = Arc::new(HttpServer::new(config(&server.url)).unwrap());
        let result = tokio::time::timeout(Duration::from_secs(1), async {
            context(&runtime, "").await.is_stateless().await
        })
        .await
        .unwrap();
        if error {
            assert!(result.is_err());
        } else {
            assert!(result.unwrap());
        }
    }
}

#[tokio::test]
async fn unrelated_discovery_responses_are_not_legacy_evidence() {
    for status in [200, 400] {
        for result in [
            json!({"result":{"supportedVersions":[VERSION]}}),
            json!({"error":{"code":-32020,"message":"Header mismatch"}}),
        ] {
            let server = serve(Router::new().route(
                "/",
                post(move || {
                    let mut message = result.clone();
                    async move {
                        message["jsonrpc"] = json!("2.0");
                        message["id"] = json!("unrelated");
                        (StatusCode::from_u16(status).unwrap(), Json(message))
                    }
                }),
            ))
            .await;
            let runtime = Arc::new(HttpServer::new(config(&server.url)).unwrap());
            assert!(
                context(&runtime, "")
                    .await
                    .is_stateless()
                    .await
                    .unwrap_err()
                    .to_string()
                    .contains("Uncorrelated MCP response")
            );
        }
    }
    assert!(
        process_message(
            json!({"jsonrpc":"2.0", "id":"unrelated",
        "error":{"code":-32600,"message":"Invalid request"}}),
            "expected",
            None
        )
        .is_err()
    );
}

#[tokio::test]
async fn broken_tool_stream_is_not_replayed_and_cancellation_closes_only_its_request() {
    let (wire, _server, runtime) = fixture().await;
    let request = context(&runtime, "").await;
    assert!(
        request
            .call_tool(call_params("broken"), None)
            .await
            .is_err()
    );
    assert_eq!(wire.calls.load(Ordering::SeqCst), 1);
    let request = context(&runtime, "").await;
    let task = tokio::spawn(async move { request.call_tool(call_params("pending"), None).await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while wire.active.load(Ordering::SeqCst) == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let other = context(&runtime, "").await;
    other.call_tool(call_params(""), None).await.unwrap();
    task.abort();
    let _ = task.await;
    tokio::time::timeout(Duration::from_secs(2), async {
        while wire.active.load(Ordering::SeqCst) != 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn production_legacy_discovery_rejections_fall_back_to_working_sessions() {
    let discoveries = Arc::new(AtomicUsize::new(0));
    let versions = Arc::new(std::sync::Mutex::new(Vec::new()));
    let observed_discoveries = discoveries.clone();
    let observed_versions = versions.clone();
    let server = serve(mock_mcp_server::app().layer(axum::middleware::from_fn(
        move |request: axum::extract::Request, next: axum::middleware::Next| {
            let discoveries = observed_discoveries.clone();
            let versions = observed_versions.clone();
            async move {
                if request
                    .headers()
                    .get("mcp-method")
                    .is_some_and(|v| v == "server/discover")
                {
                    discoveries.fetch_add(1, Ordering::SeqCst);
                }
                if request.headers().contains_key("mcp-session-id") {
                    versions
                        .lock()
                        .unwrap()
                        .push(request.headers().get("mcp-protocol-version").cloned());
                }
                next.run(request).await
            }
        },
    )))
    .await;
    let mut failures = Vec::new();
    for rejection in ["415", "422", "version", "uncorrelated"] {
        let manager = manager(config(&format!(
            "{}/mcp/compat/{rejection}/file",
            server.url
        )));
        let chat = Uuid::new_v4();
        match manager.list_tools(chat, &Default::default()).await {
            Ok(tools) => assert!(!tools.is_empty(), "{rejection}"),
            Err(error) => {
                failures.push(format!("{rejection}: {error}"));
                continue;
            }
        }
        let mut params = call_params("");
        params.arguments = json!({"path":"docs/readme.txt"}).as_object().cloned();
        let result = manager
            .call_tool(chat, "files", params, &Default::default())
            .await
            .unwrap();
        assert!(!result.is_error.unwrap_or(false), "{rejection}");
        assert_eq!(
            manager.active_session_count("files").await,
            1,
            "{rejection}"
        );
        assert_eq!(
            manager.probe_connection("files", &Default::default()).await,
            McpServerConnectionStatus::Success,
            "{rejection}"
        );
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert_eq!(
        discoveries.load(Ordering::SeqCst),
        4,
        "cache the legacy selection across listing, calling and probing"
    );
    let versions = versions.lock().unwrap();
    assert!(!versions.is_empty());
    assert!(
        versions
            .iter()
            .all(|v| v.as_ref().is_some_and(|v| v == "2024-11-05")),
        "{versions:?}"
    );
}

#[tokio::test]
async fn real_mock_supports_both_protocols_and_forced_modes() {
    let server = serve(mock_mcp_server::app()).await;
    for (path, mode, sessions) in [
        ("legacy", McpProtocolMode::Auto, 1),
        ("legacy", McpProtocolMode::Legacy, 1),
        ("stateless", McpProtocolMode::Auto, 0),
        ("stateless", McpProtocolMode::Stateless, 0),
        ("dual", McpProtocolMode::Auto, 0),
        ("dual", McpProtocolMode::Legacy, 1),
    ] {
        let mut cfg = config(&format!("{}/mcp/{path}/file", server.url));
        cfg.protocol_mode = mode;
        let manager = manager(cfg);
        let chat = Uuid::new_v4();
        for _ in 0..2 {
            assert!(
                !manager
                    .list_tools(chat, &Default::default())
                    .await
                    .unwrap()
                    .is_empty()
            );
            let mut params = call_params("");
            params.arguments = json!({"path":"docs/readme.txt"}).as_object().cloned();
            manager
                .call_tool(chat, "files", params, &Default::default())
                .await
                .unwrap();
            assert_eq!(
                manager.active_session_count("files").await,
                sessions,
                "{path}, {mode:?}"
            );
        }
    }
    for (path, mode) in [
        ("legacy", McpProtocolMode::Stateless),
        ("stateless", McpProtocolMode::Legacy),
    ] {
        let mut cfg = config(&format!("{}/mcp/{path}/file", server.url));
        cfg.protocol_mode = mode;
        assert!(
            manager(cfg)
                .list_tools(Uuid::new_v4(), &Default::default())
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn reconfiguration_replaces_stateless_catalogs() {
    let (first, first_server, _) = fixture().await;
    let (second, second_server, _) = fixture().await;
    let manager = manager(config(&first_server.url));
    manager.enumerate_tools("files", &Default::default()).await;
    let mut app = AppConfig::default();
    app.mcp_servers
        .insert("files".into(), config(&second_server.url));
    manager
        .reconfigure(&McpRuntimeConfig::from_app_config(&app))
        .await;
    assert_eq!(
        manager
            .enumerate_tools("files", &Default::default())
            .await
            .status,
        McpServerConnectionStatus::Success
    );
    assert_eq!(first.lists.load(Ordering::SeqCst), 1);
    assert_eq!(second.lists.load(Ordering::SeqCst), 1);
    assert_eq!(manager.active_session_count("files").await, 0);
}

#[tokio::test]
async fn real_mock_authentication_and_sdk_progress_limits_in_both_eras() {
    let server = serve(mock_mcp_server::app()).await;
    for era in ["legacy", "stateless"] {
        let mut fixed = config(&format!("{}/mcp/{era}/auth-fixed", server.url));
        fixed.authentication = serde_json::from_value(
            json!({"mode":"fixed", "fixed":{"api_key":"fixed-api-key-secret"}}),
        )
        .unwrap();
        let good = manager(fixed.clone());
        assert_eq!(
            good.enumerate_tools("files", &Default::default())
                .await
                .status,
            McpServerConnectionStatus::Success
        );
        fixed.authentication =
            serde_json::from_value(json!({"mode":"fixed", "fixed":{"api_key":"wrong"}})).unwrap();
        assert_eq!(
            manager(fixed)
                .probe_connection("files", &Default::default())
                .await,
            McpServerConnectionStatus::NeedsAuthentication
        );

        let forwarded = manager(forwarded_config(&format!(
            "{}/mcp/{era}/auth-forwarded-access",
            server.url
        )));
        let auth = McpRequestAuthContext {
            access_token: Some("access:allowed-user"),
            ..Default::default()
        };
        assert!(
            !forwarded
                .enumerate_tools("files", &auth)
                .await
                .tools
                .is_empty()
        );
        let auth = McpRequestAuthContext {
            access_token: Some("access:denied-user"),
            ..Default::default()
        };
        assert!(
            forwarded
                .enumerate_tools("files", &auth)
                .await
                .tools
                .is_empty()
        );
        assert_eq!(
            forwarded
                .enumerate_tools("files", &Default::default())
                .await
                .status,
            McpServerConnectionStatus::NeedsAuthentication
        );

        let progress = manager(config(&format!("{}/mcp/{era}/progress", server.url)));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut params = CallToolRequestParams::new("read_file");
        params.arguments = json!({"path":"docs/readme.txt"}).as_object().cloned();
        progress
            .call_tool_with_progress(
                Uuid::new_v4(),
                "files",
                params,
                &Default::default(),
                Some(tx),
            )
            .await
            .unwrap();
        if era == "legacy" {
            for step in 1..=3 {
                assert_eq!(rx.recv().await.unwrap().progress, f64::from(step));
            }
        }
        assert!(rx.recv().await.is_none());
    }
}

#[tokio::test]
async fn annotation_overrides_and_reload_apply_to_both_protocols() {
    use crate::services::mcp_tool_annotations::McpToolAnnotationSource;

    let server = serve(mock_mcp_server::app()).await;
    for era in ["legacy", "stateless"] {
        let mut app = AppConfig::default();
        app.mcp_servers.insert(
            "files".into(),
            config(&format!("{}/mcp/{era}/file", server.url)),
        );
        app.mcp_servers_global
            .override_tool_annotations
            .read_only_hint = Some(false);
        let manager = McpSessionManager::new(&app);
        for expected in [false, true] {
            if expected {
                let mut next = McpRuntimeConfig::from_app_config(&app);
                next.mcp_servers_global
                    .override_tool_annotations
                    .read_only_hint = Some(true);
                assert_eq!(manager.reconfigure(&next).await, vec!["files"]);
            }
            let listed = manager.enumerate_tools("files", &Default::default()).await;
            assert_eq!(listed.status, McpServerConnectionStatus::Success);
            let tool = listed
                .tools
                .iter()
                .find(|t| t.tool.name == "read_file")
                .unwrap();
            assert_eq!(
                tool.tool.annotations.as_ref().unwrap().read_only_hint,
                Some(expected)
            );
            assert_eq!(
                tool.sources.read_only_hint,
                McpToolAnnotationSource::GlobalOverride
            );
            assert_eq!(
                tool.server_annotations.as_ref().unwrap().read_only_hint,
                Some(true)
            );
            let discovered = manager
                .list_tools(Uuid::new_v4(), &Default::default())
                .await
                .unwrap();
            let tool = discovered
                .iter()
                .find(|t| t.tool.name == "read_file")
                .unwrap();
            assert_eq!(
                tool.tool.annotations.as_ref().unwrap().read_only_hint,
                Some(expected)
            );
        }
    }
}

#[tokio::test]
async fn stateless_application_handles_survive_between_tool_calls() {
    let server = serve(mock_mcp_server::app()).await;
    let manager = manager(config(&format!(
        "{}/mcp/stateless/deep-research",
        server.url
    )));
    let mut params = CallToolRequestParams::new("deep_research_dispatch");
    params.arguments = json!({"query":"test research"}).as_object().cloned();
    let dispatched = manager
        .call_tool(Uuid::new_v4(), "files", params, &Default::default())
        .await
        .unwrap();
    let task = dispatched.structured_content.unwrap()["task_id"].clone();
    assert!(task.is_string());
    for expected in ["pending", "completed"] {
        let mut params = CallToolRequestParams::new("deep_research_poll");
        params.arguments = json!({"task_id":task}).as_object().cloned();
        let result = manager
            .call_tool(Uuid::new_v4(), "files", params, &Default::default())
            .await
            .unwrap();
        assert_eq!(result.structured_content.unwrap()["status"], expected);
        assert_eq!(manager.active_session_count("files").await, 0);
    }
}

#[tokio::test]
async fn memory_inspection_deduplicates_cached_schemas_and_reports_locked_partitions() {
    let server = Arc::new(HttpServer::new(config("http://unused.invalid/mcp")).unwrap());
    let baseline = erato_memory::measure(&server).capacity;
    let mut text = String::with_capacity(32 * 1024);
    text.push_str("schema payload");
    let mut schema = serde_json::Map::new();
    schema.insert("description".into(), Value::String(text));
    let schema = Arc::new(schema);
    let mut tool: Tool = serde_json::from_value(json!({
        "name": "memory_test", "inputSchema": {"type": "object"}
    }))
    .unwrap();
    tool.input_schema = schema.clone();
    let snapshot = Snapshot {
        tools: vec![tool],
        expires: Instant::now() + Duration::from_secs(60),
    };
    let partition = Arc::new(Mutex::new(Partition {
        tools: Some(snapshot.clone()),
        ..Default::default()
    }));
    server.partitions.lock().await.insert([0; 32], partition);
    *server.public_tools.lock().await = Some(snapshot);

    let mut context = erato_memory::Context::default();
    context.measure(&server);
    let with_caches = context.usage().capacity;
    assert!(with_caches >= baseline + 32 * 1024);
    context.measure(&schema);
    assert_eq!(context.usage().capacity, with_caches);
    let locked = server.partitions.lock().await;
    assert!(erato_memory::measure(&server).locked);
    drop(locked);
    assert!(!erato_memory::measure(&server).locked);

    server.partitions.lock().await.clear();
    *server.public_tools.lock().await = None;
    assert_eq!(erato_memory::measure(&server).capacity, baseline);
}

#[tokio::test]
async fn memory_request_inspection_tracks_detached_servers_without_retaining_them() {
    let secret = "header-secret-marker".repeat(1024);
    let mut settings = config("http://unused.invalid/mcp");
    settings.http_headers = Some(HashMap::from([("x-memory-token".into(), secret.clone())]));
    let server = Arc::new(HttpServer::new(settings).unwrap());
    let weak = Arc::downgrade(&server);
    let request = server
        .request_context("files", &Default::default())
        .await
        .unwrap();
    // The same traversal backs the production request's lifetime reservation.
    let usage = erato_memory::measure_owned(&request);
    assert!(usage.estimated >= secret.len());
    assert!(
        !serde_json::to_string(&usage)
            .unwrap()
            .contains("header-secret-marker")
    );
    drop(server);
    let roots = erato_memory::shared_roots(&mut erato_memory::Context::default());
    assert!(roots[std::any::type_name::<HttpServer>()].capacity >= secret.len());
    assert!(weak.upgrade().is_some());
    drop(request);
    assert!(weak.upgrade().is_none());
}
