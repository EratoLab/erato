//! Delegated tasks that read through their parent's client tools (ERMAIN-1001).
//! The host is a test-driven Word pane on an executor stream; the parent turn
//! runs on that pane's binding with a captured document snapshot.
use super::attached::serve;
use super::executor_stream::Pane;
use super::*;
use crate::test_utils::build_openai_paused_tool_calls_streaming_response;
use erato::services::client_operations::executor_stream;
use futures::StreamExt;
use sea_orm::ConnectionTrait;

const READ_TOOL: &str = "read_document_blocks";
const READ_QUALIFIED: &str = "word/read_document_blocks";
const WRITE_TOOL: &str = "write_comment";
const PANE_TOOLS: &str = "read_document_blocks,write_comment";
const ACTION_FACET: &str = "word_turn";
/// An action facet whose turns plan tasks but are offered no Word tools.
const PLAIN_ACTION_FACET: &str = "word_plain";
const CHILD_FACET: &str = "word_reader";
const RESEARCH_FACET: &str = "research";
const SNAPSHOT: &str = "SNAPSHOT-TOKEN-7";
const USER_MESSAGE: &str = "Summarise the open document";
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
const NONE_OFFERED: &str = "the turn offered no client tools that tasks may use";
const PANE_NOT_CONNECTED: &str = "the pane is not connected";

fn word_pane() -> ExecutorBinding {
    ExecutorBinding {
        device_id: "word-device".into(),
        realm: ExecutionRealm::OfficeAddin,
        host_context: Some(HostContext {
            kind: "word_document".into(),
            identity: "pane-session-1".into(),
        }),
    }
}

fn read_tool(durable: bool) -> ClientToolConfig {
    ClientToolConfig {
        name: READ_TOOL.into(),
        namespace: Some("word".into()),
        description: "Read blocks of the open document".into(),
        parameters: json!({"type":"object","properties":{
            "snapshot":{"type":"string"},"part":{"type":"string"}}})
        .to_string(),
        timeout_ms: Some(TIMEOUT_MS),
        child_access: erato::config::ClientToolChildAccess::Read,
        host_context: Some(erato::config::ClientToolHostContext::WordDocument),
        child_context_arg: Some("document_snapshot".into()),
        child_context_input: Some("snapshot".into()),
        durable: durable.then_some(erato::config::ClientToolDurableConfig {
            host_context: erato::config::ClientToolHostContext::WordDocument,
            result_schema: None,
            attempt_expiry_secs: 900,
            claim_lease_secs: 90,
        }),
        ..Default::default()
    }
}

fn word_action_facet(tool_call_allowlist: &[&str]) -> ActionFacetConfig {
    ActionFacetConfig {
        display_name: "Word".into(),
        platform: Some("word".into()),
        template: "Work on the open document.".into(),
        allowed_args: vec!["document_snapshot".into()],
        tool_call_allowlist: tool_call_allowlist.iter().map(|s| s.to_string()).collect(),
        delegation: Some(
            serde_json::from_value(json!({ "child_facet_ids": [CHILD_FACET, RESEARCH_FACET] }))
                .unwrap(),
        ),
        ..Default::default()
    }
}

async fn delegated_state(
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
        .insert("word_read_blocks".into(), read_tool(false));
    config.client_tools.tools.insert(
        "word_write_comment".into(),
        ClientToolConfig {
            name: WRITE_TOOL.into(),
            namespace: Some("word".into()),
            description: "Add a comment to the open document".into(),
            parameters: json!({"type":"object"}).to_string(),
            ..Default::default()
        },
    );
    config.facets.facets.insert(
        CHILD_FACET.into(),
        FacetConfig {
            display_name: "Read the open document".into(),
            disable_facet_prompt_template: true,
            child_host_context: Some(erato::config::ClientToolHostContext::WordDocument),
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
        word_action_facet(&["word/*", "erato/delegate_task"]),
    );
    config.action_facets.facets.insert(
        PLAIN_ACTION_FACET.into(),
        word_action_facet(&["erato/delegate_task"]),
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
    let calls: Vec<(String, Value)> = tasks
        .into_iter()
        .map(|(id, args)| (id.to_string(), args))
        .collect();
    let recorder = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[USER_MESSAGE], &["child_run_id"]))
            .matcher(recorder);
        let calls: Vec<(&str, &str, Value)> = calls
            .iter()
            .map(|(id, args)| (id.as_str(), "delegate_task", args.clone()))
            .collect();
        mock_llm_sse_response(then, build_openai_tool_calls_streaming_response(&calls));
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
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[CLIENT_BRIEF],
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
                &[CLIENT_BRIEF, first_call],
                &[USER_MESSAGE],
            ))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[CHILD_ANSWER]));
    });
}

