//! Messages Erato owes a user at a due time: reminders, nudges, notifications.
//!
//! One table (`scheduled_deliveries`) and one executor. A *producer* creates
//! rows for its `kind` and answers, at send time, whether a row is still owed
//! and what it says. A *channel* carries the resolved content to the user and
//! reports how that went. The executor ([`run_delivery_tick`]) runs on every
//! replica from the cron supervisor without coordination: a row is taken with
//! a compare-and-set claim (`FOR UPDATE SKIP LOCKED`), every later step is
//! fenced on the claim token, and a claim whose holder died is reclaimed once
//! it is older than the configured timeout.
//!
//! The split into producer and channel is what lets reminders, inactivity
//! nudges and future notifications share the storage and the crash recovery:
//! each only has to say what is owed and how to carry it.

use crate::db::entity::prelude::{ScheduledDeliveries, Users};
use crate::db::entity::scheduled_deliveries::{CreatedBy, DeliveryState, Model};
use crate::db::entity::users;
use crate::metrics_constants::{
    POSTGRES_QUERY_SCHEDULED_DELIVERY_CANCEL, POSTGRES_QUERY_SCHEDULED_DELIVERY_CLAIM,
    POSTGRES_QUERY_SCHEDULED_DELIVERY_COUNT_DELIVERED, POSTGRES_QUERY_SCHEDULED_DELIVERY_RECLAIM,
    POSTGRES_QUERY_SCHEDULED_DELIVERY_RETRY, POSTGRES_QUERY_SCHEDULED_DELIVERY_SCHEDULE,
    POSTGRES_QUERY_SCHEDULED_DELIVERY_SCHEDULE_ONCE, POSTGRES_QUERY_SCHEDULED_DELIVERY_SETTLE,
    POSTGRES_QUERY_SCHEDULED_DELIVERY_SNOOZE, POSTGRES_QUERY_SCHEDULED_DELIVERY_TOUCH,
};
use crate::query_metrics::named_statement_from_sql_and_values;
use chrono::{DateTime, FixedOffset, Utc};
use erato_config::config::ScheduledDeliveriesConfig;
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, FromQueryResult};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Markdown and buttons, as channels render them. A channel without buttons
/// appends the links as text and leaves the actions out.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeliveryContent {
    pub text: String,
    /// Short plain text for notification previews.
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub links: Vec<DeliveryLink>,
    #[serde(default)]
    pub actions: Vec<DeliveryAction>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeliveryLink {
    pub title: String,
    pub url: String,
}

/// A button that reports back to Erato. `command` is interpreted by the
/// producer's surface; `token` is single-use and bound to the delivery row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeliveryAction {
    pub title: String,
    pub command: String,
    #[serde(default)]
    pub token: Option<Uuid>,
}

/// The producer's send-time answer to "is this still owed?".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StillDue {
    Yes,
    No { reason: String },
}

/// What a producer resolved a row to: the channel that carries it and the
/// content. Resolved at send time so the text is current and the channel
/// can depend on the user (a reminder goes to Teams only where the user has
/// a personal bot conversation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedContent {
    pub channel: String,
    pub content: DeliveryContent,
}

/// How one delivery attempt went. Channels map their own transport errors;
/// the executor only decides what the row's state becomes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeliveryOutcome {
    Delivered {
        details: Value,
    },
    /// Try again later: throttled, transport failure, service unavailable.
    Retry {
        reason: String,
        retry_after: Option<Duration>,
    },
    /// Give up: the user cannot be reached this way.
    Failed {
        reason: String,
    },
}

#[async_trait::async_trait]
pub trait DeliveryProducer: Send + Sync {
    /// The `kind` of the rows this producer owns.
    fn kind(&self) -> &str;

    /// Create rows for whatever has become due. Called on every executor tick
    /// on every replica, so a producer gates itself and inserts with a dedupe
    /// key. Returns how many rows it created.
    async fn produce(&self, _db: &DatabaseConnection) -> Result<usize, Report> {
        Ok(0)
    }

    /// Whether the row is still owed at send time.
    async fn still_due(&self, db: &DatabaseConnection, row: &Model) -> Result<StillDue, Report>;

    /// The channel and content for the row, resolved at send time.
    async fn resolve_content(
        &self,
        db: &DatabaseConnection,
        row: &Model,
    ) -> Result<ResolvedContent, Report>;
}

