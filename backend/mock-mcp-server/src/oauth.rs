//! Local OAuth fixture for ERMAIN-747. Never use these automatically approved grants in production.
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use axum::{
    extract::{Form, Query, State},
    http::{
        header::{AUTHORIZATION, WWW_AUTHENTICATE},
        StatusCode,
    },
    response::{IntoResponse, Redirect, Response},
    routing::{any, get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::json;
use sha2::{Digest, Sha256};
use tower::ServiceExt;
use url::Url;

pub const RESOURCE: &str = "https://api.example.com";
pub const SCOPE: &str = "https://api.example.com/Mcp.Read";
pub const MISMATCH: &str = "AADSTS9010010: The resource parameter provided in the request doesn't match with the requested scopes.";
pub const MCP_PATH: &str = "/mcp/oauth";

/// Configure metadata and Entra-like parameter validation independently to test overrides/fallback.
#[derive(Clone)]
pub struct OAuthConfig {
    pub base_url: String,
    /// None disables PRM discovery, leaving authorization-server metadata available.
    pub metadata_resource: Option<String>,
    /// Exact expected resource. None requires the parameter to be absent.
    pub expected_resource: Option<String>,
    pub scope: String,
    pub omit_resource_field: bool,
    pub require_issuer: bool,
}

impl OAuthConfig {
    pub fn entra(base_url: String) -> Self {
        Self {
            base_url,
            metadata_resource: Some(RESOURCE.into()),
            expected_resource: Some(RESOURCE.into()),
            scope: SCOPE.into(),
            omit_resource_field: false,
            require_issuer: false,
        }
    }
}

#[derive(Clone)]
struct Grant {
    client_id: String,
    redirect_uri: String,
    challenge: String,
    scope: String,
}

#[derive(Default)]
struct Grants {
    next_id: u64,
    codes: HashMap<String, Grant>,
    refresh_tokens: HashMap<String, Grant>,
    access_tokens: HashMap<String, Grant>,
}

impl Grants {
    fn id(&mut self, prefix: &str) -> String {
        self.next_id += 1;
        format!("{prefix}-{}", self.next_id)
    }
}

#[derive(Clone)]
struct OAuthState {
    config: OAuthConfig,
    grants: Arc<Mutex<Grants>>,
}

type Params = HashMap<String, String>;

fn error(code: &str, description: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error": code, "error_description": description})),
    )
        .into_response()
}

fn matches_resource(state: &OAuthState, params: &Params) -> bool {
    params.get("resource").map(String::as_str) == state.config.expected_resource.as_deref()
}

async fn metadata(State(state): State<OAuthState>) -> Json<serde_json::Value> {
    let base = &state.config.base_url;
    Json(json!({
        "issuer": base,
        "authorization_response_iss_parameter_supported": state.config.require_issuer,
        "authorization_endpoint": format!("{base}/oauth/authorize"),
        "token_endpoint": format!("{base}/oauth/token"),
        "registration_endpoint": format!("{base}/oauth/register"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": [state.config.scope]
    }))
}

async fn protected_metadata(State(state): State<OAuthState>) -> Response {
    match state.config.metadata_resource {
        Some(resource) => {
            let mut metadata = json!({
                "authorization_servers": [state.config.base_url],
                "scopes_supported": [state.config.scope]
            });
            if !state.config.omit_resource_field {
                metadata["resource"] = json!(resource);
            }
            Json(metadata).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn register(Json(params): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({
        "client_id": "mock-oauth-client",
        "redirect_uris": params["redirect_uris"],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none"
    }))
}

async fn authorize(State(state): State<OAuthState>, Query(params): Query<Params>) -> Response {
    if !matches_resource(&state, &params) || params.get("scope") != Some(&state.config.scope) {
        return error("invalid_resource", MISMATCH);
    }
    let (Some(client_id), Some(redirect_uri), Some(challenge), Some(csrf)) = (
        params.get("client_id"),
        params.get("redirect_uri"),
        params.get("code_challenge"),
        params.get("state"),
    ) else {
        return error("invalid_request", "Missing authorization parameters");
    };
    if params.get("response_type").map(String::as_str) != Some("code")
        || params.get("code_challenge_method").map(String::as_str) != Some("S256")
    {
        return error(
            "invalid_request",
            "Authorization code and S256 PKCE required",
        );
    }
    let Ok(mut redirect) = Url::parse(redirect_uri) else {
        return error("invalid_request", "Invalid redirect URI");
    };
    let mut grants = state.grants.lock().unwrap();
    let code = grants.id("code");
    grants.codes.insert(
        code.clone(),
        Grant {
            client_id: client_id.clone(),
            redirect_uri: redirect_uri.clone(),
            challenge: challenge.clone(),
            scope: state.config.scope.clone(),
        },
    );
    redirect
        .query_pairs_mut()
        .append_pair("code", &code)
        .append_pair("state", csrf);
    if state.config.require_issuer {
        redirect
            .query_pairs_mut()
            .append_pair("iss", &state.config.base_url);
    }
    Redirect::to(redirect.as_str()).into_response()
}

async fn token(State(state): State<OAuthState>, Form(params): Form<Params>) -> Response {
    if !matches_resource(&state, &params) {
        return error("invalid_resource", MISMATCH);
    }
    if let Some(scope) = params.get("scope") {
        if scope != &state.config.scope {
            return error("invalid_scope", MISMATCH);
        }
    }
    let mut grants = state.grants.lock().unwrap();
    let grant = match params.get("grant_type").map(String::as_str) {
        Some("authorization_code") => {
            let Some(grant) = params
                .get("code")
                .and_then(|code| grants.codes.get(code))
                .cloned()
            else {
                return error("invalid_grant", "Unknown or consumed code");
            };
            let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(
                params
                    .get("code_verifier")
                    .map(String::as_str)
                    .unwrap_or_default()
                    .as_bytes(),
            ));
            if params.get("redirect_uri") != Some(&grant.redirect_uri)
                || challenge != grant.challenge
            {
                return error("invalid_grant", "Redirect URI or PKCE mismatch");
            }
            grant
        }
        Some("refresh_token") => {
            let Some(grant) = params
                .get("refresh_token")
                .and_then(|token| grants.refresh_tokens.get(token))
                .cloned()
            else {
                return error("invalid_grant", "Unknown refresh token");
            };
            grant
        }
        _ => return error("unsupported_grant_type", "Unsupported grant type"),
    };
    if params.get("client_id") != Some(&grant.client_id) {
        return error("invalid_client", "Client mismatch");
    }
    if let Some(code) = params.get("code") {
        grants.codes.remove(code);
    }
    if let Some(token) = params.get("refresh_token") {
        grants.refresh_tokens.remove(token);
    }
    let access_token = grants.id("access");
    let refresh_token = grants.id("refresh");
    grants
        .access_tokens
        .insert(access_token.clone(), grant.clone());
    grants
        .refresh_tokens
        .insert(refresh_token.clone(), grant.clone());
    Json(json!({
        "access_token": access_token, "refresh_token": refresh_token,
        "token_type": "Bearer", "expires_in": 3600, "scope": grant.scope
    }))
    .into_response()
}

/// Build the same fixture for the standalone server and ephemeral regression-test listeners.
pub fn router(config: OAuthConfig) -> Router {
    let state = OAuthState {
        config,
        grants: Arc::default(),
    };
    let service = super::create_streamable_http_service(|| Ok(super::FileServer::new()));
    Router::new()
        .route("/.well-known/oauth-authorization-server", get(metadata))
        .route("/.well-known/oauth-protected-resource", get(protected_metadata))
        .route("/oauth/authorize", get(authorize))
        .route("/oauth/token", post(token))
        .route("/oauth/register", post(register))
        .route(MCP_PATH, any(move |State(state): State<OAuthState>, request: axum::http::Request<axum::body::Body>| {
            let service = service.clone();
            async move {
                let allowed = request.headers().get(AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.strip_prefix("Bearer "))
                    .is_some_and(|token| state.grants.lock().unwrap().access_tokens.contains_key(token));
                if !allowed {
                    let mut response = StatusCode::UNAUTHORIZED.into_response();
                    if state.config.metadata_resource.is_some() {
                        response.headers_mut().insert(WWW_AUTHENTICATE, format!(
                            "Bearer resource_metadata=\"{}/.well-known/oauth-protected-resource\"", state.config.base_url
                        ).parse().unwrap());
                    }
                    return response;
                }
                service.oneshot(request).await.unwrap().into_response()
            }
        }))
        .with_state(state)
}
