use crate::config::{AppConfig, McpRuntimeConfig};
use crate::db::entity::prelude::FileUploads;
use crate::services::file_storage::SharepointContext;
use crate::services::mcp_session_manager::{
    ManagedTool, McpServerToolEnumeration, McpSessionManager,
};
use crate::state::AppState;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use eyre::{OptionExt, Report, WrapErr, eyre};
use genai::chat::Tool as GenaiTool;
use genai::chat::ToolCall as GenaiToolCall;
use genai::chat::ToolName as GenaiToolName;
use rmcp::model::CallToolRequestParams;
use sea_orm::EntityTrait;
use sea_orm::prelude::Uuid;
use std::collections::HashSet;
use std::sync::Arc;

#[derive(Clone, Copy, Debug, Default)]
pub struct McpRequestAuthContext<'a> {
    pub app_state: Option<&'a AppState>,
    pub user_id: Option<Uuid>,
    pub oidc_token: Option<&'a str>,
    pub access_token: Option<&'a str>,
}

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

#[derive(Debug, Clone, Default)]
pub struct ToolDiscoveryResult {
    pub tools: Vec<ManagedTool>,
    /// Servers that could not be reached or errored: broken from the user's
    /// point of view, nothing they can do about it.
    pub unavailable_server_ids: Vec<String>,
    /// Servers skipped because the requesting user has not completed the
    /// server's OAuth authorization: the user can fix these by connecting.
    /// Kept apart from `unavailable_server_ids` so surfaces can offer the
    /// connect action instead of reporting an outage.
    pub needing_auth_server_ids: Vec<String>,
    /// Servers skipped because this request carried no usable credential for
    /// them: the forwarded token was absent, or the server rejected it. That
    /// is transient from the caller's point of view — the next request may
    /// carry a fresh token — so it is neither an outage nor a connect prompt,
    /// and stays out of the user-facing metadata.
    pub missing_credential_server_ids: Vec<String>,
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

    /// Apply a new evaluated configuration and drop cached sessions only for
    /// servers whose effective connection settings changed.
    pub async fn reconfigure(&self, config: &McpRuntimeConfig) -> Vec<String> {
        self.session_manager.reconfigure(config).await
    }

    pub async fn probe_connection(
        &self,
        server_id: &str,
        auth_context: &McpRequestAuthContext<'_>,
    ) -> crate::services::mcp_session_manager::McpServerConnectionStatus {
        self.session_manager
            .probe_connection(server_id, auth_context)
            .await
    }

    pub async fn invalidate_oauth_sessions_for_token(&self, server_id: &str, access_token: &str) {
        self.session_manager
            .invalidate_oauth_sessions_for_token(server_id, access_token)
            .await;
    }

    /// List one server's tools for the requesting user without tearing the
    /// session down afterwards.
    pub async fn enumerate_tools(
        &self,
        server_id: &str,
        auth_context: &McpRequestAuthContext<'_>,
    ) -> McpServerToolEnumeration {
        self.session_manager
            .enumerate_tools(server_id, auth_context)
            .await
    }

    pub async fn active_session_count(&self, server_id: &str) -> usize {
        self.session_manager.active_session_count(server_id).await
    }

    /// List all available tools for a specific chat
    pub async fn list_tools(
        &self,
        chat_id: Uuid,
        auth_context: &McpRequestAuthContext<'_>,
    ) -> Result<Vec<ManagedTool>, Report> {
        self.session_manager.list_tools(chat_id, auth_context).await
    }

    /// List tools for a chat, optionally restricted to a set of server IDs.
    pub async fn list_tools_for_server_ids(
        &self,
        chat_id: Uuid,
        server_ids: Option<&HashSet<String>>,
        auth_context: &McpRequestAuthContext<'_>,
    ) -> Result<Vec<ManagedTool>, Report> {
        self.session_manager
            .list_tools_for_server_ids(chat_id, server_ids, auth_context)
            .await
    }

    /// Discover tools for a chat while tolerating unavailable MCP servers.
    pub async fn discover_tools_for_server_ids(
        &self,
        chat_id: Uuid,
        server_ids: Option<&HashSet<String>>,
        auth_context: &McpRequestAuthContext<'_>,
    ) -> ToolDiscoveryResult {
        self.session_manager
            .discover_tools_for_server_ids(chat_id, server_ids, auth_context)
            .await
    }