#[async_trait::async_trait]
pub trait DeliveryChannel: Send + Sync {
    fn name(&self) -> &str;

    async fn deliver(
        &self,
        db: &DatabaseConnection,
        user: &users::Model,
        row: &Model,
        content: &DeliveryContent,
    ) -> DeliveryOutcome;
}

/// The producers and channels a deployment runs, built once at startup.
#[derive(Default)]
pub struct DeliveryRegistry {
    producers: HashMap<String, Arc<dyn DeliveryProducer>>,
    channels: HashMap<String, Arc<dyn DeliveryChannel>>,
}

impl DeliveryRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_producer(&mut self, producer: Arc<dyn DeliveryProducer>) {
        self.producers.insert(producer.kind().to_string(), producer);
    }

    pub fn register_channel(&mut self, channel: Arc<dyn DeliveryChannel>) {
        self.channels.insert(channel.name().to_string(), channel);
    }

    pub fn producer(&self, kind: &str) -> Option<&Arc<dyn DeliveryProducer>> {
        self.producers.get(kind)
    }

    pub fn channel(&self, name: &str) -> Option<&Arc<dyn DeliveryChannel>> {
        self.channels.get(name)
    }

    pub fn producer_kinds(&self) -> Vec<&str> {
        let mut kinds: Vec<&str> = self.producers.keys().map(String::as_str).collect();
        kinds.sort_unstable();
        kinds
    }

    pub fn channel_names(&self) -> Vec<&str> {
        let mut names: Vec<&str> = self.channels.keys().map(String::as_str).collect();
        names.sort_unstable();
        names
    }
}

impl std::fmt::Debug for DeliveryRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeliveryRegistry")
            .field("producers", &self.producer_kinds())
            .field("channels", &self.channel_names())
            .finish()
    }
}

/// A channel that keeps what it was asked to deliver and answers with a
/// scripted outcome. For tests, and for dry runs of a producer.
pub struct RecordingChannel {
    name: String,
    deliveries: Mutex<Vec<RecordedDelivery>>,
    outcome: Mutex<DeliveryOutcome>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedDelivery {
    pub delivery_id: Uuid,
    pub user_id: Uuid,
    pub kind: String,
    pub content: DeliveryContent,
}

impl RecordingChannel {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            deliveries: Mutex::new(Vec::new()),
            outcome: Mutex::new(DeliveryOutcome::Delivered {
                details: json!({"recorded": true}),
            }),
        }
    }

    pub fn answer_with(&self, outcome: DeliveryOutcome) {
        *self.outcome.lock().expect("recording channel outcome") = outcome;
    }

    pub fn deliveries(&self) -> Vec<RecordedDelivery> {
        self.deliveries
            .lock()
            .expect("recording channel deliveries")
            .clone()
    }
}

#[async_trait::async_trait]
impl DeliveryChannel for RecordingChannel {
    fn name(&self) -> &str {
        &self.name
    }

    async fn deliver(
        &self,
        _db: &DatabaseConnection,
        user: &users::Model,
        row: &Model,
        content: &DeliveryContent,
    ) -> DeliveryOutcome {
        self.deliveries
            .lock()
            .expect("recording channel deliveries")
            .push(RecordedDelivery {
                delivery_id: row.id,
                user_id: user.id,
                kind: row.kind.clone(),
                content: content.clone(),
            });
        self.outcome
            .lock()
            .expect("recording channel outcome")
            .clone()
    }
}

/// A row to create.
#[derive(Debug, Clone)]
pub struct NewDelivery {
    pub user_id: Uuid,
    pub kind: String,
    pub due_at: DateTime<Utc>,
    pub created_by: CreatedBy,
    /// Where the row comes from: chat id, tool call, rule run.
    pub origin: Value,
    /// What to say: literal text, or a template key with parameters. The
    /// producer interprets it at send time.
    pub payload: Value,
    /// With a key, at most one open row per (user, kind, key) exists.
    pub dedupe_key: Option<String>,
}

fn statement(id: &'static str, sql: &str, values: Vec<sea_orm::Value>) -> sea_orm::Statement {
    named_statement_from_sql_and_values(DbBackend::Postgres, id, sql, values)
}

