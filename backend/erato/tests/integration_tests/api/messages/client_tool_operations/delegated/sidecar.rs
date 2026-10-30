//! The desktop sidecar as a host of delegated tasks (ERMAIN-1034). Its binding
//! travels in `X-Erato-Additional-Executors`, beside the shell's Office binding
//! in an add-in and alone in the web app, and each client tool is routed to the
//! binding of its host.
use super::super::attached::next_call;
use super::rows::{desktop_sidecar, desktop_sidecar_web, office_primary};
use super::slow_path::{
    Waiting, attempt_row, child_for, claim_token, continue_operation, pane_result,
    park_a_waiting_child, post_result, record_parent_resumes, task_result_in, wait_answered,
};
use super::*;
use crate::test_utils::build_openai_paused_tool_calls_streaming_response;
use erato::config::{ClientToolChildAccess, ClientToolHostContext};
use sea_orm::ConnectionTrait;

const OFFICE_KEY: &str = "office_read";
const OFFICE_TOOL: &str = "fetch_availability";
const OFFICE_FACET: &str = "office_reader";
const OFFICE_BRIEF: &str = "OFFICE-BRIEF-SENTINEL: read the calendar";
const OFFICE_TASK_CALL: &str = "call_office_task";
const OFFICE_READ_CALL: &str = "call_office_read";
const OFFICE_TEXT: &str = "OFFICE-RESULT-SENTINEL";
const PARENT_READ_CALL: &str = "call_parent_read";
const PARENT_SECOND_READ_CALL: &str = "call_parent_second_read";
const NARRATION: &str = "Reading the next part.";
/// Between the parent's narration and its second read: long enough to move
/// the turn's stream to another connection.
const HANDOVER_PAUSE: Duration = Duration::from_secs(5);

/// The coverage a sidecar search reports beside its hits.
fn search_result(hits: &str) -> Value {
    json!({
        "hits": [{"documentId": "8f1d4c52-6f0e-4d7a-9a51-3b2f2f6c0a11", "title": hits}],
        "coverage": {"v": 1, "status": "complete", "sources": [{
            "sourceId": "2b7c2d0e-3f5c-4f63-a6f8-7a1c9b0e5d21",
            "from": "2024-07-01T00:00:00Z", "to": "2024-10-01T00:00:00Z",
            "status": "complete", "observedAt": null, "pendingNewer": null,
            "through": null, "unavailableReason": null}]},
        "freshness": desktop_sidecar().freshness,
    })
}

/// The freshness a task result carries for a sidecar read: the contract's
/// keys only, never the scope signal.
fn reported_freshness() -> Value {
    desktop_sidecar().freshness
}

/// An Outlook read beside the sidecar's, served by the shell's Office
/// binding, and a child facet for tasks that use it.
fn add_office_host(config: &mut erato::config::AppConfig) {
    config.client_tools.tools.insert(
        OFFICE_KEY.into(),
        ClientToolConfig {
            name: OFFICE_TOOL.into(),
            namespace: Some("outlook".into()),
            description: "Read the mailbox free/busy".into(),
            parameters: json!({"type": "object", "properties": {
                "lookahead_days": {"type": "integer"}}})
            .to_string(),
            timeout_ms: Some(TIMEOUT_MS),
            child_access: ClientToolChildAccess::Read,
            host_context: Some(ClientToolHostContext::OutlookMailbox),
            ..Default::default()
        },
    );
    config.facets.facets.insert(
        OFFICE_FACET.into(),
        FacetConfig {
            display_name: "Read the mailbox".into(),
            disable_facet_prompt_template: true,
            child_host_context: Some(ClientToolHostContext::OutlookMailbox),
            ..Default::default()
        },
    );
    let facet = config.action_facets.facets.get_mut(ACTION_FACET).unwrap();
    facet.tool_call_allowlist.push("outlook/*".into());
    facet.delegation = Some(
        serde_json::from_value(json!({ "child_facet_ids": [CHILD_FACET, OFFICE_FACET] })).unwrap(),
    );
}

fn office_task() -> (&'static str, Value) {
    (
        OFFICE_TASK_CALL,
        json!({ "task": OFFICE_BRIEF, "facet_ids": [OFFICE_FACET] }),
    )
}

