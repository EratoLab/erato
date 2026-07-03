import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import {
  fetchCalendarHistoryViaEws,
  fetchOutlookCalendarViaEws,
} from "../fetchOutlookCalendarEws";
import { EwsRequestError } from "../fetchOutlookMessageEws";

// The shared EWS plumbing module lazily imports the auth-recovery trigger from
// the shared library on its dead-session path; mock it so the test never loads
// the real library bundle (mirrors fetchOutlookMessageEws.test.ts).
vi.mock("@erato/frontend/library", () => ({
  tryRecoverAuth: vi.fn(async () => false),
}));

const EWS_URL = "https://exchange.example.com/EWS/Exchange.asmx";

/** Shape of the `asyncResult` the host transport's callback receives — mirrors
 * `Office.AsyncResult<string>` (status is the string-valued
 * `Office.AsyncResultStatus`). */
interface HostAsyncResult {
  status: "succeeded" | "failed";
  value?: string;
  error?: { code: number; message: string };
}

type MailboxMock = ReturnType<typeof installMockMailbox> & {
  makeEwsRequestAsync: ReturnType<typeof vi.fn>;
  ewsUrl?: string;
  userProfile?: { emailAddress: string; timeZone: string };
  item?: { itemId?: string } | null;
};

/** The REAL CalendarView response captured live (SI-1) against the SE box —
 * used verbatim. Two CalendarItems, UTC (`…Z`) Start/End. */
const CALENDAR_VIEW_SOAP =
  '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Header><h:ServerVersionInfo MajorVersion="15" MinorVersion="2" MajorBuildNumber="2562" MinorBuildNumber="17" Version="V2017_07_11" xmlns:h="http://schemas.microsoft.com/exchange/services/2006/types" xmlns="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/></s:Header><s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><m:FindItemResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><m:ResponseMessages><m:FindItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:RootFolder TotalItemsInView="2" IncludesLastItemInRange="true"><t:Items><t:CalendarItem><t:ItemId Id="AAA1" ChangeKey="CK1"/><t:Subject>Meeting A</t:Subject><t:Start>2026-07-02T06:00:00Z</t:Start><t:End>2026-07-02T06:30:00Z</t:End><t:IsRecurring>false</t:IsRecurring></t:CalendarItem><t:CalendarItem><t:ItemId Id="AAA2" ChangeKey="CK2"/><t:Subject>Our second meeting</t:Subject><t:Start>2026-07-09T06:00:00Z</t:Start><t:End>2026-07-09T06:30:00Z</t:End><t:IsRecurring>false</t:IsRecurring></t:CalendarItem></t:Items></m:RootFolder></m:FindItemResponseMessage></m:ResponseMessages></m:FindItemResponse></s:Body></s:Envelope>';

/** A CalendarView response carrying the SI-2/SI-3 enrichment fields:
 * IsAllDayEvent plus Required/Optional attendee collections. The first item is
 * all-day with 2 required + 1 optional attendee (attendeeCount 3); the second is
 * a timed solo block with no attendees (attendeeCount 0). */
const CALENDAR_VIEW_ENRICHED_SOAP =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
  '<s:Body xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" ' +
  'xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">' +
  "<m:FindItemResponse><m:ResponseMessages>" +
  '<m:FindItemResponseMessage ResponseClass="Success">' +
  "<m:ResponseCode>NoError</m:ResponseCode>" +
  '<m:RootFolder TotalItemsInView="2" IncludesLastItemInRange="true"><t:Items>' +
  "<t:CalendarItem>" +
  '<t:ItemId Id="ENR1" ChangeKey="CK1"/>' +
  "<t:Subject>All-day offsite</t:Subject>" +
  "<t:Start>2026-07-02T00:00:00Z</t:Start>" +
  "<t:End>2026-07-03T00:00:00Z</t:End>" +
  "<t:IsRecurring>false</t:IsRecurring>" +
  "<t:LegacyFreeBusyStatus>OOF</t:LegacyFreeBusyStatus>" +
  "<t:IsAllDayEvent>true</t:IsAllDayEvent>" +
  "<t:RequiredAttendees>" +
  "<t:Attendee><t:Mailbox><t:Name>Alice</t:Name><t:EmailAddress>alice@x</t:EmailAddress></t:Mailbox></t:Attendee>" +
  "<t:Attendee><t:Mailbox><t:Name>Bob</t:Name><t:EmailAddress>bob@x</t:EmailAddress></t:Mailbox></t:Attendee>" +
  "</t:RequiredAttendees>" +
  "<t:OptionalAttendees>" +
  "<t:Attendee><t:Mailbox><t:Name>Carol</t:Name><t:EmailAddress>carol@x</t:EmailAddress></t:Mailbox></t:Attendee>" +
  "</t:OptionalAttendees>" +
  "</t:CalendarItem>" +
  "<t:CalendarItem>" +
  '<t:ItemId Id="ENR2" ChangeKey="CK2"/>' +
  "<t:Subject>Solo focus block</t:Subject>" +
  "<t:Start>2026-07-09T06:00:00Z</t:Start>" +
  "<t:End>2026-07-09T07:00:00Z</t:End>" +
  "<t:IsRecurring>true</t:IsRecurring>" +
  "<t:LegacyFreeBusyStatus>Busy</t:LegacyFreeBusyStatus>" +
  "<t:IsAllDayEvent>false</t:IsAllDayEvent>" +
  "</t:CalendarItem>" +
  "</t:Items></m:RootFolder>" +
  "</m:FindItemResponseMessage>" +
  "</m:ResponseMessages></m:FindItemResponse>" +
  "</s:Body></s:Envelope>";

