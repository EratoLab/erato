//! What a user scheduled: reminders now, scheduled tasks later.
//!
//! One `scheduled_items` row per entry on the Scheduled page holds what the
//! user entered (name, message, trigger, channel) and the zone its local
//! times were entered in. Each time the item is due, one occurrence row in
//! `scheduled_deliveries` (same kind, dedupe key = the item id) carries it
//! through the executor; the dedupe index keeps it to one open occurrence per
//! item. Once an occurrence is settled, the producer creates the next one
//! from the rule on its next tick, or ends the item.
//!
//! The next occurrence is computed from the regular time recorded on the
//! item (`occurrence_at`), not from when the last one went out, so snoozing
//! moves only the current occurrence. Edits that change the trigger
//! reschedule the open occurrence; cancelling ends the series.

pub mod recurrence;

use crate::db::entity::prelude::{Chats, ScheduledItems};
use crate::db::entity::scheduled_deliveries::{self, CreatedBy, DeliveryState};
use crate::db::entity::scheduled_items::{self, ItemStatus, Model};
use crate::models::chat::resolve_chat_display_name;
use crate::query_metrics::named_statement_from_sql_and_values;
use crate::services::scheduled_deliveries::{
    DeliveryContent, DeliveryLink, DeliveryProducer, NewDelivery, ResolvedContent, StillDue,
    cancel_open, schedule, snooze,
};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use eyre::{Report, eyre};
use recurrence::Trigger;
use sea_orm::prelude::Uuid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend,
    EntityTrait, FromQueryResult, IntoActiveModel, QueryFilter, QueryOrder, QuerySelect, Statement,
    TransactionTrait,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use utoipa::ToSchema;

pub const REMINDER: &str = "reminder";
/// Upcoming items a user may have, as for the reminder tool.
pub const MAX_ACTIVE_ITEMS: u64 = 10;
/// Items one `produce` pass advances; the rest wait for the next tick.
const PRODUCE_BATCH: i64 = 200;
const OPEN_STATES: &str = "('pending', 'claimed', 'snoozed')";

fn statement(id: &'static str, sql: &str, values: Vec<sea_orm::Value>) -> Statement {
    named_statement_from_sql_and_values(DbBackend::Postgres, id, sql, values)
}

/// Why a change to an item was not made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// No such item, or it belongs to someone else.
    NotFound,
    /// The trigger has no occurrence after now.
    NoFutureOccurrence,
    /// The item has ended or was cancelled.
    Finished,
    /// Its occurrence is being delivered right now, and the change would
    /// leave nothing after it.
    InFlight,
    /// There is no open occurrence to snooze.
    NothingToSnooze,
    /// The item may still deliver something, so it cannot be deleted.
    NotFinished,
}

/// `Ok(Err(_))` is a refusal the caller reports; `Err(_)` a failure.
pub type Change<T> = Result<Result<T, Refusal>, Report>;

/// What the user entered, already validated.
#[derive(Debug, Clone)]
pub struct ItemInput {
    pub kind: String,
    pub name: String,
    pub message: String,
    pub linked_chat_id: Option<Uuid>,
    pub channel: String,
    pub trigger: Trigger,
    pub time_zone: Tz,
}

pub fn trigger_of(item: &Model) -> Result<Trigger, Report> {
    Ok(serde_json::from_value(item.trigger.clone())?)
}

pub fn zone_of(item: &Model) -> Result<Tz, Report> {
    item.time_zone
        .parse()
        .map_err(|_| eyre!("unknown time zone `{}`", item.time_zone))
}

fn count_of(item: &Model) -> u32 {
    u32::try_from(item.occurrence_count).unwrap_or(0)
}

