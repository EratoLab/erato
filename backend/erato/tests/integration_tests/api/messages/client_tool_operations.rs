//! Outlook `fetch_availability` opted into the generic `client_tool.v1` kind by
//! configuration. No test kind: the registry comes from the production builder.
use super::client_operations::{turn_requests, wait_completed};
use super::*;
use erato::db::entity::client_operation_attempts::{self as attempts, AttemptState};
use erato::services::background_tasks::StreamingEvent;
use erato::services::client_operations::*;
use std::time::Duration;

const TOOL: &str = "fetch_availability";
const QUALIFIED: &str = "outlook/fetch_availability";
const CALL: &str = "avail-call";
const ANSWER: &str = "AVAILABILITY-ANSWER";
const SCHEMA: &str = r#"{"type":"object","required":["legend","timezone","now","busy","recentMeetings","degraded"],
 "properties":{"legend":{"type":"string"},"timezone":{"type":"string"},"now":{"type":"object"},
 "busy":{"type":"array"},"recentMeetings":{"type":"array"},"degraded":{"type":"array"}}}"#;

struct Setup {
    state: erato::state::AppState,
    _mock: MockServer,
    recorder: RequestBodyRecorder,
    chat_id: Uuid,
}

async fn setup(pool: Pool<Postgres>, timeout_ms: u64, durable_flag: bool, opt_in: bool) -> Setup {
    setup_reads(pool, timeout_ms, durable_flag, opt_in, 1).await
}

async fn setup_reads(
    pool: Pool<Postgres>,
    timeout_ms: u64,
    durable_flag: bool,
    opt_in: bool,
    reads: usize,
) -> Setup {
    setup_tool_calls(pool, timeout_ms, durable_flag, opt_in, &vec![TOOL; reads]).await
}

