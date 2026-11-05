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
        ClientToolConfig {
            name: SEARCH.into(),
            namespace: Some("desktop".into()),
            description: "Search the local index".into(),
            parameters: json!({"type":"object","properties":{"text":{"type":"string"}}})
                .to_string(),
            requires_client_registration: true,
            timeout_ms: Some(TIMEOUT_MS),
            host_context: Some(erato::config::ClientToolHostContext::DesktopSidecar),
            durable: durable.then_some(erato::config::ClientToolDurableConfig {
                host_context: erato::config::ClientToolHostContext::DesktopSidecar,
                result_schema: None,
                attempt_expiry_secs: 86_400,
                claim_lease_secs: 120,
            }),
            ..Default::default()
        },
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

async fn last_part(setup: &Setup) -> Value {
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
        .last()
        .cloned()
        .unwrap()
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
