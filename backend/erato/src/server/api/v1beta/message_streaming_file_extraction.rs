use crate::models::message::{ContentPart, ContentPartImageFilePointer, GenerationErrorType};
use crate::policy::engine::PolicyEngine;
use crate::policy::types::Subject;
use crate::state::AppState;
use eyre::{Report, WrapErr, eyre};
use genai::chat::{ToolCall, ToolResponse};
use sea_orm::JsonValue;
use sea_orm::prelude::Uuid;
use serde_json::Value;
use std::collections::HashSet;
use std::time::SystemTime;

#[derive(Clone, Debug)]
enum FileContentPathPart {
    Field(String),
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
    pub image_content_parts: Vec<ContentPart>,
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
            current_path.push(FileContentPathPart::Field(name.clone()));
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
) {
    if path.is_empty() {
        out.push(current.clone());
        return;
    }

    match &path[0] {
        FileContentPathPart::Field(field) => {
            if let Value::Object(map) = value
                && let Some(next_value) = map.get(field)
            {
                current.push(field.clone());
                expand_paths_for_value(next_value, &path[1..], current, out);
                current.pop();
            }
        }
        FileContentPathPart::ArrayItem => {
            if let Value::Array(items) = value {
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
    value: &Value,
    schema_paths: &[Vec<FileContentPathPart>],
) -> Vec<Vec<String>> {
    let mut results = Vec::new();
    for path in schema_paths {
        expand_paths_for_value(value, path, &mut Vec::new(), &mut results);
    }
    results
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
        for value_path in expand_value_paths(output_value, std::slice::from_ref(&schema_path.parts))
        {
            expanded_paths.push((value_path, &schema_path.file_name_fields));
        }
    }

    if expanded_paths.is_empty() {
        return Err(eyre!(
            "MCP tool output schema marked file content, but no output values were found"
        ));
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
            [] => None,
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
        _ => None,
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
    use base64::{Engine as _, engine::general_purpose};

    let extracted_fields = extract_mcp_file_fields(output_schema, output_value)?;
    if extracted_fields.is_empty() {
        return Ok(Vec::new());
    }

    let mut image_pointers = Vec::new();
    let mut replacements = Vec::new();

    for (index, extracted) in extracted_fields.iter().enumerate() {
        let mime_type = extracted.mime_type.as_str();
        if !mime_type.starts_with("image/") {
            return Err(eyre!(
                "MCP tool returned non-image file with mime type '{}'",
                mime_type
            ));
        }

        let extension = extension_for_mime_type(mime_type)
            .ok_or_else(|| eyre!("Unsupported image mime type '{}'", mime_type))?;

        let image_bytes = general_purpose::STANDARD
            .decode(extracted.base64_data.as_bytes())
            .wrap_err("Failed to decode base64 image data from MCP")?;

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
        let file_storage_path = format!("generated_images/{}", generated_filename);

        let mut writer = file_storage
            .upload_file_writer(&file_storage_path, Some(mime_type))
            .await
            .wrap_err("Failed to create writer for MCP generated image")?;

        writer
            .write(image_bytes)
            .await
            .wrap_err("Failed to write MCP generated image bytes")?;

        writer
            .close()
            .await
            .wrap_err("Failed to close MCP generated image writer")?;

        let file_upload = create_file_upload(
            &app_state.db,
            policy,
            subject,
            &chat_id,
            filename.clone(),
            file_storage_provider_id.clone(),
            file_storage_path.clone(),
        )
        .await?;

        replacements.push((
            extracted.json_pointer.as_str(),
            format!("erato-file://{}", file_upload.id),
        ));

        image_pointers.push(ContentPart::ImageFilePointer(ContentPartImageFilePointer {
            file_upload_id: file_upload.id,
            download_url: None,
            preview_url: None,
        }));
    }

    replace_mcp_file_fields(output_value, &replacements)?;

    Ok(image_pointers)
}

fn mcp_result_to_text(result: &rmcp::model::CallToolResult) -> String {
    result
        .content
        .iter()
        .filter_map(|annotated_content| match &annotated_content.raw {
            rmcp::model::RawContent::Text(text_content) => Some(text_content.text.to_string()),
            rmcp::model::RawContent::Image { .. } => None,
            rmcp::model::RawContent::Resource { .. } => None,
            rmcp::model::RawContent::Audio(_) => None,
            rmcp::model::RawContent::ResourceLink(_) => None,
        })
        .collect::<Vec<String>>()
        .join("\n")
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

    for annotated_content in &tool_call_result.content {
        if let rmcp::model::RawContent::Text(text_content) = &annotated_content.raw
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
    let mut image_content_parts: Vec<ContentPart> = Vec::new();

    if let Some(output_schema) = output_schema {
        let output_schema_value = Value::Object(output_schema.as_ref().clone());
        let schema_paths = collect_file_content_paths(&output_schema_value);
        if !schema_paths.is_empty() {
            let mut output_json: Value = serde_json::from_str(&tool_response_content)
                .wrap_err("Failed to parse MCP tool output as JSON")?;
            image_content_parts = process_mcp_file_outputs(
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
            call_id: unfinished_tool_call.call_id.clone(),
            content: tool_response_content,
        },
        output_value,
        image_content_parts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::{CallToolResult, Content};
    use serde_json::json;

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

        let tool_result = CallToolResult::error(vec![Content::text(payload.to_string())]);
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