    /// Convert a GenAI tool call to a managed tool call by finding the server that provides the tool
    pub async fn convert_tool_call_to_managed_tool_call(
        &self,
        chat_id: Uuid,
        tool_call: GenaiToolCall,
        auth_context: &McpRequestAuthContext<'_>,
    ) -> Result<ManagedToolCall, Report> {
        let all_tools = self.list_tools(chat_id, auth_context).await?;

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
        auth_context: &McpRequestAuthContext<'_>,
    ) -> Result<rmcp::model::CallToolResult, Report> {
        self.call_tool_with_progress(chat_id, managed_tool_call, auth_context, None)
            .await
    }

    pub async fn call_tool_with_progress(
        &self,
        chat_id: Uuid,
        managed_tool_call: ManagedToolCall,
        auth_context: &McpRequestAuthContext<'_>,
        progress: Option<
            tokio::sync::mpsc::UnboundedSender<rmcp::model::ProgressNotificationParam>,
        >,
    ) -> Result<rmcp::model::CallToolResult, Report> {
        let mut params = CallToolRequestParams::default();
        params.name = managed_tool_call.tool_call.fn_name.clone().into();
        let mut tool_args = managed_tool_call.tool_call.fn_arguments.clone();
        convert_mcp_tool_call_file_fields(
            &serde_json::Value::Object(managed_tool_call.tool.input_schema.as_ref().clone()),
            &mut tool_args,
            auth_context,
        )
        .await?;
        params.arguments = tool_args.as_object().cloned();

        self.session_manager
            .call_tool_with_progress(
                chat_id,
                &managed_tool_call.server_id,
                params,
                auth_context,
                progress,
            )
            .await
    }
}

/// Convert MCP tools to GenAI tools format
pub fn convert_mcp_tools_to_genai_tools(
    managed_mcp_tools: Vec<ManagedTool>,
    omit_tool_strict: bool,
) -> Vec<GenaiTool> {
    managed_mcp_tools
        .into_iter()
        .map(|managed_tool| {
            let tool = managed_tool.tool;

            // Convert Arc<JsonObject> to serde_json::Value
            let mut input_schema_value: serde_json::Value =
                serde_json::Value::Object(tool.input_schema.as_ref().clone());
            let input_capabilities =
                discover_file_mime_capabilities(&input_schema_value, FileMimeDirection::Accepted);
            append_input_mime_descriptions(&mut input_schema_value, &input_capabilities);
            let mut description = tool.description.map(|d| d.to_string());
            let output_capabilities = tool
                .output_schema
                .as_ref()
                .map(|schema| {
                    discover_file_mime_capabilities(
                        &serde_json::Value::Object(schema.as_ref().clone()),
                        FileMimeDirection::Produced,
                    )
                })
                .unwrap_or_default();
            let summary = format_file_capability_summary(&input_capabilities, &output_capabilities);
            if !summary.is_empty() {
                let description = description.get_or_insert_with(String::new);
                if !description.contains("File capabilities:") {
                    if !description.is_empty() {
                        description.push_str("\n\n");
                    }
                    description.push_str("File capabilities: ");
                    description.push_str(&summary);
                }
            }
            remove_schema_declaration(&mut input_schema_value);
            sanitize_tool_schema_extensions(&mut input_schema_value);

            GenaiTool {
                name: GenaiToolName::Custom(tool.name.to_string()),
                description,
                schema: Some(input_schema_value),
                strict: if omit_tool_strict { None } else { Some(false) },
                config: None,
            }
        })
        .collect()
}