const INSERT_COLUMNS: &str =
    "(user_id, kind, due_at, created_by, origin, payload, dedupe_key, state)";

/// Create a pending row. `None` when an open row with the same dedupe key
/// already exists, which is how a producer run stays idempotent.
pub async fn schedule(db: &DatabaseConnection, new: NewDelivery) -> Result<Option<Model>, Report> {
    let sql = format!(
        "INSERT INTO scheduled_deliveries {INSERT_COLUMNS}
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         ON CONFLICT (user_id, kind, dedupe_key) WHERE state IN ('pending', 'claimed', 'snoozed')
         DO NOTHING
         RETURNING *"
    );
    Ok(Model::find_by_statement(statement(
        POSTGRES_QUERY_SCHEDULED_DELIVERY_SCHEDULE,
        &sql,
        insert_values(&new),
    ))
    .one(db)
    .await?)
}

/// Like [`schedule`], but also refuses when a row with this dedupe key exists
/// in ANY state: for producers whose key names a situation that must be acted
/// on once ever, such as one nudge per inactivity period. Requires a key.
pub async fn schedule_once(
    db: &DatabaseConnection,
    new: NewDelivery,
) -> Result<Option<Model>, Report> {
    if new.dedupe_key.is_none() {
        return Err(eyre::eyre!("schedule_once requires a dedupe key"));
    }
    let sql = format!(
        "INSERT INTO scheduled_deliveries {INSERT_COLUMNS}
         SELECT $1, $2, $3, $4, $5, $6, $7, 'pending'
         WHERE NOT EXISTS (
             SELECT 1 FROM scheduled_deliveries
             WHERE user_id = $1 AND kind = $2 AND dedupe_key = $7
         )
         ON CONFLICT (user_id, kind, dedupe_key) WHERE state IN ('pending', 'claimed', 'snoozed')
         DO NOTHING
         RETURNING *"
    );
    Ok(Model::find_by_statement(statement(
        POSTGRES_QUERY_SCHEDULED_DELIVERY_SCHEDULE_ONCE,
        &sql,
        insert_values(&new),
    ))
    .one(db)
    .await?)
}

fn insert_values(new: &NewDelivery) -> Vec<sea_orm::Value> {
    vec![
        new.user_id.into(),
        new.kind.clone().into(),
        DateTime::<FixedOffset>::from(new.due_at).into(),
        match new.created_by {
            CreatedBy::System => "system",
            CreatedBy::User => "user",
        }
        .into(),
        new.origin.clone().into(),
        new.payload.clone().into(),
        new.dedupe_key.clone().into(),
    ]
}

/// Cancel the user's open rows, narrowed by kind and dedupe key when given.
/// Rows in flight (`claimed`) are left to the executor, whose producer guard
/// is the place to refuse them. Returns how many rows were cancelled.
pub async fn cancel_open(
    db: &DatabaseConnection,
    user_id: Uuid,
    kind: Option<&str>,
    dedupe_key: Option<&str>,
    reason: &str,
) -> Result<u64, Report> {
    let result = db
        .execute_raw(statement(
            POSTGRES_QUERY_SCHEDULED_DELIVERY_CANCEL,
            "UPDATE scheduled_deliveries
             SET state = 'cancelled', outcome = outcome || jsonb_build_object('reason', $4::text)
             WHERE user_id = $1 AND state IN ('pending', 'snoozed')
               AND ($2::text IS NULL OR kind = $2)
               AND ($3::text IS NULL OR dedupe_key = $3)",
            vec![
                user_id.into(),
                kind.map(str::to_owned).into(),
                dedupe_key.map(str::to_owned).into(),
                reason.into(),
            ],
        ))
        .await?;
    Ok(result.rows_affected())
}

/// Move an open row to a later time. `false` when the row is not open (in
/// flight or settled). Each snooze is counted in the outcome.
pub async fn snooze(
    db: &DatabaseConnection,
    id: Uuid,
    until: DateTime<Utc>,
) -> Result<bool, Report> {
    let result = db
        .execute_raw(statement(
            POSTGRES_QUERY_SCHEDULED_DELIVERY_SNOOZE,
            "UPDATE scheduled_deliveries
             SET state = 'snoozed', due_at = $2,
                 outcome = outcome || jsonb_build_object('snoozed', COALESCE((outcome->>'snoozed')::int, 0) + 1)
             WHERE id = $1 AND state IN ('pending', 'snoozed')",
            vec![id.into(), DateTime::<FixedOffset>::from(until).into()],
        ))
        .await?;
    Ok(result.rows_affected() > 0)
}

