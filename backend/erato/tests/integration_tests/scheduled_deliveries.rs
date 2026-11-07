//! The scheduled-delivery executor: rows are claimed once, delivered through
//! a channel, and their outcome recorded, with crash recovery and several
//! replicas ticking at once.

use crate::MIGRATOR;
use crate::test_utils::setup_mock_llm_server;
use chrono::{DateTime, Duration, Utc};
use erato::actors::supervisor::{WorkerNames, delivery_tick_job};
use erato::db::entity::prelude::ScheduledDeliveries;
use erato::db::entity::scheduled_deliveries::{CreatedBy, DeliveryState, Model};
use erato::db::entity::users;
use erato::models::user::get_or_create_user;
use erato::services::scheduled_deliveries::{
    DeliveryChannel, DeliveryContent, DeliveryOutcome, DeliveryProducer, DeliveryRegistry,
    ExecutorSettings, NewDelivery, RecordingChannel, ResolvedContent, StillDue, TickOutcome,
    cancel_open, count_delivered, find, occurrence_due_at, run_delivery_tick, schedule,
    schedule_once, snooze,
};
use eyre::Report;
use ractor::registry;
use ractor_actors::time::cron::Job;
use sea_orm::prelude::Uuid;
use sea_orm::{ConnectionTrait, DatabaseConnection, EntityTrait, Statement};
use serde_json::json;
use sqlx::{Pool, Postgres};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration as StdDuration;

const KIND: &str = "test_note";
const CHANNEL: &str = "recording";

/// A producer whose answers the test scripts.
struct TestProducer {
    kind: String,
    channel: String,
    still_due: Mutex<StillDue>,
    /// When set, `produce` creates one due row for this user on every tick.
    produce_for: Option<Uuid>,
    produced: AtomicBool,
}

impl TestProducer {
    fn new() -> Self {
        Self {
            kind: KIND.into(),
            channel: CHANNEL.into(),
            still_due: Mutex::new(StillDue::Yes),
            produce_for: None,
            produced: AtomicBool::new(false),
        }
    }

    fn refusing(reason: &str) -> Self {
        let producer = Self::new();
        *producer.still_due.lock().unwrap() = StillDue::No {
            reason: reason.into(),
        };
        producer
    }
}

#[async_trait::async_trait]
impl DeliveryProducer for TestProducer {
    fn kind(&self) -> &str {
        &self.kind
    }

    async fn produce(&self, db: &DatabaseConnection) -> Result<usize, Report> {
        let Some(user_id) = self.produce_for else {
            return Ok(0);
        };
        if self.produced.swap(true, Ordering::SeqCst) {
            return Ok(0);
        }
        let created = schedule(db, new_delivery(user_id, Utc::now(), Some("produced"))).await?;
        Ok(usize::from(created.is_some()))
    }

    async fn still_due(&self, _db: &DatabaseConnection, _row: &Model) -> Result<StillDue, Report> {
        Ok(self.still_due.lock().unwrap().clone())
    }

    async fn resolve_content(
        &self,
        _db: &DatabaseConnection,
        row: &Model,
    ) -> Result<ResolvedContent, Report> {
        Ok(ResolvedContent {
            channel: self.channel.clone(),
            content: DeliveryContent {
                text: row.payload["text"].as_str().unwrap_or_default().to_string(),
                ..Default::default()
            },
        })
    }
}

fn registry_with(producer: TestProducer, channel: &Arc<RecordingChannel>) -> DeliveryRegistry {
    let mut registry = DeliveryRegistry::new();
    registry.register_producer(Arc::new(producer));
    registry.register_channel(channel.clone());
    registry
}

fn settings() -> ExecutorSettings {
    ExecutorSettings {
        batch_size: 10,
        claim_timeout: StdDuration::from_secs(300),
        max_attempts: 3,
        retry_delay: StdDuration::from_secs(60),
    }
}

fn new_delivery(user_id: Uuid, due_at: DateTime<Utc>, dedupe_key: Option<&str>) -> NewDelivery {
    NewDelivery {
        user_id,
        kind: KIND.into(),
        due_at,
        created_by: CreatedBy::System,
        origin: json!({"test": true}),
        payload: json!({"text": format!("note {}", dedupe_key.unwrap_or("-"))}),
        dedupe_key: dedupe_key.map(str::to_owned),
    }
}

