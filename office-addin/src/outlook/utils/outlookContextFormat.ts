import { i18n } from "@lingui/core";

// Dates and times read in the app's language, not the browser's: a German UI
// on an English system still says "23.10.2026".
const locale = () => i18n.locale || "en";

const valid = (date: Date) => !Number.isNaN(date.getTime());

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return valid(date) ? date : null;
};

/** A dropped email's date, with the full year: "10/7/2026", "7.10.2026". */
export function formatShortDate(value: string | Date | null | undefined) {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat(locale(), {
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).format(date)
    : "";
}

/** A thread message's date and time. */
export function formatDateTime(value: string | Date | null | undefined) {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat(locale(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    : "";
}

/** The clock time scheduling stays on until, in the locale's hour cycle. */
export function formatClockTime(value: string | Date | null | undefined) {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat(locale(), { timeStyle: "short" }).format(date)
    : "";
}

/**
 * An appointment's span: short for the chip ("Thu, Oct 23, 10:00 – 11:00 AM"),
 * with the year for the detail. Without an end it is the start alone.
 */
export function formatAppointmentWhen(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  { long = false }: { long?: boolean } = {},
): string {
  const from = toDate(start);
  if (!from) return "";
  const to = toDate(end);
  const format = new Intl.DateTimeFormat(locale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(long ? { year: "numeric" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
  return to && to.getTime() >= from.getTime()
    ? format.formatRange(from, to)
    : format.format(from);
}
