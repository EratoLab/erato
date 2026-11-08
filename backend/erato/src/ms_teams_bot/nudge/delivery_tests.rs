//! The Teams side of a tip: the card reaches the user's personal
//! conversation through the Connector, Connector refusals are mapped, and
//! installing the app records the conversation for known users. A user
//! reminder arrives as the committed sample card, and its buttons replace
//! the card in place.
use super::*;
use crate::config::AppConfig;
use crate::models::user::{get_or_create_user, record_entra_object_id};
use crate::models::user_preference::{record_client_locale, teams_nudges_opted_out};
use crate::ms_teams_bot::activity::{Activity, ConversationKind};
use crate::ms_teams_bot::handler::{on_bot_added, on_message, settle_delivered_card};
use crate::ms_teams_bot::streaming::ReplyTarget;
use crate::services::scheduled_deliveries::{
    ExecutorSettings, NewDelivery, run_delivery_tick, schedule,
};
use crate::services::scheduled_items::recurrence::{LocalTime, Trigger};
use crate::services::scheduled_items::{
    self, ItemInput, REMINDER, ReminderProducer, current_occurrence,
};
use crate::services::text_language::Lang;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::post,
};
use sqlx::ConnectOptions;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../sqitch/deploy");

/// What the fake Connector records and how it answers.
#[derive(Default)]
struct FakeConnector {
    outgoing: Vec<(String, Value)>,
    /// Replaced activities: conversation, activity id, new activity.
    updated: Vec<(String, String, Value)>,
    answer: Option<(u16, Value)>,
}

type Shared = Arc<std::sync::Mutex<FakeConnector>>;

async fn connector_reply(
    State(shared): State<Shared>,
    Path(conversation): Path<String>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let mut fake = shared.lock().unwrap();
    fake.outgoing.push((conversation, body));
    match fake.answer.clone() {
        Some((status, body)) => (StatusCode::from_u16(status).unwrap(), Json(body)),
        None => (StatusCode::CREATED, Json(json!({"id": "activity-1"}))),
    }
}

async fn connector_update(
    State(shared): State<Shared>,
    Path((conversation, activity_id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    shared
        .lock()
        .unwrap()
        .updated
        .push((conversation, activity_id.clone(), body));
    (StatusCode::OK, Json(json!({"id": activity_id})))
}

async fn harness(pool: sqlx::PgPool) -> (AppState, Arc<TeamsBot>, Shared, String) {
    let shared: Shared = Arc::default();
    let routes = Router::new()
        .route(
            "/v3/conversations/{conversation}/activities",
            post(connector_reply),
        )
        .route(
            "/v3/conversations/{conversation}/activities/{activity}",
            axum::routing::put(connector_update),
        )
        .with_state(shared.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, routes).await.unwrap() });
    let config: AppConfig = AppConfig::config_schema_builder(None, false)
        .unwrap()
        .set_override(
            "database_url",
            pool.connect_options().to_url_lossy().to_string(),
        )
        .unwrap()
        .set_override(
            "file_storage_providers",
            std::collections::HashMap::<String, String>::new(),
        )
        .unwrap()
        .build()
        .unwrap()
        .try_deserialize()
        .unwrap();
    let state = AppState::new(config).await.unwrap();
    let bot = Arc::new(TeamsBot::for_test(&base, true));
    (state, bot, shared, base)
}

fn content(token: Uuid) -> DeliveryContent {
    DeliveryContent {
        title: None,
        text: "Did you know you can attach files?".into(),
        summary: Some("A tip from Erato".into()),
        links: vec![DeliveryLink {
            title: "Open Erato".into(),
            url: "https://erato.example.com".into(),
        }],
        actions: vec![DeliveryAction {
            title: "Don't remind me".into(),
            command: OPT_OUT_COMMAND.into(),
            token: Some(token),
        }],
    }
}

fn row_for(user_id: Uuid) -> Model {
    let now = Utc::now().fixed_offset();
    Model {
        id: Uuid::new_v4(),
        user_id,
        kind: KIND.into(),
        due_at: now,
        created_by: CreatedBy::System,
        origin: json!({}),
        payload: json!({}),
        state: crate::db::entity::scheduled_deliveries::DeliveryState::Claimed,
        claim_token: Some("claim".into()),
        claimed_at: Some(now),
        delivered_at: None,
        outcome: json!({}),
        dedupe_key: None,
        created_at: now,
        updated_at: now,
    }
}

