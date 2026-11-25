//! The server-chained apply of an accepted submission through the real
//! request preparation, gate, SSE dispatch, result endpoint and approval
//! continuation, with a deterministic provider.
use super::*;
use erato::config::{
    ClientToolApproval, ClientToolCalledBy, ClientToolLabelAction, ClientToolLabelConfig,
    ClientToolLabelObjectKind, ClientToolReplayConfig, ClientToolReplayMode,
    ClientToolSubmissionConfig,
};
use erato::services::background_tasks::StreamingEvent;
use std::collections::{HashSet, VecDeque};
use std::future::IntoFuture;
use std::sync::Mutex;
use std::time::Duration;

const READ: &str = "read_document_blocks";
const SUBMIT: &str = "submit_document_plan";
const APPLY: &str = "apply_document_plan";
const FIX: &str = "fix_text";
const REGISTERED: &str = "read_document_blocks,submit_document_plan,apply_document_plan,fix_text";
const UNEXPECTED: &str = "UNEXPECTED EXTRA INFERENCE";
const PROPOSE: &str = "propose_client_action";
const OPEN_REPLY: &str = "open_reply";

enum Step {
    Tools(Vec<(&'static str, &'static str, Value)>),
    Text(&'static str),
}

fn read(id: &'static str) -> Step {
    Step::Tools(vec![(id, READ, json!({"snapshot":"s1"}))])
}

fn submit(id: &'static str, more_changes: Option<bool>) -> Step {
    Step::Tools(vec![(
        id,
        SUBMIT,
        json!({"snapshot":"s1","more_changes":more_changes}),
    )])
}

fn receipt() -> Value {
    json!({"result":{"draft_id":"draft-1","snapshot":"s1","plan":{"entries":["LARGE PLAN BODY"]},
        "approval_preview":{"title":"Change “Vertrag.docx”","summary":"Updates 1 of 4 sections: § 2"}}})
}

fn receipt_with(preview: Value) -> Value {
    json!({"result":{"draft_id":"draft-1","snapshot":"s1","approval_preview":preview}})
}

fn applied() -> Value {
    json!({"result":{"status":"applied","verified":true,"changed":["§ 2"],"undo_steps":1,"snapshot":"s2"}})
}

fn apply_result(status: &str) -> Value {
    json!({"result":{"status":status,"reason":"document_changed","snapshot":"s2"}})
}

fn read_result() -> Value {
    json!({"result":{"snapshot":"s1","blocks":["FULL DOCUMENT TEXT OF THE READ"]}})
}

struct Options {
    registered: &'static str,
    decision: Option<&'static str>,
    max_calls_per_message: u32,
    budget: u32,
    apply_approval: ClientToolApproval,
    /// An action facet whose `client_actions_always_ask` lists these.
    always_ask: Option<Vec<&'static str>>,
    apply_actions: Vec<&'static str>,
    submit_parameters: Option<Value>,
    fix_approval: ClientToolApproval,
    /// The pane holds the turn's client transport, as a Word pane does.
    shared_transport: bool,
    apply_timeout_ms: u64,
    /// An Outlook facet whose proposals `open_reply` carries out.
    proposal: Option<ProposalFacet>,
}

struct ProposalFacet {
    actions: Vec<&'static str>,
    always_ask: Vec<&'static str>,
    /// The stored decision for `outlook/open_reply`.
    decision: Option<&'static str>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            registered: REGISTERED,
            decision: Some("always_allow"),
            max_calls_per_message: 5,
            budget: 10,
            apply_approval: ClientToolApproval::UserDecision,
            always_ask: None,
            apply_actions: vec!["word.apply_document_plan"],
            submit_parameters: None,
            fix_approval: ClientToolApproval::EveryCall,
            shared_transport: false,
            apply_timeout_ms: 10_000,
            proposal: None,
        }
    }
}

/// One chat whose client calls a background responder answers in order.
struct Chat {
    state: erato::state::AppState,
    _mock: MockServer,
    recorder: RequestBodyRecorder,
    chat_id: Uuid,
    registered: &'static str,
    action_facet: Option<Value>,
    answers: Mutex<VecDeque<Value>>,
    dispatched: Mutex<Vec<(String, String, Value)>>,
    answered: Mutex<HashSet<(Uuid, String)>>,
    events: Vec<Value>,
}

fn tool(name: &str) -> ClientToolConfig {
    ClientToolConfig {
        name: name.into(),
        namespace: Some("word".into()),
        description: format!("{name} description"),
        parameters: json!({"type":"object","properties":{"snapshot":{"type":"string"}},"required":["snapshot"],"additionalProperties":false}).to_string(),
        requires_client_registration: true,
        timeout_ms: Some(10_000),
        ..Default::default()
    }
}

