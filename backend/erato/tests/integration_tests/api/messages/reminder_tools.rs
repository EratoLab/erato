//! Reminders by chat: the model creates, lists and cancels the same items as
//! the Scheduled page, through the same checks, and a created reminder comes
//! back with the confirmation card rendered from the stored item.

use super::*;
use chrono::{Datelike, Duration, NaiveDate, TimeZone, Weekday};
use erato::config::PromptSourceSpecification;
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
    let (mut config, llm) = setup_mock_llm_server_with_mocks(mocks).await;
    config.scheduled_deliveries.enabled = true;
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
/// that one through the shared cancel; the other stays.
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