/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn the_card_reaches_the_personal_conversation_and_refusals_are_mapped(pool: sqlx::PgPool) {
    let (state, bot, shared, base) = harness(pool).await;
    let host = Host::new(state.clone());
    let user = get_or_create_user(&state.db, "https://issuer.example", "tip-user", None)
        .await
        .unwrap();
    let channel = TeamsPersonalChannel::new(bot.clone());
    let token = Uuid::new_v4();

    assert_eq!(
        channel
            .deliver(&state.db, &user, &row_for(user.id), &content(token))
            .await,
        DeliveryOutcome::Failed {
            reason: "no personal Teams conversation".into()
        }
    );

    // Only the personal conversation is used, never a group chat the user
    // also talks to the bot in.
    host.upsert_conversation(
        "19:group@thread.tacv2",
        ConversationKind::GroupChat,
        user.id,
        &base,
        "29:user",
    )
    .await
    .unwrap();
    host.upsert_conversation(
        "a:personal",
        ConversationKind::Personal,
        user.id,
        &base,
        "29:user",
    )
    .await
    .unwrap();
    let row = row_for(user.id);
    let outcome = channel
        .deliver(&state.db, &user, &row, &content(token))
        .await;
    let posted = DeliveryContent {
        actions: Vec::new(),
        ..content(token)
    };
    assert_eq!(
        outcome,
        DeliveryOutcome::Delivered {
            details: json!({
                "activity_id": "activity-1",
                "conversation_id": "a:personal",
                "content": posted,
            })
        }
    );
    let (conversation, activity) = shared.lock().unwrap().outgoing.remove(0);
    assert_eq!(conversation, "a:personal");
    assert_eq!(activity["summary"], "A tip from Erato");
    let card = &activity["attachments"][0]["content"];
    assert_eq!(
        card["body"][0]["text"],
        "Did you know you can attach files?"
    );
    assert_eq!(card["actions"][0]["title"], "Open Erato");
    assert_eq!(card["actions"][1]["title"], "Don't remind me");
    assert_eq!(
        card["actions"][1]["data"]["delivery_id"],
        row.id.to_string()
    );
    assert_eq!(card["actions"][1]["data"]["token"], token.to_string());

    shared.lock().unwrap().answer = Some((
        403,
        json!({"error": {"code": "MessageWritesBlocked", "message": "Message writes are blocked"}}),
    ));
    assert_eq!(
        channel
            .deliver(&state.db, &user, &row, &content(token))
            .await,
        DeliveryOutcome::Failed {
            reason: "403 MessageWritesBlocked: Message writes are blocked".into()
        }
    );
    shared.lock().unwrap().answer = Some((
        429,
        json!({"error": {"code": "TooManyRequests", "message": "slow down"}}),
    ));
    assert!(matches!(
        channel
            .deliver(&state.db, &user, &row, &content(token))
            .await,
        DeliveryOutcome::Retry { .. }
    ));
}

/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn installing_the_app_records_the_personal_conversation_of_known_users(pool: sqlx::PgPool) {
    let (state, bot, shared, base) = harness(pool).await;
    let host = Host::new(state.clone());
    let user = get_or_create_user(&state.db, "https://issuer.example", "installed", None)
        .await
        .unwrap();
    record_entra_object_id(&state.db, &user, "4a1b3c5d-0000-4000-8000-00000000cafe")
        .await
        .unwrap();
    let added = |oid: &str, conversation: &str| -> Activity {
        serde_json::from_value(json!({
            "type": "conversationUpdate",
            "serviceUrl": base,
            "from": {"id": "29:user", "aadObjectId": oid},
            "recipient": {"id": "28:bot"},
            "conversation": {"id": conversation, "conversationType": "personal", "tenantId": "tenant"},
            "membersAdded": [{"id": "28:bot"}],
        }))
        .unwrap()
    };

    on_bot_added(
        bot.clone(),
        host.clone(),
        added("4a1b3c5d-0000-4000-8000-00000000cafe", "a:known"),
    )
    .await;
    on_bot_added(
        bot.clone(),
        host.clone(),
        added("00000000-0000-4000-8000-000000000000", "a:unknown"),
    )
    .await;

    let mut german = added("00000000-0000-4000-8000-0000000000de", "a:german");
    german.locale = Some("de-DE".into());
    on_bot_added(bot.clone(), host.clone(), german).await;

    let rows = MsTeamsConversations::find().all(&state.db).await.unwrap();
    assert_eq!(
        rows.len(),
        1,
        "only a user Erato knows gets a conversation row"
    );
    assert_eq!(rows[0].conversation_id, "a:known");
    assert_eq!(rows[0].user_id, user.id);
    assert_eq!(rows[0].conversation_type, "personal");
    assert_eq!(rows[0].service_url, base);
    // All got their welcome card; a client reporting German gets it in
    // German before Erato knows the user.
    let outgoing = shared.lock().unwrap().outgoing.clone();
    assert_eq!(outgoing.len(), 3);
    assert_eq!(outgoing[0].1["summary"], "Hi, I'm Erato.");
    assert_eq!(outgoing[2].1["summary"], "Hallo, ich bin Erato.");
}

