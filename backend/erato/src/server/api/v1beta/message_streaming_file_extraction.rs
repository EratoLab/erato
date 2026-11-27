use crate::models::message::{
    ContentPart, ContentPartImageFilePointer, ContentPartTextFilePointer, GenerationErrorType,
    ToolResultDetails, ToolResultLink,
};
use crate::policy::engine::PolicyEngine;
use crate::policy::types::Subject;
use crate::services::display_text::{MAX_DISPLAY_NAME_CHARS, sanitize_display_text};
use crate::services::prompt_composition::replay_policy::MAX_RECEIPT_FIELD_BYTES;
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

/// A file of a tool result, validated and decoded, not yet stored.
#[derive(Debug, PartialEq)]
struct McpResultFile {
    mime_type: String,
    file_name: Option<String>,
    bytes: Vec<u8>,
}

/// A stored file of a tool result, as the result's output names it.
struct StoredMcpFile {
    id: Uuid,
    file_name: String,
    mime_type: String,
}

/// What a result's files are read into before any of them is stored.
struct ValidatedMcpFiles {
    /// The output the marked fields are part of, when the tool marks any.
    marked_output: Option<Value>,
    marked_fields: Vec<ExtractedFileField>,
    /// The files to store: one per marked field, in their order, then one
    /// per content block that does not repeat a marked field's file.
    files: Vec<McpResultFile>,
    /// Whether file blocks past `MAX_RESULT_FILE_BLOCKS` were left out.
    blocks_left_out: bool,
}

pub struct McpToolPostProcessResult {
    pub tool_response: ToolResponse,
    pub output_value: Option<JsonValue>,
    pub file_content_parts: Vec<ContentPart>,
    pub result_details: Option<ToolResultDetails>,
    /// Where `output_value` holds the result's `structuredContent` once files
    /// were taken out of its marked fields, as a JSON pointer. `None` when
    /// none were: the returned `structuredContent` then carries no file.
    pub structured_content_pointer: Option<&'static str>,
}

/// The result's `structuredContent` for the call's view. Once files were
/// taken out of its marked fields, that is the stored output's copy, which
/// names them instead of carrying their bytes. Files from content blocks
/// were never part of it.
pub(super) fn structured_content_for_view<'a>(
    result: &'a rmcp::model::CallToolResult,
    structured_content_pointer: Option<&str>,
    output_value: Option<&'a JsonValue>,
) -> Option<&'a JsonValue> {
    let returned = result.structured_content.as_ref()?;
    match structured_content_pointer {
        None => Some(returned),
        Some(pointer) => output_value?.pointer(pointer),
    }
}

/// Links kept per result.
const MAX_RESULT_LINKS: usize = 10;
/// Link blocks read per result, kept or not, so thousands of them cost a
/// bounded number of URL parses.
const MAX_RESULT_LINK_CANDIDATES: usize = 100;
/// `image` and embedded `resource` blocks read as files per result. Further
/// ones are neither decoded nor stored, and the model is told so.
const MAX_RESULT_FILE_BLOCKS: usize = 64;
/// MIME types of an embedded resource that names none: `mimeType` is
/// optional there.
const DEFAULT_TEXT_RESOURCE_MIME_TYPE: &str = "text/plain";
const DEFAULT_BLOB_RESOURCE_MIME_TYPE: &str = "application/octet-stream";
/// Largest file taken from a content block where no file storage provider
/// sets an upload limit: the default limit of an upload.
const DEFAULT_MAX_RESULT_FILE_BYTES: usize = 50 * 1024 * 1024;
/// `_meta` key of an `image` or embedded `resource` block naming its file.
const FILE_NAME_META_KEY: &str = "chat.erato/file_name";

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

fn validate_mcp_file_name(name: &str) -> Result<(), Report> {
    if name == "."
        || name == ".."
        || name.contains(['/', '\\', ':'])
        || name.chars().any(char::is_control)
    {
        return Err(eyre!("Unsafe filename in MCP file output"));
    }
    Ok(())
}

fn validate_mcp_mime_type(mime_type: &str) -> Result<(), Report> {
    if !mime_type.contains('/') || mime_type.chars().any(char::is_control) {
        return Err(eyre!("Invalid MIME type in MCP file output"));
    }
    Ok(())
}

fn decode_mcp_file_data(base64_data: &str, json_pointer: &str) -> Result<Vec<u8>, Report> {
    use base64::{Engine as _, engine::general_purpose};

    general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .wrap_err_with(|| format!("Failed to decode base64 file data from MCP at {json_pointer}"))
}

fn decode_mcp_file(extracted: &ExtractedFileField) -> Result<Vec<u8>, Report> {
    if let Some(name) = &extracted.file_name {
        validate_mcp_file_name(name)?;
    }
    validate_mcp_mime_type(&extracted.mime_type)?;
    decode_mcp_file_data(&extracted.base64_data, &extracted.json_pointer)
}

/// A server's name for a content block's file: checked like a marked field's
/// file name, then without invisible characters. `None` when nothing is left.
fn block_file_name(name: &str) -> Result<Option<String>, Report> {
    validate_mcp_file_name(name)?;
    let name = sanitize_display_text(name, MAX_DISPLAY_NAME_CHARS);
    if name.truncated {
        return Err(eyre!(
            "Filename in MCP file output is longer than {MAX_DISPLAY_NAME_CHARS} characters"
        ));
    }
    // What is left once invisible characters are gone can be `..`.
    validate_mcp_file_name(&name.text)?;
    Ok((!name.text.is_empty()).then_some(name.text))
}

/// The last path segment of a resource's URI as a file name, when it is
/// usable as one.
fn uri_file_name(uri: &str) -> Option<String> {
    // Before parsing, so a URI of any length costs nothing to drop.
    if uri.len() > MAX_RECEIPT_FIELD_BYTES {
        return None;
    }
    let url = url::Url::parse(uri).ok()?;
    let segment = url.path_segments()?.next_back()?;
    let name = percent_encoding::percent_decode_str(segment)
        .decode_utf8()
        .ok()?;
    block_file_name(&name).ok().flatten()
}

/// The file name a content block's `_meta` gives, if any. The block's own
/// `_meta` is read before that of the resource it embeds.
fn meta_file_name(
    metas: [Option<&rmcp::model::MetaObject>; 2],
    json_pointer: &str,
) -> Result<Option<String>, Report> {
    for meta in metas.into_iter().flatten() {
        match meta.0.get(FILE_NAME_META_KEY) {
            None | Some(Value::Null) => {}
            Some(Value::String(name)) => {
                if let Some(name) = block_file_name(name)? {
                    return Ok(Some(name));
                }
            }
            Some(_) => {
                return Err(eyre!(
                    "MCP file name '{FILE_NAME_META_KEY}' at {json_pointer} is not a string"
                ));
            }
        }
    }
    Ok(None)
}

/// Whether a content block is read as a file: an `image` block or an
/// embedded `resource`. An embedded view (a resource with a `ui:` URI, as
/// MCP Apps names views) is no file and stays unread.
fn is_file_block(block: &rmcp::model::ContentBlock) -> bool {
    use rmcp::model::{ContentBlock, ResourceContents};

    match block {
        ContentBlock::Image(_) => true,
        ContentBlock::Resource(embedded) => match &embedded.resource {
            ResourceContents::BlobResourceContents { uri, .. }
            | ResourceContents::TextResourceContents { uri, .. } => !uri
                .get(.."ui:".len())
                .is_some_and(|scheme| scheme.eq_ignore_ascii_case("ui:")),
            _ => false,
        },
        _ => false,
    }
}

