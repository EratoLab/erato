import { describe, expect, it } from "vitest";

import { rulesCivilToUtcMs, zonedCivilToUtcMs } from "../calendarTime";
import {
  inferTypicalDurationMinutes,
  rankAvailabilitySlots,
} from "../slotRanking";

import type {
  NormalizedCalendar,
  NormalizedHistoryMeeting,
} from "../fetchOutlookCalendar";

/** Berlin, July (CEST, +02:00). Working hours 09:00–17:00 = 07:00–15:00Z. */
const baseCalendar: NormalizedCalendar = {
  workingHours: {
    daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    startMinutes: 540,
    endMinutes: 1020,
  },
  busyBlocks: [
    {
      // Monday 10:00–11:00 local.
      when: {
        kind: "date-time",
        startUtc: "2026-07-06T08:00:00Z",
        endUtc: "2026-07-06T09:00:00Z",
      },
      busyType: "Busy",
      subject: "Standup",
    },
    {
      // Free-typed block spanning Thursday's whole window — must NOT block.
      when: {
        kind: "date-time",
        startUtc: "2026-07-09T07:00:00Z",
        endUtc: "2026-07-09T15:00:00Z",
      },
      busyType: "Free",
    },
    {
      // All-day OOF Wednesday — blocks the entire day.
      when: {
        kind: "date",
        startDate: "2026-07-08",
        endDateExclusive: "2026-07-09",
      },
      busyType: "OOF",
    },
  ],
  historyMeetings: [],
  attendees: [
    {
      requested: "alice@example.de",
      smtp: "alice@example.de",
      status: "ok",
      // Tuesday 09:00–15:00 local.
      busy: [
        {
          when: {
            kind: "date-time",
            startUtc: "2026-07-07T07:00:00Z",
            endUtc: "2026-07-07T13:00:00Z",
          },
          busyType: "Busy",
        },
      ],
    },
    { requested: "Nemo", status: "unknown", reason: "not found", busy: [] },
  ],
  displayTimeZone: "Europe/Berlin",
  degradedLegs: [],
};

// Monday 08:00 local — before the working window opens.
const RANKING_OPTIONS = {
  nowUtc: "2026-07-06T06:00:00Z",
  windowEndUtc: "2026-07-11T06:00:00Z",
  durationMinutes: 60,
};