async fn replies(shared: &Shared, expected: usize) -> Vec<Value> {
    for _ in 0..100 {
        let outgoing: Vec<Value> = shared
            .lock()
            .unwrap()
            .outgoing
            .iter()
            .map(|(_, activity)| activity.clone())
            .collect();
        if outgoing.len() >= expected {
            return outgoing;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("expected {expected} replies");
}

/// "Don't remind me" and `/reminders off` work for a user whose bot sign-in
/// never completes: the sender is matched by Entra object id alone, and an
/// unknown button command does not burn the single-use token. The harness
/// has no token service, so any sign-in attempt would fail loudly.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn opting_out_needs_no_sign_in(pool: sqlx::PgPool) {
    let (state, bot, shared, base) = harness(pool).await;
    let host = Host::new(state.clone());
    let user = get_or_create_user(&state.db, "https://issuer.example", "quiet", None)
        .await
        .unwrap();
    const OID: &str = "4a1b3c5d-0000-4000-8000-00000000cafe";
    record_entra_object_id(&state.db, &user, OID).await.unwrap();
    host.upsert_conversation(
        "a:personal",
        ConversationKind::Personal,
        user.id,
        &base,
        "29:user",
    )
    .await
    .unwrap();
    let message = |text: Option<&str>, value: Option<Value>| -> Activity {
        let mut activity = json!({
            "type": "message", "id": "m1", "serviceUrl": base,
            "from": {"id": "29:user", "aadObjectId": OID}, "recipient": {"id": "28:bot"},
            "conversation": {"id": "a:personal", "conversationType": "personal", "tenantId": "tenant"}
        });
        if let Some(text) = text {
            activity["text"] = json!(text);
        }
        if let Some(value) = value {
            activity["value"] = value;
        }
        serde_json::from_value(activity).unwrap()
    };
    let off_text = format!(
        "All right, {} will not send you any more tips. Send /reminders on to get them again.",
        bot.settings.app_name
    );

    on_message(
        bot.clone(),
        host.clone(),
        message(Some("/reminders off"), None),
    )
    .await;
    let sent = replies(&shared, 1).await;
    assert_eq!(sent.len(), 1, "one reply, no sign-in card");
    assert_eq!(sent[0]["text"], off_text);
    assert!(teams_nudges_opted_out(&state.db, &user.id).await.unwrap());
    on_message(
        bot.clone(),
        host.clone(),
        message(Some("/reminders on"), None),
    )
    .await;
    replies(&shared, 2).await;
    assert!(!teams_nudges_opted_out(&state.db, &user.id).await.unwrap());

    // A delivered card. The button works without sign-in; an unknown command
    // leaves the token unclaimed; the token is claimed once.
    let row = schedule(
        &state.db,
        NewDelivery {
            user_id: user.id,
            kind: KIND.into(),
            due_at: Utc::now(),
            created_by: CreatedBy::System,
            origin: json!({}),
            payload: json!({}),
            dedupe_key: None,
        },
    )
    .await
    .unwrap()
    .unwrap();
    let token = Uuid::new_v4();
    state
        .db
        .execute_raw(statement(
            "test.mark_delivered",
            "UPDATE scheduled_deliveries
             SET state = 'delivered', delivered_at = now(),
                 outcome = jsonb_build_object(
                     'action_token', $2::text,
                     'action_expires_at', (now() + interval '1 day')::text,
                     'delivered', jsonb_build_object('conversation_id', 'a:personal'))
             WHERE id = $1",
            vec![row.id.into(), token.to_string().into()],
        ))
        .await
        .unwrap();
    let press = |command: &str| json!({"action": ACTION, "delivery_id": row.id, "command": command, "token": token});

    on_message(
        bot.clone(),
        host.clone(),
        message(None, Some(press("something_else"))),
    )
    .await;
    let sent = replies(&shared, 3).await;
    assert_eq!(sent[2]["text"], "This button is not supported.");
    assert!(
        find(&state.db, row.id)
            .await
            .unwrap()
            .unwrap()
            .outcome
            .get("action_claimed_at")
            .is_none(),
        "an unknown command leaves the token unclaimed"
    );

    on_message(
        bot.clone(),
        host.clone(),
        message(None, Some(press(OPT_OUT_COMMAND))),
    )
    .await;
    let sent = replies(&shared, 4).await;
    assert_eq!(sent[3]["text"], off_text);
    assert!(teams_nudges_opted_out(&state.db, &user.id).await.unwrap());
    on_message(
        bot.clone(),
        host.clone(),
        message(None, Some(press(OPT_OUT_COMMAND))),
    )
    .await;
    let sent = replies(&shared, 5).await;
    assert_eq!(
        sent[4]["text"],
        "This button was already used or has expired."
    );
}

/// The zone and language Teams reports with a message are kept for the
/// sender, also on a command that needs no sign-in.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn the_teams_client_zone_and_language_are_stored(pool: sqlx::PgPool) {
    let (state, bot, shared, base) = harness(pool).await;
    let host = Host::new(state.clone());
    let user = get_or_create_user(&state.db, "https://issuer.example", "zoned", None)
        .await
        .unwrap();
    const OID: &str = "4a1b3c5d-0000-4000-8000-00000000beef";
    record_entra_object_id(&state.db, &user, OID).await.unwrap();
    let activity: Activity = serde_json::from_value(json!({
        "type": "message", "id": "m1", "serviceUrl": base, "text": "/reminders off",
        "locale": "en-US",
        "from": {"id": "29:user", "aadObjectId": OID}, "recipient": {"id": "28:bot"},
        "conversation": {"id": "a:personal", "conversationType": "personal", "tenantId": "tenant"},
        "entities": [{"type": "clientInfo", "locale": "de-DE", "country": "DE",
                      "platform": "Windows", "timezone": "Europe/Berlin"}]
    }))
    .unwrap();

    on_message(bot.clone(), host.clone(), activity).await;
    let sent = replies(&shared, 1).await;
    // The reply already follows the language the client just reported.
    assert_eq!(
        sent[0]["text"],
        format!(
            "In Ordnung, {} sendet Ihnen keine Tipps mehr. Senden Sie /erinnerungen an, um sie wieder zu erhalten.",
            bot.settings.app_name
        )
    );

    let prefs = crate::models::user_preference::get_user_preferences(&state.db, &user.id)
        .await
        .unwrap()
        .expect("preferences row");
    assert_eq!(prefs.time_zone.as_deref(), Some("Europe/Berlin"));
    assert_eq!(prefs.language.as_deref(), Some("de-DE"));
}