/// The files a result carries as `image` and embedded `resource` content
/// blocks, validated and decoded, and whether blocks past
/// `MAX_RESULT_FILE_BLOCKS` were left out. A resource link is no file:
/// `mcp_result_details` keeps it as a link.
fn extract_mcp_file_blocks(
    content: &[rmcp::model::ContentBlock],
    max_file_bytes: usize,
) -> Result<(Vec<McpResultFile>, bool), Report> {
    use rmcp::model::{ContentBlock, ResourceContents};

    enum Data<'a> {
        Base64(&'a str),
        Text(&'a str),
    }
    let too_large = |json_pointer: &str| {
        eyre!(
            "MCP file output at {json_pointer} is larger than the {max_file_bytes} bytes a file may have"
        )
    };
    let mut blocks = content
        .iter()
        .enumerate()
        .filter(|(_, block)| is_file_block(block));
    let mut files = Vec::new();
    for (index, block) in blocks.by_ref().take(MAX_RESULT_FILE_BLOCKS) {
        let json_pointer = format!("/content/{index}");
        let (mime_type, data, file_name) = match block {
            ContentBlock::Image(image) => (
                image.mime_type.as_str(),
                Data::Base64(&image.data),
                meta_file_name([image.meta.as_ref(), None], &json_pointer)?,
            ),
            ContentBlock::Resource(embedded) => {
                let (uri, mime_type, data, meta) = match &embedded.resource {
                    ResourceContents::BlobResourceContents {
                        uri,
                        mime_type,
                        blob,
                        meta,
                    } => (
                        uri,
                        mime_type
                            .as_deref()
                            .unwrap_or(DEFAULT_BLOB_RESOURCE_MIME_TYPE),
                        Data::Base64(blob),
                        meta,
                    ),
                    ResourceContents::TextResourceContents {
                        uri,
                        mime_type,
                        text,
                        meta,
                    } => (
                        uri,
                        mime_type
                            .as_deref()
                            .unwrap_or(DEFAULT_TEXT_RESOURCE_MIME_TYPE),
                        Data::Text(text),
                        meta,
                    ),
                    _ => continue,
                };
                let file_name =
                    match meta_file_name([embedded.meta.as_ref(), meta.as_ref()], &json_pointer)? {
                        Some(name) => Some(name),
                        None => uri_file_name(uri),
                    };
                (mime_type, data, file_name)
            }
            _ => continue,
        };
        validate_mcp_mime_type(mime_type)?;
        let bytes = match data {
            Data::Base64(base64_data) => {
                // Checked before decoding, so an oversized file costs no
                // copy. Padding makes this estimate up to two bytes high.
                if base64_data.len() / 4 * 3 > max_file_bytes.saturating_add(2) {
                    return Err(too_large(&json_pointer));
                }
                decode_mcp_file_data(base64_data, &json_pointer)?
            }
            Data::Text(text) if text.len() > max_file_bytes => {
                return Err(too_large(&json_pointer));
            }
            Data::Text(text) => text.as_bytes().to_vec(),
        };
        if bytes.len() > max_file_bytes {
            return Err(too_large(&json_pointer));
        }
        files.push(McpResultFile {
            mime_type: mime_type.to_owned(),
            file_name,
            bytes,
        });
    }
    Ok((files, blocks.next().is_some()))
}

/// Reads every file of a result, from the fields its output schema marks and
/// from its content blocks, without storing any.
fn validate_mcp_result_files(
    output_schema: Option<&rmcp::model::JsonObject>,
    tool_call_result: &rmcp::model::CallToolResult,
    tool_response_content: &str,
    max_file_bytes: usize,
) -> Result<ValidatedMcpFiles, Report> {
    let mut marked_output = None;
    let mut marked_fields = Vec::new();
    if let Some(output_schema) = output_schema {
        let output_schema_value = Value::Object(output_schema.clone());
        let schema_paths = collect_file_content_paths(&output_schema_value);
        if !schema_paths.is_empty() {
            let output_json = mcp_tool_output_value(tool_call_result, tool_response_content)?;
            marked_fields = extract_mcp_file_fields(&output_schema_value, &output_json)?;
            marked_output = Some(output_json);
        }
    }
    let mut files = marked_fields
        .iter()
        .map(|field| {
            Ok(McpResultFile {
                bytes: decode_mcp_file(field)?,
                mime_type: field.mime_type.clone(),
                file_name: field.file_name.clone(),
            })
        })
        .collect::<Result<Vec<_>, Report>>()?;
    let (block_files, blocks_left_out) =
        extract_mcp_file_blocks(&tool_call_result.content, max_file_bytes)?;
    let marked_files = files.len();
    for file in block_files {
        // A server may send one file both in a marked field and as a block:
        // it is stored once, as the marked field's file. Two blocks are
        // always two files, whatever they hold.
        let marked = files[..marked_files]
            .iter()
            .any(|marked| marked.mime_type == file.mime_type && marked.bytes == file.bytes);
        if !marked {
            files.push(file);
        }
    }
    Ok(ValidatedMcpFiles {
        marked_output,
        marked_fields,
        files,
        blocks_left_out,
    })
}

/// A result's output beside the files its content blocks carried. Like the
/// wrapper `resolve_client_tool_files` builds: the tool's own output under
/// `result`, and each file under the reference a marked input field takes.
fn output_beside_block_files(output: Value, files: &[StoredMcpFile], left_out: bool) -> Value {
    json!({
        "result": output,
        "files": files
            .iter()
            .map(|file| {
                json!({
                    "fileReference": format!("erato-file://{}", file.id),
                    "filename": file.file_name,
                    "mimeType": file.mime_type,
                })
            })
            .collect::<Vec<_>>(),
        "filesTruncated": left_out,
    })
}

/// Names the stored files in the result's output: a marked field holds its
/// file's reference in place of the Base64, and the files of content blocks
/// are listed beside the output. Returns where the output then holds the
/// structured content the marked fields were taken out of.
fn name_stored_mcp_files(
    marked_output: Option<Value>,
    marked_fields: &[ExtractedFileField],
    stored: &[StoredMcpFile],
    blocks_left_out: bool,
    tool_response_content: &mut String,
    output_value: &mut Option<JsonValue>,
) -> Result<Option<&'static str>, Report> {
    let (marked_files, block_files) = stored.split_at(marked_fields.len());
    let mut structured_content_pointer = None;
    let mut changed = false;
    if let Some(mut output_json) = marked_output {
        let replacements = marked_fields
            .iter()
            .zip(marked_files)
            .map(|(field, file)| {
                (
                    field.json_pointer.as_str(),
                    format!("erato-file://{}", file.id),
                )
            })
            .collect::<Vec<_>>();
        replace_mcp_file_fields(&mut output_json, &replacements)?;
        if !marked_files.is_empty() {
            structured_content_pointer = Some("");
        }
        *output_value = Some(output_json);
        changed = true;
    }
    if !block_files.is_empty() || blocks_left_out {
        let output = output_value.take().unwrap_or(Value::Null);
        *output_value = Some(output_beside_block_files(
            output,
            block_files,
            blocks_left_out,
        ));
        structured_content_pointer = structured_content_pointer.map(|_| "/result");
        changed = true;
    }
    if changed && let Some(output) = output_value {
        *tool_response_content =
            serde_json::to_string(output).wrap_err("Failed to serialize MCP tool output")?;
    }
    Ok(structured_content_pointer)
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

/// Stores a result's validated files as file uploads of the chat, in order.
async fn store_mcp_files(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: Uuid,
    files: Vec<McpResultFile>,
) -> Result<Vec<StoredMcpFile>, Report> {
    use crate::models::file_upload::create_file_upload;
    let mut stored = Vec::new();

    for (index, file) in files.into_iter().enumerate() {
        let mime_type = file.mime_type.as_str();
        let extension = extension_for_mime_type(mime_type).unwrap_or("bin");

        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let generated_filename = format!("mcp_generated_{}_{}.{}", timestamp, index, extension);
        let filename = file
            .file_name
            .filter(|file_name| !file_name.is_empty())
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
            .write(file.bytes)
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

        stored.push(StoredMcpFile {
            id: file_upload.id,
            file_name: filename,
            mime_type: file.mime_type,
        });
    }

    // The new file_upload rows must enter the policy data before the client
    // fetches their previews after the turn completes.

    Ok(stored)
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

/// The result's `https` links, bounded. Structured content and embedded
/// resources are not kept here: a shared chat would hand them to its
/// viewers, and only a call's view reads structured content, which
/// `ToolResultView` keeps for it. Embedded resources and images are files
/// of the chat instead (`extract_mcp_file_blocks`).
fn mcp_result_details(
    content: &[rmcp::model::ContentBlock],
    server_url: Option<&str>,
) -> Option<ToolResultDetails> {
    let server_host = server_url.and_then(url_host);
    let links: Vec<_> = content
        .iter()
        .filter_map(|block| match block {
            rmcp::model::ContentBlock::ResourceLink(resource) => Some(resource),
            _ => None,
        })
        .take(MAX_RESULT_LINK_CANDIDATES)
        .filter_map(|resource| https_link(resource, server_host.as_deref()))
        .take(MAX_RESULT_LINKS)
        .collect();
    (!links.is_empty()).then_some(ToolResultDetails {
        links,
        ..ToolResultDetails::default()
    })
}

fn https_link(
    resource: &rmcp::model::Resource,
    server_host: Option<&str>,
) -> Option<ToolResultLink> {
    // Before parsing, so a URI of any length costs nothing to drop.
    if resource.uri.len() > MAX_RECEIPT_FIELD_BYTES {
        return None;
    }
    let url = url::Url::parse(&resource.uri).ok()?;
    let host = url.host_str().filter(|host| !host.is_empty())?.to_owned();
    // Userinfo lets `https://trusted.example@other.example/` read as the
    // wrong host, and would store any credentials in it.
    let kept = url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.as_str().len() <= MAX_RECEIPT_FIELD_BYTES;
    if !kept {
        return None;
    }
    Some(ToolResultLink {
        matches_server_host: server_host.is_some_and(|server| server.eq_ignore_ascii_case(&host)),
        host,
        uri: url.into(),
        name: display_name(Some(&resource.name)),
        title: display_name(resource.title.as_deref()),
    })
}

fn url_host(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()?
        .host_str()
        .filter(|host| !host.is_empty())
        .map(str::to_owned)
}

fn display_name(text: Option<&str>) -> Option<String> {
    text.map(|text| sanitize_display_text(text, MAX_DISPLAY_NAME_CHARS).text)
        .filter(|text| !text.is_empty())
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

/// `server_url` is the MCP server's configured URL, if it has one; a result
/// link on its host is marked as the server's own.
#[allow(clippy::too_many_arguments)]
pub async fn post_process_mcp_tool_result(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    chat_id: Uuid,
    unfinished_tool_call: &ToolCall,
    output_schema: Option<&std::sync::Arc<rmcp::model::JsonObject>>,
    tool_call_result: &rmcp::model::CallToolResult,
    server_url: Option<&str>,
) -> Result<McpToolPostProcessResult, Report> {
    let mut tool_response_content = mcp_result_to_text(tool_call_result);
    let mut output_value = serde_json::from_str(&tool_response_content)
        .ok()
        .or(Some(JsonValue::String(tool_response_content.clone())));

    // Validate the entire result before persisting any files.
    let validated = validate_mcp_result_files(
        output_schema.map(|schema| schema.as_ref()),
        tool_call_result,
        &tool_response_content,
        app_state
            .config
            .max_upload_size_bytes()
            .map(|bytes| bytes as usize)
            .unwrap_or(DEFAULT_MAX_RESULT_FILE_BYTES),
    )?;
    let stored = store_mcp_files(app_state, policy, subject, chat_id, validated.files).await?;
    let file_content_parts = stored
        .iter()
        .map(|file| mcp_file_content_part(file.id, &file.mime_type))
        .collect();
    let structured_content_pointer = name_stored_mcp_files(
        validated.marked_output,
        &validated.marked_fields,
        &stored,
        validated.blocks_left_out,
        &mut tool_response_content,
        &mut output_value,
    )?;

    let result_details = mcp_result_details(&tool_call_result.content, server_url);
    Ok(McpToolPostProcessResult {
        tool_response: ToolResponse {
            fn_name: Some(unfinished_tool_call.fn_name.clone()),
            call_id: unfinished_tool_call.call_id.clone(),
            content: tool_response_content,
        },
        output_value,
        file_content_parts,
        result_details,
        structured_content_pointer,
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
            &distribution,
            crate::services::mcp_manager::McpServers::new(&config),
        );
        AppState {
            memory_reservation: None,
            db: sea_orm::DatabaseConnection::default(),
            ms_teams_bot: None,
            entra_group_overage: None,
            default_file_storage_provider: None,
            file_storage_providers: Default::default(),
            client_operations: Default::default(),
            executor_streams: Default::default(),
            prompt_guardrails: Arc::new(
                crate::services::prompt_guardrails::CompiledPromptGuardrails::new(&config.guardrails)
                    .unwrap(),
            ),
            scheduled_deliveries: Arc::new(
                crate::services::scheduled_deliveries::DeliveryRegistry::new(),
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
            voice_command_words: Default::default(),
            speech_readings: Default::default(),
            tool_label_cache: Default::default(),
            tool_label_timeout: crate::services::tool_labeller::LABEL_TIMEOUT,
            tool_label_permits: std::sync::Arc::new(tokio::sync::Semaphore::new(
                crate::services::tool_labeller::MAX_CONCURRENT_LABELS,
            )),
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
            json!({ "success": true, "stdout": "x".repeat(64 * 1024) }),
        ] {
            for is_error in [false, true] {
                for (structured, text) in [(false, true), (true, true), (true, false)] {
                    for beside_text in [false, true] {
                        let mut result = if structured {
                            CallToolResult::structured(original.clone())
                        } else {
                            CallToolResult::success(vec![ContentBlock::text(original.to_string())])
                        };
                        if !text {
                            result.content.clear();
                        }
                        if beside_text {
                            result.content.extend(blocks_beside_text());
                        }
                        result.is_error = Some(is_error);
                        let processed = post_process_mcp_tool_result(
                            &app_state,
                            &policy,
                            &subject,
                            Uuid::new_v4(),
                            &tool_call,
                            Some(&schema),
                            &result,
                            Some(SERVER_URL),
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
                        assert_eq!(
                            processed.result_details,
                            beside_text.then(details_beside_text)
                        );
                    }
                }
            }
        }
    }

    const SERVER_URL: &str = "https://Records.Example.Test:8443/mcp";

    /// Blocks that are neither text nor files; only the link is kept.
    fn blocks_beside_text() -> Vec<ContentBlock> {
        serde_json::from_value(json!([
            {"type": "resource_link", "uri": "https://records.example.test/rows/1", "name": "row-1",
             "title": "Synthetic\u{202E} row", "mimeType": "text/html"},
            {"type": "audio", "data": "iVBORw0KGgo=", "mimeType": "audio/wav"},
        ]))
        .unwrap()
    }

    /// Blocks that are files: stored, and never kept in the details.
    fn file_blocks() -> Vec<ContentBlock> {
        serde_json::from_value(json!([
            {"type": "resource", "resource": {"uri": "records://rows/1",
             "mimeType": "application/json", "text": "{\"title\":\"SYNTHETIC-RESOURCE\"}"}},
            {"type": "resource", "resource": {"uri": "records://rows/1/chart",
             "mimeType": "image/png", "blob": "iVBORw0KGgo="}},
            {"type": "image", "data": "iVBORw0KGgo=", "mimeType": "image/png"},
        ]))
        .unwrap()
    }

    fn details_beside_text() -> ToolResultDetails {
        ToolResultDetails {
            links: vec![ToolResultLink {
                uri: "https://records.example.test/rows/1".into(),
                host: "records.example.test".into(),
                matches_server_host: true,
                name: Some("row-1".into()),
                title: Some("Synthetic row".into()),
            }],
            ..ToolResultDetails::default()
        }
    }

    async fn details_of(
        result: Value,
        server_url: Option<&str>,
    ) -> (McpToolPostProcessResult, Option<Value>) {
        let result: CallToolResult = serde_json::from_value(result).unwrap();
        let tool_call = ToolCall {
            call_id: "create-call".into(),
            fn_name: "create_row".into(),
            fn_arguments: json!({}),
            thought_signatures: None,
        };
        let processed = post_process_mcp_tool_result(
            &app_state_without_storage(),
            &PolicyEngine::new(),
            &Subject::User(Uuid::new_v4().to_string()),
            Uuid::new_v4(),
            &tool_call,
            None,
            &result,
            server_url,
        )
        .await
        .unwrap();
        let details = processed
            .result_details
            .as_ref()
            .map(|details| serde_json::to_value(details).unwrap());
        (processed, details)
    }

    fn link(uri: impl Into<String>, name: impl Into<String>) -> Value {
        json!({"type": "resource_link", "uri": uri.into(), "name": name.into()})
    }

    #[tokio::test]
    async fn only_the_links_of_a_result_are_kept_beside_its_output() {
        let row = json!({"id": "row-1", "title": "SYNTHETIC-STRUCTURED"});
        let mut content = vec![json!({"type": "text", "text": "Created row row-1."})];
        content.extend(
            serde_json::to_value(blocks_beside_text())
                .unwrap()
                .as_array()
                .unwrap()
                .clone(),
        );
        let (processed, details) = details_of(
            json!({"content": content, "structuredContent": row}),
            Some(SERVER_URL),
        )
        .await;
        assert_eq!(processed.output_value, Some(json!("Created row row-1.")));
        assert_eq!(processed.tool_response.content, "Created row row-1.");
        assert_eq!(
            details,
            Some(serde_json::to_value(details_beside_text()).unwrap())
        );
        // File blocks beside the links change nothing in the details.
        let with_files = [blocks_beside_text(), file_blocks()].concat();
        let details_with_files = mcp_result_details(&with_files, Some(SERVER_URL));
        assert_eq!(details_with_files, Some(details_beside_text()));
        for stored in [
            details.unwrap().to_string(),
            serde_json::to_string(&details_with_files).unwrap(),
        ] {
            for left_out in [
                "SYNTHETIC-STRUCTURED",
                "SYNTHETIC-RESOURCE",
                "records://",
                "iVBOR",
                "mime",
            ] {
                assert!(!stored.contains(left_out), "{left_out} was kept: {stored}");
            }
        }

        for result in [
            json!({"content": [], "structuredContent": row}),
            json!({"content": [{"type": "text", "text": row.to_string()}], "structuredContent": row}),
            json!({"content": [{"type": "text", "text": "Done."}]}),
        ] {
            let (_, details) = details_of(result.clone(), Some(SERVER_URL)).await;
            assert_eq!(details, None, "{result}");
        }
    }

    #[tokio::test]
    async fn only_https_links_with_a_host_and_no_user_info_are_kept() {
        let long_path = "a".repeat(MAX_RECEIPT_FIELD_BYTES);
        let (processed, details) = details_of(
            json!({"content": [
                {"type": "text", "text": "Done."},
                link("http://records.example.test/rows/1", "plain"),
                link("javascript:alert(1)", "script"),
                link("JavaScript://records.example.test/%0Aalert(1)", "script host"),
                link("https://records.example.test@other.example.test/rows/1", "lookalike"),
                link("https://user:token@records.example.test/rows/1", "credentials"),
                link("ui://records/view", "app"),
                link("data:text/html,<p>x</p>", "data"),
                link(format!("https://records.example.test/{long_path}"), "long"),
                link("https://", "empty"),
                link("https:", "no host"),
                link("https://[::1", "malformed"),
                link("https://exa mple.test/", "space"),
                link("https://records.example.test:99999/", "port"),
                link("//records.example.test/rows/1", "relative"),
                link("", "blank"),
                link("HTTPS://Records.Example.Test/rows/2", "\u{2066}row-2\u{2069}"),
                link("https://records.example.test/rows/\u{202E}3", "row-3"),
                link("https://records.example.test/rows/\n4", "\u{0}\u{7}\u{202E}"),
            ]}),
            None,
        )
        .await;
        assert_eq!(processed.output_value, Some(json!("Done.")));
        assert_eq!(processed.tool_response.content, "Done.");
        let host = "records.example.test";
        assert_eq!(
            details,
            Some(json!({"links": [
                {"uri": "https://records.example.test/rows/2", "host": host,
                 "matches_server_host": false, "name": "row-2"},
                {"uri": "https://records.example.test/rows/%E2%80%AE3", "host": host,
                 "matches_server_host": false, "name": "row-3"},
                {"uri": "https://records.example.test/rows/4", "host": host,
                 "matches_server_host": false},
            ]}))
        );
    }

    #[test]
    fn a_link_matches_the_server_host_by_host_alone_ignoring_case() {
        let content: Vec<ContentBlock> = serde_json::from_value(json!([
            link("https://records.example.test/rows/1", "same"),
            link(
                "https://RECORDS.example.test:8443/rows/2",
                "same, other port"
            ),
            link("https://api.records.example.test/rows/3", "subdomain"),
            link("https://records.example.test.other.test/rows/4", "suffix"),
            link("https://r\u{0435}cords.example.test/rows/5", "lookalike"),
        ]))
        .unwrap();
        let matches = |server_url: Option<&str>| {
            mcp_result_details(&content, server_url)
                .unwrap()
                .links
                .iter()
                .map(|link| link.matches_server_host)
                .collect::<Vec<_>>()
        };
        for server_url in [SERVER_URL, "http://records.example.test:8080/sse"] {
            assert_eq!(
                matches(Some(server_url)),
                [true, true, false, false, false],
                "{server_url}"
            );
        }
        for server_url in [
            None,
            Some(""),
            Some("not a url"),
            Some("records.example.test/mcp"),
            Some("file:///records.example.test"),
            Some("mailto:ops@records.example.test"),
        ] {
            assert_eq!(matches(server_url), [false; 5], "{server_url:?}");
        }

        let links = mcp_result_details(&content, None).unwrap().links;
        let lookalike = &links[4].host;
        assert!(
            lookalike.starts_with("xn--") && lookalike.is_ascii(),
            "{lookalike}"
        );
        assert_eq!(links[1].host, "records.example.test");

        let content: Vec<ContentBlock> = serde_json::from_value(json!([
            link("https://127.0.0.1/rows/1", "loopback"),
            link("https://127.0.0.2/rows/1", "other address"),
            link("https://B\u{00DC}CHER.example/rows/1", "idn"),
        ]))
        .unwrap();
        let links = |server_url| {
            mcp_result_details(&content, Some(server_url))
                .unwrap()
                .links
        };
        let by_address = links("http://127.0.0.1:44321/mcp");
        assert_eq!(
            by_address
                .iter()
                .map(|link| link.matches_server_host)
                .collect::<Vec<_>>(),
            [true, false, false]
        );
        let by_name = links("https://b\u{00FC}cher.example/mcp");
        assert_eq!(by_name[2].host, "xn--bcher-kva.example");
        assert!(by_name[2].matches_server_host);
    }

    #[tokio::test]
    async fn hostile_results_keep_their_output_and_at_most_bounded_links() {
        let nested: Value =
            serde_json::from_str(&format!("{}{}", "[".repeat(120), "]".repeat(120))).unwrap();
        for structured in [
            json!(true),
            json!(1.5),
            json!("not an object"),
            json!([]),
            json!({}),
            json!({"a/b": 1, "~0": 2, "~1/": 3, "\u{202E}": 4, "\u{0}\u{7}": 5, "": 6}),
            nested,
            json!({"body": "x".repeat(2 * 1024 * 1024)}),
        ] {
            let (processed, details) = details_of(
                json!({"content": [{"type": "text", "text": "not json {"}],
                       "structuredContent": structured}),
                Some(SERVER_URL),
            )
            .await;
            assert_eq!(processed.output_value, Some(json!("not json {")));
            assert_eq!(processed.tool_response.content, "not json {");
            assert_eq!(details, None);
        }

        let many: Vec<Value> = (0..5_000)
            .map(|i| {
                link(
                    format!("https://records.example.test/rows/{i}"),
                    format!("row-{i}"),
                )
            })
            .collect();
        let (_, details) = details_of(json!({"content": many}), Some(SERVER_URL)).await;
        let links = details.unwrap()["links"].as_array().unwrap().clone();
        assert_eq!(links.len(), MAX_RESULT_LINKS);
        assert_eq!(links[0]["uri"], "https://records.example.test/rows/0");

        for skipped in [
            MAX_RESULT_LINK_CANDIDATES - 1,
            MAX_RESULT_LINK_CANDIDATES,
            5_000,
        ] {
            let mut content: Vec<Value> = (0..skipped)
                .map(|i| link(format!("http://records.example.test/rows/{i}"), "plain"))
                .collect();
            content.push(link("https://records.example.test/rows/last", "last"));
            let (_, details) = details_of(json!({"content": content}), None).await;
            assert_eq!(
                details.is_some(),
                skipped < MAX_RESULT_LINK_CANDIDATES,
                "{skipped} links before"
            );
        }

        let huge = "x".repeat(1024 * 1024);
        let full: Vec<Value> = (0..MAX_RESULT_LINKS + 1)
            .flat_map(|i| {
                [
                    link(format!("https://records.example.test/{huge}"), "huge"),
                    json!({"type": "resource_link",
                           "uri": format!("https://records.example.test/{i}/{}", "a".repeat(MAX_RECEIPT_FIELD_BYTES - 40)),
                           "name": huge, "title": "\u{1F600}".repeat(MAX_DISPLAY_NAME_CHARS * 2)}),
                ]
            })
            .collect();
        let (_, details) = details_of(json!({"content": full}), Some(SERVER_URL)).await;
        let details = details.unwrap();
        let links = details["links"].as_array().unwrap();
        assert_eq!(links.len(), MAX_RESULT_LINKS);
        for link in links {
            assert!(link["uri"].as_str().unwrap().len() <= MAX_RECEIPT_FIELD_BYTES);
            assert_eq!(
                link["name"].as_str().unwrap().chars().count(),
                MAX_DISPLAY_NAME_CHARS
            );
            assert_eq!(
                link["title"].as_str().unwrap().chars().count(),
                MAX_DISPLAY_NAME_CHARS
            );
        }
        let per_link = 2 * MAX_RECEIPT_FIELD_BYTES + 2 * 4 * MAX_DISPLAY_NAME_CHARS + 128;
        assert!(details.to_string().len() <= MAX_RESULT_LINKS * per_link);
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
                None,
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

    const MAX_TEST_FILE_BYTES: usize = 1024;

    struct NamedFiles {
        files: Vec<(Option<String>, String, Vec<u8>)>,
        stored: Vec<StoredMcpFile>,
        left_out: bool,
        content: String,
        output: Value,
        structured_content_pointer: Option<&'static str>,
    }

    /// Post-processing without storage: every validated file gets a new id,
    /// and a file without a name gets `generated-<position>`.
    fn name_files(schema: Option<&Value>, result: &CallToolResult) -> Result<NamedFiles, Report> {
        let mut content = mcp_result_to_text(result);
        let mut output = serde_json::from_str(&content)
            .ok()
            .or(Some(Value::String(content.clone())));
        let validated = validate_mcp_result_files(
            schema.map(|schema| schema.as_object().unwrap()),
            result,
            &content,
            MAX_TEST_FILE_BYTES,
        )?;
        let files: Vec<_> = validated
            .files
            .iter()
            .map(|file| {
                (
                    file.file_name.clone(),
                    file.mime_type.clone(),
                    file.bytes.clone(),
                )
            })
            .collect();
        let stored: Vec<_> = validated
            .files
            .into_iter()
            .enumerate()
            .map(|(index, file)| StoredMcpFile {
                id: Uuid::new_v4(),
                file_name: file
                    .file_name
                    .unwrap_or_else(|| format!("generated-{index}")),
                mime_type: file.mime_type,
            })
            .collect();
        let structured_content_pointer = name_stored_mcp_files(
            validated.marked_output,
            &validated.marked_fields,
            &stored,
            validated.blocks_left_out,
            &mut content,
            &mut output,
        )?;
        Ok(NamedFiles {
            files,
            stored,
            left_out: validated.blocks_left_out,
            content,
            output: output.unwrap(),
            structured_content_pointer,
        })
    }

    fn result_of(result: Value) -> CallToolResult {
        serde_json::from_value(result).unwrap()
    }

    fn file_entry(file: &StoredMcpFile) -> Value {
        json!({
            "fileReference": format!("erato-file://{}", file.id),
            "filename": file.file_name,
            "mimeType": file.mime_type,
        })
    }

    #[test]
    fn image_and_resource_blocks_become_named_file_references() {
        let result = result_of(json!({"content": [
            {"type": "text", "text": "Created the report."},
            {"type": "image", "data": "aGVsbG8=", "mimeType": "image/png",
             "_meta": {"chat.erato/file_name": "chart.png"}},
            {"type": "resource",
             "resource": {"uri": "reports://q3/export", "mimeType": "application/pdf",
                          "blob": "d29ybGQ="},
             "_meta": {"chat.erato/file_name": "report.pdf"}},
        ]}));
        let named = name_files(None, &result).unwrap();
        assert_eq!(
            named.files,
            [
                (
                    Some("chart.png".into()),
                    "image/png".into(),
                    b"hello".to_vec()
                ),
                (
                    Some("report.pdf".into()),
                    "application/pdf".into(),
                    b"world".to_vec()
                ),
            ]
        );
        assert!(!named.left_out);
        assert_eq!(
            named.output,
            json!({
                "result": "Created the report.",
                "files": [
                    {"fileReference": format!("erato-file://{}", named.stored[0].id),
                     "filename": "chart.png", "mimeType": "image/png"},
                    {"fileReference": format!("erato-file://{}", named.stored[1].id),
                     "filename": "report.pdf", "mimeType": "application/pdf"},
                ],
                "filesTruncated": false,
            })
        );
        // The model reads the stored output, which carries no bytes.
        assert_eq!(
            serde_json::from_str::<Value>(&named.content).unwrap(),
            named.output
        );
        for bytes in ["aGVsbG8=", "d29ybGQ=", "hello", "world"] {
            assert!(!named.content.contains(bytes), "{}", named.content);
        }
        assert!(matches!(
            mcp_file_content_part(named.stored[0].id, &named.stored[0].mime_type),
            ContentPart::ImageFilePointer(pointer) if pointer.file_upload_id == named.stored[0].id
        ));
        assert!(matches!(
            mcp_file_content_part(named.stored[1].id, &named.stored[1].mime_type),
            ContentPart::TextFilePointer(pointer) if pointer.file_upload_id == named.stored[1].id
        ));
        // No marked field: the view keeps the structured content as returned.
        assert_eq!(named.structured_content_pointer, None);

        // A resource's text is a file as well, and JSON output stays JSON.
        let result = result_of(json!({"content": [
            {"type": "text", "text": "{\"rows\":2}"},
            {"type": "resource",
             "resource": {"uri": "reports://q3/rows.csv", "mimeType": "text/csv",
                          "text": "x,y\n1,2\n",
                          "_meta": {"chat.erato/file_name": "rows.csv"}}},
        ]}));
        let named = name_files(None, &result).unwrap();
        assert_eq!(
            named.files,
            [(
                Some("rows.csv".into()),
                "text/csv".into(),
                b"x,y\n1,2\n".to_vec()
            )]
        );
        assert_eq!(
            named.output,
            json!({"result": {"rows": 2}, "files": [file_entry(&named.stored[0])],
                   "filesTruncated": false})
        );
        assert!(!named.content.contains("x,y"), "{}", named.content);
    }

    #[test]
    fn a_block_without_a_name_takes_the_last_segment_of_its_uri() {
        let long = format!(
            "file:///exports/{}.pdf",
            "a".repeat(MAX_RECEIPT_FIELD_BYTES)
        );
        let overlong_name = format!("file:///exports/{}.pdf", "a".repeat(MAX_DISPLAY_NAME_CHARS));
        for (uri, expected) in [
            ("file:///exports/report.pdf", Some("report.pdf")),
            (
                "file:///exports/report%20final.pdf",
                Some("report final.pdf"),
            ),
            ("records://rows/1/chart", Some("chart")),
            (
                "https://files.example.test/a/data.csv?token=x#part",
                Some("data.csv"),
            ),
            ("file:///exports/safe%E2%80%AEtxt.pdf", Some("safetxt.pdf")),
            ("https://files.example.test/", None),
            ("https://files.example.test", None),
            ("https://files.example.test/a%2Fb.pdf", None),
            ("file:///exports/a%5Cb.pdf", None),
            ("file:///exports/a%3Ab.pdf", None),
            ("file:///exports/a%0Ab.pdf", None),
            ("file:///exports/%2E%2E", None),
            ("urn:report:1", None),
            ("not a uri", None),
            ("", None),
            (long.as_str(), None),
            (overlong_name.as_str(), None),
        ] {
            let result = result_of(json!({"content": [
                {"type": "resource",
                 "resource": {"uri": uri, "mimeType": "application/pdf", "blob": "aGVsbG8="}},
            ]}));
            let named = name_files(None, &result).unwrap();
            assert_eq!(named.files[0].0.as_deref(), expected, "{uri}");
        }

        // `_meta` names the file before the URI does, the block's before the
        // resource's; an image has no URI to fall back on.
        let result = result_of(json!({"content": [
            {"type": "resource",
             "resource": {"uri": "file:///exports/a.pdf", "mimeType": "application/pdf",
                          "blob": "YQ==", "_meta": {"chat.erato/file_name": "resource.pdf"}},
             "_meta": {"chat.erato/file_name": "block.pdf"}},
            {"type": "resource",
             "resource": {"uri": "file:///exports/b.pdf", "mimeType": "application/pdf",
                          "blob": "Yg==", "_meta": {"chat.erato/file_name": "resource.pdf"}},
             "_meta": {"chat.erato/file_name": null, "other": 1}},
            {"type": "resource",
             "resource": {"uri": "file:///exports/c.pdf", "mimeType": "application/pdf",
                          "blob": "Yw==", "_meta": {"chat.erato/file_name": ""}}},
            {"type": "resource",
             "resource": {"uri": "urn:report:1", "mimeType": "application/pdf", "blob": "Zg=="}},
            {"type": "image", "data": "ZA==", "mimeType": "image/png"},
            {"type": "image", "data": "ZQ==", "mimeType": "image/png",
             "_meta": {"chat.erato/file_name": "\u{2066}chart\u{2069}.png"}},
        ]}));
        let named = name_files(None, &result).unwrap();
        assert_eq!(
            named
                .files
                .iter()
                .map(|file| file.0.as_deref())
                .collect::<Vec<_>>(),
            [
                Some("block.pdf"),
                Some("resource.pdf"),
                Some("c.pdf"),
                None,
                None,
                Some("chart.png")
            ]
        );
        // A file without a name is listed under the name it is stored with.
        assert_eq!(named.output["files"][4], file_entry(&named.stored[4]));
        assert_eq!(named.output["files"][4]["filename"], "generated-4");
    }

    #[tokio::test]
    async fn a_malformed_file_block_fails_before_persistence() {
        // Any persistence attempt panics: no database or storage is configured.
        let app_state = app_state_without_storage();
        let policy = PolicyEngine::new();
        let subject = Subject::User(Uuid::new_v4().to_string());
        let tool_call = ToolCall {
            call_id: "export-call".into(),
            fn_name: "export_report".into(),
            fn_arguments: json!({}),
            thought_signatures: None,
        };
        let resource = |resource: Value| json!({"type": "resource", "resource": resource});
        let named = |name: Value| {
            json!({"type": "image", "data": "aGVsbG8=", "mimeType": "image/png",
                   "_meta": {"chat.erato/file_name": name}})
        };
        for (malformed, expected_error) in [
            (
                json!({"type": "image", "data": "invalid!", "mimeType": "image/png"}),
                "Failed to decode base64 file data from MCP at /content/2",
            ),
            (
                json!({"type": "image", "data": "aGVsbG8=", "mimeType": "invalid"}),
                "Invalid MIME type",
            ),
            (
                json!({"type": "image", "data": "aGVsbG8=", "mimeType": ""}),
                "Invalid MIME type",
            ),
            (
                resource(
                    json!({"uri": "file:///a.pdf", "mimeType": "application/pdf",
                           "blob": "invalid!"}),
                ),
                "Failed to decode base64 file data from MCP at /content/2",
            ),
            (
                resource(json!({"uri": "file:///a.pdf", "mimeType": "", "blob": "aGVsbG8="})),
                "Invalid MIME type",
            ),
            (
                // No `mimeType` is no excuse for bad Base64.
                resource(json!({"uri": "file:///a.pdf", "blob": "invalid!"})),
                "Failed to decode base64 file data from MCP at /content/2",
            ),
            (
                resource(
                    json!({"uri": "file:///a.txt", "mimeType": "text\n/plain", "text": "hello"}),
                ),
                "Invalid MIME type",
            ),
            (named(json!("../chart.png")), "Unsafe filename"),
            (named(json!("dir\\chart.png")), "Unsafe filename"),
            (named(json!("c:chart.png")), "Unsafe filename"),
            (named(json!("chart\n.png")), "Unsafe filename"),
            (named(json!(".\u{200B}.")), "Unsafe filename"),
            (
                named(json!(7)),
                "MCP file name 'chat.erato/file_name' at /content/2 is not a string",
            ),
            (
                named(json!("a".repeat(MAX_DISPLAY_NAME_CHARS + 1))),
                "Filename in MCP file output is longer than",
            ),
        ] {
            let result = result_of(json!({"content": [
                {"type": "text", "text": "Exported."},
                {"type": "image", "data": "d29ybGQ=", "mimeType": "image/png"},
                malformed,
            ]}));
            let error = post_process_mcp_tool_result(
                &app_state,
                &policy,
                &subject,
                Uuid::new_v4(),
                &tool_call,
                None,
                &result,
                None,
            )
            .await
            .err()
            .expect("a malformed block must fail before accessing storage");
            assert!(error.to_string().contains(expected_error), "{error}");

            // What the model gets instead names the error and carries no bytes.
            let output = mcp_tool_processing_error_output(
                &result,
                &format!("Failed to process MCP tool output: {error}"),
            );
            assert_eq!(output["status"], "error");
            assert_eq!(output["mcp_output"], "Exported.");
            assert!(
                output["error"].as_str().unwrap().contains(expected_error),
                "{output}"
            );
            assert!(!output.to_string().contains("d29ybGQ="), "{output}");
        }

        // A file larger than an upload may be is refused undecoded.
        let at_limit = "x".repeat(MAX_TEST_FILE_BYTES);
        let over_limit = "x".repeat(MAX_TEST_FILE_BYTES + 1);
        let encoded = |text: &str| {
            use base64::{Engine as _, engine::general_purpose::STANDARD};
            STANDARD.encode(text)
        };
        for (block, fits) in [
            (
                json!({"type": "image", "data": encoded(&at_limit), "mimeType": "image/png"}),
                true,
            ),
            (
                json!({"type": "image", "data": encoded(&over_limit), "mimeType": "image/png"}),
                false,
            ),
            (
                resource(
                    json!({"uri": "file:///a.txt", "mimeType": "text/plain", "text": at_limit}),
                ),
                true,
            ),
            (
                resource(
                    json!({"uri": "file:///a.txt", "mimeType": "text/plain", "text": over_limit}),
                ),
                false,
            ),
        ] {
            let named = name_files(None, &result_of(json!({"content": [block]})));
            match named {
                Ok(named) => assert!(fits && named.files.len() == 1),
                Err(error) => assert!(
                    !fits
                        && error.to_string().contains(
                            "MCP file output at /content/0 is larger than the 1024 bytes"
                        ),
                    "{error}"
                ),
            }
        }
    }

    #[test]
    fn marked_fields_and_file_blocks_share_one_result() {
        let schema = json!({
            "type": "object",
            "properties": {
                "files": { "type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "data_base64": { "type": "string", "chat.erato/file_content_field": true },
                        "name": { "type": "string" },
                        "mime_type": { "type": "string" }
                    }
                }}
            }
        });
        let structured = json!({"summary": "Exported.", "files": [
            {"name": "chart.png", "mime_type": "image/png", "data_base64": "aGVsbG8="}
        ]});

        // Marked fields alone: the output is the structured content with the
        // reference in place of the Base64, as before.
        let result = CallToolResult::structured(structured.clone());
        let named = name_files(Some(&schema), &result).unwrap();
        assert_eq!(
            named.files,
            [(
                Some("chart.png".into()),
                "image/png".into(),
                b"hello".to_vec()
            )]
        );
        let mut replaced = structured.clone();
        replaced["files"][0]["data_base64"] = json!(format!("erato-file://{}", named.stored[0].id));
        assert_eq!(named.output, replaced);
        assert_eq!(
            serde_json::from_str::<Value>(&named.content).unwrap(),
            replaced
        );
        assert_eq!(
            structured_content_for_view(
                &result,
                named.structured_content_pointer,
                Some(&named.output)
            ),
            Some(&replaced)
        );

        // The marked field's file again as a block is not stored twice;
        // blocks with other files are listed beside the output, also where
        // two of them hold the same bytes under different names.
        let mut result = CallToolResult::structured(structured.clone());
        result.content.extend(
            serde_json::from_value::<Vec<ContentBlock>>(json!([
                {"type": "image", "data": "aGVsbG8=", "mimeType": "image/png",
                 "_meta": {"chat.erato/file_name": "chart-copy.png"}},
                {"type": "resource",
                 "resource": {"uri": "file:///exports/data.csv", "mimeType": "text/csv",
                              "text": "x,y\n"}},
                {"type": "resource",
                 "resource": {"uri": "file:///exports/again.csv", "mimeType": "text/csv",
                              "blob": "eCx5Cg=="}},
            ]))
            .unwrap(),
        );
        let named = name_files(Some(&schema), &result).unwrap();
        assert_eq!(
            named.files,
            [
                (
                    Some("chart.png".into()),
                    "image/png".into(),
                    b"hello".to_vec()
                ),
                (
                    Some("data.csv".into()),
                    "text/csv".into(),
                    b"x,y\n".to_vec()
                ),
                (
                    Some("again.csv".into()),
                    "text/csv".into(),
                    b"x,y\n".to_vec()
                ),
            ]
        );
        let mut replaced = structured.clone();
        replaced["files"][0]["data_base64"] = json!(format!("erato-file://{}", named.stored[0].id));
        assert_eq!(
            named.output,
            json!({"result": replaced,
                   "files": [file_entry(&named.stored[1]), file_entry(&named.stored[2])],
                   "filesTruncated": false})
        );
        assert!(!named.content.contains("aGVsbG8="), "{}", named.content);
        // The view gets the structured content alone, naming its file.
        let for_view = structured_content_for_view(
            &result,
            named.structured_content_pointer,
            Some(&named.output),
        );
        assert_eq!(for_view, Some(&replaced));

        // Without a marked field, blocks with the same bytes are two files.
        let result = result_of(json!({"content": [
            {"type": "text", "text": "Exported."},
            {"type": "resource",
             "resource": {"uri": "file:///exports/a.csv", "mimeType": "text/csv", "text": ""}},
            {"type": "resource",
             "resource": {"uri": "file:///exports/b.csv", "mimeType": "text/csv", "text": ""}},
            {"type": "image", "data": "aGVsbG8=", "mimeType": "image/png"},
            {"type": "image", "data": "aGVsbG8=", "mimeType": "image/png"},
        ]}));
        let named = name_files(None, &result).unwrap();
        assert_eq!(
            named
                .files
                .iter()
                .map(|file| file.0.as_deref())
                .collect::<Vec<_>>(),
            [Some("a.csv"), Some("b.csv"), None, None]
        );
        assert_eq!(named.output["files"].as_array().unwrap().len(), 4);

        // A marked schema without files in the result: blocks are still read,
        // and the view keeps the structured content as returned.
        let empty = json!({"summary": "Exported.", "files": []});
        let mut result = CallToolResult::structured(empty.clone());
        result.content.push(
            serde_json::from_value(
                json!({"type": "image", "data": "aGVsbG8=", "mimeType": "image/png"}),
            )
            .unwrap(),
        );
        let named = name_files(Some(&schema), &result).unwrap();
        assert_eq!(named.output["result"], empty);
        assert_eq!(named.output["files"], json!([file_entry(&named.stored[0])]));
        assert_eq!(named.structured_content_pointer, None);
        assert_eq!(
            structured_content_for_view(&result, None, Some(&named.output)),
            Some(&empty)
        );

        // A malformed marked field fails the result whatever its blocks hold.
        let mut result = CallToolResult::structured(json!({"files": [
            {"name": "chart.png", "mime_type": "image/png", "data_base64": "invalid!"}
        ]}));
        result.content.push(
            serde_json::from_value(
                json!({"type": "image", "data": "aGVsbG8=", "mimeType": "image/png"}),
            )
            .unwrap(),
        );
        let error = name_files(Some(&schema), &result).err().unwrap();
        assert!(
            error.to_string().contains("Failed to decode base64"),
            "{error}"
        );
    }

    #[test]
    fn a_resource_without_a_mime_type_gets_a_default_and_a_view_is_no_file() {
        let result = result_of(json!({"content": [
            {"type": "text", "text": "Exported."},
            {"type": "resource", "resource": {"uri": "file:///exports/notes", "text": "hello"}},
            {"type": "resource",
             "resource": {"uri": "file:///exports/dump", "blob": "d29ybGQ="}},
            // Views of any spelling, well-formed or not, stay unread.
            {"type": "resource",
             "resource": {"uri": "ui://records/row", "mimeType": "text/html;profile=mcp-app",
                          "text": "<p>SYNTHETIC-VIEW</p>"}},
            {"type": "resource", "resource": {"uri": "UI://records/chart", "blob": "invalid!"}},
            {"type": "resource",
             "resource": {"uri": "ui:row", "mimeType": "invalid", "text": "<p>SYNTHETIC-VIEW</p>"},
             "_meta": {"chat.erato/file_name": "../view.html"}},
            // A URI that only begins like the scheme is a file.
            {"type": "resource",
             "resource": {"uri": "uix://records/row.txt", "mimeType": "text/plain", "text": "row"}},
        ]}));
        let named = name_files(None, &result).unwrap();
        assert_eq!(
            named.files,
            [
                (Some("notes".into()), "text/plain".into(), b"hello".to_vec()),
                (
                    Some("dump".into()),
                    "application/octet-stream".into(),
                    b"world".to_vec()
                ),
                (Some("row.txt".into()), "text/plain".into(), b"row".to_vec()),
            ]
        );
        assert_eq!(
            named.output["files"],
            json!([
                file_entry(&named.stored[0]),
                file_entry(&named.stored[1]),
                file_entry(&named.stored[2])
            ])
        );
        assert!(matches!(
            mcp_file_content_part(named.stored[1].id, &named.stored[1].mime_type),
            ContentPart::TextFilePointer(_)
        ));
        assert!(
            !named.content.contains("SYNTHETIC-VIEW"),
            "{}",
            named.content
        );

        // A result that holds only a view keeps its output as it was.
        let result = result_of(json!({"content": [
            {"type": "text", "text": "Shown."},
            {"type": "resource",
             "resource": {"uri": "ui://records/row", "mimeType": "text/html;profile=mcp-app",
                          "text": "<p>SYNTHETIC-VIEW</p>"}},
        ]}));
        let named = name_files(None, &result).unwrap();
        assert!(named.files.is_empty());
        assert_eq!(named.output, json!("Shown."));
        assert_eq!(named.content, "Shown.");
    }

    #[test]
    fn file_blocks_past_the_bound_are_left_out_unread() {
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        let image = |index: usize| {
            json!({"type": "image", "data": STANDARD.encode(format!("image {index}")),
                   "mimeType": "image/png"})
        };
        for count in [
            MAX_RESULT_FILE_BLOCKS - 1,
            MAX_RESULT_FILE_BLOCKS,
            MAX_RESULT_FILE_BLOCKS + 1,
            5_000,
        ] {
            let mut content = vec![json!({"type": "text", "text": "Done."})];
            // Blocks that are no files do not count, embedded views included.
            content.extend((0..MAX_RESULT_FILE_BLOCKS).flat_map(|i| {
                [
                    link(
                        format!("https://records.example.test/rows/{i}"),
                        format!("row-{i}"),
                    ),
                    json!({"type": "resource",
                           "resource": {"uri": format!("ui://records/rows/{i}"),
                                        "text": "<p>view</p>"}}),
                ]
            }));
            content.extend((0..count).map(image));
            // A malformed block fails the result within the bound; past it,
            // the block is not read.
            content.push(json!({"type": "image", "data": "invalid!", "mimeType": "invalid"}));
            let named = name_files(None, &result_of(json!({"content": content})));
            if count < MAX_RESULT_FILE_BLOCKS {
                let error = named
                    .err()
                    .expect("the malformed block is within the bound");
                assert!(error.to_string().contains("Invalid MIME type"), "{error}");
                continue;
            }
            let named = named.unwrap();
            assert_eq!(named.files.len(), MAX_RESULT_FILE_BLOCKS);
            assert_eq!(named.files[0].2, b"image 0");
            assert_eq!(
                named.files[MAX_RESULT_FILE_BLOCKS - 1].2,
                format!("image {}", MAX_RESULT_FILE_BLOCKS - 1).into_bytes()
            );
            assert!(named.left_out);
            let files = named.output["files"].as_array().unwrap();
            assert_eq!(files.len(), MAX_RESULT_FILE_BLOCKS);
            assert_eq!(named.output["filesTruncated"], true);
            assert_eq!(named.output["result"], "Done.");
        }

        // Exactly the bound, nothing after it: nothing was left out.
        let content: Vec<Value> = (0..MAX_RESULT_FILE_BLOCKS).map(image).collect();
        let named = name_files(None, &result_of(json!({"content": content}))).unwrap();
        assert_eq!(named.files.len(), MAX_RESULT_FILE_BLOCKS);
        assert!(!named.left_out);
        assert_eq!(named.output["filesTruncated"], false);
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
