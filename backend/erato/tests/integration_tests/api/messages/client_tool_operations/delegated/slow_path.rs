//! The slow path (ERMAIN-1032): a granted read whose tool dispatches durably
//! parks at once as a `client_tool.v1` operation for the grant's binding, and
//! the parent waits on the child. Run for the rows whose host context
//! outlives the pane session.
use super::super::executor_stream::wait_released;
use super::*;
use crate::test_utils::build_openai_paused_tool_calls_streaming_response;
use erato::config::ChildDispatch;
use erato::db::entity::client_operation_attempts as attempts;
use erato::services::client_operations::{
    OperationOutcome, OperationRequest, OperationResult, OperationValue,
};

/// The row's read tool with a `[durable]` table and `child_dispatch = "durable"`.
pub(super) fn dispatch_durably(row: &HostRow, config: &mut erato::config::AppConfig) {
    config.client_tools.durable_operations_enabled = true;
    config.client_tools.tools.insert(
        READ_KEY.into(),
        row.read_config(
            true,
            Some(ChildDispatch::Durable),
            erato::config::ClientToolApprovalScope::Call,
        ),
    );
}

/// A client task whose granted read waits for a client, with the parent
/// parked on it.
pub(super) struct Waiting {
    pub state: erato::state::AppState,
    pub base: String,
    pub server: tokio::task::JoinHandle<()>,
    pub llm: MockServer,
    /// Open at launch; `None` when the test closed it before the child's call.
    pub _pane: Option<Pane>,
    pub chat_id: Uuid,
    pub parent_message: erato::db::entity::messages::Model,
    pub child: chats::Model,
    pub request: OperationRequest,
}

/// Parks a client task on its durable read. With `close_pane`, the pane that
/// served the launch is gone before the child calls.
pub(super) async fn park_a_waiting_child(
    row: &HostRow,
    pool: Pool<Postgres>,
    close_pane: bool,
    tweak: impl FnOnce(&mut erato::config::AppConfig),
) -> Waiting {
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    let first = if close_pane {
        build_openai_paused_tool_calls_streaming_response(
            "Reading the introduction.",
            DISPATCH_PAUSE,
            &[(CHILD_READ_CALL, row.read_tool, row.model_input.clone())],
        )
    } else {
        read_call(row)
    };
    mock_client_child(&mut mocks, &child, first, CHILD_READ_CALL);
    let (state, llm) = delegated_state(row, pool, mocks, |config| {
        dispatch_durably(row, config);
        tweak(config);
    })
    .await;
    let (base, server) = serve(&state).await;
    let pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    let pane = if close_pane {
        let client_child = wait_child(&state.db, chat_id, CHILD_FACET).await;
        assert!(task_spec(&client_child)["client_grant"].is_object());
        drop(pane);
        wait_released(&state, &row.binding()).await;
        None
    } else {
        Some(pane)
    };
    let body = finish(run).await;
    assert!(
        !body.contains(PARENT_FINAL),
        "the parent waits for its task"
    );
    assert_eq!(
        reload(&state.db, chat_id).await.generation_state.as_deref(),
        Some("awaiting_approval")
    );
    let child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    assert_eq!(
        reload(&state.db, child.id)
            .await
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );
    let parked = attempts::Entity::find()
        .filter(attempts::Column::ChatId.eq(child.id))
        .all(&state.db)
        .await
        .unwrap();
    assert_eq!(
        parked.len(),
        1,
        "one durable operation for the child's call"
    );
    let request = serde_json::from_value(parked[0].request.clone()).unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while state.background_tasks.get_task(&child.id).await.is_some() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the parked child's run ends");
    Waiting {
        parent_message: assistant_row(&state.db, chat_id).await,
        state,
        base,
        server,
        llm,
        _pane: pane,
        chat_id,
        child,
        request,
    }
}

/// Claims the operation as the row's pane, saying whether its handler takes
/// grant calls.
async fn claim_as_pane(
    row: &HostRow,
    waiting: &Waiting,
    takes_grant_calls: bool,
) -> axum_test::TestResponse {
    claim(
        row,
        &waiting.state,
        waiting.request.attempt_id,
        takes_grant_calls,
    )
    .await
}

async fn claim(
    row: &HostRow,
    state: &erato::state::AppState,
    attempt_id: Uuid,
    takes_grant_calls: bool,
) -> axum_test::TestResponse {
    let mut request = app_server(state.clone())
        .post(&format!(
            "/api/v1beta/me/client-operations/{attempt_id}/claim"
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", pane_tools(row));
    if takes_grant_calls {
        request = request.add_header("X-Erato-Child-Client-Tools", child_pane_tools(row));
    }
    request.json(&json!({ "binding": row.binding() })).await
}

fn pane_result(row: &HostRow, request: &OperationRequest) -> OperationResult {
    OperationResult {
        attempt_id: request.attempt_id,
        operation_id: request.operation_id.clone(),
        base_revision: None,
        outcome: OperationOutcome::Succeeded,
        result: Some(OperationValue::Value {
            value: json!({ "text": PANE_TEXT, "freshness": row.freshness }),
        }),
        error: None,
        executor: row.binding(),
    }
}

async fn attempt_row(waiting: &Waiting) -> attempts::Model {
    attempts::Entity::find_by_id(waiting.request.attempt_id)
        .one(&waiting.state.db)
        .await
        .unwrap()
        .unwrap()
}

fn continuestream(waiting: &Waiting, body: Value) -> axum_test::TestRequest {
    let mut body = body;
    body["message_id"] = json!(waiting.parent_message.id);
    app_server(waiting.state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body)
}

pub(super) async fn a_durable_child_call_parks_and_the_parent_shows_what_it_waits_for(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let waiting = park_a_waiting_child(row, pool, true, |_| {}).await;
    let grant = &task_spec(&waiting.child)["client_grant"];
    assert_eq!(grant["durable_tools"], json!([row.qualified()]));

    let request = &waiting.request;
    let child_row = assistant_row(&waiting.state.db, waiting.child.id).await;
    assert_eq!(request.kind, "client_tool.v1");
    assert_eq!(request.operation_id, row.qualified());
    assert_eq!(request.binding, row.binding());
    assert_eq!(request.chat_id, waiting.child.id);
    assert_eq!(request.message_id, child_row.id);
    assert_eq!(request.input, row.dispatched_input());
    assert_eq!(
        serde_json::to_value(&request.lineage).unwrap(),
        lineage(
            row,
            (waiting.chat_id, waiting.parent_message.id),
            (waiting.child.id, &json!(child_row.id))
        )
    );
    let read = part_for(&child_row, CHILD_READ_CALL);
    assert_eq!(read["status"], "in_progress");
    assert_eq!(
        read["input"], row.model_input,
        "the stored call keeps the model's input"
    );
    let child_stop = child_row.raw_message["content"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(child_stop["content_type"], "client_tool_pending");
    assert_eq!(child_stop["attempt_id"], json!(request.attempt_id));

    let stop = parked_part(&waiting.parent_message);
    assert_eq!(stop["kind"], "delegated_task");
    let items = stop["approvals"].as_array().unwrap();
    assert_eq!(items.len(), 1, "{stop}");
    let slot = part_for(&waiting.parent_message, CLIENT_TASK_CALL);
    assert_eq!(items[0]["approval_id"], slot["tool_call_id"]);
    let child_item = &items[0]["child"];
    assert_eq!(child_item["child_chat_id"], json!(waiting.child.id));
    assert_eq!(child_item["child_message_id"], json!(child_row.id));
    assert_eq!(child_item["child_tool_call_id"], read["tool_call_id"]);
    assert_eq!(child_item["tool_name"], row.read_tool);
    assert_eq!(child_item["mcp_server_id"], row.namespace);
    assert_eq!(child_item["input"], row.model_input);
    assert_eq!(child_item["kind"], "client_tool");
    assert_eq!(
        child_item["waiting_for"],
        json!({"host_context": row.host.as_str(), "attempt_id": request.attempt_id})
    );
    assert_eq!(slot["status"], "in_progress");
    assert_eq!(slot["output"]["status"], "input_required", "{slot}");
    assert_eq!(slot["output"]["reason"], "client_pending", "{slot}");

    let mut pane = Pane::open_serving(
        &waiting.base,
        &row.binding(),
        &row.pane_tools(),
        Some(row.child_pane_tools()),
    )
    .await;
    let nudge = pane
        .next(Duration::from_secs(3))
        .await
        .expect("a pane that connects after the park gets the nudge");
    assert_eq!(nudge["message_type"], "client_operation_available");
    assert_eq!(nudge["attempt_id"], json!(request.attempt_id));
    waiting.server.abort();
}

pub(super) async fn a_pane_without_grant_support_cannot_claim_a_grant_operation(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let refused = claim_as_pane(row, &waiting, false).await;
    refused.assert_status_conflict();
    assert_eq!(refused.text(), "Executor binding mismatch");
    assert_eq!(
        attempt_row(&waiting).await.state,
        attempts::AttemptState::Pending,
        "a refused claim withdraws nothing"
    );
    claim_as_pane(row, &waiting, true).await.assert_status_ok();
    waiting.server.abort();
}

pub(super) async fn a_claimed_grant_operation_is_authorized_while_the_parent_is_parked_on_the_child(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let claimed = claim_as_pane(row, &waiting, true).await;
    claimed.assert_status_ok();
    let token = claimed.json::<Value>()["claim_token"].clone();
    let renewed = claim_as_pane(row, &waiting, true).await;
    renewed.assert_status_ok();
    assert_eq!(renewed.json::<Value>()["claim_token"], token);
    let completed = app_server(waiting.state.clone())
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/result",
            waiting.request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", row.pane_tools())
        .json(&json!({
            "claim_token": token,
            "result": pane_result(row, &waiting.request),
        }))
        .await;
    completed.assert_status_ok();
    assert_eq!(completed.json::<Value>()["state"], "ready");
    let settled = attempt_row(&waiting).await;
    assert_eq!(settled.state, attempts::AttemptState::Ready);
    assert_eq!(
        settled.validated_result.unwrap()["output"]["result"]["text"],
        PANE_TEXT
    );
    waiting.server.abort();
}

pub(super) async fn a_grant_operation_is_withdrawn_once_the_parent_chat_is_archived(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    use sea_orm::ConnectionTrait;
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    waiting
        .state
        .db
        .execute_unprepared(&format!(
            "UPDATE chats SET archived_at = now() WHERE id = '{}'",
            waiting.chat_id
        ))
        .await
        .unwrap();
    let refused = claim_as_pane(row, &waiting, true).await;
    refused.assert_status_conflict();
    assert_eq!(refused.text(), "Operation authorization withdrawn");
    let settled = attempt_row(&waiting).await;
    assert_eq!(settled.state, attempts::AttemptState::Ready);
    let output = &settled.validated_result.unwrap()["output"];
    assert_eq!(output["status"], "cancelled");
    assert_eq!(output["reason"], "withdrawn");
    assert!(
        output["error"]
            .as_str()
            .is_some_and(|text| text.contains("withdrawn") && text.contains(row.read_tool)),
        "the task's model reads why its result is missing: {output}"
    );
    waiting.server.abort();
}

async fn assert_claim_withdrawn(row: &HostRow, waiting: &Waiting) {
    let refused = claim_as_pane(row, waiting, true).await;
    refused.assert_status_conflict();
    assert_eq!(refused.text(), "Operation authorization withdrawn");
    let settled = attempt_row(waiting).await;
    assert_eq!(settled.state, attempts::AttemptState::Ready);
    assert_eq!(
        settled.validated_result.unwrap()["output"]["reason"],
        "withdrawn"
    );
}

pub(super) async fn a_grant_operation_is_withdrawn_once_the_user_never_allows_the_tool(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    erato::models::user_preference::set_client_tool_decision(
        &waiting.state.db,
        &account(&waiting.state).await,
        &row.qualified(),
        erato::models::user_preference::ClientToolDecision::NeverAllow,
    )
    .await
    .unwrap();
    assert_claim_withdrawn(row, &waiting).await;
    waiting.server.abort();
}

pub(super) async fn a_grant_operation_its_grant_does_not_hold_durably_is_withdrawn(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    use sea_orm::ConnectionTrait;
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    waiting
        .state
        .db
        .execute_unprepared(&format!(
            "UPDATE chats SET assistant_configuration = jsonb_set(assistant_configuration, \
             '{{task,client_grant,durable_tools}}', '[]'::jsonb) WHERE id = '{}'",
            waiting.child.id
        ))
        .await
        .unwrap();
    assert_eq!(
        task_spec(&reload(&waiting.state.db, waiting.child.id).await)["client_grant"]["durable_tools"],
        json!([])
    );
    assert_claim_withdrawn(row, &waiting).await;
    waiting.server.abort();
}

pub(super) async fn a_grant_operation_result_is_refused_without_a_claim(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let call = (
        waiting.request.message_id,
        waiting.request.tool_call_id.clone(),
    );
    let stored = post_live(
        &waiting.state,
        waiting.child.id,
        &call,
        json!({ "result": { "text": PANE_TEXT } }),
        Some(&row.binding()),
    )
    .await;
    stored.assert_status_conflict();
    assert_eq!(stored.text(), "Operation requires a claim");

    // The child's run holding the operation in memory, as between its
    // dispatch and its park.
    let (_events, task) = waiting
        .state
        .background_tasks
        .try_start_task(
            waiting.child.id,
            waiting.request.message_id,
            erato::services::background_tasks::Takeover::TakeParked,
            waiting.state.config.generation_status.stale_after_secs,
        )
        .await
        .unwrap();
    task.register_client_operation(waiting.request.clone())
        .await
        .unwrap();
    let in_memory = post_live(
        &waiting.state,
        waiting.child.id,
        &call,
        json!({ "result": { "text": PANE_TEXT } }),
        Some(&row.binding()),
    )
    .await;
    in_memory.assert_status_conflict();
    assert_eq!(in_memory.text(), "Operation requires a claim");
    waiting
        .state
        .background_tasks
        .remove_task(
            &waiting.child.id,
            task.generation_id,
            erato::services::background_tasks::TaskOutcome::AwaitingApproval,
        )
        .await;
    assert_eq!(
        attempt_row(&waiting).await.state,
        attempts::AttemptState::Pending
    );
    waiting.server.abort();
}

pub(super) async fn continuestream_refuses_a_decision_naming_a_waiting_item(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let approval_id = parked_part(&waiting.parent_message)["approvals"][0]["approval_id"].clone();
    let refused = continuestream(
        &waiting,
        json!({
            "decisions": [{ "approval_id": approval_id, "decision": "approve" }],
            "shows_child_items": true,
        }),
    )
    .await;
    refused.assert_status_conflict();
    assert!(
        refused.text().contains("Reload the page"),
        "{}",
        refused.text()
    );
    assert_eq!(
        reload(&waiting.state.db, waiting.chat_id)
            .await
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );
    waiting.server.abort();
}

pub(super) async fn continuestream_refuses_a_single_decision_when_only_waiting_items_are_open(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let refused = continuestream(&waiting, json!({ "decision": "approve" })).await;
    refused.assert_status_conflict();
    assert!(
        refused.text().contains("Reload the page"),
        "{}",
        refused.text()
    );
    // A card that shows waiting children answered a stop decided elsewhere.
    let stale = continuestream(
        &waiting,
        json!({ "decision": "approve", "shows_child_items": true }),
    )
    .await;
    stale.assert_status_conflict();
    assert_eq!(
        stale.json::<Value>(),
        json!({ "code": "already_continued" })
    );
    assert_eq!(
        attempt_row(&waiting).await.state,
        attempts::AttemptState::Pending
    );
    waiting.server.abort();
}

pub(super) async fn an_empty_continuestream_while_children_wait_is_children_waiting(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let refused = continuestream(
        &waiting,
        json!({ "decisions": [], "shows_child_items": true }),
    )
    .await;
    refused.assert_status_conflict();
    assert_eq!(
        refused.json::<Value>(),
        json!({ "code": "children_waiting" })
    );
    assert_eq!(
        attempt_row(&waiting).await.state,
        attempts::AttemptState::Pending
    );
    waiting.server.abort();
}

/// A second read tool of the row's host, never dispatched durably.
const LIVE_KEY: &str = "host_read_live";
const LIVE_TOOL: &str = "read_live";
const SECOND_BRIEF: &str = "SECOND-CLIENT-SENTINEL: read the conclusion";
const SECOND_TASK_CALL: &str = "call_client_task_2";
const SECOND_READ_CALL: &str = "call_child_read_2";
const SECOND_ANSWER: &str = "SECOND-CHILD-ANSWER";
const LATER_READ_CALL: &str = "call_child_read_later";
const MOVED_ON: &str = "MOVED-ON-SENTINEL: something else";
const MOVED_ON_ANSWER: &str = "MOVED-ON-ANSWER";
/// Lower than mocktail's default, so a mock added after the park wins.
const OVERRIDE: u8 = 1;

fn pane_tools(row: &HostRow) -> String {
    format!("{},{LIVE_TOOL},{WRITE_TOOL}", row.read_tool)
}

fn child_pane_tools(row: &HostRow) -> String {
    format!("{},{LIVE_TOOL}", row.read_tool)
}

fn add_live_read(row: &HostRow, config: &mut erato::config::AppConfig) {
    let mut tool = row.read_config(false, None, erato::config::ClientToolApprovalScope::Call);
    tool.name = LIVE_TOOL.into();
    config.client_tools.tools.insert(LIVE_KEY.into(), tool);
}

fn live_tool(row: &HostRow) -> String {
    format!("{}/{LIVE_TOOL}", row.namespace)
}

fn second_task() -> (&'static str, Value) {
    (
        SECOND_TASK_CALL,
        json!({ "task": SECOND_BRIEF, "facet_ids": [CHILD_FACET] }),
    )
}

fn calls(row: &HostRow, call: &str, tool: &str) -> Vec<mocktail::body::BodyAction> {
    build_openai_tool_calls_streaming_response(&[(call, tool, row.model_input.clone())])
}

/// A client child for `brief` that answers `first`, and `answer` once a
/// result for `first_call` is back.
fn mock_child(
    mocks: &mut MockSet,
    brief: &'static str,
    first: Vec<mocktail::body::BodyAction>,
    first_call: &'static str,
    answer: &'static str,
) {
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[brief],
                &[USER_MESSAGE, first_call],
            ));
        mock_llm_sse_response(then, first);
    });
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[brief, first_call],
                &[USER_MESSAGE],
            ));
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[answer]));
    });
}