describe("rankAvailabilitySlots", () => {
  it("is deterministic and respects blocking, buffers, working hours and attendees", () => {
    const first = rankAvailabilitySlots(baseCalendar, RANKING_OPTIONS);
    const second = rankAvailabilitySlots(baseCalendar, RANKING_OPTIONS);
    expect(second).toEqual(first);

    const { slots, workingHoursAssumed } = first;
    expect(workingHoursAssumed).toBe(false);
    expect(slots.length).toBeGreaterThan(0);

    // Chronologically first valid slot: Monday 09:00 local, before the standup.
    expect(slots[0]).toMatchObject({
      tier: "earliest",
      startUtc: "2026-07-06T07:00:00Z",
      endUtc: "2026-07-06T08:00:00Z",
    });

    for (const slot of slots) {
      const day = slot.startUtc.slice(0, 10);
      // All-day OOF Wednesday and the weekend never host a slot.
      expect(day).not.toBe("2026-07-08");
      expect(["2026-07-11", "2026-07-12"]).not.toContain(day);
      // Never overlap the standup (Monday 08:00–09:00Z).
      const start = Date.parse(slot.startUtc);
      const end = Date.parse(slot.endUtc);
      expect(
        end <= Date.parse("2026-07-06T08:00:00Z") ||
          start >= Date.parse("2026-07-06T09:00:00Z"),
      ).toBe(true);
      // Never overlap the attendee's Tuesday block (07:00–13:00Z).
      if (day === "2026-07-07") {
        expect(start >= Date.parse("2026-07-07T13:00:00Z")).toBe(true);
      }
    }

    // The Free-typed block does not block: Thursday still offers its day-start.
    expect(slots.some((s) => s.startUtc === "2026-07-09T07:00:00Z")).toBe(true);

    // Buffer rule: the post-standup Monday slot starts 15 min after it ends.
    expect(slots.some((s) => s.startUtc === "2026-07-06T09:15:00Z")).toBe(true);

    // Smart picks exist and carry a reason.
    const smart = slots.filter((s) => s.tier === "smart");
    expect(smart.length).toBeGreaterThan(0);
    expect(smart.every((s) => (s.reason ?? "") !== "")).toBe(true);
  });

  it("clips to now: mid-morning start pushes the earliest slot behind the meeting", () => {
    const { slots } = rankAvailabilitySlots(baseCalendar, {
      ...RANKING_OPTIONS,
      // Monday 10:30 local, during the standup.
      nowUtc: "2026-07-06T08:30:00Z",
    });
    expect(slots[0]).toMatchObject({
      tier: "earliest",
      startUtc: "2026-07-06T09:15:00Z",
    });
    expect(
      slots.every(
        (s) => Date.parse(s.startUtc) >= Date.parse("2026-07-06T08:30:00Z"),
      ),
    ).toBe(true);
  });

  it("buffers the first gap when a meeting ends just before the window start", () => {
    const { slots } = rankAvailabilitySlots(
      {
        ...baseCalendar,
        busyBlocks: [
          {
            // Ends ONE minute before `now` — must still trigger the buffer.
            when: {
              kind: "date-time",
              startUtc: "2026-07-06T08:00:00Z",
              endUtc: "2026-07-06T08:59:00Z",
            },
            busyType: "Busy",
          },
        ],
        attendees: [],
      },
      { ...RANKING_OPTIONS, nowUtc: "2026-07-06T09:00:00Z" },
    );
    // 09:00 + 15-min buffer; without the reach-back seed this would be 09:00.
    expect(slots[0].startUtc).toBe("2026-07-06T09:15:00Z");
  });

  it("assumes Mon-Fri 09:00-17:00 when working hours are null and flags it", () => {
    const { slots, workingHoursAssumed } = rankAvailabilitySlots(
      { ...baseCalendar, workingHours: null },
      RANKING_OPTIONS,
    );
    expect(workingHoursAssumed).toBe(true);
    // Same window as the explicit fixture, so the earliest slot is unchanged.
    expect(slots[0].startUtc).toBe("2026-07-06T07:00:00Z");
  });

  it("breaks smart-pick score ties on earlier start", () => {
    // Empty week: all candidates (day-start + back-edge per day) score the
    // same (buffer 1, lightness 1, 0 fragments) — smart picks = 3 earliest.
    const { slots } = rankAvailabilitySlots(
      { ...baseCalendar, busyBlocks: [], attendees: [] },
      RANKING_OPTIONS,
    );
    expect(slots[0].startUtc).toBe("2026-07-06T07:00:00Z");
    expect(
      slots.filter((s) => s.tier === "smart").map((s) => s.startUtc),
    ).toEqual([
      "2026-07-06T14:00:00Z",
      "2026-07-07T07:00:00Z",
      "2026-07-07T14:00:00Z",
    ]);
  });

  it("returns no slots when everything is blocked", () => {
    const { slots } = rankAvailabilitySlots(
      {
        ...baseCalendar,
        busyBlocks: [
          {
            when: {
              kind: "date-time",
              startUtc: "2026-07-01T00:00:00Z",
              endUtc: "2026-08-01T00:00:00Z",
            },
            busyType: "Busy",
          },
        ],
        attendees: [],
      },
      RANKING_OPTIONS,
    );
    expect(slots).toEqual([]);
  });
});

describe("inferTypicalDurationMinutes", () => {
  const meeting = (minutes: number): NormalizedHistoryMeeting => ({
    when: {
      kind: "date-time",
      startUtc: "2026-06-01T08:00:00Z",
      endUtc: new Date(
        Date.parse("2026-06-01T08:00:00Z") + minutes * 60_000,
      ).toISOString(),
    },
    subject: "m",
  });

  it("needs at least three timed samples", () => {
    expect(inferTypicalDurationMinutes([])).toBeNull();
    expect(inferTypicalDurationMinutes([meeting(30), meeting(60)])).toBeNull();
  });

  it("takes the median rounded to 15 minutes", () => {
    expect(
      inferTypicalDurationMinutes([meeting(30), meeting(45), meeting(60)]),
    ).toBe(45);
    expect(
      inferTypicalDurationMinutes([
        meeting(25),
        meeting(30),
        meeting(35),
        meeting(55),
      ]),
    ).toBe(30);
  });

  it("clamps to [15, 240]", () => {
    expect(
      inferTypicalDurationMinutes([meeting(5), meeting(5), meeting(5)]),
    ).toBe(15);
    expect(
      inferTypicalDurationMinutes([meeting(300), meeting(300), meeting(300)]),
    ).toBe(240);
  });
});

describe("zonedCivilToUtcMs", () => {
  it("resolves civil wall-clock across DST", () => {
    expect(zonedCivilToUtcMs("2026-07-06", 540, "Europe/Berlin")).toBe(
      Date.parse("2026-07-06T07:00:00Z"),
    );
    expect(zonedCivilToUtcMs("2026-01-05", 540, "Europe/Berlin")).toBe(
      Date.parse("2026-01-05T08:00:00Z"),
    );
  });
});

