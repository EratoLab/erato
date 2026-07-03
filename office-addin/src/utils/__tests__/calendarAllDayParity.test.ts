import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import { fetchOutlookCalendarViaEws } from "../fetchOutlookCalendarEws";
import { fetchOutlookCalendarViaGraph } from "../fetchOutlookCalendarGraph";

// The EWS plumbing lazily imports the auth-recovery trigger from the shared
// library; mock it so the test never loads the real library bundle.
vi.mock("@erato/frontend/library", () => ({
  tryRecoverAuth: vi.fn(async () => false),
}));

/**
 * The redesign's load-bearing invariant: an all-day event on the SAME civil day
 * must normalize to the SAME floating `{ startDate, endDateExclusive }` on BOTH
 * backends — even though Graph and EWS put all-day events on the wire with OPPOSITE
 * conventions. Here the mailbox is W. Europe (UTC+2 in July) and the day is
 * 2026-07-15:
 *   - Graph: floating midnights labeled `Z`, taken directly (never localized).
 *   - EWS: the UTC instant of LOCAL midnight (`…T22:00:00Z` the prior day),
 *     localized back to the item's StartTimeZone.
 * Both must yield 2026-07-15 / 2026-07-16.
 */
const ALL_DAY_WHEN = {
  kind: "date",
  startDate: "2026-07-15",
  endDateExclusive: "2026-07-16",
} as const;

interface HostAsyncResult {
  status: "succeeded" | "failed";
  value?: string;
  error?: { code: number; message: string };
}

type MailboxMock = ReturnType<typeof installMockMailbox> & {
  makeEwsRequestAsync?: ReturnType<typeof vi.fn>;
  ewsUrl?: string;
  userProfile?: { emailAddress: string; timeZone: string };
};

function installMailbox(): void {
  const mailbox = installMockMailbox() as MailboxMock;
  mailbox.ewsUrl = "https://exchange.example.com/EWS/Exchange.asmx";
  mailbox.userProfile = {
    emailAddress: "chris@ms-test.eratolabs.com",
    timeZone: "W. Europe Standard Time",
  };
}

// --- Graph: floating-midnight-Z all-day ------------------------------------
const GRAPH_BUSY_ALL_DAY = {
  value: [
    {
      subject: "Company offsite",
      start: { dateTime: "2026-07-15T00:00:00.0000000Z", timeZone: "UTC" },
      end: { dateTime: "2026-07-16T00:00:00.0000000Z", timeZone: "UTC" },
      isAllDay: true,
      showAs: "oof",
    },
  ],
};

function graphRouter(url: string): Response {
  const body = url.includes("showAs") ? GRAPH_BUSY_ALL_DAY : { value: [] };
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// --- EWS: UTC-instant-of-local-midnight all-day ----------------------------
const EWS_BUSY_ALL_DAY =
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
  '<s:Body xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" ' +
  'xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">' +
  "<m:FindItemResponse><m:ResponseMessages>" +
  '<m:FindItemResponseMessage ResponseClass="Success">' +
  "<m:ResponseCode>NoError</m:ResponseCode>" +
  '<m:RootFolder TotalItemsInView="1" IncludesLastItemInRange="true"><t:Items>' +
  "<t:CalendarItem>" +
  '<t:ItemId Id="P1" ChangeKey="CK1"/>' +
  "<t:Subject>Company offsite</t:Subject>" +
  "<t:Start>2026-07-14T22:00:00Z</t:Start>" +
  "<t:End>2026-07-15T22:00:00Z</t:End>" +
  "<t:IsRecurring>false</t:IsRecurring>" +
  "<t:LegacyFreeBusyStatus>OOF</t:LegacyFreeBusyStatus>" +
  "<t:IsAllDayEvent>true</t:IsAllDayEvent>" +
  '<t:StartTimeZone Id="W. Europe Standard Time"/>' +
  "</t:CalendarItem>" +
  "</t:Items></m:RootFolder>" +
  "</m:FindItemResponseMessage></m:ResponseMessages></m:FindItemResponse>" +
  "</s:Body></s:Envelope>";

function ewsResponder(body: string): HostAsyncResult {
  // Only the busy/history FindItem matters; availability degrades to null.
  if (body.includes("<m:FindItem")) {
    return { status: "succeeded", value: EWS_BUSY_ALL_DAY };
  }
  return { status: "failed", error: { code: 0, message: "unsupported" } };
}

describe("all-day cross-backend parity", () => {
  beforeEach(() => {
    installMailbox();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("normalizes the same all-day event identically on Graph and EWS", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const graphCalendar = await fetchOutlookCalendarViaGraph(
      vi.fn().mockResolvedValue("graph-tok"),
      { transport: vi.fn(async (url: string) => graphRouter(url)) },
    );

    (Office.context.mailbox as unknown as MailboxMock).makeEwsRequestAsync =
      vi.fn((data: string, cb: (r: HostAsyncResult) => void) =>
        cb(ewsResponder(String(data ?? ""))),
      );
    const ewsCalendar = await fetchOutlookCalendarViaEws();

    // Each backend recovered the true civil dates from its own wire convention...
    expect(graphCalendar.busyBlocks[0].when).toEqual(ALL_DAY_WHEN);
    expect(ewsCalendar.busyBlocks[0].when).toEqual(ALL_DAY_WHEN);
    // ...and they agree with each other, over the same IANA display zone.
    expect(graphCalendar.busyBlocks[0].when).toEqual(
      ewsCalendar.busyBlocks[0].when,
    );
    expect(graphCalendar.displayTimeZone).toBe(ewsCalendar.displayTimeZone);
    expect(graphCalendar.displayTimeZone).toBe("Europe/Berlin");

    warnSpy.mockRestore();
  });
});
