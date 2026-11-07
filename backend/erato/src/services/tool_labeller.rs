//! The model fallback for tool-call labels: one request to the configured
//! provider for an MCP call the rules are unsure of, started at the gate and
//! never awaited by it. Its label reaches the call's row while the turn runs,
//! or the call's parked approval card once the turn has stopped there.

use crate::models::message::{
    ContentPart, ContentPartText, ToolDisplayMetadata, upgrade_open_approval_display,
};
use crate::services::background_tasks::StreamingTask;
use crate::services::genai::{GenAIClient, build_chat_options_for_summary};
use crate::services::genai_langfuse::{TracedGenerationBuilder, generate_langfuse_ids};
use crate::services::langfuse::TracingLangfuseClient;
use crate::services::template_rendering::contexts::chat_provider_headers::ChatProviderHeadersContext;
use crate::services::tool_display::label::cache::ToolLabelCacheKey;
use crate::services::tool_display::label::{ToolCallLabelMapping, ToolResultContext, model};
use crate::services::tool_display::{mcp_tool_call_display_from, tool_row_display};
use crate::state::{AppState, ChatProviderConfigWithId};
use sea_orm::prelude::Uuid;
use serde_json::{Value, json};
use std::sync::{Arc, Weak};
use std::time::{Duration, SystemTime};
use tokio::sync::mpsc;
use tracing::Instrument;

pub const LABEL_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REPLY_TOKENS: u32 = 512;
/// How long a label the running turn no longer takes waits for that turn's
/// content to be stored before it tries the parked card.
const STORED_WAIT: Duration = Duration::from_secs(30);

/// Kinds whose adapter sends a reply schema. The `ollama` adapter would drop
/// one without an error.
fn sends_json_schema(provider_kind: &str) -> bool {
    matches!(
        provider_kind,
        "openai" | "openai_responses" | "azure_openai_responses" | "gemini" | "vertex_ai"
    )
}

/// A call to label, as the gate saw it.
pub struct LabelJob {
    pub key: ToolLabelCacheKey,
    pub server_id: String,
    pub tool: rmcp::model::Tool,
    pub arguments: Value,
    pub context: ToolResultContext,
    pub tool_call_id: String,
    /// What the call shows until the label arrives.
    pub shown: ToolDisplayMetadata,
}

#[derive(Debug)]
struct Upgrade {
    tool_call_id: String,
    display: ToolDisplayMetadata,
}

#[derive(Clone)]
struct Turn {
    user_id: String,
    chat_id: Uuid,
    message_id: Uuid,
    assistant_id: Option<Uuid>,
    platform: String,
    /// Weak, since the turn's stream lasts as long as its task does.
    task: Option<Weak<StreamingTask>>,
}

/// One turn's model labels: started at the gate, applied to the turn's
/// content as they arrive, and written to the parked card once the turn has
/// stopped taking them.
pub struct LabelUpgrades {
    sender: mpsc::UnboundedSender<Upgrade>,
    receiver: mpsc::UnboundedReceiver<Upgrade>,
    /// Applied again on every look, since a row can be written over after
    /// its label arrived and a card joins the content only when the turn parks.
    received: Vec<Upgrade>,
    turn: Turn,
}

