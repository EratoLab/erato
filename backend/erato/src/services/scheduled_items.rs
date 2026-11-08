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
//!
//! Snoozing a reminder after it arrived (from its card) brings back that one
//! reminder as a re-delivery row of its own, keyed `{item_id}:snooze`, so the
//! regular occurrence keeps its row and the dedupe index stays one open row
//! per key. Everything that asks for the item's open occurrence sees the
//! re-delivery too, and the producer leaves the item alone until it settles.

pub mod chat_tools;
mod checks;
pub mod recurrence;
pub mod wording;

pub use checks::{
    Checked, DeliveryChannelStatus, ItemRequest, MAX_MESSAGE_CHARS, MAX_NAME_CHARS, Refused,
    ScheduledItemErrorCode, ScheduledItemType, TimeZoneSource, cancel_checked, checked_input,
    create_checked, default_zone, entry_zone, owned_chats, owns_chat, teams_channel_available,
    teams_status, update_checked,
};

use crate::db::entity::prelude::ScheduledItems;
use crate::db::entity::scheduled_deliveries::{self, CreatedBy, DeliveryState};
use crate::db::entity::scheduled_items::{self, ItemStatus, Model};
use crate::models::chat::chat_title;
use crate::models::user_preference::user_time_zone;
use crate::query_metrics::named_statement_from_sql_and_values;
use crate::services::scheduled_deliveries::{
    self as deliveries, DeliveryAction, DeliveryContent, DeliveryLink, DeliveryProducer,
    NewDelivery, ResolvedContent, StillDue, cancel_open, schedule, snooze, store_action_token,
};
use crate::services::text_language;
use chrono::{DateTime, NaiveTime, SecondsFormat, SubsecRound, Utc};
use chrono_tz::Tz;
use eyre::{Report, eyre};
use recurrence::{Trigger, local_time, resolve_local};
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
/// Upcoming items a user may have, on the page and through the chat tools.
pub const MAX_ACTIVE_ITEMS: u64 = 10;
/// Items one `produce` pass advances; the rest wait for the next tick.
const PRODUCE_BATCH: i64 = 200;
const OPEN_STATES: &str = "('pending', 'claimed', 'snoozed')";
const REDELIVERY_SUFFIX: &str = ":snooze";
/// Commands of the buttons on a delivered reminder's card.
pub const DONE_COMMAND: &str = "done";
pub const SNOOZE_COMMAND: &str = "snooze";
pub const TOMORROW_COMMAND: &str = "tomorrow";
/// The hour "Tomorrow" brings a reminder back at, as the web's
/// `SCHEDULED_SNOOZE_HOUR`.
pub const SNOOZE_HOUR: u32 = 9;
const SNOOZE_MINUTES: i64 = 30;

fn statement(id: &'static str, sql: &str, values: Vec<sea_orm::Value>) -> Statement {
    named_statement_from_sql_and_values(DbBackend::Postgres, id, sql, values)
}

fn redelivery_key(item_id: Uuid) -> String {
    format!("{item_id}{REDELIVERY_SUFFIX}")
}

/// The item a row belongs to, whether a regular occurrence or a re-delivery.
fn item_key(dedupe_key: &str) -> &str {
    dedupe_key
        .strip_suffix(REDELIVERY_SUFFIX)
        .unwrap_or(dedupe_key)
}

fn item_id_of(row: &scheduled_deliveries::Model) -> Option<Uuid> {
    row.payload
        .get("item_id")
        .and_then(Value::as_str)
        .or(row.dedupe_key.as_deref().map(item_key))
        .and_then(|id| Uuid::parse_str(id).ok())
}

/// When a delivered reminder comes back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnoozeChoice {
    /// In 30 minutes.
    HalfAnHour,
    /// Tomorrow at [`SNOOZE_HOUR`] in the item's zone.
    TomorrowMorning,
}

impl SnoozeChoice {
    pub const ALL: [Self; 2] = [Self::HalfAnHour, Self::TomorrowMorning];

    pub fn until(self, zone: Tz, now: DateTime<Utc>) -> DateTime<Utc> {
        match self {
            // As Postgres stores it, so the time returned is the one kept.
            Self::HalfAnHour => (now + chrono::Duration::minutes(SNOOZE_MINUTES)).trunc_subsecs(6),
            Self::TomorrowMorning => {
                let tomorrow = local_time(zone, now).date() + chrono::Duration::days(1);
                let morning = NaiveTime::from_hms_opt(SNOOZE_HOUR, 0, 0).unwrap_or_default();
                resolve_local(zone, tomorrow.and_time(morning))
            }
        }
    }

