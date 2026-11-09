//! Reminders by chat: `create_reminder`, `list_reminders` and
//! `cancel_reminder`, offered to the model in the web chat and in Teams.
//!
//! They create, list and cancel the same items as the Scheduled page, through
//! the same checks, with origin `{"via": "chat"}`. A created reminder comes
//! back with a [`Confirmation`] rendered from the stored item, which the web
//! chat and the Teams bot both show as the confirmation card, so the user sees
//! what was stored rather than the model's paraphrase of it.

use super::recurrence::{Trigger, local_time, resolve_local};
use super::wording;
use super::{
    DisplayStatus, ItemRequest, ItemView, MAX_ACTIVE_ITEMS, Model, Refused, ScheduledItemErrorCode,
    ScheduledItemType, cancel_checked, create_checked, entry_zone, owned_chats, owns_chat,
};
use crate::models::chat::chat_title;
use crate::models::user_preference::user_time_zone;
use crate::ms_teams_bot::nudge::CHANNEL as TEAMS_CHANNEL;
use crate::services::text_language::{self, Lang};
use crate::state::AppState;
use chrono::{DateTime, Duration, NaiveDateTime, SubsecRound, Timelike, Utc};
use chrono_tz::Tz;
use eyre::{Report, eyre};
use genai::chat::{Tool, ToolName};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;

pub const CREATE_REMINDER: &str = "create_reminder";
pub const LIST_REMINDERS: &str = "list_reminders";
pub const CANCEL_REMINDER: &str = "cancel_reminder";
pub const TOOL_NAMES: [&str; 3] = [CREATE_REMINDER, LIST_REMINDERS, CANCEL_REMINDER];
/// Where the web app's Scheduled page lives, relative to the app's base URL.
pub const SCHEDULED_PATH: &str = "/scheduled";
/// The longest `in` a reminder may be set for: a year.
const MAX_IN_MINUTES: i64 = 365 * 24 * 60;

pub fn is_reminder_tool(name: &str) -> bool {
    TOOL_NAMES.contains(&name)
}

/// Whether the tool only reads. Listing changes nothing; creating and
/// cancelling change what the user gets.
pub fn is_read_only(name: &str) -> bool {
    name == LIST_REMINDERS
}

/// The offered tools among `names`. Their descriptions name the zone local
/// times are read in and today's date there, since the system prompt is
/// written once per chat and its date goes stale.
pub fn tools(names: &[&str], zone: Tz, now: DateTime<Utc>, omit_strict: bool) -> Vec<Tool> {
    names
        .iter()
        .filter_map(|name| {
            let (description, schema) = match *name {
                CREATE_REMINDER => (create_description(zone, now), create_schema()),
                LIST_REMINDERS => (
                    format!(
                        "List the user's upcoming reminders (at most {MAX_ACTIVE_ITEMS}) with their ids, names, messages, when each arrives next and the chat it links to. Use it when the user asks which reminders they have, and to find a reminder's id before cancelling it."
                    ),
                    json!({"type": "object", "properties": {}, "additionalProperties": false}),
                ),
                CANCEL_REMINDER => (
                    "Cancel one of the user's upcoming reminders by its id from list_reminders; a repeating one stops for good. When several reminders could be meant, ask the user which one first.".to_string(),
                    json!({
                        "type": "object",
                        "properties": {
                            "reminder_id": {
                                "type": "string",
                                "description": "The reminder's id, as list_reminders returns it.",
                            },
                        },
                        "required": ["reminder_id"],
                        "additionalProperties": false,
                    }),
                ),
                _ => return None,
            };
            Some(Tool {
                name: ToolName::Custom((*name).to_string()),
                description: Some(description),
                schema: Some(schema),
                strict: if omit_strict { None } else { Some(false) },
                config: None,
                custom_format: None,
                cache_control: None,
                eager_input_streaming: None,
            })
        })
        .collect()
}

