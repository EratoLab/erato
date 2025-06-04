use crate::config::McpServerConfig;
use rust_mcp_sdk::TransportError;
use rust_mcp_transport::{ClientSseTransport, ClientSseTransportOptions};

pub fn new_mcp_proxy_sse_transport(
    config: &McpServerConfig,
    options: Option<ClientSseTransportOptions>,
) -> Result<ClientSseTransport, TransportError> {
    let transport_options = options.unwrap_or_default();

    ClientSseTransport::new(&config.url.clone(), transport_options)
}
