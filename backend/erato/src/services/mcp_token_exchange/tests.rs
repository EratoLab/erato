use super::*;
use crate::config::McpServerAuthenticationConfig;
use crate::services::mcp_transports::apply_auth_headers;
use axum::{
    Form, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

struct Wire {
    requests: Mutex<Vec<(String, HashMap<String, String>)>>,
    body: Mutex<Value>,
    status: StatusCode,
    delay: Duration,
}
struct Sts {
    wire: Arc<Wire>,
    url: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Sts {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn receive(
    State(wire): State<Arc<Wire>>,
    headers: HeaderMap,
    Form(form): Form<HashMap<String, String>>,
) -> Response {
    wire.requests
        .lock()
        .unwrap()
        .push((headers["authorization"].to_str().unwrap().to_owned(), form));
    tokio::time::sleep(wire.delay).await;
    (wire.status, Json(wire.body.lock().unwrap().clone())).into_response()
}
async fn sts(body: Value, status: StatusCode, delay: Duration) -> Sts {
    let wire = Arc::new(Wire {
        requests: Mutex::new(Vec::new()),
        body: Mutex::new(body),
        status,
        delay,
    });
    let app = Router::new()
        .route("/token", post(receive))
        .with_state(wire.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/token", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Sts { wire, url, task }
}
fn jwt(expiry: SystemTime) -> String {
    let exp = expiry.duration_since(UNIX_EPOCH).unwrap().as_secs();
    format!(
        "e30.{}.signature",
        URL_SAFE_NO_PAD.encode(json!({"exp":exp}).to_string())
    )
}
fn response() -> Value {
    // Observed STS envelope: refresh_expires_in is present without a refresh_token.
    // These extra fields must not change token selection or imply a refresh flow.
    json!({"access_token":"sts-access", "id_token":jwt(SystemTime::now() + Duration::from_secs(600)),
        "expires_in":600, "token_type":"Bearer", "scope":"openid target-api-audience",
        "refresh_expires_in":1800, "not-before-policy":0, "session_state":"session-placeholder"})
}
fn config(url: &str, input: &str, output: &str) -> McpServerConfig {
    let mut value = json!({"transport_type":"streamable_http", "url":"http://127.0.0.1/mcp",
    "authentication":{"mode":"forwarded", "forwarded":{"credential":output,
        "header_name":"x-target-auth", "prefix":"Token ", "custom_token_exchange":{
        "enabled":true,"token_endpoint":url,"grant_type":"urn:test:external-jwt",
        "client_id":"entra-client","client_secret":"client-secret","scope":"openid target", "subject_credential":input
    }}}});
    if input.is_empty() {
        value["authentication"]["forwarded"]["custom_token_exchange"]
            .as_object_mut()
            .unwrap()
            .remove("subject_credential");
    }
    serde_json::from_value(value).unwrap()
}
fn forwarded(server: &McpServerConfig) -> &McpServerForwardedAuthenticationConfig {
    let McpServerAuthenticationConfig::Forwarded { forwarded } = &server.authentication else {
        panic!()
    };
    forwarded
}
fn auth() -> McpRequestAuthContext<'static> {
    McpRequestAuthContext {
        user_id: Some(Uuid::new_v4()),
        access_token: Some("entra-access"),
        oidc_token: Some("entra-id"),
        ..Default::default()
    }
}

#[tokio::test]
async fn all_input_output_combinations_and_aliases_use_exact_protocol() {
    for input in ["", "access_token", "oidc_id_token", "oidc_token"] {
        for output in ["access_token", "oidc_id_token", "oidc_token"] {
            let body = response();
            let sts = sts(body.clone(), StatusCode::OK, Duration::ZERO).await;
            let server = config(&sts.url, input, output);
            let mut headers = HeaderMap::new();
            assert!(
                apply_auth_headers(&mut headers, "normal", &server, &auth())
                    .await
                    .unwrap()
                    .is_some()
            );
            let expected = if output == "access_token" {
                body["access_token"].as_str().unwrap()
            } else {
                body["id_token"].as_str().unwrap()
            };
            assert_eq!(headers["x-target-auth"], format!("Token {expected}"));
            assert!(headers["x-target-auth"].is_sensitive());
            let requests = sts.wire.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            use base64::engine::general_purpose::STANDARD;
            assert_eq!(
                requests[0].0,
                format!("Basic {}", STANDARD.encode("entra-client:client-secret"))
            );
            assert_eq!(
                requests[0].1,
                HashMap::from([
                    ("grant_type".into(), "urn:test:external-jwt".into()),
                    ("subject_issuer".into(), "entra".into()),
                    (
                        "subject_token".into(),
                        if input.is_empty() || input == "access_token" {
                            "entra-access"
                        } else {
                            "entra-id"
                        }
                        .into()
                    ),
                    ("scope".into(), "openid target".into()),
                ])
            );
        }
    }
}

#[tokio::test]
async fn missing_and_expired_subjects_never_fall_back_or_contact_sts() {
    let sts = sts(response(), StatusCode::OK, Duration::ZERO).await;
    for input in ["access_token", "oidc_id_token"] {
        for output in ["access_token", "oidc_id_token"] {
            let server = config(&sts.url, input, output);
            for expired in [false, true] {
                let mut auth = auth();
                let past = SystemTime::now() - Duration::from_secs(1);
                if input == "access_token" {
                    if expired {
                        auth.access_token_expires_at = Some(past);
                    } else {
                        auth.access_token = None;
                    }
                } else if expired {
                    auth.oidc_token_expires_at = Some(past);
                } else {
                    auth.oidc_token = None;
                }
                let mut headers = HeaderMap::new();
                assert!(
                    apply_auth_headers(&mut headers, "normal", &server, &auth)
                        .await
                        .is_err()
                );
                assert!(headers.is_empty());
            }
        }
    }
    assert!(sts.wire.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invalid_selected_outputs_and_rejections_fail_closed() {
    for output in ["access_token", "oidc_id_token"] {
        let selected = if output == "access_token" {
            "access_token"
        } else {
            "id_token"
        };
        let mut missing = response();
        missing.as_object_mut().unwrap().remove(selected);
        let mut empty = response();
        empty[selected] = json!("");
        let mut whitespace = response();
        whitespace[selected] = json!("invalid token");
        let mut wrong_type = response();
        wrong_type[selected] = json!({"token":"invalid"});
        let mut expired = response();
        expired[selected] = json!(jwt(SystemTime::now() - Duration::from_secs(60)));
        let mut no_expiry = response();
        no_expiry[selected] = json!("opaque");
        no_expiry.as_object_mut().unwrap().remove("expires_in");
        for (body, status) in [
            (missing, StatusCode::OK),
            (empty, StatusCode::OK),
            (whitespace, StatusCode::OK),
            (wrong_type, StatusCode::OK),
            (expired, StatusCode::OK),
            (no_expiry, StatusCode::OK),
            (json!("malformed"), StatusCode::OK),
            (response(), StatusCode::BAD_REQUEST),
            (response(), StatusCode::UNAUTHORIZED),
        ] {
            let sts = sts(body, status, Duration::ZERO).await;
            let server = config(&sts.url, "access_token", output);
            let mut headers = HeaderMap::new();
            let error = apply_auth_headers(&mut headers, "normal", &server, &auth())
                .await
                .unwrap_err();
            assert!(headers.is_empty());
            for secret in ["client-secret", "entra-access", "sts-access", "signature"] {
                assert!(!format!("{error:?}").contains(secret));
            }
        }
    }
}

#[tokio::test]
async fn disabled_exchange_preserves_direct_forwarding_independently() {
    let sts = sts(response(), StatusCode::OK, Duration::ZERO).await;
    let normal = config(&sts.url, "access_token", "oidc_id_token");
    let mut admin = normal.clone();
    let McpServerAuthenticationConfig::Forwarded { forwarded } = &mut admin.authentication else {
        panic!()
    };
    forwarded.custom_token_exchange.as_mut().unwrap().enabled = false;
    let auth = auth();
    let mut headers = HeaderMap::new();
    assert!(
        apply_auth_headers(&mut headers, "admin", &admin, &auth)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(headers["x-target-auth"], "Token entra-id");
    assert!(sts.wire.requests.lock().unwrap().is_empty());
    apply_auth_headers(&mut headers, "normal", &normal, &auth)
        .await
        .unwrap();
    assert_ne!(headers["x-target-auth"], "Token entra-id");
    assert_eq!(sts.wire.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn cache_coalesces_and_isolates_user_target_source_and_selection() {
    let sts = sts(response(), StatusCode::OK, Duration::from_millis(20)).await;
    let server = config(&sts.url, "access_token", "access_token");
    let auth = auth();
    let results = futures::future::join_all(
        (0..20).map(|_| resolve("normal", &server, forwarded(&server), &auth)),
    )
    .await;
    let first = results[0].as_ref().ok().unwrap().generation;
    assert!(
        results
            .iter()
            .all(|result| result.as_ref().ok().unwrap().generation == first)
    );
    assert_eq!(sts.wire.requests.lock().unwrap().len(), 1);
    let another_user = McpRequestAuthContext {
        user_id: Some(Uuid::new_v4()),
        ..auth
    };
    let rotated = McpRequestAuthContext {
        access_token: Some("rotated"),
        ..auth
    };
    for (target, context) in [
        ("admin", auth),
        ("normal", another_user),
        ("normal", rotated),
    ] {
        assert_ne!(
            resolve(target, &server, forwarded(&server), &context)
                .await
                .unwrap()
                .generation,
            first
        );
    }
    for (input, output) in [
        ("oidc_id_token", "access_token"),
        ("access_token", "oidc_id_token"),
    ] {
        let server = config(&sts.url, input, output);
        assert_ne!(
            resolve("normal", &server, forwarded(&server), &auth)
                .await
                .unwrap()
                .generation,
            first
        );
    }
    assert_eq!(sts.wire.requests.lock().unwrap().len(), 6);
}

#[tokio::test]
async fn selected_expiry_and_source_expiry_bound_reuse() {
    let mut body = response();
    body["id_token"] = json!(jwt(SystemTime::now() + Duration::from_secs(60)));
    let sts = sts(body, StatusCode::OK, Duration::ZERO).await;
    let server = config(&sts.url, "access_token", "oidc_id_token");
    let context = auth();
    let token = resolve("normal", &server, forwarded(&server), &context)
        .await
        .unwrap();
    assert!(token.usable_until.duration_since(Instant::now()) < Duration::from_secs(46));
    let context = McpRequestAuthContext {
        access_token_expires_at: Some(SystemTime::now() + Duration::from_secs(30)),
        ..context
    };
    let token = resolve("normal", &server, forwarded(&server), &context)
        .await
        .unwrap();
    assert!(token.usable_until.duration_since(Instant::now()) < Duration::from_secs(16));
    // Exercise the same cache expiry policy without a wall-clock minute-long test.
    let cache = Cache::builder().expire_after(TokenExpiry).build();
    let mut short = token.clone();
    short.usable_until = Instant::now() + Duration::from_millis(20);
    cache.insert([0; 32], short).await;
    assert!(cache.get(&[0; 32]).await.is_some());
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(cache.get(&[0; 32]).await.is_none());
}

#[tokio::test]
async fn timeout_and_redirect_do_not_yield_credentials() {
    let slow = sts(
        response(),
        StatusCode::OK,
        REQUEST_TIMEOUT + Duration::from_secs(1),
    )
    .await;
    let server = config(&slow.url, "access_token", "access_token");
    // Without the configured timeout this server would return a valid token.
    assert!(
        resolve("normal", &server, forwarded(&server), &auth())
            .await
            .is_err()
    );

    let hits = Arc::new(AtomicUsize::new(0));
    let observed = hits.clone();
    let app = Router::new()
        .route(
            "/token",
            post(|| async { (StatusCode::TEMPORARY_REDIRECT, [("location", "/leak")]) }),
        )
        .route(
            "/leak",
            post(move || async move {
                observed.fetch_add(1, Ordering::SeqCst);
                Json(response())
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/token", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let server = config(&url, "access_token", "access_token");
    assert!(
        resolve("normal", &server, forwarded(&server), &auth())
            .await
            .is_err()
    );
    task.abort();
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn mcp_sessions_rebuild_after_exchange_refresh_and_never_send_on_failure() {
    use crate::config::{AppConfig, McpProtocolMode};
    use crate::services::mcp_session_manager::McpSessionManager;
    use rmcp::model::CallToolRequestParams;

    let seen = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
    let recorded = seen.clone();
    let app = Router::new().route("/mcp", post(move |headers: HeaderMap, Json(request): Json<Value>| {
        let recorded = recorded.clone();
        async move {
            let method = request["method"].as_str().unwrap().to_owned();
            recorded.lock().unwrap().push((method.clone(), headers["x-target-auth"].to_str().unwrap().to_owned()));
            if request.get("id").is_none() { return StatusCode::ACCEPTED.into_response(); }
            let result = match method.as_str() {
                "initialize" => json!({"protocolVersion":request["params"]["protocolVersion"], "capabilities":{"tools":{}}, "serverInfo":{"name":"exchange-test", "version":"1"}}),
                "tools/list" => json!({"tools":[{"name":"probe", "inputSchema":{"type":"object"}}]}),
                "tools/call" => json!({"content":[{"type":"text", "text":"ok"}]}),
                _ => panic!("unexpected MCP method"),
            };
            Json(json!({"jsonrpc":"2.0", "id":request["id"], "result":result})).into_response()
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/mcp", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let sts = sts(response(), StatusCode::OK, Duration::ZERO).await;
    let mut server = config(&sts.url, "access_token", "access_token");
    server.url = url;
    server.protocol_mode = McpProtocolMode::Legacy;
    let mut app = AppConfig::default();
    app.mcp_servers.insert("normal".into(), server.clone());
    let manager = McpSessionManager::new(&app);
    let context = auth();
    let chat = Uuid::new_v4();
    let call = || {
        let mut params = CallToolRequestParams::default();
        params.name = "probe".into();
        params
    };
    manager
        .call_tool(chat, "normal", call(), &context)
        .await
        .unwrap();
    manager
        .call_tool(chat, "normal", call(), &context)
        .await
        .unwrap();
    assert_eq!(
        seen.lock()
            .unwrap()
            .iter()
            .filter(|(method, _)| method == "initialize")
            .count(),
        1
    );
    let initial = resolve("normal", &server, forwarded(&server), &context)
        .await
        .unwrap();
    // Expire just this cached exchange, using the production expiry policy.
    TOKENS.run_pending_tasks().await;
    let key = TOKENS
        .iter()
        .find(|(_, value)| value.generation == initial.generation)
        .unwrap()
        .0;
    let mut expired = initial.clone();
    expired.usable_until = Instant::now();
    TOKENS.invalidate(key.as_ref()).await;
    TOKENS.insert(*key, expired).await;
    sts.wire.body.lock().unwrap()["access_token"] = json!("sts-refreshed");
    manager
        .call_tool(chat, "normal", call(), &context)
        .await
        .unwrap();
    assert_eq!(
        seen.lock()
            .unwrap()
            .iter()
            .filter(|(method, _)| method == "initialize")
            .count(),
        2
    );
    assert_eq!(
        seen.lock().unwrap().last().unwrap().1,
        "Token sts-refreshed"
    );
    let count = seen.lock().unwrap().len();
    let missing = McpRequestAuthContext {
        access_token: None,
        ..context
    };
    assert!(
        manager
            .call_tool(chat, "normal", call(), &missing)
            .await
            .is_err()
    );
    let expired = McpRequestAuthContext {
        access_token_expires_at: Some(UNIX_EPOCH),
        ..context
    };
    assert!(
        manager
            .call_tool(chat, "normal", call(), &expired)
            .await
            .is_err()
    );
    // A rotated source forces another exchange; invalid STS output must not reuse the old session.
    sts.wire
        .body
        .lock()
        .unwrap()
        .as_object_mut()
        .unwrap()
        .remove("access_token");
    let rotated = McpRequestAuthContext {
        access_token: Some("rotated-invalid"),
        ..context
    };
    assert!(
        manager
            .call_tool(chat, "normal", call(), &rotated)
            .await
            .is_err()
    );
    assert_eq!(seen.lock().unwrap().len(), count);
    task.abort();
}

#[tokio::test]
async fn stateless_catalogs_stay_isolated_even_when_sts_returns_identical_tokens() {
    use crate::services::mcp_stateless::HttpServer;
    let lists = Arc::new(AtomicUsize::new(0));
    let observed = lists.clone();
    let app = Router::new().route("/mcp", post(move |headers: HeaderMap, Json(request): Json<Value>| {
        let observed = observed.clone();
        async move {
            assert_eq!(headers["x-target-auth"], "Token sts-access");
            assert_eq!(request["method"], "tools/list");
            observed.fetch_add(1, Ordering::SeqCst);
            Json(json!({"jsonrpc":"2.0", "id":request["id"], "result":{"tools":[], "ttlMs":60000, "cacheScope":"private"}}))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/mcp", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let sts = sts(response(), StatusCode::OK, Duration::ZERO).await;
    let mut server = config(&sts.url, "access_token", "access_token");
    server.url = url;
    let runtime = Arc::new(HttpServer::new(server).unwrap());
    let first = auth();
    let second = auth();
    for context in [
        first,
        first,
        second,
        second,
        McpRequestAuthContext {
            access_token: Some("rotated"),
            ..first
        },
    ] {
        runtime
            .request_context("normal", &context)
            .await
            .unwrap()
            .tool_list(false)
            .await
            .unwrap();
    }
    assert_eq!(lists.load(Ordering::SeqCst), 3);
    assert_eq!(sts.wire.requests.lock().unwrap().len(), 3);
    task.abort();
}

#[tokio::test]
async fn observed_sts_envelope_keeps_output_audiences_claims_and_lifetimes_distinct() {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let token = |claims: Value| {
        format!(
            "e30.{}.signature",
            URL_SAFE_NO_PAD.encode(claims.to_string())
        )
    };
    let access = token(
        json!({"exp":now + 300, "iat":now, "iss":"https://sts.example.com/realms/example",
        "aud":"target-api", "sub":"user", "groups":["operators"], "custom_permission":"run"}),
    );
    let id = token(
        json!({"exp":now + 90, "iat":now, "iss":"https://sts.example.com/realms/example",
        "aud":"exchange-client-id", "sub":"user", "jti":"id", "typ":"ID", "azp":"exchange-client-id",
        "sid":"session", "at_hash":"access-token-hash"}),
    );
    let body = json!({"access_token":access, "expires_in":300, "token_type":"Bearer", "id_token":id,
        "scope":"openid target-api-audience", "refresh_expires_in":1800, "not-before-policy":0,
        "session_state":"session-placeholder", "unknown_extension":{"ignored":true}});
    assert!(body.get("refresh_token").is_none());
    let sts = sts(body, StatusCode::OK, Duration::ZERO).await;
    let context = auth();
    for (output, expected, lifetime) in [("access_token", access, 300), ("oidc_id_token", id, 90)] {
        let server = config(&sts.url, "", output);
        let exchanged = resolve("normal", &server, forwarded(&server), &context)
            .await
            .unwrap();
        assert_eq!(&*exchanged.token, expected);
        let remaining = exchanged.usable_until.duration_since(Instant::now());
        assert!(remaining <= Duration::from_secs(lifetime) - REFRESH_MARGIN);
        assert!(remaining > Duration::from_secs(lifetime - 20));
        let mut headers = HeaderMap::new();
        apply_auth_headers(&mut headers, "normal", &server, &context)
            .await
            .unwrap();
        assert_eq!(headers["x-target-auth"], format!("Token {expected}"));
    }
    assert_eq!(sts.wire.requests.lock().unwrap().len(), 2);
    assert_eq!(context.access_token, Some("entra-access"));
    assert_eq!(context.oidc_token, Some("entra-id"));
}