/// From now on the parent's turns after its tasks are back are recorded.
fn record_parent_resumes(llm: &mut MockServer) -> RequestBodyRecorder {
    let recorder = RequestBodyRecorder::new();
    let capture = recorder.clone();
    llm.mock_with_options(OVERRIDE, None, move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[USER_MESSAGE, "child_run_id"],
                &[],
            ))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[PARENT_FINAL]));
    });
    recorder
}

/// From now on the first client child's turns after its read are answered by
/// `then_answer` and recorded.
fn after_the_read(
    llm: &mut MockServer,
    then_answer: Vec<mocktail::body::BodyAction>,
    unless: &'static [&'static str],
) -> RequestBodyRecorder {
    let recorder = RequestBodyRecorder::new();
    let capture = recorder.clone();
    llm.mock_with_options(OVERRIDE, None, move |when, then| {
        let mut excluded = vec![USER_MESSAGE];
        excluded.extend_from_slice(unless);
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[CLIENT_BRIEF, CHILD_READ_CALL],
                &excluded,
            ))
            .matcher(capture);
        mock_llm_sse_response(then, then_answer);
    });
    recorder
}

/// The next live call the pane receives; nudges for durable operations are
/// skipped.
async fn live_call(pane: &mut Pane) -> Value {
    loop {
        let event = pane
            .next(Duration::from_secs(15))
            .await
            .expect("a live call on the executor stream");
        if event["message_type"] == "client_tool_call" {
            return event;
        }
        assert_eq!(event["message_type"], "client_operation_available");
    }
}

async fn claim_token(row: &HostRow, state: &erato::state::AppState, attempt_id: Uuid) -> Value {
    let claimed = claim(row, state, attempt_id, true).await;
    claimed.assert_status_ok();
    claimed.json::<Value>()["claim_token"].clone()
}

async fn post_result(
    row: &HostRow,
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
        .add_header("X-Erato-Client-Tools", pane_tools(row))
        .json(&json!({ "claim_token": token, "result": result }))
        .await
}

/// Any of the user's clients continuing a grant operation, without a stream.
async fn continue_operation(
    state: &erato::state::AppState,
    attempt_id: Uuid,
) -> axum_test::TestResponse {
    app_server(state.clone())
        .post(&format!(
            "/api/v1beta/me/client-operations/{attempt_id}/continue"
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
}

/// What a pane that takes grant calls does with one: claim, answer, and
/// continue the child.
async fn answer_as_pane(
    row: &HostRow,
    state: &erato::state::AppState,
    request: &OperationRequest,
    result: OperationResult,
) {
    let token = claim_token(row, state, request.attempt_id).await;
    post_result(row, state, &token, &result)
        .await
        .assert_status_ok();
    continue_operation(state, request.attempt_id)
        .await
        .assert_status_ok();
}

fn declined_result(row: &HostRow, request: &OperationRequest) -> OperationResult {
    OperationResult {
        outcome: OperationOutcome::Rejected,
        result: None,
        error: Some(erato::services::client_operations::OperationError {
            code: "declined".into(),
            validation: None,
            message: None,
        }),
        ..pane_result(row, request)
    }
}

async fn eventually<T, F, Fut>(what: &str, mut probe: F) -> T
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Option<T>>,
{
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if let Some(found) = probe().await {
                return found;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
}

fn text_of(row: &erato::db::entity::messages::Model) -> String {
    row.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|part| part["content_type"] == "text")
        .filter_map(|part| part["text"].as_str())
        .collect()
}

/// The parent's turn, once it has answered and its lease is free.
async fn wait_answered(
    state: &erato::state::AppState,
    chat_id: Uuid,
) -> erato::db::entity::messages::Model {
    eventually("the parent's answer", || async {
        let idle = state.background_tasks.get_task(&chat_id).await.is_none()
            && reload(&state.db, chat_id).await.generation_state.as_deref() == Some("completed");
        let row = assistant_row(&state.db, chat_id).await;
        (idle && text_of(&row).contains(PARENT_FINAL)).then_some(row)
    })
    .await
}

async fn wait_idle(state: &erato::state::AppState, chat_id: Uuid, generation_state: &str) {
    eventually(generation_state, || async {
        (state.background_tasks.get_task(&chat_id).await.is_none()
            && reload(&state.db, chat_id).await.generation_state.as_deref()
                == Some(generation_state))
        .then_some(())
    })
    .await
}

async fn attempts_of(state: &erato::state::AppState, chat_id: Uuid) -> Vec<attempts::Model> {
    attempts::Entity::find()
        .filter(attempts::Column::ChatId.eq(chat_id))
        .order_by_asc(attempts::Column::CreatedAt)
        .all(&state.db)
        .await
        .unwrap()
}

/// The child's newest operation, once it exists.
async fn operation_of(
    state: &erato::state::AppState,
    chat_id: Uuid,
    nth: usize,
) -> OperationRequest {
    let attempt = eventually("the child's operation", || async {
        attempts_of(state, chat_id).await.into_iter().nth(nth)
    })
    .await;
    serde_json::from_value(attempt.request).unwrap()
}

/// The delegated child answering the parent's `call`.
async fn child_for(state: &erato::state::AppState, chat_id: Uuid, call: &str) -> chats::Model {
    let suffix = format!(":{call}");
    eventually("the task's child chat", || async {
        chats::Entity::find()
            .all(&state.db)
            .await
            .unwrap()
            .into_iter()
            .find(|chat| {
                chat.assistant_configuration.as_ref().is_some_and(|config| {
                    config["provenance"]["origin_chat_id"] == json!(chat_id)
                        && config["task"]["parent_tool_call_id"]
                            .as_str()
                            .is_some_and(|id| id.ends_with(&suffix))
                })
            })
    })
    .await
}

fn stops(row: &erato::db::entity::messages::Model) -> Vec<Value> {
    row.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|part| part["content_type"] == "tool_approval_request")
        .cloned()
        .collect()
}

/// The item of the parent's last stop for the task `call`.
fn item_for(row: &erato::db::entity::messages::Model, call: &str) -> Value {
    let suffix = format!(":{call}");
    parked_part(row)["approvals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| {
            item["tool_call_id"]
                .as_str()
                .is_some_and(|id| id.ends_with(&suffix))
        })
        .unwrap_or_else(|| panic!("no item for {call}: {}", parked_part(row)))
        .clone()
}

