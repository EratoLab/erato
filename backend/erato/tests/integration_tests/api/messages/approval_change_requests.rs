//! Change requests on a waiting approval: the user neither allows nor denies
//! the call but asks for it to be different. The call is not run, the model
//! is told so with the user's words, and the corrected call's card names the
//! one it replaces.

use super::*;
use erato::models::user_tool_approval_setting::{UserToolDecision, upsert_active};
use mock_mcp_server::RECORD_ID;

const ASK: &str = "Set the record to Done";

/// The messages the model was sent, from a recorded request body.
fn sent_messages(body: &str) -> Vec<Value> {
    serde_json::from_str::<Value>(body).unwrap()["messages"]
        .as_array()
        .unwrap()
        .clone()
}

fn update(call_id: &str, status: &str) -> Vec<BodyAction> {
    build_openai_tool_calls_streaming_response(&[(
        call_id,
        "update_record",
        json!({"id": RECORD_ID, "status": status}),
    )])
}

async fn park(server: &TestServer) -> (Uuid, Uuid) {
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": ASK }))
        .await;
    response.assert_status_ok();
    let events = parse_sse_events(&response);
    let chat_id = Uuid::parse_str(&extract_chat_id(&events).unwrap()).unwrap();
    let message_id = Uuid::parse_str(&assistant_message_id_from_events(&events)).unwrap();
    (chat_id, message_id)
}

const ONE: &str = "CHANGE-ONE nimm stattdessen Review";
const TWO: &str = "CHANGE-TWO doch lieber Approved";

/// `{approval_id, decision: request_change, change_request}` for `message_id`.
async fn ask_for_change(
    server: &TestServer,
    message_id: Uuid,
    approval_id: &str,
    words: &str,
) -> axum_test::TestResponse {
    server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": message_id,
            "decisions": [{
                "approval_id": approval_id,
                "decision": "request_change",
                "change_request": words,
            }],
        }))
        .await
}

fn stops(content: &[Value]) -> Vec<&Value> {
    content
        .iter()
        .filter(|part| part["content_type"] == "tool_approval_request")
        .collect()
}

fn own_item(stop: &Value) -> &Value {
    &stop["approvals"][0]
}

/// The record is updated only by a call that ran: the server answers
/// `record <id> updated to <status>`.
fn ran_with(bodies: &[String], status: &str) -> bool {
    let needle = format!("updated to {status}");
    bodies.iter().any(|body| body.contains(&needle))
}