/// A parent turn sent by an Outlook add-in shell, with `with_sidecar` saying
/// whether the shell also sends the sidecar binding.
fn spawn_shell_turn(
    row: &HostRow,
    base: &str,
    chat_id: Uuid,
    with_sidecar: bool,
) -> tokio::task::JoinHandle<String> {
    spawn_parent_registering(
        row,
        base,
        chat_id,
        ACTION_FACET,
        with_sidecar.then(|| row.binding()),
        &format!("{},{OFFICE_TOOL}", row.pane_tools()),
    )
}

async fn answer_office_call(state: &erato::state::AppState, event: &Value) {
    let answered = post_live(
        state,
        event["chat_id"].as_str().unwrap().parse().unwrap(),
        &(
            event["message_id"].as_str().unwrap().parse().unwrap(),
            event["tool_call_id"].as_str().unwrap().to_string(),
        ),
        json!({ "result": {"text": OFFICE_TEXT} }),
        Some(&office_primary()),
    )
    .await;
    answered.assert_status_ok();
    assert_eq!(answered.json::<Value>()["delivered"], true);
}

fn office_read_call() -> Vec<mocktail::body::BodyAction> {
    build_openai_tool_calls_streaming_response(&[(
        OFFICE_READ_CALL,
        OFFICE_TOOL,
        json!({"lookahead_days": 7}),
    )])
}

async fn open_office_pane(base: &str) -> Pane {
    Pane::open_serving(base, &office_primary(), OFFICE_TOOL, Some(OFFICE_TOOL)).await
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_sidecar_task_gets_its_grant_beside_an_office_binding(pool: Pool<Postgres>) {
    let row = &desktop_sidecar();
    let (parent, child, office_child) = (
        RequestBodyRecorder::new(),
        RequestBodyRecorder::new(),
        RequestBodyRecorder::new(),
    );
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None), office_task()]);
    mock_client_child_reads(row, &mut mocks, &child);
    mock_client_child_for(
        &mut mocks,
        &office_child,
        OFFICE_BRIEF,
        office_read_call(),
        OFFICE_READ_CALL,
    );
    let (state, _llm) = delegated_state(row, pool, mocks, add_office_host).await;
    let (base, server) = serve(&state).await;
    let mut sidecar_pane = open_pane(row, &base).await;
    let mut office_pane = open_office_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_shell_turn(row, &base, chat_id, true);
    let sidecar_call = sidecar_pane.call().await;
    let office_call = office_pane.call().await;
    let sidecar_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    let office_child_chat = child_chat(&state.db, chat_id, OFFICE_FACET).await.unwrap();
    assert_eq!(sidecar_call["tool_name"], row.read_tool);
    assert_eq!(sidecar_call["chat_id"], json!(sidecar_child.id));
    assert_eq!(office_call["tool_name"], OFFICE_TOOL);
    assert_eq!(office_call["chat_id"], json!(office_child_chat.id));
    answer_call(row, &state, &sidecar_call).await;
    answer_office_call(&state, &office_call).await;
    assert!(finish(run).await.contains(PARENT_FINAL));

    let grant = &task_spec(&sidecar_child)["client_grant"];
    assert_eq!(grant["binding"], json!(row.binding()), "{grant}");
    assert_eq!(grant["tools"], json!([row.qualified()]));
    let office_grant = &task_spec(&office_child_chat)["client_grant"];
    assert_eq!(office_grant["binding"], json!(office_primary()));
    assert_eq!(
        office_grant["tools"],
        json!([format!("outlook/{OFFICE_TOOL}")])
    );
    let child_turns = turn_bodies(&child);
    assert!(offers(&child_turns[0], row.read_tool));
    assert!(!offers(&child_turns[0], OFFICE_TOOL));
    assert!(child_turns[1].to_string().contains(PANE_TEXT));
    let office_turns = turn_bodies(&office_child);
    assert!(offers(&office_turns[0], OFFICE_TOOL));
    assert!(!offers(&office_turns[0], row.read_tool));
    assert!(office_turns[1].to_string().contains(OFFICE_TEXT));
    assert_eq!(sidecar_pane.next(Duration::from_millis(300)).await, None);
    assert_eq!(office_pane.next(Duration::from_millis(300)).await, None);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn without_the_additional_header_a_sidecar_task_gets_no_grant(pool: Pool<Postgres>) {
    let row = &desktop_sidecar();
    let (parent, child, office_child) = (
        RequestBodyRecorder::new(),
        RequestBodyRecorder::new(),
        RequestBodyRecorder::new(),
    );
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None), office_task()]);
    mock_client_child_answers(&mut mocks, &child);
    mock_client_child_for(
        &mut mocks,
        &office_child,
        OFFICE_BRIEF,
        office_read_call(),
        OFFICE_READ_CALL,
    );
    let (state, _llm) = delegated_state(row, pool, mocks, add_office_host).await;
    let (base, server) = serve(&state).await;
    let mut sidecar_pane = open_pane(row, &base).await;
    let mut office_pane = open_office_pane(&base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    // A shell from before ERMAIN-1034: its Office binding only.
    let run = spawn_shell_turn(row, &base, chat_id, false);
    answer_office_call(&state, &office_pane.call().await).await;
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert_no_grant(row, &state, chat_id, &child, NOT_FROM_HOST).await;
    let office_child_chat = child_chat(&state.db, chat_id, OFFICE_FACET).await.unwrap();
    let office_grant = &task_spec(&office_child_chat)["client_grant"];
    assert_eq!(office_grant["binding"], json!(office_primary()));
    assert_eq!(
        office_grant["tools"],
        json!([format!("outlook/{OFFICE_TOOL}")])
    );
    assert_eq!(sidecar_pane.next(Duration::from_millis(300)).await, None);
    server.abort();
}

