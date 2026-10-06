//! Request-scoped retrieval of embedded PDF images.

use crate::models::message::{ContentPart, ContentPartImage, GenerationInputMessages};
use crate::policy::prelude::*;
use crate::services::file_processing_cached::{get_file_bytes_cached, get_file_cache_key};
use crate::services::file_storage::SharepointContext;
use crate::state::AppState;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use eyre::{OptionExt, Report, WrapErr, eyre};
use genai::chat::{ChatRequest, Tool, ToolName};
use sea_orm::prelude::Uuid;
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const TOOL_NAME: &str = "retrieve_embedded_image";
pub const IMAGE_OUTPUT_KEY: &str = "embedded_image";

/// Extract the durable image payload before serializing the text-only tool envelope.
pub fn take_output_image(output: &mut Value) -> Option<ContentPartImage> {
    let image = output.as_object_mut()?.remove(IMAGE_OUTPUT_KEY)?;
    serde_json::from_value(image).ok()
}

fn embedded_id(file_id: Uuid, index: u32) -> String {
    format!("file-embed://{file_id}/{index}")
}

fn parse_id(id: &str) -> Result<(Uuid, u32), Report> {
    let (file, index) = id
        .strip_prefix("file-embed://")
        .and_then(|id| id.split_once('/'))
        .ok_or_eyre("Invalid embedded image ID")?;
    Ok((file.parse()?, index.parse()?))
}

async fn extract_pdf(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    file_id: Uuid,
    access_token: Option<&str>,
) -> Result<xberg::ExtractedDocument, Report> {
    let file =
        crate::models::file_upload::get_file_upload_by_id(&app_state.db, policy, subject, &file_id)
            .await?;
    let storage = app_state
        .file_storage_providers
        .get(&file.file_storage_provider_id)
        .ok_or_eyre("File storage unavailable")?;
    let context = access_token.map(|access_token| SharepointContext { access_token });
    let mime_type = storage
        .get_file_content_type_with_context(&file.file_storage_path, context.as_ref())
        .await?;
    if !file.filename.to_ascii_lowercase().ends_with(".pdf")
        && mime_type
            .as_deref()
            .is_none_or(|mime| mime.split(';').next().unwrap_or(mime).trim() != "application/pdf")
    {
        return Err(eyre!("File is not a PDF"));
    }
    // Refresh SharePoint metadata/permissions before using the shared byte
    // cache. ETags prevent a modified remote PDF from reusing stale bytes.
    let cache_key =
        get_file_cache_key(storage, &file_id, &file.file_storage_path, context.as_ref()).await?;
    let bytes = get_file_bytes_cached(
        app_state,
        &cache_key,
        storage,
        &file.file_storage_path,
        context.as_ref(),
    )
    .await?;
    if !bytes.starts_with(b"%PDF-") {
        return Err(eyre!("File is not a PDF"));
    }
    let _permit = app_state.file_processing_semaphore.acquire().await?;
    tokio::task::spawn_blocking(move || {
        let config = extraction_config();
        crate::services::file_processor::extract_xberg_bytes_sync(
            &bytes,
            "application/pdf",
            &config,
        )
        .wrap_err("Failed to extract embedded images")
    })
    .await?
}

fn extraction_config() -> xberg::ExtractionConfig {
    xberg::ExtractionConfig {
        use_cache: false,
        output_format: xberg::OutputFormat::Markdown,
        images: Some(xberg::ImageExtractionConfig {
            extract_images: true,
            ..Default::default()
        }),
        pages: Some(xberg::PageConfig {
            extract_pages: true,
            insert_page_markers: true,
            marker_format: "<page number=\"{page_num}\">".to_string(),
        }),
        ..Default::default()
    }
}