impl LabelUpgrades {
    pub fn new(
        user_id: &str,
        chat_id: Uuid,
        message_id: Uuid,
        assistant_id: Option<Uuid>,
        platform: &str,
        task: Option<&Arc<StreamingTask>>,
    ) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();
        Self {
            sender,
            receiver,
            received: Vec::new(),
            turn: Turn {
                user_id: user_id.to_string(),
                chat_id,
                message_id,
                assistant_id,
                platform: platform.to_string(),
                task: task.map(Arc::downgrade),
            },
        }
    }

    /// Labels `job` with the configured model when tool labels are on.
    /// Nothing waits for it, and a failure is only logged.
    pub fn start(
        &self,
        app_state: &AppState,
        headers: &ChatProviderHeadersContext<'_>,
        job: LabelJob,
    ) {
        if !app_state.config.tool_labels.enabled {
            return;
        }
        let client = app_state
            .chat_provider_for_tool_labels()
            .and_then(|provider| {
                let client = app_state.genai_for_chat_provider_id_with_headers_context(
                    Some(&provider.chat_provider_id),
                    Some(headers),
                )?;
                Ok((provider, client))
            });
        let (provider, client) = match client {
            Ok(client) => client,
            Err(error) => {
                tracing::warn!(%error, "Cannot label a tool call with the configured model");
                return;
            }
        };
        let app_state = app_state.clone();
        let sender = self.sender.clone();
        let turn = self.turn.clone();
        let span = tracing::info_span!("Labelling a tool call", chat_id = %turn.chat_id);
        tokio::spawn(
            async move {
                let Some(display) =
                    label(&app_state, &turn, &provider, client.as_ref(), &job).await
                else {
                    return;
                };
                if display.label == job.shown.label {
                    return;
                }
                let upgrade = Upgrade {
                    tool_call_id: job.tool_call_id,
                    display,
                };
                let Err(mpsc::error::SendError(upgrade)) = sender.send(upgrade) else {
                    return;
                };
                if let Some(task) = turn.task.as_ref().and_then(Weak::upgrade) {
                    let _ = tokio::time::timeout(STORED_WAIT, task.wait_for_completion()).await;
                }
                if let Err(error) = upgrade_open_approval_display(
                    &app_state.db,
                    turn.message_id,
                    &upgrade.tool_call_id,
                    &upgrade.display,
                )
                .await
                {
                    tracing::warn!(%error, "Cannot put a model's label on a parked approval card");
                }
            }
            .instrument(span),
        );
    }

    /// Puts the labels that arrived on `content`: a call's row gets its row
    /// display, its approval card the whole display. Returns the indices of
    /// the rows that changed.
    pub fn apply(&mut self, content: &mut [ContentPart]) -> Vec<usize> {
        while let Ok(upgrade) = self.receiver.try_recv() {
            self.received.push(upgrade);
        }
        let mut changed = Vec::new();
        for upgrade in &self.received {
            place(upgrade, content, &mut changed);
        }
        changed.sort_unstable();
        changed.dedup();
        changed
    }

    /// Stops taking labels into the turn and puts those already here on
    /// `content`; a later one goes to the stored card.
    pub fn finish(&mut self, content: &mut [ContentPart]) -> Vec<usize> {
        self.receiver.close();
        self.apply(content)
    }
}

fn place(upgrade: &Upgrade, content: &mut [ContentPart], changed: &mut Vec<usize>) {
    let row = tool_row_display(&upgrade.display);
    for (index, part) in content.iter_mut().enumerate() {
        match part {
            ContentPart::ToolUse(tool) if tool.tool_call_id == upgrade.tool_call_id => {
                if tool.display.as_ref() != Some(&row) {
                    tool.display = Some(row.clone());
                    changed.push(index);
                }
            }
            ContentPart::ToolApprovalRequest(request)
                if request.tool_call_id == upgrade.tool_call_id =>
            {
                request.display = Some(upgrade.display.clone());
                for item in request.approvals.iter_mut().filter(|item| {
                    item.tool_call_id == upgrade.tool_call_id && item.child.is_none()
                }) {
                    item.display = Some(upgrade.display.clone());
                }
            }
            _ => {}
        }
    }
}

/// The display the model's mapping gives the call, after the same checks as
/// any label; a mapping kept for the call's shape is used without a request.
async fn label(
    app_state: &AppState,
    turn: &Turn,
    provider: &ChatProviderConfigWithId,
    client: &dyn GenAIClient,
    job: &LabelJob,
) -> Option<ToolDisplayMetadata> {
    let mapping = app_state
        .tool_label_cache
        .get_or_compute(
            job.key.clone(),
            &job.arguments,
            model_mapping(app_state, turn, provider, client, job),
        )
        .await?;
    let mcp = app_state.mcp_state().await;
    Some(mcp_tool_call_display_from(
        &mcp.config,
        &job.server_id,
        &job.tool,
        &job.arguments,
        &mapping,
        &job.context,
    ))
}

