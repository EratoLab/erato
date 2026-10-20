import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  formatAppointmentWhen,
  formatClockTime,
  formatDateTime,
  formatShortDate,
} from "../outlookContextFormat";

// ICU puts thin and narrow no-break spaces around ranges and day periods.
const plain = (text: string) => text.replace(/\s/gu, " ");

// Local wall times, so the strings hold in any time zone.
const start = new Date(2026, 9, 23, 10, 0);
const end = new Date(2026, 9, 23, 11, 0);

function inLocale(locale: string) {
  i18n.loadAndActivate({ locale, messages: {} });
}

afterEach(() => inLocale("en"));

describe("outlookContextFormat", () => {
  it("reads in the app's language, not the browser's", () => {
    inLocale("en");
    expect(formatShortDate(new Date(2026, 9, 7))).toBe("10/7/2026");
    expect(plain(formatClockTime(new Date(2026, 9, 23, 15, 40)))).toBe(
      "3:40 PM",
    );
    expect(plain(formatDateTime(new Date(2026, 9, 6, 9, 14)))).toBe(
      "Oct 6, 2026, 9:14 AM",
    );
    expect(plain(formatAppointmentWhen(start, end))).toBe(
      "Fri, Oct 23, 10:00 – 11:00 AM",
    );
    expect(plain(formatAppointmentWhen(start, end, { long: true }))).toBe(
      "Fri, Oct 23, 2026, 10:00 – 11:00 AM",
    );

    inLocale("de");
    expect(formatShortDate(new Date(2026, 9, 7))).toBe("7.10.2026");
    expect(formatClockTime(new Date(2026, 9, 23, 15, 40))).toBe("15:40");
    expect(plain(formatDateTime(new Date(2026, 9, 6, 9, 14)))).toBe(
      "06.10.2026, 09:14",
    );
    expect(plain(formatAppointmentWhen(start, end))).toBe(
      "Fr., 23. Okt., 10:00–11:00 Uhr",
    );
  });

  it("takes ISO strings and says nothing for a missing or broken date", () => {
    inLocale("en");
    expect(formatShortDate(new Date(2026, 9, 7).toISOString())).toBe(
      "10/7/2026",
    );
    expect(formatShortDate(null)).toBe("");
    expect(formatDateTime("not a date")).toBe("");
    expect(formatClockTime(undefined)).toBe("");
    expect(formatAppointmentWhen(null, end)).toBe("");
  });

  it("gives the start alone without a usable end", () => {
    inLocale("en");
    expect(plain(formatAppointmentWhen(start, null))).toBe(
      "Fri, Oct 23, 10:00 AM",
    );
    expect(plain(formatAppointmentWhen(end, start))).toBe(
      "Fri, Oct 23, 11:00 AM",
    );
  });
});
