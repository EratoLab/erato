//! The cases every host context must pass, run once per row of `rows`.
use super::super::executor_stream::wait_released;
use super::slow_path::{
    a_child_that_finishes_while_approvals_are_open_keeps_the_parent_parked,
    a_child_that_parks_on_a_second_grant_call_updates_its_waiting_item,
    a_claimed_grant_operation_is_authorized_while_the_parent_is_parked_on_the_child,
    a_device_decline_ends_the_durable_call_as_declined,
    a_device_prompt_answered_after_the_tool_timeout_completes_within_the_attempt,
    a_durable_and_a_live_child_only_the_durable_one_waits,
    a_durable_child_call_parks_and_the_parent_shows_what_it_waits_for,
    a_durable_child_call_waits_for_a_client_and_the_parent_resumes,
    a_durable_child_that_finishes_before_the_parent_parks_resumes_the_parent_once,
    a_grant_operation_is_withdrawn_once_the_parent_chat_is_archived,
    a_grant_operation_is_withdrawn_once_the_user_never_allows_the_tool,
    a_grant_operation_its_grant_does_not_hold_durably_is_withdrawn,
    a_grant_operation_result_is_refused_without_a_claim,
    a_pane_without_grant_support_cannot_claim_a_grant_operation,
    a_parent_errored_after_its_decisions_resumes_once_when_the_waiting_child_finishes,
    a_restart_while_parked_gives_one_continuation_and_no_duplicate_calls,
    a_waiting_call_is_withdrawn_once_the_parent_moved_on,
    a_waiting_child_that_parks_on_an_ask_during_the_decision_continuation_reparks_as_an_approval,
    a_waiting_childs_continuation_is_offered_its_granted_tools_while_the_parent_is_parked,
    a_withdrawn_childs_ask_is_answerable_in_its_own_chat,
    an_approved_child_call_on_a_durable_tool_waits_and_the_parent_shows_it,
    an_empty_continuestream_while_children_wait_is_children_waiting,
    approvals_decided_while_a_child_waits_repark_on_the_waiting_child,
    continuestream_refuses_a_decision_naming_a_waiting_item,
    continuestream_refuses_a_single_decision_when_only_waiting_items_are_open,
    no_client_before_the_attempt_ends_gives_expired,
    resume_parked_refuses_a_chat_whose_generation_moved_on,
    the_sweep_settles_a_waiting_child_whose_tail_never_ran_and_an_empty_continue_resumes_the_parent,
    two_waiting_children_one_still_running_give_one_parent_continuation_with_both_answers,
};
use super::*;
use crate::test_utils::build_openai_paused_tool_calls_streaming_response;
use erato::config::ClientToolHostContext;
use erato::services::client_operations::executor_stream;
use sea_orm::ConnectionTrait;
use std::collections::BTreeSet;