impl Chat {
    async fn new(
        pool: Pool<Postgres>,
        steps: Vec<Step>,
        answers: Vec<Value>,
        options: Options,
    ) -> Self {
        let recorder = RequestBodyRecorder::new();
        let mut mocks = MockSet::new();
        let mut previous: Option<&'static str> = None;
        for step in steps {
            let marker = match &step {
                Step::Tools(calls) => calls[0].0,
                Step::Text(text) => *text,
            };
            let capture = recorder.clone();
            let required: Vec<&'static str> = previous.into_iter().collect();
            mocks.mock(move |when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(&required, &[marker]))
                    .matcher(capture);
                match step {
                    Step::Tools(calls) => mock_llm_sse_response(
                        then,
                        build_openai_tool_calls_streaming_response(&calls),
                    ),
                    Step::Text(text) => {
                        mock_llm_sse_response(then, build_openai_text_streaming_response(&[text]))
                    }
                }
            });
            previous = Some(marker);
        }
        let capture = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[previous.unwrap()], &[]))
                .matcher(capture);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&[UNEXPECTED]));
        });
        let (mut config, mock) = setup_mock_llm_server_with_mocks(mocks).await;
        let receipt_replay = |fields: &[&str]| ClientToolReplayConfig {
            mode: ClientToolReplayMode::Receipt,
            keep_input_fields: vec!["$.snapshot".into()],
            keep_output_fields: fields.iter().map(|field| field.to_string()).collect(),
            max_input_field_bytes: None,
        };
        config.client_tools.tools.insert(
            READ.into(),
            ClientToolConfig {
                replay: receipt_replay(&["$.status", "$.result.snapshot"]),
                durable: options.shared_transport.then_some(
                    erato::config::ClientToolDurableConfig {
                        host_context: erato::config::ClientToolHostContext::WordDocument,
                        result_schema: None,
                        attempt_expiry_secs: 3600,
                        claim_lease_secs: 120,
                    },
                ),
                ..tool(READ)
            },
        );
        config.client_tools.durable_operations_enabled = options.shared_transport;
        config.client_tools.tools.insert(
            SUBMIT.into(),
            ClientToolConfig {
                parameters: options
                    .submit_parameters
                    .unwrap_or_else(|| json!({"type":"object","properties":{"snapshot":{"type":"string"},"more_changes":{"type":["boolean","null"]}},"required":["snapshot"],"additionalProperties":false}))
                    .to_string(),
                replay: receipt_replay(&["$.status", "$.result.draft_id", "$.result.snapshot"]),
                submission: Some(ClientToolSubmissionConfig {
                    max_attempts: 3,
                    recovery_read_tools: vec!["word/read_document_blocks".into()],
                    more_steps_key: Some("/more_changes".into()),
                    ..Default::default()
                }),
                ..tool(SUBMIT)
            },
        );
        config.client_tools.tools.insert(
            APPLY.into(),
            ClientToolConfig {
                description: "Apply the checked plan".into(),
                parameters: json!({"type":"object"}).to_string(),
                called_by: ClientToolCalledBy::Server,
                follows_tool: Some("word/submit_document_plan".into()),
                max_calls_per_message: Some(options.max_calls_per_message),
                approval: options.apply_approval,
                client_actions: options
                    .apply_actions
                    .iter()
                    .map(|a| a.to_string())
                    .collect(),
                label: Some(ClientToolLabelConfig {
                    action: ClientToolLabelAction::Update,
                    object_kind: ClientToolLabelObjectKind::Document,
                    fields: vec![],
                }),
                replay: receipt_replay(&["$.status", "$.result.status", "$.result.changed"]),
                timeout_ms: Some(options.apply_timeout_ms),
                ..tool(APPLY)
            },
        );
        config.client_tools.tools.insert(
            FIX.into(),
            ClientToolConfig {
                approval: options.fix_approval,
                ..tool(FIX)
            },
        );
        config.facets.tool_call_allowlist = vec!["word/*".into()];
        config.generation.max_tool_calls_per_message = options.budget;
        let action_facet = options.always_ask.map(|always_ask| {
            config.action_facets.facets.insert(
                "edit_document".into(),
                ActionFacetConfig {
                    display_name: "Edit".into(),
                    platform: None,
                    template: "Edit the document.".into(),
                    allowed_args: vec![],
                    client_actions: options
                        .apply_actions
                        .iter()
                        .map(|a| a.to_string())
                        .collect(),
                    presentation: None,
                    client_actions_always_ask: always_ask.iter().map(|a| a.to_string()).collect(),
                    grant_scope: Default::default(),
                    tool_call_allowlist: vec!["word/*".into()],
                    delegation: None,
                },
            );
            json!({"id":"edit_document","args":{}})
        });
        let proposal_decision = options.proposal.as_ref().and_then(|p| p.decision);
        let action_facet = match options.proposal {
            Some(proposal) => {
                config.client_tools.tools.insert(
                    "outlook_open_reply".into(),
                    ClientToolConfig {
                        name: OPEN_REPLY.into(),
                        namespace: Some("outlook".into()),
                        description: "Open a reply to the email".into(),
                        parameters: json!({"type":"object"}).to_string(),
                        called_by: ClientToolCalledBy::Server,
                        client_actions: vec!["outlook.reply".into()],
                        ..tool(OPEN_REPLY)
                    },
                );
                config.action_facets.facets.insert(
                    "outlook_reply_from_read".into(),
                    ActionFacetConfig {
                        display_name: "Reply".into(),
                        platform: None,
                        template: "Draft a reply.".into(),
                        allowed_args: vec!["item_identity".into()],
                        client_actions: proposal.actions.iter().map(|a| a.to_string()).collect(),
                        presentation: Some("auto_prompt".into()),
                        client_actions_always_ask: proposal
                            .always_ask
                            .iter()
                            .map(|a| a.to_string())
                            .collect(),
                        grant_scope: Default::default(),
                        tool_call_allowlist: vec![],
                        delegation: None,
                    },
                );
                Some(json!({"id":"outlook_reply_from_read","args":{"item_identity":"item-1"}}))
            }
            None => action_facet,
        };
        let state = test_app_state(config, pool).await;
        let chat_id = seed_origin_chat(&state.db).await;
        let chat = Self {
            state,
            _mock: mock,
            recorder,
            chat_id,
            registered: options.registered,
            action_facet,
            answers: Mutex::new(VecDeque::from(answers)),
            dispatched: Mutex::new(Vec::new()),
            answered: Mutex::new(HashSet::new()),
            events: Vec::new(),
        };
        if let Some(decision) = options.decision {
            chat.store_decision("word/apply_document_plan", decision)
                .await;
        }
        if let Some(decision) = proposal_decision {
            chat.store_decision("outlook/open_reply", decision).await;
        }
        chat
    }

    fn binding() -> String {
        json!({"device_id":"pane-one","realm":"office-addin","host_context":{"kind":"word_document","identity":"c".repeat(64)}}).to_string()
    }

    fn server(&self) -> TestServer {
        app_server(self.state.clone())
    }

    async fn store_decision(&self, tool: &str, decision: &str) {
        self.server()
            .put("/api/v1beta/me/profile/preferences")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({"client_tool_decisions":{tool:decision}}))
            .await
            .assert_status_ok();
    }

    fn take_events(&mut self, response: &axum_test::TestResponse) {
        self.events.extend(
            parse_sse_events(response)
                .into_iter()
                .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok()),
        );
    }

    async fn submit(&mut self) {
        let mut body =
            json!({"existing_chat_id":self.chat_id,"user_message":"Change ALPHA-7 to BRAVO-9"});
        if let Some(facet) = &self.action_facet {
            body["action_facet"] = facet.clone();
        }
        let response = self
            .answering(
                self.server()
                    .post("/api/v1beta/me/messages/submitstream")
                    .with_bearer_token(TEST_JWT_TOKEN)
                    .add_header("X-Erato-Client-Tools", self.registered)
                    .json(&body)
                    .into_future(),
            )
            .await;
        response.assert_status_ok();
        self.take_events(&response);
    }

    async fn message(&self) -> erato::db::entity::messages::Model {
        Messages::find()
            .filter(erato::db::entity::messages::Column::ChatId.eq(self.chat_id))
            .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
            .all(&self.state.db)
            .await
            .unwrap()
            .into_iter()
            .rfind(|row| row.raw_message["role"] == "assistant")
            .expect("assistant row")
    }

    /// The open stop of the answer, when it waits for a decision.
    async fn stop(&self) -> Option<Value> {
        let message = self.message().await;
        let last = message.raw_message["content"].as_array()?.last()?.clone();
        (last["content_type"] == "tool_approval_request").then_some(last)
    }

    /// Answers the open stop's only item with `decision` and its extras.
    async fn decide(&mut self, mut item: Value) -> axum_test::TestResponse {
        let stop = self.stop().await.expect("an open stop");
        let message_id = self.message().await.id;
        item["approval_id"] = stop["approvals"][0]["approval_id"].clone();
        let response = self
            .answering(
                self.server()
                    .post("/api/v1beta/me/messages/continuestream")
                    .with_bearer_token(TEST_JWT_TOKEN)
                    .add_header("X-Erato-Client-Tools", self.registered)
                    .json(&json!({"message_id":message_id,"decisions":[item]}))
                    .into_future(),
            )
            .await;
        if response.status_code() == http::StatusCode::OK {
            self.take_events(&response);
        }
        response
    }

    /// Every tool-enabled model request, title generation left out.
    fn requests(&self) -> Vec<Value> {
        self.recorder
            .bodies()
            .iter()
            .map(|body| serde_json::from_str::<Value>(body).unwrap())
            .filter(|body| body.get("tools").is_some())
            .collect()
    }

    fn dispatched(&self) -> Vec<(String, String, Value)> {
        self.dispatched.lock().unwrap().clone()
    }

    fn dispatched_names(&self) -> Vec<String> {
        self.dispatched()
            .into_iter()
            .map(|(name, _, _)| name)
            .collect()
    }

    fn answers_left(&self) -> usize {
        self.answers.lock().unwrap().len()
    }
}

