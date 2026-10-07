//! Integrated text reads. Only typed, approved conversation references are eligible.
use crate::models::message::{
    ContentPart, GenerationInputMessages, InputMessage, MessageRole, ToolCallStatus,
};
use crate::policy::prelude::*;
use crate::services::file_context::{Attachment, Coverage};
use crate::services::file_storage::SharepointContext;
use crate::state::AppState;
use eyre::{Report, bail, eyre};
use genai::chat::{ChatRequest, Tool, ToolName};
use sea_orm::prelude::Uuid;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub const TOOL_NAME: &str = "retrieve_file_contents";
const MARKER: &str = "requested_in_full";

#[derive(Debug, Clone, Default)]
pub struct RetrievalContext {
    pub enabled: bool,
    pub offered: bool,
    pub files: BTreeMap<Uuid, Result<(), String>>,
}

impl RetrievalContext {
    pub fn observe(&mut self, file: &Attachment) {
        if (file.coverage == Coverage::Unavailable
            || file.coverage == Coverage::Partial && file.reason != "bounded_text_extraction"
            || file.image.is_some())
            && let Ok(id) = file.id.parse()
            && let Some(status) = self.files.get_mut(&id)
        {
            *status = Err(if file.image.is_some() {
                "unsupported integrated text extraction".into()
            } else {
                file.reason.clone()
            });
        }
    }

    pub fn indicator(&self, file: &Attachment) -> String {
        let reason = if !self.offered {
            Some("tool disabled or not offered")
        } else if file.uri.is_none() {
            Some("missing accessible persisted bytes")
        } else if file.coverage == Coverage::Unavailable
            || (file.coverage == Coverage::Partial && file.reason != "bounded_text_extraction")
        {
            Some(file.reason.as_str())
        } else {
            match file.id.parse().ok().and_then(|id| self.files.get(&id)) {
                Some(Ok(())) => None,
                Some(Err(reason)) => Some(reason.as_str()),
                None => Some("file not approved for chat context"),
            }
        };
        match reason {
            Some(reason) => format!("Full extracted text retrieval: unavailable ({reason})."),
            None => "Full extracted text retrieval: available via retrieve_file_contents (subject to extraction and provider limits).".into(),
        }
    }

    pub fn tool(&self, omit_strict: bool) -> Option<Tool> {
        if !self.offered {
            return None;
        }
        let ids: Vec<_> = self
            .files
            .iter()
            .filter(|(_, status)| status.is_ok())
            .map(|(id, _)| format!("erato-file://{id}"))
            .collect();
        let mut reference = json!({"type": "string"});
        if !ids.is_empty() {
            reference["enum"] = json!(ids);
        }
        Some(Tool {
            name: ToolName::Custom(TOOL_NAME.into()),
            description: Some("Request the complete textual extraction of an approved file in this conversation. Contents follow the tool result separately. This does not transfer original bytes or guarantee preservation of visual elements.".into()),
            schema: Some(json!({"type":"object", "properties":{"file_reference":reference}, "required":["file_reference"], "additionalProperties":false})),
            strict: if omit_strict { None } else { Some(false) },
            config: None, custom_format: None, cache_control: None, eager_input_streaming: None,
        })
    }
}

pub fn parse_reference(reference: &str) -> Result<Uuid, Report> {
    reference
        .strip_prefix("erato-file://")
        .ok_or_else(|| eyre!("Invalid file reference"))?
        .parse()
        .map_err(Into::into)
}

/// Durable metadata is independent of extraction coverage. Never inspect free text
/// or arbitrary external tool output for file IDs.
pub fn requested_file(message: &InputMessage) -> Option<Uuid> {
    if message.role != MessageRole::Tool {
        return None;
    }
    let ContentPart::ToolUse(tool) = &message.content else {
        return None;
    };
    let output = tool.output.as_ref()?;
    if tool.tool_name != TOOL_NAME
        || tool.status != ToolCallStatus::Success
        || output["file_context_status"] != MARKER
        || output["extraction_status"] != "complete"
    {
        return None;
    }
    parse_reference(output["file_reference"].as_str()?).ok()
}

