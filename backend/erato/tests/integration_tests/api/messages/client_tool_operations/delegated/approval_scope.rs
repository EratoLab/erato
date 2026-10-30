//! Context approvals (ERMAIN-1033): one decision on the parent's card lets a
//! task's granted read run under an approval for the document (checked by the
//! pane) or the response (kept by the server alone). The `pub(super)` cases
//! run once per host row; the others run on a fake host.
use super::*;
use crate::test_utils::{archive_chat_via_api, unarchive_chat_via_api};
use erato::config::{ClientToolApprovalScope, ClientToolHostContext};
use erato::services::approval_scope::{self as scope, ScopeKey};
use sea_orm::ConnectionTrait;
use std::collections::HashSet;

const TASK_CALLS: [&str; 10] = [
    CLIENT_TASK_CALL,
    "call_client_task_1",
    "call_client_task_2",
    "call_client_task_3",
    "call_client_task_4",
    "call_client_task_5",
    "call_client_task_6",
    "call_client_task_7",
    "call_client_task_8",
    "call_client_task_9",
];
const USER_MESSAGE_2: &str = "SECOND-TURN-SENTINEL: read it once more";
const CLIENT_BRIEF_2: &str = "SECOND-TURN-BRIEF-SENTINEL: read the summary";
const TURN_2_TASK_CALL: &str = "call_turn_two_task";
const PARENT_FINAL_2: &str = "PARENT-SECOND-FINAL-ANSWER";
const MOVED_ON: &str = "MOVED-ON-SENTINEL: never mind";
const OTHER_READ_TOOL: &str = "read_other";
const OTHER_READ_CALL: &str = "call_other_read";

/// Whether the row's scope is a document the pane checks, rather than the
/// parent turn the server keeps.
fn document(row: &HostRow) -> bool {
    scope::kind(row.host).is_some_and(scope::device_checked)
}

fn position(seq: u64) -> Value {
    json!({"journal": "journal-1", "seq": seq, "events": true})
}

/// The item's scope as the parent's card offers it.
fn offered(row: &HostRow, scope_id: &str) -> Value {
    json!({
        "host_context": row.host.as_str(),
        "covers": if document(row) { "document" } else { "turn" },
        "scope_id": scope_id,
    })
}

/// The key a document approval of the row's read tool is kept under.
fn document_key(row: &HostRow, binding: &ExecutorBinding) -> ScopeKey {
    ScopeKey {
        host_context: row.host,
        kind: scope::kind(row.host).unwrap(),
        binding_digest: scope::binding_digest(binding),
        scope_id: binding.host_context.as_ref().unwrap().identity.clone(),
        tool_name: row.qualified(),
    }
}

/// `count` client tasks, each with its own brief that the client child's
/// mocks still match.
fn tasks(count: usize) -> Vec<(&'static str, Value)> {
    TASK_CALLS[..count]
        .iter()
        .enumerate()
        .map(|(index, call)| {
            (
                *call,
                json!({"task": format!("{CLIENT_BRIEF} (part {index})"), "facet_ids": [CHILD_FACET]}),
            )
        })
        .collect()
}

fn read_with_context_scope(row: &HostRow, config: &mut erato::config::AppConfig) {
    config.client_tools.tools.insert(
        READ_KEY.into(),
        row.read_config(false, None, ClientToolApprovalScope::Context),
    );
}

/// A second parent turn with one client task of its own brief. Registered
/// before the first turn's mocks, whose matchers its context also satisfies.
fn mock_second_turn(row: &HostRow, mocks: &mut MockSet, child: &RequestBodyRecorder) {
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[USER_MESSAGE_2, TURN_2_TASK_CALL],
                &[],
            ));
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&[PARENT_FINAL_2]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[USER_MESSAGE_2], &[]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&task_calls(vec![(
                TURN_2_TASK_CALL,
                json!({"task": CLIENT_BRIEF_2, "facet_ids": [CHILD_FACET]}),
            )])),
        );
    });
    mock_client_child_for(
        mocks,
        child,
        CLIENT_BRIEF_2,
        read_call(row),
        CHILD_READ_CALL,
    );
}

/// A parent chat whose first turn plans client tasks that read through the
/// pane, the read allowed per document or turn and asking first.
struct ScopeChat {
    state: erato::state::AppState,
    base: String,
    server: tokio::task::JoinHandle<()>,
    _llm: MockServer,
    pane: Pane,
    chat_id: Uuid,
    child: RequestBodyRecorder,
}

/// `mocks_first` registers before the default mocks, so it can answer a
/// context they would also match. The pane checks approval scopes when
/// `scoped`.
async fn scope_chat(
    row: &HostRow,
    pool: Pool<Postgres>,
    task_count: usize,
    scoped: bool,
    mocks_first: impl FnOnce(&mut MockSet, &RequestBodyRecorder),
    tweak: impl FnOnce(&mut erato::config::AppConfig),
) -> ScopeChat {
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mocks_first(&mut mocks, &child);
    mock_second_turn(row, &mut mocks, &child);
    mock_parent(&mut mocks, &parent, tasks(task_count));
    mock_client_child_reads(row, &mut mocks, &child);
    let (state, llm) = delegated_state(row, pool, mocks, |config| {
        read_with_context_scope(row, config);
        // Ten tasks at the default parallelism: the test database pool's five
        // connections are too few for ten task runs at once.
        config.delegation.tasks.max_tasks_per_turn = 10;
        tweak(config);
    })
    .await;
    ask_before_reads(row, &state).await;
    let (base, server) = serve(&state).await;
    let pane = open_row_pane(row, &base, &row.binding(), scoped).await;
    let chat_id = seed_origin_chat(&state.db).await;
    ScopeChat {
        state,
        base,
        server,
        _llm: llm,
        pane,
        chat_id,
        child,
    }
}

async fn open_row_pane(row: &HostRow, base: &str, binding: &ExecutorBinding, scoped: bool) -> Pane {
    if scoped {
        Pane::open_scoped(
            base,
            binding,
            &row.pane_tools(),
            row.child_pane_tools(),
            row.read_tool,
        )
        .await
    } else {
        Pane::open_serving(
            base,
            binding,
            &row.pane_tools(),
            Some(row.child_pane_tools()),
        )
        .await
    }
}