fn remove_schema_declaration(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            map.remove("$schema");
            for child in map.values_mut() {
                remove_schema_declaration(child);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                remove_schema_declaration(item);
            }
        }
        _ => {}
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FileMimeDirection {
    Accepted,
    Produced,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileMimeCapability {
    path: String,
    mime_types: Vec<String>,
}

fn discover_file_mime_capabilities(
    schema: &serde_json::Value,
    direction: FileMimeDirection,
) -> Vec<FileMimeCapability> {
    let mut capabilities = Vec::new();
    let mut path = Vec::new();
    let mut visited_refs = HashSet::new();
    collect_file_mime_capabilities(
        schema,
        schema,
        direction,
        &mut path,
        &mut visited_refs,
        &mut capabilities,
    );
    capabilities
}

fn collect_file_mime_capabilities(
    root: &serde_json::Value,
    schema: &serde_json::Value,
    direction: FileMimeDirection,
    path: &mut Vec<String>,
    visited_refs: &mut HashSet<String>,
    out: &mut Vec<FileMimeCapability>,
) {
    if !schema.is_object() {
        return;
    }
    let is_file = [
        "chat.erato/file_content_field",
        "x-chat.erato/file_content_field",
    ]
    .iter()
    .any(|key| schema.get(*key).and_then(serde_json::Value::as_bool) == Some(true));
    if is_file {
        let annotation = match direction {
            FileMimeDirection::Accepted => "chat.erato/accepted_mime_types",
            FileMimeDirection::Produced => "chat.erato/produced_mime_types",
        };
        let alias = format!("x-{annotation}");
        let primary = schema.get(annotation);
        let alias_value = schema.get(&alias);
        let declared = primary.or(alias_value);
        let mut values = declared
            .and_then(serde_json::Value::as_array)
            .filter(|items| !items.is_empty() && items.iter().all(|item| item.as_str().is_some()))
            .map(|items| {
                items
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if primary.is_some() && alias_value.is_some() && primary != alias_value {
            values.clear();
        }
        if primary.is_none()
            && alias_value.is_none()
            && let Some(media_type) = schema
                .get("contentMediaType")
                .and_then(serde_json::Value::as_str)
            && is_exact_mime_type(media_type)
        {
            values.push(media_type.to_ascii_lowercase());
        }
        values = values
            .into_iter()
            .map(|value| value.to_ascii_lowercase())
            .collect();
        if values.iter().any(|value| !is_supported_mime_pattern(value)) {
            values.clear();
        }
        if let Some(media_type) = schema
            .get("contentMediaType")
            .and_then(serde_json::Value::as_str)
            && declared.is_some()
            && (!is_exact_mime_type(media_type)
                || values.as_slice() != [media_type.to_ascii_lowercase()])
        {
            values.clear();
        }
        let mut unique_values = Vec::with_capacity(values.len());
        for value in values {
            if !unique_values.contains(&value) {
                unique_values.push(value);
            }
        }
        let values = unique_values;
        if !values.is_empty() {
            out.push(FileMimeCapability {
                path: if path.is_empty() {
                    "file".to_string()
                } else {
                    path.join(".")
                },
                mime_types: values,
            });
        }
        return;
    }
    if let Some(reference) = schema.get("$ref").and_then(serde_json::Value::as_str)
        && visited_refs.insert(reference.to_string())
    {
        if let Some(resolved) = reference
            .strip_prefix("#")
            .and_then(|pointer| root.pointer(pointer))
        {
            collect_file_mime_capabilities(root, resolved, direction, path, visited_refs, out);
        }
        visited_refs.remove(reference);
    }
    for keyword in ["oneOf", "anyOf", "allOf"] {
        if let Some(branches) = schema.get(keyword).and_then(serde_json::Value::as_array) {
            for (index, branch) in branches.iter().enumerate() {
                path.push(format!("{keyword}[{index}]"));
                collect_file_mime_capabilities(root, branch, direction, path, visited_refs, out);
                path.pop();
            }
        }
    }
    if let Some(properties) = schema
        .get("properties")
        .and_then(serde_json::Value::as_object)
    {
        for (name, child) in properties {
            path.push(name.clone());
            collect_file_mime_capabilities(root, child, direction, path, visited_refs, out);
            path.pop();
        }
    }
    if let Some(items) = schema.get("items") {
        path.push("[]".to_string());
        collect_file_mime_capabilities(root, items, direction, path, visited_refs, out);
        path.pop();
    }
}

fn is_supported_mime_pattern(value: &str) -> bool {
    let Some((major, minor)) = value.split_once('/') else {
        return false;
    };
    let is_token = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"!#$&^_.+-".contains(&byte))
    };
    ((is_token(major) || major == "*") && minor == "*") || (is_token(major) && is_token(minor))
}

fn is_exact_mime_type(value: &str) -> bool {
    is_supported_mime_pattern(value) && !value.split('/').any(|part| part == "*")
}

fn render_mime_list(values: &[String]) -> String {
    let mut unique = Vec::new();
    for value in values {
        if !unique.contains(value) {
            unique.push(value.clone());
        }
    }
    let mut rendered = unique
        .iter()
        .take(10)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    if unique.len() > 10 {
        let omitted = unique.len() - 10;
        rendered.push_str(&format!(
            ", and {omitted} further MIME type{}",
            if omitted == 1 { "" } else { "s" }
        ));
    }
    rendered
}

fn append_input_mime_descriptions(
    schema: &mut serde_json::Value,
    capabilities: &[FileMimeCapability],
) {
    for capability in capabilities {
        if capability.path.contains("[]") || capability.path == "file" {
            continue;
        }
        let parts = capability.path.split('.').collect::<Vec<_>>();
        if let Some(cursor) = schema_at_capability_path_mut(schema, &parts) {
            let branch_context = parts
                .iter()
                .filter(|part| part.contains('['))
                .map(|part| part.replace('[', " branch ").replace(']', ""))
                .collect::<Vec<_>>();
            let field_label = if branch_context.is_empty() {
                "Accepted file MIME types".to_string()
            } else {
                format!("Accepted file MIME types in {}", branch_context.join(" / "))
            };
            let helper = format!(
                "{field_label}: {}.",
                render_mime_list(&capability.mime_types)
            );
            let existing = cursor
                .get("description")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            if !existing.contains(&format!("{field_label}:")) {
                cursor["description"] = serde_json::Value::String(if existing.is_empty() {
                    helper
                } else {
                    format!("{existing} {helper}")
                });
            }
        }
    }
}

fn schema_at_capability_path_mut<'a>(
    schema: &'a mut serde_json::Value,
    parts: &[&str],
) -> Option<&'a mut serde_json::Value> {
    let Some((first, rest)) = parts.split_first() else {
        return Some(schema);
    };
    let child = if let Some((keyword, index)) = first.split_once('[') {
        let index = index.strip_suffix(']')?.parse::<usize>().ok()?;
        schema.get_mut(keyword)?.as_array_mut()?.get_mut(index)?
    } else {
        schema.get_mut("properties")?.get_mut(*first)?
    };
    schema_at_capability_path_mut(child, rest)
}

