//! A reviewed desktop sidecar tool set to Ask does not ask in the chat when the
//! page says the Erato desktop app behind the call's binding runs in strict
//! mode: the app's review is the only question (ERMAIN-1155). Without that
//! word, for a tool the app does not review, and for Never, the server decides
//! as before.
use super::*;
use erato::models::user_preference::ClientToolDecision;

const SEARCH: &str = "search_sidecar_index";
const MAILBOXES: &str = "list_sidecar_mailboxes";
const FIELDS: &str = "get_sidecar_search_fields";
const REVIEWED: [&str; 4] = [
    "get_sidecar_folder_hierarchy",
    SEARCH,
    "get_sidecar_document",
    "read_sidecar_conversation",
];
const FIRST_CALL: &str = "strict-first-call";
const SEARCH_CALL: &str = "strict-search-call";
const ANSWER: &str = "STRICT-REVIEW-ANSWER";
/// Far beyond each test's own deadline, so only an answer ends a live call.
const TIMEOUT_MS: u64 = 600_000;

/// The binding every Erato window of one desktop app installation sends.
fn sidecar() -> ExecutorBinding {
    ExecutorBinding {
        device_id: "installation-one".into(),
        realm: ExecutionRealm::DesktopSidecar,
        host_context: Some(HostContext {
            kind: "desktop_sidecar".into(),
            identity: "local".into(),
        }),
    }
}

fn sidecar_tool(name: &str) -> ClientToolConfig {
    ClientToolConfig {
        name: name.into(),
        namespace: Some("desktop".into()),
        description: "Read the local index".into(),
        parameters: json!({"type":"object","properties":{"text":{"type":"string"}}}).to_string(),
        requires_client_registration: true,
        timeout_ms: Some(TIMEOUT_MS),
        host_context: Some(erato::config::ClientToolHostContext::DesktopSidecar),
        durable: Some(erato::config::ClientToolDurableConfig {
            host_context: erato::config::ClientToolHostContext::DesktopSidecar,
            result_schema: None,
            attempt_expiry_secs: 86_400,
            claim_lease_secs: 120,
        }),
        ..Default::default()
    }
}

fn all_tools() -> Vec<&'static str> {
    let mut tools = REVIEWED.to_vec();
    tools.extend([MAILBOXES, FIELDS]);
    tools
}

/// The model makes `calls` one per inference, then answers once the last
/// call's outcome is in the history. Every sidecar tool is configured, each
/// with the user's decision from `decisions`.
async fn setup(
    pool: Pool<Postgres>,
    calls: &[(&'static str, &'static str)],
    decisions: &[(&str, ClientToolDecision)],
) -> Setup {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let mut previous: Option<&'static str> = None;
    for &(call_id, tool) in calls {
        let capture = recorder.clone();
        let required: Vec<&'static str> = previous.into_iter().collect();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&required, &[call_id]))
                .matcher(capture);
            mock_llm_sse_response(
                then,
                build_openai_tool_calls_streaming_response(&[(
                    call_id,
                    tool,
                    json!({"text": "quarterly report"}),
                )]),
            );
        });
        previous = Some(call_id);
    }
    let last = previous.expect("at least one call");
    let capture = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[last], &[]))
            .matcher(capture);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[ANSWER]));
    });
    let (mut config, mock) = setup_mock_llm_server_with_mocks(mocks).await;
    config.client_tools.durable_operations_enabled = true;
    for name in all_tools() {
        config
            .client_tools
            .tools
            .insert(format!("desktop_{name}"), sidecar_tool(name));
    }
    config.facets.tool_call_allowlist = vec!["desktop/*".into()];
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let user = get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    for (tool, decision) in decisions {
        erato::models::user_preference::set_client_tool_decision(
            &state.db,
            &user.id,
            &format!("desktop/{tool}"),
            *decision,
        )
        .await
        .unwrap();
    }
    Setup {
        state,
        _mock: mock,
        recorder,
        chat_id,
    }
}

/// The headers of a web app page with the app ready: its binding alone in
/// the additional executors, and `strict`, when given, as the app's word.
fn page_request(
    request: axum_test::TestRequest,
    strict: Option<&[ExecutorBinding]>,
) -> axum_test::TestRequest {
    let request = request
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", all_tools().join(","))
        .add_header(
            "X-Erato-Additional-Executors",
            serde_json::to_string(&[sidecar()]).unwrap(),
        );
    match strict {
        Some(bindings) => request.add_header(
            "X-Erato-Strict-Mode-Executors",
            serde_json::to_string(bindings).unwrap(),
        ),
        None => request,
    }
}