/// The result of the task `call` as the parent's model read it in `body`.
fn task_result_in(body: &Value, call: &str) -> Value {
    let suffix = format!(":{call}");
    let content = &body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| {
            message["role"] == "tool"
                && message["tool_call_id"]
                    .as_str()
                    .is_some_and(|id| id == call || id.ends_with(&suffix))
        })
        .unwrap_or_else(|| panic!("no result for {call}: {body}"))["content"];
    content
        .as_str()
        .and_then(|text| serde_json::from_str(text).ok())
        .unwrap_or_else(|| content.clone())
}

/// The tool parts of a row for the provider's `call`: one per dispatch.
fn calls_named(row: &erato::db::entity::messages::Model, call: &str) -> usize {
    let suffix = format!(":{call}");
    row.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|part| {
            part["content_type"] == "tool_use"
                && part["tool_call_id"]
                    .as_str()
                    .is_some_and(|id| id.ends_with(&suffix))
        })
        .count()
}

fn assert_row_reads(row: &erato::db::entity::messages::Model) {
    erato::models::message::MessageSchema::validate(&row.raw_message)
        .unwrap_or_else(|error| panic!("{error}: {}", row.raw_message));
}

/// A parent that plans `tasks` on the row's pane, whose children `children`
/// answers. Tasks dispatch the row's read durably; `read_live` stays live.
pub(super) struct Launched {
    pub state: erato::state::AppState,
    pub base: String,
    pub server: tokio::task::JoinHandle<()>,
    pub llm: MockServer,
    pub pane: Pane,
    pub chat_id: Uuid,
    run: Option<tokio::task::JoinHandle<String>>,
}

/// `asking` are the qualified tools the user asks about before each call.
async fn launch(
    row: &HostRow,
    pool: Pool<Postgres>,
    tasks: Vec<(&'static str, Value)>,
    children: impl FnOnce(&mut MockSet),
    tweak: impl FnOnce(&mut erato::config::AppConfig),
    asking: &[String],
) -> Launched {
    let parent = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, tasks);
    children(&mut mocks);
    let (state, llm) = delegated_state(row, pool, mocks, |config| {
        dispatch_durably(row, config);
        add_live_read(row, config);
        tweak(config);
    })
    .await;
    for tool in asking {
        erato::models::user_preference::set_client_tool_decision(
            &state.db,
            &account(&state).await,
            tool,
            erato::models::user_preference::ClientToolDecision::Ask,
        )
        .await
        .unwrap();
    }
    let (base, server) = serve(&state).await;
    let pane = Pane::open_serving(
        &base,
        &row.binding(),
        &pane_tools(row),
        Some(&child_pane_tools(row)),
    )
    .await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    Launched {
        state,
        base,
        server,
        llm,
        pane,
        chat_id,
        run: Some(run),
    }
}

impl Launched {
    /// The parent's first turn's stream, once it has ended.
    async fn finish(&mut self) -> String {
        finish(self.run.take().expect("the parent turn runs once")).await
    }

    /// The parent's row once its first turn parked and its children are idle.
    async fn parked(&mut self) -> erato::db::entity::messages::Model {
        let body = self.finish().await;
        assert!(
            !body.contains(PARENT_FINAL),
            "the parent waits for its tasks"
        );
        wait_idle(&self.state, self.chat_id, "awaiting_approval").await;
        let row = assistant_row(&self.state.db, self.chat_id).await;
        for item in parked_part(&row)["approvals"].as_array().unwrap() {
            let child: Uuid =
                serde_json::from_value(item["child"]["child_chat_id"].clone()).unwrap();
            eventually("the child's run to end", || async {
                self.state
                    .background_tasks
                    .get_task(&child)
                    .await
                    .is_none()
                    .then_some(())
            })
            .await;
        }
        row
    }

    /// Decides the parent's open items over a real connection.
    fn decide(
        &self,
        message_id: Uuid,
        decisions: Vec<(Value, &str)>,
    ) -> tokio::task::JoinHandle<String> {
        spawn_decision(
            &self.base,
            json!({
                "message_id": message_id,
                "decisions": decisions
                    .into_iter()
                    .map(|(approval_id, decision)| json!({"approval_id": approval_id, "decision": decision}))
                    .collect::<Vec<_>>(),
                "shows_child_items": true,
            }),
        )
    }
}

/// One task's durable read and one task's live read.
async fn launch_mixed(
    row: &HostRow,
    pool: Pool<Postgres>,
    tweak: impl FnOnce(&mut erato::config::AppConfig),
    asking: &[String],
) -> Launched {
    launch(
        row,
        pool,
        vec![client_task(None), second_task()],
        |mocks| {
            mock_child(
                mocks,
                CLIENT_BRIEF,
                read_call(row),
                CHILD_READ_CALL,
                CHILD_ANSWER,
            );
            mock_child(
                mocks,
                SECOND_BRIEF,
                calls(row, SECOND_READ_CALL, LIVE_TOOL),
                SECOND_READ_CALL,
                SECOND_ANSWER,
            );
        },
        tweak,
        asking,
    )
    .await
}

/// [`launch_mixed`] with the live read asking first, parked on the waiting
/// durable child and the asking live one.
async fn park_mixed(
    row: &HostRow,
    pool: Pool<Postgres>,
    tweak: impl FnOnce(&mut erato::config::AppConfig),
) -> (Launched, erato::db::entity::messages::Model) {
    let mut launched = launch_mixed(row, pool, tweak, &[live_tool(row)]).await;
    let parked = launched.parked().await;
    let waiting = item_for(&parked, CLIENT_TASK_CALL);
    assert!(waiting["child"]["waiting_for"].is_object(), "{waiting}");
    let asking = item_for(&parked, SECOND_TASK_CALL);
    assert!(asking["child"].get("waiting_for").is_none(), "{asking}");
    assert_eq!(asking["child"]["tool_name"], LIVE_TOOL);
    (launched, parked)
}

pub(super) async fn a_durable_child_call_waits_for_a_client_and_the_parent_resumes(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, true, |_| {}).await;
    let item = item_for(&waiting.parent_message, CLIENT_TASK_CALL);
    assert_eq!(
        item["child"]["waiting_for"]["attempt_id"],
        json!(waiting.request.attempt_id),
        "the parent shows what its task waits for: {item}"
    );
    let resumed = record_parent_resumes(&mut waiting.llm);
    let mut pane = Pane::open_serving(
        &waiting.base,
        &row.binding(),
        &row.pane_tools(),
        Some(row.child_pane_tools()),
    )
    .await;
    let nudge = pane
        .next(Duration::from_secs(3))
        .await
        .expect("the reconnected pane is told about the call");
    assert_eq!(nudge["message_type"], "client_operation_available");
    assert_eq!(nudge["attempt_id"], json!(waiting.request.attempt_id));
    answer_as_pane(
        row,
        &waiting.state,
        &waiting.request,
        pane_result(row, &waiting.request),
    )
    .await;

    let answered = wait_answered(&waiting.state, waiting.chat_id).await;
    assert_eq!(answered.id, waiting.parent_message.id);
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "the parent continues once");
    assert!(parent_turns[0].to_string().contains(CHILD_ANSWER));
    let slot = part_for(&answered, CLIENT_TASK_CALL);
    assert_eq!(slot["status"], "success", "{slot}");
    assert_eq!(slot["output"]["status"], "completed", "{slot}");
    assert!(
        slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains(CHILD_ANSWER)
    );
    let child_row = assistant_row(&waiting.state.db, waiting.child.id).await;
    let read = part_for(&child_row, CHILD_READ_CALL);
    assert_eq!(read["status"], "success");
    assert_eq!(read["output"]["result"]["text"], PANE_TEXT);
    assert_eq!(calls_named(&child_row, CHILD_READ_CALL), 1);
    assert_eq!(attempts_of(&waiting.state, waiting.child.id).await.len(), 1);
    assert_eq!(
        attempt_row(&waiting).await.state,
        attempts::AttemptState::Completed
    );
    waiting.server.abort();
}

pub(super) async fn a_waiting_childs_continuation_is_offered_its_granted_tools_while_the_parent_is_parked(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let child_turns = after_the_read(
        &mut waiting.llm,
        build_openai_text_streaming_response(&[CHILD_ANSWER]),
        &[],
    );
    answer_as_pane(
        row,
        &waiting.state,
        &waiting.request,
        pane_result(row, &waiting.request),
    )
    .await;
    wait_answered(&waiting.state, waiting.chat_id).await;
    let turns = turn_bodies(&child_turns);
    assert_eq!(turns.len(), 1);
    assert!(
        offers(&turns[0], row.read_tool),
        "the parked parent still holds the grant's context"
    );
    waiting.server.abort();
}

