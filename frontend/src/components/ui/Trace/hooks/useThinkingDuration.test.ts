import { describe, expect, it } from "vitest";

import { durationBetween, formatThinkingDuration } from "./useThinkingDuration";

describe("formatThinkingDuration", () => {
  it("returns null for invalid or non-positive durations", () => {
    expect(formatThinkingDuration(null)).toBeNull();
    expect(formatThinkingDuration(0)).toBeNull();
    expect(formatThinkingDuration(-1)).toBeNull();
    expect(formatThinkingDuration(Number.NaN)).toBeNull();
    expect(formatThinkingDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("labels sub-second durations as 'less than a second'", () => {
    expect(formatThinkingDuration(1)).toBe("less than a second");
    expect(formatThinkingDuration(999)).toBe("less than a second");
  });

  it("renders sub-minute durations in seconds", () => {
    expect(formatThinkingDuration(1_000)).toBe("1s");
    expect(formatThinkingDuration(45_000)).toBe("45s");
    expect(formatThinkingDuration(59_499)).toBe("59s");
  });

  it("renders minutes-and-seconds for durations between 1 and 10 minutes", () => {
    expect(formatThinkingDuration(60_000)).toBe("1m");
    expect(formatThinkingDuration(60_999)).toBe("1m 1s");
    expect(formatThinkingDuration(3 * 60_000 + 23_000)).toBe("3m 23s");
    expect(formatThinkingDuration(9 * 60_000 + 59_000)).toBe("9m 59s");
  });

  it("drops the seconds component beyond 10 minutes", () => {
    expect(formatThinkingDuration(10 * 60_000)).toBe("10m");
    expect(formatThinkingDuration(15 * 60_000 + 30_000)).toBe("15m");
  });

  it("renders hours for very long durations", () => {
    expect(formatThinkingDuration(60 * 60_000)).toBe("1h");
    expect(formatThinkingDuration(60 * 60_000 + 5 * 60_000)).toBe("1h 5m");
    expect(formatThinkingDuration(2 * 60 * 60_000 + 30 * 60_000)).toBe(
      "2h 30m",
    );
  });
});

describe("durationBetween", () => {
  it("returns null when either timestamp is missing", () => {
    expect(durationBetween(undefined, "2026-05-07T12:00:00Z")).toBeNull();
    expect(durationBetween("2026-05-07T12:00:00Z", undefined)).toBeNull();
    expect(durationBetween(undefined, undefined)).toBeNull();
  });

  it("returns null when timestamps are unparseable", () => {
    expect(durationBetween("not-a-date", "2026-05-07T12:00:00Z")).toBeNull();
    expect(durationBetween("2026-05-07T12:00:00Z", "not-a-date")).toBeNull();
  });

  it("returns null when end is before or equal to start", () => {
    expect(
      durationBetween("2026-05-07T12:00:01Z", "2026-05-07T12:00:00Z"),
    ).toBeNull();
    expect(
      durationBetween("2026-05-07T12:00:00Z", "2026-05-07T12:00:00Z"),
    ).toBeNull();
  });

  it("returns the difference in ms for valid timestamps", () => {
    expect(
      durationBetween("2026-05-07T12:00:00Z", "2026-05-07T12:00:03Z"),
    ).toBe(3_000);
    expect(
      durationBetween("2026-05-07T12:00:00Z", "2026-05-07T12:03:23Z"),
    ).toBe(3 * 60_000 + 23_000);
  });
});