/// The user asks twice for the waiting update to be different. Each time the
/// call is not run, the model reads the user's words as its result and makes
/// a corrected call, and the corrected card names the one it replaces. Only
/// the card the user finally allows runs.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_change_request_leads_to_a_corrected_card_that_names_the_one_it_replaces(
    pool: Pool<Postgres>,
) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&["updated to"], &[]))
                .matcher(recorder);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&["DONE"]));
        });
    }
    for (contains, excludes, call, status) in [
        (TWO, "updated to", "call_fix_two", "Approved"),
        (ONE, "CHANGE-TWO", "call_fix_one", "Review"),
        (ASK, "CHANGE-ONE", "call_update", "Done"),
    ] {
        let recorder = recorder.clone();
        let contains: &'static str = contains;
        let excludes: &'static str = excludes;
        let actions = update(call, status);
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[contains], &[excludes]))
                .matcher(recorder.clone());
            mock_llm_sse_response(then, actions.clone());
        });
    }
    let app_state = records_app_state(pool, mocks).await;
    let server = app_server(app_state.clone());
    let (_chat_id, message_id) = park(&server).await;
    let first = own_item(stops(&message_content(&app_state, message_id).await)[0]).clone();

    ask_for_change(
        &server,
        message_id,
        first["approval_id"].as_str().unwrap(),
        ONE,
    )
    .await
    .assert_status_ok();
    let content = message_content(&app_state, message_id).await;
    let types: Vec<&str> = content
        .iter()
        .map(|part| part["content_type"].as_str().unwrap())
        .collect();
    assert_eq!(
        types,
        [
            "tool_approval_request",
            "tool_rejection",
            "tool_use",
            "tool_approval_request"
        ]
    );
    let rejection = &content[1];
    assert_eq!(rejection["reason"], "change_requested");
    assert_eq!(rejection["change_request"], ONE);
    assert_eq!(rejection["never_allow"], false);
    let result = &content[2];
    assert_eq!(result["tool_call_id"], first["tool_call_id"]);
    assert_eq!(result["status"], "error");
    assert_eq!(result["output"]["status"], "change_requested");
    assert_eq!(result["output"]["user_request"], ONE);
    assert_eq!(
        result["output"]["note"],
        erato::config::ApprovalChangeRequestsConfig::default().note
    );
    let second = own_item(stops(&content)[1]).clone();
    assert_eq!(second["input"]["status"], "Review");
    assert_eq!(second["replaces_approval_id"], first["approval_id"]);

    // What the model read for the withdrawn call: a tool result holding the
    // note and the user's words as separate fields.
    let bodies = recorder.bodies();
    let messages = sent_messages(bodies.last().unwrap());
    let tool_result = messages
        .iter()
        .rev()
        .find(|message| message["role"] == "tool")
        .expect("the withdrawn call's result");
    let read: Value = serde_json::from_str(tool_result["content"].as_str().unwrap()).unwrap();
    assert_eq!(read["status"], "change_requested");
    assert_eq!(read["user_request"], ONE);

    ask_for_change(
        &server,
        message_id,
        second["approval_id"].as_str().unwrap(),
        TWO,
    )
    .await
    .assert_status_ok();
    let content = message_content(&app_state, message_id).await;
    let third = own_item(stops(&content)[2]).clone();
    assert_eq!(third["input"]["status"], "Approved");
    assert_eq!(third["replaces_approval_id"], second["approval_id"]);

    let approved = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": message_id,
            "decisions": [{"approval_id": third["approval_id"], "decision": "approve"}],
        }))
        .await;
    approved.assert_status_ok();
    assert_eq!(extract_full_text(&parse_sse_events(&approved)), "DONE");
    let bodies = recorder.bodies();
    assert!(ran_with(&bodies, "Approved"));
    assert!(
        !ran_with(&bodies, "Done") && !ran_with(&bodies, "Review"),
        "a call the user asked to change never runs"
    );
}

/// Past `max_rounds` the change request still withdraws the call, but the
/// model answers without tools, so the turn ends with a sentence.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_change_request_past_the_limit_ends_the_turn(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let limit_note = "LIMIT-NOTE answer without tools";
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&["LIMIT-NOTE"], &[]))
                .matcher(recorder);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&["ENDED"]));
        });
    }
    answers_with(
        &mut mocks,
        &[ONE],
        &["LIMIT-NOTE"],
        update("call_fix_one", "Review"),
    );
    answers_with(
        &mut mocks,
        &[ASK],
        &["CHANGE-ONE"],
        update("call_update", "Done"),
    );
    let app_state = records_app_state_with(pool, mocks, |config| {
        config.approval_change_requests.max_rounds = 1;
        config.approval_change_requests.limit_note = limit_note.into();
    })
    .await;
    let server = app_server(app_state.clone());
    let (_chat_id, message_id) = park(&server).await;
    let first = own_item(stops(&message_content(&app_state, message_id).await)[0]).clone();
    ask_for_change(
        &server,
        message_id,
        first["approval_id"].as_str().unwrap(),
        ONE,
    )
    .await
    .assert_status_ok();
    let second = own_item(stops(&message_content(&app_state, message_id).await)[1]).clone();

    let ended = ask_for_change(
        &server,
        message_id,
        second["approval_id"].as_str().unwrap(),
        TWO,
    )
    .await;
    ended.assert_status_ok();
    assert_eq!(extract_full_text(&parse_sse_events(&ended)), "ENDED");
    let body: Value = serde_json::from_str(&recorder.bodies()[0]).unwrap();
    assert!(
        body["tools"].as_array().is_none_or(Vec::is_empty),
        "the limit's answer is made without tools: {}",
        body["tools"]
    );
    let content = message_content(&app_state, message_id).await;
    assert_eq!(stops(&content).len(), 2, "no further card");
    let rejections: Vec<_> = content
        .iter()
        .filter(|part| part["content_type"] == "tool_rejection")
        .collect();
    assert_eq!(rejections.len(), 2);
    assert!(
        rejections
            .iter()
            .all(|part| part["reason"] == "change_requested")
    );
    assert_eq!(content.last().unwrap()["content_type"], "text");
}