pub(super) async fn a_device_prompt_answered_after_the_tool_timeout_completes_within_the_attempt(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, false, |config| {
        let tool = config.client_tools.tools.get_mut(READ_KEY).unwrap();
        tool.timeout_ms = Some(1_500);
        tool.durable.as_mut().unwrap().claim_lease_secs = 2;
    })
    .await;
    let resumed = record_parent_resumes(&mut waiting.llm);
    let attempt_id = waiting.request.attempt_id;
    let result = pane_result(row, &waiting.request);

    // A prompt that outlives an unrenewed claim answers too late.
    let token = claim_token(row, &waiting.state, attempt_id).await;
    tokio::time::sleep(Duration::from_millis(3_500)).await;
    post_result(row, &waiting.state, &token, &result)
        .await
        .assert_status_conflict();

    let token = claim_token(row, &waiting.state, attempt_id).await;
    for _ in 0..2 {
        tokio::time::sleep(Duration::from_millis(1_200)).await;
        assert_eq!(claim_token(row, &waiting.state, attempt_id).await, token);
    }
    tokio::time::sleep(Duration::from_millis(1_200)).await;
    let accepted = post_result(row, &waiting.state, &token, &result).await;
    accepted.assert_status_ok();
    assert_eq!(accepted.json::<Value>()["state"], "ready");
    continue_operation(&waiting.state, attempt_id)
        .await
        .assert_status_ok();
    wait_answered(&waiting.state, waiting.chat_id).await;
    let read = part_for(
        &assistant_row(&waiting.state.db, waiting.child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(read["status"], "success", "{read}");
    assert_eq!(read["output"]["result"]["text"], PANE_TEXT);
    assert_eq!(turn_bodies(&resumed).len(), 1, "one parent continuation");
    waiting.server.abort();
}

pub(super) async fn a_device_decline_ends_the_durable_call_as_declined(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let child_turns = after_the_read(
        &mut waiting.llm,
        build_openai_text_streaming_response(&[CHILD_ANSWER]),
        &[],
    );
    let resumed = record_parent_resumes(&mut waiting.llm);
    answer_as_pane(
        row,
        &waiting.state,
        &waiting.request,
        declined_result(row, &waiting.request),
    )
    .await;
    let answered = wait_answered(&waiting.state, waiting.chat_id).await;

    let read = part_for(
        &assistant_row(&waiting.state.db, waiting.child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(read["status"], "error", "{read}");
    assert_eq!(read["output"]["status"], "cancelled");
    assert_eq!(read["output"]["reason"], "declined");
    let declined_text = read["output"]["error"].as_str().unwrap();
    assert!(declined_text.contains(row.read_tool), "{declined_text}");
    let child_turn = turn_bodies(&child_turns)[0].to_string();
    assert!(child_turn.contains("The user declined this call"));
    assert!(child_turn.contains("say in the answer what is missing"));
    let slot = part_for(&answered, CLIENT_TASK_CALL);
    assert_eq!(
        slot["output"]["client_tools"],
        json!({"declined": 1}),
        "{slot}"
    );
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "one parent continuation");
    let told = task_result_in(&parent_turns[0], CLIENT_TASK_CALL);
    assert_eq!(told["client_tools"], json!({"declined": 1}), "{told}");
    assert!(told.to_string().contains(CHILD_ANSWER), "{told}");
    assert_eq!(attempts_of(&waiting.state, waiting.child.id).await.len(), 1);
    waiting.server.abort();
}

pub(super) async fn no_client_before_the_attempt_ends_gives_expired(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    use sea_orm::ConnectionTrait;
    let mut waiting = park_a_waiting_child(row, pool, true, |_| {}).await;
    let child_turns = after_the_read(
        &mut waiting.llm,
        build_openai_text_streaming_response(&[CHILD_ANSWER]),
        &[],
    );
    let resumed = record_parent_resumes(&mut waiting.llm);
    waiting
        .state
        .db
        .execute_unprepared(&format!(
            "UPDATE client_operation_attempts SET expires_at = now() - interval '1 second' WHERE attempt_id = '{}'",
            waiting.request.attempt_id
        ))
        .await
        .unwrap();
    continue_operation(&waiting.state, waiting.request.attempt_id)
        .await
        .assert_status_ok();
    let answered = wait_answered(&waiting.state, waiting.chat_id).await;

    let read = part_for(
        &assistant_row(&waiting.state.db, waiting.child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(read["output"]["status"], "cancelled", "{read}");
    assert_eq!(read["output"]["reason"], "expired");
    let child_turns = turn_bodies(&child_turns);
    assert_eq!(child_turns.len(), 1, "one child continuation");
    let child_turn = child_turns[0].to_string();
    assert!(child_turn.contains("No client ran this call before it expired"));
    assert!(child_turn.contains("say in the answer what is missing"));
    let slot = part_for(&answered, CLIENT_TASK_CALL);
    assert_eq!(
        slot["output"]["client_tools"],
        json!({"expired": 1}),
        "{slot}"
    );
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "one parent continuation");
    let told = task_result_in(&parent_turns[0], CLIENT_TASK_CALL);
    assert_eq!(told["client_tools"], json!({"expired": 1}), "{told}");
    assert!(told.to_string().contains(CHILD_ANSWER), "{told}");
    let settled = attempt_row(&waiting).await;
    assert_eq!(settled.state, attempts::AttemptState::Completed);
    assert_eq!(attempts_of(&waiting.state, waiting.child.id).await.len(), 1);
    waiting.server.abort();
}

pub(super) async fn a_durable_and_a_live_child_only_the_durable_one_waits(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut launched = launch_mixed(row, pool, |_| {}, &[]).await;
    let live = live_call(&mut launched.pane).await;
    assert_eq!(live["tool_name"], LIVE_TOOL);
    answer_call(row, &launched.state, &live).await;
    let parked = launched.parked().await;
    let resumed = record_parent_resumes(&mut launched.llm);

    let items = parked_part(&parked)["approvals"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(items.len(), 1, "only the durable child waits: {items:?}");
    assert!(items[0]["child"]["waiting_for"].is_object());
    let live_slot = part_for(&parked, SECOND_TASK_CALL);
    assert_eq!(live_slot["status"], "success", "{live_slot}");
    assert!(
        live_slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains(SECOND_ANSWER)
    );

    let live_child = child_for(&launched.state, launched.chat_id, SECOND_TASK_CALL).await;
    assert!(
        attempts_of(&launched.state, live_child.id).await.is_empty(),
        "the live child's call never became a durable operation"
    );
    let durable = child_for(&launched.state, launched.chat_id, CLIENT_TASK_CALL).await;
    let request = operation_of(&launched.state, durable.id, 0).await;
    answer_as_pane(row, &launched.state, &request, pane_result(row, &request)).await;
    let answered = wait_answered(&launched.state, launched.chat_id).await;
    assert_eq!(answered.id, parked.id);
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "one parent continuation");
    assert!(parent_turns[0].to_string().contains(CHILD_ANSWER));
    assert!(parent_turns[0].to_string().contains(SECOND_ANSWER));
    assert_eq!(attempts_of(&launched.state, durable.id).await.len(), 1);
    launched.server.abort();
}

pub(super) async fn a_durable_child_that_finishes_before_the_parent_parks_resumes_the_parent_once(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut launched = launch(
        row,
        pool,
        vec![client_task(None), research_task(None)],
        |mocks| {
            mock_child(
                mocks,
                CLIENT_BRIEF,
                read_call(row),
                CHILD_READ_CALL,
                CHILD_ANSWER,
            );
            // Keeps the parent's join running after the client task parked.
            mocks.mock(|when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(&[RESEARCH_BRIEF], &[USER_MESSAGE]));
                mock_llm_sse_response(
                    then,
                    crate::test_utils::build_openai_delayed_text_streaming_response(
                        &[RESEARCH_ANSWER, " and more"],
                        DISPATCH_PAUSE,
                    ),
                );
            });
        },
        |_| {},
        &[],
    )
    .await;
    let resumed = record_parent_resumes(&mut launched.llm);
    let durable = child_for(&launched.state, launched.chat_id, CLIENT_TASK_CALL).await;
    let request = operation_of(&launched.state, durable.id, 0).await;
    wait_idle(&launched.state, durable.id, "awaiting_approval").await;
    answer_as_pane(row, &launched.state, &request, pane_result(row, &request)).await;
    wait_idle(&launched.state, durable.id, "completed").await;
    assert!(
        launched.run.as_ref().is_some_and(|run| !run.is_finished()),
        "the child finished while the parent's join still ran"
    );

    launched.finish().await;
    let answered = wait_answered(&launched.state, launched.chat_id).await;
    let slot = part_for(&answered, CLIENT_TASK_CALL);
    assert_eq!(slot["status"], "success", "{slot}");
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "one parent continuation");
    assert!(parent_turns[0].to_string().contains(CHILD_ANSWER));
    assert!(parent_turns[0].to_string().contains(RESEARCH_ANSWER));
    launched.server.abort();
}

pub(super) async fn two_waiting_children_one_still_running_give_one_parent_continuation_with_both_answers(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut launched = launch(
        row,
        pool,
        vec![client_task(None), second_task()],
        |mocks| {
            mock_child(
                mocks,
                CLIENT_BRIEF,
                read_call(row),
                CHILD_READ_CALL,
                CHILD_ANSWER,
            );
            // The second child's continuation pauses between its read's
            // result and a second, live read.
            mocks.mock(move |when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(
                        &[SECOND_BRIEF],
                        &[USER_MESSAGE, SECOND_READ_CALL],
                    ));
                mock_llm_sse_response(
                    then,
                    build_openai_tool_calls_streaming_response(&[(
                        SECOND_READ_CALL,
                        row.read_tool,
                        row.model_input.clone(),
                    )]),
                );
            });
            mocks.mock(move |when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(
                        &[SECOND_BRIEF, SECOND_READ_CALL],
                        &[USER_MESSAGE, LATER_READ_CALL],
                    ));
                mock_llm_sse_response(
                    then,
                    build_openai_paused_tool_calls_streaming_response(
                        "Reading more.",
                        DISPATCH_PAUSE,
                        &[(LATER_READ_CALL, LIVE_TOOL, row.model_input.clone())],
                    ),
                );
            });
            mocks.mock(move |when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(
                        &[SECOND_BRIEF, LATER_READ_CALL],
                        &[USER_MESSAGE],
                    ));
                mock_llm_sse_response(then, build_openai_text_streaming_response(&[SECOND_ANSWER]));
            });
        },
        |_| {},
        &[],
    )
    .await;
    let parked = launched.parked().await;
    assert_eq!(
        parked_part(&parked)["approvals"].as_array().unwrap().len(),
        2
    );
    let resumed = record_parent_resumes(&mut launched.llm);
    let first = child_for(&launched.state, launched.chat_id, CLIENT_TASK_CALL).await;
    let second = child_for(&launched.state, launched.chat_id, SECOND_TASK_CALL).await;
    let first_request = operation_of(&launched.state, first.id, 0).await;
    let second_request = operation_of(&launched.state, second.id, 0).await;
    for (call, child, request) in [
        (CLIENT_TASK_CALL, &first, &first_request),
        (SECOND_TASK_CALL, &second, &second_request),
    ] {
        let item = item_for(&parked, call);
        assert_eq!(item["child"]["child_chat_id"], json!(child.id), "{item}");
        assert_eq!(
            item["child"]["waiting_for"]["attempt_id"],
            json!(request.attempt_id),
            "one waiting item per child: {item}"
        );
    }

    answer_as_pane(
        row,
        &launched.state,
        &second_request,
        pane_result(row, &second_request),
    )
    .await;
    eventually("the second child to run", || async {
        (reload(&launched.state.db, second.id)
            .await
            .generation_state
            .as_deref()
            == Some("running"))
        .then_some(())
    })
    .await;
    answer_as_pane(
        row,
        &launched.state,
        &first_request,
        pane_result(row, &first_request),
    )
    .await;
    let settled_first = eventually("the first child's slot to settle", || async {
        let row = assistant_row(&launched.state.db, launched.chat_id).await;
        (part_for(&row, CLIENT_TASK_CALL)["status"] == "success").then_some(row)
    })
    .await;
    assert_eq!(
        part_for(&settled_first, SECOND_TASK_CALL)["status"],
        "in_progress",
        "a child still running is not finished"
    );
    assert_eq!(
        reload(&launched.state.db, launched.chat_id)
            .await
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );
    assert!(turn_bodies(&resumed).is_empty());

    let later = live_call(&mut launched.pane).await;
    assert_eq!(later["tool_name"], LIVE_TOOL);
    answer_call(row, &launched.state, &later).await;
    wait_answered(&launched.state, launched.chat_id).await;
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "one parent continuation");
    assert!(parent_turns[0].to_string().contains(CHILD_ANSWER));
    assert!(parent_turns[0].to_string().contains(SECOND_ANSWER));
    launched.server.abort();
}

pub(super) async fn approvals_decided_while_a_child_waits_repark_on_the_waiting_child(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let (mut launched, parked) = park_mixed(row, pool, |_| {}).await;
    let resumed = record_parent_resumes(&mut launched.llm);
    let asking = item_for(&parked, SECOND_TASK_CALL);
    let decided = launched.decide(parked.id, vec![(asking["approval_id"].clone(), "approve")]);
    let live = live_call(&mut launched.pane).await;
    answer_call(row, &launched.state, &live).await;
    let body = finish(decided).await;
    assert!(!body.contains(PARENT_FINAL), "the parent still waits");
    wait_idle(&launched.state, launched.chat_id, "awaiting_approval").await;

    let reparked = assistant_row(&launched.state.db, launched.chat_id).await;
    assert_row_reads(&reparked);
    assert_eq!(stops(&reparked).len(), 2);
    let items = parked_part(&reparked)["approvals"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(items.len(), 1, "{items:?}");
    let first = child_for(&launched.state, launched.chat_id, CLIENT_TASK_CALL).await;
    let request = operation_of(&launched.state, first.id, 0).await;
    assert_eq!(
        items[0]["child"]["waiting_for"]["attempt_id"],
        json!(request.attempt_id)
    );
    assert_eq!(part_for(&reparked, SECOND_TASK_CALL)["status"], "success");
    assert!(turn_bodies(&resumed).is_empty());

    answer_as_pane(row, &launched.state, &request, pane_result(row, &request)).await;
    wait_answered(&launched.state, launched.chat_id).await;
    assert_eq!(turn_bodies(&resumed).len(), 1, "one parent continuation");
    launched.server.abort();
}

pub(super) async fn a_child_that_finishes_while_approvals_are_open_keeps_the_parent_parked(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let (mut launched, parked) = park_mixed(row, pool, |_| {}).await;
    let resumed = record_parent_resumes(&mut launched.llm);
    let first = child_for(&launched.state, launched.chat_id, CLIENT_TASK_CALL).await;
    let request = operation_of(&launched.state, first.id, 0).await;
    answer_as_pane(row, &launched.state, &request, pane_result(row, &request)).await;
    let settled = eventually("the waiting child's slot to settle", || async {
        let row = assistant_row(&launched.state.db, launched.chat_id).await;
        (part_for(&row, CLIENT_TASK_CALL)["status"] == "success").then_some(row)
    })
    .await;
    assert_row_reads(&settled);
    assert_eq!(
        reload(&launched.state.db, launched.chat_id)
            .await
            .generation_state
            .as_deref(),
        Some("awaiting_approval"),
        "the open approval keeps the parent parked"
    );
    assert_eq!(stops(&settled).len(), 1);
    assert!(turn_bodies(&resumed).is_empty());

    let asking = item_for(&settled, SECOND_TASK_CALL);
    let decided = launched.decide(parked.id, vec![(asking["approval_id"].clone(), "approve")]);
    let live = live_call(&mut launched.pane).await;
    answer_call(row, &launched.state, &live).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "one parent continuation");
    assert!(parent_turns[0].to_string().contains(CHILD_ANSWER));
    assert!(parent_turns[0].to_string().contains(SECOND_ANSWER));
    launched.server.abort();
}

