//! Per-tool client tool decisions enforced at dispatch: `never_allow` refuses the
//! call and `ask` parks the same durable approval an MCP tool does, so the time
//! the user takes to decide never counts against the tool's result timeout.
use super::*;
use erato::services::background_tasks::StreamingEvent;
use std::time::Duration;

const SEARCH: &str = "search_sidecar_index";
const READ: &str = "read_sidecar_conversation";
const CALL: &str = "call_search_decision";

struct Setup {
    server: TestServer,
    state: erato::state::AppState,
    chat_id: Uuid,
    recorder: RequestBodyRecorder,
}

/// The model makes `calls` one per inference, then answers in prose once the
/// last call's outcome is in the history. `timeout_ms` is each tool's result
/// timeout.
async fn setup_with_calls(
    pool: Pool<Postgres>,
    calls: &[(&'static str, &'static str)],
    timeout_ms: u64,
    requires_registration: bool,
) -> Setup {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let mut previous: Option<&'static str> = None;
    for &(call_id, tool) in calls {
        let capture = recorder.clone();
        let required: Vec<&'static str> = previous.map_or(vec![SEARCH], |id| vec![id]);
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&required, &[call_id]))
                .matcher(capture);
            mock_llm_sse_response(
                then,
                build_openai_tool_calls_streaming_response(&[(call_id, tool, json!({}))]),
            );
        });
        previous = Some(call_id);
    }
    let last = previous.expect("at least one call");
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[last], &[]))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&["DECISION-ANSWER"]),
        );
    });
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    for name in [SEARCH, READ] {
        config.client_tools.tools.insert(
            name.into(),
            ClientToolConfig {
                name: name.into(),
                namespace: Some("desktop".into()),
                description: "Read-only test tool".into(),
                parameters: r#"{"type":"object","properties":{}}"#.into(),
                requires_client_registration: requires_registration,
                timeout_ms: Some(timeout_ms),
                ..Default::default()
            },
        );
    }
    config.facets.tool_call_allowlist = vec!["desktop/*".into()];
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let server = app_server(state.clone());
    Setup {
        server,
        state,
        chat_id,
        recorder,
    }
}

async fn setup(pool: Pool<Postgres>, timeout_ms: u64, requires_registration: bool) -> Setup {
    setup_with_calls(pool, &[(CALL, SEARCH)], timeout_ms, requires_registration).await
}

async fn set_decisions(server: &TestServer, decisions: Value) {
    server
        .put("/api/v1beta/me/profile/preferences")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "client_tool_decisions": decisions }))
        .await
        .assert_status_ok();
}

async fn stored_decisions(setup: &Setup) -> Value {
    setup
        .server
        .get("/api/v1beta/me/profile")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json::<Value>()["client_tool_decisions"]
        .clone()
}

fn submit(setup: &Setup) -> axum_test::TestRequest {
    setup
        .server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", format!("{SEARCH},{READ}"))
        .json(&json!({ "existing_chat_id": setup.chat_id, "user_message": "search locally" }))
}

fn continuation(
    setup: &Setup,
    message_id: Uuid,
    decision: &str,
    tools: &str,
) -> axum_test::TestRequest {
    setup
        .server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", tools)
        .json(&json!({
            "message_id": message_id,
            "decisions": [{ "approval_id": CALL, "decision": decision }],
        }))
}

/// Answers every client tool call the chat dispatches until `stop` resolves,
/// and returns the names of the tools it was asked to run.
async fn answer_client_calls(
    setup: &Setup,
    done: impl std::future::Future<Output = ()>,
) -> Vec<String> {
    let mut answered = Vec::new();
    let mut seen = std::collections::HashSet::new();
    tokio::pin!(done);
    loop {
        if let Some(task) = setup.state.background_tasks.get_task(&setup.chat_id).await {
            for event in task.get_event_history().await {
                if let StreamingEvent::ClientToolCall {
                    message_id,
                    tool_call_id,
                    tool_name,
                    ..
                } = event
                    && seen.insert(tool_call_id.clone())
                {
                    let response = setup
                        .server
                        .post("/api/v1beta/me/messages/clienttoolresult")
                        .with_bearer_token(TEST_JWT_TOKEN)
                        .json(&json!({
                            "chat_id": setup.chat_id,
                            "message_id": message_id,
                            "tool_call_id": tool_call_id,
                            "result": { "hits": 3 },
                        }))
                        .await;
                    response.assert_status_ok();
                    assert_eq!(response.json::<Value>()["delivered"], true);
                    answered.push(tool_name);
                }
            }
        }
        tokio::select! {
            () = &mut done => return answered,
            () = tokio::time::sleep(Duration::from_millis(5)) => {}
        }
    }
}

