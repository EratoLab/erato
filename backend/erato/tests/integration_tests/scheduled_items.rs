//! Scheduled items on the delivery executor: a repeating item gets its next
//! occurrence after each one, until its end; snoozing, editing and cancelling
//! act on the series as the Scheduled page expects; several replicas deliver
//! each occurrence once.

use crate::MIGRATOR;
use chrono::{DateTime, Duration, NaiveDate, Utc};
use erato::db::entity::prelude::{ScheduledDeliveries, ScheduledItems};
use erato::db::entity::scheduled_deliveries::{self, DeliveryState};
use erato::db::entity::scheduled_items::{ItemStatus, Model};
use erato::db::entity::users;
use erato::models::user::get_or_create_user;
use erato::services::scheduled_deliveries::{
    DeliveryProducer, DeliveryRegistry, ExecutorSettings, RecordingChannel, StillDue,
    run_delivery_tick, snooze,
};
use erato::services::scheduled_items::recurrence::{
    Frequency, LocalTime, RepeatEnd, RepeatRule, Trigger,
};
use erato::services::scheduled_items::{
    ItemInput, REMINDER, Refusal, ReminderProducer, cancel, create, current_occurrence, update,
};
use sea_orm::prelude::Uuid;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter, Statement,
};
use serde_json::json;
use sqlx::{Pool, Postgres};
use std::sync::Arc;
use std::time::Duration as StdDuration;

const CHANNEL: &str = "teams_personal";
const BASE_URL: &str = "https://erato.example.com";

fn settings() -> ExecutorSettings {
    ExecutorSettings {
        batch_size: 10,
        claim_timeout: StdDuration::from_secs(300),
        max_attempts: 3,
        retry_delay: StdDuration::from_secs(60),
    }
}

fn registry(channel: &Arc<RecordingChannel>) -> DeliveryRegistry {
    let mut registry = DeliveryRegistry::new();
    registry.register_producer(Arc::new(ReminderProducer::new(Some(format!(
        "{BASE_URL}/"
    )))));
    registry.register_channel(channel.clone());
    registry
}

async fn database(pool: Pool<Postgres>) -> (DatabaseConnection, users::Model) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let user = get_or_create_user(&db, "https://issuer.example", "scheduling-user", None)
        .await
        .expect("user");
    (db, user)
}

fn today() -> NaiveDate {
    Utc::now().date_naive()
}

fn daily(time: LocalTime, ends: RepeatEnd) -> Trigger {
    Trigger::Repeat(RepeatRule {
        frequency: Frequency::Daily,
        weekdays: Vec::new(),
        time,
        starts_on: today() - Duration::days(3),
        ends,
    })
}

fn nine() -> LocalTime {
    LocalTime::new(9, 0).unwrap()
}

/// UTC keeps the arithmetic of these tests free of daylight-saving
/// changes; the recurrence unit tests cover those.
fn input(trigger: Trigger) -> ItemInput {
    ItemInput {
        kind: REMINDER.into(),
        name: "Stand-up notes".into(),
        message: "Bring the numbers for the Q4 call.".into(),
        linked_chat_id: None,
        channel: CHANNEL.into(),
        trigger,
        time_zone: chrono_tz::UTC,
    }
}

async fn create_item(db: &DatabaseConnection, user_id: Uuid, input: ItemInput) -> Model {
    create(db, user_id, input, json!({"test": true}))
        .await
        .unwrap()
        .expect("item created")
}

async fn reload(db: &DatabaseConnection, item: &Model) -> Model {
    ScheduledItems::find_by_id(item.id)
        .one(db)
        .await
        .unwrap()
        .unwrap()
}

async fn open(db: &DatabaseConnection, item: &Model) -> Option<scheduled_deliveries::Model> {
    current_occurrence(db, item).await.unwrap()
}

async fn occurrences(db: &DatabaseConnection, item: &Model) -> Vec<scheduled_deliveries::Model> {
    use sea_orm::QueryOrder;
    ScheduledDeliveries::find()
        .filter(scheduled_deliveries::Column::DedupeKey.eq(item.id.to_string()))
        .order_by_asc(scheduled_deliveries::Column::CreatedAt)
        .all(db)
        .await
        .unwrap()
}

