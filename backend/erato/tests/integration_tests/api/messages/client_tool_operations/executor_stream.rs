//! Executor streams (ERMAIN-1000): a pane's stream for its binding receives
//! live calls from any of the account's chats that no chat stream can take.
use super::attached::{next_call, serve, wait_park};
use super::*;
use crate::test_utils::{
    build_openai_delayed_text_streaming_response, build_openai_paused_tool_calls_streaming_response,
};
use erato::services::client_operations::executor_stream::{
    self, LiveCallRoute, PRESENCE_LOSS_GRACE, PresenceClaim,
};
use futures::StreamExt;
use sea_orm::ConnectionTrait;
use std::pin::Pin;

const TIMEOUT_MS: u64 = 60_000;
/// Between the model's narration and its tool call; well above the time a
/// dropped chat stream takes to detach.
const PAUSE: Duration = Duration::from_secs(5);
/// A user message whose turn only narrates, for [`BUSY_FOR`].
const BUSY: &str = "Keep this chat busy";
const BUSY_FOR: Duration = Duration::from_secs(12);

/// The model narrates first and calls the tool [`PAUSE`] later, so a test
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
            .matcher(BodyContainsMatcher::new(&[], &[CALL, BUSY]))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_paused_tool_calls_streaming_response(
                "Checking your calendar.",
                PAUSE,
                &[(CALL, TOOL, json!({"lookahead_days":7}))],
            ),
        );
    });
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[BUSY], &[]));
        mock_llm_sse_response(
            then,
            build_openai_delayed_text_streaming_response(&["Still working."], BUSY_FOR),
        );
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
pub(super) struct Pane {
    body: Body,
    buffer: String,
}

fn stream_request(base: &str, binding: &ExecutorBinding) -> reqwest::RequestBuilder {
    serving_request(base, binding, TOOL, None)
}