async fn assistant_rows(setup: &Setup) -> Vec<Value> {
    Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(setup.chat_id))
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&setup.state.db)
        .await
        .unwrap()
        .into_iter()
        .filter(|row| row.raw_message["role"] == "assistant")
        .map(|row| {
            let mut value = row.raw_message.clone();
            value["id"] = json!(row.id);
            value
        })
        .collect()
}

fn tool_use_output(row: &Value, tool_call_id: &str) -> Value {
    row["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| part["content_type"] == "tool_use" && part["tool_call_id"] == tool_call_id)
        .map(|part| part["output"].clone())
        .unwrap_or(Value::Null)
}

fn dispatched_calls(response: &axum_test::TestResponse) -> Vec<String> {
    parse_sse_events(response)
        .into_iter()
        .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
        .filter(|event| event["message_type"] == "client_tool_call")
        .map(|event| event["tool_name"].as_str().unwrap_or_default().to_string())
        .collect()
}

/// Parks on "ask" without dispatching, returning the parked assistant row.
async fn park_on_ask(setup: &Setup) -> Value {
    set_decisions(&setup.server, json!({ format!("desktop/{SEARCH}"): "ask" })).await;
    let response = submit(setup).await;
    response.assert_status_ok();
    assert!(
        dispatched_calls(&response).is_empty(),
        "an ask decision must not reach the device before the user answers"
    );
    let row = assistant_rows(setup)
        .await
        .pop()
        .expect("parked assistant row");
    let request = row["content"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(request["content_type"], "tool_approval_request");
    assert_eq!(request["kind"], "client_tool");
    assert_eq!(request["tool_name"], SEARCH);
    assert_eq!(request["mcp_server_id"], "desktop");
    row
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn ask_parks_durably_and_allow_once_runs_after_the_timeout_would_have_passed(
    pool: Pool<Postgres>,
) {
    let setup = setup(pool, 200, true).await;
    let row = park_on_ask(&setup).await;
    // Longer than the tool's 200 ms result timeout: deciding must not count.
    tokio::time::sleep(Duration::from_millis(500)).await;
    let message_id: Uuid = serde_json::from_value(row["id"].clone()).unwrap();
    let (response, answered) = tokio::time::timeout(Duration::from_secs(30), async {
        let (done_tx, done_rx) = tokio::sync::oneshot::channel::<()>();
        let request = async {
            let response =
                continuation(&setup, message_id, "approve", &format!("{SEARCH},{READ}")).await;
            let _ = done_tx.send(());
            response
        };
        tokio::join!(
            request,
            answer_client_calls(&setup, async {
                let _ = done_rx.await;
            })
        )
    })
    .await
    .expect("continuation did not finish");
    response.assert_status_ok();
    assert_eq!(answered, vec![SEARCH.to_string()]);
    let row = assistant_rows(&setup).await.pop().unwrap();
    assert_eq!(tool_use_output(&row, CALL)["result"]["hits"], 3, "{row}");
    assert!(
        setup
            .recorder
            .bodies()
            .iter()
            .any(|body| body.contains(CALL) && body.contains("hits")),
        "the approved call's result must reach the model"
    );
    assert_eq!(
        stored_decisions(&setup).await[format!("desktop/{SEARCH}")],
        "ask",
        "allow once leaves the standing decision alone"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn always_allow_on_the_card_is_saved_and_runs_the_call(pool: Pool<Postgres>) {
    let setup = setup(pool, 60_000, true).await;
    let row = park_on_ask(&setup).await;
    let message_id: Uuid = serde_json::from_value(row["id"].clone()).unwrap();
    let (response, answered) = tokio::time::timeout(Duration::from_secs(30), async {
        let (done_tx, done_rx) = tokio::sync::oneshot::channel::<()>();
        let request = async {
            let response = continuation(
                &setup,
                message_id,
                "approve_always",
                &format!("{SEARCH},{READ}"),
            )
            .await;
            let _ = done_tx.send(());
            response
        };
        tokio::join!(
            request,
            answer_client_calls(&setup, async {
                let _ = done_rx.await;
            })
        )
    })
    .await
    .expect("continuation did not finish");
    response.assert_status_ok();
    assert_eq!(answered, vec![SEARCH.to_string()]);
    assert_eq!(
        stored_decisions(&setup).await[format!("desktop/{SEARCH}")],
        "always_allow"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_allow_on_the_card_is_saved_and_refuses_the_call(pool: Pool<Postgres>) {
    let setup = setup(pool, 60_000, true).await;
    let row = park_on_ask(&setup).await;
    // Saved elsewhere while the card was open; the card's answer must keep it.
    let user = get_or_create_user(&setup.state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    erato::models::user_preference::set_client_tool_decision(
        &setup.state.db,
        &user.id,
        &format!("desktop/{READ}"),
        erato::models::user_preference::ClientToolDecision::AlwaysAllow,
    )
    .await
    .unwrap();
    let message_id: Uuid = serde_json::from_value(row["id"].clone()).unwrap();
    let response = tokio::time::timeout(Duration::from_secs(30), async {
        continuation(
            &setup,
            message_id,
            "reject_always",
            &format!("{SEARCH},{READ}"),
        )
        .await
    })
    .await
    .expect("continuation did not finish");
    response.assert_status_ok();
    assert!(dispatched_calls(&response).is_empty());
    let row = assistant_rows(&setup).await.pop().unwrap();
    let output = tool_use_output(&row, CALL);
    assert_eq!(output["status"], "rejected");
    assert_eq!(output["error"], "The user denied this tool call.");
    let stored = stored_decisions(&setup).await;
    assert_eq!(stored[format!("desktop/{SEARCH}")], "never_allow");
    assert_eq!(
        stored[format!("desktop/{READ}")],
        "always_allow",
        "saving one answer keeps the user's other decisions"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approval_from_a_device_without_the_executor_settles_at_once(pool: Pool<Postgres>) {
    let setup = setup(pool, 60_000, true).await;
    let row = park_on_ask(&setup).await;
    let message_id: Uuid = serde_json::from_value(row["id"].clone()).unwrap();
    // The tool's timeout is a minute; the refusal must not wait for it.
    let response = tokio::time::timeout(Duration::from_secs(20), async {
        continuation(&setup, message_id, "approve", READ).await
    })
    .await
    .expect("an approval from a device without the tool must not wait for the timeout");
    response.assert_status_ok();
    assert!(dispatched_calls(&response).is_empty());
    let row = assistant_rows(&setup).await.pop().unwrap();
    let output = tool_use_output(&row, CALL);
    assert_eq!(output["status"], "error");
    assert_eq!(
        output["error"],
        format!("The tool '{SEARCH}' is not available on this device; the call was not executed.")
    );
}

/// A decision saved after the tool was offered still holds when the model calls it.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_allow_saved_mid_turn_refuses_at_dispatch(pool: Pool<Postgres>) {
    const FIRST: &str = "call_read_first";
    let setup = setup_with_calls(pool, &[(FIRST, READ), (CALL, SEARCH)], 60_000, false).await;
    // The first call's executor saves the denial before answering, so the
    // second call reaches dispatch with a tool that was offered but is now denied.
    let client = async {
        loop {
            if let Some(task) = setup.state.background_tasks.get_task(&setup.chat_id).await {
                for event in task.get_event_history().await {
                    if let StreamingEvent::ClientToolCall {
                        message_id,
                        tool_call_id,
                        ..
                    } = event
                        && tool_call_id == FIRST
                    {
                        set_decisions(
                            &setup.server,
                            json!({ format!("desktop/{SEARCH}"): "never_allow" }),
                        )
                        .await;
                        setup
                            .server
                            .post("/api/v1beta/me/messages/clienttoolresult")
                            .with_bearer_token(TEST_JWT_TOKEN)
                            .json(&json!({
                                "chat_id": setup.chat_id,
                                "message_id": message_id,
                                "tool_call_id": tool_call_id,
                                "result": { "conversation": [] },
                            }))
                            .await
                            .assert_status_ok();
                        return;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    let (response, ()) = tokio::time::timeout(Duration::from_secs(30), async {
        tokio::join!(async { submit(&setup).await }, client)
    })
    .await
    .expect("turn did not finish");
    response.assert_status_ok();
    let offered = recorded_tool_offers(&setup.recorder.bodies());
    assert!(
        offered
            .first()
            .is_some_and(|tools| tools.iter().any(|tool| tool == SEARCH)),
        "the tool must have been offered before the decision changed: {offered:?}"
    );
    assert_eq!(dispatched_calls(&response), vec![READ.to_string()]);
    let row = assistant_rows(&setup).await.pop().unwrap();
    let output = tool_use_output(&row, CALL);
    assert_eq!(output["status"], "rejected");
    assert_eq!(
        output["error"],
        format!(
            "The user has disabled the tool '{SEARCH}' in their settings; the call was not executed."
        )
    );
}
