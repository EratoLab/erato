//! A user's own desktop sidecar call that waits for its review in the Erato
//! desktop app: the client asks the generation to park the call as its
//! durable operation, so the turn waits for the decision without the tool's
//! timeout, and the call's result resumes it.
use super::*;

const SEARCH: &str = "search_sidecar_index";
const SEARCH_CALL: &str = "search-call";
const SEARCH_ANSWER: &str = "SEARCH-ANSWER";
const HIT: &str = "APPROVED-HIT-MARKER";
const DECLINED: &str = "The user declined sharing this result in the Erato desktop app. Do not retry without their permission.";
/// Far beyond each test's own deadline, so only a park ends the live wait.
const TIMEOUT_MS: u64 = 600_000;

async fn setup_search(pool: Pool<Postgres>, durable: bool) -> Setup {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[SEARCH_CALL]))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                SEARCH_CALL,
                SEARCH,
                json!({"text": "quarterly report"}),
            )]),
        );
    });
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[SEARCH_CALL], &[]))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[SEARCH_ANSWER]));
    });
    let (mut config, mock) = setup_mock_llm_server_with_mocks(mocks).await;
    config.client_tools.durable_operations_enabled = true;
    config.client_tools.tools.insert(
        "desktop_search_index".into(),
        search_tool(TIMEOUT_MS, durable),
    );
    config.facets.tool_call_allowlist = vec!["desktop/*".into()];
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    Setup {
        state,
        _mock: mock,
        recorder,
        chat_id,
    }
}

fn search_tool(timeout_ms: u64, durable: bool) -> ClientToolConfig {
    ClientToolConfig {
        name: SEARCH.into(),
        namespace: Some("desktop".into()),
        description: "Search the local index".into(),
        parameters: json!({"type":"object","properties":{"text":{"type":"string"}}}).to_string(),
        requires_client_registration: true,
        timeout_ms: Some(timeout_ms),
        host_context: Some(erato::config::ClientToolHostContext::DesktopSidecar),
        durable: durable.then_some(erato::config::ClientToolDurableConfig {
            host_context: erato::config::ClientToolHostContext::DesktopSidecar,
            result_schema: None,
            attempt_expiry_secs: 86_400,
            claim_lease_secs: 120,
        }),
        ..Default::default()
    }
}

/// The binding every Erato window of one desktop app installation sends.
fn sidecar() -> ExecutorBinding {
    ExecutorBinding {
        device_id: "installation-one".into(),
        realm: ExecutionRealm::DesktopSidecar,
        host_context: Some(HostContext {
            kind: "desktop_sidecar".into(),
            identity: "local".into(),
        }),
    }
}

/// A web app turn: the sidecar binding alone in the additional executors.
fn submit_search(state: &erato::state::AppState, chat_id: Uuid) -> axum_test::TestRequest {
    app_server(state.clone())
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", SEARCH)
        .add_header(
            "X-Erato-Additional-Executors",
            serde_json::to_string(&[sidecar()]).unwrap(),
        )
        .json(&json!({"existing_chat_id":chat_id,"user_message":"Find the quarterly report"}))
}

async fn post_park(
    state: &erato::state::AppState,
    chat_id: Uuid,
    (message_id, tool_call_id): &(Uuid, String),
    executor: Option<&ExecutorBinding>,
) -> axum_test::TestResponse {
    let mut request = app_server(state.clone())
        .post("/api/v1beta/me/messages/clienttoolpark")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"chat_id":chat_id,"message_id":message_id,"tool_call_id":tool_call_id}));
    if let Some(executor) = executor {
        request = request.add_header("X-Erato-Executor", serde_json::to_string(executor).unwrap());
    }
    request.await
}

/// Submits the search and, once its call is live, asks `parking` to park it
/// with the sidecar's binding; returns the parked operation and the call.
async fn park_on_review(
    setup: &Setup,
    parking: &erato::state::AppState,
) -> (OperationRequest, (Uuid, String)) {
    let (response, call) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(submit_search(&setup.state, setup.chat_id), async {
            let call = live_call(&setup.state, setup.chat_id).await;
            for wrong in [None, Some(&mailbox())] {
                let refused = post_park(&setup.state, setup.chat_id, &call, wrong).await;
                refused.assert_status_conflict();
                assert_eq!(refused.text(), "Operation binding mismatch");
            }
            let parked = post_park(parking, setup.chat_id, &call, Some(&sidecar())).await;
            parked.assert_status_ok();
            assert_eq!(parked.json::<Value>()["requested"], true);
            call
        })
    })
    .await
    .expect("the review should park the turn instead of waiting out the timeout");
    response.assert_status_ok();
    let request = parked(setup).await;
    (request, call)
}

fn assert_parked_for_a_day(setup: &Setup, request: &OperationRequest) {
    assert_eq!(request.kind, client_tool::CLIENT_TOOL_KIND);
    assert_eq!(request.operation_id, "desktop/search_sidecar_index");
    assert_eq!(request.realm, ExecutionRealm::DesktopSidecar);
    assert_eq!(request.consent, ConsentPolicy::None);
    assert_eq!(request.binding, sidecar());
    assert!(request.lineage.is_none());
    let left = request.expires_at - chrono::Utc::now();
    assert!(
        (left - chrono::Duration::seconds(86_400))
            .num_seconds()
            .abs()
            <= 30,
        "the attempt lives for its configured day, not the tool's timeout: {left}"
    );
    // The model has not been asked again while the review waits.
    assert_eq!(turn_requests(&setup.recorder).len(), 1);
}

