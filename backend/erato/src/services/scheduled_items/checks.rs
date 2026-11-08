//! The checks every way of scheduling an item passes: the Scheduled page's
//! form, the chat tools and the card actions. A refusal carries the code the
//! form branches on and a reason in English; each caller words it for its
//! own reader.

use super::recurrence::Trigger;
use super::{Change, ItemInput, MAX_ACTIVE_ITEMS, Model, REMINDER, Refusal};
use crate::db::entity::prelude::{Chats, MsTeamsConversations};
use crate::db::entity::{chats, ms_teams_conversations};
use crate::models::user_preference::user_time_zone;
use crate::ms_teams_bot::nudge::CHANNEL as TEAMS_CHANNEL;
use crate::state::AppState;
use chrono_tz::Tz;
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

pub const MAX_NAME_CHARS: usize = 200;
pub const MAX_MESSAGE_CHARS: usize = 4000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ScheduledItemType {
    /// Delivers a message; never runs anything.
    #[default]
    Reminder,
    /// Runs a prompt in the user's name. Not available yet.
    ScheduledTask,
}

/// Whether a delivery channel can reach the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryChannelStatus {
    Connected,
    /// The user has not opened Erato in Teams yet, so there is no personal
    /// chat to deliver to.
    NotSetUp,
    /// This deployment does not deliver through the channel.
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TimeZoneSource {
    /// The zone the user's client last reported.
    User,
    /// No zone was reported yet; the deployment's default is used.
    DeploymentDefault,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ScheduledItemErrorCode {
    NotFound,
    /// Name or message missing or too long.
    InvalidRequest,
    /// `scheduled_task` is not available yet.
    TypeNotAvailable,
    /// The schedule is not usable (e.g. weekly without a weekday).
    InvalidTrigger,
    /// The schedule has no time in the future.
    TriggerInPast,
    LinkedChatNotFound,
    ChannelUnknown,
    /// The deployment does not deliver through the channel.
    ChannelUnavailable,
    /// The user cannot be reached on the channel yet (no Teams chat with
    /// Erato).
    ChannelNotSetUp,
    /// The user has the maximum number of upcoming items.
    LimitReached,
    /// The item is done, failed or cancelled.
    Finished,
    /// The item's occurrence is being delivered right now.
    InFlight,
    /// The item has no occurrence waiting to be snoozed.
    NothingToSnooze,
    /// Only done, failed or cancelled items can be deleted.
    NotFinished,
    Internal,
}

/// What the form or a chat tool asks for, before it is checked. Times in
/// the trigger are local; the request carries no zone.
#[derive(Debug, Clone)]
pub struct ItemRequest {
    pub item_type: ScheduledItemType,
    pub name: String,
    pub message: String,
    pub linked_chat_id: Option<Uuid>,
    pub channel: String,
    pub trigger: Trigger,
}

/// Why a request was refused: `code` to branch on, `message` in English.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refused {
    pub code: ScheduledItemErrorCode,
    pub message: String,
}