describe("rulesCivilToUtcMs", () => {
  // W. Europe as EWS serializes it: UTC+1, DST +2 from the last Sunday of
  // March 02:00 to the last Sunday of October 03:00.
  const BERLIN_RULES = {
    kind: "rules" as const,
    standardOffset: 60,
    daylightOffset: 120,
    daylightStart: { month: 3, dayOrder: 5, dayOfWeek: 0, timeMinutes: 120 },
    standardStart: { month: 10, dayOrder: 5, dayOfWeek: 0, timeMinutes: 180 },
  };

  it("applies the DST phase per date (matches Intl for the same zone)", () => {
    expect(rulesCivilToUtcMs("2026-07-06", 480, BERLIN_RULES)).toBe(
      Date.parse("2026-07-06T06:00:00Z"),
    );
    expect(rulesCivilToUtcMs("2026-01-15", 480, BERLIN_RULES)).toBe(
      Date.parse("2026-01-15T07:00:00Z"),
    );
    // 2026-03-29 IS the last Sunday of March: 09:00 falls after the 02:00
    // spring-forward, so the daylight offset applies.
    expect(rulesCivilToUtcMs("2026-03-29", 540, BERLIN_RULES)).toBe(
      Date.parse("2026-03-29T07:00:00Z"),
    );
    // The day before the transition is still standard time.
    expect(rulesCivilToUtcMs("2026-03-28", 540, BERLIN_RULES)).toBe(
      Date.parse("2026-03-28T08:00:00Z"),
    );
  });

  it("treats missing transitions as a fixed offset", () => {
    const fixed = {
      kind: "rules" as const,
      standardOffset: 60,
      daylightOffset: 60,
    };
    expect(rulesCivilToUtcMs("2026-07-06", 480, fixed)).toBe(
      Date.parse("2026-07-06T07:00:00Z"),
    );
    expect(rulesCivilToUtcMs("2026-01-15", 480, fixed)).toBe(
      Date.parse("2026-01-15T07:00:00Z"),
    );
  });
});

describe("attendee working hours", () => {
  it("prefers slots inside every shared attendee window (soft, never a filter)", () => {
    const { slots } = rankAvailabilitySlots(
      {
        ...baseCalendar,
        busyBlocks: [],
        attendees: [
          {
            requested: "ny@example.de",
            smtp: "ny@example.de",
            status: "ok",
            busy: [],
            // NY 9-17 seen from Berlin = 15:00-23:00; overlap with the user's
            // 09:00-17:00 Berlin window is 15:00-17:00 (13:00-15:00Z).
            workingHours: {
              daysOfWeek: [
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
              ],
              startMinutes: 540,
              endMinutes: 1020,
              anchor: { kind: "iana", zone: "America/New_York" },
            },
          },
        ],
      },
      RANKING_OPTIONS,
    );

    const overlapTagged = slots.filter((s) =>
      (s.reason ?? "").includes("inside everyone's working hours"),
    );
    expect(overlapTagged.length).toBeGreaterThan(0);
    for (const slot of overlapTagged) {
      // Tagged slots really lie inside the mutual window (13:00-15:00Z).
      const hour = new Date(slot.startUtc).getUTCHours();
      expect(hour).toBeGreaterThanOrEqual(13);
      expect(Date.parse(slot.endUtc)).toBeLessThanOrEqual(
        Date.parse(slot.startUtc.slice(0, 10) + "T15:00:00Z"),
      );
    }
    // The top smart pick lands in the overlap — the bonus dominates.
    const smart = slots.find((s) => s.tier === "smart");
    expect(smart?.reason).toContain("inside everyone's working hours");
    // Slots outside the overlap still exist: soft preference, not a filter.
    expect(
      slots.some((s) => !(s.reason ?? "").includes("inside everyone's")),
    ).toBe(true);
  });
});

describe("working-hours anchor", () => {
  it("computes the working window in the anchor zone, not the display zone", () => {
    const { slots } = rankAvailabilitySlots(
      {
        ...baseCalendar,
        busyBlocks: [],
        attendees: [],
        // NY-anchored 09:00-17:00 viewed from Berlin: the Monday window is
        // 13:00-21:00 UTC, NOT Berlin's 07:00-15:00 UTC.
        workingHours: {
          daysOfWeek: baseCalendar.workingHours!.daysOfWeek,
          startMinutes: 540,
          endMinutes: 1020,
          anchor: { kind: "iana", zone: "America/New_York" },
        },
      },
      RANKING_OPTIONS,
    );
    expect(slots[0].startUtc).toBe("2026-07-06T13:00:00Z");
  });
});
