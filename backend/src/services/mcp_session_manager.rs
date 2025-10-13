use crate::config::{AppConfig, McpServerConfig};
use crate::services::mcp_transports::{create_mcp_service, EmptyClientHandler};
use eyre::{eyre, Report};
use rmcp::model::{CallToolRequestParam, CallToolResult, Tool};
use rmcp::service::{Peer, RoleClient, RunningService};
use sea_orm::prelude::Uuid;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

/// Represents a single MCP session for a specific chat and server
#[derive(Debug)]
struct McpSession {
    /// The rmcp running service (must be kept alive to maintain the connection)
    _service: RunningService<RoleClient, EmptyClientHandler>,
    /// The rmcp peer instance for making requests
    peer: Peer<RoleClient>,
    /// Server ID this session is for
    #[allow(dead_code)]
    server_id: String,
    /// Cached list of available tools
    tools: Vec<Tool>,
    /// Timestamp of last activity (tool call or tool list request)
    last_activity: SystemTime,
}

impl McpSession {
    /// Create a new session by connecting to the MCP server
    async fn new(server_id: String, config: &McpServerConfig) -> Result<Self, Report> {
        debug!(
            server_id = %server_id,
            transport_type = %config.transport_type,
            "Creating MCP service connection"
        );

        let service = create_mcp_service(config)
            .await
            .map_err(|e| eyre!("Failed to create MCP service: {}", e))?;

        debug!(
            server_id = %server_id,
            "MCP service created, fetching tool list"
        );

        // Get a peer reference from the running service
        let peer = service.peer().clone();

        // Fetch the initial tool list using Default::default() as shown in the example
        let tools_result = peer
            .list_tools(Default::default())
            .await
            .map_err(|e| eyre!("Failed to list tools during session initialization: {}", e))?;

        debug!(
            server_id = %server_id,
            num_tools = tools_result.tools.len(),
            "Successfully fetched tools from MCP server"
        );

        Ok(Self {
            _service: service, // Keep the service alive!
            peer,
            server_id,
            tools: tools_result.tools,
            last_activity: SystemTime::now(),
        })
    }

    /// Update the last activity timestamp
    fn touch(&mut self) {
        self.last_activity = SystemTime::now();
    }

    /// Check if this session has been inactive for longer than the given duration
    fn is_inactive(&self, duration: Duration) -> bool {
        if let Ok(elapsed) = self.last_activity.elapsed() {
            elapsed > duration
        } else {
            false
        }
    }

    /// Refresh the tools list from the server
    async fn refresh_tools(&mut self) -> Result<(), Report> {
        let tools_result = self
            .peer
            .list_tools(Default::default())
            .await
            .map_err(|e| eyre!("Failed to refresh tools: {}", e))?;

        self.tools = tools_result.tools;
        self.touch();
        Ok(())
    }

    /// Call a tool on this session
    async fn call_tool(&mut self, params: CallToolRequestParam) -> Result<CallToolResult, Report> {
        let result = self
            .peer
            .call_tool(params)
            .await
            .map_err(|e| eyre!("Failed to call tool: {}", e))?;

        self.touch();
        Ok(result)
    }
}

/// Key for identifying a unique session (chat_id, server_id)
type SessionKey = (Uuid, String);

/// Manages MCP sessions on a per-chat basis
#[derive(Debug)]
pub struct McpSessionManager {
    /// Map of (chat_id, server_id) to active sessions
    sessions: Arc<RwLock<HashMap<SessionKey, McpSession>>>,
    /// Server configurations from the app config
    server_configs: HashMap<String, McpServerConfig>,
    /// Handle to the background cleanup task
    _cleanup_task: JoinHandle<()>,
}

impl McpSessionManager {
    /// Create a new session manager with the given configuration
    pub fn new(config: &AppConfig) -> Self {
        let server_configs = config.mcp_servers.clone();
        let sessions = Arc::new(RwLock::new(HashMap::new()));

        // Spawn background cleanup task
        let cleanup_task = {
            let sessions = Arc::clone(&sessions);
            tokio::spawn(async move {
                Self::run_cleanup_task(sessions).await;
            })
        };

        Self {
            sessions,
            server_configs,
            _cleanup_task: cleanup_task,
        }
    }