impl Refused {
    pub fn new(code: ScheduledItemErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl From<Refusal> for Refused {
    fn from(refusal: Refusal) -> Self {
        use ScheduledItemErrorCode as Code;
        match refusal {
            Refusal::NotFound => Self::new(Code::NotFound, "No such item."),
            Refusal::NoFutureOccurrence => Self::new(
                Code::TriggerInPast,
                "The schedule has no time in the future.",
            ),
            Refusal::Finished => Self::new(Code::Finished, "This item is already over."),
            Refusal::InFlight => {
                Self::new(Code::InFlight, "This item is being delivered right now.")
            }
            Refusal::NothingToSnooze => Self::new(
                Code::NothingToSnooze,
                "Nothing of this item is waiting to be delivered.",
            ),
            Refusal::NotFinished => Self::new(
                Code::NotFinished,
                "Only items that are done, failed or cancelled can be deleted.",
            ),
        }
    }
}

/// `Ok(Err(_))` is a refusal with its code; `Err(_)` a failure.
pub type Checked<T> = Result<Result<T, Refused>, Report>;

fn refused_change<T>(change: Change<T>) -> Checked<T> {
    Ok(change?.map_err(Refused::from))
}

/// The zone new times are entered in: what the user's client reported, else
/// the deployment's default (the Teams send window's zone).
pub async fn entry_zone(
    app_state: &AppState,
    user_id: Uuid,
) -> Result<(Tz, TimeZoneSource), Report> {
    if let Some(zone) = user_time_zone(&app_state.db, &user_id).await? {
        return Ok((zone, TimeZoneSource::User));
    }
    Ok((default_zone(app_state), TimeZoneSource::DeploymentDefault))
}

pub fn default_zone(app_state: &AppState) -> Tz {
    app_state
        .config
        .integrations
        .ms_office
        .teams
        .bot
        .inactivity_nudge
        .send_window
        .time_zone_parsed()
        .unwrap_or(chrono_tz::UTC)
}

/// Whether this deployment delivers through the Teams chat at all.
pub fn teams_channel_available(app_state: &AppState) -> bool {
    app_state.config.scheduled_deliveries.enabled
        && app_state
            .scheduled_deliveries
            .channel(TEAMS_CHANNEL)
            .is_some()
}

/// Whether the Teams chat reaches the user: they need a personal chat with
/// the bot.
pub async fn teams_status(
    app_state: &AppState,
    user_id: Uuid,
) -> Result<DeliveryChannelStatus, Report> {
    if !teams_channel_available(app_state) {
        return Ok(DeliveryChannelStatus::Unavailable);
    }
    let personal = MsTeamsConversations::find()
        .filter(ms_teams_conversations::Column::UserId.eq(user_id))
        .filter(ms_teams_conversations::Column::ConversationType.eq("personal"))
        .one(&app_state.db)
        .await?;
    Ok(if personal.is_some() {
        DeliveryChannelStatus::Connected
    } else {
        DeliveryChannelStatus::NotSetUp
    })
}

async fn owns_chat(app_state: &AppState, user_id: Uuid, chat_id: Uuid) -> Result<bool, Report> {
    Ok(Chats::find_by_id(chat_id)
        .filter(chats::Column::OwnerUserId.eq(user_id.to_string()))
        .one(&app_state.db)
        .await?
        .is_some())
}

/// Check a request and turn it into an item whose times are read in `zone`.
pub async fn checked_input(
    app_state: &AppState,
    user_id: Uuid,
    request: ItemRequest,
    zone: Tz,
) -> Checked<ItemInput> {
    use ScheduledItemErrorCode as Code;
    if request.item_type != ScheduledItemType::Reminder {
        return Ok(Err(Refused::new(
            Code::TypeNotAvailable,
            "Scheduled tasks are not available yet.",
        )));
    }
    let name = request.name.trim().to_string();
    let message = request.message.trim().to_string();
    if name.is_empty() || message.is_empty() {
        return Ok(Err(Refused::new(
            Code::InvalidRequest,
            "A name and a message are required.",
        )));
    }
    if name.chars().count() > MAX_NAME_CHARS || message.chars().count() > MAX_MESSAGE_CHARS {
        return Ok(Err(Refused::new(
            Code::InvalidRequest,
            "The name or the message is too long.",
        )));
    }
    let trigger = match request.trigger.normalized() {
        Ok(trigger) => trigger,
        Err(reason) => return Ok(Err(Refused::new(Code::InvalidTrigger, reason))),
    };
    if request.channel != TEAMS_CHANNEL {
        return Ok(Err(Refused::new(
            Code::ChannelUnknown,
            "Unknown delivery channel.",
        )));
    }
    if let Some(chat_id) = request.linked_chat_id
        && !owns_chat(app_state, user_id, chat_id).await?
    {
        return Ok(Err(Refused::new(
            Code::LinkedChatNotFound,
            "The linked chat does not exist.",
        )));
    }
    match teams_status(app_state, user_id).await? {
        DeliveryChannelStatus::Connected => {}
        DeliveryChannelStatus::NotSetUp => {
            return Ok(Err(Refused::new(
                Code::ChannelNotSetUp,
                "Erato can't reach you in Teams yet. Open the Erato app in Teams once, then this channel works.",
            )));
        }
        DeliveryChannelStatus::Unavailable => {
            return Ok(Err(Refused::new(
                Code::ChannelUnavailable,
                "Delivery via Teams chat is not available here.",
            )));
        }
    }
    Ok(Ok(ItemInput {
        kind: REMINDER.to_string(),
        name,
        message,
        linked_chat_id: request.linked_chat_id,
        channel: request.channel,
        trigger,
        time_zone: zone,
    }))
}

/// Schedule an item, read in the user's entry zone. Refused, with nothing
/// stored, when a check fails or the user has the maximum number of
/// upcoming items.
pub async fn create_checked(
    app_state: &AppState,
    user_id: Uuid,
    request: ItemRequest,
    origin: Value,
) -> Checked<Model> {
    let (zone, _) = entry_zone(app_state, user_id).await?;
    let input = match checked_input(app_state, user_id, request, zone).await? {
        Ok(input) => input,
        Err(refused) => return Ok(Err(refused)),
    };
    let (upcoming, _) = super::counts(&app_state.db, user_id).await?;
    if upcoming >= MAX_ACTIVE_ITEMS {
        return Ok(Err(Refused::new(
            ScheduledItemErrorCode::LimitReached,
            "You have the maximum number of upcoming reminders. Cancel one first.",
        )));
    }
    refused_change(super::create(&app_state.db, user_id, input, origin).await)
}

/// Edit an item through the same checks. A schedule that is unchanged keeps
/// the item's zone; a changed one is read in the user's current zone.
pub async fn update_checked(
    app_state: &AppState,
    user_id: Uuid,
    item_id: Uuid,
    request: ItemRequest,
) -> Checked<Model> {
    let Some(existing) = super::get(&app_state.db, user_id, item_id).await? else {
        return Ok(Err(Refusal::NotFound.into()));
    };
    let existing = existing.item;
    let unchanged = request
        .trigger
        .clone()
        .normalized()
        .ok()
        .zip(super::trigger_of(&existing).ok())
        .is_some_and(|(requested, stored)| requested == stored);
    let zone = match super::zone_of(&existing) {
        Ok(zone) if unchanged => zone,
        _ => entry_zone(app_state, user_id).await?.0,
    };
    let input = match checked_input(app_state, user_id, request, zone).await? {
        Ok(input) => input,
        Err(refused) => return Ok(Err(refused)),
    };
    refused_change(super::update(&app_state.db, user_id, item_id, input).await)
}

/// End an item's series, as the page's and the cards' Cancel do.
pub async fn cancel_checked(app_state: &AppState, user_id: Uuid, item_id: Uuid) -> Checked<Model> {
    refused_change(super::cancel(&app_state.db, user_id, item_id).await)
}
