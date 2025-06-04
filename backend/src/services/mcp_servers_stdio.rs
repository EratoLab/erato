use crate::config::McpServerConfig;
use rust_mcp_sdk::{
    StdioTransport,
    TransportError,
    TransportOptions, // Assuming this is the correct path
};
use std::collections::HashMap; // For the 'env' parameter

/// Creates a new StdioTransport instance configured to launch `uvx mcp-proxy [URL]`.
///
/// This function uses the `rust-mcp-sdk`'s built-in `StdioTransport` and tells it
/// to manage the lifecycle of the `mcp-proxy` process.
///
/// # Arguments
///
/// * `config` - The McpServerConfig containing the URL for the proxy target.
/// * `options` - Transport options (e.g., timeouts). Defaults will be used if not provided.
///
/// # Returns
///
/// A `Result` containing the configured `StdioTransport` instance or a `TransportError`.
pub fn new_mcp_proxy_stdio_transport(
    config: &McpServerConfig,
    options: Option<TransportOptions>,
) -> Result<StdioTransport, TransportError> {
    let command = "uvx";
    let args = vec!["mcp-proxy".to_string(), config.url.clone()];
    let env: Option<HashMap<String, String>> = None; // No specific environment variables needed for now
    let transport_options = options.unwrap_or_default(); // Assume TransportOptions implements Default

    StdioTransport::create_with_server_launch(command, args, env, transport_options)
}