fn create_description(zone: Tz, now: DateTime<Utc>) -> String {
    format!(
        "Schedule a reminder for the user. At the chosen time the user gets its name and message in their Teams chat with this assistant; nothing is run then. Times are the user's local time in {zone}, where today is {today}. \
Ask the user instead of guessing when the date or time is unclear, such as \"next week\" without a day or \"at 8\" without morning or evening. \
Defaults: a day without a time means 09:00; \"later\" (\"später\") means in 2 hours (kind `in`, 120 minutes); \"tonight\" (\"heute Abend\") means 18:00 today. \
The reminder links back to this chat. Say that a reminder is set only after this tool succeeded: the user then sees a confirmation card with the stored time, a Cancel button and a link to the Scheduled page, so confirm in one short sentence without repeating the details. When it is refused, tell the user why.",
        zone = zone.name(),
        today = wording::today_for_model(zone, now),
    )
}

fn create_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "A short title, shown in the user's Scheduled list and as the title when it arrives; at most 200 characters.",
            },
            "message": {
                "type": "string",
                "description": "What the user wants to be reminded of, written so it reads well on its own when it arrives; at most 4000 characters.",
            },
            "trigger": {
                "type": "object",
                "description": "When it arrives, in the user's local time.",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["once", "in", "repeat"],
                        "description": "`once`: on `date` at `time`. `in`: `minutes` from now. `repeat`: on a repeating schedule.",
                    },
                    "date": {"type": "string", "description": "once: the local date, YYYY-MM-DD."},
                    "time": {"type": "string", "description": "once and repeat: the local time of day, HH:MM in 24-hour time."},
                    "minutes": {"type": "integer", "minimum": 1, "maximum": MAX_IN_MINUTES, "description": "in: how many minutes from now."},
                    "frequency": {
                        "type": "string",
                        "enum": ["daily", "weekdays", "weekly", "monthly"],
                        "description": "repeat: every day, Monday to Friday, on the given `weekdays`, or every month on the day of `starts_on`.",
                    },
                    "weekdays": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]},
                        "description": "repeat, weekly: the days.",
                    },
                    "starts_on": {"type": "string", "description": "repeat: the first day it may happen, YYYY-MM-DD; today when left out."},
                    "ends": {
                        "type": "object",
                        "description": "repeat: when it stops; never when left out.",
                        "properties": {
                            "kind": {"type": "string", "enum": ["never", "on_date", "after_count"]},
                            "date": {"type": "string", "description": "on_date: the last day it may happen, YYYY-MM-DD."},
                            "count": {"type": "integer", "minimum": 1, "description": "after_count: how many times in all."},
                        },
                        "required": ["kind"],
                    },
                },
                "required": ["kind"],
            },
        },
        "required": ["name", "message", "trigger"],
        "additionalProperties": false,
    })
}

/// The request a call runs in.
#[derive(Debug, Clone, Copy)]
pub struct CallContext<'a> {
    pub user_id: Uuid,
    pub chat_id: Uuid,
    pub message_id: Uuid,
    /// `X-Erato-Platform` of the request, e.g. the Teams bot's.
    pub platform: Option<&'a str>,
}

/// The tool's answer: `output` is stored on the tool row and sent to the
/// model. A refusal is not a failure of the call, but it did not succeed.
#[derive(Debug, Clone)]
pub struct CallResult {
    pub succeeded: bool,
    pub output: Value,
}

impl CallResult {
    fn refused(refused: Refused) -> Self {
        Self {
            succeeded: false,
            output: refused_output(&refused),
        }
    }
}

fn refused_output(refused: &Refused) -> Value {
    json!({"status": "refused", "code": refused.code, "error": refused.message})
}

/// Run one reminder tool call for the user of `call`.
pub async fn run(
    app_state: &AppState,
    call: CallContext<'_>,
    name: &str,
    arguments: &Value,
) -> Result<CallResult, Report> {
    match name {
        CREATE_REMINDER => create(app_state, call, arguments).await,
        LIST_REMINDERS => list(app_state, call.user_id).await,
        CANCEL_REMINDER => cancel(app_state, call.user_id, arguments).await,
        other => Err(eyre!("`{other}` is not a reminder tool")),
    }
}

