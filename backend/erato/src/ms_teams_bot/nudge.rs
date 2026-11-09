//! The inactivity nudge: a "Did you know…?" tip for users who have not used
//! Erato for a while, delivered to their personal chat with the bot (Jira
//! PAI-950). The first producer and the first real channel on the
//! scheduled-deliveries foundation.
//!
//! Erato-side like `host`: the producer reads the users, chats, preferences
//! and conversation tables directly, and the channel sends through the bot's
//! Connector to the user's `personal` conversation row rather than to the
//! current chat's conversation.

use super::TeamsBot;
use super::cards;
use super::connector::ActivityError;
use super::host::Host;
use super::render;
use super::texts::Msg;
use crate::db::entity::chats;
use crate::db::entity::prelude::MsTeamsConversations;
use crate::db::entity::scheduled_deliveries::{CreatedBy, Model};
use crate::db::entity::scheduled_items::Model as ScheduledItem;
use crate::db::entity::{ms_teams_conversations, users};
use crate::distribution::runtime::ReloadableAppState;
use crate::models::user_preference::{set_teams_nudges_opt_out, user_time_zone};
use crate::query_metrics::named_statement_from_sql_and_values;
use crate::services::scheduled_deliveries::{
    DeliveryAction, DeliveryChannel, DeliveryContent, DeliveryLink, DeliveryOutcome,
    DeliveryProducer, DeliveryRegistry, NewDelivery, ResolvedContent, StillDue, count_delivered,
    find, schedule_once, store_action_token,
};
use crate::services::scheduled_items::{
    self, CONTINUE_COMMAND, Change, DONE_COMMAND, SNOOZE_COMMAND, SnoozeChoice, TOMORROW_COMMAND,
};
use crate::services::text_language;
use chrono::{
    DateTime, Datelike, Duration as ChronoDuration, FixedOffset, TimeZone, Timelike, Utc,
};
use chrono_tz::Tz;
use erato_config::config::{TeamsInactivityNudgeConfig, TeamsNudgeSendWindowConfig};
use eyre::{Report, eyre};
use sea_orm::prelude::Uuid;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, FromQueryResult,
    QueryFilter, QueryOrder, Statement,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

#[cfg(test)]
mod delivery_tests;

pub const KIND: &str = "inactivity_nudge";
pub const CHANNEL: &str = "teams_personal";
/// `data.action` of buttons on delivered cards.
pub const ACTION: &str = "erato_delivery_action";
pub const OPT_OUT_COMMAND: &str = "opt_out";
/// The producer rule runs at most this often per replica; the dedupe key
/// keeps several replicas from scheduling the same tip.
const PRODUCE_INTERVAL: Duration = Duration::from_secs(60 * 60);

fn statement(id: &'static str, sql: &str, values: Vec<sea_orm::Value>) -> Statement {
    named_statement_from_sql_and_values(DbBackend::Postgres, id, sql, values)
}

/// Register the Teams channel and the nudge producer. The producer comes
/// with the bot rather than with `inactivity_nudge.enabled`: its settings are
/// reloadable (`ReloadableAppState::teams_nudge`), so an admin can switch the
/// nudge on without a restart, and a replica only claims the kinds it has a
/// producer for, so rows created before the nudge was switched off are
/// cancelled at send time rather than left pending.
pub fn register(
    registry: &mut DeliveryRegistry,
    bot: &Arc<TeamsBot>,
    reloadable: Arc<RwLock<ReloadableAppState>>,
) {
    registry.register_channel(Arc::new(TeamsPersonalChannel { bot: bot.clone() }));
    registry.register_producer(Arc::new(InactivityNudgeProducer::reloadable(
        reloadable,
        &bot.settings.app_name,
        bot.settings.public_base_url.as_deref(),
        &bot.settings.default_language,
    )));
}

/// When tips may be sent, in the deployment's time zone.
#[derive(Debug, Clone)]
pub struct SendWindow {
    weekdays: [bool; 7],
    start_hour: u32,
    end_hour: u32,
    time_zone: Tz,
}

impl SendWindow {
    pub fn from_config(config: &TeamsNudgeSendWindowConfig) -> Result<Self, Report> {
        config.validate()?;
        Ok(Self {
            weekdays: config.weekday_set()?,
            start_hour: u32::from(config.start_hour),
            end_hour: u32::from(config.end_hour),
            time_zone: config.time_zone_parsed()?,
        })
    }

    /// The earliest time at or after `from` inside the window.
    pub fn next_slot(&self, from: DateTime<Utc>) -> DateTime<Utc> {
        let local = from.with_timezone(&self.time_zone);
        for offset in 0..14 {
            let day = local.date_naive() + ChronoDuration::days(offset);
            if !self.weekdays[day.weekday().num_days_from_monday() as usize] {
                continue;
            }
            if offset == 0 {
                let hour = local.hour();
                if hour >= self.start_hour && hour < self.end_hour {
                    return from;
                }
                if hour >= self.end_hour {
                    continue;
                }
            }
            // A start inside a DST gap is pushed to the next representable
            // hour rather than dropped.
            for hour in self.start_hour..self.end_hour {
                if let Some(start) = day
                    .and_hms_opt(hour, 0, 0)
                    .and_then(|start| self.time_zone.from_local_datetime(&start).earliest())
                {
                    return start.with_timezone(&Utc);
                }
            }
        }
        from
    }
}