/// Create an item and its first occurrence.
pub async fn create(
    db: &DatabaseConnection,
    user_id: Uuid,
    input: ItemInput,
    origin: Value,
) -> Change<Model> {
    let Some(first) = input.trigger.next_after(input.time_zone, Utc::now(), 0) else {
        return Ok(Err(Refusal::NoFutureOccurrence));
    };
    let txn = db.begin().await?;
    let item = scheduled_items::ActiveModel {
        user_id: ActiveValue::Set(user_id),
        kind: ActiveValue::Set(input.kind),
        name: ActiveValue::Set(input.name),
        message: ActiveValue::Set(input.message),
        linked_chat_id: ActiveValue::Set(input.linked_chat_id),
        channel: ActiveValue::Set(input.channel),
        trigger: ActiveValue::Set(serde_json::to_value(&input.trigger)?),
        time_zone: ActiveValue::Set(input.time_zone.name().to_string()),
        status: ActiveValue::Set(ItemStatus::Active),
        occurrence_at: ActiveValue::Set(Some(first.fixed_offset())),
        occurrence_count: ActiveValue::Set(1),
        origin: ActiveValue::Set(origin),
        ..Default::default()
    }
    .insert(&txn)
    .await?;
    schedule_occurrence(&txn, &item, first, 1)
        .await?
        .ok_or_else(|| eyre!("a new item already had an open occurrence"))?;
    txn.commit().await?;
    Ok(Ok(item))
}

/// Apply an edit. A changed trigger or zone moves the open occurrence to the
/// new rule's first time after now (dropping a snooze); while an occurrence
/// is being delivered, the new rule applies from the next one.
pub async fn update(
    db: &DatabaseConnection,
    user_id: Uuid,
    item_id: Uuid,
    input: ItemInput,
) -> Change<Model> {
    let txn = db.begin().await?;
    let Some(item) = lock(&txn, Some(user_id), item_id).await? else {
        return Ok(Err(Refusal::NotFound));
    };
    if item.status != ItemStatus::Active {
        return Ok(Err(Refusal::Finished));
    }
    let now = Utc::now();
    let rescheduled = trigger_of(&item).ok().as_ref() != Some(&input.trigger)
        || item.time_zone != input.time_zone.name();
    let mut occurrence_at = item.occurrence_at;
    if rescheduled {
        match lock_current_occurrence(&txn, &item).await? {
            Some(row) if row.state.is_open() => {
                // The open occurrence is replaced, so it does not count.
                let before = count_of(&item).saturating_sub(1);
                let Some(at) = input.trigger.next_after(input.time_zone, now, before) else {
                    return Ok(Err(Refusal::NoFutureOccurrence));
                };
                reschedule(&txn, row.id, at).await?;
                occurrence_at = Some(at.fixed_offset());
            }
            current => {
                let after = item
                    .occurrence_at
                    .map_or(now, |at| at.with_timezone(&Utc).max(now));
                if input
                    .trigger
                    .next_after(input.time_zone, after, count_of(&item))
                    .is_none()
                {
                    return Ok(Err(if current.is_some() {
                        Refusal::InFlight
                    } else if input.trigger.next_after(input.time_zone, now, 0).is_some() {
                        Refusal::Finished
                    } else {
                        Refusal::NoFutureOccurrence
                    }));
                }
            }
        }
    }
    let mut model = item.into_active_model();
    model.name = ActiveValue::Set(input.name);
    model.message = ActiveValue::Set(input.message);
    model.linked_chat_id = ActiveValue::Set(input.linked_chat_id);
    model.channel = ActiveValue::Set(input.channel);
    model.trigger = ActiveValue::Set(serde_json::to_value(&input.trigger)?);
    model.time_zone = ActiveValue::Set(input.time_zone.name().to_string());
    model.occurrence_at = ActiveValue::Set(occurrence_at);
    let item = model.update(&txn).await?;
    txn.commit().await?;
    Ok(Ok(item))
}

/// End the series: the item is cancelled and its open occurrence with it. An
/// occurrence already being delivered still goes out.
pub async fn cancel(db: &DatabaseConnection, user_id: Uuid, item_id: Uuid) -> Change<Model> {
    let txn = db.begin().await?;
    let Some(item) = lock(&txn, Some(user_id), item_id).await? else {
        return Ok(Err(Refusal::NotFound));
    };
    if item.status != ItemStatus::Active {
        return Ok(Err(Refusal::Finished));
    }
    let mut model = item.into_active_model();
    model.status = ActiveValue::Set(ItemStatus::Cancelled);
    let item = model.update(&txn).await?;
    cancel_open(
        &txn,
        item.user_id,
        Some(&item.kind),
        Some(&item.id.to_string()),
        "cancelled by the user",
    )
    .await?;
    txn.commit().await?;
    Ok(Ok(item))
}