/// A stream advertising `client_tools`, of which `child_client_tools` accept
/// grant calls.
fn serving_request(
    base: &str,
    binding: &ExecutorBinding,
    client_tools: &str,
    child_client_tools: Option<&str>,
) -> reqwest::RequestBuilder {
    let request = reqwest::Client::new()
        .get(format!("{base}/me/client-operations/stream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("X-Erato-Client-Tools", client_tools)
        .header("X-Erato-Executor", serde_json::to_string(binding).unwrap());
    match child_client_tools {
        Some(names) => request.header("X-Erato-Child-Client-Tools", names),
        None => request,
    }
}

impl Pane {
    async fn open(base: &str, binding: &ExecutorBinding) -> Self {
        Self::open_request(stream_request(base, binding)).await
    }

    /// A stream sent with the pane's `X-Erato-Executor-Instance`.
    async fn open_as(base: &str, binding: &ExecutorBinding, instance: Uuid) -> Self {
        Self::open_request(
            stream_request(base, binding).header("X-Erato-Executor-Instance", instance.to_string()),
        )
        .await
    }

    pub(super) async fn open_serving(
        base: &str,
        binding: &ExecutorBinding,
        client_tools: &str,
        child_client_tools: Option<&str>,
    ) -> Self {
        Self::open_request(serving_request(
            base,
            binding,
            client_tools,
            child_client_tools,
        ))
        .await
    }

    async fn open_request(request: reqwest::RequestBuilder) -> Self {
        let response = request.send().await.unwrap();
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
    pub(super) async fn next(&mut self, within: Duration) -> Option<Value> {
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

    pub(super) async fn call(&mut self) -> Value {
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

/// Submits over a real connection and returns its body once the model has
/// started narrating.
async fn submit_narrated(
    base: &str,
    chat_id: Uuid,
    binding: &ExecutorBinding,
    user_message: &str,
) -> impl futures::Stream<Item = Result<axum::body::Bytes, reqwest::Error>> + Unpin + use<> {
    let response = reqwest::Client::new()
        .post(format!("{base}/me/messages/submitstream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("X-Erato-Client-Tools", TOOL)
        .header("X-Erato-Executor", serde_json::to_string(binding).unwrap())
        .json(&json!({"existing_chat_id":chat_id,"user_message":user_message}))
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
    body
}

/// Submits over a real connection and drops it once the model has started
/// narrating, before it calls the tool.
async fn submit_detached(
    state: &erato::state::AppState,
    base: &str,
    chat_id: Uuid,
    binding: &ExecutorBinding,
) {
    drop(submit_narrated(base, chat_id, binding, "When am I free this week?").await);
    let task = tokio::time::timeout(Duration::from_millis(1500), async {
        loop {
            if let Some(task) = state.background_tasks.get_task(&chat_id).await
                && !task.client_stream_attached().await
            {
                return task;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the dropped chat stream must detach before the call");
    assert!(
        !task.get_event_history().await.iter().any(|event| matches!(
            event,
            StreamingEvent::ToolCallProposed { .. }
                | StreamingEvent::ToolCallUpdate { .. }
                | StreamingEvent::ClientToolCall { .. }
        )),
        "the model called the tool before the chat stream detached"
    );
    assert_eq!(rows(state, "client_executor_calls").await, 0);
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

pub(super) async fn rows(state: &erato::state::AppState, table: &str) -> i64 {
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

pub(super) async fn account(state: &erato::state::AppState) -> Uuid {
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

/// A stream's claim without an instance, as from a client that sends none.
fn presence_claim(
    account_id: Uuid,
    binding: &ExecutorBinding,
    child_client_tools: &[String],
) -> PresenceClaim {
    PresenceClaim {
        account_id,
        binding: binding.clone(),
        instance_id: None,
        connected_at: chrono::Utc::now(),
        client_tools: vec![TOOL.to_string()],
        child_client_tools: child_client_tools.to_vec(),
    }
}

async fn wait_handed_over(state: &erato::state::AppState) {
    tokio::time::timeout(PAUSE + Duration::from_secs(5), async {
        while rows(state, "client_executor_calls").await == 0 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the call is handed to the executor stream");
}

pub(super) async fn wait_released(state: &erato::state::AppState, binding: &ExecutorBinding) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while presence(state, binding).await.is_some() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("a dropped stream releases its binding");
}

fn handed_call(
    account_id: Uuid,
    chat_id: Uuid,
    generation_id: Uuid,
) -> executor_stream::ExecutorCall {
    executor_stream::ExecutorCall {
        account_id,
        binding: mailbox(),
        chat_id,
        generation_id,
        message_id: Uuid::new_v4(),
        tool_call_id: CALL.into(),
        tool_name: TOOL.into(),
        input: json!({}),
        lineage: None,
        expires_at: None,
    }
}

async fn set_running(db: &sea_orm::DatabaseConnection, chat_id: Uuid, generation_id: Uuid) {
    db.execute_unprepared(&format!(
        "UPDATE chats SET generation_state = 'running', active_generation_id = '{generation_id}', \
         generation_heartbeat_at = now() WHERE id = '{chat_id}'"
    ))
    .await
    .unwrap();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn executor_stream_answers_a_call_from_another_chat(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let mut pane = Pane::open(&base, &mailbox()).await;
    let streamed_chat = seed_origin_chat(&setup.state.db).await;
    let mut streamed = submit_narrated(&base, streamed_chat, &mailbox(), BUSY).await;
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
    assert!(
        setup
            .state
            .background_tasks
            .get_task(&streamed_chat)
            .await
            .expect("the other chat still runs")
            .client_stream_attached()
            .await,
        "the other chat's stream must stay attached while the call runs"
    );
    let rest = tokio::time::timeout(BUSY_FOR + Duration::from_secs(5), async {
        let mut rest = String::new();
        while let Some(bytes) = streamed.next().await {
            rest.push_str(&String::from_utf8_lossy(&bytes.unwrap()));
        }
        rest
    })
    .await
    .unwrap();
    assert!(rest.contains("assistant_message_completed"));
    assert!(!rest.contains("client_tool_call") && !rest.contains(&call.1));
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
            let silent = pane.next(PAUSE + Duration::from_secs(2)).await.is_none();
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
    wait_released(&setup.state, &mailbox()).await;
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
async fn resumed_chat_stream_keeps_its_call(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let mut pane = Pane::open(&base, &mailbox()).await;
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    let response = reqwest::Client::new()
        .post(format!("{base}/me/messages/resumestream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .json(&json!({"chat_id":setup.chat_id}))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let mut resumed = response.bytes_stream();
    let call = next_call(&mut resumed).await;
    assert_eq!(pane.next(Duration::from_secs(1)).await, None);
    assert_eq!(rows(&setup.state, "client_executor_calls").await, 0);
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
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn reconnected_pane_gets_the_call_again_and_keeps_it_past_the_grace(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let instance = Uuid::now_v7();
    let mut pane = Pane::open_as(&base, &mailbox(), instance).await;
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    let first = call_of(&pane.call().await);
    drop(pane);
    let dropped = tokio::time::Instant::now();
    wait_released(&setup.state, &mailbox()).await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    let mut pane = Pane::open_as(&base, &mailbox(), instance).await;
    assert_eq!(call_of(&pane.call().await), first);
    let past_grace = (dropped + PRESENCE_LOSS_GRACE + Duration::from_secs(2))
        .saturating_duration_since(tokio::time::Instant::now());
    assert!(!wait_idle(&setup.state, setup.chat_id, past_grace).await);
    post_live(
        &setup.state,
        setup.chat_id,
        &first,
        json!({"result":availability()}),
        Some(&mailbox()),
    )
    .await
    .assert_status_ok();
    assert_answered(&setup.state, setup.chat_id).await;
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn expired_presence_settles_as_context_unavailable_after_grace(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    // Held by a replica that died: nothing renews or releases it.
    executor_stream::announce(
        &setup.state.db,
        &presence_claim(account(&setup.state).await, &mailbox(), &[]),
        Uuid::new_v4(),
    )
    .await
    .unwrap();
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    wait_handed_over(&setup.state).await;
    setup
        .state
        .db
        .execute_unprepared(
            "UPDATE client_executor_presence SET expires_at = now() - interval '1 second'",
        )
        .await
        .unwrap();
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
async fn submissions_keep_the_chat_path(pool: Pool<Postgres>) {
    let mut setup = setup_stream(pool, 1_000, true, false).await;
    setup
        .state
        .config
        .client_tools
        .tools
        .get_mut("outlook_fetch_availability")
        .unwrap()
        .submission = Some(erato::config::ClientToolSubmissionConfig::default());
    let (base, server) = serve(&setup.state).await;
    let mut pane = Pane::open(&base, &mailbox()).await;
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    assert_eq!(pane.next(PAUSE + Duration::from_secs(3)).await, None);
    assert!(wait_idle(&setup.state, setup.chat_id, Duration::from_secs(10)).await);
    let output = call_output(&answer(&setup.state, setup.chat_id).await);
    assert_eq!(output["status"], "cancelled");
    assert_eq!(output["reason"], "timeout");
    assert_eq!(rows(&setup.state, "client_executor_calls").await, 0);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn only_the_running_generation_delivers_its_calls(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let mut pane = Pane::open(&base, &mailbox()).await;
    let db = &setup.state.db;
    let account = account(&setup.state).await;
    let generation = Uuid::new_v4();
    set_running(db, setup.chat_id, generation).await;
    executor_stream::hand_over(db, &handed_call(account, setup.chat_id, Uuid::new_v4()))
        .await
        .unwrap();
    assert_eq!(pane.next(Duration::from_secs(1)).await, None);
    let current = handed_call(account, setup.chat_id, generation);
    executor_stream::hand_over(db, &current).await.unwrap();
    assert_eq!(
        pane.call().await["message_id"],
        current.message_id.to_string()
    );
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
    assert!(wait_idle(&setup.state, setup.chat_id, PAUSE + Duration::from_secs(5)).await);
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
    submit(&setup.state, setup.chat_id, Some(&mailbox()))
        .await
        .assert_status_ok();
    let request = wait_park(&setup, 1).await;
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
async fn call_without_any_stream_ends_after_the_grace(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    wait_handed_over(&setup.state).await;
    assert!(
        !wait_idle(
            &setup.state,
            setup.chat_id,
            PRESENCE_LOSS_GRACE - Duration::from_secs(3)
        )
        .await
    );
    assert!(wait_idle(&setup.state, setup.chat_id, Duration::from_secs(10)).await);
    assert_eq!(
        call_output(&answer(&setup.state, setup.chat_id).await),
        json!({"status":"cancelled","reason":"context_unavailable"})
    );
    assert_eq!(rows(&setup.state, "client_executor_calls").await, 0);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_pane_that_connects_within_the_grace_gets_the_call(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    wait_handed_over(&setup.state).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    let mut pane = Pane::open_as(&base, &mailbox(), Uuid::now_v7()).await;
    let call = call_of(&pane.call().await);
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
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_newest_pane_serves_new_calls_and_an_older_one_once_it_closes(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let mut older = Pane::open_as(&base, &mailbox(), Uuid::now_v7()).await;
    let older_stream = presence(&setup.state, &mailbox()).await.expect("presence");
    tokio::time::sleep(Duration::from_millis(5)).await;
    let mut newer = Pane::open_as(&base, &mailbox(), Uuid::now_v7()).await;
    assert_ne!(presence(&setup.state, &mailbox()).await, Some(older_stream));
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    let call = call_of(&newer.call().await);
    assert_eq!(older.next(Duration::from_secs(1)).await, None);
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

    drop(newer);
    tokio::time::timeout(Duration::from_secs(5), async {
        while presence(&setup.state, &mailbox()).await != Some(older_stream) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the older pane serves again");
    let other_chat = seed_origin_chat(&setup.state.db).await;
    submit_detached(&setup.state, &base, other_chat, &mailbox()).await;
    let event = older.call().await;
    assert_eq!(event["chat_id"], other_chat.to_string());
    server.abort();
}

/// The server may not see a silently dropped connection die for minutes. The
/// pane's reconnect gets its call again at once; a newer pane never gets it.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_delivered_call_goes_again_only_to_its_own_pane(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let instance = Uuid::now_v7();
    let mut silent = Pane::open_as(&base, &mailbox(), instance).await;
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    let call = call_of(&silent.call().await);

    tokio::time::sleep(Duration::from_millis(5)).await;
    let mut newer = Pane::open_as(&base, &mailbox(), Uuid::now_v7()).await;
    let mut reconnected = Pane::open_as(&base, &mailbox(), instance).await;
    assert_eq!(call_of(&reconnected.call().await), call);
    assert_eq!(newer.next(Duration::from_secs(1)).await, None);
    assert_eq!(silent.next(Duration::from_secs(1)).await, None);
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
    server.abort();
}

/// A pane left open elsewhere never runs a call another pane had: once that
/// pane is gone for the grace, the call ends.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_call_whose_pane_closed_goes_to_no_other_pane(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let mut pane = Pane::open_as(&base, &mailbox(), Uuid::now_v7()).await;
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    pane.call().await;
    let mut other_pane = Pane::open_as(&base, &mailbox(), Uuid::now_v7()).await;
    drop(pane);
    assert_eq!(
        other_pane
            .next(PRESENCE_LOSS_GRACE - Duration::from_secs(5))
            .await,
        None
    );
    assert!(wait_idle(&setup.state, setup.chat_id, Duration::from_secs(15)).await);
    assert_eq!(
        call_output(&answer(&setup.state, setup.chat_id).await),
        json!({"status":"cancelled","reason":"context_unavailable"})
    );
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_newer_pane_without_the_tool_leaves_its_calls_to_one_with_it(pool: Pool<Postgres>) {
    let setup = setup_stream(pool, TIMEOUT_MS, true, false).await;
    let (base, server) = serve(&setup.state).await;
    let mut serving = Pane::open_as(&base, &mailbox(), Uuid::now_v7()).await;
    tokio::time::sleep(Duration::from_millis(5)).await;
    let mut other_tools = Pane::open_request(
        reqwest::Client::new()
            .get(format!("{base}/me/client-operations/stream"))
            .bearer_auth(TEST_JWT_TOKEN)
            .header("X-Erato-Client-Tools", "another_tool")
            .header(
                "X-Erato-Executor",
                serde_json::to_string(&mailbox()).unwrap(),
            )
            .header("X-Erato-Executor-Instance", Uuid::now_v7().to_string()),
    )
    .await;
    submit_detached(&setup.state, &base, setup.chat_id, &mailbox()).await;
    let call = call_of(&serving.call().await);
    assert_eq!(other_tools.next(Duration::from_secs(1)).await, None);
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
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn grant_calls_need_a_pane_that_takes_them(pool: Pool<Postgres>) {
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
        LiveCallRoute::Unavailable
    );
    assert_eq!(route(true, false).await.unwrap(), LiveCallRoute::ChatStream);

    let (older, newer) = (Uuid::new_v4(), Uuid::new_v4());
    let tools = vec![TOOL.to_string()];
    executor_stream::announce(db, &presence_claim(account, &binding, &[]), older)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(5)).await;
    executor_stream::announce(db, &presence_claim(account, &binding, &tools), newer)
        .await
        .unwrap();
    assert!(matches!(
        route(false, true).await.unwrap(),
        LiveCallRoute::Executor(presence)
            if presence.stream_id == newer && presence.serves_grant_call(TOOL)
    ));
    assert_eq!(route(true, false).await.unwrap(), LiveCallRoute::ChatStream);

    executor_stream::release(db, newer).await.unwrap();
    assert_eq!(
        route(false, true).await.unwrap(),
        LiveCallRoute::Unavailable
    );
    assert!(matches!(
        route(false, false).await.unwrap(),
        LiveCallRoute::Executor(presence) if presence.stream_id == older
    ));
}

/// A pending attempt for the mailbox binding, nudged on its stream.
async fn nudged_attempt(
    state: &erato::state::AppState,
    chat_id: Uuid,
    lineage: Option<executor_stream::CallLineage>,
) -> OperationRequest {
    let db = &state.db;
    let message_id = seed_row(db, chat_id, None, "assistant", None, None).await;
    let request = OperationRequest {
        attempt_id: Uuid::new_v4(),
        operation_id: QUALIFIED.into(),
        kind: client_tool::CLIENT_TOOL_KIND.into(),
        realm: ExecutionRealm::OfficeAddin,
        chat_id,
        message_id,
        tool_call_id: CALL.into(),
        account_id: account(state).await,
        binding: mailbox(),
        base_revision: None,
        consent: ConsentPolicy::None,
        expires_at: chrono::Utc::now() + chrono::Duration::hours(1),
        input: json!({}),
        lineage,
    };
    db.execute_raw(sea_orm::Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        r#"INSERT INTO client_operation_attempts
             (attempt_id, account_id, chat_id, message_id, tool_call_id, generation_id,
              request, state, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)"#,
        [
            request.attempt_id.into(),
            request.account_id.into(),
            chat_id.into(),
            message_id.into(),
            CALL.into(),
            Uuid::new_v4().into(),
            serde_json::to_value(&request).unwrap().into(),
            request.expires_at.into(),
        ],
    ))
    .await
    .unwrap();
    executor_stream::nudge(db, &request).await.unwrap();
    request
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_grant_operation_nudge_goes_only_to_a_stream_that_takes_grant_calls(
    pool: Pool<Postgres>,
) {
    let mut config = hermetic_app_config(None, None);
    config.client_tools.executor_stream_enabled = true;
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let (base, server) = serve(&state).await;
    let mut plain = Pane::open_serving(&base, &mailbox(), TOOL, None).await;
    let own = nudged_attempt(&state, chat_id, None).await;
    let nudge = plain
        .next(Duration::from_secs(2))
        .await
        .expect("the user's own operation goes to any stream of its binding");
    assert_eq!(nudge["attempt_id"], own.attempt_id.to_string());

    let granted = nudged_attempt(
        &state,
        chat_id,
        Some(executor_stream::CallLineage {
            owner_chat_id: Uuid::new_v4(),
            owner_message_id: Uuid::new_v4(),
            requesting_chat_id: chat_id,
            requesting_message_id: Uuid::new_v4(),
            context_ref: None,
        }),
    )
    .await;
    assert_eq!(plain.next(Duration::from_secs(1)).await, None);
    let mut takes_grants = Pane::open_serving(&base, &mailbox(), TOOL, Some(TOOL)).await;
    let nudge = takes_grants
        .next(Duration::from_secs(2))
        .await
        .expect("a stream that takes grant calls gets the waiting nudge");
    assert_eq!(nudge["message_type"], "client_operation_available");
    assert_eq!(nudge["attempt_id"], granted.attempt_id.to_string());
    assert_eq!(plain.next(Duration::from_millis(500)).await, None);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn cleanup_removes_only_rows_that_no_run_or_stream_can_use(pool: Pool<Postgres>) {
    let state = test_app_state(hermetic_app_config(None, None), pool).await;
    let db = &state.db;
    let account = account(&state).await;
    let chat_id = seed_origin_chat(db).await;
    let binding = mailbox();
    let held = Uuid::new_v4();
    executor_stream::announce(db, &presence_claim(account, &binding, &[]), held)
        .await
        .unwrap();
    let stale = mailbox_binding("device-two", 'a');
    executor_stream::announce(db, &presence_claim(account, &stale, &[]), Uuid::new_v4())
        .await
        .unwrap();
    db.execute_unprepared(&format!(
        "UPDATE client_executor_presence SET expires_at = now() - interval '2 minutes' \
         WHERE stream_id <> '{held}'"
    ))
    .await
    .unwrap();
    let running_chat = seed_origin_chat(db).await;
    let generation = Uuid::new_v4();
    set_running(db, running_chat, generation).await;
    let running_call = handed_call(account, running_chat, generation);
    for call in [
        handed_call(account, chat_id, Uuid::new_v4()),
        handed_call(account, running_chat, Uuid::new_v4()),
        running_call.clone(),
    ] {
        executor_stream::hand_over(db, &call).await.unwrap();
    }
    let request = |attempt_id, message_id| OperationRequest {
        attempt_id,
        operation_id: QUALIFIED.into(),
        kind: client_tool::CLIENT_TOOL_KIND.into(),
        realm: ExecutionRealm::OfficeAddin,
        chat_id,
        message_id,
        tool_call_id: CALL.into(),
        account_id: account,
        binding: binding.clone(),
        base_revision: None,
        consent: ConsentPolicy::None,
        expires_at: chrono::Utc::now() + chrono::Duration::hours(1),
        input: json!({}),
        lineage: None,
    };
    let pending = request(
        Uuid::new_v4(),
        seed_row(db, chat_id, None, "assistant", None, None).await,
    );
    db.execute_raw(sea_orm::Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        r#"INSERT INTO client_operation_attempts
             (attempt_id, account_id, chat_id, message_id, tool_call_id, generation_id,
              request, state, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)"#,
        [
            pending.attempt_id.into(),
            account.into(),
            chat_id.into(),
            pending.message_id.into(),
            CALL.into(),
            Uuid::new_v4().into(),
            serde_json::to_value(&pending).unwrap().into(),
            pending.expires_at.into(),
        ],
    ))
    .await
    .unwrap();
    for nudge in [request(Uuid::new_v4(), Uuid::new_v4()), pending.clone()] {
        executor_stream::nudge(db, &nudge).await.unwrap();
    }
    assert_eq!(rows(&state, "client_executor_calls").await, 5);
    executor_stream::cleanup(db).await.unwrap();
    let kept = db
        .query_all_raw(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            "SELECT message_id FROM client_executor_calls ORDER BY call_id",
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get::<Uuid>("", "message_id").unwrap())
        .collect::<Vec<_>>();
    assert_eq!(kept, [running_call.message_id, pending.message_id]);
    assert_eq!(rows(&state, "client_executor_presence").await, 1);
    assert_eq!(presence(&state, &binding).await, Some(held));
}
