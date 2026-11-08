//! Scheduled items on the delivery executor: a repeating item gets its next
//! occurrence after each one, until its end; snoozing, editing and cancelling
//! act on the series as the Scheduled page expects; several replicas deliver
//! each occurrence once; the buttons on a delivered reminder close it or
//! bring it back without touching the regular schedule.

use crate::MIGRATOR;
use chrono::{DateTime, Duration, NaiveDate, SubsecRound, Utc};
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
    DONE_COMMAND, DisplayStatus, ItemInput, REMINDER, Refusal, ReminderProducer, SNOOZE_COMMAND,
    SnoozeChoice, acknowledge, cancel, create, current_occurrence, delete, display_status, get,
    list, next_occurrence, snooze_choices, snooze_delivered, snooze_occurrence, update,
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
    let actions = &delivered[0].content.actions;
    assert_eq!(actions[0].title, "Done");
    assert_eq!(actions[0].command, DONE_COMMAND);
    assert_eq!(actions[1].command, SNOOZE_COMMAND);
    let token = actions[0].token.expect("a token");
    assert!(actions.iter().all(|action| action.token == Some(token)));
    let stored = ScheduledDeliveries::find_by_id(first.id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.outcome["action_token"], token.to_string());

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

async fn deliveries(db: &DatabaseConnection, item: &Model) -> Vec<scheduled_deliveries::Model> {
    use sea_orm::QueryOrder;
    ScheduledDeliveries::find()
        .filter(
            scheduled_deliveries::Column::DedupeKey
                .is_in([item.id.to_string(), format!("{}:snooze", item.id)]),
        )
        .order_by_asc(scheduled_deliveries::Column::CreatedAt)
        .all(db)
        .await
        .unwrap()
}

async fn set_due(db: &DatabaseConnection, id: Uuid, at: DateTime<Utc>) {
    db.execute_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        "UPDATE scheduled_deliveries SET due_at = $2 WHERE id = $1",
        [id.into(), at.fixed_offset().into()],
    ))
    .await
    .expect("due time set");
}

async fn status(db: &DatabaseConnection, user: &users::Model, item: &Model) -> DisplayStatus {
    let view = get(db, user.id, item.id).await.unwrap().unwrap();
    display_status(&view, Utc::now())
}

fn tomorrow_at_nine() -> Trigger {
    Trigger::Once {
        date: today() + Duration::days(1),
        time: nine(),
    }
}

/// Done on the card only stores `acknowledged_at` on that delivery: the item
/// still ends as Done (it happened as planned) and nothing else changes.
/// Only the recipient's delivered rows can be acknowledged.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn done_closes_the_card_and_leaves_the_schedule(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let other = get_or_create_user(&db, "https://issuer.example", "someone-else", None)
        .await
        .unwrap();
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry(&channel);
    let item = create_item(&db, user.id, input(tomorrow_at_nine())).await;
    let row = open(&db, &item).await.unwrap();
    assert_eq!(
        acknowledge(&db, user.id, row.id).await.unwrap(),
        Err(Refusal::NotFound),
        "nothing to close before it arrived"
    );
    make_due(&db, row.id).await;
    run_delivery_tick(&db, &settings(), &registry).await;

    assert_eq!(
        acknowledge(&db, other.id, row.id).await.unwrap(),
        Err(Refusal::NotFound)
    );
    let acknowledged = acknowledge(&db, user.id, row.id).await.unwrap().unwrap();
    assert_eq!(acknowledged.status, ItemStatus::Active);
    assert_eq!(acknowledged.occurrence_count, 1);
    let stored = &deliveries(&db, &item).await[0];
    assert_eq!(stored.state, DeliveryState::Delivered);
    let at = stored.outcome["acknowledged_at"].as_str().unwrap();
    assert!(DateTime::parse_from_rfc3339(at).is_ok(), "{at}");

    run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(reload(&db, &item).await.status, ItemStatus::Ended);
    assert_eq!(status(&db, &user, &item).await, DisplayStatus::Done);
    let view = get(&db, user.id, item.id).await.unwrap().unwrap();
    assert_eq!(view.last.unwrap().outcome["acknowledged_at"], at);
}

