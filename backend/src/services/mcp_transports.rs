use crate::config::McpServerConfig;
use eyre::{Report, eyre};
use rmcp::ClientHandler;
use rmcp::service::{RoleClient, RunningService, ServiceExt};
use rmcp::transport::{SseClientTransport, StreamableHttpClientTransport};

/// Create an MCP client service based on the transport type specified in the configuration
/// Returns a RunningService which must be kept alive to maintain the connection
pub async fn create_mcp_service(
    config: &McpServerConfig,
) -> Result<RunningService<RoleClient, EmptyClientHandler>, Report> {
    match config.transport_type.as_str() {
        "sse" => create_sse_service(config).await,
        "streamable_http" => create_streamable_http_service(config).await,
        other => Err(eyre!(
            "Unsupported transport type '{}'. Supported types are 'sse' and 'streamable_http'",
            other
        )),
    }
}

/// Create an MCP service using SSE (Server-Sent Events) transport
async fn create_sse_service(
    config: &McpServerConfig,
) -> Result<RunningService<RoleClient, EmptyClientHandler>, Report> {
    use tracing::debug;

    debug!(url = %config.url, "Starting SSE transport");

    // Create SSE transport using the convenience method
    // This uses the default reqwest client
    // TODO: Add support for custom headers via a custom reqwest::Client if needed
    let transport = SseClientTransport::start(config.url.as_str())
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
) -> Result<RunningService<RoleClient, EmptyClientHandler>, Report> {
    use tracing::debug;

    debug!(url = %config.url, "Creating Streamable HTTP transport");

    // Create Streamable HTTP transport
    // TODO: Add support for custom headers via a custom reqwest::Client if needed
    let transport = StreamableHttpClientTransport::from_uri(config.url.as_str());

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