fn mark_images(file_id: Uuid, document: &xberg::ExtractedDocument) -> (String, Vec<String>) {
    let mut content = crate::services::file_processor::content_with_page_markers(
        document.content.clone(),
        document.pages.clone(),
        "<page number=\"{page_num}\">",
    )
    .replace('\0', "");
    let mut ids = Vec::new();
    for image in document
        .images
        .iter()
        .flatten()
        .filter(|image| !image.data.is_empty() && !image.is_mask)
    {
        let id = embedded_id(file_id, image.image_index);
        let marker = format!(
            "<image num=\"{}\" embeddedId=\"{id}\">",
            image.image_index + 1
        );
        // xberg uses zero-based image_N.format references in Markdown output.
        let pattern = format!(
            r"!\[[^\]]*\]\(image_{}\.{}\)",
            image.image_index,
            regex::escape(&image.format)
        );
        let regex = regex::Regex::new(&pattern).expect("valid image reference pattern");
        if regex.is_match(&content) {
            content = regex.replace_all(&content, marker.as_str()).into_owned();
        } else {
            // Some PDF extraction paths omit image references from rendered text.
            content.push_str(&format!("\n{marker}"));
        }
        ids.push(id);
    }
    (content, ids)
}

/// Enrich only files present in this prompt. The schema is the dispatch allowlist,
/// so guessed IDs and files from other chats cannot be retrieved.
#[allow(clippy::too_many_arguments)]
pub async fn prepare(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    source: &GenerationInputMessages,
    resolved: &mut GenerationInputMessages,
    plans: &mut [crate::services::file_context::PlannedAttachment],
    context_size: usize,
    access_token: Option<&str>,
    enabled: bool,
    omit_strict: bool,
) -> Option<Tool> {
    if !enabled {
        return None;
    }
    // Resolution expands image pointers into two parts; all other source
    // messages resolve to one. Use those positions so ordinary user text can
    // never be mistaken for a resolved file, and enrich repeated files too.
    let mut file_positions: BTreeMap<Uuid, Vec<usize>> = BTreeMap::new();
    let mut position = 0;
    let mut plan_index = 0;
    let mut plan_positions = BTreeMap::new();
    for message in &source.messages {
        if let ContentPart::TextFilePointer(pointer) = &message.content {
            file_positions
                .entry(pointer.file_upload_id)
                .or_default()
                .push(position);
        }
        if matches!(
            message.content,
            ContentPart::TextFilePointer(_) | ContentPart::ImageFilePointer(_)
        ) {
            plan_positions.insert(position, plan_index);
            position += plans.get(plan_index).map_or(1, |p| p.parts.len());
            plan_index += 1;
        } else {
            position += 1;
        }
    }
    let mut ids = Vec::new();
    let mut has_pdf = false;
    for (file_id, positions) in file_positions {
        let header = format!("file_id: erato_file_id:{file_id}\nFile contents\n");
        if !positions.iter().any(|position| {
            resolved.messages.get(*position).is_some_and(|message| {
                matches!(&message.content, ContentPart::Text(text) if text.text.contains(&header))
            })
        }) {
            continue;
        }
        match extract_pdf(app_state, policy, subject, file_id, access_token).await {
            Ok(document) => {
                has_pdf = true;
                let (text, image_ids) = mark_images(file_id, &document);
                for position in positions {
                    if let Some(message) = resolved.messages.get_mut(position)
                        && let ContentPart::Text(part) = &mut message.content
                        && let Some((prefix, _)) = part.text.split_once(&header)
                    {
                        let rendered = format!("{prefix}{header}---\n{text}\n---");
                        let Some(&index) = plan_positions.get(&position) else {
                            continue;
                        };
                        let cost = crate::services::file_context::tokens(&rendered);
                        let config = &app_state.config.file_context;
                        // Optional image-location annotations may not bypass the file budget.
                        // The tool's enum still identifies retrievable images when annotations
                        // do not fit, so retain the already planned text in that case.
                        if config.max_inline_tokens_per_file != 0
                            && cost > config.max_inline_tokens_per_file
                        {
                            continue;
                        }
                        if config
                            .attachment_budget(context_size)
                            .is_some_and(|budget| {
                                plans
                                    .iter()
                                    .map(|p| p.budget_token_count(config))
                                    .sum::<usize>()
                                    - plans[index].budget_token_count(config)
                                    + cost
                                    > budget
                            })
                        {
                            continue;
                        }
                        part.text = rendered.clone();
                        plans[index].parts[0] =
                            ContentPart::Text(crate::models::message::ContentPartText {
                                text: rendered,
                            });
                        plans[index].token_count = cost;
                        plans[index].full_token_count = Some(cost);
                    }
                }
                ids.extend(image_ids);
            }
            Err(error) => tracing::debug!(%file_id, %error, "Embedded PDF images unavailable"),
        }
    }
    has_pdf.then(|| build_tool(ids, omit_strict))
}