/// Snoozing a delivered one-off brings that reminder back as a row of its
/// own: the delivered row stays as it was, the item is upcoming again and
/// shows as snoozed until then, the producer does not end it meanwhile, and
/// the re-delivery arrives with buttons of its own. Once it is settled the
/// item ends and can be deleted with both rows.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn snoozing_after_delivery_brings_back_this_one_reminder(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry(&channel);
    let item = create_item(&db, user.id, input(tomorrow_at_nine())).await;
    let row = open(&db, &item).await.unwrap();
    make_due(&db, row.id).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(reload(&db, &item).await.status, ItemStatus::Ended);
    let delivered_row = deliveries(&db, &item).await.remove(0);

    let before = Utc::now();
    let (snoozed, until) = snooze_delivered(&db, user.id, row.id, SnoozeChoice::HalfAnHour)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(snoozed.status, ItemStatus::Active);
    assert!(
        until >= before.trunc_subsecs(6) + Duration::minutes(30)
            && until <= Utc::now() + Duration::minutes(30)
    );
    let rows = deliveries(&db, &item).await;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0], delivered_row, "the delivered row is left alone");
    let redelivery = &rows[1];
    assert_eq!(
        redelivery.dedupe_key.as_deref(),
        Some(format!("{}:snooze", item.id).as_str())
    );
    assert_eq!(redelivery.state, DeliveryState::Snoozed);
    assert_eq!(utc(redelivery.due_at), until);
    assert_eq!(redelivery.payload["item_id"], item.id.to_string());
    assert_eq!(redelivery.payload["occurrence"], 1);

    let upcoming = list(&db, user.id, false, 100).await.unwrap();
    assert_eq!(upcoming.len(), 1);
    assert_eq!(
        display_status(&upcoming[0], Utc::now()),
        DisplayStatus::Snoozed
    );
    assert_eq!(next_occurrence(&upcoming[0], Utc::now()), Some(until));
    assert_eq!(
        delete(&db, user.id, item.id).await.unwrap(),
        Err(Refusal::NotFinished)
    );

    let tick = run_delivery_tick(&db, &settings(), &registry).await;
    assert!(!tick.touched(), "{tick:?}");
    assert_eq!(reload(&db, &item).await.status, ItemStatus::Active);

    make_due(&db, redelivery.id).await;
    let tick = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(tick.delivered, 1, "{tick:?}");
    let cards = channel.deliveries();
    assert_eq!(cards[1].delivery_id, redelivery.id);
    assert_eq!(cards[1].content.title.as_deref(), Some("Stand-up notes"));
    assert_eq!(cards[1].content.actions.len(), 3);
    assert_ne!(
        cards[1].content.actions[0].token,
        cards[0].content.actions[0].token
    );

    run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(reload(&db, &item).await.status, ItemStatus::Ended);
    assert_eq!(status(&db, &user, &item).await, DisplayStatus::Done);
    let view = get(&db, user.id, item.id).await.unwrap().unwrap();
    assert_eq!(view.last.unwrap().id, redelivery.id);
    delete(&db, user.id, item.id).await.unwrap().unwrap();
    assert!(deliveries(&db, &item).await.is_empty());
}