/// Move the item's open occurrence to `until`. The next occurrence keeps
/// its regular time.
pub async fn snooze_occurrence(
    db: &DatabaseConnection,
    user_id: Uuid,
    item_id: Uuid,
    until: DateTime<Utc>,
) -> Change<Model> {
    let Some(item) = find(db, user_id, item_id).await? else {
        return Ok(Err(Refusal::NotFound));
    };
    if item.status != ItemStatus::Active {
        return Ok(Err(Refusal::Finished));
    }
    let Some(row) = current_occurrence(db, &item)
        .await?
        .filter(|row| row.state.is_open())
    else {
        return Ok(Err(Refusal::NothingToSnooze));
    };
    if !snooze(db, row.id, until).await? {
        return Ok(Err(Refusal::NothingToSnooze));
    }
    Ok(Ok(item))
}

/// Delete a finished item (done, failed or cancelled) with its occurrence
/// rows.
pub async fn delete(db: &DatabaseConnection, user_id: Uuid, item_id: Uuid) -> Change<()> {
    let txn = db.begin().await?;
    let Some(item) = lock(&txn, Some(user_id), item_id).await? else {
        return Ok(Err(Refusal::NotFound));
    };
    // A cancelled item's occurrence that was already claimed still goes out,
    // and the producer needs the item for it.
    if current_occurrence(&txn, &item).await?.is_some() {
        return Ok(Err(Refusal::NotFinished));
    }
    let view = ItemView {
        item,
        current: None,
        last: None,
    };
    if display_status(&view, Utc::now()) == DisplayStatus::Scheduled {
        return Ok(Err(Refusal::NotFinished));
    }
    let item = view.item;
    txn.execute_raw(statement(
        "scheduled_items.delete_occurrences",
        "DELETE FROM scheduled_deliveries
         WHERE user_id = $1 AND kind = $2 AND dedupe_key = $3",
        vec![
            item.user_id.into(),
            item.kind.clone().into(),
            item.id.to_string().into(),
        ],
    ))
    .await?;
    ScheduledItems::delete_by_id(item.id).exec(&txn).await?;
    txn.commit().await?;
    Ok(Ok(()))
}

async fn find(
    db: &DatabaseConnection,
    user_id: Uuid,
    item_id: Uuid,
) -> Result<Option<Model>, Report> {
    Ok(ScheduledItems::find_by_id(item_id)
        .filter(scheduled_items::Column::UserId.eq(user_id))
        .one(db)
        .await?)
}

/// The status the Scheduled page shows, the same for every item type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DisplayStatus {
    Scheduled,
    Snoozed,
    Done,
    Failed,
    Cancelled,
}

/// An item with its open occurrence and its latest settled one.
#[derive(Debug, Clone)]
pub struct ItemView {
    pub item: Model,
    pub current: Option<scheduled_deliveries::Model>,
    pub last: Option<scheduled_deliveries::Model>,
}

/// The one place that maps an item and its occurrences to what the page
/// shows. "Done" means delivered; whether it should mean "the user pressed
/// Done" is still open, and `acknowledged_at` is reported separately.
pub fn display_status(view: &ItemView, now: DateTime<Utc>) -> DisplayStatus {
    if view.item.status == ItemStatus::Cancelled {
        return DisplayStatus::Cancelled;
    }
    match (&view.current, &view.last) {
        (Some(current), _) if current.state == DeliveryState::Snoozed => DisplayStatus::Snoozed,
        (Some(_), _) => DisplayStatus::Scheduled,
        // Between two occurrences, before the producer's next tick.
        (None, _) if next_occurrence(view, now).is_some() => DisplayStatus::Scheduled,
        (None, Some(last)) => match last.state {
            DeliveryState::Failed => DisplayStatus::Failed,
            DeliveryState::Cancelled => DisplayStatus::Cancelled,
            _ => DisplayStatus::Done,
        },
        (None, None) => DisplayStatus::Done,
    }
}