async fn parts(setup: &Setup) -> Vec<Value> {
    Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(setup.chat_id))
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&setup.state.db)
        .await
        .unwrap()
        .into_iter()
        .rfind(|row| row.raw_message["role"] == "assistant")
        .expect("assistant row")
        .raw_message["content"]
        .as_array()
        .unwrap()
        .clone()
}

async fn last_part(setup: &Setup) -> Value {
    parts(setup).await.last().cloned().unwrap()
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_review_on_the_device_parks_the_turn_until_the_approved_result_resumes_it(
    pool: Pool<Postgres>,
) {
    let setup = setup_search(pool, true).await;
    let (request, call) = park_on_review(&setup, &setup.state).await;
    assert_parked_for_a_day(&setup, &request);
    let pending = last_part(&setup).await;
    assert_eq!(pending["content_type"], "client_tool_pending");
    assert_eq!(pending["attempt_id"], request.attempt_id.to_string());

    // The live executor kept polling the review; the user approved there.
    let approved = post_live(
        &setup.state,
        setup.chat_id,
        &call,
        json!({"result": {"hits": [{"title": HIT}]}}),
        Some(&sidecar()),
    )
    .await;
    approved.assert_status_ok();
    assert_eq!(approved.json::<Value>()["stored"], true);
    assert_eq!(
        attempt(&setup.state, request.attempt_id).await.state,
        AttemptState::Ready
    );
    continue_turn(&setup.state, request.attempt_id).await;
    let requests = turn_requests(&setup.recorder);
    assert_eq!(requests.len(), 2);
    let seen = last_tool_results(&setup.recorder);
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["status"], "success");
    assert_eq!(seen[0]["result"]["hits"][0]["title"], HIT);
    let answer = last_part(&setup).await;
    assert!(answer.to_string().contains(SEARCH_ANSWER));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_declined_review_resumes_the_turn_with_its_do_not_retry_error(pool: Pool<Postgres>) {
    let setup = setup_search(pool, true).await;
    let (request, call) = park_on_review(&setup, &setup.state).await;
    post_live(
        &setup.state,
        setup.chat_id,
        &call,
        json!({"error": DECLINED}),
        Some(&sidecar()),
    )
    .await
    .assert_status_ok();
    continue_turn(&setup.state, request.attempt_id).await;
    let seen = last_tool_results(&setup.recorder);
    assert_eq!(seen, vec![json!({"status": "error", "error": DECLINED})]);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_park_request_reaches_a_generation_on_another_replica(pool: Pool<Postgres>) {
    let setup = setup_search(pool.clone(), true).await;
    let replica = test_app_state(setup.state.config.clone(), pool).await;
    assert!(
        replica
            .background_tasks
            .get_task(&setup.chat_id)
            .await
            .is_none()
    );
    let (request, _) = park_on_review(&setup, &replica).await;
    assert_parked_for_a_day(&setup, &request);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_park_request_leaves_a_call_without_a_durable_operation_live(pool: Pool<Postgres>) {
    let setup = setup_search(pool, false).await;
    let (response, ()) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(submit_search(&setup.state, setup.chat_id), async {
            let call = live_call(&setup.state, setup.chat_id).await;
            let ignored = post_park(&setup.state, setup.chat_id, &call, Some(&sidecar())).await;
            ignored.assert_status_ok();
            assert_eq!(ignored.json::<Value>()["requested"], false);
            let answered = post_live(
                &setup.state,
                setup.chat_id,
                &call,
                json!({"result": {"hits": [{"title": HIT}]}}),
                None,
            )
            .await;
            answered.assert_status_ok();
            assert_eq!(answered.json::<Value>()["delivered"], true);
        })
    })
    .await
    .expect("the live call should still take its result");
    response.assert_status_ok();
    assert!(chat_attempts(&setup.state, setup.chat_id).await.is_empty());
    assert_eq!(turn_requests(&setup.recorder).len(), 2);
    assert!(last_part(&setup).await.to_string().contains(SEARCH_ANSWER));
}

// A task started in the same step as a call that then waits durably: its
// question stays in the one approval slot, on the waiting call (ERMAIN-1156).

const TURN: &str = "Find the report and publish the probe";
const TASK_CALL: &str = "task-call";
const TASK_BRIEF: &str = "TASK-BRIEF: publish the probe";
const PROBE: &str = "publish_approval_probe";
const PROBE_RESULT: &str = "approval probe published";
const TASK_ANSWER: &str = "TASK-ANSWER-AFTER-THE-PROBE";
const TURN_ANSWER: &str = "TURN-ANSWER-AFTER-BOTH";
/// The answer of a turn that stopped at the tool-call limit before the search
/// ran, once its task has answered.
const LIMIT_ANSWER: &str = "LIMIT-ANSWER-WITH-THE-TASK";
/// The call of a task that asks a second time.
const SECOND_PROBE: &str = "task-probe-2";
/// Long enough that the own call is popped and parks before the task asks: a
/// task that asked first holds that call back, which is not the case here.
const TASK_ASKS_AFTER: Duration = Duration::from_millis(1_500);
/// How long an answered task keeps running, for what lands during its run.
const TASK_ANSWERS_AFTER: Duration = Duration::from_millis(1_500);

async fn setup_search_and_task(pool: Pool<Postgres>, timeout_ms: u64, asks_twice: bool) -> Setup {
    setup_search_and_paced_task(pool, timeout_ms, asks_twice, Duration::ZERO).await
}

async fn setup_search_and_paced_task(
    pool: Pool<Postgres>,
    timeout_ms: u64,
    asks_twice: bool,
    answers_after: Duration,
) -> Setup {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[TURN], &[TASK_BRIEF]))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[
                (
                    TASK_CALL,
                    "delegate_task",
                    json!({"task": TASK_BRIEF, "facet_ids": ["plan"]}),
                ),
                (SEARCH_CALL, SEARCH, json!({"text": "quarterly report"})),
            ]),
        );
    });
    // Excluded on the parent's envelope, as in the delegation tests: only the
    // parent's replayed tool responses carry `child_run_id`.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[TASK_BRIEF],
                &["child_run_id", PROBE_RESULT],
            ));
        let mut actions = vec![BodyAction::Delay(TASK_ASKS_AFTER)];
        actions.extend(build_openai_tool_calls_streaming_response(&[(
            "task-probe",
            PROBE,
            json!({}),
        )]));
        mock_llm_sse_response(then, actions);
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[TASK_BRIEF, PROBE_RESULT],
                &["child_run_id", SECOND_PROBE],
            ));
        let mut actions = vec![BodyAction::Delay(answers_after)];
        actions.extend(if asks_twice {
            build_openai_tool_calls_streaming_response(&[(SECOND_PROBE, PROBE, json!({}))])
        } else {
            build_openai_text_streaming_response(&[TASK_ANSWER])
        });
        mock_llm_sse_response(then, actions);
    });
    // A task that asked twice answers once its second call ran.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[TASK_BRIEF, SECOND_PROBE],
                &["child_run_id"],
            ));
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[TASK_ANSWER]));
    });
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[TURN, "child_run_id", HIT], &[]))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[TURN_ANSWER]));
    });
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[TURN, "child_run_id", TASK_ANSWER],
                &[HIT],
            ))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[LIMIT_ANSWER]));
    });
    let (mut config, mock) = setup_mock_llm_server_with_mocks(mocks).await;
    config.client_tools.durable_operations_enabled = true;
    config
        .client_tools
        .tools
        .insert("desktop_search_index".into(), search_tool(timeout_ms, true));
    config.delegation.tasks.enabled = true;
    config.facets.facets.insert(
        "plan".to_string(),
        erato::config::FacetConfig {
            display_name: "Plan & delegate".to_string(),
            icon: None,
            additional_system_prompt: None,
            tool_call_allowlist: ["erato/delegate_task", "mock_mcp_approval/*", "desktop/*"]
                .map(String::from)
                .to_vec(),
            disable_facet_prompt_template: true,
            ..Default::default()
        },
    );
    config.mcp_servers.insert(
        "mock_mcp_approval".to_string(),
        erato::config::McpServerConfig {
            display_name: None,
            approval_argument: None,
            protocol_mode: Default::default(),
            transport_type: "streamable_http".to_string(),
            url: format!("{}/mcp/approval-policy", mock_mcp_base_url()),
            http_headers: None,
            allow_tools: None,
            exclude_tools: vec![],
            wait_tools: vec![],
            authentication: erato::config::McpServerAuthenticationConfig::None,
            max_session_idle_seconds: None,
            default_tool_annotations: Default::default(),
            override_tool_annotations: Default::default(),
            tools: Default::default(),
            glossary: Default::default(),
        },
    );
    config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".to_string()],
        },
    );
    config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    Setup {
        state,
        _mock: mock,
        recorder,
        chat_id,
    }
}

