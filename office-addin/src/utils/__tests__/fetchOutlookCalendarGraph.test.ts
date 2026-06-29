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
    },
    {
      subject: "Conference (out of office)",
      start: { dateTime: "2026-07-03T00:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-07-04T00:00:00.0000000", timeZone: "UTC" },
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
      attendees: [
        { type: "required" },
        { type: "optional" },
        { type: "required" },
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
        timeZone: { name: "UTC" },
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

    expect(calendar.timezone).toBe("W. Europe Standard Time");
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
    expect(calendar.busyBlocks.map((block) => block.isAllDay)).toEqual([
      false,
      true,
      false,
    ]);

    // historyMeetings: attendeeCount = attendees.length, undefined when absent.
    expect(calendar.historyMeetings.map((m) => m.subject)).toEqual([
      "Project kickoff",
      "Company holiday",
    ]);
    expect(calendar.historyMeetings[0].attendeeCount).toBe(3);
    expect(calendar.historyMeetings[1].attendeeCount).toBeUndefined();
    expect(calendar.historyMeetings[0].isAllDay).toBe(false);
    expect(calendar.historyMeetings[1].isAllDay).toBe(true);

    // Load-bearing: every emitted start/end is a millis-free UTC `…Z`.
    for (const event of [...calendar.busyBlocks, ...calendar.historyMeetings]) {
      expect(event.start.endsWith("Z")).toBe(true);
      expect(event.end.endsWith("Z")).toBe(true);
      expect(event.start).not.toContain(".");
      expect(event.end).not.toContain(".");
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
