import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import { fetchOutlookCalendarViaGraph } from "../fetchOutlookCalendarGraph";
import { GRAPH_BASE } from "../fetchOutlookMessageGraph";

type MailboxMock = ReturnType<typeof installMockMailbox> & {
  userProfile?: { emailAddress: string; timeZone: string };
};

function installOutlookMailboxMock(): MailboxMock {
  const mailbox = installMockMailbox() as MailboxMock;
  mailbox.userProfile = {
    emailAddress: "chris@ms-test.eratolabs.com",
    timeZone: "W. Europe Standard Time",
  };
  return mailbox;
}

interface MockResponseInit {
  ok?: boolean;
  status?: number;
  statusText?: string;
}

/** A minimal JSON `Response` stand-in — `graphFetch` only reads `ok`/`status`/
 * `statusText` and calls `json()`. */
function jsonResponse(value: unknown, init: MockResponseInit = {}): Response {
  const ok = init.ok ?? true;
  return {
    ok,
    status: init.status ?? (ok ? 200 : 500),
    statusText: init.statusText ?? (ok ? "OK" : "Error"),
    json: () => Promise.resolve(value),
  } as unknown as Response;
}

/** Page 1 of the look-forward (busy) calendarView, carrying an `@odata.nextLink`
 * to a second page so pagination is exercised. */
const BUSY_PAGE_1 = {
  value: [
    {
      subject: "All-hands",
      start: { dateTime: "2026-07-02T06:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-07-02T07:00:00.0000000", timeZone: "UTC" },
      isAllDay: false,
      showAs: "busy",
      // Authored in a non-UTC zone → authoringTimeZone should resolve to IANA.
      originalStartTimeZone: "W. Europe Standard Time",
    },
    {
      // All-day: Graph labels the midnights `Z` but does NOT offset-shift them, so
      // the floating date is taken directly (2026-07-03 / -04), never localized.
      subject: "Conference (out of office)",
      start: { dateTime: "2026-07-03T00:00:00.0000000Z", timeZone: "UTC" },
      end: { dateTime: "2026-07-04T00:00:00.0000000Z", timeZone: "UTC" },
      isAllDay: true,
      showAs: "oof",
    },
  ],
  "@odata.nextLink": `${GRAPH_BASE}/me/calendarView?%24skiptoken=BUSY_PAGE_2`,
};

const BUSY_PAGE_2 = {
  value: [
    {
      // dateTime already carries a trailing Z — must still normalize cleanly.
      subject: "Maybe sync",
      start: { dateTime: "2026-07-05T09:00:00.0000000Z", timeZone: "UTC" },
      end: { dateTime: "2026-07-05T09:30:00.0000000Z", timeZone: "UTC" },
      isAllDay: false,
      showAs: "tentative",
    },
  ],
};

const HISTORY_PAGE = {
  value: [
    {
      subject: "Project kickoff",
      start: { dateTime: "2026-06-10T08:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-06-10T09:00:00.0000000", timeZone: "UTC" },
      isAllDay: false,
      type: "occurrence",
      attendees: [
        { type: "required" },
        { type: "optional" },
        { type: "required" },
        // A resource room must NOT count toward attendeeCount (EWS parity).
        { type: "resource" },
      ],
    },
    {
      subject: "Company holiday",
      start: { dateTime: "2026-06-15T00:00:00.0000000Z", timeZone: "UTC" },
      end: { dateTime: "2026-06-16T00:00:00.0000000Z", timeZone: "UTC" },
      isAllDay: true,
      // attendees intentionally omitted → attendeeCount undefined.
    },
  ],
};

const GET_SCHEDULE_RESPONSE = {
  value: [
    {
      workingHours: {
        daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        startTime: "08:00:00.0000000",
        endTime: "17:00:00.0000000",
        // Matches the mock mailbox zone so the minutes are meaningful; the
        // zone-divergence degrade is covered by its own test below.
        timeZone: { name: "W. Europe Standard Time" },
      },
    },
  ],
};

/** Routes a Graph GET by URL to the canned fixture for that leg/page. */
function happyRouter(url: string): Response {
  if (url.includes("BUSY_PAGE_2")) {
    return jsonResponse(BUSY_PAGE_2);
  }
  if (url.includes("getSchedule")) {
    return jsonResponse(GET_SCHEDULE_RESPONSE);
  }
  if (url.includes("/me/calendarView") && url.includes("showAs")) {
    return jsonResponse(BUSY_PAGE_1);
  }
  if (url.includes("/me/calendarView") && url.includes("attendees")) {
    return jsonResponse(HISTORY_PAGE);
  }
  return jsonResponse({}, { ok: false, status: 404, statusText: "Not Found" });
}

