//! Exercise actual request preparation, SSE dispatch, REST feedback and persistence
//! with a deterministic provider. No paid inference or application-specific host.
use super::*;
use erato::config::ClientToolSubmissionConfig;
use erato::services::background_tasks::StreamingEvent;
use std::collections::HashSet;
use std::time::Duration;

fn submission(id: &'static str, title: Value) -> ModelStep {
    ModelStep::Tools(vec![(id, "submit_draft", json!({"title":title}))])
}

fn rejected(recovery: &str) -> Value {
    json!({"validation_errors":[{"path":"/title","code":"parser_rejection","message":"Correct the proposal"}],"submission_feedback":{"recovery":recovery}})
}

fn final_outcome(events: &[Value]) -> &Value {
    &events
        .iter()
        .rev()
        .find(|event| event["message_type"] == "assistant_message_completed")
        .unwrap()["message"]["submission_outcome"]
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn exhausted_ordinary_budget_preserves_all_five_submission_attempts(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            ModelStep::Tools(vec![(
                "call_854_work",
                "unrelated_work",
                json!({"title":"call_854_work"}),
            )]),
            submission("call_854_one", json!(1)),
            submission("call_854_two", json!(2)),
            submission("call_854_three", json!(3)),
            submission("call_854_four", json!(4)),
            submission("call_854_five", json!("valid")),
        ],
        vec![
            json!({"result":{}}),
            json!({"result":{"draft_id":"only-receipt"}}),
        ],
        ScenarioOptions {
            ordinary_budget: 1,
            duplicate_results: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(requests.len(), 6);
    assert_eq!(
        final_outcome(&events),
        &json!({"status":"accepted","attempts_used":5,"max_attempts":5})
    );
    assert!(
        !events
            .iter()
            .any(|event| event.to_string().contains("tool_call_limit"))
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn prose_during_correction_is_charged_and_cannot_silently_complete(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!(1)),
            ModelStep::Text("PROSE_WITHOUT_PROPOSAL"),
            submission("call_854_corrected", json!("valid")),
        ],
        vec![json!({"result":{"draft_id":"call_854_corrected"}})],
        ScenarioOptions::default(),
    )
    .await;
    assert_eq!(requests.len(), 3);
    assert_eq!(final_outcome(&events)["status"], "accepted");
    assert_eq!(final_outcome(&events)["attempts_used"], 3);
    assert!(
        requests[2]
            .to_string()
            .contains("3 of 5 total attempts remain")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn repeated_prose_ends_with_explicit_exhaustion(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!(1)),
            ModelStep::Text("FIRST_PROSE"),
            ModelStep::Text("SECOND_PROSE"),
            ModelStep::Text("THIRD_PROSE"),
            ModelStep::Text("FOURTH_PROSE"),
        ],
        vec![],
        ScenarioOptions::default(),
    )
    .await;
    assert_eq!(requests.len(), 5);
    assert_eq!(final_outcome(&events)["status"], "unresolved");
    assert_eq!(final_outcome(&events)["reason"], "attempts_exhausted");
    assert_eq!(final_outcome(&events)["attempts_used"], 5);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn sixth_submission_never_dispatches_or_extends_inference(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        [
            "call_854_one",
            "call_854_two",
            "call_854_three",
            "call_854_four",
            "call_854_five",
            "call_854_six",
        ]
        .into_iter()
        .map(|id| submission(id, json!(0)))
        .collect(),
        vec![],
        ScenarioOptions::default(),
    )
    .await;
    assert_eq!(requests.len(), 5);
    assert!(
        !events
            .iter()
            .any(|event| event["message_type"] == "client_tool_call")
    );
    assert_eq!(final_outcome(&events)["reason"], "attempts_exhausted");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn large_document_rejection_allows_scoped_reads_then_scoped_edit(pool: Pool<Postgres>) {
    let mut feedback = rejected("read_current_context");
    feedback["validation_errors"][0]["code"] = json!("too-large");
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_whole_plan", json!("whole document")),
            ModelStep::Tools(vec![(
                "call_854_page_one",
                "read_context",
                json!({"title":"section page one"}),
            )]),
            ModelStep::Tools(vec![(
                "call_854_page_two",
                "read_context",
                json!({"title":"section page two"}),
            )]),
            submission("call_854_scoped_edit", json!("scoped edit")),
        ],
        vec![
            feedback,
            json!({"result":{"readToken":"page-1"}}),
            json!({"result":{"readToken":"scope-2"}}),
            json!({"result":{"draft_id":"scoped"}}),
        ],
        ScenarioOptions {
            ordinary_budget: 0,
            duplicate_results: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(requests.len(), 4);
    assert_eq!(final_outcome(&events)["status"], "accepted");
    assert_eq!(final_outcome(&events)["attempts_used"], 2);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn recovery_read_loop_has_an_independent_finite_limit(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!("draft")),
            ModelStep::Tools(vec![(
                "call_854_read_one",
                "read_context",
                json!({"title":"page"}),
            )]),
            ModelStep::Tools(vec![(
                "call_854_read_two",
                "read_context",
                json!({"title":"page"}),
            )]),
        ],
        vec![rejected("read_current_context"), json!({"result":{}})],
        ScenarioOptions {
            ordinary_budget: 0,
            recovery_reads: 1,
            check_metadata: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(requests.len(), 3);
    assert_eq!(
        events
            .iter()
            .filter(|event| event["message_type"] == "client_tool_call")
            .count(),
        2
    );
    assert_eq!(final_outcome(&events)["reason"], "recovery_reads_exhausted");
}

