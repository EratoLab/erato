use erato_mcp_oauth::AuthorizationManager;
use std::collections::HashMap;

use mock_mcp_server::oauth::{self, OAuthConfig, MCP_PATH, MISMATCH, RESOURCE, SCOPE};
use reqwest::{Client, StatusCode, Url};
use rmcp::{
    transport::{
        auth::{InMemoryCredentialStore, InMemoryStateStore, OAuthClientConfig},
        streamable_http_client::StreamableHttpClientTransportConfig,
        CredentialStore, StreamableHttpClientTransport,
    },
    ServiceExt,
};

type Params = HashMap<String, String>;

struct Fixture {
    base_url: String,
    endpoint: String,
    config: OAuthConfig,
    client: Client,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Fixture {
    async fn new(configure: impl FnOnce(&mut OAuthConfig)) -> Self {
        Self::with_router(configure, |router| router).await
    }

    async fn with_router(
        configure: impl FnOnce(&mut OAuthConfig),
        modify: impl FnOnce(axum::Router) -> axum::Router,
    ) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let mut config = OAuthConfig::entra(base_url.clone());
        configure(&mut config);
        let router = modify(oauth::router(config.clone()));
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self {
            endpoint: format!("{base_url}{MCP_PATH}?transport=streamable&tenant=test"),
            base_url,
            config,
            task,
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
        }
    }

    async fn manager(
        &self,
        resource: Option<&str>,
        credentials: &InMemoryCredentialStore,
        states: &InMemoryStateStore,
    ) -> AuthorizationManager {
        let mut manager = AuthorizationManager::new(
            &self.endpoint,
            resource.map(str::to_owned),
            reqwest::header::HeaderMap::from_iter([(
                reqwest::header::HeaderName::from_static("x-mcp-test"),
                reqwest::header::HeaderValue::from_static("configured-header"),
            )]),
        )
        .await
        .unwrap();
        manager.set_credential_store(credentials.clone());
        manager.set_state_store(states.clone());
        let metadata = manager.resolve_metadata().await.unwrap().metadata;
        manager.set_metadata(metadata);
        manager
            .configure_client(OAuthClientConfig::new(
                "mock-oauth-client",
                "http://localhost/callback",
            ))
            .unwrap();
        manager
    }

    async fn authorize(&self, manager: &AuthorizationManager) -> Params {
        let scopes = manager.select_scopes(None, &[]);
        assert_eq!(scopes, std::slice::from_ref(&self.config.scope));
        let url = manager
            .get_authorization_url(&scopes.iter().map(String::as_str).collect::<Vec<_>>())
            .await
            .unwrap();
        let params: Params = Url::parse(&url)
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect();
        assert_eq!(
            params.get("resource"),
            self.config.expected_resource.as_ref()
        );
        let response = self.client.get(url).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        Url::parse(response.headers()["location"].to_str().unwrap())
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect()
    }

    async fn call_mcp(&self, access_token: String) {
        let transport = StreamableHttpClientTransport::from_config(
            StreamableHttpClientTransportConfig::with_uri(self.endpoint.clone())
                .auth_header(access_token),
        );
        let service = ().serve(transport).await.unwrap();
        let result = service
            .call_tool(rmcp::model::CallToolRequestParams::new("list_files"))
            .await
            .unwrap();
        assert_ne!(result.is_error, Some(true));
        assert!(serde_json::to_string(&result)
            .unwrap()
            .contains("docs/readme.txt"));
        service.cancel().await.unwrap();
    }

    async fn round_trip(&self, resource: Option<&str>) {
        let credentials = InMemoryCredentialStore::new();
        let states = InMemoryStateStore::new();
        let start = self.manager(resource, &credentials, &states).await;
        let callback = self.authorize(&start).await;
        // Erato reconstructs the manager for callbacks and for subsequent MCP requests.
        let callback_manager = self.manager(resource, &credentials, &states).await;
        callback_manager
            .exchange_code_for_token(&callback["code"], &callback["state"])
            .await
            .unwrap();
        let access_token = callback_manager.get_access_token().await.unwrap();
        self.call_mcp(access_token.clone()).await;
        // Force expiry without wall-clock sleeps, then exercise get_access_token's refresh path.
        let mut stored = credentials.load().await.unwrap().unwrap();
        stored.token_received_at = Some(0);
        credentials.save(stored).await.unwrap();
        let refresh_manager = self.manager(resource, &credentials, &states).await;
        let refreshed = refresh_manager.get_access_token().await.unwrap();
        assert_ne!(refreshed, access_token);
        self.call_mcp(refreshed).await;
    }
}

#[tokio::test]
async fn prm_resource_supports_authorization_exchange_mcp_and_refresh() {
    let fixture = Fixture::new(|_| {}).await;
    fixture.round_trip(None).await;
}