async fn database(pool: Pool<Postgres>) -> (DatabaseConnection, users::Model) {
    let db = sea_orm::SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let user = get_or_create_user(&db, "https://issuer.example", "delivery-user", None)
        .await
        .expect("user");
    (db, user)
}

async fn row(db: &DatabaseConnection, id: Uuid) -> Model {
    find(db, id).await.expect("lookup").expect("row exists")
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

/// Due rows are delivered through the producer's channel exactly once and
/// the row records how; rows that are not due yet wait.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn due_rows_are_delivered_once_and_recorded(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry_with(TestProducer::new(), &channel);

    let due = schedule(&db, new_delivery(user.id, Utc::now(), Some("now")))
        .await
        .unwrap()
        .expect("row created");
    let later = schedule(
        &db,
        new_delivery(user.id, Utc::now() + Duration::hours(1), Some("later")),
    )
    .await
    .unwrap()
    .expect("row created");
    assert_eq!(due.state, DeliveryState::Pending);

    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(
        outcome,
        TickOutcome {
            claimed: 1,
            delivered: 1,
            ..Default::default()
        }
    );
    let deliveries = channel.deliveries();
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].delivery_id, due.id);
    assert_eq!(deliveries[0].user_id, user.id);
    assert_eq!(deliveries[0].content.text, "note now");

    let delivered = row(&db, due.id).await;
    assert_eq!(delivered.state, DeliveryState::Delivered);
    assert!(delivered.delivered_at.is_some());
    assert!(delivered.claim_token.is_none());
    assert_eq!(delivered.outcome["channel"], CHANNEL);
    assert_eq!(delivered.outcome["attempts"], 1);
    assert_eq!(delivered.outcome["delivered"]["recorded"], true);
    assert_eq!(row(&db, later.id).await.state, DeliveryState::Pending);
    assert_eq!(count_delivered(&db, user.id, KIND).await.unwrap(), 1);

    // Nothing is due any more: the second tick is a no-op.
    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert!(!outcome.touched(), "{outcome:?}");
    assert_eq!(channel.deliveries().len(), 1);
}

/// A dedupe key allows one OPEN row per (user, kind, key); `schedule_once`
/// also refuses a key that was ever used.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn dedupe_key_blocks_a_second_open_row(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry_with(TestProducer::new(), &channel);

    let first = schedule(&db, new_delivery(user.id, Utc::now(), Some("k")))
        .await
        .unwrap();
    assert!(first.is_some());
    let duplicate = schedule(&db, new_delivery(user.id, Utc::now(), Some("k")))
        .await
        .unwrap();
    assert!(duplicate.is_none(), "an open row with the key exists");
    // Rows without a key never collide.
    assert!(
        schedule(&db, new_delivery(user.id, Utc::now(), None))
            .await
            .unwrap()
            .is_some()
    );
    assert!(
        schedule(&db, new_delivery(user.id, Utc::now(), None))
            .await
            .unwrap()
            .is_some()
    );

    run_delivery_tick(&db, &settings(), &registry).await;

    let again = schedule(&db, new_delivery(user.id, Utc::now(), Some("k")))
        .await
        .unwrap();
    assert!(again.is_some(), "a delivered row does not block the key");
    let once = schedule_once(&db, new_delivery(user.id, Utc::now(), Some("k")))
        .await
        .unwrap();
    assert!(
        once.is_none(),
        "schedule_once refuses a key used in any state"
    );
    let once = schedule_once(&db, new_delivery(user.id, Utc::now(), Some("fresh")))
        .await
        .unwrap();
    assert!(once.is_some());
    assert!(
        schedule_once(&db, new_delivery(user.id, Utc::now(), None))
            .await
            .is_err(),
        "schedule_once needs a key"
    );
}

/// The producer's send-time guard cancels a row that is no longer owed,
/// with the reason on the row, and nothing reaches the channel.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn guard_cancels_rows_no_longer_owed(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry_with(TestProducer::refusing("user became active"), &channel);
    let created = schedule(&db, new_delivery(user.id, Utc::now(), None))
        .await
        .unwrap()
        .unwrap();

    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(
        outcome,
        TickOutcome {
            claimed: 1,
            cancelled: 1,
            ..Default::default()
        }
    );
    let cancelled = row(&db, created.id).await;
    assert_eq!(cancelled.state, DeliveryState::Cancelled);
    assert_eq!(cancelled.outcome["reason"], "user became active");
    assert!(channel.deliveries().is_empty());
}