/// A user reminder through the executor, the reminder producer and this
/// channel. The posted activity is the committed sample
/// `snapshots/scheduled_reminder_card.snap.json`, which also renders the card
/// for review; after an intended change to the card, refresh it with
/// `INSTA_UPDATE=always just test a_reminder_arrives_as_the_sample_card`.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn a_reminder_arrives_as_the_sample_card(pool: sqlx::PgPool) {
    let sample = sample_card(
        pool,
        None,
        "Q4 rate comparison",
        "Call Alex back",
        "Ask whether they need the revised rates before Friday.",
    )
    .await;
    assert_sample("scheduled_reminder_card.json", sample);
}

/// The same for a user whose stored language is German, with no message to
/// answer: `snapshots/scheduled_reminder_card_de.snap.json`.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn a_reminder_arrives_as_the_sample_card_in_german(pool: sqlx::PgPool) {
    let sample = sample_card(
        pool,
        Some("de-DE"),
        "Vergleich der Q4-Konditionen",
        "Alex zurückrufen",
        "Fragen, ob die neuen Konditionen vor Freitag gebraucht werden.",
    )
    .await;
    assert_sample("scheduled_reminder_card_de.json", sample);
}

/// Deliver a reminder for tomorrow 9:00 Berlin time, linked to a chat, to a
/// user in Berlin, and return the posted activity with its ids replaced.
async fn sample_card(
    pool: sqlx::PgPool,
    language: Option<&str>,
    chat_title: &str,
    name: &str,
    message: &str,
) -> String {
    let (state, bot, shared, base) = harness(pool).await;
    let host = Host::new(state.clone());
    let user = get_or_create_user(&state.db, "https://issuer.example", "reminded", None)
        .await
        .unwrap();
    record_client_locale(&state.db, &user.id, Some("Europe/Berlin"), language)
        .await
        .unwrap();
    host.upsert_conversation(
        "a:personal",
        ConversationKind::Personal,
        user.id,
        &base,
        "29:user",
    )
    .await
    .unwrap();
    let chat_id = Uuid::new_v4();
    state
        .db
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO chats (id, owner_user_id, title_by_user_provided)
             VALUES ($1, $2, $3)",
            [
                chat_id.into(),
                user.id.to_string().into(),
                chat_title.into(),
            ],
        ))
        .await
        .unwrap();
    let item = scheduled_items::create(
        &state.db,
        user.id,
        ItemInput {
            kind: REMINDER.into(),
            name: name.into(),
            message: message.into(),
            linked_chat_id: Some(chat_id),
            channel: CHANNEL.into(),
            trigger: Trigger::Once {
                date: Utc::now().date_naive() + ChronoDuration::days(1),
                time: LocalTime::new(9, 0).unwrap(),
            },
            time_zone: chrono_tz::Europe::Berlin,
        },
        json!({"via": "web"}),
    )
    .await
    .unwrap()
    .unwrap();
    let occurrence = current_occurrence(&state.db, &item).await.unwrap().unwrap();
    make_due(&state, occurrence.id).await;
    let registry = reminder_registry(bot);
    let tick = run_delivery_tick(&state.db, &executor(), &registry).await;
    assert_eq!(tick.delivered, 1, "{tick:?}");

    let (conversation, activity) = shared.lock().unwrap().outgoing.remove(0);
    assert_eq!(conversation, "a:personal");
    let token = submit_of(&activity, DONE_COMMAND)["token"]
        .as_str()
        .unwrap()
        .to_string();
    let mut sample = serde_json::to_string_pretty(&activity).unwrap();
    for (id, placeholder) in [
        (chat_id.to_string(), "CHAT_ID"),
        (occurrence.id.to_string(), "DELIVERY_ID"),
        (item.id.to_string(), "ITEM_ID"),
        (token, "TOKEN"),
    ] {
        sample = sample.replace(&id, placeholder);
    }
    sample.push('\n');
    sample
}