#[tokio::test]
async fn endpoint_resource_reproduces_entra_error_at_every_oauth_stage() {
    let fixture = Fixture::new(|_| {}).await;
    let credentials = InMemoryCredentialStore::new();
    let states = InMemoryStateStore::new();
    let manager = fixture.manager(None, &credentials, &states).await;
    let good_url = manager.get_authorization_url(&[SCOPE]).await.unwrap();
    let mut bad_url = Url::parse(&good_url).unwrap();
    let mut params: Params = bad_url.query_pairs().into_owned().collect();
    params.insert("resource".into(), fixture.endpoint.clone());
    bad_url.query_pairs_mut().clear().extend_pairs(&params);
    let response = fixture.client.get(bad_url).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap()["error_description"],
        MISMATCH
    );

    let callback = fixture.authorize(&manager).await;
    // A resource mismatch must be caught before accepting a code or refresh grant.
    for grant_type in ["authorization_code", "refresh_token"] {
        let response = fixture
            .client
            .post(format!("{}/oauth/token", fixture.base_url))
            .form(&[
                ("grant_type", grant_type),
                ("resource", fixture.endpoint.as_str()),
                ("code", callback["code"].as_str()),
                ("client_id", "mock-oauth-client"),
            ])
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap()["error_description"],
            MISMATCH
        );
    }
    // Reproduce through the actual client as well, including a real issued refresh token.
    let bad_manager = fixture
        .manager(Some(&fixture.endpoint), &credentials, &states)
        .await;
    assert!(bad_manager
        .exchange_code_for_token(&callback["code"], &callback["state"])
        .await
        .is_err());
    let callback = fixture.authorize(&manager).await;
    manager
        .exchange_code_for_token(&callback["code"], &callback["state"])
        .await
        .unwrap();
    assert!(bad_manager.refresh_token().await.is_err());
    manager.refresh_token().await.unwrap();
}

#[tokio::test]
async fn explicit_override_takes_precedence_over_prm() {
    let fixture = Fixture::new(|config| {
        config.metadata_resource = Some("https://wrong.example.com".into());
    })
    .await;
    fixture.round_trip(Some(RESOURCE)).await;
}

#[tokio::test]
async fn explicit_omission_applies_to_all_stages_despite_prm() {
    let fixture = Fixture::new(|config| config.expected_resource = None).await;
    fixture.round_trip(Some("")).await;
}

#[tokio::test]
async fn absent_metadata_falls_back_to_endpoint_without_transport_query() {
    let fixture = Fixture::new(|config| {
        config.metadata_resource = None;
        let resource = format!("{}{MCP_PATH}", config.base_url);
        config.scope = format!("{resource}/Mcp.Read");
        config.expected_resource = Some(resource);
    })
    .await;
    fixture.round_trip(None).await;
}

#[tokio::test]
async fn override_and_omission_work_without_prm() {
    let fixture = Fixture::new(|config| config.metadata_resource = None).await;
    fixture.round_trip(Some(RESOURCE)).await;
    let fixture = Fixture::new(|config| {
        config.metadata_resource = None;
        config.expected_resource = None;
    })
    .await;
    fixture.round_trip(Some("")).await;
}

#[tokio::test]
async fn prm_resource_query_and_trailing_slash_are_preserved_verbatim() {
    for resource in [
        "https://api.example.com/",
        "https://api.example.com?audience=mcp",
        "api://application-id",
    ] {
        let fixture = Fixture::new(|config| {
            config.metadata_resource = Some(resource.into());
            config.expected_resource = Some(resource.into());
            config.scope = format!("{resource}/Mcp.Read");
        })
        .await;
        fixture.round_trip(None).await;
    }
}

#[tokio::test]
async fn matching_resource_path_ignores_transport_query() {
    let fixture = Fixture::new(|config| {
        let resource = format!("{}{MCP_PATH}", config.base_url);
        config.metadata_resource = Some(resource.clone());
        config.expected_resource = Some(resource.clone());
        config.scope = format!("{resource}/Mcp.Read");
    })
    .await;
    fixture.round_trip(None).await;
}

#[tokio::test]
async fn invalid_resource_is_rejected_unless_configuration_overrides_metadata() {
    for resource in [
        "relative/path",
        "https://api.example.com#fragment",
        "https://api.example.com/a b",
        "",
    ] {
        let fixture = Fixture::new(|config| config.metadata_resource = Some(resource.into())).await;
        let manager = AuthorizationManager::new(&fixture.endpoint, None, Default::default())
            .await
            .unwrap();
        assert!(manager.resolve_metadata().await.is_err());
        let manager =
            AuthorizationManager::new(&fixture.endpoint, Some(RESOURCE.into()), Default::default())
                .await
                .unwrap();
        manager.resolve_metadata().await.unwrap();
        if !resource.is_empty() {
            assert!(AuthorizationManager::new(
                &fixture.endpoint,
                Some(resource.into()),
                Default::default()
            )
            .await
            .is_err());
        }
    }
}

#[tokio::test]
async fn missing_prm_resource_field_uses_endpoint_fallback() {
    let fixture = Fixture::new(|config| {
        config.omit_resource_field = true;
        let resource = format!("{}{MCP_PATH}", config.base_url);
        config.expected_resource = Some(resource.clone());
        config.scope = format!("{resource}/Mcp.Read");
    })
    .await;
    fixture.round_trip(None).await;
}

