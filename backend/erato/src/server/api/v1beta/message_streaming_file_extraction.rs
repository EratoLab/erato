use crate::models::message::{
    ContentPart, ContentPartImageFilePointer, ContentPartTextFilePointer, GenerationErrorType,
};
use crate::policy::engine::PolicyEngine;
use crate::policy::types::Subject;
use crate::state::AppState;
use eyre::{Report, WrapErr, eyre};
use genai::chat::{ToolCall, ToolResponse};
use sea_orm::JsonValue;
use sea_orm::prelude::Uuid;
use serde_json::Value;
use serde_json::json;
use std::collections::HashSet;
use std::time::SystemTime;

#[derive(Clone, Debug)]
enum FileContentPathPart {
    Field { name: String, required: bool },
    ArrayItem,
}

#[derive(Clone, Debug)]
struct FileContentPath {
    parts: Vec<FileContentPathPart>,
    file_name_fields: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct ExtractedFileField {
    json_pointer: String,
    mime_type: String,
    base64_data: String,
    file_name: Option<String>,
}

pub struct McpToolPostProcessResult {
    pub tool_response: ToolResponse,
    pub output_value: Option<JsonValue>,
    pub file_content_parts: Vec<ContentPart>,
}

fn json_pointer_escape(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

fn resolve_schema_ref<'a>(root: &'a Value, reference: &str) -> Option<&'a Value> {
    if !reference.starts_with("#/") {
        return None;
    }
    root.pointer(&reference[1..])
}

fn has_schema_annotation(schema: &Value, annotation: &str) -> bool {
    let prefixed_annotation = format!("x-{annotation}");
    schema.get(annotation).and_then(Value::as_bool) == Some(true)
        || schema
            .get(prefixed_annotation.as_str())
            .and_then(Value::as_bool)
            == Some(true)
}

fn collect_file_content_paths(schema: &Value) -> Vec<FileContentPath> {
    let mut paths = Vec::new();
    let mut visited_refs = HashSet::new();
    collect_file_content_paths_inner(
        schema,
        schema,
        &mut Vec::new(),
        &[],
        &mut paths,
        &mut visited_refs,
    );
    paths
}

fn collect_file_content_paths_inner(
    root: &Value,
    schema: &Value,
    current_path: &mut Vec<FileContentPathPart>,
    sibling_file_name_fields: &[String],
    paths: &mut Vec<FileContentPath>,
    visited_refs: &mut HashSet<String>,
) {
    if has_schema_annotation(schema, "chat.erato/file_content_field") {
        paths.push(FileContentPath {
            parts: current_path.clone(),
            file_name_fields: sibling_file_name_fields.to_vec(),
        });
        return;
    }

    if let Some(reference) = schema.get("$ref").and_then(|value| value.as_str()) {
        if !visited_refs.insert(reference.to_string()) {
            return;
        }
        if let Some(resolved) = resolve_schema_ref(root, reference) {
            collect_file_content_paths_inner(
                root,
                resolved,
                current_path,
                sibling_file_name_fields,
                paths,
                visited_refs,
            );
        }
        visited_refs.remove(reference);
        return;
    }

    for keyword in ["oneOf", "anyOf", "allOf"] {
        if let Some(options) = schema.get(keyword).and_then(|value| value.as_array()) {
            for option in options {
                collect_file_content_paths_inner(
                    root,
                    option,
                    current_path,
                    sibling_file_name_fields,
                    paths,
                    visited_refs,
                );
            }
        }
    }

    if let Some(properties) = schema.get("properties").and_then(|value| value.as_object()) {
        let file_name_fields = properties
            .iter()
            .filter(|(_, subschema)| has_schema_annotation(subschema, "chat.erato/file_name_field"))
            .map(|(name, _)| name.clone())
            .collect::<Vec<_>>();

        for (name, subschema) in properties {
            let required = schema
                .get("required")
                .and_then(Value::as_array)
                .is_some_and(|fields| fields.iter().any(|field| field.as_str() == Some(name)));
            current_path.push(FileContentPathPart::Field {
                name: name.clone(),
                required,
            });
            collect_file_content_paths_inner(
                root,
                subschema,
                current_path,
                &file_name_fields,
                paths,
                visited_refs,
            );
            current_path.pop();
        }
    }

    if let Some(items) = schema.get("items") {
        current_path.push(FileContentPathPart::ArrayItem);
        collect_file_content_paths_inner(root, items, current_path, &[], paths, visited_refs);
        current_path.pop();
    }
}

fn expand_paths_for_value(
    value: &Value,
    path: &[FileContentPathPart],
    current: &mut Vec<String>,
    out: &mut Vec<Vec<String>>,
) -> Result<(), Report> {
    if path.is_empty() {
        out.push(current.clone());
        return Ok(());
    }

    match &path[0] {
        FileContentPathPart::Field { name, required } => {
            let object = value
                .as_object()
                .ok_or_else(|| eyre!("File content field parent is not an object"))?;
            let Some(next_value) = object.get(name) else {
                if *required {
                    return Err(eyre!("Missing file content field '{}'", name));
                }
                // Only absence is optional; present values still need validation.
                return Ok(());
            };
            current.push(name.clone());
            let result = expand_paths_for_value(next_value, &path[1..], current, out);
            current.pop();
            result?;
        }
        FileContentPathPart::ArrayItem => {
            let items = value
                .as_array()
                .ok_or_else(|| eyre!("File content field parent is not an array"))?;
            // An empty array is a valid zero-file result. Continue validating other
            // annotated paths so malformed entries cannot be hidden beside it.
            for (index, item) in items.iter().enumerate() {
                current.push(index.to_string());
                let result = expand_paths_for_value(item, &path[1..], current, out);
                current.pop();
                result?;
            }
        }
    }

    Ok(())
}

