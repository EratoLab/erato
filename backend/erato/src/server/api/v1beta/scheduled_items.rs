//! The Scheduled page's API: the user's own scheduled items (reminders now).
//!
//! Each item is listed once, however many occurrences it had. Times in a
//! request are local to the user's stored zone (`preference_time_zone`, else
//! the deployment default); the zone used is stored with the item, so a
//! later change of the user's zone does not move it. Only items the user
//! created are listed: system deliveries such as the Teams inactivity nudge
//! are not scheduled items.

use crate::db::entity::prelude::Chats;
use crate::db::entity::{chats, scheduled_deliveries};
use crate::models::chat::resolve_chat_display_name;
use crate::ms_teams_bot::nudge::CHANNEL as TEAMS_CHANNEL;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::scheduled_deliveries::occurrence_due_at;
use crate::services::scheduled_items::recurrence::{Trigger, local_time};
use crate::services::scheduled_items::{
    self, DisplayStatus, ItemRequest, ItemView, MAX_ACTIVE_ITEMS, Refusal, Refused,
};
pub use crate::services::scheduled_items::{
    DeliveryChannelStatus, ScheduledItemErrorCode, ScheduledItemType, TimeZoneSource,
};
use crate::services::sentry::log_internal_server_error;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use chrono::{DateTime, NaiveDateTime, SubsecRound, Utc};
use chrono_tz::Tz;
use erato_config::config::{ScheduledTemplateType, ScheduledTemplatesConfig};
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use utoipa::{IntoParams, ToSchema};