fn format_file_capability_summary(
    inputs: &[FileMimeCapability],
    outputs: &[FileMimeCapability],
) -> String {
    inputs
        .iter()
        .map(|cap| {
            format!(
                "input {} accepts {}",
                cap.path,
                render_mime_list(&cap.mime_types)
            )
        })
        .chain(outputs.iter().map(|cap| {
            format!(
                "output {} can produce {}",
                cap.path,
                render_mime_list(&cap.mime_types)
            )
        }))
        .collect::<Vec<_>>()
        .join("; ")
}

fn sanitize_tool_schema_extensions(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            let file_content_field = map
                .get("chat.erato/file_content_field")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
                || map
                    .get("x-chat.erato/file_content_field")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
            let content_encoding = map
                .get("contentEncoding")
                .and_then(|value| value.as_str())
                .unwrap_or("");

            if file_content_field && content_encoding == "base64" {
                const BASE64_HELPER: &str = "Expected value: erato-file://<file_upload_id> URI referencing an uploaded file.";
                match map
                    .get_mut("description")
                    .and_then(|description| description.as_str())
                {
                    Some(description) => {
                        if !description.contains(BASE64_HELPER) {
                            let mut combined = description.to_string();
                            if !combined.is_empty() && !combined.ends_with(' ') {
                                combined.push(' ');
                            }
                            combined.push_str(BASE64_HELPER);
                            map.insert(
                                "description".to_string(),
                                serde_json::Value::String(combined),
                            );
                        }
                    }
                    None => {
                        map.insert(
                            "description".to_string(),
                            serde_json::Value::String(BASE64_HELPER.to_string()),
                        );
                    }
                }
            }

            if file_content_field {
                // The model sees an Erato file URI at this field, not the
                // encoded bytes whose media type this keyword describes.
                map.remove("contentMediaType");
            }

            map.remove("chat.erato/file_content_field");
            map.remove("chat.erato/file_name_field");
            map.remove("contentEncoding");
            map.remove("x-chat.erato/file_content_field");
            map.remove("x-chat.erato/file_name_field");
            map.remove("chat.erato/accepted_mime_types");
            map.remove("x-chat.erato/accepted_mime_types");
            map.remove("chat.erato/produced_mime_types");
            map.remove("x-chat.erato/produced_mime_types");
            map.remove("$schema");
            for child in map.values_mut() {
                sanitize_tool_schema_extensions(child);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                sanitize_tool_schema_extensions(item);
            }
        }
        _ => {}
    }
}

