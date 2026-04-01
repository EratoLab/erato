use std::net::SocketAddr;

use axum::{
    body::Body,
    http::{header::AUTHORIZATION, HeaderMap, HeaderName, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
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
use tower::util::ServiceExt;

const MOCK_FILES: &[(&str, &str)] = &[
    ("docs/readme.txt", "This is a mock README file."),
    ("docs/notes.txt", "These are mock notes for MCP testing."),
    (
        "configs/app.toml",
        "[app]\nname = \"mock-mcp\"\nenvironment = \"local\"",
    ),
];

const FIXED_API_KEY: &str = "fixed-api-key-secret";
const FIXED_CUSTOM_HEADER_NAME: &str = "x-api-key";
const FIXED_CUSTOM_PREFIX: &str = "Token ";
const FORWARDED_ACCESS_ALLOWED_SUBJECTS: &[&str] =
    &["allowed-user", "08a8684b-db88-4b73-90a9-3cd166300003"];
const FORWARDED_ACCESS_ALLOWED_GROUP: &str = "mcp-auth-forwarded-access";
const FORWARDED_OIDC_ALLOWED_SUBJECTS: &[&str] =
    &["allowed-user", "08a8684b-db88-4b73-90a9-3cd166300004"];
const FORWARDED_OIDC_ALLOWED_GROUP: &str = "mcp-auth-forwarded-oidc";

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

#[derive(Clone)]
struct NoneAuthProbeServer {
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl NoneAuthProbeServer {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl NoneAuthProbeServer {
    #[tool(description = "Probe MCP endpoint configured with authentication.mode = none")]
    fn auth_none_probe(&self) -> String {
        "none-auth probe succeeded".to_string()
    }
}

impl ServerHandler for NoneAuthProbeServer {
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
            instructions: Some("Mock MCP none-auth probe server".into()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[derive(Clone)]
struct FixedApiKeyProbeServer {
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl FixedApiKeyProbeServer {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl FixedApiKeyProbeServer {
    #[tool(description = "Probe MCP endpoint configured with fixed API key authentication")]
    fn auth_fixed_api_key_probe(&self) -> String {
        "fixed-auth probe succeeded".to_string()
    }

    #[tool(description = "Probe MCP endpoint configured with custom fixed header authentication")]
    fn auth_fixed_custom_header_probe(&self) -> String {
        "fixed-auth custom-header probe succeeded".to_string()
    }
}

impl ServerHandler for FixedApiKeyProbeServer {
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
            instructions: Some("Mock MCP fixed-auth probe server".into()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[derive(Clone)]
struct ForwardedAccessProbeServer {
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl ForwardedAccessProbeServer {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl ForwardedAccessProbeServer {
    #[tool(
        description = "Probe MCP endpoint configured with forwarded access token authentication"
    )]
    fn auth_forwarded_access_probe(&self) -> String {
        "forwarded-access probe succeeded".to_string()
    }
}

impl ServerHandler for ForwardedAccessProbeServer {
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
            instructions: Some("Mock MCP forwarded-access probe server".into()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[derive(Clone)]
struct ForwardedOidcProbeServer {
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl ForwardedOidcProbeServer {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl ForwardedOidcProbeServer {
    #[tool(description = "Probe MCP endpoint configured with forwarded OIDC token authentication")]
    fn auth_forwarded_oidc_probe(&self) -> String {
        "forwarded-oidc probe succeeded".to_string()
    }
}

impl ServerHandler for ForwardedOidcProbeServer {
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
            instructions: Some("Mock MCP forwarded-oidc probe server".into()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[derive(Clone)]
struct EmptyToolServer;

impl ServerHandler for EmptyToolServer {
    fn call_tool(
        &self,
        _request: CallToolRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, McpError>> + Send + '_ {
        std::future::ready(Err(McpError::internal_error(
            "No tools available for this identity".to_string(),
            None,
        )))
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult {
            tools: Vec::new(),
            next_cursor: None,
        }))
    }

    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some("Mock MCP empty tool server".into()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

fn create_streamable_http_service<S>(
    factory: impl Fn() -> Result<S, std::io::Error> + Clone + Send + Sync + 'static,
) -> StreamableHttpService<S, LocalSessionManager>
where
    S: ServerHandler + Send + Sync + 'static,
{
    StreamableHttpService::new(
        factory,
        Default::default(),
        StreamableHttpServerConfig {
            stateful_mode: true,
            sse_keep_alive: None,
        },
    )
}

fn unauthorized(message: &str) -> Response {
    (StatusCode::UNAUTHORIZED, Json(json!({ "error": message }))).into_response()
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
}

fn access_token_subject(token: &str) -> Option<String> {
    token
        .strip_prefix("access:")
        .map(str::to_string)
        .or_else(|| {
            token_claims(token)?
                .get("sub")?
                .as_str()
                .map(str::to_string)
        })
}

fn oidc_token_subject(token: &str) -> Option<String> {
    token_claims(token)?
        .get("sub")?
        .as_str()
        .map(str::to_string)
}

fn token_claims(token: &str) -> Option<serde_json::Value> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice(&decoded).ok()
}

fn token_has_group(token: &str, expected_group: &str) -> bool {
    let Some(claims) = token_claims(token) else {
        return false;
    };

    match claims.get("groups") {
        Some(serde_json::Value::Array(groups)) => groups
            .iter()
            .filter_map(|group| group.as_str())
            .any(|group| group == expected_group),
        Some(serde_json::Value::String(group)) => group == expected_group,
        _ => false,
    }
}

async fn serve_without_auth<S>(service: S, request: Request<Body>) -> Response
where
    S: tower::Service<Request<Body>> + Clone + Send + 'static,
    S::Response: IntoResponse,
    S::Future: Send + 'static,
{
    if bearer_token(request.headers()).is_some() {
        return unauthorized("expected no Authorization header");
    }

    match service.clone().oneshot(request).await {
        Ok(response) => response.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn serve_with_fixed_api_key<S>(service: S, request: Request<Body>) -> Response
where
    S: tower::Service<Request<Body>> + Clone + Send + 'static,
    S::Response: IntoResponse,
    S::Future: Send + 'static,
{
    match bearer_token(request.headers()) {
        Some(token) if token == FIXED_API_KEY => match service.clone().oneshot(request).await {
            Ok(response) => response.into_response(),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        },
        _ => unauthorized("expected fixed API key bearer token"),
    }
}

async fn serve_with_fixed_api_key_custom_header<S>(service: S, request: Request<Body>) -> Response
where
    S: tower::Service<Request<Body>> + Clone + Send + 'static,
    S::Response: IntoResponse,
    S::Future: Send + 'static,
{
    let expected = format!("{FIXED_CUSTOM_PREFIX}{FIXED_API_KEY}");
    match request
        .headers()
        .get(HeaderName::from_static(FIXED_CUSTOM_HEADER_NAME))
        .and_then(|value| value.to_str().ok())
    {
        Some(value) if value == expected => match service.clone().oneshot(request).await {
            Ok(response) => response.into_response(),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        },
        _ => unauthorized("expected configured fixed API key header"),
    }
}

async fn serve_with_forwarded_access_token<A, D>(
    allowed_service: A,
    denied_service: D,
    request: Request<Body>,
) -> Response
where
    A: tower::Service<Request<Body>> + Clone + Send + 'static,
    A::Response: IntoResponse,
    A::Future: Send + 'static,
    D: tower::Service<Request<Body>> + Clone + Send + 'static,
    D::Response: IntoResponse,
    D::Future: Send + 'static,
{
    match bearer_token(request.headers()) {
        Some(token)
            if access_token_subject(token)
                .as_deref()
                .is_some_and(|subject| FORWARDED_ACCESS_ALLOWED_SUBJECTS.contains(&subject))
                || token_has_group(token, FORWARDED_ACCESS_ALLOWED_GROUP) =>
        {
            match allowed_service.clone().oneshot(request).await {
                Ok(response) => response.into_response(),
                Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            }
        }
        Some(_) => match denied_service.clone().oneshot(request).await {
            Ok(response) => response.into_response(),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        },
        None => unauthorized("expected forwarded access token bearer token"),
    }
}

async fn serve_with_forwarded_oidc_token<A, D>(
    allowed_service: A,
    denied_service: D,
    request: Request<Body>,
) -> Response
where
    A: tower::Service<Request<Body>> + Clone + Send + 'static,
    A::Response: IntoResponse,
    A::Future: Send + 'static,
    D: tower::Service<Request<Body>> + Clone + Send + 'static,
    D::Response: IntoResponse,
    D::Future: Send + 'static,
{
    match bearer_token(request.headers()) {
        Some(token)
            if oidc_token_subject(token)
                .as_deref()
                .is_some_and(|subject| FORWARDED_OIDC_ALLOWED_SUBJECTS.contains(&subject))
                || token_has_group(token, FORWARDED_OIDC_ALLOWED_GROUP) =>
        {
            match allowed_service.clone().oneshot(request).await {
                Ok(response) => response.into_response(),
                Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            }
        }
        Some(_) => match denied_service.clone().oneshot(request).await {
            Ok(response) => response.into_response(),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        },
        None => unauthorized("expected forwarded OIDC bearer token"),
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
        MechanismSummary {
            name: "None auth probe server",
            description: "Validates that no bearer credentials are sent",
            endpoint: "Streamable HTTP /mcp/auth-none",
            tools: &["auth_none_probe"],
        },
        MechanismSummary {
            name: "Forwarded access token probe server",
            description: "Validates forwarded access tokens and filters tools by user identity",
            endpoint: "Streamable HTTP /mcp/auth-forwarded-access",
            tools: &["auth_forwarded_access_probe"],
        },
        MechanismSummary {
            name: "Forwarded OIDC token probe server",
            description: "Validates forwarded OIDC tokens and filters tools by user identity",
            endpoint: "Streamable HTTP /mcp/auth-forwarded-oidc",
            tools: &["auth_forwarded_oidc_probe"],
        },
        MechanismSummary {
            name: "Fixed API key probe server",
            description: "Validates a configured fixed API key bearer token",
            endpoint: "Streamable HTTP /mcp/auth-fixed",
            tools: &["auth_fixed_api_key_probe"],
        },
        MechanismSummary {
            name: "Fixed API key custom-header probe server",
            description: "Validates a configured fixed API key header and prefix",
            endpoint: "Streamable HTTP /mcp/auth-fixed-custom",
            tools: &["auth_fixed_custom_header_probe"],
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
    println!(
        "  {} {}",
        "MCP HTTP".bright_cyan(),
        "/mcp/auth-none".bright_yellow()
    );
    println!(
        "  {} {}",
        "MCP HTTP".bright_cyan(),
        "/mcp/auth-forwarded-access".bright_yellow()
    );
    println!(
        "  {} {}",
        "MCP HTTP".bright_cyan(),
        "/mcp/auth-forwarded-oidc".bright_yellow()
    );
    println!(
        "  {} {}",
        "MCP HTTP".bright_cyan(),
        "/mcp/auth-fixed".bright_yellow()
    );
    println!(
        "  {} {}",
        "MCP HTTP".bright_cyan(),
        "/mcp/auth-fixed-custom".bright_yellow()
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

pub fn app() -> Router {
    let file_service = create_streamable_http_service(|| Ok(FileServer::new()));
    let error_service = create_streamable_http_service(|| Ok(ErrorFileServer::new()));
    let progress_service = create_streamable_http_service(|| Ok(ProgressFileServer::new()));
    let content_filter_service =
        create_streamable_http_service(|| Ok(ContentFilterFileServer::new()));

    let none_auth_service = create_streamable_http_service(|| Ok(NoneAuthProbeServer::new()));
    let fixed_auth_service = create_streamable_http_service(|| Ok(FixedApiKeyProbeServer::new()));
    let forwarded_access_allowed_service =
        create_streamable_http_service(|| Ok(ForwardedAccessProbeServer::new()));
    let forwarded_oidc_allowed_service =
        create_streamable_http_service(|| Ok(ForwardedOidcProbeServer::new()));
    let empty_tool_service = create_streamable_http_service(|| Ok(EmptyToolServer));
    let none_auth_service_route = none_auth_service.clone();
    let fixed_auth_service_route = fixed_auth_service.clone();
    let fixed_auth_custom_service_route = fixed_auth_service.clone();
    let forwarded_access_allowed_route = forwarded_access_allowed_service.clone();
    let forwarded_access_denied_route = empty_tool_service.clone();
    let forwarded_oidc_allowed_route = forwarded_oidc_allowed_service.clone();
    let forwarded_oidc_denied_route = empty_tool_service.clone();

    Router::new()
        .route("/health", get(health))
        .nest_service("/mcp/file", file_service)
        .nest_service("/mcp/error", error_service)
        .nest_service("/mcp/progress", progress_service)
        .nest_service("/mcp/content-filter", content_filter_service)
        .route(
            "/mcp/auth-none",
            any(move |request| {
                let service = none_auth_service_route.clone();
                async move { serve_without_auth(service, request).await }
            }),
        )
        .route(
            "/mcp/auth-fixed",
            any(move |request| {
                let service = fixed_auth_service_route.clone();
                async move { serve_with_fixed_api_key(service, request).await }
            }),
        )
        .route(
            "/mcp/auth-fixed-custom",
            any(move |request| {
                let service = fixed_auth_custom_service_route.clone();
                async move { serve_with_fixed_api_key_custom_header(service, request).await }
            }),
        )
        .route(
            "/mcp/auth-forwarded-access",
            any(move |request| {
                let allowed_service = forwarded_access_allowed_route.clone();
                let denied_service = forwarded_access_denied_route.clone();
                async move {
                    serve_with_forwarded_access_token(allowed_service, denied_service, request)
                        .await
                }
            }),
        )
        .route(
            "/mcp/auth-forwarded-oidc",
            any(move |request| {
                let allowed_service = forwarded_oidc_allowed_route.clone();
                let denied_service = forwarded_oidc_denied_route.clone();
                async move {
                    serve_with_forwarded_oidc_token(allowed_service, denied_service, request).await
                }
            }),
        )
}

pub async fn serve(addr: SocketAddr) {
    let mechanisms = builtin_mechanisms();
    log_startup(&addr.to_string(), &mechanisms);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind to {}: {}", addr, e));

    axum::serve(listener, app())
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .unwrap_or_else(|e| panic!("Server error: {}", e));
}