/// One module per row, named before the colon, with one test per case. A row
/// marked `slow_path` also runs the slow-path cases; a guard case holds every
/// row to whether its host's context outlives the pane session.
macro_rules! host_conformance {
    (@cases [$($why:literal)?]) => {};
    (@cases [$($why:literal)?] $case:ident $($rest:ident)*) => {
        #[sqlx::test(migrator = "crate::MIGRATOR")]
        $(#[ignore = $why])?
        async fn $case(pool: Pool<Postgres>) {
            super::$case(pool, &row()).await;
        }

        host_conformance!(@cases [$($why)?] $($rest)*);
    };
    (@row $name:ident, $row:ident($($arg:expr),*), $slow_path:literal, [$($why:literal)?],
        [$($slow_case:ident)*]) => {
        mod $name {
            use super::*;

            const SLOW_PATH: bool = $slow_path;

            fn row() -> HostRow {
                rows::$row($($arg),*)
            }

            #[test]
            fn slow_path_rows_are_the_hosts_that_outlive_the_pane() {
                assert_eq!(row().host.outlives_pane_session(), SLOW_PATH);
            }

            host_conformance!(@cases [$($why)?]
                one_turn_grants_the_client_task_and_not_its_sibling
                the_continuation_offers_what_the_fresh_turn_offered
                a_resumed_child_is_offered_its_granted_tool_again
                never_withholds_the_grant_and_the_offer
                an_adopted_child_is_not_offered_the_granted_tool
                the_granted_tool_disappears_once_the_parent_turn_is_over
                a_retried_client_task_gets_no_grant
                a_child_is_never_offered_a_tool_its_parent_was_not
                client_tasks_get_no_grant_while_executor_streams_are_off
                a_turn_without_the_hosts_binding_gets_no_grant
                never_before_the_turn_leaves_nothing_to_grant
                never_after_the_offer_writes_no_grant
                never_after_the_childs_offer_refuses_its_call
                no_pane_at_launch_means_no_grant_and_the_result_says_why
                a_pane_that_takes_no_task_calls_gets_no_grant
                a_granted_call_reaches_the_pane_with_lineage_and_the_server_context_ref
                a_child_cannot_call_write_tools_without_child_access_or_invented_tools
                a_pane_gone_before_dispatch_is_context_unavailable_after_the_grace
                a_pane_lost_in_flight_is_context_unavailable_after_the_grace
                a_child_call_never_waits_for_the_inbox_even_for_a_durable_tool
                a_client_task_asking_for_async_runs_in_wait_mode_beside_an_async_research_task
                the_async_only_gate_treats_a_client_task_as_wait
                a_childs_client_tool_ask_shows_one_item_per_child_and_parks_the_parent
                a_child_ask_joins_the_coordinators_own_client_tool_ask
                a_child_client_ask_is_refused_when_child_approvals_are_off
                an_approved_child_call_reaches_the_pane_under_the_same_grant
                a_denied_child_call_is_declined_and_the_task_result_says_so
                freshness_reaches_the_task_result_and_the_parent_trace
                freshness_after_an_approval_reaches_the_task_result_and_the_trace
            );
            host_conformance!(@cases [$($why)?] $($slow_case)*);
        }
    };
    ($name:ident: $row:ident($($arg:expr),*), slow_path $(, ignore = $why:literal)?) => {
        host_conformance!(@row $name, $row($($arg),*), true, [$($why)?], [
            a_durable_child_call_parks_and_the_parent_shows_what_it_waits_for
            a_pane_without_grant_support_cannot_claim_a_grant_operation
            a_claimed_grant_operation_is_authorized_while_the_parent_is_parked_on_the_child
            a_grant_operation_is_withdrawn_once_the_parent_chat_is_archived
            a_grant_operation_is_withdrawn_once_the_user_never_allows_the_tool
            a_grant_operation_its_grant_does_not_hold_durably_is_withdrawn
            a_grant_operation_result_is_refused_without_a_claim
            continuestream_refuses_a_decision_naming_a_waiting_item
            continuestream_refuses_a_single_decision_when_only_waiting_items_are_open
            an_empty_continuestream_while_children_wait_is_children_waiting
            a_durable_child_call_waits_for_a_client_and_the_parent_resumes
            a_waiting_childs_continuation_is_offered_its_granted_tools_while_the_parent_is_parked
            a_device_prompt_answered_after_the_tool_timeout_completes_within_the_attempt
            a_device_decline_ends_the_durable_call_as_declined
            no_client_before_the_attempt_ends_gives_expired
            a_durable_and_a_live_child_only_the_durable_one_waits
            a_durable_child_that_finishes_before_the_parent_parks_resumes_the_parent_once
            two_waiting_children_one_still_running_give_one_parent_continuation_with_both_answers
            approvals_decided_while_a_child_waits_repark_on_the_waiting_child
            a_child_that_finishes_while_approvals_are_open_keeps_the_parent_parked
            a_waiting_child_that_parks_on_an_ask_during_the_decision_continuation_reparks_as_an_approval
            an_approved_child_call_on_a_durable_tool_waits_and_the_parent_shows_it
            a_child_that_parks_on_a_second_grant_call_updates_its_waiting_item
            a_parent_errored_after_its_decisions_resumes_once_when_the_waiting_child_finishes
            resume_parked_refuses_a_chat_whose_generation_moved_on
            a_restart_while_parked_gives_one_continuation_and_no_duplicate_calls
            the_sweep_settles_a_waiting_child_whose_tail_never_ran_and_an_empty_continue_resumes_the_parent
            a_waiting_call_is_withdrawn_once_the_parent_moved_on
            a_withdrawn_childs_ask_is_answerable_in_its_own_chat
        ]);
    };
    ($name:ident: $row:ident($($arg:expr),*) $(, ignore = $why:literal)?) => {
        host_conformance!(@row $name, $row($($arg),*), false, [$($why)?], []);
    };
}

host_conformance!(fake_host: fake_host(ClientToolHostContext::WordDocument));
host_conformance!(
    fake_live_host: fake_live_host(ClientToolHostContext::OutlookMailbox),
    slow_path
);
// A host's row is enabled by the issue that makes its pane take grant calls,
// so a passing row never stands for a host whose pane would refuse them.
host_conformance!(
    word_document: word_document(),
    ignore = "ERMAIN-1003: enabled once the Word pane takes grant calls"
);
host_conformance!(
    outlook_mailbox: outlook_mailbox(),
    slow_path,
    ignore = "ERMAIN-1006: enabled once the Outlook pane takes grant calls"
);

/// Long enough for the pane to receive the call, short enough that a durable
/// escalation would happen inside the test.
const UNANSWERED_TIMEOUT_MS: u64 = 1_500;

/// Between the parent's offer and its task call, long enough for the test to
/// change the user's decision.
const PLAN_PAUSE: Duration = Duration::from_secs(3);

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

async fn one_turn_grants_the_client_task_and_not_its_sibling(pool: Pool<Postgres>, row: &HostRow) {
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

async fn the_continuation_offers_what_the_fresh_turn_offered(pool: Pool<Postgres>, row: &HostRow) {
    let mut asked = ask_in_a_client_task(row, pool, |_| {}).await;
    let decided = spawn_decision(
        &asked.base,
        json!({ "message_id": asked.parent_message.id, "decision": "approve" }),
    );
    answer_call(row, &asked.state, &asked.pane.call().await).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));

    let child_turns = turn_bodies(&asked.recorder);
    assert_eq!(child_turns.len(), 2);
    let fresh = offered(&child_turns[0]);
    assert!(fresh.contains(row.read_tool), "{fresh:?}");
    assert_eq!(offered(&child_turns[1]), fresh);
    asked.server.abort();
}

