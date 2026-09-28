//! Real HTTP dispatch, logged attempts and a second AppState/replica. The
//! deterministic test kind is registered only here, never by production startup.
use super::*;
use erato::db::entity::client_operation_attempts::{self as attempts, AttemptState};
use erato::services::client_operations::{self as operations, *};
use serde::Deserialize;
use std::{sync::Arc, time::Duration};

struct DocumentPageKind;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {
    document_identity: String,
    page: u32,
    text: String,
}
impl OperationKind for DocumentPageKind {
    fn kind(&self) -> &'static str {
        "test.document-page.v1"
    }
    fn operation_id(&self) -> &'static str {
        "client/read_document_page"
    }
    fn realm(&self) -> ExecutionRealm {
        ExecutionRealm::OfficeAddin
    }
    fn consent(&self) -> ConsentPolicy {
        ConsentPolicy::None
    }
    fn allow_cross_device(&self) -> bool {
        true
    }
    fn validate_input(&self, input: &Value, binding: &ExecutorBinding) -> Result<(), String> {
        if input["page"].as_u64().is_some()
            && binding
                .host_context
                .as_ref()
                .is_some_and(|host| host.kind == "word" && host.identity == "doc-one")
        {
            Ok(())
        } else {
            Err("invalid input".into())
        }
    }
    fn validate_result(
        &self,
        request: &OperationRequest,
        result: &OperationResult,
    ) -> Result<ValidatedResult, String> {
        if result.outcome == OperationOutcome::Rejected
            && result.result.is_none()
            && result
                .error
                .as_ref()
                .is_some_and(|error| error.code == "validation_failed")
        {
            return Ok(ValidatedResult {
                succeeded: false,
                output: json!({"status":"error","error":"Validation failed"}),
            });
        }
        let Some(OperationValue::Value { value }) = &result.result else {
            return Err("page required".into());
        };
        let page: Page =
            serde_json::from_value(value.clone()).map_err(|_| "typed page required")?;
        if page.document_identity != "doc-one"
            || Some(page.page as u64) != request.input["page"].as_u64()
            || page.text.len() > 4096
        {
            return Err("page mismatch".into());
        }
        Ok(ValidatedResult {
            output: json!({"status":"success","result":value}),
            succeeded: true,
        })
    }
}
fn binding(device: &str) -> ExecutorBinding {
    ExecutorBinding {
        device_id: device.into(),
        realm: ExecutionRealm::OfficeAddin,
        host_context: Some(HostContext {
            kind: "word".into(),
            identity: "doc-one".into(),
        }),
    }
}
fn page_result(request: &OperationRequest, executor: ExecutorBinding) -> OperationResult {
    OperationResult {
        attempt_id: request.attempt_id,
        operation_id: request.operation_id.clone(),
        base_revision: request.base_revision,
        outcome: OperationOutcome::Succeeded,
        result: Some(OperationValue::Value {
            value: json!({"document_identity":"doc-one","page":1,"text":"approved page"}),
        }),
        error: None,
        executor,
    }
}
fn turn_requests(recorder: &RequestBodyRecorder) -> Vec<Value> {
    recorder
        .bodies()
        .iter()
        .map(|body| serde_json::from_str::<Value>(body).unwrap())
        // The existing title generator shares the mock endpoint, independently
        // of the turn. A missing tool offer on resume still fails the count.
        .filter(|body| body.get("tools").is_some())
        .collect()
}

async fn setup(
    pool: Pool<Postgres>,
    timeout_ms: u64,
) -> (
    erato::state::AppState,
    MockServer,
    RequestBodyRecorder,
    Uuid,
) {
    setup_with_second_submission(pool, timeout_ms, false).await
}