impl Chat {
    /// Runs `request` while answering every client call of the chat's
    /// generations in order, keyed by generation so a call asked again after a
    /// decision is answered again.
    async fn answering<T>(&self, request: impl std::future::Future<Output = T>) -> T {
        tokio::time::timeout(Duration::from_secs(30), async {
            tokio::select! {
                response = request => response,
                _ = self.respond() => unreachable!("the responder never ends"),
            }
        })
        .await
        .expect("the request did not finish")
    }

    async fn respond(&self) {
        let server = self.server();
        let chat_id = self.chat_id;
        loop {
            if let Some(task) = self.state.background_tasks.get_task(&chat_id).await {
                for event in task.get_event_history().await {
                    let StreamingEvent::ClientToolCall {
                        message_id,
                        tool_call_id,
                        tool_name,
                        input,
                        ..
                    } = event
                    else {
                        continue;
                    };
                    if !self
                        .answered
                        .lock()
                        .unwrap()
                        .insert((task.generation_id, tool_call_id.clone()))
                    {
                        continue;
                    }
                    self.dispatched.lock().unwrap().push((
                        tool_name.clone(),
                        tool_call_id.clone(),
                        input.unwrap_or(Value::Null),
                    ));
                    let next = self.answers.lock().unwrap().pop_front();
                    let Some(mut payload) = next else {
                        continue;
                    };
                    let object = payload.as_object_mut().unwrap();
                    let store_decision = object.remove("store_decision");
                    let stop_first = object.remove("stop_first").is_some();
                    if object.remove("no_answer").is_some() {
                        continue;
                    }
                    if let Some(decision) = store_decision {
                        server
                            .put("/api/v1beta/me/profile/preferences")
                            .with_bearer_token(TEST_JWT_TOKEN)
                            .json(&json!({"client_tool_decisions":{"word/apply_document_plan":decision}}))
                            .await
                            .assert_status_ok();
                    }
                    if stop_first {
                        server
                            .post("/api/v1beta/me/messages/abortstream")
                            .with_bearer_token(TEST_JWT_TOKEN)
                            .json(&json!({"chat_id":chat_id}))
                            .await
                            .assert_status_ok();
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    }
                    payload["chat_id"] = json!(chat_id);
                    payload["message_id"] = json!(message_id);
                    payload["tool_call_id"] = json!(tool_call_id);
                    server
                        .post("/api/v1beta/me/messages/clienttoolresult")
                        .with_bearer_token(TEST_JWT_TOKEN)
                        .json(&payload)
                        .await
                        .assert_status_ok();
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
}

fn parts(message: &erato::db::entity::messages::Model) -> Vec<Value> {
    message.raw_message["content"].as_array().unwrap().clone()
}

fn tool_use<'a>(parts: &'a [Value], call: &str) -> &'a Value {
    parts
        .iter()
        .find(|part| {
            part["content_type"] == "tool_use"
                && part["tool_call_id"]
                    .as_str()
                    .is_some_and(|id| id.ends_with(&format!(":{call}")))
        })
        .unwrap_or_else(|| panic!("no tool use for {call}: {parts:?}"))
}

fn has_tool_use(parts: &[Value], call: &str) -> bool {
    parts.iter().any(|part| {
        part["content_type"] == "tool_use"
            && part["tool_call_id"]
                .as_str()
                .is_some_and(|id| id.ends_with(&format!(":{call}")))
    })
}

fn offered(request: &Value) -> Vec<String> {
    request["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["function"]["name"].as_str().unwrap().to_string())
        .collect()
}

/// The index of the request message answering `call`.
fn response_index(request: &Value, call: &str) -> usize {
    request["messages"]
        .as_array()
        .unwrap()
        .iter()
        .position(|message| message["role"] == "tool" && message["tool_call_id"] == call)
        .unwrap_or_else(|| panic!("no response to {call}"))
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_single_clean_change_applies_and_ends_without_another_request(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false))],
        vec![receipt(), applied()],
        Options::default(),
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.requests().len(), 1);
    assert!(!offered(&chat.requests()[0]).contains(&APPLY.to_string()));
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY]);
    let dispatched = chat.dispatched();
    assert_eq!(
        dispatched[0].2,
        json!({"snapshot":"s1"}),
        "the host never sees more_changes"
    );
    assert!(dispatched[1].1.ends_with(":call_one.apply"));
    assert!(
        dispatched[1].2["proposal_call_id"]
            .as_str()
            .unwrap()
            .ends_with(":call_one")
    );
    assert_eq!(dispatched[1].2["draft_id"], "draft-1");
    assert_eq!(dispatched[1].2["confirmation"], Value::Null);
    let message = chat.message().await;
    let parts = parts(&message);
    let submission = tool_use(&parts, "call_one");
    assert_eq!(submission["input"], json!({"snapshot":"s1"}));
    assert!(
        submission["output"]["apply"]["call_id"]
            .as_str()
            .unwrap()
            .ends_with(".apply")
    );
    let apply = tool_use(&parts, "call_one.apply");
    assert_eq!(apply["tool_name"], APPLY);
    assert_eq!(apply["output"]["result"]["status"], "applied");
    assert_eq!(apply["output"]["changes_left"], 4);
    assert_eq!(
        message.generation_metadata.unwrap()["submission_outcome"]["status"],
        "accepted"
    );
    assert!(chat.stop().await.is_none());
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn more_changes_continues_with_the_apply_as_a_pair_of_its_own(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(true)), Step::Text("SECOND_STEP")],
        vec![receipt(), applied()],
        Options::default(),
    )
    .await;
    chat.submit().await;
    let requests = chat.requests();
    assert_eq!(requests.len(), 2);
    let messages = requests[1]["messages"].as_array().unwrap();
    let at = response_index(&requests[1], "call_one");
    let submission = messages[at]["content"].as_str().unwrap();
    assert!(!submission.contains("LARGE PLAN BODY"), "{submission}");
    assert!(!submission.contains("approval_preview"), "{submission}");
    assert!(submission.contains("draft-1"));
    assert_eq!(messages[at + 1]["role"], "assistant");
    let provider_id = messages[at + 1]["tool_calls"][0]["id"].as_str().unwrap();
    assert_eq!(
        Some(provider_id.to_string()),
        erato::services::chained_apply::provider_call_id("call_one.apply")
    );
    assert!(
        provider_id.len() == 9 && provider_id.chars().all(|c| c.is_ascii_alphanumeric()),
        "every provider takes the made-up id: {provider_id}"
    );
    assert_eq!(messages[at + 1]["tool_calls"][0]["function"]["name"], APPLY);
    assert_eq!(messages[at + 2]["tool_call_id"], provider_id);
    let result: Value =
        serde_json::from_str(messages[at + 2]["content"].as_str().unwrap()).unwrap();
    assert_eq!(result["result"]["status"], "applied");
    assert_eq!(result["changes_left"], 4);
    let stored = tool_use(&parts(&chat.message().await), "call_one").clone();
    assert!(
        stored["output"]["result"]["plan"].is_object(),
        "the stored output stays complete"
    );
}

