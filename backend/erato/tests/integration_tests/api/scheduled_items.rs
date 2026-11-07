//! The Scheduled page's API: own items only, local times in the user's zone,
//! reachability and the cap refused with a code the form can show.

use axum::http::StatusCode;
use axum_test::TestServer;
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Timelike, Utc, Weekday};
use erato::config::{ScheduledTemplateConfig, ScheduledTemplateType};
use erato::models::user::get_or_create_user;
use erato::models::user_preference::record_client_locale;
use erato::services::scheduled_deliveries::{
    DeliveryOutcome, DeliveryRegistry, ExecutorSettings, RecordingChannel, run_delivery_tick,
};
use erato::services::scheduled_items::ReminderProducer;
use erato::state::AppState;
use sea_orm::prelude::Uuid;
use sea_orm::{ConnectionTrait, DatabaseConnection, Statement};
use serde_json::{Value, json};
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::sync::Arc;

use crate::test_app_state;
use crate::test_utils::{
    JwtTokenBuilder, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT, TestRequestAuthExt,
    create_test_server, hermetic_app_config,
};

const ITEMS: &str = "/api/v1beta/me/scheduled-items";
const TEMPLATES: &str = "/api/v1beta/me/scheduled-templates";
const CHANNEL: &str = "teams_personal";

struct Setup {
    server: TestServer,
    db: DatabaseConnection,
    user_id: Uuid,
    channel: Arc<RecordingChannel>,
    registry: Arc<DeliveryRegistry>,
}

