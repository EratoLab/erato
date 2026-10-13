use super::attached::{next_call, serve, wait_park};
use super::*;
use erato::services::client_operations::transport;
use sea_orm::ConnectionTrait;

const READ: &str = "read_document_blocks";
const SUBMIT: &str = "submit_document_plan";

fn binding() -> ExecutorBinding {
    ExecutorBinding {
        host_context: Some(HostContext {
            kind: "word_document".into(),
            identity: "c".repeat(64),
        }),
        ..mailbox()
    }
}

fn interactive(base: &str, path: &str) -> reqwest::RequestBuilder {
    reqwest::Client::new()
        .post(format!("{base}{path}"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("Accept", "text/event-stream")
        .header("X-Erato-Client-Tools", format!("{READ},{SUBMIT}"))
        .header(
            "X-Erato-Executor",
            serde_json::to_string(&binding()).unwrap(),
        )
}

async fn setup_word(pool: Pool<Postgres>, sequence: &[&str]) -> Setup {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    for (i, name) in sequence.iter().enumerate() {
        let capture = recorder.clone();
        let name = name.to_string();
        mocks.mock(move |when, then| {
            let call = format!("word-call-{i}");
            let previous = (i > 0).then(|| format!("word-call-{}", i - 1));
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(
                    &previous.as_deref().into_iter().collect::<Vec<_>>(),
                    &[&call],
                ))
                .matcher(capture);
            mock_llm_sse_response(
                then,
                build_openai_tool_calls_streaming_response(&[(
                    &call,
                    &name,
                    json!({"snapshot":"capture"}),
                )]),
            );
        });
    }
    let (mut config, mock) = setup_mock_llm_server_with_mocks(mocks).await;
    config.client_tools.durable_operations_enabled = true;
    config.facets.tool_call_allowlist = vec!["word/*".into()];
    config.generation.max_tool_calls_per_message = 1;
    for name in [READ, SUBMIT] {
        config.client_tools.tools.insert(name.into(), ClientToolConfig {
            name: name.into(), namespace: Some("word".into()), description: name.into(),
            parameters: json!({"type":"object","properties":{"snapshot":{"type":"string"}},"required":["snapshot"],"additionalProperties":false}).to_string(),
            requires_client_registration: true,
            timeout_ms: Some(60_000),
            durable: (name == READ).then_some(erato::config::ClientToolDurableConfig {
                host_context: erato::config::ClientToolHostContext::WordDocument,
                result_schema: None, attempt_expiry_secs: 3600, claim_lease_secs: 120,
            }),
            submission: (name == SUBMIT).then_some(erato::config::ClientToolSubmissionConfig {
                max_attempts: 5, recovery_read_tools: vec!["word/read_document_blocks".into()], ..Default::default()
            }),
            ..Default::default()
        });
    }
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    Setup {
        state,
        _mock: mock,
        recorder,
        chat_id,
    }
}

async fn start(
    setup: &Setup,
    base: &str,
) -> impl futures::Stream<Item = Result<axum::body::Bytes, reqwest::Error>> + Unpin {
    let response = interactive(base, "/me/messages/submitstream")
        .json(&json!({"existing_chat_id":setup.chat_id,"user_message":"Edit this document"}))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    response.bytes_stream()
}

async fn settle(setup: &Setup, call: &(Uuid, String), payload: Value) -> Value {
    let response = post_live(&setup.state, setup.chat_id, call, payload, Some(&binding())).await;
    response.assert_status_ok();
    response.json()
}

async fn settle_read(setup: &Setup, request: &OperationRequest) {
    let payload = json!({"result":{"snapshot":"capture","blocks":[],"nextCursor":null}});
    assert_eq!(
        settle(
            setup,
            &(request.message_id, request.tool_call_id.clone()),
            payload.clone()
        )
        .await["stored"],
        true
    );
    assert_eq!(
        settle(
            setup,
            &(request.message_id, request.tool_call_id.clone()),
            payload
        )
        .await["stored"],
        true
    );
}

async fn attach(
    base: &str,
    request: &OperationRequest,
) -> impl futures::Stream<Item = Result<axum::body::Bytes, reqwest::Error>> + Unpin {
    let response = interactive(
        base,
        &format!("/me/client-operations/{}/continue", request.attempt_id),
    )
    .send()
    .await
    .unwrap();
    assert!(response.status().is_success());
    response.bytes_stream()
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn word_reads_and_live_submission_finish_in_one_continuation(pool: Pool<Postgres>) {
    let setup = setup_word(pool, &[READ, READ, SUBMIT]).await;
    // This scenario needs two ordinary reads before the separately reserved submission.
    let mut setup = setup;
    setup.state.config.generation.max_tool_calls_per_message = 2;
    let (base, server) = serve(&setup.state).await;
    let mut stream = start(&setup, &base).await;
    next_call(&mut stream).await;
    drop(stream);
    let request = wait_park(&setup, 1).await;
    let mut wrong = binding();
    wrong.host_context.as_mut().unwrap().identity = "d".repeat(64);
    post_live(
        &setup.state,
        setup.chat_id,
        &(request.message_id, request.tool_call_id.clone()),
        json!({"result":{}}),
        Some(&wrong),
    )
    .await
    .assert_status(axum::http::StatusCode::CONFLICT);
    settle_read(&setup, &request).await;
    let mut stream = attach(&base, &request).await;
    let call = next_call(&mut stream).await;
    assert!(call.1.ends_with("word-call-1"));
    assert_eq!(
        settle(&setup, &call, json!({"result":{"blocks":[]}})).await["stored"],
        false
    );
    let call = next_call(&mut stream).await;
    assert!(call.1.ends_with("word-call-2"));
    settle(&setup, &call, json!({"result":{"draft_id":"draft"}})).await;
    wait_completed(&setup.state, request.attempt_id).await;
    let message = assistant_message(&setup).await;
    assert_eq!(
        message.generation_metadata.unwrap()["submission_outcome"]["status"],
        "accepted"
    );
    assert_eq!(
        message.generation_parameters.unwrap()["turn_consumption"]["tool_charges"]
            .as_object()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(chat_attempts(&setup.state, setup.chat_id).await.len(), 1);
    assert_eq!(turn_requests(&setup.recorder).len(), 3);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn live_submission_without_owner_fails_before_dispatch(pool: Pool<Postgres>) {
    let setup = setup_word(pool, &[READ, SUBMIT]).await;
    let (base, server) = serve(&setup.state).await;
    let mut stream = start(&setup, &base).await;
    next_call(&mut stream).await;
    drop(stream);
    let request = wait_park(&setup, 1).await;
    settle_read(&setup, &request).await;
    let response = app_server(setup.state.clone())
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    tokio::time::timeout(
        Duration::from_secs(5),
        wait_completed(&setup.state, request.attempt_id),
    )
    .await
    .unwrap();
    let message = assistant_message(&setup).await;
    assert_eq!(
        message.generation_metadata.unwrap()["submission_outcome"]["reason"],
        "context_unavailable"
    );
    assert_eq!(chat_attempts(&setup.state, setup.chat_id).await.len(), 1);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn owner_lost_while_live_submission_waits_fails_after_reconnect_grace(pool: Pool<Postgres>) {
    let setup = setup_word(pool, &[READ, SUBMIT]).await;
    let (base, server) = serve(&setup.state).await;
    let mut stream = start(&setup, &base).await;
    next_call(&mut stream).await;
    drop(stream);
    let request = wait_park(&setup, 1).await;
    settle_read(&setup, &request).await;
    let mut stream = attach(&base, &request).await;
    let call = next_call(&mut stream).await;
    assert!(call.1.ends_with("word-call-1"));
    drop(stream);
    assert!(
        tokio::time::timeout(
            Duration::from_secs(2),
            wait_completed(&setup.state, request.attempt_id),
        )
        .await
        .is_err()
    );
    tokio::time::timeout(
        Duration::from_secs(20),
        wait_completed(&setup.state, request.attempt_id),
    )
    .await
    .unwrap();
    let outcome =
        assistant_message(&setup).await.generation_metadata.unwrap()["submission_outcome"].clone();
    assert_eq!(outcome["status"], "unresolved");
    assert_eq!(outcome["reason"], "context_unavailable");
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn live_submission_survives_reconnect_after_owner_release(pool: Pool<Postgres>) {
    reconnect_live_submission(pool, false).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn live_submission_survives_reconnect_before_owner_release(pool: Pool<Postgres>) {
    reconnect_live_submission(pool, true).await;
}

async fn reconnect_live_submission(pool: Pool<Postgres>, resume_first: bool) {
    let setup = setup_word(pool.clone(), &[READ, SUBMIT]).await;
    let replica = test_app_state(setup.state.config.clone(), pool).await;
    let (base, server) = serve(&setup.state).await;
    let (remote, remote_server) = serve(&replica).await;
    let mut stream = start(&setup, &base).await;
    next_call(&mut stream).await;
    drop(stream);
    let request = wait_park(&setup, 1).await;
    settle_read(&setup, &request).await;
    let mut stream = attach(&base, &request).await;
    let call = next_call(&mut stream).await;
    let task = setup
        .state
        .background_tasks
        .get_task(&setup.chat_id)
        .await
        .unwrap();
    let old_owner = transport::owner(&setup.state.db, task.generation_id)
        .await
        .unwrap();
    let resume = || {
        interactive(&remote, "/me/messages/resumestream")
            .json(&json!({"chat_id": setup.chat_id}))
            .send()
    };
    let mut resumed = None;
    if resume_first {
        resumed = Some(
            resume()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .bytes_stream(),
        );
        assert_eq!(
            transport::owner(&setup.state.db, task.generation_id)
                .await
                .unwrap(),
            old_owner
        );
    }
    drop(stream);
    if !resume_first {
        tokio::time::timeout(Duration::from_secs(3), async {
            while transport::owner(&setup.state.db, task.generation_id)
                .await
                .unwrap()
                != Some(None)
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        // The previous 100 ms disconnect poll would have discarded the waiter.
        tokio::time::sleep(Duration::from_millis(1200)).await;
        assert!(!task.is_completed());
        resumed = Some(
            resume()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .bytes_stream(),
        );
    }
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let owner = transport::owner(&setup.state.db, task.generation_id)
                .await
                .unwrap();
            if matches!(owner, Some(Some(_))) && owner != old_owner {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("resume promptly takes the released lease");
    let response = post_live(
        &replica,
        setup.chat_id,
        &call,
        json!({"result":{"draft_id":"original-draft"}}),
        Some(&binding()),
    )
    .await;
    response.assert_status_ok();
    assert_eq!(response.json::<Value>()["delivered"], true);
    wait_completed(&setup.state, request.attempt_id).await;
    let message = assistant_message(&setup).await;
    assert_eq!(
        message.generation_metadata.unwrap()["submission_outcome"]["status"],
        "accepted"
    );
    assert!(message.raw_message.to_string().contains("original-draft"));
    assert_eq!(
        message.generation_parameters.unwrap()["turn_consumption"]["tool_charges"]
            .as_object()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(chat_attempts(&setup.state, setup.chat_id).await.len(), 1);
    assert_eq!(turn_requests(&setup.recorder).len(), 2);
    drop(resumed);
    server.abort();
    remote_server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn missing_owner_does_not_overwrite_submission_schema_refusal(pool: Pool<Postgres>) {
    let mut setup = setup_word(pool, &[READ, SUBMIT, SUBMIT, SUBMIT, SUBMIT, SUBMIT]).await;
    setup.state.config.client_tools.tools.get_mut(SUBMIT).unwrap().parameters =
        json!({"type":"object","properties":{"snapshot":{"type":"integer"}},"required":["snapshot"],"additionalProperties":false}).to_string();
    let (base, server) = serve(&setup.state).await;
    let mut stream = start(&setup, &base).await;
    next_call(&mut stream).await;
    drop(stream);
    let request = wait_park(&setup, 1).await;
    settle_read(&setup, &request).await;
    app_server(setup.state.clone())
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(&setup.state, request.attempt_id).await;
    let message = assistant_message(&setup).await;
    let outcome = &message.generation_metadata.unwrap()["submission_outcome"];
    assert_eq!(outcome["reason"], "attempts_exhausted");
    assert_eq!(outcome["attempts_used"], 5);
    assert!(
        message
            .raw_message
            .to_string()
            .contains("validation_errors")
    );
    assert!(
        !message
            .raw_message
            .to_string()
            .contains("context_unavailable")
    );
    assert_eq!(turn_requests(&setup.recorder).len(), 6);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn expired_recovery_read_reports_timeout(pool: Pool<Postgres>) {
    let setup = setup_word(pool, &[SUBMIT, READ, SUBMIT]).await;
    let (base, server) = serve(&setup.state).await;
    let mut stream = start(&setup, &base).await;
    let first = next_call(&mut stream).await;
    settle(&setup, &first, json!({"validation_errors":[{"path":"/snapshot","code":"repair","message":"Read again"}],"submission_feedback":{"recovery":"read_current_context"}})).await;
    next_call(&mut stream).await;
    drop(stream);
    let request = wait_park(&setup, 1).await;
    setup
        .state
        .db
        .execute_unprepared(
            "UPDATE client_operation_attempts SET expires_at = now() - interval '1 second'",
        )
        .await
        .unwrap();
    app_server(setup.state.clone())
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(&setup.state, request.attempt_id).await;
    let message = assistant_message(&setup).await;
    assert_eq!(
        message.generation_metadata.unwrap()["submission_outcome"]["reason"],
        "timeout"
    );
    assert_eq!(turn_requests(&setup.recorder).len(), 2);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn recovery_read_park_preserves_five_attempt_limit(pool: Pool<Postgres>) {
    let setup = setup_word(
        pool,
        &[SUBMIT, READ, SUBMIT, SUBMIT, SUBMIT, SUBMIT, SUBMIT],
    )
    .await;
    let (base, server) = serve(&setup.state).await;
    let mut stream = start(&setup, &base).await;
    let first = next_call(&mut stream).await;
    let reject = |recovery| json!({"validation_errors":[{"path":"/snapshot","code":"repair","message":"Repair the plan"}],"submission_feedback":{"recovery":recovery}});
    settle(&setup, &first, reject("read_current_context")).await;
    next_call(&mut stream).await;
    drop(stream);
    let request = wait_park(&setup, 1).await;
    let parameters = assistant_message(&setup)
        .await
        .generation_parameters
        .unwrap();
    assert_eq!(
        parameters["turn_consumption"]["submission_correction"]["outcome"]["attempts_used"],
        1
    );
    assert_eq!(
        parameters["turn_consumption"]["submission_correction"]["recovery_reads_used"],
        1
    );
    settle_read(&setup, &request).await;
    let mut stream = attach(&base, &request).await;
    for index in 2..=5 {
        let call = next_call(&mut stream).await;
        assert!(call.1.ends_with(&format!("word-call-{index}")));
        settle(&setup, &call, reject("repair_arguments")).await;
    }
    wait_completed(&setup.state, request.attempt_id).await;
    let message = assistant_message(&setup).await;
    let outcome = &message.generation_metadata.unwrap()["submission_outcome"];
    assert_eq!(outcome["reason"], "attempts_exhausted");
    assert_eq!(outcome["attempts_used"], 5);
    let parameters = message.generation_parameters.unwrap();
    assert_eq!(
        parameters["turn_consumption"]["submission_correction"]["recovery_reads_used"],
        1
    );
    assert_eq!(
        parameters["turn_consumption"]["tool_charges"]
            .as_object()
            .unwrap()
            .len(),
        6
    );
    assert_eq!(turn_requests(&setup.recorder).len(), 6);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn lost_capture_on_parked_recovery_read_ends_correction(pool: Pool<Postgres>) {
    let setup = setup_word(pool, &[SUBMIT, READ, SUBMIT]).await;
    let (base, server) = serve(&setup.state).await;
    let mut stream = start(&setup, &base).await;
    let first = next_call(&mut stream).await;
    settle(&setup, &first, json!({"validation_errors":[{"path":"/snapshot","code":"repair","message":"Read again"}],"submission_feedback":{"recovery":"read_current_context"}})).await;
    next_call(&mut stream).await;
    drop(stream);
    let request = wait_park(&setup, 1).await;
    let rejection = json!({"validation_errors":[{"path":"/snapshot","code":"capture-unavailable","message":"Capture lost"}],"submission_feedback":{"terminal":true,"recovery":"cannot_continue"}});
    let server_api = app_server(setup.state.clone());
    let claim = server_api
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/claim",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", READ)
        .add_header(
            "X-Erato-Executor",
            serde_json::to_string(&binding()).unwrap(),
        )
        .json(&json!({"binding":binding(), "user_confirmed":false}))
        .await;
    claim.assert_status_ok();
    let result = from_fast_result(
        &request,
        erato::services::client_tools::ClientToolOutcome::from_payload(&rejection),
    )
    .unwrap();
    server_api
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/result",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", READ)
        .add_header(
            "X-Erato-Executor",
            serde_json::to_string(&binding()).unwrap(),
        )
        .json(&json!({"claim_token":claim.json::<Value>()["claim_token"], "result":result}))
        .await
        .assert_status_ok();
    let _stream = attach(&base, &request).await;
    wait_completed(&setup.state, request.attempt_id).await;
    let message = assistant_message(&setup).await;
    assert_eq!(
        message.generation_metadata.unwrap()["submission_outcome"]["reason"],
        "context_unavailable"
    );
    assert!(
        message
            .raw_message
            .to_string()
            .contains("capture-unavailable")
    );
    assert_eq!(turn_requests(&setup.recorder).len(), 2);
    server.abort();
}