fn offered(body: &Value) -> BTreeSet<&str> {
    body["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|tool| tool["function"]["name"].as_str())
        .collect()
}

async fn a_resumed_child_is_offered_its_granted_tool_again(pool: Pool<Postgres>, row: &HostRow) {
    let parked = park_a_client_child(row, pool).await;
    let resumed = approve_and_resume(&parked).await;
    assert!(offers(&resumed, row.read_tool), "{resumed}");
    assert!(!offers(&resumed, WRITE_TOOL));
    parked.server.abort();
}

async fn never_withholds_the_grant_and_the_offer(pool: Pool<Postgres>, row: &HostRow) {
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

async fn an_adopted_child_is_not_offered_the_granted_tool(pool: Pool<Postgres>, row: &HostRow) {
    let parked = park_a_client_child(row, pool).await;
    // What the user's own first message into the child chat records.
    erato::models::chat::mark_delegated_run_adopted(&parked.state.db, &parked.child)
        .await
        .unwrap();
    let resumed = approve_and_resume(&parked).await;
    assert!(!offers(&resumed, row.read_tool), "{resumed}");
    parked.server.abort();
}

async fn the_granted_tool_disappears_once_the_parent_turn_is_over(
    pool: Pool<Postgres>,
    row: &HostRow,
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

async fn a_retried_client_task_gets_no_grant(pool: Pool<Postgres>, row: &HostRow) {
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

async fn a_child_is_never_offered_a_tool_its_parent_was_not(pool: Pool<Postgres>, row: &HostRow) {
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

async fn client_tasks_get_no_grant_while_executor_streams_are_off(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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

async fn a_turn_without_the_hosts_binding_gets_no_grant(pool: Pool<Postgres>, row: &HostRow) {
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

async fn never_before_the_turn_leaves_nothing_to_grant(pool: Pool<Postgres>, row: &HostRow) {
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

async fn never_after_the_offer_writes_no_grant(pool: Pool<Postgres>, row: &HostRow) {
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

async fn never_after_the_childs_offer_refuses_its_call(pool: Pool<Postgres>, row: &HostRow) {
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child(
        &mut mocks,
        &child,
        build_openai_paused_tool_calls_streaming_response(
            "Reading the introduction.",
            PLAN_PAUSE,
            &[(CHILD_READ_CALL, row.read_tool, row.model_input.clone())],
        ),
        CHILD_READ_CALL,
    );
    let (state, _llm) = delegated_state(row, pool, mocks, |_| {}).await;
    let (base, server) = serve(&state).await;
    let mut pane = open_pane(row, &base).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let run = spawn_parent(row, &base, chat_id, ACTION_FACET, Some(row.binding()));
    tokio::time::timeout(Duration::from_secs(15), async {
        while turn_bodies(&child).is_empty() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the child's model is asked");
    erato::models::user_preference::set_client_tool_decision(
        &state.db,
        &account(&state).await,
        &row.qualified(),
        erato::models::user_preference::ClientToolDecision::NeverAllow,
    )
    .await
    .unwrap();
    assert!(finish(run).await.contains(PARENT_FINAL));

    assert!(offers(&turn_bodies(&child)[0], row.read_tool));
    assert_eq!(pane.next(Duration::from_millis(300)).await, None);
    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    assert!(task_spec(&client_child)["client_grant"].is_object());
    let read = part_for(
        &assistant_row(&state.db, client_child.id).await,
        CHILD_READ_CALL,
    );
    assert_eq!(read["status"], "error");
    assert_eq!(
        read["output"],
        json!({
            "status": "rejected",
            "error": format!(
                "The user has disabled the tool '{}' in their settings; the call was not executed.",
                row.read_tool
            ),
        })
    );
    assert_eq!(row_count(&state, "client_executor_calls").await, 0);
    server.abort();
}

async fn no_pane_at_launch_means_no_grant_and_the_result_says_why(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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

async fn a_pane_that_takes_no_task_calls_gets_no_grant(pool: Pool<Postgres>, row: &HostRow) {
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

async fn a_granted_call_reaches_the_pane_with_lineage_and_the_server_context_ref(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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
    if let Some(context) = &row.context {
        let offered = &child_turns[0]["tools"]
            .as_array()
            .and_then(|tools| {
                tools
                    .iter()
                    .find(|tool| tool["function"]["name"] == row.read_tool)
            })
            .expect("the granted read tool")["function"]["parameters"];
        assert!(
            offered["properties"].get(context.input).is_none(),
            "the task's model is not asked for the context version the server fills: {offered}"
        );
    }
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

async fn a_child_cannot_call_write_tools_without_child_access_or_invented_tools(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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

async fn a_pane_gone_before_dispatch_is_context_unavailable_after_the_grace(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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
    tokio::time::timeout(DISPATCH_PAUSE + Duration::from_secs(10), async {
        while row_count(&state, "client_executor_calls").await == 0 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the granted call is handed over without a pane");
    // The grace runs from the hand-over; the slack covers the polling above.
    let handed = tokio::time::Instant::now();
    assert!(finish(run).await.contains(PARENT_FINAL));
    let waited = handed.elapsed();
    assert!(
        waited >= executor_stream::PRESENCE_LOSS_GRACE - Duration::from_millis(500)
            && waited < executor_stream::PRESENCE_LOSS_GRACE + Duration::from_secs(10),
        "the call waits the full presence grace for a pane, not the tool's timeout: {waited:?}"
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

async fn a_pane_lost_in_flight_is_context_unavailable_after_the_grace(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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
        lost.elapsed() >= executor_stream::PRESENCE_LOSS_GRACE,
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

async fn a_child_call_never_waits_for_the_inbox_even_for_a_durable_tool(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_reads(row, &mut mocks, &child);
    let (state, _llm) = delegated_state(row, pool, mocks, |config| {
        config.client_tools.durable_operations_enabled = true;
        let mut tool = row.read_config(true, None);
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

async fn a_client_task_asking_for_async_runs_in_wait_mode_beside_an_async_research_task(
    pool: Pool<Postgres>,
    row: &HostRow,
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

async fn the_async_only_gate_treats_a_client_task_as_wait(pool: Pool<Postgres>, row: &HostRow) {
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

async fn a_childs_client_tool_ask_shows_one_item_per_child_and_parks_the_parent(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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

async fn a_child_ask_joins_the_coordinators_own_client_tool_ask(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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

async fn a_child_client_ask_is_refused_when_child_approvals_are_off(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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

async fn an_approved_child_call_reaches_the_pane_under_the_same_grant(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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

async fn a_denied_child_call_is_declined_and_the_task_result_says_so(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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

async fn freshness_reaches_the_task_result_and_the_parent_trace(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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

async fn freshness_after_an_approval_reaches_the_task_result_and_the_trace(
    pool: Pool<Postgres>,
    row: &HostRow,
) {
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