fn assert_sample(name: &str, sample: String) {
    let mut snapshot = insta::Settings::clone_current();
    snapshot.set_prepend_module_to_snapshot(false);
    snapshot.bind(|| insta::assert_binary_snapshot!(name, sample.into_bytes()));
}

fn reminder_registry(bot: Arc<TeamsBot>) -> DeliveryRegistry {
    let mut registry = DeliveryRegistry::new();
    registry.register_producer(Arc::new(ReminderProducer::new(
        Some("https://erato.example.com".into()),
        "en",
    )));
    registry.register_channel(Arc::new(TeamsPersonalChannel::new(bot)));
    registry
}

fn executor() -> ExecutorSettings {
    ExecutorSettings {
        batch_size: 10,
        claim_timeout: Duration::from_secs(300),
        max_attempts: 3,
        retry_delay: Duration::from_secs(60),
    }
}

/// The `data` of the card's button with this command.
fn submit_of(activity: &Value, command: &str) -> Value {
    activity["attachments"][0]["content"]["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| action["data"]["command"] == command)
        .unwrap_or_else(|| panic!("no `{command}` button on {activity}"))["data"]
        .clone()
}

fn buttons(activity: &Value) -> Vec<String> {
    activity["attachments"][0]["content"]["actions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|action| action["title"].as_str().unwrap().to_string())
        .collect()
}

async fn make_due(state: &AppState, id: Uuid) {
    state
        .db
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE scheduled_deliveries SET due_at = now() - interval '1 second' WHERE id = $1",
            [id.into()],
        ))
        .await
        .unwrap();
}

const REMINDER_OID: &str = "4a1b3c5d-0000-4000-8000-00000000f00d";

/// A one-off reminder delivered as a card to a user known by Entra object
/// id: the item, its occurrence and the card.
async fn deliver_reminder(
    state: &AppState,
    bot: &Arc<TeamsBot>,
    host: &Host,
    shared: &Shared,
    base: &str,
) -> (ScheduledItem, Model, Value) {
    let user = get_or_create_user(&state.db, "https://issuer.example", "snoozer", None)
        .await
        .unwrap();
    record_entra_object_id(&state.db, &user, REMINDER_OID)
        .await
        .unwrap();
    host.upsert_conversation(
        "a:personal",
        ConversationKind::Personal,
        user.id,
        base,
        "29:user",
    )
    .await
    .unwrap();
    let item = scheduled_items::create(
        &state.db,
        user.id,
        ItemInput {
            kind: REMINDER.into(),
            name: "Call Alex back".into(),
            message: "Ask about the revised rates.".into(),
            linked_chat_id: None,
            channel: CHANNEL.into(),
            trigger: Trigger::Once {
                date: Utc::now().date_naive() + ChronoDuration::days(1),
                time: LocalTime::new(9, 0).unwrap(),
            },
            time_zone: chrono_tz::Europe::Berlin,
        },
        json!({"via": "web"}),
    )
    .await
    .unwrap()
    .unwrap();
    let occurrence = current_occurrence(&state.db, &item).await.unwrap().unwrap();
    make_due(state, occurrence.id).await;
    run_delivery_tick(&state.db, &executor(), &reminder_registry(bot.clone())).await;
    let card = shared.lock().unwrap().outgoing[0].1.clone();
    assert_eq!(buttons(&card), ["Done", "Snooze 30 min", "Tomorrow 9:00"]);
    (item, occurrence, card)
}