impl ScopeChat {
    /// Runs the first turn to its stop and returns the parent's message.
    async fn ask(&mut self, row: &HostRow) -> erato::db::entity::messages::Model {
        finish(spawn_parent(
            row,
            &self.base,
            self.chat_id,
            ACTION_FACET,
            Some(row.binding()),
        ))
        .await;
        assert_eq!(self.pane.next(Duration::from_millis(300)).await, None);
        assert_eq!(
            reload(&self.state.db, self.chat_id)
                .await
                .generation_state
                .as_deref(),
            Some("awaiting_approval")
        );
        assistant_row(&self.state.db, self.chat_id).await
    }

    /// Runs a second turn from `binding` and hands back its SSE body.
    fn second_turn(
        &self,
        row: &HostRow,
        binding: ExecutorBinding,
    ) -> tokio::task::JoinHandle<String> {
        spawn_parent_saying(
            row,
            &self.base,
            self.chat_id,
            USER_MESSAGE_2,
            ACTION_FACET,
            Some(binding),
        )
    }

    async fn approvals(&self) -> Vec<Stored> {
        approvals(&self.state, self.chat_id).await
    }
}

fn stop_items(message: &erato::db::entity::messages::Model) -> Vec<Value> {
    parked_part(message)["approvals"]
        .as_array()
        .unwrap()
        .clone()
}

/// The pane allows `items` for their document or turn: a document carries the
/// position taken at the click, and the decision the pane's binding.
fn allow_for_scope(
    row: &HostRow,
    base: &str,
    message_id: Uuid,
    items: &[Value],
    position: &Value,
) -> tokio::task::JoinHandle<String> {
    let decisions: Vec<Value> = items
        .iter()
        .map(|item| {
            let mut decision =
                json!({"approval_id": item["approval_id"], "decision": "approve_context"});
            if document(row) {
                decision["scope_position"] = position.clone();
            }
            decision
        })
        .collect();
    spawn_decision_from(
        base,
        json!({"message_id": message_id, "decisions": decisions, "shows_child_items": true}),
        &row.binding(),
    )
}

/// [`spawn_decision`] sent with an executor binding, as the pane sends it.
fn spawn_decision_from(
    base: &str,
    body: Value,
    executor: &ExecutorBinding,
) -> tokio::task::JoinHandle<String> {
    let request = reqwest::Client::new()
        .post(format!("{base}/me/messages/continuestream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("X-Erato-Executor", serde_json::to_string(executor).unwrap())
        .json(&body);
    tokio::spawn(async move {
        let response = request.send().await.unwrap();
        let status = response.status();
        let received = response.text().await.unwrap();
        assert!(status.is_success(), "{status}: {received}");
        received
    })
}

/// A decision that must be refused, sent with `executor` when given.
async fn assert_refused(
    state: &erato::state::AppState,
    body: Value,
    executor: Option<&ExecutorBinding>,
    because: &str,
) {
    let mut request = app_server(state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body);
    if let Some(executor) = executor {
        request = request.add_header("X-Erato-Executor", serde_json::to_string(executor).unwrap());
    }
    let response = request.await;
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);
    assert!(response.text().contains(because), "{}", response.text());
}

/// The pane answers a call that the document changed since the decision,
/// without reading.
async fn answer_scope_changed(row: &HostRow, state: &erato::state::AppState, event: &Value) {
    let chat_id: Uuid = event["chat_id"].as_str().unwrap().parse().unwrap();
    let call = (
        event["message_id"].as_str().unwrap().parse().unwrap(),
        event["tool_call_id"].as_str().unwrap().to_string(),
    );
    let answered = post_live(
        state,
        chat_id,
        &call,
        json!({"validation_errors": [{
            "path": "", "code": "scope_changed",
            "message": "The document changed since the approval.",
        }]}),
        Some(&row.binding()),
    )
    .await;
    answered.assert_status_ok();
    assert_eq!(answered.json::<Value>()["delivered"], true);
}

fn lineage_scope(approval_id: Uuid, scope_id: &str, position: &Value) -> Value {
    json!({"approval_id": approval_id, "scope_id": scope_id, "position": position})
}

fn content(row: &erato::db::entity::messages::Model) -> &Vec<Value> {
    row.raw_message["content"].as_array().unwrap()
}

fn stops(row: &erato::db::entity::messages::Model) -> usize {
    content(row)
        .iter()
        .filter(|part| part["content_type"] == "tool_approval_request")
        .count()
}

#[derive(Debug, PartialEq)]
pub(super) struct Stored {
    pub id: Uuid,
    pub position: Option<Value>,
    pub decided_in: Uuid,
    pub end_reason: Option<String>,
}

pub(super) async fn approvals(state: &erato::state::AppState, chat_id: Uuid) -> Vec<Stored> {
    state
        .db
        .query_all_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"SELECT id, position, decided_in_message_id, end_reason
               FROM client_tool_approval_scopes WHERE chat_id = $1 ORDER BY created_at"#,
            vec![chat_id.into()],
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| Stored {
            id: row.try_get("", "id").unwrap(),
            position: row.try_get("", "position").unwrap(),
            decided_in: row.try_get("", "decided_in_message_id").unwrap(),
            end_reason: row.try_get("", "end_reason").unwrap(),
        })
        .collect()
}

/// Every approval in the database, in any chat.
async fn approval_count(state: &erato::state::AppState) -> i64 {
    state
        .db
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            "SELECT count(*) AS stored FROM client_tool_approval_scopes",
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "stored")
        .unwrap()
}

async fn wait_no_scoped_stream(state: &erato::state::AppState) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let left = state
                .db
                .query_one_raw(sea_orm::Statement::from_string(
                    sea_orm::DatabaseBackend::Postgres,
                    "SELECT count(*) AS left FROM client_executor_presence \
                     WHERE scoped_client_tools <> '[]'::jsonb",
                ))
                .await
                .unwrap()
                .unwrap()
                .try_get::<i64>("", "left")
                .unwrap();
            if left == 0 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("a dropped stream releases its presence");
}

/// The task chats a parent chat dispatched.
async fn task_chats(db: &sea_orm::DatabaseConnection, parent: Uuid) -> Vec<Uuid> {
    chats::Entity::find()
        .all(db)
        .await
        .unwrap()
        .into_iter()
        .filter(|task| {
            task.assistant_configuration
                .as_ref()
                .is_some_and(|config| config["provenance"]["origin_chat_id"] == json!(parent))
        })
        .map(|task| task.id)
        .collect()
}

/// Answers each call the pane receives until `count` have run.
async fn answer_calls(row: &HostRow, chat: &mut ScopeChat, count: usize) -> Vec<Value> {
    let mut calls = Vec::new();
    for _ in 0..count {
        let event = chat.pane.call().await;
        answer_call(row, &chat.state, &event).await;
        calls.push(event);
    }
    calls
}