/// The parent's own reads of the sidecar tool, one per turn, and its answer
/// once the last is back. A read after the first comes `pause` after the
/// model's narration.
fn mock_parent_reads(mocks: &mut MockSet, row: &HostRow, reads: &[&'static str], pause: Duration) {
    for (index, call) in reads.iter().copied().enumerate() {
        let previous: Vec<&'static str> = index
            .checked_sub(1)
            .map(|previous| reads[previous])
            .into_iter()
            .collect();
        let calls = [(call, row.read_tool, row.model_input.clone())];
        let response = if index == 0 || pause.is_zero() {
            build_openai_tool_calls_streaming_response(&calls)
        } else {
            build_openai_paused_tool_calls_streaming_response(NARRATION, pause, &calls)
        };
        mocks.mock(move |when, then| {
            let mut included = vec![USER_MESSAGE];
            included.extend(previous.iter().copied());
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&included, &[call]));
            mock_llm_sse_response(then, response.clone());
        });
    }
    let last = *reads.last().unwrap();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[USER_MESSAGE, last], &[]));
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[PARENT_FINAL]));
    });
}

/// The sidecar read waits durably for the parent's own calls.
fn durable_own_read(row: &HostRow, timeout_ms: u64) -> impl FnOnce(&mut erato::config::AppConfig) {
    let mut tool = row.read_config(true, None, erato::config::ClientToolApprovalScope::Call);
    tool.timeout_ms = Some(timeout_ms);
    move |config| {
        config.client_tools.durable_operations_enabled = true;
        config.client_tools.tools.insert(READ_KEY.into(), tool);
    }
}

async fn chat_attempts_of(state: &erato::state::AppState, chat_id: Uuid) -> Vec<attempts::Model> {
    attempts::Entity::find()
        .filter(attempts::Column::ChatId.eq(chat_id))
        .all(&state.db)
        .await
        .unwrap()
}