/// The reminder user's press of a card button.
fn press_on(base: &str, data: Value) -> Activity {
    serde_json::from_value(json!({
        "type": "message", "id": "m1", "serviceUrl": base, "value": data,
        "from": {"id": "29:user", "aadObjectId": REMINDER_OID}, "recipient": {"id": "28:bot"},
        "conversation": {"id": "a:personal", "conversationType": "personal", "tenantId": "tenant"}
    }))
    .unwrap()
}

/// Snooze on a delivered reminder replaces the card in place with a
/// "Snoozed until" line and no buttons, and brings the reminder back as a
/// card with its own token; Done closes that card and stores
/// `acknowledged_at`. A used button gets a reply pointing to the Scheduled
/// page. None of it needs a sign-in.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn reminder_buttons_replace_the_card_in_place(pool: sqlx::PgPool) {
    let (state, mut bot, shared, base) = harness(pool).await;
    Arc::get_mut(&mut bot).unwrap().settings.public_base_url =
        Some("https://erato.example.com/".into());
    let host = Host::new(state.clone());
    let (item, occurrence, card) = deliver_reminder(&state, &bot, &host, &shared, &base).await;
    let registry = reminder_registry(bot.clone());
    let press = |data: Value| press_on(&base, data);

    on_message(
        bot.clone(),
        host.clone(),
        press(submit_of(&card, SNOOZE_COMMAND)),
    )
    .await;
    let (conversation, activity_id, settled) = shared.lock().unwrap().updated[0].clone();
    assert_eq!(
        (conversation.as_str(), activity_id.as_str()),
        ("a:personal", "activity-1")
    );
    assert_eq!(settled["id"], "activity-1");
    let body = &settled["attachments"][0]["content"]["body"];
    assert_eq!(body[0]["text"], "Call Alex back");
    assert_eq!(body[1]["text"], "Ask about the revised rates.");
    assert!(
        body[2]["text"]
            .as_str()
            .unwrap()
            .starts_with("Snoozed until "),
        "{body}"
    );
    assert!(buttons(&settled).is_empty());
    assert_eq!(
        shared.lock().unwrap().outgoing.len(),
        1,
        "the card changes; no message is added"
    );
    let redelivery = current_occurrence(&state.db, &item).await.unwrap().unwrap();
    assert_ne!(redelivery.id, occurrence.id);
    assert_eq!(
        redelivery.dedupe_key.as_deref(),
        Some(format!("{}:snooze", item.id).as_str())
    );

    on_message(
        bot.clone(),
        host.clone(),
        press(submit_of(&card, DONE_COMMAND)),
    )
    .await;
    let sent = replies(&shared, 2).await;
    assert_eq!(
        sent[1]["text"],
        "This button was already used or has expired. You can find your reminders on the [Scheduled page](https://erato.example.com/scheduled)."
    );

    make_due(&state, redelivery.id).await;
    let tick = run_delivery_tick(&state.db, &executor(), &registry).await;
    assert_eq!(tick.delivered, 1, "{tick:?}");
    let again = shared.lock().unwrap().outgoing[2].1.clone();
    assert_eq!(again["summary"], "Call Alex back");
    assert_ne!(
        submit_of(&again, DONE_COMMAND)["token"],
        submit_of(&card, DONE_COMMAND)["token"],
        "the re-delivered card has its own token"
    );
    on_message(
        bot.clone(),
        host.clone(),
        press(submit_of(&again, DONE_COMMAND)),
    )
    .await;
    let settled = shared.lock().unwrap().updated[1].2.clone();
    assert_eq!(
        settled["attachments"][0]["content"]["body"][2]["text"],
        "Marked as done."
    );
    assert!(buttons(&settled).is_empty());
    let acknowledged = find(&state.db, redelivery.id).await.unwrap().unwrap();
    assert!(
        acknowledged.outcome["acknowledged_at"].is_string(),
        "{}",
        acknowledged.outcome
    );
    assert_eq!(shared.lock().unwrap().outgoing.len(), 3);
}

