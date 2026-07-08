import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EXPECTED_ATTENDEE_PARITY,
  stripReasons,
} from "./attendeeParity.fixture";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import {
  fetchAttendeeAvailabilityViaEws,
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
 * IsAllDayEvent and StartTimeZone. The first item is all-day; the second is a
 * timed solo block. No attendee collections — FindItem never returns them.
 *
 * The all-day item's Start/End are on the wire as the UTC instant of W. Europe
 * (UTC+2 in July) LOCAL midnight — i.e. `…T22:00:00Z` the day BEFORE — exactly the
 * shape that naive `.slice(0,10)` would mis-date by a day. Localizing to the
 * StartTimeZone must recover the true civil dates 2026-07-02 / 2026-07-03. */
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
  "<t:Start>2026-07-01T22:00:00Z</t:Start>" +
  "<t:End>2026-07-02T22:00:00Z</t:End>" +
  "<t:IsRecurring>false</t:IsRecurring>" +
  "<t:LegacyFreeBusyStatus>OOF</t:LegacyFreeBusyStatus>" +
  "<t:IsAllDayEvent>true</t:IsAllDayEvent>" +
  '<t:StartTimeZone Id="W. Europe Standard Time"/>' +
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

/** Mon-Fri 480..1020 plus a Saturday period with DIFFERENT hours (540..720). */
const AVAILABILITY_MIXED_PERIODS_SOAP = AVAILABILITY_SOAP.replace(
  "</t:WorkingPeriodArray>",
  "<t:WorkingPeriod>" +
    "<t:DayOfWeek>Saturday</t:DayOfWeek>" +
    "<t:StartTimeInMinutes>540</t:StartTimeInMinutes>" +
    "<t:EndTimeInMinutes>720</t:EndTimeInMinutes>" +
    "</t:WorkingPeriod>" +
    "</t:WorkingPeriodArray>",
);

/** Mon-Fri 480..1020 plus a Saturday period with IDENTICAL hours. */
const AVAILABILITY_MATCHING_PERIODS_SOAP = AVAILABILITY_SOAP.replace(
  "</t:WorkingPeriodArray>",
  "<t:WorkingPeriod>" +
    "<t:DayOfWeek>Saturday</t:DayOfWeek>" +
    "<t:StartTimeInMinutes>480</t:StartTimeInMinutes>" +
    "<t:EndTimeInMinutes>1020</t:EndTimeInMinutes>" +
    "</t:WorkingPeriod>" +
    "</t:WorkingPeriodArray>",
);

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

    // resolveTimezone maps the mailbox's Windows zone name to canonical IANA.
    expect(calendar.displayTimeZone).toBe("Europe/Berlin");
    // Every leg sourced cleanly → nothing degraded.
    expect(calendar.degradedLegs).toEqual([]);
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

    // These fixtures are all timed, so every event lands on the date-time arm as
    // a UTC `…Z` instant.
    for (const event of [...calendar.historyMeetings, ...calendar.busyBlocks]) {
      expect(event.when.kind).toBe("date-time");
      if (event.when.kind === "date-time") {
        expect(event.when.startUtc.endsWith("Z")).toBe(true);
        expect(event.when.endUtc.endsWith("Z")).toBe(true);
      }
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
    expect(findBody).toContain("calendar:StartTimeZone");
    // Attendee collections must NOT be requested: FindItem cannot return
    // recipient lists, so asking would only feed an always-0 count.
    expect(findBody).not.toContain("calendar:RequiredAttendees");
    expect(findBody).not.toContain("calendar:OptionalAttendees");
  });

  it("drops WorkingPeriod days whose hours differ from the first period (never overstate)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    installHostMock((body) => {
      if (body.includes("<m:GetUserAvailabilityRequest")) {
        return { status: "succeeded", value: AVAILABILITY_MIXED_PERIODS_SOAP };
      }
      if (body.includes("<m:FindItem")) {
        return { status: "succeeded", value: CALENDAR_VIEW_SOAP };
      }
      return { status: "failed", error: { code: 0, message: "unexpected op" } };
    });

    const calendar = await fetchOutlookCalendarViaEws();

    // Saturday works 540..720, not the Mon-Fri 480..1020 window — including it
    // under the first window would propose Saturday hours the user doesn't work.
    expect(calendar.workingHours).toEqual({
      daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      startMinutes: 480,
      endMinutes: 1020,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[parseAvailability] dropped 1 WorkingPeriod"),
    );
    warnSpy.mockRestore();
  });

  it("unions days across WorkingPeriods that share the first period's hours", async () => {
    installHostMock((body) => {
      if (body.includes("<m:GetUserAvailabilityRequest")) {
        return {
          status: "succeeded",
          value: AVAILABILITY_MATCHING_PERIODS_SOAP,
        };
      }
      if (body.includes("<m:FindItem")) {
        return { status: "succeeded", value: CALENDAR_VIEW_SOAP };
      }
      return { status: "failed", error: { code: 0, message: "unexpected op" } };
    });

    const calendar = await fetchOutlookCalendarViaEws();

    expect(calendar.workingHours).toEqual({
      daysOfWeek: [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ],
      startMinutes: 480,
      endMinutes: 1020,
    });
  });

  it("parses isAllDay from the CalendarView enrichment fields and omits attendeeCount", async () => {
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

    // historyMeetings: the all-day item decodes to floating civil dates via its
    // StartTimeZone (the off-by-one regression), the timed item to a UTC instant.
    expect(calendar.historyMeetings[0]).toMatchObject({
      subject: "All-day offsite",
      when: {
        kind: "date",
        startDate: "2026-07-02",
        endDateExclusive: "2026-07-03",
      },
      isRecurring: false,
      authoringTimeZone: "Europe/Berlin",
    });
    expect(calendar.historyMeetings[1]).toMatchObject({
      subject: "Solo focus block",
      when: { kind: "date-time" },
      isRecurring: true,
      authoringTimeZone: null,
    });
    // EWS never emits attendeeCount (FindItem can't return recipient lists);
    // absent must mean "backend doesn't report it", never an affirmative 0.
    for (const meeting of calendar.historyMeetings) {
      expect(meeting).not.toHaveProperty("attendeeCount");
    }

    // busyBlocks carry the same `when` + the unified busyType (OOF preserved), but
    // NOT attendeeCount.
    expect(calendar.busyBlocks[0]).toMatchObject({
      subject: "All-day offsite",
      when: {
        kind: "date",
        startDate: "2026-07-02",
        endDateExclusive: "2026-07-03",
      },
      busyType: "OOF",
    });
    expect(calendar.busyBlocks[0]).not.toHaveProperty("attendeeCount");
    expect(calendar.busyBlocks[1]).toMatchObject({
      subject: "Solo focus block",
      when: { kind: "date-time" },
      busyType: "Busy",
    });
    warnSpy.mockRestore();
  });

  it('maps NoData and off-vocabulary LegacyFreeBusyStatus to "Busy"', async () => {
    // NoData is EWS-only vocabulary; a future off-vocabulary value must not leak
    // through either — both normalize to the conservative "Busy".
    const offVocabSoap = CALENDAR_VIEW_ENRICHED_SOAP.replace(
      "<t:LegacyFreeBusyStatus>OOF</t:LegacyFreeBusyStatus>",
      "<t:LegacyFreeBusyStatus>NoData</t:LegacyFreeBusyStatus>",
    ).replace(
      "<t:LegacyFreeBusyStatus>Busy</t:LegacyFreeBusyStatus>",
      "<t:LegacyFreeBusyStatus>SomeFutureStatus</t:LegacyFreeBusyStatus>",
    );
    installHostMock((body) => {
      if (body.includes("<m:GetUserAvailabilityRequest")) {
        return { status: "succeeded", value: AVAILABILITY_SOAP };
      }
      if (body.includes("<m:FindItem")) {
        return { status: "succeeded", value: offVocabSoap };
      }
      return { status: "failed", error: { code: 0, message: "unexpected op" } };
    });

    const calendar = await fetchOutlookCalendarViaEws();

    expect(calendar.busyBlocks.map((block) => block.busyType)).toEqual([
      "Busy",
      "Busy",
    ]);
  });

  it("anchors an all-day item with an unmappable StartTimeZone to the mailbox zone, not the client OS zone", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // "Customized Time Zone" cannot resolve to IANA. The anchor must fall back
    // to the mailbox displayTimeZone (Europe/Berlin) — NOT the client OS zone,
    // which would shift the civil dates by ±1 day on a mismatched viewer.
    const unmappableSoap = CALENDAR_VIEW_ENRICHED_SOAP.replace(
      '<t:StartTimeZone Id="W. Europe Standard Time"/>',
      '<t:StartTimeZone Id="Customized Time Zone"/>',
    );
    installHostMock((body) => {
      if (body.includes("<m:GetUserAvailabilityRequest")) {
        return { status: "succeeded", value: AVAILABILITY_SOAP };
      }
      if (body.includes("<m:FindItem")) {
        return { status: "succeeded", value: unmappableSoap };
      }
      return { status: "failed", error: { code: 0, message: "unexpected op" } };
    });

    const calendar = await fetchOutlookCalendarViaEws();

    expect(calendar.historyMeetings[0]).toMatchObject({
      subject: "All-day offsite",
      when: {
        kind: "date",
        startDate: "2026-07-02",
        endDateExclusive: "2026-07-03",
      },
      // Unmappable → unknown stays unknown.
      authoringTimeZone: null,
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
      // No attendees requested → the leg resolves [] without a host call and
      // is NOT degraded.
      attendees: [],
      displayTimeZone: "Europe/Berlin",
      // Every network leg hard-failed → all three flagged (in dispatch order).
      degradedLegs: ["history", "busy", "workingHours"],
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
    // Only the working-hours leg failed; busy/history stay authoritative.
    expect(calendar.degradedLegs).toEqual(["workingHours"]);
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

// --- Attendee availability (ERMAIN-434) ---------------------------------------

const soapEnvelope = (body: string): string =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
  '<s:Body xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" ' +
  'xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">' +
  body +
  "</s:Body></s:Envelope>";

const resolutionXml = (
  name: string,
  address: string,
  mailboxType: string,
): string =>
  "<t:Resolution><t:Mailbox>" +
  `<t:Name>${name}</t:Name>` +
  `<t:EmailAddress>${address}</t:EmailAddress>` +
  "<t:RoutingType>SMTP</t:RoutingType>" +
  `<t:MailboxType>${mailboxType}</t:MailboxType>` +
  "</t:Mailbox></t:Resolution>";

const resolveNamesSoap = (resolutions: string, responseClass = "Success") =>
  soapEnvelope(
    "<m:ResolveNamesResponse><m:ResponseMessages>" +
      `<m:ResolveNamesResponseMessage ResponseClass="${responseClass}">` +
      `<m:ResponseCode>${
        responseClass === "Warning"
          ? "ErrorNameResolutionMultipleResults"
          : "NoError"
      }</m:ResponseCode>` +
      `<m:ResolutionSet>${resolutions}</m:ResolutionSet>` +
      "</m:ResolveNamesResponseMessage>" +
      "</m:ResponseMessages></m:ResolveNamesResponse>",
  );

const RESOLVE_NONE_SOAP = soapEnvelope(
  "<m:ResolveNamesResponse><m:ResponseMessages>" +
    '<m:ResolveNamesResponseMessage ResponseClass="Error">' +
    "<m:MessageText>No results were found.</m:MessageText>" +
    "<m:ResponseCode>ErrorNameResolutionNoResults</m:ResponseCode>" +
    "</m:ResolveNamesResponseMessage>" +
    "</m:ResponseMessages></m:ResolveNamesResponse>",
);

const EXPAND_DL_SOAP = soapEnvelope(
  "<m:ExpandDLResponse><m:ResponseMessages>" +
    '<m:ExpandDLResponseMessage ResponseClass="Success">' +
    "<m:ResponseCode>NoError</m:ResponseCode>" +
    '<m:DLExpansion TotalItemsInView="3" IncludesLastItemInRange="true">' +
    "<t:Mailbox><t:Name>Bob</t:Name><t:EmailAddress>bob@example.de</t:EmailAddress>" +
    "<t:RoutingType>SMTP</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Mailbox>" +
    "<t:Mailbox><t:Name>Carol</t:Name><t:EmailAddress>carol@example.de</t:EmailAddress>" +
    "<t:RoutingType>SMTP</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Mailbox>" +
    "<t:Mailbox><t:Name>Nested DL</t:Name><t:EmailAddress>nested@example.de</t:EmailAddress>" +
    "<t:RoutingType>SMTP</t:RoutingType><t:MailboxType>PublicDL</t:MailboxType></t:Mailbox>" +
    "</m:DLExpansion>" +
    "</m:ExpandDLResponseMessage>" +
    "</m:ResponseMessages></m:ExpandDLResponse>",
);

const calendarEventXml = (
  start: string,
  end: string,
  busyType: string,
): string =>
  "<t:CalendarEvent>" +
  `<t:StartTime>${start}</t:StartTime>` +
  `<t:EndTime>${end}</t:EndTime>` +
  `<t:BusyType>${busyType}</t:BusyType>` +
  "</t:CalendarEvent>";

/** The EWS half of the shared parity contract: same instants and free/busy
 * states as the Graph suite's `GET_SCHEDULE_ATTENDEES_RESPONSE`, including a
 * `Free` event that must be filtered, plus a denied second mailbox. */
const FREE_BUSY_PARITY_SOAP = soapEnvelope(
  "<m:GetUserAvailabilityResponse><m:FreeBusyResponseArray>" +
    "<m:FreeBusyResponse>" +
    '<m:ResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode></m:ResponseMessage>' +
    "<m:FreeBusyView><t:FreeBusyViewType>FreeBusy</t:FreeBusyViewType>" +
    "<t:CalendarEventArray>" +
    calendarEventXml("2026-07-07T08:00:00", "2026-07-07T09:00:00", "Busy") +
    calendarEventXml("2026-07-07T10:00:00", "2026-07-07T10:30:00", "Free") +
    calendarEventXml(
      "2026-07-07T12:00:00",
      "2026-07-07T12:30:00",
      "Tentative",
    ) +
    calendarEventXml("2026-07-08T08:00:00", "2026-07-08T16:00:00", "OOF") +
    "</t:CalendarEventArray>" +
    "</m:FreeBusyView>" +
    "</m:FreeBusyResponse>" +
    "<m:FreeBusyResponse>" +
    '<m:ResponseMessage ResponseClass="Error">' +
    "<m:MessageText>Access is denied.</m:MessageText>" +
    "<m:ResponseCode>ErrorNoFreeBusyAccess</m:ResponseCode>" +
    "</m:ResponseMessage>" +
    "</m:FreeBusyResponse>" +
    "</m:FreeBusyResponseArray></m:GetUserAvailabilityResponse>",
);

/** MergedOnly: the sharing policy publishes only the merged digit string.
 * '4' is NoData on EWS and must read as Busy. */
const FREE_BUSY_MERGED_ONLY_SOAP = soapEnvelope(
  "<m:GetUserAvailabilityResponse><m:FreeBusyResponseArray>" +
    "<m:FreeBusyResponse>" +
    '<m:ResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode></m:ResponseMessage>' +
    "<m:FreeBusyView><t:FreeBusyViewType>MergedOnly</t:FreeBusyViewType>" +
    "<t:MergedFreeBusy>0220334</t:MergedFreeBusy>" +
    "</m:FreeBusyView>" +
    "</m:FreeBusyResponse>" +
    "</m:FreeBusyResponseArray></m:GetUserAvailabilityResponse>",
);

/** A short array: ONE FreeBusyResponse returned for TWO requested mailboxes.
 * EWS echoes no identity, so a count divergence makes positional matching
 * unsafe — the guard must degrade every queried mailbox rather than hand the
 * lone calendar to the first attendee. */
const FREE_BUSY_COUNT_MISMATCH_SOAP = soapEnvelope(
  "<m:GetUserAvailabilityResponse><m:FreeBusyResponseArray>" +
    "<m:FreeBusyResponse>" +
    '<m:ResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode></m:ResponseMessage>' +
    "<m:FreeBusyView><t:FreeBusyViewType>FreeBusy</t:FreeBusyViewType>" +
    "<t:CalendarEventArray>" +
    calendarEventXml("2026-07-07T08:00:00", "2026-07-07T09:00:00", "Busy") +
    "</t:CalendarEventArray>" +
    "</m:FreeBusyView>" +
    "</m:FreeBusyResponse>" +
    "</m:FreeBusyResponseArray></m:GetUserAvailabilityResponse>",
);

const ATTENDEE_RANGE = {
  startUtc: "2026-07-07T00:00:00Z",
  endUtc: "2026-07-14T00:00:00Z",
};

describe("fetchAttendeeAvailabilityViaEws", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("queries all SMTP attendees in ONE GetUserAvailability and matches the shared parity contract", async () => {
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:GetUserAvailabilityRequest")) {
        return { status: "succeeded", value: FREE_BUSY_PARITY_SOAP };
      }
      return { status: "failed", error: { code: 0, message: "unexpected op" } };
    });

    const entries = await fetchAttendeeAvailabilityViaEws(ATTENDEE_RANGE, [
      "alice@example.de",
      "denied@example.de",
    ]);

    // SMTP inputs skip ResolveNames entirely: exactly one host call.
    expect(hostMock).toHaveBeenCalledTimes(1);
    const sent = String(hostMock.mock.calls[0][0]);
    expect(sent).toContain("<t:Address>alice@example.de</t:Address>");
    expect(sent).toContain("<t:Address>denied@example.de</t:Address>");
    // Opaque view, never Detailed (no subjects wanted or needed).
    expect(sent).toContain("<t:RequestedView>FreeBusy</t:RequestedView>");

    expect(stripReasons(entries)).toEqual(EXPECTED_ATTENDEE_PARITY);
    expect(entries[1].reason).toContain("Access is denied");
  });

  it("degrades ALL queried mailboxes to unknown when the response count != the request count", async () => {
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:GetUserAvailabilityRequest")) {
        return { status: "succeeded", value: FREE_BUSY_COUNT_MISMATCH_SOAP };
      }
      return { status: "failed", error: { code: 0, message: "unexpected op" } };
    });

    const entries = await fetchAttendeeAvailabilityViaEws(ATTENDEE_RANGE, [
      "alice@example.de",
      "bob@example.de",
    ]);

    expect(hostMock).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(2);
    // One response for two mailboxes: positions are untrustworthy, so NEITHER
    // inherits the lone Busy block — both degrade visibly instead of one
    // silently showing the other's calendar.
    for (const entry of entries) {
      expect(entry.status).toBe("unknown");
      expect(entry.busy).toEqual([]);
      expect(entry.reason).toContain("response count mismatch");
    }
  });

  it("resolves a GAL display name via ResolveNames before the availability call", async () => {
    installHostMock((body) => {
      if (body.includes("<m:ResolveNames")) {
        return {
          status: "succeeded",
          value: resolveNamesSoap(
            resolutionXml("Bob Builder", "bob@example.de", "Mailbox"),
          ),
        };
      }
      if (body.includes("<m:GetUserAvailabilityRequest")) {
        return { status: "succeeded", value: FREE_BUSY_MERGED_ONLY_SOAP };
      }
      return { status: "failed", error: { code: 0, message: "unexpected op" } };
    });

    const entries = await fetchAttendeeAvailabilityViaEws(ATTENDEE_RANGE, [
      "Bob Builder",
    ]);

    expect(entries).toEqual([
      {
        requested: "Bob Builder",
        smtp: "bob@example.de",
        status: "ok",
        // MergedFreeBusy "0220334", 30-min slices from the window start:
        // Busy 00:30–01:30, OOF 02:00–03:00, NoData('4'→Busy) 03:00–03:30.
        busy: [
          {
            when: {
              kind: "date-time",
              startUtc: "2026-07-07T00:30:00Z",
              endUtc: "2026-07-07T01:30:00Z",
            },
            busyType: "Busy",
          },
          {
            when: {
              kind: "date-time",
              startUtc: "2026-07-07T02:00:00Z",
              endUtc: "2026-07-07T03:00:00Z",
            },
            busyType: "OOF",
          },
          {
            when: {
              kind: "date-time",
              startUtc: "2026-07-07T03:00:00Z",
              endUtc: "2026-07-07T03:30:00Z",
            },
            busyType: "Busy",
          },
        ],
      },
    ]);
  });

  it("degrades ambiguous and unresolvable names to unknown without an availability call", async () => {
    const hostMock = installHostMock((body) => {
      if (body.includes("Ambiguous Person")) {
        return {
          status: "succeeded",
          value: resolveNamesSoap(
            resolutionXml("Ambiguous Person", "a1@example.de", "Mailbox") +
              resolutionXml("Ambiguous Person 2", "a2@example.de", "Mailbox"),
            "Warning",
          ),
        };
      }
      if (body.includes("<m:ResolveNames")) {
        return { status: "succeeded", value: RESOLVE_NONE_SOAP };
      }
      return { status: "failed", error: { code: 0, message: "unexpected op" } };
    });

    const entries = await fetchAttendeeAvailabilityViaEws(ATTENDEE_RANGE, [
      "Ambiguous Person",
      "Ghost",
    ]);

    expect(entries).toEqual([
      {
        requested: "Ambiguous Person",
        status: "unknown",
        reason: expect.stringContaining(
          "ambiguous name (2 directory matches: Ambiguous Person <a1@example.de>, Ambiguous Person 2 <a2@example.de>)",
        ),
        busy: [],
      },
      {
        requested: "Ghost",
        status: "unknown",
        reason: expect.stringContaining("not found in the directory"),
        busy: [],
      },
    ]);
    // Nothing resolved → GetUserAvailability is never sent.
    const availabilityCalls = hostMock.mock.calls.filter((call) =>
      String(call[0]).includes("<m:GetUserAvailabilityRequest"),
    );
    expect(availabilityCalls).toHaveLength(0);
  });

  it("expands a DL one level, skipping nested DLs with a caveat on the first member", async () => {
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:ResolveNames")) {
        return {
          status: "succeeded",
          value: resolveNamesSoap(
            resolutionXml("Sales Team", "sales@example.de", "PublicDL"),
          ),
        };
      }
      if (body.includes("<m:ExpandDL")) {
        return { status: "succeeded", value: EXPAND_DL_SOAP };
      }
      if (body.includes("<m:GetUserAvailabilityRequest")) {
        return { status: "succeeded", value: FREE_BUSY_PARITY_SOAP };
      }
      return { status: "failed", error: { code: 0, message: "unexpected op" } };
    });

    const entries = await fetchAttendeeAvailabilityViaEws(ATTENDEE_RANGE, [
      "Sales Team",
    ]);

    const expandBody = hostMock.mock.calls
      .map((call) => String(call[0]))
      .find((sent) => sent.includes("<m:ExpandDL"));
    expect(expandBody).toContain(
      "<t:EmailAddress>sales@example.de</t:EmailAddress>",
    );

    // Two resolvable members ride the parity response: ok + denied-unknown.
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      requested: "Sales Team",
      smtp: "bob@example.de",
      status: "ok",
      reason: expect.stringContaining("nested distribution list"),
    });
    expect(entries[1]).toMatchObject({
      requested: "Sales Team",
      smtp: "carol@example.de",
      status: "unknown",
    });
  });

  it("returns [] for an empty attendee list without a host call", async () => {
    const hostMock = installHostMock(() => ({
      status: "failed",
      error: { code: 0, message: "should not be called" },
    }));
    await expect(
      fetchAttendeeAvailabilityViaEws(ATTENDEE_RANGE, []),
    ).resolves.toEqual([]);
    expect(hostMock).not.toHaveBeenCalled();
  });
});
