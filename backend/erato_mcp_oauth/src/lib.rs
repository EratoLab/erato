//! Resource compatibility for rmcp 3.2.0, using only its public APIs.
//!
//! PRM is obtained from the configured MCP endpoint, never from the API resource
//! identifier. The HTTP adapter presents the endpoint as PRM's resource to rmcp's
//! endpoint-matching validator, while retaining the real identifier separately.
//! Only that field is adapted: SDK discovery, issuer checks, PKCE, credential
//! storage, refresh coordination, and token parsing remain in use.
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use futures::StreamExt;
use http::{
    HeaderMap, Method, StatusCode,
    header::{CONTENT_LENGTH, CONTENT_TYPE},
};
use reqwest::{Client, Url};
use rmcp::transport::auth::{
    AuthError, AuthorizationManager as SdkAuthorizationManager, AuthorizationMetadata,
    AuthorizationMetadataResolution, CredentialStore, OAuthClientConfig, OAuthHttpClient,
    OAuthHttpClientError, OAuthHttpClientFuture, OAuthHttpRedirectPolicy, OAuthHttpRequest,
    OAuthTokenResponse, StateStore,
};
use serde_json::Value;
use url::form_urlencoded;

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Default)]
struct Discovery {
    resource: Option<String>,
    token_endpoint: Option<Url>,
}

struct ResourceHttpClient {
    endpoint: Url,
    resource_override: Option<String>,
    discovery: Mutex<Discovery>,
    follow_redirects: Client,
    stop_redirects: Client,
}

impl ResourceHttpClient {
    fn resource(&self) -> Option<String> {
        if let Some(resource) = &self.resource_override {
            return (!resource.is_empty()).then(|| resource.clone());
        }
        if let Some(resource) = &self
            .discovery
            .lock()
            .expect("OAuth discovery lock")
            .resource
        {
            return Some(resource.clone());
        }
        Some(self.fallback_resource())
    }

    fn fallback_resource(&self) -> String {
        let mut endpoint = self.endpoint.clone();
        endpoint.set_query(None);
        endpoint.set_fragment(None);
        endpoint.to_string()
    }

    fn adapt_token_request(&self, request: &mut http::Request<Vec<u8>>) {
        let is_token_endpoint = self
            .discovery
            .lock()
            .expect("OAuth discovery lock")
            .token_endpoint
            .as_ref()
            .is_some_and(|url| url.as_str() == request.uri());
        let is_form = request
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value.split(';').next() == Some("application/x-www-form-urlencoded")
            });
        if request.method() != Method::POST || !is_token_endpoint || !is_form {
            return;
        }
        let body = replace_resource(request.body(), self.resource().as_deref());
        *request.body_mut() = body.into_bytes();
        request.headers_mut().remove(CONTENT_LENGTH);
    }

    fn adapt_metadata(&self, url: &Url, body: &mut Vec<u8>) -> Result<(), OAuthHttpClientError> {
        // rmcp only accepts same-origin PRM discovery URLs. Never adapt an AS
        // document or a document obtained from another origin.
        if url.origin() != self.endpoint.origin() {
            return Ok(());
        }
        let Ok(Value::Object(mut metadata)) = serde_json::from_slice::<Value>(body) else {
            return Ok(());
        };
        let is_prm = metadata.contains_key("resource")
            || metadata
                .get("authorization_servers")
                .is_some_and(Value::is_array)
            || metadata
                .get("authorization_server")
                .is_some_and(Value::is_string);
        if !is_prm
            || metadata.contains_key("authorization_endpoint")
            || metadata.contains_key("token_endpoint")
        {
            return Ok(());
        }
        if self.resource_override.is_none() {
            let resource = match metadata.get("resource") {
                None | Some(Value::Null) => None,
                Some(Value::String(resource)) => {
                    validate_resource(resource)?;
                    Some(resource.clone())
                }
                Some(_) => return Err("PRM resource must be a string".into()),
            };
            self.discovery
                .lock()
                .expect("OAuth discovery lock")
                .resource = resource;
        }
        metadata.insert("resource".into(), Value::String(self.fallback_resource()));
        *body = serde_json::to_vec(&metadata)?;
        Ok(())
    }
}

