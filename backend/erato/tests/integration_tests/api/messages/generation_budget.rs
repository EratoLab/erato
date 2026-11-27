use super::*;
use crate::test_utils::build_openai_narrated_tool_calls_streaming_response;
use erato::config::BudgetModelRate;
use erato::state::AppState;
use std::time::Duration;

const PARTIAL: &str = "Here is my partial answer.";
const FINAL: &str = "Here is the completed answer.";
const READ_RESULT: &str = "closed-world approval fixture read";
const PUBLISH_RESULT: &str = "approval probe published";

async fn setup(
    pool: Pool<Postgres>,
    limit: f64,
    finish: bool,
    second_turn_delay: Duration,
) -> (AppState, RequestBodyRecorder, MockServer) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let provider = recorder.clone();
    mocks.mock_with_options(u8::MAX, None, move |when, then| {
        when.post().path("/v1/chat/completions").matcher(provider);
        let mut actions = with_budget_usage(build_openai_text_streaming_response(&[FINAL]), None);
        if !second_turn_delay.is_zero() {
            actions.insert(0, BodyAction::Delay(second_turn_delay));
        }
        mock_llm_sse_response(then, actions);
    });
    for (prompt, tool, result) in [
        ("Read the fixture", "read_approval_fixture", READ_RESULT),
        (
            "Publish the fixture",
            "publish_approval_probe",
            PUBLISH_RESULT,
        ),
    ] {
        let provider = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[prompt], &[result]))
                .matcher(provider);
            mock_llm_sse_response(
                then,
                with_budget_usage(
                    build_openai_narrated_tool_calls_streaming_response(
                        PARTIAL,
                        &[("fixture", tool, json!({}))],
                    ),
                    None,
                ),
            );
        });
    }
    let (mut config, llm) = setup_mock_llm_server_with_mocks(mocks).await;
    config.budget.enabled = true;
    config.budget.enforce_limit = true;
    config.budget.allow_request_to_finish = finish;
    config.budget.budget_period_days = 30;
    config.budget.max_budget = Some(limit);
    let rates = BudgetModelRate {
        cost_input_tokens_per_1m: 1_000_000.0,
        cost_cached_input_tokens_per_1m: Some(500_000.0),
        cost_output_tokens_per_1m: 1_000_000.0,
    };
    config
        .budget
        .model_rates
        .insert("mock-llm".into(), rates.clone());
    config.budget.model_rates.insert("Mock/v1".into(), rates);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, mock_mcp_server::app()).await.unwrap() });
    config.mcp_servers.insert(
        "approval".into(),
        mcp_server_config(
            &base_url,
            "/mcp/approval-policy",
            McpServerAuthenticationConfig::None,
        ),
    );
    config.mcp_server_permissions.rules.insert(
        "allow-approval-fixture".into(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["approval".into()],
        },
    );
    config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    let state = test_app_state(config, pool).await;
    get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    (state, recorder, llm)
}

async fn submit(server: &TestServer, text: &str) -> axum_test::TestResponse {
    server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"user_message": text}))
        .await
}

fn assert_refused(response: &axum_test::TestResponse) {
    response.assert_status(http::StatusCode::FORBIDDEN);
    assert_eq!(response.json::<Value>()["code"], "budget_limit_reached");
}

fn provider_turn_count(provider: &RequestBodyRecorder) -> usize {
    provider
        .bodies()
        .iter()
        .filter(|body| {
            serde_json::from_str::<Value>(body).is_ok_and(|request| request["stream"] == true)
        })
        .count()
}