async fn make_due(db: &DatabaseConnection, id: Uuid) {
    db.execute_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        "UPDATE scheduled_deliveries SET due_at = now() - interval '1 second' WHERE id = $1",
        [id.into()],
    ))
    .await
    .expect("row made due");
}

fn utc(at: sea_orm::prelude::DateTimeWithTimeZone) -> DateTime<Utc> {
    at.with_timezone(&Utc)
}

/// A daily reminder is delivered with its name and message, and the next
/// occurrence follows at the regular time once the current one is settled.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn a_repeating_reminder_gets_its_next_occurrence_after_each_delivery(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry(&channel);
    let item = create_item(&db, user.id, input(daily(nine(), RepeatEnd::Never))).await;
    assert_eq!(item.status, ItemStatus::Active);
    assert_eq!(item.occurrence_count, 1);
    let first = open(&db, &item).await.expect("first occurrence");
    assert_eq!(Some(first.due_at), item.occurrence_at);
    assert!(utc(first.due_at) > Utc::now());
    assert_eq!(first.created_by, scheduled_deliveries::CreatedBy::User);
    assert_eq!(first.payload["item_id"], item.id.to_string());

    make_due(&db, first.id).await;
    let tick = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(tick.delivered, 1, "{tick:?}");
    let delivered = channel.deliveries();
    assert_eq!(delivered[0].delivery_id, first.id);
    assert_eq!(
        delivered[0].content.title.as_deref(),
        Some("Stand-up notes")
    );
    assert_eq!(
        delivered[0].content.text,
        "Bring the numbers for the Q4 call."
    );
    assert!(delivered[0].content.links.is_empty());
    assert!(delivered[0].content.actions.is_empty());

    let tick = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(tick.produced, 1, "{tick:?}");
    let second = open(&db, &item).await.expect("second occurrence");
    assert_eq!(
        utc(second.due_at),
        utc(first.due_at) + Duration::days(1),
        "the next one keeps the regular time"
    );
    let item = reload(&db, &item).await;
    assert_eq!(item.occurrence_count, 2);
    assert_eq!(item.occurrence_at, Some(second.due_at));
    assert_eq!(second.payload["occurrence"], 2);

    let tick = run_delivery_tick(&db, &settings(), &registry).await;
    assert!(!tick.touched(), "{tick:?}");
}

/// "After N times", "on a date" and a one-off all end the item once their
/// last occurrence is settled.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn the_series_stops_at_its_end(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry(&channel);

    let twice = create_item(
        &db,
        user.id,
        input(daily(nine(), RepeatEnd::AfterCount { count: 2 })),
    )
    .await;
    for _ in 0..2 {
        let row = open(&db, &twice).await.expect("an open occurrence");
        make_due(&db, row.id).await;
        run_delivery_tick(&db, &settings(), &registry).await;
        run_delivery_tick(&db, &settings(), &registry).await;
    }
    let twice = reload(&db, &twice).await;
    assert_eq!(twice.status, ItemStatus::Ended);
    assert_eq!(twice.occurrence_count, 2);
    assert!(open(&db, &twice).await.is_none());

    let first_day = {
        let probe = create_item(&db, user.id, input(daily(nine(), RepeatEnd::Never))).await;
        let day = utc(probe.occurrence_at.unwrap()).date_naive();
        cancel(&db, user.id, probe.id).await.unwrap().unwrap();
        day
    };
    let until = create_item(
        &db,
        user.id,
        input(daily(nine(), RepeatEnd::OnDate { date: first_day })),
    )
    .await;
    make_due(&db, open(&db, &until).await.unwrap().id).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(reload(&db, &until).await.status, ItemStatus::Ended);

    let once = create_item(
        &db,
        user.id,
        input(Trigger::Once {
            date: today() + Duration::days(1),
            time: nine(),
        }),
    )
    .await;
    make_due(&db, open(&db, &once).await.unwrap().id).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    let once = reload(&db, &once).await;
    assert_eq!(once.status, ItemStatus::Ended);
    assert_eq!(occurrences(&db, &once).await.len(), 1);
    assert_eq!(channel.deliveries().len(), 4);
}

