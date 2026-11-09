//! What a delivered reminder offers, on any channel: its buttons, and times
//! as the user reads them. English for now; the user's language follows.
//! Each channel words the replies to those buttons itself.
//!
//! Times are shown in the reminder's zone without a zone name, unless that
//! zone is not the user's current one: "10:00 (New York time)".

use super::recurrence::local_time;
use super::{SNOOZE_HOUR, SnoozeChoice};
use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz;

pub const DONE_BUTTON: &str = "Done";

pub fn snooze_button(choice: SnoozeChoice, zone: Tz, user_zone: Option<Tz>) -> String {
    match choice {
        SnoozeChoice::HalfAnHour => "Snooze 30 min".to_string(),
        SnoozeChoice::TomorrowMorning => {
            format!("Tomorrow {SNOOZE_HOUR}:00{}", zone_suffix(zone, user_zone))
        }
    }
}

/// `9:30`, `tomorrow 9:00` or `Fri, Nov 13, 9:00`, as seen from `now`.
pub fn when(at: DateTime<Utc>, zone: Tz, user_zone: Option<Tz>, now: DateTime<Utc>) -> String {
    let local = local_time(zone, at);
    let today = local_time(zone, now).date();
    let day = if local.date() == today {
        String::new()
    } else if local.date() == today + Duration::days(1) {
        "tomorrow ".to_string()
    } else {
        local.format("%a, %b %-d, ").to_string()
    };
    format!(
        "{day}{}{}",
        local.format("%-H:%M"),
        zone_suffix(zone, user_zone)
    )
}

fn zone_suffix(zone: Tz, user_zone: Option<Tz>) -> String {
    match user_zone {
        Some(user_zone) if user_zone != zone => {
            let name = zone.name();
            let place = name.rsplit('/').next().unwrap_or(name).replace('_', " ");
            format!(" ({place} time)")
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
            when(utc("2026-11-08T13:30:00Z"), BERLIN, None, now),
            "14:30"
        );
        assert_eq!(
            when(utc("2026-11-09T08:00:00Z"), BERLIN, Some(BERLIN), now),
            "tomorrow 9:00"
        );
        assert_eq!(
            when(utc("2026-11-13T08:00:00Z"), BERLIN, None, now),
            "Fri, Nov 13, 9:00"
        );
    }

    #[test]
    fn the_zone_shows_only_when_it_is_not_the_users() {
        let now = utc("2026-11-08T13:00:00Z");
        let new_york: Tz = chrono_tz::America::New_York;
        assert_eq!(
            when(utc("2026-11-09T15:00:00Z"), new_york, Some(BERLIN), now),
            "tomorrow 10:00 (New York time)"
        );
        assert_eq!(
            snooze_button(SnoozeChoice::TomorrowMorning, new_york, Some(BERLIN)),
            "Tomorrow 9:00 (New York time)"
        );
        assert_eq!(
            snooze_button(SnoozeChoice::TomorrowMorning, BERLIN, Some(BERLIN)),
            "Tomorrow 9:00"
        );
        assert_eq!(
            snooze_button(SnoozeChoice::TomorrowMorning, BERLIN, None),
            "Tomorrow 9:00"
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
