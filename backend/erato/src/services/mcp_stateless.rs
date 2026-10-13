//! Request-scoped modern MCP. Only HTTP pools and metadata survive an operation.
//! Legacy protocol services continue to live in McpSessionManager.
use super::mcp_manager::McpRequestAuthContext;
use super::mcp_transports::{apply_auth_headers, oauth_default_headers};
use crate::config::{McpProtocolMode, McpServerConfig};
use base64::{Engine, engine::general_purpose::STANDARD};
use eyre::{Report, eyre};
use reqwest::header::{HeaderMap, HeaderValue};
use rmcp::model::{
    CallToolRequestParams, CallToolResult, ListToolsResult, ProgressNotificationParam, Tool,
};
use rmcp::transport::streamable_http_client::{StreamableHttpClient, StreamableHttpError};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, mpsc::UnboundedSender};
use tokio::time::Instant;

const VERSION: &str = "2026-07-28";
const DEFAULT_TTL: Duration = Duration::from_secs(30);
const MAX_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_PARTITIONS: usize = 512;

#[derive(Debug, Clone)]
pub(super) struct RequestError {
    pub status: Option<u16>,
    code: Option<i64>,
    message: String,
    transport_failure: bool,
}

impl std::fmt::Display for RequestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "MCP request failed (HTTP {:?}, RPC {:?}): {}",
            self.status, self.code, self.message
        )
    }
}

impl std::error::Error for RequestError {}

impl RequestError {
    fn protocol(message: impl Into<String>) -> Self {
        Self {
            status: None,
            code: None,
            message: message.into(),
            transport_failure: false,
        }
    }

    fn from_transport(error: StreamableHttpError<reqwest::Error>) -> Self {
        let status = match &error {
            StreamableHttpError::AuthRequired(_) => Some(401),
            StreamableHttpError::InsufficientScope(_) => Some(403),
            StreamableHttpError::Client(error) => error.status().map(|s| s.as_u16()),
            // rmcp currently exposes other HTTP failures as a formatted message.
            StreamableHttpError::UnexpectedServerResponse(message) => message
                .strip_prefix("HTTP ")
                .and_then(|rest| rest.split_whitespace().next())
                .and_then(|code| code.parse().ok()),
            _ => None,
        };
        let transport_failure = matches!(&error, StreamableHttpError::Client(error) if error.is_connect() || error.is_timeout());
        Self {
            status,
            code: None,
            message: error.to_string(),
            transport_failure,
        }
    }

    fn transient(&self) -> bool {
        self.transport_failure || self.status.is_some_and(|s| s == 429 || s >= 500)
    }

    fn legacy(&self) -> bool {
        // Modern errors identify the era even on HTTP 400/404.
        if self.code.is_some_and(|c| (-32099..=-32020).contains(&c)) {
            return false;
        }
        // rmcp discards the HTTP status for JSON-RPC error bodies. Only
        // method-not-found is an unambiguous legacy discovery response.
        matches!(self.status, Some(400 | 404 | 405))
            || (self.status.is_none_or(|s| (200..300).contains(&s))
                && matches!(self.code, Some(-32601)))
    }
}

#[derive(Debug, Clone)]
struct Snapshot {
    tools: Vec<Tool>,
    expires: Instant,
}

#[derive(Debug, Default)]
struct Partition {
    mode: Option<(bool, Instant)>,
    tools: Option<Snapshot>,
    failure: Option<(RequestError, Instant)>,
    denied: bool,
}

#[derive(Debug)]
pub(super) struct HttpServer {
    pub config: McpServerConfig,
    client: reqwest::Client,
    partitions: Mutex<HashMap<[u8; 32], Arc<Mutex<Partition>>>>,
    public_tools: Mutex<Option<Snapshot>>,
}

// Headers never enter Debug output; the cache identity is an opaque digest.
pub(super) struct HttpRequest {
    server: Arc<HttpServer>,
    headers: HeaderMap,
    partition: Arc<Mutex<Partition>>,
}

impl HttpServer {
    pub fn new(config: McpServerConfig) -> Result<Self, Report> {
        Ok(Self {
            config,
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .build()?,
            partitions: Mutex::new(HashMap::new()),
            public_tools: Mutex::new(None),
        })
    }

