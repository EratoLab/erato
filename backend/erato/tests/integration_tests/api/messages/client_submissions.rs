//! Exercise actual request preparation, SSE dispatch, REST feedback and persistence
//! with a deterministic provider. No paid inference or application-specific host.
use super::*;
use erato::config::ClientToolSubmissionConfig;
use erato::services::background_tasks::StreamingEvent;
use std::collections::HashSet;
use std::time::Duration;

async fn run_submission(
    pool: Pool<Postgres>,
    attempts: Vec<Vec<(&'static str, Value)>>,
    client_results: Vec<Value>,
    max_attempts: u32,
    timeout_ms: u64,
    native: bool,
) -> (Vec<Value>, Vec<Value>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let mut previous_id = None;
    for calls in attempts {
        let first_id = calls[0].0;
        let capture = recorder.clone();
        let previous = previous_id;
        mocks.mock(move |when, then| {
            let required = previous.into_iter().collect::<Vec<_>>();
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&required, &[first_id]))
                .matcher(capture);
            let calls = calls
                .into_iter()
                .map(|(id, input)| (id, "submit_draft", input))
                .collect::<Vec<_>>();
            mock_llm_sse_response(then, build_openai_tool_calls_streaming_response(&calls));
        });
        previous_id = Some(first_id);
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
    }
    config.client_tools.tools.insert("draft".into(), ClientToolConfig {
        name: "submit_draft".into(),
        description: "Validate and stage a draft for review. Call alone after reading.".into(),
        parameters: json!({"type":"object","properties":{"title":{"type":"string"}},"required":["title"],"additionalProperties":false}).to_string(),
        timeout_ms: Some(timeout_ms),
        submission: (max_attempts > 0).then_some(ClientToolSubmissionConfig { max_attempts, ..Default::default() }),
        ..Default::default()
    });
    config.facets.tool_call_allowlist = vec!["client/submit_draft".into()];
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let server = app_server(state.clone());
    let request_body = json!({"existing_chat_id":chat_id,"user_message":"Prepare a draft"});
    let submit = async {
        server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&request_body)
            .await
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
                        next_result = results.next();
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
    assert_eq!(requests[0]["tools"][0]["function"]["strict"], true);
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
    assert_eq!(requests[0]["tools"][0]["function"]["strict"], false);
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
    assert_eq!(requests[0]["tools"][0]["function"]["strict"], false);
    assert!(
        !events
            .iter()
            .any(|event| event["output"].get("submission").is_some())
    );
}
