//! The inactivity nudge: who gets a tip, once per inactivity period, and
//! what stops it at send time.

use super::*;
use chrono::{Timelike, Utc};
use erato::db::entity::scheduled_deliveries::DeliveryState;
use erato::models::user_preference::{
    record_client_locale, set_teams_nudges_opt_out, teams_nudges_opted_out,
};
use erato::ms_teams_bot::nudge::{CHANNEL, DeliverySubmit, InactivityNudgeProducer, KIND};
use erato::services::scheduled_deliveries::{
    DeliveryOutcome, DeliveryProducer, DeliveryRegistry, ExecutorSettings, RecordingChannel,
    StillDue, find, run_delivery_tick,
};
use erato_config::config::{TeamsInactivityNudgeConfig, TeamsNudgeSendWindowConfig};
use sea_orm::prelude::Uuid;
use sea_orm::{ConnectionTrait, DatabaseConnection, Statement};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

const APP_NAME: &str = "Hugo";

fn config() -> TeamsInactivityNudgeConfig {
    TeamsInactivityNudgeConfig {
        enabled: true,
        inactive_after: "2h".into(),
        tips: vec!["Tip one".into(), "Tip two".into()],
        send_window: TeamsNudgeSendWindowConfig {
            weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
                .into_iter()
                .map(String::from)
                .collect(),
            start_hour: 0,
            end_hour: 24,
            time_zone: "UTC".into(),
        },
        ..TeamsInactivityNudgeConfig::default()
    }
}

fn producer(config: &TeamsInactivityNudgeConfig) -> InactivityNudgeProducer {
    InactivityNudgeProducer::from_config(config, APP_NAME, Some("https://hugo.example.com"), "en")
        .expect("producer")
}

fn settings() -> ExecutorSettings {
    ExecutorSettings {
        batch_size: 20,
        claim_timeout: Duration::from_secs(300),
        max_attempts: 3,
        retry_delay: Duration::from_secs(60),
    }
}

async fn sql(db: &DatabaseConnection, sql: &str, values: Vec<sea_orm::Value>) {
    db.execute_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        sql,
        values,
    ))
    .await
    .expect("statement runs");
}

async fn personal_conversation(db: &DatabaseConnection, user_id: Uuid, conversation_id: &str) {
    sql(
        db,
        "INSERT INTO ms_teams_conversations (conversation_id, conversation_type, user_id, service_url, ms_teams_user_id)
         VALUES ($1, 'personal', $2, 'https://smba.example/', '29:user')",
        vec![conversation_id.into(), user_id.into()],
    )
    .await;
}

/// Replace the user's chats with one whose last update was `hours_ago`;
/// chats cannot be backdated in place because the update trigger stamps
/// `updated_at`.
async fn last_activity_hours_ago(db: &DatabaseConnection, user_id: Uuid, hours_ago: f64) {
    sql(
        db,
        "DELETE FROM chats WHERE owner_user_id = $1",
        vec![user_id.to_string().into()],
    )
    .await;
    sql(
        db,
        "INSERT INTO chats (owner_user_id, created_at, updated_at)
         VALUES ($1, now() - make_interval(secs => $2 * 3600), now() - make_interval(secs => $2 * 3600))",
        vec![user_id.to_string().into(), hours_ago.into()],
    )
    .await;
}

async fn user(db: &DatabaseConnection, subject: &str, email: &str) -> users::Model {
    get_or_create_user(db, "https://issuer.example", subject, Some(email))
        .await
        .expect("user")
}