const PAST_LIMIT: u64 = 100;

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DeliveryChannelInfo {
    pub channel: String,
    pub status: DeliveryChannelStatus,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct OccurrenceTime {
    pub at: DateTime<Utc>,
    /// The wall-clock time in the item's zone.
    #[schema(value_type = String, example = "2026-11-13T10:00:00")]
    pub local: NaiveDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LastDeliveryOutcome {
    Delivered,
    Failed,
    /// Not sent: the item was cancelled while it was due.
    Cancelled,
}

/// The most recent occurrence that is over.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct LastDelivery {
    /// When it was due (a snoozed occurrence: the snoozed time).
    pub due: OccurrenceTime,
    pub outcome: LastDeliveryOutcome,
    pub delivered_at: Option<DateTime<Utc>>,
    /// Why it failed or was not sent.
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct LinkedChat {
    pub id: Uuid,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ScheduledItem {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub item_type: ScheduledItemType,
    /// Shown in the list and as the title when it arrives.
    pub name: String,
    /// The body of what arrives.
    pub message: String,
    /// As entered; its times are local to `time_zone`.
    pub trigger: Trigger,
    /// The IANA zone the trigger's times are in.
    pub time_zone: String,
    pub status: DisplayStatus,
    /// When it arrives next (a snoozed occurrence: the snoozed time); absent
    /// once the item is over.
    pub next_occurrence: Option<OccurrenceTime>,
    pub last_delivery: Option<LastDelivery>,
    /// How many occurrences there were, including the coming one.
    pub occurrence_count: u32,
    pub channel: String,
    pub channel_status: DeliveryChannelStatus,
    pub linked_chat: Option<LinkedChat>,
    /// When the user marked the last delivery done on its card. Set once the
    /// card has a Done button (ERMAIN-1112).
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ScheduledItemsTab {
    /// Items that will still happen: scheduled or snoozed.
    #[default]
    Upcoming,
    /// Items that are over: done, failed or cancelled (the latest 100).
    Past,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct ScheduledItemsQuery {
    #[serde(default)]
    pub tab: ScheduledItemsTab,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ScheduledItemsResponse {
    pub items: Vec<ScheduledItem>,
    pub upcoming_count: u64,
    pub past_count: u64,
    /// The zone a new item's times are entered in.
    pub time_zone: String,
    pub time_zone_source: TimeZoneSource,
    /// Every delivery channel and whether it reaches the user.
    pub channels: Vec<DeliveryChannelInfo>,
    /// How many upcoming items a user may have.
    pub max_upcoming: u64,
}

/// One body for create and edit, as the form sends it.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct ScheduledItemRequest {
    #[serde(rename = "type", default)]
    pub item_type: ScheduledItemType,
    pub name: String,
    pub message: String,
    /// One of the user's chats; the delivered message links to it.
    #[serde(default)]
    pub linked_chat_id: Option<Uuid>,
    /// Defaults to `teams_personal`, the only channel today.
    #[serde(default = "default_channel")]
    pub channel: String,
    /// Local to the user's stored zone; the request carries no zone.
    pub trigger: Trigger,
}

fn default_channel() -> String {
    TEAMS_CHANNEL.to_string()
}

impl From<ScheduledItemRequest> for ItemRequest {
    fn from(request: ScheduledItemRequest) -> Self {
        Self {
            item_type: request.item_type,
            name: request.name,
            message: request.message,
            linked_chat_id: request.linked_chat_id,
            channel: request.channel,
            trigger: request.trigger,
        }
    }
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct SnoozeScheduledItemRequest {
    /// When the current occurrence should arrive instead. The next one keeps
    /// its regular time.
    pub until: DateTime<Utc>,
}

/// A refusal the form can show: `code` to branch on, `message` in English.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ScheduledItemError {
    pub code: ScheduledItemErrorCode,
    pub message: String,
}

#[derive(Debug)]
pub struct ApiError(StatusCode, ScheduledItemError);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}

fn status_of(code: ScheduledItemErrorCode) -> StatusCode {
    use ScheduledItemErrorCode as Code;
    match code {
        Code::NotFound => StatusCode::NOT_FOUND,
        Code::LimitReached
        | Code::Finished
        | Code::InFlight
        | Code::NothingToSnooze
        | Code::NotFinished => StatusCode::CONFLICT,
        Code::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        Code::InvalidRequest
        | Code::TypeNotAvailable
        | Code::InvalidTrigger
        | Code::TriggerInPast
        | Code::LinkedChatNotFound
        | Code::ChannelUnknown
        | Code::ChannelUnavailable
        | Code::ChannelNotSetUp => StatusCode::UNPROCESSABLE_ENTITY,
    }
}

impl From<Refused> for ApiError {
    fn from(refused: Refused) -> Self {
        ApiError(
            status_of(refused.code),
            ScheduledItemError {
                code: refused.code,
                message: refused.message,
            },
        )
    }
}

fn internal(report: Report) -> ApiError {
    ApiError(
        log_internal_server_error(report),
        ScheduledItemError {
            code: ScheduledItemErrorCode::Internal,
            message: "Something went wrong.".to_string(),
        },
    )
}

fn refusal(refusal: Refusal) -> ApiError {
    Refused::from(refusal).into()
}

fn not_found() -> ApiError {
    refusal(Refusal::NotFound)
}

fn user_id_of(me_user: &MeProfile) -> Result<Uuid, ApiError> {
    Uuid::parse_str(&me_user.id).map_err(|error| internal(Report::new(error)))
}

async fn teams_status(
    app_state: &AppState,
    user_id: Uuid,
) -> Result<DeliveryChannelStatus, ApiError> {
    scheduled_items::teams_status(app_state, user_id)
        .await
        .map_err(internal)
}

async fn linked_chats(
    app_state: &AppState,
    user_id: Uuid,
    ids: Vec<Uuid>,
) -> Result<HashMap<Uuid, chats::Model>, ApiError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    Ok(Chats::find()
        .filter(chats::Column::Id.is_in(ids))
        .filter(chats::Column::OwnerUserId.eq(user_id.to_string()))
        .all(&app_state.db)
        .await
        .map_err(|error| internal(error.into()))?
        .into_iter()
        .map(|chat| (chat.id, chat))
        .collect())
}

/// Whole seconds: a retry or a snooze stores the database's microseconds,
/// which the page would otherwise show in `local`.
fn occurrence_time(zone: Tz, at: DateTime<Utc>) -> OccurrenceTime {
    let at = at.trunc_subsecs(0);
    OccurrenceTime {
        at,
        local: local_time(zone, at),
    }
}

fn last_delivery(zone: Tz, row: &scheduled_deliveries::Model) -> Option<LastDelivery> {
    use scheduled_deliveries::DeliveryState;
    let outcome = match row.state {
        DeliveryState::Delivered => LastDeliveryOutcome::Delivered,
        DeliveryState::Failed => LastDeliveryOutcome::Failed,
        DeliveryState::Cancelled => LastDeliveryOutcome::Cancelled,
        DeliveryState::Pending | DeliveryState::Claimed | DeliveryState::Snoozed => return None,
    };
    Some(LastDelivery {
        due: occurrence_time(zone, occurrence_due_at(row)),
        outcome,
        delivered_at: row
            .delivered_at
            .map(|at| at.with_timezone(&Utc).trunc_subsecs(0)),
        reason: (outcome != LastDeliveryOutcome::Delivered)
            .then(|| row.outcome.get("reason").and_then(|reason| reason.as_str()))
            .flatten()
            .map(str::to_string),
    })
}

fn item_response(
    view: ItemView,
    chats: &HashMap<Uuid, chats::Model>,
    channel_status: DeliveryChannelStatus,
    now: DateTime<Utc>,
) -> Result<ScheduledItem, ApiError> {
    let item = &view.item;
    let zone = scheduled_items::zone_of(item).map_err(internal)?;
    let trigger = scheduled_items::trigger_of(item).map_err(internal)?;
    let status = scheduled_items::display_status(&view, now);
    let next_occurrence =
        scheduled_items::next_occurrence(&view, now).map(|at| occurrence_time(zone, at));
    let last_delivery = view.last.as_ref().and_then(|row| last_delivery(zone, row));
    let acknowledged_at = view
        .last
        .as_ref()
        .and_then(|row| row.outcome.get("acknowledged_at"))
        .and_then(|value| value.as_str())
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|at| at.with_timezone(&Utc));
    let linked_chat = item
        .linked_chat_id
        .and_then(|id| chats.get(&id))
        .map(|chat| LinkedChat {
            id: chat.id,
            title: resolve_chat_display_name(
                chat.title_by_user_provided.as_deref(),
                chat.title_by_summary.as_deref(),
            ),
        });
    Ok(ScheduledItem {
        id: item.id,
        item_type: ScheduledItemType::Reminder,
        name: item.name.clone(),
        message: item.message.clone(),
        trigger,
        time_zone: item.time_zone.clone(),
        status,
        next_occurrence,
        last_delivery,
        occurrence_count: u32::try_from(item.occurrence_count).unwrap_or(0),
        channel: item.channel.clone(),
        channel_status: if item.channel == TEAMS_CHANNEL {
            channel_status
        } else {
            DeliveryChannelStatus::Unavailable
        },
        linked_chat,
        acknowledged_at,
        created_at: item.created_at.with_timezone(&Utc),
        updated_at: item.updated_at.with_timezone(&Utc),
    })
}

async fn respond_with(
    app_state: &AppState,
    user_id: Uuid,
    views: Vec<ItemView>,
) -> Result<Vec<ScheduledItem>, ApiError> {
    let channel_status = teams_status(app_state, user_id).await?;
    let chat_ids = views
        .iter()
        .filter_map(|view| view.item.linked_chat_id)
        .collect();
    let chats = linked_chats(app_state, user_id, chat_ids).await?;
    let now = Utc::now();
    views
        .into_iter()
        .map(|view| item_response(view, &chats, channel_status, now))
        .collect()
}

async fn one_item(
    app_state: &AppState,
    user_id: Uuid,
    item_id: Uuid,
) -> Result<ScheduledItem, ApiError> {
    let view = scheduled_items::get(&app_state.db, user_id, item_id)
        .await
        .map_err(internal)?
        .ok_or_else(not_found)?;
    respond_with(app_state, user_id, vec![view])
        .await?
        .pop()
        .ok_or_else(not_found)
}

/// The user's scheduled items, one entry per item.
#[utoipa::path(
    get,
    path = "/me/scheduled-items",
    params(ScheduledItemsQuery),
    responses(
        (status = OK, body = ScheduledItemsResponse),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_scheduled_items(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Query(query): Query<ScheduledItemsQuery>,
) -> Result<Json<ScheduledItemsResponse>, ApiError> {
    let user_id = user_id_of(&me_user)?;
    let past = query.tab == ScheduledItemsTab::Past;
    let views = scheduled_items::list(&app_state.db, user_id, past, PAST_LIMIT)
        .await
        .map_err(internal)?;
    let mut items = respond_with(&app_state, user_id, views).await?;
    if !past {
        items.sort_by_key(|item| item.next_occurrence.as_ref().map(|next| next.at));
    }
    let (upcoming_count, past_count) = scheduled_items::counts(&app_state.db, user_id)
        .await
        .map_err(internal)?;
    let (zone, time_zone_source) = scheduled_items::entry_zone(&app_state, user_id)
        .await
        .map_err(internal)?;
    Ok(Json(ScheduledItemsResponse {
        items,
        upcoming_count,
        past_count,
        time_zone: zone.name().to_string(),
        time_zone_source,
        channels: vec![DeliveryChannelInfo {
            channel: TEAMS_CHANNEL.to_string(),
            status: teams_status(&app_state, user_id).await?,
        }],
        max_upcoming: MAX_ACTIVE_ITEMS,
    }))
}

#[utoipa::path(
    get,
    path = "/me/scheduled-items/{item_id}",
    params(("item_id" = Uuid, Path, description = "The item")),
    responses(
        (status = OK, body = ScheduledItem),
        (status = NOT_FOUND, body = ScheduledItemError, description = "No such item, or not the user's")
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_scheduled_item(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(item_id): Path<Uuid>,
) -> Result<Json<ScheduledItem>, ApiError> {
    let user_id = user_id_of(&me_user)?;
    Ok(Json(one_item(&app_state, user_id, item_id).await?))
}

/// Schedule a reminder. Refused, with nothing stored, when the channel
/// cannot reach the user, the schedule has no future time, or the user has
/// the maximum number of upcoming items.
#[utoipa::path(
    post,
    path = "/me/scheduled-items",
    request_body = ScheduledItemRequest,
    responses(
        (status = CREATED, body = ScheduledItem),
        (status = UNPROCESSABLE_ENTITY, body = ScheduledItemError, description = "Invalid input, unreachable channel or a schedule in the past"),
        (status = CONFLICT, body = ScheduledItemError, description = "The user has the maximum number of upcoming items (`limit_reached`)")
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_scheduled_item(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Json(request): Json<ScheduledItemRequest>,
) -> Result<(StatusCode, Json<ScheduledItem>), ApiError> {
    let user_id = user_id_of(&me_user)?;
    let item = scheduled_items::create_checked(
        &app_state,
        user_id,
        request.into(),
        serde_json::json!({"via": "web"}),
    )
    .await
    .map_err(internal)??;
    Ok((
        StatusCode::CREATED,
        Json(one_item(&app_state, user_id, item.id).await?),
    ))
}

/// Edit an item that is not over. A changed schedule moves the coming
/// occurrence (and drops a snooze); a schedule that is unchanged keeps the
/// item's zone, a changed one is read in the user's current zone.
#[utoipa::path(
    put,
    path = "/me/scheduled-items/{item_id}",
    params(("item_id" = Uuid, Path, description = "The item")),
    request_body = ScheduledItemRequest,
    responses(
        (status = OK, body = ScheduledItem),
        (status = NOT_FOUND, body = ScheduledItemError),
        (status = UNPROCESSABLE_ENTITY, body = ScheduledItemError, description = "Invalid input, unreachable channel or a schedule in the past"),
        (status = CONFLICT, body = ScheduledItemError, description = "The item is over (`finished`) or being delivered (`in_flight`)")
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_scheduled_item(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(item_id): Path<Uuid>,
    Json(request): Json<ScheduledItemRequest>,
) -> Result<Json<ScheduledItem>, ApiError> {
    let user_id = user_id_of(&me_user)?;
    scheduled_items::update_checked(&app_state, user_id, item_id, request.into())
        .await
        .map_err(internal)??;
    Ok(Json(one_item(&app_state, user_id, item_id).await?))
}

/// Cancel an item: a repeating one stops for good.
#[utoipa::path(
    post,
    path = "/me/scheduled-items/{item_id}/cancel",
    params(("item_id" = Uuid, Path, description = "The item")),
    responses(
        (status = OK, body = ScheduledItem),
        (status = NOT_FOUND, body = ScheduledItemError),
        (status = CONFLICT, body = ScheduledItemError, description = "The item is already over (`finished`)")
    ),
    security(("bearer_auth" = []))
)]
pub async fn cancel_scheduled_item(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(item_id): Path<Uuid>,
) -> Result<Json<ScheduledItem>, ApiError> {
    let user_id = user_id_of(&me_user)?;
    scheduled_items::cancel_checked(&app_state, user_id, item_id)
        .await
        .map_err(internal)??;
    Ok(Json(one_item(&app_state, user_id, item_id).await?))
}

/// Delete an item that is over (done, failed or cancelled), with its
/// delivery history.
#[utoipa::path(
    delete,
    path = "/me/scheduled-items/{item_id}",
    params(("item_id" = Uuid, Path, description = "The item")),
    responses(
        (status = NO_CONTENT, description = "Deleted"),
        (status = NOT_FOUND, body = ScheduledItemError),
        (status = CONFLICT, body = ScheduledItemError, description = "The item is scheduled, snoozed or being delivered (`not_finished`)")
    ),
    security(("bearer_auth" = []))
)]
pub async fn delete_scheduled_item(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(item_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let user_id = user_id_of(&me_user)?;
    scheduled_items::delete(&app_state.db, user_id, item_id)
        .await
        .map_err(internal)?
        .map_err(refusal)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Move the item's coming occurrence to a later time; a repeating item's
/// next occurrence keeps its regular time.
#[utoipa::path(
    post,
    path = "/me/scheduled-items/{item_id}/snooze",
    params(("item_id" = Uuid, Path, description = "The item")),
    request_body = SnoozeScheduledItemRequest,
    responses(
        (status = OK, body = ScheduledItem),
        (status = NOT_FOUND, body = ScheduledItemError),
        (status = UNPROCESSABLE_ENTITY, body = ScheduledItemError, description = "`until` is not in the future (`trigger_in_past`)"),
        (status = CONFLICT, body = ScheduledItemError, description = "The item is over, nothing is waiting to be delivered, or a reminder snoozed after delivery would not come back before its next regular time")
    ),
    security(("bearer_auth" = []))
)]
pub async fn snooze_scheduled_item(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Path(item_id): Path<Uuid>,
    Json(request): Json<SnoozeScheduledItemRequest>,
) -> Result<Json<ScheduledItem>, ApiError> {
    let user_id = user_id_of(&me_user)?;
    if request.until <= Utc::now() {
        return Err(refusal(Refusal::NoFutureOccurrence));
    }
    scheduled_items::snooze_occurrence(&app_state.db, user_id, item_id, request.until)
        .await
        .map_err(internal)?
        .map_err(refusal)?;
    Ok(Json(one_item(&app_state, user_id, item_id).await?))
}

/// A template on the Scheduled page's empty state; it opens the form
/// prefilled with `name` and `message`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ScheduledTemplate {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: ScheduledItemType,
    /// The label of the template's button.
    pub title: String,
    /// A short line shown with the button; may be empty.
    pub description: String,
    pub name: String,
    /// May be empty.
    pub message: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ScheduledTemplatesResponse {
    pub templates: Vec<ScheduledTemplate>,
}

/// Configured templates in `priority_order`, then the rest sorted by id.
pub fn ordered_templates(config: &ScheduledTemplatesConfig) -> Vec<ScheduledTemplate> {
    if !config.enabled {
        return Vec::new();
    }
    let mut rest: Vec<&String> = config
        .templates
        .keys()
        .filter(|id| !config.priority_order.contains(id))
        .collect();
    rest.sort();
    let mut seen = HashSet::new();
    config
        .priority_order
        .iter()
        .chain(rest)
        .filter(|id| seen.insert(id.as_str()))
        .filter_map(|id| {
            let template = config.templates.get(id)?;
            Some(ScheduledTemplate {
                id: id.clone(),
                item_type: match template.r#type {
                    ScheduledTemplateType::Reminder => ScheduledItemType::Reminder,
                },
                title: template.title.clone(),
                description: template.description.clone(),
                name: template.name.clone(),
                message: template.message.clone(),
            })
        })
        .collect()
}

/// The templates configured for the Scheduled page; empty when none are.
#[utoipa::path(
    get,
    path = "/me/scheduled-templates",
    responses(
        (status = OK, body = ScheduledTemplatesResponse),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_scheduled_templates(
    State(app_state): State<AppState>,
) -> Json<ScheduledTemplatesResponse> {
    Json(ScheduledTemplatesResponse {
        templates: ordered_templates(&app_state.config.scheduled.templates),
    })
}
