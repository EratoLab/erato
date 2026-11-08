//! The model fallback for tool-call labels: one request to the configured
//! provider for an MCP call the rules are unsure of, started at the gate and
//! never awaited by it. Its label reaches the call's row while the turn runs,
//! or the call's parked approval card once the turn has stopped there. A
//! failing, slow or hostile labeller only costs the call the model's label.

use crate::config::{AppConfig, McpRuntimeConfig};
use crate::models::message::{
    ContentPart, ContentPartText, ToolCallLabel, ToolDisplayMetadata, upgrade_open_approval_label,
};
use crate::policy::engine::PolicyEngine;
use crate::policy::types::Subject;
use crate::services::background_tasks::StreamingTask;
use crate::services::delegation::TaskModelPermissions;
use crate::services::genai::{GenAIClient, build_chat_options_for_summary};
use crate::services::genai_langfuse::{TracedGenerationBuilder, generate_langfuse_ids};
use crate::services::langfuse::TracingLangfuseClient;
use crate::services::template_rendering::contexts::chat_provider_headers::ChatProviderHeadersContext;
use crate::services::tool_display::label::cache::ToolLabelCacheKey;
use crate::services::tool_display::label::{
    ToolCallLabelMapping, ToolResultContext, logged_tool_name, model,
};
use crate::services::tool_display::{label_consent_argument, mcp_tool_call_display_from};
use crate::state::{AppState, ChatProviderConfigWithId};
use futures::FutureExt;
use sea_orm::prelude::Uuid;
use serde_json::{Value, json};
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Weak};
use std::time::{Duration, SystemTime};
use tokio::sync::{OnceCell, OwnedSemaphorePermit, Semaphore, mpsc};
use tracing::Instrument;

pub const LABEL_TIMEOUT: Duration = Duration::from_secs(10);
/// Labeller requests one replica has in flight. A call past the cap keeps
/// the rules' label and is never queued; labels share the provider's rate
/// limit with chat turns.
pub const MAX_CONCURRENT_LABELS: usize = 4;
/// Labeller requests one turn starts; its later unsure calls keep the rules'
/// label, so a turn's cost and memory stay bounded however many it makes.
const MAX_LABELS_PER_TURN: usize = 32;
const MAX_REPLY_TOKENS: u32 = 512;
/// How long a label the running turn no longer takes waits for that turn's
/// content to be stored before it tries the parked card.
const STORED_WAIT: Duration = Duration::from_secs(30);
/// How long a finished request's trace may take to send.
const TRACE_TIMEOUT: Duration = Duration::from_secs(5);

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
    /// The model's arguments without the tool's consent argument; see
    /// [`crate::services::tool_display::labelled_arguments`].
    pub arguments: Value,
    /// The consent argument the tool declares, which Erato fills at dispatch.
    pub approval_argument: Option<String>,
    /// The index as the call saw it, shared with the turn until it reads more.
    pub context: Arc<ToolResultContext>,
    pub tool_call_id: String,
    /// What the call shows until the label arrives.
    pub shown: ToolDisplayMetadata,
}

#[derive(Debug)]
struct Upgrade {
    tool_call_id: String,
    label: ToolCallLabel,
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

/// The provider that labels one turn's calls. Whether the turn's user may use
/// it is read once, by the turn's first labelling, off the turn's path.
pub struct TurnLabeller {
    provider: ChatProviderConfigWithId,
    policy: PolicyEngine,
    subject: Subject,
    user_groups: Vec<String>,
    permitted: OnceCell<bool>,
}

impl TurnLabeller {
    /// `None` unless tool labels are on and the labeller is the provider the
    /// turn runs on, or another provider is explicitly allowed.
    pub fn for_turn(
        app_state: &AppState,
        policy: &PolicyEngine,
        subject: &Subject,
        user_groups: &[String],
        turn_chat_provider_id: Option<&str>,
    ) -> Option<Arc<Self>> {
        if !app_state.config.tool_labels.enabled {
            return None;
        }
        let provider = app_state
            .chat_provider_for_tool_labels()
            .inspect_err(|error| {
                tracing::warn!(%error, "Cannot label tool calls with the configured model");
            })
            .ok()?;
        if !labels_turns_on(
            &app_state.config,
            &provider.chat_provider_id,
            turn_chat_provider_id,
        ) {
            tracing::debug!(
                "Not labelling this turn's tool calls with a model: the turn runs on another provider"
            );
            return None;
        }
        Some(Arc::new(Self {
            provider,
            policy: policy.clone(),
            subject: subject.clone(),
            user_groups: user_groups.to_vec(),
            permitted: OnceCell::new(),
        }))
    }

