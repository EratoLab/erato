use super::me_profile_middleware::MeProfile;
use super::message_streaming::{
    MeProfileChatRequestInput, PreparedChatRequest, prepare_chat_request_with_adapters,
};
use crate::db::entity::{chats, messages};
use crate::models::message::{
    ContentPart, ContentPartCompactionMarker, ContentPartText, GenerationRequestContext,
    MessageRole, MessageSchema, compaction_marker,
};
use crate::policy::prelude::*;
use crate::services::background_tasks::{Takeover, TaskCleanupGuard, TaskOutcome};
use crate::services::chat_history_compaction::{self as compaction, FilePreview};
use crate::services::prompt_composition::adapters::OverlayMessageRepository;
use crate::services::prompt_composition::{
    AppStateFileResolver, AppStatePromptProvider, DatabaseMessageRepository,
    PromptCompositionUserInput,
};
use crate::state::AppState;
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::Utc;
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CompactChatRequest {
    pub expected_tip_message_id: Uuid,
    pub operation_id: Uuid,
    /// Conversation model used for estimates and the soft target, not the summarizer.
    #[schema(nullable = false)]
    pub target_chat_provider_id: Option<String>,
    #[serde(default)]
    pub selected_facet_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CompactChatResponse {
    pub message_id: Uuid,
    pub compaction: ContentPartCompactionMarker,
}

type ApiError = (StatusCode, String);
fn internal(error: impl std::fmt::Display) -> ApiError {
    tracing::error!(error = %error, "Chat history compaction failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Could not compact chat history. Please retry.".into(),
    )
}
fn conflict() -> ApiError {
    (
        StatusCode::CONFLICT,
        "The chat changed or has an active generation. Refresh and retry.".into(),
    )
}

/// Compact the current active conversation after explicit user approval.
#[utoipa::path(post, path = "/me/chats/{chat_id}/compact", request_body = CompactChatRequest,
    params(("chat_id" = Uuid, Path, description = "Chat ID")),
    responses((status = 200, body = CompactChatResponse), (status = 400, description = "Invalid or over-limit context"),
        (status = 403, description = "Chat is read-only"), (status = 404, description = "Disabled or missing chat"),
        (status = 409, description = "Stale tip or busy chat"), (status = 502, description = "Invalid summarizer response")),
    security(("bearer_auth" = [])))]