impl OAuthHttpClient for ResourceHttpClient {
    fn execute(&self, mut operation: OAuthHttpRequest) -> OAuthHttpClientFuture<'_> {
        Box::pin(async move {
            self.adapt_token_request(&mut operation.request);
            let method = operation.request.method().clone();
            let url = Url::parse(&operation.request.uri().to_string())?;
            let client = match operation.redirect_policy {
                OAuthHttpRedirectPolicy::Follow => &self.follow_redirects,
                // Fail closed for future redirect-policy variants.
                _ => &self.stop_redirects,
            };
            let mut request = reqwest::Request::try_from(operation.request)?;
            *request.timeout_mut() = operation.timeout;
            let response = client.execute(request).await?;
            let mut builder = http::Response::builder()
                .status(response.status())
                .version(response.version());
            for (name, value) in response.headers() {
                builder = builder.header(name, value);
            }
            let status = response.status();
            let mut body = Vec::new();
            let mut chunks = response.bytes_stream();
            while let Some(chunk) = chunks.next().await {
                let chunk = chunk?;
                if chunk.len() > MAX_RESPONSE_BYTES - body.len() {
                    return Err("OAuth HTTP response exceeds 1 MiB".into());
                }
                body.extend_from_slice(&chunk);
            }
            if method == Method::GET && status == StatusCode::OK {
                self.adapt_metadata(&url, &mut body)?;
                // The in-memory body may have changed; do not retain its wire size.
                builder
                    .headers_mut()
                    .expect("valid response headers")
                    .remove(CONTENT_LENGTH);
            }
            Ok(builder.body(body)?)
        })
    }
}

fn validate_resource(resource: &str) -> Result<(), AuthError> {
    let url = Url::parse(resource)
        .map_err(|_| AuthError::MetadataError("OAuth resource must be an absolute URI".into()))?;
    if resource
        .chars()
        .any(|ch| ch.is_whitespace() || ch.is_control())
        || url.fragment().is_some()
    {
        return Err(AuthError::MetadataError(
            "OAuth resource must not contain whitespace, controls, or a fragment".into(),
        ));
    }
    Ok(())
}

fn replace_resource(encoded: &[u8], resource: Option<&str>) -> String {
    let mut serializer = form_urlencoded::Serializer::new(String::new());
    for (key, value) in form_urlencoded::parse(encoded) {
        if key != "resource" {
            serializer.append_pair(&key, &value);
        }
    }
    if let Some(resource) = resource {
        serializer.append_pair("resource", resource);
    }
    serializer.finish()
}

/// rmcp authorization with consistent automatic/override/omitted resource selection.
/// Only Erato's supported operations are exposed, so callers cannot bypass the
/// authorization URL adapter or replace the compatibility HTTP client.
pub struct AuthorizationManager {
    sdk: SdkAuthorizationManager,
    http: Arc<ResourceHttpClient>,
}

impl AuthorizationManager {
    /// None selects PRM with endpoint fallback; Some("") omits the parameter.
    /// Other strings override the identifier verbatim. Headers apply to discovery,
    /// registration, code exchange and refresh, using identical client settings.
    pub async fn new(
        endpoint: &str,
        resource: Option<String>,
        headers: HeaderMap,
    ) -> Result<Self, AuthError> {
        if let Some(resource) = resource.as_deref().filter(|value| !value.is_empty()) {
            validate_resource(resource)?;
        }
        let build_client = |redirect| {
            Client::builder()
                .default_headers(headers.clone())
                .timeout(Duration::from_secs(30))
                .redirect(redirect)
                .build()
        };
        let http = Arc::new(ResourceHttpClient {
            endpoint: Url::parse(endpoint)?,
            resource_override: resource,
            discovery: Mutex::default(),
            follow_redirects: build_client(reqwest::redirect::Policy::limited(10))?,
            stop_redirects: build_client(reqwest::redirect::Policy::none())?,
        });
        let sdk =
            SdkAuthorizationManager::new_with_oauth_http_client(endpoint, http.clone()).await?;
        Ok(Self { sdk, http })
    }

    pub async fn resolve_metadata(&self) -> Result<AuthorizationMetadataResolution, AuthError> {
        self.http
            .discovery
            .lock()
            .expect("OAuth discovery lock")
            .resource = None;
        self.sdk.resolve_metadata().await
    }

    pub fn set_metadata(&mut self, metadata: AuthorizationMetadata) {
        self.http
            .discovery
            .lock()
            .expect("OAuth discovery lock")
            .token_endpoint = Url::parse(&metadata.token_endpoint).ok();
        self.sdk.set_metadata(metadata);
    }

    pub fn configure_client(&mut self, config: OAuthClientConfig) -> Result<(), AuthError> {
        self.sdk.configure_client(config)
    }