fn build_tool(ids: Vec<String>, omit_strict: bool) -> Tool {
    let mut id_schema = json!({"type": "string"});
    // JSON Schema requires enum to have at least one element. A PDF with no
    // images still offers the tool, but dispatch refuses every ID.
    if !ids.is_empty() {
        id_schema["enum"] = json!(ids);
    }
    Tool {
        name: ToolName::Custom(TOOL_NAME.into()),
        description: Some("Retrieve an embedded image from a PDF in this conversation. Use the embeddedId from an <image> marker. The image follows the tool response as an image content part.".into()),
        schema: Some(json!({"type": "object", "properties": {"embedded_id": id_schema}, "required": ["embedded_id"], "additionalProperties": false})),
        strict: if omit_strict { None } else { Some(false) },
        config: None,
        custom_format: None,
        cache_control: None,
        eager_input_streaming: None,
    }
}

fn validate_request_id(request: &ChatRequest, input: &Value) -> Result<(Uuid, u32), Report> {
    let id = input
        .get("embedded_id")
        .and_then(Value::as_str)
        .ok_or_eyre("Missing embedded_id")?;
    let offered = request
        .tools
        .iter()
        .flatten()
        .find(|tool| tool.name.to_string() == TOOL_NAME)
        .and_then(|tool| tool.schema.as_ref())
        .and_then(|schema| schema["properties"]["embedded_id"]["enum"].as_array())
        .is_some_and(|ids| ids.iter().any(|offered| offered.as_str() == Some(id)));
    if !offered {
        return Err(eyre!("Embedded image was not offered for this request"));
    }
    parse_id(id)
}

pub async fn retrieve(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    request: &ChatRequest,
    input: &Value,
    access_token: Option<&str>,
) -> Result<ContentPartImage, Report> {
    let (file_id, index) = validate_request_id(request, input)?;
    let document = extract_pdf(app_state, policy, subject, file_id, access_token).await?;
    image_content(document, index)
}