fn submit_search_and_task(state: &erato::state::AppState, chat_id: Uuid) -> axum_test::TestRequest {
    app_server(state.clone())
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", SEARCH)
        .add_header(
            "X-Erato-Additional-Executors",
            serde_json::to_string(&[sidecar()]).unwrap(),
        )
        .json(&json!({
            "existing_chat_id": chat_id,
            "user_message": TURN,
            "input_files_ids": [],
            "selected_facet_ids": ["plan"],
        }))
}

/// Parks the own search on its review while the task it started in the same
/// step is about to ask, and returns the parked operation and the call.
async fn park_search_and_task(setup: &Setup) -> (OperationRequest, (Uuid, String)) {
    let (response, call) = tokio::time::timeout(Duration::from_secs(30), async {
        tokio::join!(submit_search_and_task(&setup.state, setup.chat_id), async {
            let call = live_call(&setup.state, setup.chat_id).await;
            let parked = post_park(&setup.state, setup.chat_id, &call, Some(&sidecar())).await;
            parked.assert_status_ok();
            assert_eq!(parked.json::<Value>()["requested"], true);
            call
        })
    })
    .await
    .expect("the task's question and the review should park the turn");
    response.assert_status_ok();
    let request = parked(setup).await;
    (request, call)
}

/// The turn ends on one stop: the waiting call's part, right behind it the
/// part that asks the task's question. Returns the question's item.
fn assert_rides_on_the_waiting_call(content: &[Value], request: &OperationRequest) -> Value {
    let [.., pending, stop] = content else {
        panic!("too few parts: {content:?}");
    };
    assert_eq!(
        pending["content_type"], "client_tool_pending",
        "{content:?}"
    );
    assert_eq!(pending["attempt_id"], json!(request.attempt_id));
    assert_eq!(stop["content_type"], "tool_approval_request", "{content:?}");
    assert_eq!(stop["kind"], "delegated_task");
    let [item] = stop["approvals"].as_array().unwrap().as_slice() else {
        panic!("one question: {stop}");
    };
    assert_eq!(item["child"]["tool_name"], PROBE, "{stop}");
    assert!(item["child"]["waiting_for"].is_null(), "a question: {item}");
    item.clone()
}

fn slot(content: &[Value], tool_call_id: &str) -> Value {
    content
        .iter()
        .find(|part| {
            part["content_type"] == "tool_use"
                && part["tool_call_id"].as_str().is_some_and(|id| {
                    id == tool_call_id || id.ends_with(&format!(":{tool_call_id}"))
                })
        })
        .unwrap_or_else(|| panic!("no slot for {tool_call_id}: {content:?}"))
        .clone()
}