    pub fn set_credential_store<S: CredentialStore + 'static>(&mut self, store: S) {
        self.sdk.set_credential_store(store);
    }
    pub fn set_state_store<S: StateStore + 'static>(&mut self, store: S) {
        self.sdk.set_state_store(store);
    }

    pub async fn register_client(
        &mut self,
        name: &str,
        redirect_uri: &str,
        scopes: &[&str],
    ) -> Result<OAuthClientConfig, AuthError> {
        self.sdk.register_client(name, redirect_uri, scopes).await
    }

    pub fn select_scopes(&self, challenge: Option<&str>, defaults: &[&str]) -> Vec<String> {
        self.sdk.select_scopes(challenge, defaults)
    }

    pub async fn get_access_token(&self) -> Result<String, AuthError> {
        self.sdk.get_access_token().await
    }

    pub async fn refresh_token(&self) -> Result<OAuthTokenResponse, AuthError> {
        self.sdk.refresh_token().await
    }

    pub async fn exchange_code_for_token(
        &self,
        code: &str,
        state: &str,
    ) -> Result<OAuthTokenResponse, AuthError> {
        self.exchange_code_for_token_with_issuer(code, state, None)
            .await
    }

    pub async fn exchange_code_for_token_with_issuer(
        &self,
        code: &str,
        state: &str,
        issuer: Option<&str>,
    ) -> Result<OAuthTokenResponse, AuthError> {
        self.sdk
            .exchange_code_for_token_with_issuer(code, state, issuer)
            .await
    }

    pub async fn get_authorization_url(&self, scopes: &[&str]) -> Result<String, AuthError> {
        let mut url = Url::parse(&self.sdk.get_authorization_url(scopes).await?)?;
        let query = replace_resource(
            url.query().unwrap_or_default().as_bytes(),
            self.http.resource().as_deref(),
        );
        url.set_query(Some(&query));
        Ok(url.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> ResourceHttpClient {
        ResourceHttpClient {
            endpoint: Url::parse("https://mcp.example.com/mcp?transport=streamable").unwrap(),
            resource_override: Some("https://api.example.com/".into()),
            discovery: Mutex::new(Discovery {
                resource: None,
                token_endpoint: Some(Url::parse("https://login.example.com/token").unwrap()),
            }),
            follow_redirects: Client::new(),
            stop_redirects: Client::new(),
        }
    }

    #[test]
    fn replacing_resource_preserves_state_pkce_and_repeated_parameters() {
        let query =
            "resource=old&state=a%2Bb%26c&code_challenge=abc&scope=read&scope=write&resource=other";
        for selected in [None, Some("https://api.example.com/?a=b&c=d")] {
            let result = replace_resource(query.as_bytes(), selected);
            let pairs = form_urlencoded::parse(result.as_bytes())
                .into_owned()
                .collect::<Vec<_>>();
            assert_eq!(
                pairs.iter().filter(|(key, _)| key == "resource").count(),
                usize::from(selected.is_some())
            );
            assert!(pairs.contains(&("state".into(), "a+b&c".into())));
            assert!(pairs.contains(&("code_challenge".into(), "abc".into())));
            assert_eq!(pairs.iter().filter(|(key, _)| key == "scope").count(), 2);
            assert_eq!(
                pairs
                    .iter()
                    .find(|(key, _)| key == "resource")
                    .map(|(_, value)| value.as_str()),
                selected
            );
        }
    }

    #[test]
    fn only_form_posts_to_the_discovered_token_endpoint_are_adapted() {
        let client = client();
        for (uri, content_type, expected) in [
            (
                "https://login.example.com/register",
                "application/x-www-form-urlencoded",
                false,
            ),
            ("https://login.example.com/token", "application/json", false),
            (
                "https://login.example.com/token",
                "application/x-www-form-urlencoded",
                true,
            ),
        ] {
            let original = b"resource=old&code=a%2Bb&grant_type=authorization_code".to_vec();
            let mut request = http::Request::builder()
                .method("POST")
                .uri(uri)
                .header(CONTENT_TYPE, content_type)
                .header(CONTENT_LENGTH, original.len())
                .body(original.clone())
                .unwrap();
            client.adapt_token_request(&mut request);
            assert_eq!(request.body() != &original, expected);
            assert_eq!(request.headers().contains_key(CONTENT_LENGTH), !expected);
        }
    }

    #[test]
    fn authorization_metadata_and_other_origins_are_not_rewritten() {
        let client = client();
        for (url, document) in [
            (
                "https://mcp.example.com/.well-known/oauth-authorization-server",
                serde_json::json!({
                    "issuer": "https://login.example.com", "authorization_endpoint": "https://login.example.com/authorize",
                    "authorization_servers": ["https://login.example.com"], "resource": "https://other.example.com"
                }),
            ),
            (
                "https://other.example.com/prm",
                serde_json::json!({
                    "authorization_servers": ["https://login.example.com"], "resource": "https://other.example.com"
                }),
            ),
        ] {
            let original = serde_json::to_vec(&document).unwrap();
            let mut body = original.clone();
            client
                .adapt_metadata(&Url::parse(url).unwrap(), &mut body)
                .unwrap();
            assert_eq!(body, original);
        }
    }
}