    async fn permitted(&self, app_state: &AppState) -> bool {
        *self
            .permitted
            .get_or_init(|| async {
                let check = async {
                    TaskModelPermissions::for_user(
                        app_state,
                        &self.policy,
                        &self.subject,
                        &self.user_groups,
                    )
                    .await
                    .map(|permissions| permissions.may_use(&self.provider.chat_provider_id))
                };
                match tokio::time::timeout(app_state.tool_label_timeout, check).await {
                    Ok(Ok(true)) => true,
                    Ok(Ok(false)) => {
                        tracing::info!(
                            "Not labelling tool calls with a model: the user's model permissions do not include its provider"
                        );
                        false
                    }
                    Ok(Err(error)) => {
                        tracing::warn!(%error, "Not labelling tool calls with a model: reading the user's model permissions failed");
                        false
                    }
                    Err(_) => {
                        tracing::warn!("Not labelling tool calls with a model: reading the user's model permissions timed out");
                        false
                    }
                }
            })
            .await
    }
}

/// Whether the labeller may see the calls of a turn that runs on
/// `turn_chat_provider_id`.
fn labels_turns_on(
    config: &AppConfig,
    labeller_id: &str,
    turn_chat_provider_id: Option<&str>,
) -> bool {
    config.tool_labels.allow_other_provider
        || turn_chat_provider_id.and_then(|id| config.resolve_chat_provider_id(id).ok())
            == Some(labeller_id)
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
    labeller: Option<Arc<TurnLabeller>>,
    started: usize,
}

impl LabelUpgrades {
    pub fn new(
        user_id: &str,
        chat_id: Uuid,
        message_id: Uuid,
        assistant_id: Option<Uuid>,
        platform: &str,
        task: Option<&Arc<StreamingTask>>,
        labeller: Option<Arc<TurnLabeller>>,
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
            labeller,
            started: 0,
        }
    }

    /// Labels the call `job` describes with the turn's labeller, if it has
    /// one and the replica has a request to spare; `job` is built only then.
    /// Nothing waits for it, and a failure is only logged.
    pub fn start(
        &mut self,
        app_state: &AppState,
        headers: &ChatProviderHeadersContext<'_>,
        job: impl FnOnce() -> LabelJob,
    ) {
        let Some((labeller, permit)) = self.admit(&app_state.tool_label_permits) else {
            return;
        };
        let client = match app_state.genai_for_chat_provider_id_with_headers_context(
            Some(&labeller.provider.chat_provider_id),
            Some(headers),
        ) {
            Ok(client) => client,
            Err(error) => {
                tracing::warn!(%error, "Cannot label a tool call with the configured model");
                return;
            }
        };
        let labelling = Labelling {
            app_state: app_state.clone(),
            labeller,
            turn: self.turn.clone(),
            client,
            job: job(),
        };
        let sender = self.sender.clone();
        let span = tracing::info_span!("Labelling a tool call", chat_id = %self.turn.chat_id);
        tokio::spawn(
            async move {
                // Boxed: the labelling future is too deep to lay out inline.
                if AssertUnwindSafe(Box::pin(labelling.run(permit, sender)))
                    .catch_unwind()
                    .await
                    .is_err()
                {
                    tracing::error!("Labelling a tool call panicked; the call keeps its label");
                }
            }
            .instrument(span),
        );
    }