/// A question back, another tool, several calls: the new card, if any, is an
/// ordinary card that replaces nothing.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_answer_other_than_one_corrected_call_replaces_nothing(pool: Pool<Postgres>) {
    let question = build_openai_text_streaming_response(&["Welcher Status genau?"]);
    let gizmo = build_openai_tool_calls_streaming_response(&[(
        "call_gizmo",
        "update_gizmo",
        json!({"id": RECORD_ID, "status": "Review"}),
    )]);
    let several = build_openai_tool_calls_streaming_response(&[
        (
            "call_fix_a",
            "update_record",
            json!({"id": RECORD_ID, "status": "Review"}),
        ),
        (
            "call_fix_b",
            "update_record",
            json!({"id": RECORD_ID, "status": "Approved"}),
        ),
    ]);
    for (case, answer) in [
        ("question", question),
        ("other tool", gizmo),
        ("several", several),
    ] {
        let mut mocks = MockSet::new();
        answers_with(&mut mocks, &[ONE], &[], answer);
        answers_with(
            &mut mocks,
            &[ASK],
            &["CHANGE-ONE"],
            update("call_update", "Done"),
        );
        let app_state = records_app_state(pool.clone(), mocks).await;
        let server = app_server(app_state.clone());
        let (_chat_id, message_id) = park(&server).await;
        let first = own_item(stops(&message_content(&app_state, message_id).await)[0]).clone();
        ask_for_change(
            &server,
            message_id,
            first["approval_id"].as_str().unwrap(),
            ONE,
        )
        .await
        .assert_status_ok();
        let content = message_content(&app_state, message_id).await;
        let stops = stops(&content);
        match case {
            "question" => {
                assert_eq!(stops.len(), 1, "{case}");
                assert_eq!(content.last().unwrap()["content_type"], "text", "{case}");
            }
            _ => {
                assert_eq!(stops.len(), 2, "{case}");
                assert!(
                    stops[1]["approvals"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .all(|item| item.get("replaces_approval_id").is_none()),
                    "{case}: {}",
                    stops[1]
                );
            }
        }
    }
}

/// The model's batch asked about two updates; the user asks for the first to
/// change. The second, queued behind the first card, is still asked about on
/// its own card and is no replacement. Once it is decided, the model makes
/// the corrected call, and that card replaces the first.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_queued_call_stays_to_be_decided_after_a_change_request(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    answers_with(
        &mut mocks,
        &[ONE, "updated to Approved"],
        &[],
        update("call_fix", "Review"),
    );
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[ASK], &["CHANGE-ONE"]))
                .matcher(recorder);
            mock_llm_sse_response(
                then,
                build_openai_tool_calls_streaming_response(&[
                    (
                        "call_a",
                        "update_record",
                        json!({"id": RECORD_ID, "status": "Done"}),
                    ),
                    (
                        "call_b",
                        "update_record",
                        json!({"id": RECORD_ID, "status": "Approved"}),
                    ),
                ]),
            );
        });
    }
    let app_state = records_app_state(pool, mocks).await;
    let server = app_server(app_state.clone());
    let (_chat_id, message_id) = park(&server).await;
    let content = message_content(&app_state, message_id).await;
    let first_stop = stops(&content)[0].clone();
    assert_eq!(
        first_stop["pending_tool_calls"].as_array().unwrap().len(),
        1
    );
    let first = own_item(&first_stop).clone();

    ask_for_change(
        &server,
        message_id,
        first["approval_id"].as_str().unwrap(),
        ONE,
    )
    .await
    .assert_status_ok();
    let content = message_content(&app_state, message_id).await;
    let queued = own_item(stops(&content)[1]).clone();
    assert_eq!(queued["input"]["status"], "Approved");
    assert!(queued.get("replaces_approval_id").is_none(), "{queued}");

    server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "message_id": message_id, "decision": "approve" }))
        .await
        .assert_status_ok();
    let content = message_content(&app_state, message_id).await;
    let corrected = own_item(stops(&content)[2]).clone();
    assert_eq!(corrected["input"]["status"], "Review");
    assert_eq!(corrected["replaces_approval_id"], first["approval_id"]);
}

