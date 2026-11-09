//! Reminders by chat: the model creates, lists and cancels the same items as
//! the Scheduled page, through the same checks, and a created reminder comes
//! back with the confirmation card rendered from the stored item.

use super::*;
use chrono::{Datelike, Duration, NaiveDate, TimeZone, Weekday};
use erato::config::{McpToolApprovalConfig, McpToolApprovalPreset, PromptSourceSpecification};
use erato::db::entity::prelude::ScheduledItems;
use erato::models::user_preference::record_client_locale;
use erato::services::scheduled_deliveries::{DeliveryRegistry, RecordingChannel};
use erato::services::scheduled_items::recurrence::{LocalTime, Trigger};
use erato::services::scheduled_items::{
    self, ItemRequest, ReminderProducer, ScheduledItemType, wording,
};
use erato::services::text_language::Lang;
use erato::state::AppState;
use sea_orm::{ConnectionTrait, DatabaseConnection, Statement};
use std::sync::Arc;

const BERLIN: chrono_tz::Tz = chrono_tz::Europe::Berlin;

/// A deployment that delivers reminders through Teams, the test user with
/// a stored zone and language, and a chat of theirs.
async fn setup(
    pool: Pool<Postgres>,
    mocks: MockSet,
    reachable: bool,
    language: &str,
) -> (AppState, TestServer, Uuid, Uuid, MockServer) {
    setup_with_approval(pool, mocks, reachable, language, None).await
}

/// `setup` with the tool approval gate on under `preset`.
async fn setup_with_approval(
    pool: Pool<Postgres>,
    mocks: MockSet,
    reachable: bool,
    language: &str,
    preset: Option<McpToolApprovalPreset>,
) -> (AppState, TestServer, Uuid, Uuid, MockServer) {
    let (mut config, llm) = setup_mock_llm_server_with_mocks(mocks).await;
    config.scheduled_deliveries.enabled = true;
    if let Some(preset) = preset {
        config.mcp_servers_global.approval = McpToolApprovalConfig {
            enabled: true,
            preset,
            allow_always: true,
        };
    }
    config
        .chat_providers
        .as_mut()
        .unwrap()
        .providers
        .get_mut("mock-llm")
        .unwrap()
        .system_prompt = Some(PromptSourceSpecification::Static {
        content: "It is now {{erato_inject_now_datetime}}.".into(),
    });
    let mut state = test_app_state(config, pool).await;
    let mut registry = DeliveryRegistry::new();
    registry.register_producer(Arc::new(ReminderProducer::new(None, "en")));
    registry.register_channel(Arc::new(RecordingChannel::new("teams_personal")));
    state.scheduled_deliveries = Arc::new(registry);
    let chat_id = seed_origin_chat(&state.db).await;
    let user_id = get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap()
        .id;
    record_client_locale(&state.db, &user_id, Some("Europe/Berlin"), Some(language))
        .await
        .unwrap();
    if reachable {
        personal_conversation(&state.db, user_id).await;
    }
    let server = app_server(state.clone());
    (state, server, user_id, chat_id, llm)
}

async fn personal_conversation(db: &DatabaseConnection, user_id: Uuid) {
    db.execute_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        "INSERT INTO ms_teams_conversations (conversation_id, conversation_type, user_id, service_url, ms_teams_user_id)
         VALUES ('a:personal', 'personal', $1, 'https://smba.example/', '29:user')",
        [user_id.into()],
    ))
    .await
    .unwrap();
}

/// The Friday at least two days ahead, so it is never today or tomorrow.
fn next_friday() -> NaiveDate {
    let mut day = Utc::now().with_timezone(&BERLIN).date_naive() + Duration::days(2);
    while day.weekday() != Weekday::Fri {
        day += Duration::days(1);
    }
    day
}

/// A model turn that calls one tool: once the request holds every `after`
/// call and not yet `call`'s own id.
fn tool_turn(mocks: &mut MockSet, after: &[&str], call: (&str, &str, Value)) {
    let (call_id, name, arguments) = call;
    let after: Vec<String> = after.iter().map(|id| id.to_string()).collect();
    let call_id = call_id.to_string();
    let name = name.to_string();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(
                &after.iter().map(String::as_str).collect::<Vec<_>>(),
                &[call_id.as_str()],
            ));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(&call_id, &name, arguments)]),
        );
    });
}