    pub async fn request_context(
        self: &Arc<Self>,
        server_id: &str,
        auth: &McpRequestAuthContext<'_>,
    ) -> Result<HttpRequest, Report> {
        let mut headers = oauth_default_headers(&self.config)?;
        apply_auth_headers(&mut headers, server_id, &self.config, auth).await?;
        // Include all configured/credential headers: custom authentication headers
        // must partition just as strictly as Authorization.
        let mut entries = headers.iter().collect::<Vec<_>>();
        entries.sort_by_key(|(name, _)| name.as_str());
        let mut digest = Sha256::new();
        for (name, value) in entries {
            digest.update(name.as_str().as_bytes());
            digest.update([0]);
            digest.update(value.as_bytes());
            digest.update([0]);
        }
        let key: [u8; 32] = digest.finalize().into();
        let mut partitions = self.partitions.lock().await;
        if partitions.len() >= MAX_PARTITIONS && !partitions.contains_key(&key) {
            // Evict only idle entries. In-flight refreshes retain their identity.
            partitions.retain(|_, value| Arc::strong_count(value) > 1);
            if partitions.len() >= MAX_PARTITIONS {
                return Err(eyre!("Too many concurrent MCP authentication contexts"));
            }
        }
        let partition = partitions.entry(key).or_default().clone();
        Ok(HttpRequest {
            server: self.clone(),
            headers,
            partition,
        })
    }
}

impl HttpRequest {
    pub async fn is_stateless(&self) -> Result<bool, Report> {
        match self.server.config.protocol_mode {
            McpProtocolMode::Legacy => return Ok(false),
            McpProtocolMode::Stateless => return Ok(true),
            McpProtocolMode::Auto => {}
        }
        let mut state = self.partition.lock().await;
        if let Some((modern, expires)) = state.mode
            && expires > Instant::now()
        {
            return Ok(modern);
        }
        let response = tokio::time::timeout(
            Duration::from_secs(3),
            self.rpc("server/discover", json!({}), None),
        )
        .await;
        let modern = match response {
            Ok(Ok(result)) => {
                let versions = result
                    .get("supportedVersions")
                    .and_then(Value::as_array)
                    .ok_or_else(|| eyre!("MCP discovery omitted supportedVersions"))?;
                if versions.iter().any(|v| v == VERSION) {
                    true
                } else if versions.iter().any(|v| {
                    matches!(
                        v.as_str(),
                        Some("2025-11-25" | "2025-06-18" | "2025-03-26" | "2024-11-05")
                    )
                }) {
                    false
                } else {
                    return Err(eyre!("No compatible MCP protocol version"));
                }
            }
            Ok(Err(error)) if error.legacy() => false,
            Ok(Err(error)) => return Err(error.into()),
            // Some older servers ignore unknown requests. A bounded probe leaves
            // time for initialization within the roster's overall deadline.
            Err(_) => false,
        };
        state.mode = Some((modern, Instant::now() + Duration::from_secs(300)));
        Ok(modern)
    }

    pub async fn list_tools(&self, fresh: bool) -> Result<Vec<Tool>, Report> {
        let mut state = self.partition.lock().await;
        if !fresh {
            if let Some(snapshot) = &state.tools
                && snapshot.expires > Instant::now()
            {
                return Ok(snapshot.tools.clone());
            }
            if let Some(snapshot) = &*self.server.public_tools.lock().await
                && !state.denied
                && snapshot.expires > Instant::now()
            {
                return Ok(snapshot.tools.clone());
            }
            if let Some((error, until)) = &state.failure
                && *until > Instant::now()
            {
                return Err(error.clone().into());
            }
        }
        let result = tokio::time::timeout(Duration::from_secs(10), self.fetch_tools())
            .await
            .unwrap_or_else(|_| Err(RequestError::protocol("tools/list timed out")));
        match result {
            Ok((snapshot, public)) => {
                state.failure = None;
                state.denied = false;
                let tools = snapshot.tools.clone();
                if public {
                    state.tools = None;
                    *self.server.public_tools.lock().await = Some(snapshot);
                } else {
                    // A scope change must not leave an older public snapshot usable.
                    *self.server.public_tools.lock().await = None;
                    state.tools = Some(snapshot);
                }
                Ok(tools)
            }
            Err(error) => {
                if error.code == Some(-32022) {
                    state.mode = None;
                }
                // Retain last-good snapshots but never renew their freshness.
                // Failure coalescing is per credential, never public.
                if !matches!(error.status, Some(401 | 403)) {
                    let delay = Duration::from_secs(1);
                    state.failure = Some((error.clone(), Instant::now() + delay));
                } else {
                    state.tools = None;
                    state.failure = None;
                    state.denied = true;
                }
                Err(error.into())
            }
        }
    }