async fn setup_tool_calls(
    pool: Pool<Postgres>,
    timeout_ms: u64,
    durable_flag: bool,
    opt_in: bool,
    tools: &[&str],
) -> Setup {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let calls: Vec<String> = (0..tools.len())
        .map(|i| {
            if i == 0 {
                CALL.into()
            } else {
                format!("{CALL}-{}", i + 1)
            }
        })
        .collect();
    for (index, call) in calls.iter().enumerate() {
        let capture = recorder.clone();
        let call = call.clone();
        let tool = tools[index].to_owned();
        let previous = index.checked_sub(1).map(|i| calls[i].clone());
        mocks.mock(move |when, then| {
            let included: Vec<&str> = previous.as_deref().into_iter().collect();
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&included, &[&call]))
                .matcher(capture);
            mock_llm_sse_response(
                then,
                build_openai_tool_calls_streaming_response(&[(
                    &call,
                    &tool,
                    json!({"lookahead_days":7}),
                )]),
            );
        });
    }
    let last = calls.last().unwrap().clone();
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[&last], &[]))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[ANSWER]));
    });
    let (mut config, mock) = setup_mock_llm_server_with_mocks(mocks).await;
    config.client_tools.durable_operations_enabled = durable_flag;
    config.client_tools.tools.insert(
        "outlook_fetch_availability".into(),
        ClientToolConfig {
            name: TOOL.into(),
            namespace: Some("outlook".into()),
            description: "Read the mailbox free/busy".into(),
            parameters: json!({"type":"object","properties":{"lookahead_days":{"type":"integer"}}})
                .to_string(),
            timeout_ms: Some(timeout_ms),
            durable: opt_in.then(|| erato::config::ClientToolDurableConfig {
                host_context: erato::config::ClientToolHostContext::OutlookMailbox,
                result_schema: Some(SCHEMA.into()),
                attempt_expiry_secs: 900,
                claim_lease_secs: 90,
            }),
            ..Default::default()
        },
    );
    config.facets.tool_call_allowlist = vec!["outlook/*".into()];
    for tool in tools.iter().filter(|tool| **tool != TOOL) {
        config.client_tools.tools.insert(
            format!("outlook_{tool}"),
            ClientToolConfig {
                name: (*tool).into(),
                namespace: Some("outlook".into()),
                description: "Read live mailbox state".into(),
                parameters:
                    json!({"type":"object","properties":{"lookahead_days":{"type":"integer"}}})
                        .to_string(),
                ..Default::default()
            },
        );
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

fn set_timeout(setup: &mut Setup, timeout_ms: u64) {
    setup
        .state
        .config
        .client_tools
        .tools
        .get_mut("outlook_fetch_availability")
        .unwrap()
        .timeout_ms = Some(timeout_ms);
}

/// The add-in's routing identity: a per-origin device id and the SHA-256 hex
/// digest of the mailbox address, here a fixed 64-character stand-in.
fn mailbox_binding(device: &str, email_digest: char) -> ExecutorBinding {
    ExecutorBinding {
        device_id: device.into(),
        realm: ExecutionRealm::OfficeAddin,
        host_context: Some(HostContext {
            kind: "outlook_mailbox".into(),
            identity: email_digest.to_string().repeat(64),
        }),
    }
}

fn mailbox() -> ExecutorBinding {
    mailbox_binding("device-one", 'a')
}

fn availability() -> Value {
    json!({
        "legend": "AVAIL-SLOT-MARKER busy blocks are local time",
        "timezone": "Europe/Berlin",
        "now": {"iso": "2026-10-12T09:00:00+02:00"},
        "busy": [{"start": "2026-10-12T10:00:00+02:00", "end": "2026-10-12T11:00:00+02:00"}],
        "recentMeetings": [],
        "degraded": [],
    })
}

fn value_result(request: &OperationRequest, value: Value) -> OperationResult {
    OperationResult {
        attempt_id: request.attempt_id,
        operation_id: request.operation_id.clone(),
        base_revision: None,
        outcome: OperationOutcome::Succeeded,
        result: Some(OperationValue::Value { value }),
        error: None,
        executor: request.binding.clone(),
    }
}

fn failed_result(request: &OperationRequest, message: &str) -> OperationResult {
    OperationResult {
        outcome: OperationOutcome::Failed,
        result: None,
        error: Some(OperationError {
            code: "execution_failed".into(),
            message: Some(message.into()),
        }),
        ..value_result(request, Value::Null)
    }
}

fn submit(
    state: &erato::state::AppState,
    chat_id: Uuid,
    executor: Option<&ExecutorBinding>,
) -> axum_test::TestRequest {
    let mut request = app_server(state.clone())
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", TOOL)
        .json(&json!({"existing_chat_id":chat_id,"user_message":"When am I free this week?"}));
    if let Some(executor) = executor {
        request = request.add_header("X-Erato-Executor", serde_json::to_string(executor).unwrap());
    }
    request
}

async fn chat_attempts(state: &erato::state::AppState, chat_id: Uuid) -> Vec<attempts::Model> {
    attempts::Entity::find()
        .filter(attempts::Column::ChatId.eq(chat_id))
        .all(&state.db)
        .await
        .unwrap()
}

async fn attempt(state: &erato::state::AppState, id: Uuid) -> attempts::Model {
    attempts::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap()
}

/// Submits with the mailbox binding and a short timeout so the call parks.
async fn park(setup: &Setup) -> OperationRequest {
    let response = tokio::time::timeout(
        Duration::from_secs(15),
        submit(&setup.state, setup.chat_id, Some(&mailbox())),
    )
    .await
    .unwrap();
    response.assert_status_ok();
    assert!(client_tool_calls(&response) > 0);
    parked(setup).await
}

async fn parked(setup: &Setup) -> OperationRequest {
    let rows = chat_attempts(&setup.state, setup.chat_id).await;
    assert_eq!(
        rows.len(),
        1,
        "the timeout must become one logged operation"
    );
    let chat = chats::Entity::find_by_id(setup.chat_id)
        .one(&setup.state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(chat.generation_state.as_deref(), Some("awaiting_approval"));
    serde_json::from_value(rows[0].request.clone()).unwrap()
}

fn client_tool_calls(response: &axum_test::TestResponse) -> usize {
    parse_sse_events(response)
        .iter()
        .filter(|event| {
            serde_json::from_str::<Value>(&event.data)
                .is_ok_and(|value| value["message_type"] == "client_tool_call")
        })
        .count()
}

async fn claim(
    state: &erato::state::AppState,
    request: &OperationRequest,
    binding: &ExecutorBinding,
    confirmed: bool,
) -> axum_test::TestResponse {
    app_server(state.clone())
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/claim",
            request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", TOOL)
        .json(&json!({"binding":binding,"user_confirmed":confirmed}))
        .await
}

async fn claim_token(state: &erato::state::AppState, request: &OperationRequest) -> Value {
    let response = claim(state, request, &mailbox(), false).await;
    response.assert_status_ok();
    response.json::<Value>()["claim_token"].clone()
}

async fn post_result(
    state: &erato::state::AppState,
    token: &Value,
    result: &OperationResult,
) -> axum_test::TestResponse {
    app_server(state.clone())
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/result",
            result.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", TOOL)
        .json(&json!({"claim_token":token,"result":result}))
        .await
}

async fn continue_turn(state: &erato::state::AppState, id: Uuid) {
    app_server(state.clone())
        .post(&format!("/api/v1beta/me/client-operations/{id}/continue"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    wait_completed(state, id).await;
}

/// The message and call id of the chat's live `fetch_availability` call.
async fn live_call(state: &erato::state::AppState, chat_id: Uuid) -> (Uuid, String) {
    loop {
        if let Some(task) = state.background_tasks.get_task(&chat_id).await {
            for event in task.get_event_history().await {
                if let StreamingEvent::ClientToolCall {
                    message_id,
                    tool_call_id,
                    ..
                } = event
                {
                    return (message_id, tool_call_id);
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

async fn post_live(
    state: &erato::state::AppState,
    chat_id: Uuid,
    (message_id, tool_call_id): &(Uuid, String),
    mut body: Value,
    executor: Option<&ExecutorBinding>,
) -> axum_test::TestResponse {
    body["chat_id"] = json!(chat_id);
    body["message_id"] = json!(message_id);
    body["tool_call_id"] = json!(tool_call_id);
    let mut request = app_server(state.clone())
        .post("/api/v1beta/me/messages/clienttoolresult")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body);
    if let Some(executor) = executor {
        request = request.add_header("X-Erato-Executor", serde_json::to_string(executor).unwrap());
    }
    request.await
}

/// Runs a submit while answering its live call with `body`, and returns the
/// submit response and the answer's response.
async fn submit_and_answer(
    setup: &Setup,
    submit_executor: Option<&ExecutorBinding>,
    body: Value,
    answer_executor: Option<&ExecutorBinding>,
) -> (axum_test::TestResponse, axum_test::TestResponse) {
    tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(
            submit(&setup.state, setup.chat_id, submit_executor),
            async {
                let call = live_call(&setup.state, setup.chat_id).await;
                post_live(&setup.state, setup.chat_id, &call, body, answer_executor).await
            }
        )
    })
    .await
    .expect("turn did not finish")
}

async fn assistant_message(setup: &Setup) -> erato::db::entity::messages::Model {
    Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(setup.chat_id))
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&setup.state.db)
        .await
        .unwrap()
        .into_iter()
        .rfind(|row| row.raw_message["role"] == "assistant")
        .expect("assistant row")
}

fn call_output(message: &erato::db::entity::messages::Model) -> Value {
    message.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| {
            part["content_type"] == "tool_use"
                && part["tool_call_id"]
                    .as_str()
                    .is_some_and(|id| id.ends_with(&format!(":{CALL}")))
        })
        .map(|part| part["output"].clone())
        .unwrap_or(Value::Null)
}

/// The tool results the model saw in the last turn request, parsed when JSON.
fn last_tool_results(recorder: &RequestBodyRecorder) -> Vec<Value> {
    let requests = turn_requests(recorder);
    requests.last().expect("a turn request")["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|message| message["role"] == "tool")
        .map(|message| {
            message["content"]
                .as_str()
                .and_then(|content| serde_json::from_str(content).ok())
                .unwrap_or_else(|| message["content"].clone())
        })
        .collect()
}

fn offers_tool(body: &Value) -> bool {
    body["tools"]
        .as_array()
        .is_some_and(|tools| tools.iter().any(|tool| tool["function"]["name"] == TOOL))
}

fn offered_last(recorder: &RequestBodyRecorder) -> bool {
    offers_tool(turn_requests(recorder).last().unwrap())
}

async fn set_decision(state: &erato::state::AppState, decision: &str) {
    app_server(state.clone())
        .put("/api/v1beta/me/profile/preferences")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"client_tool_decisions":{QUALIFIED:decision}}))
        .await
        .assert_status_ok();
}

async fn assert_settled_in_memory(setup: &Setup, reason: &str) {
    assert!(chat_attempts(&setup.state, setup.chat_id).await.is_empty());
    let output = call_output(&assistant_message(setup).await);
    assert_eq!(output, json!({"status":"cancelled","reason":reason}));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn dropped_stream_parks_fetch_availability_and_a_second_tab_resumes_the_turn(
    pool: Pool<Postgres>,
) {
    use futures::StreamExt;
    use sea_orm::ConnectionTrait;
    let setup = setup(pool.clone(), 60_000, true, true).await;
    let state = &setup.state;
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
        .header("X-Erato-Client-Tools", TOOL)
        .header(
            "X-Erato-Executor",
            serde_json::to_string(&mailbox()).unwrap(),
        )
        .json(&json!({"existing_chat_id":setup.chat_id,"user_message":"When am I free?"}))
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
    let row = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(row) = chat_attempts(state, setup.chat_id).await.pop() {
                break row;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("a dropped stream should park without waiting for the timeout");
    assert_eq!(row.state, AttemptState::Pending);
    let request: OperationRequest = serde_json::from_value(row.request).unwrap();
    // The attempt commits while the generation still runs; claims wait for its release.
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let chat = chats::Entity::find_by_id(setup.chat_id)
                .one(&state.db)
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
    .expect("the parked generation should release as awaiting_approval");
    server.abort();

    // A second tab of the same add-in: same device id and mailbox, another replica.
    let replica = test_app_state(state.config.clone(), pool).await;
    assert!(replica.client_operations.for_operation(QUALIFIED).is_some());
    replica.db.execute_unprepared("TRUNCATE temp_chat_generation_commands, temp_chat_generation_events, temp_chat_generations CASCADE").await.unwrap();
    let inbox = app_server(replica.clone())
        .get("/api/v1beta/me/client-operations")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    inbox.assert_status_ok();
    assert_eq!(
        inbox.json::<Value>()["operations"][0]["request"]["attempt_id"],
        request.attempt_id.to_string()
    );
    let token = claim_token(&replica, &request).await;
    post_result(&replica, &token, &value_result(&request, availability()))
        .await
        .assert_status_ok();
    continue_turn(&replica, request.attempt_id).await;
    let message = assistant_message(&setup).await;
    assert!(message.raw_message.to_string().contains(ANSWER));
    assert!(
        !message
            .raw_message
            .to_string()
            .contains("client_tool_pending")
    );
    let requests = turn_requests(&setup.recorder);
    assert_eq!(requests.len(), 2);
    assert!(offered_last(&setup.recorder), "the tool must be re-offered");
    assert!(
        requests[1]["messages"]
            .to_string()
            .contains("AVAIL-SLOT-MARKER")
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn timeout_parks_fetch_availability_with_configured_expiry_and_lease(pool: Pool<Postgres>) {
    let setup = setup(pool, 10, true, true).await;
    let request = park(&setup).await;
    assert_eq!(request.kind, client_tool::CLIENT_TOOL_KIND);
    assert_eq!(request.operation_id, QUALIFIED);
    assert_eq!(request.consent, ConsentPolicy::None);
    assert_eq!(request.realm, ExecutionRealm::OfficeAddin);
    assert_eq!(request.binding, mailbox());
    let close = |actual: chrono::DateTime<chrono::Utc>, seconds: i64| {
        let expected = chrono::Utc::now() + chrono::Duration::seconds(seconds);
        assert!(
            (actual - expected).num_seconds().abs() <= 5,
            "{actual} is not {seconds} s from now"
        );
    };
    close(request.expires_at, 900);
    claim_token(&setup.state, &request).await;
    let row = attempt(&setup.state, request.attempt_id).await;
    close(row.expires_at.with_timezone(&chrono::Utc), 900);
    close(
        row.claim_expires_at.unwrap().with_timezone(&chrono::Utc),
        90,
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn live_fetch_availability_result_creates_no_attempt(pool: Pool<Postgres>) {
    let setup = setup(pool, 60_000, true, true).await;
    let (response, ()) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(
            submit(&setup.state, setup.chat_id, Some(&mailbox())),
            async {
                let call = live_call(&setup.state, setup.chat_id).await;
                let body = json!({"result":availability()});
                let unbound =
                    post_live(&setup.state, setup.chat_id, &call, body.clone(), None).await;
                unbound.assert_status_conflict();
                assert_eq!(unbound.text(), "Operation binding mismatch");
                let bound =
                    post_live(&setup.state, setup.chat_id, &call, body, Some(&mailbox())).await;
                bound.assert_status_ok();
                let answered = bound.json::<Value>();
                assert_eq!(answered["delivered"], true);
                assert_eq!(answered["stored"], false);
            }
        )
    })
    .await
    .unwrap();
    response.assert_status_ok();
    assert!(chat_attempts(&setup.state, setup.chat_id).await.is_empty());
    assert_eq!(turn_requests(&setup.recorder).len(), 2);
    let seen = last_tool_results(&setup.recorder);
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["status"], "success");
    assert_eq!(seen[0]["result"], availability());
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn late_live_result_settles_an_unclaimed_park_and_reports_it(pool: Pool<Postgres>) {
    let setup = setup(pool, 10, true, true).await;
    let request = park(&setup).await;
    let call = (request.message_id, request.tool_call_id.clone());
    let late = post_live(
        &setup.state,
        setup.chat_id,
        &call,
        json!({"result":availability()}),
        Some(&mailbox()),
    )
    .await;
    late.assert_status_ok();
    let answered = late.json::<Value>();
    assert_eq!(answered["delivered"], true);
    assert_eq!(answered["stored"], true);
    assert_eq!(
        attempt(&setup.state, request.attempt_id).await.state,
        AttemptState::Ready
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn claims_require_the_same_device_and_mailbox(pool: Pool<Postgres>) {
    let setup = setup(pool, 10, true, true).await;
    let request = park(&setup).await;
    let other_device = claim(
        &setup.state,
        &request,
        &mailbox_binding("device-two", 'a'),
        true,
    )
    .await;
    other_device.assert_status_conflict();
    assert_eq!(other_device.text(), "Operation consent required");
    let other_mailbox = claim(
        &setup.state,
        &request,
        &mailbox_binding("device-one", 'b'),
        false,
    )
    .await;
    other_mailbox.assert_status_conflict();
    assert_eq!(other_mailbox.text(), "Executor binding mismatch");
    let mut frontend = mailbox();
    frontend.realm = ExecutionRealm::Frontend;
    claim(&setup.state, &request, &frontend, false)
        .await
        .assert_status_conflict();
    claim(&setup.state, &request, &mailbox(), false)
        .await
        .assert_status_ok();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn duplicate_and_late_fetch_availability_results_are_fenced(pool: Pool<Postgres>) {
    let setup = setup(pool, 10, true, true).await;
    let request = park(&setup).await;
    let state = &setup.state;
    let token = claim_token(state, &request).await;
    let call = (request.message_id, request.tool_call_id.clone());
    let fast = json!({"result":availability()});
    let late = post_live(state, setup.chat_id, &call, fast.clone(), Some(&mailbox())).await;
    late.assert_status_conflict();
    assert_eq!(
        attempt(state, request.attempt_id).await.state,
        AttemptState::Claimed
    );

    let result = value_result(&request, availability());
    for _ in 0..2 {
        post_result(state, &token, &result).await.assert_status_ok();
    }
    let mut replacement = availability();
    replacement["legend"] = json!("changed");
    let replaced = post_result(state, &token, &value_result(&request, replacement.clone())).await;
    replaced.assert_status_conflict();
    assert_eq!(replaced.text(), "Operation already settled");
    let ready = attempt(state, request.attempt_id).await;
    assert_eq!(ready.state, AttemptState::Ready);
    assert_eq!(
        ready.result.unwrap(),
        serde_json::to_value(&result).unwrap()
    );

    continue_turn(state, request.attempt_id).await;
    let replay = post_result(state, &token, &result).await;
    replay.assert_status_ok();
    assert_eq!(replay.json::<Value>()["state"], "completed");
    post_result(state, &token, &value_result(&request, replacement))
        .await
        .assert_status_conflict();
    post_live(state, setup.chat_id, &call, fast, Some(&mailbox()))
        .await
        .assert_status_conflict();
    assert_eq!(turn_requests(&setup.recorder).len(), 2);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn expired_fetch_availability_continues_with_expired(pool: Pool<Postgres>) {
    use sea_orm::ConnectionTrait;
    let setup = setup(pool, 10, true, true).await;
    let request = park(&setup).await;
    setup.state.db.execute_unprepared(&format!("UPDATE client_operation_attempts SET expires_at = now() - interval '1 second' WHERE attempt_id = '{}'", request.attempt_id)).await.unwrap();
    claim(&setup.state, &request, &mailbox(), false)
        .await
        .assert_status_conflict();
    continue_turn(&setup.state, request.attempt_id).await;
    assert_eq!(
        call_output(&assistant_message(&setup).await),
        json!({"status":"cancelled","reason":"expired"})
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn malformed_fetch_availability_results_settle_with_fixed_feedback(pool: Pool<Postgres>) {
    let mut setup = setup(pool, 10, true, true).await;
    let schema_violation = json!({"legend":"MALFORMED-SECRET"});
    let reference = Some(OperationValue::Reference {
        reference: Uuid::new_v4(),
    });
    for case in ["schema", "reference"] {
        setup.chat_id = seed_origin_chat(&setup.state.db).await;
        let request = park(&setup).await;
        let token = claim_token(&setup.state, &request).await;
        let mut result = value_result(&request, schema_violation.clone());
        if case == "reference" {
            result.result = reference.clone();
        }
        for _ in 0..2 {
            let response = post_result(&setup.state, &token, &result).await;
            response.assert_status_ok();
            assert!(!response.text().contains("MALFORMED-SECRET"));
        }
        let row = attempt(&setup.state, request.attempt_id).await;
        assert_eq!(row.state, AttemptState::Ready, "{case}");
        assert_eq!(
            row.result.as_ref().unwrap()["error"]["code"],
            "invalid_operation_result"
        );
        assert!(!row.result.unwrap().to_string().contains("MALFORMED-SECRET"));
        continue_turn(&setup.state, request.attempt_id).await;
        let output = call_output(&assistant_message(&setup).await);
        assert_eq!(output, invalid_result_feedback().output, "{case}");
        assert!(
            assistant_message(&setup)
                .await
                .raw_message
                .to_string()
                .contains(ANSWER)
        );
    }

    set_timeout(&mut setup, 60_000);
    setup.chat_id = seed_origin_chat(&setup.state.db).await;
    let (response, answer) = submit_and_answer(
        &setup,
        Some(&mailbox()),
        json!({"result":schema_violation}),
        Some(&mailbox()),
    )
    .await;
    response.assert_status_ok();
    answer.assert_status_ok();
    assert!(chat_attempts(&setup.state, setup.chat_id).await.is_empty());
    let seen = last_tool_results(&setup.recorder);
    assert_eq!(seen.last().unwrap(), &invalid_result_feedback().output);
    assert!(
        !setup
            .recorder
            .bodies()
            .iter()
            .any(|body| body.contains("MALFORMED-SECRET"))
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn executor_error_text_reaches_the_model(pool: Pool<Postgres>) {
    let mut setup = setup(pool, 60_000, true, true).await;
    let long = format!("Calendar\nunavailable {}", "x".repeat(2000));
    let (response, answer) = submit_and_answer(
        &setup,
        Some(&mailbox()),
        json!({"error":long}),
        Some(&mailbox()),
    )
    .await;
    response.assert_status_ok();
    answer.assert_status_ok();
    let seen = last_tool_results(&setup.recorder);
    let error = seen.last().unwrap()["error"].as_str().unwrap().to_string();
    assert_eq!(seen.last().unwrap()["status"], "error");
    assert!(error.starts_with("Calendar unavailable x"), "{error}");
    assert_eq!(error.chars().count(), MAX_OPERATION_MESSAGE_CHARS);

    set_timeout(&mut setup, 10);
    setup.chat_id = seed_origin_chat(&setup.state.db).await;
    let request = park(&setup).await;
    let token = claim_token(&setup.state, &request).await;
    post_result(
        &setup.state,
        &token,
        &failed_result(&request, "Mailbox\nlocked"),
    )
    .await
    .assert_status_ok();
    continue_turn(&setup.state, request.attempt_id).await;
    let output = json!({"status":"error","error":"Mailbox locked"});
    assert_eq!(call_output(&assistant_message(&setup).await), output);
    assert_eq!(last_tool_results(&setup.recorder).last().unwrap(), &output);

    setup.chat_id = seed_origin_chat(&setup.state.db).await;
    let request = park(&setup).await;
    let token = claim_token(&setup.state, &request).await;
    post_result(
        &setup.state,
        &token,
        &failed_result(&request, &"y".repeat(MAX_OPERATION_MESSAGE_CHARS + 1)),
    )
    .await
    .assert_status_ok();
    let row = attempt(&setup.state, request.attempt_id).await;
    assert_eq!(
        row.result.unwrap()["error"],
        json!({"code":"invalid_operation_result"})
    );
}

async fn ask_card(setup: &Setup) -> (Uuid, String) {
    set_decision(&setup.state, "ask").await;
    let response = submit(&setup.state, setup.chat_id, Some(&mailbox())).await;
    response.assert_status_ok();
    assert_eq!(client_tool_calls(&response), 0, "ask must not dispatch");
    assert!(chat_attempts(&setup.state, setup.chat_id).await.is_empty());
    let message = assistant_message(setup).await;
    let card = message.raw_message["content"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(card["content_type"], "tool_approval_request");
    assert_eq!(card["kind"], "client_tool");
    (
        message.id,
        card["approvals"][0]["approval_id"]
            .as_str()
            .unwrap()
            .to_string(),
    )
}

fn answer_card(
    state: &erato::state::AppState,
    (message_id, approval_id): &(Uuid, String),
    decision: &str,
    executor: Option<&ExecutorBinding>,
) -> axum_test::TestRequest {
    let mut request = app_server(state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", TOOL)
        .json(&json!({"message_id":message_id,
            "decisions":[{"approval_id":approval_id,"decision":decision}]}));
    if let Some(executor) = executor {
        request = request.add_header("X-Erato-Executor", serde_json::to_string(executor).unwrap());
    }
    request
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn ask_shows_the_card_and_an_approved_call_parks_with_consent_none(pool: Pool<Postgres>) {
    let setup = setup(pool, 10, true, true).await;
    let card = ask_card(&setup).await;
    let response = tokio::time::timeout(
        Duration::from_secs(15),
        answer_card(&setup.state, &card, "approve", Some(&mailbox())),
    )
    .await
    .unwrap();
    response.assert_status_ok();
    assert_eq!(client_tool_calls(&response), 1);
    let request = parked(&setup).await;
    assert_eq!(request.consent, ConsentPolicy::None);
    assert_eq!(request.binding, mailbox());
    assert_eq!(request.message_id, card.0);
    let token = claim_token(&setup.state, &request).await;
    post_result(
        &setup.state,
        &token,
        &value_result(&request, availability()),
    )
    .await
    .assert_status_ok();
    continue_turn(&setup.state, request.attempt_id).await;
    let message = assistant_message(&setup).await;
    assert!(message.raw_message.to_string().contains(ANSWER));
    assert_eq!(call_output(&message)["status"], "success");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn rejected_fetch_availability_creates_no_attempt(pool: Pool<Postgres>) {
    let setup = setup(pool, 10, true, true).await;
    let card = ask_card(&setup).await;
    let response = tokio::time::timeout(
        Duration::from_secs(15),
        answer_card(&setup.state, &card, "reject", Some(&mailbox())),
    )
    .await
    .unwrap();
    response.assert_status_ok();
    assert_eq!(client_tool_calls(&response), 0);
    assert!(chat_attempts(&setup.state, setup.chat_id).await.is_empty());
    assert_eq!(
        call_output(&assistant_message(&setup).await)["status"],
        "rejected"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approval_from_another_executor_keeps_the_legacy_path(pool: Pool<Postgres>) {
    let mut setup = setup(pool, 10, true, true).await;
    let card = ask_card(&setup).await;
    tokio::time::timeout(
        Duration::from_secs(15),
        answer_card(&setup.state, &card, "approve", None),
    )
    .await
    .unwrap()
    .assert_status_ok();
    assert_settled_in_memory(&setup, "timeout").await;

    set_timeout(&mut setup, 60_000);
    setup.chat_id = seed_origin_chat(&setup.state.db).await;
    let card = ask_card(&setup).await;
    let other = mailbox_binding("device-two", 'a');
    let (response, answer) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(
            answer_card(&setup.state, &card, "approve", Some(&other)),
            async {
                let call = live_call(&setup.state, setup.chat_id).await;
                post_live(
                    &setup.state,
                    setup.chat_id,
                    &call,
                    json!({"result":availability()}),
                    None,
                )
                .await
            }
        )
    })
    .await
    .unwrap();
    response.assert_status_ok();
    answer.assert_status_ok();
    assert_eq!(answer.json::<Value>()["delivered"], true);
    assert!(chat_attempts(&setup.state, setup.chat_id).await.is_empty());
    assert_eq!(
        call_output(&assistant_message(&setup).await)["result"],
        availability()
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn ask_saved_after_park_does_not_block_the_claim(pool: Pool<Postgres>) {
    let setup = setup(pool, 10, true, true).await;
    let request = park(&setup).await;
    set_decision(&setup.state, "ask").await;
    let token = claim_token(&setup.state, &request).await;
    post_result(
        &setup.state,
        &token,
        &value_result(&request, availability()),
    )
    .await
    .assert_status_ok();
    continue_turn(&setup.state, request.attempt_id).await;
    assert_eq!(
        call_output(&assistant_message(&setup).await)["status"],
        "success"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_allow_is_neither_offered_nor_escalated(pool: Pool<Postgres>) {
    let setup = setup(pool, 10, true, true).await;
    set_decision(&setup.state, "never_allow").await;
    let response = submit(&setup.state, setup.chat_id, Some(&mailbox())).await;
    response.assert_status_ok();
    assert_eq!(client_tool_calls(&response), 0);
    assert!(chat_attempts(&setup.state, setup.chat_id).await.is_empty());
    assert!(
        !setup
            .recorder
            .bodies()
            .iter()
            .any(|body| offers_tool(&serde_json::from_str(body).unwrap())),
        "a tool the user never allows is not offered"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_allow_saved_after_park_withdraws_the_claim(pool: Pool<Postgres>) {
    let mut setup = setup(pool, 10, true, true).await;
    for stage in ["claim", "late_fast_result", "first_claimed_result"] {
        setup.chat_id = seed_origin_chat(&setup.state.db).await;
        set_decision(&setup.state, "always_allow").await;
        let request = park(&setup).await;
        let token = if stage == "first_claimed_result" {
            Some(claim_token(&setup.state, &request).await)
        } else {
            None
        };
        set_decision(&setup.state, "never_allow").await;
        let refused = match &token {
            Some(token) => {
                post_result(&setup.state, token, &value_result(&request, availability())).await
            }
            None if stage == "late_fast_result" => {
                post_live(
                    &setup.state,
                    setup.chat_id,
                    &(request.message_id, request.tool_call_id.clone()),
                    json!({"result":availability()}),
                    Some(&mailbox()),
                )
                .await
            }
            None => claim(&setup.state, &request, &mailbox(), false).await,
        };
        refused.assert_status_conflict();
        assert_eq!(refused.text(), "Operation authorization withdrawn");
        let row = attempt(&setup.state, request.attempt_id).await;
        assert_eq!(row.state, AttemptState::Ready);
        assert_eq!(row.result.unwrap()["error"]["code"], "withdrawn");
        let before = setup.recorder.bodies().len();
        continue_turn(&setup.state, request.attempt_id).await;
        let message = assistant_message(&setup).await;
        assert_eq!(
            call_output(&message),
            json!({"status":"cancelled","reason":"withdrawn"})
        );
        assert!(message.raw_message.to_string().contains(ANSWER));
        let resumed = setup.recorder.bodies()[before..].to_vec();
        assert!(!resumed.is_empty());
        assert!(
            !resumed
                .iter()
                .any(|body| offers_tool(&serde_json::from_str(body).unwrap())),
            "withdrawn tools are not re-offered"
        );
        assert!(
            !setup
                .recorder
                .bodies()
                .iter()
                .any(|body| body.contains("AVAIL-SLOT-MARKER")),
            "{stage}: a withdrawn result never reaches the model"
        );
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_allow_saved_during_the_live_wait_is_not_escalated(pool: Pool<Postgres>) {
    let setup = setup(pool, 2_000, true, true).await;
    let (response, ()) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(
            submit(&setup.state, setup.chat_id, Some(&mailbox())),
            async {
                live_call(&setup.state, setup.chat_id).await;
                set_decision(&setup.state, "never_allow").await;
            }
        )
    })
    .await
    .expect("turn did not finish");
    response.assert_status_ok();
    assert!(client_tool_calls(&response) > 0);
    assert_settled_in_memory(&setup, "withdrawn").await;
    assert!(
        assistant_message(&setup)
            .await
            .raw_message
            .to_string()
            .contains(ANSWER)
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn opted_in_tool_with_a_sidecar_binding_keeps_the_legacy_path(pool: Pool<Postgres>) {
    let mut setup = setup(pool, 10, true, true).await;
    let sidecar = ExecutorBinding {
        device_id: "s".repeat(32),
        realm: ExecutionRealm::DesktopSidecar,
        host_context: Some(HostContext {
            kind: "origin".into(),
            identity: "http://localhost:3130".into(),
        }),
    };
    submit(&setup.state, setup.chat_id, Some(&sidecar))
        .await
        .assert_status_ok();
    assert_settled_in_memory(&setup, "timeout").await;

    set_timeout(&mut setup, 60_000);
    setup.chat_id = seed_origin_chat(&setup.state.db).await;
    let (response, answer) = submit_and_answer(
        &setup,
        Some(&sidecar),
        json!({"result":availability()}),
        Some(&sidecar),
    )
    .await;
    response.assert_status_ok();
    assert_eq!(answer.json::<Value>()["delivered"], true);
    assert!(chat_attempts(&setup.state, setup.chat_id).await.is_empty());
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn tools_that_do_not_opt_in_still_time_out_in_memory(pool: Pool<Postgres>) {
    let setup = setup(pool, 10, true, false).await;
    assert!(
        setup
            .state
            .client_operations
            .for_operation(QUALIFIED)
            .is_none()
    );
    submit(&setup.state, setup.chat_id, Some(&mailbox()))
        .await
        .assert_status_ok();
    assert_settled_in_memory(&setup, "timeout").await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn disabled_flag_keeps_fetch_availability_in_memory(pool: Pool<Postgres>) {
    let mut setup = setup(pool, 10, false, true).await;
    assert!(
        setup
            .state
            .client_operations
            .for_operation(QUALIFIED)
            .is_none()
    );
    submit(&setup.state, setup.chat_id, Some(&mailbox()))
        .await
        .assert_status_ok();
    assert_settled_in_memory(&setup, "timeout").await;

    set_timeout(&mut setup, 60_000);
    setup.chat_id = seed_origin_chat(&setup.state.db).await;
    let (response, answer) = submit_and_answer(
        &setup,
        Some(&mailbox()),
        json!({"result":availability()}),
        Some(&mailbox()),
    )
    .await;
    response.assert_status_ok();
    assert_eq!(answer.json::<Value>()["delivered"], true);
    assert!(chat_attempts(&setup.state, setup.chat_id).await.is_empty());
    // The legacy fast path hands the model the raw result, not the kind's wrapper.
    assert_eq!(
        last_tool_results(&setup.recorder).last().unwrap(),
        &availability()
    );
    let inbox = app_server(setup.state.clone())
        .get("/api/v1beta/me/client-operations")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    inbox.assert_status_ok();
    assert_eq!(inbox.json::<Value>()["enabled"], false);
    assert_eq!(inbox.json::<Value>()["operations"], json!([]));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn opted_in_tool_without_a_binding_keeps_the_legacy_path(pool: Pool<Postgres>) {
    let mut setup = setup(pool, 10, true, true).await;
    submit(&setup.state, setup.chat_id, None)
        .await
        .assert_status_ok();
    assert_settled_in_memory(&setup, "timeout").await;

    set_timeout(&mut setup, 60_000);
    setup.chat_id = seed_origin_chat(&setup.state.db).await;
    let (response, answer) =
        submit_and_answer(&setup, None, json!({"result":availability()}), None).await;
    response.assert_status_ok();
    assert_eq!(answer.json::<Value>()["delivered"], true);
    assert!(chat_attempts(&setup.state, setup.chat_id).await.is_empty());
}

mod attached;