/** A schema-accurate GetUserAvailability response carrying WorkingHours with a
 * single Mon-Fri WorkingPeriod (08:00–17:00 → 480..1020 minutes). */
const AVAILABILITY_SOAP =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
  '<s:Body xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" ' +
  'xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">' +
  "<m:GetUserAvailabilityResponse>" +
  "<m:FreeBusyResponseArray>" +
  "<m:FreeBusyResponse>" +
  '<m:ResponseMessage ResponseClass="Success">' +
  "<m:ResponseCode>NoError</m:ResponseCode>" +
  "</m:ResponseMessage>" +
  "<m:FreeBusyView>" +
  "<t:FreeBusyViewType>Detailed</t:FreeBusyViewType>" +
  "<t:WorkingHours>" +
  "<t:TimeZone>" +
  "<t:Bias>-60</t:Bias>" +
  "<t:StandardTime><t:Bias>0</t:Bias><t:Time>03:00:00</t:Time><t:DayOrder>5</t:DayOrder><t:Month>10</t:Month><t:DayOfWeek>Sunday</t:DayOfWeek></t:StandardTime>" +
  "<t:DaylightTime><t:Bias>-60</t:Bias><t:Time>02:00:00</t:Time><t:DayOrder>5</t:DayOrder><t:Month>3</t:Month><t:DayOfWeek>Sunday</t:DayOfWeek></t:DaylightTime>" +
  "</t:TimeZone>" +
  "<t:WorkingPeriodArray>" +
  "<t:WorkingPeriod>" +
  "<t:DayOfWeek>Monday Tuesday Wednesday Thursday Friday</t:DayOfWeek>" +
  "<t:StartTimeInMinutes>480</t:StartTimeInMinutes>" +
  "<t:EndTimeInMinutes>1020</t:EndTimeInMinutes>" +
  "</t:WorkingPeriod>" +
  "</t:WorkingPeriodArray>" +
  "</t:WorkingHours>" +
  "</m:FreeBusyView>" +
  "</m:FreeBusyResponse>" +
  "</m:FreeBusyResponseArray>" +
  "</m:GetUserAvailabilityResponse>" +
  "</s:Body></s:Envelope>";

function installOutlookMailboxMock(): MailboxMock {
  const mailbox = installMockMailbox() as MailboxMock;
  // Default: surface an EWS error so a test that forgets to wire the host
  // transport fails loudly rather than silently.
  mailbox.makeEwsRequestAsync = vi.fn(
    (_data: string, callback: (result: HostAsyncResult) => void) => {
      callback({
        status: "failed",
        error: { code: 0, message: "makeEwsRequestAsync not mocked" },
      });
    },
  );
  mailbox.ewsUrl = EWS_URL;
  mailbox.userProfile = {
    emailAddress: "chris@ms-test.eratolabs.com",
    timeZone: "W. Europe Standard Time",
  };
  return mailbox;
}

/**
 * Installs the host transport mock (`makeEwsRequestAsync`). Responses are keyed
 * off the operation name in the SOAP body the production code passes as the first
 * argument (mirrors fetchOutlookMessageEws.test.ts).
 */
function installHostMock(
  responder: (soapBody: string) => HostAsyncResult,
): ReturnType<typeof vi.fn> {
  const hostMock = vi.fn(
    (data: string, callback: (result: HostAsyncResult) => void) => {
      callback(responder(String(data ?? "")));
    },
  );
  (Office.context.mailbox as unknown as MailboxMock).makeEwsRequestAsync =
    hostMock;
  return hostMock;
}

/** Routes the host SOAP by operation: availability vs. CalendarView FindItem. */
function happyResponder(body: string): HostAsyncResult {
  if (body.includes("<m:GetUserAvailabilityRequest")) {
    return { status: "succeeded", value: AVAILABILITY_SOAP };
  }
  if (body.includes("<m:FindItem")) {
    return { status: "succeeded", value: CALENDAR_VIEW_SOAP };
  }
  return { status: "failed", error: { code: 0, message: "unexpected op" } };
}