/// A retryable channel outcome puts the row back to pending with a later due
/// time and counts the attempt; the last allowed attempt fails the row.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn retryable_outcomes_requeue_until_max_attempts(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    channel.answer_with(DeliveryOutcome::Retry {
        reason: "throttled".into(),
        retry_after: Some(StdDuration::from_secs(3600)),
    });
    let registry = registry_with(TestProducer::new(), &channel);
    let created = schedule(&db, new_delivery(user.id, Utc::now(), Some("retry")))
        .await
        .unwrap()
        .unwrap();

    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(
        outcome,
        TickOutcome {
            claimed: 1,
            retried: 1,
            ..Default::default()
        }
    );
    let requeued = row(&db, created.id).await;
    assert_eq!(requeued.state, DeliveryState::Pending);
    assert!(requeued.claim_token.is_none());
    assert!(
        requeued.due_at > (Utc::now() + Duration::minutes(50)).fixed_offset(),
        "the channel's retry-after wins over the default delay"
    );
    assert_eq!(requeued.outcome["attempts"], 1);
    assert_eq!(requeued.outcome["last_error"], "throttled");
    let due = created.due_at.with_timezone(&Utc);
    assert_eq!(
        occurrence_due_at(&requeued),
        due,
        "a retry keeps the due time"
    );

    // Not due yet: untouched.
    assert!(
        !run_delivery_tick(&db, &settings(), &registry)
            .await
            .touched()
    );

    make_due(&db, created.id).await;
    channel.answer_with(DeliveryOutcome::Retry {
        reason: "transport".into(),
        retry_after: None,
    });
    run_delivery_tick(&db, &settings(), &registry).await;
    let requeued = row(&db, created.id).await;
    assert_eq!(requeued.state, DeliveryState::Pending);
    assert_eq!(requeued.outcome["attempts"], 2);
    let default_delay = (Utc::now() + Duration::seconds(30)).fixed_offset();
    assert!(
        requeued.due_at > default_delay
            && requeued.due_at < (Utc::now() + Duration::minutes(5)).fixed_offset()
    );

    make_due(&db, created.id).await;
    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(outcome.failed, 1, "{outcome:?}");
    let failed = row(&db, created.id).await;
    assert_eq!(failed.state, DeliveryState::Failed);
    assert_eq!(failed.outcome["attempts"], 3);
    assert_eq!(failed.outcome["reason"], "transport (after 3 attempts)");
    assert_eq!(occurrence_due_at(&failed), due);
    assert_eq!(channel.deliveries().len(), 3);
}

/// A retry keeps the occurrence's due time; a snooze or a producer's
/// deferral moves the occurrence, so later retries keep the new time.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn retries_keep_the_due_time_and_snoozes_and_deferrals_move_it(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    channel.answer_with(DeliveryOutcome::Retry {
        reason: "throttled".into(),
        retry_after: None,
    });
    let registry = registry_with(TestProducer::new(), &channel);
    let created = schedule(
        &db,
        new_delivery(user.id, Utc::now() - Duration::minutes(5), Some("moves")),
    )
    .await
    .unwrap()
    .unwrap();

    assert_eq!(
        run_delivery_tick(&db, &settings(), &registry).await.retried,
        1
    );
    let retried = row(&db, created.id).await;
    assert!(retried.due_at > created.due_at);
    assert_eq!(
        occurrence_due_at(&retried),
        created.due_at.with_timezone(&Utc)
    );

    // Snoozed into the past, so the next tick takes it at once.
    assert!(
        snooze(&db, created.id, Utc::now() - Duration::minutes(1))
            .await
            .unwrap()
    );
    let snoozed = row(&db, created.id).await;
    assert!(snoozed.outcome.get("original_due_at").is_none());
    let snoozed_to = snoozed.due_at.with_timezone(&Utc);
    assert_eq!(occurrence_due_at(&snoozed), snoozed_to);
    assert_eq!(
        run_delivery_tick(&db, &settings(), &registry).await.retried,
        1
    );
    assert_eq!(
        occurrence_due_at(&row(&db, created.id).await),
        snoozed_to,
        "retries after a snooze keep the snoozed time"
    );

    let later = Utc::now() + Duration::hours(1);
    let deferring = TestProducer {
        still_due: Mutex::new(StillDue::Later { due_at: later }),
        ..TestProducer::new()
    };
    make_due(&db, created.id).await;
    let outcome = run_delivery_tick(&db, &settings(), &registry_with(deferring, &channel)).await;
    assert_eq!(outcome.deferred, 1, "{outcome:?}");
    let deferred = row(&db, created.id).await;
    assert!(deferred.outcome.get("original_due_at").is_none());
    assert_eq!(
        occurrence_due_at(&deferred),
        deferred.due_at.with_timezone(&Utc)
    );
    assert!((occurrence_due_at(&deferred) - later).num_seconds().abs() < 2);
}

