import { describe, it, expect, vi } from "vitest";

import { CLIENT_ACTION_TOOL_NAME } from "../outlookClientActions";
import {
  FETCH_AVAILABILITY_TOOL_NAME,
  SCHEDULING_THREAD_MAX_AGE_MS,
  containsFetchAvailabilityToolUse,
  containsSchedulingSignal,
  createFetchAvailabilityExecutor,
  isSchedulingThreadFresh,
  parseAttendees,
  parseDurationMinutes,
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
  attendees: [],
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

  it("serializes attendees opaquely with unknown-as-not-free wording", () => {
    const result = serializeCalendarForModel(
      {
        ...emptyCalendar,
        attendees: [
          {
            requested: "alice@example.de",
            smtp: "alice@example.de",
            status: "ok",
            busy: [
              {
                when: {
                  kind: "date-time",
                  startUtc: "2026-07-06T07:00:00Z",
                  endUtc: "2026-07-06T08:00:00Z",
                },
                busyType: "Busy",
              },
            ],
          },
          {
            requested: "Sales Team",
            smtp: "bob@example.de",
            status: "ok",
            reason:
              '1 nested distribution list(s) inside "Sales Team" were not expanded',
            busy: [],
          },
          {
            requested: "Nemo",
            status: "unknown",
            reason: "not found in the directory (GAL)",
            busy: [],
          },
        ],
      },
      NOW,
    ) as { attendees: Record<string, unknown>[]; legend: string };

    expect(result.attendees).toEqual([
      {
        name: "alice@example.de",
        status: "ok",
        busy: [
          {
            day: "Monday 2026-07-06",
            start: "09:00",
            end: "10:00",
            utcOffset: "+02:00",
            busyType: "Busy",
          },
        ],
      },
      {
        name: "Sales Team",
        email: "bob@example.de",
        status: "ok",
        note: expect.stringContaining("nested distribution list"),
        busy: [],
      },
      {
        name: "Nemo",
        status: "unknown - treat as NOT free",
        note: "not found in the directory (GAL)",
        busy: [],
      },
    ]);
    expect(result.legend).toContain("attendees");
    expect(result.legend).toContain("NOT free");
  });

  it("stamps coveredUntil on a truncated attendee busy list (tail cut ≠ free)", () => {
    // 150 hourly blocks from Monday 07:00Z; the cap keeps the 100 soonest, so
    // coverage ends at block #99's end: +99h30m → Friday 10:30Z = 12:30 Berlin.
    const busy = Array.from({ length: 150 }, (_, i) => ({
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

    const result = serializeCalendarForModel(
      {
        ...emptyCalendar,
        attendees: [
          {
            requested: "alice@example.de",
            smtp: "alice@example.de",
            status: "ok",
            busy,
          },
        ],
      },
      NOW,
    ) as {
      attendees: { status: string; coveredUntil?: string; busy: unknown[] }[];
      notes: string[];
      legend: string;
    };

    expect(result.attendees[0].busy).toHaveLength(100);
    expect(result.attendees[0].status).toBe("ok");
    expect(result.attendees[0].coveredUntil).toBe("Friday 2026-07-10 12:30");
    expect(result.notes).toContain(
      "1 attendee busy list(s) truncated to the 100 soonest entries",
    );
    expect(result.legend).toContain("coveredUntil");
  });

  it("emits ranked suggestedSlots and flags unreadable attendees in notes", () => {
    const result = serializeCalendarForModel(
      {
        ...emptyCalendar,
        workingHours: {
          daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          startMinutes: 540,
          endMinutes: 1020,
        },
        // PARTIALLY readable: one ok attendee keeps slots flowing; all-unknown
        // suppresses them entirely (next test).
        attendees: [
          {
            requested: "alice@example.de",
            smtp: "alice@example.de",
            status: "ok",
            busy: [],
          },
          { requested: "Nemo", status: "unknown", reason: "no", busy: [] },
        ],
      },
      NOW,
      { requestedDurationMinutes: 60, freeBusyWindowDays: 3 },
    ) as {
      suggestedSlots: {
        durationMinutes: number;
        durationBasis: string;
        slots: { tier: string; start: string; day: string }[];
      };
      notes: string[];
    };

    expect(result.suggestedSlots.durationMinutes).toBe(60);
    expect(result.suggestedSlots.durationBasis).toBe("requested");
    expect(result.suggestedSlots.slots.length).toBeGreaterThan(0);
    expect(result.suggestedSlots.slots[0].tier).toBe("earliest");
    // NOW is Friday 14:00 Berlin; the same afternoon is the soonest window.
    expect(result.suggestedSlots.slots[0].day).toBe("Friday 2026-07-03");
    expect(result.notes).toEqual([
      expect.stringContaining("1 attendee(s) whose calendar was unreadable"),
    ]);
  });

  it("distinguishes failed working-hours lookup from genuinely unconfigured hours", () => {
    const failed = serializeCalendarForModel(
      { ...emptyCalendar, degradedLegs: ["workingHours"] },
      NOW,
      { requestedDurationMinutes: 30, freeBusyWindowDays: 3 },
    ) as { notes: string[] };
    expect(failed.notes).toContain(
      "suggestedSlots assume Mon-Fri 09:00-17:00 (working-hours lookup failed — real hours unknown)",
    );

    const unconfigured = serializeCalendarForModel(emptyCalendar, NOW, {
      requestedDurationMinutes: 30,
      freeBusyWindowDays: 3,
    }) as { notes: string[]; legend: string };
    expect(unconfigured.notes).toContain(
      "suggestedSlots assume Mon-Fri 09:00-17:00 (no working hours configured)",
    );
    expect(unconfigured.legend).toContain('"degraded" contains "workingHours"');
  });

  it("suppresses suggestedSlots when every requested attendee is unreadable", () => {
    const result = serializeCalendarForModel(
      {
        ...emptyCalendar,
        attendees: [
          { requested: "Nemo", status: "unknown", reason: "no", busy: [] },
          { requested: "Dory", status: "unknown", reason: "no", busy: [] },
        ],
      },
      NOW,
      { requestedDurationMinutes: 60, freeBusyWindowDays: 3 },
    ) as { suggestedSlots?: unknown; notes: string[] };

    expect(result.suggestedSlots).toBeUndefined();
    expect(result.notes).toContain(
      "suggestedSlots suppressed — no requested attendee's calendar could be read",
    );
  });

  it("suppresses suggestedSlots when busy or attendee data degraded", () => {
    for (const leg of ["busy", "attendees"] as const) {
      const result = serializeCalendarForModel(
        { ...emptyCalendar, degradedLegs: [leg] },
        NOW,
        { requestedDurationMinutes: 30, freeBusyWindowDays: 7 },
      );
      expect(result.suggestedSlots).toBeUndefined();
    }
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

describe("parseAttendees", () => {
  it("returns empty for absent/invalid input", () => {
    expect(parseAttendees(null)).toEqual({ attendees: [], droppedByCap: 0 });
    expect(parseAttendees({})).toEqual({ attendees: [], droppedByCap: 0 });
    expect(parseAttendees({ attendees: "alice" })).toEqual({
      attendees: [],
      droppedByCap: 0,
    });
  });

  it("trims, drops non-strings/empties and dedupes case-insensitively", () => {
    expect(
      parseAttendees({
        attendees: [" alice@x.de ", "ALICE@x.de", 7, "", "Bob"],
      }),
    ).toEqual({ attendees: ["alice@x.de", "Bob"], droppedByCap: 0 });
  });

  it("caps at 15 and reports only cap drops", () => {
    const attendees = Array.from({ length: 18 }, (_, i) => `p${i}@x.de`);
    const parsed = parseAttendees({ attendees });
    expect(parsed.attendees).toHaveLength(15);
    expect(parsed.droppedByCap).toBe(3);
  });

  it('extracts the address from RFC-style "Name <addr>" and dedupes against the bare form', () => {
    expect(
      parseAttendees({
        attendees: [
          "Alice Meier <alice@x.de>",
          "alice@x.de",
          "<bob@x.de>",
          "Just A Name",
        ],
      }),
    ).toEqual({
      attendees: ["alice@x.de", "bob@x.de", "Just A Name"],
      droppedByCap: 0,
    });
  });
});

describe("parseDurationMinutes", () => {
  it("returns null for absent/invalid and clamps valid values", () => {
    expect(parseDurationMinutes(null)).toBeNull();
    expect(parseDurationMinutes({})).toBeNull();
    expect(parseDurationMinutes({ duration_minutes: "60" })).toBeNull();
    expect(parseDurationMinutes({ duration_minutes: 60 })).toBe(60);
    expect(parseDurationMinutes({ duration_minutes: 1 })).toBe(5);
    expect(parseDurationMinutes({ duration_minutes: 5000 })).toBe(1440);
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
      attendees: [],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toMatchObject({ timezone: "Europe/Berlin" });
    }
  });

  it("passes attendees through and notes cap overflow", async () => {
    const fetchCalendar = vi.fn().mockResolvedValue(emptyCalendar);
    const executor = createFetchAvailabilityExecutor(() => ({
      fetchCalendar,
    }));

    const attendees = Array.from({ length: 17 }, (_, i) => `p${i}@x.de`);
    const outcome = await executor({ attendees });

    expect(fetchCalendar.mock.calls[0][0].attendees).toHaveLength(15);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect((outcome.result as { notes: string[] }).notes).toContainEqual(
        expect.stringContaining("2 not checked"),
      );
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
  const toolUse = (toolName: string, status = "success"): ContentPart =>
    ({
      content_type: "tool_use",
      tool_name: toolName,
      tool_call_id: "c1",
      status,
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

  it("counts a FAILED fetch too — the follow-up is usually a retry", () => {
    expect(
      containsFetchAvailabilityToolUse([
        toolUse(FETCH_AVAILABILITY_TOOL_NAME, "error"),
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

describe("containsSchedulingSignal", () => {
  const textPart = (text: string): ContentPart =>
    ({ content_type: "text", text }) as unknown as ContentPart;

  it("counts a fetch_availability tool use", () => {
    expect(
      containsSchedulingSignal([
        {
          content_type: "tool_use",
          tool_name: FETCH_AVAILABILITY_TOOL_NAME,
        } as unknown as ContentPart,
      ]),
    ).toBe(true);
  });

  const proposeToolUse = (action: string): ContentPart =>
    ({
      content_type: "tool_use",
      tool_name: CLIENT_ACTION_TOOL_NAME,
      tool_call_id: "c1",
      status: "success",
      input: { action },
    }) as unknown as ContentPart;

  it("counts an erato-appointment fence — confirm/adjust turns must stay sticky", () => {
    expect(
      containsSchedulingSignal([
        textPart('Passt!\n```erato-appointment\n{"start":"..."}\n```'),
      ]),
    ).toBe(true);
  });

  it("ignores prose that merely quotes the fence syntax", () => {
    expect(
      containsSchedulingSignal([
        textPart("You could use a ```erato-appointment fence for that."),
      ]),
    ).toBe(false);
  });

  it("counts a propose_client_action for the appointment action", () => {
    expect(
      containsSchedulingSignal([proposeToolUse("outlook.create_appointment")]),
    ).toBe(true);
  });

  it("ignores a propose_client_action for a non-appointment action", () => {
    expect(containsSchedulingSignal([proposeToolUse("outlook.reply")])).toBe(
      false,
    );
  });

  it("ignores plain text, other fences and other tools", () => {
    expect(containsSchedulingSignal(undefined)).toBe(false);
    expect(
      containsSchedulingSignal([textPart("```erato-email\nHi\n```")]),
    ).toBe(false);
    expect(
      containsSchedulingSignal([
        {
          content_type: "tool_use",
          tool_name: "other_tool",
        } as unknown as ContentPart,
      ]),
    ).toBe(false);
  });
});

describe("isSchedulingThreadFresh", () => {
  const NOW_MS = Date.parse("2026-07-03T12:00:00Z");
  const atWindowEdge = new Date(
    NOW_MS - SCHEDULING_THREAD_MAX_AGE_MS,
  ).toISOString();
  const justBeyondWindow = new Date(
    NOW_MS - SCHEDULING_THREAD_MAX_AGE_MS - 60_000,
  ).toISOString();

  it("is fresh within the window and stale beyond it", () => {
    expect(isSchedulingThreadFresh("2026-07-03T11:30:00Z", NOW_MS)).toBe(true);
    expect(isSchedulingThreadFresh(atWindowEdge, NOW_MS)).toBe(true);
    expect(isSchedulingThreadFresh(justBeyondWindow, NOW_MS)).toBe(false);
    // A days-old scheduling chat must not hijack tomorrow's first send.
    expect(isSchedulingThreadFresh("2026-07-02T12:00:00Z", NOW_MS)).toBe(false);
  });

  it("is never fresh without a scheduling tool use", () => {
    expect(isSchedulingThreadFresh(null, NOW_MS)).toBe(false);
  });

  it("treats an unparseable timestamp as fresh (optimistic in-session message)", () => {
    expect(isSchedulingThreadFresh("not-a-date", NOW_MS)).toBe(true);
  });
});