/// A snoozed occurrence goes out at the snoozed time; the next one keeps
/// the regular time.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn snoozing_moves_only_the_current_occurrence(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry(&channel);
    let item = create_item(&db, user.id, input(daily(nine(), RepeatEnd::Never))).await;
    let first = open(&db, &item).await.unwrap();
    let regular = utc(first.due_at);

    assert!(
        snooze(&db, first.id, regular + Duration::minutes(30))
            .await
            .unwrap()
    );
    let snoozed = open(&db, &item).await.unwrap();
    assert_eq!(snoozed.state, DeliveryState::Snoozed);
    assert_eq!(utc(snoozed.due_at), regular + Duration::minutes(30));
    assert_eq!(
        utc(reload(&db, &item).await.occurrence_at.unwrap()),
        regular
    );

    make_due(&db, first.id).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    let next = open(&db, &item).await.expect("next occurrence");
    assert_eq!(utc(next.due_at), regular + Duration::days(1));
}

/// Several replicas ticking at once deliver the occurrence once and create
/// one next occurrence between them.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn several_replicas_deliver_each_occurrence_once(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = Arc::new(registry(&channel));
    let item = create_item(&db, user.id, input(daily(nine(), RepeatEnd::Never))).await;
    make_due(&db, open(&db, &item).await.unwrap().id).await;

    let tick = |db: DatabaseConnection, registry: Arc<DeliveryRegistry>| async move {
        run_delivery_tick(&db, &settings(), &registry).await
    };
    let mut delivered = 0;
    let mut produced = 0;
    // The second round's producers run after the delivery has settled; a
    // tick of the first round may already have created the next one.
    for _ in 0..2 {
        let (a, b, c) = tokio::join!(
            tick(db.clone(), registry.clone()),
            tick(db.clone(), registry.clone()),
            tick(db.clone(), registry.clone()),
        );
        delivered += a.delivered + b.delivered + c.delivered;
        produced += a.produced + b.produced + c.produced;
    }
    assert_eq!(delivered, 1);
    assert_eq!(channel.deliveries().len(), 1);
    assert_eq!(produced, 1);
    let rows = occurrences(&db, &item).await;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].state, DeliveryState::Delivered);
    assert_eq!(rows[1].state, DeliveryState::Pending);
    assert_eq!(reload(&db, &item).await.occurrence_count, 2);
}