pub(super) async fn a_waiting_child_that_parks_on_an_ask_during_the_decision_continuation_reparks_as_an_approval(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let (mut launched, parked) = park_mixed(row, pool, |config| {
        gate_mock_mcp_tools_on_approval(row, config)
    })
    .await;
    let resumed = record_parent_resumes(&mut launched.llm);
    after_the_read(
        &mut launched.llm,
        build_openai_tool_calls_streaming_response(&[(CHILD_PARKED_CALL, PARKED_TOOL, json!({}))]),
        &[PARKED_TOOL_RESULT],
    );
    let first = child_for(&launched.state, launched.chat_id, CLIENT_TASK_CALL).await;
    let request = operation_of(&launched.state, first.id, 0).await;
    let token = claim_token(row, &launched.state, request.attempt_id).await;
    post_result(row, &launched.state, &token, &pane_result(row, &request))
        .await
        .assert_status_ok();

    // The decision continuation runs, held by the live read it waits for,
    // while the waiting child continues and stops on an approval.
    let asking = item_for(&parked, SECOND_TASK_CALL);
    let decided = launched.decide(parked.id, vec![(asking["approval_id"].clone(), "approve")]);
    let live = live_call(&mut launched.pane).await;
    continue_operation(&launched.state, request.attempt_id)
        .await
        .assert_status_ok();
    wait_idle(&launched.state, first.id, "awaiting_approval").await;
    answer_call(row, &launched.state, &live).await;
    assert!(!finish(decided).await.contains(PARENT_FINAL));
    wait_idle(&launched.state, launched.chat_id, "awaiting_approval").await;

    let reparked = assistant_row(&launched.state.db, launched.chat_id).await;
    assert_row_reads(&reparked);
    let all_stops = stops(&reparked);
    assert_eq!(all_stops.len(), 2);
    assert!(
        all_stops[0]["approvals"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["child"]["waiting_for"].is_object()),
        "the earlier stop keeps the item it showed"
    );
    let items = parked_part(&reparked)["approvals"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(items.len(), 1, "{items:?}");
    assert!(
        items[0]["child"].get("waiting_for").is_none(),
        "{}",
        items[0]
    );
    assert_eq!(items[0]["child"]["tool_name"], PARKED_TOOL);
    assert_eq!(items[0]["child"]["child_chat_id"], json!(first.id));
    assert_eq!(
        part_for(&reparked, CLIENT_TASK_CALL)["output"]["reason"],
        "approval_pending"
    );

    let approved = launched.decide(
        reparked.id,
        vec![(items[0]["approval_id"].clone(), "approve")],
    );
    assert!(finish(approved).await.contains(PARENT_FINAL));
    assert_eq!(turn_bodies(&resumed).len(), 1, "one parent answer");
    launched.server.abort();
}

pub(super) async fn an_approved_child_call_on_a_durable_tool_waits_and_the_parent_shows_it(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut launched = launch(
        row,
        pool,
        vec![client_task(None)],
        |mocks| {
            mock_child(
                mocks,
                CLIENT_BRIEF,
                read_call(row),
                CHILD_READ_CALL,
                CHILD_ANSWER,
            )
        },
        |_| {},
        &[row.qualified()],
    )
    .await;
    let parked = launched.parked().await;
    let asking = item_for(&parked, CLIENT_TASK_CALL);
    assert!(asking["child"].get("waiting_for").is_none(), "{asking}");
    let resumed = record_parent_resumes(&mut launched.llm);

    let decided = launched.decide(parked.id, vec![(asking["approval_id"].clone(), "approve")]);
    assert!(!finish(decided).await.contains(PARENT_FINAL));
    wait_idle(&launched.state, launched.chat_id, "awaiting_approval").await;
    let reparked = assistant_row(&launched.state.db, launched.chat_id).await;
    assert_row_reads(&reparked);
    let child = child_for(&launched.state, launched.chat_id, CLIENT_TASK_CALL).await;
    let request = operation_of(&launched.state, child.id, 0).await;
    let items = parked_part(&reparked)["approvals"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(items.len(), 1, "{items:?}");
    assert_eq!(
        items[0]["child"]["waiting_for"]["attempt_id"],
        json!(request.attempt_id),
        "the approved call waits, never the decided question again"
    );
    assert_eq!(
        part_for(&reparked, CLIENT_TASK_CALL)["output"]["reason"],
        "client_pending"
    );

    answer_as_pane(row, &launched.state, &request, pane_result(row, &request)).await;
    wait_answered(&launched.state, launched.chat_id).await;
    assert_eq!(turn_bodies(&resumed).len(), 1, "one parent continuation");
    launched.server.abort();
}

pub(super) async fn a_response_approval_lets_a_durable_task_call_park_without_asking(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut launched = launch(
        row,
        pool,
        vec![client_task(None)],
        |mocks| {
            mock_child(
                mocks,
                CLIENT_BRIEF,
                read_call(row),
                CHILD_READ_CALL,
                CHILD_ANSWER,
            )
        },
        |config| {
            config.client_tools.tools.insert(
                READ_KEY.into(),
                row.read_config(
                    true,
                    Some(ChildDispatch::Durable),
                    erato::config::ClientToolApprovalScope::Context,
                ),
            );
        },
        &[row.qualified()],
    )
    .await;
    let parked = launched.parked().await;
    let asking = item_for(&parked, CLIENT_TASK_CALL);
    assert_eq!(
        asking["child"]["approval_scope"],
        json!({"host_context": row.host.as_str(), "covers": "turn", "scope_id": parked.id.to_string()})
    );
    let resumed = record_parent_resumes(&mut launched.llm);
    after_the_read(
        &mut launched.llm,
        calls(row, LATER_READ_CALL, row.read_tool),
        &[LATER_READ_CALL],
    );
    let later_matcher = BodyContainsMatcher::new(&[CLIENT_BRIEF, LATER_READ_CALL], &[USER_MESSAGE]);
    launched
        .llm
        .mock_with_options(OVERRIDE, None, move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(later_matcher);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&[CHILD_ANSWER]));
        });

    let decided = launched.decide(
        parked.id,
        vec![(asking["approval_id"].clone(), "approve_context")],
    );
    assert!(!finish(decided).await.contains(PARENT_FINAL));
    wait_idle(&launched.state, launched.chat_id, "awaiting_approval").await;
    let reparked = assistant_row(&launched.state.db, launched.chat_id).await;
    assert_row_reads(&reparked);
    let stored = super::approval_scope::approvals(&launched.state, launched.chat_id).await;
    assert_eq!(stored.len(), 1, "{stored:?}");
    assert_eq!(stored[0].position, None);
    let child = child_for(&launched.state, launched.chat_id, CLIENT_TASK_CALL).await;
    let request = operation_of(&launched.state, child.id, 0).await;
    let lineage = &serde_json::to_value(&request).unwrap()["lineage"];
    assert!(
        lineage.is_object() && lineage.get("approval_scope").is_none(),
        "{lineage}"
    );
    assert_eq!(
        item_for(&reparked, CLIENT_TASK_CALL)["child"]["waiting_for"]["attempt_id"],
        json!(request.attempt_id)
    );

    answer_as_pane(row, &launched.state, &request, pane_result(row, &request)).await;
    let later = operation_of(&launched.state, child.id, 1).await;
    let rewritten = eventually("the item to name the second call", || async {
        let row = assistant_row(&launched.state.db, launched.chat_id).await;
        (item_for(&row, CLIENT_TASK_CALL)["child"]["waiting_for"]["attempt_id"]
            == json!(later.attempt_id))
        .then_some(row)
    })
    .await;
    assert_row_reads(&rewritten);
    assert_eq!(
        stops(&rewritten).len(),
        stops(&reparked).len(),
        "the second call parks under the turn's approval without a new ask"
    );
    assert_eq!(
        stops(&assistant_row(&launched.state.db, child.id).await).len(),
        1,
        "the task asked once"
    );

    answer_as_pane(row, &launched.state, &later, pane_result(row, &later)).await;
    wait_answered(&launched.state, launched.chat_id).await;
    assert_eq!(turn_bodies(&resumed).len(), 1, "one parent continuation");
    assert_eq!(
        super::approval_scope::approvals(&launched.state, launched.chat_id).await,
        stored
    );
    launched.server.abort();
}

pub(super) async fn a_waiting_task_that_starts_asking_offers_the_response_scope(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut launched = launch(
        row,
        pool,
        vec![client_task(None)],
        |mocks| {
            mock_child(
                mocks,
                CLIENT_BRIEF,
                read_call(row),
                CHILD_READ_CALL,
                CHILD_ANSWER,
            )
        },
        |config| {
            let mut tool =
                row.read_config(false, None, erato::config::ClientToolApprovalScope::Context);
            tool.name = LIVE_TOOL.into();
            config.client_tools.tools.insert(LIVE_KEY.into(), tool);
        },
        &[live_tool(row)],
    )
    .await;
    let parked = launched.parked().await;
    assert!(item_for(&parked, CLIENT_TASK_CALL)["child"]["waiting_for"].is_object());
    let resumed = record_parent_resumes(&mut launched.llm);
    after_the_read(
        &mut launched.llm,
        calls(row, LATER_READ_CALL, LIVE_TOOL),
        &[LATER_READ_CALL],
    );
    let later_matcher = BodyContainsMatcher::new(&[CLIENT_BRIEF, LATER_READ_CALL], &[USER_MESSAGE]);
    launched
        .llm
        .mock_with_options(OVERRIDE, None, move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(later_matcher);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&[CHILD_ANSWER]));
        });
    let child = child_for(&launched.state, launched.chat_id, CLIENT_TASK_CALL).await;
    let request = operation_of(&launched.state, child.id, 0).await;
    answer_as_pane(row, &launched.state, &request, pane_result(row, &request)).await;

    let asking = eventually("the waiting item to ask", || async {
        let row = assistant_row(&launched.state.db, launched.chat_id).await;
        let item = item_for(&row, CLIENT_TASK_CALL);
        item["child"]
            .get("waiting_for")
            .is_none()
            .then_some((row, item))
    })
    .await;
    assert_row_reads(&asking.0);
    assert_eq!(asking.1["child"]["tool_name"], LIVE_TOOL);
    assert_eq!(
        asking.1["child"]["approval_scope"],
        json!({"host_context": row.host.as_str(), "covers": "turn", "scope_id": parked.id.to_string()})
    );
    wait_idle(&launched.state, launched.chat_id, "awaiting_approval").await;

    let decided = launched.decide(
        asking.0.id,
        vec![(asking.1["approval_id"].clone(), "approve_context")],
    );
    let live = live_call(&mut launched.pane).await;
    assert!(live["lineage"].get("approval_scope").is_none(), "{live}");
    answer_call(row, &launched.state, &live).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert_eq!(turn_bodies(&resumed).len(), 1, "one parent answer");
    let stored = super::approval_scope::approvals(&launched.state, launched.chat_id).await;
    assert_eq!(stored.len(), 1, "{stored:?}");
    assert_eq!(stored[0].decided_in, parked.id);
    launched.server.abort();
}