/// One request, no retry. Its tokens are recorded nowhere a budget reads.
async fn model_mapping(
    app_state: &AppState,
    turn: &Turn,
    provider: &ChatProviderConfigWithId,
    client: &dyn GenAIClient,
    job: &LabelJob,
) -> Option<ToolCallLabelMapping> {
    let request = model::build_request(&job.tool.name, &job.arguments)?;
    let config = &provider.chat_provider_config;
    let mut options = build_chat_options_for_summary(
        &config.model_settings,
        &config.model_capabilities,
        MAX_REPLY_TOKENS,
    );
    if sends_json_schema(&config.provider_kind) {
        options = options.with_response_format(genai::chat::JsonSpec::new(
            "tool_call_label",
            request.schema.clone(),
        ));
    }
    let start = SystemTime::now();
    let response = tokio::time::timeout(
        app_state.tool_label_timeout,
        client.exec_chat(
            "PLACEHOLDER_MODEL",
            request.chat_request.clone(),
            Some(&options),
        ),
    )
    .await;
    let reply = match &response {
        Ok(Ok(response)) if response.content.tool_calls().is_empty() => Some(model::parse_reply(
            response.first_text().unwrap_or(""),
            &job.arguments,
            &request.paths,
        )),
        _ => None,
    };
    let outcome = match (&response, &reply) {
        (Err(_), _) => "timeout",
        (Ok(Err(_)), _) => "provider_error",
        (Ok(Ok(_)), None) => "unexpected_tools",
        (_, Some(Err(_))) => "invalid_reply",
        (_, Some(Ok(_))) => "labelled",
    };
    trace(
        app_state, turn, provider, job, &request, &response, outcome, start,
    )
    .await;
    match &response {
        Ok(Err(error)) => tracing::warn!(
            %error,
            server_id = %job.server_id,
            tool_name = %job.tool.name,
            "The tool-label provider failed; the call keeps the rules' label"
        ),
        // The reply is left out: it may quote the arguments.
        _ if outcome != "labelled" => tracing::info!(
            server_id = %job.server_id,
            tool_name = %job.tool.name,
            outcome,
            "The model gave no usable label; the call keeps the rules' label"
        ),
        _ => {}
    }
    reply?.ok()
}