    /// The turn's labeller and a request slot, unless the turn has none, has
    /// started its share or the replica is at its cap. Nothing is queued.
    fn admit(
        &mut self,
        permits: &Arc<Semaphore>,
    ) -> Option<(Arc<TurnLabeller>, OwnedSemaphorePermit)> {
        let labeller = self.labeller.clone()?;
        if self.started == MAX_LABELS_PER_TURN {
            tracing::debug!(
                chat_id = %self.turn.chat_id,
                "Not labelling a tool call with a model: the turn has started its share of labeller requests"
            );
            return None;
        }
        let Ok(permit) = permits.clone().try_acquire_owned() else {
            tracing::info!(
                chat_id = %self.turn.chat_id,
                "Not labelling a tool call with a model: the replica's labeller requests are at their cap"
            );
            return None;
        };
        self.started += 1;
        Some((labeller, permit))
    }

    /// Puts the labels that arrived on `content`: on a call's row and on its
    /// approval card, changing nothing but the label. Returns the indices of
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
    for (index, part) in content.iter_mut().enumerate() {
        match part {
            ContentPart::ToolUse(tool) if tool.tool_call_id == upgrade.tool_call_id => {
                if let Some(display) = tool.display.as_mut()
                    && display.label.as_ref() != Some(&upgrade.label)
                {
                    display.label = Some(upgrade.label.clone());
                    changed.push(index);
                }
            }
            ContentPart::ToolApprovalRequest(request)
                if request.tool_call_id == upgrade.tool_call_id =>
            {
                let items = request
                    .approvals
                    .iter_mut()
                    .filter(|item| {
                        item.tool_call_id == upgrade.tool_call_id && item.child.is_none()
                    })
                    .filter_map(|item| item.display.as_mut());
                for display in request.display.iter_mut().chain(items) {
                    display.label = Some(upgrade.label.clone());
                }
            }
            _ => {}
        }
    }
}

/// One labelling, from the request to where its label lands.
struct Labelling {
    app_state: AppState,
    labeller: Arc<TurnLabeller>,
    turn: Turn,
    client: Arc<dyn GenAIClient>,
    job: LabelJob,
}

impl Labelling {
    async fn run(self, permit: OwnedSemaphorePermit, sender: mpsc::UnboundedSender<Upgrade>) {
        if !self.labeller.permitted(&self.app_state).await {
            return;
        }
        let mut record = None;
        let label = self.label(&mut record).await;
        drop(permit);
        let langfuse = &self.app_state.config.integrations.langfuse;
        if let Some(record) = record.filter(|_| langfuse.enabled && langfuse.tracing_enabled) {
            let traced = (
                self.app_state.clone(),
                self.turn.clone(),
                self.labeller.clone(),
            );
            tokio::spawn(async move {
                let (app_state, turn, labeller) = traced;
                let sent = trace(&app_state, &turn, &labeller.provider, record);
                if tokio::time::timeout(TRACE_TIMEOUT, sent).await.is_err() {
                    tracing::warn!("Gave up tracing a tool-label request: Langfuse took too long");
                }
            });
        }
        let Some(label) = label else {
            return;
        };
        if self.job.shown.label.as_ref() == Some(&label) {
            return;
        }
        let upgrade = Upgrade {
            tool_call_id: self.job.tool_call_id,
            label,
        };
        let Err(mpsc::error::SendError(upgrade)) = sender.send(upgrade) else {
            return;
        };
        if let Some(task) = self.turn.task.as_ref().and_then(Weak::upgrade) {
            let _ = tokio::time::timeout(STORED_WAIT, task.wait_for_completion()).await;
        }
        if let Err(error) = upgrade_open_approval_label(
            &self.app_state.db,
            self.turn.message_id,
            &upgrade.tool_call_id,
            &upgrade.label,
        )
        .await
        {
            tracing::warn!(%error, "Cannot put a model's label on a parked approval card");
        }
    }

    /// The label the model's mapping gives the call; a mapping kept for the
    /// call's shape is used without a request.
    async fn label(&self, record: &mut Option<TraceRecord>) -> Option<ToolCallLabel> {
        let job = &self.job;
        let mcp = self.app_state.mcp_state().await;
        let consent = label_consent_argument(
            &mcp.config,
            &job.server_id,
            job.approval_argument.as_deref(),
        );
        let mapping = self
            .app_state
            .tool_label_cache
            .get_or_compute(
                job.key.clone(),
                &job.tool,
                &job.arguments,
                consent,
                self.model_mapping(record),
            )
            .await?;
        shown_label(&mcp.config, job, &mapping)
    }

