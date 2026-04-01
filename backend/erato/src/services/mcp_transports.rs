use crate::config::{McpServerAuthenticationConfig, McpServerConfig, McpServerForwardedCredential};
use crate::services::mcp_manager::McpRequestAuthContext;
use eyre::{Report, eyre};
use reqwest_012::header::{HeaderMap, HeaderName, HeaderValue};
use rmcp::ClientHandler;
use rmcp::service::{RoleClient, RunningService, ServiceExt};
use rmcp::transport::sse_client::SseClientConfig;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::{SseClientTransport, StreamableHttpClientTransport};
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

fn apply_auth_headers(
    default_headers: &mut HeaderMap,
    config: &McpServerConfig,
    auth_context: &McpRequestAuthContext<'_>,
) -> Result<(), Report> {
    match &config.authentication {
        McpServerAuthenticationConfig::None => Ok(()),
        McpServerAuthenticationConfig::Forwarded { forwarded } => match forwarded.credential {
            McpServerForwardedCredential::AccessToken => {
                let token = auth_context
                    .access_token
                    .ok_or_else(|| eyre!("Missing forwarded access token for MCP server"))?;
                apply_auth_header(default_headers, "Authorization", &format!("Bearer {token}"))
            }
            McpServerForwardedCredential::OidcIdToken => {
                let token = auth_context
                    .oidc_token
                    .ok_or_else(|| eyre!("Missing forwarded OIDC token for MCP server"))?;
                apply_auth_header(default_headers, "Authorization", &format!("Bearer {token}"))
            }
        },
        McpServerAuthenticationConfig::Fixed { fixed } => apply_auth_header(
            default_headers,
            &fixed.header_name,
            &format!("{}{}", fixed.prefix, fixed.api_key),
        ),
    }
}

fn build_reqwest_client(
    config: &McpServerConfig,
    auth_context: &McpRequestAuthContext<'_>,
) -> Result<reqwest_012::Client, Report> {
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
    apply_auth_headers(&mut default_headers, config, auth_context)?;

    reqwest_012::Client::builder()
        .default_headers(default_headers)
        .build()
        .map_err(|e| eyre!("Failed to build MCP reqwest client: {}", e))
}

/// Create an MCP client service based on the transport type specified in the configuration
/// Returns a RunningService which must be kept alive to maintain the connection
pub async fn create_mcp_service(
    config: &McpServerConfig,
    auth_context: &McpRequestAuthContext<'_>,
) -> Result<RunningService<RoleClient, EmptyClientHandler>, Report> {
    match config.transport_type.as_str() {
        "sse" => create_sse_service(config, auth_context).await,
        "streamable_http" => create_streamable_http_service(config, auth_context).await,
        other => Err(eyre!(
            "Unsupported transport type '{}'. Supported types are 'sse' and 'streamable_http'",
            other
        )),
    }
}

/// Create an MCP service using SSE (Server-Sent Events) transport
async fn create_sse_service(
    config: &McpServerConfig,
    auth_context: &McpRequestAuthContext<'_>,
) -> Result<RunningService<RoleClient, EmptyClientHandler>, Report> {
    use tracing::debug;

    debug!(url = %config.url, "Starting SSE transport");

    let client = build_reqwest_client(config, auth_context)?;
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
    config: &McpServerConfig,
    auth_context: &McpRequestAuthContext<'_>,
) -> Result<RunningService<RoleClient, EmptyClientHandler>, Report> {
    use tracing::debug;

    debug!(url = %config.url, "Creating Streamable HTTP transport");

    let client = build_reqwest_client(config, auth_context)?;
    let transport = StreamableHttpClientTransport::with_client(
        client,
        StreamableHttpClientTransportConfig {
            uri: Arc::<str>::from(config.url.as_str()),
            auth_header: None,
            ..Default::default()
        },
    );

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