fn answer_turn(mocks: &mut MockSet, after: &str, text: &'static str) {
    let after = after.to_string();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[after.as_str()], &[]));
        mock_llm_sse_response(then, build_openai_text_streaming_response(&[text]));
    });
}

async fn send(server: &TestServer, chat_id: Uuid, text: &str) -> Vec<Value> {
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"existing_chat_id": chat_id, "user_message": text}))
        .await;
    response.assert_status_ok();
    parse_sse_events(&response)
        .into_iter()
        .filter_map(|event| serde_json::from_str(&event.data).ok())
        .collect()
}

/// The settled output of the reminder tool call `call_id`, from the stream.
fn tool_output(events: &[Value], call_id: &str) -> Value {
    events
        .iter()
        .rev()
        .find(|event| {
            event["message_type"] == "tool_call_update"
                && event["tool_call_id"]
                    .as_str()
                    .is_some_and(|id| id.ends_with(&format!(":{call_id}")))
                && !event["output"].is_null()
        })
        .unwrap_or_else(|| panic!("no output for {call_id} in {events:?}"))["output"]
        .clone()
}

async fn upcoming(server: &TestServer) -> Vec<Value> {
    let response = server
        .get("/api/v1beta/me/scheduled-items?tab=upcoming")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    response.json::<Value>()["items"]
        .as_array()
        .unwrap()
        .clone()
}

fn reminder(name: &str, date: NaiveDate, hour: u32) -> ItemRequest {
    ItemRequest {
        item_type: ScheduledItemType::Reminder,
        name: name.into(),
        message: format!("About {name}."),
        linked_chat_id: None,
        channel: "teams_personal".into(),
        trigger: Trigger::Once {
            date,
            time: LocalTime::new(hour, 0).unwrap(),
        },
    }
}

/// "Erinnere mich Freitag 10 Uhr an das Angebot": the item the form would
/// create, at 10:00 Berlin time, linked to the chat, shown on the Scheduled
/// page, with a German confirmation from the stored item. The model sees the
/// user's zone and today in the tool and the system prompt.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_reminder_created_in_chat_is_the_forms_item(pool: Pool<Postgres>) {
    let friday = next_friday();
    let first_request = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let recorder = first_request.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &["call_create"]))
            .matcher(recorder);
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[(
                "call_create",
                "create_reminder",
                json!({
                    "name": "Angebot nachfassen",
                    "message": "Beim Kunden wegen des Angebots nachfassen.",
                    "trigger": {"kind": "once", "date": friday, "time": "10:00"},
                }),
            )]),
        );
    });
    answer_turn(&mut mocks, "call_create", "Ist geplant.");
    let (state, server, user_id, chat_id, _llm) = setup(pool, mocks, true, "de-DE").await;

    let events = send(
        &server,
        chat_id,
        "Erinnere mich Freitag 10 Uhr an das Angebot",
    )
    .await;

    // The chat request, not the title summary's.
    let body: Value = first_request
        .bodies()
        .iter()
        .find(|body| body.contains("It is now"))
        .map(|body| serde_json::from_str(body).unwrap())
        .expect("the chat request reached the model");
    let tools: Vec<&str> = body["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["function"]["name"].as_str().unwrap())
        .collect();
    for name in ["create_reminder", "list_reminders", "cancel_reminder"] {
        assert!(tools.contains(&name), "{tools:?}");
    }
    let create = body["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["function"]["name"] == "create_reminder")
        .unwrap()["function"]["description"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(create.contains("Europe/Berlin"), "{create}");
    let system = body["messages"][0]["content"].as_str().unwrap();
    assert!(
        system.ends_with("+01:00.") || system.ends_with("+02:00."),
        "the system prompt's now is in the user's zone: {system}"
    );

    let output = tool_output(&events, "call_create");
    assert_eq!(output["status"], "created", "{output}");
    let at = BERLIN
        .from_local_datetime(&friday.and_hms_opt(10, 0, 0).unwrap())
        .unwrap()
        .with_timezone(&Utc);
    let when = wording::exact_when(at, BERLIN, Some(BERLIN), Utc::now(), Lang::De);
    assert!(
        when.starts_with("Freitag, ") && when.ends_with(", 10:00"),
        "{when}"
    );
    assert_eq!(
        output["confirmation"],
        json!({
            "item_id": output["reminder"]["id"],
            "language": "de",
            "heading": "Erinnerung geplant",
            "name": "Angebot nachfassen",
            "when": when,
            "repeats": null,
            "delivery": "Zustellung per Teams-Chat",
            "cancel_label": "Abbrechen",
            "open_scheduled_label": "In „Geplant“ öffnen",
            "scheduled_path": "/scheduled",
        })
    );
    assert_eq!(extract_answer(&events), "Ist geplant.");

    let items = upcoming(&server).await;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], output["reminder"]["id"]);
    assert_eq!(items[0]["name"], "Angebot nachfassen");
    assert_eq!(items[0]["time_zone"], "Europe/Berlin");
    assert_eq!(items[0]["channel"], "teams_personal");
    assert_eq!(
        items[0]["next_occurrence"]["local"],
        format!("{friday}T10:00:00")
    );
    assert_eq!(items[0]["linked_chat"]["id"], json!(chat_id));
    let stored = ScheduledItems::find_by_id(
        Uuid::parse_str(output["reminder"]["id"].as_str().unwrap()).unwrap(),
    )
    .one(&state.db)
    .await
    .unwrap()
    .unwrap();
    assert_eq!(stored.user_id, user_id);
    assert_eq!(stored.origin["via"], "chat");
    assert_eq!(stored.origin["chat_id"], json!(chat_id));

    let saved = Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
        .all(&state.db)
        .await
        .unwrap();
    let tool_use = saved
        .iter()
        .flat_map(|message| {
            message.raw_message["content"]
                .as_array()
                .cloned()
                .unwrap_or_default()
        })
        .find(|part| part["content_type"] == "tool_use" && part["tool_name"] == "create_reminder")
        .expect("the tool row is stored");
    assert_eq!(tool_use["status"], "success");
    assert_eq!(
        tool_use["output"]["confirmation"]["item_id"],
        output["reminder"]["id"]
    );
}