pub async fn compact_chat(
    State(app): State<AppState>,
    Extension(me): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
    Path(chat_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<CompactChatRequest>,
) -> Result<Json<CompactChatResponse>, ApiError> {
    if !app.config.chat_history_compaction.enabled {
        return Err((StatusCode::NOT_FOUND, "Chat compaction is disabled".into()));
    }
    policy
        .rebuild_data_if_needed_req(&app.db, &app.config)
        .await
        .map_err(internal)?;
    let subject = me.to_subject();
    authorize!(
        policy,
        &subject,
        &Resource::Chat(chat_id.to_string()),
        Action::Update
    )
    .map_err(|_| (StatusCode::FORBIDDEN, "Chat is read-only".into()))?;
    authorize!(
        policy,
        &subject,
        &Resource::Chat(chat_id.to_string()),
        Action::SubmitMessage
    )
    .map_err(|_| (StatusCode::FORBIDDEN, "Chat is read-only".into()))?;
    let chat = chats::Entity::find_by_id(chat_id)
        .one(&app.db)
        .await
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "Chat not found".into()))?;
    if chat.archived_at.is_some() {
        return Err((StatusCode::FORBIDDEN, "Archived chat is read-only".into()));
    }
    // The operation UUID is also the checkpoint primary key, making uncertain
    // network retries idempotent without a second lookup/index or schema change.
    if let Some(row) = messages::Entity::find_by_id(request.operation_id)
        .one(&app.db)
        .await
        .map_err(internal)?
    {
        if row.chat_id != chat_id
            || row.previous_message_id != Some(request.expected_tip_message_id)
            || !row.is_message_in_active_thread
        {
            return Err(conflict());
        }
        let marker = compaction_marker(&row)
            .map_err(internal)?
            .ok_or_else(conflict)?;
        if marker.operation_id != request.operation_id {
            return Err(conflict());
        }
        return Ok(Json(CompactChatResponse {
            message_id: row.id,
            compaction: marker,
        }));
    }
    let tip = crate::models::message::get_active_thread_tip(&app.db, &chat_id)
        .await
        .map_err(internal)?
        .filter(|tip| tip.id == request.expected_tip_message_id)
        .ok_or_else(conflict)?;
    let parsed = MessageSchema::validate(&tip.raw_message).map_err(internal)?;
    if parsed.role != MessageRole::Assistant
        || crate::models::message::is_durable_stop(&parsed.content)
    {
        return Err((
            StatusCode::CONFLICT,
            "Finish the pending turn before compacting".into(),
        ));
    }
    let (_, task) = app
        .background_tasks
        .try_start_task(
            chat_id,
            request.operation_id,
            Takeover::RefuseParked,
            app.config.generation_status.stale_after_secs,
        )
        .await
        .map_err(|_| conflict())?;
    let mut guard =
        TaskCleanupGuard::new(app.background_tasks.clone(), chat_id, task.generation_id);
    let context = super::message_streaming::generation_request_context_from_headers(&headers);
    let result = tokio::select! {
        _ = task.wait_for_abort() => Err(conflict()),
        result = tokio::time::timeout(std::time::Duration::from_secs(300), compact_under_lease(&app, &policy, &me, &chat, &request, context, task.generation_id)) => result.unwrap_or_else(|_| Err((StatusCode::GATEWAY_TIMEOUT, "Compaction timed out. Please retry.".into()))),
    };
    if let Ok(response) = &result {
        if let Ok(Some(row)) = messages::Entity::find_by_id(response.message_id)
            .one(&app.db)
            .await
            && let (Ok(parsed), Ok(message)) = (
                MessageSchema::validate(&row.raw_message),
                super::ChatMessage::from_model(row),
            )
        {
            let _ = task
                .send_event(
                    crate::services::background_tasks::StreamingEvent::AssistantMessageCompleted {
                        message_id: response.message_id,
                        content: parsed.content,
                        message,
                    },
                )
                .await;
        }
    } else {
        let _ = task.send_event(crate::services::background_tasks::StreamingEvent::Error { error: Some(serde_json::json!({"error_type":"internal_error", "error_description":"Could not compact chat history. Please retry."})) }).await;
    }
    let _ = task
        .send_event(crate::services::background_tasks::StreamingEvent::StreamEnd)
        .await;
    task.mark_completed();
    app.background_tasks
        .remove_task(
            &chat_id,
            task.generation_id,
            if result.is_ok() {
                TaskOutcome::Completed
            } else {
                TaskOutcome::Errored
            },
        )
        .await;
    guard.disarm();
    result.map(Json)
}

fn draft(chat_id: Uuid, predecessor: Uuid) -> Result<messages::Model, Report> {
    let now = Utc::now().into();
    Ok(messages::Model {
        id: Uuid::new_v4(),
        chat_id,
        created_at: now,
        updated_at: now,
        raw_message: MessageSchema {
            role: MessageRole::User,
            content: vec![],
            name: None,
            additional_fields: Default::default(),
        }
        .to_json()?,
        previous_message_id: Some(predecessor),
        sibling_message_id: None,
        is_message_in_active_thread: true,
        generation_input_messages: None,
        input_file_uploads: None,
        generation_parameters: None,
        generation_metadata: None,
        input_parameters: None,
    })
}

#[allow(clippy::too_many_arguments)]
async fn prepare(
    app: &AppState,
    policy: &PolicyEngine,
    me: &MeProfile,
    chat: &chats::Model,
    request: &CompactChatRequest,
    context: GenerationRequestContext,
    predecessor: Uuid,
    checkpoint: Option<messages::Model>,
) -> Result<PreparedChatRequest, Report> {
    let subject = me.to_subject();
    let assistant =
        crate::models::chat::get_chat_assistant_configuration(&app.db, policy, &subject, chat)
            .await?;
    let draft = draft(chat.id, predecessor)?;
    let input = PromptCompositionUserInput {
        just_submitted_user_message_id: draft.id,
        requested_chat_provider_id: request.target_chat_provider_id.clone(),
        new_input_file_ids: vec![],
        selected_facet_ids: request.selected_facet_ids.clone(),
        action_facet: None,
        delegation_targets: vec![],
        delegation_run_mode: Default::default(),
        suppress_task_offer: false,
    };
    let mut overlays = HashMap::from([(draft.id, draft)]);
    if let Some(row) = checkpoint {
        overlays.insert(row.id, row);
    }
    let repo = OverlayMessageRepository {
        base: DatabaseMessageRepository {
            conn: &app.db,
            policy,
            subject: &subject,
        },
        overlays,
    };
    prepare_chat_request_with_adapters(
        app,
        policy,
        chat,
        input,
        context,
        &MeProfileChatRequestInput::from_me_profile(me),
        assistant,
        &repo,
        &AppStateFileResolver {
            app_state: app,
            access_token: me.access_token.as_deref(),
        },
        &AppStatePromptProvider {
            app_state: app,
            policy,
            subject: &subject,
            access_token: me.access_token.as_deref(),
        },
        &[],
    )
    .await
}

