//! Delegated tasks that read through their parent's client tools (ERMAIN-1001).
//! The host is a test-driven pane on an executor stream, described by a
//! [`rows::HostRow`]; the parent turn runs on that pane's binding.
use super::attached::serve;
use super::executor_stream::{Pane, account, rows as row_count, wait_released};
use super::*;
use crate::test_utils::{
    build_openai_delayed_text_streaming_response, build_openai_paused_tool_calls_streaming_response,
};
use erato::services::client_operations::executor_stream;
use futures::StreamExt;
use rows::HostRow;
use sea_orm::ConnectionTrait;

mod rows;

/// Stands in for the host's writes in the row's namespace: offered to the
/// parent, never child-eligible.
const WRITE_TOOL: &str = "apply_change";
const READ_KEY: &str = "host_read";
const WRITE_KEY: &str = "host_write";
const ACTION_FACET: &str = "host_turn";
/// An action facet whose turns plan tasks but are offered no host tools.
const PLAIN_ACTION_FACET: &str = "host_plain";
const CHILD_FACET: &str = "client_reader";
const RESEARCH_FACET: &str = "research";
const USER_MESSAGE: &str = "Summarise what the pane holds";
const CLIENT_BRIEF: &str = "CLIENT-BRIEF-SENTINEL: read the introduction";
const RESEARCH_BRIEF: &str = "RESEARCH-BRIEF-SENTINEL: look up the background";
const CLIENT_TASK_CALL: &str = "call_client_task";
const RESEARCH_TASK_CALL: &str = "call_research_task";
const CHILD_READ_CALL: &str = "call_child_read";
const CHILD_ANSWER: &str = "CHILD-READ-ANSWER";
const RESEARCH_ANSWER: &str = "RESEARCH-ANSWER";
const PARENT_FINAL: &str = "PARENT-FINAL-ANSWER";
const PANE_TEXT: &str = "PANE-RESULT-SENTINEL";
const TIMEOUT_MS: u64 = 60_000;
const NOT_ENABLED: &str = "client tools are not enabled for tasks";
const NOT_FROM_HOST: &str = "the turn was not sent from the pane this task needs";
const NONE_OFFERED: &str = "the turn offered no client tools that tasks may use";
const ALL_NEVER: &str = "the user does not allow these client tools";
const PANE_NOT_CONNECTED: &str = "the pane is not connected";
const PANE_REFUSES_TASKS: &str = "the pane does not take calls from tasks";
const RETRIED: &str = "a retried task gets no client tools";

fn fake_host() -> HostRow {
    rows::fake_host(erato::config::ClientToolHostContext::WordDocument)
}

fn host_tools(row: &HostRow) -> String {
    format!("{}/*", row.namespace)
}

fn action_facet(row: &HostRow, tool_call_allowlist: &[&str]) -> ActionFacetConfig {
    ActionFacetConfig {
        display_name: "Host turn".into(),
        platform: Some(row.platform.into()),
        template: "Work with what the pane holds.".into(),
        allowed_args: row
            .turn_action_args()
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect(),
        tool_call_allowlist: tool_call_allowlist.iter().map(|s| s.to_string()).collect(),
        delegation: Some(
            serde_json::from_value(json!({ "child_facet_ids": [CHILD_FACET, RESEARCH_FACET] }))
                .unwrap(),
        ),
        ..Default::default()
    }
}

async fn delegated_state(
    row: &HostRow,
    pool: Pool<Postgres>,
    mocks: MockSet,
    tweak: impl FnOnce(&mut erato::config::AppConfig),
) -> (erato::state::AppState, MockServer) {
    let (mut config, server) = setup_mock_llm_server_with_mocks(mocks).await;
    config.delegation.tasks.enabled = true;
    config.delegation.tasks.run_modes = vec![
        erato_config::config::TaskRunMode::Wait,
        erato_config::config::TaskRunMode::Async,
    ];
    config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Never;
    config.delegation.tasks.scheduling = erato_config::config::TaskScheduling::Silent;
    config.client_tools.executor_stream_enabled = true;
    config
        .client_tools
        .tools
        .insert(READ_KEY.into(), row.read_config(false));
    config.client_tools.tools.insert(
        WRITE_KEY.into(),
        ClientToolConfig {
            name: WRITE_TOOL.into(),
            namespace: Some(row.namespace.into()),
            description: "Change what the pane holds".into(),
            parameters: json!({"type":"object"}).to_string(),
            ..Default::default()
        },
    );
    config.facets.facets.insert(
        CHILD_FACET.into(),
        FacetConfig {
            display_name: "Read what the pane holds".into(),
            disable_facet_prompt_template: true,
            child_host_context: Some(row.host),
            ..Default::default()
        },
    );
    config.facets.facets.insert(
        RESEARCH_FACET.into(),
        FacetConfig {
            display_name: "Research".into(),
            disable_facet_prompt_template: true,
            ..Default::default()
        },
    );
    config.action_facets.facets.insert(
        ACTION_FACET.into(),
        action_facet(row, &[&host_tools(row), "erato/delegate_task"]),
    );
    config.action_facets.facets.insert(
        PLAIN_ACTION_FACET.into(),
        action_facet(row, &["erato/delegate_task"]),
    );
    tweak(&mut config);
    let state = test_app_state(config, pool).await;
    get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    (state, server)
}

fn client_task(run_mode: Option<&str>) -> (&'static str, Value) {
    let mut args = json!({ "task": CLIENT_BRIEF, "facet_ids": [CHILD_FACET] });
    if let Some(mode) = run_mode {
        args["run_mode"] = json!(mode);
    }
    (CLIENT_TASK_CALL, args)
}

fn research_task(run_mode: Option<&str>) -> (&'static str, Value) {
    let mut args = json!({ "task": RESEARCH_BRIEF, "facet_ids": [RESEARCH_FACET] });
    if let Some(mode) = run_mode {
        args["run_mode"] = json!(mode);
    }
    (RESEARCH_TASK_CALL, args)
}

/// The parent plans `tasks`, then answers once a task result is back.
fn mock_parent(mocks: &mut MockSet, recorder: &RequestBodyRecorder, tasks: Vec<(&str, Value)>) {
    mock_parent_with(
        mocks,
        recorder,
        build_openai_tool_calls_streaming_response(&task_calls(tasks)),
    );
}

fn task_calls(tasks: Vec<(&str, Value)>) -> Vec<(&str, &str, Value)> {
    tasks
        .into_iter()
        .map(|(id, args)| (id, "delegate_task", args))
        .collect()
}

/// [`mock_parent`] whose planning turn answers with `first`.
fn mock_parent_with(
    mocks: &mut MockSet,
    recorder: &RequestBodyRecorder,
    first: Vec<mocktail::body::BodyAction>,
) {
    let recorder = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[USER_MESSAGE], &["child_run_id"]))
            .matcher(recorder);
        mock_llm_sse_response(then, first);
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[USER_MESSAGE, "child_run_id"],
                &[],
            ));
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[PARENT_FINAL]));
    });
}

/// The client child's first turn answers with `first`; once a result for
/// `first_call` is back it answers in prose.
fn mock_client_child(
    mocks: &mut MockSet,
    recorder: &RequestBodyRecorder,
    first: Vec<mocktail::body::BodyAction>,
    first_call: &'static str,
) {
    mock_client_child_for(mocks, recorder, CLIENT_BRIEF, first, first_call);
}