/// A change request without words, longer than allowed, in the legacy single
/// form, or words on another decision is refused before anything happens,
/// and the card still waits.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_malformed_change_request_is_refused_and_the_card_waits(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    answers_with(
        &mut mocks,
        &["updated to"],
        &[],
        build_openai_text_streaming_response(&["DONE"]),
    );
    answers_with(
        &mut mocks,
        &[ASK],
        &["updated to"],
        update("call_update", "Done"),
    );
    let app_state = records_app_state_with(pool, mocks, |config| {
        config.approval_change_requests.max_chars = 10;
    })
    .await;
    let server = app_server(app_state.clone());
    let (_chat_id, message_id) = park(&server).await;
    let first = own_item(stops(&message_content(&app_state, message_id).await)[0]).clone();
    let approval_id = first["approval_id"].as_str().unwrap();
    for body in [
        json!({"message_id": message_id, "decisions": [
            {"approval_id": approval_id, "decision": "request_change", "change_request": "  "}]}),
        json!({"message_id": message_id, "decisions": [
            {"approval_id": approval_id, "decision": "request_change"}]}),
        json!({"message_id": message_id, "decisions": [
            {"approval_id": approval_id, "decision": "request_change", "change_request": "elf Zeichen"}]}),
        json!({"message_id": message_id, "decision": "request_change"}),
        json!({"message_id": message_id, "decisions": [
            {"approval_id": approval_id, "decision": "approve", "change_request": "kurz"}]}),
    ] {
        let response = server
            .post("/api/v1beta/me/messages/continuestream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&body)
            .await;
        assert_eq!(
            response.status_code(),
            http::StatusCode::BAD_REQUEST,
            "{body}"
        );
    }
    let content = message_content(&app_state, message_id).await;
    assert_eq!(content.len(), 1, "the card still waits: {content:?}");
    ask_for_change(&server, message_id, approval_id, "zehn Zeich")
        .await
        .assert_status_ok();
}

/// A client that never sends `request_change` sees denials and withdrawals
/// exactly as before: the same result text, no new fields.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_denial_and_a_withdrawal_read_as_before(pool: Pool<Postgres>) {
    for (decision, reason) in [("reject", None), ("withdraw", Some("withdrawn"))] {
        let mut mocks = MockSet::new();
        answers_with(
            &mut mocks,
            &["The user denied this tool call."],
            &[],
            build_openai_text_streaming_response(&["AFTER"]),
        );
        answers_with(
            &mut mocks,
            &[ASK],
            &["denied"],
            update("call_update", "Done"),
        );
        let app_state = records_app_state(pool.clone(), mocks).await;
        let server = app_server(app_state.clone());
        let (_chat_id, message_id) = park(&server).await;
        let response = server
            .post("/api/v1beta/me/messages/continuestream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({ "message_id": message_id, "decision": decision }))
            .await;
        response.assert_status_ok();
        assert_eq!(extract_full_text(&parse_sse_events(&response)), "AFTER");
        let content = message_content(&app_state, message_id).await;
        assert_eq!(content[1]["content_type"], "tool_rejection");
        assert_eq!(content[1].get("reason").and_then(Value::as_str), reason);
        assert!(content[1].get("change_request").is_none());
        assert_eq!(
            content[2]["output"],
            json!({"status": "rejected", "error": "The user denied this tool call."})
        );
    }
}