/// When the item arrives next: its open occurrence's time (snoozed or
/// not), or for an active item between two occurrences the time the
/// producer will schedule.
pub fn next_occurrence(view: &ItemView, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    if let Some(current) = &view.current {
        return Some(current.due_at.with_timezone(&Utc));
    }
    let item = &view.item;
    if item.status != ItemStatus::Active {
        return None;
    }
    let after = item
        .occurrence_at
        .map_or(now, |at| at.with_timezone(&Utc).max(now));
    trigger_of(item)
        .ok()?
        .next_after(zone_of(item).ok()?, after, count_of(item))
}

/// The user's upcoming (active) or past (ended, cancelled) items; past ones
/// newest first, at most `past_limit`.
pub async fn list(
    db: &DatabaseConnection,
    user_id: Uuid,
    past: bool,
    past_limit: u64,
) -> Result<Vec<ItemView>, Report> {
    let query = ScheduledItems::find().filter(scheduled_items::Column::UserId.eq(user_id));
    let items = if past {
        query
            .filter(scheduled_items::Column::Status.ne(ItemStatus::Active))
            .order_by_desc(scheduled_items::Column::UpdatedAt)
            .limit(past_limit)
            .all(db)
            .await?
    } else {
        query
            .filter(scheduled_items::Column::Status.eq(ItemStatus::Active))
            .order_by_asc(scheduled_items::Column::OccurrenceAt)
            .all(db)
            .await?
    };
    views(db, user_id, items).await
}

/// One of the user's items.
pub async fn get(
    db: &DatabaseConnection,
    user_id: Uuid,
    item_id: Uuid,
) -> Result<Option<ItemView>, Report> {
    let Some(item) = find(db, user_id, item_id).await? else {
        return Ok(None);
    };
    Ok(views(db, user_id, vec![item]).await?.pop())
}

/// How many upcoming and past items the user has.
pub async fn counts(db: &DatabaseConnection, user_id: Uuid) -> Result<(u64, u64), Report> {
    #[derive(FromQueryResult)]
    struct Counts {
        upcoming: i64,
        past: i64,
    }
    let counts = Counts::find_by_statement(statement(
        "scheduled_items.counts",
        "SELECT count(*) FILTER (WHERE status = 'active') AS upcoming,
                count(*) FILTER (WHERE status <> 'active') AS past
         FROM scheduled_items WHERE user_id = $1",
        vec![user_id.into()],
    ))
    .one(db)
    .await?;
    Ok(counts.map_or((0, 0), |counts| {
        (counts.upcoming.max(0) as u64, counts.past.max(0) as u64)
    }))
}