async fn setup_with_second_submission(
    pool: Pool<Postgres>,
    timeout_ms: u64,
    second_submission: bool,
) -> (
    erato::state::AppState,
    MockServer,
    RequestBodyRecorder,
    Uuid,
) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &["page-call"]))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "page-call",
                "read_document_page",
                json!({"page":1}),
            )]),
        );
    });
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["page-call"], &["page-call-2"]))
            .matcher(capture);
        if second_submission {
            mock_llm_sse_response(
                then,
                build_openai_tool_calls_streaming_response(&[(
                    "page-call-2",
                    "read_document_page",
                    json!({"page":1}),
                )]),
            );
        } else {
            mock_llm_sse_response(
                then,
                build_openai_text_streaming_response(&["I read the approved page."]),
            );
        }
    });
    let (mut config, mock) = setup_mock_llm_server_with_mocks(mocks).await;
    config.client_tools.durable_operations_enabled = true;
    config.client_tools.tools.insert("page".into(), ClientToolConfig {
        name: "read_document_page".into(), description: "Read one bound document page".into(),
        parameters: json!({"type":"object","properties":{"page":{"type":"integer"}},"required":["page"],"additionalProperties":false}).to_string(),
        timeout_ms: Some(timeout_ms), requires_client_registration: true, ..Default::default()
    });
    config.facets.tool_call_allowlist = vec!["client/read_document_page".into()];
    let mut state = test_app_state(config, pool).await;
    state
        .client_operations
        .register(Arc::new(DocumentPageKind))
        .unwrap();
    let chat_id = seed_origin_chat(&state.db).await;
    (state, mock, recorder, chat_id)
}
async fn park(state: &erato::state::AppState, chat_id: Uuid) -> OperationRequest {
    let server = app_server(state.clone());
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .add_header(
            "X-Erato-Executor",
            serde_json::to_string(&binding("device-one")).unwrap(),
        )
        .json(&json!({"existing_chat_id":chat_id,"user_message":"Read page one"}))
        .await;
    response.assert_status_ok();
    let rows = attempts::Entity::find().all(&state.db).await.unwrap();
    assert_eq!(rows.len(), 1, "timeout must become one logged operation");
    let request: OperationRequest = serde_json::from_value(rows[0].request.clone()).unwrap();
    if request.operation_id.starts_with("erato/") {
        assert!(
            !parse_sse_events(&response).iter().any(|event| {
                serde_json::from_str::<Value>(&event.data)
                    .is_ok_and(|value| value["message_type"] == "client_tool_call")
            }),
            "synthetic child operations must use account discovery, not SSE"
        );
    }

    let message = Messages::find_by_id(request.message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let parsed = erato::models::message::MessageSchema::validate(&message.raw_message).unwrap();
    assert_eq!(
        operations::pending(&parsed.content).unwrap().attempt_id,
        request.attempt_id
    );
    assert!(
        !message
            .raw_message
            .to_string()
            .contains("\"reason\":\"timeout\"")
    );
    let chat = chats::Entity::find_by_id(chat_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(chat.generation_state.as_deref(), Some("awaiting_approval"));
    request
}
async fn wait_completed(state: &erato::state::AppState, id: Uuid) {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            if attempts::Entity::find_by_id(id)
                .one(&state.db)
                .await
                .unwrap()
                .unwrap()
                .state
                == AttemptState::Completed
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("continuation did not complete");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn durable_timeout_claim_and_continue_on_another_replica(pool: Pool<Postgres>) {
    let (state, _mock, recorder, chat_id) = setup(pool.clone(), 10).await;
    let request = park(&state, chat_id).await;
    let mut replica = test_app_state(state.config.clone(), pool).await;
    replica.client_operations = state.client_operations.clone();
    let current = replica.config.client_tools.tools.get_mut("page").unwrap();
    current.description = "Updated page reader".into();
    current.timeout_ms = Some(15);
    assert!(replica.background_tasks.get_task(&chat_id).await.is_none());
    let server = app_server(replica.clone());
    let listed = server
        .get("/api/v1beta/me/client-operations")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    listed.assert_status_ok();
    assert_eq!(
        listed.json::<Value>()["operations"][0]["request"]["attempt_id"],
        request.attempt_id.to_string()
    );
    let claim_url = format!(
        "/api/v1beta/me/client-operations/{}/claim",
        request.attempt_id
    );
    let refused = server
        .post(&claim_url)
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&json!({"binding":binding("device-two"),"user_confirmed":false}))
        .await;
    refused.assert_status_conflict();
    let claimed = server
        .post(&claim_url)
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&json!({"binding":binding("device-two"),"user_confirmed":true}))
        .await;
    claimed.assert_status_ok();
    let token = claimed.json::<Value>()["claim_token"].clone();
    // Lost claim response: retry returns the same fence, not another executor.
    let retry = server
        .post(&claim_url)
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&json!({"binding":binding("device-two"),"user_confirmed":true}))
        .await;
    retry.assert_status_ok();
    assert_eq!(retry.json::<Value>()["claim_token"], token);
    let payload =
        json!({"claim_token":token,"result":page_result(&request, binding("device-two"))});
    let result_url = format!(
        "/api/v1beta/me/client-operations/{}/result",
        request.attempt_id
    );
    for _ in 0..2 {
        server
            .post(&result_url)
            .with_bearer_token(TEST_JWT_TOKEN)
            .add_header("X-Erato-Client-Tools", "read_document_page")
            .json(&payload)
            .await
            .assert_status_ok();
    }
    assert_eq!(
        attempts::Entity::find_by_id(request.attempt_id)
            .one(&replica.db)
            .await
            .unwrap()
            .unwrap()
            .state,
        AttemptState::Ready
    );
    use sea_orm::ConnectionTrait;
    replica.db.execute_unprepared("TRUNCATE temp_chat_generation_commands, temp_chat_generation_events, temp_chat_generations CASCADE").await.unwrap();
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(&replica, request.attempt_id).await;
    // Duplicate continue cannot produce another model call.
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    let message = Messages::find_by_id(request.message_id)
        .one(&replica.db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        message
            .raw_message
            .to_string()
            .contains("I read the approved page.")
    );
    assert!(
        !message
            .raw_message
            .to_string()
            .contains("client_tool_pending")
    );
    let requests = turn_requests(&recorder);
    assert_eq!(requests.len(), 2);
    let last = requests.last().unwrap();
    assert!(
        last["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["function"]["name"] == "read_document_page"),
        "original client tool must survive continuation"
    );
    assert!(last["tools"].to_string().contains("Updated page reader"));
    assert!(last["messages"].to_string().contains("approved page"));
    let params: GenerationParameters =
        serde_json::from_value(message.generation_parameters.unwrap()).unwrap();
    assert_eq!(params.turn_consumption.tool_calls, 1);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn durable_binding_and_typed_result_rejections(pool: Pool<Postgres>) {
    let (state, _mock, _recorder, chat_id) = setup(pool, 10).await;
    let request = park(&state, chat_id).await;
    let server = app_server(state.clone());
    let claim_url = format!(
        "/api/v1beta/me/client-operations/{}/claim",
        request.attempt_id
    );
    let mut wrong = binding("device-one");
    wrong.host_context.as_mut().unwrap().identity = "another-document".into();
    server
        .post(&claim_url)
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&json!({"binding":wrong}))
        .await
        .assert_status_conflict();
    server
        .post(&claim_url)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"binding":binding("device-one")}))
        .await
        .assert_status_conflict();
    let claim = server
        .post(&claim_url)
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&json!({"binding":binding("device-one")}))
        .await;
    claim.assert_status_ok();
    let token = claim.json::<Value>()["claim_token"].clone();
    let url = format!(
        "/api/v1beta/me/client-operations/{}/result",
        request.attempt_id
    );
    let mut result = serde_json::to_value(page_result(&request, binding("device-one"))).unwrap();
    result["result"]["value"]["secret"] = json!("SYNTHETIC_UNVALIDATED_MARKER");
    let response = server
        .post(&url)
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&json!({"claim_token":token,"result":result}))
        .await;
    response.assert_status_bad_request();
    assert!(!response.text().contains("SYNTHETIC_UNVALIDATED_MARKER"));
    let row = attempts::Entity::find_by_id(request.attempt_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert!(row.result.is_none());
    assert!(
        store::get(&state.db, Uuid::new_v4(), request.attempt_id)
            .await
            .is_err()
    );
    let mut wrong_result = page_result(&request, binding("device-one"));
    wrong_result.base_revision = Some(99);
    assert!(
        store::accept(
            &state.db,
            &state.client_operations,
            request.account_id,
            Some(serde_json::from_value(token).unwrap()),
            &wrong_result
        )
        .await
        .is_err()
    );
    store::cancel(&state.db, request.account_id, request.attempt_id, false)
        .await
        .unwrap();
    assert!(
        store::accept(
            &state.db,
            &state.client_operations,
            request.account_id,
            None,
            &page_result(&request, binding("device-one"))
        )
        .await
        .is_err()
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn late_fast_result_only_settles_an_open_attempt(pool: Pool<Postgres>) {
    let (state, _mock, _recorder, chat_id) = setup(pool, 10).await;
    let request = park(&state, chat_id).await;
    let server = app_server(state.clone());
    let payload = json!({"chat_id":chat_id,"message_id":request.message_id,"tool_call_id":request.tool_call_id,
        "result":{"document_identity":"doc-one","page":1,"text":"late page"}});
    for _ in 0..2 {
        let response = server
            .post("/api/v1beta/me/messages/clienttoolresult")
            .with_bearer_token(TEST_JWT_TOKEN)
            .add_header(
                "X-Erato-Executor",
                serde_json::to_string(&binding("device-one")).unwrap(),
            )
            .json(&payload)
            .await;
        response.assert_status_ok();
        assert_eq!(response.json::<Value>()["delivered"], true);
    }
    let mut replacement = payload.clone();
    replacement["result"]["text"] = json!("changed page");
    server
        .post("/api/v1beta/me/messages/clienttoolresult")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(
            "X-Erato-Executor",
            serde_json::to_string(&binding("device-one")).unwrap(),
        )
        .json(&replacement)
        .await
        .assert_status_conflict();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn dropped_http_stream_escalates_before_the_execution_timeout(pool: Pool<Postgres>) {
    use futures::StreamExt;
    let (state, _mock, _recorder, chat_id) = setup(pool, 60_000).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = router(state.clone())
        .split_for_parts()
        .0
        .with_state(state.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let response = reqwest::Client::new()
        .post(format!(
            "http://{address}/api/v1beta/me/messages/submitstream"
        ))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("X-Erato-Client-Tools", "read_document_page")
        .header(
            "X-Erato-Executor",
            serde_json::to_string(&binding("device-one")).unwrap(),
        )
        .json(&json!({"existing_chat_id":chat_id,"user_message":"Read page one"}))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let mut stream = response.bytes_stream();
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut received = String::new();
        while let Some(bytes) = stream.next().await {
            received.push_str(&String::from_utf8_lossy(&bytes.unwrap()));
            if received.contains("client_tool_call") {
                break;
            }
        }
        assert!(received.contains("client_tool_call"));
    })
    .await
    .unwrap();
    drop(stream);
    let attempt = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(row) = attempts::Entity::find().one(&state.db).await.unwrap() {
                break row;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("disconnect should park without waiting sixty seconds");
    assert_eq!(attempt.state, AttemptState::Pending);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn successful_fast_call_creates_no_durable_attempt(pool: Pool<Postgres>) {
    fast_call_case(pool, false, false).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn invalid_fast_result_is_refused_without_escalating_or_aborting(pool: Pool<Postgres>) {
    fast_call_case(pool, true, false).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn unexpected_fast_attachment_is_refused_without_resolving_files(pool: Pool<Postgres>) {
    fast_call_case(pool, true, true).await;
}

async fn fast_call_case(pool: Pool<Postgres>, invalid: bool, unexpected_attachment: bool) {
    let (state, _mock, recorder, chat_id) = setup(pool, 60_000).await;
    let server = app_server(state.clone());
    let submit = async {
        server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .add_header("X-Erato-Client-Tools", "read_document_page")
            .add_header(
                "X-Erato-Executor",
                serde_json::to_string(&binding("device-one")).unwrap(),
            )
            .json(&json!({"existing_chat_id":chat_id,"user_message":"Read page one"}))
            .await
    };
    let client = async {
        loop {
            if let Some(task) = state.background_tasks.get_task(&chat_id).await {
                for event in task.get_event_history().await {
                    if let erato::services::background_tasks::StreamingEvent::ClientToolCall {
                        message_id,
                        tool_call_id,
                        ..
                    } = event
                    {
                        let result = if invalid && !unexpected_attachment {
                            json!({"private":"INVALID-FAST-SECRET"})
                        } else {
                            json!({"document_identity":"doc-one","page":1,"text":"approved page"})
                        };
                        let response = server.post("/api/v1beta/me/messages/clienttoolresult").with_bearer_token(TEST_JWT_TOKEN)
                            .add_header("X-Erato-Executor", serde_json::to_string(&binding("device-one")).unwrap())
                            .json(&json!({"chat_id":chat_id,"message_id":message_id,"tool_call_id":tool_call_id,
                                "result":result, "file_upload_ids": if unexpected_attachment { vec![Uuid::new_v4()] } else { vec![] }})).await;
                        response.assert_status_ok();
                        assert_eq!(response.json::<Value>()["delivered"], true);
                        return;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    let (response, ()) = tokio::time::timeout(Duration::from_secs(15), async {
        tokio::join!(submit, client)
    })
    .await
    .unwrap();
    response.assert_status_ok();
    assert!(
        attempts::Entity::find()
            .all(&state.db)
            .await
            .unwrap()
            .is_empty()
    );
    let requests = turn_requests(&recorder);
    assert_eq!(requests.len(), 2);
    if invalid {
        assert!(
            requests.last().unwrap()["messages"]
                .to_string()
                .contains("invalid_operation_result")
        );
        assert!(
            !recorder
                .bodies()
                .iter()
                .any(|body| body.contains("INVALID-FAST-SECRET"))
        );
        let messages = Messages::find().all(&state.db).await.unwrap();
        assert!(!messages.iter().any(|message| {
            message
                .raw_message
                .to_string()
                .contains("INVALID-FAST-SECRET")
        }));
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn parked_submission_keeps_its_attempt_count_and_terminal_behavior(pool: Pool<Postgres>) {
    let (mut state, _mock, recorder, chat_id) = setup(pool, 10).await;
    state
        .config
        .client_tools
        .tools
        .get_mut("page")
        .unwrap()
        .submission = Some(erato::config::ClientToolSubmissionConfig {
        max_attempts: 2,
        ..Default::default()
    });
    let request = park(&state, chat_id).await;
    let message = Messages::find_by_id(request.message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let params: GenerationParameters =
        serde_json::from_value(message.generation_parameters.unwrap()).unwrap();
    assert_eq!(
        params.turn_consumption.submission_attempts["read_document_page"],
        1
    );
    store::accept(
        &state.db,
        &state.client_operations,
        request.account_id,
        None,
        &page_result(&request, binding("device-one")),
    )
    .await
    .unwrap();
    let server = app_server(state.clone());
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(&state, request.attempt_id).await;
    assert_eq!(
        turn_requests(&recorder).len(),
        1,
        "accepted submissions must end without a new model call"
    );
    let message = Messages::find_by_id(request.message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        message
            .raw_message
            .to_string()
            .contains("\"status\":\"accepted\"")
    );
    let params: GenerationParameters =
        serde_json::from_value(message.generation_parameters.unwrap()).unwrap();
    assert_eq!(
        params.turn_consumption.submission_attempts["read_document_page"],
        1
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn superseding_a_park_settles_its_message_part(pool: Pool<Postgres>) {
    let (state, _mock, _recorder, chat_id) = setup(pool, 10).await;
    let request = park(&state, chat_id).await;
    let (_events, replacement) = state
        .background_tasks
        .try_start_task(
            chat_id,
            Uuid::new_v4(),
            erato::services::background_tasks::Takeover::TakeParked,
            30,
        )
        .await
        .unwrap();
    let row = attempts::Entity::find_by_id(request.attempt_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.state, AttemptState::Completed);
    let message = Messages::find_by_id(request.message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        !message
            .raw_message
            .to_string()
            .contains("client_tool_pending")
    );
    assert!(message.raw_message.to_string().contains("superseded"));
    assert!(
        store::accept(
            &state.db,
            &state.client_operations,
            request.account_id,
            None,
            &page_result(&request, binding("device-one"))
        )
        .await
        .is_err()
    );
    replacement.mark_completed();
    state
        .background_tasks
        .remove_task(
            &chat_id,
            replacement.generation_id,
            erato::services::background_tasks::TaskOutcome::Completed,
        )
        .await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn archived_park_can_still_be_aborted_over_http(pool: Pool<Postgres>) {
    let (state, _mock, _recorder, chat_id) = setup(pool, 10).await;
    let request = park(&state, chat_id).await;
    let server = app_server(state.clone());
    archive_chat_via_api(&server, &chat_id.to_string()).await;
    server
        .post("/api/v1beta/me/messages/abortstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"chat_id":chat_id}))
        .await
        .assert_status_ok();
    assert_eq!(
        attempts::Entity::find_by_id(request.attempt_id)
            .one(&state.db)
            .await
            .unwrap()
            .unwrap()
            .state,
        AttemptState::Completed
    );
    let message = Messages::find_by_id(request.message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        !message
            .raw_message
            .to_string()
            .contains("client_tool_pending")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn crashed_continuation_is_replayed_and_old_generation_is_fenced(pool: Pool<Postgres>) {
    use erato::services::background_tasks::{BackgroundTaskManager, Takeover};
    use sea_orm::ConnectionTrait;
    let (state, _mock, recorder, chat_id) = setup(pool.clone(), 10).await;
    let request = park(&state, chat_id).await;
    store::accept(
        &state.db,
        &state.client_operations,
        request.account_id,
        None,
        &page_result(&request, binding("device-one")),
    )
    .await
    .unwrap();
    let manager = BackgroundTaskManager::new(
        Some(state.db.clone()),
        state.config.generation_status.clone(),
        None,
    )
    .with_lease_identity_guard(true);
    let (_events, old_task) = manager
        .try_start_task(chat_id, request.message_id, Takeover::TakeParked, 30)
        .await
        .unwrap();
    // Enter the same transaction production uses, then simulate losing the
    // worker after result application but before inference.
    store::begin_continuation(
        &state.db,
        request.account_id,
        request.attempt_id,
        old_task.generation_id,
    )
    .await
    .unwrap();
    old_task.request_abort(); // Stop this in-memory worker's heartbeat.
    state.db.execute_unprepared(&format!("UPDATE chats SET generation_state = 'running', generation_heartbeat_at = now() - interval '1 hour' WHERE id = '{chat_id}'")).await.unwrap();
    state.db.execute_unprepared("TRUNCATE temp_chat_generation_commands, temp_chat_generation_events, temp_chat_generations CASCADE").await.unwrap();
    let mut replica = test_app_state(state.config.clone(), pool).await;
    replica.client_operations = state.client_operations.clone();
    // The production maintenance pass must retain the durable stop.
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if chats::Entity::find_by_id(chat_id)
                .one(&replica.db)
                .await
                .unwrap()
                .unwrap()
                .generation_state
                .as_deref()
                == Some("awaiting_approval")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("stale operation should remain recoverable");
    let server = app_server(replica.clone());
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(&replica, request.attempt_id).await;
    assert!(
        store::save_progress(
            &state.db,
            request.attempt_id,
            old_task.generation_id,
            &[],
            &TurnConsumption::default()
        )
        .await
        .is_err()
    );
    let message = Messages::find_by_id(request.message_id)
        .one(&replica.db)
        .await
        .unwrap()
        .unwrap();
    let parsed = erato::models::message::MessageSchema::validate(&message.raw_message).unwrap();
    assert_eq!(parsed.content.iter().filter(|part| matches!(part, erato::models::message::ContentPart::ToolUse(tool) if tool.tool_call_id == "page-call")).count(), 1);
    assert_eq!(turn_requests(&recorder).len(), 2);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn account_inbox_discovers_child_attempts_and_excludes_other_accounts(pool: Pool<Postgres>) {
    let (state, _mock, _recorder, child_id) = setup(pool, 10).await;
    let request = park(&state, child_id).await;
    let parent_id = seed_origin_chat(&state.db).await;
    let mut child: chats::ActiveModel = chats::Entity::find_by_id(child_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap()
        .into();
    child.assistant_configuration = ActiveValue::Set(Some(
        json!({"provenance":{"kind":"delegation","origin_chat_id":parent_id,"depth":1,"run_mode":"async"}}),
    ));
    let child = child.update(&state.db).await.unwrap();
    assert!(erato::models::chat::chat_is_delegated_run(&child));
    let server = app_server(state.clone());
    let inbox = server
        .get("/api/v1beta/me/client-operations")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    inbox.assert_status_ok();
    assert_eq!(
        inbox.json::<Value>()["operations"][0]["request"]["chat_id"],
        child_id.to_string()
    );
    let foreign = JwtTokenBuilder::new()
        .subject("different-operation-account")
        .build();
    let other_inbox = server
        .get("/api/v1beta/me/client-operations")
        .with_bearer_token(&foreign)
        .await;
    other_inbox.assert_status_ok();
    assert_eq!(other_inbox.json::<Value>()["operations"], json!([]));
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/claim",
            request.attempt_id
        ))
        .with_bearer_token(&foreign)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&json!({"binding":binding("device-one")}))
        .await
        .assert_status_not_found();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn expired_attempt_rejects_results_and_continues_a_fixed_expiry_outcome(
    pool: Pool<Postgres>,
) {
    use sea_orm::ConnectionTrait;
    let (state, _mock, _recorder, chat_id) = setup(pool, 10).await;
    let request = park(&state, chat_id).await;
    state.db.execute_unprepared(&format!("UPDATE client_operation_attempts SET expires_at = now() - interval '1 second' WHERE attempt_id = '{}'", request.attempt_id)).await.unwrap();
    assert!(
        store::accept(
            &state.db,
            &state.client_operations,
            request.account_id,
            None,
            &page_result(&request, binding("device-one"))
        )
        .await
        .is_err()
    );
    let server = app_server(state.clone());
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(&state, request.attempt_id).await;
    let message = Messages::find_by_id(request.message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        message
            .raw_message
            .to_string()
            .contains("\"reason\":\"expired\"")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn repeated_parks_do_not_mint_new_submission_allowances(pool: Pool<Postgres>) {
    let (mut state, _mock, recorder, chat_id) = setup_with_second_submission(pool, 10, true).await;
    state
        .config
        .client_tools
        .tools
        .get_mut("page")
        .unwrap()
        .submission = Some(erato::config::ClientToolSubmissionConfig {
        max_attempts: 2,
        ..Default::default()
    });
    let first = park(&state, chat_id).await;
    state
        .config
        .client_tools
        .tools
        .get_mut("page")
        .unwrap()
        .submission
        .as_mut()
        .unwrap()
        .max_attempts = 8;

    let server = app_server(state.clone());
    let mut request = first;
    for expected_count in 1..=2 {
        let message = Messages::find_by_id(request.message_id)
            .one(&state.db)
            .await
            .unwrap()
            .unwrap();
        let params: GenerationParameters =
            serde_json::from_value(message.generation_parameters.unwrap()).unwrap();
        assert_eq!(
            params.turn_consumption.submission_attempts["read_document_page"],
            expected_count
        );
        let mut rejected = page_result(&request, binding("device-one"));
        rejected.outcome = OperationOutcome::Rejected;
        rejected.result = None;
        rejected.error = Some(OperationError {
            code: "validation_failed".into(),
        });
        store::accept(
            &state.db,
            &state.client_operations,
            request.account_id,
            None,
            &rejected,
        )
        .await
        .unwrap();
        server
            .post(&format!(
                "/api/v1beta/me/client-operations/{}/continue",
                request.attempt_id
            ))
            .with_bearer_token(TEST_JWT_TOKEN)
            .await
            .assert_status_ok();
        wait_completed(&state, request.attempt_id).await;
        if expected_count == 1 {
            request = tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let chat = chats::Entity::find_by_id(chat_id)
                        .one(&state.db)
                        .await
                        .unwrap()
                        .unwrap();
                    let next = attempts::Entity::find()
                        .filter(attempts::Column::State.eq(AttemptState::Pending))
                        .one(&state.db)
                        .await
                        .unwrap();
                    if let Some(next) = next
                        && chat.generation_state.as_deref() == Some("awaiting_approval")
                    {
                        break serde_json::from_value(next.request).unwrap();
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
        }
    }
    assert_eq!(turn_requests(&recorder).len(), 2);
    let message = Messages::find_by_id(request.message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        message
            .raw_message
            .to_string()
            .contains("\"status\":\"failed\"")
    );
    let params: GenerationParameters =
        serde_json::from_value(message.generation_parameters.unwrap()).unwrap();
    assert_eq!(
        params.turn_consumption.submission_attempts["read_document_page"],
        2
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn invalid_late_fast_result_settles_only_the_open_attempt(pool: Pool<Postgres>) {
    let (state, _mock, recorder, chat_id) = setup(pool, 10).await;
    let request = park(&state, chat_id).await;
    let server = app_server(state.clone());
    let body = json!({"chat_id":chat_id,"message_id":request.message_id,
        "tool_call_id":request.tool_call_id,"result":{"private":"LATE-FAST-SECRET"}});
    for _ in 0..2 {
        server
            .post("/api/v1beta/me/messages/clienttoolresult")
            .with_bearer_token(TEST_JWT_TOKEN)
            .add_header(
                "X-Erato-Executor",
                serde_json::to_string(&binding("device-one")).unwrap(),
            )
            .json(&body)
            .await
            .assert_status_ok();
    }
    let row = store::get(&state.db, request.account_id, request.attempt_id)
        .await
        .unwrap();
    assert_eq!(row.state, AttemptState::Ready);
    assert_eq!(
        row.result.as_ref().unwrap()["error"]["code"],
        "invalid_operation_result"
    );
    assert!(!row.result.unwrap().to_string().contains("LATE-FAST-SECRET"));
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(&state, request.attempt_id).await;
    assert_eq!(turn_requests(&recorder).len(), 2);
    assert!(
        !recorder
            .bodies()
            .iter()
            .any(|body| body.contains("LATE-FAST-SECRET"))
    );
    server.post("/api/v1beta/me/messages/clienttoolresult")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Executor", serde_json::to_string(&binding("device-one")).unwrap())
        .json(&json!({"chat_id":chat_id,"message_id":request.message_id,
            "tool_call_id":request.tool_call_id,"result":{"document_identity":"doc-one","page":1,"text":"replacement"}}))
        .await.assert_status_conflict();
}

struct SyntheticPageKind {
    authorize_child: bool,
}
impl OperationKind for SyntheticPageKind {
    fn kind(&self) -> &'static str {
        "test.synthetic-page.v1"
    }
    fn operation_id(&self) -> &'static str {
        "erato/read_document_page"
    }
    fn realm(&self) -> ExecutionRealm {
        ExecutionRealm::OfficeAddin
    }
    fn consent(&self) -> ConsentPolicy {
        ConsentPolicy::None
    }
    fn tool_offer(&self, context: &OperationOfferContext<'_>) -> Option<OperationToolOffer> {
        if !self.authorize_child
            || !erato::models::chat::chat_is_delegated_run(context.chat)
            || context.other_tools
            || context.account_id.is_none()
        {
            return None;
        }
        let executor = context.request_context.executor.clone()?;
        self.validate_input(&json!({"page":1}), &executor).ok()?;
        Some(OperationToolOffer {
            definition: ClientToolConfig {
                namespace: Some("erato".into()), name: "read_document_page".into(),
                description: "Synthetic bound page reader".into(),
                parameters: json!({"type":"object","properties":{"page":{"type":"integer"}},"required":["page"]}).to_string(),
                timeout_ms: Some(60_000), ..Default::default()
            }, binding: executor,
        })
    }
    fn validate_input(&self, input: &Value, executor: &ExecutorBinding) -> Result<(), String> {
        DocumentPageKind.validate_input(input, executor)
    }
    fn validate_result(
        &self,
        request: &OperationRequest,
        result: &OperationResult,
    ) -> Result<ValidatedResult, String> {
        DocumentPageKind.validate_result(request, result)
    }
}

async fn mark_child(state: &erato::state::AppState, chat_id: Uuid) {
    let parent_id = seed_origin_chat(&state.db).await;
    let mut chat: chats::ActiveModel = chats::Entity::find_by_id(chat_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap()
        .into();
    chat.assistant_configuration = ActiveValue::Set(Some(json!({"provenance":{
        "kind":"delegation","origin_chat_id":parent_id,"depth":1,"run_mode":"async"}})));
    chat.update(&state.db).await.unwrap();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn synthetic_kind_parks_and_resumes_a_bound_child_without_config_or_sse(
    pool: Pool<Postgres>,
) {
    let (mut state, _mock, recorder, chat_id) = setup(pool, 60_000).await;
    state.config.client_tools.tools.clear();
    state.config.facets.tool_call_allowlist = vec!["erato/read_document_page".into()];
    state.client_operations = OperationRegistry::default();
    state
        .client_operations
        .register(Arc::new(SyntheticPageKind {
            authorize_child: true,
        }))
        .unwrap();
    mark_child(&state, chat_id).await;
    // The synthetic kind bypasses neither the allowlist nor the binding, but
    // needs no configured tool in the otherwise-reserved erato namespace.
    let request = tokio::time::timeout(Duration::from_secs(10), park(&state, chat_id))
        .await
        .unwrap();
    assert_eq!(request.operation_id, "erato/read_document_page");
    let message = Messages::find_by_id(request.message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let params: GenerationParameters =
        serde_json::from_value(message.generation_parameters.unwrap()).unwrap();
    assert!(params.client_tools.contains_key("read_document_page"));
    let server = app_server(state.clone());
    let claim = server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/claim",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&json!({"binding":binding("device-one")}))
        .await;
    claim.assert_status_ok();
    server.post(&format!("/api/v1beta/me/client-operations/{}/result", request.attempt_id))
        .with_bearer_token(TEST_JWT_TOKEN).add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&json!({"claim_token":claim.json::<Value>()["claim_token"],"result":page_result(&request,binding("device-one"))}))
        .await.assert_status_ok();
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(&state, request.attempt_id).await;
    let requests = turn_requests(&recorder);
    assert_eq!(requests.len(), 2);
    assert!(
        requests[1]["tools"]
            .to_string()
            .contains("Synthetic bound page reader")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn child_offers_require_kind_authorization_allowlist_and_binding(pool: Pool<Postgres>) {
    let (state, _mock, recorder, _) = setup(pool, 60_000).await;
    for case in ["ordinary", "kind_refused", "no_allowlist", "no_binding"] {
        let mut state = state.clone();
        let chat_id = seed_origin_chat(&state.db).await;
        mark_child(&state, chat_id).await;
        if case != "ordinary" {
            state.config.client_tools.tools.clear();
            state.config.facets.tool_call_allowlist = vec!["erato/read_document_page".into()];
            state.client_operations = OperationRegistry::default();
            state
                .client_operations
                .register(Arc::new(SyntheticPageKind {
                    authorize_child: case != "kind_refused",
                }))
                .unwrap();
        }
        if case == "no_allowlist" {
            state.config.facets.tool_call_allowlist.clear();
        }
        let server = app_server(state.clone());
        let mut call = server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .add_header("X-Erato-Client-Tools", "read_document_page")
            .json(&json!({"existing_chat_id":chat_id,"user_message":"Read page"}));
        if case != "no_binding" {
            call = call.add_header(
                "X-Erato-Executor",
                serde_json::to_string(&binding("device-one")).unwrap(),
            );
        }
        tokio::time::timeout(Duration::from_secs(10), call)
            .await
            .unwrap()
            .assert_status_ok();
        assert!(
            attempts::Entity::find()
                .all(&state.db)
                .await
                .unwrap()
                .is_empty(),
            "{case}"
        );
    }
    for body in recorder.bodies() {
        let body: Value = serde_json::from_str(&body).unwrap();
        assert!(!body["tools"].to_string().contains("read_document_page"));
    }
}

struct PolicyPageKind {
    consent: ConsentPolicy,
    crash_on_input: Arc<std::sync::atomic::AtomicBool>,
}
impl OperationKind for PolicyPageKind {
    fn kind(&self) -> &'static str {
        DocumentPageKind.kind()
    }
    fn operation_id(&self) -> &'static str {
        DocumentPageKind.operation_id()
    }
    fn realm(&self) -> ExecutionRealm {
        DocumentPageKind.realm()
    }
    fn consent(&self) -> ConsentPolicy {
        self.consent
    }
    fn allow_cross_device(&self) -> bool {
        true
    }
    fn validate_input(&self, input: &Value, executor: &ExecutorBinding) -> Result<(), String> {
        // This is reached by the actual dispatch loop AFTER its charge/identity
        // checkpoint. Panic only the spawned generation to simulate worker death.
        assert!(
            !self
                .crash_on_input
                .swap(false, std::sync::atomic::Ordering::SeqCst),
            "injected worker death after committed call charge"
        );
        DocumentPageKind.validate_input(input, executor)
    }
    fn validate_result(
        &self,
        request: &OperationRequest,
        result: &OperationResult,
    ) -> Result<ValidatedResult, String> {
        DocumentPageKind.validate_result(request, result)
    }
}
fn install_policy_kind(
    state: &mut erato::state::AppState,
    consent: ConsentPolicy,
) -> Arc<std::sync::atomic::AtomicBool> {
    let crash = Arc::new(std::sync::atomic::AtomicBool::new(false));
    state.client_operations = OperationRegistry::default();
    state
        .client_operations
        .register(Arc::new(PolicyPageKind {
            consent,
            crash_on_input: crash.clone(),
        }))
        .unwrap();
    crash
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn consent_kinds_cannot_execute_or_submit_through_the_fast_path(pool: Pool<Postgres>) {
    let (mut state, _mock, _recorder, _) = setup(pool, 60_000).await;
    for consent in [ConsentPolicy::Ask, ConsentPolicy::Native] {
        install_policy_kind(&mut state, consent);
        let chat_id = seed_origin_chat(&state.db).await;
        let server = app_server(state.clone());
        let response = tokio::time::timeout(
            Duration::from_secs(10),
            server
                .post("/api/v1beta/me/messages/submitstream")
                .with_bearer_token(TEST_JWT_TOKEN)
                .add_header("X-Erato-Client-Tools", "read_document_page")
                .add_header(
                    "X-Erato-Executor",
                    serde_json::to_string(&binding("device-one")).unwrap(),
                )
                .json(&json!({"existing_chat_id":chat_id,"user_message":"Read page one"})),
        )
        .await
        .unwrap();
        response.assert_status_ok();
        assert!(!parse_sse_events(&response).iter().any(|event| {
            serde_json::from_str::<Value>(&event.data)
                .is_ok_and(|value| value["message_type"] == "client_tool_call")
        }));
        let row = attempts::Entity::find()
            .filter(attempts::Column::ChatId.eq(chat_id))
            .one(&state.db)
            .await
            .unwrap()
            .unwrap();
        let request: OperationRequest = serde_json::from_value(row.request).unwrap();
        assert_eq!(request.consent, consent);
        server.post("/api/v1beta/me/messages/clienttoolresult").with_bearer_token(TEST_JWT_TOKEN)
            .add_header("X-Erato-Executor", serde_json::to_string(&binding("device-one")).unwrap())
            .json(&json!({"chat_id":chat_id,"message_id":request.message_id,"tool_call_id":request.tool_call_id,
                "status":"success","result":{"document_identity":"doc-one","page":1,"text":"unconfirmed"}}))
            .await.assert_status_conflict();
        assert!(
            store::accept_fast(
                &state.db,
                &state.client_operations,
                request.account_id,
                &page_result(&request, binding("device-one"))
            )
            .await
            .is_err()
        );
        let claim_url = format!(
            "/api/v1beta/me/client-operations/{}/claim",
            request.attempt_id
        );
        if consent == ConsentPolicy::Ask {
            server
                .post(&claim_url)
                .with_bearer_token(TEST_JWT_TOKEN)
                .add_header("X-Erato-Client-Tools", "read_document_page")
                .json(&json!({"binding":binding("device-one"),"user_confirmed":false}))
                .await
                .assert_status_conflict();
        }
        let claimed = server
            .post(&claim_url)
            .with_bearer_token(TEST_JWT_TOKEN)
            .add_header("X-Erato-Client-Tools", "read_document_page")
            .json(&json!({"binding":binding("device-one"),"user_confirmed":true}))
            .await;
        claimed.assert_status_ok();
        // Native proof belongs to the kind validator; this fixture tests routing,
        // not an attestation. Neither consent mode can use unclaimed acceptance.
        server.post(&format!("/api/v1beta/me/client-operations/{}/result", request.attempt_id))
            .with_bearer_token(TEST_JWT_TOKEN).add_header("X-Erato-Client-Tools", "read_document_page")
            .json(&json!({"claim_token":claimed.json::<Value>()["claim_token"],"result":page_result(&request,binding("device-one"))}))
            .await.assert_status_ok();
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn withdrawn_tools_refuse_claims_and_uncommitted_results(pool: Pool<Postgres>) {
    let (base, _mock, _recorder, _) = setup(pool, 10).await;
    for remove_tool in [false, true] {
        for claimed_before in [false, true] {
            let mut state = base.clone();
            let chat_id = seed_origin_chat(&state.db).await;
            // park() also asserts the isolated inbox size, so use one row per case.
            let request = park(&state, chat_id).await;
            let server = app_server(state.clone());
            let claim_url = format!(
                "/api/v1beta/me/client-operations/{}/claim",
                request.attempt_id
            );
            let token = if claimed_before {
                let response = server
                    .post(&claim_url)
                    .with_bearer_token(TEST_JWT_TOKEN)
                    .add_header("X-Erato-Client-Tools", "read_document_page")
                    .json(&json!({"binding":binding("device-one")}))
                    .await;
                response.assert_status_ok();
                Some(response.json::<Value>()["claim_token"].clone())
            } else {
                None
            };
            if remove_tool {
                state.config.client_tools.tools.clear();
            } else {
                state.config.facets.tool_call_allowlist.clear();
            }
            let server = app_server(state.clone());
            if let Some(token) = token {
                server.post(&format!("/api/v1beta/me/client-operations/{}/result",request.attempt_id))
                    .with_bearer_token(TEST_JWT_TOKEN).add_header("X-Erato-Client-Tools","read_document_page")
                    .json(&json!({"claim_token":token,"result":page_result(&request,binding("device-one"))}))
                    .await.assert_status_conflict();
            } else {
                server
                    .post(&claim_url)
                    .with_bearer_token(TEST_JWT_TOKEN)
                    .add_header("X-Erato-Client-Tools", "read_document_page")
                    .json(&json!({"binding":binding("device-one")}))
                    .await
                    .assert_status_conflict();
            }
            let row = attempts::Entity::find_by_id(request.attempt_id)
                .one(&state.db)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(row.state, AttemptState::Ready);
            assert_eq!(row.result.unwrap()["error"]["code"], "withdrawn");
            assert!(
                !row.validated_result
                    .unwrap()
                    .to_string()
                    .contains("approved page")
            );
            server
                .post(&format!(
                    "/api/v1beta/me/client-operations/{}/continue",
                    request.attempt_id
                ))
                .with_bearer_token(TEST_JWT_TOKEN)
                .await
                .assert_status_ok();
            wait_completed(&state, request.attempt_id).await;
            let message = Messages::find_by_id(request.message_id)
                .one(&state.db)
                .await
                .unwrap()
                .unwrap();
            assert!(message.raw_message.to_string().contains("withdrawn"));
            attempts::Entity::delete_by_id(request.attempt_id)
                .exec(&state.db)
                .await
                .unwrap();
        }
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn committed_results_survive_withdrawal_and_identical_redelivery(pool: Pool<Postgres>) {
    let (mut state, _mock, _recorder, chat_id) = setup(pool, 10).await;
    let request = park(&state, chat_id).await;
    let server = app_server(state.clone());
    let claim = server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/claim",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&json!({"binding":binding("device-one")}))
        .await;
    claim.assert_status_ok();
    let result = json!({"claim_token":claim.json::<Value>()["claim_token"],"result":page_result(&request,binding("device-one"))});
    let url = format!(
        "/api/v1beta/me/client-operations/{}/result",
        request.attempt_id
    );
    server
        .post(&url)
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&result)
        .await
        .assert_status_ok();
    state.config.client_tools.tools.clear();
    state.client_operations = OperationRegistry::default();
    let server = app_server(state.clone());
    server
        .post(&url)
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page")
        .json(&result)
        .await
        .assert_status_ok();
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(&state, request.attempt_id).await;
    let message = Messages::find_by_id(request.message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert!(message.raw_message.to_string().contains("approved page"));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn crash_after_call_charge_reuses_counts_and_execution_identity(pool: Pool<Postgres>) {
    use sea_orm::ConnectionTrait;
    use std::sync::atomic::Ordering;
    let (mut state, _mock, recorder, chat_id) =
        setup_with_second_submission(pool.clone(), 10, true).await;
    state.config.generation.max_tool_calls_per_message = 2;
    state
        .config
        .client_tools
        .tools
        .get_mut("page")
        .unwrap()
        .submission = Some(erato::config::ClientToolSubmissionConfig {
        max_attempts: 2,
        ..Default::default()
    });
    let crash = install_policy_kind(&mut state, ConsentPolicy::None);
    let first = park(&state, chat_id).await;
    let mut rejected = page_result(&first, binding("device-one"));
    rejected.outcome = OperationOutcome::Rejected;
    rejected.result = None;
    rejected.error = Some(OperationError {
        code: "validation_failed".into(),
    });
    store::accept(
        &state.db,
        &state.client_operations,
        first.account_id,
        None,
        &rejected,
    )
    .await
    .unwrap();
    crash.store(true, Ordering::SeqCst);
    app_server(state.clone())
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            first.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    let checkpoint = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let message = Messages::find_by_id(first.message_id)
                .one(&state.db)
                .await
                .unwrap()
                .unwrap();
            let params: GenerationParameters =
                serde_json::from_value(message.generation_parameters.unwrap()).unwrap();
            if !crash.load(Ordering::SeqCst)
                && params
                    .turn_consumption
                    .tool_charges
                    .get("page-call-2")
                    .is_some_and(|charge| charge.submission_attempt == Some(2))
            {
                break params.turn_consumption;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(checkpoint.tool_calls, 2);
    let second_id = checkpoint.tool_charges["page-call-2"]
        .operation_identity
        .as_ref()
        .unwrap()
        .attempt_id;
    // The test uses a panic, so let the in-process cleanup guard finish before
    // restoring the stale lease that a real process death would have left.
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let chat = chats::Entity::find_by_id(chat_id)
                .one(&state.db)
                .await
                .unwrap()
                .unwrap();
            if chat.generation_state.as_deref() == Some("errored") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    state
        .db
        .execute_unprepared(&format!(
            "UPDATE chats SET generation_state='running',generation_heartbeat_at=now()-interval '1 hour' WHERE id='{chat_id}'"
        ))
        .await
        .unwrap();
    state.db.execute_unprepared("TRUNCATE temp_chat_generation_commands, temp_chat_generation_events, temp_chat_generations CASCADE").await.unwrap();
    let mut replica = test_app_state(state.config.clone(), pool).await;
    replica.client_operations = state.client_operations.clone();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let chat = chats::Entity::find_by_id(chat_id)
                .one(&replica.db)
                .await
                .unwrap()
                .unwrap();
            if chat.generation_state.as_deref() == Some("awaiting_approval") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let server = app_server(replica.clone());
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            first.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(&replica, first.attempt_id).await;
    let row = attempts::Entity::find_by_id(second_id)
        .one(&replica.db)
        .await
        .unwrap()
        .expect("same operation identity after crash");
    assert_eq!(row.state, AttemptState::Pending);
    let message = Messages::find_by_id(first.message_id)
        .one(&replica.db)
        .await
        .unwrap()
        .unwrap();
    let after: GenerationParameters =
        serde_json::from_value(message.generation_parameters.unwrap()).unwrap();
    assert_eq!(
        after.turn_consumption, checkpoint,
        "recovery must not charge the same iteration/call/submission twice"
    );
    let second: OperationRequest = serde_json::from_value(row.request).unwrap();
    let result = page_result(&second, binding("device-one"));
    for _ in 0..2 {
        store::accept(
            &replica.db,
            &replica.client_operations,
            second.account_id,
            None,
            &result,
        )
        .await
        .unwrap();
    }
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/continue",
            second_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(&replica, second_id).await;
    let message = Messages::find_by_id(first.message_id)
        .one(&replica.db)
        .await
        .unwrap()
        .unwrap();
    let parts = message.raw_message["content"].as_array().unwrap();
    assert_eq!(
        parts
            .iter()
            .filter(
                |part| part["tool_call_id"] == "page-call-2" && part["content_type"] == "tool_use"
            )
            .count(),
        1
    );
    assert_eq!(
        turn_requests(&recorder).len(),
        2,
        "recovery must not regenerate a proposal"
    );
}

struct PlanKind;
impl OperationKind for PlanKind {
    fn kind(&self) -> &'static str {
        "test.plan.v1"
    }
    fn operation_id(&self) -> &'static str {
        "client/submit_plan"
    }
    fn realm(&self) -> ExecutionRealm {
        ExecutionRealm::OfficeAddin
    }
    fn consent(&self) -> ConsentPolicy {
        ConsentPolicy::None
    }
    fn validate_input(&self, input: &Value, binding: &ExecutorBinding) -> Result<(), String> {
        DocumentPageKind.validate_input(&json!({"page":1}), binding)?;
        input["draft"]
            .as_str()
            .filter(|draft| draft.len() < 4096)
            .map(|_| ())
            .ok_or("draft required".into())
    }
    fn validate_result(
        &self,
        _request: &OperationRequest,
        result: &OperationResult,
    ) -> Result<ValidatedResult, String> {
        if result.outcome == OperationOutcome::Rejected
            && result.result.is_none()
            && result
                .error
                .as_ref()
                .is_some_and(|error| error.code == "validation_failed")
        {
            return Ok(ValidatedResult {
                succeeded: false,
                output: json!({"status":"error","error":"CURRENT-DIAGNOSTIC"}),
            });
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct PlanReceipt {
            accepted: bool,
        }
        let Some(OperationValue::Value { value }) = &result.result else {
            return Err("receipt required".into());
        };
        let receipt: PlanReceipt =
            serde_json::from_value(value.clone()).map_err(|_| "typed receipt required")?;
        if !receipt.accepted {
            return Err("invalid receipt".into());
        }
        Ok(ValidatedResult {
            succeeded: true,
            output: json!({"status":"success","result":{"accepted":true}}),
        })
    }
}
async fn next_inbox_request(state: &erato::state::AppState, chat_id: Uuid) -> OperationRequest {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let row = attempts::Entity::find()
                .filter(attempts::Column::ChatId.eq(chat_id))
                .filter(attempts::Column::State.eq(AttemptState::Pending))
                .one(&state.db)
                .await
                .unwrap();
            let chat = chats::Entity::find_by_id(chat_id)
                .one(&state.db)
                .await
                .unwrap()
                .unwrap();
            if let Some(row) = row
                && chat.generation_state.as_deref() == Some("awaiting_approval")
            {
                break serde_json::from_value(row.request).unwrap();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}
async fn post_claimed_result(
    state: &erato::state::AppState,
    request: &OperationRequest,
    accepted: bool,
) -> Value {
    let server = app_server(state.clone());
    let claim = server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/claim",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page,submit_plan")
        .json(&json!({"binding":binding("device-one")}))
        .await;
    claim.assert_status_ok();
    let mut result = page_result(request, binding("device-one"));
    if request.operation_id == "client/submit_plan" {
        result.result = accepted.then(|| OperationValue::Value {
            value: json!({"accepted":true}),
        });
        if !accepted {
            result.outcome = OperationOutcome::Rejected;
            result.error = Some(OperationError {
                code: "validation_failed".into(),
            });
        }
    } else {
        result.result = Some(OperationValue::Value {
            value: json!({"document_identity":"doc-one","page":1,
            "text":if request.tool_call_id=="read-A" {"PRIOR-PAGE-SECRET"} else {"CURRENT-PAGE"}}),
        });
    }
    let payload = json!({"claim_token":claim.json::<Value>()["claim_token"],"result":result});
    server
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/result",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", "read_document_page,submit_plan")
        .json(&payload)
        .await
        .assert_status_ok();
    payload
}
async fn continue_inbox(state: &erato::state::AppState, id: Uuid) {
    app_server(state.clone())
        .post(&format!("/api/v1beta/me/client-operations/{id}/continue"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(state, id).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn joint_replay_keeps_current_drafts_through_restart_and_duplicate_result(
    pool: Pool<Postgres>,
) {
    joint_replay_case(pool, false).await;
}
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn joint_replay_refuses_withdrawn_tool_before_claim(pool: Pool<Postgres>) {
    joint_replay_case(pool, true).await;
}
async fn joint_replay_case(pool: Pool<Postgres>, withdraw: bool) {
    use erato::services::background_tasks::{BackgroundTaskManager, Takeover};
    use sea_orm::ConnectionTrait;
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    for (yes, no, call, name, args) in [
        (
            vec!["TURN-A"],
            vec!["TURN-B", "read-A"],
            "read-A",
            "read_document_page",
            json!({"page":1}),
        ),
        (
            vec!["read-A"],
            vec!["TURN-B", "plan-A"],
            "plan-A",
            "submit_plan",
            json!({"draft":"PRIOR-DRAFT-SECRET"}),
        ),
        (
            vec!["TURN-B"],
            vec!["read-B"],
            "read-B",
            "read_document_page",
            json!({"page":1}),
        ),
        (
            vec!["read-B"],
            vec!["plan-B1"],
            "plan-B1",
            "submit_plan",
            json!({"draft":"CURRENT-DRAFT-REJECTED"}),
        ),
        (
            vec!["plan-B1"],
            vec!["plan-B2"],
            "plan-B2",
            "submit_plan",
            json!({"draft":"CURRENT-DRAFT-CORRECTED"}),
        ),
    ] {
        let capture = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&yes, &no))
                .matcher(capture);
            mock_llm_sse_response(
                then,
                build_openai_tool_calls_streaming_response(&[(call, name, args)]),
            );
        });
    }
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&["plan-B2"], &[]))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&["JOINT-RECOVERED"]),
        );
    });
    let (mut config, _mock) = setup_mock_llm_server_with_mocks(mocks).await;
    config.client_tools.durable_operations_enabled = true;
    config.facets.tool_call_allowlist = vec![
        "client/read_document_page".into(),
        "client/submit_plan".into(),
    ];
    for (name, parameters, submission) in [
        (
            "read_document_page",
            json!({"type":"object","properties":{"page":{"type":"integer"}},"required":["page"]}),
            None,
        ),
        (
            "submit_plan",
            json!({"type":"object","properties":{"draft":{"type":"string"}},"required":["draft"]}),
            Some(erato::config::ClientToolSubmissionConfig {
                max_attempts: 3,
                ..Default::default()
            }),
        ),
    ] {
        let tool = ClientToolConfig {
            name: name.into(),
            description: name.into(),
            parameters: parameters.to_string(),
            timeout_ms: Some(10),
            requires_client_registration: true,
            submission,
            ..Default::default()
        };
        // The same regression runs on #1249 alone and on its combined tree with
        // #1250. There is no compile-time dependency on the latter's new type.
        let mut value = serde_json::to_value(tool).unwrap();
        value["replay"] =
            json!({"mode":"receipt","keep_input_fields":[],"keep_output_fields":["$.status"]});
        config
            .client_tools
            .tools
            .insert(name.into(), serde_json::from_value(value).unwrap());
    }
    let receipts_supported = serde_json::to_value(&config.client_tools.tools["read_document_page"])
        .unwrap()
        .get("replay")
        .is_some();
    let mut state = test_app_state(config, pool.clone()).await;
    state
        .client_operations
        .register(Arc::new(DocumentPageKind))
        .unwrap();
    state
        .client_operations
        .register(Arc::new(PlanKind))
        .unwrap();
    let chat_id = seed_origin_chat(&state.db).await;
    let mut previous_message_id = None;
    for turn in ["TURN-A", "TURN-B"] {
        app_server(state.clone())
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .add_header("X-Erato-Client-Tools", "read_document_page,submit_plan")
            .add_header(
                "X-Erato-Executor",
                serde_json::to_string(&binding("device-one")).unwrap(),
            )
            .json(&json!({"existing_chat_id":chat_id,"previous_message_id":previous_message_id,"user_message":turn}))
            .await
            .assert_status_ok();
        let read = next_inbox_request(&state, chat_id).await;
        post_claimed_result(&state, &read, true).await;
        continue_inbox(&state, read.attempt_id).await;
        let plan = next_inbox_request(&state, chat_id).await;
        post_claimed_result(&state, &plan, turn == "TURN-A").await;
        continue_inbox(&state, plan.attempt_id).await;
        previous_message_id = Some(plan.message_id);
    }
    let request = next_inbox_request(&state, chat_id).await;
    assert_eq!(request.tool_call_id, "plan-B2");
    let message = Messages::find_by_id(request.message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let snapshot = message.generation_input_messages.unwrap().to_string();
    assert_eq!(snapshot.contains("PRIOR-PAGE-SECRET"), !receipts_supported);
    assert_eq!(snapshot.contains("PRIOR-DRAFT-SECRET"), !receipts_supported);
    if receipts_supported {
        assert!(snapshot.contains("omitted_from_replay"));
    }
    let payload = if withdraw {
        state.config.client_tools.tools.remove("submit_plan");
        app_server(state.clone())
            .post(&format!(
                "/api/v1beta/me/client-operations/{}/claim",
                request.attempt_id
            ))
            .with_bearer_token(TEST_JWT_TOKEN)
            .add_header("X-Erato-Client-Tools", "submit_plan")
            .json(&json!({"binding":binding("device-one")}))
            .await
            .assert_status_conflict();
        None
    } else {
        Some(post_claimed_result(&state, &request, false).await)
    };
    let manager = BackgroundTaskManager::new(
        Some(state.db.clone()),
        state.config.generation_status.clone(),
        None,
    )
    .with_lease_identity_guard(true);
    let (_events, old_task) = manager
        .try_start_task(chat_id, request.message_id, Takeover::TakeParked, 30)
        .await
        .unwrap();
    store::begin_continuation(
        &state.db,
        request.account_id,
        request.attempt_id,
        old_task.generation_id,
    )
    .await
    .unwrap();
    old_task.request_abort();
    state.db.execute_unprepared(&format!("UPDATE chats SET generation_state='running',generation_heartbeat_at=now()-interval '1 hour' WHERE id='{chat_id}'")).await.unwrap();
    state.db.execute_unprepared("TRUNCATE temp_chat_generation_commands, temp_chat_generation_events, temp_chat_generations CASCADE").await.unwrap();
    let mut replica = test_app_state(state.config.clone(), pool).await;
    replica.client_operations = state.client_operations.clone();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let chat = chats::Entity::find_by_id(chat_id)
                .one(&replica.db)
                .await
                .unwrap()
                .unwrap();
            if chat.generation_state.as_deref() == Some("awaiting_approval") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    if let Some(payload) = payload {
        app_server(replica.clone())
            .post(&format!(
                "/api/v1beta/me/client-operations/{}/result",
                request.attempt_id
            ))
            .with_bearer_token(TEST_JWT_TOKEN)
            .add_header("X-Erato-Client-Tools", "read_document_page,submit_plan")
            .json(&payload)
            .await
            .assert_status_ok();
    }
    continue_inbox(&replica, request.attempt_id).await;
    let message = Messages::find_by_id(request.message_id)
        .one(&replica.db)
        .await
        .unwrap()
        .unwrap();
    let params: GenerationParameters =
        serde_json::from_value(message.generation_parameters.unwrap()).unwrap();
    assert_eq!(params.turn_consumption.tool_calls, 3);
    assert_eq!(
        params.turn_consumption.submission_attempts["submit_plan"],
        2
    );
    assert_eq!(
        message.raw_message["content"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|part| part["content_type"] == "tool_use" && part["tool_call_id"] == "plan-B2")
            .count(),
        1
    );
    let bodies = turn_requests(&recorder);
    assert_eq!(bodies.len(), if withdraw { 5 } else { 6 });
    // Withdrawal is a terminal submission refusal, so it must not launch an
    // extra model call. Its complete current turn remains in the message row.
    let rebuilt = if withdraw {
        message.raw_message.to_string()
    } else {
        bodies.last().unwrap().to_string()
    };
    for marker in [
        "CURRENT-PAGE",
        "CURRENT-DRAFT-REJECTED",
        "CURRENT-DRAFT-CORRECTED",
        "CURRENT-DIAGNOSTIC",
    ] {
        assert!(rebuilt.contains(marker), "missing {marker}");
    }
    if withdraw {
        assert!(rebuilt.contains("withdrawn"));
    } else {
        assert_eq!(rebuilt.contains("PRIOR-PAGE-SECRET"), !receipts_supported);
        assert_eq!(rebuilt.contains("PRIOR-DRAFT-SECRET"), !receipts_supported);
    }
}