/// The user changes the card on one device; another tab still shows the old
/// card and answers it the way a single card is answered, without naming it.
/// That answer cannot be meant for the corrected card, so it is refused as a
/// changed card and nothing runs; naming the corrected card works.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_unnamed_decision_on_a_corrected_card_is_refused(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = recorder.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&["updated to"], &[]))
                .matcher(recorder);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&["DONE"]));
        });
    }
    answers_with(
        &mut mocks,
        &[ONE],
        &["updated to"],
        update("call_fix_one", "Review"),
    );
    answers_with(
        &mut mocks,
        &[ASK],
        &["CHANGE-ONE"],
        update("call_update", "Done"),
    );
    let app_state = records_app_state(pool, mocks).await;
    let server = app_server(app_state.clone());
    let (_chat_id, message_id) = park(&server).await;
    let first = own_item(stops(&message_content(&app_state, message_id).await)[0]).clone();
    ask_for_change(
        &server,
        message_id,
        first["approval_id"].as_str().unwrap(),
        ONE,
    )
    .await
    .assert_status_ok();
    let corrected = own_item(stops(&message_content(&app_state, message_id).await)[1]).clone();
    assert_eq!(corrected["replaces_approval_id"], first["approval_id"]);

    for decision in ["approve", "reject", "withdraw"] {
        let stale = server
            .post("/api/v1beta/me/messages/continuestream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({ "message_id": message_id, "decision": decision }))
            .await;
        assert_eq!(
            stale.status_code(),
            http::StatusCode::CONFLICT,
            "{decision}"
        );
        assert_eq!(
            stale.json::<Value>(),
            json!({"code": "card_changed", "approval_id": corrected["approval_id"]})
        );
    }
    let content = message_content(&app_state, message_id).await;
    assert_eq!(
        content.last().unwrap(),
        stops(&content)[1],
        "the corrected card still waits"
    );
    assert!(recorder.bodies().is_empty(), "nothing ran");

    server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": message_id,
            "decisions": [{"approval_id": corrected["approval_id"], "decision": "approve"}],
        }))
        .await
        .assert_status_ok();
    assert!(ran_with(&recorder.bodies(), "Review"));
}

