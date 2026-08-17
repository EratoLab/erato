//! In-chat delegation to @-mentioned assistants.

use crate::policy::prelude::*;
use crate::state::AppState;
use axum::http::StatusCode;
use genai::chat::Tool as GenaiTool;
use genai::chat::ToolName as GenaiToolName;
use sea_orm::prelude::Uuid;
use serde_json::json;

/// Name of the synthetic tool offered to the model when the current turn
/// carries validated assistant mentions.
pub use erato_config::config::DELEGATE_TO_ASSISTANT_TOOL_NAME;

/// A parent-chat attachment enumerated in the delegation tool offer, so the
/// model can pass files to the delegate by reference.
#[derive(Debug, Clone)]
pub struct DelegationOfferedFile {
    pub id: Uuid,
    pub filename: String,
}

/// Build the `delegate_to_assistant` tool for the validated targets of this
/// turn. The `assistant_id` (and any `file_ids`) are enum-constrained to what
/// was validated/offered, and the description enumerates targets and
/// attachments so the model selects them informed.
pub fn build_delegate_to_assistant_tool(
    targets: &[DelegationTarget],
    offered_files: &[DelegationOfferedFile],
    omit_tool_strict: bool,
) -> GenaiTool {
    let target_ids: Vec<String> = targets.iter().map(|target| target.id.to_string()).collect();
    let target_lines: String = targets
        .iter()
        .map(|target| {
            let description = target
                .description
                .as_deref()
                .filter(|description| !description.trim().is_empty())
                .unwrap_or("no description");
            format!("- {} → {} — {}", target.id, target.name, description)
        })
        .collect::<Vec<_>>()
        .join("\n");

    let mut description = format!(
        "Delegate a task to one of the assistants the user mentioned in their message. \
         The delegate works on the task in its own chat run and this tool returns its final \
         answer as the result; the run may take a while. Give a self-contained task brief — \
         the delegate does not see this conversation unless you set \
         include_conversation_context. Available assistants:\n{target_lines}"
    );

    let mut properties = json!({
        "assistant_id": {
            "type": "string",
            "enum": target_ids,
            "description": "The mentioned assistant to delegate to.",
        },
        "task": {
            "type": "string",
            "description": "Self-contained description of the task the delegate should complete.",
        },
        "expected_output": {
            "type": "string",
            "description": "Optional description of the expected shape or content of the result.",
        },
        "constraints": {
            "type": "string",
            "description": "Optional constraints the delegate must respect while working the task.",
        },
        "include_conversation_context": {
            "type": "boolean",
            "default": false,
            "description": "Pass the conversation so far to the delegate as context.",
        },
    });

    if !offered_files.is_empty() {
        let file_ids: Vec<String> = offered_files
            .iter()
            .map(|file| file.id.to_string())
            .collect();
        let file_lines: String = offered_files
            .iter()
            .map(|file| format!("- {} → {}", file.id, file.filename))
            .collect::<Vec<_>>()
            .join("\n");
        description.push_str(&format!(
            "\nAttachments of this chat that can be passed to the delegate by file_id:\n{file_lines}"
        ));
        properties["file_ids"] = json!({
            "type": "array",
            "items": { "type": "string", "enum": file_ids },
            "description": "Attachments of this chat to make available to the delegate.",
        });
    }

    GenaiTool {
        name: GenaiToolName::Custom(DELEGATE_TO_ASSISTANT_TOOL_NAME.to_string()),
        description: Some(description),
        schema: Some(json!({
            "type": "object",
            "properties": properties,
            "required": ["assistant_id", "task"],
            "additionalProperties": false,
        })),
        strict: if omit_tool_strict { None } else { Some(false) },
        config: None,
    }
}

/// Deduplicates mentioned assistant ids preserving first-mention order.
pub fn dedupe_mentions(ids: &[Uuid]) -> Vec<Uuid> {
    let mut seen = std::collections::HashSet::new();
    ids.iter().copied().filter(|id| seen.insert(*id)).collect()
}

/// A validated assistant the current turn may delegate to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DelegationTarget {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
}