async fn decide(state: &erato::state::AppState, message_id: Uuid, approval_id: &Value) {
    app_server(state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": message_id,
            "decisions": [{"approval_id": approval_id, "decision": "approve"}],
            "shows_child_items": true,
        }))
        .await
        .assert_status_ok();
}

async fn generation_state(setup: &Setup) -> Option<String> {
    chats::Entity::find_by_id(setup.chat_id)
        .one(&setup.state.db)
        .await
        .unwrap()
        .unwrap()
        .generation_state
}

fn delegate_child(content: &[Value]) -> Uuid {
    Uuid::parse_str(
        slot(content, TASK_CALL)["output"]["delegate_chat_id"]
            .as_str()
            .unwrap(),
    )
    .unwrap()
}

/// Waits until the answered task's own run is under way, with the parent's
/// continuation waiting for it.
async fn task_runs_again(setup: &Setup, child: Uuid) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let chat = chats::Entity::find_by_id(child)
                .one(&setup.state.db)
                .await
                .unwrap()
                .unwrap();
            if chat.generation_state.as_deref() == Some("running") {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("the answered task should run again");
}

async fn child_row(setup: &Setup, chat_id: Uuid) -> erato::db::entity::messages::Model {
    Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&setup.state.db)
        .await
        .unwrap()
        .into_iter()
        .rfind(|row| row.raw_message["role"] == "assistant")
        .expect("the child's assistant row")
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_tasks_question_rides_on_the_waiting_call_and_its_answer_keeps_the_call_open(
    pool: Pool<Postgres>,
) {
    let setup = setup_search_and_task(pool, TIMEOUT_MS, false).await;
    let (request, call) = park_search_and_task(&setup).await;
    let content = parts(&setup).await;
    let item = assert_rides_on_the_waiting_call(&content, &request);
    assert_eq!(
        slot(&content, TASK_CALL)["output"]["status"],
        "input_required"
    );
    assert_eq!(
        generation_state(&setup).await.as_deref(),
        Some("awaiting_approval")
    );
    assert_eq!(turn_requests(&setup.recorder).len(), 1);

    // The person answers in the slot, before the review on the device.
    decide(&setup.state, call.0, &item["approval_id"]).await;
    let content = parts(&setup).await;
    let task = slot(&content, TASK_CALL);
    assert_eq!(task["status"], "success", "{task}");
    assert!(
        task["output"]["result"]
            .as_str()
            .unwrap()
            .contains(TASK_ANSWER)
    );
    let pending = content.last().unwrap();
    assert_eq!(
        pending["content_type"], "client_tool_pending",
        "{content:?}"
    );
    assert_eq!(pending["attempt_id"], json!(request.attempt_id));
    assert_eq!(
        attempt(&setup.state, request.attempt_id).await.state,
        AttemptState::Pending
    );
    assert_eq!(
        generation_state(&setup).await.as_deref(),
        Some("awaiting_approval")
    );
    assert_eq!(
        turn_requests(&setup.recorder).len(),
        1,
        "the model waits for the call's result"
    );

    // The review ends; the turn answers with both.
    post_live(
        &setup.state,
        setup.chat_id,
        &call,
        json!({"result": {"hits": [{"title": HIT}]}}),
        Some(&sidecar()),
    )
    .await
    .assert_status_ok();
    continue_turn(&setup.state, request.attempt_id).await;
    assert_eq!(turn_requests(&setup.recorder).len(), 2);
    let content = parts(&setup).await;
    assert!(content.last().unwrap().to_string().contains(TURN_ANSWER));
    assert!(
        !content
            .iter()
            .any(|part| part["content_type"] == "client_tool_pending"),
        "{content:?}"
    );
}

