import { describe, it, expect, vi } from "vitest";

import {
  FETCH_AVAILABILITY_TOOL_NAME,
  containsFetchAvailabilityToolUse,
  createFetchAvailabilityExecutor,
  parseLookaheadDays,
  serializeCalendarForModel,
  toLocalOffsetIso,
} from "../outlookScheduleTool";

import type {
  NormalizedCalendar,
  OutlookCalendarFetcher,
} from "../fetchOutlookCalendar";
import type { ContentPart } from "@erato/frontend/library";

const emptyCalendar: NormalizedCalendar = {
  workingHours: null,
  busyBlocks: [],
  historyMeetings: [],
  displayTimeZone: "Europe/Berlin",
  degradedLegs: [],
};

const NOW = new Date("2026-07-03T12:00:00Z");

describe("serializeCalendarForModel", () => {
  it("localizes timed busy blocks into the display zone with per-instant offsets", () => {
    const result = serializeCalendarForModel(
      {
        ...emptyCalendar,
        busyBlocks: [
          {
            // July in Berlin: CEST, +02:00.
            when: {
              kind: "date-time",
              startUtc: "2026-07-06T07:00:00Z",
              endUtc: "2026-07-06T08:30:00Z",
            },
            busyType: "Busy",
            subject: "Standup",
          },
          {
            // January in Berlin: CET, +01:00 — offsets must be per-instant.
            when: {
              kind: "date-time",
              startUtc: "2026-01-12T08:00:00Z",
              endUtc: "2026-01-12T09:00:00Z",
            },
            busyType: "Tentative",
          },
        ],
      },
      NOW,
    );

    expect(result.busy).toEqual([
      {
        day: "Monday 2026-01-12",
        start: "09:00",
        end: "10:00",
        utcOffset: "+01:00",
        busyType: "Tentative",
      },
      {
        day: "Monday 2026-07-06",
        start: "09:00",
        end: "10:30",
        utcOffset: "+02:00",
        busyType: "Busy",
        subject: "Standup",
      },
    ]);
  });

  it("keeps all-day events as labelled civil days (single and multi-day)", () => {
    const result = serializeCalendarForModel(
      {
        ...emptyCalendar,
        busyBlocks: [
          {
            when: {
              kind: "date",
              startDate: "2026-07-10",
              endDateExclusive: "2026-07-11",
            },
            busyType: "OOF",
            subject: "Vacation day",
          },
          {
            when: {
              kind: "date",
              startDate: "2026-07-20",
              endDateExclusive: "2026-07-23",
            },
            busyType: "OOF",
          },
        ],
      },
      NOW,
    );

    expect(result.busy).toEqual([
      {
        day: "Friday 2026-07-10",
        allDay: true,
        busyType: "OOF",
        subject: "Vacation day",
      },
      {
        firstDay: "Monday 2026-07-20",
        lastDay: "Wednesday 2026-07-22",
        allDay: true,
        busyType: "OOF",
      },
    ]);
  });

  it("names the end day only when a timed event crosses local midnight", () => {
    const result = serializeCalendarForModel(
      {
        ...emptyCalendar,
        busyBlocks: [
          {
            // 23:00–01:00 Berlin local.
            when: {
              kind: "date-time",
              startUtc: "2026-07-06T21:00:00Z",
              endUtc: "2026-07-06T23:00:00Z",
            },
            busyType: "Busy",
          },
        ],
      },
      NOW,
    );

    expect(result.busy).toEqual([
      {
        day: "Monday 2026-07-06",
        start: "23:00",
        end: "01:00",
        endDay: "Tuesday 2026-07-07",
        utcOffset: "+02:00",
        busyType: "Busy",
      },
    ]);
  });

  it("renders working hours as HH:MM and localizes now", () => {
    const result = serializeCalendarForModel(
      {
        ...emptyCalendar,
        workingHours: {
          daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
          startMinutes: 480,
          endMinutes: 1020,
        },
      },
      NOW,
    );

    expect(result.workingHours).toEqual({
      days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      start: "08:00",
      end: "17:00",
    });
    expect(result.now).toEqual({
      day: "Friday 2026-07-03",
      time: "14:00",
      utcOffset: "+02:00",
    });
    expect(result.timezone).toBe("Europe/Berlin");
    expect(result.legend).toContain("BLOCK");
  });

  it("passes null working hours and degraded legs through for the legend rules", () => {
    const result = serializeCalendarForModel(
      { ...emptyCalendar, degradedLegs: ["busy"] },
      NOW,
    );

    expect(result.workingHours).toBeNull();
    expect(result.degraded).toEqual(["busy"]);
  });

  it("computes durations for recent meetings and keeps calibration fields", () => {
    const result = serializeCalendarForModel(
      {
        ...emptyCalendar,
        historyMeetings: [
          {
            when: {
              kind: "date-time",
              startUtc: "2026-06-22T08:00:00Z",
              endUtc: "2026-06-22T08:45:00Z",
            },
            subject: "Jour fixe",
            attendeeCount: 4,
            isRecurring: true,
          },
        ],
      },
      NOW,
    );

    expect(result.recentMeetings).toEqual([
      {
        day: "Monday 2026-06-22",
        start: "10:00",
        end: "10:45",
        utcOffset: "+02:00",
        durationMinutes: 45,
        subject: "Jour fixe",
        attendeeCount: 4,
        isRecurring: true,
      },
    ]);
  });

  it("truncates oversized lists keeping the soonest busy and latest history", () => {
    const busyBlocks = Array.from({ length: 305 }, (_, i) => ({
      when: {
        kind: "date-time" as const,
        startUtc: new Date(
          Date.parse("2026-07-06T07:00:00Z") + i * 3_600_000,
        ).toISOString(),
        endUtc: new Date(
          Date.parse("2026-07-06T07:30:00Z") + i * 3_600_000,
        ).toISOString(),
      },
      busyType: "Busy" as const,
    }));
    const historyMeetings = Array.from({ length: 155 }, (_, i) => ({
      when: {
        kind: "date-time" as const,
        startUtc: new Date(
          Date.parse("2026-06-01T07:00:00Z") + i * 3_600_000,
        ).toISOString(),
        endUtc: new Date(
          Date.parse("2026-06-01T07:30:00Z") + i * 3_600_000,
        ).toISOString(),
      },
      subject: `m${i}`,
    }));

    const result = serializeCalendarForModel(
      { ...emptyCalendar, busyBlocks, historyMeetings },
      NOW,
    ) as {
      busy: { start: string }[];
      recentMeetings: { subject: string }[];
      notes: string[];
    };

    expect(result.busy).toHaveLength(300);
    // Soonest kept: the first serialized block is the earliest one.
    expect(result.busy[0].start).toBe("09:00");
    expect(result.recentMeetings).toHaveLength(150);
    // Latest kept: the last five oldest fell off, so m5 leads.
    expect(result.recentMeetings[0].subject).toBe("m5");
    expect(result.notes).toHaveLength(2);
  });

  it("trims very long subjects", () => {
    const result = serializeCalendarForModel(
      {
        ...emptyCalendar,
        busyBlocks: [
          {
            when: {
              kind: "date-time",
              startUtc: "2026-07-06T07:00:00Z",
              endUtc: "2026-07-06T08:00:00Z",
            },
            busyType: "Busy",
            subject: "x".repeat(200),
          },
        ],
      },
      NOW,
    ) as { busy: { subject: string }[] };

    expect(result.busy[0].subject).toHaveLength(121);
    expect(result.busy[0].subject.endsWith("…")).toBe(true);
  });
});