async fn continues_after(pool: Pool<Postgres>, result: Value) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false)), Step::Text("EXPLAINED")],
        vec![receipt(), result],
        Options::default(),
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.requests().len(), 2);
    assert!(
        !chat
            .events
            .iter()
            .any(|event| event.to_string().contains(UNEXPECTED))
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_failed_apply_continues(pool: Pool<Postgres>) {
    continues_after(pool, apply_result("failed")).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_stale_apply_continues(pool: Pool<Postgres>) {
    continues_after(pool, apply_result("stale")).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_apply_that_asks_for_a_follow_up_continues(pool: Pool<Postgres>) {
    continues_after(
        pool,
        json!({"result":{"status":"applied","verified":false,"needs_follow_up":true}}),
    )
    .await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn ask_parks_the_chained_call_and_approve_applies_before_any_request(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false))],
        vec![receipt(), applied()],
        Options {
            decision: None,
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    let stop = chat.stop().await.expect("a write asks by default");
    assert_eq!(stop["kind"], "client_tool");
    assert_eq!(stop["tool_name"], APPLY);
    assert_eq!(stop["mcp_server_id"], "word");
    assert_eq!(stop["allow_always"], true);
    assert_eq!(stop["display"]["title"], "Change “Vertrag.docx”");
    assert_eq!(
        stop["display"]["description"],
        "Updates 1 of 4 sections: § 2"
    );
    let item = &stop["approvals"][0];
    assert!(
        item["tool_call_id"]
            .as_str()
            .unwrap()
            .ends_with(":call_one.apply")
    );
    assert!(
        item["follows"]["proposal_call_id"]
            .as_str()
            .unwrap()
            .ends_with(":call_one")
    );
    assert_eq!(item["follows"]["decide_on_screen"], false);
    assert_eq!(chat.dispatched_names(), [SUBMIT]);
    chat.decide(json!({"decision":"approve"}))
        .await
        .assert_status_ok();
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY]);
    assert_eq!(chat.requests().len(), 1);
    let parts = parts(&chat.message().await);
    assert_eq!(
        tool_use(&parts, "call_one.apply")["output"]["result"]["status"],
        "applied"
    );
    assert!(chat.stop().await.is_none());
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn cancel_ends_without_a_request(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false))],
        vec![receipt()],
        Options {
            decision: Some("ask"),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    chat.decide(json!({"decision":"reject"}))
        .await
        .assert_status_ok();
    assert_eq!(chat.requests().len(), 1);
    assert_eq!(chat.dispatched_names(), [SUBMIT]);
    let parts = parts(&chat.message().await);
    assert_eq!(
        tool_use(&parts, "call_one.apply")["output"]["status"],
        "rejected"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn cancel_of_one_step_of_several_asks_the_model_once(pool: Pool<Postgres>) {
    one_step_of_several_declined(pool, "reject").await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_on_one_step_of_several_asks_the_model_once(pool: Pool<Postgres>) {
    one_step_of_several_declined(pool, "reject_always").await;
}

async fn one_step_of_several_declined(pool: Pool<Postgres>, decision: &str) {
    let mut chat = Chat::new(
        pool,
        vec![
            submit("call_one", Some(true)),
            Step::Text("SAID_WHAT_IS_LEFT"),
        ],
        vec![receipt()],
        Options {
            decision: Some("ask"),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    chat.decide(json!({"decision":decision}))
        .await
        .assert_status_ok();
    assert_eq!(
        chat.requests().len(),
        1,
        "the closing request offers no tools"
    );
    let note = erato::services::chained_apply::DECLINED_REMAINING_CHANGES_NOTE;
    let closing: Vec<Value> = chat
        .recorder
        .bodies()
        .iter()
        .map(|body| serde_json::from_str::<Value>(body).unwrap())
        .filter(|body| body.to_string().contains(note))
        .collect();
    assert_eq!(closing.len(), 1);
    let last = closing[0]["messages"].as_array().unwrap().last().unwrap();
    assert_eq!(last["role"], "user");
    assert_eq!(last["content"], note);
    assert!(
        chat.events
            .iter()
            .any(|event| event.to_string().contains("SAID_WHAT_IS_LEFT"))
    );
    assert!(
        !chat
            .events
            .iter()
            .any(|event| event.to_string().contains(UNEXPECTED))
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn withdraw_ends_without_a_request(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(true))],
        vec![receipt()],
        Options {
            decision: Some("ask"),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    chat.decide(json!({"decision":"withdraw"}))
        .await
        .assert_status_ok();
    assert_eq!(chat.requests().len(), 1);
    assert_eq!(chat.dispatched_names(), [SUBMIT]);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_change_request_replans_and_the_next_apply_asks_under_always(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![
            submit("call_one", Some(false)),
            submit("call_two", Some(false)),
        ],
        vec![receipt(), receipt(), applied()],
        Options {
            decision: Some("ask"),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    chat.store_decision("word/apply_document_plan", "always_allow")
        .await;
    chat.decide(json!({"decision":"request_change","change_request":"Use BRAVO-10 instead"}))
        .await
        .assert_status_ok();
    assert_eq!(chat.requests().len(), 2);
    assert!(chat.requests()[1].to_string().contains("BRAVO-10"));
    let stop = chat.stop().await.expect("the corrected change asks");
    assert!(
        stop["approvals"][0]["tool_call_id"]
            .as_str()
            .unwrap()
            .ends_with(":call_two.apply")
    );
    assert_eq!(stop["allow_always"], true);
    chat.decide(json!({"decision":"approve"}))
        .await
        .assert_status_ok();
    assert_eq!(chat.dispatched_names(), [SUBMIT, SUBMIT, APPLY]);
    assert_eq!(chat.requests().len(), 2);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_confirmation_reaches_only_a_chained_approval(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false))],
        vec![receipt(), applied()],
        Options {
            decision: Some("ask"),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    chat.decide(json!({"decision":"reject","client_confirmation":{"tick":true}}))
        .await
        .assert_status(http::StatusCode::BAD_REQUEST);
    chat.decide(json!({"decision":"approve","client_confirmation":{"rows":"x".repeat(5000)}}))
        .await
        .assert_status(http::StatusCode::BAD_REQUEST);
    chat.decide(json!({"decision":"approve","client_confirmation":{"whole_document":true}}))
        .await
        .assert_status_ok();
    let dispatched = chat.dispatched();
    assert_eq!(
        dispatched[1].2["confirmation"],
        json!({"whole_document":true})
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_card_decided_on_screen_asks_under_always_and_refuses_a_standing_allow(
    pool: Pool<Postgres>,
) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false))],
        vec![
            receipt_with(json!({"title":"Replace the document","decide_on_screen":true})),
            applied(),
        ],
        Options::default(),
    )
    .await;
    chat.submit().await;
    let stop = chat.stop().await.expect("on-screen card asks under Always");
    assert_eq!(stop["allow_always"], false);
    assert_eq!(stop["approvals"][0]["follows"]["decide_on_screen"], true);
    chat.decide(json!({"decision":"approve_always"}))
        .await
        .assert_status(http::StatusCode::BAD_REQUEST);
    chat.decide(json!({"decision":"approve"}))
        .await
        .assert_status_ok();
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY]);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_tick_found_while_writing_asks_again_once_without_a_request(pool: Pool<Postgres>) {
    let needs = json!({"result":{"status":"needs_decision","reason":"whole_document"}});
    let mut chat = Chat::new(
        pool,
        vec![
            submit("call_one", Some(false)),
            Step::Text("EXPLAINED_FAILURE"),
        ],
        vec![receipt(), needs.clone(), needs],
        Options::default(),
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.requests().len(), 1);
    let stop = chat.stop().await.expect("parked again");
    assert_eq!(stop["allow_always"], false);
    assert_eq!(stop["approvals"][0]["follows"]["decide_on_screen"], true);
    assert_eq!(stop["approvals"][0]["follows"]["reason"], "whole_document");
    assert!(!has_tool_use(
        &parts(&chat.message().await),
        "call_one.apply"
    ));
    chat.decide(json!({"decision":"approve","client_confirmation":{"whole_document":true}}))
        .await
        .assert_status_ok();
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY, APPLY]);
    assert_eq!(
        chat.dispatched()[2].2["confirmation"],
        json!({"whole_document":true})
    );
    assert_eq!(
        chat.requests().len(),
        2,
        "a second tick request fails and continues"
    );
    let parts = parts(&chat.message().await);
    let apply = tool_use(&parts, "call_one.apply");
    assert_eq!(apply["output"]["result"]["status"], "failed");
    assert_eq!(apply["output"]["result"]["reason"], "needs_decision_again");
    assert_eq!(
        apply["output"]["changes_left"], 4,
        "the tick's second run is the same change"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_hides_the_change_tools(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![Step::Text("CHANGES_ARE_OFF")],
        vec![],
        Options {
            decision: Some("never_allow"),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    let tools = offered(&chat.requests()[0]);
    assert!(tools.contains(&READ.to_string()));
    assert!(!tools.contains(&SUBMIT.to_string()));
    assert!(!tools.contains(&APPLY.to_string()));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn never_saved_while_the_answer_runs_refuses_the_apply(pool: Pool<Postgres>) {
    let mut accepted = receipt();
    accepted["store_decision"] = json!("never_allow");
    let mut chat = Chat::new(
        pool,
        vec![
            submit("call_one", Some(false)),
            Step::Text("SAID_CHANGES_ARE_OFF"),
        ],
        vec![accepted],
        Options::default(),
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.dispatched_names(), [SUBMIT]);
    assert_eq!(chat.requests().len(), 2);
    let parts = parts(&chat.message().await);
    assert_eq!(
        tool_use(&parts, "call_one.apply")["output"]["status"],
        "rejected"
    );
    assert_eq!(
        chat.message().await.generation_parameters.unwrap()["turn_consumption"]["chained_applies_run"],
        1,
        "a refused apply counts toward max_calls_per_message"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn every_call_asks_under_always_and_offers_no_always(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![Step::Tools(vec![(
            "call_fix",
            FIX,
            json!({"snapshot":"s1"}),
        )])],
        vec![json!({"result":{"status":"applied"}})],
        Options::default(),
    )
    .await;
    chat.store_decision("word/fix_text", "always_allow").await;
    chat.submit().await;
    let stop = chat.stop().await.expect("every call asks");
    assert_eq!(stop["tool_name"], FIX);
    assert_eq!(stop["allow_always"], false);
    chat.decide(json!({"decision":"approve_always"}))
        .await
        .assert_status(http::StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn every_call_on_the_apply_tool_asks_under_always(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false))],
        vec![receipt(), applied()],
        Options {
            apply_approval: ClientToolApproval::EveryCall,
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    let stop = chat.stop().await.expect("every call asks");
    assert_eq!(stop["allow_always"], false);
    chat.decide(json!({"decision":"approve"}))
        .await
        .assert_status_ok();
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY]);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn approval_none_runs_unasked(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![
            Step::Tools(vec![("call_fix", FIX, json!({"snapshot":"s1"}))]),
            Step::Text("FIXED"),
        ],
        vec![json!({"result":{"status":"applied"}})],
        Options {
            fix_approval: ClientToolApproval::None,
            ..Default::default()
        },
    )
    .await;
    chat.store_decision("word/fix_text", "ask").await;
    chat.submit().await;
    assert!(chat.stop().await.is_none());
    assert_eq!(chat.dispatched_names(), [FIX]);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn without_a_registered_apply_tool_the_answer_ends_as_today(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(true))],
        vec![receipt()],
        Options {
            registered: "read_document_blocks,submit_document_plan",
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.requests().len(), 1);
    assert_eq!(chat.dispatched_names(), [SUBMIT]);
    assert_eq!(chat.dispatched()[0].2, json!({"snapshot":"s1"}));
    let parts = parts(&chat.message().await);
    let submission = tool_use(&parts, "call_one");
    assert_eq!(submission["input"], json!({"snapshot":"s1"}));
    assert!(submission["output"].get("apply").is_none());
    assert!(!has_tool_use(&parts, "call_one.apply"));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_required_nullable_more_changes_is_checked_then_kept_from_the_host(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", None)],
        vec![receipt(), applied()],
        Options {
            submit_parameters: Some(json!({"type":"object","properties":{"snapshot":{"type":"string"},"more_changes":{"type":["boolean","null"]}},"required":["snapshot","more_changes"],"additionalProperties":false})),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY]);
    assert_eq!(chat.dispatched()[0].2, json!({"snapshot":"s1"}));
    assert_eq!(chat.requests().len(), 1);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn stop_during_the_apply_records_its_result_and_ends(pool: Pool<Postgres>) {
    let mut result = applied();
    result["stop_first"] = json!(true);
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(true))],
        vec![receipt(), result],
        Options::default(),
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.requests().len(), 1);
    let message = chat.message().await;
    assert_eq!(
        tool_use(&parts(&message), "call_one.apply")["output"]["result"]["status"],
        "applied"
    );
    assert_eq!(message.generation_metadata.unwrap()["was_aborted"], true);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_cap_counts_every_apply_and_refuses_the_next_submission(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![
            submit("call_one", Some(true)),
            submit("call_two", Some(true)),
            submit("call_three", Some(true)),
            Step::Text("SAID_WHAT_IS_LEFT"),
        ],
        vec![
            receipt(),
            apply_result("stale"),
            receipt(),
            apply_result("failed"),
        ],
        Options {
            max_calls_per_message: 2,
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY, SUBMIT, APPLY]);
    let requests = chat.requests();
    assert_eq!(requests.len(), 4);
    let refusal = &requests[3]["messages"][response_index(&requests[3], "call_three")]["content"];
    assert!(
        refusal.as_str().unwrap().contains("the most allowed"),
        "{refusal}"
    );
    assert_eq!(chat.answers_left(), 0);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_tool_call_limit_counts_the_whole_answer(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![
            read("call_read_one"),
            submit("call_one", Some(true)),
            read("call_read_two"),
            submit("call_two", Some(true)),
            read("call_read_three"),
        ],
        vec![
            read_result(),
            receipt(),
            applied(),
            read_result(),
            receipt(),
            applied(),
        ],
        Options {
            budget: 2,
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    assert_eq!(
        chat.dispatched_names(),
        [READ, SUBMIT, APPLY, READ, SUBMIT, APPLY]
    );
    let stop = chat.stop().await.expect("the limit card");
    assert_eq!(stop["kind"], "tool_call_limit");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn submissions_past_the_cap_count_toward_the_tool_call_limit(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![
            submit("call_one", Some(true)),
            submit("call_two", Some(true)),
            submit("call_three", Some(true)),
            submit("call_four", Some(true)),
        ],
        vec![receipt(), applied()],
        Options {
            max_calls_per_message: 1,
            budget: 2,
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY]);
    assert_eq!(chat.requests().len(), 4);
    let stop = chat.stop().await.expect("the limit card");
    assert_eq!(stop["kind"], "tool_call_limit");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_chain_survives_an_approval_park(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![
            submit("call_one", Some(true)),
            submit("call_two", Some(true)),
            Step::Text("SAID_WHAT_IS_LEFT"),
        ],
        vec![receipt(), applied()],
        Options {
            decision: Some("ask"),
            max_calls_per_message: 1,
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    chat.decide(json!({"decision":"approve"}))
        .await
        .assert_status_ok();
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY]);
    let message = chat.message().await;
    let consumption = &message.generation_parameters.unwrap()["turn_consumption"];
    assert_eq!(consumption["chained_applies_run"], 1);
    assert_eq!(consumption["chained_applies"].as_object().unwrap().len(), 1);
    assert_eq!(chat.requests().len(), 3);
    assert!(chat.requests()[2].to_string().contains("the most allowed"));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_continuation_replays_the_submission_as_the_model_sent_it(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![
            Step::Tools(vec![(
                "call_one",
                SUBMIT,
                json!({"more_changes":true,"snapshot":"s1"}),
            )]),
            Step::Text("SECOND_STEP"),
        ],
        vec![receipt(), applied()],
        Options {
            decision: Some("ask"),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    chat.decide(json!({"decision":"approve"}))
        .await
        .assert_status_ok();
    assert_eq!(chat.dispatched()[0].2, json!({"snapshot":"s1"}));
    let requests = chat.requests();
    assert_eq!(requests.len(), 2);
    let call = requests[1]["messages"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|message| {
            message["tool_calls"]
                .as_array()
                .cloned()
                .unwrap_or_default()
        })
        .find(|call| call["id"] == "call_one")
        .expect("the submission call");
    assert_eq!(
        call["function"]["arguments"],
        json!({"more_changes":true,"snapshot":"s1"}).to_string()
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn reads_of_the_replaced_copy_reach_the_next_request_as_receipts(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![
            read("call_read_one"),
            submit("call_one", Some(true)),
            Step::Text("SECOND_STEP"),
        ],
        vec![read_result(), receipt(), applied()],
        Options::default(),
    )
    .await;
    chat.submit().await;
    let requests = chat.requests();
    assert_eq!(requests.len(), 3);
    let at = response_index(&requests[1], "call_read_one");
    assert_eq!(
        requests[1]["messages"].as_array().unwrap()[..at],
        requests[2]["messages"].as_array().unwrap()[..at],
        "the prompt up to the replaced read is unchanged"
    );
    let before = requests[1]["messages"][at]["content"].as_str().unwrap();
    assert!(before.contains("FULL DOCUMENT TEXT"));
    let after = requests[2]["messages"][at]["content"].as_str().unwrap();
    assert!(!after.contains("FULL DOCUMENT TEXT"), "{after}");
    assert!(after.contains("omitted_from_replay"));
    let stored = tool_use(&parts(&chat.message().await), "call_read_one").clone();
    assert!(
        stored.to_string().contains("FULL DOCUMENT TEXT"),
        "the stored read stays complete"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_facet_that_always_asks_for_the_action_asks_under_always(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false))],
        vec![receipt(), applied()],
        Options {
            always_ask: Some(vec!["word.apply_document_plan"]),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    let stop = chat.stop().await.expect("the facet asks every time");
    assert_eq!(stop["allow_always"], false);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_facet_asks_only_for_the_actions_a_change_uses(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false))],
        vec![
            receipt_with(json!({"title":"Add a comment","actions":["word.add_comments"]})),
            applied(),
        ],
        Options {
            apply_actions: vec!["word.add_comments", "word.modify_comments"],
            always_ask: Some(vec!["word.modify_comments"]),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    assert!(chat.stop().await.is_none());
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY]);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn unknown_actions_count_as_every_action(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false))],
        vec![
            receipt_with(json!({"title":"Change comments","actions":["word.something_else"]})),
            applied(),
        ],
        Options {
            apply_actions: vec!["word.add_comments", "word.modify_comments"],
            always_ask: Some(vec!["word.modify_comments"]),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    assert!(chat.stop().await.is_some());
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn without_a_facet_that_asks_the_same_change_runs(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false))],
        vec![receipt(), applied()],
        Options {
            always_ask: Some(vec![]),
            ..Default::default()
        },
    )
    .await;
    chat.submit().await;
    assert!(chat.stop().await.is_none());
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY]);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_facets_list_the_apply_tools_they_reach(pool: Pool<Postgres>) {
    let chat = Chat::new(pool, vec![Step::Text("UNUSED")], vec![], Options::default()).await;
    let response = chat
        .server()
        .get("/api/v1beta/me/facets")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let listed = response.json::<Value>()["approval_tools"].clone();
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["qualified_name"], "word/apply_document_plan");
    assert_eq!(listed[0]["title"], "Apply the checked plan");
    assert_eq!(listed[0]["approval"], "user_decision");
    assert_eq!(
        (
            &listed[0]["label"]["action"],
            &listed[0]["label"]["object_kind"]
        ),
        (&json!("update"), &json!("document")),
        "a client names the change in the user's language from the label"
    );
}

