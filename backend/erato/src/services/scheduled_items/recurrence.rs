//! When a scheduled item happens: once at a local date and time, or on a
//! repeating rule. Local times resolve in the zone stored with the item, so
//! 09:00 stays 09:00 local across daylight-saving changes.
//!
//! Short months: a monthly rule on the 29th, 30th or 31st happens on the last
//! day of a month that does not have that day (31 January, 28 February,
//! 31 March, 30 April), the way calendar apps clamp it.

use chrono::{
    DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone,
    Timelike, Utc, Weekday,
};
use chrono_tz::Tz;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use utoipa::ToSchema;

/// Enough for the sparsest rule (monthly) plus a daylight-saving shift.
const MAX_SCAN_DAYS: usize = 400;
pub const MAX_REPEAT_COUNT: u32 = 1000;

/// A time of day, `HH:MM`. Seconds are dropped: the executor works in
/// minutes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct LocalTime(NaiveTime);

impl LocalTime {
    pub fn new(hour: u32, minute: u32) -> Option<Self> {
        NaiveTime::from_hms_opt(hour, minute, 0).map(Self)
    }

    pub fn naive(self) -> NaiveTime {
        self.0
    }
}

impl Serialize for LocalTime {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0.format("%H:%M").to_string())
    }
}

impl<'de> Deserialize<'de> for LocalTime {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        NaiveTime::parse_from_str(text.trim(), "%H:%M")
            .or_else(|_| NaiveTime::parse_from_str(text.trim(), "%H:%M:%S"))
            .ok()
            .and_then(|time| Self::new(time.hour(), time.minute()))
            .ok_or_else(|| serde::de::Error::custom("expected a time of day as HH:MM"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DayOfWeek {
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
    Sun,
}

impl DayOfWeek {
    pub fn weekday(self) -> Weekday {
        match self {
            Self::Mon => Weekday::Mon,
            Self::Tue => Weekday::Tue,
            Self::Wed => Weekday::Wed,
            Self::Thu => Weekday::Thu,
            Self::Fri => Weekday::Fri,
            Self::Sat => Weekday::Sat,
            Self::Sun => Weekday::Sun,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Frequency {
    /// Every day.
    Daily,
    /// Monday to Friday.
    Weekdays,
    /// On the chosen `weekdays`.
    Weekly,
    /// On the day of the month of `starts_on`.
    Monthly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RepeatEnd {
    #[default]
    Never,
    /// The last day an occurrence may fall on.
    OnDate { date: NaiveDate },
    /// After this many occurrences.
    AfterCount { count: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RepeatRule {
    pub frequency: Frequency,
    /// The days of a weekly rule; empty for the other frequencies.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weekdays: Vec<DayOfWeek>,
    /// Local time of day, `HH:MM`.
    #[schema(value_type = String, example = "09:00")]
    pub time: LocalTime,
    /// The first day an occurrence may fall on.
    pub starts_on: NaiveDate,
    #[serde(default)]
    pub ends: RepeatEnd,
}

/// What makes an item happen. Times are local to the zone stored with the
/// item; event-driven triggers will be further variants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Trigger {
    /// At a local date and time.
    Once {
        date: NaiveDate,
        /// Local time of day, `HH:MM`.
        #[schema(value_type = String, example = "10:00")]
        time: LocalTime,
    },
    /// On a repeating schedule.
    Repeat(RepeatRule),
}

impl Trigger {
    /// The same trigger with the weekday list in canonical form, or why it
    /// is not a usable rule.
    pub fn normalized(self) -> Result<Self, String> {
        let Trigger::Repeat(mut rule) = self else {
            return Ok(self);
        };
        if rule.frequency == Frequency::Weekly {
            rule.weekdays.sort_unstable();
            rule.weekdays.dedup();
            if rule.weekdays.is_empty() {
                return Err("a weekly schedule needs at least one weekday".into());
            }
        } else {
            rule.weekdays.clear();
        }
        match rule.ends {
            RepeatEnd::AfterCount { count } if count == 0 || count > MAX_REPEAT_COUNT => {
                return Err(format!(
                    "the number of times must be between 1 and {MAX_REPEAT_COUNT}"
                ));
            }
            RepeatEnd::OnDate { date } if date < rule.starts_on => {
                return Err("the end date is before the start date".into());
            }
            _ => {}
        }
        Ok(Trigger::Repeat(rule))
    }

    /// The first occurrence strictly after `after`, for an item that already
    /// had `count` occurrences; `None` when there is none: a one-off that
    /// happened or lies in the past, or a rule whose end is reached.
    pub fn next_after(&self, zone: Tz, after: DateTime<Utc>, count: u32) -> Option<DateTime<Utc>> {
        match self {
            Trigger::Once { date, time } => {
                if count > 0 {
                    return None;
                }
                let at = resolve_local(zone, date.and_time(time.naive()));
                (at > after).then_some(at)
            }
            Trigger::Repeat(rule) => rule.next_after(zone, after, count),
        }
    }
}

impl RepeatRule {
    fn next_after(&self, zone: Tz, after: DateTime<Utc>, count: u32) -> Option<DateTime<Utc>> {
        if let RepeatEnd::AfterCount { count: limit } = self.ends
            && count >= limit
        {
            return None;
        }
        // A local day's occurrence can lie on the previous UTC day.
        let from =
            (after.with_timezone(&zone).date_naive() - Duration::days(1)).max(self.starts_on);
        for date in from.iter_days().take(MAX_SCAN_DAYS) {
            if let RepeatEnd::OnDate { date: last } = self.ends
                && date > last
            {
                return None;
            }
            if !self.happens_on(date) {
                continue;
            }
            let at = resolve_local(zone, date.and_time(self.time.naive()));
            if at > after {
                return Some(at);
            }
        }
        None
    }

    fn happens_on(&self, date: NaiveDate) -> bool {
        match self.frequency {
            Frequency::Daily => true,
            Frequency::Weekdays => date.weekday().num_days_from_monday() < 5,
            Frequency::Weekly => self
                .weekdays
                .iter()
                .any(|day| day.weekday() == date.weekday()),
            Frequency::Monthly => date.day() == self.starts_on.day().min(days_in_month(date)),
        }
    }
}

fn days_in_month(date: NaiveDate) -> u32 {
    let next_month = if date.month() == 12 {
        NaiveDate::from_ymd_opt(date.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(date.year(), date.month() + 1, 1)
    };
    next_month
        .and_then(|first| first.pred_opt())
        .map_or(28, |last| last.day())
}

/// A local time in `zone`. One inside a daylight-saving gap moves to the
/// first valid minute after the gap; one in the repeated hour takes its
/// first instance, so a daily time there happens once.
pub fn resolve_local(zone: Tz, local: NaiveDateTime) -> DateTime<Utc> {
    match zone.from_local_datetime(&local) {
        LocalResult::Single(at) => at.with_timezone(&Utc),
        LocalResult::Ambiguous(first, _) => first.with_timezone(&Utc),
        LocalResult::None => (1..=24 * 60)
            .find_map(|minutes| {
                zone.from_local_datetime(&(local + Duration::minutes(minutes)))
                    .earliest()
            })
            .map_or_else(
                || Utc.from_utc_datetime(&local),
                |at| at.with_timezone(&Utc),
            ),
    }
}

/// The wall-clock time of `at` in `zone`, as the user sees it.
pub fn local_time(zone: Tz, at: DateTime<Utc>) -> NaiveDateTime {
    at.with_timezone(&zone).naive_local()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const BERLIN: Tz = chrono_tz::Europe::Berlin;

    fn utc(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn date(text: &str) -> NaiveDate {
        text.parse().unwrap()
    }

    fn rule(frequency: Frequency, weekdays: &[DayOfWeek], time: &str, starts_on: &str) -> Trigger {
        Trigger::Repeat(RepeatRule {
            frequency,
            weekdays: weekdays.to_vec(),
            time: serde_json::from_value(json!(time)).unwrap(),
            starts_on: date(starts_on),
            ends: RepeatEnd::Never,
        })
    }

    fn with_end(trigger: Trigger, ends: RepeatEnd) -> Trigger {
        let Trigger::Repeat(rule) = trigger else {
            unreachable!()
        };
        Trigger::Repeat(RepeatRule { ends, ..rule })
    }

    /// The first `n` occurrences after `from`, each computed from the one
    /// before, as the producer does.
    fn series(trigger: &Trigger, zone: Tz, from: &str, n: usize) -> Vec<String> {
        let mut after = utc(from);
        let mut out = Vec::new();
        for count in 0..n {
            let Some(at) = trigger.next_after(zone, after, count as u32) else {
                break;
            };
            out.push(at.to_rfc3339());
            after = at;
        }
        out
    }

    #[test]
    fn daily_keeps_local_time_across_the_spring_change() {
        // Berlin moves from +01:00 to +02:00 on Sunday, 29 March 2026.
        let daily = rule(Frequency::Daily, &[], "09:00", "2026-03-27");
        assert_eq!(
            series(&daily, BERLIN, "2026-03-01T00:00:00Z", 4),
            [
                "2026-03-27T08:00:00+00:00",
                "2026-03-28T08:00:00+00:00",
                "2026-03-29T07:00:00+00:00",
                "2026-03-30T07:00:00+00:00",
            ]
        );
    }

    #[test]
    fn weekdays_skip_the_weekend_across_the_autumn_change() {
        // Berlin moves from +02:00 to +01:00 on Sunday, 25 October 2026.
        let weekdays = rule(Frequency::Weekdays, &[], "09:00", "2026-10-22");
        assert_eq!(
            series(&weekdays, BERLIN, "2026-10-22T08:00:00Z", 3),
            [
                "2026-10-23T07:00:00+00:00",
                "2026-10-26T08:00:00+00:00",
                "2026-10-27T08:00:00+00:00",
            ]
        );
    }

    #[test]
    fn weekly_on_chosen_days() {
        let weekly = rule(
            Frequency::Weekly,
            &[DayOfWeek::Thu, DayOfWeek::Mon],
            "09:00",
            "2026-03-23",
        );
        assert_eq!(
            series(&weekly, BERLIN, "2026-03-20T00:00:00Z", 4),
            [
                "2026-03-23T08:00:00+00:00",
                "2026-03-26T08:00:00+00:00",
                "2026-03-30T07:00:00+00:00",
                "2026-04-02T07:00:00+00:00",
            ]
        );
    }

    #[test]
    fn monthly_keeps_the_day_and_clamps_short_months() {
        let monthly = rule(Frequency::Monthly, &[], "10:00", "2026-03-15");
        assert_eq!(
            series(&monthly, BERLIN, "2026-03-01T00:00:00Z", 2),
            ["2026-03-15T09:00:00+00:00", "2026-04-15T08:00:00+00:00"]
        );
        let end_of_month = rule(Frequency::Monthly, &[], "10:00", "2026-01-31");
        assert_eq!(
            series(&end_of_month, chrono_tz::UTC, "2026-01-01T00:00:00Z", 4),
            [
                "2026-01-31T10:00:00+00:00",
                "2026-02-28T10:00:00+00:00",
                "2026-03-31T10:00:00+00:00",
                "2026-04-30T10:00:00+00:00",
            ]
        );
    }

    #[test]
    fn a_time_in_the_gap_moves_to_the_next_valid_time() {
        // 02:00–03:00 does not exist in Berlin on 29 March 2026.
        let daily = rule(Frequency::Daily, &[], "02:30", "2026-03-28");
        assert_eq!(
            series(&daily, BERLIN, "2026-03-27T00:00:00Z", 3),
            [
                "2026-03-28T01:30:00+00:00",
                "2026-03-29T01:00:00+00:00",
                "2026-03-30T00:30:00+00:00",
            ]
        );
    }

    #[test]
    fn a_time_in_the_repeated_hour_happens_once() {
        // 02:00–03:00 happens twice in Berlin on 25 October 2026.
        let daily = rule(Frequency::Daily, &[], "02:30", "2026-10-24");
        assert_eq!(
            series(&daily, BERLIN, "2026-10-23T00:00:00Z", 3),
            [
                "2026-10-24T00:30:00+00:00",
                "2026-10-25T00:30:00+00:00",
                "2026-10-26T01:30:00+00:00",
            ]
        );
    }

    #[test]
    fn end_on_a_date_and_after_a_count_stop_the_series() {
        let daily = rule(Frequency::Daily, &[], "09:00", "2026-03-27");
        let until = with_end(
            daily.clone(),
            RepeatEnd::OnDate {
                date: date("2026-03-28"),
            },
        );
        assert_eq!(series(&until, BERLIN, "2026-03-01T00:00:00Z", 10).len(), 2);
        let twice = with_end(daily, RepeatEnd::AfterCount { count: 2 });
        assert_eq!(series(&twice, BERLIN, "2026-03-01T00:00:00Z", 10).len(), 2);
    }

    #[test]
    fn the_next_occurrence_is_taken_from_the_regular_time_or_now_whichever_is_later() {
        let daily = rule(Frequency::Daily, &[], "09:00", "2026-03-01");
        // A snoozed occurrence delivered at 09:30 is followed by tomorrow's 09:00.
        let regular = utc("2026-03-10T08:00:00Z");
        let delivered = utc("2026-03-10T08:30:00Z");
        assert_eq!(
            daily.next_after(BERLIN, regular.max(delivered), 1),
            Some(utc("2026-03-11T08:00:00Z"))
        );
        // After an outage, missed days are not caught up.
        assert_eq!(
            daily.next_after(BERLIN, utc("2026-03-14T12:00:00Z"), 1),
            Some(utc("2026-03-15T08:00:00Z"))
        );
    }

    #[test]
    fn a_one_off_happens_once_and_only_in_the_future() {
        let once = Trigger::Once {
            date: date("2026-03-29"),
            time: LocalTime::new(10, 0).unwrap(),
        };
        let at = utc("2026-03-29T08:00:00Z");
        assert_eq!(
            once.next_after(BERLIN, utc("2026-03-28T00:00:00Z"), 0),
            Some(at)
        );
        assert_eq!(once.next_after(BERLIN, at, 0), None);
        assert_eq!(
            once.next_after(BERLIN, utc("2026-03-28T00:00:00Z"), 1),
            None
        );
        // 10:00 Berlin is stored on both sides of the change.
        let winter = Trigger::Once {
            date: date("2026-03-27"),
            time: LocalTime::new(10, 0).unwrap(),
        };
        assert_eq!(
            winter.next_after(BERLIN, utc("2026-03-01T00:00:00Z"), 0),
            Some(utc("2026-03-27T09:00:00Z"))
        );
    }

    #[test]
    fn rules_are_validated_and_normalized() {
        let weekly = rule(
            Frequency::Weekly,
            &[DayOfWeek::Thu, DayOfWeek::Mon, DayOfWeek::Thu],
            "09:00",
            "2026-03-23",
        );
        let Trigger::Repeat(normalized) = weekly.normalized().unwrap() else {
            unreachable!()
        };
        assert_eq!(normalized.weekdays, [DayOfWeek::Mon, DayOfWeek::Thu]);
        assert!(
            rule(Frequency::Weekly, &[], "09:00", "2026-03-23")
                .normalized()
                .is_err()
        );
        let Trigger::Repeat(daily) =
            rule(Frequency::Daily, &[DayOfWeek::Mon], "09:00", "2026-03-23")
                .normalized()
                .unwrap()
        else {
            unreachable!()
        };
        assert!(daily.weekdays.is_empty());
        for ends in [
            RepeatEnd::AfterCount { count: 0 },
            RepeatEnd::OnDate {
                date: date("2026-03-22"),
            },
        ] {
            assert!(
                with_end(rule(Frequency::Daily, &[], "09:00", "2026-03-23"), ends)
                    .normalized()
                    .is_err()
            );
        }
    }

    #[test]
    fn json_shape() {
        let trigger: Trigger = serde_json::from_value(json!({
            "kind": "repeat", "frequency": "weekly", "weekdays": ["mon", "thu"],
            "time": "09:00:30", "starts_on": "2026-11-09", "ends": {"kind": "after_count", "count": 5}
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(&trigger).unwrap(),
            json!({
                "kind": "repeat", "frequency": "weekly", "weekdays": ["mon", "thu"],
                "time": "09:00", "starts_on": "2026-11-09", "ends": {"kind": "after_count", "count": 5}
            })
        );
        let once: Trigger =
            serde_json::from_value(json!({"kind": "once", "date": "2026-11-13", "time": "10:00"}))
                .unwrap();
        assert_eq!(
            serde_json::to_value(&once).unwrap(),
            json!({"kind": "once", "date": "2026-11-13", "time": "10:00"})
        );
        let never: Trigger = serde_json::from_value(json!({
            "kind": "repeat", "frequency": "daily", "time": "08:00", "starts_on": "2026-11-09"
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(&never).unwrap()["ends"],
            json!({"kind": "never"})
        );
        assert!(
            serde_json::from_value::<Trigger>(
                json!({"kind": "once", "date": "2026-11-13", "time": "25:00"})
            )
            .is_err()
        );
    }
}