async fn open_rows(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Vec<erato::db::entity::scheduled_deliveries::Model> {
    use erato::db::entity::prelude::ScheduledDeliveries;
    use erato::db::entity::scheduled_deliveries::Column;
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
    ScheduledDeliveries::find()
        .filter(Column::UserId.eq(user_id))
        .filter(Column::Kind.eq(KIND))
        .order_by_asc(Column::CreatedAt)
        .all(db)
        .await
        .expect("rows")
}

/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn tips_go_to_inactive_reachable_users_who_did_not_opt_out(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let inactive = user(&db, "inactive", "inactive@example.com").await;
    personal_conversation(&db, inactive.id, "a:inactive").await;
    last_activity_hours_ago(&db, inactive.id, 3.0).await;
    let active = user(&db, "active", "active@example.com").await;
    personal_conversation(&db, active.id, "a:active").await;
    last_activity_hours_ago(&db, active.id, 1.0).await;
    let unreachable = user(&db, "unreachable", "unreachable@example.com").await;
    last_activity_hours_ago(&db, unreachable.id, 3.0).await;
    let opted_out = user(&db, "opted-out", "opted-out@example.com").await;
    personal_conversation(&db, opted_out.id, "a:opted-out").await;
    last_activity_hours_ago(&db, opted_out.id, 3.0).await;
    set_teams_nudges_opt_out(&db, &opted_out.id, true)
        .await
        .unwrap();
    // Never chatted, but known to Erato for longer than the interval.
    let silent = user(&db, "silent", "silent@example.com").await;
    personal_conversation(&db, silent.id, "a:silent").await;
    sql(
        &db,
        "UPDATE users SET created_at = now() - interval '5 hours' WHERE id = $1",
        vec![silent.id.into()],
    )
    .await;

    let producer = producer(&config());
    assert_eq!(producer.schedule_due(&db).await.unwrap(), 2);
    assert_eq!(
        producer.schedule_due(&db).await.unwrap(),
        0,
        "a period is scheduled once"
    );
    for (user, expected) in [
        (&inactive, 1),
        (&active, 0),
        (&unreachable, 0),
        (&opted_out, 0),
        (&silent, 1),
    ] {
        assert_eq!(
            open_rows(&db, user.id).await.len(),
            expected,
            "{}",
            user.subject
        );
    }
    let row = open_rows(&db, inactive.id).await.remove(0);
    assert_eq!(row.state, DeliveryState::Pending);
    assert!(
        row.due_at <= Utc::now().fixed_offset(),
        "the all-day window makes it due now"
    );
    assert_eq!(row.origin["rule"], KIND);
    assert_eq!(row.origin["sequence"], 1);
    assert!(row.dedupe_key.as_deref().unwrap().ends_with("#1"));

    // A pilot list narrows the rule to the listed addresses.
    let pilot = producer_with(|config| {
        config.pilot_users = vec!["Inactive@Example.com".into()];
        config.inactive_after = "1m".into();
    });
    let newcomer = user(&db, "newcomer", "newcomer@example.com").await;
    personal_conversation(&db, newcomer.id, "a:newcomer").await;
    last_activity_hours_ago(&db, newcomer.id, 3.0).await;
    assert_eq!(pilot.schedule_due(&db).await.unwrap(), 0);
    assert!(open_rows(&db, newcomer.id).await.is_empty());
}

fn producer_with(adjust: impl FnOnce(&mut TeamsInactivityNudgeConfig)) -> InactivityNudgeProducer {
    let mut config = config();
    adjust(&mut config);
    producer(&config)
}

/// A tip goes out without a message to answer, so the card around it
/// follows the user's stored language, else the deployment's default. The
/// tip stays as the admin entered it.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn the_tip_card_follows_the_stored_language(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let german = user(&db, "german", "german@example.com").await;
    record_client_locale(&db, &german.id, None, Some("de-AT"))
        .await
        .unwrap();
    let unset = user(&db, "unset", "unset@example.com").await;
    for (user, conversation) in [(&german, "a:german"), (&unset, "a:unset")] {
        personal_conversation(&db, user.id, conversation).await;
        last_activity_hours_ago(&db, user.id, 3.0).await;
    }
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let mut registry = DeliveryRegistry::new();
    registry.register_producer(Arc::new(producer(&config())));
    registry.register_channel(channel.clone());
    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(outcome.delivered, 2, "{outcome:?}");
    let card_of = |user_id: Uuid| {
        channel
            .deliveries()
            .into_iter()
            .find(|delivery| delivery.user_id == user_id)
            .expect("a tip")
            .content
    };
    let card = card_of(german.id);
    assert_eq!(card.text, "Tip one");
    assert_eq!(card.summary.as_deref(), Some("Ein Tipp von Hugo"));
    assert_eq!(card.links[0].title, "Hugo öffnen");
    assert_eq!(card.actions[0].title, "Nicht mehr erinnern");
    assert_eq!(card_of(unset.id).actions[0].title, "Don't remind me");

    let defaults_to_german =
        InactivityNudgeProducer::from_config(&config(), APP_NAME, None, "de").expect("producer");
    let mut registry = DeliveryRegistry::new();
    registry.register_producer(Arc::new(defaults_to_german));
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    registry.register_channel(channel.clone());
    let newcomer = user(&db, "newcomer", "newcomer@example.com").await;
    personal_conversation(&db, newcomer.id, "a:newcomer").await;
    last_activity_hours_ago(&db, newcomer.id, 3.0).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    let delivered = channel.deliveries();
    assert_eq!(delivered.len(), 1);
    assert_eq!(delivered[0].content.actions[0].title, "Nicht mehr erinnern");
}