async fn pending_budget_choice(pool: Pool<Postgres>, decision: &'static str, reason: &str) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!(1)),
            ModelStep::Tools(vec![(
                "call_854_unrelated",
                "unrelated_work",
                json!({"title":"ordinary work"}),
            )]),
        ],
        vec![],
        ScenarioOptions {
            ordinary_budget: 0,
            budget_decision: Some(decision),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(
        requests.len(),
        2,
        "terminal choices need no explanatory inference"
    );
    assert_eq!(final_outcome(&events)["status"], "unresolved");
    assert_eq!(final_outcome(&events)["reason"], reason);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn generate_answer_now_persists_unresolved(pool: Pool<Postgres>) {
    pending_budget_choice(pool, "reject", "user_requested_answer").await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn stop_at_budget_prompt_persists_unresolved(pool: Pool<Postgres>) {
    pending_budget_choice(pool, "withdraw", "user_stopped").await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn changing_tools_and_parallel_ids_does_not_mint_attempts(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_initial", json!(1)),
            ModelStep::Tools(vec![(
                "call_854_switched",
                "other_submission",
                json!({"title":"new id"}),
            )]),
            ModelStep::Tools(vec![
                ("call_854_a", "submit_draft", json!({"title":"call_854_a"})),
                (
                    "call_854_b",
                    "other_submission",
                    json!({"title":"call_854_b"}),
                ),
                ("call_854_c", "submit_draft", json!({"title":"call_854_c"})),
                (
                    "call_854_d",
                    "other_submission",
                    json!({"title":"call_854_d"}),
                ),
            ]),
        ],
        vec![],
        ScenarioOptions::default(),
    )
    .await;
    assert_eq!(requests.len(), 3);
    assert!(
        !events
            .iter()
            .any(|event| event["message_type"] == "client_tool_call")
    );
    assert_eq!(final_outcome(&events)["attempts_used"], 5);
    assert_eq!(final_outcome(&events)["reason"], "attempts_exhausted");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn correction_and_mixed_batch_charge_survive_task_approval(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_before_task", json!(1)),
            ModelStep::Tools(vec![
                (
                    "call_854_task",
                    "delegate_task",
                    json!({"task":"Research context","facet_ids":["plan"]}),
                ),
                (
                    "call_854_mixed",
                    "submit_draft",
                    json!({"title":"mixed batch"}),
                ),
            ]),
            submission("call_854_after_task", json!("valid")),
        ],
        vec![json!({"result":{"draft_id":"after-approval"}})],
        ScenarioOptions {
            task_approval: true,
            budget_decision: Some("reject"),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(requests.len(), 3);
    assert_eq!(final_outcome(&events)["status"], "accepted");
    assert_eq!(final_outcome(&events)["attempts_used"], 3);
    assert!(requests[2].to_string().contains("submission_must_be_alone"));
    assert_eq!(
        events
            .iter()
            .filter(|event| event["message_type"] == "client_tool_call")
            .count(),
        1
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn unavailable_capture_is_terminal_without_using_remaining_attempts(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![submission("call_854_unavailable", json!("draft"))],
        vec![rejected("cannot_continue")],
        ScenarioOptions::default(),
    )
    .await;
    assert_eq!(requests.len(), 1);
    assert_eq!(final_outcome(&events)["reason"], "context_unavailable");
    assert_eq!(final_outcome(&events)["attempts_used"], 1);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn empty_tool_list_during_correction_cannot_silently_complete(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!(1)),
            ModelStep::EmptyTools,
        ],
        vec![],
        ScenarioOptions {
            max_attempts: 2,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(requests.len(), 2);
    assert_eq!(final_outcome(&events)["reason"], "attempts_exhausted");
    assert_eq!(final_outcome(&events)["attempts_used"], 2);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn unavailable_recovery_context_stops_without_another_submission(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_plan", json!("draft")),
            ModelStep::Tools(vec![
                ("call_854_read", "read_context", json!({"title":"scope"})),
                (
                    "call_854_after_failure",
                    "unrelated_work",
                    json!({"title":"must not dispatch"}),
                ),
            ]),
        ],
        vec![
            rejected("read_current_context"),
            rejected("cannot_continue"),
        ],
        ScenarioOptions {
            ordinary_budget: 0,
            check_metadata: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(requests.len(), 2);
    assert_eq!(
        events
            .iter()
            .filter(|event| event["message_type"] == "client_tool_call")
            .count(),
        2
    );
    assert_eq!(final_outcome(&events)["reason"], "context_unavailable");
    assert_eq!(final_outcome(&events)["attempts_used"], 1);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn lost_host_capability_retains_an_unresolved_reason(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!(1)),
            submission("call_854_repaired", json!("draft")),
        ],
        vec![json!({"error":"The host capability is unavailable"})],
        ScenarioOptions::default(),
    )
    .await;
    assert_eq!(requests.len(), 2);
    assert_eq!(final_outcome(&events)["reason"], "capability_unavailable");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn provider_failure_during_correction_retains_an_unresolved_reason(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!(1)),
            ModelStep::ProviderFailure,
        ],
        vec![],
        ScenarioOptions::default(),
    )
    .await;
    assert_eq!(requests.len(), 2);
    assert_eq!(final_outcome(&events)["reason"], "provider_error");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn cancellation_during_correction_retains_an_unresolved_reason(pool: Pool<Postgres>) {
    let (_, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!(1)),
            submission("call_854_repaired", json!("draft")),
        ],
        vec![json!({"abort_test_generation":true})],
        ScenarioOptions::default(),
    )
    .await;
    assert_eq!(final_outcome(&events)["reason"], "cancelled");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn declared_reads_after_argument_rejection_preserve_submission_attempts(
    pool: Pool<Postgres>,
) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!(1)),
            ModelStep::Tools(vec![(
                "call_854_read_one",
                "read_context",
                json!({"title":"page one"}),
            )]),
            ModelStep::Tools(vec![(
                "call_854_read_two",
                "read_context",
                json!({"title":"page two"}),
            )]),
            submission("call_854_corrected", json!("valid")),
        ],
        vec![
            json!({"result":{}}),
            json!({"result":{}}),
            json!({"result":{"draft_id":"valid"}}),
        ],
        ScenarioOptions {
            max_attempts: 3,
            ordinary_budget: 2,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(requests.len(), 4);
    assert_eq!(final_outcome(&events)["status"], "accepted");
    assert_eq!(final_outcome(&events)["attempts_used"], 2);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn declared_reads_still_need_ordinary_budget_without_host_recovery_request(
    pool: Pool<Postgres>,
) {
    let (_, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!(1)),
            ModelStep::Tools(vec![(
                "call_854_read",
                "read_context",
                json!({"title":"page"}),
            )]),
        ],
        vec![],
        ScenarioOptions {
            ordinary_budget: 0,
            budget_decision: Some("reject"),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(final_outcome(&events)["reason"], "user_requested_answer");
    assert_eq!(final_outcome(&events)["attempts_used"], 1);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn recovery_read_timeout_preserves_generation_metadata(pool: Pool<Postgres>) {
    let (_, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!("draft")),
            ModelStep::Tools(vec![(
                "call_854_read",
                "read_context",
                json!({"title":"page"}),
            )]),
        ],
        vec![rejected("read_current_context")],
        ScenarioOptions {
            timeout_ms: 200,
            check_metadata: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(final_outcome(&events)["reason"], "timeout");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn responses_prose_retry_replays_reasoning_with_required_summary(pool: Pool<Postgres>) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!(1)),
            ModelStep::Text("PROSE_WITHOUT_PROPOSAL"),
            submission("call_854_corrected", json!("valid")),
        ],
        vec![json!({"result":{"draft_id":"valid"}})],
        ScenarioOptions {
            responses: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(requests.len(), 3);
    let reasoning = requests[2]["input"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["type"] == "reasoning")
        .collect::<Vec<_>>();
    assert_eq!(
        reasoning.len(),
        2,
        "bare signatures must not duplicate reasoning items"
    );
    for item in reasoning {
        assert_eq!(item["summary"], json!([{"type":"summary_text","text":""}]));
    }
    assert_eq!(final_outcome(&events)["status"], "accepted");
    assert_eq!(final_outcome(&events)["attempts_used"], 3);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn submission_withdrawn_at_approval_preserves_parked_generation_metadata(
    pool: Pool<Postgres>,
) {
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_invalid", json!(1)),
            ModelStep::Tools(vec![(
                "call_854_task",
                "delegate_task",
                json!({"task":"Research context","facet_ids":["plan"]}),
            )]),
        ],
        vec![],
        ScenarioOptions {
            task_approval: true,
            budget_decision: Some("reject"),
            check_metadata: true,
            withdraw_submission_on_approval: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(requests.len(), 2);
    assert_eq!(final_outcome(&events)["reason"], "capability_unavailable");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn denied_fifth_submission_stops_without_a_sixth_inference(pool: Pool<Postgres>) {
    let mut last_rejection = rejected("repair_arguments");
    last_rejection["deny_tool"] = json!("client/submit_draft");
    let (requests, events) = run_scenario(
        pool,
        [
            "call_854_one",
            "call_854_two",
            "call_854_three",
            "call_854_four",
            "call_854_five",
        ]
        .into_iter()
        .map(|id| submission(id, json!(id)))
        .collect(),
        vec![
            rejected("repair_arguments"),
            rejected("repair_arguments"),
            rejected("repair_arguments"),
            last_rejection,
        ],
        ScenarioOptions {
            ordinary_budget: 0,
            check_metadata: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(requests.len(), 5);
    assert_eq!(
        events
            .iter()
            .filter(|event| event["message_type"] == "client_tool_call")
            .count(),
        4
    );
    assert_eq!(final_outcome(&events)["reason"], "capability_unavailable");
    assert_eq!(final_outcome(&events)["attempts_used"], 5);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn denied_recovery_read_stops_correction_without_more_inference(pool: Pool<Postgres>) {
    let mut feedback = rejected("read_current_context");
    feedback["deny_tool"] = json!("client/read_context");
    let (requests, events) = run_scenario(
        pool,
        vec![
            submission("call_854_plan", json!("draft")),
            ModelStep::Tools(vec![(
                "call_854_read",
                "read_context",
                json!({"title":"page"}),
            )]),
        ],
        vec![feedback],
        ScenarioOptions {
            ordinary_budget: 0,
            check_metadata: true,
            ..Default::default()
        },
    )
    .await;
    assert_eq!(requests.len(), 2);
    assert_eq!(final_outcome(&events)["reason"], "capability_unavailable");
    assert_eq!(final_outcome(&events)["attempts_used"], 1);
}

async fn run_submission(
    pool: Pool<Postgres>,
    attempts: Vec<Vec<(&'static str, Value)>>,
    client_results: Vec<Value>,
    max_attempts: u32,
    timeout_ms: u64,
    native: bool,
) -> (Vec<Value>, Vec<Value>) {
    run_scenario(
        pool,
        attempts
            .into_iter()
            .map(|calls| {
                ModelStep::Tools(
                    calls
                        .into_iter()
                        .map(|(id, input)| (id, "submit_draft", input))
                        .collect(),
                )
            })
            .collect(),
        client_results,
        ScenarioOptions {
            max_attempts,
            timeout_ms,
            native,
            ..Default::default()
        },
    )
    .await
}

enum ModelStep {
    Tools(Vec<(&'static str, &'static str, Value)>),
    Text(&'static str),
    EmptyTools,
    ProviderFailure,
}

struct ScenarioOptions {
    max_attempts: u32,
    timeout_ms: u64,
    native: bool,
    ordinary_budget: u32,
    recovery_reads: u32,
    budget_decision: Option<&'static str>,
    duplicate_results: bool,
    task_approval: bool,
    responses: bool,
    check_metadata: bool,
    withdraw_submission_on_approval: bool,
}

impl Default for ScenarioOptions {
    fn default() -> Self {
        Self {
            max_attempts: 5,
            timeout_ms: 5_000,
            native: false,
            ordinary_budget: 10,
            recovery_reads: 4,
            budget_decision: None,
            duplicate_results: false,
            task_approval: false,
            responses: false,
            check_metadata: false,
            withdraw_submission_on_approval: false,
        }
    }
}

async fn run_scenario(
    pool: Pool<Postgres>,
    steps: Vec<ModelStep>,
    client_results: Vec<Value>,
    options: ScenarioOptions,
) -> (Vec<Value>, Vec<Value>) {
    let ScenarioOptions {
        max_attempts,
        timeout_ms,
        native,
        ordinary_budget,
        recovery_reads,
        budget_decision,
        duplicate_results,
        task_approval,
        responses,
        check_metadata,
        withdraw_submission_on_approval,
    } = options;
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let mut previous_id = None;
    for step in steps {
        let marker = match &step {
            ModelStep::Tools(calls) => calls[0].0,
            ModelStep::Text(text) => *text,
            ModelStep::EmptyTools => "EMPTY_TOOL_LIST",
            ModelStep::ProviderFailure => "PROVIDER_FAILURE",
        };
        let capture = recorder.clone();
        let previous = previous_id;
        mocks.mock(move |when, then| {
            let required = previous.into_iter().collect::<Vec<_>>();
            when.post()
                .path(if responses { "/v1/responses" } else { "/v1/chat/completions" })
                .matcher(BodyContainsMatcher::new(&required, &[marker]))
                .matcher(capture);
            if responses {
                let text_delta = match &step { ModelStep::Text(text) => Some(json!({"type":"response.output_text.delta","delta":text})), _ => None };
                let mut output = vec![json!({"type":"reasoning","id":format!("rs_{marker}"),"summary":[],"encrypted_content":format!("encrypted_{marker}")})];
                match step {
                    ModelStep::Tools(calls) => output.extend(calls.into_iter().map(|(id,name,args)| json!({"type":"function_call","call_id":id,"name":name,"arguments":args.to_string()}))),
                    ModelStep::Text(text) => output.push(json!({"type":"message","role":"assistant","content":[{"type":"output_text","text":text}]})),
                    _ => panic!("unsupported Responses fixture"),
                }
                let body = json!({"type":"response.completed","response":{"id":format!("resp_{marker}"),"model":"gpt-4o","output":output}});
                let mut actions = Vec::new();
                if let Some(delta) = text_delta { actions.push(BodyAction::Bytes(format!("data: {delta}\n\n").into())); }
                actions.push(BodyAction::Bytes(format!("data: {body}\n\n").into()));
                mock_llm_sse_response(then, actions);
                return;
            }
            let with_usage = |mut actions: Vec<BodyAction>| {
                if check_metadata {
                    let usage = json!({"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18,"completion_tokens_details":{"reasoning_tokens":3}}});
                    actions.insert(actions.len()-1, BodyAction::Bytes(format!("data: {usage}\n\n").into()));
                }
                actions
            };
            match step {
                ModelStep::Tools(calls) => {
                    mock_llm_sse_response(then, with_usage(build_openai_tool_calls_streaming_response(&calls)));
                }
                ModelStep::Text(text) => {
                    mock_llm_sse_response(then, build_openai_text_streaming_response(&[text]));
                }
                ModelStep::EmptyTools => {
                    mock_llm_sse_response(then, build_openai_tool_calls_streaming_response(&[]));
                }
                ModelStep::ProviderFailure => {
                    then.status(http::StatusCode::BAD_REQUEST).json(json!({"error":{"type":"invalid_request_error","message":"Context limit exceeded"}}));
                }
            }
        });
        previous_id = Some(marker);
    }
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[previous_id.unwrap()], &[]))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&["UNEXPECTED EXTRA INFERENCE"]),
        );
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    for provider in config
        .chat_providers
        .as_mut()
        .unwrap()
        .providers
        .values_mut()
    {
        provider.model_capabilities.supports_strict_tool_calling = native;
        if responses {
            provider.provider_kind = "openai_responses".into();
            provider.model_settings.reasoning_effort =
                Some(erato::config::ModelReasoningEffort::Medium);
            provider.model_capabilities.supports_reasoning_summary = true;
            provider
                .model_capabilities
                .supports_encrypted_reasoning_content = true;
        }
    }
    config.client_tools.tools.insert("draft".into(), ClientToolConfig {
        name: "submit_draft".into(),
        description: "Validate and stage a draft for review. Call alone after reading.".into(),
        parameters: json!({"type":"object","properties":{"title":{"type":"string"}},"required":["title"],"additionalProperties":false}).to_string(),
        timeout_ms: Some(timeout_ms),
        submission: (max_attempts > 0).then_some(ClientToolSubmissionConfig { max_attempts, max_recovery_reads: recovery_reads, recovery_read_tools: vec!["client/read_context".into()], ..Default::default() }),
        ..Default::default()
    });
    for name in ["read_context", "unrelated_work", "other_submission"] {
        let mut tool = config.client_tools.tools["draft"].clone();
        tool.name = name.into();
        if name != "other_submission" {
            tool.submission = None;
        }
        config.client_tools.tools.insert(name.into(), tool);
    }
    config.generation.max_tool_calls_per_message = ordinary_budget;
    config.facets.tool_call_allowlist = vec!["client/*".into()];
    if task_approval {
        config.delegation.tasks.enabled = true;
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Always;
        config.facets.facets.insert(
            "plan".into(),
            erato::config::FacetConfig {
                display_name: "Plan".into(),
                icon: None,
                additional_system_prompt: None,
                tool_call_allowlist: vec!["erato/delegate_task".into(), "client/*".into()],
                model_settings: Default::default(),
                disable_facet_prompt_template: true,
                hidden: false,
                hidden_always_active_for_platform: None,
                delegation: None,
                child_chat_provider: None,
                child_host_context: None,
            },
        );
    }
    if check_metadata {
        // test_app_state supplies an inactive tracing client, so no telemetry leaves the test.
        config.integrations.langfuse.enabled = true;
        config.integrations.langfuse.tracing_enabled = true;
    }
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let server = app_server(state.clone());
    let request_body = json!({"existing_chat_id":chat_id,"user_message":"Prepare a draft", "selected_facet_ids": if task_approval {vec!["plan"]} else {vec![]}});
    let submit = async {
        let response = server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&request_body)
            .await;
        response.assert_status_ok();
        if let Some(decision) = budget_decision {
            let rows = Messages::find()
                .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
                .all(&state.db)
                .await
                .unwrap();
            let row = rows
                .iter()
                .find(|row| {
                    row.raw_message.to_string().contains(if task_approval {
                        "tool_approval_request"
                    } else {
                        "tool_call_limit"
                    })
                })
                .expect("budget approval");
            let mut continuation_state = state.clone();
            if withdraw_submission_on_approval {
                continuation_state.config.client_tools.tools.remove("draft");
            }
            let continuation_server = app_server(continuation_state);
            let response = continuation_server
                .post("/api/v1beta/me/messages/continuestream")
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({"message_id":row.id,"decision":decision}))
                .await;
            if withdraw_submission_on_approval {
                let completed = Messages::find_by_id(row.id)
                    .one(&state.db)
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(
                    completed.generation_metadata.as_ref().unwrap()["langfuse_trace_id"],
                    row.generation_metadata.as_ref().unwrap()["langfuse_trace_id"]
                );
            }
            response
        } else {
            response
        }
    };
    let client = async {
        let mut results = client_results.into_iter();
        let mut next_result = results.next();
        let mut answered = HashSet::new();
        while next_result.is_some() {
            if let Some(task) = state.background_tasks.get_task(&chat_id).await {
                for event in task.get_event_history().await {
                    if let StreamingEvent::ClientToolCall {
                        message_id,
                        tool_call_id,
                        ..
                    } = event
                        && answered.insert(tool_call_id.clone())
                    {
                        let mut payload = next_result.take().expect("unexpected dispatch");
                        if let Some(tool) = payload.as_object_mut().unwrap().remove("deny_tool") {
                            server.put("/api/v1beta/me/profile/preferences")
                                .with_bearer_token(TEST_JWT_TOKEN)
                                .json(&json!({"client_tool_decisions":{tool.as_str().unwrap():"never_allow"}}))
                                .await.assert_status_ok();
                        }
                        if payload["abort_test_generation"] == true {
                            server
                                .post("/api/v1beta/me/messages/abortstream")
                                .with_bearer_token(TEST_JWT_TOKEN)
                                .json(&json!({"chat_id":chat_id}))
                                .await
                                .assert_status_ok();
                            return;
                        }
                        payload["chat_id"] = json!(chat_id);
                        payload["message_id"] = json!(message_id);
                        payload["tool_call_id"] = json!(tool_call_id);
                        let response = server
                            .post("/api/v1beta/me/messages/clienttoolresult")
                            .with_bearer_token(TEST_JWT_TOKEN)
                            .json(&payload)
                            .await;
                        response.assert_status_ok();
                        assert_eq!(response.json::<Value>()["delivered"], true);
                        if duplicate_results {
                            let duplicate = server
                                .post("/api/v1beta/me/messages/clienttoolresult")
                                .with_bearer_token(TEST_JWT_TOKEN)
                                .json(&payload)
                                .await;
                            if duplicate.status_code() == http::StatusCode::NOT_FOUND {
                                // Live-only results retire with the completed task; redelivery
                                // then returns 404, after the accepted receipt is persisted.
                                assert_eq!(
                                    duplicate.text(),
                                    "No active generation task found for this chat"
                                );
                                let completed = Messages::find_by_id(message_id)
                                    .one(&state.db)
                                    .await
                                    .unwrap()
                                    .unwrap();
                                assert_eq!(
                                    completed.generation_metadata.unwrap()["submission_outcome"]["status"],
                                    "accepted"
                                );
                            } else {
                                duplicate.assert_status_ok();
                                assert_eq!(duplicate.json::<Value>()["delivered"], false);
                            }
                        }
                        next_result = results.next();
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    let reconnect = async {
        if !duplicate_results {
            return None;
        }
        while state.background_tasks.get_task(&chat_id).await.is_none() {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        Some(
            server
                .post("/api/v1beta/me/messages/resumestream")
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({"chat_id":chat_id}))
                .await,
        )
    };
    let (response, (), reconnected) = tokio::time::timeout(Duration::from_secs(30), async {
        tokio::join!(submit, client, reconnect)
    })
    .await
    .expect("submission loop did not finish");
    response.assert_status_ok();
    let events = parse_sse_events(&response)
        .into_iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .collect::<Vec<_>>();
    assert!(
        events
            .iter()
            .any(|event| event["message_type"] == "assistant_message_completed"),
        "{events:?}"
    );
    if let Some(reconnected) = reconnected {
        reconnected.assert_status_ok();
        let replay = parse_sse_events(&reconnected)
            .into_iter()
            .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
            .collect::<Vec<_>>();
        assert_eq!(final_outcome(&replay), final_outcome(&events));
        assert_eq!(
            replay
                .iter()
                .filter(|event| event["output"]["submission"]["status"] == "accepted")
                .count(),
            1
        );
    }
    let rows = Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
        .all(&state.db)
        .await
        .unwrap();
    if max_attempts > 0 {
        assert!(
            rows.iter()
                .any(|row| row.raw_message.to_string().contains("submission")),
            "submission result must persist"
        );
    }
    let completion = events
        .iter()
        .find(|event| event["message_type"] == "assistant_message_completed")
        .unwrap();
    let message_id = completion["message_id"].as_str().unwrap();
    let saved = rows
        .iter()
        .find(|row| row.id.to_string() == message_id)
        .unwrap();
    if check_metadata {
        let requests = recorder
            .bodies()
            .iter()
            .filter(|body| body.contains("\"tools\""))
            .count();
        let metadata = saved.generation_metadata.as_ref().unwrap();
        assert_eq!(metadata["used_prompt_tokens"], json!(11 * requests));
        assert_eq!(metadata["used_completion_tokens"], json!(7 * requests));
        assert_eq!(metadata["used_total_tokens"], json!(18 * requests));
        assert_eq!(metadata["used_reasoning_tokens"], json!(3 * requests));
        assert!(!metadata["langfuse_trace_id"].as_str().unwrap().is_empty());
    }
    let saved_outcome =
        &saved.generation_metadata.as_ref().unwrap_or(&Value::Null)["submission_outcome"];
    assert_eq!(&completion["message"]["submission_outcome"], saved_outcome);
    let history = server
        .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    history.assert_status_ok();
    let history: Value = history.json();
    let reloaded = history["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == message_id)
        .unwrap();
    assert_eq!(&reloaded["submission_outcome"], saved_outcome);
    (
        recorder
            .bodies()
            .iter()
            .map(|body| serde_json::from_str::<Value>(body).unwrap())
            // Chat-title generation is independent of the tool loop and also
            // uses this mock endpoint. Count every tool-enabled inference,
            // including an unwanted continuation after an accepted draft.
            .filter(|body| body.get("tools").is_some())
            .collect(),
        events,
    )
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn schema_then_parser_repair_stops_after_acceptance(pool: Pool<Postgres>) {
    let (requests, events) = run_submission(pool, vec![
        vec![("call_schema", json!({"title":123}))],
        vec![("call_parser", json!({"title":"Unknown reference"}))],
        vec![("call_accept", json!({"title":"Valid draft"}))],
    ], vec![
        json!({"error":"Invalid draft","validation_errors":[{"path":"/title","code":"unknown_reference","message":"Use a known reference"}]}),
        json!({"result":{"draft_id":"draft-1"}}),
    ], 3, 5_000, true).await;
    assert_eq!(requests.len(), 3, "no fourth inference after acceptance");
    assert_eq!(
        requests[0]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["function"]["name"] == "submit_draft")
            .unwrap()["function"]["strict"],
        true
    );
    assert!(requests[1].to_string().contains("validation_errors"));
    assert!(requests[2].to_string().contains("unknown_reference"));
    let calls = events
        .iter()
        .filter(|event| event["message_type"] == "client_tool_call")
        .collect::<Vec<_>>();
    assert_eq!(calls.len(), 2, "invalid schema never reaches the client");
    assert!(
        events
            .iter()
            .any(|event| event["output"]["submission"]["status"] == "accepted")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn local_validation_stops_at_attempt_limit(pool: Pool<Postgres>) {
    let (requests, events) = run_submission(
        pool,
        vec![
            vec![("call_one", json!({"title":1}))],
            vec![("call_two", json!({"title":2}))],
        ],
        vec![],
        2,
        5_000,
        false,
    )
    .await;
    assert_eq!(requests.len(), 2);
    assert_eq!(
        requests[0]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["function"]["name"] == "submit_draft")
            .unwrap()["function"]["strict"],
        false
    );
    assert!(
        !events
            .iter()
            .any(|event| event["message_type"] == "client_tool_call")
    );
    assert!(
        events.iter().any(|event| event["output"]["submission"]
            == json!({"status":"failed","attempts_remaining":0}))
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn correction_handle_reaches_model_and_terminal_rejection_stops_early(pool: Pool<Postgres>) {
    let issues =
        json!([{"path":"/title","code":"invalid_title","message":"Title requires correction"}]);
    let (requests, events) = run_submission(pool, vec![
        vec![("call_initial", json!({"title":"Rejected"}))],
        vec![("call_repeated", json!({"title":"Rejected"}))],
    ], vec![
        json!({"validation_errors":issues,"submission_feedback":{"draft":{"id":"draft-1","revision":1},"terminal":false}}),
        json!({"validation_errors":issues,"submission_feedback":{"draft":{"id":"draft-1","revision":1},"terminal":true}}),
    ], 3, 5_000, false).await;
    assert_eq!(
        requests.len(),
        2,
        "terminal rejection must not consume the remaining attempt"
    );
    assert!(requests[1].to_string().contains("draft-1"));
    assert!(events.iter().any(|event| event["output"]["submission"]
        == json!({"status":"failed","attempts_remaining":0})
        && event["output"]["submission_feedback"]["terminal"] == true));
    assert!(
        !events
            .iter()
            .any(|event| event["output"]["submission"]["status"] == "accepted")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn parallel_submissions_never_stage_two_drafts(pool: Pool<Postgres>) {
    let (requests, events) = run_submission(
        pool,
        vec![vec![
            ("call_a", json!({"title":"A"})),
            ("call_b", json!({"title":"B"})),
        ]],
        vec![],
        2,
        5_000,
        false,
    )
    .await;
    assert_eq!(requests.len(), 1);
    assert!(
        !events
            .iter()
            .any(|event| event["message_type"] == "client_tool_call")
    );
    assert!(
        events
            .iter()
            .any(|event| event["output"]["validation_errors"][0]["code"]
                == "submission_must_be_alone")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn timed_out_submission_finishes_without_retrying_the_host(pool: Pool<Postgres>) {
    let (requests, events) = run_submission(
        pool,
        vec![vec![("call_timeout", json!({"title":"Draft"}))]],
        vec![],
        3,
        20,
        false,
    )
    .await;
    assert_eq!(requests.len(), 1);
    assert_eq!(final_outcome(&events)["reason"], "timeout");
    assert!(
        events
            .iter()
            .any(|event| event["output"]["reason"] == "timeout"
                && event["output"]["submission"]["status"] == "failed")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn ordinary_client_tools_still_continue_after_success(pool: Pool<Postgres>) {
    let (requests, events) = run_submission(
        pool,
        vec![vec![("call_read", json!({"title":"Read input"}))]],
        vec![json!({"result":{"available":true}})],
        0,
        5_000,
        true,
    )
    .await;
    assert_eq!(
        requests.len(),
        2,
        "ordinary read tools still resume inference"
    );
    assert_eq!(
        requests[0]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["function"]["name"] == "submit_draft")
            .unwrap()["function"]["strict"],
        false
    );
    assert!(
        !events
            .iter()
            .any(|event| event["output"].get("submission").is_some())
    );
}

/// Client files must survive the full tool loop, completion SSE and persisted
/// history; a JSON-only reference cannot drive the attachment renderer.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn client_tool_attachments_are_linked_streamed_and_persisted(pool: Pool<Postgres>) {
    use axum_test::multipart::{MultipartForm, Part};

    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &["call_files"]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_files",
                "retrieve_files",
                json!({}),
            )]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["call_files"], &[]));
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&["Retrieved your files."]),
        );
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    // This test verifies that client tools can attach image bytes even when
    // the mock model itself does not support image understanding.
    config.file_uploads.upload_allowed_if_supports =
        vec![erato::config::FileUploadOperationSelector::Any];
    config.client_tools.tools.insert(
        "files".into(),
        ClientToolConfig {
            name: "retrieve_files".into(),
            parameters: json!({"type":"object","properties":{}}).to_string(),
            ..Default::default()
        },
    );
    config.facets.tool_call_allowlist = vec!["client/retrieve_files".into()];
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let server = app_server(state.clone());
    // Standalone uploads exercise creation of the chat association. Include a
    // document that parses, one that cannot parse, and an image.
    let mut ids = Vec::new();
    for (name, mime, bytes) in [
        ("note.txt", "text/plain", b"ATTACHMENT TEXT".to_vec()),
        ("broken.pdf", "application/pdf", b"not a valid PDF".to_vec()),
        (
            "image.png",
            "image/png",
            read_integration_test_file_bytes("image_1.png"),
        ),
    ] {
        let upload_url = if name == "note.txt" {
            format!("/api/v1beta/me/files?chat_id={chat_id}")
        } else {
            "/api/v1beta/me/files".to_string()
        };
        let uploaded = server
            .post(&upload_url)
            .with_bearer_token(TEST_JWT_TOKEN)
            .multipart(
                MultipartForm::new()
                    .add_part("file", Part::bytes(bytes).file_name(name).mime_type(mime)),
            )
            .await;
        uploaded.assert_status_ok();
        ids.push(
            uploaded.json::<Value>()["files"][0]["id"]
                .as_str()
                .unwrap()
                .to_string(),
        );
    }
    let request = json!({"existing_chat_id":chat_id,"user_message":"Retrieve the files"});
    let submit = async {
        server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&request)
            .await
    };
    let client = async {
        loop {
            if let Some(task) = state.background_tasks.get_task(&chat_id).await {
                for event in task.get_event_history().await {
                    if let StreamingEvent::ClientToolCall {
                        message_id,
                        tool_call_id,
                        ..
                    } = event
                    {
                        let response = server.post("/api/v1beta/me/messages/clienttoolresult")
                            .with_bearer_token(TEST_JWT_TOKEN)
                            .json(&json!({
                                "chat_id": chat_id, "message_id": message_id, "tool_call_id": tool_call_id,
                                "result": null,
                                "file_upload_ids": [ids[0], ids[1], ids[2], ids[0]],
                            })).await;
                        response.assert_status_ok();
                        assert_eq!(response.json::<Value>()["delivered"], true);
                        return;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    let (response, ()) = tokio::time::timeout(Duration::from_secs(30), async {
        tokio::join!(submit, client)
    })
    .await
    .expect("file tool loop did not finish");
    response.assert_status_ok();
    let events: Vec<Value> = parse_sse_events(&response)
        .into_iter()
        .filter_map(|event| serde_json::from_str(&event.data).ok())
        .collect();
    let completed = events
        .iter()
        .find(|event| event["message_type"] == "assistant_message_completed")
        .expect("completed event");
    let message_id = Uuid::parse_str(completed["message_id"].as_str().unwrap()).unwrap();
    let saved = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let listing = server
        .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    listing.assert_status_ok();
    let listing: Value = listing.json();
    let reloaded = listing["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["id"] == message_id.to_string())
        .unwrap();
    for content in [
        &completed["content"],
        &completed["message"]["content"],
        &saved.raw_message["content"],
        &reloaded["content"],
    ] {
        let parts = content.as_array().expect("message content");
        let pointers: Vec<_> = parts
            .iter()
            .filter(|part| part.get("file_upload_id").is_some())
            .collect();
        assert_eq!(pointers.len(), 3, "each file is attached once: {content}");
        for (index, id) in ids.iter().enumerate() {
            assert_eq!(pointers[index]["file_upload_id"], *id);
            assert_eq!(
                pointers[index]["content_type"],
                if index == 2 {
                    "image_file_pointer"
                } else {
                    "text_file_pointer"
                }
            );
        }
    }
    for id in ids {
        assert!(
            chat_file_uploads::Entity::find_by_id((chat_id, Uuid::parse_str(&id).unwrap()))
                .one(&state.db)
                .await
                .unwrap()
                .is_some()
        );
    }
}
