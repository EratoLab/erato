//! Durable local-research continuations. Only explicitly scoped async leaf tasks
//! enter this runner. The first version offers deterministic local collection;
//! it never replays arbitrary MCP/Office effects after a restart.
use super::*;
use crate::db::entity::local_delegation_jobs::JobState;
use crate::services::local_delegation::{Checkpoint, Consumption, store, tool};
use base64::{Engine as _, engine::general_purpose::STANDARD};

pub(super) use crate::services::local_delegation::is_waiting;
pub(super) fn raw(checkpoint: &Checkpoint) -> Value {
    json!({"role":"assistant","content":checkpoint.content})
}
fn waiting_content(checkpoint: &mut Checkpoint, call: &genai::chat::ToolCall, id: Uuid) {
    upsert_tool_use(
        &mut checkpoint.content,
        ToolUse {
            tool_call_id: call.call_id.clone(),
            tool_name: tool::NAME.into(),
            status: MessageToolCallStatus::InProgress,
            input: Some(call.fn_arguments.clone()),
            output: Some(json!({"status":"awaiting_local_consent","jobId":id})),
            progress_message: None,
            progress: None,
            total: None,
            started_at: Some(now_timestamp()),
            ended_at: None,
        },
    );
}
#[allow(clippy::too_many_arguments)]
pub(super) async fn park_initial(
    state: &AppState,
    task: &Arc<StreamingTask>,
    owner: &str,
    chat_id: Uuid,
    message_id: Uuid,
    provider: &str,
    call: &genai::chat::ToolCall,
    pending: Vec<genai::chat::ToolCall>,
    mut request: ChatRequest,
    content: Vec<ContentPart>,
    responses: &[(usize, genai::chat::ToolResponse)],
    metadata: Option<GenerationMetadata>,
    consumption: Consumption,
    budgets: Option<crate::services::delegation::TaskToolBudgets>,
    allowed: &HashSet<String>,
    previous: Option<&store::Resume>,
) -> Result<Vec<ContentPart>, Report> {
    if allowed.len() != 1
        || !allowed.contains(tool::NAME)
        || pending.iter().any(|c| c.fn_name != tool::NAME)
    {
        return Err(eyre!(
            "Local research requires an exclusive read-only leaf scope"
        ));
    }
    let budgets = budgets.ok_or_else(|| eyre!("Missing local research budget"))?;
    let row = crate::db::entity::prelude::Messages::find_by_id(message_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| eyre!("Missing generation"))?;
    let parameters: GenerationParameters = serde_json::from_value(
        row.generation_parameters
            .ok_or_else(|| eyre!("Missing generation scope"))?,
    )?;
    let mut facets: Vec<_> = parameters
        .selected_facets
        .into_iter()
        .filter_map(|(id, on)| on.then_some(id))
        .collect();
    facets.sort();
    let mut responses = responses.to_vec();
    responses.sort_by_key(|(position, _)| *position);
    if !responses.is_empty() {
        request.messages.push(GenAiChatMessage {
            role: ChatRole::Tool,
            content: MessageContent::from_parts(
                responses
                    .into_iter()
                    .map(|(_, r)| GenAiContentPart::ToolResponse(r))
                    .collect::<Vec<_>>(),
            ),
            options: None,
        });
    }
    let mut checkpoint = Checkpoint {
        version: 1,
        selected_facets: facets,
        max_tool_calls: state.config.generation.max_tool_calls_per_message,
        max_model_turns: state
            .config
            .generation
            .max_tool_calls_per_message
            .saturating_add(2),
        result_applied: false,
        model_finished: false,
        request,
        content,
        pending_calls: pending,
        consumption,
        generation_metadata: metadata,
        allowed_tools: vec![tool::NAME.into()],
        model_id: provider.into(),
        origin_user_message_id: row.previous_message_id,
        task_server_budget: Some(budgets.server),
        task_client_budget: Some(budgets.client),
    };
    if let Some(previous) = previous {
        checkpoint.selected_facets = previous.checkpoint.selected_facets.clone();
        checkpoint.max_tool_calls = previous.checkpoint.max_tool_calls;
        checkpoint.max_model_turns = previous.checkpoint.max_model_turns;
        checkpoint.origin_user_message_id = previous.checkpoint.origin_user_message_id;
        checkpoint.task_server_budget = previous.checkpoint.task_server_budget;
        checkpoint.task_client_budget = previous.checkpoint.task_client_budget;
    }
    let id = Uuid::new_v4();
    let plan = tool::plan(&call.fn_arguments, Utc::now().timestamp())?;
    waiting_content(&mut checkpoint, call, id);
    store::park(
        &state.db,
        store::Park {
            id,
            previous: previous.map(|resume| resume.fence),
            owner,
            chat_id,
            message_id,
            generation_id: task.generation_id,
            tool_call_id: &call.call_id,
            task_id: &chat_id.to_string(),
            plan: &plan,
            checkpoint: &checkpoint,
            message: &raw(&checkpoint),
        },
    )
    .await?;
    task.mark_awaiting_approval();
    Ok(checkpoint.content)
}

