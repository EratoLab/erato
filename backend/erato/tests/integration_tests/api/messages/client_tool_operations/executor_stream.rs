//! Executor streams (ERMAIN-1000): a pane's stream for its binding receives
//! live calls from any of the account's chats that no chat stream can take.
use super::attached::serve;
use super::*;
use crate::test_utils::build_openai_narrated_tool_calls_streaming_response;
use erato::services::client_operations::executor_stream::{self, LiveCallRoute};
use futures::StreamExt;
use sea_orm::ConnectionTrait;
use std::pin::Pin;

const TIMEOUT_MS: u64 = 60_000;

/// The model narrates first and calls the tool two seconds later, so a test
/// can drop the chat's own stream before the call is dispatched.
async fn setup_stream(
    pool: Pool<Postgres>,
    timeout_ms: u64,
    executor_flag: bool,
    durable_flag: bool,
) -> Setup {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[CALL]))
            .matcher(capture);
        let mut actions = build_openai_narrated_tool_calls_streaming_response(
            "Checking your calendar.",
            &[(CALL, TOOL, json!({"lookahead_days":7}))],
        );
        actions.insert(2, BodyAction::Delay(Duration::from_secs(2)));
        mock_llm_sse_response(then, actions);
    });
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[CALL], &[]))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[ANSWER]));
    });
    let (mut config, mock) = setup_mock_llm_server_with_mocks(mocks).await;
    config.client_tools.durable_operations_enabled = durable_flag;
    config.client_tools.executor_stream_enabled = executor_flag;
    config.client_tools.tools.insert(
        "outlook_fetch_availability".into(),
        ClientToolConfig {
            name: TOOL.into(),
            namespace: Some("outlook".into()),
            description: "Read the mailbox free/busy".into(),
            parameters: json!({"type":"object","properties":{"lookahead_days":{"type":"integer"}}})
                .to_string(),
            timeout_ms: Some(timeout_ms),
            durable: durable_flag.then(|| erato::config::ClientToolDurableConfig {
                host_context: erato::config::ClientToolHostContext::OutlookMailbox,
                result_schema: Some(SCHEMA.into()),
                attempt_expiry_secs: 900,
                claim_lease_secs: 90,
            }),
            ..Default::default()
        },
    );
    config.facets.tool_call_allowlist = vec!["outlook/*".into()];
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    Setup {
        state,
        _mock: mock,
        recorder,
        chat_id,
    }
}

type Body = Pin<Box<dyn futures::Stream<Item = reqwest::Result<Vec<u8>>> + Send>>;

/// A pane's executor stream, read one SSE event at a time.
struct Pane {
    body: Body,
    buffer: String,
}