fn submit(setup: &Setup, strict: Option<&[ExecutorBinding]>) -> axum_test::TestRequest {
    page_request(
        app_server(setup.state.clone()).post("/api/v1beta/me/messages/submitstream"),
        strict,
    )
    .json(&json!({"existing_chat_id": setup.chat_id, "user_message": "Find the quarterly report"}))
}

/// Runs `request` while answering, as the app's page, every live call the
/// chat dispatches; returns the response and the tools it was asked to run.
async fn run_answering(
    setup: &Setup,
    request: axum_test::TestRequest,
) -> (axum_test::TestResponse, Vec<String>) {
    tokio::time::timeout(Duration::from_secs(30), async {
        let (done_tx, mut done_rx) = tokio::sync::oneshot::channel::<()>();
        let run = async {
            let response = request.await;
            let _ = done_tx.send(());
            response
        };
        let answer = async {
            let mut answered = Vec::new();
            let mut seen = std::collections::HashSet::new();
            loop {
                if let Some(task) = setup.state.background_tasks.get_task(&setup.chat_id).await {
                    for event in task.get_event_history().await {
                        if let StreamingEvent::ClientToolCall {
                            message_id,
                            tool_call_id,
                            tool_name,
                            ..
                        } = event
                            && seen.insert(tool_call_id.clone())
                        {
                            let response = post_live(
                                &setup.state,
                                setup.chat_id,
                                &(message_id, tool_call_id),
                                json!({"result": {"hits": [{"title": "APPROVED-HIT"}]}}),
                                Some(&sidecar()),
                            )
                            .await;
                            response.assert_status_ok();
                            assert_eq!(response.json::<Value>()["delivered"], true);
                            answered.push(tool_name);
                        }
                    }
                }
                tokio::select! {
                    _ = &mut done_rx => return answered,
                    () = tokio::time::sleep(Duration::from_millis(5)) => {}
                }
            }
        };
        tokio::join!(run, answer)
    })
    .await
    .expect("the turn did not finish")
}

async fn assistant_content(setup: &Setup) -> Vec<Value> {
    Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(setup.chat_id))
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&setup.state.db)
        .await
        .unwrap()
        .into_iter()
        .rfind(|row| row.raw_message["role"] == "assistant")
        .expect("assistant row")
        .raw_message["content"]
        .as_array()
        .unwrap()
        .clone()
}

async fn assistant_id(setup: &Setup) -> Uuid {
    Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(setup.chat_id))
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&setup.state.db)
        .await
        .unwrap()
        .into_iter()
        .rfind(|row| row.raw_message["role"] == "assistant")
        .expect("assistant row")
        .id
}

/// The chat questions on the row, by the tool each asks about.
fn questions(content: &[Value]) -> Vec<String> {
    content
        .iter()
        .filter(|part| part["content_type"] == "tool_approval_request")
        .map(|part| {
            assert_eq!(part["kind"], "client_tool", "{part}");
            part["tool_name"].as_str().unwrap().to_string()
        })
        .collect()
}

fn output_of(content: &[Value], call: &str) -> Value {
    content
        .iter()
        .find(|part| {
            part["content_type"] == "tool_use"
                && part["tool_call_id"]
                    .as_str()
                    .is_some_and(|id| id == call || id.ends_with(&format!(":{call}")))
        })
        .map(|part| part["output"].clone())
        .unwrap_or(Value::Null)
}

