/**
 * Wall-clock arithmetic in a named IANA zone, without a time zone library.
 * Scheduled times are entered and stored as local date and time in the
 * user's stored zone, which need not be the browser's.
 */

// en-CA formats a date as YYYY-MM-DD, which doubles as a sortable day key.
// eslint-disable-next-line lingui/no-unlocalized-strings -- format locale, not copy
const DAY_KEY_LOCALE = "en-CA";

/** The day `date` falls on in `timeZone` (the browser's when omitted), as `YYYY-MM-DD`. */
export function localDateKey(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(DAY_KEY_LOCALE, {
    year: "numeric",
    month: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
    day: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
    timeZone,
  }).format(date);
}

/** The time of day `date` shows in `timeZone`, as `HH:MM`. */
export function localTimeKey(date: Date, timeZone?: string): string {
  const parts = wallClockParts(date, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

const utcMidnight = (key: string, days = 0) => {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day + days);
};

/** `YYYY-MM-DD` moved by whole calendar days. */
export function addDaysToDateKey(key: string, days: number): string {
  const moved = new Date(utcMidnight(key, days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(
    moved.getUTCDate(),
  )}`;
}

/** Whole calendar days from one `YYYY-MM-DD` to another. */
export function daysBetweenDateKeys(fromKey: string, toKey: string): number {
  return Math.round(
    (utcMidnight(toKey) - utcMidnight(fromKey)) / (24 * 60 * 60 * 1000),
  );
}

const pad = (value: number) => String(value).padStart(2, "0");

function wallClockParts(date: Date, timeZone: string | undefined) {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- format locale, not copy
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function zoneOffset(instant: number, timeZone: string | undefined): number {
  const parts = wallClockParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - (instant - (instant % 1000));
}

/**
 * The instant a local date (`YYYY-MM-DD`) and time (`HH:MM`) name in
 * `timeZone`. A time skipped by a DST change resolves to the hour after.
 */
export function zonedWallTimeToDate(
  dateKey: string,
  time: string,
  timeZone?: string,
): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = asUtc - zoneOffset(asUtc, timeZone);
  // The offset at the guess can differ from the one at the result across a
  // DST change; a second pass settles on the offset that applies there.
  const second = asUtc - zoneOffset(first, timeZone);
  return new Date(second);
}

/** The hour a snooze moves an item to, the next morning. */
export const SCHEDULED_SNOOZE_HOUR = 9;

/** Tomorrow at the snooze hour in `timeZone`. */
export function snoozeUntil(now: Date, timeZone?: string): Date {
  return zonedWallTimeToDate(
    addDaysToDateKey(localDateKey(now, timeZone), 1),
    `${pad(SCHEDULED_SNOOZE_HOUR)}:00`,
    timeZone,
  );
}
