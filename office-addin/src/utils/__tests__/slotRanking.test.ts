import { describe, expect, it } from "vitest";

import {
  inferTypicalDurationMinutes,
  rankAvailabilitySlots,
  zonedCivilToUtcMs,
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

  it("assumes Mon-Fri 09:00-17:00 when working hours are null and flags it", () => {
    const { slots, workingHoursAssumed } = rankAvailabilitySlots(
      { ...baseCalendar, workingHours: null },
      RANKING_OPTIONS,
    );
    expect(workingHoursAssumed).toBe(true);
    // Same window as the explicit fixture, so the earliest slot is unchanged.
    expect(slots[0].startUtc).toBe("2026-07-06T07:00:00Z");
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
