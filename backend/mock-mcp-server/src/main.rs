use std::net::SocketAddr;

use axum::{routing::get, Json, Router};
use colored::Colorize;
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{
        CallToolRequestParam, CallToolResult, ListToolsResult, Meta, PaginatedRequestParam,
        ProgressNotificationParam, ServerCapabilities, ServerInfo,
    },
    schemars,
    service::RequestContext,
    tool, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager,
        tower::{StreamableHttpServerConfig, StreamableHttpService},
    },
    ErrorData as McpError, Peer, RoleServer, ServerHandler,
};
use serde::Serialize;
use serde_json::json;
use tokio::time::{sleep, Duration};

const MOCK_FILES: &[(&str, &str)] = &[
    ("docs/readme.txt", "This is a mock README file."),
    ("docs/notes.txt", "These are mock notes for MCP testing."),
    (
        "configs/app.toml",
        "[app]\nname = \"mock-mcp\"\nenvironment = \"local\"",
    ),
];

#[derive(Debug, Clone, Serialize)]
struct MechanismSummary {
    name: &'static str,
    description: &'static str,
    endpoint: &'static str,
    tools: &'static [&'static str],
}

#[derive(Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
struct ListFilesResult {
    files: Vec<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct ReadFileParams {
    path: String,
}

fn list_mock_files() -> Vec<String> {
    MOCK_FILES
        .iter()
        .map(|(path, _)| (*path).to_string())
        .collect()
}

fn read_mock_file(path: &str) -> Option<&'static str> {
    MOCK_FILES
        .iter()
        .find(|(candidate, _)| *candidate == path)
        .map(|(_, content)| *content)
}

fn list_tools_from_router<S>(tool_router: &ToolRouter<S>) -> ListToolsResult
where
    S: Send + Sync + 'static,
{
    ListToolsResult {
        tools: tool_router.list_all(),
        next_cursor: None,
    }
}

async fn call_tool_from_router<S>(
    service: &S,
    tool_router: &ToolRouter<S>,
    request: CallToolRequestParam,
    context: RequestContext<RoleServer>,
) -> Result<CallToolResult, McpError>
where
    S: Send + Sync + 'static,
{
    let tool_call_context =
        rmcp::handler::server::tool::ToolCallContext::new(service, request, context);
    tool_router.call(tool_call_context).await
}