/// How many rows of this kind the user has received.
pub async fn count_delivered(
    db: &DatabaseConnection,
    user_id: Uuid,
    kind: &str,
) -> Result<u64, Report> {
    #[derive(FromQueryResult)]
    struct Count {
        count: i64,
    }
    let count = Count::find_by_statement(statement(
        POSTGRES_QUERY_SCHEDULED_DELIVERY_COUNT_DELIVERED,
        "SELECT count(*) AS count FROM scheduled_deliveries
         WHERE user_id = $1 AND kind = $2 AND state = 'delivered'",
        vec![user_id.into(), kind.into()],
    ))
    .one(db)
    .await?;
    Ok(count.map(|row| row.count.max(0) as u64).unwrap_or(0))
}

pub async fn find(db: &DatabaseConnection, id: Uuid) -> Result<Option<Model>, Report> {
    Ok(ScheduledDeliveries::find_by_id(id).one(db).await?)
}

/// What the executor reads from the configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutorSettings {
    pub batch_size: u32,
    pub claim_timeout: Duration,
    pub max_attempts: u32,
    pub retry_delay: Duration,
}

impl From<&ScheduledDeliveriesConfig> for ExecutorSettings {
    fn from(config: &ScheduledDeliveriesConfig) -> Self {
        Self {
            batch_size: config.batch_size.max(1),
            claim_timeout: Duration::from_secs(config.claim_timeout_seconds.max(1)),
            max_attempts: config.max_attempts.max(1),
            retry_delay: Duration::from_secs(config.retry_delay_seconds),
        }
    }
}

/// What one tick did, for the log line and for tests.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TickOutcome {
    pub produced: usize,
    pub reclaimed: u64,
    pub claimed: usize,
    pub delivered: usize,
    pub retried: usize,
    pub failed: usize,
    pub cancelled: usize,
    /// Rows whose claim was lost between claiming and delivering.
    pub lost: usize,
}

impl TickOutcome {
    pub fn touched(&self) -> bool {
        *self != Self::default()
    }
}

/// One executor tick: let producers create what is due, give abandoned
/// claims back, claim a batch of due rows and deliver each.
pub async fn run_delivery_tick(
    db: &DatabaseConnection,
    settings: &ExecutorSettings,
    registry: &DeliveryRegistry,
) -> TickOutcome {
    let mut outcome = TickOutcome::default();

    for kind in registry.producer_kinds() {
        let Some(producer) = registry.producer(kind) else {
            continue;
        };
        match producer.produce(db).await {
            Ok(produced) => outcome.produced += produced,
            Err(error) => tracing::warn!(%error, kind, "A delivery producer failed"),
        }
    }

    match reclaim_stale(db, settings.claim_timeout).await {
        Ok(reclaimed) => {
            outcome.reclaimed = reclaimed;
            if reclaimed > 0 {
                tracing::warn!(
                    reclaimed,
                    "Reclaimed scheduled deliveries whose claim went stale"
                );
            }
        }
        Err(error) => {
            tracing::warn!(%error, "The delivery executor could not reclaim stale claims");
            return outcome;
        }
    }

    let claim_token = Uuid::new_v4().to_string();
    let rows = match claim_due(db, settings.batch_size, &claim_token).await {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(%error, "The delivery executor could not claim due rows");
            return outcome;
        }
    };
    outcome.claimed = rows.len();

    for row in rows {
        match deliver_claimed(db, settings, registry, &row, &claim_token).await {
            Disposition::Delivered => outcome.delivered += 1,
            Disposition::Retried => outcome.retried += 1,
            Disposition::Failed => outcome.failed += 1,
            Disposition::Cancelled => outcome.cancelled += 1,
            Disposition::Lost => outcome.lost += 1,
        }
    }
    outcome
}

enum Disposition {
    Delivered,
    Retried,
    Failed,
    Cancelled,
    Lost,
}