/// A channel that reports the user as unreachable fails the row for good.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn unreachable_outcomes_fail_the_row(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    channel.answer_with(DeliveryOutcome::Failed {
        reason: "blocked by policy".into(),
    });
    let registry = registry_with(TestProducer::new(), &channel);
    let created = schedule(&db, new_delivery(user.id, Utc::now(), None))
        .await
        .unwrap()
        .unwrap();

    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(outcome.failed, 1, "{outcome:?}");
    let failed = row(&db, created.id).await;
    assert_eq!(failed.state, DeliveryState::Failed);
    assert_eq!(failed.outcome["reason"], "blocked by policy");
    assert_eq!(failed.outcome["attempts"], 1);
    assert_eq!(count_delivered(&db, user.id, KIND).await.unwrap(), 0);
}

/// A claim whose holder died is given back once it is older than the claim
/// timeout, and the row is then delivered by whoever ticks next.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn stale_claims_are_reclaimed_and_delivered(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry_with(TestProducer::new(), &channel);
    let stranded = schedule(&db, new_delivery(user.id, Utc::now(), Some("stranded")))
        .await
        .unwrap()
        .unwrap();
    let fresh = schedule(&db, new_delivery(user.id, Utc::now(), Some("fresh")))
        .await
        .unwrap()
        .unwrap();
    for (id, age) in [(stranded.id, "1 hour"), (fresh.id, "10 seconds")] {
        db.execute_raw(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            format!(
                "UPDATE scheduled_deliveries SET state = 'claimed', claim_token = 'dead-replica',
                 claimed_at = now() - interval '{age}' WHERE id = $1"
            ),
            [id.into()],
        ))
        .await
        .unwrap();
    }

    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(
        outcome,
        TickOutcome {
            reclaimed: 1,
            claimed: 1,
            delivered: 1,
            ..Default::default()
        }
    );
    let delivered = row(&db, stranded.id).await;
    assert_eq!(delivered.state, DeliveryState::Delivered);
    assert_eq!(delivered.outcome["reclaimed"], 1);
    // The live claim is left to its holder.
    let held = row(&db, fresh.id).await;
    assert_eq!(held.state, DeliveryState::Claimed);
    assert_eq!(held.claim_token.as_deref(), Some("dead-replica"));
}

/// Several replicas ticking at once deliver every row exactly once.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn concurrent_ticks_deliver_each_row_once(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = Arc::new(registry_with(TestProducer::new(), &channel));
    let mut ids = Vec::new();
    for n in 0..25 {
        let created = schedule(
            &db,
            new_delivery(user.id, Utc::now(), Some(&format!("row-{n}"))),
        )
        .await
        .unwrap()
        .unwrap();
        ids.push(created.id);
    }

    let tick = |db: DatabaseConnection, registry: Arc<DeliveryRegistry>| async move {
        run_delivery_tick(&db, &settings(), &registry).await
    };
    let (a, b, c) = tokio::join!(
        tick(db.clone(), registry.clone()),
        tick(db.clone(), registry.clone()),
        tick(db.clone(), registry.clone()),
    );
    let delivered = a.delivered + b.delivered + c.delivered;
    assert_eq!(a.lost + b.lost + c.lost, 0);
    assert_eq!(delivered, 25, "{a:?} {b:?} {c:?}");

    let deliveries = channel.deliveries();
    assert_eq!(deliveries.len(), 25);
    let mut seen: Vec<Uuid> = deliveries.iter().map(|d| d.delivery_id).collect();
    seen.sort_unstable();
    seen.dedup();
    assert_eq!(seen.len(), 25, "no row was delivered twice");
    let rows = ScheduledDeliveries::find().all(&db).await.unwrap();
    assert!(rows.iter().all(|row| row.state == DeliveryState::Delivered));
}