    async fn fetch_tools(&self) -> Result<(Snapshot, bool), RequestError> {
        let mut tools = Vec::new();
        let mut cursor = None;
        let mut cursors = HashSet::new();
        let mut expires = Instant::now() + MAX_TTL;
        let mut public = true;
        for _ in 0..1000 {
            let params = match &cursor {
                Some(value) => json!({"cursor": value}),
                None => json!({}),
            };
            let first = self.rpc("tools/list", params.clone(), None).await;
            let result = match first {
                Err(error) if error.transient() => {
                    // rmcp does not expose Retry-After; use one bounded retry.
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    self.rpc("tools/list", params, None).await?
                }
                result => result?,
            };
            let mut result = result;
            if !matches!(result["cacheScope"].as_str(), Some("public" | "private"))
                && let Some(object) = result.as_object_mut()
            {
                object.remove("cacheScope");
            }
            let page: ListToolsResult = serde_json::from_value(result)
                .map_err(|e| RequestError::protocol(format!("Invalid tool list: {e}")))?;
            expires = expires.min(
                Instant::now()
                    + page
                        .ttl_ms
                        .map(Duration::from_millis)
                        .unwrap_or(DEFAULT_TTL)
                        .min(MAX_TTL),
            );
            public &= matches!(page.cache_scope, Some(rmcp::model::CacheScope::Public));
            tools.extend(page.tools);
            if tools.len() > 10_000 {
                return Err(RequestError::protocol("MCP tool catalog too large"));
            }
            cursor = page.next_cursor;
            if cursor.is_none() {
                tools.sort_by(|a, b| a.name.cmp(&b.name));
                return Ok((Snapshot { tools, expires }, public));
            }
            if !cursors.insert(cursor.clone()) {
                return Err(RequestError::protocol(
                    "Repeated tools/list pagination cursor",
                ));
            }
        }
        Err(RequestError::protocol(
            "MCP tool list exceeded pagination limit",
        ))
    }

    pub async fn call_tool(
        &self,
        params: CallToolRequestParams,
        progress: Option<UnboundedSender<ProgressNotificationParam>>,
    ) -> Result<CallToolResult, Report> {
        let tools = self.list_tools(false).await?;
        if !tools.iter().any(|tool| tool.name == params.name) {
            return Err(eyre!("MCP tool is absent from the current tool catalog"));
        }
        let result = self
            .rpc("tools/call", serde_json::to_value(params)?, progress)
            .await;
        if let Err(error) = &result {
            let mut state = self.partition.lock().await;
            if error.code == Some(-32022) {
                state.mode = None;
            }
            if matches!(error.status, Some(401 | 403)) {
                state.tools = None;
                state.denied = true;
            }
        }
        // Never replay calls: a failed stream may follow a completed write.
        Ok(serde_json::from_value(result?)?)
    }