/// The same when the call waits on its own, without a review on the device:
/// a durable tool that outlives its live window (normal mode).
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_tasks_question_also_rides_on_a_call_that_waits_without_a_review(pool: Pool<Postgres>) {
    let setup = setup_search_and_task(pool, 200, false).await;
    let response = tokio::time::timeout(
        Duration::from_secs(30),
        submit_search_and_task(&setup.state, setup.chat_id),
    )
    .await
    .expect("the call should outlive its live window and park");
    response.assert_status_ok();
    let request = parked(&setup).await;
    assert_rides_on_the_waiting_call(&parts(&setup).await, &request);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_calls_result_leaves_the_turn_on_the_tasks_open_question(pool: Pool<Postgres>) {
    let setup = setup_search_and_task(pool, TIMEOUT_MS, false).await;
    let (request, call) = park_search_and_task(&setup).await;
    let content = parts(&setup).await;
    let item = assert_rides_on_the_waiting_call(&content, &request);

    // The review ends first: the result is in, the question still open.
    post_live(
        &setup.state,
        setup.chat_id,
        &call,
        json!({"result": {"hits": [{"title": HIT}]}}),
        Some(&sidecar()),
    )
    .await
    .assert_status_ok();
    continue_turn(&setup.state, request.attempt_id).await;
    let content = parts(&setup).await;
    let stop = content.last().unwrap();
    assert_eq!(stop["content_type"], "tool_approval_request", "{content:?}");
    assert_eq!(stop["approvals"][0]["approval_id"], item["approval_id"]);
    assert!(
        !content
            .iter()
            .any(|part| part["content_type"] == "client_tool_pending"),
        "{content:?}"
    );
    assert_eq!(slot(&content, SEARCH_CALL)["status"], "success");
    assert_eq!(
        generation_state(&setup).await.as_deref(),
        Some("awaiting_approval")
    );
    assert_eq!(
        turn_requests(&setup.recorder).len(),
        1,
        "the question comes first"
    );

    decide(&setup.state, call.0, &item["approval_id"]).await;
    assert_eq!(turn_requests(&setup.recorder).len(), 2);
    let content = parts(&setup).await;
    assert!(content.last().unwrap().to_string().contains(TURN_ANSWER));
    assert_eq!(slot(&content, TASK_CALL)["status"], "success");
}

/// The review ends while the answered task's run holds the chat on this
/// replica. That run knows nothing of the call, so the result goes to the
/// logged inbox; a delivery to the run would drop it and run the tool again.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_result_posted_while_the_answered_task_runs_settles_the_waiting_call(
    pool: Pool<Postgres>,
) {
    let setup = setup_search_and_paced_task(pool, TIMEOUT_MS, false, TASK_ANSWERS_AFTER).await;
    let (request, call) = park_search_and_task(&setup).await;
    let content = parts(&setup).await;
    let item = assert_rides_on_the_waiting_call(&content, &request);
    let child = delegate_child(&content);

    let (_, posted) = tokio::join!(decide(&setup.state, call.0, &item["approval_id"]), async {
        task_runs_again(&setup, child).await;
        post_live(
            &setup.state,
            setup.chat_id,
            &call,
            json!({"result": {"hits": [{"title": HIT}]}}),
            Some(&sidecar()),
        )
        .await
    });
    posted.assert_status_ok();
    assert_eq!(posted.json::<Value>()["stored"], true, "{}", posted.text());
    assert_eq!(
        attempt(&setup.state, request.attempt_id).await.state,
        AttemptState::Ready
    );
    let content = parts(&setup).await;
    assert_eq!(slot(&content, TASK_CALL)["status"], "success");
    let pending = content.last().unwrap();
    assert_eq!(
        pending["content_type"], "client_tool_pending",
        "the turn stays on the call until its continuation: {content:?}"
    );
    assert_eq!(pending["attempt_id"], json!(request.attempt_id));

    continue_turn(&setup.state, request.attempt_id).await;
    assert_eq!(turn_requests(&setup.recorder).len(), 2);
    let content = parts(&setup).await;
    assert!(content.last().unwrap().to_string().contains(TURN_ANSWER));
    assert!(
        !content
            .iter()
            .any(|part| part["content_type"] == "client_tool_pending"),
        "{content:?}"
    );
}