/// Cancellation narrows by kind and dedupe key, leaves other users alone and
/// records the reason.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn cancel_open_narrows_by_kind_and_key(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let other = get_or_create_user(&db, "https://issuer.example", "other", None)
        .await
        .unwrap();
    let a1 = schedule(&db, new_delivery(user.id, Utc::now(), Some("k1")))
        .await
        .unwrap()
        .unwrap();
    let a2 = schedule(&db, new_delivery(user.id, Utc::now(), Some("k2")))
        .await
        .unwrap()
        .unwrap();
    let b1 = schedule(
        &db,
        NewDelivery {
            kind: "other_kind".into(),
            ..new_delivery(user.id, Utc::now(), Some("k1"))
        },
    )
    .await
    .unwrap()
    .unwrap();
    let theirs = schedule(&db, new_delivery(other.id, Utc::now(), Some("k1")))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        cancel_open(&db, user.id, Some(KIND), Some("k1"), "test")
            .await
            .unwrap(),
        1
    );
    assert_eq!(row(&db, a1.id).await.state, DeliveryState::Cancelled);
    assert_eq!(row(&db, a1.id).await.outcome["reason"], "test");
    assert_eq!(row(&db, a2.id).await.state, DeliveryState::Pending);
    assert_eq!(
        cancel_open(&db, user.id, Some(KIND), None, "kind")
            .await
            .unwrap(),
        1
    );
    assert_eq!(row(&db, a2.id).await.state, DeliveryState::Cancelled);
    assert_eq!(row(&db, b1.id).await.state, DeliveryState::Pending);
    assert_eq!(
        cancel_open(&db, user.id, None, None, "all").await.unwrap(),
        1
    );
    assert_eq!(row(&db, b1.id).await.state, DeliveryState::Cancelled);
    assert_eq!(row(&db, theirs.id).await.state, DeliveryState::Pending);
    assert_eq!(
        cancel_open(&db, user.id, None, None, "again")
            .await
            .unwrap(),
        0
    );
}

/// A snoozed row waits for its new time and is then taken like a pending one.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn snoozed_rows_wait_and_are_then_delivered(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry_with(TestProducer::new(), &channel);
    let created = schedule(&db, new_delivery(user.id, Utc::now(), Some("snooze")))
        .await
        .unwrap()
        .unwrap();

    assert!(
        snooze(&db, created.id, Utc::now() + Duration::hours(1))
            .await
            .unwrap()
    );
    let snoozed = row(&db, created.id).await;
    assert_eq!(snoozed.state, DeliveryState::Snoozed);
    assert_eq!(snoozed.outcome["snoozed"], 1);
    assert!(
        schedule(&db, new_delivery(user.id, Utc::now(), Some("snooze")))
            .await
            .unwrap()
            .is_none(),
        "a snoozed row still holds its dedupe key"
    );
    assert!(
        !run_delivery_tick(&db, &settings(), &registry)
            .await
            .touched()
    );

    make_due(&db, created.id).await;
    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(outcome.delivered, 1, "{outcome:?}");
    assert_eq!(row(&db, created.id).await.state, DeliveryState::Delivered);
    assert!(
        !snooze(&db, created.id, Utc::now()).await.unwrap(),
        "a settled row cannot be snoozed"
    );
}

