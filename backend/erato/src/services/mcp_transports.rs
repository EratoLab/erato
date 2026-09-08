use crate::config::{McpServerAuthenticationConfig, McpServerConfig, McpServerForwardedCredential};
use crate::services::mcp_manager::McpRequestAuthContext;
use crate::services::mcp_oauth::resolve_oauth_access_token;
use crate::services::template_rendering::consumers::{
    mcp_access_token::{
        FORWARDED_ACCESS_TOKEN_AUTH_HEADER_TEMPLATE, McpAccessTokenAuthHeaderRenderer,
    },
    mcp_id_token::{FORWARDED_ID_TOKEN_AUTH_HEADER_TEMPLATE, McpIdTokenAuthHeaderRenderer},
};
use crate::services::template_rendering::contexts::mcp_access_token::McpForwardedAccessTokenContext;
use crate::services::template_rendering::contexts::mcp_id_token::McpForwardedIdTokenContext;
use eyre::{Report, eyre};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use rmcp::ClientHandler;
use rmcp::model::{ProgressNotificationParam, ProgressToken};
use rmcp::service::{RoleClient, RunningService, ServiceExt};
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp_sse::{SseClientConfig, SseClientTransport};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::UnboundedSender;

fn apply_auth_header(
    headers: &mut HeaderMap,
    header_name: &str,
    header_value: &str,
) -> Result<(), Report> {
    headers.insert(
        HeaderName::from_bytes(header_name.as_bytes())
            .map_err(|e| eyre!("Invalid MCP auth header name '{}': {}", header_name, e))?,
        HeaderValue::from_str(header_value)
            .map_err(|e| eyre!("Invalid MCP auth header value for '{}': {}", header_name, e))?,
    );
    Ok(())
}

async fn apply_auth_headers(
    default_headers: &mut HeaderMap,
    server_id: &str,
    config: &McpServerConfig,
    auth_context: &McpRequestAuthContext<'_>,
) -> Result<(), Report> {
    match &config.authentication {
        McpServerAuthenticationConfig::None => Ok(()),
        McpServerAuthenticationConfig::Forwarded { forwarded } => match forwarded.credential {
            McpServerForwardedCredential::AccessToken => {
                let renderer = McpAccessTokenAuthHeaderRenderer::new();
                let token = auth_context
                    .access_token
                    .ok_or_else(|| eyre!("Missing forwarded access token for MCP server"))?;
                let header_value = renderer.render(
                    FORWARDED_ACCESS_TOKEN_AUTH_HEADER_TEMPLATE,
                    &McpForwardedAccessTokenContext {
                        access_token: Some(token),
                        prefix: Some(forwarded.prefix.as_str()),
                    },
                );
                apply_auth_header(default_headers, &forwarded.header_name, &header_value)
            }
            McpServerForwardedCredential::OidcIdToken => {
                let renderer = McpIdTokenAuthHeaderRenderer::new();
                let token = auth_context
                    .oidc_token
                    .ok_or_else(|| eyre!("Missing forwarded OIDC token for MCP server"))?;
                let header_value = renderer.render(
                    FORWARDED_ID_TOKEN_AUTH_HEADER_TEMPLATE,
                    &McpForwardedIdTokenContext {
                        id_token: Some(token),
                        prefix: Some(forwarded.prefix.as_str()),
                    },
                );
                apply_auth_header(default_headers, &forwarded.header_name, &header_value)
            }
        },
        McpServerAuthenticationConfig::Fixed { fixed } => apply_auth_header(
            default_headers,
            &fixed.header_name,
            &format!("{}{}", fixed.prefix, fixed.api_key.expose_secret()),
        ),
        McpServerAuthenticationConfig::Oauth2 { oauth2 } => {
            let app_state = auth_context
                .app_state
                .ok_or_else(|| eyre!("Missing application state for MCP OAuth2 authentication"))?;
            let user_id = auth_context
                .user_id
                .ok_or_else(|| eyre!("Missing user ID for MCP OAuth2 authentication"))?;
            let access_token =
                resolve_oauth_access_token(app_state, user_id, server_id, config, oauth2)
                    .await
                    .map_err(|error| eyre!(error.to_string()))?;
            apply_auth_header(
                default_headers,
                "Authorization",
                &format!("Bearer {access_token}"),
            )
        }
    }
}

