import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";

import { scheduledFirstOccurrence } from "./scheduledForm";
import { formatScheduledDateTime, scheduledHourStyle } from "./scheduledItems";
import { daysBetweenDateKeys, localDateKey } from "./scheduledTime";
import { Alert } from "../Feedback/Alert";

import type { ScheduledFormValues, ScheduledWeekday } from "./scheduledForm";

// The zone a bare wall date or time is formatted in, so nothing shifts it.
const UTC = "UTC";

const WEEKDAY_INDEX: Record<ScheduledWeekday, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

const utcNoon = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
};

/** "Friday, 13 November 2026" for a `YYYY-MM-DD`, whatever the zone. */
export function formatWallDate(key: string, locale: string | undefined) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: UTC,
  }).format(utcNoon(key));
}

/** "9:00 AM" or "09:00" for an `HH:MM`, in the locale's clock. */
export function formatWallTime(time: string, locale: string | undefined) {
  const [hour, minute] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(locale, {
    hour: scheduledHourStyle(locale),
    minute: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
    timeZone: UTC,
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

/** Weekday names in the locale; 1 January 2024 was a Monday. */
export function weekdayName(
  day: ScheduledWeekday,
  locale: string | undefined,
  width: "long" | "short",
) {
  return new Intl.DateTimeFormat(locale, {
    weekday: width,
    timeZone: UTC,
  }).format(new Date(Date.UTC(2024, 0, 1 + WEEKDAY_INDEX[day], 12)));
}

function repeatPattern(
  values: ScheduledFormValues,
  locale: string | undefined,
) {
  const time = formatWallTime(values.time, locale);
  switch (values.frequency) {
    case "daily":
      return t({
        id: "scheduled.form.summary.daily",
        message: `every day at ${time}`,
      });
    case "weekdays":
      return t({
        id: "scheduled.form.summary.weekdays",
        message: `every weekday at ${time}`,
      });
    case "weekly": {
      const days = new Intl.ListFormat(locale, { type: "conjunction" }).format(
        [...values.weekdays]
          .sort((left, right) => WEEKDAY_INDEX[left] - WEEKDAY_INDEX[right])
          .map((day) => weekdayName(day, locale, "long")),
      );
      return t({
        id: "scheduled.form.summary.weekly",
        message: `every week on ${days} at ${time}`,
      });
    }
    case "monthly": {
      const day = Number(values.date.split("-")[2]);
      return t({
        id: "scheduled.form.summary.monthly",
        message: `every month on day ${day} at ${time}`,
      });
    }
  }
}

function endSentence(values: ScheduledFormValues, locale: string | undefined) {
  if (values.endKind === "on_date" && values.endDate) {
    const last = formatWallDate(values.endDate, locale);
    return t({
      id: "scheduled.form.summary.endsOn",
      message: `Not after ${last}.`,
    });
  }
  if (values.endKind === "after_count") {
    const count = Number(values.endCount);
    if (Number.isInteger(count) && count > 0) {
      return t({
        id: "scheduled.form.summary.endsAfter",
        message: plural(count, {
          one: "Only once.",
          other: "# times in all.",
        }),
      });
    }
  }
  return null;
}

/** Whether a field the schedule needs is still missing or unusable. */
function isIncomplete(values: ScheduledFormValues) {
  if (!values.date || !values.time) return true;
  if (values.triggerKind === "once") return false;
  if (values.frequency === "weekly" && values.weekdays.length === 0) {
    return true;
  }
  if (values.endKind === "on_date") return !values.endDate;
  if (values.endKind === "after_count") {
    const count = Number(values.endCount);
    return !Number.isInteger(count) || count < 1;
  }
  return false;
}

interface ScheduledTriggerSummaryProps {
  values: ScheduledFormValues;
  now: Date;
  /** The zone the times are read in; never named in the line. */
  timeZone: string | undefined;
  /**
   * ISO time a snooze moved the item to, while its schedule is as loaded:
   * the line says the snooze instead of the schedule's own times.
   */
  snoozedUntil?: string | null;
}

/** The info line under the trigger: when it happens, in plain words. */
export function ScheduledTriggerSummary({
  values,
  now,
  timeZone,
  snoozedUntil,
}: ScheduledTriggerSummaryProps) {
  const { i18n } = useLingui();
  const locale = i18n.locale || undefined;
  const first = scheduledFirstOccurrence(values, now, timeZone);

  let content: React.ReactNode;
  if (snoozedUntil) {
    const until = formatScheduledDateTime(snoozedUntil, { locale, timeZone });
    content = (
      <Trans id="scheduled.form.summary.snoozed">
        Snoozed until <strong className="font-semibold">{until}</strong>.
        Changing the schedule replaces the snooze.
      </Trans>
    );
  } else if (isIncomplete(values)) {
    content = t({
      id: "scheduled.form.summary.incomplete",
      message: "Complete the schedule to see when it happens.",
    });
  } else if (first === null) {
    content = t({
      id: "scheduled.form.summary.noTimeAhead",
      message: "This schedule has no time in the future.",
    });
  } else if (values.triggerKind === "once") {
    const when = `${formatWallDate(first, locale)}, ${formatWallTime(values.time, locale)}`;
    const relative = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto",
    }).format(daysBetweenDateKeys(localDateKey(now, timeZone), first), "day");
    content = (
      <Trans id="scheduled.form.summary.once">
        Happens on <strong className="font-semibold">{when}</strong>, {relative}
        .
      </Trans>
    );
  } else {
    const pattern = repeatPattern(values, locale);
    const firstDay = formatWallDate(first, locale);
    const ends = endSentence(values, locale);
    content = (
      <>
        <Trans id="scheduled.form.summary.repeat">
          Happens <strong className="font-semibold">{pattern}</strong>, first on{" "}
          {firstDay}.
        </Trans>
        {ends && <> {ends}</>}
      </>
    );
  }

  return (
    <Alert type="info" role="status" data-testid="scheduled-trigger-summary">
      {content}
    </Alert>
  );
}