async fn tokens(app: &AppState, prepared: &PreparedChatRequest) -> Result<usize, ApiError> {
    Ok(
        super::token_usage::count_tokens_for_chat_request(app, prepared.chat_request())
            .await
            .map_err(internal)?
            + prepared
                .attachment_plans
                .iter()
                .map(|p| p.native_image_tokens)
                .sum::<usize>(),
    )
}

#[tracing::instrument(name = "chat_history_compaction.summarize", skip_all, fields(chat_id = %chat.id, operation_id = %request.operation_id, mode = "summarize"))]
async fn compact_under_lease(
    app: &AppState,
    policy: &PolicyEngine,
    me: &MeProfile,
    chat: &chats::Model,
    request: &CompactChatRequest,
    context: GenerationRequestContext,
    generation_id: Uuid,
) -> Result<CompactChatResponse, ApiError> {
    if crate::models::message::get_active_thread_tip(&app.db, &chat.id)
        .await
        .map_err(internal)?
        .map(|t| t.id)
        != Some(request.expected_tip_message_id)
    {
        return Err(conflict());
    }
    let prepared = prepare(
        app,
        policy,
        me,
        chat,
        request,
        context.clone(),
        request.expected_tip_message_id,
        None,
    )
    .await
    .map_err(internal)?;
    let before_tokens = tokens(app, &prepared).await?;
    let source = prepared.generation_input().clone();
    if !source.messages.iter().any(|m| {
        m.role != MessageRole::System
            && matches!(&m.content, ContentPart::Text(t) if !t.text.trim().is_empty())
    }) {
        return Err((
            StatusCode::BAD_REQUEST,
            "There is no conversation to compact".into(),
        ));
    }
    let subject = me.to_subject();
    let assistant =
        crate::models::chat::get_chat_assistant_configuration(&app.db, policy, &subject, chat)
            .await
            .map_err(internal)?;
    let pinned: BTreeSet<_> = assistant
        .as_ref()
        .map(|a| a.files.iter().map(|f| f.id).collect())
        .unwrap_or_default();
    let ids = compaction::file_ids(&source);
    let mut previews = Vec::new();
    let ctx = me
        .access_token
        .as_deref()
        .map(|access_token| crate::services::file_storage::SharepointContext { access_token });
    for id in &ids {
        // Authorization precedes extraction, including external-storage checks.
        let allowed =
            crate::models::file_upload::get_file_upload_by_id(&app.db, policy, &subject, id)
                .await
                .is_ok();
        if !allowed {
            previews.push(FilePreview {
                id: *id,
                filename: "Unavailable file".into(),
                preview: "Preview unavailable or access denied".into(),
                always_keep: true,
                estimated_context_tokens: 0,
            });
            continue;
        }
        let attachment = super::file_resolution::load_attachment(app, *id, ctx.as_ref()).await;
        let plan = attachment.compaction_preview(&app.config.file_context);
        let available = plan.inclusion_mode
            == crate::services::file_context::InclusionMode::Preview
            && attachment
                .text
                .as_deref()
                .or(attachment.csv_source.as_deref())
                .is_some_and(|text| !text.trim().is_empty());
        previews.push(FilePreview {
            id: *id,
            filename: attachment.filename,
            preview: plan
                .parts
                .iter()
                .filter_map(|p| {
                    if let ContentPart::Text(t) = p {
                        Some(t.text.as_str())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n"),
            always_keep: pinned.contains(id) || !available,
            estimated_context_tokens: prepared
                .attachment_plans
                .iter()
                .find(|p| p.id == id.to_string())
                .map(|p| p.token_count)
                .unwrap_or(plan.token_count),
        });
    }
    let target_id = prepared.generation_parameters_id();
    let target = app.config.get_chat_provider(&target_id);
    let provider = app.chat_provider_for_compaction().map_err(internal)?;
    let summary_request = compaction::build_summary_request(
        &source,
        &previews,
        before_tokens,
        target.model_capabilities.context_size_tokens,
        app.config
            .chat_history_compaction
            .target_compaction_token_limit_percentage,
    )
    .map_err(internal)?;
    let input_tokens = super::token_usage::count_tokens_for_chat_request(app, &summary_request)
        .await
        .map_err(internal)?;
    let limit = provider
        .chat_provider_config
        .model_capabilities
        .context_size_tokens;
    let headroom = (limit / 4).clamp(1, 4096);
    if input_tokens + headroom > limit {
        return Err((
            StatusCode::BAD_REQUEST,
            "Conversation and file previews exceed the configured compaction model's context limit"
                .into(),
        ));
    }
    let options = crate::services::genai::build_chat_options_for_completion(
        &provider.chat_provider_config.model_settings,
        &provider.chat_provider_config.model_capabilities,
    )
    .with_max_tokens(headroom as u32);
    let client = app
        .genai_for_chat_provider_id(Some(&provider.chat_provider_id))
        .map_err(internal)?;
    let start = std::time::SystemTime::now();
    let response = client
        .exec_chat("PLACEHOLDER_MODEL", summary_request.clone(), Some(&options))
        .await;
    let outcome = match &response {
        Err(_) => "provider_error",
        Ok(response) if !response.content.tool_calls().is_empty() => "unexpected_tools",
        Ok(response)
            if compaction::validate_result(response.first_text().unwrap_or(""), &previews)
                .is_err() =>
        {
            "invalid_summary"
        }
        Ok(_) => "valid_summary",
    };
    let mut compaction_trace = None;
    // Named operation metadata is exported on success and provider failure.
    if app.config.integrations.langfuse.enabled && app.config.integrations.langfuse.tracing_enabled
    {
        let (observation_id, trace_id) = crate::services::genai_langfuse::generate_langfuse_ids();
        let trace = crate::services::langfuse::TracingLangfuseClient::new(
            app.langfuse_client.clone(),
            trace_id,
            Some(me.id.clone()),
            Some(chat.id.to_string()),
        );
        let metadata = serde_json::json!({"operation": "chat_history_compaction", "mode":"summarize", "operation_id":request.operation_id, "summarizer_chat_provider_id":provider.chat_provider_id, "target_chat_provider_id":target_id, "before_tokens": before_tokens, "file_count":ids.len(), "outcome":outcome});
        if let Err(error) = trace
            .create_trace(
                Some("chat_history_compaction.summarize".into()),
                None,
                Some(metadata),
                Some(vec!["chat_history_compaction".into(), "summarize".into()]),
            )
            .await
        {
            tracing::warn!(%error, "Could not trace compaction");
        }
        let output = response
            .as_ref()
            .ok()
            .and_then(|r| r.first_text())
            .unwrap_or("Compaction provider failed");
        if let Err(error) =
            crate::services::genai_langfuse::TracedGenerationBuilder::new(observation_id)
                .with_name("chat_history_compaction.summarize".into())
                .with_model(
                    provider
                        .chat_provider_config
                        .model_name_langfuse()
                        .to_string(),
                )
                .with_start_time(start)
                .with_end_time(std::time::SystemTime::now())
                .build_and_send(
                    &trace,
                    &summary_request,
                    &[ContentPart::Text(ContentPartText {
                        text: output.into(),
                    })],
                    response.as_ref().ok().map(|r| &r.usage),
                    chat.assistant_id,
                    &[],
                    context.platform.as_deref(),
                )
                .await
        {
            tracing::warn!(%error, "Could not trace compaction generation");
        }
        compaction_trace = Some(trace);
    }
    let response = response.map_err(|e| {
        tracing::warn!(%e, "Compaction provider failed");
        (
            StatusCode::BAD_GATEWAY,
            "Compaction model request failed. Please retry.".into(),
        )
    })?;
    if !response.content.tool_calls().is_empty() {
        return Err((
            StatusCode::BAD_GATEWAY,
            "Compaction model returned tools instead of a summary".into(),
        ));
    }
    let result = compaction::validate_result(response.first_text().unwrap_or(""), &previews)
        .map_err(|e| {
            tracing::warn!(%e, "Invalid compaction result");
            (
                StatusCode::BAD_GATEWAY,
                "Compaction model returned an invalid summary. Please retry.".into(),
            )
        })?;
    let replacement = compaction::replacement(&source, &result);
    let retained = compaction::file_ids(&replacement);
    let mut marker = ContentPartCompactionMarker {
        version: 1,
        mode: "summarize".into(),
        operation_id: request.operation_id,
        summarizer_chat_provider_id: provider.chat_provider_id,
        target_chat_provider_id: target_id,
        before_tokens,
        after_tokens: 0,
        before_files: ids.len(),
        after_files: retained.len(),
        retained_file_ids: retained.iter().copied().collect(),
        dropped_file_ids: ids.difference(&retained).copied().collect(),
    };
    let now = Utc::now().into();
    let mut checkpoint = draft(chat.id, request.expected_tip_message_id).map_err(internal)?;
    checkpoint.id = request.operation_id;
    checkpoint.created_at = now;
    checkpoint.updated_at = now;
    checkpoint.generation_input_messages =
        Some(serde_json::to_value(&replacement).map_err(internal)?);
    let mut parameters = prepared.generation_parameters().clone();
    parameters.generation_chat_provider_id = Some(marker.summarizer_chat_provider_id.clone());
    checkpoint.generation_parameters = Some(serde_json::to_value(parameters).map_err(internal)?);
    checkpoint.input_file_uploads = Some(retained.iter().copied().collect());
    checkpoint.generation_metadata = Some(
        serde_json::to_value(crate::models::message::GenerationMetadata {
            used_prompt_tokens: response.usage.prompt_tokens.map(|n| n as u32),
            used_completion_tokens: response.usage.completion_tokens.map(|n| n as u32),
            used_total_tokens: response.usage.total_tokens.map(|n| n as u32),
            langfuse_trace_id: compaction_trace
                .as_ref()
                .map(|trace| trace.trace_id().to_owned()),
            ..Default::default()
        })
        .map_err(internal)?,
    );
    let raw = |marker| {
        MessageSchema {
            role: MessageRole::Assistant,
            content: vec![
                ContentPart::CompactionMarker(marker),
                ContentPart::Text(ContentPartText {
                    text: result.summary.trim().into(),
                }),
            ],
            name: None,
            additional_fields: Default::default(),
        }
        .to_json()
    };
    checkpoint.raw_message = raw(marker.clone()).map_err(internal)?;
    let after = prepare(
        app,
        policy,
        me,
        chat,
        request,
        context,
        checkpoint.id,
        Some(checkpoint.clone()),
    )
    .await
    .map_err(internal)?;
    marker.after_tokens = tokens(app, &after).await?;
    checkpoint.raw_message = raw(marker.clone()).map_err(internal)?;
    // Fence the append under the same locked chat row used by lease acquisition.
    let txn = app.db.begin().await.map_err(internal)?;
    let locked = chats::Entity::find_by_id(chat.id)
        .lock_exclusive()
        .one(&txn)
        .await
        .map_err(internal)?
        .ok_or_else(conflict)?;
    let tip = messages::Entity::find()
        .filter(messages::Column::ChatId.eq(chat.id))
        .filter(messages::Column::IsMessageInActiveThread.eq(true))
        .order_by_desc(messages::Column::CreatedAt)
        .one(&txn)
        .await
        .map_err(internal)?;
    if locked.archived_at.is_some()
        || locked.active_generation_id != Some(generation_id)
        || locked.generation_state.as_deref() != Some("running")
        || tip.map(|t| t.id) != Some(request.expected_tip_message_id)
    {
        return Err(conflict());
    }
    let mut active: messages::ActiveModel = checkpoint.into();
    active.id = Set(request.operation_id);
    messages::Entity::insert(active)
        .exec(&txn)
        .await
        .map_err(internal)?;
    txn.commit().await.map_err(internal)?;
    if let Some(trace) = compaction_trace {
        let metadata = serde_json::json!({
            "operation": "chat_history_compaction", "mode":"summarize", "outcome":"committed",
            "operation_id":marker.operation_id, "summarizer_chat_provider_id":marker.summarizer_chat_provider_id,
            "target_chat_provider_id":marker.target_chat_provider_id, "before_tokens":marker.before_tokens,
            "after_tokens":marker.after_tokens, "before_files":marker.before_files, "after_files":marker.after_files,
        });
        // The append is committed. Telemetry must not hold the cancellation
        // arm open or delay returning the durable checkpoint to the caller.
        tokio::spawn(async move {
            if let Err(error) = trace.update_trace_metadata(metadata).await {
                tracing::warn!(%error, "Could not update compaction trace");
            }
        });
    }
    tracing::info!(before_tokens = marker.before_tokens, after_tokens = marker.after_tokens,
        before_files = marker.before_files, after_files = marker.after_files,
        summarizer_chat_provider_id = %marker.summarizer_chat_provider_id,
        target_chat_provider_id = %marker.target_chat_provider_id, outcome = "committed", "Chat history compacted");
    Ok(CompactChatResponse {
        message_id: request.operation_id,
        compaction: marker,
    })
}