/// A row whose producer or channel is not registered is failed with the
/// reason, rather than retried forever.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn unknown_kind_is_left_alone_and_unknown_channel_retries(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new("another_channel"));
    let registry = registry_with(TestProducer::new(), &channel);
    let unknown_kind = schedule(
        &db,
        NewDelivery {
            kind: "nobody_owns_this".into(),
            ..new_delivery(user.id, Utc::now(), None)
        },
    )
    .await
    .unwrap()
    .unwrap();
    let unknown_channel = schedule(&db, new_delivery(user.id, Utc::now(), None))
        .await
        .unwrap()
        .unwrap();

    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(
        outcome,
        TickOutcome {
            claimed: 1,
            retried: 1,
            ..Default::default()
        }
    );
    // A kind this replica has no producer for stays for the replica that has
    // one (a rolling update), untouched.
    let left = row(&db, unknown_kind.id).await;
    assert_eq!(left.state, DeliveryState::Pending);
    assert!(left.claim_token.is_none());
    assert_eq!(left.outcome, json!({}));
    // A channel this replica lacks gets the bounded retries, not a failure.
    let requeued = row(&db, unknown_channel.id).await;
    assert_eq!(requeued.state, DeliveryState::Pending);
    assert_eq!(requeued.outcome["attempts"], 1);
    assert_eq!(
        requeued.outcome["last_error"],
        "no channel registered as `recording`"
    );
    assert!(channel.deliveries().is_empty());

    // With nothing registered, nothing is claimed at all.
    make_due(&db, unknown_channel.id).await;
    assert!(
        !run_delivery_tick(&db, &settings(), &DeliveryRegistry::new())
            .await
            .touched()
    );
    assert_eq!(
        row(&db, unknown_channel.id).await.state,
        DeliveryState::Pending
    );
}

/// Producers run at the start of every tick, so a row they create for now is
/// delivered in the same tick.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn producers_run_on_the_tick(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry_with(
        TestProducer {
            produce_for: Some(user.id),
            ..TestProducer::new()
        },
        &channel,
    );

    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(
        outcome,
        TickOutcome {
            produced: 1,
            claimed: 1,
            delivered: 1,
            ..Default::default()
        }
    );
    assert_eq!(channel.deliveries()[0].content.text, "note produced");
}

/// With only `scheduled_deliveries.enabled`, the supervisor starts the
/// delivery worker (and not the cleanup worker), and the tick job it
/// schedules reaches that worker.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn supervisor_runs_the_delivery_worker_on_its_own_switch(pool: Pool<Postgres>) {
    let (mut app_config, _server) = setup_mock_llm_server(None).await;
    app_config.cleanup_enabled = false;
    app_config.scheduled_deliveries.enabled = true;
    app_config.scheduled_deliveries.batch_size = 5;
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = Arc::new(registry_with(TestProducer::new(), &channel));
    let created = schedule(&db, new_delivery(user.id, Utc::now(), Some("ticked")))
        .await
        .unwrap()
        .unwrap();

    let supervisor_name = format!("test_sup_{}", Uuid::new_v4());
    let derived = WorkerNames::derived_from(&supervisor_name);
    let _manager = erato::actors::manager::ActorManager::new_with_name(
        db.clone(),
        app_config,
        registry,
        Some(supervisor_name.clone()),
    )
    .await;

    let delivery_registered = registry::where_is(derived.delivery_worker.clone()).is_some();
    let cleanup_registered = registry::where_is(derived.cleanup_worker.clone()).is_some();
    let cron_registered = registry::where_is(derived.cleanup_worker_cron.clone()).is_some();

    let mut job = delivery_tick_job(&derived);
    job.work().await.expect("tick job must dispatch");
    let mut delivered = false;
    for _ in 0..100 {
        if row(&db, created.id).await.state == DeliveryState::Delivered {
            delivered = true;
            break;
        }
        tokio::time::sleep(StdDuration::from_millis(50)).await;
    }

    if let Some(supervisor) = registry::where_is(supervisor_name) {
        supervisor.stop(Some("test finished".to_string()));
    }

    assert!(
        delivery_registered,
        "the delivery worker must start on its own switch"
    );
    assert!(cron_registered, "the cron manager carries the delivery job");
    assert!(
        !cleanup_registered,
        "the cleanup worker stays off without cleanup or delegation"
    );
    assert!(
        delivered,
        "a tick addressed to the derived worker name must deliver"
    );
    assert_eq!(channel.deliveries().len(), 1);
}

/// A channel that never answers: the executor cuts the call off before the
/// claim can go stale under it, and leaves the row claimed for the reclaim.
struct HangingChannel;

#[async_trait::async_trait]
impl DeliveryChannel for HangingChannel {
    fn name(&self) -> &str {
        CHANNEL
    }