#[derive(Debug, Deserialize)]
struct CreateArguments {
    name: String,
    message: String,
    trigger: TriggerArguments,
}

#[derive(Debug, Deserialize)]
struct TriggerArguments {
    kind: String,
    #[serde(default)]
    date: Option<Value>,
    #[serde(default)]
    time: Option<Value>,
    #[serde(default)]
    minutes: Option<i64>,
    #[serde(default)]
    frequency: Option<Value>,
    #[serde(default)]
    weekdays: Option<Value>,
    #[serde(default)]
    starts_on: Option<Value>,
    #[serde(default)]
    ends: Option<Value>,
}

impl TriggerArguments {
    /// The item's trigger, its times local to `zone`. `in` becomes a one-off
    /// at the next whole minute after the delay.
    fn resolve(self, zone: Tz, now: DateTime<Utc>) -> Result<Trigger, String> {
        let trigger = match self.kind.as_str() {
            "in" => {
                let minutes = self
                    .minutes
                    .filter(|minutes| (1..=MAX_IN_MINUTES).contains(minutes))
                    .ok_or_else(|| {
                        format!("`in` needs `minutes` between 1 and {MAX_IN_MINUTES}")
                    })?;
                let due = now + Duration::minutes(minutes);
                let at = local_time(zone, due);
                let at = if at.second() > 0 || at.nanosecond() > 0 {
                    at.trunc_subsecs(0).with_second(0).unwrap_or(at) + Duration::minutes(1)
                } else {
                    at
                };
                // The stored local time keeps no offset, and one in the
                // repeated autumn hour reads as its first instance: an hour
                // early, or in the past. Such a time moves to the end of
                // that hour, so `in` is never early.
                let at = (0..=24 * 60)
                    .map(|minute| at + Duration::minutes(minute))
                    .find(|local| resolve_local(zone, *local) >= due)
                    .unwrap_or(at);
                json!({"kind": "once", "date": at.date(), "time": at.format("%H:%M").to_string()})
            }
            "once" => {
                let (Some(date), Some(time)) = (self.date, self.time) else {
                    return Err("`once` needs `date` and `time`".into());
                };
                json!({"kind": "once", "date": date, "time": time})
            }
            "repeat" => json!({
                "kind": "repeat",
                "frequency": self.frequency,
                "weekdays": self.weekdays.unwrap_or_else(|| json!([])),
                "time": self.time,
                "starts_on": self.starts_on.unwrap_or_else(|| json!(local_time(zone, now).date())),
                "ends": self.ends.unwrap_or_else(|| json!({"kind": "never"})),
            }),
            other => return Err(format!("unknown trigger kind `{other}`")),
        };
        serde_json::from_value(trigger).map_err(|error| error.to_string())
    }
}

async fn create(
    app_state: &AppState,
    call: CallContext<'_>,
    arguments: &Value,
) -> Result<CallResult, Report> {
    let arguments: CreateArguments = match serde_json::from_value(arguments.clone()) {
        Ok(arguments) => arguments,
        Err(error) => {
            return Ok(CallResult::refused(Refused::new(
                ScheduledItemErrorCode::InvalidRequest,
                format!("The arguments do not fit the tool: {error}"),
            )));
        }
    };
    let (zone, _) = entry_zone(app_state, call.user_id).await?;
    let trigger = match arguments.trigger.resolve(zone, Utc::now()) {
        Ok(trigger) => trigger,
        Err(reason) => {
            return Ok(CallResult::refused(Refused::new(
                ScheduledItemErrorCode::InvalidTrigger,
                reason,
            )));
        }
    };
    // A chat shared with the user is not theirs to link.
    let linked_chat_id = owns_chat(&app_state.db, call.user_id, call.chat_id)
        .await?
        .then_some(call.chat_id);
    let request = ItemRequest {
        item_type: ScheduledItemType::Reminder,
        name: arguments.name,
        message: arguments.message,
        linked_chat_id,
        channel: TEAMS_CHANNEL.to_string(),
        trigger,
    };
    let origin = json!({
        "via": "chat",
        "chat_id": call.chat_id,
        "message_id": call.message_id,
        "platform": call.platform,
    });
    let item = match create_checked(app_state, call.user_id, request, origin).await? {
        Ok(item) => item,
        Err(refused) if refused.code == ScheduledItemErrorCode::LimitReached => {
            let mut output = refused_output(&refused);
            output["upcoming"] = upcoming(app_state, call.user_id).await?;
            return Ok(CallResult {
                succeeded: false,
                output,
            });
        }
        Err(refused) => return Ok(CallResult::refused(refused)),
    };
    // The reminder is stored and will arrive, so a failure from here on must
    // not read as a failed create.
    let output = match created_output(app_state, call.user_id, &item).await {
        Ok(output) => output,
        Err(error) => {
            tracing::warn!(%error, item_id = %item.id, "A reminder was created but could not be described");
            json!({"status": "created", "reminder": {"id": item.id, "name": item.name}})
        }
    };
    Ok(CallResult {
        succeeded: true,
        output,
    })
}