#[derive(Clone, Debug)]
enum FileContentPathPart {
    Field(String),
    ArrayItem,
}

fn resolve_schema_ref<'a>(
    root: &'a serde_json::Value,
    reference: &str,
) -> Option<&'a serde_json::Value> {
    if !reference.starts_with("#/") {
        return None;
    }
    root.pointer(&reference[1..])
}

fn collect_file_content_paths(schema: &serde_json::Value) -> Vec<Vec<FileContentPathPart>> {
    let mut paths = Vec::new();
    let mut visited_refs = HashSet::new();
    collect_file_content_paths_inner(
        schema,
        schema,
        &mut Vec::new(),
        &mut paths,
        &mut visited_refs,
    );
    paths
}

fn collect_file_content_paths_inner(
    root: &serde_json::Value,
    schema: &serde_json::Value,
    current_path: &mut Vec<FileContentPathPart>,
    paths: &mut Vec<Vec<FileContentPathPart>>,
    visited_refs: &mut HashSet<String>,
) {
    let file_content_field = schema
        .get("chat.erato/file_content_field")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
        || schema
            .get("x-chat.erato/file_content_field")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
    let content_encoding = schema
        .get("contentEncoding")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    if file_content_field && content_encoding == "base64" {
        paths.push(current_path.clone());
        return;
    }

    if let Some(reference) = schema.get("$ref").and_then(|value| value.as_str()) {
        if !visited_refs.insert(reference.to_string()) {
            return;
        }
        if let Some(resolved) = resolve_schema_ref(root, reference) {
            collect_file_content_paths_inner(root, resolved, current_path, paths, visited_refs);
        }
        visited_refs.remove(reference);
        return;
    }

    for keyword in ["oneOf", "anyOf", "allOf"] {
        if let Some(options) = schema.get(keyword).and_then(|value| value.as_array()) {
            for option in options {
                collect_file_content_paths_inner(root, option, current_path, paths, visited_refs);
            }
        }
    }

    if let Some(properties) = schema.get("properties").and_then(|value| value.as_object()) {
        for (name, subschema) in properties {
            current_path.push(FileContentPathPart::Field(name.clone()));
            collect_file_content_paths_inner(root, subschema, current_path, paths, visited_refs);
            current_path.pop();
        }
    }

    if let Some(items) = schema.get("items") {
        current_path.push(FileContentPathPart::ArrayItem);
        collect_file_content_paths_inner(root, items, current_path, paths, visited_refs);
        current_path.pop();
    }
}

fn expand_paths_for_value(
    value: &serde_json::Value,
    path: &[FileContentPathPart],
    current: &mut Vec<String>,
    out: &mut Vec<Vec<String>>,
) {
    if path.is_empty() {
        out.push(current.clone());
        return;
    }

    match &path[0] {
        FileContentPathPart::Field(field) => {
            if let serde_json::Value::Object(map) = value
                && let Some(next_value) = map.get(field)
            {
                current.push(field.clone());
                expand_paths_for_value(next_value, &path[1..], current, out);
                current.pop();
            }
        }
        FileContentPathPart::ArrayItem => {
            if let serde_json::Value::Array(items) = value {
                for (index, item) in items.iter().enumerate() {
                    current.push(index.to_string());
                    expand_paths_for_value(item, &path[1..], current, out);
                    current.pop();
                }
            }
        }
    }
}