/// Validates the `mentioned_assistant_ids` of a streaming request and resolves
/// them into delegation targets.
///
/// Rules, all enforced server-side: mentions require
/// `assistants.delegation.enabled`; ids are deduplicated preserving order;
/// the deduplicated count is capped by
/// `assistants.delegation.max_mentions_per_message`; the chat's own bound
/// assistant cannot be mentioned; every id must resolve through the checked
/// owner-or-viewer assistant lookup, which also rejects archived assistants.
/// The error message deliberately does not distinguish missing, archived, and
/// inaccessible assistants.
pub async fn validate_mentioned_assistants(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    mentioned_assistant_ids: Option<&[Uuid]>,
    chat_bound_assistant_id: Option<Uuid>,
    chat_is_delegated_run: bool,
) -> Result<Vec<DelegationTarget>, (StatusCode, String)> {
    let Some(ids) = mentioned_assistant_ids else {
        return Ok(Vec::new());
    };
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let delegation = &app_state.config.assistants.delegation;
    if !delegation.enabled {
        return Err((
            StatusCode::BAD_REQUEST,
            "Assistant delegation is not enabled".to_string(),
        ));
    }

    // Depth stays at one: a delegated run never offers the tool, so mentions
    // inside one would validate and then silently do nothing. Reject them
    // explicitly instead.
    if chat_is_delegated_run {
        return Err((
            StatusCode::BAD_REQUEST,
            "Assistants cannot be mentioned inside a delegated run".to_string(),
        ));
    }

    let deduped = dedupe_mentions(ids);

    if deduped.len() > delegation.max_mentions_per_message {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "At most {} assistants can be mentioned per message",
                delegation.max_mentions_per_message
            ),
        ));
    }

    let mut targets = Vec::with_capacity(deduped.len());
    for assistant_id in deduped {
        if Some(assistant_id) == chat_bound_assistant_id {
            return Err((
                StatusCode::BAD_REQUEST,
                "The chat's own assistant cannot be mentioned for delegation".to_string(),
            ));
        }
        let assistant = crate::models::assistant::get_assistant_by_id(
            &app_state.db,
            policy,
            subject,
            assistant_id,
        )
        .await
        .map_err(|error| {
            tracing::debug!(
                %assistant_id,
                %error,
                "Rejecting mentioned assistant"
            );
            (
                StatusCode::BAD_REQUEST,
                format!("Mentioned assistant {assistant_id} is not available"),
            )
        })?;
        targets.push(DelegationTarget {
            id: assistant.id,
            name: assistant.name,
            description: assistant.description,
        });
    }

    Ok(targets)
}

/// Replay-stable variant for mentions read back from a persisted user message
/// (regenerate without the request field, edit fallback): validation failures
/// drop the mentions with a warning instead of failing the turn, mirroring how
/// a stored action facet that no longer validates is dropped on replay.
pub async fn resolve_persisted_mentions(
    app_state: &AppState,
    policy: &PolicyEngine,
    subject: &Subject,
    persisted_ids: Option<&[Uuid]>,
    chat_bound_assistant_id: Option<Uuid>,
    chat_is_delegated_run: bool,
) -> Vec<DelegationTarget> {
    match validate_mentioned_assistants(
        app_state,
        policy,
        subject,
        persisted_ids,
        chat_bound_assistant_id,
        chat_is_delegated_run,
    )
    .await
    {
        Ok(targets) => targets,
        Err((_, message)) => {
            tracing::warn!("Dropping persisted assistant mentions on replay: {message}");
            Vec::new()
        }
    }
}

/// Terminal status of a delegated child run, as reported to the origin model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DelegationRunStatus {
    Completed,
    Failed,
    Timeout,
    Cancelled,
}

/// Compact result envelope pushed as the `delegate_to_assistant` tool result.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DelegationResultEnvelope {
    pub status: DelegationRunStatus,
    pub assistant_id: Uuid,
    pub assistant_name: String,
    pub delegate_chat_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    pub truncated: bool,
}