async fn serve(state: &erato::state::AppState) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/api/v1beta", listener.local_addr().unwrap());
    let app = router(state.clone())
        .split_for_parts()
        .0
        .with_state(state.clone());
    (
        base,
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        }),
    )
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn only_the_pane_that_owns_the_turn_gets_the_apply(pool: Pool<Postgres>) {
    let chat = Chat::new(
        pool,
        vec![submit("call_one", Some(false))],
        vec![receipt(), applied()],
        Options {
            shared_transport: true,
            ..Default::default()
        },
    )
    .await;
    let server = chat.server();
    let submit = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .add_header("X-Erato-Client-Tools", REGISTERED)
        .add_header("X-Erato-Executor", Chat::binding())
        .json(&json!({"existing_chat_id":chat.chat_id,"user_message":"Change ALPHA-7"}))
        .into_future();
    let other_device = async {
        while chat
            .state
            .background_tasks
            .get_task(&chat.chat_id)
            .await
            .is_none()
        {
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        server
            .post("/api/v1beta/me/messages/resumestream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({"chat_id":chat.chat_id}))
            .await
    };
    let (owner, other) = chat
        .answering(async { tokio::join!(submit, other_device) })
        .await;
    owner.assert_status_ok();
    other.assert_status_ok();
    let calls = |response: &axum_test::TestResponse| {
        parse_sse_events(response)
            .into_iter()
            .filter_map(|event| serde_json::from_str::<Value>(&event.data).ok())
            .filter(|event| event["message_type"] == "client_tool_call")
            .map(|event| event["tool_name"].as_str().unwrap().to_string())
            .collect::<Vec<_>>()
    };
    assert_eq!(calls(&owner), [SUBMIT, APPLY]);
    assert!(calls(&other).is_empty(), "{:?}", calls(&other));
    assert_eq!(chat.dispatched_names(), [SUBMIT, APPLY]);
    let parts = parts(&chat.message().await);
    assert_eq!(
        tool_use(&parts, "call_one.apply")["output"]["result"]["status"],
        "applied"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_closed_pane_ends_the_answer_within_the_reconnect_grace(pool: Pool<Postgres>) {
    let chat = Chat::new(
        pool,
        vec![submit("call_one", Some(true))],
        vec![receipt(), json!({"no_answer":true})],
        Options {
            shared_transport: true,
            apply_timeout_ms: 60_000,
            ..Default::default()
        },
    )
    .await;
    let (base, server) = serve(&chat.state).await;
    let started = std::time::Instant::now();
    chat.answering(async {
        let response = reqwest::Client::new()
            .post(format!("{base}/me/messages/submitstream"))
            .bearer_auth(TEST_JWT_TOKEN)
            .header("Accept", "text/event-stream")
            .header("X-Erato-Client-Tools", REGISTERED)
            .header("X-Erato-Executor", Chat::binding())
            .json(&json!({"existing_chat_id":chat.chat_id,"user_message":"Change ALPHA-7"}))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let stream = response.bytes_stream();
        while !chat.dispatched_names().contains(&APPLY.to_string()) {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        drop(stream);
        loop {
            let message = chat.message().await;
            if has_tool_use(&parts(&message), "call_one.apply") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    assert!(
        started.elapsed() < Duration::from_secs(40),
        "the grace ends it, not the 60 s call timeout"
    );
    let parts = parts(&chat.message().await);
    assert_eq!(
        tool_use(&parts, "call_one.apply")["output"],
        json!({"status":"cancelled","reason":"pane_gone","changes_left":4})
    );
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        chat.requests().len(),
        1,
        "nobody is there to read an explanation"
    );
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_model_cannot_call_the_apply_tool_itself(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![
            Step::Tools(vec![(
                "call_forged",
                APPLY,
                json!({"proposal_call_id":"call_other","draft_id":null,"confirmation":null}),
            )]),
            Step::Text("COULD_NOT"),
        ],
        vec![applied()],
        Options::default(),
    )
    .await;
    chat.submit().await;
    assert!(chat.dispatched_names().is_empty());
    assert_eq!(chat.requests().len(), 2);
    let parts = parts(&chat.message().await);
    assert_eq!(tool_use(&parts, "call_forged")["output"]["status"], "error");
}

fn propose(id: &'static str, action: &str) -> Step {
    Step::Tools(vec![(id, PROPOSE, json!({ "action": action }))])
}

fn proposal_options(decision: Option<&'static str>, always_ask: Vec<&'static str>) -> Options {
    Options {
        registered: OPEN_REPLY,
        decision: None,
        proposal: Some(ProposalFacet {
            actions: vec!["outlook.reply", "outlook.reply_all"],
            always_ask,
            decision,
        }),
        ..Default::default()
    }
}

fn opened() -> Value {
    json!({"result":{"status":"applied"}})
}

fn proposed_actions(request: &Value) -> Vec<String> {
    request["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["function"]["name"] == PROPOSE)
        .map(|tool| {
            tool["function"]["parameters"]["properties"]["action"]["enum"]
                .as_array()
                .unwrap()
                .iter()
                .map(|action| action.as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_proposed_action_asks_and_approve_carries_it_out_without_another_request(
    pool: Pool<Postgres>,
) {
    let mut chat = Chat::new(
        pool,
        vec![propose("call_p", "outlook.reply")],
        vec![opened()],
        proposal_options(None, vec![]),
    )
    .await;
    chat.submit().await;
    assert!(!offered(&chat.requests()[0]).contains(&OPEN_REPLY.to_string()));
    let stop = chat.stop().await.expect("the action asks by default");
    assert_eq!(stop["kind"], "client_tool");
    assert_eq!(stop["tool_name"], OPEN_REPLY);
    assert_eq!(stop["mcp_server_id"], "outlook");
    assert_eq!(stop["allow_always"], true);
    assert_eq!(stop["display"]["title"], "Open a reply to the email");
    let item = &stop["approvals"][0];
    assert!(
        item["chained"]["submission_call_id"]
            .as_str()
            .unwrap()
            .ends_with(":call_p")
    );
    let parts_before = parts(&chat.message().await);
    let proposal = tool_use(&parts_before, "call_p");
    assert_eq!(proposal["output"]["status"], "proposed");
    assert!(
        proposal["output"]["apply"]["call_id"]
            .as_str()
            .unwrap()
            .ends_with(":call_p.apply")
    );
    assert!(chat.dispatched().is_empty());
    chat.decide(json!({"decision":"approve"}))
        .await
        .assert_status_ok();
    let dispatched = chat.dispatched();
    assert_eq!(chat.dispatched_names(), [OPEN_REPLY]);
    assert!(dispatched[0].1.ends_with(":call_p.apply"));
    assert!(
        dispatched[0].2["proposal_call_id"]
            .as_str()
            .unwrap()
            .ends_with(":call_p")
    );
    assert_eq!(dispatched[0].2["action"], "outlook.reply");
    assert_eq!(
        dispatched[0].2["item_identity"], "item-1",
        "the send-time identity of the open item travels with the call"
    );
    assert_eq!(chat.requests().len(), 1, "a clean action ends the answer");
    let parts = parts(&chat.message().await);
    let apply = tool_use(&parts, "call_p.apply");
    assert_eq!(apply["tool_name"], OPEN_REPLY);
    assert_eq!(apply["output"]["result"]["status"], "applied");
    assert!(apply["output"].get("changes_left").is_none());
    assert!(chat.stop().await.is_none());
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_rejected_proposal_carries_out_nothing_and_ends(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![propose("call_p", "outlook.reply")],
        vec![],
        proposal_options(Some("ask"), vec![]),
    )
    .await;
    chat.submit().await;
    chat.decide(json!({"decision":"reject"}))
        .await
        .assert_status_ok();
    assert!(chat.dispatched().is_empty());
    assert_eq!(chat.requests().len(), 1);
    let parts = parts(&chat.message().await);
    assert_eq!(
        tool_use(&parts, "call_p.apply")["output"]["status"],
        "rejected"
    );
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_action_no_tool_carries_out_keeps_todays_flow(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![propose("call_p", "outlook.reply_all"), Step::Text("DONE")],
        vec![],
        proposal_options(Some("always_allow"), vec![]),
    )
    .await;
    chat.submit().await;
    assert!(chat.stop().await.is_none());
    assert!(chat.dispatched().is_empty());
    assert_eq!(chat.requests().len(), 2, "the model goes on as today");
    let parts = parts(&chat.message().await);
    let proposal = tool_use(&parts, "call_p");
    assert_eq!(
        proposal["output"],
        json!({"status":"proposed","action":"outlook.reply_all"})
    );
    assert!(!has_tool_use(&parts, "call_p.apply"));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_old_pane_without_the_tool_keeps_todays_flow(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![propose("call_p", "outlook.reply"), Step::Text("DONE")],
        vec![],
        Options {
            registered: READ,
            ..proposal_options(Some("always_allow"), vec![])
        },
    )
    .await;
    chat.submit().await;
    assert!(chat.dispatched().is_empty());
    assert_eq!(chat.requests().len(), 2);
    assert!(!has_tool_use(&parts(&chat.message().await), "call_p.apply"));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn always_allow_carries_out_the_action_at_once(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![propose("call_p", "outlook.reply")],
        vec![opened()],
        proposal_options(Some("always_allow"), vec!["outlook.reply_all"]),
    )
    .await;
    chat.submit().await;
    assert!(
        chat.stop().await.is_none(),
        "the facet asks every time only for reply all"
    );
    assert_eq!(chat.dispatched_names(), [OPEN_REPLY]);
    assert_eq!(chat.requests().len(), 1);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_facet_that_always_asks_for_the_proposed_action_asks_under_always(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![propose("call_p", "outlook.reply")],
        vec![opened()],
        proposal_options(Some("always_allow"), vec!["outlook.reply"]),
    )
    .await;
    chat.submit().await;
    let stop = chat.stop().await.expect("the facet asks every time");
    assert_eq!(stop["allow_always"], false);
    assert!(chat.dispatched().is_empty());
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_failed_action_goes_back_to_the_model(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![propose("call_p", "outlook.reply"), Step::Text("EXPLAINED")],
        vec![json!({"result":{"status":"unavailable","reason":"other_item"}})],
        proposal_options(Some("always_allow"), vec![]),
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.requests().len(), 2);
    let messages = chat.requests()[1]["messages"].clone();
    assert!(messages.to_string().contains("other_item"));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_proposal_of_an_action_turned_off_is_refused_with_a_reason(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![propose("call_p", "outlook.reply"), Step::Text("TOLD")],
        vec![],
        proposal_options(Some("never_allow"), vec![]),
    )
    .await;
    chat.submit().await;
    assert_eq!(
        proposed_actions(&chat.requests()[0]),
        ["outlook.reply", "outlook.reply_all"],
        "a turned-off action is not swapped for another"
    );
    assert!(chat.dispatched().is_empty());
    assert_eq!(chat.requests().len(), 2);
    let parts = parts(&chat.message().await);
    assert_eq!(tool_use(&parts, "call_p")["output"]["status"], "turned_off");
    assert!(!has_tool_use(&parts, "call_p.apply"));
    assert!(chat.requests()[1].to_string().contains("turned off"));
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_change_request_on_a_proposal_lets_the_model_propose_again(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![
            propose("call_p", "outlook.reply"),
            propose("call_q", "outlook.reply"),
        ],
        vec![opened()],
        proposal_options(Some("ask"), vec![]),
    )
    .await;
    chat.submit().await;
    chat.decide(json!({"decision":"request_change","change_request":"Make it more formal"}))
        .await
        .assert_status_ok();
    assert_eq!(chat.requests().len(), 2);
    assert!(chat.requests()[1].to_string().contains("more formal"));
    let parts_before = parts(&chat.message().await);
    assert_eq!(
        tool_use(&parts_before, "call_q")["output"]["status"],
        "proposed"
    );
    let stop = chat.stop().await.expect("the changed proposal asks");
    assert!(
        stop["approvals"][0]["tool_call_id"]
            .as_str()
            .unwrap()
            .ends_with(":call_q.apply")
    );
    chat.decide(json!({"decision":"approve"}))
        .await
        .assert_status_ok();
    assert_eq!(chat.dispatched_names(), [OPEN_REPLY]);
    assert_eq!(chat.requests().len(), 2);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_clean_action_in_a_batch_runs_the_rest_then_ends_without_a_request(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![Step::Tools(vec![
            ("call_p", PROPOSE, json!({"action":"outlook.reply"})),
            ("call_r", READ, json!({"snapshot":"s1"})),
        ])],
        vec![opened(), read_result()],
        Options {
            registered: "open_reply,read_document_blocks",
            ..proposal_options(Some("always_allow"), vec![])
        },
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.dispatched_names()[0], OPEN_REPLY);
    assert!(has_tool_use(&parts(&chat.message().await), "call_r"));
    assert_eq!(chat.requests().len(), 1, "the answer ends after the batch");
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn several_versions_for_the_user_to_pick_end_without_a_request(pool: Pool<Postgres>) {
    let mut chat = Chat::new(
        pool,
        vec![propose("call_p", "outlook.reply")],
        vec![json!({"result":{"status":"unavailable","reason":"user_picks"}})],
        proposal_options(Some("always_allow"), vec![]),
    )
    .await;
    chat.submit().await;
    assert_eq!(chat.dispatched_names(), [OPEN_REPLY]);
    assert_eq!(chat.requests().len(), 1);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_facets_list_the_actions_a_tool_carries_out(pool: Pool<Postgres>) {
    let chat = Chat::new(
        pool,
        vec![Step::Text("UNUSED")],
        vec![],
        proposal_options(None, vec![]),
    )
    .await;
    let response = chat
        .server()
        .get("/api/v1beta/me/facets")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let listed = response.json::<Value>()["approval_tools"].clone();
    let reply = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["qualified_name"] == "outlook/open_reply")
        .expect("the facet reaches the reply tool through its action");
    assert_eq!(reply["client_actions"], json!(["outlook.reply"]));
}