/// Approves the parent's own asked read with the given executor headers and
/// waits for the continuation to end.
async fn approve_own_read(
    row: &HostRow,
    state: &erato::state::AppState,
    chat_id: Uuid,
    executor: Option<&ExecutorBinding>,
) {
    let message = assistant_row(&state.db, chat_id).await;
    let card = parked_part(&message);
    assert_eq!(card["kind"], "client_tool", "{card}");
    let mut request = app_server(state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", row.pane_tools());
    for (name, value) in row.executor_headers(executor) {
        request = request.add_header(name, value);
    }
    tokio::time::timeout(
        Duration::from_secs(20),
        request.json(&json!({
            "message_id": message.id,
            "decisions": [{"approval_id": card["approvals"][0]["approval_id"], "decision": "approve"}],
        })),
    )
    .await
    .expect("the continuation ends")
    .assert_status_ok();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_approval_in_the_same_shell_keeps_a_sidecar_tool_durable(pool: Pool<Postgres>) {
    approval_in_the_same_shell_keeps_a_sidecar_tool_durable(&desktop_sidecar(), pool).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_approval_in_the_web_app_keeps_a_sidecar_tool_durable(pool: Pool<Postgres>) {
    approval_in_the_same_shell_keeps_a_sidecar_tool_durable(&desktop_sidecar_web(), pool).await;
}

async fn approval_in_the_same_shell_keeps_a_sidecar_tool_durable(
    row: &HostRow,
    pool: Pool<Postgres>,
) {
    let mut mocks = MockSet::new();
    mock_parent_reads(&mut mocks, row, &[PARENT_READ_CALL], Duration::ZERO);
    let (state, _llm) = delegated_state(row, pool, mocks, durable_own_read(row, 10)).await;
    ask_before_reads(row, &state).await;
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
    assert!(chat_attempts_of(&state, chat_id).await.is_empty());
    approve_own_read(row, &state, chat_id, Some(&row.binding())).await;
    let parked = chat_attempts_of(&state, chat_id).await;
    assert_eq!(parked.len(), 1, "the approved call parks durably");
    let request: OperationRequest = serde_json::from_value(parked[0].request.clone()).unwrap();
    assert_eq!(request.binding, row.binding());
    assert_eq!(request.consent, ConsentPolicy::None);
    assert!(request.lineage.is_none());

    // A shell that sends no sidecar binding answered for another device.
    let legacy = seed_origin_chat(&state.db).await;
    finish(spawn_parent(
        row,
        &base,
        legacy,
        ACTION_FACET,
        Some(row.binding()),
    ))
    .await;
    approve_own_read(row, &state, legacy, None).await;
    assert!(chat_attempts_of(&state, legacy).await.is_empty());
    let read = part_for(&assistant_row(&state.db, legacy).await, PARENT_READ_CALL);
    assert_eq!(
        read["output"],
        json!({"status": "cancelled", "reason": "timeout"})
    );
    server.abort();
}

/// Reads the stream until the model has started narrating.
async fn narrated<S, B>(stream: &mut S)
where
    S: futures::Stream<Item = Result<B, reqwest::Error>> + Unpin,
    B: AsRef<[u8]>,
{
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut received = String::new();
        while let Some(bytes) = stream.next().await {
            received.push_str(&String::from_utf8_lossy(bytes.unwrap().as_ref()));
            if received.contains(NARRATION) {
                return;
            }
        }
        panic!("the stream ended before the narration: {received}");
    })
    .await
    .expect("the narration");
}

/// The client call for the provider's `call` on a stream that may first
/// replay earlier calls.
async fn call_named<S, B>(stream: &mut S, call: &str) -> (Uuid, String)
where
    S: futures::Stream<Item = Result<B, reqwest::Error>> + Unpin,
    B: AsRef<[u8]>,
{
    let suffix = format!(":{call}");
    tokio::time::timeout(Duration::from_secs(15), async {
        let mut buffer = String::new();
        while let Some(bytes) = stream.next().await {
            buffer.push_str(&String::from_utf8_lossy(bytes.unwrap().as_ref()));
            while let Some(end) = buffer.find("\n\n") {
                let block: String = buffer.drain(..end + 2).collect();
                let Some(event) = block
                    .lines()
                    .filter_map(|line| line.strip_prefix("data:"))
                    .find_map(|data| serde_json::from_str::<Value>(data.trim()).ok())
                else {
                    continue;
                };
                if event["message_type"] == "client_tool_call"
                    && event["tool_call_id"]
                        .as_str()
                        .is_some_and(|id| id.ends_with(&suffix))
                {
                    return (
                        event["message_id"].as_str().unwrap().parse().unwrap(),
                        event["tool_call_id"].as_str().unwrap().into(),
                    );
                }
            }
        }
        panic!("the stream ended without the call {call}: {buffer}");
    })
    .await
    .expect("the client call")
}

fn resume_request(
    base: &str,
    row: &HostRow,
    chat_id: Uuid,
    executor: Option<&ExecutorBinding>,
) -> reqwest::RequestBuilder {
    let mut request = reqwest::Client::new()
        .post(format!("{base}/me/messages/resumestream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("Accept", "text/event-stream")
        .header("X-Erato-Client-Tools", row.pane_tools())
        .json(&json!({ "chat_id": chat_id }));
    for (name, value) in row.executor_headers(executor) {
        request = request.header(name, value);
    }
    request
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_resumed_stream_reattaches_with_the_sidecar_binding(pool: Pool<Postgres>) {
    resumed_stream_reattaches_with_the_sidecar_binding(&desktop_sidecar(), pool).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_resumed_stream_in_the_web_app_reattaches_with_the_sidecar_binding(pool: Pool<Postgres>) {
    resumed_stream_reattaches_with_the_sidecar_binding(&desktop_sidecar_web(), pool).await;
}

async fn resumed_stream_reattaches_with_the_sidecar_binding(row: &HostRow, pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_parent_reads(
        &mut mocks,
        row,
        &[PARENT_READ_CALL, PARENT_SECOND_READ_CALL],
        HANDOVER_PAUSE,
    );
    let (state, _llm) = delegated_state(row, pool, mocks, durable_own_read(row, TIMEOUT_MS)).await;
    let (base, server) = serve(&state).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let mut submit = reqwest::Client::new()
        .post(format!("{base}/me/messages/submitstream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("Accept", "text/event-stream")
        .header("X-Erato-Platform", row.platform)
        .header("X-Erato-Client-Tools", row.pane_tools())
        .json(&json!({
            "existing_chat_id": chat_id,
            "user_message": USER_MESSAGE,
            "action_facet": { "id": ACTION_FACET, "args": row.turn_action_args() },
        }));
    for (name, value) in row.executor_headers(Some(&row.binding())) {
        submit = submit.header(name, value);
    }
    let response = submit.send().await.unwrap();
    assert!(response.status().is_success());
    let mut original = response.bytes_stream();
    let first = next_call(&mut original).await;
    let task = state.background_tasks.get_task(&chat_id).await.unwrap();
    assert!(
        matches!(
            transport::owner(&state.db, task.generation_id)
                .await
                .unwrap(),
            Some(Some(_))
        ),
        "the submitting stream holds the sidecar tool's transport"
    );
    post_live(
        &state,
        chat_id,
        &first,
        json!({ "result": {"text": PANE_TEXT, "freshness": row.freshness} }),
        Some(&row.binding()),
    )
    .await
    .assert_status_ok();
    // The second read comes after a pause, while the stream changes hands.
    narrated(&mut original).await;
    drop(original);
    tokio::time::timeout(Duration::from_secs(5), async {
        while transport::owner(&state.db, task.generation_id)
            .await
            .unwrap()
            != Some(None)
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the dropped stream releases the transport");

    let legacy = resume_request(&base, row, chat_id, None)
        .send()
        .await
        .unwrap();
    assert!(legacy.status().is_success());
    assert_eq!(
        transport::owner(&state.db, task.generation_id)
            .await
            .unwrap(),
        Some(None),
        "a reconnect without the sidecar binding cannot take the sidecar tool's transport"
    );
    drop(legacy);

    let response = resume_request(&base, row, chat_id, Some(&row.binding()))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    assert!(
        matches!(
            transport::owner(&state.db, task.generation_id)
                .await
                .unwrap(),
            Some(Some(_))
        ),
        "the reconnect with the sidecar binding takes the transport"
    );
    let mut resumed = response.bytes_stream();
    let second = call_named(&mut resumed, PARENT_SECOND_READ_CALL).await;
    let answered = post_live(
        &state,
        chat_id,
        &second,
        json!({ "result": {"text": PANE_TEXT} }),
        Some(&row.binding()),
    )
    .await;
    answered.assert_status_ok();
    assert_eq!(answered.json::<Value>()["delivered"], true);
    tokio::time::timeout(Duration::from_secs(15), async {
        while reload(&state.db, chat_id).await.generation_state.as_deref() != Some("completed") {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the turn finishes on the resumed stream");
    assert!(chat_attempts_of(&state, chat_id).await.is_empty());
    let message = assistant_row(&state.db, chat_id).await;
    assert!(message.raw_message.to_string().contains(PARENT_FINAL));
    server.abort();
}

const SEARCH_FACET: &str = "desktop_local";
const BRIEF_A: &str = "PERSON-A-SENTINEL: what Anna wrote about the contract in Q3 2024";
const BRIEF_B: &str = "PERSON-B-SENTINEL: what Ben wrote about the contract in Q3 2024";
const TASK_A_CALL: &str = "call_task_a";
const TASK_B_CALL: &str = "call_task_b";
const SEARCH_A_CALL: &str = "call_search_a";
const SEARCH_B_CALL: &str = "call_search_b";
const ANSWER_A: &str = "ANSWER-A-SENTINEL";
const ANSWER_B: &str = "ANSWER-B-SENTINEL";

/// A sidecar task that searches its part once and then answers `answer`;
/// `answering` records the turn that reads the search result.
fn mock_searching_child(
    mocks: &mut MockSet,
    brief: &'static str,
    call: &'static str,
    input: Value,
    answer: &'static str,
    answering: &RequestBodyRecorder,
) {
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[brief], &[USER_MESSAGE, call]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                call,
                "search_sidecar_index",
                input.clone(),
            )]),
        );
    });
    let capture = answering.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[brief, call], &[USER_MESSAGE]))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[answer]));
    });
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn two_sidecar_tasks_search_their_parts_and_the_parent_receives_both(pool: Pool<Postgres>) {
    let row = &desktop_sidecar();
    let (planning, resumed) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let (answering_a, answering_b) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    let capture = planning.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[USER_MESSAGE], &["child_run_id"]))
            .matcher(capture);
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&task_calls(vec![
                (
                    TASK_A_CALL,
                    json!({ "task": BRIEF_A, "facet_ids": [CHILD_FACET] }),
                ),
                (
                    TASK_B_CALL,
                    json!({ "task": BRIEF_B, "facet_ids": [CHILD_FACET] }),
                ),
            ])),
        );
    });
    let capture = resumed.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[USER_MESSAGE, "child_run_id"],
                &[],
            ))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[PARENT_FINAL]));
    });
    let quarter = json!({"dateFrom": 1719792000, "dateTo": 1727740800});
    mock_searching_child(
        &mut mocks,
        BRIEF_A,
        SEARCH_A_CALL,
        json!({"text": "contract Anna", "filters": quarter}),
        ANSWER_A,
        &answering_a,
    );
    mock_searching_child(
        &mut mocks,
        BRIEF_B,
        SEARCH_B_CALL,
        json!({"text": "contract Ben", "filters": quarter}),
        ANSWER_B,
        &answering_b,
    );
    let (state, _llm) = delegated_state(row, pool, mocks, |config| {
        // A regular facet, as the overlay's desktop_local is.
        config.facets.facets.insert(
            SEARCH_FACET.into(),
            FacetConfig {
                display_name: "Search this device".into(),
                disable_facet_prompt_template: true,
                tool_call_allowlist: vec![host_tools(row), "erato/delegate_task".into()],
                delegation: Some(
                    serde_json::from_value(json!({
                        "child_facet_ids": [CHILD_FACET],
                        "run_modes": ["wait"],
                    }))
                    .unwrap(),
                ),
                ..Default::default()
            },
        );
    })
    .await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_submit(
        &base,
        row.platform,
        &row.pane_tools(),
        row.executor_headers(Some(&row.binding())),
        json!({
            "existing_chat_id": chat_id,
            "user_message": USER_MESSAGE,
            "selected_facet_ids": [SEARCH_FACET],
        }),
    );
    for _ in 0..2 {
        let event = pane.call().await;
        assert_eq!(event["tool_name"], row.read_tool);
        assert_eq!(event["input"]["filters"], quarter, "{event}");
        answer_call_with(row, &state, &event, search_result("Contract draft")).await;
    }
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert!(offers(&turn_bodies(&planning)[0], row.read_tool));
    for call in [TASK_A_CALL, TASK_B_CALL] {
        let child = child_for(&state, chat_id, call).await;
        assert_eq!(
            task_spec(&child)["client_grant"]["binding"],
            json!(row.binding())
        );
    }
    // Each task's model reads the period its search covered, the one it is
    // asked to report.
    for answering in [&answering_a, &answering_b] {
        let turns = turn_bodies(answering);
        assert_eq!(turns.len(), 1);
        let read = turns[0].to_string();
        assert!(
            read.contains("2024-07-01T00:00:00Z") && read.contains("2024-10-01T00:00:00Z"),
            "{read}"
        );
    }
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "the parent continues once");
    for (call, answer) in [(TASK_A_CALL, ANSWER_A), (TASK_B_CALL, ANSWER_B)] {
        let told = task_result_in(&parent_turns[0], call);
        assert!(told.to_string().contains(answer), "{told}");
        assert_eq!(
            told["client_tools"],
            json!({"freshness": reported_freshness()}),
            "{told}"
        );
    }
    server.abort();
}