    async fn rpc(
        &self,
        method: &str,
        mut params: Value,
        progress: Option<UnboundedSender<ProgressNotificationParam>>,
    ) -> Result<Value, RequestError> {
        let id = sea_orm::prelude::Uuid::new_v4().to_string();
        let meta = params
            .as_object_mut()
            .ok_or_else(|| RequestError::protocol("Invalid request parameters"))?
            .entry("_meta")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or_else(|| RequestError::protocol("Invalid request metadata"))?;
        meta.insert(
            "io.modelcontextprotocol/protocolVersion".into(),
            json!(VERSION),
        );
        meta.insert(
            "io.modelcontextprotocol/clientCapabilities".into(),
            json!({}),
        );
        meta.insert(
            "io.modelcontextprotocol/clientInfo".into(),
            json!({"name": "erato", "version": env!("CARGO_PKG_VERSION")}),
        );
        meta.insert("progressToken".into(), json!(id));
        let mut headers = self.headers.clone();
        // Protocol fields cannot be overridden by configured headers.
        headers.remove("mcp-session-id");
        headers.remove("last-event-id");
        headers.remove("mcp-name");
        let parameter_headers = headers
            .keys()
            .filter(|name| name.as_str().starts_with("mcp-param-"))
            .cloned()
            .collect::<Vec<_>>();
        for name in parameter_headers {
            headers.remove(name);
        }
        headers.insert("mcp-protocol-version", HeaderValue::from_static(VERSION));
        headers.insert("mcp-method", HeaderValue::from_str(method).unwrap());
        if let Some(name) = params.get("name").and_then(Value::as_str) {
            headers.insert("mcp-name", encode_header(name)?);
        }
        let message = serde_json::from_value(json!({
            "jsonrpc": "2.0", "id": id, "method": method, "params": params
        }))
        .map_err(|error| RequestError::protocol(error.to_string()))?;
        // Use rmcp's HTTP/SSE implementation directly, without a retained worker
        // or session. Cancellation drops the POST/response future. The SDK's
        // response helper drains notifications preceding the first result.
        let response = self
            .server
            .client
            .post_message(
                self.server.config.url.clone().into(),
                message,
                None,
                None,
                headers
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
            )
            .await
            .map_err(RequestError::from_transport)?;
        let (message, _) = response
            .expect_initialized::<reqwest::Error>()
            .await
            .map_err(RequestError::from_transport)?;
        let message = serde_json::to_value(message)
            .map_err(|error| RequestError::protocol(error.to_string()))?;
        process_message(message, &id, progress.as_ref())?
            .ok_or_else(|| RequestError::protocol("Expected MCP result"))
    }
}

fn process_message(
    message: Value,
    id: &str,
    progress: Option<&UnboundedSender<ProgressNotificationParam>>,
) -> Result<Option<Value>, RequestError> {
    if message["jsonrpc"] != "2.0" {
        return Err(RequestError::protocol("Invalid JSON-RPC version"));
    }
    if message.get("method").is_some() {
        if message.get("id").is_some() {
            return Err(RequestError::protocol(
                "Unsupported server-initiated MCP request",
            ));
        }
        if message["method"] == "notifications/progress" && message["params"]["progressToken"] == id
        {
            let update = serde_json::from_value(message["params"].clone())
                .map_err(|e| RequestError::protocol(format!("Invalid progress: {e}")))?;
            if let Some(sender) = progress {
                let _ = sender.send(update);
            }
        }
        return Ok(None);
    }
    if message["id"] != id && !(message["id"].is_null() && message.get("error").is_some()) {
        return Err(RequestError::protocol("Uncorrelated MCP response"));
    }
    if let Some(error) = message.get("error") {
        return Err(RequestError {
            // rmcp synthesizes this error for non-JSON legacy HTTP failures.
            status: error["message"]
                .as_str()
                .and_then(|message| message.strip_prefix("server/discover rejected with HTTP "))
                .and_then(|rest| rest.split_whitespace().next())
                .and_then(|status| status.parse().ok()),
            code: error["code"].as_i64(),
            message: error["message"]
                .as_str()
                .unwrap_or("JSON-RPC error")
                .to_owned(),
            transport_failure: false,
        });
    }
    let result = message
        .get("result")
        .ok_or_else(|| RequestError::protocol("Missing MCP result"))?;
    if result.get("resultType").is_some_and(|v| v != "complete") {
        return Err(RequestError::protocol(
            "Unsupported MCP interactive result type",
        ));
    }
    Ok(Some(result.clone()))
}

// rmcp's standard-header encoder is crate-private. Keep only the wire encoding
// needed for Mcp-Name; parameter-header schema tracking stays SDK-limited.
fn encode_header(value: &str) -> Result<HeaderValue, RequestError> {
    let encoded = if value.trim() != value
        || !value.bytes().all(|b| (0x20..=0x7e).contains(&b))
        || (value.starts_with("=?base64?") && value.ends_with("?="))
    {
        format!("=?base64?{}?=", STANDARD.encode(value))
    } else {
        value.to_owned()
    };
    HeaderValue::from_str(&encoded).map_err(|_| RequestError::protocol("Invalid MCP header"))
}

#[cfg(test)]
#[path = "mcp_stateless_tests.rs"]
mod tests;