fn extract_answer(events: &[Value]) -> String {
    events
        .iter()
        .filter(|event| event["message_type"] == "text_delta")
        .filter_map(|event| event["new_text"].as_str())
        .collect()
}

/// "Welche Erinnerungen habe ich?" then "Lösch die für Freitag": the list
/// names each upcoming reminder with its id and time, and the cancel ends
/// that one through the shared cancel; the other stays. The approval gate is
/// off here, so the cancel runs without asking.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn reminders_are_listed_and_cancelled_in_chat(pool: Pool<Postgres>) {
    let (state, server, user_id, chat_id, llm) = setup(pool, MockSet::new(), true, "en-US").await;
    let friday = next_friday();
    let mut ids = Vec::new();
    for (name, date) in [
        ("Follow up on the offer", friday),
        ("Book the train", friday + Duration::days(3)),
    ] {
        let item = scheduled_items::create_checked(
            &state,
            user_id,
            reminder(name, date, 9),
            json!({"via": "web"}),
        )
        .await
        .unwrap()
        .unwrap();
        ids.push(item.id);
    }
    tool_turn(
        &mut llm.mocks(),
        &[],
        ("call_list", "list_reminders", json!({})),
    );
    tool_turn(
        &mut llm.mocks(),
        &["call_list"],
        (
            "call_cancel",
            "cancel_reminder",
            json!({"reminder_id": ids[0]}),
        ),
    );
    answer_turn(&mut llm.mocks(), "call_cancel", "Cancelled it.");

    let events = send(&server, chat_id, "Delete the one for Friday").await;

    let listed = tool_output(&events, "call_list");
    assert_eq!(listed["time_zone"], "Europe/Berlin");
    assert_eq!(listed["max_upcoming"], 10);
    let reminders = listed["reminders"].as_array().unwrap();
    assert_eq!(reminders.len(), 2, "{listed}");
    assert_eq!(reminders[0]["id"], json!(ids[0]));
    assert_eq!(reminders[0]["name"], "Follow up on the offer");
    assert_eq!(reminders[0]["next_local"], format!("{friday}T09:00:00"));
    assert!(
        reminders[0]["when"]
            .as_str()
            .unwrap()
            .starts_with("Friday, "),
        "{listed}"
    );
    let cancelled = tool_output(&events, "call_cancel");
    assert_eq!(cancelled["status"], "cancelled", "{cancelled}");

    let items = upcoming(&server).await;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], json!(ids[1]));
    let past = server
        .get("/api/v1beta/me/scheduled-items?tab=past")
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json::<Value>();
    assert_eq!(past["items"][0]["id"], json!(ids[0]));
    assert_eq!(past["items"][0]["status"], "cancelled");
}