/// The turn's first call, `tool` set to `decision`, from a page that says
/// `strict`: the questions the turn asked and the tools the app was asked to
/// run.
async fn one_call(
    pool: Pool<Postgres>,
    tool: &'static str,
    decision: ClientToolDecision,
    strict: Option<&[ExecutorBinding]>,
) -> (Vec<String>, Vec<String>, Vec<Value>) {
    let setup = setup(pool, &[(SEARCH_CALL, tool)], &[(tool, decision)]).await;
    let (response, answered) = run_answering(&setup, submit(&setup, strict)).await;
    response.assert_status_ok();
    let content = assistant_content(&setup).await;
    (questions(&content), answered, content)
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_reviewed_tool_set_to_ask_asks_only_in_the_review_of_a_strict_app(pool: Pool<Postgres>) {
    for tool in REVIEWED {
        let (asked, answered, content) = one_call(
            pool.clone(),
            tool,
            ClientToolDecision::Ask,
            Some(&[sidecar()]),
        )
        .await;
        assert!(asked.is_empty(), "{tool} asked in the chat: {asked:?}");
        assert_eq!(answered, vec![tool.to_string()]);
        assert_eq!(
            output_of(&content, SEARCH_CALL)["result"]["hits"][0]["title"],
            "APPROVED-HIT",
            "{content:?}"
        );
        assert!(json!(content).to_string().contains(ANSWER));
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_reviewed_tool_keeps_its_chat_question_unless_the_page_says_its_app_is_strict(
    pool: Pool<Postgres>,
) {
    let other_installation = ExecutorBinding {
        device_id: "installation-two".into(),
        ..sidecar()
    };
    let words: [(&str, Option<&[ExecutorBinding]>); 3] = [
        ("no word", None),
        ("an empty word", Some(&[])),
        ("a word about another app", Some(&[other_installation])),
    ];
    for (what, strict) in words {
        let (asked, answered, _) =
            one_call(pool.clone(), SEARCH, ClientToolDecision::Ask, strict).await;
        assert_eq!(asked, vec![SEARCH.to_string()], "{what}");
        assert!(answered.is_empty(), "{what}: ran before the user answered");
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn mailboxes_and_search_fields_set_to_ask_keep_their_chat_question_under_strict_mode(
    pool: Pool<Postgres>,
) {
    for tool in [MAILBOXES, FIELDS] {
        let (asked, answered, _) = one_call(
            pool.clone(),
            tool,
            ClientToolDecision::Ask,
            Some(&[sidecar()]),
        )
        .await;
        assert_eq!(asked, vec![tool.to_string()]);
        assert!(answered.is_empty(), "{tool} ran before the user answered");
    }
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_still_refuses_and_always_still_runs_under_strict_mode(pool: Pool<Postgres>) {
    let (asked, answered, content) = one_call(
        pool.clone(),
        SEARCH,
        ClientToolDecision::NeverAllow,
        Some(&[sidecar()]),
    )
    .await;
    assert!(asked.is_empty());
    assert!(answered.is_empty(), "a tool set to Never reached the app");
    // Not offered, so the call the model makes anyway is refused.
    assert_eq!(
        output_of(&content, SEARCH_CALL),
        json!({
            "status": "error",
            "error": format!("Proposed tool call '{SEARCH}' is not allowed for this request"),
        })
    );

    let (asked, answered, _) = one_call(
        pool,
        SEARCH,
        ClientToolDecision::AlwaysAllow,
        Some(&[sidecar()]),
    )
    .await;
    assert!(asked.is_empty());
    assert_eq!(answered, vec![SEARCH.to_string()]);
}

/// The turn's first call asks about the mailboxes, which the app does not
/// review; the continuation that answers it then reaches the search.
async fn search_after_an_approved_mailbox_question(
    pool: Pool<Postgres>,
    strict_on_continuation: bool,
) -> (Vec<String>, Vec<String>) {
    let setup = setup(
        pool,
        &[(FIRST_CALL, MAILBOXES), (SEARCH_CALL, SEARCH)],
        &[
            (MAILBOXES, ClientToolDecision::Ask),
            (SEARCH, ClientToolDecision::Ask),
        ],
    )
    .await;
    let (response, answered) = run_answering(&setup, submit(&setup, Some(&[sidecar()]))).await;
    response.assert_status_ok();
    assert!(answered.is_empty());
    let content = assistant_content(&setup).await;
    assert_eq!(questions(&content), vec![MAILBOXES.to_string()]);
    let approval_id = content
        .iter()
        .rfind(|part| part["content_type"] == "tool_approval_request")
        .unwrap()["approvals"][0]["approval_id"]
        .clone();
    let message_id = assistant_id(&setup).await;
    let continuation = page_request(
        app_server(setup.state.clone()).post("/api/v1beta/me/messages/continuestream"),
        strict_on_continuation.then_some(&[sidecar()][..]),
    )
    .json(&json!({
        "message_id": message_id,
        "decisions": [{"approval_id": approval_id, "decision": "approve"}],
    }));
    let (response, answered) = run_answering(&setup, continuation).await;
    response.assert_status_ok();
    (questions(&assistant_content(&setup).await), answered)
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_continuation_skips_the_question_on_its_own_requests_word(pool: Pool<Postgres>) {
    let (asked, answered) = search_after_an_approved_mailbox_question(pool, true).await;
    assert_eq!(
        asked,
        vec![MAILBOXES.to_string()],
        "only the mailbox question"
    );
    assert_eq!(answered, vec![MAILBOXES.to_string(), SEARCH.to_string()]);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_continuation_without_the_word_asks_although_the_turn_began_strict(pool: Pool<Postgres>) {
    let (asked, answered) = search_after_an_approved_mailbox_question(pool, false).await;
    assert_eq!(asked, vec![MAILBOXES.to_string(), SEARCH.to_string()]);
    assert_eq!(answered, vec![MAILBOXES.to_string()]);
}