fn stream_request(base: &str, binding: &ExecutorBinding) -> reqwest::RequestBuilder {
    reqwest::Client::new()
        .get(format!("{base}/me/client-operations/stream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("X-Erato-Client-Tools", TOOL)
        .header("X-Erato-Executor", serde_json::to_string(binding).unwrap())
}

impl Pane {
    async fn open(base: &str, binding: &ExecutorBinding) -> Self {
        let response = stream_request(base, binding).send().await.unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "text/event-stream");
        Self {
            body: Box::pin(
                response
                    .bytes_stream()
                    .map(|chunk| chunk.map(|bytes| bytes.to_vec())),
            ),
            buffer: String::new(),
        }
    }

    /// The next event's data, or `None` when nothing arrives in time.
    async fn next(&mut self, within: Duration) -> Option<Value> {
        tokio::time::timeout(within, async {
            loop {
                if let Some(end) = self.buffer.find("\n\n") {
                    let block: String = self.buffer.drain(..end + 2).collect();
                    if let Some(data) = block.lines().find_map(|line| line.strip_prefix("data:")) {
                        return serde_json::from_str(data.trim()).unwrap();
                    }
                    continue;
                }
                let chunk = self.body.next().await.expect("stream ended").unwrap();
                self.buffer.push_str(&String::from_utf8_lossy(&chunk));
            }
        })
        .await
        .ok()
    }

    async fn call(&mut self) -> Value {
        let event = self
            .next(Duration::from_secs(10))
            .await
            .expect("an executor stream call");
        assert_eq!(event["message_type"], "client_tool_call");
        event
    }
}

fn call_of(event: &Value) -> (Uuid, String) {
    (
        event["message_id"].as_str().unwrap().parse().unwrap(),
        event["tool_call_id"].as_str().unwrap().into(),
    )
}

/// Submits over a real connection and drops it once the model has started
/// narrating, before it calls the tool.
async fn submit_detached(
    state: &erato::state::AppState,
    base: &str,
    chat_id: Uuid,
    binding: &ExecutorBinding,
) {
    let response = reqwest::Client::new()
        .post(format!("{base}/me/messages/submitstream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("X-Erato-Client-Tools", TOOL)
        .header("X-Erato-Executor", serde_json::to_string(binding).unwrap())
        .json(&json!({"existing_chat_id":chat_id,"user_message":"When am I free this week?"}))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let mut body = response.bytes_stream();
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut received = String::new();
        while let Some(bytes) = body.next().await {
            received.push_str(&String::from_utf8_lossy(&bytes.unwrap()));
            if received.contains("text_delta") {
                return;
            }
        }
        panic!("stream ended before the model narrated: {received}");
    })
    .await
    .unwrap();
    drop(body);
    tokio::time::timeout(Duration::from_millis(1500), async {
        loop {
            if let Some(task) = state.background_tasks.get_task(&chat_id).await
                && !task.client_stream_attached().await
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the dropped chat stream must detach before the call");
}

async fn wait_idle(state: &erato::state::AppState, chat_id: Uuid, within: Duration) -> bool {
    tokio::time::timeout(within, async {
        loop {
            let chat = chats::Entity::find_by_id(chat_id)
                .one(&state.db)
                .await
                .unwrap()
                .unwrap();
            if chat
                .generation_state
                .as_deref()
                .is_some_and(|state| state != "running")
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .is_ok()
}

async fn answer(
    state: &erato::state::AppState,
    chat_id: Uuid,
) -> erato::db::entity::messages::Model {
    Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&state.db)
        .await
        .unwrap()
        .into_iter()
        .rfind(|row| row.raw_message["role"] == "assistant")
        .expect("assistant row")
}

async fn assert_answered(state: &erato::state::AppState, chat_id: Uuid) {
    assert!(wait_idle(state, chat_id, Duration::from_secs(20)).await);
    let message = answer(state, chat_id).await;
    assert!(message.raw_message.to_string().contains(ANSWER));
    assert_eq!(call_output(&message)["status"], "success");
}

async fn rows(state: &erato::state::AppState, table: &str) -> i64 {
    state
        .db
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            format!("SELECT count(*) AS n FROM {table}"),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "n")
        .unwrap()
}

async fn account(state: &erato::state::AppState) -> Uuid {
    erato::models::user::get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap()
        .id
}

async fn presence(state: &erato::state::AppState, binding: &ExecutorBinding) -> Option<Uuid> {
    executor_stream::present(&state.db, account(state).await, binding)
        .await
        .unwrap()
        .map(|presence| presence.stream_id)
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn executor_stream_answers_a_call_from_another_chat(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let mut pane = Pane::open(&base, &mailbox()).await;
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    let event = pane.call().await;
    assert_eq!(event["chat_id"], setup.chat_id.to_string());
    assert_eq!(event["tool_name"], TOOL);
    assert_eq!(event["input"], json!({"lookahead_days":7}));
    assert!(event.get("lineage").is_none());
    let call = call_of(&event);
    let body = json!({"result":availability()});
    for wrong in [None, Some(mailbox_binding("device-two", 'a'))] {
        let refused = post_live(
            &setup.state,
            setup.chat_id,
            &call,
            body.clone(),
            wrong.as_ref(),
        )
        .await;
        refused.assert_status_conflict();
        assert_eq!(refused.text(), "Operation binding mismatch");
    }
    let accepted = post_live(&setup.state, setup.chat_id, &call, body, Some(&mailbox())).await;
    accepted.assert_status_ok();
    assert_eq!(accepted.json::<Value>()["delivered"], true);
    assert_answered(&setup.state, setup.chat_id).await;
    assert_eq!(rows(&setup.state, "client_executor_calls").await, 0);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn executor_stream_on_another_replica_answers_the_call(pool: Pool<Postgres>) {
    let setup = setup_stream(pool.clone(), TIMEOUT_MS, true, false).await;
    let replica = test_app_state(setup.state.config.clone(), pool).await;
    let (base, server) = serve(&setup.state).await;
    let (remote, remote_server) = serve(&replica).await;
    let mut pane = Pane::open(&remote, &mailbox()).await;
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    let call = call_of(&pane.call().await);
    assert!(
        replica
            .background_tasks
            .get_task(&setup.chat_id)
            .await
            .is_none()
    );
    let body = json!({"result":availability()});
    let refused = post_live(
        &replica,
        setup.chat_id,
        &call,
        body.clone(),
        Some(&mailbox_binding("device-two", 'a')),
    )
    .await;
    refused.assert_status_conflict();
    assert_eq!(refused.text(), "Operation binding mismatch");
    post_live(&replica, setup.chat_id, &call, body, Some(&mailbox()))
        .await
        .assert_status_ok();
    assert_answered(&setup.state, setup.chat_id).await;
    server.abort();
    remote_server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn two_panes_receive_only_their_own_calls(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let first_binding = mailbox_binding("device-one", 'a');
    let second_binding = mailbox_binding("device-one", 'b');
    let mut first = Pane::open(&base, &first_binding).await;
    let mut second = Pane::open(&base, &second_binding).await;
    let other_chat = seed_origin_chat(&setup.state.db).await;
    tokio::join!(
        submit_detached(&setup.state, &base, setup.chat_id, &first_binding),
        submit_detached(&setup.state, &base, other_chat, &second_binding),
    );
    let (first_event, second_event) = tokio::join!(first.call(), second.call());
    assert_eq!(first_event["chat_id"], setup.chat_id.to_string());
    assert_eq!(second_event["chat_id"], other_chat.to_string());
    let (first_extra, second_extra) = tokio::join!(
        first.next(Duration::from_secs(1)),
        second.next(Duration::from_secs(1))
    );
    assert_eq!(first_extra, None);
    assert_eq!(second_extra, None);
    let body = json!({"result":availability()});
    post_live(
        &setup.state,
        other_chat,
        &call_of(&second_event),
        body.clone(),
        Some(&first_binding),
    )
    .await
    .assert_status_conflict();
    for (chat_id, event, binding) in [
        (setup.chat_id, &first_event, &first_binding),
        (other_chat, &second_event, &second_binding),
    ] {
        post_live(
            &setup.state,
            chat_id,
            &call_of(event),
            body.clone(),
            Some(binding),
        )
        .await
        .assert_status_ok();
        assert_answered(&setup.state, chat_id).await;
    }
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn attached_chat_stream_keeps_its_call(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let binding = mailbox();
    let mut pane = Pane::open(&base, &binding).await;
    let ((response, answered), silent) = tokio::join!(
        submit_and_answer(
            &setup,
            Some(&binding),
            json!({"result":availability()}),
            Some(&binding),
        ),
        async {
            let silent = pane.next(Duration::from_secs(4)).await.is_none();
            assert_eq!(rows(&setup.state, "client_executor_calls").await, 0);
            silent
        }
    );
    response.assert_status_ok();
    assert!(client_tool_calls(&response) > 0);
    assert_eq!(answered.json::<Value>()["delivered"], true);
    assert!(
        silent,
        "the executor stream must not receive an attached chat's call"
    );
    assert_answered(&setup.state, setup.chat_id).await;
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn lost_presence_settles_as_context_unavailable_after_grace(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let mut pane = Pane::open(&base, &mailbox()).await;
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    pane.call().await;
    drop(pane);
    tokio::time::timeout(Duration::from_secs(5), async {
        while presence(&setup.state, &mailbox()).await.is_some() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("a dropped stream releases its binding");
    assert!(!wait_idle(&setup.state, setup.chat_id, Duration::from_secs(2)).await);
    assert!(wait_idle(&setup.state, setup.chat_id, Duration::from_secs(20)).await);
    assert_eq!(
        call_output(&answer(&setup.state, setup.chat_id).await),
        json!({"status":"cancelled","reason":"context_unavailable"})
    );
    assert_eq!(rows(&setup.state, "client_executor_calls").await, 0);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn disabled_flag_changes_nothing(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, 1_000, false, false).await;
    let (base, server) = serve(&setup.state).await;
    let response = stream_request(&base, &mailbox()).send().await.unwrap();
    assert_eq!(response.status(), 404);
    let inbox = app_server(setup.state.clone())
        .get("/api/v1beta/me/client-operations")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    inbox.assert_status_ok();
    assert_eq!(inbox.json::<Value>()["executor_stream_enabled"], false);
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    assert!(wait_idle(&setup.state, setup.chat_id, Duration::from_secs(10)).await);
    assert_eq!(
        call_output(&answer(&setup.state, setup.chat_id).await),
        json!({"status":"cancelled","reason":"timeout"})
    );
    assert_eq!(rows(&setup.state, "client_executor_calls").await, 0);
    assert_eq!(rows(&setup.state, "client_executor_presence").await, 0);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn parked_operation_nudges_the_binding_stream(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, 10, true, true).await;
    let (base, server) = serve(&setup.state).await;
    let mut pane = Pane::open(&base, &mailbox()).await;
    let inbox = app_server(setup.state.clone())
        .get("/api/v1beta/me/client-operations")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    assert_eq!(inbox.json::<Value>()["executor_stream_enabled"], true);
    let request = park(&setup).await;
    let nudge = pane
        .next(Duration::from_secs(2))
        .await
        .expect("a nudge for the parked operation");
    assert_eq!(nudge["message_type"], "client_operation_available");
    assert_eq!(nudge["attempt_id"], request.attempt_id.to_string());
    claim(&setup.state, &request, &mailbox(), false)
        .await
        .assert_status_ok();
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn presence_is_first_come_and_released_on_drop(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let mut first = Pane::open(&base, &mailbox()).await;
    let holder = presence(&setup.state, &mailbox()).await.expect("presence");
    let mut standby = Pane::open(&base, &mailbox()).await;
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert_eq!(presence(&setup.state, &mailbox()).await, Some(holder));
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    let call = call_of(&first.call().await);
    assert_eq!(standby.next(Duration::from_secs(1)).await, None);
    post_live(
        &setup.state,
        setup.chat_id,
        &call,
        json!({"result":availability()}),
        Some(&mailbox()),
    )
    .await
    .assert_status_ok();
    assert_answered(&setup.state, setup.chat_id).await;

    drop(first);
    tokio::time::timeout(Duration::from_secs(5), async {
        while presence(&setup.state, &mailbox())
            .await
            .is_none_or(|stream| stream == holder)
        {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the standby stream takes over");
    let other_chat = seed_origin_chat(&setup.state.db).await;
    submit_detached(&setup.state, &base, other_chat, &mailbox()).await;
    let event = standby.call().await;
    assert_eq!(event["chat_id"], other_chat.to_string());
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn grant_call_without_presence_is_unavailable(pool: Pool<Postgres>) {
    let state = test_app_state(hermetic_app_config(None, None), pool).await;
    let db = &state.db;
    let account = account(&state).await;
    let binding = mailbox();
    let route = |attached, grant| {
        executor_stream::route_live_call(db, account, &binding, TOOL, attached, grant)
    };
    assert_eq!(
        route(false, true).await.unwrap(),
        LiveCallRoute::Unavailable
    );
    assert_eq!(route(true, true).await.unwrap(), LiveCallRoute::Unavailable);
    assert_eq!(
        route(false, false).await.unwrap(),
        LiveCallRoute::ChatStream
    );

    let (first, second) = (Uuid::new_v4(), Uuid::new_v4());
    let tools = vec![TOOL.to_string()];
    assert!(
        executor_stream::acquire(db, account, &binding, first, &tools, &[])
            .await
            .unwrap()
    );
    assert!(
        !executor_stream::acquire(db, account, &binding, second, &tools, &tools)
            .await
            .unwrap()
    );
    assert_eq!(
        route(false, true).await.unwrap(),
        LiveCallRoute::Unavailable
    );
    assert_eq!(route(true, false).await.unwrap(), LiveCallRoute::ChatStream);
    assert!(matches!(
        route(false, false).await.unwrap(),
        LiveCallRoute::Executor(presence) if presence.stream_id == first
    ));

    executor_stream::release(db, first).await.unwrap();
    assert!(
        executor_stream::acquire(db, account, &binding, second, &tools, &tools)
            .await
            .unwrap()
    );
    assert!(matches!(
        route(true, true).await.unwrap(),
        LiveCallRoute::Executor(presence)
            if presence.stream_id == second && presence.serves_grant_call(TOOL)
    ));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn cleanup_removes_rows_that_no_run_or_stream_can_use(pool: Pool<Postgres>) {
    let state = test_app_state(hermetic_app_config(None, None), pool).await;
    let db = &state.db;
    let account = account(&state).await;
    let chat_id = seed_origin_chat(db).await;
    let binding = mailbox();
    let held = Uuid::new_v4();
    let tools = vec![TOOL.to_string()];
    assert!(
        executor_stream::acquire(db, account, &binding, held, &tools, &[])
            .await
            .unwrap()
    );
    let stale = mailbox_binding("device-two", 'a');
    assert!(
        executor_stream::acquire(db, account, &stale, Uuid::new_v4(), &tools, &[])
            .await
            .unwrap()
    );
    db.execute_unprepared(&format!(
        "UPDATE client_executor_presence SET expires_at = now() - interval '2 minutes' \
         WHERE stream_id <> '{held}'"
    ))
    .await
    .unwrap();
    executor_stream::hand_over(
        db,
        &executor_stream::ExecutorCall {
            account_id: account,
            binding: binding.clone(),
            chat_id,
            message_id: Uuid::new_v4(),
            tool_call_id: CALL.into(),
            tool_name: TOOL.into(),
            input: json!({}),
            lineage: None,
        },
    )
    .await
    .unwrap();
    executor_stream::nudge(
        db,
        &OperationRequest {
            attempt_id: Uuid::new_v4(),
            operation_id: QUALIFIED.into(),
            kind: client_tool::CLIENT_TOOL_KIND.into(),
            realm: ExecutionRealm::OfficeAddin,
            chat_id,
            message_id: Uuid::new_v4(),
            tool_call_id: CALL.into(),
            account_id: account,
            binding: binding.clone(),
            base_revision: None,
            consent: ConsentPolicy::None,
            expires_at: chrono::Utc::now() + chrono::Duration::hours(1),
            input: json!({}),
        },
    )
    .await
    .unwrap();
    assert_eq!(rows(&state, "client_executor_calls").await, 2);
    executor_stream::cleanup(db).await.unwrap();
    assert_eq!(rows(&state, "client_executor_calls").await, 0);
    assert_eq!(rows(&state, "client_executor_presence").await, 1);
    assert_eq!(presence(&state, &binding).await, Some(held));
}