/// One tip per inactivity period, the next only after the user was active
/// again; tips rotate; the card carries the link and a single-use button.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn one_tip_per_period_with_rotating_tips(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let user = user(&db, "periodic", "periodic@example.com").await;
    personal_conversation(&db, user.id, "a:periodic").await;
    last_activity_hours_ago(&db, user.id, 3.0).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let mut registry = DeliveryRegistry::new();
    registry.register_producer(Arc::new(producer(&config())));
    registry.register_channel(channel.clone());

    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!((outcome.produced, outcome.delivered), (1, 1), "{outcome:?}");
    let first = channel.deliveries().remove(0);
    assert_eq!(first.content.text, "Tip one");
    assert_eq!(first.content.summary.as_deref(), Some("A tip from Hugo"));
    assert_eq!(first.content.links[0].title, "Open Hugo");
    assert_eq!(first.content.links[0].url, "https://hugo.example.com");
    assert_eq!(first.content.actions[0].title, "Don't remind me");
    let token = first.content.actions[0].token.expect("single-use token");
    let delivered = find(&db, first.delivery_id).await.unwrap().unwrap();
    assert_eq!(delivered.state, DeliveryState::Delivered);
    assert_eq!(delivered.outcome["action_token"], token.to_string());
    assert!(delivered.outcome["action_expires_at"].is_string());

    // Still silent: the same period gets nothing more, however often we run.
    // (The producer's hourly gate is bypassed by driving the rule directly.)
    let producer = producer(&config());
    assert_eq!(producer.schedule_due(&db).await.unwrap(), 0);
    assert!(
        !run_delivery_tick(&db, &settings(), &registry)
            .await
            .touched()
    );

    // Active again and then silent for another interval: a new period. The
    // registry's producer is still inside its hourly gate, so the rule is
    // driven directly and the tick only delivers.
    last_activity_hours_ago(&db, user.id, 2.5).await;
    age_rows(&db, user.id, 3.0).await;
    assert_eq!(producer.schedule_due(&db).await.unwrap(), 1, "a new period");
    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(outcome.delivered, 1, "{outcome:?}");
    let second = channel.deliveries().remove(1);
    assert_eq!(second.content.text, "Tip two", "the next tip in turn");
    assert_ne!(second.content.actions[0].token, Some(token));
    assert_eq!(open_rows(&db, user.id).await.len(), 2);
}