fn settle_call(
    checkpoint: &mut Checkpoint,
    call: &genai::chat::ToolCall,
    output: Value,
    error: bool,
) -> Result<(), Report> {
    checkpoint.request.messages.push(GenAiChatMessage {
        role: ChatRole::Tool,
        content: MessageContent::from_parts(vec![GenAiContentPart::ToolResponse(
            genai::chat::ToolResponse {
                call_id: call.call_id.clone(),
                content: serde_json::to_string(&output)?,
            },
        )]),
        options: None,
    });
    upsert_tool_use(
        &mut checkpoint.content,
        ToolUse {
            tool_call_id: call.call_id.clone(),
            tool_name: call.fn_name.clone(),
            status: if error {
                MessageToolCallStatus::Error
            } else {
                MessageToolCallStatus::Success
            },
            input: Some(call.fn_arguments.clone()),
            output: Some(output),
            progress_message: None,
            progress: None,
            total: None,
            started_at: None,
            ended_at: Some(now_timestamp()),
        },
    );
    Ok(())
}
fn apply_result(resume: &mut store::Resume) -> Result<(), Report> {
    if resume.job.server_outcome.is_some() {
        resume.checkpoint.allowed_tools.clear();
        resume.checkpoint.request.tools = None;
    }
    if resume.checkpoint.result_applied {
        return Ok(());
    }
    let output = if let Some(outcome) = resume.job.server_outcome.as_ref() {
        outcome.clone()
    } else {
        let package = resume
            .package
            .as_ref()
            .ok_or_else(|| eyre!("Missing approved result"))?;
        let mut evidence = Vec::new();
        for item in package["artifacts"]
            .as_array()
            .ok_or_else(|| eyre!("Invalid approved result"))?
        {
            let text = String::from_utf8(
                STANDARD.decode(
                    item["contentBase64"]
                        .as_str()
                        .ok_or_else(|| eyre!("Invalid approved result"))?,
                )?,
            )?;
            evidence.push(json!({
                "artifactId": item["artifactId"],
                "file_id": crate::services::local_delegation::uploads::file_id(
                    resume.job.id,
                    package["exportId"].as_str().unwrap(),
                    item["artifactId"].as_str().unwrap(),
                    item["sha256"].as_str().unwrap()
                ),
                "filename": item["filename"],
                "text": text
            }));
        }
        json!({"status":"approved","exportId":package["exportId"],"evidence":evidence})
    };
    let call = genai::chat::ToolCall {
        call_id: resume.job.tool_call_id.clone(),
        fn_name: tool::NAME.into(),
        fn_arguments: json!({"queryVariants":resume.job.plan["queryVariants"]}),
        thought_signatures: None,
    };
    settle_call(
        &mut resume.checkpoint,
        &call,
        output,
        resume.job.server_outcome.is_some(),
    )?;
    resume.checkpoint.result_applied = true;
    if resume.job.server_outcome.is_some() {
        // A server-side cancellation/expiry does not authorize another collection.
        resume.checkpoint.allowed_tools.clear();
        resume.checkpoint.request.tools = None;
    }
    Ok(())
}
pub(super) async fn save(state: &AppState, resume: &store::Resume) -> Result<(), Report> {
    store::checkpoint(
        &state.db,
        resume.fence,
        &resume.checkpoint,
        &raw(&resume.checkpoint),
    )
    .await
}
async fn publish(
    state: &AppState,
    policy: &PolicyEngine,
    me: &MeProfile,
    task: &Arc<StreamingTask>,
    message_id: Uuid,
) -> Result<(), Report> {
    let row = get_message_by_id(&state.db, policy, &me.to_subject(), &message_id).await?;
    let message = ChatMessage::from_model(row)?;
    task.send_event(StreamingEvent::AssistantMessageCompleted {
        message_id,
        content: message.content.clone(),
        message,
    })
    .await
    .map_err(Report::msg)
}

