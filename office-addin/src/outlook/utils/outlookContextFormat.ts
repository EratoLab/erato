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

/**
 * An attachment's type as the file tiles name it, from its extension ("PDF");
 * the MIME type only when the name has none.
 */
export function attachmentTypeLabel(name: string, contentType: string) {
  const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(name.trim())?.[1];
  return extension ? extension.toUpperCase() : contentType;
}

/** The clock time scheduling stays on until, in the locale's hour cycle. */
export function formatClockTime(value: string | Date | null | undefined) {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat(locale(), { timeStyle: "short" }).format(date)
    : "";
}

/** A zone Intl does not know falls back to the runtime's, rather than throwing. */
function dateTimeFormat(
  options: Intl.DateTimeFormatOptions,
  timeZone: string | undefined,
): Intl.DateTimeFormat {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat(locale(), { ...options, timeZone });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return new Intl.DateTimeFormat(locale(), options);
}

/**
 * An appointment's span: short for the chip ("Thu, Oct 23, 10:00 – 11:00 AM"),
 * with the year for the detail. Without an end it is the start alone. A sent
 * appointment reads in the zone it was sent from (`timeZone`, an IANA name).
 */
export function formatAppointmentWhen(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  { long = false, timeZone }: { long?: boolean; timeZone?: string } = {},
): string {
  const from = toDate(start);
  if (!from) return "";
  const to = toDate(end);
  const format = dateTimeFormat(
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(long ? { year: "numeric" as const } : {}),
      hour: "numeric",
      minute: "2-digit",
    },
    timeZone,
  );
  return to && to.getTime() >= from.getTime()
    ? format.formatRange(from, to)
    : format.format(from);
}