async fn reclaim_stale(db: &DatabaseConnection, claim_timeout: Duration) -> Result<u64, Report> {
    let result = db
        .execute_raw(statement(
            POSTGRES_QUERY_SCHEDULED_DELIVERY_RECLAIM,
            "UPDATE scheduled_deliveries
             SET state = 'pending', claim_token = NULL, claimed_at = NULL,
                 outcome = outcome || jsonb_build_object('reclaimed', COALESCE((outcome->>'reclaimed')::int, 0) + 1)
             WHERE state = 'claimed' AND claimed_at < now() - make_interval(secs => $1::double precision)",
            vec![claim_timeout.as_secs_f64().into()],
        ))
        .await?;
    Ok(result.rows_affected())
}

async fn claim_due(
    db: &DatabaseConnection,
    batch_size: u32,
    claim_token: &str,
) -> Result<Vec<Model>, Report> {
    // `SKIP LOCKED` keeps concurrent ticks from waiting on each other; the
    // repeated state predicate on the update keeps a row that changed between
    // the select and the update from being taken anyway.
    Ok(Model::find_by_statement(statement(
        POSTGRES_QUERY_SCHEDULED_DELIVERY_CLAIM,
        "WITH due AS (
             SELECT id FROM scheduled_deliveries
             WHERE state IN ('pending', 'snoozed') AND due_at <= now()
             ORDER BY due_at ASC
             LIMIT $1
             FOR UPDATE SKIP LOCKED
         )
         UPDATE scheduled_deliveries AS d
         SET state = 'claimed', claim_token = $2, claimed_at = now()
         FROM due
         WHERE d.id = due.id AND d.state IN ('pending', 'snoozed')
         RETURNING d.*",
        vec![(batch_size as i64).into(), claim_token.into()],
    ))
    .all(db)
    .await?)
}

/// Renew the claim right before the channel call, so a long batch cannot be
/// reclaimed under its holder: the timeout then only has to outlast one
/// delivery, not a whole batch. `false` when the claim is no longer ours.
async fn touch_claim(db: &DatabaseConnection, id: Uuid, claim_token: &str) -> Result<bool, Report> {
    let result = db
        .execute_raw(statement(
            POSTGRES_QUERY_SCHEDULED_DELIVERY_TOUCH,
            "UPDATE scheduled_deliveries SET claimed_at = now()
             WHERE id = $1 AND claim_token = $2 AND state = 'claimed'",
            vec![id.into(), claim_token.into()],
        ))
        .await?;
    Ok(result.rows_affected() > 0)
}

async fn settle(
    db: &DatabaseConnection,
    id: Uuid,
    claim_token: &str,
    state: DeliveryState,
    outcome: Value,
) -> Result<bool, Report> {
    let result = db
        .execute_raw(statement(
            POSTGRES_QUERY_SCHEDULED_DELIVERY_SETTLE,
            "UPDATE scheduled_deliveries
             SET state = $3, claim_token = NULL,
                 delivered_at = CASE WHEN $3 = 'delivered' THEN now() ELSE delivered_at END,
                 outcome = outcome || $4::jsonb
             WHERE id = $1 AND claim_token = $2 AND state = 'claimed'",
            vec![
                id.into(),
                claim_token.into(),
                state.as_str().into(),
                outcome.into(),
            ],
        ))
        .await?;
    Ok(result.rows_affected() > 0)
}

async fn retry_later(
    db: &DatabaseConnection,
    id: Uuid,
    claim_token: &str,
    delay: Duration,
    outcome: Value,
) -> Result<bool, Report> {
    let result = db
        .execute_raw(statement(
            POSTGRES_QUERY_SCHEDULED_DELIVERY_RETRY,
            "UPDATE scheduled_deliveries
             SET state = 'pending', claim_token = NULL, claimed_at = NULL,
                 due_at = now() + make_interval(secs => $3::double precision),
                 outcome = outcome || $4::jsonb
             WHERE id = $1 AND claim_token = $2 AND state = 'claimed'",
            vec![
                id.into(),
                claim_token.into(),
                delay.as_secs_f64().into(),
                outcome.into(),
            ],
        ))
        .await?;
    Ok(result.rows_affected() > 0)
}

fn attempts(row: &Model) -> u32 {
    row.outcome
        .get("attempts")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(0)
}