pub fn oauth_default_headers(config: &McpServerConfig) -> Result<HeaderMap, Report> {
    let mut default_headers = HeaderMap::new();
    if let Some(http_headers) = &config.http_headers {
        for (name, value) in http_headers {
            default_headers.insert(
                HeaderName::from_bytes(name.as_bytes())
                    .map_err(|e| eyre!("Invalid MCP HTTP header name '{}': {}", name, e))?,
                HeaderValue::from_str(value)
                    .map_err(|e| eyre!("Invalid MCP HTTP header value for '{}': {}", name, e))?,
            );
        }
    }

    Ok(default_headers)
}

pub fn build_oauth_supporting_reqwest_client(
    config: &McpServerConfig,
) -> Result<reqwest::Client, Report> {
    reqwest::Client::builder()
        .default_headers(oauth_default_headers(config)?)
        .build()
        .map_err(|e| eyre!("Failed to build MCP reqwest client: {}", e))
}

async fn build_reqwest_client(
    server_id: &str,
    config: &McpServerConfig,
    auth_context: &McpRequestAuthContext<'_>,
) -> Result<reqwest::Client, Report> {
    let mut default_headers = HeaderMap::new();
    if let Some(http_headers) = &config.http_headers {
        for (name, value) in http_headers {
            default_headers.insert(
                HeaderName::from_bytes(name.as_bytes())
                    .map_err(|e| eyre!("Invalid MCP HTTP header name '{}': {}", name, e))?,
                HeaderValue::from_str(value)
                    .map_err(|e| eyre!("Invalid MCP HTTP header value for '{}': {}", name, e))?,
            );
        }
    }
    apply_auth_headers(&mut default_headers, server_id, config, auth_context).await?;
    reqwest::Client::builder()
        .default_headers(default_headers)
        .build()
        .map_err(|e| eyre!("Failed to build MCP reqwest client: {}", e))
}

/// Create an MCP client service based on the transport type specified in the configuration
/// Returns a RunningService which must be kept alive to maintain the connection
pub async fn create_mcp_service(
    server_id: &str,
    config: &McpServerConfig,
    auth_context: &McpRequestAuthContext<'_>,
) -> Result<RunningService<RoleClient, ProgressClientHandler>, Report> {
    match config.transport_type.as_str() {
        "sse" => create_sse_service(server_id, config, auth_context).await,
        "streamable_http" => create_streamable_http_service(server_id, config, auth_context).await,
        other => Err(eyre!(
            "Unsupported transport type '{}'. Supported types are 'sse' and 'streamable_http'",
            other
        )),
    }
}

/// Create an MCP service using SSE (Server-Sent Events) transport
async fn create_sse_service(
    server_id: &str,
    config: &McpServerConfig,
    auth_context: &McpRequestAuthContext<'_>,
) -> Result<RunningService<RoleClient, ProgressClientHandler>, Report> {
    use tracing::debug;

    debug!(url = %config.url, "Starting SSE transport");

    let client = build_reqwest_client(server_id, config, auth_context).await?;
    let transport = SseClientTransport::start_with_client(
        client,
        SseClientConfig {
            sse_endpoint: Arc::<str>::from(config.url.as_str()),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| eyre!("Failed to start SSE transport to {}: {}", config.url, e))?;

    debug!("SSE transport created, initializing service");

    // Each connection owns its progress correlation registry.
    let handler = ProgressClientHandler::default();

    // Create the peer using the service extension trait
    let running_service = handler
        .serve(transport)
        .await
        .map_err(|e| eyre!("Failed to create MCP service with SSE transport: {}", e))?;

    debug!("SSE peer service ready");

    Ok(running_service)
}

/// Create an MCP service using Streamable HTTP transport
async fn create_streamable_http_service(
    server_id: &str,
    config: &McpServerConfig,
    auth_context: &McpRequestAuthContext<'_>,
) -> Result<RunningService<RoleClient, ProgressClientHandler>, Report> {
    use tracing::debug;

    debug!(url = %config.url, "Creating Streamable HTTP transport");

    let client = build_reqwest_client(server_id, config, auth_context).await?;
    let mut transport_config = StreamableHttpClientTransportConfig::default();
    transport_config.uri = Arc::<str>::from(config.url.as_str());
    transport_config.auth_header = None;
    let transport = StreamableHttpClientTransport::with_client(client, transport_config);

    debug!("Streamable HTTP transport created, initializing service");

    // Each connection owns its progress correlation registry.
    let handler = ProgressClientHandler::default();

    // Create the peer using the service extension trait
    let running_service = handler.serve(transport).await.map_err(|e| {
        eyre!(
            "Failed to create MCP service with Streamable HTTP transport: {}",
            e
        )
    })?;

    debug!("Streamable HTTP peer service ready");

    Ok(running_service)
}

type ProgressRoutes = HashMap<ProgressToken, Option<UnboundedSender<ProgressNotificationParam>>>;

/// Progress routes belong to one connection, never to a global token namespace.
#[derive(Debug, Clone, Default)]
pub struct ProgressClientHandler {
    closed: Arc<std::sync::atomic::AtomicBool>,
    pub registration_gate: Arc<tokio::sync::Mutex<()>>,
    routes: Arc<Mutex<ProgressRoutes>>,
}

pub struct ProgressRegistration {
    handler: ProgressClientHandler,
    token: ProgressToken,
}

impl Drop for ProgressRegistration {
    fn drop(&mut self) {
        self.handler.routes.lock().unwrap().remove(&self.token);
    }
}

impl ProgressClientHandler {
    pub fn register(
        &self,
        token: ProgressToken,
        sender: Option<UnboundedSender<ProgressNotificationParam>>,
    ) -> ProgressRegistration {
        let mut routes = self.routes.lock().unwrap();
        if !self.closed.load(std::sync::atomic::Ordering::Relaxed) {
            routes.insert(token.clone(), sender);
        }
        ProgressRegistration {
            handler: self.clone(),
            token,
        }
    }

    pub fn same_connection(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.routes, &other.routes)
    }

    pub fn has_active_calls(&self) -> bool {
        !self.routes.lock().unwrap().is_empty()
    }

    pub fn clear(&self) {
        let mut routes = self.routes.lock().unwrap();
        self.closed
            .store(true, std::sync::atomic::Ordering::Relaxed);
        routes.clear();
    }

    fn forward(&self, params: ProgressNotificationParam) {
        let mut routes = self.routes.lock().unwrap();
        if let Some(Some(sender)) = routes.get(&params.progress_token) {
            let token = params.progress_token.clone();
            if sender.send(params).is_err() {
                routes.remove(&token);
            }
        }
    }
}