/// After a change request the first call the model makes asks, even for a
/// tool the user always allows: they are in the middle of deciding and
/// confirm the version that results. A read the policy never asks about
/// still runs at once.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_first_call_after_a_change_request_asks_even_when_always_allowed(pool: Pool<Postgres>) {
    const GIZMO_ASK: &str = "Set the gizmo to Done";
    const RECORD_INSTEAD: &str = "CHANGE-ONE nicht das Gizmo, den Record";
    const READ_FIRST: &str = "CHANGE-ONE lies erst den Record";
    let gizmo = build_openai_tool_calls_streaming_response(&[(
        "call_gizmo",
        "update_gizmo",
        json!({"id": RECORD_ID, "status": "Done"}),
    )]);
    for (words, answer) in [
        (RECORD_INSTEAD, update("call_record", "Done")),
        (
            READ_FIRST,
            build_openai_tool_calls_streaming_response(&[("call_read", "read_record", json!({}))]),
        ),
    ] {
        let recorder = RequestBodyRecorder::new();
        let mut mocks = MockSet::new();
        {
            let recorder = recorder.clone();
            mocks.mock(move |when, then| {
                when.post()
                    .path("/v1/chat/completions")
                    .matcher(BodyContainsMatcher::new(&["Quarterly plan"], &[]))
                    .matcher(recorder);
                mock_llm_sse_response(then, build_openai_text_streaming_response(&["READ"]));
            });
        }
        answers_with(&mut mocks, &["CHANGE-ONE"], &["Quarterly plan"], answer);
        answers_with(&mut mocks, &[GIZMO_ASK], &["CHANGE-ONE"], gizmo.clone());
        let app_state = records_app_state_with(pool.clone(), mocks, |config| {
            config.mcp_servers_global.approval.allow_always = true;
        })
        .await;
        let user = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
            .await
            .unwrap();
        upsert_active(
            &app_state.db,
            user.id,
            "records",
            "update_record",
            UserToolDecision::AlwaysAllow,
        )
        .await
        .unwrap();
        let server = app_server(app_state.clone());
        let response = server
            .post("/api/v1beta/me/messages/submitstream")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({ "user_message": GIZMO_ASK }))
            .await;
        response.assert_status_ok();
        let message_id = Uuid::parse_str(&assistant_message_id_from_events(&parse_sse_events(
            &response,
        )))
        .unwrap();
        let first = own_item(stops(&message_content(&app_state, message_id).await)[0]).clone();
        assert_eq!(first["tool_name"], "update_gizmo");

        ask_for_change(
            &server,
            message_id,
            first["approval_id"].as_str().unwrap(),
            words,
        )
        .await
        .assert_status_ok();
        let content = message_content(&app_state, message_id).await;
        let stops = stops(&content);
        if words == RECORD_INSTEAD {
            assert_eq!(
                stops.len(),
                2,
                "the always-allowed update asks: {content:?}"
            );
            let asked = own_item(stops[1]);
            assert_eq!(asked["tool_name"], "update_record");
            assert!(asked.get("replaces_approval_id").is_none(), "another tool");
            assert!(
                !content.iter().any(|part| part["content_type"] == "tool_use"
                    && part["tool_name"] == "update_record"),
                "it did not run"
            );
        } else {
            assert_eq!(stops.len(), 1, "a read runs without a card: {content:?}");
            let read = content
                .iter()
                .find(|part| {
                    part["content_type"] == "tool_use" && part["tool_name"] == "read_record"
                })
                .expect("the read ran");
            assert_eq!(read["status"], "success");
            assert_eq!(extract_full_text_from_content(&content), "READ");
        }
    }
}

fn extract_full_text_from_content(content: &[Value]) -> String {
    content
        .iter()
        .filter(|part| part["content_type"] == "text")
        .filter_map(|part| part["text"].as_str())
        .collect()
}