const DOCUMENT_ID: &str = "8f1d4c52-6f0e-4d7a-9a51-3b2f2f6c0a11";
const DOCUMENT_TEXT: &str = "DOCUMENT-FILE-SENTINEL: minutes of the contract call";

/// The overlay's `get_sidecar_document`, the read that returns a file.
fn document_row() -> HostRow {
    HostRow {
        read_tool: "get_sidecar_document",
        read_parameters: json!({"type": "object", "properties": {
            "documentId": {"type": "string", "format": "uuid"},
            "subject_scope": {"type": "string", "enum": ["subject", "subject_with_thread"]}},
            "required": ["documentId"],
            "additionalProperties": false}),
        model_input: json!({"documentId": DOCUMENT_ID}),
        part: ("$.documentId", DOCUMENT_ID),
        ..desktop_sidecar()
    }
}

async fn upload_into(state: &erato::state::AppState, chat_id: Uuid, text: &str) -> Uuid {
    use axum_test::multipart::{MultipartForm, Part};
    let response = app_server(state.clone())
        .post(&format!("/api/v1beta/me/files?chat_id={chat_id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .multipart(
            MultipartForm::new().add_part(
                "file",
                Part::bytes(text.as_bytes().to_vec())
                    .file_name("minutes.eml.txt")
                    .mime_type("text/plain"),
            ),
        )
        .await;
    response.assert_status_ok();
    Uuid::parse_str(response.json::<Value>()["files"][0]["id"].as_str().unwrap()).unwrap()
}

/// The tool's own value for the document read, with its scope signal.
fn document_value(row: &HostRow) -> Value {
    let mut freshness = row.freshness.clone();
    freshness["scope"] = json!({
        "kind": "document", "id": format!("doc:{DOCUMENT_ID}"),
        "position": "unknown", "added": "unknown",
    });
    json!({"documentId": DOCUMENT_ID, "fileName": "minutes.eml", "freshness": freshness})
}

/// The device answers a task's document read before the tool's timeout, as
/// where the read stays live: the file reaches the task, and the read's
/// freshness inside the file wrapper reaches the task result and the trace.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_live_document_read_returns_its_file_to_the_task(pool: Pool<Postgres>) {
    let row = &document_row();
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
    let event = pane.call().await;
    let task_chat: Uuid = event["chat_id"].as_str().unwrap().parse().unwrap();
    let file_id = upload_into(&state, task_chat, DOCUMENT_TEXT).await;
    let value = document_value(row);
    let answered = post_live(
        &state,
        task_chat,
        &(
            event["message_id"].as_str().unwrap().parse().unwrap(),
            event["tool_call_id"].as_str().unwrap().to_string(),
        ),
        json!({"result": value, "file_upload_ids": [file_id]}),
        Some(&row.binding()),
    )
    .await;
    answered.assert_status_ok();
    assert_eq!(answered.json::<Value>()["delivered"], true);
    assert!(finish(run).await.contains(PARENT_FINAL));

    let child_row = assistant_row(&state.db, task_chat).await;
    let read = part_for(&child_row, CHILD_READ_CALL);
    assert_eq!(read["status"], "success", "{read}");
    assert_eq!(read["output"]["result"]["result"], value);
    assert_eq!(
        read["output"]["result"]["files"][0]["fileId"],
        json!(file_id)
    );
    let child_turns = turn_bodies(&child);
    assert_eq!(child_turns.len(), 2);
    assert!(
        child_turns[1].to_string().contains(DOCUMENT_TEXT),
        "the task's model reads the file"
    );
    assert!(
        !linked_to_chat(&state, chat_id, file_id).await,
        "the file stays in the task's chat"
    );
    assert_freshness_reported(
        row,
        &part_for(&assistant_row(&state.db, chat_id).await, CLIENT_TASK_CALL),
    );
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_durable_document_read_returns_its_file_to_the_task(pool: Pool<Postgres>) {
    let row = &document_row();
    let mut waiting: Waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let resumed = record_parent_resumes(&mut waiting.llm);
    let file_id = upload_into(&waiting.state, waiting.child.id, DOCUMENT_TEXT).await;
    let value = document_value(row);
    let attempt_id = waiting.request.attempt_id;
    let token = claim_token(row, &waiting.state, attempt_id).await;
    let mut result = pane_result(row, &waiting.request);
    result.result = Some(OperationValue::Value {
        value: value.clone(),
        file_upload_ids: vec![file_id],
    });
    post_result(row, &waiting.state, &token, &result)
        .await
        .assert_status_ok();
    let stored = attempt_row(&waiting).await;
    assert_eq!(
        stored.result.unwrap()["result"],
        json!({"type": "value", "value": value, "file_upload_ids": [file_id]}),
        "the stored result keeps the tool's own value and the raw ids"
    );
    continue_operation(&waiting.state, attempt_id)
        .await
        .assert_status_ok();
    let answered = wait_answered(&waiting.state, waiting.chat_id).await;

    let child_row = assistant_row(&waiting.state.db, waiting.child.id).await;
    let read = part_for(&child_row, CHILD_READ_CALL);
    assert_eq!(read["status"], "success", "{read}");
    assert_eq!(read["output"]["result"]["result"], value);
    assert_eq!(
        read["output"]["result"]["result"]["freshness"]["scope"]["id"],
        format!("doc:{DOCUMENT_ID}")
    );
    assert_eq!(
        read["output"]["result"]["files"][0]["fileId"],
        json!(file_id)
    );
    assert!(
        read["output"]["result"]["files"][0]["text"]
            .as_str()
            .unwrap()
            .contains(DOCUMENT_TEXT),
        "{read}"
    );
    let pointers: Vec<&Value> = child_row.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|part| part["content_type"] == "text_file_pointer")
        .collect();
    assert_eq!(pointers.len(), 1, "{}", child_row.raw_message);
    assert_eq!(pointers[0]["file_upload_id"], json!(file_id));
    assert!(linked_to_chat(&waiting.state, waiting.child.id, file_id).await);
    assert!(
        !linked_to_chat(&waiting.state, waiting.chat_id, file_id).await,
        "the file stays in the task's chat"
    );

    let slot = part_for(&answered, CLIENT_TASK_CALL);
    assert_eq!(
        slot["output"]["client_tools"],
        json!({"freshness": reported_freshness()}),
        "{slot}"
    );
    let parent_turns = turn_bodies(&resumed);
    assert_eq!(parent_turns.len(), 1, "one parent continuation");
    let told = task_result_in(&parent_turns[0], CLIENT_TASK_CALL);
    assert_eq!(
        told["client_tools"],
        json!({"freshness": reported_freshness()}),
        "{told}"
    );
    waiting.server.abort();
}