async fn created_output(
    app_state: &AppState,
    user_id: Uuid,
    item: &Model,
) -> Result<Value, Report> {
    let view = super::get(&app_state.db, user_id, item.id)
        .await?
        .ok_or_else(|| eyre!("the reminder just created is gone"))?;
    let lang = stored_language(app_state, user_id).await?;
    let user_zone = user_time_zone(&app_state.db, &user_id).await?;
    let now = Utc::now();
    let titles = chat_titles(app_state, user_id, &[&view]).await?;
    Ok(json!({
        "status": "created",
        "reminder": summary(&view, &titles, user_zone, now, lang)?,
        "confirmation": Confirmation::of(&view, user_zone, now, lang)?,
    }))
}

async fn list(app_state: &AppState, user_id: Uuid) -> Result<CallResult, Report> {
    let (zone, _) = entry_zone(app_state, user_id).await?;
    Ok(CallResult {
        succeeded: true,
        output: json!({
            "status": "ok",
            "time_zone": zone.name(),
            "max_upcoming": MAX_ACTIVE_ITEMS,
            "reminders": upcoming(app_state, user_id).await?,
        }),
    })
}

#[derive(Debug, Deserialize)]
struct CancelArguments {
    reminder_id: String,
}

async fn cancel(
    app_state: &AppState,
    user_id: Uuid,
    arguments: &Value,
) -> Result<CallResult, Report> {
    let Some(item_id) = serde_json::from_value::<CancelArguments>(arguments.clone())
        .ok()
        .and_then(|arguments| Uuid::parse_str(arguments.reminder_id.trim()).ok())
    else {
        return Ok(CallResult::refused(Refused::new(
            ScheduledItemErrorCode::NotFound,
            "No reminder has this id; list_reminders gives the ids.",
        )));
    };
    Ok(match cancel_checked(app_state, user_id, item_id).await? {
        Ok(item) => CallResult {
            succeeded: true,
            output: json!({"status": "cancelled", "reminder": {"id": item.id, "name": item.name}}),
        },
        Err(refused) => CallResult::refused(refused),
    })
}

async fn stored_language(app_state: &AppState, user_id: Uuid) -> Result<Lang, Report> {
    text_language::of_user(
        &app_state.db,
        user_id,
        None,
        &app_state.config.i18n.language.default_language,
    )
    .await
}

/// The user's upcoming reminders, the next one first.
async fn upcoming(app_state: &AppState, user_id: Uuid) -> Result<Value, Report> {
    let mut views = super::list(&app_state.db, user_id, false, 0).await?;
    let now = Utc::now();
    views.sort_by_key(|view| super::next_occurrence(view, now));
    let lang = stored_language(app_state, user_id).await?;
    let user_zone = user_time_zone(&app_state.db, &user_id).await?;
    let titles = chat_titles(app_state, user_id, &views.iter().collect::<Vec<_>>()).await?;
    let summaries = views
        .iter()
        .map(|view| summary(view, &titles, user_zone, now, lang))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!(summaries))
}

