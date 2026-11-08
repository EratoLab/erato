import { describe, expect, it } from "vitest";

import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  localDateKey,
  localTimeKey,
  snoozeUntil,
  zonedWallTimeToDate,
} from "./scheduledTime";

describe("scheduledTime", () => {
  it("reads the day and time in the given zone", () => {
    const instant = new Date("2026-11-07T23:30:00Z");

    expect(localDateKey(instant, "Europe/Berlin")).toBe("2026-11-08");
    expect(localTimeKey(instant, "Europe/Berlin")).toBe("00:30");
    expect(localDateKey(instant, "America/New_York")).toBe("2026-11-07");
  });

  it("turns a local date and time into the instant, across DST", () => {
    expect(
      zonedWallTimeToDate("2026-11-13", "10:00", "Europe/Berlin").toISOString(),
    ).toBe("2026-11-13T09:00:00.000Z");
    expect(
      zonedWallTimeToDate("2026-07-13", "10:00", "Europe/Berlin").toISOString(),
    ).toBe("2026-07-13T08:00:00.000Z");
    // 02:30 does not exist in Berlin on 29 March 2026; it lands an hour on.
    expect(
      zonedWallTimeToDate("2026-03-29", "02:30", "Europe/Berlin").toISOString(),
    ).toBe("2026-03-29T01:30:00.000Z");
  });

  it("counts and moves calendar days", () => {
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetweenDateKeys("2026-11-07", "2026-11-13")).toBe(6);
  });

  it("snoozes to tomorrow morning in the user's zone", () => {
    // 00:30 on the 8th in Berlin, still the 7th in New York.
    const now = new Date("2026-11-07T23:30:00Z");

    expect(snoozeUntil(now, "Europe/Berlin").toISOString()).toBe(
      "2026-11-09T08:00:00.000Z",
    );
    expect(snoozeUntil(now, "America/New_York").toISOString()).toBe(
      "2026-11-08T14:00:00.000Z",
    );
  });
});