describe("fetchOutlookCalendarViaEws", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("normalizes busy/history/working-hours with UTC times and the mailbox time zone", async () => {
    const hostMock = installHostMock(happyResponder);

    const calendar = await fetchOutlookCalendarViaEws();

    expect(calendar.timezone).toBe("W. Europe Standard Time");
    expect(calendar.workingHours).toEqual({
      daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      startMinutes: 480,
      endMinutes: 1020,
    });

    expect(calendar.historyMeetings.map((meeting) => meeting.subject)).toEqual([
      "Meeting A",
      "Our second meeting",
    ]);
    expect(calendar.busyBlocks.map((block) => block.subject)).toEqual([
      "Meeting A",
      "Our second meeting",
    ]);

    // Load-bearing: every emitted start/end is UTC (ends with Z).
    for (const event of [...calendar.historyMeetings, ...calendar.busyBlocks]) {
      expect(event.start.endsWith("Z")).toBe(true);
      expect(event.end.endsWith("Z")).toBe(true);
    }

    // The FindItem leg targets the user's OWN calendar folder at
    // Exchange2013_SP1, and the host body carries no XML declaration.
    const findBody = hostMock.mock.calls
      .map((call) => String(call[0] ?? ""))
      .find((sent) => sent.includes("<m:FindItem"));
    expect(findBody).toContain('<t:DistinguishedFolderId Id="calendar"/>');
    expect(findBody).toContain('Version="Exchange2013_SP1"');
    expect(findBody).not.toContain("<?xml");
    // The enrichment fields (SI-2/SI-3 parity) are requested alongside the core.
    expect(findBody).toContain("calendar:IsAllDayEvent");
    expect(findBody).toContain("calendar:RequiredAttendees");
    expect(findBody).toContain("calendar:OptionalAttendees");
  });

  it("parses isAllDay and attendeeCount from the CalendarView enrichment fields", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    installHostMock((body) => {
      if (body.includes("<m:GetUserAvailabilityRequest")) {
        return { status: "succeeded", value: AVAILABILITY_SOAP };
      }
      if (body.includes("<m:FindItem")) {
        return { status: "succeeded", value: CALENDAR_VIEW_ENRICHED_SOAP };
      }
      return { status: "failed", error: { code: 0, message: "unexpected op" } };
    });

    const calendar = await fetchOutlookCalendarViaEws();

    // historyMeetings carry isAllDay + attendeeCount + isRecurring.
    expect(calendar.historyMeetings[0]).toMatchObject({
      subject: "All-day offsite",
      isAllDay: true,
      attendeeCount: 3,
      isRecurring: false,
    });
    expect(calendar.historyMeetings[1]).toMatchObject({
      subject: "Solo focus block",
      isAllDay: false,
      attendeeCount: 0,
      isRecurring: true,
    });

    // busyBlocks carry isAllDay + the unified busyType (OOF preserved), but NOT
    // attendeeCount.
    expect(calendar.busyBlocks[0]).toMatchObject({
      subject: "All-day offsite",
      isAllDay: true,
      busyType: "OOF",
    });
    expect(calendar.busyBlocks[0]).not.toHaveProperty("attendeeCount");
    expect(calendar.busyBlocks[1]).toMatchObject({
      subject: "Solo focus block",
      isAllDay: false,
      busyType: "Busy",
    });
    warnSpy.mockRestore();
  });

  it("degrades to []/null when the host forbids the web method, while the per-leg fetcher rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    installHostMock(() => ({
      status: "failed",
      error: {
        code: 0,
        message:
          "the requested web method is unavailable to this caller or application",
      },
    }));

    // The per-leg history fetcher surfaces the hard EWS error...
    await expect(
      fetchCalendarHistoryViaEws({
        startUtc: "2026-06-08T00:00:00Z",
        endUtc: "2026-06-29T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(EwsRequestError);

    // ...but the dispatcher degrades every failed leg rather than throwing.
    const calendar = await fetchOutlookCalendarViaEws();
    expect(calendar).toEqual({
      workingHours: null,
      busyBlocks: [],
      historyMeetings: [],
      timezone: "W. Europe Standard Time",
    });
    warnSpy.mockRestore();
  });

  it("keeps busy/history populated with workingHours null when only GetUserAvailability fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    installHostMock((body) => {
      if (body.includes("<m:GetUserAvailabilityRequest")) {
        return {
          status: "failed",
          error: { code: 0, message: "The specified time zone isn't valid." },
        };
      }
      if (body.includes("<m:FindItem")) {
        return { status: "succeeded", value: CALENDAR_VIEW_SOAP };
      }
      return { status: "failed", error: { code: 0, message: "unexpected op" } };
    });

    const calendar = await fetchOutlookCalendarViaEws();

    expect(calendar.workingHours).toBeNull();
    expect(calendar.historyMeetings).toHaveLength(2);
    expect(calendar.busyBlocks).toHaveLength(2);
    expect(calendar.historyMeetings[0].subject).toBe("Meeting A");
    expect(calendar.busyBlocks[0].subject).toBe("Meeting A");
    warnSpy.mockRestore();
  });

  it("rethrows the abort reason when the signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("calendar fetch aborted");
    controller.abort(reason);

    await expect(
      fetchOutlookCalendarViaEws({ signal: controller.signal }),
    ).rejects.toBe(reason);
  });
});