/// A German user gets the reminder, its buttons, the card after Snooze and
/// Done, and the reply to a used button in German, from the stored language
/// alone: the button presses carry no locale.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn a_german_user_gets_the_reminder_and_its_buttons_in_german(pool: sqlx::PgPool) {
    let (state, mut bot, shared, base) = harness(pool).await;
    Arc::get_mut(&mut bot).unwrap().settings.public_base_url =
        Some("https://erato.example.com".into());
    let host = Host::new(state.clone());
    let user = get_or_create_user(&state.db, "https://issuer.example", "deutsch", None)
        .await
        .unwrap();
    const OID: &str = "4a1b3c5d-0000-4000-8000-00000000d0e0";
    record_entra_object_id(&state.db, &user, OID).await.unwrap();
    record_client_locale(&state.db, &user.id, Some("Europe/Berlin"), Some("de-AT"))
        .await
        .unwrap();
    host.upsert_conversation(
        "a:personal",
        ConversationKind::Personal,
        user.id,
        &base,
        "29:user",
    )
    .await
    .unwrap();
    let chat_id = Uuid::new_v4();
    state
        .db
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO chats (id, owner_user_id) VALUES ($1, $2)",
            [chat_id.into(), user.id.to_string().into()],
        ))
        .await
        .unwrap();
    let item = scheduled_items::create(
        &state.db,
        user.id,
        ItemInput {
            kind: REMINDER.into(),
            name: "Alex zurückrufen".into(),
            message: "Nach den neuen Konditionen fragen.".into(),
            linked_chat_id: Some(chat_id),
            channel: CHANNEL.into(),
            trigger: Trigger::Once {
                date: Utc::now().date_naive() + ChronoDuration::days(3),
                time: LocalTime::new(9, 0).unwrap(),
            },
            time_zone: chrono_tz::Europe::Berlin,
        },
        json!({"via": "web"}),
    )
    .await
    .unwrap()
    .unwrap();
    let occurrence = current_occurrence(&state.db, &item).await.unwrap().unwrap();
    make_due(&state, occurrence.id).await;
    let registry = reminder_registry(bot.clone());
    run_delivery_tick(&state.db, &executor(), &registry).await;
    let card = shared.lock().unwrap().outgoing[0].1.clone();
    assert_eq!(
        buttons(&card),
        [
            "Unbenannter Chat",
            "Erledigt",
            "Später (30 Min.)",
            "Morgen 9:00"
        ]
    );
    let press = |data: Value| -> Activity {
        serde_json::from_value(json!({
            "type": "message", "id": "m1", "serviceUrl": base, "value": data,
            "from": {"id": "29:user", "aadObjectId": OID}, "recipient": {"id": "28:bot"},
            "conversation": {"id": "a:personal", "conversationType": "personal", "tenantId": "tenant"}
        }))
        .unwrap()
    };

    on_message(
        bot.clone(),
        host.clone(),
        press(submit_of(&card, SNOOZE_COMMAND)),
    )
    .await;
    let settled = shared.lock().unwrap().updated[0].2.clone();
    let note = settled["attachments"][0]["content"]["body"][2]["text"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(note.starts_with("Zurückgestellt bis "), "{note}");
    assert!(
        !note.contains("tomorrow") && !note.contains("time)"),
        "{note}"
    );

    on_message(
        bot.clone(),
        host.clone(),
        press(submit_of(&card, DONE_COMMAND)),
    )
    .await;
    let sent = replies(&shared, 2).await;
    assert_eq!(
        sent[1]["text"],
        "Diese Schaltfläche wurde bereits verwendet oder ist abgelaufen. Ihre Erinnerungen finden Sie auf der Seite [„Geplant“](https://erato.example.com/scheduled)."
    );

    let redelivery = current_occurrence(&state.db, &item).await.unwrap().unwrap();
    make_due(&state, redelivery.id).await;
    run_delivery_tick(&state.db, &executor(), &registry).await;
    let again = shared.lock().unwrap().outgoing[2].1.clone();
    on_message(
        bot.clone(),
        host.clone(),
        press(submit_of(&again, DONE_COMMAND)),
    )
    .await;
    let settled = shared.lock().unwrap().updated[1].2.clone();
    assert_eq!(
        settled["attachments"][0]["content"]["body"][2]["text"],
        "Als erledigt markiert."
    );
}