/// Stop while an answered task runs ends the waiting call. The run still holds
/// its earlier copy of the row, and that copy must not bring the call back.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn stopping_the_turn_while_the_answered_task_runs_ends_the_waiting_call(
    pool: Pool<Postgres>,
) {
    let setup = setup_search_and_paced_task(pool, TIMEOUT_MS, false, TASK_ANSWERS_AFTER).await;
    let (request, call) = park_search_and_task(&setup).await;
    let content = parts(&setup).await;
    let item = assert_rides_on_the_waiting_call(&content, &request);
    let child = delegate_child(&content);

    tokio::join!(decide(&setup.state, call.0, &item["approval_id"]), async {
        task_runs_again(&setup, child).await;
        app_server(setup.state.clone())
            .post("/api/v1beta/me/messages/abortstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({"chat_id": setup.chat_id}))
            .await
            .assert_status_ok();
    });

    assert_eq!(
        attempt(&setup.state, request.attempt_id).await.state,
        AttemptState::Completed
    );
    let content = parts(&setup).await;
    assert!(
        content
            .iter()
            .all(|part| part["content_type"] != "client_tool_pending"),
        "a stopped turn waits for nothing: {content:?}"
    );
    let search = slot(&content, SEARCH_CALL);
    assert_eq!(search["status"], "error", "{search}");
    assert_eq!(search["output"]["status"], "cancelled", "{search}");
    assert_eq!(
        slot(&content, TASK_CALL)["status"],
        "success",
        "the answered task still ran: {content:?}"
    );
    assert_eq!(
        turn_requests(&setup.recorder).len(),
        1,
        "the stopped turn asks the model nothing"
    );
}

/// The fallback the slot cannot hold: the user stopped the turn. The question
/// goes back to the task's own chat, and only there can it be answered.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn stopping_the_turn_sends_the_tasks_question_back_to_its_own_chat(pool: Pool<Postgres>) {
    let setup = setup_search_and_task(pool, TIMEOUT_MS, false).await;
    let (request, _call) = park_search_and_task(&setup).await;
    let content = parts(&setup).await;
    assert_rides_on_the_waiting_call(&content, &request);
    let child = delegate_child(&content);

    // Covered while it sits on the parent's stop.
    let covered = app_server(setup.state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"message_id": child_row(&setup, child).await.id, "decision": "approve"}))
        .await;
    assert_eq!(
        covered.status_code(),
        http::StatusCode::CONFLICT,
        "{}",
        covered.text()
    );
    assert_eq!(covered.json::<Value>()["code"], "covered_by_parent");

    app_server(setup.state.clone())
        .post("/api/v1beta/me/messages/abortstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"chat_id": setup.chat_id}))
        .await
        .assert_status_ok();
    let content = parts(&setup).await;
    assert!(
        content
            .iter()
            .all(|part| part["content_type"] != "tool_approval_request"
                && part["content_type"] != "client_tool_pending"),
        "{content:?}"
    );
    assert_eq!(
        slot(&content, TASK_CALL)["output"]["status"],
        "input_required"
    );

    let answered = app_server(setup.state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"message_id": child_row(&setup, child).await.id, "decision": "approve"}))
        .await;
    answered.assert_status_ok();
    assert!(
        answered.text().contains(TASK_ANSWER),
        "the child's own card answers it: {}",
        answered.text()
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_second_question_from_the_task_stays_on_the_waiting_call(pool: Pool<Postgres>) {
    let setup = setup_search_and_task(pool, TIMEOUT_MS, true).await;
    let (request, call) = park_search_and_task(&setup).await;
    let content = parts(&setup).await;
    let first = assert_rides_on_the_waiting_call(&content, &request);

    decide(&setup.state, call.0, &first["approval_id"]).await;
    let content = parts(&setup).await;
    let second = assert_rides_on_the_waiting_call(&content, &request);
    assert!(
        second["child"]["child_tool_call_id"]
            .as_str()
            .unwrap()
            .ends_with("task-probe-2")
    );
    assert_eq!(
        attempt(&setup.state, request.attempt_id).await.state,
        AttemptState::Pending
    );
    assert_eq!(
        generation_state(&setup).await.as_deref(),
        Some("awaiting_approval")
    );
    assert_eq!(
        turn_requests(&setup.recorder).len(),
        1,
        "the call and the task still wait"
    );
}

// The tool-call limit's stop carries the task's question as any stop does
// (ERMAIN-1164): the search reaches the limit, the task launched before it
// asks, and the turn ends on one stop holding both.

/// Submits the search and the task with room for one tool call, and returns
/// the parent's message id with the limit's item and the task's.
async fn park_on_the_limit(setup: &mut Setup) -> (Uuid, Value, Value) {
    setup.state.config.generation.max_tool_calls_per_message = 1;
    let response = tokio::time::timeout(
        Duration::from_secs(30),
        submit_search_and_task(&setup.state, setup.chat_id),
    )
    .await
    .expect("the limit and the task's question should park the turn");
    response.assert_status_ok();
    let content = parts(setup).await;
    let stop = content.last().unwrap();
    assert_eq!(stop["content_type"], "tool_approval_request", "{content:?}");
    assert_eq!(stop["kind"], "tool_call_limit", "{stop}");
    assert_eq!(stop["input"]["budget"], 1, "{stop}");
    assert!(
        stop["pending_tool_calls"].to_string().contains(SEARCH_CALL),
        "the search waits for the limit's choice: {stop}"
    );
    let [budget, task] = stop["approvals"].as_array().unwrap().as_slice() else {
        panic!("the limit's choice and the task's question: {stop}");
    };
    assert_eq!(budget["approval_id"], stop["tool_call_id"], "{stop}");
    assert!(budget["child"].is_null(), "{budget}");
    assert_eq!(task["child"]["tool_name"], PROBE, "{task}");
    assert!(task["child"]["waiting_for"].is_null(), "a question: {task}");
    assert_eq!(
        slot(&content, TASK_CALL)["output"]["status"],
        "input_required"
    );
    assert_eq!(
        generation_state(setup).await.as_deref(),
        Some("awaiting_approval")
    );
    assert_eq!(turn_requests(&setup.recorder).len(), 1);
    let message_id = child_row(setup, setup.chat_id).await.id;
    (message_id, budget.clone(), task.clone())
}

fn decide_limit(
    state: &erato::state::AppState,
    message_id: Uuid,
    decisions: &[(&Value, &str)],
) -> axum_test::TestRequest {
    app_server(state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", SEARCH)
        .add_header(
            "X-Erato-Additional-Executors",
            serde_json::to_string(&[sidecar()]).unwrap(),
        )
        .json(&json!({
            "message_id": message_id,
            "decisions": decisions
                .iter()
                .map(|(item, decision)| json!({
                    "approval_id": item["approval_id"],
                    "decision": decision,
                }))
                .collect::<Vec<_>>(),
            "shows_child_items": true,
            "shows_limit_and_builtin_child_items": true,
        }))
}

/// While the task's question is on the limit's stop, only that stop answers it.
async fn assert_covered_by_the_parent(setup: &Setup, child: Uuid) {
    let covered = app_server(setup.state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"message_id": child_row(setup, child).await.id, "decision": "approve"}))
        .await;
    assert_eq!(
        covered.status_code(),
        http::StatusCode::CONFLICT,
        "{}",
        covered.text()
    );
    assert_eq!(covered.json::<Value>()["code"], "covered_by_parent");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn answer_now_at_the_tool_call_limit_resumes_the_task_its_question_rides_on(
    pool: Pool<Postgres>,
) {
    let mut setup = setup_search_and_task(pool, TIMEOUT_MS, false).await;
    let (message_id, budget, task) = park_on_the_limit(&mut setup).await;
    assert_covered_by_the_parent(&setup, delegate_child(&parts(&setup).await)).await;

    let answered = tokio::time::timeout(
        Duration::from_secs(30),
        decide_limit(
            &setup.state,
            message_id,
            &[(&budget, "reject"), (&task, "approve")],
        ),
    )
    .await
    .expect("the task and then the turn should answer");
    answered.assert_status_ok();

    let content = parts(&setup).await;
    let task_slot = slot(&content, TASK_CALL);
    assert_eq!(task_slot["status"], "success", "{task_slot}");
    assert!(
        task_slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains(TASK_ANSWER),
        "the approved task ran: {task_slot}"
    );
    let search = slot(&content, SEARCH_CALL);
    assert_eq!(
        search["output"]["status"], "rejected",
        "answer now runs no held call: {search}"
    );
    assert!(
        content.last().unwrap().to_string().contains(LIMIT_ANSWER),
        "{content:?}"
    );
    assert!(
        content
            .iter()
            .all(|part| part["content_type"] != "tool_approval_request"
                || part["kind"] == "tool_call_limit"),
        "nothing asks again: {content:?}"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn continuing_at_the_tool_call_limit_resumes_the_task_and_then_the_held_call(
    pool: Pool<Postgres>,
) {
    // A search that outlives its live window parks as a durable call, so the
    // continuation ends on it once it ran.
    let mut setup = setup_search_and_task(pool, 200, false).await;
    let (message_id, budget, task) = park_on_the_limit(&mut setup).await;

    let continued = tokio::time::timeout(
        Duration::from_secs(30),
        decide_limit(
            &setup.state,
            message_id,
            &[(&budget, "approve"), (&task, "approve")],
        ),
    )
    .await
    .expect("the task should answer and the held search should run");
    continued.assert_status_ok();

    let content = parts(&setup).await;
    assert_eq!(slot(&content, TASK_CALL)["status"], "success");
    let request = parked(&setup).await;
    assert!(
        request.tool_call_id.ends_with(SEARCH_CALL),
        "the held search ran with the doubled budget: {request:?}"
    );
    let pending = content.last().unwrap();
    assert_eq!(
        pending["content_type"], "client_tool_pending",
        "{content:?}"
    );
    assert_eq!(pending["attempt_id"], json!(request.attempt_id));
}

/// Stop at the limit stops the turn as the user's own Stop does: the task's
/// question leaves the stop and is answered in the task's own chat.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn stop_at_the_tool_call_limit_sends_the_tasks_question_back_to_its_own_chat(
    pool: Pool<Postgres>,
) {
    let mut setup = setup_search_and_task(pool, TIMEOUT_MS, false).await;
    let (message_id, budget, task) = park_on_the_limit(&mut setup).await;
    let child = delegate_child(&parts(&setup).await);

    // Stop cannot carry an answer to the task: it would be dropped unseen.
    decide_limit(
        &setup.state,
        message_id,
        &[(&budget, "withdraw"), (&task, "approve")],
    )
    .await
    .assert_status(http::StatusCode::BAD_REQUEST);
    assert_covered_by_the_parent(&setup, child).await;

    decide_limit(
        &setup.state,
        message_id,
        &[(&budget, "withdraw"), (&task, "withdraw")],
    )
    .await
    .assert_status_ok();
    let content = parts(&setup).await;
    let stop = content
        .iter()
        .rfind(|part| part["content_type"] == "tool_approval_request")
        .unwrap();
    assert!(
        stop["approvals"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["child"].is_null()),
        "the task's question left the stop: {stop}"
    );
    assert_eq!(content.last().unwrap()["reason"], "withdrawn");
    assert_eq!(
        slot(&content, TASK_CALL)["output"]["status"],
        "input_required"
    );
    assert_eq!(
        child_row(&setup, setup.chat_id)
            .await
            .generation_metadata
            .unwrap()["was_aborted"],
        true
    );
    assert_eq!(
        turn_requests(&setup.recorder).len(),
        1,
        "the stopped turn asks the model nothing"
    );

    let answered = app_server(setup.state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"message_id": child_row(&setup, child).await.id, "decision": "approve"}))
        .await;
    answered.assert_status_ok();
    assert!(
        answered.text().contains(TASK_ANSWER),
        "the child's own card answers it: {}",
        answered.text()
    );
}