async fn deliver_claimed(
    db: &DatabaseConnection,
    settings: &ExecutorSettings,
    registry: &DeliveryRegistry,
    row: &Model,
    claim_token: &str,
) -> Disposition {
    let attempt = attempts(row) + 1;
    let fail = |reason: String| async move {
        tracing::warn!(delivery_id = %row.id, kind = %row.kind, %reason, "Scheduled delivery failed");
        match settle(
            db,
            row.id,
            claim_token,
            DeliveryState::Failed,
            json!({"reason": reason, "attempts": attempt}),
        )
        .await
        {
            Ok(true) => Disposition::Failed,
            Ok(false) => Disposition::Lost,
            Err(error) => {
                tracing::warn!(%error, delivery_id = %row.id, "Could not mark a scheduled delivery failed");
                Disposition::Lost
            }
        }
    };
    // A producer or channel error is transient until proven otherwise: a
    // database or network hiccup must not consume the one delivery.
    let retry = |reason: String, retry_after: Option<Duration>| async move {
        if attempt >= settings.max_attempts {
            return fail(format!("{reason} (after {attempt} attempts)")).await;
        }
        let delay = retry_after.unwrap_or(settings.retry_delay);
        match retry_later(
            db,
            row.id,
            claim_token,
            delay,
            json!({"attempts": attempt, "last_error": reason}),
        )
        .await
        {
            Ok(true) => Disposition::Retried,
            Ok(false) => Disposition::Lost,
            Err(error) => {
                tracing::warn!(%error, delivery_id = %row.id, "Could not requeue a scheduled delivery");
                Disposition::Lost
            }
        }
    };

    let Some(producer) = registry.producer(&row.kind) else {
        return fail(format!("no producer registered for kind `{}`", row.kind)).await;
    };
    match producer.still_due(db, row).await {
        Ok(StillDue::Yes) => {}
        Ok(StillDue::No { reason }) => {
            return match settle(
                db,
                row.id,
                claim_token,
                DeliveryState::Cancelled,
                json!({"reason": reason, "attempts": attempt}),
            )
            .await
            {
                Ok(true) => Disposition::Cancelled,
                Ok(false) => Disposition::Lost,
                Err(error) => {
                    tracing::warn!(%error, delivery_id = %row.id, "Could not cancel a scheduled delivery");
                    Disposition::Lost
                }
            };
        }
        Err(error) => return retry(format!("guard failed: {error}"), None).await,
    }
    let resolved = match producer.resolve_content(db, row).await {
        Ok(resolved) => resolved,
        Err(error) => return retry(format!("content resolution failed: {error}"), None).await,
    };
    let Some(channel) = registry.channel(&resolved.channel) else {
        return fail(format!("no channel registered as `{}`", resolved.channel)).await;
    };
    let user = match Users::find_by_id(row.user_id).one(db).await {
        Ok(Some(user)) => user,
        Ok(None) => return fail("user no longer exists".to_string()).await,
        Err(error) => return retry(format!("user lookup failed: {error}"), None).await,
    };
    match touch_claim(db, row.id, claim_token).await {
        Ok(true) => {}
        Ok(false) => return Disposition::Lost,
        Err(error) => return retry(format!("claim renewal failed: {error}"), None).await,
    }
    match channel.deliver(db, &user, row, &resolved.content).await {
        DeliveryOutcome::Delivered { details } => {
            match settle(
                db,
                row.id,
                claim_token,
                DeliveryState::Delivered,
                json!({"channel": resolved.channel, "attempts": attempt, "delivered": details}),
            )
            .await
            {
                Ok(true) => Disposition::Delivered,
                // The channel call went out; losing the claim here means another
                // holder may deliver again. Loud, because it is the one window the
                // compare-and-sets cannot close.
                Ok(false) => {
                    tracing::error!(delivery_id = %row.id, "A scheduled delivery was sent but its claim was lost before it could be marked delivered");
                    Disposition::Lost
                }
                Err(error) => {
                    tracing::error!(%error, delivery_id = %row.id, "A scheduled delivery was sent but could not be marked delivered");
                    Disposition::Lost
                }
            }
        }
        DeliveryOutcome::Retry {
            reason,
            retry_after,
        } => retry(reason, retry_after).await,
        DeliveryOutcome::Failed { reason } => fail(reason).await,
    }
}
