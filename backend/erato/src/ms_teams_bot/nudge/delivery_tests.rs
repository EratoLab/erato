//! The Teams side of a tip: the card reaches the user's personal
//! conversation through the Connector, Connector refusals are mapped, and
//! installing the app records the conversation for known users.
use super::*;
use crate::config::AppConfig;
use crate::models::user::{get_or_create_user, record_entra_object_id};
use crate::models::user_preference::teams_nudges_opted_out;
use crate::ms_teams_bot::activity::{Activity, ConversationKind};
use crate::ms_teams_bot::handler::{on_bot_added, on_message};
use crate::services::scheduled_deliveries::{NewDelivery, find, schedule};
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

async fn harness(pool: sqlx::PgPool) -> (AppState, Arc<TeamsBot>, Shared, String) {
    let shared: Shared = Arc::default();
    let routes = Router::new()
        .route(
            "/v3/conversations/{conversation}/activities",
            post(connector_reply),
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
    assert_eq!(
        outcome,
        DeliveryOutcome::Delivered {
            details: json!({"activity_id": "activity-1", "conversation_id": "a:personal"})
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
    // Both got their welcome card.
    assert_eq!(shared.lock().unwrap().outgoing.len(), 2);
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
    replies(&shared, 1).await;

    let prefs = crate::models::user_preference::get_user_preferences(&state.db, &user.id)
        .await
        .unwrap()
        .expect("preferences row");
    assert_eq!(prefs.time_zone.as_deref(), Some("Europe/Berlin"));
    assert_eq!(prefs.language.as_deref(), Some("de-DE"));
}