/// A client that predates the limit's tasks still sends `shows_child_items`,
/// but shows the budget choice alone and answers every open item with it: its
/// Continue would approve the task's call unseen, so it is asked to reload.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_client_that_shows_the_limits_choice_alone_is_asked_to_reload(pool: Pool<Postgres>) {
    let mut setup = setup_search_and_task(pool, TIMEOUT_MS, false).await;
    let (message_id, budget, task) = park_on_the_limit(&mut setup).await;
    let child = delegate_child(&parts(&setup).await);

    let stale = app_server(setup.state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", SEARCH)
        .json(&json!({
            "message_id": message_id,
            "decisions": [
                {"approval_id": budget["approval_id"], "decision": "approve"},
                {"approval_id": task["approval_id"], "decision": "approve"},
            ],
            "shows_child_items": true,
        }))
        .await;
    assert_eq!(
        stale.status_code(),
        http::StatusCode::CONFLICT,
        "{}",
        stale.text()
    );
    assert!(stale.text().contains("Reload the page"), "{}", stale.text());

    let content = parts(&setup).await;
    assert_eq!(
        slot(&content, TASK_CALL)["output"]["status"],
        "input_required",
        "the task's call was not approved"
    );
    assert_eq!(
        generation_state(&setup).await.as_deref(),
        Some("awaiting_approval")
    );
    assert_covered_by_the_parent(&setup, child).await;
    assert_eq!(turn_requests(&setup.recorder).len(), 1);
}

/// Leaves the parked turn as one whose client submission still waits for its
/// correction, as a submission the host refused before the limit leaves it.
async fn with_a_pending_correction(setup: &Setup, message_id: Uuid) {
    use sea_orm::ConnectionTrait;
    let row = Messages::find_by_id(message_id)
        .one(&setup.state.db)
        .await
        .unwrap()
        .unwrap();
    let mut parameters = row.generation_parameters.expect("generation parameters");
    assert!(
        parameters["turn_consumption"].is_object(),
        "the parked turn counted its calls: {parameters}"
    );
    parameters["turn_consumption"]["submission_correction"] = json!({
        "tool": "desktop/search_sidecar_index",
        "outcome": {
            "status": "correcting",
            "reason": "validation_failed",
            "attempts_used": 1,
            "max_attempts": 5,
        },
        "recovery": "repair_arguments",
        "recovery_read_tools": [],
        "recovery_reads_used": 0,
        "max_recovery_reads": 0,
    });
    let parameters = serde_json::to_string(&parameters)
        .unwrap()
        .replace('\'', "''");
    setup
        .state
        .db
        .execute_unprepared(&format!(
            "UPDATE messages SET generation_parameters = '{parameters}'::jsonb WHERE id = '{message_id}'"
        ))
        .await
        .unwrap();
}

