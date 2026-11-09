//! What a reminder shows on any channel, in English or German: the buttons
//! of a delivered reminder, the confirmation after one was scheduled, and
//! times as the user reads them. Each channel words the replies to those
//! buttons itself.
//!
//! Times are shown in the reminder's zone without a zone name, unless that
//! zone is not the user's current one: "10:00 (New York time)".

use super::recurrence::{Frequency, RepeatRule, local_time};
use super::{SNOOZE_HOUR, SnoozeChoice};
use crate::ms_teams_bot::nudge::CHANNEL as TEAMS_CHANNEL;
use crate::services::text_language::Lang;
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc, Weekday};
use chrono_tz::Tz;

/// As the web app's German dates read them (`Intl`, `de`).
const GERMAN_WEEKDAYS: [&str; 7] = [
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
];
const GERMAN_MONTHS: [&str; 12] = [
    "Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez.",
];

const ENGLISH_WEEKDAYS: [&str; 7] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];

pub fn done_button(lang: Lang) -> &'static str {
    lang.pick("Done", "Erledigt")
}

pub fn snooze_button(choice: SnoozeChoice, zone: Tz, user_zone: Option<Tz>, lang: Lang) -> String {
    match choice {
        SnoozeChoice::HalfAnHour => lang.pick("Snooze 30 min", "Später (30 Min.)").to_string(),
        SnoozeChoice::TomorrowMorning => format!(
            "{} {SNOOZE_HOUR}:00{}",
            lang.pick("Tomorrow", "Morgen"),
            zone_suffix(zone, user_zone, lang)
        ),
    }
}

/// The linked chat's name on the card, when the chat has none.
pub fn untitled_chat(lang: Lang) -> &'static str {
    lang.pick("Untitled Chat", "Unbenannter Chat")
}

/// `9:30`, `tomorrow 9:00` or `Fri, Nov 13, 9:00` as seen from `now`; in
/// German `9:30`, `morgen 9:00` or `Freitag, 13. Nov., 9:00`.
pub fn when(
    at: DateTime<Utc>,
    zone: Tz,
    user_zone: Option<Tz>,
    now: DateTime<Utc>,
    lang: Lang,
) -> String {
    let local = local_time(zone, at);
    let today = local_time(zone, now).date();
    let date = local.date();
    let day = if date == today {
        String::new()
    } else if date == today + Duration::days(1) {
        lang.pick("tomorrow ", "morgen ").to_string()
    } else {
        match lang {
            Lang::En => local.format("%a, %b %-d, ").to_string(),
            Lang::De => format!(
                "{}, {}. {}, ",
                GERMAN_WEEKDAYS[date.weekday().num_days_from_monday() as usize],
                date.day(),
                GERMAN_MONTHS[date.month0() as usize]
            ),
        }
    };
    format!(
        "{day}{}{}",
        local.format("%-H:%M"),
        zone_suffix(zone, user_zone, lang)
    )
}

/// The full date and time, as a confirmation states it: `Friday, 13 Nov,
/// 10:00`, with the year when it is not this year's; in German `Freitag,
/// 13. Nov., 10:00`.
pub fn exact_when(
    at: DateTime<Utc>,
    zone: Tz,
    user_zone: Option<Tz>,
    now: DateTime<Utc>,
    lang: Lang,
) -> String {
    let local = local_time(zone, at);
    let date = local.date();
    let year = if date.year() == local_time(zone, now).year() {
        String::new()
    } else {
        format!(" {}", date.year())
    };
    let day = match lang {
        Lang::En => format!(
            "{}, {} {}{year}",
            weekday_name(date.weekday(), lang),
            date.day(),
            local.format("%b")
        ),
        Lang::De => format!(
            "{}, {}. {}{year}",
            weekday_name(date.weekday(), lang),
            date.day(),
            GERMAN_MONTHS[date.month0() as usize]
        ),
    };
    format!(
        "{day}, {}{}",
        local.format("%-H:%M"),
        zone_suffix(zone, user_zone, lang)
    )
}