fn expand_value_paths(
    value: &Value,
    schema_paths: &[Vec<FileContentPathPart>],
) -> Result<Vec<Vec<String>>, Report> {
    let mut results = Vec::new();
    for path in schema_paths {
        expand_paths_for_value(value, path, &mut Vec::new(), &mut results)?;
    }
    Ok(results)
}

fn extract_mcp_file_fields(
    output_schema: &Value,
    output_value: &Value,
) -> Result<Vec<ExtractedFileField>, Report> {
    let schema_paths = collect_file_content_paths(output_schema);
    if schema_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut expanded_paths = Vec::new();
    for schema_path in &schema_paths {
        for value_path in
            expand_value_paths(output_value, std::slice::from_ref(&schema_path.parts))?
        {
            expanded_paths.push((value_path, &schema_path.file_name_fields));
        }
    }

    let mut extracted = Vec::new();

    for (path, file_name_fields) in expanded_paths {
        let pointer = format!(
            "/{}",
            path.iter()
                .map(|segment| json_pointer_escape(segment))
                .collect::<Vec<_>>()
                .join("/")
        );
        let parent_pointer = if path.len() > 1 {
            format!(
                "/{}",
                path[..path.len() - 1]
                    .iter()
                    .map(|segment| json_pointer_escape(segment))
                    .collect::<Vec<_>>()
                    .join("/")
            )
        } else {
            String::new()
        };

        let parent_value = if parent_pointer.is_empty() {
            output_value
        } else {
            output_value
                .pointer(&parent_pointer)
                .ok_or_else(|| eyre!("Missing parent value for file content field"))?
        };

        let parent_object = parent_value
            .as_object()
            .ok_or_else(|| eyre!("File content field parent is not an object"))?;

        let mime_type = parent_object
            .get("mime_type")
            .or_else(|| parent_object.get("content_type"))
            .and_then(|value| value.as_str())
            .ok_or_else(|| eyre!("Missing mime_type for MCP file output"))?;

        let base64_value = output_value
            .pointer(&pointer)
            .and_then(|value| value.as_str())
            .ok_or_else(|| eyre!("File content field is not a string"))?;

        let file_name = match file_name_fields.as_slice() {
            [] => parent_object
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_owned),
            [field_name] => match parent_object.get(field_name) {
                None | Some(Value::Null) => None,
                Some(Value::String(file_name)) => Some(file_name.clone()),
                Some(_) => {
                    return Err(eyre!(
                        "MCP file-name field '{}' is not a string",
                        field_name
                    ));
                }
            },
            _ => {
                return Err(eyre!(
                    "MCP file output has multiple sibling fields marked as file names"
                ));
            }
        };

        extracted.push(ExtractedFileField {
            json_pointer: pointer,
            mime_type: mime_type.to_string(),
            base64_data: base64_value.to_string(),
            file_name,
        });
    }

    Ok(extracted)
}

fn replace_mcp_file_fields(
    output_value: &mut Value,
    replacements: &[(&str, String)],
) -> Result<(), Report> {
    for (pointer, replacement) in replacements {
        let target = output_value
            .pointer_mut(pointer)
            .ok_or_else(|| eyre!("Missing output value for {}", pointer))?;
        *target = Value::String(replacement.clone());
    }
    Ok(())
}

