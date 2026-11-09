//! Delegated tasks of a Teams turn (ERMAIN-1007). The bot has no client: its
//! turns carry no executor binding, so a task that needs a client tool gets
//! none, even while the user's app is connected on another device (CT-7).

use super::{completion, identity};
use crate::test_app_state;
use crate::test_utils::{
    BodyContainsMatcher, RequestBodyRecorder, build_openai_text_streaming_response,
    build_openai_tool_calls_streaming_response, setup_mock_llm_server_with_mocks,
};
use erato::config::{ClientToolChildAccess, ClientToolConfig, ClientToolHostContext, FacetConfig};
use erato::db::entity::{chats, messages, users};
use erato::models::user::get_or_create_user;
use erato::models::user_preference::{ClientToolDecision, set_client_tool_decision};
use erato::ms_teams_bot::activity::ConversationKind;
use erato::ms_teams_bot::host::{ClientTask, Completion, Host, Session, TaskClient};
use erato::services::client_operations::executor_stream::{self, PresenceClaim};
use erato::services::client_operations::{ExecutionRealm, ExecutorBinding, HostContext};
use mocktail::MockSet;
use mocktail::body::BodyAction;
use mocktail::mock_builder::Then;
use mocktail::server::MockServer;
use sea_orm::prelude::Uuid;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::time::{Duration, Instant};

const READ_TOOL: &str = "fetch_availability";
const READ_TOOL_QUALIFIED: &str = "outlook/fetch_availability";
const CHILD_FACET: &str = "mailbox_reader";
const RESEARCH_FACET: &str = "research";
const USER_MESSAGE: &str = "TEAMS-USER-MESSAGE: when am I free next week?";
const CLIENT_BRIEF: &str = "CLIENT-BRIEF-SENTINEL: read my calendar for next week";
const RESEARCH_BRIEF: &str = "RESEARCH-BRIEF-SENTINEL: look up the team's holidays";
const CLIENT_TASK_CALL: &str = "call_client_task";
const RESEARCH_TASK_CALL: &str = "call_research_task";
const CHILD_READ_CALL: &str = "call_child_read";
const CHILD_ANSWER: &str = "CHILD-ANSWER";
const RESEARCH_ANSWER: &str = "RESEARCH-ANSWER";
const PARENT_FINAL: &str = "PARENT-FINAL-ANSWER";
const TOOL_TIMEOUT: Duration = Duration::from_secs(60);
const NOT_FROM_HOST: &str = "the turn was not sent from the pane this task needs";

fn mock_sse(then: Then, body: Vec<BodyAction>) {
    then.status(axum::http::StatusCode::OK)
        .headers([
            ("Content-Type", "text/event-stream"),
            ("Cache-Control", "no-cache"),
            ("Connection", "keep-alive"),
        ])
        .bytes_stream_with_delays(body);
}

/// The parent answers the user's message with `first`, and with
/// `PARENT_FINAL` once a result is back.
fn mock_parent(mocks: &mut MockSet, first: Vec<BodyAction>, result_marker: &'static str) {
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[USER_MESSAGE], &[result_marker]));
        mock_sse(then, first);
    });
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[USER_MESSAGE, result_marker],
                &[],
            ));
        mock_sse(then, build_openai_text_streaming_response(&[PARENT_FINAL]));
    });
}

/// The client child calls the read tool although it was not offered, and
/// answers once that call has a result.
fn mock_client_child(mocks: &mut MockSet, recorder: &RequestBodyRecorder) {
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[CLIENT_BRIEF],
                &[USER_MESSAGE, CHILD_READ_CALL],
            ))
            .matcher(capture);
        mock_sse(
            then,
            build_openai_tool_calls_streaming_response(&[(
                CHILD_READ_CALL,
                READ_TOOL,
                json!({"lookahead_days": 7}),
            )]),
        );
    });
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[CLIENT_BRIEF, CHILD_READ_CALL],
                &[USER_MESSAGE],
            ))
            .matcher(capture);
        mock_sse(then, build_openai_text_streaming_response(&[CHILD_ANSWER]));
    });
}

fn mock_research_child(mocks: &mut MockSet) {
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[RESEARCH_BRIEF], &[USER_MESSAGE]));
        mock_sse(
            then,
            build_openai_text_streaming_response(&[RESEARCH_ANSWER]),
        );
    });
}