fn weekday_name(day: Weekday, lang: Lang) -> &'static str {
    let index = day.num_days_from_monday() as usize;
    lang.pick(ENGLISH_WEEKDAYS[index], GERMAN_WEEKDAYS[index])
}

/// How a repeating schedule reads, as the web form's summary words it:
/// `every week on Monday and Wednesday at 9:00`, `jeden Werktag um 9:00`.
pub fn repeat_pattern(rule: &RepeatRule, lang: Lang) -> String {
    let time = rule.time.naive().format("%-H:%M").to_string();
    match (rule.frequency, lang) {
        (Frequency::Daily, Lang::En) => format!("every day at {time}"),
        (Frequency::Daily, Lang::De) => format!("jeden Tag um {time}"),
        (Frequency::Weekdays, Lang::En) => format!("every weekday at {time}"),
        (Frequency::Weekdays, Lang::De) => format!("jeden Werktag um {time}"),
        (Frequency::Weekly, _) => {
            let days: Vec<&str> = rule
                .weekdays
                .iter()
                .map(|day| weekday_name(day.weekday(), lang))
                .collect();
            match lang {
                Lang::En => format!("every week on {} at {time}", list(&days, lang)),
                Lang::De => format!("jede Woche am {} um {time}", list(&days, lang)),
            }
        }
        (Frequency::Monthly, Lang::En) => {
            format!("every month on day {} at {time}", rule.starts_on.day())
        }
        (Frequency::Monthly, Lang::De) => {
            format!("jeden Monat am {}. um {time}", rule.starts_on.day())
        }
    }
}

/// `A`, `A and B`, `A, B, and C` (as `Intl.ListFormat` writes English);
/// `A, B und C` in German.
fn list(items: &[&str], lang: Lang) -> String {
    let and = lang.pick("and", "und");
    match items {
        [] => String::new(),
        [only] => only.to_string(),
        [first, second] => format!("{first} {and} {second}"),
        [rest @ .., last] => {
            let comma = lang.pick(",", "");
            format!("{}{comma} {and} {last}", rest.join(", "))
        }
    }
}

/// The delivery channel as the Scheduled page names it.
pub fn channel_name(channel: &str, lang: Lang) -> String {
    match channel {
        TEAMS_CHANNEL => lang.pick("Teams chat", "Teams-Chat").to_string(),
        other => other.to_string(),
    }
}

/// Where a scheduled reminder arrives, as the form's delivery line reads.
pub fn delivery_line(channel: &str, lang: Lang) -> String {
    let name = channel_name(channel, lang);
    match lang {
        Lang::En => format!("Delivered via {name}"),
        Lang::De => format!("Zustellung per {name}"),
    }
}

pub fn confirmation_heading(lang: Lang) -> &'static str {
    lang.pick("Reminder scheduled", "Erinnerung geplant")
}

pub fn cancel_button(lang: Lang) -> &'static str {
    lang.pick("Cancel", "Abbrechen")
}

pub fn open_scheduled_button(lang: Lang) -> &'static str {
    lang.pick("Open in Scheduled", "In „Geplant“ öffnen")
}

/// The first letter upper-cased, for a pattern that starts a line.
pub fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Today in `zone` with its weekday, as the tools tell the model:
/// `Sunday, 2026-11-08`.
pub fn today_for_model(zone: Tz, now: DateTime<Utc>) -> String {
    let today: NaiveDate = local_time(zone, now).date();
    format!(
        "{}, {}",
        weekday_name(today.weekday(), Lang::En),
        today.format("%Y-%m-%d")
    )
}