/// A deployment that delivers through Teams, and the test user, optionally
/// with a personal Teams chat and a stored zone.
async fn setup(pool: Pool<Postgres>, reachable: bool, zone: Option<&str>) -> Setup {
    let mut config = hermetic_app_config(None, None);
    config.scheduled_deliveries.enabled = true;
    let mut app_state: AppState = test_app_state(config, pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let mut registry = DeliveryRegistry::new();
    registry.register_producer(Arc::new(ReminderProducer::new(None)));
    registry.register_channel(channel.clone());
    let registry = Arc::new(registry);
    app_state.scheduled_deliveries = registry.clone();
    let db = app_state.db.clone();
    let user_id = get_or_create_user(&db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap()
        .id;
    if reachable {
        personal_conversation(&db, user_id).await;
    }
    if zone.is_some() {
        record_client_locale(&db, &user_id, zone, None)
            .await
            .unwrap();
    }
    Setup {
        server: create_test_server(app_state),
        db,
        user_id,
        channel,
        registry,
    }
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

async fn chat_of(db: &DatabaseConnection, owner: Uuid, title: &str) -> Uuid {
    let id = Uuid::new_v4();
    db.execute_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        "INSERT INTO chats (id, owner_user_id, title_by_user_provided) VALUES ($1, $2, $3)",
        [id.into(), owner.to_string().into(), title.into()],
    ))
    .await
    .unwrap();
    id
}

fn in_days(days: i64) -> NaiveDate {
    Utc::now().date_naive() + Duration::days(days)
}

fn once(date: NaiveDate, time: &str) -> Value {
    json!({"kind": "once", "date": date, "time": time})
}

fn reminder(name: &str, trigger: Value) -> Value {
    json!({
        "type": "reminder",
        "name": name,
        "message": "Ask whether they need the revised rates.",
        "trigger": trigger,
    })
}

async fn post(server: &TestServer, path: &str, body: &Value) -> axum_test::TestResponse {
    server
        .post(path)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(body)
        .await
}

async fn list(server: &TestServer, tab: &str) -> Value {
    let response = server
        .get(&format!("{ITEMS}?tab={tab}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    response.json()
}

fn assert_refused(response: &axum_test::TestResponse, status: StatusCode, code: &str) {
    response.assert_status(status);
    let body: Value = response.json();
    assert_eq!(body["code"], code, "{body}");
    assert!(body["message"].as_str().is_some_and(|m| !m.is_empty()));
}

/// Create, list, read, edit, snooze and cancel a one-off reminder; times are
/// entered and returned in the user's zone.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_a_reminder_through_its_life(pool: Pool<Postgres>) {
    let setup = setup(pool, true, Some("Europe/Berlin")).await;
    let server = &setup.server;

    let empty = list(server, "upcoming").await;
    assert_eq!(empty["items"], json!([]));
    assert_eq!(empty["time_zone"], "Europe/Berlin");
    assert_eq!(empty["time_zone_source"], "user");
    assert_eq!(
        empty["channels"],
        json!([{"channel": CHANNEL, "status": "connected"}])
    );
    assert_eq!(empty["max_upcoming"], 10);

    let chat_id = chat_of(&setup.db, setup.user_id, "Offer Müller GmbH, sea freight").await;
    let date = in_days(3);
    let mut body = reminder(
        "Follow up on the offer for Müller GmbH",
        once(date, "10:00"),
    );
    body["linked_chat_id"] = json!(chat_id);
    let created = post(server, ITEMS, &body).await;
    created.assert_status(StatusCode::CREATED);
    let created: Value = created.json();
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["type"], "reminder");
    assert_eq!(created["name"], "Follow up on the offer for Müller GmbH");
    assert_eq!(
        created["message"],
        "Ask whether they need the revised rates."
    );
    assert_eq!(created["trigger"], once(date, "10:00"));
    assert_eq!(created["time_zone"], "Europe/Berlin");
    assert_eq!(created["status"], "scheduled");
    assert_eq!(created["channel"], CHANNEL);
    assert_eq!(created["channel_status"], "connected");
    assert_eq!(
        created["linked_chat"],
        json!({"id": chat_id, "title": "Offer Müller GmbH, sea freight"})
    );
    assert_eq!(
        created["next_occurrence"]["local"],
        format!("{date}T10:00:00")
    );
    let expected = chrono_tz::Europe::Berlin
        .from_local_datetime(&date.and_hms_opt(10, 0, 0).unwrap())
        .unwrap()
        .with_timezone(&Utc);
    assert_eq!(
        created["next_occurrence"]["at"]
            .as_str()
            .unwrap()
            .parse::<chrono::DateTime<Utc>>()
            .unwrap(),
        expected
    );
    assert_eq!(created["acknowledged_at"], Value::Null);

    let upcoming = list(server, "upcoming").await;
    assert_eq!(upcoming["items"].as_array().unwrap().len(), 1);
    assert_eq!(upcoming["upcoming_count"], 1);
    assert_eq!(upcoming["past_count"], 0);
    let fetched: Value = server
        .get(&format!("{ITEMS}/{id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(fetched, created);

    let mut edit = reminder("Follow up on the offer", once(date, "11:30"));
    edit["linked_chat_id"] = json!(chat_id);
    let edited = server
        .put(&format!("{ITEMS}/{id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&edit)
        .await;
    edited.assert_status_ok();
    let edited: Value = edited.json();
    assert_eq!(edited["name"], "Follow up on the offer");
    assert_eq!(
        edited["next_occurrence"]["local"],
        format!("{date}T11:30:00")
    );

    let until = Utc::now() + Duration::days(4);
    let snoozed = post(
        server,
        &format!("{ITEMS}/{id}/snooze"),
        &json!({"until": until}),
    )
    .await;
    snoozed.assert_status_ok();
    let snoozed: Value = snoozed.json();
    assert_eq!(snoozed["status"], "snoozed");
    assert_eq!(
        snoozed["next_occurrence"]["at"]
            .as_str()
            .unwrap()
            .parse::<chrono::DateTime<Utc>>()
            .unwrap()
            .timestamp(),
        until.timestamp()
    );

    let cancelled = post(server, &format!("{ITEMS}/{id}/cancel"), &json!({})).await;
    cancelled.assert_status_ok();
    let cancelled: Value = cancelled.json();
    assert_eq!(cancelled["status"], "cancelled");
    assert_eq!(cancelled["next_occurrence"], Value::Null);
    let past = list(server, "past").await;
    assert_eq!(past["items"][0]["id"], id);
    assert_eq!(past["upcoming_count"], 0);
    assert_eq!(past["past_count"], 1);
    assert_eq!(list(server, "upcoming").await["items"], json!([]));

    assert_refused(
        &post(server, &format!("{ITEMS}/{id}/cancel"), &json!({})).await,
        StatusCode::CONFLICT,
        "finished",
    );
    assert_refused(
        &server
            .put(&format!("{ITEMS}/{id}"))
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&edit)
            .await,
        StatusCode::CONFLICT,
        "finished",
    );
}

/// 10:00 in Berlin is stored as 09:00 UTC in winter and 08:00 UTC in
/// summer; a weekly rule returns its next local occurrence.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_local_times_resolve_in_the_users_zone(pool: Pool<Postgres>) {
    let setup = setup(pool, true, Some("Europe/Berlin")).await;
    let server = &setup.server;
    for (date, utc) in [
        ("2030-01-15", "2030-01-15T09:00:00Z"),
        ("2030-07-15", "2030-07-15T08:00:00Z"),
    ] {
        let created: Value = post(
            server,
            ITEMS,
            &reminder(
                "Quarterly check",
                json!({"kind": "once", "date": date, "time": "10:00"}),
            ),
        )
        .await
        .json();
        assert_eq!(created["next_occurrence"]["at"], utc, "{created}");
        assert_eq!(
            created["next_occurrence"]["local"],
            format!("{date}T10:00:00")
        );
    }

    let weekly = json!({
        "kind": "repeat", "frequency": "weekly", "weekdays": ["thu", "mon", "thu"],
        "time": "09:00", "starts_on": in_days(0), "ends": {"kind": "after_count", "count": 4}
    });
    let created = post(server, ITEMS, &reminder("Stand-up notes", weekly)).await;
    created.assert_status(StatusCode::CREATED);
    let created: Value = created.json();
    assert_eq!(created["trigger"]["weekdays"], json!(["mon", "thu"]));
    assert_eq!(created["occurrence_count"], 1);
    let local: chrono::NaiveDateTime = created["next_occurrence"]["local"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!(matches!(local.weekday(), Weekday::Mon | Weekday::Thu));
    assert_eq!(
        local.time(),
        chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap()
    );
    assert!(local.date() <= in_days(7));
}

/// Another user sees none of the items and cannot change them.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_only_the_owner_sees_and_changes_an_item(pool: Pool<Postgres>) {
    let setup = setup(pool, true, Some("Europe/Berlin")).await;
    let server = &setup.server;
    let created: Value = post(server, ITEMS, &reminder("Mine", once(in_days(2), "09:00")))
        .await
        .json();
    let id = created["id"].as_str().unwrap();
    let other = JwtTokenBuilder::new().subject("someone-else").build();

    let listed: Value = server.get(ITEMS).with_bearer_token(&other).await.json();
    assert_eq!(listed["items"], json!([]));
    assert_eq!(listed["upcoming_count"], 0);
    let get = server
        .get(&format!("{ITEMS}/{id}"))
        .with_bearer_token(&other)
        .await;
    assert_refused(&get, StatusCode::NOT_FOUND, "not_found");
    let cancel = server
        .post(&format!("{ITEMS}/{id}/cancel"))
        .with_bearer_token(&other)
        .await;
    assert_refused(&cancel, StatusCode::NOT_FOUND, "not_found");
    let snooze = server
        .post(&format!("{ITEMS}/{id}/snooze"))
        .with_bearer_token(&other)
        .json(&json!({"until": Utc::now() + Duration::days(5)}))
        .await;
    assert_refused(&snooze, StatusCode::NOT_FOUND, "not_found");
    let edit = server
        .put(&format!("{ITEMS}/{id}"))
        .with_bearer_token(&other)
        .json(&reminder("Theirs", once(in_days(2), "09:00")))
        .await;
    assert_refused(&edit, StatusCode::NOT_FOUND, "not_found");
    let mine: Value = server
        .get(&format!("{ITEMS}/{id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(mine["status"], "scheduled");
    assert_eq!(mine["name"], "Mine");
}

/// Without a personal Teams chat, or when the deployment does not deliver,
/// creating is refused with the reason and nothing is stored.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_an_unreachable_channel_is_refused(pool: Pool<Postgres>) {
    let setup = setup(pool, false, None).await;
    let server = &setup.server;
    let listed = list(server, "upcoming").await;
    assert_eq!(
        listed["channels"],
        json!([{"channel": CHANNEL, "status": "not_set_up"}])
    );
    assert_eq!(listed["time_zone"], "Europe/Berlin");
    assert_eq!(listed["time_zone_source"], "deployment_default");

    let refused = post(
        server,
        ITEMS,
        &reminder("Nobody sees this", once(in_days(2), "09:00")),
    )
    .await;
    assert_refused(
        &refused,
        StatusCode::UNPROCESSABLE_ENTITY,
        "channel_not_set_up",
    );
    let listed = list(server, "upcoming").await;
    assert_eq!(listed["upcoming_count"], 0);
    assert_eq!(listed["past_count"], 0);
}

/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_a_deployment_without_deliveries_offers_no_channel(pool: Pool<Postgres>) {
    let mut config = hermetic_app_config(None, None);
    config.scheduled_deliveries.enabled = false;
    let app_state = test_app_state(config, pool).await;
    let user_id = get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap()
        .id;
    personal_conversation(&app_state.db, user_id).await;
    let server = create_test_server(app_state);
    assert_eq!(
        list(&server, "upcoming").await["channels"][0]["status"],
        "unavailable"
    );
    let refused = post(
        &server,
        ITEMS,
        &reminder("Never sent", once(in_days(2), "09:00")),
    )
    .await;
    assert_refused(
        &refused,
        StatusCode::UNPROCESSABLE_ENTITY,
        "channel_unavailable",
    );
}

/// Input the form could send wrong is refused with a code, and the eleventh
/// upcoming item is refused by the cap.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_invalid_input_and_the_cap(pool: Pool<Postgres>) {
    let setup = setup(pool, true, Some("Europe/Berlin")).await;
    let server = &setup.server;
    let someone_else = get_or_create_user(&setup.db, "https://issuer.example", "other", None)
        .await
        .unwrap();
    let foreign_chat = chat_of(&setup.db, someone_else.id, "Not yours").await;

    let mut task = reminder("Run a check", once(in_days(2), "09:00"));
    task["type"] = json!("scheduled_task");
    let nameless = reminder("  ", once(in_days(2), "09:00"));
    let mut foreign = reminder("Linked elsewhere", once(in_days(2), "09:00"));
    foreign["linked_chat_id"] = json!(foreign_chat);
    let mut email = reminder("By mail", once(in_days(2), "09:00"));
    email["channel"] = json!("email");
    let no_weekday = json!({
        "kind": "repeat", "frequency": "weekly", "time": "09:00", "starts_on": in_days(0)
    });
    for (body, code) in [
        (task, "type_not_available"),
        (nameless, "invalid_request"),
        (
            reminder("Yesterday", once(in_days(-1), "09:00")),
            "trigger_in_past",
        ),
        (reminder("No weekday", no_weekday), "invalid_trigger"),
        (foreign, "linked_chat_not_found"),
        (email, "channel_unknown"),
    ] {
        assert_refused(
            &post(server, ITEMS, &body).await,
            StatusCode::UNPROCESSABLE_ENTITY,
            code,
        );
    }
    assert_eq!(list(server, "upcoming").await["upcoming_count"], 0);

    for n in 0..10 {
        post(
            server,
            ITEMS,
            &reminder(&format!("Item {n}"), once(in_days(2), "09:00")),
        )
        .await
        .assert_status(StatusCode::CREATED);
    }
    assert_refused(
        &post(
            server,
            ITEMS,
            &reminder("Eleventh", once(in_days(2), "09:00")),
        )
        .await,
        StatusCode::CONFLICT,
        "limit_reached",
    );
    assert_refused(
        &post(
            server,
            &format!("{ITEMS}/{}/snooze", Uuid::new_v4()),
            &json!({"until": Utc::now() + Duration::days(1)}),
        )
        .await,
        StatusCode::NOT_FOUND,
        "not_found",
    );
}

/// After delivery a one-off is Done, a failed delivery is Failed with the
/// reason, both in Past; system deliveries (the Teams nudge) never appear.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_delivered_and_failed_items_move_to_past(pool: Pool<Postgres>) {
    let setup = setup(pool, true, Some("Europe/Berlin")).await;
    let server = &setup.server;
    let settings = ExecutorSettings {
        batch_size: 10,
        claim_timeout: std::time::Duration::from_secs(300),
        max_attempts: 3,
        retry_delay: std::time::Duration::from_secs(60),
    };
    let make_all_due = || async {
        setup
            .db
            .execute_raw(Statement::from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                "UPDATE scheduled_deliveries SET due_at = now() - interval '1 second'
                 WHERE state IN ('pending', 'snoozed')",
                [],
            ))
            .await
            .unwrap();
    };
    setup
        .db
        .execute_raw(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            "INSERT INTO scheduled_deliveries (user_id, kind, due_at, created_by, dedupe_key)
             VALUES ($1, 'inactivity_nudge', now(), 'system', 'nudge')",
            [setup.user_id.into()],
        ))
        .await
        .unwrap();

    let done: Value = post(
        server,
        ITEMS,
        &reminder("Delivered", once(in_days(2), "09:00")),
    )
    .await
    .json();
    make_all_due().await;
    run_delivery_tick(&setup.db, &settings, &setup.registry).await;
    let delivered: Value = server
        .get(&format!("{ITEMS}/{}", done["id"].as_str().unwrap()))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(delivered["status"], "done");
    assert_eq!(delivered["last_delivery"]["outcome"], "delivered");
    assert!(delivered["last_delivery"]["delivered_at"].is_string());
    run_delivery_tick(&setup.db, &settings, &setup.registry).await;

    setup.channel.answer_with(DeliveryOutcome::Failed {
        reason: "no personal Teams conversation".into(),
    });
    let failed: Value = post(
        server,
        ITEMS,
        &reminder("Undeliverable", once(in_days(2), "09:00")),
    )
    .await
    .json();
    make_all_due().await;
    run_delivery_tick(&setup.db, &settings, &setup.registry).await;
    run_delivery_tick(&setup.db, &settings, &setup.registry).await;

    let past = list(server, "past").await;
    assert_eq!(past["past_count"], 2);
    assert_eq!(past["upcoming_count"], 0);
    let by_id = |id: &Value| {
        past["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == *id)
            .cloned()
            .unwrap()
    };
    assert_eq!(by_id(&done["id"])["status"], "done");
    let failed = by_id(&failed["id"]);
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["last_delivery"]["outcome"], "failed");
    assert_eq!(
        failed["last_delivery"]["reason"],
        "no personal Teams conversation"
    );
    assert_eq!(failed["next_occurrence"], Value::Null);
}