    async fn deliver(
        &self,
        _db: &DatabaseConnection,
        _user: &users::Model,
        _row: &Model,
        _content: &DeliveryContent,
    ) -> DeliveryOutcome {
        tokio::time::sleep(StdDuration::from_secs(30)).await;
        DeliveryOutcome::Delivered { details: json!({}) }
    }
}

/// A channel with a bug in it.
struct PanickingChannel;

#[async_trait::async_trait]
impl DeliveryChannel for PanickingChannel {
    fn name(&self) -> &str {
        "panicking"
    }

    async fn deliver(
        &self,
        _db: &DatabaseConnection,
        _user: &users::Model,
        _row: &Model,
        _content: &DeliveryContent,
    ) -> DeliveryOutcome {
        panic!("channel bug");
    }
}

async fn strand_claim(db: &DatabaseConnection, id: Uuid, outcome: serde_json::Value) {
    db.execute_raw(Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        "UPDATE scheduled_deliveries SET state = 'claimed', claim_token = 'dead-replica',
         claimed_at = now() - interval '1 hour', outcome = $2 WHERE id = $1",
        [id.into(), outcome.into()],
    ))
    .await
    .expect("claim stranded");
}

/// A claim that went stale counts as an attempt, so a row whose holders keep
/// dying or hanging in the channel call runs out of attempts instead of
/// coming back every claim timeout forever.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn stale_claims_count_as_attempts(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let registry = registry_with(TestProducer::new(), &channel);
    let poison = schedule(&db, new_delivery(user.id, Utc::now(), Some("poison")))
        .await
        .unwrap()
        .unwrap();
    let unlucky = schedule(&db, new_delivery(user.id, Utc::now(), Some("unlucky")))
        .await
        .unwrap()
        .unwrap();
    // settings(): three attempts. Two holders died on the poison row, one on
    // the unlucky row; both are stranded in a third and second claim.
    strand_claim(&db, poison.id, json!({"attempts": 2, "reclaimed": 2})).await;
    strand_claim(&db, unlucky.id, json!({"attempts": 1, "reclaimed": 1})).await;

    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(
        outcome,
        TickOutcome {
            reclaimed: 2,
            claimed: 2,
            delivered: 1,
            failed: 1,
            ..Default::default()
        }
    );
    let given_up = row(&db, poison.id).await;
    assert_eq!(given_up.state, DeliveryState::Failed);
    assert_eq!(given_up.outcome["attempts"], 3);
    assert_eq!(given_up.outcome["reclaimed"], 3);
    assert_eq!(given_up.outcome["reason"], "no delivery after 3 attempts");
    let delivered = row(&db, unlucky.id).await;
    assert_eq!(delivered.state, DeliveryState::Delivered);
    assert_eq!(delivered.outcome["attempts"], 3);
    assert_eq!(delivered.outcome["reclaimed"], 2);
    assert_eq!(channel.deliveries().len(), 1);
    assert_eq!(channel.deliveries()[0].delivery_id, unlucky.id);
}

/// A channel that does not answer within the claim timeout is cut off; the
/// row keeps its claim, is reclaimed later as a counted attempt, and a
/// healthy replica then delivers it.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn hanging_channel_is_cut_off_and_the_row_keeps_its_claim(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let mut hanging = DeliveryRegistry::new();
    hanging.register_producer(Arc::new(TestProducer::new()));
    hanging.register_channel(Arc::new(HangingChannel));
    let short_claims = ExecutorSettings {
        claim_timeout: StdDuration::from_secs(1),
        ..settings()
    };
    let created = schedule(&db, new_delivery(user.id, Utc::now(), Some("slow")))
        .await
        .unwrap()
        .unwrap();

    let outcome = run_delivery_tick(&db, &short_claims, &hanging).await;
    assert_eq!(
        outcome,
        TickOutcome {
            claimed: 1,
            lost: 1,
            ..Default::default()
        }
    );
    let held = row(&db, created.id).await;
    assert_eq!(held.state, DeliveryState::Claimed);
    assert!(held.claim_token.is_some());
    assert!(held.outcome.get("attempts").is_none());

    // The claim ages past the timeout; a healthy replica reclaims and delivers.
    tokio::time::sleep(StdDuration::from_millis(1200)).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let healthy = registry_with(TestProducer::new(), &channel);
    let outcome = run_delivery_tick(&db, &short_claims, &healthy).await;
    assert_eq!(
        outcome,
        TickOutcome {
            reclaimed: 1,
            claimed: 1,
            delivered: 1,
            ..Default::default()
        }
    );
    let delivered = row(&db, created.id).await;
    assert_eq!(delivered.state, DeliveryState::Delivered);
    assert_eq!(delivered.outcome["attempts"], 2);
    assert_eq!(delivered.outcome["reclaimed"], 1);
}