/// A card offers, and the service accepts, only snoozes that come back
/// before the item's next regular occurrence; a card whose next occurrence
/// already arrived cannot be snoozed. A snooze of a repeating item sits next
/// to its next occurrence and goes when the item is cancelled.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn a_snooze_after_delivery_comes_before_the_next_occurrence(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry(&channel);
    let item = create_item(&db, user.id, input(daily(nine(), RepeatEnd::Never))).await;
    let first = open(&db, &item).await.unwrap();
    make_due(&db, first.id).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    let second = open(&db, &item).await.expect("next occurrence");
    let first = ScheduledDeliveries::find_by_id(first.id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();

    set_due(&db, second.id, Utc::now() + Duration::minutes(20)).await;
    let item = reload(&db, &item).await;
    assert!(
        snooze_choices(&db, &item, &first, Utc::now())
            .await
            .unwrap()
            .is_empty()
    );
    for choice in SnoozeChoice::ALL {
        assert_eq!(
            snooze_delivered(&db, user.id, first.id, choice)
                .await
                .unwrap(),
            Err(Refusal::NextOccurrenceFirst)
        );
    }

    set_due(&db, second.id, Utc::now() + Duration::days(2)).await;
    assert_eq!(
        snooze_choices(&db, &item, &first, Utc::now())
            .await
            .unwrap(),
        SnoozeChoice::ALL
    );
    let (_, until) = snooze_delivered(&db, user.id, first.id, SnoozeChoice::HalfAnHour)
        .await
        .unwrap()
        .unwrap();
    let current = open(&db, &item).await.unwrap();
    assert_ne!(current.id, second.id, "the snooze arrives first");
    assert_eq!(utc(current.due_at), until);
    assert_eq!(status(&db, &user, &item).await, DisplayStatus::Snoozed);
    let tick = run_delivery_tick(&db, &settings(), &registry).await;
    assert!(!tick.touched(), "{tick:?}");

    cancel(&db, user.id, item.id).await.unwrap().unwrap();
    assert!(
        deliveries(&db, &item)
            .await
            .iter()
            .skip(1)
            .all(|row| row.state == DeliveryState::Cancelled)
    );
    assert_eq!(
        snooze_delivered(&db, user.id, first.id, SnoozeChoice::HalfAnHour)
            .await
            .unwrap(),
        Err(Refusal::Finished)
    );

    // A card two occurrences old cannot come back.
    let item = create_item(&db, user.id, input(daily(nine(), RepeatEnd::Never))).await;
    let old = open(&db, &item).await.unwrap();
    for _ in 0..2 {
        let row = open(&db, &item).await.unwrap();
        make_due(&db, row.id).await;
        run_delivery_tick(&db, &settings(), &registry).await;
        run_delivery_tick(&db, &settings(), &registry).await;
    }
    assert_eq!(
        snooze_delivered(&db, user.id, old.id, SnoozeChoice::HalfAnHour)
            .await
            .unwrap(),
        Err(Refusal::NextOccurrenceFirst)
    );
}