/// A failed occurrence that was retried first shows when it was due, not
/// when it was last tried, and no time carries fractions of a second.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_a_retried_occurrence_keeps_its_due_time(pool: Pool<Postgres>) {
    let setup = setup(pool, true, Some("Europe/Berlin")).await;
    let server = &setup.server;
    let settings = ExecutorSettings {
        batch_size: 10,
        claim_timeout: std::time::Duration::from_secs(300),
        max_attempts: 3,
        retry_delay: std::time::Duration::from_secs(60),
    };
    let created: Value = post(
        server,
        ITEMS,
        &reminder("Retried", once(in_days(2), "09:00")),
    )
    .await
    .json();
    let id = created["id"].as_str().unwrap().to_string();
    let set_due = |at: Option<DateTime<Utc>>| {
        let db = setup.db.clone();
        let id = id.clone();
        async move {
            db.execute_raw(Statement::from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                "UPDATE scheduled_deliveries
                 SET due_at = COALESCE($2, now() - interval '1 second')
                 WHERE dedupe_key = $1 AND state = 'pending'",
                [id.into(), at.map(|at| at.fixed_offset()).into()],
            ))
            .await
            .unwrap();
        }
    };
    let due = (Utc::now() - Duration::minutes(30))
        .with_second(0)
        .unwrap()
        .with_nanosecond(0)
        .unwrap();
    set_due(Some(due)).await;

    setup.channel.answer_with(DeliveryOutcome::Retry {
        reason: "transport".into(),
        retry_after: None,
    });
    assert_eq!(
        run_delivery_tick(&setup.db, &settings, &setup.registry)
            .await
            .retried,
        1
    );
    let retrying: Value = server
        .get(&format!("{ITEMS}/{id}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(retrying["status"], "scheduled");
    let next = retrying["next_occurrence"]["local"].as_str().unwrap();
    assert!(!next.contains('.'), "{next}");

    set_due(None).await;
    setup.channel.answer_with(DeliveryOutcome::Failed {
        reason: "403 MessageWritesBlocked: Message writes are blocked".into(),
    });
    assert_eq!(
        run_delivery_tick(&setup.db, &settings, &setup.registry)
            .await
            .failed,
        1
    );
    // The next tick ends the one-off, which moves it to Past.
    run_delivery_tick(&setup.db, &settings, &setup.registry).await;
    let past = list(server, "past").await;
    let failed = past["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == id.as_str())
        .cloned()
        .unwrap();
    assert_eq!(failed["status"], "failed");
    let shown = &failed["last_delivery"]["due"];
    assert_eq!(
        shown["at"],
        due.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)
    );
    assert_eq!(
        shown["local"],
        due.with_timezone(&chrono_tz::Europe::Berlin)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string()
    );
}

async fn delivery_rows(db: &DatabaseConnection, dedupe_key: &str) -> i64 {
    db.query_one_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        "SELECT count(*) AS rows FROM scheduled_deliveries WHERE dedupe_key = $1",
        [dedupe_key.into()],
    ))
    .await
    .unwrap()
    .unwrap()
    .try_get("", "rows")
    .unwrap()
}