/// The nudge's settings as the producer uses them, parsed from the section.
#[derive(Debug, Clone)]
pub struct NudgeSettings {
    enabled: bool,
    inactive_after: Duration,
    repeat: bool,
    window: SendWindow,
    tips: Vec<String>,
    /// Lower-cased; empty means everyone.
    pilot_users: Vec<String>,
    max_per_run: u32,
}

impl NudgeSettings {
    pub fn from_config(config: &TeamsInactivityNudgeConfig) -> Result<Self, Report> {
        Ok(Self {
            enabled: config.enabled,
            inactive_after: config.inactive_after_duration()?,
            repeat: config.repeat,
            window: SendWindow::from_config(&config.send_window)?,
            tips: config
                .tips
                .iter()
                .map(|tip| tip.trim().to_string())
                .collect(),
            pilot_users: config
                .pilot_users
                .iter()
                .map(|email| email.trim().to_ascii_lowercase())
                .filter(|email| !email.is_empty())
                .collect(),
            max_per_run: config.max_per_run.max(1),
        })
    }

    pub fn window(&self) -> &SendWindow {
        &self.window
    }

    /// The tip a user who has already received `delivered` tips gets next;
    /// `None` without tips, which validation refuses for an enabled nudge.
    pub fn tip_for(&self, delivered: u64) -> Option<&str> {
        if self.tips.is_empty() {
            return None;
        }
        Some(&self.tips[(delivered % self.tips.len() as u64) as usize])
    }

    fn pilot_filter(&self) -> String {
        self.pilot_users.join(",")
    }
}

/// Where the producer reads its settings, on every use.
enum SettingsSource {
    /// A running server: the section in the reloadable state, which a
    /// configuration reload (an admin-panel change, say) replaces.
    Reloadable(Arc<RwLock<ReloadableAppState>>),
    /// Tests and tools: one fixed section.
    Fixed(Arc<NudgeSettings>),
}

pub struct InactivityNudgeProducer {
    settings: SettingsSource,
    app_name: String,
    public_base_url: Option<String>,
    /// For users without a stored language. The tip itself is as the admin
    /// entered it; only the card around it follows the user's language.
    default_language: String,
    last_run: Mutex<Option<Instant>>,
}

#[derive(Debug, FromQueryResult)]
struct Candidate {
    user_id: Uuid,
    last_activity: DateTime<FixedOffset>,
    sequence: i32,
}

#[derive(Debug, FromQueryResult)]
struct ActivityRow {
    last_activity: DateTime<FixedOffset>,
    email: Option<String>,
    personal_conversations: i64,
    opted_out: bool,
}

impl InactivityNudgeProducer {
    /// A producer with one fixed section, for tests and tools; the section
    /// must list at least one tip.
    pub fn from_config(
        config: &TeamsInactivityNudgeConfig,
        app_name: &str,
        public_base_url: Option<&str>,
        default_language: &str,
    ) -> Result<Self, Report> {
        if config.tips.is_empty() {
            return Err(eyre!("the inactivity nudge needs at least one tip"));
        }
        Ok(Self::new(
            SettingsSource::Fixed(Arc::new(NudgeSettings::from_config(config)?)),
            app_name,
            public_base_url,
            default_language,
        ))
    }

    /// The running server's producer, which reads the section from the
    /// reloadable state on every use.
    pub fn reloadable(
        reloadable: Arc<RwLock<ReloadableAppState>>,
        app_name: &str,
        public_base_url: Option<&str>,
        default_language: &str,
    ) -> Self {
        Self::new(
            SettingsSource::Reloadable(reloadable),
            app_name,
            public_base_url,
            default_language,
        )
    }

    fn new(
        settings: SettingsSource,
        app_name: &str,
        public_base_url: Option<&str>,
        default_language: &str,
    ) -> Self {
        Self {
            settings,
            app_name: app_name.to_string(),
            public_base_url: public_base_url.map(|url| url.trim_end_matches('/').to_string()),
            default_language: default_language.to_string(),
            last_run: Mutex::new(None),
        }
    }

    /// The settings in force now. A reload validates the section before it
    /// replaces the previous one, so a parse failure here is a bug rather
    /// than a configuration error.
    pub async fn settings(&self) -> Result<Arc<NudgeSettings>, Report> {
        match &self.settings {
            SettingsSource::Fixed(settings) => Ok(settings.clone()),
            SettingsSource::Reloadable(reloadable) => {
                let section = reloadable.read().await.teams_nudge.clone();
                Ok(Arc::new(NudgeSettings::from_config(&section)?))
            }
        }
    }

    /// The rule with the settings in force now; see `schedule_with`.
    pub async fn schedule_due(&self, db: &DatabaseConnection) -> Result<usize, Report> {
        let settings = self.settings().await?;
        self.schedule_with(&settings, db).await
    }