impl DelegationResultEnvelope {
    /// The tool-response content the origin model receives.
    pub fn model_response_text(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            format!(
                "{{\"status\":\"failed\",\"delegate_chat_id\":\"{}\"}}",
                self.delegate_chat_id
            )
        })
    }
}

/// Arguments of a `delegate_to_assistant` call.
#[derive(Debug, serde::Deserialize)]
struct DelegateToolArgs {
    assistant_id: String,
    task: String,
    #[serde(default)]
    expected_output: Option<String>,
    #[serde(default)]
    constraints: Option<String>,
    #[serde(default)]
    file_ids: Option<Vec<String>>,
    #[serde(default)]
    include_conversation_context: bool,
}

/// How long an aborted/timed-out child run gets to wind down and persist
/// before its future is cancelled outright.
const CHILD_ABORT_GRACE: std::time::Duration = std::time::Duration::from_secs(2);

async fn parent_abort_signal(
    parent_task: Option<&std::sync::Arc<crate::services::background_tasks::StreamingTask>>,
) {
    match parent_task {
        Some(task) => task.wait_for_abort().await,
        None => std::future::pending::<()>().await,
    }
}

/// Renders the configured delegation preamble, filling the optional
/// structured-brief sections.
fn render_delegation_preamble(
    preamble_template: &str,
    expected_output: Option<&str>,
    constraints: Option<&str>,
) -> String {
    let mut args = std::collections::HashMap::new();
    args.insert(
        "expected_output_section".to_string(),
        expected_output
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("\nExpected output:\n{value}\n"))
            .unwrap_or_default(),
    );
    args.insert(
        "constraints_section".to_string(),
        constraints
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("\nConstraints:\n{value}\n"))
            .unwrap_or_default(),
    );
    crate::services::prompt_composition::transforms::render_action_facet_template(
        preamble_template,
        &args,
    )
}

fn delegated_chat_title(task: &str) -> String {
    let trimmed = task.trim();
    let mut title: String = trimmed.chars().take(80).collect();
    if trimmed.chars().count() > 80 {
        title.push('…');
    }
    title
}

/// Wrapper mirroring the submit path's spawned task: cleanup guard, the run,
/// stream end, outcome persistence.
///
/// Returns an explicitly boxed future: the child generation nests the whole
/// streaming machinery inside the parent's dispatch loop, which would
/// otherwise make the parent's future recursively sized (and trips the
/// worker-stack limit `main.rs` documents).
fn run_delegated_child(
    app_state: AppState,
    policy: PolicyEngine,
    me_user: crate::server::api::v1beta::me_profile_middleware::MeProfile,
    child_task: std::sync::Arc<crate::services::background_tasks::StreamingTask>,
    request: crate::server::api::v1beta::message_streaming::MessageSubmitRequest,
    chat_id: Uuid,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), eyre::Report>> + Send>> {
    Box::pin(async move {
        let mut cleanup_guard = crate::services::background_tasks::TaskCleanupGuard::new(
            app_state.background_tasks.clone(),
            chat_id,
            child_task.generation_id,
        );
        let result = crate::server::api::v1beta::message_streaming::run_message_submit_task(
            &child_task,
            &app_state,
            &policy,
            &me_user,
            &request,
            crate::models::message::GenerationRequestContext { platform: None },
            chat_id,
            true,
            Vec::new(),
        )
        .await;
        let generation_failed = result.is_err();
        if let Err(error) = &result {
            tracing::warn!(child_chat_id = %chat_id, error = ?error, "Delegated child run failed");
            let _ = child_task
                .send_event(crate::services::background_tasks::StreamingEvent::Error {
                    error: crate::server::api::v1beta::message_streaming::delegated_run_failure_error_value(),
                })
                .await;
        }
        let _ = child_task
            .send_event(crate::services::background_tasks::StreamingEvent::StreamEnd)
            .await;
        let outcome = child_task.derive_outcome(generation_failed);
        child_task.mark_completed();
        cleanup_guard.disarm();
        app_state
            .background_tasks
            .remove_task(&chat_id, child_task.generation_id, outcome)
            .await;
        result
    })
}