/// The tools refuse what the form refuses, with the same codes and nothing
/// stored: no Teams chat with the bot yet, and the cap, whose refusal lists
/// the upcoming reminders.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn the_tools_refuse_what_the_form_refuses(pool: Pool<Postgres>) {
    let friday = next_friday();
    let mut mocks = MockSet::new();
    let create = json!({
        "name": "Call back",
        "message": "Call back about the offer.",
        "trigger": {"kind": "once", "date": friday, "time": "10:00"},
    });
    tool_turn(&mut mocks, &[], ("call_create", "create_reminder", create));
    answer_turn(&mut mocks, "call_create", "Could not.");
    let (state, server, user_id, chat_id, _llm) = setup(pool, mocks, false, "en-US").await;

    let events = send(&server, chat_id, "Remind me on Friday at 10").await;
    let refused = tool_output(&events, "call_create");
    assert_eq!(refused["status"], "refused");
    assert_eq!(refused["code"], "channel_not_set_up");
    assert!(upcoming(&server).await.is_empty());

    personal_conversation(&state.db, user_id).await;
    for day in 0..10 {
        scheduled_items::create_checked(
            &state,
            user_id,
            reminder(&format!("Reminder {day}"), friday + Duration::days(day), 9),
            json!({"via": "web"}),
        )
        .await
        .unwrap()
        .unwrap();
    }
    let second_chat = seed_origin_chat(&state.db).await;
    let events = send(&server, second_chat, "Remind me on Friday at 10").await;
    let refused = tool_output(&events, "call_create");
    assert_eq!(refused["code"], "limit_reached", "{refused}");
    assert_eq!(refused["upcoming"].as_array().unwrap().len(), 10);
    assert_eq!(refused["upcoming"][0]["name"], "Reminder 0");
    assert_eq!(upcoming(&server).await.len(), 10);
}

/// Without deliveries through Teams the tools are not offered at all.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn no_reminder_tools_without_a_delivery_channel(pool: Pool<Postgres>) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let seen = recorder.clone();
    mocks.mock(move |when, then| {
        when.post().path("/v1/chat/completions").matcher(seen);
        mock_llm_sse_response(then, build_openai_text_streaming_response(&["Hi."]));
    });
    let (config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    let state = test_app_state(config, pool).await;
    let chat_id = seed_origin_chat(&state.db).await;
    let server = app_server(state);
    send(&server, chat_id, "Remind me tomorrow").await;
    let bodies = recorder.bodies();
    assert!(
        bodies
            .iter()
            .any(|body| body.contains("Remind me tomorrow"))
    );
    for body in bodies {
        assert!(!body.contains("create_reminder"), "{body}");
    }
}

/// The assistant row the chat's turn parked on, and its approval request.
async fn parked(state: &AppState, chat_id: Uuid) -> (Uuid, Value) {
    let rows = Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
        .order_by_asc(erato::db::entity::messages::Column::CreatedAt)
        .all(&state.db)
        .await
        .unwrap();
    rows.iter()
        .rev()
        .find_map(|row| {
            let last = row.raw_message["content"].as_array()?.last()?.clone();
            (last["content_type"] == "tool_approval_request").then_some((row.id, last))
        })
        .expect("the turn parked on an approval")
}

async fn decide(
    server: &TestServer,
    message_id: Uuid,
    approval_id: &Value,
    decision: &str,
) -> Vec<Value> {
    let response = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": message_id,
            "decisions": [{"approval_id": approval_id, "decision": decision}],
        }))
        .await;
    response.assert_status_ok();
    parse_sse_events(&response)
        .into_iter()
        .filter_map(|event| serde_json::from_str(&event.data).ok())
        .collect()
}

/// A model turn that cancels the user's first reminder, then answers.
fn cancel_turns(mocks: &mut MockSet, reminder_id: Uuid) {
    tool_turn(
        mocks,
        &[],
        (
            "call_cancel",
            "cancel_reminder",
            json!({"reminder_id": reminder_id}),
        ),
    );
    answer_turn(mocks, "call_cancel", "Done.");
}