    /// Background task that periodically cleans up inactive sessions
    async fn run_cleanup_task(sessions: Arc<RwLock<HashMap<SessionKey, McpSession>>>) {
        let mut interval = tokio::time::interval(Duration::from_secs(5 * 60)); // Run every 5 minutes
        let inactivity_threshold = Duration::from_secs(60 * 60); // 1 hour

        loop {
            interval.tick().await;

            let mut sessions_guard = sessions.write().await;
            let initial_count = sessions_guard.len();

            // Remove inactive sessions
            sessions_guard.retain(|(chat_id, server_id), session| {
                let should_keep = !session.is_inactive(inactivity_threshold);
                if !should_keep {
                    info!(
                        chat_id = %chat_id,
                        server_id = %server_id,
                        "Expiring inactive MCP session"
                    );
                }
                should_keep
            });

            let removed_count = initial_count - sessions_guard.len();
            if removed_count > 0 {
                info!(
                    "Cleaned up {} inactive MCP sessions, {} remaining",
                    removed_count,
                    sessions_guard.len()
                );
            }
        }
    }

    /// Get or create a session for the given chat and server
    async fn get_or_create_session(&self, chat_id: Uuid, server_id: &str) -> Result<(), Report> {
        let key = (chat_id, server_id.to_string());

        // Check if session already exists
        {
            let sessions_guard = self.sessions.read().await;
            if sessions_guard.contains_key(&key) {
                return Ok(());
            }
        }

        // Session doesn't exist, create it
        let config = self
            .server_configs
            .get(server_id)
            .ok_or_else(|| eyre!("MCP server '{}' not found in configuration", server_id))?;

        debug!(
            chat_id = %chat_id,
            server_id = %server_id,
            "Creating new MCP session"
        );

        let session = McpSession::new(server_id.to_string(), config).await?;

        let mut sessions_guard = self.sessions.write().await;
        sessions_guard.insert(key, session);

        info!(
            chat_id = %chat_id,
            server_id = %server_id,
            "Created new MCP session"
        );

        Ok(())
    }

    /// Remove a session from the cache (used when a session becomes invalid)
    async fn invalidate_session(&self, chat_id: Uuid, server_id: &str) {
        let key = (chat_id, server_id.to_string());
        let mut sessions_guard = self.sessions.write().await;
        if sessions_guard.remove(&key).is_some() {
            info!(
                chat_id = %chat_id,
                server_id = %server_id,
                "Invalidated MCP session (will be recreated on next request)"
            );
        }
    }

    /// List all available tools for a chat across all configured MCP servers
    pub async fn list_tools(&self, chat_id: Uuid) -> Vec<ManagedTool> {
        let mut all_tools = Vec::new();

        for server_id in self.server_configs.keys() {
            // Ensure session exists
            if let Err(e) = self.get_or_create_session(chat_id, server_id).await {
                warn!(
                    chat_id = %chat_id,
                    server_id = %server_id,
                    error = %e,
                    "Failed to create session for listing tools"
                );
                continue;
            }

            // Get tools from the session
            let sessions_guard = self.sessions.read().await;
            let key = (chat_id, server_id.clone());

            if let Some(session) = sessions_guard.get(&key) {
                for tool in &session.tools {
                    all_tools.push(ManagedTool {
                        server_id: server_id.clone(),
                        tool: tool.clone(),
                    });
                }
            }
        }

        debug!(
            chat_id = %chat_id,
            num_tools = all_tools.len(),
            "Listed tools for chat"
        );

        all_tools
    }

    /// Check if an error indicates the session is invalid and should be recreated
    fn is_session_invalid_error(error: &Report) -> bool {
        let error_msg = error.to_string().to_lowercase();

        // Common error patterns that indicate the session is no longer valid
        error_msg.contains("session")
            || error_msg.contains("404")
            || error_msg.contains("not found")
            || error_msg.contains("transport closed")
            || error_msg.contains("connection")
    }