fn image_content(
    document: xberg::ExtractedDocument,
    index: u32,
) -> Result<ContentPartImage, Report> {
    let image = document
        .images
        .into_iter()
        .flatten()
        .find(|image| image.image_index == index && !image.is_mask && !image.data.is_empty())
        .ok_or_eyre("Embedded image unavailable")?;
    let content_type = infer::get(&image.data)
        .filter(|kind| kind.mime_type().starts_with("image/"))
        .ok_or_eyre("Unsupported embedded image format")?
        .mime_type()
        .to_string();
    Ok(ContentPartImage {
        content_type,
        base64_data: STANDARD.encode(&image.data),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{MessageRole, ToolCallStatus, ToolUse};

    fn pdf_document() -> xberg::ExtractedDocument {
        crate::services::file_processor::extract_xberg_bytes_sync(
            include_bytes!("../../tests/integration_tests/test_files/embedded-images.pdf"),
            "application/pdf",
            &extraction_config(),
        )
        .unwrap()
    }

    #[test]
    fn embedded_images_have_document_wide_ids_and_decodable_data() {
        let document = pdf_document();
        let file_id = Uuid::new_v4();
        let (text, ids) = mark_images(file_id, &document);
        assert_eq!(ids, vec![embedded_id(file_id, 0), embedded_id(file_id, 1)]);
        assert!(text.contains("Image on page 1"));
        assert!(text.contains("Image on page 2"));
        assert!(text.contains("<page number=\"1\""));
        assert!(text.contains("<page number=\"2\""));
        for (index, image) in document.images.as_ref().unwrap().iter().enumerate() {
            assert!(text.contains(&format!("embeddedId=\"{}\"", ids[index])));
            assert!(
                infer::get(&image.data)
                    .unwrap()
                    .mime_type()
                    .starts_with("image/")
            );
            assert_eq!(
                STANDARD.decode(STANDARD.encode(&image.data)).unwrap(),
                image.data
            );
        }
        let first = image_content(document.clone(), 0).unwrap();
        let second = image_content(document.clone(), 1).unwrap();
        assert_ne!(first.base64_data, second.base64_data);
        assert_eq!(
            STANDARD.decode(&second.base64_data).unwrap(),
            document.images.as_ref().unwrap()[1].data
        );
        assert!(image_content(document.clone(), 2).is_err());
        let other_file = Uuid::new_v4();
        assert_ne!(ids, mark_images(other_file, &document).1);
        assert!(!text.contains("image_0."));
    }

    #[test]
    fn retrieval_rejects_unoffered_files_indices_and_malformed_ids() {
        let file_id = Uuid::new_v4();
        let id = embedded_id(file_id, 1);
        let request = ChatRequest {
            tools: Some(vec![build_tool(vec![id.clone()], false)]),
            ..Default::default()
        };
        assert_eq!(
            validate_request_id(&request, &json!({"embedded_id": id})).unwrap(),
            (file_id, 1)
        );
        for input in [
            json!({}),
            json!({"embedded_id": 1}),
            json!({"embedded_id": "bad"}),
            json!({"embedded_id": embedded_id(file_id, 0)}),
            json!({"embedded_id": embedded_id(Uuid::new_v4(), 1)}),
        ] {
            assert!(validate_request_id(&request, &input).is_err());
        }
        assert!(validate_request_id(&ChatRequest::default(), &json!({"embedded_id": id})).is_err());
        let empty = ChatRequest {
            tools: Some(vec![build_tool(Vec::new(), true)]),
            ..Default::default()
        };
        assert!(validate_request_id(&empty, &json!({"embedded_id": id})).is_err());
        assert_eq!(empty.tools.unwrap()[0].strict, None);
        for invalid in [
            "file-embed://bad/0",
            &format!("file-embed://{file_id}/-1"),
            &format!("file-embed://{file_id}/0/1"),
        ] {
            assert!(parse_id(invalid).is_err());
        }
    }

    #[test]
    fn retrieved_images_replay_after_tool_response_as_user_input() {
        let image = ContentPartImage {
            content_type: "image/png".into(),
            base64_data: "aW1hZ2U=".into(),
        };
        let parts = vec![ContentPart::ToolUse(ToolUse {
            tool_call_id: "image-call".into(),
            tool_name: TOOL_NAME.into(),
            input: Some(json!({"embedded_id": embedded_id(Uuid::new_v4(), 0)})),
            output: Some(json!({"status": "success", IMAGE_OUTPUT_KEY: image})),
            status: ToolCallStatus::Success,
            ..Default::default()
        })];
        // Check the durable representation survives serialization before replay.
        let persisted: Vec<ContentPart> =
            serde_json::from_value(serde_json::to_value(parts).unwrap()).unwrap();
        let messages = crate::services::prompt_composition::transforms::replay_assistant_content(
            &MessageRole::Assistant,
            persisted,
        );
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, MessageRole::Assistant);
        assert_eq!(messages[1].role, MessageRole::Tool);
        let request = GenerationInputMessages { messages }.into_chat_request();
        assert_eq!(request.messages.len(), 3);
        assert!(request.messages[1].content.contains_tool_response());
        assert!(
            !request.messages[1].content.tool_responses()[0]
                .content
                .contains("aW1hZ2U=")
        );
        assert_eq!(request.messages[2].role, genai::chat::ChatRole::User);
        assert_eq!(request.messages[2].content.parts().len(), 1);
    }
}