fn read_call(snapshot: &str) -> Vec<mocktail::body::BodyAction> {
    build_openai_tool_calls_streaming_response(&[(
        CHILD_READ_CALL,
        READ_TOOL,
        json!({"snapshot": snapshot, "part": "intro"}),
    )])
}

/// A client child that reads once through the pane and then answers.
fn mock_client_child_reads(mocks: &mut MockSet, recorder: &RequestBodyRecorder) {
    mock_client_child(mocks, recorder, read_call("forged"), CHILD_READ_CALL);
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

async fn open_pane(base: &str) -> Pane {
    Pane::open_serving(base, &word_pane(), PANE_TOOLS, Some(READ_TOOL)).await
}

/// Submits the parent turn over a real connection, as the Word pane does,
/// and hands back its full SSE body once it ends.
fn spawn_parent(
    base: &str,
    chat_id: Uuid,
    action_facet: &str,
    executor: Option<ExecutorBinding>,
) -> tokio::task::JoinHandle<String> {
    let mut request = reqwest::Client::new()
        .post(format!("{base}/me/messages/submitstream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("X-Erato-Platform", "word")
        .header("X-Erato-Client-Tools", PANE_TOOLS)
        .json(&json!({
            "existing_chat_id": chat_id,
            "user_message": USER_MESSAGE,
            "action_facet": { "id": action_facet, "args": { "document_snapshot": SNAPSHOT } },
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
async fn answer_call(state: &erato::state::AppState, event: &Value) {
    let chat_id: Uuid = event["chat_id"].as_str().unwrap().parse().unwrap();
    let call = (
        event["message_id"].as_str().unwrap().parse().unwrap(),
        event["tool_call_id"].as_str().unwrap().to_string(),
    );
    let answered = post_live(
        state,
        chat_id,
        &call,
        json!({"result": {"text": PANE_TEXT}}),
        Some(&word_pane()),
    )
    .await;
    answered.assert_status_ok();
    assert_eq!(answered.json::<Value>()["delivered"], true);
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

async fn account(state: &erato::state::AppState) -> Uuid {
    get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap()
        .id
}

async fn table_rows(state: &erato::state::AppState, table: &str) -> i64 {
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

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn one_turn_grants_the_client_task_and_not_its_sibling(pool: Pool<Postgres>) {
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
    mock_client_child_reads(&mut mocks, &child);
    mock_research_child(&mut mocks, &research);
    let (state, _llm) = delegated_state(pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(&base, chat_id, ACTION_FACET, Some(word_pane()));
    answer_call(&state, &pane.call().await).await;
    assert!(finish(run).await.contains(PARENT_FINAL));

    let parent_message = assistant_row(&state.db, chat_id).await;
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    let grant = &task_spec(&client_child)["client_grant"];
    assert_eq!(grant["tools"], json!([READ_QUALIFIED]));
    assert_eq!(grant["binding"], json!(word_pane()));
    assert_eq!(grant["owner_chat_id"], json!(chat_id));
    assert_eq!(grant["owner_message_id"], json!(parent_message.id));
    assert_eq!(grant["context_ref"], SNAPSHOT);
    assert_eq!(
        task_spec(&client_child)["client_task"],
        json!({"host_context": "word_document"})
    );
    let research_child = child_chat(&state.db, chat_id, RESEARCH_FACET)
        .await
        .unwrap();
    assert!(task_spec(&research_child).get("client_grant").is_none());
    assert!(task_spec(&research_child).get("client_task").is_none());

    let parent_turn = &turn_bodies(&parent)[0];
    assert!(offers(parent_turn, READ_TOOL) && offers(parent_turn, WRITE_TOOL));
    let child_turns = turn_bodies(&child);
    assert_eq!(child_turns.len(), 2);
    assert!(offers(&child_turns[0], READ_TOOL));
    assert!(!offers(&child_turns[0], WRITE_TOOL));
    let research_turns = turn_bodies(&research);
    assert_eq!(research_turns.len(), 1);
    assert!(!offers(&research_turns[0], READ_TOOL));
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
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_reads(&mut mocks, &child);
    let (state, _llm) = delegated_state(pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(&base, chat_id, ACTION_FACET, Some(word_pane()));
    let event = pane.call().await;
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    let parent_message = assistant_row(&state.db, chat_id).await;
    assert_eq!(event["chat_id"], json!(client_child.id));
    assert_eq!(event["tool_name"], READ_TOOL);
    assert_eq!(
        event["input"],
        json!({"snapshot": SNAPSHOT, "part": "intro"}),
        "the grant's context version replaces the one the model sent"
    );
    assert_eq!(
        event["lineage"],
        json!({
            "owner_chat_id": chat_id,
            "owner_message_id": parent_message.id,
            "requesting_chat_id": client_child.id,
            "requesting_message_id": event["message_id"],
            "context_ref": SNAPSHOT,
        })
    );
    answer_call(&state, &event).await;
    assert!(finish(run).await.contains(PARENT_FINAL));

    let child_row = assistant_row(&state.db, client_child.id).await;
    assert_eq!(event["message_id"], json!(child_row.id));
    let read = part_for(&child_row, CHILD_READ_CALL);
    assert_eq!(read["status"], "success", "{read}");
    assert_eq!(
        read["input"]["snapshot"], "forged",
        "the stored call keeps what the model sent"
    );
    let child_turns = turn_bodies(&child);
    assert!(child_turns[1].to_string().contains(PANE_TEXT));
    assert!(
        !child_turns
            .iter()
            .any(|body| body.to_string().contains(SNAPSHOT)),
        "the child's model never sees the context version"
    );
    assert_eq!(table_rows(&state, "client_executor_calls").await, 0);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_child_is_never_offered_a_tool_its_parent_was_not(pool: Pool<Postgres>) {
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_answers(&mut mocks, &child);
    let (state, _llm) = delegated_state(pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let _pane = open_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(&base, chat_id, PLAIN_ACTION_FACET, Some(word_pane()));
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert!(!offers(&turn_bodies(&parent)[0], READ_TOOL));
    let child_turns = turn_bodies(&child);
    assert_eq!(child_turns.len(), 1);
    assert!(!offers(&child_turns[0], READ_TOOL));
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
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child(
        &mut mocks,
        &child,
        build_openai_tool_calls_streaming_response(&[
            ("call_child_write", WRITE_TOOL, json!({"text": "hi"})),
            ("call_child_invented", "delete_document", json!({})),
        ]),
        "call_child_write",
    );
    let (state, _llm) = delegated_state(pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(&base, chat_id, ACTION_FACET, Some(word_pane()));
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert_eq!(pane.next(Duration::from_millis(500)).await, None);
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    let child_row = assistant_row(&state.db, client_child.id).await;
    for (call, tool) in [
        ("call_child_write", WRITE_TOOL),
        ("call_child_invented", "delete_document"),
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
    mock_client_child_reads(&mut mocks, &child);
    mock_research_child(&mut mocks, &research);
    let (state, _llm) = delegated_state(pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(&base, chat_id, ACTION_FACET, Some(word_pane()));
    answer_call(&state, &pane.call().await).await;
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
        json!({"run_mode": "wait (uses the open document)"})
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
        "wait (uses the open document)"
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
    let parent = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    mock_parent(
        &mut mocks,
        &parent,
        vec![client_task(Some("async")), research_task(Some("async"))],
    );
    let (state, _llm) = delegated_state(pool, mocks, |config| {
        config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::AsyncOnly;
    })
    .await;
    let (base, server) = serve(&state).await;
    let chat_id = seed_origin_chat(&state.db).await;
    finish(spawn_parent(
        &base,
        chat_id,
        ACTION_FACET,
        Some(word_pane()),
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
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_answers(&mut mocks, &child);
    let (state, _llm) = delegated_state(pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(&base, chat_id, ACTION_FACET, Some(word_pane()));
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert!(offers(&turn_bodies(&parent)[0], READ_TOOL));
    assert!(!offers(&turn_bodies(&child)[0], READ_TOOL));
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    assert!(task_spec(&client_child).get("client_grant").is_none());
    assert_eq!(
        task_spec(&client_child)["client_task"]["unavailable"],
        PANE_NOT_CONNECTED
    );
    let slot = part_for(&assistant_row(&state.db, chat_id).await, CLIENT_TASK_CALL);
    assert_eq!(
        slot["output"]["client_tools"],
        json!({"unavailable": PANE_NOT_CONNECTED})
    );
    server.abort();
}

/// The child narrates, pauses long enough for the test to close the pane,
/// and then calls the read tool.
const DISPATCH_PAUSE: Duration = Duration::from_secs(6);

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_pane_gone_before_dispatch_is_context_unavailable_at_once(pool: Pool<Postgres>) {
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child(
        &mut mocks,
        &child,
        build_openai_paused_tool_calls_streaming_response(
            "Reading the introduction.",
            DISPATCH_PAUSE,
            &[(
                CHILD_READ_CALL,
                READ_TOOL,
                json!({"snapshot": "forged", "part": "intro"}),
            )],
        ),
        CHILD_READ_CALL,
    );
    let (state, _llm) = delegated_state(pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let pane = open_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(&base, chat_id, ACTION_FACET, Some(word_pane()));
    let client_child = wait_child(&state.db, chat_id, CHILD_FACET).await;
    assert!(task_spec(&client_child)["client_grant"].is_object());
    drop(pane);
    let account = account(&state).await;
    tokio::time::timeout(Duration::from_secs(5), async {
        while executor_stream::present(&state.db, account, &word_pane())
            .await
            .unwrap()
            .is_some()
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("a dropped pane releases its binding");
    let gone = tokio::time::Instant::now();
    assert!(finish(run).await.contains(PARENT_FINAL));
    assert!(
        gone.elapsed() < DISPATCH_PAUSE + Duration::from_secs(5),
        "the call fails at dispatch, not after the presence grace or the timeout: {:?}",
        gone.elapsed()
    );
    let read = part_for(
        &assistant_row(&state.db, client_child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(
        read["output"],
        json!({"status":"cancelled","reason":"context_unavailable"})
    );
    assert_eq!(table_rows(&state, "client_executor_calls").await, 0);
    server.abort();
}

/// Long enough for the pane to receive the call, short enough that a durable
/// escalation would happen inside the test.
const UNANSWERED_TIMEOUT_MS: u64 = 1_500;

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_child_call_never_waits_for_the_inbox_even_for_a_durable_tool(pool: Pool<Postgres>) {
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_reads(&mut mocks, &child);
    let (state, _llm) = delegated_state(pool, mocks, |config| {
        config.client_tools.durable_operations_enabled = true;
        let mut tool = read_tool(true);
        tool.timeout_ms = Some(UNANSWERED_TIMEOUT_MS);
        config
            .client_tools
            .tools
            .insert("word_read_blocks".into(), tool);
    })
    .await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(&base, chat_id, ACTION_FACET, Some(word_pane()));
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
    assert_eq!(table_rows(&state, "client_operation_attempts").await, 0);
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
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_reads(&mut mocks, &child);
    let (state, _llm) = delegated_state(pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    // Held by a replica that died: nothing renews or releases it.
    let tools = vec![READ_TOOL.to_string(), WRITE_TOOL.to_string()];
    assert!(
        executor_stream::acquire(
            &state.db,
            account(&state).await,
            &word_pane(),
            Uuid::new_v4(),
            &tools,
            &[READ_TOOL.to_string()],
        )
        .await
        .unwrap()
    );
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(&base, chat_id, ACTION_FACET, Some(word_pane()));
    tokio::time::timeout(Duration::from_secs(15), async {
        while table_rows(&state, "client_executor_calls").await == 0 {
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
    assert_eq!(table_rows(&state, "client_executor_calls").await, 0);
    server.abort();
}

/// The gated MCP tool a child reaches; open-world, so the restrictive preset
/// asks about it.
const PARKED_TOOL: &str = "publish_approval_probe";
const PARKED_TOOL_RESULT: &str = "approval probe published";
const CHILD_PARKED_CALL: &str = "call_child_probe";

fn gate_mock_mcp_tools_on_approval(config: &mut erato::config::AppConfig) {
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
        word_action_facet(&["word/*", "erato/delegate_task", "mock_mcp_approval/*"]),
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
async fn park_a_client_child(pool: Pool<Postgres>) -> ParkedChild {
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
    let (state, llm) = delegated_state(pool, mocks, gate_mock_mcp_tools_on_approval).await;
    let (base, server) = serve(&state).await;
    let pane = open_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    finish(spawn_parent(
        &base,
        chat_id,
        ACTION_FACET,
        Some(word_pane()),
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
    assert!(offers(&child_turns[0], READ_TOOL));
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
    let parked = park_a_client_child(pool).await;
    let resumed = approve_and_resume(&parked).await;
    assert!(offers(&resumed, READ_TOOL), "{resumed}");
    assert!(!offers(&resumed, WRITE_TOOL));
    parked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_withholds_the_grant_and_the_offer(pool: Pool<Postgres>) {
    let parked = park_a_client_child(pool.clone()).await;
    erato::models::user_preference::set_client_tool_decision(
        &parked.state.db,
        &account(&parked.state).await,
        READ_QUALIFIED,
        erato::models::user_preference::ClientToolDecision::NeverAllow,
    )
    .await
    .unwrap();
    let resumed = approve_and_resume(&parked).await;
    assert!(
        !offers(&resumed, READ_TOOL),
        "Never set while the child was parked"
    );
    parked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_before_launch_writes_no_grant(pool: Pool<Postgres>) {
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_answers(&mut mocks, &child);
    let (state, _llm) = delegated_state(pool, mocks, |_| {}).await;
    erato::models::user_preference::set_client_tool_decision(
        &state.db,
        &account(&state).await,
        READ_QUALIFIED,
        erato::models::user_preference::ClientToolDecision::NeverAllow,
    )
    .await
    .unwrap();
    let (base, server) = serve(&state).await;
    let _pane = open_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(&base, chat_id, ACTION_FACET, Some(word_pane()));
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert!(!offers(&turn_bodies(&parent)[0], READ_TOOL));
    assert!(!offers(&turn_bodies(&child)[0], READ_TOOL));
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    assert!(task_spec(&client_child).get("client_grant").is_none());
    assert_eq!(
        task_spec(&client_child)["client_task"]["unavailable"],
        NONE_OFFERED
    );
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_adopted_child_is_not_offered_the_granted_tool(pool: Pool<Postgres>) {
    let parked = park_a_client_child(pool).await;
    // What the user's own first message into the child chat records.
    erato::models::chat::mark_delegated_run_adopted(&parked.state.db, &parked.child)
        .await
        .unwrap();
    let resumed = approve_and_resume(&parked).await;
    assert!(!offers(&resumed, READ_TOOL), "{resumed}");
    parked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_retried_client_task_gets_no_grant(pool: Pool<Postgres>) {
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
    let (state, _llm) = delegated_state(pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let _pane = open_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    finish(spawn_parent(
        &base,
        chat_id,
        ACTION_FACET,
        Some(word_pane()),
    ))
    .await;
    let failed = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    assert!(task_spec(&failed)["client_grant"].is_object());
    assert!(offers(&turn_bodies(&child)[0], READ_TOOL));

    let retried = app_server(state.clone())
        .post(&format!(
            "/api/v1beta/me/chats/{chat_id}/delegated_runs/{}/retry",
            failed.id
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header(
            "X-Erato-Executor",
            serde_json::to_string(&word_pane()).unwrap(),
        )
        .add_header("X-Erato-Client-Tools", PANE_TOOLS)
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
    assert!(!offers(&turn_bodies(&child)[1], READ_TOOL));
    let replacement = reload(&state.db, replacement).await;
    assert_eq!(
        task_spec(&replacement)["facet_ids"],
        json!([CHILD_FACET]),
        "the replacement is the same client task"
    );
    assert!(task_spec(&replacement).get("client_grant").is_none());
    assert!(task_spec(&replacement).get("client_task").is_none());
    server.abort();
}