pub(super) async fn a_context_approval_covers_every_task_reading_the_scope(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut chat = scope_chat(row, pool, 10, document(row), |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    // The stop holds the tasks launched before it; the rest launch after the
    // decision and find its approval at the gate.
    let items = stop_items(&parent);
    assert!((3..=10).contains(&items.len()), "{items:?}");
    let scope_id = if document(row) {
        row.identity.to_string()
    } else {
        parent.id.to_string()
    };
    for item in &items {
        assert_eq!(item["child"]["approval_scope"], offered(row, &scope_id));
    }
    let position = position(41);
    let decided = allow_for_scope(row, &chat.base, parent.id, &items, &position);
    let calls = answer_calls(row, &mut chat, 10).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));

    let stored = chat.approvals().await;
    assert_eq!(stored.len(), 1, "one approval for the decision: {stored:?}");
    assert_eq!(
        approval_count(&chat.state).await,
        1,
        "no task chat keeps an approval of its own"
    );
    assert_eq!(stored[0].decided_in, parent.id);
    assert_eq!(stored[0].end_reason, None);
    assert_eq!(stored[0].position, document(row).then(|| position.clone()));
    let decided = assistant_row(&chat.state.db, chat.chat_id).await;
    for item in &items {
        assert!(
            content(&decided)
                .iter()
                .any(|part| part["content_type"] == "tool_approval"
                    && part["approval_id"] == item["approval_id"]
                    && part["scope_approval_id"] == json!(stored[0].id)),
            "every item names the one approval: {}",
            decided.raw_message
        );
    }
    let task_chats: HashSet<&str> = calls
        .iter()
        .map(|event| event["chat_id"].as_str().unwrap())
        .collect();
    assert_eq!(task_chats.len(), 10);
    for event in &calls {
        if document(row) {
            assert_eq!(
                event["lineage"]["approval_scope"],
                lineage_scope(stored[0].id, row.identity, &position)
            );
        } else {
            assert!(event["lineage"].get("approval_scope").is_none(), "{event}");
        }
    }
    assert_eq!(
        stops(&assistant_row(&chat.state.db, chat.chat_id).await),
        1,
        "no second stop"
    );
    chat.server.abort();
}

pub(super) async fn a_later_turn_reuses_a_document_approval_and_a_turn_approval_asks_again(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut chat = scope_chat(row, pool, 1, document(row), |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let position = position(7);
    let decided = allow_for_scope(row, &chat.base, parent.id, &stop_items(&parent), &position);
    answer_calls(row, &mut chat, 1).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));
    let first = chat.approvals().await;
    assert_eq!(first.len(), 1);

    let second = chat.second_turn(row, row.binding());
    if document(row) {
        let event = chat.pane.call().await;
        assert_eq!(
            event["lineage"]["approval_scope"],
            lineage_scope(first[0].id, row.identity, &position)
        );
        answer_call(row, &chat.state, &event).await;
        assert!(finish(second).await.contains(PARENT_FINAL_2));
        let later = assistant_row(&chat.state.db, chat.chat_id).await;
        assert_ne!(later.id, parent.id);
        assert_eq!(stops(&later), 0, "the later turn never asks");
    } else {
        finish(second).await;
        assert_eq!(chat.pane.next(Duration::from_millis(300)).await, None);
        let later = assistant_row(&chat.state.db, chat.chat_id).await;
        assert_ne!(later.id, parent.id);
        assert_eq!(
            stop_items(&later)[0]["child"]["approval_scope"],
            offered(row, &later.id.to_string())
        );
    }
    assert_eq!(chat.approvals().await, first);
    chat.server.abort();
}

pub(super) async fn a_new_pane_session_asks_again(pool: Pool<Postgres>, row: &HostRow) {
    let mut chat = scope_chat(row, pool, 1, document(row), |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let decided = allow_for_scope(
        row,
        &chat.base,
        parent.id,
        &stop_items(&parent),
        &position(2),
    );
    answer_calls(row, &mut chat, 1).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));

    let mut reloaded = row.binding();
    let identity = format!("{}-2", row.identity);
    reloaded.host_context.as_mut().unwrap().identity = identity.clone();
    let mut pane = open_row_pane(row, &chat.base, &reloaded, document(row)).await;
    finish(chat.second_turn(row, reloaded)).await;
    assert_eq!(pane.next(Duration::from_millis(300)).await, None);
    assert_eq!(chat.pane.next(Duration::from_millis(300)).await, None);
    let later = assistant_row(&chat.state.db, chat.chat_id).await;
    let scope_id = if document(row) {
        identity
    } else {
        later.id.to_string()
    };
    assert_eq!(
        stop_items(&later)[0]["child"]["approval_scope"],
        offered(row, &scope_id)
    );
    let stored = chat.approvals().await;
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].end_reason, None);
    chat.server.abort();
}

pub(super) async fn scope_changed_ends_the_approval_and_asks_again(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut chat = scope_chat(row, pool, 1, document(row), |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let first_position = position(3);
    let decided = allow_for_scope(
        row,
        &chat.base,
        parent.id,
        &stop_items(&parent),
        &first_position,
    );
    let event = chat.pane.call().await;
    if !document(row) {
        // The server alone keeps a turn approval: a host's scope_changed is a
        // failure of the call, nothing more.
        assert!(event["lineage"].get("approval_scope").is_none(), "{event}");
        answer_scope_changed(row, &chat.state, &event).await;
        assert!(finish(decided).await.contains(PARENT_FINAL));
        let stored = chat.approvals().await;
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].end_reason, None);
        let task_chat: Uuid = event["chat_id"].as_str().unwrap().parse().unwrap();
        let read = part_for(
            &assistant_row(&chat.state.db, task_chat).await,
            CHILD_READ_CALL,
        );
        assert_eq!(
            read["output"]["validation_errors"][0]["code"],
            "scope_changed"
        );
        chat.server.abort();
        return;
    }
    let first = chat.approvals().await;
    assert_eq!(
        event["lineage"]["approval_scope"],
        lineage_scope(first[0].id, row.identity, &first_position)
    );
    answer_scope_changed(row, &chat.state, &event).await;
    assert!(!finish(decided).await.contains(PARENT_FINAL));

    let stored = chat.approvals().await;
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].end_reason.as_deref(), Some("scope_changed"));
    let task_chat: Uuid = event["chat_id"].as_str().unwrap().parse().unwrap();
    let task_row = assistant_row(&chat.state.db, task_chat).await;
    let asked = parked_part(&task_row);
    assert_eq!(asked["tool_call_id"], event["tool_call_id"]);
    let mut changed = offered(row, row.identity);
    changed["changed"] = json!(true);
    assert_eq!(asked["approval_scope"], changed);
    assert!(
        !content(&task_row)
            .iter()
            .any(|part| part["content_type"] == "tool_use"
                && part["tool_call_id"] == event["tool_call_id"]),
        "the call has no result, so it is asked again: {}",
        task_row.raw_message
    );
    let reparked = assistant_row(&chat.state.db, chat.chat_id).await;
    assert_eq!(reparked.id, parent.id);
    let items = stop_items(&reparked);
    assert_eq!(items[0]["child"]["approval_scope"], changed);

    let second_position = position(9);
    let decided = allow_for_scope(row, &chat.base, parent.id, &items, &second_position);
    let event = chat.pane.call().await;
    let stored = chat.approvals().await;
    assert_eq!(stored.len(), 2, "a new decision makes a new approval");
    assert_eq!(stored[1].position, Some(second_position.clone()));
    assert_eq!(stored[1].end_reason, None);
    assert_eq!(
        event["lineage"]["approval_scope"],
        lineage_scope(stored[1].id, row.identity, &second_position)
    );
    answer_call(row, &chat.state, &event).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));
    chat.server.abort();
}