/// With `repeat`, each further interval of silence gets one more tip.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn repeat_sends_one_tip_per_further_interval(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let user = user(&db, "repeat", "repeat@example.com").await;
    personal_conversation(&db, user.id, "a:repeat").await;
    last_activity_hours_ago(&db, user.id, 2.5).await;
    let producer = producer_with(|config| {
        config.repeat = true;
        config.inactive_after = "1h".into();
    });

    assert_eq!(producer.schedule_due(&db).await.unwrap(), 1);
    let rows = open_rows(&db, user.id).await;
    assert_eq!(
        rows[0].origin["sequence"], 2,
        "two full intervals have passed"
    );
    assert_eq!(producer.schedule_due(&db).await.unwrap(), 0);

    // Time passes (modelled as the same silence seen from later).
    last_activity_hours_ago(&db, user.id, 3.5).await;
    assert_eq!(
        producer.schedule_due(&db).await.unwrap(),
        0,
        "the last tip is less than an interval old: no burst"
    );
    age_rows(&db, user.id, 1.5).await;
    assert_eq!(producer.schedule_due(&db).await.unwrap(), 1);
    let rows = open_rows(&db, user.id).await;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].origin["sequence"], 3);

    // Without `repeat`, the same silence would get nothing more.
    let once = producer_with(|config| config.inactive_after = "1h".into());
    assert_eq!(once.schedule_due(&db).await.unwrap(), 0);
}

/// The send-time guard drops a tip for a user who became active, opted out
/// or lost their personal conversation since it was scheduled.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn guard_drops_tips_that_are_no_longer_owed(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let producer = Arc::new(producer(&config()));
    let mut users = Vec::new();
    for subject in ["became-active", "opted-out", "left", "still-due"] {
        let user = user(&db, subject, &format!("{subject}@example.com")).await;
        personal_conversation(&db, user.id, &format!("a:{subject}")).await;
        last_activity_hours_ago(&db, user.id, 3.0).await;
        users.push(user);
    }
    assert_eq!(producer.schedule_due(&db).await.unwrap(), 4);

    last_activity_hours_ago(&db, users[0].id, 0.1).await;
    set_teams_nudges_opt_out(&db, &users[1].id, true)
        .await
        .unwrap();
    sql(
        &db,
        "DELETE FROM ms_teams_conversations WHERE user_id = $1",
        vec![users[2].id.into()],
    )
    .await;
    for (user, expected) in [
        (&users[0], "user became active"),
        (&users[1], "user opted out"),
        (&users[2], "no personal Teams conversation"),
    ] {
        let row = open_rows(&db, user.id).await.remove(0);
        assert_eq!(
            producer.still_due(&db, &row).await.unwrap(),
            StillDue::No {
                reason: expected.into()
            }
        );
    }
    let row = open_rows(&db, users[3].id).await.remove(0);
    assert_eq!(producer.still_due(&db, &row).await.unwrap(), StillDue::Yes);

    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let mut registry = DeliveryRegistry::new();
    registry.register_producer(producer.clone());
    registry.register_channel(channel.clone());
    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(
        (outcome.cancelled, outcome.delivered),
        (3, 1),
        "{outcome:?}"
    );
    assert_eq!(channel.deliveries()[0].user_id, users[3].id);
    assert_eq!(
        open_rows(&db, users[0].id).await[0].outcome["reason"],
        "user became active"
    );
}