/// Tasks on, a mailbox read tool that tasks may use and that a turn without
/// an action facet is offered, a child facet that needs the mailbox and one
/// that needs no client.
async fn teams_state(pool: Pool<Postgres>, mocks: MockSet) -> (erato::state::AppState, MockServer) {
    let (mut config, server) = setup_mock_llm_server_with_mocks(mocks).await;
    config.delegation.tasks.enabled = true;
    config.delegation.tasks.run_modes = vec![erato_config::config::TaskRunMode::Wait];
    config.delegation.tasks.approval.mode = erato_config::config::TaskApprovalMode::Never;
    config.delegation.tasks.scheduling = erato_config::config::TaskScheduling::Silent;
    config.delegation.tasks.child_facet_ids = vec![CHILD_FACET.into(), RESEARCH_FACET.into()];
    config.client_tools.executor_stream_enabled = true;
    config.facets.tool_call_allowlist =
        vec!["erato/delegate_task".into(), READ_TOOL_QUALIFIED.into()];
    config.client_tools.tools.insert(
        "mailbox_read".into(),
        ClientToolConfig {
            name: READ_TOOL.into(),
            namespace: Some("outlook".into()),
            description: "Read free and busy times from the mailbox".into(),
            parameters: json!({"type": "object", "properties": {
                "lookahead_days": {"type": "integer"}}})
            .to_string(),
            timeout_ms: Some(TOOL_TIMEOUT.as_millis() as u64),
            child_access: ClientToolChildAccess::Read,
            host_context: Some(ClientToolHostContext::OutlookMailbox),
            ..Default::default()
        },
    );
    config.facets.facets.insert(
        CHILD_FACET.into(),
        FacetConfig {
            display_name: "Read the mailbox".into(),
            disable_facet_prompt_template: true,
            child_host_context: Some(ClientToolHostContext::OutlookMailbox),
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
    (test_app_state(config, pool).await, server)
}

/// A Teams personal chat of a new user, ready for a turn.
async fn teams_chat(
    state: &erato::state::AppState,
    subject: &str,
) -> (Host, Session, Uuid, users::Model) {
    let user = get_or_create_user(&state.db, "https://issuer.example", subject, None)
        .await
        .expect("user");
    let host = Host::new(state.clone());
    let session = host
        .session(
            &user,
            &identity(),
            Vec::new(),
            "graph-token".into(),
            None,
            "tenant-1",
        )
        .await
        .expect("session");
    let row = host
        .upsert_conversation(
            &format!("a:personal-{subject}"),
            ConversationKind::Personal,
            user.id,
            "https://smba.example/",
            "29:user",
        )
        .await
        .expect("conversation");
    let (chat_id, _) = host.ensure_chat(&session, &row, None).await.expect("chat");
    (host, session, chat_id, user)
}

/// Runs a Teams turn to its end and says how long it took.
async fn run_turn(host: &Host, session: &Session, chat_id: Uuid) -> (Completion, Duration) {
    let started = Instant::now();
    let updates = host
        .submit(session, chat_id, USER_MESSAGE.into(), Vec::new())
        .await
        .expect("submit starts");
    let (done, _) = tokio::time::timeout(TOOL_TIMEOUT / 2, completion(updates))
        .await
        .expect("the Teams turn waited");
    (done, started.elapsed())
}

/// The user's Outlook pane on another device, connected and taking calls
/// from tasks.
fn outlook_elsewhere(account_id: Uuid) -> PresenceClaim {
    PresenceClaim {
        account_id,
        binding: ExecutorBinding {
            device_id: "laptop-at-home".into(),
            realm: ExecutionRealm::OfficeAddin,
            host_context: Some(HostContext {
                kind: "outlook_mailbox".into(),
                identity: "mailbox-1".into(),
            }),
        },
        instance_id: None,
        connected_at: chrono::Utc::now(),
        client_tools: vec![READ_TOOL.into()],
        child_client_tools: vec![READ_TOOL.into()],
        scoped_client_tools: Vec::new(),
    }
}

/// The delegated child of `parent` whose task names `facet`.
async fn child_chat(db: &sea_orm::DatabaseConnection, parent: Uuid, facet: &str) -> chats::Model {
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
        .unwrap_or_else(|| panic!("no child chat for {facet}"))
}

/// The tool part of `call` in the chat's last assistant row.
async fn tool_part(db: &sea_orm::DatabaseConnection, chat_id: Uuid, call: &str) -> Value {
    let row = messages::Entity::find()
        .filter(messages::Column::ChatId.eq(chat_id))
        .order_by_asc(messages::Column::CreatedAt)
        .all(db)
        .await
        .unwrap()
        .into_iter()
        .rfind(|row| row.raw_message["role"] == "assistant")
        .expect("an assistant row");
    let suffix = format!(":{call}");
    row.raw_message["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| {
            part["content_type"] == "tool_use"
                && part["tool_call_id"]
                    .as_str()
                    .is_some_and(|id| id == call || id.ends_with(&suffix))
        })
        .unwrap_or_else(|| panic!("no part for {call}: {}", row.raw_message))
        .clone()
}

async fn count(state: &erato::state::AppState, table: &str) -> i64 {
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

fn offers(body: &str, name: &str) -> bool {
    serde_json::from_str::<Value>(body).unwrap()["tools"]
        .as_array()
        .is_some_and(|tools| tools.iter().any(|tool| tool["function"]["name"] == name))
}

/// A Teams turn plans a task that needs the Outlook mailbox and one that needs
/// no client. The mailbox task gets no client tools although the user's
/// Outlook pane is connected on another device, its forced call runs nowhere
/// and waits for nothing, the other task completes, and the answer reaches
/// Teams naming the mailbox task.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_teams_task_gets_no_client_tools_and_says_so(pool: Pool<Postgres>) {
    let parent = RequestBodyRecorder::new();
    let child = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let capture = parent.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[USER_MESSAGE], &["child_run_id"]))
            .matcher(capture);
        mock_sse(
            then,
            build_openai_tool_calls_streaming_response(&[
                (
                    CLIENT_TASK_CALL,
                    "delegate_task",
                    json!({"task": CLIENT_BRIEF, "facet_ids": [CHILD_FACET]}),
                ),
                (
                    RESEARCH_TASK_CALL,
                    "delegate_task",
                    json!({"task": RESEARCH_BRIEF, "facet_ids": [RESEARCH_FACET]}),
                ),
            ]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &[USER_MESSAGE, "child_run_id"],
                &[],
            ));
        mock_sse(then, build_openai_text_streaming_response(&[PARENT_FINAL]));
    });
    mock_client_child(&mut mocks, &child);
    mock_research_child(&mut mocks);
    let (state, _llm) = teams_state(pool, mocks).await;
    let (host, session, chat_id, user) = teams_chat(&state, "subject-tasks").await;

    let elsewhere = outlook_elsewhere(user.id);
    executor_stream::announce(&state.db, &elsewhere, Uuid::new_v4())
        .await
        .unwrap();
    assert!(
        executor_stream::present(&state.db, user.id, &elsewhere.binding)
            .await
            .unwrap()
            .is_some(),
        "the user's Outlook pane is connected elsewhere"
    );

    let (done, took) = run_turn(&host, &session, chat_id).await;
    assert!(took < TOOL_TIMEOUT / 2, "the turn waited {took:?}");
    assert_eq!(done.chat_id, chat_id);
    assert_eq!(done.text, PARENT_FINAL);
    assert!(!done.needs_client);
    assert!(done.approvals.is_none());
    assert_eq!(
        done.client_tasks,
        [ClientTask {
            brief: CLIENT_BRIEF.into(),
            client: Some(TaskClient::Outlook),
        }]
    );

    let first_turn = parent
        .bodies()
        .into_iter()
        .find(|body| !body.contains("Generate a summary for the topic"))
        .expect("the parent's first request");
    assert!(
        offers(&first_turn, READ_TOOL),
        "the parent is offered the mailbox tool, so only the missing binding keeps it from the task"
    );

    let client_child = child_chat(&state.db, chat_id, CHILD_FACET).await;
    let task = &client_child.assistant_configuration.as_ref().unwrap()["task"];
    assert!(task.get("client_grant").is_none(), "{task}");
    assert_eq!(task["client_task"]["unavailable"], NOT_FROM_HOST);
    let child_turns: Vec<String> = child
        .bodies()
        .into_iter()
        .filter(|body| !body.contains("Generate a summary for the topic"))
        .collect();
    assert!(!child_turns.is_empty());
    assert!(
        child_turns.iter().all(|body| !offers(body, READ_TOOL)),
        "the task was offered the client tool"
    );
    let forced = tool_part(&state.db, client_child.id, CHILD_READ_CALL).await;
    assert_eq!(forced["status"], "error", "{forced}");
    assert!(
        forced["output"]["error"]
            .as_str()
            .is_some_and(|error| error.contains("not allowed")),
        "{forced}"
    );
    assert_eq!(count(&state, "client_executor_calls").await, 0);
    assert_eq!(count(&state, "client_operation_attempts").await, 0);

    let client_slot = tool_part(&state.db, chat_id, CLIENT_TASK_CALL).await;
    assert_eq!(
        client_slot["output"]["client_tools"],
        json!({"unavailable": NOT_FROM_HOST}),
        "{client_slot}"
    );
    let research_slot = tool_part(&state.db, chat_id, RESEARCH_TASK_CALL).await;
    assert_eq!(
        research_slot["output"]["status"], "completed",
        "{research_slot}"
    );
    assert!(
        research_slot["output"].get("client_tools").is_none(),
        "{research_slot}"
    );
}

/// A Teams turn whose own step calls a client tool still stops for the Erato
/// app, with no card and no task to name.
///
/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_teams_parent_client_step_still_needs_the_app(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mock_parent(
        &mut mocks,
        build_openai_tool_calls_streaming_response(&[(
            "call_parent_read",
            READ_TOOL,
            json!({"lookahead_days": 7}),
        )]),
        "call_parent_read",
    );
    let (state, _llm) = teams_state(pool, mocks).await;
    let (host, session, chat_id, user) = teams_chat(&state, "subject-step").await;
    set_client_tool_decision(
        &state.db,
        &user.id,
        READ_TOOL_QUALIFIED,
        ClientToolDecision::Ask,
    )
    .await
    .unwrap();

    let (done, took) = run_turn(&host, &session, chat_id).await;
    assert!(took < TOOL_TIMEOUT / 2, "the turn waited {took:?}");
    assert!(done.needs_client);
    assert!(done.approvals.is_none());
    assert!(done.client_tasks.is_empty());
}