pub(super) async fn a_child_that_parks_on_a_second_grant_call_updates_its_waiting_item(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    after_the_read(
        &mut waiting.llm,
        calls(row, LATER_READ_CALL, row.read_tool),
        &[LATER_READ_CALL],
    );
    let later_matcher = BodyContainsMatcher::new(&[CLIENT_BRIEF, LATER_READ_CALL], &[USER_MESSAGE]);
    waiting
        .llm
        .mock_with_options(OVERRIDE, None, move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(later_matcher);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&[CHILD_ANSWER]));
        });
    let resumed = record_parent_resumes(&mut waiting.llm);
    answer_as_pane(
        row,
        &waiting.state,
        &waiting.request,
        pane_result(row, &waiting.request),
    )
    .await;
    let later = operation_of(&waiting.state, waiting.child.id, 1).await;
    let rewritten = eventually("the item to name the second call", || async {
        let row = assistant_row(&waiting.state.db, waiting.chat_id).await;
        (item_for(&row, CLIENT_TASK_CALL)["child"]["waiting_for"]["attempt_id"]
            == json!(later.attempt_id))
        .then_some(row)
    })
    .await;
    assert_row_reads(&rewritten);
    let item = item_for(&rewritten, CLIENT_TASK_CALL);
    assert!(
        item["child"]["child_tool_call_id"]
            .as_str()
            .unwrap()
            .ends_with(&format!(":{LATER_READ_CALL}")),
        "{item}"
    );
    assert_eq!(
        item["child"]["child_tool_call_id"],
        json!(later.tool_call_id)
    );
    assert_eq!(
        part_for(&rewritten, CLIENT_TASK_CALL)["status"],
        "in_progress"
    );
    assert_eq!(
        reload(&waiting.state.db, waiting.chat_id)
            .await
            .generation_state
            .as_deref(),
        Some("awaiting_approval")
    );
    assert!(turn_bodies(&resumed).is_empty());

    answer_as_pane(row, &waiting.state, &later, pane_result(row, &later)).await;
    wait_answered(&waiting.state, waiting.chat_id).await;
    assert_eq!(turn_bodies(&resumed).len(), 1, "one parent continuation");
    waiting.server.abort();
}

pub(super) async fn a_parent_errored_after_its_decisions_resumes_once_when_the_waiting_child_finishes(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    resume_after_a_crashed_decision(row, pool, false).await;
}

pub(super) async fn a_crashed_parent_the_cleanup_cleared_resumes_once_when_the_waiting_child_finishes(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    resume_after_a_crashed_decision(row, pool, true).await;
}

/// What the heartbeat cleanup does to a chat whose generation ended a minute
/// ago.
async fn clear_the_generation(state: &erato::state::AppState, chat_id: Uuid) {
    sql(
        state,
        format!(
            "UPDATE chats SET active_generation_id = NULL, generation_state = NULL, \
                 generation_started_at = NULL, generation_heartbeat_at = NULL, \
                 generation_ended_at = NULL \
             WHERE id = '{chat_id}'"
        ),
    )
    .await;
}

/// A decision continuation crashed after settling the asking item while the
/// durable child still waits; with `cleared`, the cleanup ran before the child
/// finished.
async fn resume_after_a_crashed_decision(row: &HostRow, pool: Pool<Postgres>, cleared: bool) {
    use sea_orm::ConnectionTrait;
    let (mut launched, parked) = park_mixed(row, pool, |_| {}).await;
    let resumed = record_parent_resumes(&mut launched.llm);
    // What a decision continuation that crashed after settling its item
    // leaves behind.
    let asking = item_for(&parked, SECOND_TASK_CALL);
    let mut raw = parked.raw_message.clone();
    let content = raw["content"].as_array_mut().unwrap();
    for part in content.iter_mut() {
        if part["content_type"] == "tool_use" && part["tool_call_id"] == asking["tool_call_id"] {
            part["status"] = json!("success");
            part["output"] = json!({
                "status": "completed",
                "delegate_chat_id": asking["child"]["child_chat_id"],
                "child_run_id": asking["child"]["child_chat_id"],
                "parent_tool_call_id": asking["tool_call_id"],
                "result": SECOND_ANSWER,
                "truncated": false,
            });
        }
    }
    content.push(json!({
        "content_type": "tool_approval",
        "tool_call_id": asking["tool_call_id"],
        "approval_id": asking["approval_id"],
        "child_chat_id": asking["child"]["child_chat_id"],
        "always_allow": false,
        "approved_at": "2026-10-29T10:00:00Z",
    }));
    let raw = serde_json::to_string(&raw).unwrap().replace('\'', "''");
    launched
        .state
        .db
        .execute_unprepared(&format!(
            "UPDATE messages SET raw_message = '{raw}'::jsonb, \
             generation_metadata = coalesce(generation_metadata, '{{}}'::jsonb) || '{{\"continuation_in_flight\": true}}'::jsonb \
             WHERE id = '{}'",
            parked.id
        ))
        .await
        .unwrap();
    launched
        .state
        .db
        .execute_unprepared(&format!(
            "UPDATE chats SET generation_state = 'errored' WHERE id = '{}'",
            launched.chat_id
        ))
        .await
        .unwrap();
    if cleared {
        clear_the_generation(&launched.state, launched.chat_id).await;
    }
    assert_row_reads(&assistant_row(&launched.state.db, launched.chat_id).await);

    let first = child_for(&launched.state, launched.chat_id, CLIENT_TASK_CALL).await;
    let request = operation_of(&launched.state, first.id, 0).await;
    answer_as_pane(row, &launched.state, &request, pane_result(row, &request)).await;
    let answered = wait_answered(&launched.state, launched.chat_id).await;
    assert_eq!(answered.id, parked.id);
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "one parent continuation");
    assert!(parent_turns[0].to_string().contains(CHILD_ANSWER));
    launched.server.abort();
}

pub(super) async fn resume_parked_refuses_a_chat_whose_generation_moved_on(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    use erato::services::background_tasks::Takeover;
    use sea_orm::ConnectionTrait;
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let parked_generation = reload(&waiting.state.db, waiting.chat_id)
        .await
        .active_generation_id
        .unwrap();
    let resume = |expected_generation| {
        waiting.state.background_tasks.try_start_task(
            waiting.chat_id,
            waiting.parent_message.id,
            Takeover::ResumeParked {
                expected_generation,
            },
            waiting.state.config.generation_status.stale_after_secs,
        )
    };

    // Only a chat whose generation was cleared is taken without one.
    assert!(resume(None).await.is_err());
    let newer = Uuid::new_v4();
    let set_generation = async |generation: Uuid| {
        waiting
            .state
            .db
            .execute_unprepared(&format!(
                "UPDATE chats SET active_generation_id = '{generation}' WHERE id = '{}'",
                waiting.chat_id
            ))
            .await
            .unwrap();
    };
    set_generation(newer).await;
    assert!(resume(Some(parked_generation)).await.is_err());
    let chat = reload(&waiting.state.db, waiting.chat_id).await;
    assert_eq!(chat.active_generation_id, Some(newer));
    assert_eq!(chat.generation_state.as_deref(), Some("awaiting_approval"));

    // The parked generation, but a turn written below the parked message.
    set_generation(parked_generation).await;
    let later = Uuid::new_v4();
    waiting
        .state
        .db
        .execute_unprepared(&format!(
            "INSERT INTO messages (id, chat_id, raw_message, created_at, updated_at, is_message_in_active_thread) \
             VALUES ('{later}', '{}', '{{\"role\":\"user\",\"content\":[{{\"content_type\":\"text\",\"text\":\"later\"}}]}}'::jsonb, now(), now(), true)",
            waiting.chat_id
        ))
        .await
        .unwrap();
    assert!(resume(Some(parked_generation)).await.is_err());
    let chat = reload(&waiting.state.db, waiting.chat_id).await;
    assert_eq!(chat.active_generation_id, Some(parked_generation));
    assert_eq!(chat.generation_state.as_deref(), Some("awaiting_approval"));
    assert_eq!(
        attempt_row(&waiting).await.state,
        attempts::AttemptState::Pending,
        "nothing was superseded"
    );

    waiting
        .state
        .db
        .execute_unprepared(&format!("DELETE FROM messages WHERE id = '{later}'"))
        .await
        .unwrap();
    let (_events, task) = resume(Some(parked_generation))
        .await
        .expect("the parked generation is resumable");
    assert_eq!(
        reload(&waiting.state.db, waiting.chat_id)
            .await
            .generation_state
            .as_deref(),
        Some("running")
    );
    waiting
        .state
        .background_tasks
        .remove_task(
            &waiting.chat_id,
            task.generation_id,
            erato::services::background_tasks::TaskOutcome::AwaitingApproval,
        )
        .await;
    waiting.server.abort();
}

pub(super) async fn a_restart_while_parked_gives_one_continuation_and_no_duplicate_calls(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let Waiting {
        state,
        server,
        mut llm,
        _pane,
        chat_id,
        child,
        request,
        parent_message,
        ..
    } = park_a_waiting_child(row, pool.clone(), false, |_| {}).await;
    let child_turns = after_the_read(
        &mut llm,
        build_openai_text_streaming_response(&[CHILD_ANSWER]),
        &[],
    );
    let resumed = record_parent_resumes(&mut llm);
    let parent_rows = rows_of(chat_id, &state.db).await.len();
    let child_rows = rows_of(child.id, &state.db).await.len();
    let config = state.config.clone();
    server.abort();
    drop(_pane);
    drop(state);

    let b = test_app_state(config.clone(), pool.clone()).await;
    let c = test_app_state(config, pool).await;
    let token = claim_token(row, &b, request.attempt_id).await;
    post_result(row, &b, &token, &pane_result(row, &request))
        .await
        .assert_status_ok();
    let (on_b, on_c, backstop) = tokio::join!(
        continue_operation(&b, request.attempt_id),
        continue_operation(&c, request.attempt_id),
        app_server(c.clone())
            .post("/api/v1beta/me/messages/continuestream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({
                "message_id": parent_message.id,
                "decisions": [],
                "shows_child_items": true,
            })),
    );
    for response in [&on_b, &on_c, &backstop] {
        let status = response.status_code();
        assert!(
            status.is_success() || status == axum::http::StatusCode::CONFLICT,
            "{status}: {}",
            response.text()
        );
    }
    assert!(on_b.status_code().is_success() || on_c.status_code().is_success());

    let answered = wait_answered(&b, chat_id).await;
    assert_eq!(answered.id, parent_message.id);
    wait_idle(&b, child.id, "completed").await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(attempts_of(&b, child.id).await.len(), 1);
    assert_eq!(turn_bodies(&child_turns).len(), 1, "one child continuation");
    assert_eq!(turn_bodies(&resumed).len(), 1, "one parent continuation");
    assert_eq!(rows_of(chat_id, &b.db).await.len(), parent_rows);
    assert_eq!(rows_of(child.id, &b.db).await.len(), child_rows);
    let child_row = assistant_row(&b.db, child.id).await;
    assert_eq!(calls_named(&child_row, CHILD_READ_CALL), 1);
    assert_eq!(
        part_for(&child_row, CHILD_READ_CALL)["output"]["result"]["text"],
        PANE_TEXT
    );
}

pub(super) async fn the_sweep_settles_a_waiting_child_whose_tail_never_ran_and_an_empty_continue_resumes_the_parent(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    sweep_after_a_lost_tail(row, pool, "completed").await;
}

/// The stale-generation reap writes `errored` for a chat whose calls have all
/// completed, so a replica that died after the child's answer leaves it so.
pub(super) async fn a_child_reaped_errored_after_its_answer_reads_as_completed(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    sweep_after_a_lost_tail(row, pool, "errored").await;
}

fn cleanup_args(
    state: &erato::state::AppState,
) -> erato::actors::cleanup_worker::CleanupWorkerArgs {
    erato::actors::cleanup_worker::CleanupWorkerArgs {
        db: state.db.clone(),
        cleanup_enabled: false,
        cleanup_archived_max_age_days: 30,
        delegated_run_auto_archive_after_days: 0,
        generation_stale_after_secs: state.config.generation_status.stale_after_secs,
        result_max_chars: state.config.delegation.result_max_chars,
        durable_operations_enabled: true,
        app_config: std::sync::Arc::new(state.config.clone()),
        waiting_parents_cursor: Default::default(),
    }
}

