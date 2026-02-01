use crate::models::message::{ContentPart, ContentPartImageFilePointer};
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

#[derive(Clone, Debug, PartialEq)]
struct ExtractedFileField {
    json_pointer: String,
    mime_type: String,
    base64_data: String,
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

fn collect_file_content_paths(schema: &Value) -> Vec<Vec<FileContentPathPart>> {
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
    root: &Value,
    schema: &Value,
    current_path: &mut Vec<FileContentPathPart>,
    paths: &mut Vec<Vec<FileContentPathPart>>,
    visited_refs: &mut HashSet<String>,
) {
    if schema
        .get("chat.erato/file_content_field")
        .and_then(|value| value.as_bool())
        == Some(true)
    {
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

    let value_paths = expand_value_paths(output_value, &schema_paths);
    if value_paths.is_empty() {
        return Err(eyre!(
            "MCP tool output schema marked file content, but no output values were found"
        ));
    }

    let mut extracted = Vec::new();

    for path in value_paths {
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

        extracted.push(ExtractedFileField {
            json_pointer: pointer,
            mime_type: mime_type.to_string(),
            base64_data: base64_value.to_string(),
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
        let filename = format!("mcp_generated_{}_{}.{}", timestamp, index, extension);

        let file_storage_provider_id = app_state.default_file_storage_provider_id();
        let file_storage = app_state.default_file_storage_provider();
        let file_storage_path = format!("generated_images/{}", filename);

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

        let download_url = file_storage
            .generate_presigned_download_url(&file_storage_path, None)
            .await
            .wrap_err("Failed to generate download URL for MCP generated image")?;

        replacements.push((
            extracted.json_pointer.as_str(),
            format!("erato-file://{}", file_upload.id),
        ));

        image_pointers.push(ContentPart::ImageFilePointer(ContentPartImageFilePointer {
            file_upload_id: file_upload.id,
            download_url,
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
            }
        );
        assert_eq!(
            extracted[1],
            ExtractedFileField {
                json_pointer: "/images/1/data_base64".to_string(),
                mime_type: "image/png".to_string(),
                base64_data: "d29ybGQ=".to_string(),
            }
        );
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
}