/// With approvals on, a cancel asked for by chat waits for the user: the card
/// names the reminder and when it arrives in the user's language, offers no
/// standing decision, and the cancel runs once approved.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_cancel_in_chat_asks_first_and_runs_once_approved(pool: Pool<Postgres>) {
    let (state, server, user_id, chat_id, llm) = setup_with_approval(
        pool,
        MockSet::new(),
        true,
        "de-DE",
        Some(McpToolApprovalPreset::Permissive),
    )
    .await;
    let friday = next_friday();
    let item = scheduled_items::create_checked(
        &state,
        user_id,
        reminder("Angebot nachfassen", friday, 10),
        json!({"via": "web"}),
    )
    .await
    .unwrap()
    .unwrap();
    cancel_turns(&mut llm.mocks(), item.id);

    send(&server, chat_id, "Lösch die für Freitag").await;

    let (message_id, request) = parked(&state, chat_id).await;
    assert_eq!(request["kind"], "builtin_tool", "{request}");
    assert_eq!(request["tool_name"], "cancel_reminder");
    assert_eq!(request["allow_always"], false);
    let at = BERLIN
        .from_local_datetime(&friday.and_hms_opt(10, 0, 0).unwrap())
        .unwrap()
        .with_timezone(&Utc);
    assert_eq!(
        request["approvals"][0]["display"],
        json!({
            "title": "Angebot nachfassen",
            "description": wording::exact_when(at, BERLIN, Some(BERLIN), Utc::now(), Lang::De),
            "description_truncated": false,
        })
    );
    assert_eq!(upcoming(&server).await.len(), 1, "nothing is cancelled yet");

    let approval_id = request["approvals"][0]["approval_id"].clone();
    let refused = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": message_id,
            "decisions": [{"approval_id": approval_id, "decision": "approve_always"}],
        }))
        .await;
    refused.assert_status(axum::http::StatusCode::BAD_REQUEST);

    let events = decide(&server, message_id, &approval_id, "approve").await;
    let cancelled = tool_output(&events, "call_cancel");
    assert_eq!(cancelled["status"], "cancelled", "{cancelled}");
    assert_eq!(extract_answer(&events), "Done.");
    assert!(upcoming(&server).await.is_empty());
}

/// A denied cancel changes nothing, and the model reads that the user said no.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_denied_cancel_leaves_the_reminder(pool: Pool<Postgres>) {
    let (state, server, user_id, chat_id, llm) = setup_with_approval(
        pool,
        MockSet::new(),
        true,
        "en-US",
        Some(McpToolApprovalPreset::Restrictive),
    )
    .await;
    let item = scheduled_items::create_checked(
        &state,
        user_id,
        reminder("Follow up on the offer", next_friday(), 9),
        json!({"via": "web"}),
    )
    .await
    .unwrap()
    .unwrap();
    cancel_turns(&mut llm.mocks(), item.id);

    send(&server, chat_id, "Delete the one for Friday").await;
    let (message_id, request) = parked(&state, chat_id).await;

    let events = decide(
        &server,
        message_id,
        &request["approvals"][0]["approval_id"],
        "reject",
    )
    .await;
    let denied = tool_output(&events, "call_cancel");
    assert_eq!(denied["status"], "rejected", "{denied}");
    assert_eq!(denied["error"], "The user denied this tool call.");
    let items = upcoming(&server).await;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], json!(item.id));
}

/// A cancel of an id that names no reminder of the user's changes nothing, so
/// it is not asked about: it is refused at once.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_cancel_with_nothing_to_cancel_is_not_asked_about(pool: Pool<Postgres>) {
    let (state, server, _user_id, chat_id, llm) = setup_with_approval(
        pool,
        MockSet::new(),
        true,
        "en-US",
        Some(McpToolApprovalPreset::Permissive),
    )
    .await;
    cancel_turns(&mut llm.mocks(), Uuid::new_v4());

    let events = send(&server, chat_id, "Delete the one for Friday").await;

    assert_eq!(tool_output(&events, "call_cancel")["code"], "not_found");
    assert_eq!(extract_answer(&events), "Done.");
    let rows = Messages::find()
        .filter(erato::db::entity::messages::Column::ChatId.eq(chat_id))
        .all(&state.db)
        .await
        .unwrap();
    assert!(rows.iter().all(|row| {
        !row.raw_message
            .to_string()
            .contains("tool_approval_request")
    }));
}