    pub fn command(self) -> &'static str {
        match self {
            Self::HalfAnHour => SNOOZE_COMMAND,
            Self::TomorrowMorning => TOMORROW_COMMAND,
        }
    }
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
    /// A reminder snoozed after delivery would not come back before its next
    /// regular occurrence, or that occurrence already came.
    NextOccurrenceFirst,
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
        let (regular, redelivery) = lock_open_occurrences(&txn, &item).await?;
        // A new schedule replaces a snooze after delivery as it replaces one
        // before; a one-off's re-delivery is all that is left of it, so it
        // moves instead.
        let current = match (regular, redelivery) {
            (None, Some(redelivery))
                if matches!(input.trigger, Trigger::Once { .. }) || !redelivery.state.is_open() =>
            {
                Some(redelivery)
            }
            (regular, redelivery) => {
                if redelivery.is_some() {
                    cancel_open(
                        &txn,
                        item.user_id,
                        Some(&item.kind),
                        Some(&redelivery_key(item.id)),
                        "replaced by a new schedule",
                    )
                    .await?;
                }
                regular
            }
        };
        match current {
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
    // A delivered one-off stays active until the producer's next tick ends
    // it, but nothing of it is left to cancel.
    let current = current_occurrence(&txn, &item).await?;
    let view = ItemView {
        item,
        current,
        last: None,
    };
    if view.current.is_none() && next_occurrence(&view, Utc::now()).is_none() {
        return Ok(Err(Refusal::Finished));
    }
    let mut model = view.item.into_active_model();
    model.status = ActiveValue::Set(ItemStatus::Cancelled);
    let item = model.update(&txn).await?;
    for key in [item.id.to_string(), redelivery_key(item.id)] {
        cancel_open(
            &txn,
            item.user_id,
            Some(&item.kind),
            Some(&key),
            "cancelled by the user",
        )
        .await?;
    }
    txn.commit().await?;
    Ok(Ok(item))
}

/// Move the item's open occurrence (the one arriving first, which may be a
/// re-delivery) to `until`. The next occurrence keeps its regular time, and
/// a re-delivery only moves to a time before it, as from its card.
pub async fn snooze_occurrence(
    db: &DatabaseConnection,
    user_id: Uuid,
    item_id: Uuid,
    until: DateTime<Utc>,
) -> Change<Model> {
    let txn = db.begin().await?;
    let Some(item) = lock(&txn, Some(user_id), item_id).await? else {
        return Ok(Err(Refusal::NotFound));
    };
    if item.status != ItemStatus::Active {
        return Ok(Err(Refusal::Finished));
    }
    let Some(row) = current_occurrence(&txn, &item)
        .await?
        .filter(|row| row.state.is_open())
    else {
        return Ok(Err(Refusal::NothingToSnooze));
    };
    if row.dedupe_key.as_deref() == Some(redelivery_key(item.id).as_str())
        && !next_regular_after(&txn, &item, &row, Utc::now())
            .await?
            .allows(until)
    {
        return Ok(Err(Refusal::NextOccurrenceFirst));
    }
    if !snooze(&txn, row.id, until).await? {
        return Ok(Err(Refusal::NothingToSnooze));
    }
    txn.commit().await?;
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
         WHERE user_id = $1 AND kind = $2 AND dedupe_key IN ($3, $4)",
        vec![
            item.user_id.into(),
            item.kind.clone().into(),
            item.id.to_string().into(),
            redelivery_key(item.id).into(),
        ],
    ))
    .await?;
    ScheduledItems::delete_by_id(item.id).exec(&txn).await?;
    txn.commit().await?;
    Ok(Ok(()))
}