    /// Call a tool on the appropriate MCP server for the given chat
    /// Automatically retries once with a new session if the session has become invalid
    pub async fn call_tool(
        &self,
        chat_id: Uuid,
        server_id: &str,
        params: CallToolRequestParam,
    ) -> Result<CallToolResult, Report> {
        // Try calling the tool with the current session
        match self
            .call_tool_internal(chat_id, server_id, params.clone())
            .await
        {
            Ok(result) => Ok(result),
            Err(e) if Self::is_session_invalid_error(&e) => {
                warn!(
                    chat_id = %chat_id,
                    server_id = %server_id,
                    error = %e,
                    "MCP session appears to be invalid, recreating and retrying"
                );

                // Invalidate the session
                self.invalidate_session(chat_id, server_id).await;

                // Retry with a new session
                self.call_tool_internal(chat_id, server_id, params).await
            }
            Err(e) => Err(e),
        }
    }

    /// Internal implementation of call_tool without retry logic
    async fn call_tool_internal(
        &self,
        chat_id: Uuid,
        server_id: &str,
        params: CallToolRequestParam,
    ) -> Result<CallToolResult, Report> {
        // Ensure session exists
        self.get_or_create_session(chat_id, server_id).await?;

        // Call the tool
        let mut sessions_guard = self.sessions.write().await;
        let key = (chat_id, server_id.to_string());

        let session = sessions_guard
            .get_mut(&key)
            .ok_or_else(|| eyre!("Session not found after creation"))?;

        session.call_tool(params).await
    }

    /// Manually refresh the tools list for a specific chat and server
    /// Automatically retries once with a new session if the session has become invalid
    pub async fn refresh_tools(&self, chat_id: Uuid, server_id: &str) -> Result<(), Report> {
        match self.refresh_tools_internal(chat_id, server_id).await {
            Ok(()) => Ok(()),
            Err(e) if Self::is_session_invalid_error(&e) => {
                warn!(
                    chat_id = %chat_id,
                    server_id = %server_id,
                    error = %e,
                    "MCP session appears to be invalid during refresh, recreating and retrying"
                );

                // Invalidate the session
                self.invalidate_session(chat_id, server_id).await;

                // Retry with a new session
                self.refresh_tools_internal(chat_id, server_id).await
            }
            Err(e) => Err(e),
        }
    }

    /// Internal implementation of refresh_tools without retry logic
    async fn refresh_tools_internal(&self, chat_id: Uuid, server_id: &str) -> Result<(), Report> {
        self.get_or_create_session(chat_id, server_id).await?;

        let mut sessions_guard = self.sessions.write().await;
        let key = (chat_id, server_id.to_string());

        if let Some(session) = sessions_guard.get_mut(&key) {
            session.refresh_tools().await?;
        }

        Ok(())
    }

    /// Perform connectivity checks for all configured MCP servers
    /// This is called during startup to verify server availability
    /// Failures are logged but not fatal
    pub async fn check_connectivity(&self) {
        if self.server_configs.is_empty() {
            info!("No MCP servers configured");
            return;
        }

        info!(
            "Checking connectivity to {} MCP server(s)...",
            self.server_configs.len()
        );

        for (server_id, config) in &self.server_configs {
            info!(
                server_id = %server_id,
                transport_type = %config.transport_type,
                url = %config.url,
                "Checking MCP server connectivity"
            );

            // Use a dummy chat_id for the connectivity check
            let test_chat_id = Uuid::nil();

            match self.get_or_create_session(test_chat_id, server_id).await {
                Ok(_) => {
                    // Get the session to check how many tools are available
                    let sessions_guard = self.sessions.read().await;
                    let key = (test_chat_id, server_id.clone());

                    if let Some(session) = sessions_guard.get(&key) {
                        info!(
                            server_id = %server_id,
                            num_tools = session.tools.len(),
                            "✓ MCP server connection successful"
                        );
                    }
                }
                Err(e) => {
                    warn!(
                        server_id = %server_id,
                        transport_type = %config.transport_type,
                        url = %config.url,
                        error = %e,
                        "✗ Failed to connect to MCP server (server may be unavailable). This is not fatal - the server will be retried when needed."
                    );
                }
            }
        }

        info!("MCP server connectivity checks complete");
    }
}

/// A tool with its associated server ID
#[derive(Debug, Clone)]
pub struct ManagedTool {
    pub server_id: String,
    pub tool: Tool,
}