fn create_turns(mocks: &mut MockSet, friday: NaiveDate) {
    tool_turn(
        mocks,
        &[],
        (
            "call_create",
            "create_reminder",
            json!({
                "name": "Call back",
                "message": "Call back about the offer.",
                "trigger": {"kind": "once", "date": friday, "time": "10:00"},
            }),
        ),
    );
    answer_turn(mocks, "call_create", "Scheduled.");
}

/// Under the restrictive preset a create asks first and is stored once
/// approved, with its confirmation card.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_create_asks_under_the_restrictive_preset(pool: Pool<Postgres>) {
    let (state, server, _user_id, chat_id, llm) = setup_with_approval(
        pool,
        MockSet::new(),
        true,
        "en-US",
        Some(McpToolApprovalPreset::Restrictive),
    )
    .await;
    let friday = next_friday();
    create_turns(&mut llm.mocks(), friday);

    send(&server, chat_id, "Remind me on Friday at 10").await;
    let (message_id, request) = parked(&state, chat_id).await;
    assert_eq!(request["kind"], "builtin_tool");
    assert_eq!(request["tool_name"], "create_reminder");
    assert_eq!(request["approvals"][0]["display"]["title"], "Call back");
    assert!(
        request["approvals"][0]["display"]["description"]
            .as_str()
            .unwrap()
            .ends_with(", 10:00"),
        "{request}"
    );
    assert!(upcoming(&server).await.is_empty(), "nothing is stored yet");

    let events = decide(
        &server,
        message_id,
        &request["approvals"][0]["approval_id"],
        "approve",
    )
    .await;
    let created = tool_output(&events, "call_create");
    assert_eq!(created["status"], "created", "{created}");
    assert_eq!(created["confirmation"]["name"], "Call back");
    assert_eq!(upcoming(&server).await.len(), 1);
}

/// "Remind me in 90 minutes", approved later: the parked call already holds
/// the one-off its card names, so the reminder is stored at that time and not
/// moved by how long the user took to answer.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_approved_relative_create_stores_the_time_its_card_showed(pool: Pool<Postgres>) {
    let (state, server, _user_id, chat_id, llm) = setup_with_approval(
        pool,
        MockSet::new(),
        true,
        "en-US",
        Some(McpToolApprovalPreset::Restrictive),
    )
    .await;
    tool_turn(
        &mut llm.mocks(),
        &[],
        (
            "call_create",
            "create_reminder",
            json!({
                "name": "Stretch",
                "message": "Time to stretch.",
                "trigger": {"kind": "in", "minutes": 90},
            }),
        ),
    );
    answer_turn(&mut llm.mocks(), "call_create", "Scheduled.");

    send(&server, chat_id, "Remind me in 90 minutes to stretch").await;
    let (message_id, request) = parked(&state, chat_id).await;
    let input = &request["approvals"][0]["input"];
    assert_eq!(input["trigger"]["kind"], "once", "{request}");
    assert_eq!(request["input"], *input);
    assert_eq!(input["message"], "Time to stretch.");
    let date: NaiveDate = input["trigger"]["date"].as_str().unwrap().parse().unwrap();
    let time = input["trigger"]["time"].as_str().unwrap().to_string();
    let local = date.and_time(chrono::NaiveTime::parse_from_str(&time, "%H:%M").unwrap());
    let at = BERLIN
        .from_local_datetime(&local)
        .earliest()
        .unwrap()
        .with_timezone(&Utc);
    let minutes_ahead = (at - Utc::now()).num_minutes();
    assert!((89..=91).contains(&minutes_ahead), "{at}");
    assert_eq!(
        request["approvals"][0]["display"]["description"],
        wording::exact_when(at, BERLIN, Some(BERLIN), Utc::now(), Lang::En)
    );

    let events = decide(
        &server,
        message_id,
        &request["approvals"][0]["approval_id"],
        "approve",
    )
    .await;
    assert_eq!(tool_output(&events, "call_create")["status"], "created");
    let items = upcoming(&server).await;
    assert_eq!(items.len(), 1);
    assert_eq!(
        items[0]["next_occurrence"]["local"],
        format!("{date}T{time}:00")
    );
}