fn expand_value_paths(
    value: &serde_json::Value,
    schema_paths: &[Vec<FileContentPathPart>],
) -> Vec<Vec<String>> {
    let mut results = Vec::new();
    for path in schema_paths {
        expand_paths_for_value(value, path, &mut Vec::new(), &mut results);
    }
    results
}

fn json_pointer_escape(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

fn parse_erato_file_upload_uri(uri: &str) -> Option<Uuid> {
    const ERATO_FILE_URI_PREFIX: &str = "erato-file://";
    let file_id = uri.strip_prefix(ERATO_FILE_URI_PREFIX)?;

    Uuid::parse_str(file_id).ok()
}

async fn resolve_file_upload_to_base64(
    app_state: &AppState,
    file_upload_id: Uuid,
    access_token: Option<&str>,
) -> Result<String, Report> {
    let file_upload = FileUploads::find_by_id(file_upload_id)
        .one(&app_state.db)
        .await
        .wrap_err("Failed to load file upload for MCP tool call")?
        .ok_or_eyre("Referenced file upload not found for MCP tool call")?;

    let file_storage = app_state
        .file_storage_providers
        .get(&file_upload.file_storage_provider_id)
        .ok_or_eyre("File storage provider for MCP tool call not found")?;

    let sharepoint_ctx = access_token.map(|token| SharepointContext {
        access_token: token,
    });

    let file_bytes = file_storage
        .read_file_to_bytes_with_context(&file_upload.file_storage_path, sharepoint_ctx.as_ref())
        .await
        .wrap_err("Failed to read file for MCP tool call")?;

    Ok(STANDARD.encode(file_bytes))
}

async fn convert_mcp_tool_call_file_fields(
    input_schema: &serde_json::Value,
    tool_call_arguments: &mut serde_json::Value,
    auth_context: &McpRequestAuthContext<'_>,
) -> Result<(), Report> {
    let schema_paths = collect_file_content_paths(input_schema);
    if schema_paths.is_empty() {
        return Ok(());
    }

    let value_paths = expand_value_paths(tool_call_arguments, &schema_paths);
    if value_paths.is_empty() {
        return Ok(());
    }

    let Some(app_state) = auth_context.app_state else {
        return Ok(());
    };

    for path in value_paths {
        let pointer = if path.is_empty() {
            String::new()
        } else {
            format!(
                "/{}",
                path.iter()
                    .map(|segment| json_pointer_escape(segment))
                    .collect::<Vec<_>>()
                    .join("/")
            )
        };

        let pointer_text = tool_call_arguments
            .pointer(&pointer)
            .and_then(|value| value.as_str());
        let Some(pointer_text) = pointer_text else {
            continue;
        };

        let Some(file_upload_id) = parse_erato_file_upload_uri(pointer_text) else {
            continue;
        };

        let encoded =
            resolve_file_upload_to_base64(app_state, file_upload_id, auth_context.access_token)
                .await?;

        if let Some(target) = tool_call_arguments.pointer_mut(&pointer) {
            *target = serde_json::Value::String(encoded);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        FileContentPathPart, FileMimeDirection, append_input_mime_descriptions,
        collect_file_content_paths, discover_file_mime_capabilities, expand_value_paths,
        format_file_capability_summary, json_pointer_escape, parse_erato_file_upload_uri,
        remove_schema_declaration, render_mime_list, sanitize_tool_schema_extensions,
    };
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn remove_schema_declaration_removes_all_occurrences() {
        let mut value = json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {
                "nested": {
                    "$schema": "https://example.com/other",
                    "type": "string"
                }
            },
            "anyOf": [
                { "$schema": "https://example.com/array-item", "type": "null" }
            ]
        });

        remove_schema_declaration(&mut value);

        assert!(value.get("$schema").is_none());
        assert!(value["properties"]["nested"].get("$schema").is_none());
        assert!(value["anyOf"][0].get("$schema").is_none());
    }

    #[test]
    fn sanitize_tool_schema_extensions_removes_unsupported_properties() {
        let mut value = json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {
                "value": {
                    "type": "string",
                    "chat.erato/file_content_field": true,
                    "contentEncoding": "base64",
                    "contentMediaType": "application/octet-stream",
                    "x-chat.erato/file_content_field": true,
                    "properties": {
                        "inner": {
                            "chat.erato/file_content_field": true,
                            "contentEncoding": "base64",
                            "type": "string"
                        }
                    }
                },
                "file_name": {
                    "type": "string",
                    "chat.erato/file_name_field": true,
                    "x-chat.erato/file_name_field": true
                },
                "ordinary_encoded_string": {
                    "type": "string",
                    "contentMediaType": "image/png"
                }
            }
        });

        sanitize_tool_schema_extensions(&mut value);

        assert!(value.get("chat.erato/file_content_field").is_none());
        assert!(value.get("contentEncoding").is_none());
        let nested = value["properties"]["value"].as_object().unwrap();
        assert!(nested.get("chat.erato/file_content_field").is_none());
        assert!(nested.get("contentEncoding").is_none());
        assert!(nested.get("contentMediaType").is_none());
        assert!(nested.get("x-chat.erato/file_content_field").is_none());
        let file_name = value["properties"]["file_name"].as_object().unwrap();
        assert!(file_name.get("chat.erato/file_name_field").is_none());
        assert!(file_name.get("x-chat.erato/file_name_field").is_none());
        assert_eq!(
            value["properties"]["ordinary_encoded_string"]["contentMediaType"],
            "image/png"
        );
        assert_eq!(
            nested.get("description").and_then(|value| value.as_str()),
            Some("Expected value: erato-file://<file_upload_id> URI referencing an uploaded file.")
        );
        let inner = nested["properties"]["inner"].as_object().unwrap();
        assert!(inner.get("chat.erato/file_content_field").is_none());
        assert!(inner.get("contentEncoding").is_none());
        assert_eq!(
            inner.get("description").and_then(|value| value.as_str()),
            Some("Expected value: erato-file://<file_upload_id> URI referencing an uploaded file.")
        );
    }

    #[test]
    fn discovers_input_and_output_types_with_fallbacks_and_refs() {
        let input = json!({
            "type": "object",
            "$defs": {"upload": {"type": "string", "chat.erato/file_content_field": true,
                "chat.erato/accepted_mime_types": ["text/plain", "text/markdown"]}},
            "properties": {"source": {"$ref": "#/$defs/upload"}}
        });
        let output = json!({
            "type": "object",
            "properties": {"result": {"type": "string", "chat.erato/file_content_field": true,
                "contentMediaType": "application/pdf"}}
        });
        let accepted = discover_file_mime_capabilities(&input, FileMimeDirection::Accepted);
        let produced = discover_file_mime_capabilities(&output, FileMimeDirection::Produced);
        assert_eq!(accepted[0].mime_types, ["text/plain", "text/markdown"]);
        assert_eq!(accepted[0].path, "source");
        assert_eq!(produced[0].mime_types, ["application/pdf"]);
        assert_eq!(produced[0].path, "result");
    }

    #[test]
    fn invalid_or_conflicting_declarations_remain_unknown() {
        let schema = json!({"type":"object","properties": {
            "empty":{"type":"string","chat.erato/file_content_field":true,"chat.erato/accepted_mime_types":[]},
            "invalid":{"type":"string","chat.erato/file_content_field":true,"chat.erato/accepted_mime_types":["bad"]},
            "conflict":{"type":"string","chat.erato/file_content_field":true,
                "chat.erato/accepted_mime_types":["text/plain"],"x-chat.erato/accepted_mime_types":["image/png"]},
            "mismatch":{"type":"string","chat.erato/file_content_field":true,
                "contentMediaType":"application/pdf","chat.erato/accepted_mime_types":["text/plain"]}
        }});
        assert!(discover_file_mime_capabilities(&schema, FileMimeDirection::Accepted).is_empty());
    }

    #[test]
    fn mime_listing_is_deduplicated_and_bounded_with_exact_remainder() {
        let values = (0..20)
            .map(|i| format!("application/x-{i}"))
            .collect::<Vec<_>>();
        assert_eq!(render_mime_list(&values[..10]), values[..10].join(", "));
        assert!(render_mime_list(&values[..11]).ends_with("and 1 further MIME type"));
        assert!(render_mime_list(&values).ends_with("and 10 further MIME types"));
        let repeated = vec![values[0].clone(), values[0].clone()];
        assert_eq!(render_mime_list(&repeated), values[0]);
    }

    #[test]
    fn mime_guidance_is_added_to_input_schema_and_tool_summary() {
        let mut input = json!({"type":"object","properties":{"source":{"type":"string",
            "description":"Source file","contentEncoding":"base64","chat.erato/file_content_field":true,
            "chat.erato/accepted_mime_types":["text/plain"]}}});
        let output = json!({"type":"object","properties":{"data":{"type":"string",
            "chat.erato/file_content_field":true,"chat.erato/produced_mime_types":["application/pdf"]}}});
        let accepted = discover_file_mime_capabilities(&input, FileMimeDirection::Accepted);
        let produced = discover_file_mime_capabilities(&output, FileMimeDirection::Produced);
        append_input_mime_descriptions(&mut input, &accepted);
        assert_eq!(
            input["properties"]["source"]["description"],
            "Source file Accepted file MIME types: text/plain."
        );
        assert!(
            format_file_capability_summary(&accepted, &produced)
                .contains("output data can produce application/pdf")
        );

        let input_obj = input.as_object().unwrap().clone();
        let output_obj = output.as_object().unwrap().clone();
        let mcp_tool = rmcp::model::Tool::new("convert_document", "Convert document", input_obj)
            .with_raw_output_schema(Arc::new(output_obj));
        let converted = super::convert_mcp_tools_to_genai_tools(
            vec![super::ManagedTool {
                server_id: "docs".to_string(),
                tool: mcp_tool,
            }],
            false,
        );
        assert!(
            converted[0]
                .description
                .as_deref()
                .unwrap()
                .contains("output data can produce application/pdf")
        );
        assert!(
            converted[0].schema.as_ref().unwrap()["properties"]["source"]["description"]
                .as_str()
                .unwrap()
                .contains("Expected value: erato-file://")
        );
        assert!(
            converted[0].schema.as_ref().unwrap()["properties"]["source"]["description"]
                .as_str()
                .unwrap()
                .contains("Accepted file MIME types: text/plain")
        );
    }

    #[test]
    fn collect_file_content_paths_follows_refs_and_arrays() {
        let schema = json!({
            "type": "object",
            "properties": {
                "files": {
                    "type": "array",
                    "items": { "$ref": "#/$defs/File" }
                }
            },
            "$defs": {
                "File": {
                    "type": "object",
                    "properties": {
                        "content": {
                            "chat.erato/file_content_field": true,
                            "contentEncoding": "base64",
                            "type": "string"
                        },
                        "name": { "type": "string" }
                    }
                }
            }
        });

        let paths = collect_file_content_paths(&schema);
        let rendered = paths
            .into_iter()
            .map(|path| {
                format!(
                    "/{}",
                    path.iter()
                        .map(|part| match part {
                            FileContentPathPart::Field(field) => json_pointer_escape(field),
                            FileContentPathPart::ArrayItem => "0".to_string(),
                        })
                        .collect::<Vec<_>>()
                        .join("/")
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(rendered, vec!["/files/0/content"]);
    }

    #[test]
    fn expand_value_paths_matches_array_elements() {
        let schema_paths = vec![vec![
            FileContentPathPart::Field("files".to_string()),
            FileContentPathPart::ArrayItem,
            FileContentPathPart::Field("content".to_string()),
        ]];
        let value = json!({
            "files": [
                { "content": "erato-file://11111111-1111-1111-1111-111111111111" },
                { "content": "erato-file://22222222-2222-2222-2222-222222222222" }
            ]
        });

        let expanded = expand_value_paths(&value, &schema_paths);
        assert_eq!(
            expanded,
            vec![
                vec!["files".to_string(), "0".to_string(), "content".to_string()],
                vec!["files".to_string(), "1".to_string(), "content".to_string()]
            ]
        );
    }

    #[test]
    fn parse_erato_file_upload_uri_extracts_uuid() {
        assert!(
            parse_erato_file_upload_uri("erato-file://11111111-1111-1111-1111-111111111111")
                .is_some()
        );
        assert!(parse_erato_file_upload_uri("not-a-file-uri").is_none());
    }
}