/// The running server's producer reads the reloadable settings on every use,
/// so a reload (an admin-panel change) applies without a restart: switched
/// off, nothing is scheduled and an open tip is cancelled at send time;
/// switched on again, the current pilot list decides.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn the_producer_follows_reloaded_settings(pool: Pool<Postgres>) {
    let app_state =
        crate::test_app_state(crate::test_utils::hermetic_app_config(None, None), pool).await;
    let db = app_state.db.clone();
    app_state.reloadable.write().await.teams_nudge = config();
    let producer =
        InactivityNudgeProducer::reloadable(app_state.reloadable.clone(), APP_NAME, None, "en");

    let inactive = user(&db, "reloaded", "reloaded@example.com").await;
    personal_conversation(&db, inactive.id, "a:reloaded").await;
    last_activity_hours_ago(&db, inactive.id, 3.0).await;
    assert_eq!(producer.schedule_due(&db).await.unwrap(), 1);
    let row = open_rows(&db, inactive.id).await.remove(0);
    assert_eq!(producer.still_due(&db, &row).await.unwrap(), StillDue::Yes);

    app_state.reloadable.write().await.teams_nudge.enabled = false;
    assert_eq!(producer.produce(&db).await.unwrap(), 0);
    assert_eq!(
        producer.still_due(&db, &row).await.unwrap(),
        StillDue::No {
            reason: "inactivity nudge switched off".into()
        }
    );

    {
        let mut reloadable = app_state.reloadable.write().await;
        reloadable.teams_nudge.enabled = true;
        reloadable.teams_nudge.pilot_users = vec!["someone-else@example.com".into()];
    }
    assert_eq!(
        producer.still_due(&db, &row).await.unwrap(),
        StillDue::No {
            reason: "not a pilot user".into()
        }
    );
}

/// The card's button is claimed once, only by the user it was sent to and
/// only from the conversation it was sent in; `/reminders` toggles the
/// preference the producer and guard read.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn card_buttons_are_single_use_and_bound_to_their_recipient(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let db = app_state.db.clone();
    let host = Host::new(app_state.clone());
    let recipient = user(&db, "recipient", "recipient@example.com").await;
    personal_conversation(&db, recipient.id, "a:recipient").await;
    last_activity_hours_ago(&db, recipient.id, 3.0).await;
    let other = user(&db, "other", "other@example.com").await;

    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    channel.answer_with(DeliveryOutcome::Delivered {
        details: json!({"conversation_id": "a:recipient", "activity_id": "1"}),
    });
    let mut registry = DeliveryRegistry::new();
    registry.register_producer(Arc::new(producer(&config())));
    registry.register_channel(channel.clone());
    assert_eq!(
        run_delivery_tick(&db, &settings(), &registry)
            .await
            .delivered,
        1
    );
    let delivered = channel.deliveries().remove(0);
    let token = delivered.content.actions[0].token.unwrap();
    let submit = |token: Uuid| {
        DeliverySubmit::from_value(&json!({
            "action": "erato_delivery_action",
            "delivery_id": delivered.delivery_id,
            "command": "opt_out",
            "token": token,
        }))
        .unwrap()
    };

    assert!(
        !host
            .claim_delivery_action(other.id, "a:recipient", &submit(token))
            .await
            .unwrap(),
        "someone else's card"
    );
    assert!(
        !host
            .claim_delivery_action(recipient.id, "a:forwarded", &submit(token))
            .await
            .unwrap(),
        "another conversation"
    );
    assert!(
        !host
            .claim_delivery_action(recipient.id, "a:recipient", &submit(Uuid::new_v4()))
            .await
            .unwrap(),
        "a made-up token"
    );
    assert!(
        host.claim_delivery_action(recipient.id, "a:recipient", &submit(token))
            .await
            .unwrap()
    );
    assert!(
        !host
            .claim_delivery_action(recipient.id, "a:recipient", &submit(token))
            .await
            .unwrap(),
        "claimed once"
    );
    let row = find(&db, delivered.delivery_id).await.unwrap().unwrap();
    assert_eq!(row.outcome["action_command"], "opt_out");

    host.set_teams_nudges_opt_out(recipient.id, true)
        .await
        .unwrap();
    assert!(teams_nudges_opted_out(&db, &recipient.id).await.unwrap());
    last_activity_hours_ago(&db, recipient.id, 2.5).await;
    age_rows(&db, recipient.id, 3.0).await;
    let producer = producer(&config());
    assert_eq!(producer.schedule_due(&db).await.unwrap(), 0, "opted out");
    host.set_teams_nudges_opt_out(recipient.id, false)
        .await
        .unwrap();
    assert!(!teams_nudges_opted_out(&db, &recipient.id).await.unwrap());
    assert_eq!(
        producer.schedule_due(&db).await.unwrap(),
        1,
        "tips on again"
    );
}