    /// The rule, without the hourly gate: one pending row per user whose last
    /// chat activity (or, without any chat, whose account) is older than
    /// `inactive_after`, who can be reached in a personal Teams chat, is in
    /// the pilot when one is configured, and has not opted out. The dedupe
    /// key names the inactivity period (last activity plus, with `repeat`,
    /// the number of intervals elapsed), so a period is nudged once and a new
    /// period begins only when the user is active again. At least one
    /// interval lies between two tips for the same user whatever the sequence
    /// says, so enabling `repeat` after a long silence does not catch up in a
    /// burst.
    ///
    /// Activity is the newest message in a chat the user owns, or the chat's
    /// creation when it has none: `chats.updated_at` also moves on
    /// housekeeping writes such as archiving, which must not reset a period.
    async fn schedule_with(
        &self,
        settings: &NudgeSettings,
        db: &DatabaseConnection,
    ) -> Result<usize, Report> {
        let candidates = Candidate::find_by_statement(statement(
            "teams_nudge.candidates",
            "WITH candidates AS (
                 SELECT u.id AS user_id,
                        COALESCE(a.last_activity, u.created_at) AS last_activity
                 FROM users u
                 JOIN LATERAL (
                     SELECT max(GREATEST(c.created_at,
                                (SELECT max(m.created_at) FROM messages m WHERE m.chat_id = c.id))) AS last_activity
                     FROM chats c WHERE c.owner_user_id = u.id::text
                 ) a ON true
                 WHERE EXISTS (
                         SELECT 1 FROM ms_teams_conversations t
                         WHERE t.user_id = u.id AND t.conversation_type = 'personal')
                   AND NOT EXISTS (
                         SELECT 1 FROM user_preferences p
                         WHERE p.user_id = u.id AND p.teams_nudges_opted_out_at IS NOT NULL)
                   AND ($2 = '' OR lower(u.email) = ANY(string_to_array($2, ',')))
             ), due AS (
                 SELECT user_id, last_activity,
                        CASE WHEN $4 THEN
                            floor(extract(epoch FROM (now() - last_activity)) / $1::double precision)::int
                        ELSE 1 END AS sequence
                 FROM candidates
                 WHERE last_activity < now() - make_interval(secs => $1::double precision)
             )
             SELECT user_id, last_activity, sequence FROM due
             WHERE NOT EXISTS (
                 SELECT 1 FROM scheduled_deliveries d
                 WHERE d.user_id = due.user_id AND d.kind = $5
                   AND (d.origin->>'last_activity')::timestamptz >= due.last_activity
                   AND COALESCE((d.origin->>'sequence')::int, 1) >= due.sequence
             )
             AND NOT EXISTS (
                 SELECT 1 FROM scheduled_deliveries d
                 WHERE d.user_id = due.user_id AND d.kind = $5
                   AND d.state <> 'cancelled'
                   AND d.created_at > now() - make_interval(secs => $1::double precision)
             )
             ORDER BY last_activity ASC
             LIMIT $3",
            vec![
                settings.inactive_after.as_secs_f64().into(),
                settings.pilot_filter().into(),
                i64::from(settings.max_per_run).into(),
                settings.repeat.into(),
                KIND.into(),
            ],
        ))
        .all(db)
        .await?;

        let due_at = settings.window.next_slot(Utc::now());
        let mut created = 0;
        for candidate in candidates {
            let last_activity = candidate.last_activity.to_rfc3339();
            let row = schedule_once(
                db,
                NewDelivery {
                    user_id: candidate.user_id,
                    kind: KIND.to_string(),
                    due_at,
                    created_by: CreatedBy::System,
                    origin: json!({
                        "rule": KIND,
                        "last_activity": last_activity,
                        "sequence": candidate.sequence,
                    }),
                    payload: json!({}),
                    dedupe_key: Some(format!("{last_activity}#{}", candidate.sequence)),
                },
            )
            .await?;
            created += usize::from(row.is_some());
        }
        Ok(created)
    }

    async fn activity(
        &self,
        db: &DatabaseConnection,
        user_id: Uuid,
    ) -> Result<Option<ActivityRow>, Report> {
        Ok(ActivityRow::find_by_statement(statement(
            "teams_nudge.activity",
            "SELECT COALESCE(a.last_activity, u.created_at) AS last_activity,
                    u.email,
                    (SELECT count(*) FROM ms_teams_conversations t
                     WHERE t.user_id = u.id AND t.conversation_type = 'personal') AS personal_conversations,
                    EXISTS (SELECT 1 FROM user_preferences p
                            WHERE p.user_id = u.id AND p.teams_nudges_opted_out_at IS NOT NULL) AS opted_out
             FROM users u
             JOIN LATERAL (
                 SELECT max(GREATEST(c.created_at,
                            (SELECT max(m.created_at) FROM messages m WHERE m.chat_id = c.id))) AS last_activity
                 FROM chats c WHERE c.owner_user_id = u.id::text
             ) a ON true
             WHERE u.id = $1",
            vec![user_id.into()],
        ))
        .one(db)
        .await?)
    }
}