fn assert_budget_stop(events: &[crate::test_utils::Event]) {
    assert!(
        events.iter().any(|event| {
            serde_json::from_str::<Value>(&event.data)
                .is_ok_and(|data| data["error_type"] == "budget_limit_reached")
        }),
        "{events:?}"
    );
    assert!(has_event_type(events, "assistant_message_completed"));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn finish_mode_publishes_spending_before_completion_and_allows_reconnect(
    pool: Pool<Postgres>,
) {
    let (state, provider, _llm) = setup(pool, 18.0, true, Duration::from_secs(3)).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let app: Router = router(state.clone())
        .split_for_parts()
        .0
        .with_state(state.clone());
    let web_server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let server = app_server(state.clone());
    let client = reqwest::Client::new();
    let first = client
        .post(format!("{base_url}/api/v1beta/me/messages/submitstream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .json(&json!({"user_message": "Read the fixture"}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        while !provider
            .bodies()
            .iter()
            .any(|body| body.contains(READ_RESULT))
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the second model turn should start");

    // The final turn is still running. Both the model and tool settlements
    // from the first turn are visible to another admission.
    assert_eq!(budget_spending(&server).await, 28.0);
    assert_refused(&submit(&server, "This follow-up must be refused").await);

    let chat_id = *state
        .background_tasks
        .tasks
        .read()
        .await
        .keys()
        .next()
        .unwrap();
    drop(first);
    let resumed = client
        .post(format!("{base_url}/api/v1beta/me/messages/resumestream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .json(&json!({"chat_id": chat_id}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(resumed.contains(PARTIAL), "{resumed}");
    assert!(resumed.contains(FINAL), "{resumed}");
    assert!(!resumed.contains("budget_limit_reached"));
    assert_eq!(budget_spending(&server).await, 46.0);
    assert_refused(&submit(&server, "Follow-up after it finished").await);
    assert_eq!(provider_turn_count(&provider), 2);
    assert_eq!(chats::Entity::find().all(&state.db).await.unwrap().len(), 1);
    web_server.abort();
    let _ = web_server.await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn strict_mode_stops_before_the_first_tool_and_preserves_partial_output(
    pool: Pool<Postgres>,
) {
    let (state, provider, _llm) = setup(pool, 18.0, false, Duration::ZERO).await;
    let server = app_server(state.clone());
    let response = submit(&server, "Read the fixture").await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    assert_budget_stop(&events);
    assert_eq!(extract_full_text(&events), PARTIAL);
    assert_eq!(budget_spending(&server).await, 18.0);
    assert_eq!(provider_turn_count(&provider), 1);
    assert_refused(&submit(&server, "Follow-up at the exact limit").await);

    let chat_id = extract_chat_id(&events).unwrap();
    let reloaded = server
        .get(&format!("/api/v1beta/chats/{chat_id}/messages"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    reloaded.assert_status_ok();
    let body = reloaded.json::<Value>();
    let message = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["role"] == "assistant")
        .unwrap();
    assert_eq!(message["error"]["error_type"], "budget_limit_reached");
    assert_eq!(message["content"][0]["text"], PARTIAL);
    assert_eq!(message["content"].as_array().unwrap().len(), 1);

    let id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let user_id = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["role"] == "user")
        .unwrap()["id"]
        .clone();
    for (route, request) in [
        (
            "editstream",
            json!({"message_id": user_id, "replace_user_message": "Refused edit"}),
        ),
        ("regeneratestream", json!({"current_message_id": id})),
    ] {
        let response = server
            .post(&format!("/api/v1beta/me/messages/{route}"))
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&request)
            .await;
        assert_refused(&response);
    }
    assert_eq!(provider_turn_count(&provider), 1);
    assert_eq!(Messages::find().all(&state.db).await.unwrap().len(), 2);

    let reply = Messages::find_by_id(id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let mut metadata = reply.generation_metadata.clone().unwrap();
    for settlement in metadata["budget_usage_settlements"].as_array_mut().unwrap() {
        settlement["settled_at"] = json!((Utc::now() - chrono::Duration::days(31)).to_rfc3339());
    }
    let mut stored: erato::db::entity::messages::ActiveModel = reply.into();
    stored.generation_metadata = ActiveValue::Set(Some(metadata));
    stored.update(&state.db).await.unwrap();
    assert_eq!(budget_spending(&server).await, 0.0);
    let next = submit(&server, "A first request in the new window").await;
    next.assert_status_ok();
    let events = parse_sse_events(&next);
    // A turn that finishes at the limit keeps its final answer.
    assert_eq!(extract_full_text(&events), FINAL);
    assert!(!has_event_type(&events, "error"));
    assert_eq!(budget_spending(&server).await, 18.0);
}

async fn parked_budget(pool: Pool<Postgres>, finish: bool) {
    let (mut state, provider, _llm) = setup(pool, 36.0, finish, Duration::ZERO).await;
    let server = app_server(state.clone());
    let first = submit(&server, "Publish the fixture").await;
    first.assert_status_ok();
    let events = parse_sse_events(&first);
    let message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    let parked = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        parked.raw_message["content"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()["content_type"],
        "tool_approval_request"
    );
    assert_eq!(budget_spending(&server).await, 18.0);

    submit(&server, "Spend the rest from another chat")
        .await
        .assert_status_ok();
    assert_eq!(budget_spending(&server).await, 36.0);
    // A continuation on a replica with a different setting inherits the
    // policy on the verified, server-created parked message.
    state.config.budget.allow_request_to_finish = !finish;
    let server = app_server(state.clone());
    let continued = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"message_id": message_id, "decision": "approve"}))
        .await;
    continued.assert_status_ok();
    let events = parse_sse_events(&continued);
    if finish {
        assert_eq!(extract_full_text(&events), FINAL);
        assert_eq!(provider_turn_count(&provider), 3);
        // The approved MCP call reports 6 cached tokens at half the input rate.
        assert_eq!(budget_spending(&server).await, 76.0);
    } else {
        assert_budget_stop(&events);
        assert_eq!(provider_turn_count(&provider), 2);
        assert_eq!(budget_spending(&server).await, 36.0);
        let stopped = Messages::find_by_id(message_id)
            .one(&state.db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stopped.raw_message["content"][0]["text"], PARTIAL);
        assert_eq!(
            stopped.generation_metadata.unwrap()["error"]["error_type"],
            "budget_limit_reached"
        );
        assert_eq!(
            chats::Entity::find_by_id(stopped.chat_id)
                .one(&state.db)
                .await
                .unwrap()
                .unwrap()
                .generation_state
                .as_deref(),
            Some("errored")
        );
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn parked_approval_inherits_finish_mode(pool: Pool<Postgres>) {
    parked_budget(pool, true).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn parked_approval_inherits_strict_mode(pool: Pool<Postgres>) {
    parked_budget(pool, false).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn incomplete_pricing_fails_closed_only_when_enforcement_is_enabled(pool: Pool<Postgres>) {
    let (mut state, provider, _llm) = setup(pool, 18.0, true, Duration::ZERO).await;
    submit(&app_server(state.clone()), "Record an ordinary turn")
        .await
        .assert_status_ok();
    state.config.budget.model_rates.remove("mock-llm");
    let capabilities = &mut state
        .config
        .chat_providers
        .as_mut()
        .unwrap()
        .providers
        .get_mut("mock-llm")
        .unwrap()
        .model_capabilities;
    capabilities.cost_input_tokens_per_1m = None;
    capabilities.cost_output_tokens_per_1m = None;
    let blocked = submit(&app_server(state.clone()), "Cannot verify spending").await;
    blocked.assert_status(http::StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(provider_turn_count(&provider), 1);

    state.config.budget.enforce_limit = false;
    submit(&app_server(state), "Explicit warning-only policy")
        .await
        .assert_status_ok();
    assert_eq!(provider_turn_count(&provider), 2);
}
