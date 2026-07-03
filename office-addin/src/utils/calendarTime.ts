/**
 * Shared all-day date helpers for the calendar normalizers. All-day events are
 * floating civil dates (no instant), but the two backends put them on the wire
 * with OPPOSITE conventions, so the date must be recovered differently per
 * backend. Centralizing that here is the single place all-day date logic lives.
 */

/**
 * The civil date (`YYYY-MM-DD`) of a UTC instant AS OBSERVED in `ianaZone`.
 *
 * EWS returns an all-day event as the UTC instant of local midnight (e.g. a
 * UTC+2 mailbox's July 2 all-day comes back as `2026-07-01T22:00:00Z`), so the
 * civil date must be read as the wall-clock date in the anchor zone. Never
 * `.slice(0,10)` such a UTC string — that's the classic all-day next-day-shift
 * bug (localize first, THEN take the date).
 */
export function utcInstantToCivilDate(iso: string, ianaZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
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