#[derive(Clone)]
struct FileServer {
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl FileServer {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl FileServer {
    #[tool(description = "List available mock files")]
    fn list_files(&self) -> rmcp::Json<ListFilesResult> {
        rmcp::Json(ListFilesResult {
            files: list_mock_files(),
        })
    }

    #[tool(description = "Read a mock file by path")]
    fn read_file(
        &self,
        Parameters(ReadFileParams { path }): Parameters<ReadFileParams>,
    ) -> Result<String, McpError> {
        read_mock_file(&path)
            .map(|content| content.to_string())
            .ok_or_else(|| McpError::invalid_params(format!("File not found: {path}"), None))
    }
}

impl ServerHandler for FileServer {
    fn call_tool(
        &self,
        request: CallToolRequestParam,
        context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, McpError>> + Send + '_ {
        call_tool_from_router(self, &self.tool_router, request, context)
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        std::future::ready(Ok(list_tools_from_router(&self.tool_router)))
    }

    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some("Mock MCP file server".into()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[derive(Clone)]
struct ErrorFileServer {
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl ErrorFileServer {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl ErrorFileServer {
    #[tool(description = "List available mock files")]
    fn list_files(&self) -> rmcp::Json<ListFilesResult> {
        rmcp::Json(ListFilesResult {
            files: list_mock_files(),
        })
    }

    #[tool(description = "Read a mock file by path (always returns an error)")]
    fn read_file(
        &self,
        Parameters(ReadFileParams { path }): Parameters<ReadFileParams>,
    ) -> Result<String, McpError> {
        Err(McpError::internal_error(
            format!("Simulated read_file error for path: {path}"),
            None,
        ))
    }
}

impl ServerHandler for ErrorFileServer {
    fn call_tool(
        &self,
        request: CallToolRequestParam,
        context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, McpError>> + Send + '_ {
        call_tool_from_router(self, &self.tool_router, request, context)
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        std::future::ready(Ok(list_tools_from_router(&self.tool_router)))
    }

    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some("Mock MCP error simulation server".into()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[derive(Clone)]
struct ProgressFileServer {
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl ProgressFileServer {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl ProgressFileServer {
    #[tool(description = "List available mock files")]
    fn list_files(&self) -> rmcp::Json<ListFilesResult> {
        rmcp::Json(ListFilesResult {
            files: list_mock_files(),
        })
    }

    #[tool(description = "Read a mock file by path while emitting progress messages")]
    async fn read_file(
        meta: Meta,
        client: Peer<RoleServer>,
        Parameters(ReadFileParams { path }): Parameters<ReadFileParams>,
    ) -> Result<String, McpError> {
        if let Some(progress_token) = meta.get_progress_token() {
            for step in 1..=3 {
                let _ = client
                    .notify_progress(ProgressNotificationParam {
                        progress_token: progress_token.clone(),
                        progress: step as f64,
                        total: Some(3.0),
                        message: Some(format!("Reading file step {step}/3")),
                    })
                    .await;
                sleep(Duration::from_secs(5)).await;
            }
        }

        read_mock_file(&path)
            .map(|content| content.to_string())
            .ok_or_else(|| McpError::invalid_params(format!("File not found: {path}"), None))
    }
}

impl ServerHandler for ProgressFileServer {
    fn call_tool(
        &self,
        request: CallToolRequestParam,
        context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, McpError>> + Send + '_ {
        call_tool_from_router(self, &self.tool_router, request, context)
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        std::future::ready(Ok(list_tools_from_router(&self.tool_router)))
    }

    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some("Mock MCP progress simulation server".into()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[derive(Clone)]
struct ContentFilterFileServer {
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl ContentFilterFileServer {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl ContentFilterFileServer {
    #[tool(description = "Always returns a content_filter tool error payload")]
    fn trigger_content_filter(&self) -> Result<rmcp::model::CallToolResult, McpError> {
        Ok(rmcp::model::CallToolResult::structured_error(json!({
            "type": "content_filter",
            "error_description": "The response was filtered by MCP content policy.",
            "filter_details": {
                "sexual": { "filtered": true, "severity": "medium" },
                "violence": { "filtered": false, "severity": "low" },
                "hate": { "filtered": false, "severity": "safe" },
                "self_harm": { "filtered": false, "severity": "safe" }
            }
        })))
    }
}

impl ServerHandler for ContentFilterFileServer {
    fn call_tool(
        &self,
        request: CallToolRequestParam,
        context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, McpError>> + Send + '_ {
        call_tool_from_router(self, &self.tool_router, request, context)
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        std::future::ready(Ok(list_tools_from_router(&self.tool_router)))
    }

    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some("Mock MCP content filter simulation server".into()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "mock-mcp-server"
    }))
}

fn builtin_mechanisms() -> Vec<MechanismSummary> {
    vec![
        MechanismSummary {
            name: "File server",
            description: "Provides list_files and read_file for mock files",
            endpoint: "Streamable HTTP /mcp/file",
            tools: &["list_files", "read_file"],
        },
        MechanismSummary {
            name: "Error simulation server",
            description: "Same tools; read_file intentionally returns errors",
            endpoint: "Streamable HTTP /mcp/error",
            tools: &["list_files", "read_file"],
        },
        MechanismSummary {
            name: "Progress simulation server",
            description: "Same tools; read_file emits progress notifications",
            endpoint: "Streamable HTTP /mcp/progress",
            tools: &["list_files", "read_file"],
        },
        MechanismSummary {
            name: "Content filter simulation server",
            description: "Provides trigger_content_filter and returns is_error payload",
            endpoint: "Streamable HTTP /mcp/content-filter",
            tools: &["trigger_content_filter"],
        },
    ]
}

fn log_startup(addr: &str, mechanisms: &[MechanismSummary]) {
    println!("{}", "Mock MCP Server".bright_green().bold());
    println!("{} {}", "Listening on:".bright_white(), addr.bright_cyan());
    println!();

    println!("{}", "Available endpoints:".bright_white());
    println!("  {} {}", "GET".bright_cyan(), "/health".bright_yellow());
    println!(
        "  {} {}",
        "MCP HTTP".bright_cyan(),
        "/mcp/file".bright_yellow()
    );
    println!(
        "  {} {}",
        "MCP HTTP".bright_cyan(),
        "/mcp/error".bright_yellow()
    );
    println!(
        "  {} {}",
        "MCP HTTP".bright_cyan(),
        "/mcp/progress".bright_yellow()
    );
    println!(
        "  {} {}",
        "MCP HTTP".bright_cyan(),
        "/mcp/content-filter".bright_yellow()
    );
    println!();

    println!("{}", "Built-in mocking mechanisms:".bright_white());
    for mechanism in mechanisms {
        println!("  [{}]", mechanism.name.bold());
        println!("    {}: {}", "Description".bold(), mechanism.description);
        println!("    {}: {}", "Endpoint".bold(), mechanism.endpoint);
        println!("    {}: {}", "Tools".bold(), mechanism.tools.join(", "));
        println!();
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "off".into()),
        )
        .init();

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "44321".to_string());
    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .unwrap_or_else(|e| panic!("Invalid HOST/PORT address: {}", e));

    let file_service: StreamableHttpService<FileServer, LocalSessionManager> =
        StreamableHttpService::new(
            || Ok(FileServer::new()),
            Default::default(),
            StreamableHttpServerConfig {
                stateful_mode: true,
                sse_keep_alive: None,
            },
        );

    let error_service: StreamableHttpService<ErrorFileServer, LocalSessionManager> =
        StreamableHttpService::new(
            || Ok(ErrorFileServer::new()),
            Default::default(),
            StreamableHttpServerConfig {
                stateful_mode: true,
                sse_keep_alive: None,
            },
        );

    let progress_service: StreamableHttpService<ProgressFileServer, LocalSessionManager> =
        StreamableHttpService::new(
            || Ok(ProgressFileServer::new()),
            Default::default(),
            StreamableHttpServerConfig {
                stateful_mode: true,
                sse_keep_alive: None,
            },
        );
    let content_filter_service: StreamableHttpService<
        ContentFilterFileServer,
        LocalSessionManager,
    > = StreamableHttpService::new(
        || Ok(ContentFilterFileServer::new()),
        Default::default(),
        StreamableHttpServerConfig {
            stateful_mode: true,
            sse_keep_alive: None,
        },
    );

    let app = Router::new()
        .route("/health", get(health))
        .nest_service("/mcp/file", file_service)
        .nest_service("/mcp/error", error_service)
        .nest_service("/mcp/progress", progress_service)
        .nest_service("/mcp/content-filter", content_filter_service);

    let mechanisms = builtin_mechanisms();
    log_startup(&addr.to_string(), &mechanisms);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind to {}: {}", addr, e));

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .unwrap_or_else(|e| panic!("Server error: {}", e));
}
