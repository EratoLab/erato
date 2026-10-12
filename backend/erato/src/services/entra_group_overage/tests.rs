use super::*;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{Json, Router, extract::Query, http::HeaderMap, routing::get};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

const ISSUER: &str = "https://login.microsoftonline.com/tenant/v2.0";
const TOKEN: &str = "graph-access-token";

fn claims() -> Value {
    json!({"iss": ISSUER, "sub": "user", "oid": "USER-ID", "_claim_names": {"groups": "src1"}})
}

struct GraphServer {
    base: String,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for GraphServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn graph_server(router: Router) -> GraphServer {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1.0", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    GraphServer { base, task }
}

#[tokio::test]
async fn resolves_all_pages_and_directory_object_types_for_verified_identity() {
    let calls = Arc::new(AtomicUsize::new(0));
    let router = Router::new()
        .route("/v1.0/me", get({
            let calls = calls.clone();
            move |headers: HeaderMap, Query(query): Query<HashMap<String, String>>| {
                calls.fetch_add(1, Ordering::SeqCst);
                async move {
                    assert_eq!(headers["authorization"], "Bearer graph-access-token");
                    assert_eq!(query["$select"], "id");
                    Json(json!({"id": "user-id"}))
                }
            }
        }))
        .route("/v1.0/me/transitiveMemberOf", get({
            let calls = calls.clone();
            move |headers: HeaderMap, Query(query): Query<HashMap<String, String>>| {
                calls.fetch_add(1, Ordering::SeqCst);
                async move {
                    assert_eq!(headers["authorization"], "Bearer graph-access-token");
                    assert_eq!(headers["consistencylevel"], "eventual");
                    if query.contains_key("$skiptoken") {
                        Json(json!({"value": [{"id": "group"}, {"id": "administrative-unit", "@odata.type": "#microsoft.graph.administrativeUnit"}]}))
                    } else {
                        assert_eq!(query["$select"], "id");
                        assert_eq!(query["$top"], "100");
                        Json(json!({
                            "value": [{"id": "group", "@odata.type": "#microsoft.graph.group"}, {"id": "role", "@odata.type": "#microsoft.graph.directoryRole"}],
                            "@odata.nextLink": format!("http://{}/v1.0/me/transitiveMemberOf?$skiptoken=next", headers["host"].to_str().unwrap())
                        }))
                    }
                }
            }
        }));
    let server = graph_server(router).await;
    let resolver = EntraGroupOverageResolver::with_graph_base_url(&server.base).unwrap();
    let expected = vec!["group", "role", "administrative-unit"];
    assert_eq!(
        resolver.resolve_groups(&claims(), Some(TOKEN)).await,
        expected
    );
    let mut implicit_flow = claims();
    implicit_flow
        .as_object_mut()
        .unwrap()
        .remove("_claim_names");
    implicit_flow["hasgroups"] = json!(true);
    assert_eq!(
        resolver.resolve_groups(&implicit_flow, Some(TOKEN)).await,
        expected
    );
    assert_eq!(
        resolver.resolve_groups(&claims(), Some(TOKEN)).await,
        expected
    );
    assert_eq!(calls.load(Ordering::SeqCst), 3, "success should be cached");
}

#[tokio::test]
async fn mismatch_never_fetches_memberships() {
    let membership_calls = Arc::new(AtomicUsize::new(0));
    let server = graph_server(
        Router::new()
            .route(
                "/v1.0/me",
                get(|| async { Json(json!({"id": "different-user"})) }),
            )
            .route(
                "/v1.0/me/transitiveMemberOf",
                get({
                    let calls = membership_calls.clone();
                    move || {
                        calls.fetch_add(1, Ordering::SeqCst);
                        async { Json(json!({"value": [{"id": "premium"}]})) }
                    }
                }),
            ),
    )
    .await;
    let resolver = EntraGroupOverageResolver::with_graph_base_url(&server.base).unwrap();
    assert!(
        resolver
            .resolve_groups(&claims(), Some(TOKEN))
            .await
            .is_empty()
    );
    assert_eq!(membership_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn rejects_incomplete_failed_and_unsafe_membership_responses() {
    let leaked_tokens = Arc::new(AtomicUsize::new(0));
    let receiver = graph_server(Router::new().fallback({
        let calls = leaked_tokens.clone();
        move || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { StatusCode::OK }
        }
    }))
    .await;
    for (status, body) in [
        (StatusCode::FORBIDDEN, "{}".to_owned()),
        (StatusCode::TOO_MANY_REQUESTS, "{}".to_owned()),
        (StatusCode::OK, "not json".to_owned()),
        (StatusCode::OK, "{}".to_owned()),
        (StatusCode::OK, json!({"value": [{"id": null}]}).to_string()),
        (StatusCode::OK, json!({"value": [{"id": ""}]}).to_string()),
        (StatusCode::OK, json!({"value": [{"id": "premium"}], "@odata.nextLink": format!("{}/me/transitiveMemberOf", receiver.base)}).to_string()),
        (StatusCode::OK, " ".repeat(MAX_GRAPH_BYTES + 1)),
    ] {
        let server = graph_server(Router::new()
            .route("/v1.0/me", get(|| async { Json(json!({"id": "user-id"})) }))
            .route("/v1.0/me/transitiveMemberOf", get(move || {
                let body = body.clone(); async move { (status, body) }
            }))).await;
        let resolver = EntraGroupOverageResolver::with_graph_base_url(&server.base).unwrap();
        assert!(resolver.resolve_groups(&claims(), Some(TOKEN)).await.is_empty());
    }
    // A redirect must not carry the bearer token to another origin either.
    let location = format!("{}/me/transitiveMemberOf", receiver.base);
    let server = graph_server(Router::new().route(
        "/v1.0/me",
        get(move || {
            let location = location.clone();
            async move { (StatusCode::TEMPORARY_REDIRECT, [("location", location)]) }
        }),
    ))
    .await;
    let resolver = EntraGroupOverageResolver::with_graph_base_url(&server.base).unwrap();
    assert!(
        resolver
            .resolve_groups(&claims(), Some(TOKEN))
            .await
            .is_empty()
    );
    assert_eq!(leaked_tokens.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_later_page_failure_discards_earlier_memberships() {
    let server = graph_server(Router::new()
        .route("/v1.0/me", get(|| async { Json(json!({"id": "user-id"})) }))
        .route("/v1.0/me/transitiveMemberOf", get(|headers: HeaderMap, Query(query): Query<HashMap<String, String>>| async move {
            if query.contains_key("$skiptoken") {
                StatusCode::SERVICE_UNAVAILABLE.into_response()
            } else {
                Json(json!({"value": [{"id": "premium"}], "@odata.nextLink": format!("http://{}/v1.0/me/transitiveMemberOf?$skiptoken=next", headers["host"].to_str().unwrap())})).into_response()
            }
        }))).await;
    let resolver = EntraGroupOverageResolver::with_graph_base_url(&server.base).unwrap();
    assert!(
        resolver
            .resolve_groups(&claims(), Some(TOKEN))
            .await
            .is_empty()
    );
}

#[tokio::test]
async fn repeated_pagination_link_fails_without_repeating_requests() {
    let calls = Arc::new(AtomicUsize::new(0));
    let server = graph_server(Router::new()
        .route("/v1.0/me", get(|| async { Json(json!({"id": "user-id"})) }))
        .route("/v1.0/me/transitiveMemberOf", get({
            let calls = calls.clone();
            move |headers: HeaderMap| {
                calls.fetch_add(1, Ordering::SeqCst);
                async move { Json(json!({"value": [{"id": "premium"}], "@odata.nextLink": format!("http://{}/v1.0/me/transitiveMemberOf?$select=id&$top=100", headers["host"].to_str().unwrap())})) }
            }
        }))).await;
    let resolver = EntraGroupOverageResolver::with_graph_base_url(&server.base).unwrap();
    assert!(
        resolver
            .resolve_groups(&claims(), Some(TOKEN))
            .await
            .is_empty()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn only_native_global_entra_issuers_are_eligible() {
    for (issuer, expected) in [
        (ISSUER, true),
        ("https://sts.windows.net/tenant/", true),
        ("http://login.microsoftonline.com/tenant/v2.0", false),
        ("https://login.microsoftonline.com:444/tenant/v2.0", false),
        ("https://login.microsoftonline.com/tenant/v2.0/extra", false),
        (
            "https://login.microsoftonline.com/tenant/v2.0?redirect=other",
            false,
        ),
        (
            "https://login.microsoftonline.com.evil.example/tenant/v2.0",
            false,
        ),
        ("https://user@login.microsoftonline.com/tenant/v2.0", false),
        ("https://other-provider.example", false),
    ] {
        assert_eq!(is_entra_issuer(issuer), expected, "{issuer}");
    }
}

#[tokio::test]
async fn pagination_may_use_the_verified_user_but_not_other_users_or_paths() {
    for (path, allowed) in [
        ("users/USER-ID/transitiveMemberOf", true),
        ("users/different-user/transitiveMemberOf", false),
        ("me/messages", false),
    ] {
        let calls = Arc::new(AtomicUsize::new(0));
        let route = format!("/v1.0/{path}");
        let server = graph_server(Router::new()
            .route("/v1.0/me", get(|| async { Json(json!({"id": "user-id"})) }))
            .route("/v1.0/me/transitiveMemberOf", get(move |headers: HeaderMap| async move {
                Json(json!({"value": [{"id": "first"}], "@odata.nextLink": format!("http://{}/v1.0/{path}", headers["host"].to_str().unwrap())}))
            }))
            .route(&route, get({
                let calls = calls.clone();
                move || { calls.fetch_add(1, Ordering::SeqCst); async { Json(json!({"value": [{"id": "last"}]})) } }
            }))).await;
        let resolver = EntraGroupOverageResolver::with_graph_base_url(&server.base).unwrap();
        let groups = resolver.resolve_groups(&claims(), Some(TOKEN)).await;
        assert_eq!(!groups.is_empty(), allowed);
        assert_eq!(calls.load(Ordering::SeqCst), usize::from(allowed));
    }
}

#[tokio::test]
async fn combined_deadline_covers_identity_and_membership_calls() {
    let server = graph_server(
        Router::new()
            .route(
                "/v1.0/me",
                get(|| async {
                    tokio::time::sleep(Duration::from_millis(60)).await;
                    Json(json!({"id": "user-id"}))
                }),
            )
            .route(
                "/v1.0/me/transitiveMemberOf",
                get(|| async {
                    tokio::time::sleep(Duration::from_millis(60)).await;
                    Json(json!({"value": [{"id": "premium"}]}))
                }),
            ),
    )
    .await;
    let mut resolver = EntraGroupOverageResolver::with_graph_base_url(&server.base).unwrap();
    resolver.timeout = Duration::from_millis(100);
    assert!(
        resolver
            .resolve_groups(&claims(), Some(TOKEN))
            .await
            .is_empty()
    );
}

#[tokio::test]
async fn concurrent_misses_share_resolution_and_tokens_and_issuers_are_isolated() {
    let calls = Arc::new(AtomicUsize::new(0));
    let membership_calls = Arc::new(AtomicUsize::new(0));
    let server = graph_server(
        Router::new()
            .route(
                "/v1.0/me",
                get({
                    let calls = calls.clone();
                    move |headers: HeaderMap| {
                        calls.fetch_add(1, Ordering::SeqCst);
                        async move {
                            tokio::time::sleep(Duration::from_millis(20)).await;
                            let id = if headers["authorization"] == "Bearer different-token" {
                                "other-user"
                            } else {
                                "user-id"
                            };
                            Json(json!({"id": id}))
                        }
                    }
                }),
            )
            .route(
                "/v1.0/me/transitiveMemberOf",
                get({
                    let calls = membership_calls.clone();
                    move || {
                        calls.fetch_add(1, Ordering::SeqCst);
                        async { Json(json!({"value": [{"id": "premium"}]})) }
                    }
                }),
            ),
    )
    .await;
    let resolver = EntraGroupOverageResolver::with_graph_base_url(&server.base).unwrap();
    let claims = claims();
    let results =
        futures::future::join_all((0..8).map(|_| resolver.resolve_groups(&claims, Some(TOKEN))))
            .await;
    assert!(results.iter().all(|groups| groups == &["premium"]));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(membership_calls.load(Ordering::SeqCst), 1);
    assert!(
        resolver
            .resolve_groups(&claims, Some("different-token"))
            .await
            .is_empty()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(membership_calls.load(Ordering::SeqCst), 1);
    let mut other_issuer = claims.clone();
    other_issuer["iss"] = json!("https://login.microsoftonline.com/other-tenant/v2.0");
    assert_eq!(
        resolver.resolve_groups(&other_issuer, Some(TOKEN)).await,
        ["premium"]
    );
    assert_eq!(calls.load(Ordering::SeqCst), 3);

    for (mut claims, token) in [
        (claims.clone(), None),
        (claims.clone(), Some("")),
        (claims.clone(), Some(TOKEN)),
    ] {
        if token == Some(TOKEN) {
            claims.as_object_mut().unwrap().remove("oid");
        }
        assert!(resolver.resolve_groups(&claims, token).await.is_empty());
    }
    let mut ordinary = claims.clone();
    ordinary.as_object_mut().unwrap().remove("_claim_names");
    ordinary["groups"] = json!(["claim-group"]);
    assert!(
        resolver
            .resolve_groups(&ordinary, Some(TOKEN))
            .await
            .is_empty()
    );
    let mut non_entra = claims.clone();
    non_entra["iss"] = json!("https://login.microsoftonline.com.evil.example/tenant/v2.0");
    assert!(
        resolver
            .resolve_groups(&non_entra, Some(TOKEN))
            .await
            .is_empty()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    resolver.cache.run_pending_tasks().await;
    assert_eq!(resolver.cache.entry_count(), 3);
}

#[tokio::test]
async fn failure_cooldown_expires_before_a_successful_empty_result() {
    let calls = Arc::new(AtomicUsize::new(0));
    let server = graph_server(
        Router::new()
            .route(
                "/v1.0/me",
                get({
                    let calls = calls.clone();
                    move |headers: HeaderMap| {
                        let attempt = calls.fetch_add(1, Ordering::SeqCst);
                        async move {
                            if headers["authorization"] == "Bearer initially-failing-token"
                                && attempt == 0
                            {
                                StatusCode::SERVICE_UNAVAILABLE.into_response()
                            } else {
                                Json(json!({"id": "user-id"})).into_response()
                            }
                        }
                    }
                }),
            )
            .route(
                "/v1.0/me/transitiveMemberOf",
                get(|| async { Json(json!({"value": []})) }),
            ),
    )
    .await;
    let mut resolver = EntraGroupOverageResolver::with_graph_base_url(&server.base).unwrap();
    resolver.cache = membership_cache(Duration::from_millis(500), Duration::from_millis(50));
    let claims = claims();
    assert!(
        resolver
            .resolve_groups(&claims, Some("initially-failing-token"))
            .await
            .is_empty()
    );
    assert!(
        resolver
            .resolve_groups(&claims, Some("initially-failing-token"))
            .await
            .is_empty()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(
        resolver
            .resolve_groups(&claims, Some(TOKEN))
            .await
            .is_empty()
    );
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert!(
        resolver
            .resolve_groups(&claims, Some(TOKEN))
            .await
            .is_empty()
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        2,
        "successful empty result retains the longer TTL"
    );
    assert!(
        resolver
            .resolve_groups(&claims, Some("initially-failing-token"))
            .await
            .is_empty()
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        3,
        "failure must retry after cooldown"
    );
    tokio::time::sleep(Duration::from_millis(510)).await;
    assert!(
        resolver
            .resolve_groups(&claims, Some(TOKEN))
            .await
            .is_empty()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 4, "success must expire too");
}

#[tokio::test]
async fn failed_resolution_logs_once_without_identity_token_or_response_body() {
    use std::io::Write;
    use std::sync::Mutex;
    use tracing::instrument::WithSubscriber;

    #[derive(Clone)]
    struct Capture(Arc<Mutex<Vec<u8>>>);
    impl Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let server = graph_server(Router::new().fallback(|| async {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": {"code": "graph-access-token USER-ID premium"}})),
        )
    }))
    .await;
    let resolver = EntraGroupOverageResolver::with_graph_base_url(&server.base).unwrap();
    let output = Arc::new(Mutex::new(Vec::new()));
    let sink = Capture(output.clone());
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .without_time()
        .with_max_level(tracing::Level::WARN)
        .with_writer(move || sink.clone())
        .finish();
    async {
        assert!(
            resolver
                .resolve_groups(&claims(), Some(TOKEN))
                .await
                .is_empty()
        );
        assert!(
            resolver
                .resolve_groups(&claims(), Some(TOKEN))
                .await
                .is_empty()
        );
    }
    .with_subscriber(subscriber)
    .await;
    let log = String::from_utf8(output.lock().unwrap().clone()).unwrap();
    assert_eq!(
        log.matches("Failed to resolve Entra group overage").count(),
        1
    );
    assert!(log.contains("503"));
    for secret in [TOKEN, "USER-ID", "premium", ISSUER] {
        assert!(!log.contains(secret));
    }
}
