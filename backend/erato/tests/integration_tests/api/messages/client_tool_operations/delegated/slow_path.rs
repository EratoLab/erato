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
        row.read_config(true, Some(ChildDispatch::Durable)),
    );
}

/// A client task whose granted read waits for a client, with the parent
/// parked on it.
pub(super) struct Waiting {
    pub state: erato::state::AppState,
    pub base: String,
    pub server: tokio::task::JoinHandle<()>,
    pub _llm: MockServer,
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
        _llm: llm,
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
    let mut request = app_server(waiting.state.clone())
        .post(&format!(
            "/api/v1beta/me/client-operations/{}/claim",
            waiting.request.attempt_id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", row.pane_tools());
    if takes_grant_calls {
        request = request.add_header("X-Erato-Child-Client-Tools", row.child_pane_tools());
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
