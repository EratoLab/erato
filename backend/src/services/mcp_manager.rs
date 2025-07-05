use crate::config::AppConfig;
use crate::services::mcp_servers_sse::new_mcp_proxy_sse_transport;
use async_trait::async_trait;
use eyre::{eyre, Report};
use genai::chat::Tool as GenaiTool;
use genai::chat::{ToolCall as GenaiToolCall, ToolResponse};
use rust_mcp_schema::{
    CallToolRequestParams, ClientCapabilities, Implementation, InitializeRequestParams,
    ListToolsRequestParams, RpcError, Tool, ToolListChangedNotification, LATEST_PROTOCOL_VERSION,
};
use rust_mcp_sdk::{
    mcp_client::{client_runtime::create_client, ClientHandler, ClientRuntime},
    McpClient,
};
use rust_mcp_transport::ClientSseTransportOptions;
use std::collections::HashMap;
use std::fmt::{self, Debug};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;

// Entry now holds the ClientRuntime
struct McpServerEntry {
    id: String,
    // Transport is consumed during ClientRuntime creation
    tools: Arc<Mutex<Vec<Tool>>>,
    // Store the runtime Arc for access to McpClient methods
    runtime: Option<Arc<ClientRuntime>>, // Option because it's set during initialization
}

impl Debug for McpServerEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("McpServerEntry")
            .field("id", &self.id)
            .field("tools", &self.tools)
            // Avoid showing the runtime internals, maybe just indicate if present
            .field("runtime_present", &self.runtime.is_some())
            .finish()
    }
}

// Wrapper struct for tools to associate them with their server
#[derive(Debug, Clone)]
pub struct ManagedTool {
    pub server_id: String,
    pub tool: Tool,
}

pub struct ManagedToolCall {
    pub server_id: String,
    pub tool_call: GenaiToolCall,
}

#[derive(Debug, Clone, Default)]
pub struct McpServers {
    servers: Arc<HashMap<String, Arc<McpServerEntry>>>,
}

// Handler now needs access to tools storage
#[derive(Debug)] // Removed Clone, handler instance is unique per client
struct ToolUpdaterHandler {
    server_id: String,
    tools_storage: Arc<Mutex<Vec<Tool>>>,
}

#[async_trait]
impl ClientHandler for ToolUpdaterHandler {
    async fn handle_tool_list_changed_notification(
        &self,
        _notification: ToolListChangedNotification,
        runtime: &dyn McpClient, // This is the ClientRuntime
    ) -> Result<(), RpcError> {
        tracing::info!(server_id = %self.server_id, "Tool list changed notification received. Requesting update.");
        // Use ListToolsRequestParams for the Option type
        let params: Option<ListToolsRequestParams> = None;
        match runtime.list_tools(params).await {
            Ok(result) => {
                tracing::info!(server_id = %self.server_id, num_tools = result.tools.len(), "Received updated tool list.");
                let mut tools_guard = self.tools_storage.lock().await;
                *tools_guard = result.tools;
            }
            Err(e) => {
                tracing::error!(server_id = %self.server_id, error = ?e, "Failed to list tools after notification");
                // Return the error? Or just log?
                // Returning the error might stop the client runtime depending on SDK handling.
                // return Err(RpcError::InternalError(format!("Failed to list_tools: {}", e)));
            }
        }
        Ok(())
    }

    // Keep error logging
    async fn handle_error(
        &self,
        error: RpcError,
        _runtime: &dyn McpClient,
    ) -> Result<(), RpcError> {
        tracing::error!(server_id = %self.server_id, ?error, "MCP Client Error Notification/Request received");
        Ok(())
    }

    async fn handle_process_error(
        &self,
        _error_message: String,
        _runtime: &dyn McpClient,
    ) -> Result<(), RpcError> {
        // NOTE: Very spammy and contains normal logs for the test server; Need to figure out a better strategy.
        // tracing::error!(server_id = %self.server_id, error = %error_message, "MCP Process Error");
        // Err(RpcError::InternalError(format!("MCP process error: {}", error_message)))
        Ok(())
    }
}