fn zone_suffix(zone: Tz, user_zone: Option<Tz>, lang: Lang) -> String {
    match user_zone {
        Some(user_zone) if user_zone != zone => {
            let name = zone.name();
            let place = name.rsplit('/').next().unwrap_or(name).replace('_', " ");
            match lang {
                Lang::En => format!(" ({place} time)"),
                Lang::De => format!(" (Ortszeit {place})"),
            }
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BERLIN: Tz = chrono_tz::Europe::Berlin;

    fn utc(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn times_name_the_day_only_when_it_is_not_today() {
        // Sunday 8 Nov 2026, 14:00 in Berlin.
        let now = utc("2026-11-08T13:00:00Z");
        assert_eq!(
            when(utc("2026-11-08T13:30:00Z"), BERLIN, None, now, Lang::En),
            "14:30"
        );
        assert_eq!(
            when(
                utc("2026-11-09T08:00:00Z"),
                BERLIN,
                Some(BERLIN),
                now,
                Lang::En
            ),
            "tomorrow 9:00"
        );
        assert_eq!(
            when(utc("2026-11-13T08:00:00Z"), BERLIN, None, now, Lang::En),
            "Fri, Nov 13, 9:00"
        );
    }

    #[test]
    fn the_zone_shows_only_when_it_is_not_the_users() {
        let now = utc("2026-11-08T13:00:00Z");
        let new_york: Tz = chrono_tz::America::New_York;
        assert_eq!(
            when(
                utc("2026-11-09T15:00:00Z"),
                new_york,
                Some(BERLIN),
                now,
                Lang::En
            ),
            "tomorrow 10:00 (New York time)"
        );
        assert_eq!(
            snooze_button(
                SnoozeChoice::TomorrowMorning,
                new_york,
                Some(BERLIN),
                Lang::En
            ),
            "Tomorrow 9:00 (New York time)"
        );
        assert_eq!(
            snooze_button(
                SnoozeChoice::TomorrowMorning,
                BERLIN,
                Some(BERLIN),
                Lang::En
            ),
            "Tomorrow 9:00"
        );
        assert_eq!(
            snooze_button(SnoozeChoice::TomorrowMorning, BERLIN, None, Lang::En),
            "Tomorrow 9:00"
        );
    }

    #[test]
    fn german_times_read_as_the_web_app_writes_them() {
        let now = utc("2026-11-08T13:00:00Z");
        assert_eq!(
            when(
                utc("2026-11-08T13:30:00Z"),
                BERLIN,
                Some(BERLIN),
                now,
                Lang::De
            ),
            "14:30"
        );
        assert_eq!(
            when(utc("2026-11-09T08:00:00Z"), BERLIN, None, now, Lang::De),
            "morgen 9:00"
        );
        assert_eq!(
            when(utc("2026-11-13T08:00:00Z"), BERLIN, None, now, Lang::De),
            "Freitag, 13. Nov., 9:00"
        );
        assert_eq!(
            when(utc("2027-03-01T08:00:00Z"), BERLIN, None, now, Lang::De),
            "Montag, 1. März, 9:00"
        );
        let new_york: Tz = chrono_tz::America::New_York;
        assert_eq!(
            when(
                utc("2026-11-09T15:00:00Z"),
                new_york,
                Some(BERLIN),
                now,
                Lang::De
            ),
            "morgen 10:00 (Ortszeit New York)"
        );
    }

    #[test]
    fn german_buttons() {
        let new_york: Tz = chrono_tz::America::New_York;
        assert_eq!(done_button(Lang::De), "Erledigt");
        assert_eq!(
            snooze_button(SnoozeChoice::HalfAnHour, BERLIN, Some(BERLIN), Lang::De),
            "Später (30 Min.)"
        );
        assert_eq!(
            snooze_button(
                SnoozeChoice::TomorrowMorning,
                BERLIN,
                Some(BERLIN),
                Lang::De
            ),
            "Morgen 9:00"
        );
        assert_eq!(
            snooze_button(
                SnoozeChoice::TomorrowMorning,
                new_york,
                Some(BERLIN),
                Lang::De
            ),
            "Morgen 9:00 (Ortszeit New York)"
        );
    }

    #[test]
    fn a_confirmation_states_the_full_date() {
        let now = utc("2026-11-08T13:00:00Z");
        assert_eq!(
            exact_when(
                utc("2026-11-13T09:00:00Z"),
                BERLIN,
                Some(BERLIN),
                now,
                Lang::En
            ),
            "Friday, 13 Nov, 10:00"
        );
        assert_eq!(
            exact_when(
                utc("2026-11-13T09:00:00Z"),
                BERLIN,
                Some(BERLIN),
                now,
                Lang::De
            ),
            "Freitag, 13. Nov., 10:00"
        );
        assert_eq!(
            exact_when(utc("2026-11-08T13:30:00Z"), BERLIN, None, now, Lang::En),
            "Sunday, 8 Nov, 14:30"
        );
        assert_eq!(
            exact_when(utc("2027-03-01T08:00:00Z"), BERLIN, None, now, Lang::De),
            "Montag, 1. März 2027, 9:00"
        );
        let new_york: Tz = chrono_tz::America::New_York;
        assert_eq!(
            exact_when(
                utc("2026-11-13T15:00:00Z"),
                new_york,
                Some(BERLIN),
                now,
                Lang::En
            ),
            "Friday, 13 Nov, 10:00 (New York time)"
        );
        assert_eq!(
            today_for_model(BERLIN, utc("2026-11-08T23:30:00Z")),
            "Monday, 2026-11-09"
        );
    }

    #[test]
    fn repeating_schedules_read_as_the_forms_summary() {
        use crate::services::scheduled_items::recurrence::{DayOfWeek, LocalTime, RepeatEnd};
        let rule = |frequency, weekdays: Vec<DayOfWeek>| RepeatRule {
            frequency,
            weekdays,
            time: LocalTime::new(9, 0).unwrap(),
            starts_on: NaiveDate::from_ymd_opt(2026, 11, 13).unwrap(),
            ends: RepeatEnd::Never,
        };
        assert_eq!(
            repeat_pattern(&rule(Frequency::Weekdays, vec![]), Lang::En),
            "every weekday at 9:00"
        );
        assert_eq!(
            repeat_pattern(&rule(Frequency::Daily, vec![]), Lang::De),
            "jeden Tag um 9:00"
        );
        let weekly = rule(
            Frequency::Weekly,
            vec![DayOfWeek::Mon, DayOfWeek::Wed, DayOfWeek::Fri],
        );
        assert_eq!(
            repeat_pattern(&weekly, Lang::En),
            "every week on Monday, Wednesday, and Friday at 9:00"
        );
        assert_eq!(
            repeat_pattern(&weekly, Lang::De),
            "jede Woche am Montag, Mittwoch und Freitag um 9:00"
        );
        assert_eq!(
            repeat_pattern(
                &rule(Frequency::Weekly, vec![DayOfWeek::Tue, DayOfWeek::Thu]),
                Lang::En
            ),
            "every week on Tuesday and Thursday at 9:00"
        );
        assert_eq!(
            repeat_pattern(&rule(Frequency::Monthly, vec![]), Lang::De),
            "jeden Monat am 13. um 9:00"
        );
        assert_eq!(capitalized("jeden Tag um 9:00"), "Jeden Tag um 9:00");
        assert_eq!(
            delivery_line(TEAMS_CHANNEL, Lang::De),
            "Zustellung per Teams-Chat"
        );
        assert_eq!(
            delivery_line(TEAMS_CHANNEL, Lang::En),
            "Delivered via Teams chat"
        );
    }

    #[test]
    fn tomorrow_morning_is_nine_in_the_items_zone() {
        // Monday 00:30 in Berlin, still Sunday evening in New York.
        let now = utc("2026-11-08T23:30:00Z");
        assert_eq!(
            SnoozeChoice::TomorrowMorning.until(BERLIN, now),
            utc("2026-11-10T08:00:00Z")
        );
        assert_eq!(
            SnoozeChoice::TomorrowMorning.until(chrono_tz::America::New_York, now),
            utc("2026-11-09T14:00:00Z")
        );
        assert_eq!(
            SnoozeChoice::HalfAnHour.until(BERLIN, now),
            utc("2026-11-09T00:00:00Z")
        );
        assert_eq!(
            SnoozeChoice::HalfAnHour.until(BERLIN, now + Duration::nanoseconds(1_234_567)),
            utc("2026-11-09T00:00:00.001234Z")
        );
    }
}
