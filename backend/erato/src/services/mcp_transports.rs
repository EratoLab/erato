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
use rmcp::service::{RoleClient, RunningService, ServiceExt};
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp_sse::{SseClientConfig, SseClientTransport};
use std::sync::Arc;

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
            &format!("{}{}", fixed.prefix, fixed.api_key),
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

pub fn build_oauth_supporting_reqwest_client(
    config: &McpServerConfig,
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

    reqwest::Client::builder()
        .default_headers(default_headers)
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
) -> Result<RunningService<RoleClient, EmptyClientHandler>, Report> {
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
) -> Result<RunningService<RoleClient, EmptyClientHandler>, Report> {
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

    // Create a client handler (empty for now, can be customized later)
    let handler = EmptyClientHandler;

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
) -> Result<RunningService<RoleClient, EmptyClientHandler>, Report> {
    use tracing::debug;

    debug!(url = %config.url, "Creating Streamable HTTP transport");

    let client = build_reqwest_client(server_id, config, auth_context).await?;
    let mut transport_config = StreamableHttpClientTransportConfig::default();
    transport_config.uri = Arc::<str>::from(config.url.as_str());
    transport_config.auth_header = None;
    let transport = StreamableHttpClientTransport::with_client(client, transport_config);

    debug!("Streamable HTTP transport created, initializing service");

    // Create a client handler (empty for now, can be customized later)
    let handler = EmptyClientHandler;

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

/// Empty client handler that doesn't handle any client-side notifications
#[derive(Debug, Clone)]
pub struct EmptyClientHandler;

impl ClientHandler for EmptyClientHandler {}
