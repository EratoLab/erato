/**
 * A value as the voice says it: a date with the month's name, a time, a
 * number, yes or no, or text. Read off the value as the call wrote it; how
 * each is said is up to the language.
 */
export type EarValue =
  | { kind: "date"; year: number; month: number; day: number }
  | {
      kind: "datetime";
      year: number;
      month: number;
      day: number;
      hour: number;
      minute: number;
    }
  | { kind: "number"; value: number; percent: boolean }
  | { kind: "bool"; value: boolean }
  | { kind: "text"; text: string }
  /** A record named by an ID that nothing in the chat named. */
  | { kind: "unread" }
  /** A value shown only as an ID. */
  | { kind: "id" };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

const validDate = (year: number, month: number, day: number): boolean =>
  month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1000;

/** The wall-clock fields of `instant` in `timeZone`. */
const inZone = (instant: Date, timeZone: string) => {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a locale whose parts are plain numbers
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: string) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
};

/**
 * Reads a value written by a call. A time with an offset is said in
 * `timeZone`, the user's; a time without one as written. A midnight without
 * an offset is a date.
 */
export const earValue = (
  written: string,
  { percent = false, timeZone }: { percent?: boolean; timeZone?: string } = {},
): EarValue => {
  const text = written.trim();
  const date = DATE.exec(text);
  if (date) {
    const [year, month, day] = date.slice(1).map(Number);
    if (validDate(year, month, day)) return { kind: "date", year, month, day };
  }
  const time = DATE_TIME.exec(text);
  if (time) {
    const [year, month, day, hour, minute] = time.slice(1, 6).map(Number);
    const zone = time[7] as string | undefined;
    if (validDate(year, month, day) && hour < 24 && minute < 60) {
      if (zone) {
        const instant = new Date(text);
        if (!Number.isNaN(instant.getTime())) {
          return {
            kind: "datetime",
            ...inZone(
              instant,
              timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
            ),
          };
        }
      } else if (hour === 0 && minute === 0) {
        return { kind: "date", year, month, day };
      } else {
        return { kind: "datetime", year, month, day, hour, minute };
      }
    }
  }
  if (NUMBER.test(text))
    return { kind: "number", value: Number(text), percent };
  if (text === "true" || text === "false") {
    return { kind: "bool", value: text === "true" };
  }
  return { kind: "text", text };
};

/** Whether two values are said with the same unit, so it is said once. */
export const bothPercent = (a: EarValue, b: EarValue): boolean =>
  a.kind === "number" && b.kind === "number" && a.percent && b.percent;