/// The user pressed Done on a delivered reminder's card. Only
/// `outcome.acknowledged_at` is stored: the page's Done means the reminder
/// happened as planned, so the item's status and schedule stay as they are.
pub async fn acknowledge(
    db: &DatabaseConnection,
    user_id: Uuid,
    delivery_id: Uuid,
) -> Change<Model> {
    let Some(row) = deliveries::find(db, delivery_id)
        .await?
        .filter(|row| row.user_id == user_id && row.state == DeliveryState::Delivered)
    else {
        return Ok(Err(Refusal::NotFound));
    };
    let item = match item_id_of(&row) {
        Some(item_id) => find(db, user_id, item_id).await?,
        None => None,
    };
    let Some(item) = item.filter(|item| item.kind == row.kind) else {
        return Ok(Err(Refusal::NotFound));
    };
    db.execute_raw(statement(
        "scheduled_items.acknowledge",
        "UPDATE scheduled_deliveries
         SET outcome = outcome || jsonb_build_object('acknowledged_at', $2::text)
         WHERE id = $1 AND state = 'delivered' AND outcome->'acknowledged_at' IS NULL",
        vec![
            row.id.into(),
            Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true).into(),
        ],
    ))
    .await?;
    Ok(Ok(item))
}

/// Bring a delivered reminder back at `choice`'s time, as a re-delivery of
/// its own; the regular schedule stays. The time must come before the item's
/// next regular occurrence, so two cards for the same reminder are never out
/// at once. An item that has ended is active again until the re-delivery is
/// settled. Returns the item and the time it comes back.
pub async fn snooze_delivered(
    db: &DatabaseConnection,
    user_id: Uuid,
    delivery_id: Uuid,
    choice: SnoozeChoice,
) -> Change<(Model, DateTime<Utc>)> {
    let txn = db.begin().await?;
    let Some(row) = deliveries::find(&txn, delivery_id)
        .await?
        .filter(|row| row.user_id == user_id)
    else {
        return Ok(Err(Refusal::NotFound));
    };
    let item = match item_id_of(&row) {
        Some(item_id) => lock(&txn, Some(user_id), item_id).await?,
        None => None,
    };
    let Some(item) = item.filter(|item| item.kind == row.kind) else {
        return Ok(Err(Refusal::NotFound));
    };
    if item.status == ItemStatus::Cancelled {
        return Ok(Err(Refusal::Finished));
    }
    if row.state != DeliveryState::Delivered {
        return Ok(Err(Refusal::NothingToSnooze));
    }
    let now = Utc::now();
    let until = choice.until(zone_of(&item)?, now);
    if !next_regular_after(&txn, &item, &row, now)
        .await?
        .allows(until)
    {
        return Ok(Err(Refusal::NextOccurrenceFirst));
    }
    let redelivery = match lock_open_occurrences(&txn, &item).await?.1 {
        Some(open) if !open.state.is_open() => return Ok(Err(Refusal::InFlight)),
        // Another card of the item was snoozed and has not come back yet.
        Some(open) => open,
        None => schedule(
            &txn,
            NewDelivery {
                user_id,
                kind: item.kind.clone(),
                due_at: until,
                created_by: CreatedBy::User,
                origin: json!({"scheduled_item_id": item.id, "snoozed_from": row.id}),
                payload: json!({
                    "item_id": item.id,
                    "occurrence": row.payload.get("occurrence"),
                    "scheduled_for": row.payload.get("scheduled_for"),
                    "snoozed_from": row.id,
                }),
                dedupe_key: Some(redelivery_key(item.id)),
            },
        )
        .await?
        .ok_or_else(|| eyre!("a re-delivery appeared while its item was locked"))?,
    };
    snooze(&txn, redelivery.id, until).await?;
    let item = if item.status == ItemStatus::Ended {
        let mut model = item.into_active_model();
        model.status = ActiveValue::Set(ItemStatus::Active);
        model.update(&txn).await?
    } else {
        item
    };
    txn.commit().await?;
    Ok(Ok((item, until)))
}

/// The snooze buttons a delivered card offers: those whose time comes before
/// the item's next regular occurrence.
pub async fn snooze_choices<C: ConnectionTrait>(
    db: &C,
    item: &Model,
    row: &scheduled_deliveries::Model,
    now: DateTime<Utc>,
) -> Result<Vec<SnoozeChoice>, Report> {
    let next = next_regular_after(db, item, row, now).await?;
    let zone = zone_of(item)?;
    Ok(SnoozeChoice::ALL
        .into_iter()
        .filter(|choice| next.allows(choice.until(zone, now)))
        .collect())
}

/// The regular occurrence after the one a delivered card carried.
enum NextRegular {
    None,
    At(DateTime<Utc>),
    /// It was delivered (or settled) already, so the card is out of date.
    AlreadyCame,
}