/// Backdate the user's tip rows, modelling the time since they were sent.
async fn age_rows(db: &DatabaseConnection, user_id: Uuid, hours_ago: f64) {
    sql(
        db,
        "UPDATE scheduled_deliveries
         SET created_at = now() - make_interval(secs => $2 * 3600),
             delivered_at = CASE WHEN delivered_at IS NULL THEN NULL
                            ELSE now() - make_interval(secs => $2 * 3600) END
         WHERE user_id = $1 AND kind = $3",
        vec![user_id.into(), hours_ago.into(), KIND.into()],
    )
    .await;
}

/// Housekeeping writes to a chat (archiving moves `updated_at`) are not
/// activity; a new message is.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn only_messages_count_as_activity(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let user = user(&db, "housekept", "housekept@example.com").await;
    personal_conversation(&db, user.id, "a:housekept").await;
    last_activity_hours_ago(&db, user.id, 3.0).await;
    sql(
        &db,
        "UPDATE chats SET archived_at = now() WHERE owner_user_id = $1",
        vec![user.id.to_string().into()],
    )
    .await;

    let producer = producer(&config());
    assert_eq!(
        producer.schedule_due(&db).await.unwrap(),
        1,
        "archiving is not activity"
    );
    let row = open_rows(&db, user.id).await.remove(0);
    assert_eq!(producer.still_due(&db, &row).await.unwrap(), StillDue::Yes);

    sql(
        &db,
        "INSERT INTO messages (chat_id, raw_message, created_at)
         SELECT id, '{\"role\": \"user\", \"content\": \"hi\"}'::jsonb, now() - interval '10 minutes'
         FROM chats WHERE owner_user_id = $1",
        vec![user.id.to_string().into()],
    )
    .await;
    assert_eq!(
        producer.still_due(&db, &row).await.unwrap(),
        StillDue::No {
            reason: "user became active".into()
        }
    );
}

/// A tip that comes up outside the send window (a retry, a restart that
/// straddled the window) waits for the next slot instead of going out late
/// or being dropped.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn tips_outside_the_send_window_wait_for_the_next_slot(pool: Pool<Postgres>) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let user = user(&db, "after-hours", "after-hours@example.com").await;
    personal_conversation(&db, user.id, "a:after-hours").await;
    last_activity_hours_ago(&db, user.id, 3.0).await;
    // Scheduled by the all-day rule; delivered by one whose window is closed now.
    assert_eq!(producer(&config()).schedule_due(&db).await.unwrap(), 1);
    let start = ((Utc::now().hour() + 2) % 24) as u8;
    let closed = producer_with(|config| {
        config.send_window.start_hour = start;
        config.send_window.end_hour = start + 1;
    });
    let expected = closed
        .settings()
        .await
        .unwrap()
        .window()
        .next_slot(Utc::now());
    assert!(expected > Utc::now());

    let row = open_rows(&db, user.id).await.remove(0);
    assert_eq!(
        closed.still_due(&db, &row).await.unwrap(),
        StillDue::Later { due_at: expected }
    );

    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let mut registry = DeliveryRegistry::new();
    registry.register_producer(Arc::new(closed));
    registry.register_channel(channel.clone());
    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!((outcome.deferred, outcome.delivered), (1, 0), "{outcome:?}");
    let waiting = find(&db, row.id).await.unwrap().unwrap();
    assert_eq!(waiting.state, DeliveryState::Pending);
    assert_eq!(waiting.due_at.with_timezone(&Utc), expected);
    assert!(waiting.outcome.get("attempts").is_none());
    assert!(channel.deliveries().is_empty());
}