/// How many requests asked the turn's model with the task's answer.
fn turn_answers_asked(setup: &Setup) -> usize {
    setup
        .recorder
        .bodies()
        .iter()
        .filter(|body| body.contains(TURN) && body.contains(TASK_ANSWER))
        .count()
}

/// The response ended on Generate answer now: the submission is unresolved,
/// the model was not asked again, and nothing is left open.
async fn assert_answered_now_without_the_model(setup: &Setup) {
    let row = child_row(setup, setup.chat_id).await;
    assert_eq!(
        row.generation_metadata.as_ref().unwrap()["submission_outcome"],
        json!({
            "status": "unresolved",
            "reason": "user_requested_answer",
            "attempts_used": 1,
            "max_attempts": 5,
        }),
        "{:?}",
        row.generation_metadata
    );
    assert_eq!(
        row.generation_parameters.as_ref().unwrap()["turn_consumption"]["submission_correction"]["outcome"]
            ["status"],
        "unresolved"
    );
    let content = parts(setup).await;
    assert!(
        !content
            .iter()
            .any(|part| part.to_string().contains(LIMIT_ANSWER)),
        "{content:?}"
    );
    assert_eq!(
        turn_answers_asked(setup),
        0,
        "the model was not asked again"
    );
    let task_slot = slot(&content, TASK_CALL);
    assert_eq!(task_slot["status"], "success", "{task_slot}");
    assert!(
        task_slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains(TASK_ANSWER),
        "the approved task ran: {task_slot}"
    );
    assert_ne!(
        generation_state(setup).await.as_deref(),
        Some("awaiting_approval"),
        "nothing is left open"
    );
}

/// Generate answer now while a client submission waits for its correction
/// asks the model nothing, but the task the user approved on the same stop
/// still runs: the answer is not dropped and the question not sent back to the
/// task's own chat.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn answer_now_with_a_pending_correction_still_runs_the_approved_task(pool: Pool<Postgres>) {
    let mut setup = setup_search_and_task(pool, TIMEOUT_MS, false).await;
    let (message_id, budget, task) = park_on_the_limit(&mut setup).await;
    with_a_pending_correction(&setup, message_id).await;

    tokio::time::timeout(
        Duration::from_secs(30),
        decide_limit(
            &setup.state,
            message_id,
            &[(&budget, "reject"), (&task, "approve")],
        ),
    )
    .await
    .expect("the task should answer and the turn end")
    .assert_status_ok();

    assert_answered_now_without_the_model(&setup).await;
    let content = parts(&setup).await;
    let stop = content
        .iter()
        .find(|part| part["kind"] == "tool_call_limit")
        .unwrap();
    assert!(
        stop["approvals"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["approval_id"] == task["approval_id"]),
        "the task's question stays on the stop it was answered on: {stop}"
    );
    assert!(
        content
            .iter()
            .any(|part| part["content_type"] == "tool_approval"
                && part["approval_id"] == task["approval_id"]),
        "the task's approval is recorded: {content:?}"
    );
}

/// A task that asks again after Generate answer now with a pending correction
/// re-parks the turn as on any stop; the turn ends without the model once that
/// question is answered too.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn answer_now_with_a_pending_correction_waits_for_a_task_that_asks_again(
    pool: Pool<Postgres>,
) {
    let mut setup = setup_search_and_task(pool, TIMEOUT_MS, true).await;
    let (message_id, budget, task) = park_on_the_limit(&mut setup).await;
    with_a_pending_correction(&setup, message_id).await;
    // The limit of one call that stopped the turn binds the task's own run
    // too: room for its second call, so it asks instead of reaching its limit.
    setup.state.config.generation.max_tool_calls_per_message = 4;

    tokio::time::timeout(
        Duration::from_secs(30),
        decide_limit(
            &setup.state,
            message_id,
            &[(&budget, "reject"), (&task, "approve")],
        ),
    )
    .await
    .expect("the task should ask again")
    .assert_status_ok();

    let content = parts(&setup).await;
    let stop = content.last().unwrap();
    assert_eq!(stop["content_type"], "tool_approval_request", "{content:?}");
    assert_eq!(stop["kind"], "delegated_task", "{stop}");
    let [second] = stop["approvals"].as_array().unwrap().as_slice() else {
        panic!("the task's second question: {stop}");
    };
    assert!(
        second["child"]["child_tool_call_id"]
            .as_str()
            .unwrap()
            .ends_with(SECOND_PROBE),
        "{second}"
    );
    assert_eq!(
        generation_state(&setup).await.as_deref(),
        Some("awaiting_approval")
    );
    let row = child_row(&setup, setup.chat_id).await;
    assert!(
        row.generation_metadata.as_ref().unwrap()["submission_outcome"].is_null(),
        "the correction is not ended while the task asks: {:?}",
        row.generation_metadata
    );
    assert_eq!(turn_answers_asked(&setup), 0);

    tokio::time::timeout(
        Duration::from_secs(30),
        decide(&setup.state, message_id, &second["approval_id"]),
    )
    .await
    .expect("the task should answer and the turn end");
    assert_answered_now_without_the_model(&setup).await;
}