/// Under the permissive preset a create runs at once: its confirmation card
/// with Cancel is the check.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_create_runs_at_once_under_the_permissive_preset(pool: Pool<Postgres>) {
    let (_state, server, _user_id, chat_id, llm) = setup_with_approval(
        pool,
        MockSet::new(),
        true,
        "en-US",
        Some(McpToolApprovalPreset::Permissive),
    )
    .await;
    create_turns(&mut llm.mocks(), next_friday());

    let events = send(&server, chat_id, "Remind me on Friday at 10").await;

    assert_eq!(tool_output(&events, "call_create")["status"], "created");
    assert_eq!(extract_answer(&events), "Scheduled.");
    assert_eq!(upcoming(&server).await.len(), 1);
}

/// The same cancel by chat in Teams: the bot gets an approval card for it
/// rather than handing it to the app, and approving it there cancels.
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_cancel_in_teams_is_approved_in_teams(pool: Pool<Postgres>) {
    use erato::ms_teams_bot::activity::ConversationKind;
    use erato::ms_teams_bot::cards::{ApprovalChoice, ApprovalKind};
    use erato::ms_teams_bot::graph::GraphIdentity;
    use erato::ms_teams_bot::host::{Completion, GenerationUpdate, Host};

    async fn completion(mut updates: tokio::sync::mpsc::Receiver<GenerationUpdate>) -> Completion {
        let mut completion = None;
        while let Some(update) = updates.recv().await {
            match update {
                GenerationUpdate::Completed(done) => completion = Some(done),
                GenerationUpdate::Failed(error) => panic!("generation failed: {error}"),
                _ => {}
            }
        }
        completion.expect("generation completed")
    }

    let (state, _server, _web_user, _chat, llm) = setup_with_approval(
        pool,
        MockSet::new(),
        false,
        "en-US",
        Some(McpToolApprovalPreset::Permissive),
    )
    .await;
    let user = get_or_create_user(&state.db, "https://issuer.example", "teams-user", None)
        .await
        .unwrap();
    record_client_locale(&state.db, &user.id, Some("Europe/Berlin"), Some("en-US"))
        .await
        .unwrap();
    let host = Host::new(state.clone());
    let identity: GraphIdentity = serde_json::from_value(json!({
        "id": "4a1b3c5d-0000-4000-8000-00000000beef", "displayName": "Teams User",
    }))
    .unwrap();
    let session = host
        .session(
            &user,
            &identity,
            Vec::new(),
            "graph-token".into(),
            None,
            "tenant-1",
        )
        .await
        .unwrap();
    let row = host
        .upsert_conversation(
            "a:personal-reminders",
            ConversationKind::Personal,
            user.id,
            "https://smba.example/",
            "29:user",
        )
        .await
        .unwrap();
    let (chat_id, _) = host.ensure_chat(&session, &row, None).await.unwrap();
    let item = scheduled_items::create_checked(
        &state,
        user.id,
        reminder("Follow up on the offer", next_friday(), 9),
        json!({"via": "web"}),
    )
    .await
    .unwrap()
    .unwrap();
    cancel_turns(&mut llm.mocks(), item.id);

    let parked = completion(
        host.submit(
            &session,
            chat_id,
            "Delete the one for Friday".into(),
            Vec::new(),
        )
        .await
        .unwrap(),
    )
    .await;
    assert!(!parked.needs_client);
    let set = parked
        .approvals
        .expect("the cancel waits for an approval in Teams");
    assert_eq!(set.kind, ApprovalKind::BuiltinTool);
    assert_eq!(set.items.len(), 1);
    assert!(set.items[0].own_tool);
    assert_eq!(
        set.items[0].display.as_ref().unwrap().title,
        "Follow up on the offer"
    );
    let still = scheduled_items::get(&state.db, user.id, item.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        still.item.status,
        erato::db::entity::scheduled_items::ItemStatus::Active
    );

    let decisions = vec![(set.items[0].approval_id.clone(), ApprovalChoice::Approve)];
    let resumed = completion(
        host.continue_approval(&session, parked.message_id, decisions)
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(resumed.text, "Done.");
    let cancelled = scheduled_items::get(&state.db, user.id, item.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        cancelled.item.status,
        erato::db::entity::scheduled_items::ItemStatus::Cancelled
    );
}
