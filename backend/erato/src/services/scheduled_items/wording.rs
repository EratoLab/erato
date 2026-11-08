//! What a delivered reminder offers, on any channel: its buttons, and times
//! as the user reads them, in English or German. Each channel words the
//! replies to those buttons itself.
//!
//! Times are shown in the reminder's zone without a zone name, unless that
//! zone is not the user's current one: "10:00 (New York time)".

use super::recurrence::local_time;
use super::{SNOOZE_HOUR, SnoozeChoice};
use crate::services::text_language::Lang;
use chrono::{DateTime, Datelike, Duration, Utc};
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