#[async_trait::async_trait]
impl DeliveryProducer for InactivityNudgeProducer {
    fn kind(&self) -> &str {
        KIND
    }

    async fn produce(&self, db: &DatabaseConnection) -> Result<usize, Report> {
        if self
            .last_run
            .lock()
            .expect("nudge producer gate")
            .is_some_and(|at| at.elapsed() < PRODUCE_INTERVAL)
        {
            return Ok(0);
        }
        let settings = self.settings().await?;
        // Switched off: nothing is scheduled and the hourly gate is left as
        // it is, so switching the nudge on takes effect on the next tick.
        if !settings.enabled {
            return Ok(0);
        }
        let result = self.schedule_with(&settings, db).await;
        // A failed run is retried on the next tick rather than in an hour.
        *self.last_run.lock().expect("nudge producer gate") = result.is_ok().then(Instant::now);
        result
    }

    async fn still_due(&self, db: &DatabaseConnection, row: &Model) -> Result<StillDue, Report> {
        let recorded = row
            .origin
            .get("last_activity")
            .and_then(Value::as_str)
            .map(DateTime::parse_from_rfc3339)
            .transpose()?
            .ok_or_else(|| eyre!("nudge row records no last activity"))?;
        let no = |reason: &str| StillDue::No {
            reason: reason.to_string(),
        };
        // The settings in force at send time, not at creation: a row created
        // before the nudge was switched off, or before the pilot list or the
        // window changed, follows the current settings.
        let settings = self.settings().await?;
        if !settings.enabled {
            return Ok(no("inactivity nudge switched off"));
        }
        let Some(activity) = self.activity(db, row.user_id).await? else {
            return Ok(no("user no longer exists"));
        };
        if activity.last_activity > recorded {
            return Ok(no("user became active"));
        }
        if activity.opted_out {
            return Ok(no("user opted out"));
        }
        if activity.personal_conversations == 0 {
            return Ok(no("no personal Teams conversation"));
        }
        if !settings.pilot_users.is_empty()
            && !activity
                .email
                .as_deref()
                .is_some_and(|email| settings.pilot_users.contains(&email.to_ascii_lowercase()))
        {
            return Ok(no("not a pilot user"));
        }
        let now = Utc::now();
        let slot = settings.window.next_slot(now);
        if slot > now {
            // Retries, reclaims and a restart that straddled the window's end
            // all come through here: the tip waits for the next slot instead
            // of going out late, and no attempt is used.
            return Ok(StillDue::Later { due_at: slot });
        }
        Ok(StillDue::Yes)
    }

    async fn resolve_content(
        &self,
        db: &DatabaseConnection,
        row: &Model,
    ) -> Result<ResolvedContent, Report> {
        let settings = self.settings().await?;
        let delivered = count_delivered(db, row.user_id, KIND).await?;
        let tip = settings
            .tip_for(delivered)
            .ok_or_else(|| eyre!("the inactivity nudge has no tips"))?
            .to_string();
        let token = Uuid::new_v4();
        store_action_token(db, row, token).await?;
        let lang = text_language::of_user(db, row.user_id, None, &self.default_language).await?;
        let app = [("app", self.app_name.as_str())];
        let links = self
            .public_base_url
            .iter()
            .map(|url| DeliveryLink {
                title: Msg::OpenApp.fill(lang, &app),
                url: url.clone(),
            })
            .collect();
        Ok(ResolvedContent {
            channel: CHANNEL.to_string(),
            content: DeliveryContent {
                title: None,
                text: tip,
                context: None,
                summary: Some(Msg::TipFrom.fill(lang, &app)),
                links,
                actions: vec![DeliveryAction {
                    title: Msg::DontRemindMe.text(lang).to_string(),
                    command: OPT_OUT_COMMAND.to_string(),
                    token: Some(token),
                }],
            },
        })
    }
}

/// A button press on a delivered card, as Teams sends it back.
#[derive(Debug, Deserialize)]
pub struct DeliverySubmit {
    action: String,
    pub delivery_id: Uuid,
    pub command: String,
    /// Absent on buttons that need no single-use guard.
    #[serde(default)]
    pub token: Option<Uuid>,
}

/// What a card button asks for. Parsed before the token is claimed, so an
/// unknown command cannot burn a single-use token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryCommand {
    /// A tip's "Don't remind me".
    OptOut,
    /// A reminder's Done: closes its card.
    Done,
    /// A reminder's Snooze 30 min or Tomorrow 9:00.
    Snooze(SnoozeChoice),
    /// A reminder's Continue here: its linked chat becomes the conversation's
    /// current chat. It guards nothing, so it has no token.
    ContinueChat,
}

impl DeliverySubmit {
    pub fn from_value(value: &Value) -> Option<Self> {
        let submit: Self = serde_json::from_value(value.clone()).ok()?;
        (submit.action == ACTION).then_some(submit)
    }