/// [`mock_client_child`] for the client task with `brief`.
fn mock_client_child_for(
    mocks: &mut MockSet,
    recorder: &RequestBodyRecorder,
    brief: &'static str,
    first: Vec<mocktail::body::BodyAction>,
    first_call: &'static str,
) {
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[brief],
                &[USER_MESSAGE, first_call],
            ))
            .matcher(capture);
        mock_llm_sse_response(then, first);
    });
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[brief, first_call],
                &[USER_MESSAGE],
            ))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[CHILD_ANSWER]));
    });
}

fn read_call(row: &HostRow) -> Vec<mocktail::body::BodyAction> {
    build_openai_tool_calls_streaming_response(&[(
        CHILD_READ_CALL,
        row.read_tool,
        row.model_input.clone(),
    )])
}

/// A client child that reads once through the pane and then answers.
fn mock_client_child_reads(row: &HostRow, mocks: &mut MockSet, recorder: &RequestBodyRecorder) {
    mock_client_child(mocks, recorder, read_call(row), CHILD_READ_CALL);
}

/// A client child that answers at once, without any tool.
fn mock_client_child_answers(mocks: &mut MockSet, recorder: &RequestBodyRecorder) {
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[CLIENT_BRIEF], &[USER_MESSAGE]))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[CHILD_ANSWER]));
    });
}

fn mock_research_child(mocks: &mut MockSet, recorder: &RequestBodyRecorder) {
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[RESEARCH_BRIEF], &[USER_MESSAGE]))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&[RESEARCH_ANSWER]),
        );
    });
}

async fn open_pane(row: &HostRow, base: &str) -> Pane {
    Pane::open_serving(
        base,
        &row.binding(),
        &row.pane_tools(),
        Some(row.child_pane_tools()),
    )
    .await
}