/// A replica of this release continues a task's call a newer release stored,
/// with keys it does not know in the stored result.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_stored_task_result_with_a_newer_field_still_continues(pool: Pool<Postgres>) {
    let row = &desktop_sidecar();
    let mut waiting = park_a_waiting_child(row, pool, false, |_| {}).await;
    let resumed = record_parent_resumes(&mut waiting.llm);
    let attempt_id = waiting.request.attempt_id;
    let token = claim_token(row, &waiting.state, attempt_id).await;
    post_result(
        row,
        &waiting.state,
        &token,
        &pane_result(row, &waiting.request),
    )
    .await
    .assert_status_ok();
    waiting
        .state
        .db
        .execute_unprepared(&format!(
            "UPDATE client_operation_attempts SET result = jsonb_set(result || '{{\"future\": 1}}', \
             '{{result,future}}', '1') WHERE attempt_id = '{attempt_id}'"
        ))
        .await
        .unwrap();
    let stored = attempt_row(&waiting).await.result.unwrap();
    assert_eq!(stored["future"], 1);
    assert_eq!(stored["result"]["future"], 1);
    continue_operation(&waiting.state, attempt_id)
        .await
        .assert_status_ok();
    let answered = wait_answered(&waiting.state, waiting.chat_id).await;
    let read = part_for(
        &assistant_row(&waiting.state.db, waiting.child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(read["status"], "success", "{read}");
    assert_eq!(read["output"]["result"]["text"], PANE_TEXT);
    let slot = part_for(&answered, CLIENT_TASK_CALL);
    assert_eq!(slot["output"]["status"], "completed", "{slot}");
    assert_eq!(turn_bodies(&resumed).len(), 1, "one parent continuation");
    waiting.server.abort();
}