/// Reads the delegate's final answer and builds the result envelope. The
/// requested status is downgraded to `failed` when the child produced no
/// answer, errored, or — defensively — stopped on an approval request.
#[allow(clippy::too_many_arguments)]
async fn build_result_envelope(
    app_state: &AppState,
    child_chat_id: Uuid,
    child_assistant_message_id: Uuid,
    spawned_at: sea_orm::prelude::DateTimeWithTimeZone,
    assistant_id: Uuid,
    assistant_name: String,
    requested_status: DelegationRunStatus,
    result_max_chars: usize,
) -> DelegationResultEnvelope {
    use sea_orm::EntityTrait;

    let mut status = requested_status;
    let mut result_text: Option<String> = None;
    let mut truncated = false;

    // The answer is the assistant message the child's own generation wrote —
    // identified by the id recorded on its streaming task, never by
    // newest-row scanning, so neither seeded parent copies nor a concurrent
    // interloping run on the child chat can masquerade as the delegate's
    // result. Rows predating the spawn are seeded copies by construction.
    let assistant_row = crate::db::entity::messages::Entity::find_by_id(child_assistant_message_id)
        .one(&app_state.db)
        .await
        .ok()
        .flatten()
        .filter(|row| row.chat_id == child_chat_id && row.created_at > spawned_at)
        .filter(|row| {
            row.raw_message
                .get("role")
                .and_then(|role| role.as_str())
                .is_some_and(|role| role == "assistant")
        });
    let assistant_row = assistant_row.as_ref();

    if let Some(row) = assistant_row {
        let content = row
            .raw_message
            .get("content")
            .and_then(|content| content.as_array())
            .cloned()
            .unwrap_or_default();
        let stopped_on_approval = content
            .last()
            .and_then(|part| part.get("content_type"))
            .and_then(|content_type| content_type.as_str())
            .is_some_and(|content_type| content_type == "tool_approval_request");
        if stopped_on_approval && status == DelegationRunStatus::Completed {
            status = DelegationRunStatus::Failed;
        }
        let has_metadata_error = row
            .generation_metadata
            .as_ref()
            .and_then(|metadata| metadata.get("error"))
            .is_some_and(|error| !error.is_null());
        if has_metadata_error && status == DelegationRunStatus::Completed {
            status = DelegationRunStatus::Failed;
        }
        let text = content
            .iter()
            .filter(|part| {
                part.get("content_type")
                    .and_then(|content_type| content_type.as_str())
                    .is_some_and(|content_type| content_type == "text")
            })
            .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
            .collect::<Vec<_>>()
            .join("\n");
        if !text.trim().is_empty() {
            if text.chars().count() > result_max_chars {
                result_text = Some(text.chars().take(result_max_chars).collect());
                truncated = true;
            } else {
                result_text = Some(text);
            }
        }
    }

    if result_text.is_none() && status == DelegationRunStatus::Completed {
        status = DelegationRunStatus::Failed;
    }

    DelegationResultEnvelope {
        status,
        assistant_id,
        assistant_name,
        delegate_chat_id: child_chat_id,
        result: result_text,
        truncated,
    }
}