/// Deciding by voice: the phrase gets a receipt, the decision carries it and
/// the record is kept with the decision; a plain "ja" gets none, and a
/// receipt counts once and only for its card.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_approval_by_voice_needs_the_phrase_and_its_receipt(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    answers_with(
        &mut mocks,
        &["updated to"],
        &[],
        build_openai_text_streaming_response(&["DONE"]),
    );
    answers_with(
        &mut mocks,
        &[ASK],
        &["updated to"],
        update("call_update", "Done"),
    );
    let app_state = records_app_state_with(pool, mocks, |config| {
        config.approval_voice_commands.enabled = true;
        config.approval_voice_commands.decide_by_voice = true;
    })
    .await;
    let server = app_server(app_state.clone());
    let (_chat_id, message_id) = park(&server).await;
    let stop = stops(&message_content(&app_state, message_id).await)[0].clone();
    let approval_id = own_item(&stop)["approval_id"].as_str().unwrap().to_string();
    let pieces = json!([
        {"id": "what", "role": "what", "state": "heard"},
        {"id": "request", "role": "request", "state": "heard"},
    ]);
    let signals = json!({
        "voice_stopped_at_ms": 1_700_000_000_000u64,
        "request_heard_at_ms": 1_699_999_999_000u64,
        "recording_started_at_ms": 1_700_000_000_050u64,
        "recording_ended_at_ms": 1_700_000_002_000u64,
        "first_speech_at_ms": 1_700_000_000_600u64,
        "speech_ms": 900,
        "recorded_ms": 1_900,
    });
    let say = |transcript: &'static str, signals: Value| {
        let server = &server;
        let approval_id = approval_id.clone();
        let pieces = pieces.clone();
        async move {
            let response = server
                .post(&format!(
                    "/api/v1beta/me/messages/{message_id}/approval-voice-command"
                ))
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({
                    "transcript": transcript,
                    "language": "de",
                    "pieces": pieces,
                    "approval_id": approval_id,
                    "signals": signals,
                }))
                .await;
            response.assert_status_ok();
            response.json::<Value>()
        }
    };
    let decide = |receipt: Value| {
        let server = &server;
        let approval_id = approval_id.clone();
        async move {
            server
                .post("/api/v1beta/me/messages/continuestream")
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({
                    "message_id": message_id,
                    "decisions": [{
                        "approval_id": approval_id,
                        "decision": "approve",
                        "voice_receipt": receipt,
                    }],
                }))
                .await
        }
    };

    let yes = say("Ja, mach das.", signals.clone()).await;
    assert_eq!(yes["meaning"], "approve", "{yes}");
    assert_eq!(yes["decision"], json!({"status": "phrase_needed"}));
    let mut over = signals.clone();
    over["over_voice"] = json!(true);
    let over_voice = say("Ich bestätige.", over).await;
    assert_eq!(over_voice["decision"], json!({"status": "say_again"}));
    let not_asked = server
        .post(&format!(
            "/api/v1beta/me/messages/{message_id}/approval-voice-command"
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "transcript": "Ich bestätige.",
            "pieces": [{"id": "request", "role": "request", "state": "cut_short"}],
            "approval_id": approval_id,
            "signals": signals,
        }))
        .await
        .json::<Value>();
    // Before the card asked, the phrase is listening, as any yes.
    assert_eq!(not_asked["meaning"], "noise", "{not_asked}");
    assert!(not_asked.get("decision").is_none());
    let owed = server
        .post(&format!(
            "/api/v1beta/me/messages/{message_id}/approval-voice-command"
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "transcript": "Ich bestätige.",
            "pieces": [
                {"id": "loss", "role": "consequence", "state": "cut_short"},
                {"id": "request", "role": "request", "state": "heard"},
            ],
            "approval_id": approval_id,
            "signals": signals,
        }))
        .await
        .json::<Value>();
    assert_eq!(owed["decision"], json!({"status": "not_yet"}));
    let early = say(
        "Ich bestätige.",
        json!({
            "voice_stopped_at_ms": 1_700_000_000_000u64,
            "recording_started_at_ms": 1_700_000_000_050u64,
            "recording_ended_at_ms": 1_700_000_002_000u64,
            "first_speech_at_ms": 1_700_000_000_100u64,
            "speech_ms": 900,
            "recorded_ms": 1_900,
        }),
    )
    .await;
    assert_eq!(
        early["decision"],
        json!({"status": "say_again"}),
        "echo tail"
    );

    let confirmed = say("Ich bestätige.", signals.clone()).await;
    assert_eq!(confirmed["meaning"], "approve");
    assert_eq!(confirmed["decision"]["status"], "accepted", "{confirmed}");
    let receipt = confirmed["decision"]["receipt"].clone();
    // A made-up receipt, or one used up, is refused, and nothing runs.
    decide(json!("not-a-receipt"))
        .await
        .assert_status(axum::http::StatusCode::CONFLICT);
    decide(receipt.clone()).await.assert_status_ok();
    let content = message_content(&app_state, message_id).await;
    let approval = content
        .iter()
        .find(|part| part["content_type"] == "tool_approval")
        .expect("approved");
    let voice = &approval["voice"];
    assert_eq!(voice["outcome"], "approved", "{approval}");
    assert_eq!(voice["required_phrase"], "de.ich_bestaetige");
    assert_eq!(voice["matched_words"], "ich bestaetige");
    assert_eq!(voice["match_kind"], "exact");
    assert_eq!(voice["approval_id"], approval_id.as_str());
    assert_eq!(voice["speech_ms"], 900);
    assert_eq!(voice["answer_latency_ms"], 1_600);
    assert_eq!(
        voice["pieces"][1],
        json!({"id": "request", "role": "request", "state": "heard"})
    );
    // The receipt was taken.
    decide(receipt)
        .await
        .assert_status(axum::http::StatusCode::CONFLICT);
}