impl NextRegular {
    fn allows(&self, until: DateTime<Utc>) -> bool {
        match self {
            Self::None => true,
            Self::At(next) => until < *next,
            Self::AlreadyCame => false,
        }
    }
}

/// What follows the occurrence `row` carried: the next regular row's time,
/// or the time the producer will give it.
async fn next_regular_after<C: ConnectionTrait>(
    db: &C,
    item: &Model,
    row: &scheduled_deliveries::Model,
    now: DateTime<Utc>,
) -> Result<NextRegular, Report> {
    let count = count_of(item);
    let carried = row
        .payload
        .get("occurrence")
        .and_then(Value::as_u64)
        .and_then(|number| u32::try_from(number).ok())
        .unwrap_or(count);
    if count > carried + 1 {
        return Ok(NextRegular::AlreadyCame);
    }
    let (regular, _) = open_occurrences(db, item, "scheduled_items.open_occurrences", "").await?;
    if let Some(regular) = regular.filter(|regular| regular.id != row.id) {
        return Ok(NextRegular::At(regular.due_at.with_timezone(&Utc)));
    }
    if count > carried {
        return Ok(NextRegular::AlreadyCame);
    }
    if item.status != ItemStatus::Active {
        return Ok(NextRegular::None);
    }
    let after = item
        .occurrence_at
        .map_or(now, |at| at.with_timezone(&Utc).max(now));
    Ok(
        match trigger_of(item)?.next_after(zone_of(item)?, after, count) {
            Some(at) => NextRegular::At(at),
            None => NextRegular::None,
        },
    )
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

/// An item with its open occurrence (the one arriving first, a re-delivery
/// included) and its latest settled one.
#[derive(Debug, Clone)]
pub struct ItemView {
    pub item: Model,
    pub current: Option<scheduled_deliveries::Model>,
    pub last: Option<scheduled_deliveries::Model>,
}

/// The one place that maps an item and its occurrences to what the page
/// shows. Done means the reminder happened as planned (delivered): the Done
/// button on its card only closes that card and is reported as
/// `acknowledged_at`, so a user who never presses it does not see the
/// reminder as unfinished.
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

/// Whether an item with this id exists, whoever's it is.
pub async fn exists(db: &DatabaseConnection, item_id: Uuid) -> Result<bool, Report> {
    Ok(ScheduledItems::find_by_id(item_id).one(db).await?.is_some())
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
    let keys = items
        .iter()
        .flat_map(|item| [item.id.to_string(), redelivery_key(item.id)])
        .collect::<Vec<_>>()
        .join(",");
    // Per item, over its regular rows and its re-deliveries: the open row
    // that arrives first and the settled one that was due last. A re-delivery
    // can be created before the next regular row and settle after it, so
    // creation order does not tell which is the latest. A cancelled
    // re-delivery is a snooze that was dropped, not an outcome.
    let sql = format!(
        "SELECT DISTINCT ON (split_part(dedupe_key, ':', 1), state IN {OPEN_STATES}) *
         FROM scheduled_deliveries
         WHERE user_id = $1 AND dedupe_key = ANY(string_to_array($2, ','))
           AND NOT (state = 'cancelled' AND dedupe_key LIKE '%{REDELIVERY_SUFFIX}')
         ORDER BY split_part(dedupe_key, ':', 1), state IN {OPEN_STATES},
                  CASE WHEN state IN {OPEN_STATES} THEN due_at END ASC, due_at DESC, id DESC"
    );
    let rows = scheduled_deliveries::Model::find_by_statement(statement(
        "scheduled_items.occurrences",
        &sql,
        vec![user_id.into(), keys.into()],
    ))
    .all(db)
    .await?;
    let mut by_item: HashMap<String, (Option<_>, Option<_>)> = HashMap::new();
    for row in rows {
        let Some(key) = row
            .dedupe_key
            .as_deref()
            .map(|key| item_key(key).to_string())
        else {
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

/// The item's occurrence that is not settled yet, if any: of a regular one
/// and a re-delivery, the one that arrives first.
pub async fn current_occurrence<C: ConnectionTrait>(
    db: &C,
    item: &Model,
) -> Result<Option<scheduled_deliveries::Model>, Report> {
    let (regular, redelivery) =
        open_occurrences(db, item, "scheduled_items.current_occurrence", "").await?;
    Ok(match (regular, redelivery) {
        (Some(regular), Some(redelivery)) => Some(if redelivery.due_at < regular.due_at {
            redelivery
        } else {
            regular
        }),
        (regular, redelivery) => regular.or(redelivery),
    })
}

async fn lock_open_occurrences<C: ConnectionTrait>(
    db: &C,
    item: &Model,
) -> Result<OpenOccurrences, Report> {
    open_occurrences(
        db,
        item,
        "scheduled_items.lock_open_occurrences",
        "FOR UPDATE",
    )
    .await
}

/// The item's open regular occurrence and its open re-delivery.
type OpenOccurrences = (
    Option<scheduled_deliveries::Model>,
    Option<scheduled_deliveries::Model>,
);

async fn open_occurrences<C: ConnectionTrait>(
    db: &C,
    item: &Model,
    id: &'static str,
    lock: &str,
) -> Result<OpenOccurrences, Report> {
    let sql = format!(
        "SELECT * FROM scheduled_deliveries
         WHERE user_id = $1 AND kind = $2 AND dedupe_key IN ($3, $4) AND state IN {OPEN_STATES}
         {lock}"
    );
    let regular_key = item.id.to_string();
    let mut open = (None, None);
    for row in scheduled_deliveries::Model::find_by_statement(statement(
        id,
        &sql,
        vec![
            item.user_id.into(),
            item.kind.clone().into(),
            regular_key.clone().into(),
            redelivery_key(item.id).into(),
        ],
    ))
    .all(db)
    .await?
    {
        if row.dedupe_key.as_deref() == Some(regular_key.as_str()) {
            open.0 = Some(row);
        } else {
            open.1 = Some(row);
        }
    }
    Ok(open)
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

/// Give an active item without an open occurrence (a re-delivery counts) its
/// next one, or end it.
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
/// and a link to the linked chat. Buttons and times are in the user's stored
/// language, else in `default_language`.
pub struct ReminderProducer {
    public_base_url: Option<String>,
    default_language: String,
}

impl ReminderProducer {
    pub fn new(public_base_url: Option<String>, default_language: &str) -> Self {
        Self {
            public_base_url: public_base_url.map(|url| url.trim_end_matches('/').to_string()),
            default_language: default_language.to_string(),
        }
    }

    async fn item_for(
        &self,
        db: &DatabaseConnection,
        row: &scheduled_deliveries::Model,
    ) -> Result<Option<Model>, Report> {
        let Some(item_id) = item_id_of(row) else {
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
                     AND d.dedupe_key IN (i.id::text, i.id::text || '{REDELIVERY_SUFFIX}')
                     AND d.state IN {OPEN_STATES})
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
            (Some(chat_id), Some(_)) => owned_chats(db, item.user_id, vec![chat_id])
                .await?
                .remove(&chat_id),
            _ => None,
        };
        let lang = text_language::of_user(db, item.user_id, None, &self.default_language).await?;
        let links = chat
            .zip(self.public_base_url.as_deref())
            .map(|(chat, base)| DeliveryLink {
                title: chat_title(
                    chat.title_by_user_provided.as_deref(),
                    chat.title_by_summary.as_deref(),
                )
                .unwrap_or(wording::untitled_chat(lang))
                .to_string(),
                url: format!("{base}/chat/{}", chat.id),
            })
            .into_iter()
            .collect();
        // One token for the card: the first button pressed wins.
        let token = Uuid::new_v4();
        store_action_token(db, row, token).await?;
        let zone = zone_of(&item)?;
        let user_zone = user_time_zone(db, &item.user_id).await?;
        let mut actions = vec![DeliveryAction {
            title: wording::done_button(lang).to_string(),
            command: DONE_COMMAND.to_string(),
            token: Some(token),
        }];
        actions.extend(
            snooze_choices(db, &item, row, Utc::now())
                .await?
                .into_iter()
                .map(|choice| DeliveryAction {
                    title: wording::snooze_button(choice, zone, user_zone, lang),
                    command: choice.command().to_string(),
                    token: Some(token),
                }),
        );
        Ok(ResolvedContent {
            channel: item.channel.clone(),
            content: DeliveryContent {
                title: Some(item.name.clone()),
                text: item.message.clone(),
                summary: Some(item.name),
                links,
                actions,
            },
        })
    }
}