describe("toLocalOffsetIso", () => {
  it("produces a local wall-clock ISO with the browser offset", () => {
    const iso = toLocalOffsetIso("2026-07-03T12:00:00Z");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    // Round-trips to the same instant regardless of the runner's zone.
    expect(Date.parse(iso)).toBe(Date.parse("2026-07-03T12:00:00Z"));
  });

  it("passes unparseable input through", () => {
    expect(toLocalOffsetIso("not-a-date")).toBe("not-a-date");
  });
});

describe("parseLookaheadDays", () => {
  it("defaults on absent/invalid input and clamps to the window", () => {
    expect(parseLookaheadDays(null)).toBe(14);
    expect(parseLookaheadDays({})).toBe(14);
    expect(parseLookaheadDays({ lookahead_days: "7" })).toBe(14);
    expect(parseLookaheadDays({ lookahead_days: 7 })).toBe(7);
    expect(parseLookaheadDays({ lookahead_days: 7.6 })).toBe(8);
    expect(parseLookaheadDays({ lookahead_days: 0 })).toBe(1);
    expect(parseLookaheadDays({ lookahead_days: 400 })).toBe(62);
  });
});

describe("createFetchAvailabilityExecutor", () => {
  it("returns a clean error when no calendar backend applies", async () => {
    const executor = createFetchAvailabilityExecutor(() => null);
    const outcome = await executor({});
    expect(outcome).toEqual({
      ok: false,
      error: expect.stringContaining("Calendar access is not available"),
    });
  });

  it("fetches with the requested lookahead and serializes the result", async () => {
    const fetchCalendar = vi.fn().mockResolvedValue(emptyCalendar);
    const fetcher: OutlookCalendarFetcher = { fetchCalendar };
    const executor = createFetchAvailabilityExecutor(() => fetcher);

    const outcome = await executor({ lookahead_days: 30 });

    expect(fetchCalendar).toHaveBeenCalledWith({
      freeBusyWindowDays: 30,
      historyWindowDays: 21,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toMatchObject({ timezone: "Europe/Berlin" });
    }
  });

  it("maps a throwing fetch into an error result", async () => {
    const fetcher: OutlookCalendarFetcher = {
      fetchCalendar: vi.fn().mockRejectedValue(new Error("EWS 9020")),
    };
    const executor = createFetchAvailabilityExecutor(() => fetcher);
    expect(await executor(null)).toEqual({ ok: false, error: "EWS 9020" });
  });
});

describe("containsFetchAvailabilityToolUse", () => {
  const toolUse = (toolName: string): ContentPart =>
    ({
      content_type: "tool_use",
      tool_name: toolName,
      tool_call_id: "c1",
      status: "success",
      input: {},
    }) as unknown as ContentPart;

  it("detects a fetch_availability tool use", () => {
    expect(
      containsFetchAvailabilityToolUse([
        { content_type: "text", text: "hi" } as unknown as ContentPart,
        toolUse(FETCH_AVAILABILITY_TOOL_NAME),
      ]),
    ).toBe(true);
  });

  it("ignores other tools and empty content", () => {
    expect(containsFetchAvailabilityToolUse(undefined)).toBe(false);
    expect(containsFetchAvailabilityToolUse([toolUse("other_tool")])).toBe(
      false,
    );
  });
});