impl ClientHandler for ProgressClientHandler {
    async fn on_progress(
        &self,
        params: ProgressNotificationParam,
        _: rmcp::service::NotificationContext<RoleClient>,
    ) {
        let _gate = self.registration_gate.lock().await;
        self.forward(params);
    }
}

#[cfg(test)]
mod progress_tests {
    use super::*;
    use rmcp::model::{NumberOrString, ProgressNotificationParam, ProgressToken};
    use tokio::sync::mpsc::unbounded_channel;

    fn token(value: i64) -> ProgressToken {
        ProgressToken(NumberOrString::Number(value))
    }

    #[test]
    fn routes_are_isolated_and_cleanup_ignores_stale_tokens() {
        let first = ProgressClientHandler::default();
        let second = ProgressClientHandler::default();
        let (tx_a, mut rx_a) = unbounded_channel();
        let (tx_b, mut rx_b) = unbounded_channel();
        let (tx_c, mut rx_c) = unbounded_channel();
        let a = first.register(token(1), Some(tx_a));
        let b = first.register(token(2), Some(tx_b));
        let _c = second.register(token(1), Some(tx_c));
        first.forward(ProgressNotificationParam::new(token(1), 1.0));
        assert_eq!(rx_a.try_recv().unwrap().progress, 1.0);
        assert!(rx_b.try_recv().is_err());
        assert!(rx_c.try_recv().is_err());
        drop(a); // completion/error/cancellation all use this same Drop path
        first.forward(ProgressNotificationParam::new(token(1), 2.0));
        first.forward(ProgressNotificationParam::new(token(99), 2.0));
        assert!(rx_a.try_recv().is_err());
        assert_eq!(first.routes.lock().unwrap().len(), 1);
        first.clear(); // session teardown also disables registration in flight
        let (tx, mut rx) = unbounded_channel();
        let _late = first.register(token(3), Some(tx));
        first.forward(ProgressNotificationParam::new(token(3), 3.0));
        assert!(rx.try_recv().is_err());
        assert!(!first.has_active_calls());
        drop(b);
        second.forward(ProgressNotificationParam::new(token(1), 3.0));
        let update = rx_c.try_recv().unwrap();
        assert_eq!(update.progress, 3.0);
        assert_eq!(update.total, None);
        assert_eq!(update.message, None);
    }

    #[tokio::test]
    async fn aborting_call_drops_registration() {
        let handler = ProgressClientHandler::default();
        let (tx, _rx) = unbounded_channel();
        let registration = handler.register(token(1), Some(tx));
        let task = tokio::spawn(async move {
            let _registration = registration;
            std::future::pending::<()>().await;
        });
        task.abort();
        let _ = task.await;
        assert!(!handler.has_active_calls());
    }
}