impl McpServers {
    pub async fn new(config: &AppConfig) -> Result<Self, Report> {
        let mut servers_map = HashMap::new();
        let mut initialization_results = Vec::new();

        for (id, server_config) in &config.mcp_servers {
            tracing::info!(server_id = %id, url = %server_config.url, "Creating transport and runtime");

            let transport_result = new_mcp_proxy_sse_transport(
                server_config,
                Some(ClientSseTransportOptions::default()),
            );
            let tools_storage = Arc::new(Mutex::new(Vec::new()));
            let mut client_runtime: Option<Arc<ClientRuntime>> = None;
            let creation_error: Option<String>;

            match transport_result {
                Ok(transport) => {
                    let handler = ToolUpdaterHandler {
                        server_id: id.clone(),
                        tools_storage: tools_storage.clone(),
                    };
                    let client_info = InitializeRequestParams {
                        client_info: Implementation {
                            name: "erato-backend".to_string(),
                            version: env!("CARGO_PKG_VERSION").to_string(),
                        },
                        protocol_version: LATEST_PROTOCOL_VERSION.to_string(),
                        capabilities: ClientCapabilities::default(),
                    };

                    // Use create_client which returns Arc<ClientRuntime> directly
                    let runtime_arc = create_client(client_info, transport, handler);
                    client_runtime = Some(runtime_arc);
                    tracing::info!(server_id = %id, "ClientRuntime created successfully.");

                    // Since create_client doesn't return Result, we assume success if it returns.
                    // Clear any potential previous error from transport creation.
                    creation_error = None;
                }
                Err(e) => {
                    let err_msg = format!("Transport creation failed: {}", e);
                    tracing::error!(server_id = %id, error = %err_msg);
                    creation_error = Some(err_msg);
                }
            }

            // Store entry regardless of runtime creation success/failure
            // We need the entry later in start_runtime_tasks to report status
            let entry = Arc::new(McpServerEntry {
                id: id.clone(),
                tools: tools_storage.clone(), // Store the Arc<Mutex<Vec<Tool>>>
                runtime: client_runtime,      // Store the Option<Arc<ClientRuntime>>
            });
            servers_map.insert(id.clone(), entry);

            // Store the immediate creation result for start_runtime_tasks
            initialization_results.push((id.clone(), creation_error));
        }

        let instance = Self {
            servers: Arc::new(servers_map),
        };
        instance.start_runtime_tasks(initialization_results).await?;
        Ok(instance)
    }

    // Starts the background tasks for successfully created runtimes
    async fn start_runtime_tasks(
        &self,
        creation_results: Vec<(String, Option<String>)>,
    ) -> Result<(), Report> {
        let (init_tx, mut init_rx) = tokio::sync::mpsc::channel(self.servers.len().max(1));
        let mut expected_responses = 0;

        for (server_id, creation_error_opt) in creation_results {
            expected_responses += 1;
            if let Some(err_msg) = creation_error_opt {
                // If creation failed in `new`, send the error signal immediately
                init_tx.send(Err((server_id, err_msg))).await.ok();
                continue;
            }

            // If creation succeeded, find the entry and start the task
            if let Some(entry_arc) = self.servers.get(&server_id) {
                if let Some(client_runtime) = entry_arc.runtime.clone() {
                    // Clone the Arc<ClientRuntime>
                    let tools_storage = entry_arc.tools.clone();
                    let init_tx_clone = init_tx.clone();
                    let server_id_clone = server_id.clone();
                    let server_id_clone2 = server_id.clone();

                    tracing::info!(server_id = %server_id, "Spawning ClientRuntime task");
                    tokio::spawn(async move {
                        // 1. Start the main client loop
                        tracing::info!(server_id = %server_id_clone, "Starting ClientRuntime loop.");
                        match client_runtime.clone().start().await {
                            Ok(()) => {
                                tracing::info!(server_id = %server_id_clone, "ClientRuntime started successfully.");
                                init_tx_clone.send(Ok(server_id_clone)).await.ok();
                            }
                            Err(e) => {
                                let err_msg = format!("ClientRuntime failed to start: {}", e);
                                tracing::error!(server_id = %server_id_clone, error = %err_msg);
                                init_tx_clone
                                    .send(Err((server_id_clone, err_msg)))
                                    .await
                                    .ok();
                            }
                        }

                        // 2. Fetch initial tools
                        let params: Option<ListToolsRequestParams> = None;
                        match client_runtime.list_tools(params).await {
                            Ok(result) => {
                                tracing::info!(server_id = %server_id_clone2, num_tools = result.tools.len(), "Fetched initial tool list.");
                                *tools_storage.lock().await = result.tools;
                            }
                            Err(e) => {
                                let err_msg = format!("Initial list_tools failed: {}", e);
                                tracing::error!(server_id = %server_id_clone2, error = %err_msg);
                                init_tx_clone
                                    .send(Err((server_id_clone2, err_msg)))
                                    .await
                                    .ok();
                            }
                        }
                        info!(
                            "Finished connecting and initializing MCP client for server {}",
                            server_id
                        );
                    });
                } else {
                    // Should not happen if creation_error_opt was None, but handle defensively
                    tracing::error!(server_id = %server_id, "Runtime missing in entry despite creation success?");
                    init_tx
                        .send(Err((
                            server_id,
                            "Internal error: Runtime missing post-creation".to_string(),
                        )))
                        .await
                        .ok();
                }
            } else {
                // Should not happen if server_id came from config iteration
                tracing::error!(server_id = %server_id, "Entry missing in map during task spawning?");
                init_tx
                    .send(Err((
                        server_id,
                        "Internal error: Server entry missing".to_string(),
                    )))
                    .await
                    .ok();
            }
        }
        drop(init_tx);

        // --- Wait for Initialization Signals ---
        let mut initialized_count = 0;
        let mut init_errors = Vec::new();
        for _ in 0..expected_responses {
            if let Some(result) = init_rx.recv().await {
                match result {
                    Ok(id) => {
                        tracing::info!(server_id = %id, "Initialization task reported success.");
                        initialized_count += 1;
                    }
                    Err((id, msg)) => {
                        tracing::error!(server_id = %id, error=%msg, "Initialization task reported failure.");
                        init_errors.push(format!("Server '{}': {}", id, msg));
                    }
                }
            } else {
                break; // Channel closed
            }
        }

        if !init_errors.is_empty() {
            return Err(Report::msg(format!(
                "Failed to initialize some MCP servers: {}",
                init_errors.join("; ")
            )));
        }
        if initialized_count < expected_responses {
            tracing::warn!(
                "Did not receive initialization confirmation from all expected MCP servers ({}/{})",
                initialized_count,
                expected_responses
            );
        }

        tracing::info!("Finished MCP server initialization task spawning phase.");
        Ok(())
    }