/// A press whose service call fails changes nothing and gives the token
/// back: the card keeps its buttons, and the next press works.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn a_failed_press_leaves_the_card_usable(pool: sqlx::PgPool) {
    let (state, bot, shared, base) = harness(pool).await;
    let host = Host::new(state.clone());
    let (item, occurrence, card) = deliver_reminder(&state, &bot, &host, &shared, &base).await;
    let set_zone = |zone: &'static str| {
        let db = state.db.clone();
        async move {
            db.execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "UPDATE scheduled_items SET time_zone = $2 WHERE id = $1",
                [item.id.into(), zone.into()],
            ))
            .await
            .unwrap();
        }
    };
    // The snooze fails inside its transaction on a zone it cannot read.
    set_zone("Nowhere/Invalid").await;

    on_message(
        bot.clone(),
        host.clone(),
        press_on(&base, submit_of(&card, SNOOZE_COMMAND)),
    )
    .await;
    let sent = replies(&shared, 2).await;
    assert_eq!(
        sent[1]["text"],
        "Something went wrong. Please try the button again."
    );
    assert!(shared.lock().unwrap().updated.is_empty());
    let row = find(&state.db, occurrence.id).await.unwrap().unwrap();
    assert!(
        row.outcome.get("action_claimed_at").is_none()
            && row.outcome.get("action_command").is_none(),
        "{}",
        row.outcome
    );

    set_zone("Europe/Berlin").await;
    on_message(
        bot.clone(),
        host.clone(),
        press_on(&base, submit_of(&card, SNOOZE_COMMAND)),
    )
    .await;
    let settled = shared.lock().unwrap().updated[0].2.clone();
    assert!(
        settled["attachments"][0]["content"]["body"][2]["text"]
            .as_str()
            .unwrap()
            .starts_with("Snoozed until "),
        "{settled}"
    );
    assert!(buttons(&settled).is_empty());
}

/// A snooze that went through stays a snooze when reading the user's time
/// zone afterwards fails: the card settles with its "Snoozed until" line
/// instead of an error reply, and the reminder comes back.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn a_committed_snooze_is_not_reported_as_an_error(pool: sqlx::PgPool) {
    let (state, bot, shared, base) = harness(pool).await;
    let host = Host::new(state.clone());
    let (item, occurrence, card) = deliver_reminder(&state, &bot, &host, &shared, &base).await;
    // The snooze never reads user preferences; only the note after it does.
    state
        .db
        .execute_unprepared("ALTER TABLE user_preferences RENAME TO user_preferences_gone")
        .await
        .unwrap();

    on_message(
        bot.clone(),
        host.clone(),
        press_on(&base, submit_of(&card, SNOOZE_COMMAND)),
    )
    .await;
    let outgoing: Vec<Value> = shared
        .lock()
        .unwrap()
        .outgoing
        .iter()
        .map(|(_, activity)| activity.clone())
        .collect();
    assert_eq!(outgoing.len(), 1, "no message is added: {outgoing:?}");
    let settled = shared.lock().unwrap().updated[0].2.clone();
    assert!(
        settled["attachments"][0]["content"]["body"][2]["text"]
            .as_str()
            .unwrap()
            .starts_with("Snoozed until "),
        "{settled}"
    );
    assert!(buttons(&settled).is_empty());
    let redelivery = current_occurrence(&state.db, &item).await.unwrap().unwrap();
    assert_ne!(redelivery.id, occurrence.id);
    assert_eq!(
        redelivery.dedupe_key.as_deref(),
        Some(format!("{}:snooze", item.id).as_str())
    );
}

/// When the delivered card cannot be read back, its note still reaches the
/// user, as a message.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn a_note_goes_out_as_a_message_when_the_card_cannot_be_read(pool: sqlx::PgPool) {
    let (state, bot, shared, base) = harness(pool).await;
    let host = Host::new(state.clone());
    let (_, occurrence, _) = deliver_reminder(&state, &bot, &host, &shared, &base).await;
    state.db.close_by_ref().await.unwrap();
    let target = ReplyTarget {
        connector: &bot.connector,
        service_url: &base,
        conversation_id: "a:personal",
        reply_to_id: None,
        mention: None,
        lang: Lang::En,
    };

    settle_delivered_card(&host, &target, occurrence.id, "Snoozed until 9:30.")
        .await
        .unwrap();
    let sent = replies(&shared, 2).await;
    assert_eq!(sent[1]["text"], "Snoozed until 9:30.");
    assert!(shared.lock().unwrap().updated.is_empty());
}