    /// One request, no retry. Its tokens are recorded nowhere a budget reads.
    async fn model_mapping(
        &self,
        record: &mut Option<TraceRecord>,
    ) -> Option<ToolCallLabelMapping> {
        let job = &self.job;
        let request = model::build_request(&job.tool.name, &job.tool.input_schema, &job.arguments)?;
        let config = &self.labeller.provider.chat_provider_config;
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
            self.app_state.tool_label_timeout,
            self.client.exec_chat(
                "PLACEHOLDER_MODEL",
                request.chat_request.clone(),
                Some(&options),
            ),
        )
        .await;
        let tool_name = logged_tool_name(&job.tool.name);
        let (outcome, mapping, output, usage) = match response {
            Err(_) => (
                "timeout",
                None,
                "Tool-label provider timed out".into(),
                None,
            ),
            Ok(Err(error)) => {
                let failure = provider_failure(&error);
                // The error's text can carry the provider's response body.
                tracing::warn!(
                    server_id = %job.server_id,
                    tool_name = ?tool_name,
                    failure,
                    status = error.status().map(|status| status.as_u16()),
                    "The tool-label provider failed; the call keeps the rules' label"
                );
                (
                    "provider_error",
                    None,
                    format!("Tool-label provider failed: {failure}"),
                    None,
                )
            }
            Ok(Ok(reply)) if !reply.content.tool_calls().is_empty() => {
                ("unexpected_tools", None, String::new(), Some(reply.usage))
            }
            Ok(Ok(reply)) => {
                let text = reply.first_text().unwrap_or("");
                let parsed = model::parse_reply(text, &job.arguments, &request.paths);
                let output = model::traced_reply(text).to_string();
                match parsed {
                    Ok(mapping) => ("labelled", Some(mapping), output, Some(reply.usage)),
                    Err(_) => ("invalid_reply", None, output, Some(reply.usage)),
                }
            }
        };
        if !matches!(outcome, "labelled" | "provider_error") {
            // The reply is left out: it may quote the arguments.
            tracing::info!(
                server_id = %job.server_id,
                tool_name = ?tool_name,
                outcome,
                "The model gave no usable label; the call keeps the rules' label"
            );
        }
        *record = Some(TraceRecord {
            chat_request: request.chat_request,
            output,
            usage,
            outcome,
            server_id: job.server_id.clone(),
            tool_name,
            start,
            end: SystemTime::now(),
        });
        mapping
    }
}

/// The label a model's mapping gives the call: through the cross-check and
/// the same filters as any label, with names from earlier results resolved.
fn shown_label(
    config: &McpRuntimeConfig,
    job: &LabelJob,
    mapping: &ToolCallLabelMapping,
) -> Option<ToolCallLabel> {
    mcp_tool_call_display_from(
        config,
        &job.server_id,
        &job.tool,
        &job.arguments,
        job.approval_argument.as_deref(),
        mapping,
        &job.context,
    )
    .label
}

/// What kind of failure a provider error is, for logs that leave out the
/// provider's own text.
fn provider_failure(error: &genai::Error) -> &'static str {
    if let Some(status) = error.status() {
        return match status.as_u16() {
            401 | 403 => "unauthorized",
            408 | 504 => "timeout",
            429 => "rate_limited",
            400..=499 => "rejected",
            500..=599 => "server_error",
            _ => "unexpected_status",
        };
    }
    match error {
        genai::Error::WebModelCall { webc_error, .. }
        | genai::Error::WebAdapterCall { webc_error, .. } => match webc_error {
            genai::webc::Error::Reqwest(error) if error.is_timeout() => "timeout",
            genai::webc::Error::Reqwest(error) if error.is_connect() => "unreachable",
            genai::webc::Error::Reqwest(_) => "transport",
            _ => "invalid_response",
        },
        genai::Error::RequiresApiKey { .. }
        | genai::Error::NoAuthResolver { .. }
        | genai::Error::NoAuthData { .. } => "unauthorized",
        genai::Error::NoChatResponse { .. } => "empty_response",
        genai::Error::ChatResponse { .. }
        | genai::Error::ChatResponseGeneration { .. }
        | genai::Error::InvalidJsonResponseElement { .. }
        | genai::Error::SerdeJson(_)
        | genai::Error::JsonValueExt(_) => "invalid_response",
        _ => "other",
    }
}