    pub fn command(&self) -> Option<DeliveryCommand> {
        match self.command.as_str() {
            OPT_OUT_COMMAND => Some(DeliveryCommand::OptOut),
            DONE_COMMAND => Some(DeliveryCommand::Done),
            SNOOZE_COMMAND => Some(DeliveryCommand::Snooze(SnoozeChoice::HalfAnHour)),
            TOMORROW_COMMAND => Some(DeliveryCommand::Snooze(SnoozeChoice::TomorrowMorning)),
            CONTINUE_COMMAND => Some(DeliveryCommand::ContinueChat),
            _ => None,
        }
    }
}

/// What a `/reminders` command (German `/erinnerungen`) asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemindersCommand {
    /// `on|off` (`an|aus`): tips on or off.
    Tips(bool),
    /// No argument: the list of upcoming reminders.
    List,
}

pub fn reminders_command(text: &str) -> Option<RemindersCommand> {
    let normalized = text.trim().to_lowercase();
    let mut words = normalized.split_whitespace();
    let command = words.next()?;
    if !matches!(command, "/reminders" | "/erinnerungen") {
        return None;
    }
    let argument = words.next();
    if words.next().is_some() {
        return None;
    }
    match (command, argument) {
        (_, None) => Some(RemindersCommand::List),
        ("/reminders", Some("on")) | ("/erinnerungen", Some("an")) => {
            Some(RemindersCommand::Tips(true))
        }
        ("/reminders", Some("off")) | ("/erinnerungen", Some("aus")) => {
            Some(RemindersCommand::Tips(false))
        }
        _ => None,
    }
}

/// The card a delivered message is rendered as: its text, link buttons and
/// single-use action buttons that name the delivery row.
pub fn delivery_card(content: &DeliveryContent, delivery_id: Uuid) -> Value {
    card_with_note(content, delivery_id, None)
}

/// The card once one of its buttons was used: the same text and links, only
/// the buttons without a token, and a line saying what happened.
pub fn settled_delivery_card(content: &DeliveryContent, delivery_id: Uuid, note: &str) -> Value {
    card_with_note(&without_token_buttons(content), delivery_id, Some(note))
}

fn without_token_buttons(content: &DeliveryContent) -> DeliveryContent {
    DeliveryContent {
        actions: content
            .actions
            .iter()
            .filter(|action| action.token.is_none())
            .cloned()
            .collect(),
        ..content.clone()
    }
}

fn card_with_note(content: &DeliveryContent, delivery_id: Uuid, note: Option<&str>) -> Value {
    let mut body = Vec::new();
    if let Some(title) = content.title.as_deref().filter(|title| !title.is_empty()) {
        body.push(json!({
            "type": "TextBlock", "text": title, "wrap": true,
            "weight": "Bolder", "size": "Medium",
        }));
    }
    if !content.text.is_empty() {
        body.push(json!({"type": "TextBlock", "text": content.text, "wrap": true}));
    }
    if let Some(context) = content.context.as_deref() {
        body.push(json!({
            "type": "TextBlock", "text": context, "wrap": true,
            "isSubtle": true, "size": "Small", "spacing": "Small",
        }));
    }
    if let Some(note) = note {
        body.push(json!({
            "type": "TextBlock", "text": note, "wrap": true,
            "isSubtle": true, "spacing": "Medium",
        }));
    }
    let mut actions: Vec<Value> = content
        .links
        .iter()
        .map(|link| json!({"type": "Action.OpenUrl", "title": link.title, "url": link.url}))
        .collect();
    actions.extend(content.actions.iter().map(|action| {
        let mut data = json!({
            "action": ACTION, "delivery_id": delivery_id, "command": action.command,
        });
        if let Some(token) = action.token {
            data["token"] = json!(token);
        }
        json!({"type": "Action.Submit", "title": action.title, "data": data})
    }));
    render::card_message(
        cards::adaptive_card(body, actions),
        content.summary.as_deref().unwrap_or(&content.text),
    )
}

/// Delivers to the user's personal conversation with the bot.
pub struct TeamsPersonalChannel {
    bot: Arc<TeamsBot>,
}

impl TeamsPersonalChannel {
    pub fn new(bot: Arc<TeamsBot>) -> Self {
        Self { bot }
    }
}

#[async_trait::async_trait]
impl DeliveryChannel for TeamsPersonalChannel {
    fn name(&self) -> &str {
        CHANNEL
    }

    async fn deliver(
        &self,
        db: &DatabaseConnection,
        user: &users::Model,
        row: &Model,
        content: &DeliveryContent,
    ) -> DeliveryOutcome {
        let conversation = match MsTeamsConversations::find()
            .filter(ms_teams_conversations::Column::UserId.eq(user.id))
            .filter(ms_teams_conversations::Column::ConversationType.eq("personal"))
            .order_by_desc(ms_teams_conversations::Column::UpdatedAt)
            .one(db)
            .await
        {
            Ok(Some(conversation)) => conversation,
            Ok(None) => {
                return DeliveryOutcome::Failed {
                    reason: "no personal Teams conversation".to_string(),
                };
            }
            Err(error) => {
                return DeliveryOutcome::Retry {
                    reason: format!("conversation lookup failed: {error}"),
                    retry_after: None,
                };
            }
        };
        let activity = delivery_card(content, row.id);
        match self
            .bot
            .connector
            .send(
                &conversation.service_url,
                &conversation.conversation_id,
                &activity,
            )
            .await
        {
            // The posted content, without its token buttons, lets a button
            // press replace the card in place later.
            Ok(activity_id) => DeliveryOutcome::Delivered {
                details: json!({
                    "activity_id": activity_id,
                    "conversation_id": conversation.conversation_id,
                    "content": without_token_buttons(content),
                }),
            },
            Err(error) => outcome_for_error(&error),
        }
    }
}