/// This entry point is called only by the normal authenticated HTTP handler.
/// Neither the sweeper nor a stored subject ID can invoke a model generation.
pub(crate) async fn launch(
    state: AppState,
    policy: PolicyEngine,
    me: MeProfile,
    id: Uuid,
) -> Result<(), Report> {
    if !state.config.delegation.tasks.enabled {
        return Err(eyre!("Durable task leases are disabled"));
    }
    let job = store::get(&state.db, id, &me.id).await?;
    if job.state == JobState::Completed {
        return Ok(());
    }
    if job.state != JobState::AwaitingAuthenticatedResume && job.state != JobState::Continuing {
        return Err(eyre!("No continuation is ready"));
    }
    let (_, task) = state
        .background_tasks
        .try_start_task(
            job.chat_id,
            job.message_id,
            Takeover::ResumeLocalJob(id),
            state.config.generation_status.stale_after_secs,
        )
        .await
        .map_err(|_| eyre!("Generation lease is held or the local task was superseded"))?;
    let resume = match store::claimed(&state.db, id, &me.id, task.generation_id).await {
        Ok(resume) => resume,
        Err(error) => {
            state
                .background_tasks
                .remove_task(&job.chat_id, task.generation_id, TaskOutcome::Errored)
                .await;
            return Err(error);
        }
    };
    tokio::spawn(async move {
        let mut cleanup = TaskCleanupGuard::new(
            state.background_tasks.clone(),
            job.chat_id,
            task.generation_id,
        );
        let result = tokio::select! {
            result = run(&state, &policy, &me, &task, resume) => result,
            _ = task.wait_for_abort() => Err(eyre!("Local continuation interrupted")),
        };
        if result.is_err() {
            // The checkpoint remains the authority; no private/native error is
            // posted or reconstructed here. A fresh authenticated request retries.
            tracing::warn!(job_id=%id,"Local continuation stopped; durable recovery is pending");
        }
        let outcome = task.derive_outcome(result.is_err());
        task.mark_completed();
        cleanup.disarm();
        state
            .background_tasks
            .remove_task(&job.chat_id, task.generation_id, outcome)
            .await;
        if result.is_ok() {
            settle_tail_deliveries(&state, &policy, &me, job.chat_id, &task, outcome).await;
        }
    });
    Ok(())
}
async fn run(
    state: &AppState,
    policy: &PolicyEngine,
    me: &MeProfile,
    task: &Arc<StreamingTask>,
    mut resume: store::Resume,
) -> Result<(), Report> {
    let chat =
        get_chat_by_message_id(&state.db, policy, &me.to_subject(), &resume.job.message_id).await?;
    reject_if_archived(&chat).map_err(|_| eyre!("Chat is archived"))?;
    let authorized = policy
        .filter_authorized_facet_ids(
            &me.to_subject(),
            &me.groups,
            &resume.checkpoint.selected_facets,
        )
        .await?;
    if resume.checkpoint.selected_facets.iter().any(|id| {
        !authorized.contains(id) && !state.config.facets.facets.get(id).is_some_and(|f| f.hidden)
    }) {
        return Err(eyre!("Local research scope was withdrawn"));
    }
    let allowlist = effective_client_tool_allowlist(
        &state.config.facets,
        &state.config.action_facets,
        &resume.checkpoint.selected_facets,
        None,
    );
    if !tool::eligible(&state.config, &chat, &allowlist, false)
        || resume
            .checkpoint
            .allowed_tools
            .iter()
            .any(|name| name != tool::NAME)
    {
        return Err(eyre!("Local research is no longer authorized"));
    }
    let models = state
        .available_models(policy, &me.to_subject(), &me.groups)
        .await?;
    if !models
        .iter()
        .any(|model| model.chat_provider_id == resume.checkpoint.model_id)
    {
        return Err(eyre!("Local research model is no longer authorized"));
    }
    let provider = state.config.get_chat_provider(&resume.checkpoint.model_id);
    let settings = build_model_settings_for_facets(
        &provider.model_settings,
        &state.config.facets,
        &resume.checkpoint.selected_facets,
    );
    let options = build_chat_options_for_completion(&settings, &provider.model_capabilities);
    let headers = ChatProviderHeadersContext::new(&me.id, &me.id_token_claims);
    apply_result(&mut resume)?;
    save(state, &resume).await?;
    if resume.checkpoint.model_finished {
        store::finish(
            &state.db,
            resume.fence,
            &raw(&resume.checkpoint),
            &serde_json::to_value(&resume.checkpoint.generation_metadata)?,
        )
        .await?;
        return publish(state, policy, me, task, resume.job.message_id).await;
    }
    let current_budget = task_tool_budgets_for_chat(&chat)
        .ok_or_else(|| eyre!("Local research budget was withdrawn"))?;
    let budgets = crate::services::delegation::TaskToolBudgets {
        server: current_budget
            .server
            .min(resume.checkpoint.task_server_budget.unwrap_or(0)),
        client: current_budget
            .client
            .min(resume.checkpoint.task_client_budget.unwrap_or(0)),
    };
    let model_id = resume.checkpoint.model_id.clone();
    let message_id = resume.job.message_id;
    let request = resume.checkpoint.request.clone();
    let content = resume.checkpoint.content.clone();
    let allowed = resume.checkpoint.allowed_tools.iter().cloned().collect();
    let pending = resume.checkpoint.pending_calls.clone();
    // Reuse the same streaming, guardrail, tracing, accounting and tool dispatch
    // loop as /continue. The resume seed adds durable counters/checkpoints only;
    // it does not introduce another model runner or ordinary approval grant.
    stream_generate_chat_completion::<MessageSubmitStreamingResponseMessage>(
        detached_generation_event_sink(),
        state,
        policy,
        &me.to_subject(),
        request,
        LangfuseTraceEnrichment::default(),
        options,
        message_id,
        me.id.clone(),
        chat.id,
        Some(&model_id),
        &me.groups,
        McpRequestAuthContext {
            app_state: Some(state),
            user_id: Uuid::parse_str(&me.id).ok(),
            oidc_token: Some(&me.oidc_token),
            access_token: me.access_token.as_deref(),
        },
        vec![],
        vec![],
        vec![],
        vec![],
        allowed,
        vec![],
        HashMap::new(),
        &headers,
        Some(task),
        chat.assistant_id,
        content,
        true,
        false,
        None,
        Some(budgets),
        Some(ParkedTurnResume {
            initial_unfinished_tool_calls: pending,
            approved_task_call_ids: HashSet::new(),
            local_job: Some(resume),
        }),
    )
    .await?;
    publish(state, policy, me, task, message_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn resume_fixture() -> store::Resume {
        let id = Uuid::new_v4();
        let mut checkpoint = Checkpoint {
            version: 1,
            selected_facets: vec!["local-research".into()],
            max_tool_calls: 3,
            max_model_turns: 5,
            result_applied: false,
            model_finished: false,
            request: ChatRequest::from_user("Find evidence"),
            content: vec![],
            pending_calls: vec![],
            consumption: Consumption {
                model_turns: 2,
                tool_calls: 1,
                client_tool_calls: 1,
                ..Default::default()
            },
            generation_metadata: None,
            allowed_tools: vec![tool::NAME.into()],
            model_id: "test".into(),
            origin_user_message_id: None,
            task_server_budget: Some(0),
            task_client_budget: Some(3),
        };
        let call = genai::chat::ToolCall {
            call_id: "call".into(),
            fn_name: tool::NAME.into(),
            fn_arguments: json!({"queryVariants":["query"]}),
            thought_signatures: None,
        };
        waiting_content(&mut checkpoint, &call, id);
        store::Resume {
            fence: store::Fence {
                job_id: id,
                generation_id: Uuid::new_v4(),
            },
            checkpoint,
            package: Some(
                json!({"exportId":"export","artifacts":[{"artifactId":"artifact","sha256":"digest","filename":"approved.txt","contentBase64":STANDARD.encode("APPROVED_SECRET")}]}),
            ),
            job: store::PendingJob {
                id,
                chat_id: Uuid::new_v4(),
                message_id: Uuid::new_v4(),
                tool_call_id: call.call_id,
                task_id: "task".into(),
                attempt_id: Uuid::new_v4(),
                plan: json!({"queryVariants":["query"]}),
                binding: None,
                origin: None,
                state: JobState::Continuing,
                receipt: Some("receipt".into()),
                server_outcome: None,
            },
        }
    }
    #[test]
    fn applied_result_survives_checkpoint_reload_without_duplicate_tool_responses_or_budget_reset()
    {
        let mut resume = resume_fixture();
        assert!(is_waiting(&resume.checkpoint.content));
        assert!(
            !serde_json::to_string(&resume.checkpoint)
                .unwrap()
                .contains("APPROVED_SECRET")
        );
        apply_result(&mut resume).unwrap();
        let saved = serde_json::to_value(&resume.checkpoint).unwrap();
        assert!(saved.to_string().contains("APPROVED_SECRET"));
        resume.checkpoint = serde_json::from_value(saved.clone()).unwrap();
        resume.package = None;
        apply_result(&mut resume).unwrap();
        assert_eq!(serde_json::to_value(&resume.checkpoint).unwrap(), saved);
        assert_eq!(resume.checkpoint.consumption.model_turns, 2);
        assert_eq!(resume.checkpoint.consumption.client_tool_calls, 1);
        assert!(!is_waiting(&resume.checkpoint.content));
    }
    #[test]
    fn waiting_marker_survives_later_parallel_tool_parts() {
        let mut resume = resume_fixture();
        resume
            .checkpoint
            .content
            .push(ContentPart::ToolUse(ToolUse {
                tool_call_id: "parallel-sibling".into(),
                tool_name: tool::NAME.into(),
                status: MessageToolCallStatus::Success,
                input: None,
                output: Some(json!({"status":"approved"})),
                progress_message: None,
                progress: None,
                total: None,
                started_at: None,
                ended_at: None,
            }));
        assert!(is_waiting(&resume.checkpoint.content));
    }

    #[test]
    fn server_cancel_does_not_apply_evidence_or_offer_another_collection() {
        let mut resume = resume_fixture();
        resume.job.server_outcome = Some(json!({"status":"cancelled"}));
        apply_result(&mut resume).unwrap();
        assert!(
            !serde_json::to_string(&resume.checkpoint)
                .unwrap()
                .contains("APPROVED_SECRET")
        );
        assert!(resume.checkpoint.allowed_tools.is_empty());
        assert!(resume.checkpoint.request.tools.is_none());
        assert_eq!(resume.checkpoint.consumption.tool_calls, 1);
    }
}