function makeTransport(router: (url: string) => Response) {
  return vi.fn(async (url: string, _init?: RequestInit) => router(url));
}

describe("fetchOutlookCalendarViaGraph", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("normalizes busy/history/working-hours with UTC times and the mailbox time zone", async () => {
    const acquireToken = vi.fn().mockResolvedValue("graph-tok");
    const transport = makeTransport(happyRouter);

    const calendar = await fetchOutlookCalendarViaGraph(acquireToken, {
      transport,
    });

    // resolveTimezone maps the mailbox's Windows zone name to canonical IANA.
    expect(calendar.displayTimeZone).toBe("Europe/Berlin");
    // Every leg sourced cleanly → nothing degraded.
    expect(calendar.degradedLegs).toEqual([]);
    expect(calendar.workingHours).toEqual({
      daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      startMinutes: 480,
      endMinutes: 1020,
    });

    // busyType mapping (busy→Busy, oof→OOF, tentative→Tentative) across both
    // pages, in order.
    expect(calendar.busyBlocks.map((block) => block.busyType)).toEqual([
      "Busy",
      "OOF",
      "Tentative",
    ]);
    // Timed events land on the date-time arm as UTC instants; the all-day event
    // lands on the date arm as a floating half-open date range.
    expect(calendar.busyBlocks.map((block) => block.when.kind)).toEqual([
      "date-time",
      "date",
      "date-time",
    ]);
    expect(calendar.busyBlocks[0].when).toEqual({
      kind: "date-time",
      startUtc: "2026-07-02T06:00:00Z",
      endUtc: "2026-07-02T07:00:00Z",
    });
    expect(calendar.busyBlocks[1].when).toEqual({
      kind: "date",
      startDate: "2026-07-03",
      endDateExclusive: "2026-07-04",
    });
    // originalStartTimeZone → IANA on the first block; absent → null.
    expect(calendar.busyBlocks[0].authoringTimeZone).toBe("Europe/Berlin");
    expect(calendar.busyBlocks[1].authoringTimeZone).toBeNull();

    // historyMeetings: attendeeCount excludes resource rooms (3 people, 1 room
    // → 3), undefined when absent.
    expect(calendar.historyMeetings.map((m) => m.subject)).toEqual([
      "Project kickoff",
      "Company holiday",
    ]);
    expect(calendar.historyMeetings[0].attendeeCount).toBe(3);
    expect(calendar.historyMeetings[1].attendeeCount).toBeUndefined();
    expect(calendar.historyMeetings[0].when.kind).toBe("date-time");
    expect(calendar.historyMeetings[1].when).toEqual({
      kind: "date",
      startDate: "2026-06-15",
      endDateExclusive: "2026-06-16",
    });
    // isRecurring derived from Graph's event `type` (occurrence → true).
    expect(calendar.historyMeetings[0].isRecurring).toBe(true);
    expect(calendar.historyMeetings[1].isRecurring).toBe(false);

    // Load-bearing: timed events are millis-free UTC `…Z`; date events are bare
    // `YYYY-MM-DD` with no time/zone designator.
    for (const event of [...calendar.busyBlocks, ...calendar.historyMeetings]) {
      if (event.when.kind === "date-time") {
        expect(event.when.startUtc).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:]+Z$/);
        expect(event.when.endUtc).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:]+Z$/);
      } else {
        expect(event.when.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(event.when.endDateExclusive).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }

    // The bearer token from acquireToken reaches the transport.
    const [, firstInit] = transport.mock.calls[0];
    const headers = (firstInit as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Bearer graph-tok");
  });

  it("follows the calendarView @odata.nextLink to a second page", async () => {
    const acquireToken = vi.fn().mockResolvedValue("graph-tok");
    const transport = makeTransport(happyRouter);

    const calendar = await fetchOutlookCalendarViaGraph(acquireToken, {
      transport,
    });

    // Page 1 (2 events) + page 2 (1 event) = 3 busy blocks.
    expect(calendar.busyBlocks).toHaveLength(3);
    const requestedUrls = transport.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls.some((url) => url.includes("BUSY_PAGE_2"))).toBe(true);
  });

  it("degrades the busy leg to [] when its transport returns HTTP 500, while the whole call resolves", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const acquireToken = vi.fn().mockResolvedValue("graph-tok");
    const transport = makeTransport((url) => {
      if (url.includes("/me/calendarView") && url.includes("showAs")) {
        return jsonResponse(
          {},
          { ok: false, status: 500, statusText: "Internal Server Error" },
        );
      }
      return happyRouter(url);
    });

    const calendar = await fetchOutlookCalendarViaGraph(acquireToken, {
      transport,
    });

    expect(calendar.busyBlocks).toEqual([]);
    // The other legs still populate — one failed leg can't sink the snapshot.
    expect(calendar.historyMeetings).toHaveLength(2);
    expect(calendar.workingHours).not.toBeNull();
    // ...but the busy leg's emptiness is flagged as unauthoritative.
    expect(calendar.degradedLegs).toEqual(["busy"]);
    warnSpy.mockRestore();
  });

  it("degrades working hours to null when getSchedule returns HTTP 500", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const acquireToken = vi.fn().mockResolvedValue("graph-tok");
    const transport = makeTransport((url) => {
      if (url.includes("getSchedule")) {
        return jsonResponse(
          {},
          { ok: false, status: 500, statusText: "Internal Server Error" },
        );
      }
      return happyRouter(url);
    });

    const calendar = await fetchOutlookCalendarViaGraph(acquireToken, {
      transport,
    });

    expect(calendar.workingHours).toBeNull();
    expect(calendar.busyBlocks).toHaveLength(3);
    expect(calendar.historyMeetings).toHaveLength(2);
    // A hard getSchedule failure flags the workingHours leg degraded.
    expect(calendar.degradedLegs).toEqual(["workingHours"]);
    warnSpy.mockRestore();
  });

  it("degrades working hours to null when getSchedule's zone differs from the mailbox zone", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const acquireToken = vi.fn().mockResolvedValue("graph-tok");
    // Mailbox mock is "W. Europe Standard Time"; a UTC schedule zone would make
    // the clock-time minutes wrong, so working hours must degrade rather than lie.
    const transport = makeTransport((url) => {
      if (url.includes("getSchedule")) {
        return jsonResponse({
          value: [
            {
              workingHours: {
                daysOfWeek: ["monday"],
                startTime: "08:00:00.0000000",
                endTime: "17:00:00.0000000",
                timeZone: { name: "UTC" },
              },
            },
          ],
        });
      }
      return happyRouter(url);
    });

    const calendar = await fetchOutlookCalendarViaGraph(acquireToken, {
      transport,
    });

    expect(calendar.workingHours).toBeNull();
    expect(calendar.busyBlocks).toHaveLength(3);
    // Zone divergence is a data-trust degrade, NOT a fetch failure — the leg
    // fetched fine, so it is deliberately not listed in degradedLegs.
    expect(calendar.degradedLegs).toEqual([]);
    warnSpy.mockRestore();
  });

  it("stops at the page cap (and warns) when calendarView never stops paginating", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const acquireToken = vi.fn().mockResolvedValue("graph-tok");
    let busyPages = 0;
    const transport = makeTransport((url) => {
      // Match both the first busy page (showAs) and every follow-up page (whose
      // nextLink carries only a skiptoken), always handing back another nextLink
      // → an unbounded loop without the cap.
      if (
        (url.includes("/me/calendarView") && url.includes("showAs")) ||
        url.includes("skiptoken=PAGE_")
      ) {
        busyPages += 1;
        return jsonResponse({
          value: [],
          "@odata.nextLink": `${GRAPH_BASE}/me/calendarView?%24skiptoken=PAGE_${busyPages}`,
        });
      }
      return happyRouter(url);
    });

    const calendar = await fetchOutlookCalendarViaGraph(acquireToken, {
      transport,
    });

    // Terminated (didn't hang) at a finite cap and warned about truncation.
    expect(calendar.busyBlocks).toEqual([]);
    expect(busyPages).toBeLessThanOrEqual(21);
    expect(
      warnSpy.mock.calls.some((call) => String(call[0]).includes("page cap")),
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it("rethrows the abort reason when the signal is already aborted", async () => {
    const acquireToken = vi.fn().mockResolvedValue("graph-tok");
    const transport = makeTransport(happyRouter);
    const controller = new AbortController();
    const reason = new Error("calendar fetch aborted");
    controller.abort(reason);

    await expect(
      fetchOutlookCalendarViaGraph(acquireToken, {
        transport,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
  });
});