/// Which Connector failures are worth another attempt. Throttling and
/// gateway errors are; a 403 (`MessageWritesBlocked`,
/// `ForbiddenOperationException`, the bot removed from the roster) says the
/// user cannot be reached this way at all.
pub fn outcome_for_error(error: &Report) -> DeliveryOutcome {
    let Some(activity) = error.downcast_ref::<ActivityError>() else {
        return DeliveryOutcome::Retry {
            reason: format!("transport: {error}"),
            retry_after: None,
        };
    };
    let reason = match activity.code.as_deref() {
        Some(code) => format!("{} {code}: {}", activity.status.as_u16(), activity.message),
        None => format!("{}: {}", activity.status.as_u16(), activity.message),
    };
    match activity.status.as_u16() {
        401 | 408 | 412 | 429 | 500 | 502 | 503 | 504 => DeliveryOutcome::Retry {
            reason,
            retry_after: activity.retry_after,
        },
        _ => DeliveryOutcome::Failed { reason },
    }
}

impl Host {
    /// Take the card's single-use token, bound to the user who got the card
    /// and the conversation it was delivered to. `false` when it was used,
    /// expired, or is not theirs.
    pub async fn claim_delivery_action(
        &self,
        user_id: Uuid,
        conversation_id: &str,
        submit: &DeliverySubmit,
    ) -> Result<bool, Report> {
        let Some(token) = submit.token else {
            return Ok(false);
        };
        let result = self
            .app_state
            .db
            .execute_raw(statement(
                "teams_nudge.claim_action",
                "UPDATE scheduled_deliveries
                 SET outcome = outcome || jsonb_build_object(
                     'action_claimed_at', now()::text, 'action_command', $4::text)
                 WHERE id = $1 AND user_id = $2 AND state = 'delivered'
                   AND outcome->>'action_token' = $3
                   AND (outcome->>'action_expires_at')::timestamptz > now()
                   AND outcome->>'action_claimed_at' IS NULL
                   AND outcome->'delivered'->>'conversation_id' = $5",
                vec![
                    submit.delivery_id.into(),
                    user_id.into(),
                    token.to_string().into(),
                    submit.command.clone().into(),
                    conversation_id.into(),
                ],
            ))
            .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Give back a claimed token whose press changed nothing, so the card's
    /// buttons work again.
    pub async fn release_delivery_action(&self, submit: &DeliverySubmit) -> Result<(), Report> {
        let Some(token) = submit.token else {
            return Ok(());
        };
        self.app_state
            .db
            .execute_raw(statement(
                "teams_nudge.release_action",
                "UPDATE scheduled_deliveries
                 SET outcome = outcome - 'action_claimed_at' - 'action_command'
                 WHERE id = $1 AND state = 'delivered'
                   AND outcome->>'action_token' = $2
                   AND outcome->>'action_claimed_at' IS NOT NULL",
                vec![submit.delivery_id.into(), token.to_string().into()],
            ))
            .await?;
        Ok(())
    }

    pub async fn set_teams_nudges_opt_out(
        &self,
        user_id: Uuid,
        opted_out: bool,
    ) -> Result<(), Report> {
        set_teams_nudges_opt_out(&self.app_state.db, &user_id, opted_out).await
    }

    pub async fn acknowledge_reminder(
        &self,
        user_id: Uuid,
        delivery_id: Uuid,
    ) -> Change<ScheduledItem> {
        scheduled_items::acknowledge(&self.app_state.db, user_id, delivery_id).await
    }

    pub async fn snooze_delivered_reminder(
        &self,
        user_id: Uuid,
        delivery_id: Uuid,
        choice: SnoozeChoice,
    ) -> Change<(ScheduledItem, DateTime<Utc>)> {
        scheduled_items::snooze_delivered(&self.app_state.db, user_id, delivery_id, choice).await
    }

    /// The chat a delivered reminder links to, while the user can still
    /// continue it.
    pub async fn reminder_chat_to_continue(
        &self,
        user_id: Uuid,
        delivery_id: Uuid,
    ) -> Result<Option<chats::Model>, Report> {
        scheduled_items::chat_to_continue(&self.app_state.db, user_id, delivery_id).await
    }

    pub async fn stored_time_zone(&self, user_id: Uuid) -> Result<Option<Tz>, Report> {
        user_time_zone(&self.app_state.db, &user_id).await
    }

    /// Where a delivered card was posted and what it said, for replacing it.
    pub async fn delivered_card(
        &self,
        delivery_id: Uuid,
    ) -> Result<Option<(String, DeliveryContent)>, Report> {
        let Some(row) = find(&self.app_state.db, delivery_id).await? else {
            return Ok(None);
        };
        let delivered = &row.outcome["delivered"];
        let activity_id = delivered["activity_id"].as_str().map(str::to_string);
        let content = serde_json::from_value(delivered["content"].clone()).ok();
        Ok(activity_id.zip(content))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use erato_config::config::TeamsNudgeSendWindowConfig;

    fn window() -> SendWindow {
        SendWindow::from_config(&TeamsNudgeSendWindowConfig::default()).unwrap()
    }

    fn utc(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn next_slot_keeps_times_inside_the_window_and_moves_the_rest_to_the_next_start() {
        let window = window();
        // Wednesday 10:30 Berlin (CET, +01:00) is inside.
        let inside = utc("2026-11-04T09:30:00Z");
        assert_eq!(window.next_slot(inside), inside);
        // Wednesday 19:00 Berlin → Thursday 08:00 Berlin.
        assert_eq!(
            window.next_slot(utc("2026-11-04T18:00:00Z")),
            utc("2026-11-05T07:00:00Z")
        );
        // Wednesday 06:00 Berlin → Wednesday 08:00 Berlin.
        assert_eq!(
            window.next_slot(utc("2026-11-04T05:00:00Z")),
            utc("2026-11-04T07:00:00Z")
        );
        // Friday 18:00 Berlin → Monday 08:00 Berlin.
        assert_eq!(
            window.next_slot(utc("2026-11-06T17:00:00Z")),
            utc("2026-11-09T07:00:00Z")
        );
        // Saturday noon → Monday 08:00 Berlin.
        assert_eq!(
            window.next_slot(utc("2026-11-07T11:00:00Z")),
            utc("2026-11-09T07:00:00Z")
        );
    }

    #[test]
    fn next_slot_follows_the_configured_zone_and_days() {
        let window = SendWindow::from_config(&TeamsNudgeSendWindowConfig {
            weekdays: vec!["sat".into(), "sun".into()],
            start_hour: 9,
            end_hour: 12,
            time_zone: "America/New_York".into(),
        })
        .unwrap();
        // Friday 20:00 New York (EST, -05:00) → Saturday 09:00 New York.
        assert_eq!(
            window.next_slot(utc("2026-11-07T01:00:00Z")),
            utc("2026-11-07T14:00:00Z")
        );
        // Saturday 11:59 New York stays.
        let inside = utc("2026-11-07T16:59:00Z");
        assert_eq!(window.next_slot(inside), inside);
        // Saturday 12:00 New York → Sunday 09:00.
        assert_eq!(
            window.next_slot(utc("2026-11-07T17:00:00Z")),
            utc("2026-11-08T14:00:00Z")
        );
    }

    #[test]
    fn tips_rotate_by_the_number_already_delivered() {
        let config = TeamsInactivityNudgeConfig {
            enabled: true,
            tips: vec!["one".into(), " two ".into(), "three".into()],
            ..TeamsInactivityNudgeConfig::default()
        };
        let settings = NudgeSettings::from_config(&config).unwrap();
        assert_eq!(settings.tip_for(0), Some("one"));
        assert_eq!(settings.tip_for(1), Some("two"));
        assert_eq!(settings.tip_for(2), Some("three"));
        assert_eq!(settings.tip_for(3), Some("one"));
        let producer = InactivityNudgeProducer::from_config(
            &config,
            "Hugo",
            Some("https://hugo.example.com/"),
            "en",
        )
        .unwrap();
        assert_eq!(
            producer.public_base_url.as_deref(),
            Some("https://hugo.example.com")
        );
    }

    #[test]
    fn a_switched_off_section_parses_without_tips() {
        let settings = NudgeSettings::from_config(&TeamsInactivityNudgeConfig::default()).unwrap();
        assert!(!settings.enabled);
        assert_eq!(settings.tip_for(0), None);
    }

    #[test]
    fn reminders_commands_in_both_languages() {
        use RemindersCommand::{List, Tips};
        assert_eq!(reminders_command(" /reminders off "), Some(Tips(false)));
        assert_eq!(reminders_command("/Reminders ON"), Some(Tips(true)));
        assert_eq!(reminders_command("/erinnerungen aus"), Some(Tips(false)));
        assert_eq!(reminders_command("/erinnerungen an"), Some(Tips(true)));
        assert_eq!(reminders_command("/reminders"), Some(List));
        assert_eq!(reminders_command(" /Erinnerungen "), Some(List));
        assert_eq!(reminders_command("/reminders an"), None);
        assert_eq!(reminders_command("/reminders off please"), None);
        assert_eq!(reminders_command("reminders off"), None);
        assert_eq!(reminders_command("/remindersx"), None);
    }

    #[test]
    fn delivery_card_carries_links_and_single_use_buttons() {
        let delivery_id = Uuid::new_v4();
        let token = Uuid::new_v4();
        let content = DeliveryContent {
            title: None,
            text: "Did you know?".into(),
            context: None,
            summary: Some("A tip from Hugo".into()),
            links: vec![DeliveryLink {
                title: "Open Hugo".into(),
                url: "https://hugo.example.com".into(),
            }],
            actions: vec![DeliveryAction {
                title: "Don't remind me".into(),
                command: OPT_OUT_COMMAND.into(),
                token: Some(token),
            }],
        };
        let activity = delivery_card(&content, delivery_id);
        assert_eq!(activity["summary"], "A tip from Hugo");
        let card = &activity["attachments"][0]["content"];
        assert_eq!(card["body"][0]["text"], "Did you know?");
        assert_eq!(card["actions"][0]["type"], "Action.OpenUrl");
        assert_eq!(card["actions"][0]["url"], "https://hugo.example.com");
        let submit = DeliverySubmit::from_value(&card["actions"][1]["data"]).unwrap();
        assert_eq!(submit.delivery_id, delivery_id);
        assert_eq!(submit.token, Some(token));
        assert_eq!(submit.command, OPT_OUT_COMMAND);
        assert!(
            DeliverySubmit::from_value(&json!({"action": "other", "delivery_id": delivery_id, "command": "x", "token": token}))
                .is_none()
        );
    }

    #[test]
    fn reminder_buttons_parse_to_their_commands() {
        let command = |command: &str| {
            DeliverySubmit::from_value(&json!({
                "action": ACTION, "delivery_id": Uuid::new_v4(),
                "command": command, "token": Uuid::new_v4(),
            }))
            .unwrap()
            .command()
        };
        assert_eq!(command(OPT_OUT_COMMAND), Some(DeliveryCommand::OptOut));
        assert_eq!(command(DONE_COMMAND), Some(DeliveryCommand::Done));
        assert_eq!(
            command(SNOOZE_COMMAND),
            Some(DeliveryCommand::Snooze(SnoozeChoice::HalfAnHour))
        );
        assert_eq!(
            command(TOMORROW_COMMAND),
            Some(DeliveryCommand::Snooze(SnoozeChoice::TomorrowMorning))
        );
        assert_eq!(command("later"), None);
    }

    #[test]
    fn a_settled_card_keeps_its_text_and_links_but_loses_its_buttons() {
        let content = DeliveryContent {
            title: Some("Call Ms Schulz".into()),
            text: "About the delivery date.".into(),
            context: None,
            summary: Some("Call Ms Schulz".into()),
            links: vec![DeliveryLink {
                title: "Q4 rate comparison".into(),
                url: "https://erato.example.com/chat/1".into(),
            }],
            actions: vec![DeliveryAction {
                title: "Done".into(),
                command: DONE_COMMAND.into(),
                token: Some(Uuid::new_v4()),
            }],
        };
        let activity = settled_delivery_card(&content, Uuid::new_v4(), "Marked as done.");
        assert_eq!(activity["summary"], "Call Ms Schulz");
        let card = &activity["attachments"][0]["content"];
        assert_eq!(card["body"][1]["text"], "About the delivery date.");
        assert_eq!(card["body"][2]["text"], "Marked as done.");
        assert_eq!(card["actions"].as_array().unwrap().len(), 1);
        assert_eq!(card["actions"][0]["type"], "Action.OpenUrl");
    }

    #[test]
    fn delivery_card_puts_the_title_above_the_text() {
        let card = |title: Option<&str>, text: &str| {
            delivery_card(
                &DeliveryContent {
                    title: title.map(str::to_string),
                    text: text.into(),
                    ..Default::default()
                },
                Uuid::new_v4(),
            )["attachments"][0]["content"]["body"]
                .clone()
        };
        let body = card(Some("Call Ms Schulz"), "About the delivery date.");
        assert_eq!(body[0]["text"], "Call Ms Schulz");
        assert_eq!(body[0]["weight"], "Bolder");
        assert_eq!(body[1]["text"], "About the delivery date.");
        let title_only = card(Some("Call Ms Schulz"), "");
        assert_eq!(title_only.as_array().unwrap().len(), 1);
    }

    #[test]
    fn connector_errors_map_to_retry_or_failure() {
        let error = |status: u16, code: Option<&str>, retry_after: Option<u64>| {
            Report::from(ActivityError {
                status: reqwest::StatusCode::from_u16(status).unwrap(),
                code: code.map(str::to_string),
                message: "m".into(),
                retry_after: retry_after.map(Duration::from_secs),
            })
        };
        assert_eq!(
            outcome_for_error(&error(429, None, Some(7))),
            DeliveryOutcome::Retry {
                reason: "429: m".into(),
                retry_after: Some(Duration::from_secs(7)),
            }
        );
        for status in [412, 502, 504] {
            assert!(matches!(
                outcome_for_error(&error(status, None, None)),
                DeliveryOutcome::Retry { .. }
            ));
        }
        for code in ["MessageWritesBlocked", "ForbiddenOperationException"] {
            assert_eq!(
                outcome_for_error(&error(403, Some(code), None)),
                DeliveryOutcome::Failed {
                    reason: format!("403 {code}: m"),
                }
            );
        }
        assert!(matches!(
            outcome_for_error(&eyre!("connection reset")),
            DeliveryOutcome::Retry { .. }
        ));
    }
}