async fn chat_titles(
    app_state: &AppState,
    user_id: Uuid,
    views: &[&ItemView],
) -> Result<HashMap<Uuid, String>, Report> {
    let ids = views
        .iter()
        .filter_map(|view| view.item.linked_chat_id)
        .collect();
    Ok(owned_chats(&app_state.db, user_id, ids)
        .await?
        .into_values()
        .map(|chat| {
            let title = chat_title(
                chat.title_by_user_provided.as_deref(),
                chat.title_by_summary.as_deref(),
            )
            .unwrap_or("")
            .to_string();
            (chat.id, title)
        })
        .collect())
}

#[derive(Debug, Serialize)]
struct LinkedChatSummary {
    id: Uuid,
    title: String,
}

/// A reminder as the model reads it.
#[derive(Debug, Serialize)]
struct ReminderSummary {
    id: Uuid,
    name: String,
    message: String,
    status: DisplayStatus,
    /// When it arrives next, in the user's language.
    when: Option<String>,
    /// The wall-clock time in `time_zone`.
    next_local: Option<NaiveDateTime>,
    repeats: Option<String>,
    time_zone: String,
    linked_chat: Option<LinkedChatSummary>,
}

fn summary(
    view: &ItemView,
    titles: &HashMap<Uuid, String>,
    user_zone: Option<Tz>,
    now: DateTime<Utc>,
    lang: Lang,
) -> Result<ReminderSummary, Report> {
    let item = &view.item;
    let zone = super::zone_of(item)?;
    let next = super::next_occurrence(view, now);
    Ok(ReminderSummary {
        id: item.id,
        name: item.name.clone(),
        message: item.message.clone(),
        status: super::display_status(view, now),
        when: next.map(|at| wording::exact_when(at, zone, user_zone, now, lang)),
        next_local: next.map(|at| local_time(zone, at)),
        repeats: match super::trigger_of(item)? {
            Trigger::Repeat(rule) => Some(wording::repeat_pattern(&rule, lang)),
            Trigger::Once { .. } => None,
        },
        time_zone: item.time_zone.clone(),
        linked_chat: item.linked_chat_id.and_then(|id| {
            titles.get(&id).map(|title| LinkedChatSummary {
                id,
                title: title.clone(),
            })
        }),
    })
}

/// The confirmation card after a reminder was scheduled, the same on every
/// channel: the stored name and time in the user's language, where it
/// arrives, Cancel and Open in Scheduled. No Edit: editing happens on the
/// Scheduled page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Confirmation {
    pub item_id: Uuid,
    /// `en` or `de`, the language the texts are in.
    pub language: String,
    pub heading: String,
    pub name: String,
    /// When it arrives next, or for an item that is over, when it was due.
    pub when: Option<String>,
    /// A repeating reminder's schedule.
    pub repeats: Option<String>,
    pub delivery: String,
    pub cancel_label: String,
    pub open_scheduled_label: String,
    /// The Scheduled page, relative to the app's base URL.
    pub scheduled_path: String,
}