/// Only an item that is over can be deleted, and only by its owner; it goes
/// with its occurrence rows. A cancelled item whose occurrence is being
/// delivered right now waits for that delivery.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_only_finished_items_are_deleted(pool: Pool<Postgres>) {
    let setup = setup(pool, true, Some("Europe/Berlin")).await;
    let server = &setup.server;
    let delete = |id: String, token: String| async move {
        server
            .delete(&format!("{ITEMS}/{id}"))
            .with_bearer_token(&token)
            .await
    };
    let create = |name: &'static str| async move {
        let created: Value = post(server, ITEMS, &reminder(name, once(in_days(2), "09:00")))
            .await
            .json();
        created["id"].as_str().unwrap().to_string()
    };

    let upcoming = create("Upcoming").await;
    let response = delete(upcoming.clone(), TEST_JWT_TOKEN.to_string()).await;
    assert_refused(&response, StatusCode::CONFLICT, "not_finished");
    let snoozed = server
        .post(&format!("{ITEMS}/{upcoming}/snooze"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"until": Utc::now() + Duration::days(5)}))
        .await;
    snoozed.assert_status_ok();
    let response = delete(upcoming.clone(), TEST_JWT_TOKEN.to_string()).await;
    assert_refused(&response, StatusCode::CONFLICT, "not_finished");

    let delivered = create("Delivered").await;
    setup
        .db
        .execute_raw(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            "UPDATE scheduled_deliveries SET due_at = now() - interval '1 second'
             WHERE dedupe_key = $1",
            [delivered.clone().into()],
        ))
        .await
        .unwrap();
    let settings = ExecutorSettings {
        batch_size: 10,
        claim_timeout: std::time::Duration::from_secs(300),
        max_attempts: 3,
        retry_delay: std::time::Duration::from_secs(60),
    };
    run_delivery_tick(&setup.db, &settings, &setup.registry).await;
    assert_eq!(setup.channel.deliveries().len(), 1);
    let other = JwtTokenBuilder::new().subject("someone-else").build();
    let response = delete(delivered.clone(), other).await;
    assert_refused(&response, StatusCode::NOT_FOUND, "not_found");
    delete(delivered.clone(), TEST_JWT_TOKEN.to_string())
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let gone = server
        .get(&format!("{ITEMS}/{delivered}"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    assert_refused(&gone, StatusCode::NOT_FOUND, "not_found");
    assert_eq!(delivery_rows(&setup.db, &delivered).await, 0);
    let response = delete(delivered.clone(), TEST_JWT_TOKEN.to_string()).await;
    assert_refused(&response, StatusCode::NOT_FOUND, "not_found");

    let cancelled = create("Cancelled").await;
    server
        .post(&format!("{ITEMS}/{cancelled}/cancel"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    delete(cancelled.clone(), TEST_JWT_TOKEN.to_string())
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert_eq!(delivery_rows(&setup.db, &cancelled).await, 0);

    let in_flight = create("In flight").await;
    setup
        .db
        .execute_raw(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            "UPDATE scheduled_deliveries SET state = 'claimed', claimed_at = now()
             WHERE dedupe_key = $1",
            [in_flight.clone().into()],
        ))
        .await
        .unwrap();
    server
        .post(&format!("{ITEMS}/{in_flight}/cancel"))
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .assert_status_ok();
    let response = delete(in_flight.clone(), TEST_JWT_TOKEN.to_string()).await;
    assert_refused(&response, StatusCode::CONFLICT, "not_finished");
    assert_eq!(delivery_rows(&setup.db, &in_flight).await, 1);

    let unknown = delete(Uuid::new_v4().to_string(), TEST_JWT_TOKEN.to_string()).await;
    assert_refused(&unknown, StatusCode::NOT_FOUND, "not_found");
    let past = list(server, "past").await;
    assert_eq!(past["past_count"], 1);
    assert_eq!(past["items"][0]["id"], in_flight.as_str());
}

/// Templates come from `[scheduled.templates]` in `priority_order`, then by
/// id; none ship in code, and a switched-off section offers none.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_templates_come_from_the_config(pool: Pool<Postgres>) {
    let template = |title: &str| ScheduledTemplateConfig {
        r#type: ScheduledTemplateType::Reminder,
        title: title.to_string(),
        description: format!("About {title}"),
        name: format!("{title} name"),
        message: String::new(),
    };
    let mut config = hermetic_app_config(None, None);
    let templates = &mut config.scheduled.templates;
    templates.enabled = true;
    templates.priority_order = vec!["meeting".into(), "missing".into(), "offer".into()];
    for (id, title) in [
        ("offer", "Follow up on an offer"),
        ("meeting", "Prepare for a meeting"),
        ("deadline", "Before a deadline"),
        ("chat", "Continue a chat later"),
    ] {
        templates.templates.insert(id.into(), template(title));
    }
    let disabled = {
        let mut config = config.clone();
        config.scheduled.templates.enabled = false;
        config
    };
    let server = create_test_server(test_app_state(config, pool.clone()).await);
    let response = server
        .get(TEMPLATES)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await;
    response.assert_status_ok();
    let body: Value = response.json();
    let ids: Vec<&str> = body["templates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|template| template["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["meeting", "offer", "chat", "deadline"]);
    assert_eq!(
        body["templates"][0],
        json!({
            "id": "meeting",
            "type": "reminder",
            "title": "Prepare for a meeting",
            "description": "About Prepare for a meeting",
            "name": "Prepare for a meeting name",
            "message": "",
        })
    );

    let server = create_test_server(test_app_state(disabled, pool.clone()).await);
    let body: Value = server
        .get(TEMPLATES)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(body, json!({"templates": []}));
    let server = create_test_server(test_app_state(hermetic_app_config(None, None), pool).await);
    let body: Value = server
        .get(TEMPLATES)
        .with_bearer_token(TEST_JWT_TOKEN)
        .await
        .json();
    assert_eq!(body, json!({"templates": []}));
}