/// Editing the trigger moves the open occurrence (and drops its snooze);
/// editing only the text leaves the time alone; cancelling ends the series;
/// a finished item and someone else's item cannot be changed.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn editing_and_cancelling_act_on_the_coming_occurrences(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let other = get_or_create_user(&db, "https://issuer.example", "someone-else", None)
        .await
        .unwrap();
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry(&channel);
    let item = create_item(&db, user.id, input(daily(nine(), RepeatEnd::Never))).await;
    let first = open(&db, &item).await.unwrap();

    let ten = LocalTime::new(10, 0).unwrap();
    let edited = update(&db, user.id, item.id, input(daily(ten, RepeatEnd::Never)))
        .await
        .unwrap()
        .unwrap();
    let moved = open(&db, &item).await.unwrap();
    assert_eq!(moved.id, first.id, "the same row is rescheduled");
    assert_eq!(
        utc(moved.due_at).time(),
        chrono::NaiveTime::from_hms_opt(10, 0, 0).unwrap()
    );
    assert!(utc(moved.due_at) > Utc::now());
    assert_eq!(edited.occurrence_at, Some(moved.due_at));
    assert_eq!(edited.occurrence_count, 1);

    snooze(&db, moved.id, utc(moved.due_at) + Duration::hours(1))
        .await
        .unwrap();
    let mut text_only = input(daily(ten, RepeatEnd::Never));
    text_only.message = "New text".into();
    update(&db, user.id, item.id, text_only)
        .await
        .unwrap()
        .unwrap();
    let still_snoozed = open(&db, &item).await.unwrap();
    assert_eq!(still_snoozed.state, DeliveryState::Snoozed);
    assert_eq!(
        utc(still_snoozed.due_at),
        utc(moved.due_at) + Duration::hours(1)
    );
    update(
        &db,
        user.id,
        item.id,
        input(daily(nine(), RepeatEnd::Never)),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        open(&db, &item).await.unwrap().state,
        DeliveryState::Pending,
        "a new trigger drops the snooze"
    );

    assert_eq!(
        cancel(&db, other.id, item.id).await.unwrap(),
        Err(Refusal::NotFound)
    );
    assert_eq!(
        update(&db, other.id, item.id, input(daily(ten, RepeatEnd::Never)))
            .await
            .unwrap(),
        Err(Refusal::NotFound)
    );
    let cancelled = cancel(&db, user.id, item.id).await.unwrap().unwrap();
    assert_eq!(cancelled.status, ItemStatus::Cancelled);
    assert!(open(&db, &item).await.is_none());
    assert_eq!(
        occurrences(&db, &item).await[0].state,
        DeliveryState::Cancelled
    );
    let tick = run_delivery_tick(&db, &settings(), &registry).await;
    assert!(
        !tick.touched(),
        "a cancelled series gets no next occurrence"
    );
    assert_eq!(
        cancel(&db, user.id, item.id).await.unwrap(),
        Err(Refusal::Finished)
    );
    assert_eq!(
        update(&db, user.id, item.id, input(daily(ten, RepeatEnd::Never)))
            .await
            .unwrap(),
        Err(Refusal::Finished)
    );
    assert_eq!(
        create(
            &db,
            user.id,
            input(Trigger::Once {
                date: today() - Duration::days(1),
                time: nine(),
            }),
            json!({}),
        )
        .await
        .unwrap(),
        Err(Refusal::NoFutureOccurrence)
    );
}

/// An occurrence that is being delivered when the item is cancelled is
/// refused by the send-time guard if it has not gone out yet; a one-off in
/// flight cannot be moved to a new time.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn an_occurrence_in_flight_follows_the_item(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let producer = ReminderProducer::new(None);
    let tomorrow = Trigger::Once {
        date: today() + Duration::days(1),
        time: nine(),
    };
    let item = create_item(&db, user.id, input(tomorrow)).await;
    let row = open(&db, &item).await.unwrap();
    db.execute_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        "UPDATE scheduled_deliveries SET state = 'claimed', claim_token = 'replica', claimed_at = now()
         WHERE id = $1",
        [row.id.into()],
    ))
    .await
    .unwrap();
    let claimed = open(&db, &item).await.unwrap();
    assert_eq!(
        producer.still_due(&db, &claimed).await.unwrap(),
        StillDue::Yes
    );

    let later = Trigger::Once {
        date: today() + Duration::days(2),
        time: nine(),
    };
    assert_eq!(
        update(&db, user.id, item.id, input(later)).await.unwrap(),
        Err(Refusal::InFlight)
    );

    cancel(&db, user.id, item.id).await.unwrap().unwrap();
    assert_eq!(
        open(&db, &item).await.unwrap().state,
        DeliveryState::Claimed,
        "a claimed row is left to the executor"
    );
    assert!(matches!(
        producer.still_due(&db, &claimed).await.unwrap(),
        StillDue::No { .. }
    ));
}

/// The card links the item's chat by its title.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn the_reminder_links_its_chat(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry(&channel);
    let chat_id = Uuid::new_v4();
    db.execute_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        "INSERT INTO chats (id, owner_user_id, title_by_user_provided) VALUES ($1, $2, 'Q4 rate comparison')",
        [chat_id.into(), user.id.to_string().into()],
    ))
    .await
    .unwrap();
    let mut linked = input(daily(nine(), RepeatEnd::Never));
    linked.linked_chat_id = Some(chat_id);
    let item = create_item(&db, user.id, linked).await;
    make_due(&db, open(&db, &item).await.unwrap().id).await;
    run_delivery_tick(&db, &settings(), &registry).await;

    let links = &channel.deliveries()[0].content.links;
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].title, "Q4 rate comparison");
    assert_eq!(links[0].url, format!("{BASE_URL}/chat/{chat_id}"));
}