/// Traced like chat-history compaction: its own trace per request, on
/// success and on failure.
#[allow(clippy::too_many_arguments)]
async fn trace(
    app_state: &AppState,
    turn: &Turn,
    provider: &ChatProviderConfigWithId,
    job: &LabelJob,
    request: &model::LabelRequest,
    response: &Result<genai::Result<genai::chat::ChatResponse>, tokio::time::error::Elapsed>,
    outcome: &str,
    start: SystemTime,
) {
    let langfuse = &app_state.config.integrations.langfuse;
    if !(langfuse.enabled && langfuse.tracing_enabled) {
        return;
    }
    let (observation_id, trace_id) = generate_langfuse_ids();
    let trace = TracingLangfuseClient::new(
        app_state.langfuse_client.clone(),
        trace_id,
        Some(turn.user_id.clone()),
        Some(turn.chat_id.to_string()),
    );
    let metadata = json!({
        "operation": "tool_labels",
        "labeller_chat_provider_id": provider.chat_provider_id,
        "server_id": job.server_id,
        "tool_name": job.tool.name,
        "outcome": outcome,
    });
    if let Err(error) = trace
        .create_trace(
            Some("tool_labels.label".into()),
            None,
            Some(metadata),
            Some(vec!["tool_labels".into()]),
        )
        .await
    {
        tracing::warn!(%error, "Could not trace a tool-label request");
    }
    let replied = response.as_ref().ok().and_then(|reply| reply.as_ref().ok());
    let output = match response {
        Err(_) => "Tool-label provider timed out",
        Ok(Err(_)) => "Tool-label provider failed",
        Ok(Ok(reply)) => reply.first_text().unwrap_or(""),
    };
    if let Err(error) = TracedGenerationBuilder::new(observation_id)
        .with_name("tool_labels.label".into())
        .with_model(
            provider
                .chat_provider_config
                .model_name_langfuse()
                .to_string(),
        )
        .with_start_time(start)
        .with_end_time(SystemTime::now())
        .build_and_send(
            &trace,
            &request.chat_request,
            &[ContentPart::Text(ContentPartText {
                text: output.into(),
            })],
            replied.map(|reply| &reply.usage),
            turn.assistant_id,
            &[],
            Some(&turn.platform),
        )
        .await
    {
        tracing::warn!(%error, "Could not trace a tool-label generation");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{
        ApprovalItem, ContentPartToolApprovalRequest, ToolApprovalAnnotations, ToolCallLabel,
        ToolCallLabelSource, ToolUse,
    };
    use crate::services::tool_display::label::generic_label;

    fn display(source: ToolCallLabelSource) -> ToolDisplayMetadata {
        ToolDisplayMetadata {
            title: "Update record".into(),
            description: Some("Updates the record.".into()),
            description_truncated: false,
            server_name: Some("Records".into()),
            label: Some(ToolCallLabel {
                source,
                ..generic_label(&json!({"status": "Rejected"}))
            }),
            read_only: false,
        }
    }

    fn row(call_id: &str) -> ContentPart {
        ContentPart::ToolUse(ToolUse {
            tool_call_id: call_id.into(),
            tool_name: "update_record".into(),
            display: Some(tool_row_display(&display(ToolCallLabelSource::Rules))),
            ..Default::default()
        })
    }

    fn card(call_id: &str) -> ContentPart {
        let item = |call_id: &str, child| ApprovalItem {
            approval_id: call_id.into(),
            tool_call_id: call_id.into(),
            tool_name: "update_record".into(),
            display: Some(display(ToolCallLabelSource::Rules)),
            input: json!({"status": "Rejected"}),
            child,
        };
        ContentPart::ToolApprovalRequest(ContentPartToolApprovalRequest {
            tool_call_id: call_id.into(),
            tool_name: "update_record".into(),
            display: Some(display(ToolCallLabelSource::Rules)),
            mcp_server_id: "records".into(),
            input: json!({"status": "Rejected"}),
            annotations: ToolApprovalAnnotations {
                read_only_hint: false,
                destructive_hint: false,
                idempotent_hint: true,
                open_world_hint: true,
            },
            preset: "restrictive".into(),
            allow_always: false,
            requested_at: "2026-11-07T08:00:00Z".into(),
            kind: Default::default(),
            approvals: vec![item(call_id, None)],
            pending_tool_calls: Vec::new(),
            approval_scope: None,
            labels_updated_at: None,
        })
    }

    fn upgrades() -> LabelUpgrades {
        LabelUpgrades::new("user", Uuid::nil(), Uuid::nil(), None, "web", None)
    }

    fn arrive(upgrades: &LabelUpgrades, call_id: &str) {
        upgrades
            .sender
            .send(Upgrade {
                tool_call_id: call_id.into(),
                display: display(ToolCallLabelSource::Model),
            })
            .unwrap();
    }

    fn source(part: &ContentPart) -> ToolCallLabelSource {
        let display = match part {
            ContentPart::ToolUse(tool) => tool.display.as_ref(),
            ContentPart::ToolApprovalRequest(request) => {
                assert_eq!(request.approvals[0].display, request.display);
                request.display.as_ref()
            }
            _ => None,
        };
        display.unwrap().label.as_ref().unwrap().source
    }

    #[test]
    fn a_label_reaches_its_row_and_card_once_and_again_after_a_row_is_written_over() {
        let mut upgrades = upgrades();
        let mut content = vec![row("call_a"), row("call_b")];
        assert!(upgrades.apply(&mut content).is_empty());
        arrive(&upgrades, "call_b");
        assert_eq!(upgrades.apply(&mut content), [1]);
        assert_eq!(source(&content[0]), ToolCallLabelSource::Rules);
        assert_eq!(source(&content[1]), ToolCallLabelSource::Model);
        let ContentPart::ToolUse(tool) = &content[1] else {
            unreachable!()
        };
        assert_eq!(tool.display.as_ref().unwrap().description, None);
        assert!(upgrades.apply(&mut content).is_empty());

        content[1] = row("call_b");
        assert_eq!(upgrades.apply(&mut content), [1]);

        arrive(&upgrades, "call_c");
        assert!(upgrades.apply(&mut content).is_empty());
        content.push(card("call_c"));
        assert!(upgrades.finish(&mut content).is_empty());
        assert_eq!(source(&content[2]), ToolCallLabelSource::Model);
        let ContentPart::ToolApprovalRequest(request) = &content[2] else {
            unreachable!()
        };
        assert_eq!(
            request.display.as_ref().unwrap().description.as_deref(),
            Some("Updates the record.")
        );
    }

    #[test]
    fn a_label_after_the_turn_stopped_taking_them_is_left_for_the_stored_card() {
        let mut upgrades = upgrades();
        let mut content = vec![card("call_a")];
        upgrades.finish(&mut content);
        assert!(
            upgrades
                .sender
                .send(Upgrade {
                    tool_call_id: "call_a".into(),
                    display: display(ToolCallLabelSource::Model),
                })
                .is_err()
        );
        assert_eq!(source(&content[0]), ToolCallLabelSource::Rules);
    }

    #[test]
    fn only_kinds_known_to_take_a_reply_schema_get_one() {
        for kind in [
            "openai",
            "openai_responses",
            "azure_openai_responses",
            "gemini",
            "vertex_ai",
        ] {
            assert!(sends_json_schema(kind), "{kind}");
        }
        for kind in ["ollama", "llama_cpp", "anthropic", ""] {
            assert!(!sends_json_schema(kind), "{kind}");
        }
    }
}