/// What one labeller request leaves for its trace.
struct TraceRecord {
    chat_request: genai::chat::ChatRequest,
    output: String,
    usage: Option<genai::chat::Usage>,
    outcome: &'static str,
    server_id: String,
    tool_name: String,
    start: SystemTime,
    end: SystemTime,
}

/// Traced like chat-history compaction: its own trace per request, on
/// success and on failure, sent after the label so it never delays it.
async fn trace(
    app_state: &AppState,
    turn: &Turn,
    provider: &ChatProviderConfigWithId,
    record: TraceRecord,
) {
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
        "server_id": record.server_id,
        "tool_name": record.tool_name,
        "outcome": record.outcome,
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
    if let Err(error) = TracedGenerationBuilder::new(observation_id)
        .with_name("tool_labels.label".into())
        .with_model(
            provider
                .chat_provider_config
                .model_name_langfuse()
                .to_string(),
        )
        .with_start_time(record.start)
        .with_end_time(record.end)
        .build_and_send(
            &trace,
            &record.chat_request,
            &[ContentPart::Text(ContentPartText {
                text: record.output,
            })],
            record.usage.as_ref(),
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
        ApprovalItem, ContentPartToolApprovalRequest, ToolApprovalAnnotations, ToolCallAction,
        ToolCallLabelSource, ToolCallObjectKind, ToolUse,
    };
    use crate::services::tool_display::label::{ToolCallLabelItemMapping, generic_label};
    use crate::services::tool_display::tool_row_display;

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
        LabelUpgrades::new("user", Uuid::nil(), Uuid::nil(), None, "web", None, None)
    }

    fn model_label() -> ToolCallLabel {
        display(ToolCallLabelSource::Model).label.unwrap()
    }

    fn arrive(upgrades: &LabelUpgrades, call_id: &str) {
        upgrades
            .sender
            .send(Upgrade {
                tool_call_id: call_id.into(),
                label: model_label(),
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
                    label: model_label(),
                })
                .is_err()
        );
    }

    #[test]
    fn a_label_changes_nothing_on_a_row_or_card_but_the_label() {
        let mut upgrades = upgrades();
        let mut bare = row("call_a");
        let ContentPart::ToolUse(tool) = &mut bare else {
            unreachable!()
        };
        tool.display = None;
        let mut parked = card("call_a");
        let ContentPart::ToolApprovalRequest(request) = &mut parked else {
            unreachable!()
        };
        request.display.as_mut().unwrap().title = "Odd \u{202E} title".into();
        let mut child = request.approvals[0].clone();
        child.child = Some(
            serde_json::from_value(json!({
                "child_chat_id": Uuid::nil(), "child_message_id": Uuid::nil(),
                "child_tool_call_id": "call_a", "tool_name": "update_record",
                "mcp_server_id": "records", "input": {}, "preset": "restrictive",
                "requested_at": "2026-11-07T08:00:00Z",
                "annotations": {"readOnlyHint": false, "destructiveHint": false,
                                "idempotentHint": true, "openWorldHint": true},
            }))
            .unwrap(),
        );
        request.approvals.push(child);
        let mut content = vec![row("call_a"), bare.clone(), parked.clone()];
        arrive(&upgrades, "call_a");
        assert_eq!(upgrades.apply(&mut content), [0]);

        let with_label = |part: &ContentPart| {
            let mut part = part.clone();
            match &mut part {
                ContentPart::ToolUse(tool) => {
                    if let Some(display) = tool.display.as_mut() {
                        display.label = Some(model_label());
                    }
                }
                ContentPart::ToolApprovalRequest(request) => {
                    request.display.as_mut().unwrap().label = Some(model_label());
                    request.approvals[0].display.as_mut().unwrap().label = Some(model_label());
                }
                _ => {}
            }
            part
        };
        assert_eq!(content[0], with_label(&row("call_a")));
        assert_eq!(content[1], bare);
        assert_eq!(content[2], with_label(&parked));
        let ContentPart::ToolApprovalRequest(request) = &content[2] else {
            unreachable!()
        };
        assert_eq!(
            request.approvals[1].display.as_ref().unwrap().label,
            display(ToolCallLabelSource::Rules).label
        );
    }

    fn providers(config: &mut AppConfig) {
        config.chat_providers = Some(erato_config::config::ChatProvidersConfig {
            replacement_providers: vec![erato_config::config::ProviderReplacement {
                old: "retired".into(),
                new: "chat".into(),
            }],
            priority_order: vec!["chat".into(), "labeller".into()],
            all_providers: Default::default(),
            providers: ["chat", "labeller"]
                .into_iter()
                .map(|id| (id.to_string(), Default::default()))
                .collect(),
            summary: Default::default(),
        });
    }

    #[test]
    fn a_labeller_sees_only_the_calls_of_turns_on_its_own_provider_unless_allowed() {
        let mut config = AppConfig::default();
        providers(&mut config);
        for (turn, same) in [
            (Some("chat"), true),
            (Some("retired"), true),
            (Some("labeller"), false),
            (Some("unknown"), false),
            (Some(""), false),
            (None, false),
        ] {
            assert_eq!(labels_turns_on(&config, "chat", turn), same, "{turn:?}");
        }
        config.tool_labels.allow_other_provider = true;
        for turn in [Some("labeller"), Some("unknown"), None] {
            assert!(labels_turns_on(&config, "chat", turn), "{turn:?}");
        }
    }

    #[test]
    fn a_provider_failure_is_named_by_its_kind_and_never_its_body() {
        let body = "secret arguments echoed back";
        let status = |code: u16| genai::Error::WebModelCall {
            model_iden: genai::ModelIden::new(genai::adapter::AdapterKind::OpenAI, "m"),
            webc_error: genai::webc::Error::ResponseFailedStatus {
                status: reqwest::StatusCode::from_u16(code).unwrap(),
                body: body.into(),
                headers: Box::default(),
            },
        };
        for (error, kind) in [
            (status(401), "unauthorized"),
            (status(429), "rate_limited"),
            (status(400), "rejected"),
            (status(503), "server_error"),
            (status(504), "timeout"),
            (
                genai::Error::HttpError {
                    status: reqwest::StatusCode::TOO_MANY_REQUESTS,
                    canonical_reason: body.into(),
                    body: body.into(),
                    headers: Box::default(),
                },
                "rate_limited",
            ),
            (
                genai::Error::WebModelCall {
                    model_iden: genai::ModelIden::new(genai::adapter::AdapterKind::OpenAI, "m"),
                    webc_error: genai::webc::Error::ResponseFailedInvalidJson {
                        body: body.into(),
                        cause: body.into(),
                    },
                },
                "invalid_response",
            ),
            (
                genai::Error::ChatResponse {
                    model_iden: genai::ModelIden::new(genai::adapter::AdapterKind::OpenAI, "m"),
                    body: json!(body),
                },
                "invalid_response",
            ),
            (genai::Error::Internal(body.into()), "other"),
        ] {
            assert_eq!(provider_failure(&error), kind, "{error}");
        }
    }

    fn job(tool: rmcp::model::Tool, arguments: Value) -> LabelJob {
        LabelJob {
            key: ToolLabelCacheKey::new("user", "records", &tool, &arguments),
            server_id: "records".into(),
            tool,
            arguments,
            approval_argument: None,
            context: Default::default(),
            tool_call_id: "call_a".into(),
            shown: display(ToolCallLabelSource::Rules),
        }
    }

    fn mapping(action: ToolCallAction, item: ToolCallLabelItemMapping) -> ToolCallLabelMapping {
        ToolCallLabelMapping {
            action,
            object_kind: ToolCallObjectKind::Row,
            items: vec![item],
            source: ToolCallLabelSource::Model,
        }
    }

    #[test]
    fn a_models_mapping_passes_the_same_checks_and_filters_as_any_label() {
        let config = McpRuntimeConfig::default();
        let tool = rmcp::model::Tool::new(
            "records",
            "Works on records.",
            rmcp::model::JsonObject::new(),
        );
        let call = job(
            tool.clone(),
            json!({"recordId": "r_1", "hasUserApproved": true, "status": "won"}),
        );
        let fields = ToolCallLabelItemMapping {
            id: Some("/recordId".into()),
            fields: vec!["/hasUserApproved".into(), "/status".into()],
            ..Default::default()
        };
        let label = shown_label(
            &config,
            &call,
            &mapping(ToolCallAction::Update, fields.clone()),
        )
        .unwrap();
        assert_eq!(label.source, ToolCallLabelSource::Model);
        let shown: Vec<_> = label.items[0]
            .fields
            .iter()
            .map(|field| field.pointer.as_str())
            .collect();
        assert_eq!(shown, ["/status"]);

        let consent = ToolCallLabelItemMapping {
            title: Some("/hasUserApproved".into()),
            ..Default::default()
        };
        let mut read_only = tool.clone();
        read_only.annotations = Some(rmcp::model::ToolAnnotations::from_raw(
            None,
            Some(true),
            None,
            None,
            None,
        ));
        let to_only = ToolCallLabelItemMapping {
            title: Some("/subject".into()),
            target: Some("/to".into()),
            ..Default::default()
        };
        let hidden_copy = job(
            tool.clone(),
            json!({"to": ["a@example.com"], "bcc": ["b@example.com"], "subject": "Q3"}),
        );
        let label = shown_label(
            &config,
            &hidden_copy,
            &mapping(ToolCallAction::Send, to_only.clone()),
        )
        .unwrap();
        assert_eq!(label.source, ToolCallLabelSource::Model);
        assert!(
            label.items[0]
                .fields
                .iter()
                .any(|field| field.pointer == "/bcc"),
            "{label:?}"
        );
        let mail: serde_json::Map<String, Value> =
            ["to", "cc", "bcc", "attendees", "invitees", "participants"]
                .into_iter()
                .map(|member| (member.to_string(), json!(["x@example.com"])))
                .chain([("subject".to_string(), json!("Q3"))])
                .collect();
        let mail = job(tool.clone(), Value::Object(mail));
        for (call, mapping) in [
            (&call, mapping(ToolCallAction::Update, consent)),
            (
                &job(read_only, call.arguments.clone()),
                mapping(ToolCallAction::Delete, fields),
            ),
            (&mail, mapping(ToolCallAction::Send, to_only)),
        ] {
            let label = shown_label(&config, call, &mapping).unwrap();
            assert_eq!(label.source, ToolCallLabelSource::Generic, "{mapping:?}");
            assert!(label.items.is_empty());
        }
    }

    #[test]
    fn a_turn_starts_no_more_requests_than_its_share_and_a_replica_queues_none() {
        let labeller = Arc::new(TurnLabeller {
            provider: ChatProviderConfigWithId {
                chat_provider_id: "chat".into(),
                chat_provider_config: Default::default(),
            },
            policy: PolicyEngine::default(),
            subject: Subject::User("user".into()),
            user_groups: Vec::new(),
            permitted: OnceCell::new(),
        });
        let permits = Arc::new(Semaphore::new(MAX_CONCURRENT_LABELS));
        let mut unlabelled = upgrades();
        assert!(unlabelled.admit(&permits).is_none());
        assert_eq!(permits.available_permits(), MAX_CONCURRENT_LABELS);

        let mut turn = upgrades();
        turn.labeller = Some(labeller);
        let held: Vec<_> = (0..MAX_CONCURRENT_LABELS)
            .map(|_| turn.admit(&permits).unwrap())
            .collect();
        assert!(turn.admit(&permits).is_none());
        assert_eq!(turn.started, MAX_CONCURRENT_LABELS);
        drop(held);
        while turn.started < MAX_LABELS_PER_TURN {
            assert!(turn.admit(&permits).is_some());
        }
        assert!(turn.admit(&permits).is_none());
        assert_eq!(permits.available_permits(), MAX_CONCURRENT_LABELS);
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