/// Submits the parent turn over a real connection, as the host's pane does,
/// and hands back its full SSE body once it ends.
fn spawn_parent(
    row: &HostRow,
    base: &str,
    chat_id: Uuid,
    action_facet: &str,
    executor: Option<ExecutorBinding>,
) -> tokio::task::JoinHandle<String> {
    let mut request = reqwest::Client::new()
        .post(format!("{base}/me/messages/submitstream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("X-Erato-Platform", row.platform)
        .header("X-Erato-Client-Tools", row.pane_tools())
        .json(&json!({
            "existing_chat_id": chat_id,
            "user_message": USER_MESSAGE,
            "action_facet": { "id": action_facet, "args": row.turn_action_args() },
        }));
    if let Some(executor) = executor {
        request = request.header(
            "X-Erato-Executor",
            serde_json::to_string(&executor).unwrap(),
        );
    }
    tokio::spawn(async move {
        let response = request.send().await.unwrap();
        assert!(response.status().is_success(), "{}", response.status());
        let mut body = response.bytes_stream();
        let mut received = String::new();
        while let Some(bytes) = body.next().await {
            received.push_str(&String::from_utf8_lossy(&bytes.unwrap()));
        }
        received
    })
}

async fn finish(parent: tokio::task::JoinHandle<String>) -> String {
    tokio::time::timeout(Duration::from_secs(45), parent)
        .await
        .expect("the parent turn did not finish")
        .unwrap()
}

/// Answers a pushed call as the pane: to the requesting chat, with the pane's
/// binding.
async fn answer_call(row: &HostRow, state: &erato::state::AppState, event: &Value) {
    answer_call_with(row, state, event, json!({"text": PANE_TEXT})).await;
}

async fn answer_call_with(
    row: &HostRow,
    state: &erato::state::AppState,
    event: &Value,
    result: Value,
) {
    let chat_id: Uuid = event["chat_id"].as_str().unwrap().parse().unwrap();
    let call = (
        event["message_id"].as_str().unwrap().parse().unwrap(),
        event["tool_call_id"].as_str().unwrap().to_string(),
    );
    let answered = post_live(
        state,
        chat_id,
        &call,
        json!({ "result": result }),
        Some(&row.binding()),
    )
    .await;
    answered.assert_status_ok();
    assert_eq!(answered.json::<Value>()["delivered"], true);
}

/// The lineage a grant call carries, without `context_ref` for a host that
/// has no context version.
fn lineage(row: &HostRow, owner: (Uuid, Uuid), requesting: (Uuid, &Value)) -> Value {
    let mut lineage = json!({
        "owner_chat_id": owner.0,
        "owner_message_id": owner.1,
        "requesting_chat_id": requesting.0,
        "requesting_message_id": requesting.1,
    });
    if let Some(context_ref) = row.context_ref() {
        lineage["context_ref"] = json!(context_ref);
    }
    lineage
}

async fn rows_of(
    chat_id: Uuid,
    db: &sea_orm::DatabaseConnection,
) -> Vec<erato::db::entity::messages::Model> {
    Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(db)
        .await
        .unwrap()
}

async fn assistant_row(
    db: &sea_orm::DatabaseConnection,
    chat_id: Uuid,
) -> erato::db::entity::messages::Model {
    rows_of(chat_id, db)
        .await
        .into_iter()
        .rfind(|row| row.raw_message["role"] == "assistant")
        .expect("an assistant row")
}

/// The tool part of `call` on a row, by the provider's call id.
fn part_for(row: &erato::db::entity::messages::Model, call: &str) -> Value {
    let suffix = format!(":{call}");
    row.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| {
            part["content_type"] == "tool_use"
                && part["tool_call_id"]
                    .as_str()
                    .is_some_and(|id| id.ends_with(&suffix))
        })
        .unwrap_or_else(|| panic!("no part for {call}: {}", row.raw_message))
        .clone()
}

/// The delegated child of `parent` whose task names `facet`.
async fn child_chat(
    db: &sea_orm::DatabaseConnection,
    parent: Uuid,
    facet: &str,
) -> Option<chats::Model> {
    chats::Entity::find()
        .all(db)
        .await
        .unwrap()
        .into_iter()
        .find(|chat| {
            chat.assistant_configuration.as_ref().is_some_and(|config| {
                config["provenance"]["origin_chat_id"] == json!(parent)
                    && config["task"]["facet_ids"]
                        .as_array()
                        .is_some_and(|ids| ids.contains(&json!(facet)))
            })
        })
}

async fn wait_child(db: &sea_orm::DatabaseConnection, parent: Uuid, facet: &str) -> chats::Model {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let Some(chat) = child_chat(db, parent, facet).await {
                return chat;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the task's child chat")
}

async fn reload(db: &sea_orm::DatabaseConnection, chat_id: Uuid) -> chats::Model {
    chats::Entity::find_by_id(chat_id)
        .one(db)
        .await
        .unwrap()
        .unwrap()
}

fn task_spec(chat: &chats::Model) -> Value {
    chat.assistant_configuration.as_ref().unwrap()["task"].clone()
}

/// The recorded generation requests, without a chat-title summary.
fn turn_bodies(recorder: &RequestBodyRecorder) -> Vec<Value> {
    recorder
        .bodies()
        .iter()
        .filter(|body| !body.contains("Generate a summary for the topic"))
        .map(|body| serde_json::from_str(body).unwrap())
        .collect()
}

fn offers(body: &Value, name: &str) -> bool {
    body["tools"]
        .as_array()
        .is_some_and(|tools| tools.iter().any(|tool| tool["function"]["name"] == name))
}

/// The turn's one client task got no grant, its child was not offered the
/// read tool, and its result says `reason`.
async fn assert_no_grant(
    row: &HostRow,
    state: &erato::state::AppState,
    chat_id: Uuid,
    child: &RequestBodyRecorder,
    reason: &str,
) {
    assert!(!offers(&turn_bodies(child)[0], row.read_tool));
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    assert!(task_spec(&client_child).get("client_grant").is_none());
    assert_eq!(
        task_spec(&client_child)["client_task"]["unavailable"],
        reason
    );
    let slot = part_for(&assistant_row(&state.db, chat_id).await, CLIENT_TASK_CALL);
    assert_eq!(
        slot["output"]["client_tools"],
        json!({ "unavailable": reason }),
        "{slot}"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn one_turn_grants_the_client_task_and_not_its_sibling(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child, research) = (
        RequestBodyRecorder::new(),
        RequestBodyRecorder::new(),
        RequestBodyRecorder::new(),
    );
    let mut mocks = MockSet::new();
    mock_parent(
        &mut mocks,
        &parent,
        vec![client_task(None), research_task(None)],
    );
    mock_client_child_reads(row, &mut mocks, &child);
    mock_research_child(&mut mocks, &research);
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    answer_call(row, &state, &pane.call().await).await;
    assert!(finish(run).await.contains(PARENT_FINAL));

    let parent_message = assistant_row(&state.db, chat_id).await;
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    let grant = &task_spec(&client_child)["client_grant"];
    assert_eq!(grant["tools"], json!([row.qualified()]));
    assert_eq!(grant["binding"], json!(row.binding()));
    assert_eq!(grant["owner_chat_id"], json!(chat_id));
    assert_eq!(grant["owner_message_id"], json!(parent_message.id));
    assert_eq!(
        grant.get("context_ref"),
        row.context_ref().map(|v| json!(v)).as_ref()
    );
    assert_eq!(
        task_spec(&client_child)["client_task"],
        json!({"host_context": row.host.as_str()})
    );
    let research_child = child_chat(&state.db, chat_id, RESEARCH_FACET)
        .await
        .unwrap();
    assert!(task_spec(&research_child).get("client_grant").is_none());
    assert!(task_spec(&research_child).get("client_task").is_none());

    let parent_turn = &turn_bodies(&parent)[0];
    assert!(offers(parent_turn, row.read_tool) && offers(parent_turn, WRITE_TOOL));
    let child_turns = turn_bodies(&child);
    assert_eq!(child_turns.len(), 2);
    assert!(offers(&child_turns[0], row.read_tool));
    assert!(!offers(&child_turns[0], WRITE_TOOL));
    let research_turns = turn_bodies(&research);
    assert_eq!(research_turns.len(), 1);
    assert!(!offers(&research_turns[0], row.read_tool));
    assert!(!offers(&research_turns[0], WRITE_TOOL));
    let slot = part_for(&parent_message, CLIENT_TASK_CALL);
    assert_eq!(slot["output"]["status"], "completed", "{slot}");
    assert!(
        slot["output"].get("client_tools").is_none(),
        "a granted wait task has nothing to report: {slot}"
    );
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_granted_call_reaches_the_pane_with_lineage_and_the_server_context_ref(
    pool: Pool<Postgres>,
) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_reads(row, &mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    let event = pane.call().await;
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    let parent_message = assistant_row(&state.db, chat_id).await;
    assert_eq!(event["chat_id"], json!(client_child.id));
    assert_eq!(event["tool_name"], row.read_tool);
    assert_eq!(
        event["input"],
        row.dispatched_input(),
        "the grant's context version replaces the one the model sent"
    );
    assert_eq!(
        event["lineage"],
        lineage(
            row,
            (chat_id, parent_message.id),
            (client_child.id, &event["message_id"])
        )
    );
    answer_call(row, &state, &event).await;
    assert!(finish(run).await.contains(PARENT_FINAL));

    let child_row = assistant_row(&state.db, client_child.id).await;
    assert_eq!(event["message_id"], json!(child_row.id));
    let read = part_for(&child_row, CHILD_READ_CALL);
    assert_eq!(read["status"], "success", "{read}");
    assert_eq!(
        read["input"], row.model_input,
        "the stored call keeps what the model sent"
    );
    let child_turns = turn_bodies(&child);
    let offered = &child_turns[0]["tools"]
        .as_array()
        .and_then(|tools| {
            tools
                .iter()
                .find(|tool| tool["function"]["name"] == READ_TOOL)
        })
        .expect("the granted read tool")["function"]["parameters"];
    assert!(
        offered["properties"].get("snapshot").is_none()
            && offered["properties"]["part"].is_object(),
        "the task's model is not asked for the context version the server fills: {offered}"
    );
    assert!(child_turns[1].to_string().contains(PANE_TEXT));
    if let Some(context_ref) = row.context_ref() {
        assert!(
            !child_turns
                .iter()
                .any(|body| body.to_string().contains(context_ref)),
            "the child's model never sees the context version"
        );
    }
    assert_eq!(row_count(&state, "client_executor_calls").await, 0);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_child_is_never_offered_a_tool_its_parent_was_not(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_answers(&mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let _pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, PLAIN_ACTION_FACET, Some(row.binding()));
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert!(!offers(&turn_bodies(&parent)[0], row.read_tool));
    let child_turns = turn_bodies(&child);
    assert_eq!(child_turns.len(), 1);
    assert!(!offers(&child_turns[0], row.read_tool));
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    assert!(task_spec(&client_child).get("client_grant").is_none());
    let slot = part_for(&assistant_row(&state.db, chat_id).await, CLIENT_TASK_CALL);
    assert_eq!(slot["output"]["status"], "completed");
    assert_eq!(
        slot["output"]["client_tools"],
        json!({"unavailable": NONE_OFFERED}),
        "{slot}"
    );
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_child_cannot_call_write_tools_tools_without_child_access_or_invented_tools(
    pool: Pool<Postgres>,
) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child(
        &mut mocks,
        &child,
        build_openai_tool_calls_streaming_response(&[
            ("call_child_write", WRITE_TOOL, json!({"text": "hi"})),
            ("call_child_invented", "delete_everything", json!({})),
        ]),
        "call_child_write",
    );
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert_eq!(pane.next(Duration::from_millis(500)).await, None);
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    let child_row = assistant_row(&state.db, client_child.id).await;
    for (call, tool) in [
        ("call_child_write", WRITE_TOOL),
        ("call_child_invented", "delete_everything"),
    ] {
        let part = part_for(&child_row, call);
        assert_eq!(part["status"], "error");
        assert_eq!(
            part["output"]["error"],
            format!("Proposed tool call '{tool}' is not allowed for this request")
        );
    }
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_client_task_asking_for_async_runs_in_wait_mode_beside_an_async_research_task(
    pool: Pool<Postgres>,
) {
    let row = &fake_host();
    let (parent, child, research) = (
        RequestBodyRecorder::new(),
        RequestBodyRecorder::new(),
        RequestBodyRecorder::new(),
    );
    let mut mocks = MockSet::new();
    mock_parent(
        &mut mocks,
        &parent,
        vec![client_task(Some("async")), research_task(Some("async"))],
    );
    mock_client_child_reads(row, &mut mocks, &child);
    mock_research_child(&mut mocks, &research);
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    answer_call(row, &state, &pane.call().await).await;
    assert!(finish(run).await.contains(PARENT_FINAL));

    let parent_message = assistant_row(&state.db, chat_id).await;
    let client_slot = part_for(&parent_message, CLIENT_TASK_CALL);
    assert_eq!(
        client_slot["output"]["status"], "completed",
        "{client_slot}"
    );
    assert!(
        client_slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains(CHILD_ANSWER)
    );
    assert_eq!(
        client_slot["output"]["client_tools"],
        json!({"run_mode": row.wait_note})
    );
    let research_slot = part_for(&parent_message, RESEARCH_TASK_CALL);
    assert_eq!(
        research_slot["output"]["run_mode"], "async",
        "{research_slot}"
    );
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    let configuration = client_child.assistant_configuration.as_ref().unwrap();
    assert!(configuration["provenance"].get("run_mode").is_none());
    assert_eq!(
        configuration["task"]["client_task"]["run_mode"],
        row.wait_note
    );
    assert!(configuration["task"]["client_grant"].is_object());
    let research_child = child_chat(&state.db, chat_id, RESEARCH_FACET)
        .await
        .unwrap();
    assert_eq!(
        research_child.assistant_configuration.as_ref().unwrap()["provenance"]["run_mode"],
        "async"
    );
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_async_only_gate_treats_a_client_task_as_wait(pool: Pool<Postgres>) {
    let row = &fake_host();
    let parent = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    mock_parent(
        &mut mocks,
        &parent,
        vec![client_task(Some("async")), research_task(Some("async"))],
    );
    let (state, _llm) = delegated_state(row, pool, mocks, |config| {
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::AsyncOnly;
    })
    .await;
    let (base, server) = serve(&state).await;
    let chat_id = seed_origin_chat(&state.db).await;
    finish(spawn_parent(
        row,
        &base,
        chat_id,
        ACTION_FACET,
        Some(row.binding()),
    ))
    .await;

    let parent_message = assistant_row(&state.db, chat_id).await;
    let request = parent_message.raw_message["content"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(
        request["content_type"], "tool_approval_request",
        "{request}"
    );
    assert_eq!(request["kind"], "task_plan");
    let approvals: Vec<&Value> = request["approvals"].as_array().unwrap().iter().collect();
    assert_eq!(approvals.len(), 1, "{approvals:?}");
    assert_eq!(
        approvals[0]["tool_call_id"],
        generated_tool_call_id(parent_message.id, 1, RESEARCH_TASK_CALL)
    );
    let pending: Vec<&str> = request["pending_tool_calls"]
        .as_array()
        .unwrap()
        .iter()
        .map(|call| call["call_id"].as_str().unwrap())
        .collect();
    assert_eq!(
        pending,
        vec![generated_tool_call_id(parent_message.id, 1, CLIENT_TASK_CALL).as_str()]
    );
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn no_pane_at_launch_means_no_grant_and_the_result_says_why(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_answers(&mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert!(offers(&turn_bodies(&parent)[0], row.read_tool));
    assert_no_grant(row, &state, chat_id, &child, PANE_NOT_CONNECTED).await;
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_pane_that_takes_no_task_calls_gets_no_grant(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_answers(&mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let _pane = Pane::open_serving(&base, &row.binding(), &row.pane_tools(), None).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert!(offers(&turn_bodies(&parent)[0], row.read_tool));
    assert_no_grant(row, &state, chat_id, &child, PANE_REFUSES_TASKS).await;
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_turn_without_the_hosts_binding_gets_no_grant(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_answers(&mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let _pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, None);
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert_no_grant(row, &state, chat_id, &child, NOT_FROM_HOST).await;
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn client_tasks_get_no_grant_while_executor_streams_are_off(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_answers(&mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |config| {
        config.client_tools.executor_stream_enabled = false;
    })
    .await;
    let (base, server) = serve(&state).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert_no_grant(row, &state, chat_id, &child, NOT_ENABLED).await;
    server.abort();
}

/// The child narrates, pauses long enough for the test to close the pane,
/// and then calls the read tool.
const DISPATCH_PAUSE: Duration = Duration::from_secs(6);

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_pane_gone_before_dispatch_is_context_unavailable_after_the_grace(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child(
        &mut mocks,
        &child,
        build_openai_paused_tool_calls_streaming_response(
            "Reading the introduction.",
            DISPATCH_PAUSE,
            &[(CHILD_READ_CALL, row.read_tool, row.model_input.clone())],
        ),
        CHILD_READ_CALL,
    );
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    let client_child = wait_child(&state.db, chat_id, CHILD_FACET).await;
    assert!(task_spec(&client_child)["client_grant"].is_object());
    drop(pane);
    wait_released(&state, &row.binding()).await;
    let gone = tokio::time::Instant::now();
    assert!(finish(run).await.contains(PARENT_FINAL));
    let waited = gone.elapsed();
    assert!(
        waited >= executor_stream::PRESENCE_LOSS_GRACE
            && waited
                < DISPATCH_PAUSE + executor_stream::PRESENCE_LOSS_GRACE + Duration::from_secs(10),
        "the call waits the presence grace for a pane, not the tool's timeout: {waited:?}"
    );
    let read = part_for(
        &assistant_row(&state.db, client_child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(
        read["output"],
        json!({"status":"cancelled","reason":"context_unavailable"})
    );
    assert_eq!(row_count(&state, "client_executor_calls").await, 0);
    server.abort();
}

/// Long enough for the pane to receive the call, short enough that a durable
/// escalation would happen inside the test.
const UNANSWERED_TIMEOUT_MS: u64 = 1_500;

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_child_call_never_waits_for_the_inbox_even_for_a_durable_tool(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_reads(row, &mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |config| {
        config.client_tools.durable_operations_enabled = true;
        let mut tool = row.read_config(true);
        tool.timeout_ms = Some(UNANSWERED_TIMEOUT_MS);
        config.client_tools.tools.insert(READ_KEY.into(), tool);
    })
    .await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    let event = pane.call().await;
    assert!(event["lineage"].is_object());
    assert!(finish(run).await.contains(PARENT_FINAL));

    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    let read = part_for(
        &assistant_row(&state.db, client_child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(
        read["output"],
        json!({"status":"cancelled","reason":"timeout"}),
        "an unanswered granted call times out instead of parking"
    );
    assert_eq!(row_count(&state, "client_operation_attempts").await, 0);
    for chat in [client_child.id, chat_id] {
        assert_ne!(
            reload(&state.db, chat).await.generation_state.as_deref(),
            Some("awaiting_approval")
        );
    }
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_pane_lost_in_flight_is_context_unavailable_after_the_grace(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_reads(row, &mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    // Held by a replica that died: nothing renews or releases it.
    let claim = executor_stream::PresenceClaim {
        account_id: account(&state).await,
        binding: row.binding(),
        instance_id: None,
        connected_at: chrono::Utc::now(),
        client_tools: vec![row.read_tool.to_string(), WRITE_TOOL.to_string()],
        child_client_tools: vec![row.child_pane_tools().to_string()],
    };
    executor_stream::announce(&state.db, &claim, Uuid::new_v4())
        .await
        .unwrap();
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    tokio::time::timeout(Duration::from_secs(15), async {
        while row_count(&state, "client_executor_calls").await == 0 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the granted call is handed to the binding's stream");
    state
        .db
        .execute_unprepared(
            "UPDATE client_executor_presence SET expires_at = now() - interval '1 second'",
        )
        .await
        .unwrap();
    let lost = tokio::time::Instant::now();
    assert!(finish(run).await.contains(PARENT_FINAL));
    assert!(
        lost.elapsed() >= Duration::from_secs(10),
        "the call waits out the presence grace: {:?}",
        lost.elapsed()
    );
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    let read = part_for(
        &assistant_row(&state.db, client_child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(
        read["output"],
        json!({"status":"cancelled","reason":"context_unavailable"})
    );
    assert_eq!(row_count(&state, "client_executor_calls").await, 0);
    server.abort();
}

/// The gated MCP tool a child reaches; open-world, so the restrictive preset
/// asks about it.
const PARKED_TOOL: &str = "publish_approval_probe";
const PARKED_TOOL_RESULT: &str = "approval probe published";
const CHILD_PARKED_CALL: &str = "call_child_probe";

fn gate_mock_mcp_tools_on_approval(row: &HostRow, config: &mut erato::config::AppConfig) {
    config.mcp_servers.insert(
        "mock_mcp_approval".into(),
        McpServerConfig {
            protocol_mode: Default::default(),
            transport_type: "streamable_http".into(),
            url: format!("{}/mcp/approval-policy", mock_mcp_base_url()),
            http_headers: None,
            allow_tools: None,
            exclude_tools: vec![],
            wait_tools: vec![],
            authentication: McpServerAuthenticationConfig::None,
            max_session_idle_seconds: None,
            default_tool_annotations: Default::default(),
            override_tool_annotations: Default::default(),
            tools: Default::default(),
        },
    );
    config.mcp_server_permissions.rules.insert(
        "allow-mock-mcp".into(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["mock_mcp_approval".into()],
        },
    );
    config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    config.action_facets.facets.insert(
        ACTION_FACET.into(),
        action_facet(
            row,
            &[
                &host_tools(row),
                "erato/delegate_task",
                "mock_mcp_approval/*",
            ],
        ),
    );
}

struct ParkedChild {
    state: erato::state::AppState,
    server: tokio::task::JoinHandle<()>,
    _pane: Pane,
    _llm: MockServer,
    parent_message_id: Uuid,
    child: chats::Model,
    recorder: RequestBodyRecorder,
}

/// A client task whose child stopped on an MCP approval, with the parent
/// parked on its card.
async fn park_a_client_child(row: &HostRow, pool: Pool<Postgres>) -> ParkedChild {
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    let capture = child.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[CLIENT_BRIEF],
                &[USER_MESSAGE, PARKED_TOOL_RESULT],
            ))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                CHILD_PARKED_CALL,
                PARKED_TOOL,
                json!({}),
            )]),
        );
    });
    let capture = child.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[CLIENT_BRIEF, PARKED_TOOL_RESULT],
                &[USER_MESSAGE],
            ))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[CHILD_ANSWER]));
    });
    let (state, llm) = delegated_state(row, pool, mocks, |config| {
        gate_mock_mcp_tools_on_approval(row, config)
    })
    .await;
    let (base, server) = serve(&state).await;
    let pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    finish(spawn_parent(
        row,
        &base,
        chat_id,
        ACTION_FACET,
        Some(row.binding()),
    ))
    .await;
    assert_eq!(
        reload(&state.db, chat_id).await.generation_state.as_deref(),
        Some("awaiting_approval")
    );
    let child_chat = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    assert_eq!(
        child_chat.generation_state.as_deref(),
        Some("awaiting_approval")
    );
    let child_turns = turn_bodies(&child);
    assert_eq!(child_turns.len(), 1);
    assert!(offers(&child_turns[0], row.read_tool));
    ParkedChild {
        parent_message_id: assistant_row(&state.db, chat_id).await.id,
        state,
        server,
        _pane: pane,
        _llm: llm,
        child: child_chat,
        recorder: child,
    }
}

/// Approves the parked child's call on the parent's card and returns the
/// child's resumed turn.
async fn approve_and_resume(parked: &ParkedChild) -> Value {
    let continued = app_server(parked.state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "message_id": parked.parent_message_id, "decision": "approve" }))
        .await;
    continued.assert_status_ok();
    assert!(extract_full_text(&parse_sse_events(&continued)).contains(PARENT_FINAL));
    let child_turns = turn_bodies(&parked.recorder);
    assert_eq!(child_turns.len(), 2, "the child resumed once");
    assert!(child_turns[1].to_string().contains(PARKED_TOOL_RESULT));
    child_turns[1].clone()
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_resumed_child_is_offered_its_granted_tool_again(pool: Pool<Postgres>) {
    let row = &fake_host();
    let parked = park_a_client_child(row, pool).await;
    let resumed = approve_and_resume(&parked).await;
    assert!(offers(&resumed, row.read_tool), "{resumed}");
    assert!(!offers(&resumed, WRITE_TOOL));
    parked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_withholds_the_grant_and_the_offer(pool: Pool<Postgres>) {
    let row = &fake_host();
    let parked = park_a_client_child(row, pool.clone()).await;
    erato::models::user_preference::set_client_tool_decision(
        &parked.state.db,
        &account(&parked.state).await,
        &row.qualified(),
        erato::models::user_preference::ClientToolDecision::NeverAllow,
    )
    .await
    .unwrap();
    let resumed = approve_and_resume(&parked).await;
    assert!(
        !offers(&resumed, row.read_tool),
        "Never set while the child was parked"
    );
    parked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_before_the_turn_leaves_nothing_to_grant(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_answers(&mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    erato::models::user_preference::set_client_tool_decision(
        &state.db,
        &account(&state).await,
        &row.qualified(),
        erato::models::user_preference::ClientToolDecision::NeverAllow,
    )
    .await
    .unwrap();
    let (base, server) = serve(&state).await;
    let _pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert!(!offers(&turn_bodies(&parent)[0], row.read_tool));
    assert_no_grant(row, &state, chat_id, &child, NONE_OFFERED).await;
    server.abort();
}

/// Between the parent's offer and its task call, long enough for the test to
/// change the user's decision.
const PLAN_PAUSE: Duration = Duration::from_secs(3);

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_after_the_offer_writes_no_grant(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent_with(
        &mut mocks,
        &parent,
        build_openai_paused_tool_calls_streaming_response(
            "Planning the reads.",
            PLAN_PAUSE,
            &task_calls(vec![client_task(None)]),
        ),
    );
    mock_client_child_answers(&mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let _pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    tokio::time::timeout(Duration::from_secs(15), async {
        while turn_bodies(&parent).is_empty() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the parent's model is asked");
    erato::models::user_preference::set_client_tool_decision(
        &state.db,
        &account(&state).await,
        &row.qualified(),
        erato::models::user_preference::ClientToolDecision::NeverAllow,
    )
    .await
    .unwrap();
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert!(offers(&turn_bodies(&parent)[0], row.read_tool));
    assert_no_grant(row, &state, chat_id, &child, ALL_NEVER).await;
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_adopted_child_is_not_offered_the_granted_tool(pool: Pool<Postgres>) {
    let row = &fake_host();
    let parked = park_a_client_child(row, pool).await;
    // What the user's own first message into the child chat records.
    erato::models::chat::mark_delegated_run_adopted(&parked.state.db, &parked.child)
        .await
        .unwrap();
    let resumed = approve_and_resume(&parked).await;
    assert!(!offers(&resumed, row.read_tool), "{resumed}");
    parked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_regenerate_in_a_finished_client_child_is_not_offered_the_granted_tool(
    pool: Pool<Postgres>,
) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(
        &mut mocks,
        &parent,
        vec![client_task(None), research_task(None)],
    );
    mock_client_child_answers(&mut mocks, &child);
    // Keeps the parent's turn running after the client task has finished.
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[RESEARCH_BRIEF], &[USER_MESSAGE]));
        mock_llm_sse_response(
            then,
            build_openai_delayed_text_streaming_response(
                &[RESEARCH_ANSWER, " and more"],
                Duration::from_secs(4),
            ),
        );
    });
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let _pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    let client_child = wait_child(&state.db, chat_id, CHILD_FACET).await;
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let local_done = state
                .background_tasks
                .get_task(&client_child.id)
                .await
                .is_none_or(|task| task.is_completed());
            let stored_done = reload(&state.db, client_child.id)
                .await
                .generation_state
                .is_some_and(|state| state != "running");
            if local_done && stored_done {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the client task finishes");

    let answer = assistant_row(&state.db, client_child.id).await;
    app_server(state.clone())
        .post("/api/v1beta/me/messages/regeneratestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(
            "X-Erato-Executor",
            serde_json::to_string(&row.binding()).unwrap(),
        )
        .add_header("X-Erato-Client-Tools", row.pane_tools())
        .json(&json!({ "current_message_id": answer.id }))
        .await
        .assert_status_ok();
    assert!(!run.is_finished(), "the owner turn still runs");
    let child_turns = turn_bodies(&child);
    assert_eq!(child_turns.len(), 2);
    assert!(offers(&child_turns[0], row.read_tool));
    assert!(
        !offers(&child_turns[1], row.read_tool),
        "the user's own turn adopts the run"
    );
    assert!(finish(run).await.contains(PARENT_FINAL));
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_retried_client_task_gets_no_grant(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    // A blank answer: the run reads as failed, so it can be retried.
    let capture = child.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[CLIENT_BRIEF], &[USER_MESSAGE]))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[" "]));
    });
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let _pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    finish(spawn_parent(
        row,
        &base,
        chat_id,
        ACTION_FACET,
        Some(row.binding()),
    ))
    .await;
    let failed = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    assert!(task_spec(&failed)["client_grant"].is_object());
    assert!(offers(&turn_bodies(&child)[0], row.read_tool));

    let retried = app_server(state.clone())
        .post(&format!(
            "/api/v1beta/me/chats/{chat_id}/delegated_runs/{}/retry",
            failed.id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(
            "X-Erato-Executor",
            serde_json::to_string(&row.binding()).unwrap(),
        )
        .add_header("X-Erato-Client-Tools", row.pane_tools())
        .json(&json!({"kind": "task"}))
        .await;
    retried.assert_status(http::StatusCode::ACCEPTED);
    let replacement: Uuid = retried.json::<Value>()["child_chat_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(15), async {
        while turn_bodies(&child).len() < 2 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the replacement run asks its model");
    assert!(!offers(&turn_bodies(&child)[1], row.read_tool));
    let replacement = reload(&state.db, replacement).await;
    assert_eq!(
        task_spec(&replacement)["facet_ids"],
        json!([CHILD_FACET]),
        "the replacement is the same client task"
    );
    assert!(task_spec(&replacement).get("client_grant").is_none());
    assert_eq!(
        task_spec(&replacement)["client_task"],
        json!({"host_context": row.host.as_str(), "unavailable": RETRIED})
    );
    server.abort();
}

const CLIENT_BRIEF_2: &str = "SECOND-CLIENT-SENTINEL: read the conclusion";
const CLIENT_TASK_CALL_2: &str = "call_client_task_2";
const PARENT_READ_CALL: &str = "call_parent_read";
const ASK_UNAVAILABLE: &str = "requires user approval, which is unavailable in a delegated run";

fn second_client_task() -> (&'static str, Value) {
    (
        CLIENT_TASK_CALL_2,
        json!({ "task": CLIENT_BRIEF_2, "facet_ids": [CHILD_FACET] }),
    )
}

async fn ask_before_reads(row: &HostRow, state: &erato::state::AppState) {
    erato::models::user_preference::set_client_tool_decision(
        &state.db,
        &account(state).await,
        &row.qualified(),
        erato::models::user_preference::ClientToolDecision::Ask,
    )
    .await
    .unwrap();
}

/// The stop a row ends on.
fn parked_part(row: &erato::db::entity::messages::Model) -> Value {
    let last = row.raw_message["content"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(last["content_type"], "tool_approval_request", "{last}");
    last
}

/// Decides a parked turn over a real connection, without an executor binding,
/// and hands back the full SSE body once the continuation ends.
fn spawn_decision(base: &str, body: Value) -> tokio::task::JoinHandle<String> {
    let request = reqwest::Client::new()
        .post(format!("{base}/me/messages/continuestream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .json(&body);
    tokio::spawn(async move {
        let response = request.send().await.unwrap();
        let status = response.status();
        let mut body = response.bytes_stream();
        let mut received = String::new();
        while let Some(bytes) = body.next().await {
            received.push_str(&String::from_utf8_lossy(&bytes.unwrap()));
        }
        assert!(status.is_success(), "{status}: {received}");
        received
    })
}

async fn wait_parked(db: &sea_orm::DatabaseConnection, chat_id: Uuid) {
    tokio::time::timeout(Duration::from_secs(15), async {
        while reload(db, chat_id).await.generation_state.as_deref() != Some("awaiting_approval") {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the chat parks");
}

/// A parent with one client task whose read asks first, parked on the
/// child's item.
struct AskedChild {
    state: erato::state::AppState,
    base: String,
    server: tokio::task::JoinHandle<()>,
    _llm: MockServer,
    pane: Pane,
    chat_id: Uuid,
    parent_message: erato::db::entity::messages::Model,
    child: chats::Model,
    recorder: RequestBodyRecorder,
}

async fn ask_in_a_client_task(
    row: &HostRow,
    pool: Pool<Postgres>,
    tweak: impl FnOnce(&mut erato::config::AppConfig),
) -> AskedChild {
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_reads(row, &mut mocks, &child);
    let (state, llm) = delegated_state(row, pool, mocks, tweak).await;
    ask_before_reads(row, &state).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    finish(spawn_parent(
        row,
        &base,
        chat_id,
        ACTION_FACET,
        Some(row.binding()),
    ))
    .await;
    assert_eq!(pane.next(Duration::from_millis(300)).await, None);
    assert_eq!(
        reload(&state.db, chat_id).await.generation_state.as_deref(),
        Some("awaiting_approval")
    );
    let child_chat = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    AskedChild {
        parent_message: assistant_row(&state.db, chat_id).await,
        state,
        base,
        server,
        _llm: llm,
        pane,
        chat_id,
        child: child_chat,
        recorder: child,
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_childs_client_tool_ask_shows_one_item_per_child_and_parks_the_parent(
    pool: Pool<Postgres>,
) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(
        &mut mocks,
        &parent,
        vec![client_task(None), second_client_task()],
    );
    mock_client_child_reads(row, &mut mocks, &child);
    mock_client_child_for(
        &mut mocks,
        &child,
        CLIENT_BRIEF_2,
        read_call(row),
        CHILD_READ_CALL,
    );
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    ask_before_reads(row, &state).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    finish(spawn_parent(
        row,
        &base,
        chat_id,
        ACTION_FACET,
        Some(row.binding()),
    ))
    .await;

    assert_eq!(pane.next(Duration::from_millis(500)).await, None);
    assert_eq!(
        reload(&state.db, chat_id).await.generation_state.as_deref(),
        Some("awaiting_approval")
    );
    let parent_message = assistant_row(&state.db, chat_id).await;
    let request = parked_part(&parent_message);
    assert_eq!(request["kind"], "delegated_task");
    let items = request["approvals"].as_array().unwrap();
    assert_eq!(items.len(), 2, "{request}");
    // Items follow the order the children parked, which varies between runs.
    let mut approval_ids: Vec<&str> = items
        .iter()
        .map(|item| item["approval_id"].as_str().unwrap())
        .collect();
    approval_ids.sort();
    let mut expected = [CLIENT_TASK_CALL, CLIENT_TASK_CALL_2]
        .map(|call| generated_tool_call_id(parent_message.id, 1, call));
    expected.sort();
    assert_eq!(approval_ids, expected);
    let mut children = Vec::new();
    for item in items {
        let child = &item["child"];
        assert_eq!(child["kind"], "client_tool", "{item}");
        assert_eq!(child["tool_name"], row.read_tool);
        assert_eq!(child["mcp_server_id"], row.namespace);
        assert_eq!(child["allow_always"], true);
        assert_eq!(child["input"], row.model_input);
        children.push(child["child_chat_id"].as_str().unwrap().to_string());
    }
    children.dedup();
    assert_eq!(children.len(), 2, "one item per child");
    for child in children {
        assert_eq!(
            reload(&state.db, child.parse().unwrap())
                .await
                .generation_state
                .as_deref(),
            Some("awaiting_approval")
        );
    }
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_approved_child_call_reaches_the_pane_under_the_same_grant(pool: Pool<Postgres>) {
    let row = &fake_host();
    let mut asked = ask_in_a_client_task(row, pool, |_| {}).await;
    let decided = spawn_decision(
        &asked.base,
        json!({ "message_id": asked.parent_message.id, "decision": "approve" }),
    );
    let event = asked.pane.call().await;
    let child_row = assistant_row(&asked.state.db, asked.child.id).await;
    assert_eq!(event["chat_id"], json!(asked.child.id));
    assert_eq!(event["message_id"], json!(child_row.id));
    assert_eq!(event["input"], row.dispatched_input());
    assert_eq!(
        event["lineage"],
        lineage(
            row,
            (asked.chat_id, asked.parent_message.id),
            (asked.child.id, &json!(child_row.id))
        )
    );
    answer_call(row, &asked.state, &event).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));

    let read = part_for(
        &assistant_row(&asked.state.db, asked.child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(read["status"], "success", "{read}");
    let child_turns = turn_bodies(&asked.recorder);
    assert_eq!(child_turns.len(), 2);
    assert!(offers(&child_turns[1], row.read_tool));
    assert!(child_turns[1].to_string().contains(PANE_TEXT));
    let slot = part_for(
        &assistant_row(&asked.state.db, asked.chat_id).await,
        CLIENT_TASK_CALL,
    );
    assert_eq!(slot["output"]["status"], "completed", "{slot}");
    assert!(
        slot["output"]["result"]
            .as_str()
            .unwrap()
            .contains(CHILD_ANSWER)
    );
    asked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_denied_child_call_is_declined_and_the_task_result_says_so(pool: Pool<Postgres>) {
    let row = &fake_host();
    let mut asked = ask_in_a_client_task(row, pool, |_| {}).await;
    let decided = spawn_decision(
        &asked.base,
        json!({ "message_id": asked.parent_message.id, "decision": "reject" }),
    );
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert_eq!(asked.pane.next(Duration::from_millis(300)).await, None);

    let read = part_for(
        &assistant_row(&asked.state.db, asked.child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(read["status"], "error");
    assert_eq!(read["output"]["status"], "cancelled", "{read}");
    assert_eq!(read["output"]["reason"], "declined");
    let child_turns = turn_bodies(&asked.recorder);
    assert_eq!(child_turns.len(), 2);
    assert!(
        child_turns[1]
            .to_string()
            .contains("The user declined this call")
    );
    let slot = part_for(
        &assistant_row(&asked.state.db, asked.chat_id).await,
        CLIENT_TASK_CALL,
    );
    assert_eq!(slot["output"]["status"], "completed", "{slot}");
    assert_eq!(slot["output"]["client_tools"], json!({"declined": 1}));
    asked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_child_ask_joins_the_coordinators_own_client_tool_ask(pool: Pool<Postgres>) {
    let row = &fake_host();
    let child = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let (read_tool, parent_read) = (row.read_tool, row.model_input.clone());
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[USER_MESSAGE], &["child_run_id"]));
        let (task_call, task_args) = client_task(None);
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[
                (task_call, "delegate_task", task_args),
                (PARENT_READ_CALL, read_tool, parent_read.clone()),
            ]),
        );
    });
    mock_client_child_reads(row, &mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    ask_before_reads(row, &state).await;
    let (base, server) = serve(&state).await;
    let _pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    finish(spawn_parent(
        row,
        &base,
        chat_id,
        ACTION_FACET,
        Some(row.binding()),
    ))
    .await;

    let parent_message = assistant_row(&state.db, chat_id).await;
    let parts: Vec<&Value> = parent_message.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|part| part["content_type"] == "tool_approval_request")
        .collect();
    assert_eq!(parts.len(), 1, "one stop: {}", parent_message.raw_message);
    let request = parked_part(&parent_message);
    assert_eq!(request["kind"], "client_tool");
    let items = request["approvals"].as_array().unwrap();
    assert_eq!(items.len(), 2, "{request}");
    assert_eq!(
        items[0]["tool_call_id"],
        generated_tool_call_id(parent_message.id, 1, PARENT_READ_CALL)
    );
    assert!(items[0]["child"].is_null());
    assert_eq!(
        items[1]["approval_id"],
        generated_tool_call_id(parent_message.id, 1, CLIENT_TASK_CALL)
    );
    assert_eq!(items[1]["child"]["kind"], "client_tool");
    assert_eq!(items[1]["child"]["tool_name"], row.read_tool);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn always_allow_on_a_client_tool_child_item_is_accepted_under_a_strict_mcp_policy(
    pool: Pool<Postgres>,
) {
    let row = &fake_host();
    let mut asked = ask_in_a_client_task(row, pool, |config| {
        config.mcp_servers_global.approval.enabled = true;
        config.mcp_servers_global.approval.allow_always = false;
    })
    .await;
    let request = parked_part(&asked.parent_message);
    assert_eq!(request["allow_always"], false);
    let approval_id = request["approvals"][0]["approval_id"].clone();
    let decided = spawn_decision(
        &asked.base,
        json!({
            "message_id": asked.parent_message.id,
            "decisions": [{ "approval_id": approval_id, "decision": "approve_always" }],
        }),
    );
    answer_call(row, &asked.state, &asked.pane.call().await).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));

    assert_eq!(
        erato::models::user_preference::find_client_tool_decision(
            &asked.state.db,
            &account(&asked.state).await,
            &row.qualified(),
        )
        .await
        .unwrap(),
        Some(erato::models::user_preference::ClientToolDecision::AlwaysAllow)
    );
    assert_eq!(
        row_count(&asked.state, "user_tool_approval_settings").await,
        0,
        "no MCP setting is written for a client tool"
    );
    asked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_allow_on_a_client_tool_child_item_is_stored_as_the_client_tool_preference(
    pool: Pool<Postgres>,
) {
    let row = &fake_host();
    let mut asked = ask_in_a_client_task(row, pool, |_| {}).await;
    let approval_id = parked_part(&asked.parent_message)["approvals"][0]["approval_id"].clone();
    let decided = spawn_decision(
        &asked.base,
        json!({
            "message_id": asked.parent_message.id,
            "decisions": [{ "approval_id": approval_id, "decision": "reject_always" }],
        }),
    );
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert_eq!(asked.pane.next(Duration::from_millis(300)).await, None);

    assert_eq!(
        erato::models::user_preference::find_client_tool_decision(
            &asked.state.db,
            &account(&asked.state).await,
            &row.qualified(),
        )
        .await
        .unwrap(),
        Some(erato::models::user_preference::ClientToolDecision::NeverAllow)
    );
    assert_eq!(
        row_count(&asked.state, "user_tool_approval_settings").await,
        0,
        "no MCP setting is written for a client tool"
    );
    let slot = part_for(
        &assistant_row(&asked.state.db, asked.chat_id).await,
        CLIENT_TASK_CALL,
    );
    assert_eq!(
        slot["output"]["client_tools"],
        json!({"declined": 1}),
        "{slot}"
    );
    asked.server.abort();
}

/// The read tool keeps its part in replay receipts, so the trace shows it.
fn read_keeps_its_part(row: &HostRow, config: &mut erato::config::AppConfig) {
    let mut tool = row.read_config(false);
    let context_input = row
        .context
        .as_ref()
        .map(|context| format!("$.{}", context.input));
    tool.replay = erato::config::ClientToolReplayConfig {
        mode: erato::config::ClientToolReplayMode::Receipt,
        keep_input_fields: context_input
            .into_iter()
            .chain([row.part.0.to_string()])
            .collect(),
        keep_output_fields: vec!["$.status".into()],
    };
    config.client_tools.tools.insert(READ_KEY.into(), tool);
}

fn assert_freshness_reported(row: &HostRow, slot: &Value) {
    assert_eq!(
        slot["output"]["client_tools"],
        json!({ "freshness": row.freshness }),
        "{slot}"
    );
    let reads: Vec<&Value> = slot["output"]["localTrace"]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|step| step["id"] == row.read_tool)
        .collect();
    assert_eq!(reads.len(), 1, "{slot}");
    assert_eq!(reads[0]["status"], "ok");
    assert_eq!(
        reads[0]["detail"],
        format!(
            "{} · changes: {}",
            row.part.1,
            row.freshness["changes"].as_str().unwrap()
        )
    );
    assert_eq!(reads[0]["counts"], row.freshness["counts"]);
    if let Some(context_ref) = row.context_ref() {
        assert!(
            !slot["output"]["localTrace"]
                .to_string()
                .contains(context_ref)
        );
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn freshness_reaches_the_task_result_and_the_parent_trace(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_reads(row, &mut mocks, &child);
    let (state, _llm) =
        delegated_state(row, pool, mocks, |config| read_keeps_its_part(row, config)).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    answer_call_with(
        row,
        &state,
        &pane.call().await,
        json!({"text": PANE_TEXT, "freshness": row.freshness}),
    )
    .await;
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert_freshness_reported(
        row,
        &part_for(&assistant_row(&state.db, chat_id).await, CLIENT_TASK_CALL),
    );
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn freshness_after_an_approval_reaches_the_task_result_and_the_trace(pool: Pool<Postgres>) {
    let row = &fake_host();
    let mut asked =
        ask_in_a_client_task(row, pool, |config| read_keeps_its_part(row, config)).await;
    let decided = spawn_decision(
        &asked.base,
        json!({ "message_id": asked.parent_message.id, "decision": "approve" }),
    );
    answer_call_with(
        row,
        &asked.state,
        &asked.pane.call().await,
        json!({"text": PANE_TEXT, "freshness": row.freshness}),
    )
    .await;
    assert!(finish(decided).await.contains(PARENT_FINAL));

    assert_freshness_reported(
        row,
        &part_for(
            &assistant_row(&asked.state.db, asked.chat_id).await,
            CLIENT_TASK_CALL,
        ),
    );
    asked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_granted_tool_disappears_once_the_parent_turn_is_over(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child, research) = (
        RequestBodyRecorder::new(),
        RequestBodyRecorder::new(),
        RequestBodyRecorder::new(),
    );
    let mut mocks = MockSet::new();
    mock_parent(
        &mut mocks,
        &parent,
        vec![client_task(None), research_task(None)],
    );
    mock_client_child_reads(row, &mut mocks, &child);
    // Keeps the parent's turn running after the client task has parked.
    let capture = research.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[RESEARCH_BRIEF], &[USER_MESSAGE]))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_delayed_text_streaming_response(
                &[RESEARCH_ANSWER, " and more"],
                Duration::from_secs(4),
            ),
        );
    });
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    ask_before_reads(row, &state).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    let client_child = wait_child(&state.db, chat_id, CHILD_FACET).await;
    wait_parked(&state.db, client_child.id).await;
    let research_child = wait_child(&state.db, chat_id, RESEARCH_FACET).await;
    app_server(state.clone())
        .post("/api/v1beta/me/messages/abortstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "chat_id": chat_id }))
        .await
        .assert_status_ok();
    finish(run).await;
    assert_ne!(
        reload(&state.db, chat_id).await.generation_state.as_deref(),
        Some("awaiting_approval"),
        "a stopped parent carries no card"
    );

    let child_row = assistant_row(&state.db, client_child.id).await;
    let decided = app_server(state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "message_id": child_row.id, "decision": "approve" }))
        .await;
    decided.assert_status_ok();
    assert!(extract_full_text(&parse_sse_events(&decided)).contains(CHILD_ANSWER));

    assert_eq!(pane.next(Duration::from_millis(300)).await, None);
    let read = part_for(
        &assistant_row(&state.db, client_child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(read["status"], "error", "{read}");
    let child_turns = turn_bodies(&child);
    assert_eq!(child_turns.len(), 2);
    assert!(offers(&child_turns[0], row.read_tool));
    assert!(
        !offers(&child_turns[1], row.read_tool),
        "the owner turn no longer runs"
    );
    tokio::time::timeout(Duration::from_secs(15), async {
        while reload(&state.db, research_child.id)
            .await
            .generation_state
            .as_deref()
            == Some("running")
        {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the stopped research task winds down");
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_child_client_ask_is_refused_when_child_approvals_are_off(pool: Pool<Postgres>) {
    let row = &fake_host();
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_reads(row, &mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |config| {
        config.delegation.tasks.propagate_child_mcp_approvals = false;
    })
    .await;
    ask_before_reads(row, &state).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert_eq!(pane.next(Duration::from_millis(300)).await, None);
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    let read = part_for(
        &assistant_row(&state.db, client_child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(read["status"], "error");
    assert!(
        read["output"]["error"]
            .as_str()
            .unwrap()
            .contains(ASK_UNAVAILABLE),
        "{read}"
    );
    for chat in [client_child.id, chat_id] {
        assert_ne!(
            reload(&state.db, chat).await.generation_state.as_deref(),
            Some("awaiting_approval")
        );
    }
    let slot = part_for(&assistant_row(&state.db, chat_id).await, CLIENT_TASK_CALL);
    assert_eq!(slot["output"]["status"], "completed", "{slot}");
    server.abort();
}
