use crate::config::AppConfig;
use crate::services::mcp_session_manager::{ManagedTool, McpSessionManager};
use eyre::{Report, eyre};
use genai::chat::Tool as GenaiTool;
use genai::chat::ToolCall as GenaiToolCall;
use rmcp::model::CallToolRequestParam;
use sea_orm::prelude::Uuid;
use std::sync::Arc;

/// Wrapper struct that provides a high-level API for MCP operations
#[derive(Clone, Debug)]
pub struct McpServers {
    session_manager: Arc<McpSessionManager>,
}

/// A tool call that includes the server ID it should be routed to
pub struct ManagedToolCall {
    pub server_id: String,
    pub tool_call: GenaiToolCall,
    pub tool: rmcp::model::Tool,
}

impl Default for McpServers {
    /// Create a default instance with an empty configuration (useful for tests)
    fn default() -> Self {
        // Create a minimal config with no MCP servers
        let config = AppConfig {
            mcp_servers: std::collections::HashMap::new(),
            ..Default::default()
        };
        Self::new(&config)
    }
}

impl McpServers {
    /// Create a new MCP servers manager
    pub fn new(config: &AppConfig) -> Self {
        let session_manager = Arc::new(McpSessionManager::new(config));
        Self { session_manager }
    }

    /// Perform connectivity checks for all configured MCP servers
    /// This should be called during application startup
    pub async fn check_connectivity(&self) {
        self.session_manager.check_connectivity().await;
    }

    /// List all available tools for a specific chat
    pub async fn list_tools(&self, chat_id: Uuid) -> Vec<ManagedTool> {
        self.session_manager.list_tools(chat_id).await
    }

    /// Convert a GenAI tool call to a managed tool call by finding the server that provides the tool
    pub async fn convert_tool_call_to_managed_tool_call(
        &self,
        chat_id: Uuid,
        tool_call: GenaiToolCall,
    ) -> Result<ManagedToolCall, Report> {
        let all_tools = self.list_tools(chat_id).await;

        let managed_tool = all_tools
            .iter()
            .find(|tool| tool.tool.name == tool_call.fn_name.as_str());

        if let Some(managed_tool) = managed_tool {
            Ok(ManagedToolCall {
                server_id: managed_tool.server_id.clone(),
                tool_call,
                tool: managed_tool.tool.clone(),
            })
        } else {
            Err(eyre!(
                "Tool with name '{}' not found in any MCP server",
                tool_call.fn_name
            ))
        }
    }

    /// Call a tool on the appropriate MCP server and return the raw MCP result
    pub async fn call_tool(
        &self,
        chat_id: Uuid,
        managed_tool_call: ManagedToolCall,
    ) -> Result<rmcp::model::CallToolResult, Report> {
        let params = CallToolRequestParam {
            name: managed_tool_call.tool_call.fn_name.clone().into(),
            arguments: managed_tool_call
                .tool_call
                .fn_arguments
                .as_object()
                .cloned(),
        };

        self.session_manager
            .call_tool(chat_id, &managed_tool_call.server_id, params)
            .await
    }
}

/// Convert MCP tools to GenAI tools format
pub fn convert_mcp_tools_to_genai_tools(managed_mcp_tools: Vec<ManagedTool>) -> Vec<GenaiTool> {
    managed_mcp_tools
        .into_iter()
        .map(|managed_tool| {
            let tool = managed_tool.tool;

            // Convert Arc<JsonObject> to serde_json::Value
            let input_schema_value: serde_json::Value =
                serde_json::Value::Object(tool.input_schema.as_ref().clone());

            GenaiTool {
                name: tool.name.to_string(),
                description: tool.description.map(|d| d.to_string()),
                schema: Some(input_schema_value),
                config: None,
            }
        })
        .collect()
}