/// The child's continuation committed its answer and completed the call, and
/// the process died before its tail; the child chat is left `child_state`.
async fn lose_the_tail(waiting: &Waiting, child_state: &str) {
    use sea_orm::ConnectionTrait;
    let child_row = assistant_row(&waiting.state.db, waiting.child.id).await;
    let mut raw = child_row.raw_message.clone();
    let content = raw["content"].as_array_mut().unwrap();
    content.retain(|part| part["content_type"] != "client_tool_pending");
    for part in content.iter_mut() {
        if part["content_type"] == "tool_use"
            && part["tool_call_id"] == json!(waiting.request.tool_call_id)
        {
            part["status"] = json!("success");
            part["output"] = json!({"status": "success", "result": {"text": PANE_TEXT}});
        }
    }
    content.push(json!({"content_type": "text", "text": CHILD_ANSWER}));
    let raw = serde_json::to_string(&raw).unwrap().replace('\'', "''");
    waiting
        .state
        .db
        .execute_unprepared(&format!(
            "UPDATE messages SET raw_message = '{raw}'::jsonb WHERE id = '{}'",
            child_row.id
        ))
        .await
        .unwrap();
    waiting
        .state
        .db
        .execute_unprepared(&format!(
            "UPDATE client_operation_attempts SET state = 'completed' WHERE attempt_id = '{}'",
            waiting.request.attempt_id
        ))
        .await
        .unwrap();
    waiting
        .state
        .db
        .execute_unprepared(&format!(
            "UPDATE chats SET generation_state = '{child_state}' WHERE id = '{}'",
            waiting.child.id
        ))
        .await
        .unwrap();
}

async fn sweep_after_a_lost_tail(row: &HostRow, pool: Pool<Postgres>, child_state: &str) {
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let resumed = record_parent_resumes(&mut waiting.llm);
    lose_the_tail(&waiting, child_state).await;

    erato::actors::cleanup_worker::run_cleanup_tick(&cleanup_args(&waiting.state))
        .await
        .unwrap();
    let swept = assistant_row(&waiting.state.db, waiting.chat_id).await;
    let slot = part_for(&swept, CLIENT_TASK_CALL);
    assert_eq!(slot["status"], "success", "{slot}");
    assert!(
        slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains(CHILD_ANSWER)
    );
    assert_eq!(
        reload(&waiting.state.db, waiting.chat_id)
            .await
            .generation_state
            .as_deref(),
        Some("awaiting_approval"),
        "the sweep starts no generation"
    );
    assert!(turn_bodies(&resumed).is_empty());

    let continued = continuestream(
        &waiting,
        json!({ "decisions": [], "shows_child_items": true }),
    )
    .await;
    continued.assert_status_ok();
    assert!(extract_full_text(&parse_sse_events(&continued)).contains(PARENT_FINAL));
    assert_eq!(turn_bodies(&resumed).len(), 1, "one parent continuation");
    waiting.server.abort();
}

/// The user writes a new turn in the parent chat while its task waits.
async fn move_on(waiting: &mut Waiting) {
    waiting.llm.mock_with_options(OVERRIDE, None, |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[MOVED_ON], &[]));
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&[MOVED_ON_ANSWER]),
        );
    });
    let moved = app_server(waiting.state.clone())
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "existing_chat_id": waiting.chat_id, "user_message": MOVED_ON }))
        .await;
    moved.assert_status_ok();
    assert!(extract_full_text(&parse_sse_events(&moved)).contains(MOVED_ON_ANSWER));
}

pub(super) async fn a_waiting_call_is_withdrawn_once_the_parent_moved_on(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let child_turns = after_the_read(
        &mut waiting.llm,
        build_openai_text_streaming_response(&[CHILD_ANSWER]),
        &[],
    );
    move_on(&mut waiting).await;
    let refused = claim_as_pane(row, &waiting, true).await;
    refused.assert_status_conflict();
    assert_eq!(refused.text(), "Operation authorization withdrawn");
    let withdrawn = attempt_row(&waiting).await.validated_result.unwrap();
    assert_eq!(withdrawn["output"]["reason"], "withdrawn");

    continue_operation(&waiting.state, waiting.request.attempt_id)
        .await
        .assert_status_ok();
    wait_idle(&waiting.state, waiting.child.id, "completed").await;
    let child_turns = turn_bodies(&child_turns);
    assert!(
        child_turns[0]
            .to_string()
            .contains("This call was withdrawn")
    );
    assert!(
        !offers(&child_turns[0], row.read_tool),
        "a parent that moved on no longer holds the grant's context"
    );
    let settled = eventually("the old parent slot to settle", || async {
        let row = erato::db::entity::messages::Entity::find_by_id(waiting.parent_message.id)
            .one(&waiting.state.db)
            .await
            .unwrap()
            .unwrap();
        (part_for(&row, CLIENT_TASK_CALL)["status"] != "in_progress").then_some(row)
    })
    .await;
    let slot = part_for(&settled, CLIENT_TASK_CALL);
    assert_eq!(slot["status"], "success", "{slot}");
    assert!(
        slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains(CHILD_ANSWER)
    );
    waiting.server.abort();
}

pub(super) async fn a_withdrawn_childs_ask_is_answerable_in_its_own_chat(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, false, |config| {
        gate_mock_mcp_tools_on_approval(row, config)
    })
    .await;
    after_the_read(
        &mut waiting.llm,
        build_openai_tool_calls_streaming_response(&[(CHILD_PARKED_CALL, PARKED_TOOL, json!({}))]),
        &[PARKED_TOOL_RESULT],
    );
    let answer_matcher =
        BodyContainsMatcher::new(&[CLIENT_BRIEF, PARKED_TOOL_RESULT], &[USER_MESSAGE]);
    waiting
        .llm
        .mock_with_options(OVERRIDE, None, move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(answer_matcher);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&[CHILD_ANSWER]));
        });
    move_on(&mut waiting).await;
    claim_as_pane(row, &waiting, true)
        .await
        .assert_status_conflict();
    continue_operation(&waiting.state, waiting.request.attempt_id)
        .await
        .assert_status_ok();
    wait_idle(&waiting.state, waiting.child.id, "awaiting_approval").await;

    let child_row = assistant_row(&waiting.state.db, waiting.child.id).await;
    let decided = app_server(waiting.state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "message_id": child_row.id, "decision": "approve" }))
        .await;
    decided.assert_status_ok();
    assert!(extract_full_text(&parse_sse_events(&decided)).contains(CHILD_ANSWER));
    waiting.server.abort();
}

async fn sql(state: &erato::state::AppState, statement: String) {
    use sea_orm::ConnectionTrait;
    state.db.execute_unprepared(&statement).await.unwrap();
}

/// The pane's result is in, and the child's continuation began and died: what
/// the stale-generation reap leaves for the next client to continue.
async fn answered_and_left_continuing(row: &HostRow, waiting: &Waiting) {
    let token = claim_token(row, &waiting.state, waiting.request.attempt_id).await;
    post_result(
        row,
        &waiting.state,
        &token,
        &pane_result(row, &waiting.request),
    )
    .await
    .assert_status_ok();
    sql(
        &waiting.state,
        format!(
            "UPDATE client_operation_attempts SET state = 'continuing' WHERE attempt_id = '{}'",
            waiting.request.attempt_id
        ),
    )
    .await;
}

fn assert_failed_task_result(body: &Value) {
    let result = task_result_in(body, CLIENT_TASK_CALL);
    assert_eq!(result["status"], "failed", "{result}");
}

pub(super) async fn a_failed_task_call_continuation_is_not_run_again_and_the_parent_reads_it_as_failed(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let resumed = record_parent_resumes(&mut waiting.llm);
    let child_turns = after_the_read(
        &mut waiting.llm,
        build_openai_text_streaming_response(&[CHILD_ANSWER]),
        &[],
    );
    answered_and_left_continuing(row, &waiting).await;
    // A continuation that cannot read its own turn fails the same way each time.
    let child_row = assistant_row(&waiting.state.db, waiting.child.id).await;
    sql(
        &waiting.state,
        format!(
            "UPDATE messages SET generation_parameters = '\"unreadable\"'::jsonb WHERE id = '{}'",
            child_row.id
        ),
    )
    .await;

    continue_operation(&waiting.state, waiting.request.attempt_id)
        .await
        .assert_status_ok();
    wait_idle(&waiting.state, waiting.child.id, "errored").await;
    assert_eq!(
        attempt_row(&waiting).await.state,
        attempts::AttemptState::Completed,
        "a failed continuation ends its call"
    );
    let answered = wait_answered(&waiting.state, waiting.chat_id).await;
    assert_eq!(answered.id, waiting.parent_message.id);
    assert_eq!(part_for(&answered, CLIENT_TASK_CALL)["status"], "error");
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "one parent continuation");
    assert_failed_task_result(&parent_turns[0]);

    let again = continue_operation(&waiting.state, waiting.request.attempt_id).await;
    again.assert_status_ok();
    assert_eq!(again.json::<Value>()["state"], "completed");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(turn_bodies(&child_turns).is_empty(), "the child never ran");
    assert_eq!(
        reload(&waiting.state.db, waiting.child.id)
            .await
            .generation_state
            .as_deref(),
        Some("errored")
    );
    waiting.server.abort();
}

pub(super) async fn a_task_call_left_continuing_on_an_errored_child_is_refused_and_settles_as_failed(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let resumed = record_parent_resumes(&mut waiting.llm);
    answered_and_left_continuing(row, &waiting).await;
    // The continuation failed and the write that ends its call did not land.
    sql(
        &waiting.state,
        format!(
            "UPDATE chats SET generation_state = 'errored' WHERE id = '{}'",
            waiting.child.id
        ),
    )
    .await;

    let refused = continue_operation(&waiting.state, waiting.request.attempt_id).await;
    refused.assert_status_conflict();
    assert_eq!(refused.text(), "Operation continuation failed");

    erato::actors::cleanup_worker::run_cleanup_tick(&cleanup_args(&waiting.state))
        .await
        .unwrap();
    let swept = assistant_row(&waiting.state.db, waiting.chat_id).await;
    assert_eq!(part_for(&swept, CLIENT_TASK_CALL)["status"], "error");
    let continued = continuestream(
        &waiting,
        json!({ "decisions": [], "shows_child_items": true }),
    )
    .await;
    continued.assert_status_ok();
    assert!(extract_full_text(&parse_sse_events(&continued)).contains(PARENT_FINAL));
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "one parent continuation");
    assert_failed_task_result(&parent_turns[0]);
    waiting.server.abort();
}

pub(super) async fn an_archived_waiting_child_settles_as_failed_and_the_parent_resumes_once(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let resumed = record_parent_resumes(&mut waiting.llm);
    app_server(waiting.state.clone())
        .post(&format!("/api/v1beta/chats/{}/archive", waiting.child.id))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({}))
        .await
        .assert_status_ok();

    erato::actors::cleanup_worker::run_cleanup_tick(&cleanup_args(&waiting.state))
        .await
        .unwrap();
    let swept = assistant_row(&waiting.state.db, waiting.chat_id).await;
    let slot = part_for(&swept, CLIENT_TASK_CALL);
    assert_eq!(slot["status"], "error", "{slot}");
    assert_eq!(slot["output"]["status"], "failed");
    assert_eq!(slot["output"]["error"], "The delegated run was archived.");
    assert_eq!(
        slot["output"]["child_run_id"],
        json!(waiting.child.id),
        "the slot still links to the run"
    );
    let continued = continuestream(
        &waiting,
        json!({ "decisions": [], "shows_child_items": true }),
    )
    .await;
    continued.assert_status_ok();
    assert!(extract_full_text(&parse_sse_events(&continued)).contains(PARENT_FINAL));
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "one parent continuation");
    assert_failed_task_result(&parent_turns[0]);
    assert!(
        task_result_in(&parent_turns[0], CLIENT_TASK_CALL)
            .to_string()
            .contains("archived")
    );
    waiting.server.abort();
}