    // List all available tools, aggregating from all initialized servers
    pub async fn list_tools(&self) -> Vec<ManagedTool> {
        let mut all_tools = Vec::new();
        for (id, entry) in self.servers.iter() {
            let tools_guard = entry.tools.lock().await;
            for tool in tools_guard.iter() {
                all_tools.push(ManagedTool {
                    server_id: id.clone(),
                    tool: tool.clone(),
                });
            }
        }
        tracing::debug!(num_tools = all_tools.len(), "Listing managed tools");
        all_tools
    }

    // Given a `genai` `ToolCall`, find the corresponding `ManagedTool`, and attach a `server_id`
    // to the `ToolCall`, turning it into a `ManagedToolCall`.
    pub async fn convert_tool_call_to_managed_tool_call(
        &self,
        tool_call: GenaiToolCall,
    ) -> Result<ManagedToolCall, Report> {
        let all_tools = self.list_tools().await;
        let managed_tool = all_tools
            .iter()
            .find(|tool| tool.tool.name == tool_call.fn_name);
        if let Some(managed_tool) = managed_tool {
            Ok(ManagedToolCall {
                server_id: managed_tool.server_id.clone(),
                tool_call,
            })
        } else {
            Err(Report::msg(format!(
                "Tool with name '{}' not found",
                tool_call.fn_name
            )))
        }
    }

    // Call a tool with the given `ManagedToolCall`.
    pub async fn call_tool(
        &self,
        managed_tool_call: ManagedToolCall,
    ) -> Result<ToolResponse, Report> {
        let client = self.get_client(&managed_tool_call.server_id);
        if let Some(client) = client {
            let tool_call_result = client
                .call_tool(CallToolRequestParams {
                    name: managed_tool_call.tool_call.fn_name,
                    arguments: Some(
                        managed_tool_call
                            .tool_call
                            .fn_arguments
                            .as_object()
                            .unwrap()
                            .to_owned(),
                    ),
                })
                .await
                // NOTE: Loosing some error info here due to Sync limit of error type
                .map_err(|_e| eyre!("Failed to call tool"))?;
            // TODO: Currently only supports first returned text result; May need to be expanded for multiple results and alternative types (e.g. images)
            let result_content = tool_call_result
                .content
                .first()
                .unwrap()
                .as_text_content()?;
            let tool_response = ToolResponse {
                call_id: managed_tool_call.tool_call.call_id,
                content: result_content.clone().text,
            };
            Ok(tool_response)
        } else {
            Err(Report::msg(format!(
                "Client for server '{}' not found",
                managed_tool_call.server_id
            )))
        }
    }

    // Add method to get client runtime for a specific server_id
    fn get_client(&self, server_id: &str) -> Option<Arc<ClientRuntime>> {
        self.servers
            .get(server_id)
            .and_then(|entry| entry.runtime.clone())
    }
}

pub fn convert_mcp_tools_to_genai_tools(managed_mcp_tools: Vec<ManagedTool>) -> Vec<GenaiTool> {
    managed_mcp_tools
        .into_iter()
        .map(|managed_tool| {
            let tool = managed_tool.tool;
            let mut properties = HashMap::new();
            if let Some(input_props) = &tool.input_schema.properties {
                for (key, value) in input_props {
                    // Assuming value is already a serde_json::Value or easily convertible
                    // If value is a complex struct, ensure it's correctly represented as JSON schema property
                    properties.insert(key.clone(), value.clone());
                }
            }

            let schema = serde_json::json!({
                "type": "object",
                "required": tool.input_schema.required.clone(),
                "properties": properties,
            });

            GenaiTool {
                name: tool.name,
                description: tool.description.clone(),
                schema: Some(schema),
                config: None,
            }
        })
        .collect()
}