pub(super) async fn a_decision_before_an_outside_change_never_makes_a_new_approval(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let mut chat = scope_chat(row, pool, 2, document(row), |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let items = stop_items(&parent);
    assert_eq!(items.len(), 2);
    let decided = allow_for_scope(row, &chat.base, parent.id, &items, &position(5));
    let event = chat.pane.call().await;
    if !document(row) {
        answer_call(row, &chat.state, &event).await;
        let other = chat.pane.call().await;
        assert!(other["lineage"].get("approval_scope").is_none(), "{other}");
        answer_call(row, &chat.state, &other).await;
        assert!(finish(decided).await.contains(PARENT_FINAL));
        let stored = chat.approvals().await;
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].end_reason, None);
        chat.server.abort();
        return;
    }
    answer_scope_changed(row, &chat.state, &event).await;
    assert!(!finish(decided).await.contains(PARENT_FINAL));
    assert_eq!(
        chat.pane.next(Duration::from_millis(300)).await,
        None,
        "the other task's call is asked again before it reaches the pane"
    );
    let stored = chat.approvals().await;
    assert_eq!(stored.len(), 1, "{stored:?}");
    assert_eq!(stored[0].end_reason.as_deref(), Some("scope_changed"));
    let reparked = assistant_row(&chat.state.db, chat.chat_id).await;
    let items = stop_items(&reparked);
    assert_eq!(items.len(), 2, "{items:?}");
    for item in &items {
        assert_eq!(item["child"]["approval_scope"]["changed"], true, "{item}");
    }
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_document_approval_needs_the_panes_binding_and_marks_the_tasks_approval(
    pool: Pool<Postgres>,
) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut chat = scope_chat(row, pool, 1, true, |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let items = stop_items(&parent);
    let position = position(41);
    let body = json!({
        "message_id": parent.id,
        "decisions": [{"approval_id": items[0]["approval_id"], "decision": "approve_context",
                       "scope_position": position}],
        "shows_child_items": true,
    });
    assert_refused(
        &chat.state,
        body.clone(),
        None,
        "Allow the whole document in the pane that has it open",
    )
    .await;
    assert!(chat.approvals().await.is_empty());

    let decided = spawn_decision_from(&chat.base, body, &row.binding());
    let event = answer_calls(row, &mut chat, 1).await.remove(0);
    assert!(finish(decided).await.contains(PARENT_FINAL));
    let approval_id = event["lineage"]["approval_scope"]["approval_id"].clone();
    let task_chat: Uuid = event["chat_id"].as_str().unwrap().parse().unwrap();
    let task_row = assistant_row(&chat.state.db, task_chat).await;
    assert!(
        content(&task_row)
            .iter()
            .any(|part| part["content_type"] == "tool_approval"
                && part["covers"] == "document"
                && part["scope_approval_id"] == approval_id),
        "{}",
        task_row.raw_message
    );
    let parent_row = assistant_row(&chat.state.db, chat.chat_id).await;
    assert!(
        content(&parent_row)
            .iter()
            .any(|part| part["content_type"] == "tool_approval"
                && part["covers"] == "document"
                && part["scope_approval_id"] == approval_id),
        "{}",
        parent_row.raw_message
    );
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_pane_that_does_not_check_scopes_is_asked_per_call(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut chat = scope_chat(row, pool, 1, false, |_, _| {}, |_| {}).await;
    let seeded = scope::approve_for_decision(
        &chat.state.db,
        chat.chat_id,
        &document_key(row, &row.binding()),
        Uuid::new_v4(),
        0,
        Some(&position(1)),
    )
    .await
    .unwrap();
    let parent = chat.ask(row).await;
    let items = stop_items(&parent);
    assert!(
        items[0]["child"].get("approval_scope").is_none(),
        "{items:?}"
    );
    assert_refused(
        &chat.state,
        json!({
            "message_id": parent.id,
            "decisions": [{"approval_id": items[0]["approval_id"], "decision": "approve_context",
                           "scope_position": position(1)}],
            "shows_child_items": true,
        }),
        Some(&row.binding()),
        "This call cannot be allowed for its whole document or response",
    )
    .await;
    let decided = spawn_decision(
        &chat.base,
        json!({
            "message_id": parent.id,
            "decisions": [{"approval_id": items[0]["approval_id"], "decision": "approve"}],
            "shows_child_items": true,
        }),
    );
    let event = answer_calls(row, &mut chat, 1).await.remove(0);
    assert!(event["lineage"].get("approval_scope").is_none(), "{event}");
    assert!(finish(decided).await.contains(PARENT_FINAL));
    let stored = chat.approvals().await;
    assert_eq!(stored.len(), 1);
    assert_eq!(
        (stored[0].id, stored[0].end_reason.as_deref()),
        (seeded, None)
    );
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_covered_call_reaches_only_a_stream_that_checks(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut chat = scope_chat(row, pool, 2, true, |_, _| {}, |_| {}).await;
    tokio::time::sleep(Duration::from_millis(5)).await;
    let mut plain = open_row_pane(row, &chat.base, &row.binding(), false).await;
    let parent = chat.ask(row).await;
    let decided = allow_for_scope(
        row,
        &chat.base,
        parent.id,
        &stop_items(&parent),
        &position(1),
    );
    // The newer stream takes grant calls too, but does not check the scope.
    let event = chat.pane.call().await;
    assert!(event["lineage"]["approval_scope"].is_object(), "{event}");
    assert_eq!(plain.next(Duration::from_millis(300)).await, None);

    let checking = std::mem::replace(&mut chat.pane, plain);
    drop(checking);
    wait_no_scoped_stream(&chat.state).await;
    answer_call(row, &chat.state, &event).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert_eq!(
        chat.pane.next(Duration::from_millis(300)).await,
        None,
        "the other task's covered call never reaches a stream that does not check"
    );
    let other: Vec<Uuid> = task_chats(&chat.state.db, chat.chat_id)
        .await
        .into_iter()
        .filter(|id| event["chat_id"] != json!(id))
        .collect();
    assert_eq!(other.len(), 1);
    let read = part_for(
        &assistant_row(&chat.state.db, other[0]).await,
        CHILD_READ_CALL,
    );
    assert_eq!(
        read["output"],
        json!({"status": "cancelled", "reason": "context_unavailable"})
    );
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn call_scope_tools_offer_no_context_and_refuse_approve_context(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut chat = scope_chat(
        row,
        pool,
        1,
        true,
        |_, _| {},
        |config| {
            config.client_tools.tools.insert(
                READ_KEY.into(),
                row.read_config(false, None, ClientToolApprovalScope::Call),
            );
        },
    )
    .await;
    let parent = chat.ask(row).await;
    let items = stop_items(&parent);
    assert!(
        items[0]["child"].get("approval_scope").is_none(),
        "{items:?}"
    );
    assert_refused(
        &chat.state,
        json!({
            "message_id": parent.id,
            "decisions": [{"approval_id": items[0]["approval_id"], "decision": "approve_context",
                           "scope_position": position(1)}],
            "shows_child_items": true,
        }),
        Some(&row.binding()),
        "This call cannot be allowed for its whole document or response",
    )
    .await;
    assert!(chat.approvals().await.is_empty());
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approve_context_is_refused_off_a_parent_cards_task_items(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    // The coordinator reads too, so its own call shares the card.
    let (read_tool, parent_read) = (row.read_tool, row.model_input.clone());
    let mut chat = scope_chat(
        row,
        pool.clone(),
        1,
        true,
        move |mocks, _| {
            mocks.mock(|when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(&[MOVED_ON], &[]));
                mock_llm_sse_response(then, build_openai_text_streaming_response(&["MOVED-ON"]));
            });
            mocks.mock(move |when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(
                        &[USER_MESSAGE],
                        &["child_run_id", USER_MESSAGE_2],
                    ));
                let (task_call, task_args) = client_task(None);
                mock_llm_sse_response(
                    then,
                    build_openai_tool_calls_streaming_response(&[
                        (task_call, "delegate_task", task_args),
                        ("call_parent_read", read_tool, parent_read.clone()),
                    ]),
                );
            });
        },
        |_| {},
    )
    .await;
    let parent = chat.ask(row).await;
    let items = stop_items(&parent);
    assert_eq!(items.len(), 2, "{items:?}");
    assert!(items[0]["child"].is_null());
    assert_eq!(
        items[1]["child"]["approval_scope"],
        offered(row, row.identity)
    );
    let decisions = |own: &str| {
        json!({
            "message_id": parent.id,
            "decisions": [
                {"approval_id": items[0]["approval_id"], "decision": own,
                 "scope_position": position(1)},
                {"approval_id": items[1]["approval_id"], "decision": "approve_context",
                 "scope_position": position(1)},
            ],
            "shows_child_items": true,
        })
    };
    assert_refused(
        &chat.state,
        decisions("approve_context"),
        Some(&row.binding()),
        "Only a task's call can be allowed",
    )
    .await;

    // Once the parent moved on, the task's own card answers it, with the
    // usual choices only.
    let moved = app_server(chat.state.clone())
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"existing_chat_id": chat.chat_id, "user_message": MOVED_ON}))
        .await;
    moved.assert_status_ok();
    let task = child_chat(&chat.state.db, chat.chat_id, CHILD_FACET)
        .await
        .unwrap();
    let task_row = assistant_row(&chat.state.db, task.id).await;
    let own_card = parked_part(&task_row);
    assert_eq!(own_card["approval_scope"], offered(row, row.identity));
    let own_decision = |decision: &str| {
        json!({
            "message_id": task_row.id,
            "decisions": [{"approval_id": own_card["approvals"][0]["approval_id"],
                           "decision": decision, "scope_position": position(1)}],
            "shows_child_items": true,
        })
    };
    assert_refused(
        &chat.state,
        own_decision("approve_context"),
        Some(&row.binding()),
        "A task's own card cannot allow",
    )
    .await;
    app_server(chat.state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&own_decision("approve"))
        .await
        .assert_status_ok();
    assert!(chat.approvals().await.is_empty());
    chat.server.abort();

    let parked = park_a_client_child(row, pool).await;
    let parent_row = Messages::find_by_id(parked.parent_message_id)
        .one(&parked.state.db)
        .await
        .unwrap()
        .unwrap();
    let item = &stop_items(&parent_row)[0];
    assert_eq!(item["child"]["kind"], "mcp_tool");
    assert_refused(
        &parked.state,
        json!({
            "message_id": parked.parent_message_id,
            "decisions": [{"approval_id": item["approval_id"], "decision": "approve_context"}],
            "shows_child_items": true,
        }),
        None,
        "Only a task's client tool call",
    )
    .await;
    approve_and_resume(&parked).await;
    parked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approve_context_on_a_document_needs_the_panes_position(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut chat = scope_chat(row, pool, 2, true, |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let items = stop_items(&parent);
    let body = |positions: [Option<Value>; 2]| {
        let decisions: Vec<Value> = items
            .iter()
            .zip(positions)
            .map(|(item, position)| {
                let mut decision =
                    json!({"approval_id": item["approval_id"], "decision": "approve_context"});
                if let Some(position) = position {
                    decision["scope_position"] = position;
                }
                decision
            })
            .collect();
        json!({"message_id": parent.id, "decisions": decisions, "shows_child_items": true})
    };
    let same = |position: Value| [Some(position.clone()), Some(position)];
    let binding = row.binding();
    let mut elsewhere = row.binding();
    elsewhere.device_id = "another-device".into();
    let refused = [
        (body([None, None]), &binding, "needs the position"),
        (
            body(same(position(1))),
            &elsewhere,
            "Allow the whole document in the pane that has it open",
        ),
        (
            body(same(
                json!({"journal": "journal-1", "seq": 1, "events": false}),
            )),
            &binding,
            "needs the position",
        ),
        (
            body(same(
                json!({"journal": "j".repeat(1100), "seq": 1, "events": true}),
            )),
            &binding,
            "needs the position",
        ),
        (
            body(same(json!("journal-1:1"))),
            &binding,
            "needs the position",
        ),
        (
            body([Some(position(1)), Some(position(2))]),
            &binding,
            "must carry the same position",
        ),
    ];
    for (body, executor, because) in refused {
        assert_refused(&chat.state, body, Some(executor), because).await;
    }
    assert!(chat.approvals().await.is_empty());

    let decided = spawn_decision_from(&chat.base, body(same(position(1))), &binding);
    answer_calls(row, &mut chat, 2).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert_eq!(chat.approvals().await.len(), 1);
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn always_and_never_on_a_scope_item_keep_their_meaning(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut chat = scope_chat(row, pool.clone(), 1, true, |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let decided = spawn_decision(
        &chat.base,
        json!({
            "message_id": parent.id,
            "decisions": [{"approval_id": stop_items(&parent)[0]["approval_id"],
                           "decision": "approve_always"}],
            "shows_child_items": true,
        }),
    );
    let event = answer_calls(row, &mut chat, 1).await.remove(0);
    assert!(event["lineage"].get("approval_scope").is_none(), "{event}");
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert!(chat.approvals().await.is_empty());
    chat.server.abort();

    // Never stored after a document approval refuses the calls it covered.
    let mut chat = scope_chat(row, pool, 2, true, |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let decided = allow_for_scope(
        row,
        &chat.base,
        parent.id,
        &stop_items(&parent),
        &position(1),
    );
    let event = chat.pane.call().await;
    erato::models::user_preference::set_client_tool_decision(
        &chat.state.db,
        &account(&chat.state).await,
        &row.qualified(),
        erato::models::user_preference::ClientToolDecision::NeverAllow,
    )
    .await
    .unwrap();
    answer_call(row, &chat.state, &event).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert_eq!(chat.pane.next(Duration::from_millis(300)).await, None);
    let other: Vec<Uuid> = task_chats(&chat.state.db, chat.chat_id)
        .await
        .into_iter()
        .filter(|id| event["chat_id"] != json!(id))
        .collect();
    let read = part_for(
        &assistant_row(&chat.state.db, other[0]).await,
        CHILD_READ_CALL,
    );
    assert_eq!(read["status"], "error", "{read}");
    let stored = chat.approvals().await;
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].end_reason.as_deref(), Some("never_allowed"));

    erato::models::user_preference::set_client_tool_decision(
        &chat.state.db,
        &account(&chat.state).await,
        &row.qualified(),
        erato::models::user_preference::ClientToolDecision::Ask,
    )
    .await
    .unwrap();
    finish(chat.second_turn(row, row.binding())).await;
    assert_eq!(
        chat.pane.next(Duration::from_millis(300)).await,
        None,
        "Ask after Never asks again instead of reading under the earlier approval"
    );
    let later = assistant_row(&chat.state.db, chat.chat_id).await;
    assert_ne!(later.id, parent.id);
    assert_eq!(
        stop_items(&later)[0]["child"]["approval_scope"],
        offered(row, row.identity)
    );
    assert_eq!(chat.approvals().await, stored);
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_tool_set_to_never_gets_no_approval(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    // The document allowed on one item and Never on the next: the first call is
    // allowed once and no approval outlives the Never.
    let mut chat = scope_chat(row, pool.clone(), 2, true, |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let items = stop_items(&parent);
    assert_eq!(items.len(), 2);
    let decided = spawn_decision_from(
        &chat.base,
        json!({
            "message_id": parent.id,
            "decisions": [
                {"approval_id": items[0]["approval_id"], "decision": "approve_context",
                 "scope_position": position(3)},
                {"approval_id": items[1]["approval_id"], "decision": "reject_always"},
            ],
            "shows_child_items": true,
        }),
        &row.binding(),
    );
    let event = answer_calls(row, &mut chat, 1).await.remove(0);
    assert!(event["lineage"].get("approval_scope").is_none(), "{event}");
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert_eq!(chat.pane.next(Duration::from_millis(300)).await, None);
    assert!(chat.approvals().await.is_empty());
    chat.server.abort();

    let mut chat = scope_chat(row, pool, 1, true, |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    erato::models::user_preference::set_client_tool_decision(
        &chat.state.db,
        &account(&chat.state).await,
        &row.qualified(),
        erato::models::user_preference::ClientToolDecision::NeverAllow,
    )
    .await
    .unwrap();
    let decided = allow_for_scope(
        row,
        &chat.base,
        parent.id,
        &stop_items(&parent),
        &position(4),
    );
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert_eq!(chat.pane.next(Duration::from_millis(300)).await, None);
    assert!(chat.approvals().await.is_empty());
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_in_settings_ends_the_tools_approvals(pool: Pool<Postgres>) {
    use erato::models::user_preference::{
        ClientToolDecision, UpdateUserPreferencesInput, upsert_user_preferences,
    };
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let state = test_app_state(hermetic_app_config(None, None), pool).await;
    let db = &state.db;
    let chat_id = seed_origin_chat(db).await;
    let read = document_key(row, &row.binding());
    let other = ScopeKey {
        tool_name: format!("{}/{OTHER_READ_TOOL}", row.namespace),
        ..read.clone()
    };
    let decided_in = Uuid::new_v4();
    for key in [&read, &other] {
        scope::approve_for_decision(db, chat_id, key, decided_in, 0, Some(&position(1)))
            .await
            .unwrap();
    }
    upsert_user_preferences(
        db,
        &account(&state).await,
        UpdateUserPreferencesInput {
            client_tool_decisions: Some(
                [
                    (read.tool_name.clone(), ClientToolDecision::NeverAllow),
                    (other.tool_name.clone(), ClientToolDecision::Ask),
                ]
                .into(),
            ),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        scope::lookup(db, chat_id, &read)
            .await
            .unwrap()
            .last_end
            .as_deref(),
        Some("never_allowed")
    );
    assert!(
        scope::lookup(db, chat_id, &other)
            .await
            .unwrap()
            .live
            .is_some()
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_response_approval_is_accepted_from_any_client(pool: Pool<Postgres>) {
    let row = &rows::fake_live_host(ClientToolHostContext::OutlookMailbox);
    let mut other_device = row.binding();
    other_device.device_id = "another-device".into();
    for executor in [None, Some(other_device)] {
        let mut chat = scope_chat(row, pool.clone(), 1, false, |_, _| {}, |_| {}).await;
        let parent = chat.ask(row).await;
        let body = json!({
            "message_id": parent.id,
            "decisions": [{"approval_id": stop_items(&parent)[0]["approval_id"],
                           "decision": "approve_context", "scope_position": position(1)}],
            "shows_child_items": true,
        });
        let decided = match &executor {
            Some(executor) => spawn_decision_from(&chat.base, body, executor),
            None => spawn_decision(&chat.base, body),
        };
        let event = answer_calls(row, &mut chat, 1).await.remove(0);
        assert!(event["lineage"].get("approval_scope").is_none(), "{event}");
        assert!(finish(decided).await.contains(PARENT_FINAL));
        let stored = chat.approvals().await;
        assert_eq!(stored.len(), 1, "{executor:?}: {stored:?}");
        assert_eq!(stored[0].position, None, "a response takes no position");
        assert_eq!(stored[0].end_reason, None);
        chat.server.abort();
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_crash_retry_after_a_context_decision_keeps_one_approval(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut chat = scope_chat(row, pool, 1, true, |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let position = position(4);
    // What the lost continuation had done: the decision's approval, before
    // any task resumed or any part was written.
    let stop = content(&parent)
        .iter()
        .rposition(|part| part["content_type"] == "tool_approval_request")
        .unwrap();
    let lost = scope::approve_for_decision(
        &chat.state.db,
        chat.chat_id,
        &document_key(row, &row.binding()),
        parent.id,
        i32::try_from(stop).unwrap(),
        Some(&position),
    )
    .await
    .unwrap();
    let crashed = reload(&chat.state.db, chat.chat_id).await;
    let mut active: chats::ActiveModel = crashed.into();
    active.generation_state = ActiveValue::Set(Some("errored".to_string()));
    active.update(&chat.state.db).await.unwrap();

    let decided = allow_for_scope(row, &chat.base, parent.id, &stop_items(&parent), &position);
    let event = answer_calls(row, &mut chat, 1).await.remove(0);
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert_eq!(
        event["lineage"]["approval_scope"],
        lineage_scope(lost, row.identity, &position)
    );
    let stored = chat.approvals().await;
    assert_eq!(stored.len(), 1, "{stored:?}");
    assert_eq!(stored[0].id, lost);
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_new_click_after_a_crash_makes_a_new_approval(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    for lost_ended in [true, false] {
        let mut chat = scope_chat(row, pool.clone(), 1, true, |_, _| {}, |_| {}).await;
        let parent = chat.ask(row).await;
        let stop = content(&parent)
            .iter()
            .rposition(|part| part["content_type"] == "tool_approval_request")
            .unwrap();
        let lost = scope::approve_for_decision(
            &chat.state.db,
            chat.chat_id,
            &document_key(row, &row.binding()),
            parent.id,
            i32::try_from(stop).unwrap(),
            Some(&position(4)),
        )
        .await
        .unwrap();
        if lost_ended {
            scope::end(&chat.state.db, lost, scope::END_SCOPE_CHANGED)
                .await
                .unwrap();
        }
        let crashed = reload(&chat.state.db, chat.chat_id).await;
        let mut active: chats::ActiveModel = crashed.into();
        active.generation_state = ActiveValue::Set(Some("errored".to_string()));
        active.update(&chat.state.db).await.unwrap();

        let fresh = position(6);
        let decided = allow_for_scope(row, &chat.base, parent.id, &stop_items(&parent), &fresh);
        let event = answer_calls(row, &mut chat, 1).await.remove(0);
        assert!(finish(decided).await.contains(PARENT_FINAL));
        let stored = chat.approvals().await;
        assert_eq!(stored.len(), 2, "{stored:?}");
        assert_eq!(stored[0].id, lost);
        assert_eq!(
            stored[0].end_reason.as_deref(),
            Some(if lost_ended {
                "scope_changed"
            } else {
                "superseded"
            })
        );
        assert_eq!(stored[1].position, Some(fresh.clone()));
        assert_eq!(stored[1].end_reason, None);
        assert_eq!(
            event["lineage"]["approval_scope"],
            lineage_scope(stored[1].id, row.identity, &fresh)
        );
        chat.server.abort();
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_stale_scope_changed_never_ends_a_newer_approval(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let state = test_app_state(hermetic_app_config(None, None), pool).await;
    let db = &state.db;
    let chat_id = seed_origin_chat(db).await;
    let key = document_key(row, &row.binding());
    let decided_in = Uuid::new_v4();
    let older = scope::approve_for_decision(db, chat_id, &key, decided_in, 0, Some(&position(1)))
        .await
        .unwrap();
    assert!(
        scope::end(db, older, scope::END_SCOPE_CHANGED)
            .await
            .unwrap()
    );
    let newer = scope::approve_for_decision(db, chat_id, &key, decided_in, 1, Some(&position(2)))
        .await
        .unwrap();
    assert_ne!(older, newer);
    assert!(
        !scope::end(db, older, scope::END_SCOPE_CHANGED)
            .await
            .unwrap()
    );
    assert_eq!(
        scope::approve_for_decision(db, chat_id, &key, decided_in, 0, Some(&position(1)))
            .await
            .unwrap(),
        older,
        "a decision never makes a second approval"
    );
    let lookup = scope::lookup(db, chat_id, &key).await.unwrap();
    assert_eq!(lookup.live.map(|live| live.id), Some(newer));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_scope_changed_for_a_call_without_a_scope_is_a_host_error(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut chat = scope_chat(row, pool, 1, true, |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let decided = spawn_decision(
        &chat.base,
        json!({
            "message_id": parent.id,
            "decisions": [{"approval_id": stop_items(&parent)[0]["approval_id"], "decision": "approve"}],
            "shows_child_items": true,
        }),
    );
    let event = chat.pane.call().await;
    assert!(event["lineage"].get("approval_scope").is_none(), "{event}");
    answer_scope_changed(row, &chat.state, &event).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));
    let task_chat: Uuid = event["chat_id"].as_str().unwrap().parse().unwrap();
    let read = part_for(
        &assistant_row(&chat.state.db, task_chat).await,
        CHILD_READ_CALL,
    );
    assert_eq!(
        read["output"]["validation_errors"][0]["code"],
        "scope_changed"
    );
    let heard = turn_bodies(&chat.child);
    assert!(heard.last().unwrap().to_string().contains("scope_changed"));
    assert!(chat.approvals().await.is_empty());
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_scope_changed_without_a_surface_is_a_typed_outcome(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut chat = scope_chat(
        row,
        pool,
        1,
        true,
        |_, _| {},
        |config| config.delegation.tasks.propagate_child_mcp_approvals = false,
    )
    .await;
    let seeded = scope::approve_for_decision(
        &chat.state.db,
        chat.chat_id,
        &document_key(row, &row.binding()),
        Uuid::new_v4(),
        0,
        Some(&position(6)),
    )
    .await
    .unwrap();
    let run = spawn_parent(
        row,
        &chat.base,
        chat.chat_id,
        ACTION_FACET,
        Some(row.binding()),
    );
    let event = chat.pane.call().await;
    assert_eq!(
        event["lineage"]["approval_scope"],
        lineage_scope(seeded, row.identity, &position(6))
    );
    answer_scope_changed(row, &chat.state, &event).await;
    assert!(finish(run).await.contains(PARENT_FINAL));
    let task_chat: Uuid = event["chat_id"].as_str().unwrap().parse().unwrap();
    let read = part_for(
        &assistant_row(&chat.state.db, task_chat).await,
        CHILD_READ_CALL,
    );
    assert_eq!(
        read["output"],
        json!({"status": "cancelled", "reason": "scope_changed"})
    );
    let heard = turn_bodies(&chat.child);
    assert!(
        heard
            .last()
            .unwrap()
            .to_string()
            .contains("changed outside the chat")
    );
    let stored = chat.approvals().await;
    assert_eq!(stored[0].end_reason.as_deref(), Some("scope_changed"));
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_unarchived_parent_chat_asks_again(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut chat = scope_chat(row, pool, 1, true, |_, _| {}, |_| {}).await;
    let parent = chat.ask(row).await;
    let decided = allow_for_scope(
        row,
        &chat.base,
        parent.id,
        &stop_items(&parent),
        &position(1),
    );
    answer_calls(row, &mut chat, 1).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));

    let server = app_server(chat.state.clone());
    archive_chat_via_api(&server, &chat.chat_id.to_string()).await;
    unarchive_chat_via_api(&server, &chat.chat_id.to_string()).await;
    let stored = chat.approvals().await;
    assert_eq!(stored[0].end_reason.as_deref(), Some("chat_archived"));

    finish(chat.second_turn(row, row.binding())).await;
    assert_eq!(chat.pane.next(Duration::from_millis(300)).await, None);
    let later = assistant_row(&chat.state.db, chat.chat_id).await;
    assert_eq!(
        stop_items(&later)[0]["child"]["approval_scope"],
        offered(row, row.identity)
    );
    chat.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_key_names_the_binding_and_the_tool(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    // The task reads with the first tool and then with another context tool
    // on the same document.
    let other_call = build_openai_tool_calls_streaming_response(&[(
        OTHER_READ_CALL,
        OTHER_READ_TOOL,
        row.model_input.clone(),
    )]);
    let mut chat = scope_chat(
        row,
        pool,
        1,
        false,
        move |mocks, child| {
            let capture = child.clone();
            mocks.mock(move |when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(
                        &[CLIENT_BRIEF, OTHER_READ_CALL],
                        &[USER_MESSAGE],
                    ))
                    .matcher(capture);
                mock_llm_sse_response(then, build_openai_text_streaming_response(&[CHILD_ANSWER]));
            });
            let capture = child.clone();
            mocks.mock(move |when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(
                        &[CLIENT_BRIEF, CHILD_READ_CALL],
                        &[USER_MESSAGE, OTHER_READ_CALL],
                    ))
                    .matcher(capture);
                mock_llm_sse_response(then, other_call);
            });
        },
        |config| {
            let mut other = row.read_config(false, None, ClientToolApprovalScope::Context);
            other.name = OTHER_READ_TOOL.into();
            config
                .client_tools
                .tools
                .insert("host_read_other".into(), other);
        },
    )
    .await;
    let tools = format!("{},{OTHER_READ_TOOL}", row.read_tool);
    chat.pane = Pane::open_scoped(
        &chat.base,
        &row.binding(),
        &format!("{tools},{WRITE_TOOL}"),
        &tools,
        &tools,
    )
    .await;
    erato::models::user_preference::set_client_tool_decision(
        &chat.state.db,
        &account(&chat.state).await,
        &format!("{}/{OTHER_READ_TOOL}", row.namespace),
        erato::models::user_preference::ClientToolDecision::Ask,
    )
    .await
    .unwrap();
    let parent = chat.ask(row).await;
    let decided = allow_for_scope(
        row,
        &chat.base,
        parent.id,
        &stop_items(&parent),
        &position(1),
    );
    answer_calls(row, &mut chat, 1).await;
    assert!(!finish(decided).await.contains(PARENT_FINAL));
    let reparked = assistant_row(&chat.state.db, chat.chat_id).await;
    let item = &stop_items(&reparked)[0];
    assert_eq!(item["child"]["tool_name"], OTHER_READ_TOOL);
    assert_eq!(item["child"]["approval_scope"], offered(row, row.identity));
    let decided = spawn_decision(
        &chat.base,
        json!({
            "message_id": parent.id,
            "decisions": [{"approval_id": item["approval_id"], "decision": "approve"}],
            "shows_child_items": true,
        }),
    );
    answer_calls(row, &mut chat, 1).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));

    // Another device's pane with the same session identity is another key.
    let mut device = row.binding();
    device.device_id = "fake-device-2".into();
    let mut pane = open_row_pane(row, &chat.base, &device, true).await;
    finish(chat.second_turn(row, device)).await;
    assert_eq!(pane.next(Duration::from_millis(300)).await, None);
    let later = assistant_row(&chat.state.db, chat.chat_id).await;
    assert_eq!(
        stop_items(&later)[0]["child"]["approval_scope"],
        offered(row, row.identity)
    );
    let stored = chat.approvals().await;
    assert_eq!(stored.len(), 1, "{stored:?}");
    assert_eq!(stored[0].end_reason, None);
    chat.server.abort();
}