/// The page's Snooze moves a reminder snoozed after delivery only to a time
/// before the item's next regular occurrence, as its card does, whether that
/// occurrence has its row yet or not; the regular schedule stays.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn the_pages_snooze_keeps_a_snoozed_reminder_before_the_next_occurrence(
    pool: Pool<Postgres>,
) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry(&channel);

    let item = create_item(&db, user.id, input(daily(nine(), RepeatEnd::Never))).await;
    let first = open(&db, &item).await.unwrap();
    make_due(&db, first.id).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    let second = open(&db, &item).await.expect("next occurrence");
    let (_, until) = snooze_delivered(&db, user.id, first.id, SnoozeChoice::HalfAnHour)
        .await
        .unwrap()
        .unwrap();
    let next = utc(second.due_at);
    for later in [next, next + Duration::hours(1)] {
        assert_eq!(
            snooze_occurrence(&db, user.id, item.id, later)
                .await
                .unwrap(),
            Err(Refusal::NextOccurrenceFirst)
        );
    }
    assert_eq!(utc(open(&db, &item).await.unwrap().due_at), until);
    snooze_occurrence(&db, user.id, item.id, next - Duration::minutes(1))
        .await
        .unwrap()
        .unwrap();
    let current = open(&db, &item).await.unwrap();
    assert_ne!(current.id, second.id);
    assert_eq!(utc(current.due_at), next - Duration::minutes(1));
    let regular = ScheduledDeliveries::find_by_id(second.id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(regular, second, "the regular occurrence is left alone");
    assert_eq!(status(&db, &user, &item).await, DisplayStatus::Snoozed);

    // Snoozed before the producer gave the item its next occurrence.
    let item = create_item(&db, user.id, input(daily(nine(), RepeatEnd::Never))).await;
    let first = open(&db, &item).await.unwrap();
    make_due(&db, first.id).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(
        snooze_occurrence(&db, user.id, item.id, Utc::now() + Duration::hours(1))
            .await
            .unwrap(),
        Err(Refusal::NothingToSnooze),
        "nothing is waiting yet"
    );
    snooze_delivered(&db, user.id, first.id, SnoozeChoice::HalfAnHour)
        .await
        .unwrap()
        .unwrap();
    let next = utc(reload(&db, &item).await.occurrence_at.unwrap()) + Duration::days(1);
    assert_eq!(
        snooze_occurrence(&db, user.id, item.id, next)
            .await
            .unwrap(),
        Err(Refusal::NextOccurrenceFirst)
    );
    snooze_occurrence(&db, user.id, item.id, next - Duration::minutes(1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        utc(open(&db, &item).await.unwrap().due_at),
        next - Duration::minutes(1)
    );
}

/// A new schedule replaces a snooze after delivery: a repeating item drops
/// it and keeps its series, a snoozed one-off moves to the new time.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn a_new_schedule_replaces_a_snooze_after_delivery(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry(&channel);

    let daily_item = create_item(&db, user.id, input(daily(nine(), RepeatEnd::Never))).await;
    let first = open(&db, &daily_item).await.unwrap();
    make_due(&db, first.id).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    snooze_delivered(&db, user.id, first.id, SnoozeChoice::HalfAnHour)
        .await
        .unwrap()
        .unwrap();
    let ten = LocalTime::new(10, 0).unwrap();
    update(
        &db,
        user.id,
        daily_item.id,
        input(daily(ten, RepeatEnd::Never)),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(open(&db, &daily_item).await.is_none());
    assert_eq!(
        deliveries(&db, &daily_item).await[1].state,
        DeliveryState::Cancelled
    );
    run_delivery_tick(&db, &settings(), &registry).await;
    let next = open(&db, &daily_item).await.expect("the series goes on");
    assert_eq!(next.dedupe_key, Some(daily_item.id.to_string()));
    assert_eq!(
        utc(next.due_at).time(),
        chrono::NaiveTime::from_hms_opt(10, 0, 0).unwrap()
    );
    let view = get(&db, user.id, daily_item.id).await.unwrap().unwrap();
    assert_eq!(
        view.last.unwrap().id,
        first.id,
        "the dropped snooze is not the last delivery"
    );

    let once = create_item(&db, user.id, input(tomorrow_at_nine())).await;
    let row = open(&db, &once).await.unwrap();
    make_due(&db, row.id).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    run_delivery_tick(&db, &settings(), &registry).await;
    snooze_delivered(&db, user.id, row.id, SnoozeChoice::TomorrowMorning)
        .await
        .unwrap()
        .unwrap();
    let later = Trigger::Once {
        date: today() + Duration::days(3),
        time: ten,
    };
    let moved = update(&db, user.id, once.id, input(later))
        .await
        .unwrap()
        .unwrap();
    let redelivery = open(&db, &once).await.unwrap();
    assert_eq!(redelivery.state, DeliveryState::Pending);
    assert_eq!(
        utc(redelivery.due_at),
        (today() + Duration::days(3))
            .and_hms_opt(10, 0, 0)
            .unwrap()
            .and_utc()
    );
    assert_eq!(moved.occurrence_at, Some(redelivery.due_at));
}