pub fn approved_references(source: &GenerationInputMessages) -> BTreeSet<Uuid> {
    source
        .messages
        .iter()
        .filter_map(|message| {
            // Typed pointers have already passed the source-specific admission
            // flow. Arbitrary IDs in tool result text do not grant admission.
            match &message.content {
                ContentPart::TextFilePointer(p) => Some(p.file_upload_id),
                ContentPart::ImageFilePointer(p) => Some(p.file_upload_id),
                _ => None,
            }
        })
        .collect()
}

pub async fn prepare(
    state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    source: &GenerationInputMessages,
    access_token: Option<&str>,
    enabled: bool,
) -> RetrievalContext {
    let references = approved_references(source);
    let has_references = source.messages.iter().any(|m| {
        matches!(
            m.content,
            ContentPart::TextFilePointer(_) | ContentPart::ImageFilePointer(_)
        )
    });
    let mut context = RetrievalContext {
        enabled: enabled && state.config.file_context.retrieve_file_contents_enabled,
        offered: enabled
            && state.config.file_context.retrieve_file_contents_enabled
            && has_references,
        ..Default::default()
    };
    if !context.offered && !source.messages.iter().any(|m| requested_file(m).is_some()) {
        return context;
    }
    // Also authorize replayed explicit reads when new tool calls are disabled.
    for id in references {
        context.files.insert(
            id,
            check_eligible(state, policy, subject, id, access_token)
                .await
                .map_err(|e| e.to_string()),
        );
    }
    context
}

pub(crate) async fn check_eligible(
    state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    id: Uuid,
    access_token: Option<&str>,
) -> Result<(), Report> {
    let file = crate::models::file_upload::get_file_upload_by_id(&state.db, policy, subject, &id)
        .await
        .map_err(|_| eyre!("file unavailable or access denied"))?;
    let capabilities = crate::models::file_capability::get_file_capabilities(true, true);
    let capability = crate::models::file_capability::find_file_capability_by_filename(
        &capabilities,
        &file.filename,
    );
    if !capability
        .operations
        .contains(&crate::models::file_capability::FileOperation::ExtractText)
        || crate::models::message::is_image_file(&file.filename)
    {
        bail!("unsupported integrated text extraction");
    }
    let storage = state
        .file_storage_providers
        .get(&file.file_storage_provider_id)
        .ok_or_else(|| eyre!("missing accessible persisted bytes"))?;
    if storage.is_sharepoint() {
        let ctx = access_token.map(|access_token| SharepointContext { access_token });
        storage
            .get_sharepoint_file_metadata_with_context(&file.file_storage_path, ctx.as_ref())
            .await
            .map_err(|_| eyre!("missing file, credentials or source permission"))?;
    } else {
        let metadata = storage
            .stat_object(&file.file_storage_path)
            .await
            .map_err(|_| eyre!("missing accessible persisted bytes"))?;
        let limit = state.config.file_processor.limits.max_input_bytes;
        if limit > 0 && metadata.size_bytes > limit as u64 {
            bail!("extraction input resource limit");
        }
    }
    Ok(())
}

pub async fn retrieve(
    state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    request: &ChatRequest,
    input: &Value,
    access_token: Option<&str>,
) -> Result<(Value, Attachment), Report> {
    if !state.config.file_context.retrieve_file_contents_enabled {
        bail!("Integrated retrieval is disabled");
    }
    let (id, reference) = validate_request(request, input)?;
    check_eligible(state, policy, subject, id, access_token).await?;
    let ctx = access_token.map(|access_token| SharepointContext { access_token });
    let mut file =
        crate::server::api::v1beta::file_resolution::load_full_attachment(state, id, ctx.as_ref())
            .await;
    if file.coverage != Coverage::Complete || file.text.is_none() {
        bail!("Full extraction unavailable or incomplete: {}", file.reason);
    }
    file.requested_in_full = true;
    let output = json!({"file_reference":reference, "filename":file.filename,
        "file_context_status":MARKER, "extraction_status":"complete"});
    Ok((output, file))
}