pub(super) async fn the_old_slot_settles_while_a_newer_parent_turn_runs(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    use erato::services::background_tasks::{Takeover, TaskOutcome};
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    after_the_read(
        &mut waiting.llm,
        build_openai_text_streaming_response(&[CHILD_ANSWER]),
        &[],
    );
    move_on(&mut waiting).await;
    claim_as_pane(row, &waiting, true)
        .await
        .assert_status_conflict();
    // The user's next turn is still running when the task finishes.
    let tip = assistant_row(&waiting.state.db, waiting.chat_id).await;
    assert_ne!(tip.id, waiting.parent_message.id);
    let (_events, newer) = waiting
        .state
        .background_tasks
        .try_start_task(
            waiting.chat_id,
            tip.id,
            Takeover::RefuseParked,
            waiting.state.config.generation_status.stale_after_secs,
        )
        .await
        .expect("the newer turn takes the parent chat");

    continue_operation(&waiting.state, waiting.request.attempt_id)
        .await
        .assert_status_ok();
    wait_idle(&waiting.state, waiting.child.id, "completed").await;
    let settled = eventually("the old parent slot to settle", || async {
        let row = erato::db::entity::messages::Entity::find_by_id(waiting.parent_message.id)
            .one(&waiting.state.db)
            .await
            .unwrap()
            .unwrap();
        (part_for(&row, CLIENT_TASK_CALL)["status"] != "in_progress").then_some(row)
    })
    .await;
    let slot = part_for(&settled, CLIENT_TASK_CALL);
    assert_eq!(slot["status"], "success", "{slot}");
    assert!(
        slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains(CHILD_ANSWER)
    );
    assert_eq!(
        reload(&waiting.state.db, waiting.chat_id)
            .await
            .generation_state
            .as_deref(),
        Some("running"),
        "the newer turn kept the chat"
    );
    waiting
        .state
        .background_tasks
        .remove_task(
            &waiting.chat_id,
            newer.generation_id,
            TaskOutcome::Completed,
        )
        .await;
    waiting.server.abort();
}

/// What a turn leaves that ended on a stop no child item can share (the
/// tool-call limit, its own durable operation): the child's slot waits, and
/// no stop names the child.
async fn drop_the_stop(waiting: &Waiting) {
    let mut raw = waiting.parent_message.raw_message.clone();
    raw["content"]
        .as_array_mut()
        .unwrap()
        .retain(|part| part["content_type"] != "tool_approval_request");
    let raw = serde_json::to_string(&raw).unwrap().replace('\'', "''");
    sql(
        &waiting.state,
        format!(
            "UPDATE messages SET raw_message = '{raw}'::jsonb WHERE id = '{}'",
            waiting.parent_message.id
        ),
    )
    .await;
    assert_row_reads(&assistant_row(&waiting.state.db, waiting.chat_id).await);
}

pub(super) async fn a_waiting_child_left_out_of_the_stop_keeps_its_call_and_its_slot_settles(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let child_turns = after_the_read(
        &mut waiting.llm,
        build_openai_text_streaming_response(&[CHILD_ANSWER]),
        &[],
    );
    drop_the_stop(&waiting).await;

    answer_as_pane(
        row,
        &waiting.state,
        &waiting.request,
        pane_result(row, &waiting.request),
    )
    .await;
    wait_idle(&waiting.state, waiting.child.id, "completed").await;
    let child_turns = turn_bodies(&child_turns);
    assert_eq!(child_turns.len(), 1);
    assert!(child_turns[0].to_string().contains(PANE_TEXT));
    assert!(
        offers(&child_turns[0], row.read_tool),
        "the parent still holds the grant's context"
    );
    let settled = eventually("the parent slot to settle", || async {
        let row = assistant_row(&waiting.state.db, waiting.chat_id).await;
        (part_for(&row, CLIENT_TASK_CALL)["status"] != "in_progress").then_some(row)
    })
    .await;
    let slot = part_for(&settled, CLIENT_TASK_CALL);
    assert_eq!(slot["status"], "success", "{slot}");
    assert!(
        slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains(CHILD_ANSWER)
    );
    waiting.server.abort();
}

pub(super) async fn the_sweep_reaches_a_parent_behind_a_full_batch_that_never_changes(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    lose_the_tail(&waiting, "completed").await;
    // Parents whose row this release cannot read keep matching the scan, and
    // every sync of them fails. Their ids sort before the real one.
    let mut unreadable = waiting.parent_message.raw_message.clone();
    unreadable["content"]
        .as_array_mut()
        .unwrap()
        .push(json!({"content_type": "from_a_newer_release"}));
    let unreadable = serde_json::to_string(&unreadable)
        .unwrap()
        .replace('\'', "''");
    sql(
        &waiting.state,
        format!(
            "INSERT INTO chats (id, owner_user_id, assistant_configuration, generation_state, created_via) \
             SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, owner_user_id, \
                    assistant_configuration, 'errored', created_via \
             FROM chats, generate_series(1, 100) g WHERE id = '{}'",
            waiting.chat_id
        ),
    )
    .await;
    sql(
        &waiting.state,
        format!(
            "INSERT INTO messages (id, chat_id, raw_message, generation_parameters, is_message_in_active_thread) \
             SELECT ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, \
                    ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, \
                    '{unreadable}'::jsonb, generation_parameters, true \
             FROM messages, generate_series(1, 100) g WHERE id = '{}'",
            waiting.parent_message.id
        ),
    )
    .await;
    let args = cleanup_args(&waiting.state);
    let slot_status = async || {
        part_for(
            &assistant_row(&waiting.state.db, waiting.chat_id).await,
            CLIENT_TASK_CALL,
        )["status"]
            .clone()
    };

    erato::actors::cleanup_worker::run_cleanup_tick(&args)
        .await
        .unwrap();
    assert_eq!(
        slot_status().await,
        "in_progress",
        "the first batch is full"
    );
    erato::actors::cleanup_worker::run_cleanup_tick(&args)
        .await
        .unwrap();
    assert_eq!(slot_status().await, "success");
    waiting.server.abort();
}

pub(super) async fn the_sweep_scans_only_the_last_stop_of_a_reparked_parent(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    after_the_read(
        &mut waiting.llm,
        calls(row, LATER_READ_CALL, row.read_tool),
        &[LATER_READ_CALL],
    );
    answer_as_pane(
        row,
        &waiting.state,
        &waiting.request,
        pane_result(row, &waiting.request),
    )
    .await;
    let later = operation_of(&waiting.state, waiting.child.id, 1).await;
    let rewritten = eventually("the item to name the second call", || async {
        let row = assistant_row(&waiting.state.db, waiting.chat_id).await;
        (item_for(&row, CLIENT_TASK_CALL)["child"]["waiting_for"]["attempt_id"]
            == json!(later.attempt_id))
        .then_some(row)
    })
    .await;
    wait_idle(&waiting.state, waiting.child.id, "awaiting_approval").await;
    assert_eq!(
        attempt_row(&waiting).await.state,
        attempts::AttemptState::Completed
    );
    // A stop a decision re-parked from keeps naming the call that completed.
    let stop = parked_part(&rewritten);
    let mut earlier = stop.clone();
    earlier["approvals"][0]["child"]["waiting_for"]["attempt_id"] =
        json!(waiting.request.attempt_id);
    let with_stops = async |stops: [&Value; 2]| {
        let mut raw = rewritten.raw_message.clone();
        let content = raw["content"].as_array_mut().unwrap();
        content.pop();
        content.extend(stops.into_iter().cloned());
        let raw = serde_json::to_string(&raw).unwrap().replace('\'', "''");
        sql(
            &waiting.state,
            format!(
                "UPDATE messages SET raw_message = '{raw}'::jsonb WHERE id = '{}'",
                rewritten.id
            ),
        )
        .await;
    };
    let scanned = async || {
        erato::services::delegated_client_tools::scan_waiting_parents(&waiting.state.db, None)
            .await
            .unwrap()
            .iter()
            .any(|&(chat_id, _)| chat_id == waiting.chat_id)
    };

    with_stops([&earlier, &stop]).await;
    assert_row_reads(&assistant_row(&waiting.state.db, waiting.chat_id).await);
    assert!(!scanned().await, "the last stop's call is still pending");
    with_stops([&stop, &earlier]).await;
    assert!(scanned().await, "the last stop's call completed");
    waiting.server.abort();
}

pub(super) async fn a_failed_owner_lookup_withdraws_nothing(pool: Pool<Postgres>, row: &HostRow) {
    let waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    // The parent's turn holds the grant's context only by running elsewhere:
    // a newer message sits below the parked one, and another replica leases
    // the parked message.
    sql(
        &waiting.state,
        format!(
            "INSERT INTO messages (id, chat_id, raw_message, created_at, updated_at, is_message_in_active_thread) \
             VALUES ('{}', '{}', '{{\"role\":\"user\",\"content\":[{{\"content_type\":\"text\",\"text\":\"later\"}}]}}'::jsonb, now(), now(), true)",
            Uuid::new_v4(),
            waiting.chat_id
        ),
    )
    .await;
    sql(
        &waiting.state,
        format!(
            "UPDATE temp_chat_generations SET message_id = '{}', owner_pod = 'elsewhere', \
                 state = 'running', ended_at = NULL, heartbeat_at = now() \
             WHERE chat_id = '{}'",
            waiting.parent_message.id, waiting.chat_id
        ),
    )
    .await;

    sql(
        &waiting.state,
        "ALTER TABLE temp_chat_generations RENAME TO temp_chat_generations_away".into(),
    )
    .await;
    let failed = claim_as_pane(row, &waiting, true).await;
    sql(
        &waiting.state,
        "ALTER TABLE temp_chat_generations_away RENAME TO temp_chat_generations".into(),
    )
    .await;
    failed.assert_status(axum::http::StatusCode::INTERNAL_SERVER_ERROR);
    let attempt = attempt_row(&waiting).await;
    assert_eq!(attempt.state, attempts::AttemptState::Pending);
    assert!(attempt.validated_result.is_none(), "nothing was withdrawn");

    claim_as_pane(row, &waiting, true).await.assert_status_ok();
    waiting.server.abort();
}

pub(super) async fn an_errored_parent_that_cleared_its_marker_is_not_resumed_by_its_child(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    settle_without_the_marker(row, pool, false).await;
}

pub(super) async fn a_parent_the_cleanup_cleared_without_its_marker_settles_and_is_not_resumed(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    settle_without_the_marker(row, pool, true).await;
}

/// With `cleared`, the cleanup ran before the child finished.
async fn settle_without_the_marker(row: &HostRow, pool: Pool<Postgres>, cleared: bool) {
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let resumed = record_parent_resumes(&mut waiting.llm);
    after_the_read(
        &mut waiting.llm,
        build_openai_text_streaming_response(&[CHILD_ANSWER]),
        &[],
    );
    // What a continuation stopped by the content filter leaves: the chat
    // `errored`, the waiting item still open, and no in-flight marker.
    sql(
        &waiting.state,
        format!(
            "UPDATE chats SET generation_state = 'errored' WHERE id = '{}'",
            waiting.chat_id
        ),
    )
    .await;
    if cleared {
        clear_the_generation(&waiting.state, waiting.chat_id).await;
    }

    answer_as_pane(
        row,
        &waiting.state,
        &waiting.request,
        pane_result(row, &waiting.request),
    )
    .await;
    wait_idle(&waiting.state, waiting.child.id, "completed").await;
    let settled = eventually("the parent slot to settle", || async {
        let row = assistant_row(&waiting.state.db, waiting.chat_id).await;
        (part_for(&row, CLIENT_TASK_CALL)["status"] != "in_progress").then_some(row)
    })
    .await;
    assert_eq!(part_for(&settled, CLIENT_TASK_CALL)["status"], "success");
    if cleared {
        let refused = continuestream(
            &waiting,
            json!({ "decisions": [], "shows_child_items": true }),
        )
        .await;
        refused.assert_status_conflict();
        assert_eq!(refused.json::<Value>()["code"], "already_continued");
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        turn_bodies(&resumed).is_empty(),
        "only the user runs it again"
    );
    assert_eq!(
        reload(&waiting.state.db, waiting.chat_id)
            .await
            .generation_state
            .as_deref(),
        (!cleared).then_some("errored")
    );
    waiting.server.abort();
}
