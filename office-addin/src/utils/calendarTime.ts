import type {
  WorkingHoursAnchor,
  WorkingHoursTransition,
} from "./fetchOutlookCalendar";

/**
 * Shared civil-time ↔ UTC conversion for the calendar code — the single place
 * this logic lives. All-day events are floating civil dates (no instant), but
 * the two backends put them on the wire with OPPOSITE conventions, so the date
 * must be recovered differently per backend; working-hours minutes are civil
 * wall-clock anchored to a zone (IANA name or EWS offset rules).
 */

const MINUTE_MS = 60_000;

/**
 * The civil date (`YYYY-MM-DD`) of a UTC instant (ISO string or epoch ms) AS
 * OBSERVED in `ianaZone`.
 *
 * EWS returns an all-day event as the UTC instant of local midnight (e.g. a
 * UTC+2 mailbox's July 2 all-day comes back as `2026-07-01T22:00:00Z`), so the
 * civil date must be read as the wall-clock date in the anchor zone. Never
 * `.slice(0,10)` such a UTC string — that's the classic all-day next-day-shift
 * bug (localize first, THEN take the date).
 */
export function utcInstantToCivilDate(
  instant: string | number,
  ianaZone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The civil date of a Graph floating-midnight all-day value. Graph labels
 * all-day midnights `Z` but does NOT offset-shift them, so the date part is
 * already correct — take it directly, do NOT localize.
 */
export function graphFloatingDate(dateTime: string): string {
  return dateTime.slice(0, 10);
}

// --- Zone math (Intl-based, no deps) -----------------------------------------

function utcWallClockMs(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
}

/**
 * UTC instant of civil `date` + `minutes` wall-clock in `zone`. Two-pass
 * offset resolution: exact except inside a DST transition, where the
 * second pass still lands on ONE deterministic instant.
 */
export function zonedCivilToUtcMs(
  date: string,
  minutes: number,
  zone: string,
): number {
  const guess = Date.parse(`${date}T00:00:00Z`) + minutes * MINUTE_MS;
  const offset1 = utcWallClockMs(guess, zone) - guess;
  const candidate = guess - offset1;
  const offset2 = utcWallClockMs(candidate, zone) - candidate;
  return offset2 === offset1 ? candidate : guess - offset2;
}

/** UTC instant of the nth/last-`dayOfWeek`-of-`month` transition in `year`;
 * the rule's wall-clock time is in the phase being LEFT (`offsetBefore`,
 * minutes east) — the Windows TIME_ZONE_INFORMATION convention. */
function transitionUtcMs(
  year: number,
  rule: WorkingHoursTransition,
  offsetBefore: number,
): number {
  let day: number;
  if (rule.dayOrder >= 5) {
    const daysInMonth = new Date(Date.UTC(year, rule.month, 0)).getUTCDate();
    const lastDow = new Date(
      Date.UTC(year, rule.month - 1, daysInMonth),
    ).getUTCDay();
    day = daysInMonth - ((lastDow - rule.dayOfWeek + 7) % 7);
  } else {
    const firstDow = new Date(Date.UTC(year, rule.month - 1, 1)).getUTCDay();
    day = 1 + ((rule.dayOfWeek - firstDow + 7) % 7) + (rule.dayOrder - 1) * 7;
  }
  return (
    Date.UTC(year, rule.month - 1, day) +
    rule.timeMinutes * MINUTE_MS -
    offsetBefore * MINUTE_MS
  );
}

/**
 * UTC instant of civil `date` + wall-clock `minutes` in a rules-defined zone
 * (the EWS availability shape — offsets + two yearly transitions, no IANA
 * name). This is what ical.js does for VTIMEZONE and .NET's AdjustmentRule
 * does for this exact struct; the 1h ambiguity AT a transition resolves to
 * the standard phase, immaterial for working-hours windows. A southern-
 * hemisphere DST window (daylightStart after standardStart) wraps year-end.
 */
export function rulesCivilToUtcMs(
  date: string,
  minutes: number,
  rules: Extract<WorkingHoursAnchor, { kind: "rules" }>,
): number {
  const civilAsUtc = Date.parse(`${date}T00:00:00Z`) + minutes * MINUTE_MS;
  let offset = rules.standardOffset;
  if (
    rules.daylightStart !== undefined &&
    rules.standardStart !== undefined &&
    rules.daylightOffset !== rules.standardOffset
  ) {
    const year = Number(date.slice(0, 4));
    const dstStart = transitionUtcMs(
      year,
      rules.daylightStart,
      rules.standardOffset,
    );
    const stdStart = transitionUtcMs(
      year,
      rules.standardStart,
      rules.daylightOffset,
    );
    const candidate = civilAsUtc - rules.standardOffset * MINUTE_MS;
    const inDst =
      dstStart <= stdStart
        ? candidate >= dstStart && candidate < stdStart
        : candidate >= dstStart || candidate < stdStart;
    if (inDst) offset = rules.daylightOffset;
  }
  return civilAsUtc - offset * MINUTE_MS;
}