#[tokio::test]
async fn callback_issuer_is_required_and_validated_before_consuming_state() {
    let fixture = Fixture::new(|config| config.require_issuer = true).await;
    let credentials = InMemoryCredentialStore::new();
    let states = InMemoryStateStore::new();
    let manager = fixture.manager(None, &credentials, &states).await;
    let callback = fixture.authorize(&manager).await;
    assert_eq!(callback["iss"], fixture.base_url);
    assert!(manager
        .exchange_code_for_token(&callback["code"], &callback["state"])
        .await
        .is_err());
    assert!(manager
        .exchange_code_for_token_with_issuer(
            &callback["code"],
            &callback["state"],
            Some("https://wrong.example.com")
        )
        .await
        .is_err());
    manager
        .exchange_code_for_token_with_issuer(
            &callback["code"],
            &callback["state"],
            Some(&callback["iss"]),
        )
        .await
        .unwrap();
    fixture
        .call_mcp(manager.get_access_token().await.unwrap())
        .await;
}

#[tokio::test]
async fn configured_headers_reach_discovery_exchange_and_refresh() {
    let fixture = Fixture::with_router(
        |_| {},
        |router| {
            router.layer(axum::middleware::from_fn(
                |request: axum::extract::Request, next: axum::middleware::Next| async move {
                    let path = request.uri().path();
                    if (path.starts_with("/.well-known/") || path == "/oauth/token")
                        && request
                            .headers()
                            .get("x-mcp-test")
                            .and_then(|v| v.to_str().ok())
                            != Some("configured-header")
                    {
                        return axum::response::IntoResponse::into_response(StatusCode::FORBIDDEN);
                    }
                    next.run(request).await
                },
            ))
        },
    )
    .await;
    fixture.round_trip(None).await;
}

#[tokio::test]
async fn discovery_cannot_redirect_to_another_origin() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    let requests = Arc::new(AtomicUsize::new(0));
    let count = requests.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}/metadata", listener.local_addr().unwrap());
    let target_router = axum::Router::new().route(
        "/metadata",
        axum::routing::get(move || {
            count.fetch_add(1, Ordering::SeqCst);
            async { "{}" }
        }),
    );
    let task = tokio::spawn(async move {
        axum::serve(listener, target_router).await.unwrap();
    });
    let fixture = Fixture::with_router(
        |_| {},
        |router| {
            router.layer(axum::middleware::from_fn(
                move |request: axum::extract::Request, next: axum::middleware::Next| {
                    let target = target.clone();
                    async move {
                        if request.uri().path() == "/.well-known/oauth-protected-resource" {
                            return axum::response::IntoResponse::into_response(
                                axum::response::Redirect::temporary(&target),
                            );
                        }
                        next.run(request).await
                    }
                },
            ))
        },
    )
    .await;
    let manager = AuthorizationManager::new(&fixture.endpoint, None, Default::default())
        .await
        .unwrap();
    let error = manager.resolve_metadata().await.unwrap_err();
    task.abort();
    assert!(error.to_string().contains("non-same-origin"), "{error}");
    assert_eq!(requests.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn token_redirects_are_not_followed() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    let requests = Arc::new(AtomicUsize::new(0));
    let count = requests.clone();
    let fixture = Fixture::with_router(
        |_| {},
        |router| {
            router
                .route(
                    "/token-target",
                    axum::routing::post(move || {
                        count.fetch_add(1, Ordering::SeqCst);
                        async { "{}" }
                    }),
                )
                .layer(axum::middleware::from_fn(
                    |request: axum::extract::Request, next: axum::middleware::Next| async move {
                        if request.uri().path() == "/oauth/token" {
                            return axum::response::IntoResponse::into_response(
                                axum::response::Redirect::temporary("/token-target"),
                            );
                        }
                        next.run(request).await
                    },
                ))
        },
    )
    .await;
    let manager = fixture
        .manager(
            None,
            &InMemoryCredentialStore::new(),
            &InMemoryStateStore::new(),
        )
        .await;
    let callback = fixture.authorize(&manager).await;
    assert!(manager
        .exchange_code_for_token(&callback["code"], &callback["state"])
        .await
        .is_err());
    assert_eq!(requests.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn dynamic_registration_retains_resource_compatibility() {
    let fixture = Fixture::new(|_| {}).await;
    let mut manager = AuthorizationManager::new(&fixture.endpoint, None, Default::default())
        .await
        .unwrap();
    let metadata = manager.resolve_metadata().await.unwrap().metadata;
    manager.set_metadata(metadata);
    manager
        .register_client("Erato test", "http://localhost/callback", &[SCOPE])
        .await
        .unwrap();
    let callback = fixture.authorize(&manager).await;
    manager
        .exchange_code_for_token(&callback["code"], &callback["state"])
        .await
        .unwrap();
    fixture
        .call_mcp(manager.get_access_token().await.unwrap())
        .await;
    manager.refresh_token().await.unwrap();
}