fn validate_request<'a>(
    request: &ChatRequest,
    input: &'a Value,
) -> Result<(Uuid, &'a str), Report> {
    let reference = input["file_reference"]
        .as_str()
        .ok_or_else(|| eyre!("Missing file_reference"))?;
    let id = parse_reference(reference)?;
    let allowed = request
        .tools
        .iter()
        .flatten()
        .find(|t| t.name.to_string() == TOOL_NAME)
        .and_then(|t| t.schema.as_ref())
        .and_then(|s| s["properties"]["file_reference"]["enum"].as_array())
        .is_some_and(|ids| ids.iter().any(|v| v.as_str() == Some(reference)));
    if !allowed {
        bail!("File was not offered or approved for this generation");
    }
    Ok((id, reference))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{ContentPartTextFilePointer, ToolUse};

    #[test]
    fn only_typed_admitted_references_approve_a_file() {
        let approved = Uuid::new_v4();
        let external = Uuid::new_v4();
        let source = GenerationInputMessages {
            messages: vec![
                InputMessage {
                    role: MessageRole::User,
                    content: ContentPart::TextFilePointer(ContentPartTextFilePointer {
                        file_upload_id: approved,
                    }),
                },
                InputMessage {
                    role: MessageRole::Assistant,
                    content: ContentPart::TextFilePointer(ContentPartTextFilePointer {
                        file_upload_id: external,
                    }),
                },
                InputMessage {
                    role: MessageRole::User,
                    content: ContentPart::Text(format!("erato-file://{external}").into()),
                },
            ],
        };
        assert_eq!(
            approved_references(&source),
            BTreeSet::from([approved, external])
        );
    }

    #[test]
    fn missing_disabled_and_unoffered_references_are_recoverable_errors() {
        let id = Uuid::new_v4();
        let reference = format!("erato-file://{id}");
        let context = RetrievalContext {
            enabled: true,
            offered: true,
            files: BTreeMap::from([(id, Ok(()))]),
        };
        let request = ChatRequest {
            tools: Some(vec![context.tool(false).unwrap()]),
            ..Default::default()
        };
        assert_eq!(
            validate_request(&request, &json!({"file_reference":reference}))
                .unwrap()
                .0,
            id
        );
        for input in [
            json!({}),
            json!({"file_reference":0}),
            json!({"file_reference":"bad"}),
            json!({"file_reference":format!("erato-file://{}", Uuid::new_v4())}),
            json!({"file_reference":format!("{reference}/extra")}),
        ] {
            assert!(validate_request(&request, &input).is_err());
        }
        assert!(
            validate_request(
                &ChatRequest::default(),
                &json!({"file_reference":reference})
            )
            .is_err()
        );
        let empty = RetrievalContext {
            offered: true,
            ..Default::default()
        };
        let request = ChatRequest {
            tools: Some(vec![empty.tool(true).unwrap()]),
            ..Default::default()
        };
        assert!(validate_request(&request, &json!({"file_reference":reference})).is_err());
        assert!(RetrievalContext::default().tool(false).is_none());
    }

    #[test]
    fn explicit_full_marker_survives_serialization_and_replays_after_tool_result() {
        let id = Uuid::new_v4();
        let output = json!({"file_reference":format!("erato-file://{id}"), "filename":"report.txt",
            "file_context_status":MARKER, "extraction_status":"complete"});
        let parts = vec![ContentPart::ToolUse(ToolUse {
            tool_name: TOOL_NAME.into(),
            tool_call_id: "read-file".into(),
            input: Some(json!({"file_reference":format!("erato-file://{id}")})),
            output: Some(output),
            status: ToolCallStatus::Success,
            ..Default::default()
        })];
        let saved = serde_json::to_value(&parts).unwrap();
        assert!(saved[0]["output"].get("text").is_none());
        let replay = crate::services::prompt_composition::transforms::replay_assistant_content(
            &MessageRole::Assistant,
            serde_json::from_value(saved).unwrap(),
        );
        assert_eq!(replay.len(), 2);
        assert_eq!(requested_file(&replay[0]), None);
        assert_eq!(requested_file(&replay[1]), Some(id));
        let mut failed = replay[1].clone();
        if let ContentPart::ToolUse(tool) = &mut failed.content {
            tool.status = ToolCallStatus::Error;
        }
        assert_eq!(requested_file(&failed), None);
        let mut incomplete = replay[1].clone();
        if let ContentPart::ToolUse(tool) = &mut incomplete.content {
            tool.output.as_mut().unwrap()["extraction_status"] = json!("partial");
        }
        assert_eq!(requested_file(&incomplete), None);
    }
}