async fn views(
    db: &DatabaseConnection,
    user_id: Uuid,
    items: Vec<Model>,
) -> Result<Vec<ItemView>, Report> {
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let ids = items
        .iter()
        .map(|item| item.id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    // Per item, the open occurrence and the newest settled one.
    let sql = format!(
        "SELECT DISTINCT ON (dedupe_key, state IN {OPEN_STATES}) *
         FROM scheduled_deliveries
         WHERE user_id = $1 AND dedupe_key = ANY(string_to_array($2, ','))
         ORDER BY dedupe_key, state IN {OPEN_STATES}, created_at DESC, id DESC"
    );
    let rows = scheduled_deliveries::Model::find_by_statement(statement(
        "scheduled_items.occurrences",
        &sql,
        vec![user_id.into(), ids.into()],
    ))
    .all(db)
    .await?;
    let mut by_item: HashMap<String, (Option<_>, Option<_>)> = HashMap::new();
    for row in rows {
        let Some(key) = row.dedupe_key.clone() else {
            continue;
        };
        let entry = by_item.entry(key).or_default();
        if matches!(
            row.state,
            DeliveryState::Pending | DeliveryState::Claimed | DeliveryState::Snoozed
        ) {
            entry.0 = Some(row);
        } else {
            entry.1 = Some(row);
        }
    }
    Ok(items
        .into_iter()
        .map(|item| {
            let (current, last) = by_item.remove(&item.id.to_string()).unwrap_or_default();
            ItemView {
                item,
                current,
                last,
            }
        })
        .collect())
}

/// The item's occurrence that is not settled yet, if any.
pub async fn current_occurrence<C: ConnectionTrait>(
    db: &C,
    item: &Model,
) -> Result<Option<scheduled_deliveries::Model>, Report> {
    occurrence_query(db, item, "scheduled_items.current_occurrence", "").await
}

async fn lock_current_occurrence<C: ConnectionTrait>(
    db: &C,
    item: &Model,
) -> Result<Option<scheduled_deliveries::Model>, Report> {
    occurrence_query(
        db,
        item,
        "scheduled_items.lock_current_occurrence",
        "FOR UPDATE",
    )
    .await
}

async fn occurrence_query<C: ConnectionTrait>(
    db: &C,
    item: &Model,
    id: &'static str,
    lock: &str,
) -> Result<Option<scheduled_deliveries::Model>, Report> {
    let sql = format!(
        "SELECT * FROM scheduled_deliveries
         WHERE user_id = $1 AND kind = $2 AND dedupe_key = $3 AND state IN {OPEN_STATES}
         {lock}"
    );
    Ok(scheduled_deliveries::Model::find_by_statement(statement(
        id,
        &sql,
        vec![
            item.user_id.into(),
            item.kind.clone().into(),
            item.id.to_string().into(),
        ],
    ))
    .one(db)
    .await?)
}

async fn lock<C: ConnectionTrait>(
    db: &C,
    user_id: Option<Uuid>,
    item_id: Uuid,
) -> Result<Option<Model>, Report> {
    Ok(Model::find_by_statement(statement(
        "scheduled_items.lock",
        "SELECT * FROM scheduled_items
         WHERE id = $1 AND ($2::uuid IS NULL OR user_id = $2)
         FOR UPDATE",
        vec![item_id.into(), user_id.into()],
    ))
    .one(db)
    .await?)
}

async fn schedule_occurrence<C: ConnectionTrait>(
    db: &C,
    item: &Model,
    at: DateTime<Utc>,
    number: i32,
) -> Result<Option<scheduled_deliveries::Model>, Report> {
    schedule(
        db,
        NewDelivery {
            user_id: item.user_id,
            kind: item.kind.clone(),
            due_at: at,
            created_by: CreatedBy::User,
            origin: json!({"scheduled_item_id": item.id}),
            payload: json!({"item_id": item.id, "occurrence": number, "scheduled_for": at}),
            dedupe_key: Some(item.id.to_string()),
        },
    )
    .await
}

async fn reschedule<C: ConnectionTrait>(
    db: &C,
    delivery_id: Uuid,
    at: DateTime<Utc>,
) -> Result<(), Report> {
    db.execute_raw(statement(
        "scheduled_items.reschedule",
        "UPDATE scheduled_deliveries
         SET state = 'pending', due_at = $2, payload = payload || $3::jsonb,
             outcome = outcome - 'original_due_at'
         WHERE id = $1 AND state IN ('pending', 'snoozed')",
        vec![
            delivery_id.into(),
            at.fixed_offset().into(),
            json!({"scheduled_for": at}).into(),
        ],
    ))
    .await?;
    Ok(())
}

/// Give an active item without an open occurrence its next one, or end it.
/// The item's row lock serializes replicas that picked the same item, so
/// they create one occurrence between them. Returns whether one was created.
async fn advance(db: &DatabaseConnection, item_id: Uuid) -> Result<bool, Report> {
    let txn = db.begin().await?;
    let Some(item) = lock(&txn, None, item_id).await? else {
        return Ok(false);
    };
    if item.status != ItemStatus::Active || current_occurrence(&txn, &item).await?.is_some() {
        return Ok(false);
    }
    let now = Utc::now();
    let next = match (trigger_of(&item), zone_of(&item)) {
        (Ok(trigger), Ok(zone)) => {
            // From the regular time, or from now after an outage, so missed
            // occurrences are not caught up in a burst.
            let after = item
                .occurrence_at
                .map_or(now, |at| at.with_timezone(&Utc).max(now));
            trigger.next_after(zone, after, count_of(&item))
        }
        (Err(error), _) | (_, Err(error)) => {
            tracing::warn!(%error, item_id = %item.id, "A scheduled item cannot be read; it ends");
            None
        }
    };
    let created = match next {
        Some(at) => {
            let number = item.occurrence_count + 1;
            let created = schedule_occurrence(&txn, &item, at, number)
                .await?
                .is_some();
            let mut model = item.into_active_model();
            model.occurrence_at = ActiveValue::Set(Some(at.fixed_offset()));
            model.occurrence_count = ActiveValue::Set(number);
            model.update(&txn).await?;
            created
        }
        None => {
            let mut model = item.into_active_model();
            model.status = ActiveValue::Set(ItemStatus::Ended);
            model.update(&txn).await?;
            false
        }
    };
    txn.commit().await?;
    Ok(created)
}

/// Delivers user reminders: the item's name as title, its message as body,
/// and a link to the linked chat.
pub struct ReminderProducer {
    public_base_url: Option<String>,
}

impl ReminderProducer {
    pub fn new(public_base_url: Option<String>) -> Self {
        Self {
            public_base_url: public_base_url.map(|url| url.trim_end_matches('/').to_string()),
        }
    }

    async fn item_for(
        &self,
        db: &DatabaseConnection,
        row: &scheduled_deliveries::Model,
    ) -> Result<Option<Model>, Report> {
        let Some(item_id) = row
            .payload
            .get("item_id")
            .and_then(Value::as_str)
            .or(row.dedupe_key.as_deref())
            .and_then(|id| Uuid::parse_str(id).ok())
        else {
            return Ok(None);
        };
        Ok(ScheduledItems::find_by_id(item_id)
            .one(db)
            .await?
            .filter(|item| item.user_id == row.user_id))
    }
}

#[derive(Debug, FromQueryResult)]
struct DueItem {
    id: Uuid,
}

#[async_trait::async_trait]
impl DeliveryProducer for ReminderProducer {
    fn kind(&self) -> &str {
        REMINDER
    }

    async fn produce(&self, db: &DatabaseConnection) -> Result<usize, Report> {
        let sql = format!(
            "SELECT i.id FROM scheduled_items i
             WHERE i.status = 'active' AND i.kind = $1
               AND NOT EXISTS (
                   SELECT 1 FROM scheduled_deliveries d
                   WHERE d.user_id = i.user_id AND d.kind = i.kind
                     AND d.dedupe_key = i.id::text AND d.state IN {OPEN_STATES})
             ORDER BY i.occurrence_at NULLS FIRST
             LIMIT $2"
        );
        let due = DueItem::find_by_statement(statement(
            "scheduled_items.due",
            &sql,
            vec![REMINDER.into(), PRODUCE_BATCH.into()],
        ))
        .all(db)
        .await?;
        let mut created = 0;
        for item in due {
            match advance(db, item.id).await {
                Ok(true) => created += 1,
                Ok(false) => {}
                Err(error) => {
                    tracing::warn!(%error, item_id = %item.id, "Could not schedule the next occurrence of an item")
                }
            }
        }
        Ok(created)
    }

    async fn still_due(
        &self,
        db: &DatabaseConnection,
        row: &scheduled_deliveries::Model,
    ) -> Result<StillDue, Report> {
        Ok(match self.item_for(db, row).await? {
            None => StillDue::No {
                reason: "the item no longer exists".to_string(),
            },
            Some(item) if item.status == ItemStatus::Cancelled => StillDue::No {
                reason: "cancelled by the user".to_string(),
            },
            Some(_) => StillDue::Yes,
        })
    }

    async fn resolve_content(
        &self,
        db: &DatabaseConnection,
        row: &scheduled_deliveries::Model,
    ) -> Result<ResolvedContent, Report> {
        let item = self
            .item_for(db, row)
            .await?
            .ok_or_else(|| eyre!("the item no longer exists"))?;
        let chat = match (item.linked_chat_id, &self.public_base_url) {
            (Some(chat_id), Some(_)) => Chats::find_by_id(chat_id)
                .one(db)
                .await?
                .filter(|chat| chat.owner_user_id == item.user_id.to_string()),
            _ => None,
        };
        let links = chat
            .zip(self.public_base_url.as_deref())
            .map(|(chat, base)| DeliveryLink {
                title: resolve_chat_display_name(
                    chat.title_by_user_provided.as_deref(),
                    chat.title_by_summary.as_deref(),
                ),
                url: format!("{base}/chat/{}", chat.id),
            })
            .into_iter()
            .collect();
        Ok(ResolvedContent {
            channel: item.channel.clone(),
            content: DeliveryContent {
                title: Some(item.name.clone()),
                text: item.message.clone(),
                summary: Some(item.name),
                links,
                actions: Vec::new(),
            },
        })
    }
}