impl Confirmation {
    pub fn of(
        view: &ItemView,
        user_zone: Option<Tz>,
        now: DateTime<Utc>,
        lang: Lang,
    ) -> Result<Self, Report> {
        let item = &view.item;
        let zone = super::zone_of(item)?;
        Ok(Self {
            item_id: item.id,
            language: lang.code().to_string(),
            heading: wording::confirmation_heading(lang).to_string(),
            name: item.name.clone(),
            when: super::next_occurrence(view, now)
                .or(item.occurrence_at.map(|at| at.with_timezone(&Utc)))
                .map(|at| wording::exact_when(at, zone, user_zone, now, lang)),
            repeats: match super::trigger_of(item)? {
                Trigger::Repeat(rule) => {
                    Some(wording::capitalized(&wording::repeat_pattern(&rule, lang)))
                }
                Trigger::Once { .. } => None,
            },
            delivery: wording::delivery_line(&item.channel, lang),
            cancel_label: wording::cancel_button(lang).to_string(),
            open_scheduled_label: wording::open_scheduled_button(lang).to_string(),
            scheduled_path: SCHEDULED_PATH.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    const BERLIN: Tz = chrono_tz::Europe::Berlin;

    fn utc(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn trigger(value: Value) -> Result<Trigger, String> {
        let arguments: TriggerArguments = serde_json::from_value(value).unwrap();
        // Sunday 8 Nov 2026, 14:00:20 in Berlin.
        arguments.resolve(BERLIN, utc("2026-11-08T13:00:20Z"))
    }

    #[test]
    fn later_is_the_next_whole_minute_after_the_delay() {
        assert_eq!(
            trigger(json!({"kind": "in", "minutes": 120})).unwrap(),
            serde_json::from_value::<Trigger>(
                json!({"kind": "once", "date": "2026-11-08", "time": "16:01"})
            )
            .unwrap()
        );
        assert!(trigger(json!({"kind": "in", "minutes": 0})).is_err());
        assert!(trigger(json!({"kind": "in"})).is_err());
    }

    #[test]
    fn later_in_the_repeated_autumn_hour_is_never_early() {
        // Berlin goes back from 03:00 CEST to 02:00 CET at 01:00Z.
        let due = |now: &str, minutes: i64| {
            let arguments: TriggerArguments =
                serde_json::from_value(json!({"kind": "in", "minutes": minutes})).unwrap();
            let Trigger::Once { date, time } = arguments.resolve(BERLIN, utc(now)).unwrap() else {
                panic!("not a one-off");
            };
            resolve_local(BERLIN, date.and_time(time.naive()))
        };
        // 02:30 CET, whose first instance is 00:30Z.
        assert_eq!(
            due("2026-10-24T23:30:00Z", 120),
            utc("2026-10-25T02:00:00Z")
        );
        // 02:15 CET, whose first instance is before now.
        assert_eq!(due("2026-10-25T00:45:00Z", 30), utc("2026-10-25T02:00:00Z"));
        assert_eq!(due("2026-10-25T00:10:00Z", 20), utc("2026-10-25T00:30:00Z"));
    }

    #[test]
    fn a_one_off_and_a_repeat_read_as_the_forms_trigger() {
        assert_eq!(
            trigger(json!({"kind": "once", "date": "2026-11-13", "time": "10:00"})).unwrap(),
            serde_json::from_value::<Trigger>(
                json!({"kind": "once", "date": "2026-11-13", "time": "10:00"})
            )
            .unwrap()
        );
        let Trigger::Repeat(rule) = trigger(json!({
            "kind": "repeat", "frequency": "weekly", "weekdays": ["fri", "mon"], "time": "09:00",
        }))
        .unwrap()
        .normalized()
        .unwrap() else {
            panic!("not a repeat");
        };
        assert_eq!(
            rule.starts_on,
            NaiveDate::from_ymd_opt(2026, 11, 8).unwrap()
        );
        assert_eq!(rule.ends, super::super::recurrence::RepeatEnd::Never);
        assert_eq!(rule.weekdays.len(), 2);
        assert!(trigger(json!({"kind": "once", "date": "2026-11-13"})).is_err());
        assert!(trigger(json!({"kind": "once", "date": "Friday", "time": "10:00"})).is_err());
        assert!(trigger(json!({"kind": "once", "date": "2026-11-13", "time": "10"})).is_err());
        assert!(trigger(json!({"kind": "repeat", "time": "09:00"})).is_err());
        assert!(trigger(json!({"kind": "tomorrow"})).is_err());
    }

    #[test]
    fn the_tools_tell_the_model_the_zone_and_today() {
        let now = utc("2026-11-08T23:30:00Z");
        let offered = tools(&TOOL_NAMES, BERLIN, now, false);
        assert_eq!(offered.len(), 3);
        let create = offered[0].description.as_deref().unwrap();
        assert!(create.contains("Europe/Berlin"), "{create}");
        assert!(create.contains("Monday, 2026-11-09"), "{create}");
        assert_eq!(tools(&[LIST_REMINDERS], BERLIN, now, true)[0].strict, None);
        assert!(is_read_only(LIST_REMINDERS));
        assert!(!is_read_only(CREATE_REMINDER) && !is_read_only(CANCEL_REMINDER));
    }
}