/// A panic in one row's delivery leaves that row claimed and the rest of the
/// batch still gets delivered.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn a_panicking_row_does_not_take_the_batch_with_it(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let mut registry = registry_with(TestProducer::new(), &channel);
    registry.register_producer(Arc::new(TestProducer {
        kind: "boom_kind".into(),
        channel: "panicking".into(),
        still_due: Mutex::new(StillDue::Yes),
        produce_for: None,
        produced: AtomicBool::new(false),
    }));
    registry.register_channel(Arc::new(PanickingChannel));
    // Due first, so it is delivered first and would stall everything behind it.
    let boom = schedule(
        &db,
        NewDelivery {
            kind: "boom_kind".into(),
            ..new_delivery(user.id, Utc::now() - Duration::seconds(5), None)
        },
    )
    .await
    .unwrap()
    .unwrap();
    let fine = schedule(&db, new_delivery(user.id, Utc::now(), Some("fine")))
        .await
        .unwrap()
        .unwrap();

    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(
        outcome,
        TickOutcome {
            claimed: 2,
            delivered: 1,
            lost: 1,
            ..Default::default()
        }
    );
    assert_eq!(row(&db, boom.id).await.state, DeliveryState::Claimed);
    assert_eq!(row(&db, fine.id).await.state, DeliveryState::Delivered);
    assert_eq!(channel.deliveries().len(), 1);
}

/// A producer can say "not now": the row goes back to pending for the time
/// it names, no attempt is used, and it is delivered once that time comes.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn guard_can_defer_a_row_without_using_an_attempt(pool: Pool<Postgres>) {
    let (db, user) = database(pool).await;
    let channel = Arc::new(RecordingChannel::new(CHANNEL));
    let later = Utc::now() + Duration::hours(1);
    let deferring = TestProducer {
        still_due: Mutex::new(StillDue::Later { due_at: later }),
        ..TestProducer::new()
    };
    let registry = registry_with(deferring, &channel);
    let created = schedule(&db, new_delivery(user.id, Utc::now(), Some("later")))
        .await
        .unwrap()
        .unwrap();

    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(
        outcome,
        TickOutcome {
            claimed: 1,
            deferred: 1,
            ..Default::default()
        }
    );
    let waiting = row(&db, created.id).await;
    assert_eq!(waiting.state, DeliveryState::Pending);
    assert!(waiting.claim_token.is_none());
    assert!(waiting.outcome.get("attempts").is_none());
    assert_eq!(waiting.outcome["deferred"], 1);
    assert!(
        (waiting.due_at.with_timezone(&Utc) - later)
            .num_seconds()
            .abs()
            < 2
    );
    assert!(channel.deliveries().is_empty());
    assert!(
        !run_delivery_tick(&db, &settings(), &registry)
            .await
            .touched(),
        "not due until the named time"
    );

    // A deferral into the past is pushed by the retry delay rather than spun on.
    let spinning = TestProducer {
        still_due: Mutex::new(StillDue::Later {
            due_at: Utc::now() - Duration::hours(1),
        }),
        ..TestProducer::new()
    };
    let registry = registry_with(spinning, &channel);
    make_due(&db, created.id).await;
    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(outcome.deferred, 1, "{outcome:?}");
    let pushed = row(&db, created.id).await;
    assert!(pushed.due_at > (Utc::now() + Duration::seconds(30)).fixed_offset());
    assert_eq!(pushed.outcome["deferred"], 2);

    // When the time comes, the first real attempt delivers it.
    make_due(&db, created.id).await;
    let registry = registry_with(TestProducer::new(), &channel);
    let outcome = run_delivery_tick(&db, &settings(), &registry).await;
    assert_eq!(outcome.delivered, 1, "{outcome:?}");
    assert_eq!(row(&db, created.id).await.outcome["attempts"], 1);
    assert_eq!(channel.deliveries().len(), 1);
}