fn extension_for_mime_type(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" => Some("bmp"),
        "image/svg+xml" => Some("svg"),
        "image/tiff" => Some("tiff"),
        "image/x-icon" => Some("ico"),
        "application/pdf" => Some("pdf"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => Some("docx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => Some("pptx"),
        "text/plain" => Some("txt"),
        "text/csv" => Some("csv"),
        "application/json" => Some("json"),
        "application/zip" => Some("zip"),
        _ => None,
    }
}

fn decode_mcp_file(extracted: &ExtractedFileField) -> Result<Vec<u8>, Report> {
    use base64::{Engine as _, engine::general_purpose};

    if let Some(name) = &extracted.file_name
        && (name == "."
            || name == ".."
            || name.contains(['/', '\\', ':'])
            || name.chars().any(char::is_control))
    {
        return Err(eyre!("Unsafe filename in MCP file output"));
    }
    if !extracted.mime_type.contains('/') || extracted.mime_type.chars().any(char::is_control) {
        return Err(eyre!("Invalid MIME type in MCP file output"));
    }
    general_purpose::STANDARD
        .decode(extracted.base64_data.as_bytes())
        .wrap_err_with(|| {
            format!(
                "Failed to decode base64 file data from MCP at {}",
                extracted.json_pointer
            )
        })
}

fn mcp_file_content_part(file_upload_id: Uuid, mime_type: &str) -> ContentPart {
    if mime_type.starts_with("image/") {
        ContentPart::ImageFilePointer(ContentPartImageFilePointer {
            file_upload_id,
            download_url: None,
            preview_url: None,
        })
    } else {
        ContentPart::TextFilePointer(ContentPartTextFilePointer { file_upload_id })
    }
}

async fn process_mcp_file_outputs(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: Uuid,
    output_schema: &Value,
    output_value: &mut Value,
) -> Result<Vec<ContentPart>, Report> {
    use crate::models::file_upload::create_file_upload;
    let extracted_fields = extract_mcp_file_fields(output_schema, output_value)?;
    if extracted_fields.is_empty() {
        return Ok(Vec::new());
    }

    // Validate the entire result before persisting any files.
    let decoded_files = extracted_fields
        .iter()
        .map(decode_mcp_file)
        .collect::<Result<Vec<_>, _>>()?;
    let mut file_pointers = Vec::new();
    let mut replacements = Vec::new();

    for (index, (extracted, file_bytes)) in extracted_fields.iter().zip(decoded_files).enumerate() {
        let mime_type = extracted.mime_type.as_str();
        let extension = extension_for_mime_type(mime_type).unwrap_or("bin");

        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let generated_filename = format!("mcp_generated_{}_{}.{}", timestamp, index, extension);
        let filename = extracted
            .file_name
            .as_ref()
            .filter(|file_name| !file_name.is_empty())
            .cloned()
            .unwrap_or_else(|| generated_filename.clone());

        let file_storage_provider_id = app_state.default_file_storage_provider_id();
        let file_storage = app_state.default_file_storage_provider();
        // Keep MCP-provided display names out of storage paths. Besides avoiding path traversal,
        // this preserves the existing unique generated storage naming behavior.
        let directory = if mime_type.starts_with("image/") {
            "generated_images"
        } else {
            "generated_files"
        };
        let file_storage_path = format!("{directory}/{generated_filename}");

        let mut writer = file_storage
            .upload_file_writer(&file_storage_path, Some(mime_type))
            .await
            .wrap_err("Failed to create writer for MCP generated file")?;

        writer
            .write(file_bytes)
            .await
            .wrap_err("Failed to write MCP generated file bytes")?;

        writer
            .close()
            .await
            .wrap_err("Failed to close MCP generated file writer")?;

        let file_upload = create_file_upload(
            &app_state.db,
            policy,
            subject,
            &chat_id,
            filename.clone(),
            file_storage_provider_id.clone(),
            file_storage_path.clone(),
            None,
            None,
        )
        .await?;

        replacements.push((
            extracted.json_pointer.as_str(),
            format!("erato-file://{}", file_upload.id),
        ));

        file_pointers.push(mcp_file_content_part(file_upload.id, mime_type));
    }

    replace_mcp_file_fields(output_value, &replacements)?;

    // The new file_upload rows must enter the policy data before the client
    // fetches their previews after the turn completes.

    Ok(file_pointers)
}

fn mcp_result_to_text(result: &rmcp::model::CallToolResult) -> String {
    result
        .content
        .iter()
        .filter_map(|content| match content {
            rmcp::model::ContentBlock::Text(text_content) => Some(text_content.text.to_string()),
            _ => None,
        })
        .collect::<Vec<String>>()
        .join("\n")
}

fn mcp_tool_output_value(
    tool_call_result: &rmcp::model::CallToolResult,
    tool_response_content: &str,
) -> Result<Value, Report> {
    match &tool_call_result.structured_content {
        Some(value) => Ok(value.clone()),
        None => serde_json::from_str(tool_response_content)
            .wrap_err("Failed to parse MCP tool output as JSON"),
    }
}

pub(super) fn mcp_tool_processing_error_output(
    tool_call_result: &rmcp::model::CallToolResult,
    processing_error: &str,
) -> Value {
    let tool_response_content = mcp_result_to_text(tool_call_result);
    let original_output = mcp_tool_output_value(tool_call_result, &tool_response_content)
        .unwrap_or_else(|_| Value::String(tool_response_content));

    json!({
        "status": "error",
        "error": processing_error,
        "mcp_output": original_output,
    })
}

fn parse_content_filter_error_payload(value: &Value) -> Option<GenerationErrorType> {
    let mut candidates = vec![value];
    if let Some(error_object) = value.get("error") {
        candidates.push(error_object);
    }

    for candidate in candidates {
        let error_type = candidate
            .get("type")
            .and_then(Value::as_str)
            .or_else(|| candidate.get("error_type").and_then(Value::as_str));
        if error_type != Some("content_filter") {
            continue;
        }

        let error_description = candidate
            .get("error_description")
            .and_then(Value::as_str)
            .or_else(|| candidate.get("message").and_then(Value::as_str))
            .or_else(|| value.get("message").and_then(Value::as_str))
            .unwrap_or("The response was filtered by MCP content policy.")
            .to_string();

        let filter_details = candidate
            .get("filter_details")
            .cloned()
            .or_else(|| candidate.get("content_filter_result").cloned())
            .or_else(|| {
                candidate
                    .get("innererror")
                    .and_then(|inner| inner.get("content_filter_result"))
                    .cloned()
            });

        return Some(GenerationErrorType::ContentFilter {
            error_description,
            filter_details,
        });
    }

    None
}

pub fn parse_content_filter_error_from_mcp_tool_result(
    tool_call_result: &rmcp::model::CallToolResult,
) -> Option<GenerationErrorType> {
    if tool_call_result.is_error != Some(true) {
        return None;
    }

    if let Some(structured_content) = tool_call_result.structured_content.as_ref()
        && let Some(parsed) = parse_content_filter_error_payload(structured_content)
    {
        return Some(parsed);
    }

    for content in &tool_call_result.content {
        if let rmcp::model::ContentBlock::Text(text_content) = content
            && let Ok(json_value) = serde_json::from_str::<Value>(&text_content.text)
            && let Some(parsed) = parse_content_filter_error_payload(&json_value)
        {
            return Some(parsed);
        }
    }

    None
}

pub async fn post_process_mcp_tool_result(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: Uuid,
    unfinished_tool_call: &ToolCall,
    output_schema: Option<&std::sync::Arc<rmcp::model::JsonObject>>,
    tool_call_result: &rmcp::model::CallToolResult,
) -> Result<McpToolPostProcessResult, Report> {
    let mut tool_response_content = mcp_result_to_text(tool_call_result);
    let mut output_value = serde_json::from_str(&tool_response_content)
        .ok()
        .or(Some(JsonValue::String(tool_response_content.clone())));
    let mut file_content_parts: Vec<ContentPart> = Vec::new();

    if let Some(output_schema) = output_schema {
        let output_schema_value = Value::Object(output_schema.as_ref().clone());
        let schema_paths = collect_file_content_paths(&output_schema_value);
        if !schema_paths.is_empty() {
            let mut output_json = mcp_tool_output_value(tool_call_result, &tool_response_content)?;
            file_content_parts = process_mcp_file_outputs(
                app_state,
                policy,
                subject,
                chat_id,
                &output_schema_value,
                &mut output_json,
            )
            .await?;
            tool_response_content = serde_json::to_string(&output_json)
                .wrap_err("Failed to serialize MCP tool output")?;
            output_value = Some(output_json);
        }
    }

    Ok(McpToolPostProcessResult {
        tool_response: ToolResponse {
            fn_name: Some(unfinished_tool_call.fn_name.clone()),
            call_id: unfinished_tool_call.call_id.clone(),
            content: tool_response_content,
        },
        output_value,
        file_content_parts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::{CallToolResult, ContentBlock};
    use serde_json::json;
    use std::sync::Arc;

    fn app_state_without_storage() -> AppState {
        let config = crate::config::AppConfig::default();
        let distribution = Arc::new(crate::distribution::Distribution::load(&config));
        let reloadable = crate::distribution::runtime::ReloadableAppState::new(
            &config,
            crate::services::mcp_manager::McpServers::new(&config),
        );
        AppState {
            db: sea_orm::DatabaseConnection::default(),
            local_delegation_signer: None,
            ms_teams_bot: None,
            default_file_storage_provider: None,
            file_storage_providers: Default::default(),
            client_operations: Default::default(),
            prompt_guardrails: Arc::new(
                crate::services::prompt_guardrails::CompiledPromptGuardrails::new(&config.guardrails)
                    .unwrap(),
            ),
            actor_manager: crate::actors::manager::ActorManager,
            langfuse_client: crate::services::langfuse::LangfuseClient::from_config(
                &config.integrations.langfuse,
                None,
            )
            .unwrap(),
            global_policy_engine: crate::state::GlobalPolicyEngine::new(),
            background_tasks: crate::services::background_tasks::BackgroundTaskManager::new(
                None,
                config.generation_status.clone(),
                None,
            ),
            system_prompt_renderer:
                crate::services::template_rendering::consumers::system_prompt::SystemPromptRenderer::new(),
            distribution,
            reloadable: Arc::new(tokio::sync::RwLock::new(reloadable)),
            genai_client_override: None,
            file_bytes_cache: moka::future::Cache::new(0),
            file_contents_cache: moka::future::Cache::new(0),
            token_count_cache: moka::future::Cache::new(0),
            file_processing_semaphore: Arc::new(tokio::sync::Semaphore::new(1)),
            file_processing_pipeline_semaphore: Arc::new(tokio::sync::Semaphore::new(1)),
            file_processor: crate::services::file_processor::create_file_processor(
                &config.file_processor.processor,
            )
            .unwrap(),
            file_type_detector: None,
            config,
        }
    }

    fn optional_files_schema() -> Value {
        json!({
            "type": "object",
            "required": ["success"],
            "properties": {
                "success": { "type": "boolean" },
                "files": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["content_base64", "mime_type"],
                        "properties": {
                            "content_base64": {
                                "type": "string",
                                "contentEncoding": "base64",
                                "chat.erato/file_content_field": true
                            },
                            "mime_type": { "type": "string" }
                        }
                    }
                }
            }
        })
    }

    #[tokio::test]
    async fn omitted_optional_files_preserve_structured_and_json_text_results() {
        // Any unexpected persistence attempt fails: no database or storage is configured.
        let app_state = app_state_without_storage();
        let policy = PolicyEngine::new();
        let subject = Subject::User(Uuid::new_v4().to_string());
        let tool_call = ToolCall {
            call_id: "python-call".into(),
            fn_name: "run_python_code".into(),
            fn_arguments: json!({}),
            thought_signatures: None,
        };
        let schema = Arc::new(optional_files_schema().as_object().unwrap().clone());
        for original in [
            json!({
                "success": true,
                "stdout": "ok\n",
                "stderr": "",
                "result": null,
                "error": null,
                "timed_out": false,
                "output_truncated": false
            }),
            json!({ "success": true, "stdout": "", "result": 2 }),
            json!({
                "success": false,
                "stdout": "starting worker\n",
                "stderr": "ModuleNotFoundError: No module named 'docx'",
                "result": null,
                "error": { "type": "ModuleNotFoundError", "message": "No module named 'docx'" },
                "timed_out": false,
                "output_truncated": false
            }),
        ] {
            for is_error in [false, true] {
                for structured in [false, true] {
                    let mut result = if structured {
                        CallToolResult::structured(original.clone())
                    } else {
                        CallToolResult::success(vec![ContentBlock::text(original.to_string())])
                    };
                    result.is_error = Some(is_error);
                    let processed = post_process_mcp_tool_result(
                        &app_state,
                        &policy,
                        &subject,
                        Uuid::new_v4(),
                        &tool_call,
                        Some(&schema),
                        &result,
                    )
                    .await
                    .expect("omitted optional files are valid");
                    assert!(processed.file_content_parts.is_empty());
                    assert_eq!(processed.output_value, Some(original.clone()));
                    assert_eq!(processed.tool_response.call_id, tool_call.call_id);
                    let output: Value =
                        serde_json::from_str(&processed.tool_response.content).unwrap();
                    assert_eq!(output, original);
                    assert!(output.get("files").is_none());
                }
            }
        }
    }

    #[test]
    fn optional_nested_file_paths_resolve_local_refs_and_preserve_siblings() {
        let schema = json!({
            "$ref": "#/$defs/Output",
            "$defs": {
                "Output": {
                    "type": "object",
                    "properties": {
                        "groups": { "type": "array", "items": { "$ref": "#/$defs/Group" } }
                    }
                },
                "Group": {
                    "type": "object",
                    "properties": { "result": { "$ref": "#/$defs/Result" } }
                },
                "Result": optional_files_schema()
            }
        });
        for output in [
            json!({}),
            json!({ "groups": [{}] }),
            json!({ "groups": [{ "result": { "success": true } }] }),
        ] {
            assert!(
                extract_mcp_file_fields(&schema, &output)
                    .unwrap()
                    .is_empty()
            );
        }
        let output = json!({
            "groups": [
                {},
                { "result": { "success": true } },
                { "result": { "success": true, "files": [] } },
                { "result": { "success": true, "files": [
                    { "content_base64": "aGVsbG8=", "mime_type": "text/plain" }
                ] } }
            ]
        });
        let extracted = extract_mcp_file_fields(&schema, &output).unwrap();
        assert_eq!(extracted.len(), 1);
        assert_eq!(
            extracted[0].json_pointer,
            "/groups/3/result/files/0/content_base64"
        );
        assert_eq!(decode_mcp_file(&extracted[0]).unwrap(), b"hello");

        let mut required_schema = schema.clone();
        required_schema["$defs"]["Result"]["required"] = json!(["success", "files"]);
        let error = extract_mcp_file_fields(&required_schema, &output).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("Missing file content field 'files'")
        );
        required_schema["$defs"]["Group"]["required"] = json!(["result"]);
        let error = extract_mcp_file_fields(&required_schema, &output).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("Missing file content field 'result'")
        );
    }

    #[tokio::test]
    async fn malformed_files_after_valid_files_fail_before_persistence() {
        let app_state = app_state_without_storage();
        let policy = PolicyEngine::new();
        let subject = Subject::User(Uuid::new_v4().to_string());
        let tool_call = ToolCall {
            call_id: "python-call".into(),
            fn_name: "run_python_code".into(),
            fn_arguments: json!({}),
            thought_signatures: None,
        };
        let mut schema = optional_files_schema();
        schema["properties"]["absent_files"] = schema["properties"]["files"].clone();
        let schema = Arc::new(schema.as_object().unwrap().clone());
        for (invalid, expected_error) in [
            (json!({}), "Missing file content field 'content_base64'"),
            (json!({ "content_base64": "aGVsbG8=" }), "Missing mime_type"),
            (
                json!({ "content_base64": "invalid!", "mime_type": "text/plain" }),
                "Failed to decode base64",
            ),
            (
                json!({ "content_base64": "aGVsbG8=", "mime_type": "invalid" }),
                "Invalid MIME type",
            ),
        ] {
            let result = CallToolResult::structured(json!({
                "success": true,
                "files": [
                    { "content_base64": "aGVsbG8=", "mime_type": "text/plain" },
                    invalid
                ]
            }));
            let error = post_process_mcp_tool_result(
                &app_state,
                &policy,
                &subject,
                Uuid::new_v4(),
                &tool_call,
                Some(&schema),
                &result,
            )
            .await
            .err()
            .expect("malformed files must fail before accessing storage");
            assert!(error.to_string().contains(expected_error), "{error}");
        }
    }

    #[test]
    fn optional_files_still_validate_present_values_and_required_fields() {
        let mut schema = optional_files_schema();
        // An omitted path must not hide malformed entries on another path.
        schema["properties"]["absent_files"] = schema["properties"]["files"].clone();
        let valid = json!({ "content_base64": "aGVsbG8=", "mime_type": "text/plain" });
        for files in [
            Value::Null,
            json!({}),
            json!("not an array"),
            json!([null]),
            json!([valid.clone(), {}]),
            json!([valid.clone(), { "mime_type": "text/plain" }]),
            json!([valid.clone(), { "content_base64": "aGVsbG8=" }]),
            json!([valid.clone(), { "content_base64": null, "mime_type": "text/plain" }]),
        ] {
            let output = json!({ "success": true, "files": files });
            assert!(
                extract_mcp_file_fields(&schema, &output).is_err(),
                "{output}"
            );
        }
        for invalid in [
            json!({ "content_base64": "invalid!", "mime_type": "text/plain" }),
            json!({ "content_base64": "aGVsbG8=", "mime_type": "invalid" }),
        ] {
            let output = json!({ "success": true, "files": [valid.clone(), invalid] });
            let fields = extract_mcp_file_fields(&schema, &output).unwrap();
            assert!(
                fields
                    .iter()
                    .map(decode_mcp_file)
                    .collect::<Result<Vec<_>, _>>()
                    .is_err()
            );
        }
        schema["required"] = json!(["success", "files"]);
        let error = extract_mcp_file_fields(&schema, &json!({ "success": true })).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("Missing file content field 'files'")
        );
    }

    #[test]
    fn document_and_mixed_outputs_decode_and_become_file_references() {
        let schema = json!({
            "properties": {
                "files": { "type": "array", "items": {
                    "properties": {
                        "data_base64": { "chat.erato/file_content_field": true },
                        "name": { "type": "string" },
                        "mime_type": { "type": "string" }
                    }
                }}
            }
        });
        let cases = [
            (
                "report.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            ("report.pdf", "application/pdf"),
            ("chart.png", "image/png"),
            ("custom.bin", "application/x-custom"),
        ];
        // Exercise individual documents as well as mixed image/document arrays.
        for count in [1, 2, 4] {
            let mut output = json!({ "files": cases[..count].iter().map(|(name, mime)| {
                json!({ "name": name, "mime_type": mime, "data_base64": "aGVsbG8=" })
            }).collect::<Vec<_>>() });
            let fields = extract_mcp_file_fields(&schema, &output).unwrap();
            let mut replacements = Vec::new();
            for (index, field) in fields.iter().enumerate() {
                assert_eq!(field.file_name.as_deref(), Some(cases[index].0));
                assert_eq!(field.mime_type, cases[index].1);
                assert_eq!(decode_mcp_file(field).unwrap(), b"hello");
                let id = Uuid::new_v4();
                match mcp_file_content_part(id, &field.mime_type) {
                    ContentPart::ImageFilePointer(pointer) => {
                        assert_eq!(index, 2);
                        assert_eq!(pointer.file_upload_id, id);
                        assert!(pointer.download_url.is_none());
                    }
                    ContentPart::TextFilePointer(pointer) => {
                        assert_ne!(index, 2);
                        assert_eq!(pointer.file_upload_id, id);
                    }
                    _ => panic!("Expected file pointer"),
                }
                replacements.push((field.json_pointer.as_str(), format!("erato-file://{id}")));
            }
            replace_mcp_file_fields(&mut output, &replacements).unwrap();
            for (index, (_, reference)) in replacements.iter().enumerate() {
                assert_eq!(output["files"][index]["data_base64"], *reference);
                assert_eq!(output["files"][index]["name"], cases[index].0);
                assert_eq!(output["files"][index]["mime_type"], cases[index].1);
            }
        }
    }

    #[test]
    fn invalid_file_outputs_have_recoverable_errors() {
        let mut field = ExtractedFileField {
            json_pointer: "/files/0/data_base64".into(),
            mime_type: "application/pdf".into(),
            base64_data: "invalid!".into(),
            file_name: Some("report.pdf".into()),
        };
        assert!(
            decode_mcp_file(&field)
                .unwrap_err()
                .to_string()
                .contains("base64 file data")
        );
        field.base64_data = "aGVsbG8=".into();
        for name in [
            "../report.pdf",
            "dir/report.pdf",
            "dir\\report.pdf",
            "..",
            "bad\nname.pdf",
        ] {
            field.file_name = Some(name.into());
            assert!(
                decode_mcp_file(&field)
                    .unwrap_err()
                    .to_string()
                    .contains("Unsafe filename")
            );
        }
        field.file_name = None;
        field.mime_type = "invalid".into();
        assert!(
            decode_mcp_file(&field)
                .unwrap_err()
                .to_string()
                .contains("Invalid MIME type")
        );
    }

    #[test]
    fn extract_mcp_file_fields_handles_defs_and_arrays() {
        let schema = json!({
            "type": "object",
            "properties": {
                "images": {
                    "type": "array",
                    "items": { "$ref": "#/$defs/GeneratedImage" }
                }
            },
            "required": ["images"],
            "$defs": {
                "GeneratedImage": {
                    "type": "object",
                    "properties": {
                        "data_base64": {
                            "chat.erato/file_content_field": true,
                            "contentEncoding": "base64",
                            "type": "string"
                        },
                        "height": { "type": "integer" },
                        "width": { "type": "integer" },
                        "mime_type": { "type": "string" }
                    },
                    "required": ["data_base64", "width", "height", "mime_type"]
                }
            }
        });

        let output = json!({
            "images": [
                {
                    "data_base64": "aGVsbG8=",
                    "mime_type": "image/png",
                    "width": 1,
                    "height": 1
                },
                {
                    "data_base64": "d29ybGQ=",
                    "mime_type": "image/png",
                    "width": 2,
                    "height": 2
                }
            ]
        });

        let extracted = extract_mcp_file_fields(&schema, &output).expect("extract");
        assert_eq!(extracted.len(), 2);
        assert_eq!(
            extracted[0],
            ExtractedFileField {
                json_pointer: "/images/0/data_base64".to_string(),
                mime_type: "image/png".to_string(),
                base64_data: "aGVsbG8=".to_string(),
                file_name: None,
            }
        );
        assert_eq!(
            extracted[1],
            ExtractedFileField {
                json_pointer: "/images/1/data_base64".to_string(),
                mime_type: "image/png".to_string(),
                base64_data: "d29ybGQ=".to_string(),
                file_name: None,
            }
        );
    }

    #[test]
    fn extract_mcp_file_fields_accepts_empty_annotated_arrays() {
        let schema = json!({
            "type": "object",
            "properties": {
                "result": {
                    "type": "object",
                    "properties": {
                        "files": {
                            "type": "array",
                            "items": { "$ref": "#/$defs/File" }
                        }
                    }
                }
            },
            "$defs": {
                "File": {
                    "type": "object",
                    "properties": {
                        "content": { "chat.erato/file_content_field": true, "type": "string" },
                        "mime_type": { "type": "string" }
                    }
                }
            }
        });
        let output = json!({ "result": { "files": [] }, "stdout": "2" });

        assert!(
            extract_mcp_file_fields(&schema, &output)
                .expect("empty files are valid")
                .is_empty()
        );
    }

    #[test]
    fn empty_file_arrays_preserve_structured_and_json_text_results() {
        let structured_error = json!({
            "files": [],
            "stderr": "Python runtime initialization failed",
            "error": { "type": "runtime_initialization", "message": "worker unavailable" }
        });
        let structured_result = CallToolResult::structured_error(structured_error.clone());
        assert_eq!(
            mcp_tool_output_value(&structured_result, "").expect("structured result"),
            structured_error
        );

        let text_result =
            CallToolResult::success(vec![ContentBlock::text(r#"{"files":[],"stdout":"2"}"#)]);
        let text_content = mcp_result_to_text(&text_result);
        assert_eq!(
            mcp_tool_output_value(&text_result, &text_content).expect("JSON text result"),
            json!({ "files": [], "stdout": "2" })
        );
    }

    #[test]
    fn file_processing_error_output_keeps_original_logs_and_diagnostics() {
        let original_output = json!({
            "files": [{ "content": "aGVsbG8=" }],
            "stdout": "starting worker",
            "stderr": "worker returned incomplete file metadata",
            "error": { "type": "runtime", "message": "worker failed" }
        });
        let tool_result = CallToolResult::structured_error(original_output.clone());

        let output = mcp_tool_processing_error_output(
            &tool_result,
            "Failed to process MCP tool output: Missing mime_type",
        );

        assert_eq!(output["status"], "error");
        assert_eq!(
            output["error"],
            "Failed to process MCP tool output: Missing mime_type"
        );
        assert_eq!(output["mcp_output"], original_output);
    }

    #[test]
    fn extract_mcp_file_fields_accepts_empty_nested_arrays_alongside_files() {
        let schema = json!({
            "type": "object",
            "properties": {
                "groups": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "files": {
                                "type": "array",
                                "items": { "$ref": "#/$defs/File" }
                            }
                        }
                    }
                }
            },
            "$defs": {
                "File": {
                    "type": "object",
                    "properties": {
                        "content": { "chat.erato/file_content_field": true, "type": "string" },
                        "mime_type": { "type": "string" }
                    }
                }
            }
        });
        let output = json!({
            "groups": [
                { "files": [] },
                { "files": [{ "content": "aGVsbG8=", "mime_type": "text/plain" }] }
            ]
        });

        let extracted = extract_mcp_file_fields(&schema, &output).expect("extract");
        assert_eq!(extracted.len(), 1);
        assert_eq!(extracted[0].json_pointer, "/groups/1/files/0/content");
        assert_eq!(extracted[0].mime_type, "text/plain");
    }

    #[test]
    fn extract_mcp_file_fields_rejects_malformed_output_shapes() {
        let schema = json!({
            "type": "object",
            "properties": {
                "files": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["content", "mime_type"],
                        "properties": {
                            "content": { "chat.erato/file_content_field": true, "type": "string" },
                            "mime_type": { "type": "string" }
                        }
                    }
                }
            }
        });

        for output in [json!({ "files": null }), json!({ "files": [{}] })] {
            assert!(extract_mcp_file_fields(&schema, &output).is_err());
        }

        let output = json!({ "files": [{ "content": "aGVsbG8=" }] });
        assert!(
            extract_mcp_file_fields(&schema, &output)
                .unwrap_err()
                .to_string()
                .contains("Missing mime_type")
        );
    }

    #[test]
    fn extract_mcp_file_fields_uses_annotated_sibling_file_name() {
        let schema = json!({
            "type": "object",
            "properties": {
                "images": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "data_base64": {
                                "chat.erato/file_content_field": true,
                                "contentEncoding": "base64",
                                "type": "string"
                            },
                            "name": {
                                "x-chat.erato/file_name_field": true,
                                "type": "string"
                            },
                            "mime_type": { "type": "string" }
                        }
                    }
                }
            }
        });
        let output = json!({
            "images": [
                {
                    "data_base64": "aGVsbG8=",
                    "name": "friendly-name.png",
                    "mime_type": "image/png"
                },
                {
                    "data_base64": "d29ybGQ=",
                    "mime_type": "image/png"
                }
            ]
        });

        let extracted = extract_mcp_file_fields(&schema, &output).expect("extract");

        assert_eq!(extracted[0].file_name.as_deref(), Some("friendly-name.png"));
        assert_eq!(extracted[1].file_name, None);
    }

    #[test]
    fn extract_mcp_file_fields_rejects_multiple_annotated_sibling_file_names() {
        let schema = json!({
            "type": "object",
            "properties": {
                "data_base64": {
                    "chat.erato/file_content_field": true,
                    "type": "string"
                },
                "first_name": {
                    "chat.erato/file_name_field": true,
                    "type": "string"
                },
                "second_name": {
                    "chat.erato/file_name_field": true,
                    "type": "string"
                },
                "mime_type": { "type": "string" }
            }
        });
        let output = json!({
            "data_base64": "aGVsbG8=",
            "first_name": "first.png",
            "second_name": "second.png",
            "mime_type": "image/png"
        });

        let error = extract_mcp_file_fields(&schema, &output).expect_err("ambiguous file name");

        assert!(error.to_string().contains("multiple sibling fields"));
    }

    #[test]
    fn replace_mcp_file_fields_updates_output() {
        let mut output = json!({
            "images": [
                { "data_base64": "aGVsbG8=", "mime_type": "image/png" }
            ]
        });

        replace_mcp_file_fields(
            &mut output,
            &[("/images/0/data_base64", "erato-file://123".to_string())],
        )
        .expect("replace");

        assert_eq!(
            output["images"][0]["data_base64"],
            json!("erato-file://123")
        );
    }

    #[test]
    fn parse_content_filter_error_from_mcp_structured_error_result() {
        let tool_result = CallToolResult::structured_error(json!({
            "type": "content_filter",
            "error_description": "Blocked by MCP content filter",
            "filter_details": {
                "sexual": { "filtered": true, "severity": "medium" }
            }
        }));

        let parsed = parse_content_filter_error_from_mcp_tool_result(&tool_result);
        match parsed {
            Some(GenerationErrorType::ContentFilter {
                error_description,
                filter_details,
            }) => {
                assert_eq!(error_description, "Blocked by MCP content filter");
                assert_eq!(
                    filter_details,
                    Some(json!({
                        "sexual": { "filtered": true, "severity": "medium" }
                    }))
                );
            }
            other => panic!("Expected content filter error, got: {other:?}"),
        }
    }

    #[test]
    fn parse_content_filter_error_from_mcp_text_error_result() {
        let payload = json!({
            "error": {
                "type": "content_filter",
                "message": "MCP blocked content",
                "innererror": {
                    "content_filter_result": {
                        "violence": { "filtered": true, "severity": "high" }
                    }
                }
            }
        });

        let tool_result = CallToolResult::error(vec![ContentBlock::text(payload.to_string())]);
        let parsed = parse_content_filter_error_from_mcp_tool_result(&tool_result);

        match parsed {
            Some(GenerationErrorType::ContentFilter {
                error_description,
                filter_details,
            }) => {
                assert_eq!(error_description, "MCP blocked content");
                assert_eq!(
                    filter_details,
                    Some(json!({
                        "violence": { "filtered": true, "severity": "high" }
                    }))
                );
            }
            other => panic!("Expected content filter error, got: {other:?}"),
        }
    }

    #[test]
    fn parse_content_filter_error_ignores_non_error_results() {
        let tool_result = CallToolResult::structured(json!({
            "type": "content_filter",
            "message": "Should not parse because this is not marked as error"
        }));
        assert!(parse_content_filter_error_from_mcp_tool_result(&tool_result).is_none());
    }
}