/// Dispatches a `delegate_to_assistant` call: validates the arguments against
/// what this turn offered, creates the delegated child chat (owned by the
/// origin user, full provenance envelope), runs the delegate as an awaited
/// child run, and returns the result envelope. `Err` is a refusal message for
/// the model — the caller refuses the call, never the turn.
pub(crate) async fn dispatch_delegate_tool_call(
    app_state: &AppState,
    policy: &PolicyEngine,
    context: &crate::server::api::v1beta::message_streaming::DelegationDispatchContext<'_>,
    tool_call: &genai::chat::ToolCall,
    parent_task: Option<&std::sync::Arc<crate::services::background_tasks::StreamingTask>>,
) -> Result<DelegationResultEnvelope, String> {
    use sea_orm::{ActiveValue, EntityTrait, QueryOrder};

    let config = app_state.config.assistants.delegation.clone();
    if !config.enabled {
        return Err("Assistant delegation is not enabled.".to_string());
    }

    let args: DelegateToolArgs = serde_json::from_value(tool_call.fn_arguments.clone())
        .map_err(|error| format!("Invalid delegate_to_assistant arguments: {error}"))?;
    if args.task.trim().is_empty() {
        return Err("The 'task' argument must not be empty.".to_string());
    }
    let assistant_id = Uuid::parse_str(&args.assistant_id)
        .map_err(|_| format!("Invalid assistant id '{}'.", args.assistant_id))?;
    if !context
        .targets
        .iter()
        .any(|target| target.id == assistant_id)
    {
        return Err(format!(
            "Assistant {assistant_id} was not offered for delegation on this turn."
        ));
    }

    let mut file_ids: Vec<Uuid> = Vec::new();
    for raw_id in args.file_ids.iter().flatten() {
        let file_id =
            Uuid::parse_str(raw_id).map_err(|_| format!("Invalid file id '{raw_id}'."))?;
        if !context.offered_file_ids.contains(&file_id) {
            return Err(format!("File {file_id} is not an attachment of this chat."));
        }
        let join_row = crate::db::entity::chat_file_uploads::Entity::find_by_id((
            context.origin_chat.id,
            file_id,
        ))
        .one(&app_state.db)
        .await
        .map_err(|error| {
            tracing::warn!(%error, "Failed to verify delegation file attachment");
            "Failed to verify the file attachment.".to_string()
        })?;
        if join_row.is_none() {
            return Err(format!("File {file_id} is not an attachment of this chat."));
        }
        if !file_ids.contains(&file_id) {
            file_ids.push(file_id);
        }
    }

    // Re-resolve the target access-checked (revocation or archiving between
    // submit-time validation and dispatch), as the origin chat's owner. Every
    // generation path requires chat ownership, so owner == requester; if a
    // non-owner path to generation is ever added, this subject choice becomes
    // an escalation and must switch to the requester.
    let owner_subject = Subject::User(context.origin_chat.owner_user_id.clone());
    let assistant = crate::models::assistant::get_assistant_by_id(
        &app_state.db,
        policy,
        &owner_subject,
        assistant_id,
    )
    .await
    .map_err(|error| {
        tracing::debug!(%assistant_id, %error, "Delegation target no longer resolvable");
        "The mentioned assistant is no longer available.".to_string()
    })?;

    let parent_depth = crate::models::chat::parse_assistant_configuration(context.origin_chat)
        .ok()
        .flatten()
        .and_then(|configuration| configuration.provenance)
        .map(|provenance| provenance.depth)
        .unwrap_or(0);
    let spawned_at: sea_orm::prelude::DateTimeWithTimeZone = sqlx::types::chrono::Utc::now().into();
    let provenance = crate::models::chat::ChatProvenance {
        kind: crate::models::chat::ChatProvenanceKind::Delegation,
        origin_chat_id: Some(context.origin_chat.id),
        origin_message_id: Some(context.origin_user_message_id),
        origin_assistant_id: context.origin_chat.assistant_id,
        rebase_cutoff: Some(spawned_at),
        depth: parent_depth + 1,
    };
    let child_chat = crate::models::chat::create_delegated_chat(
        &app_state.db,
        policy,
        &owner_subject,
        &context.origin_chat.owner_user_id,
        assistant_id,
        provenance,
        delegated_chat_title(&args.task),
    )
    .await
    .map_err(|error| {
        tracing::warn!(%error, "Failed to create delegated chat");
        "Failed to create the delegated chat.".to_string()
    })?;
    app_state.global_policy_engine.invalidate_data().await;

    for file_id in &file_ids {
        let join_row = crate::db::entity::chat_file_uploads::ActiveModel {
            chat_id: ActiveValue::Set(child_chat.id),
            file_upload_id: ActiveValue::Set(*file_id),
            ..Default::default()
        };
        if let Err(error) = crate::db::entity::chat_file_uploads::Entity::insert(join_row)
            .exec(&app_state.db)
            .await
        {
            tracing::warn!(%error, "Failed to attach file to delegated chat");
            return Err("Failed to attach a file to the delegated chat.".to_string());
        }
    }

    // Context transfer seeds from the origin turn's replay anchor — the
    // history BEFORE the mention message. The mention message itself is
    // represented by the task brief; a seeded user message after the last
    // snapshot would be dropped by composition anyway.
    let mut previous_message_id: Option<Uuid> = None;
    if args.include_conversation_context {
        let anchor_id =
            crate::db::entity::messages::Entity::find_by_id(context.origin_user_message_id)
                .one(&app_state.db)
                .await
                .ok()
                .flatten()
                .and_then(|row| row.previous_message_id);
        if let Some(anchor_id) = anchor_id {
            crate::models::chat::seed_chat_lineage(&app_state.db, &child_chat.id, &anchor_id)
                .await
                .map_err(|error| {
                    tracing::warn!(%error, "Failed to seed delegated chat lineage");
                    "Failed to pass the conversation context to the delegate.".to_string()
                })?;
            previous_message_id = {
                use sea_orm::{ColumnTrait, QueryFilter};
                crate::db::entity::messages::Entity::find()
                    .filter(crate::db::entity::messages::Column::ChatId.eq(child_chat.id))
                    .order_by_desc(crate::db::entity::messages::Column::CreatedAt)
                    .one(&app_state.db)
                    .await
                    .ok()
                    .flatten()
                    .map(|row| row.id)
            };
        }
    }

    let preamble = render_delegation_preamble(
        &config.preamble,
        args.expected_output.as_deref(),
        args.constraints.as_deref(),
    );
    let child_user_message = format!(
        "{}\n\n<system-reminder>\n{}\n</system-reminder>",
        args.task.trim(),
        preamble.trim()
    );

    let (_child_rx, child_task) = app_state
        .background_tasks
        .start_task(child_chat.id, Uuid::new_v4())
        .await;
    let child_request =
        crate::server::api::v1beta::message_streaming::MessageSubmitRequest::for_delegated_run(
            child_chat.id,
            child_user_message,
            file_ids,
            previous_message_id,
        );
    let mut handle = tokio::spawn(run_delegated_child(
        app_state.clone(),
        policy.clone(),
        context.me_user.clone(),
        child_task.clone(),
        child_request,
        child_chat.id,
    ));

    let status = tokio::select! {
        joined = &mut handle => match joined {
            Ok(Ok(())) => DelegationRunStatus::Completed,
            Ok(Err(_)) => DelegationRunStatus::Failed,
            Err(join_error) => {
                tracing::warn!(?join_error, "Delegated child run panicked");
                DelegationRunStatus::Failed
            }
        },
        _ = parent_abort_signal(parent_task) => {
            child_task.request_abort();
            if tokio::time::timeout(CHILD_ABORT_GRACE, &mut handle).await.is_err() {
                // Never hard-cancel: the child's cleanup tail (stream end,
                // outcome persistence, task removal) must run, or its command
                // listener and lease leak. The cooperative abort stops the run
                // at the next stream chunk or turn boundary; until then it
                // winds down detached.
                tracing::warn!(
                    child_chat_id = %child_chat.id,
                    "Delegated child did not stop within the abort grace; detaching"
                );
            }
            DelegationRunStatus::Cancelled
        },
        _ = tokio::time::sleep(std::time::Duration::from_secs(config.run_timeout_seconds)) => {
            child_task.request_abort();
            if tokio::time::timeout(CHILD_ABORT_GRACE, &mut handle).await.is_err() {
                tracing::warn!(
                    child_chat_id = %child_chat.id,
                    "Delegated child did not stop within the timeout grace; detaching"
                );
            }
            DelegationRunStatus::Timeout
        }
    };

    Ok(build_result_envelope(
        app_state,
        child_chat.id,
        child_task.message_id(),
        spawned_at,
        assistant_id,
        assistant.name,
        status,
        config.result_max_chars,
    )
    .await)
}
