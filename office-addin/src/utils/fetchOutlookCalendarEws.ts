import {
  computeCalendarRanges,
  resolveTimezone,
  runCalendarLegs,
} from "./calendarLegs";
import { utcInstantToCivilDate } from "./calendarTime";
import {
  allMessagesEls,
  allTypesEls,
  assertResponseOk,
  buildAdditionalPropertiesXml,
  buildSoapEnvelope,
  escapeXml,
  ewsHostFetch,
  firstMessagesEl,
  firstTypesEl,
  getEwsUrl,
  throwIfAborted,
  typesText,
} from "./fetchOutlookMessageEws";
import { toIanaStrict } from "./windowsZones";

import type { CalendarRange } from "./calendarLegs";
import type {
  CalendarFetchOptions,
  NormalizedBusyBlock,
  NormalizedBusyType,
  NormalizedCalendar,
  NormalizedEventWhen,
  NormalizedHistoryMeeting,
  NormalizedWorkingHours,
} from "./fetchOutlookCalendar";

export type { CalendarRange } from "./calendarLegs";

/**
 * EWS SOAP calendar sourcing for Exchange on-prem / Subscription Edition
 * (SI-3 / ERMAIN-385), where Graph does not exist; Graph sibling in
 * `./fetchOutlookCalendarGraph.ts`, shared contract in `./fetchOutlookCalendar.ts`.
 * v1 reads the SIGNED-IN USER's OWN calendar, proven live against SE 15.2.2562
 * at RequestServerVersion Exchange2013_SP1. Every operation uses the HOST
 * transport ({@link ewsHostFetch} → `makeEwsRequestAsync`) — calendar /
 * availability reads are mailbox-wide, which the item-scoped callback token
 * does not authorize. CalendarView expands recurring series into occurrences;
 * all-day events arrive as the UTC instant of authoring-zone midnight and are
 * localized back to that zone (never `.slice`d off the raw `Z` string — the
 * classic off-by-one all-day bug). Per-leg fetchers THROW on hard failure; the
 * top-level fetcher degrades each leg independently.
 */

interface RawCalendarItem {
  start: string;
  end: string;
  subject: string;
  isRecurring: boolean;
  legacyFreeBusyStatus: string | undefined;
  isAllDay: boolean;
  /** StartTimeZone `Id` (a Windows zone name), when present. */
  startTimeZoneId: string | undefined;
}

// --- SOAP body builders ----------------------------------------------------

/** Deliberately does NOT reuse the mail `buildParentFolderIdsXml`, which fans
 * out over the well-known MAIL folders. */
export function buildCalendarViewFindItemBody(
  startUtc: string,
  endUtc: string,
): string {
  return (
    '<m:FindItem Traversal="Shallow">' +
    "<m:ItemShape>" +
    "<t:BaseShape>IdOnly</t:BaseShape>" +
    buildAdditionalPropertiesXml([
      "item:Subject",
      "calendar:Start",
      "calendar:End",
      "calendar:IsRecurring",
      "calendar:LegacyFreeBusyStatus",
      "calendar:IsAllDayEvent",
      "calendar:StartTimeZone",
    ]) +
    "</m:ItemShape>" +
    `<m:CalendarView MaxEntriesReturned="1000" StartDate="${startUtc}" EndDate="${endUtc}"/>` +
    "<m:ParentFolderIds>" +
    '<t:DistinguishedFolderId Id="calendar"/>' +
    "</m:ParentFolderIds>" +
    "</m:FindItem>"
  );
}

/**
 * A no-DST, UTC `SerializableTimeZone` for GetUserAvailability. `Month=0` /
 * `DayOrder=0` signals "no transition" and is confirmed accepted on live SE;
 * a StandardTime/DaylightTime pair sharing the same Jan-1 transition is
 * REJECTED as "The specified time zone isn't valid" — don't "simplify" to that.
 */
function buildSerializableUtcTimeZone(): string {
  const noTransition =
    "<t:Bias>0</t:Bias>" +
    "<t:Time>00:00:00</t:Time>" +
    "<t:DayOrder>0</t:DayOrder>" +
    "<t:Month>0</t:Month>" +
    "<t:DayOfWeek>Sunday</t:DayOfWeek>";
  return (
    "<t:TimeZone>" +
    "<t:Bias>0</t:Bias>" +
    `<t:StandardTime>${noTransition}</t:StandardTime>` +
    `<t:DaylightTime>${noTransition}</t:DaylightTime>` +
    "</t:TimeZone>"
  );
}

/** Element order is STRICT per the schema (TimeZone → MailboxDataArray →
 * FreeBusyViewOptions; TimeWindow → Interval → RequestedView). RequestedView
 * `Detailed` makes the response carry WorkingHours. */
export function buildGetUserAvailabilityBody(
  smtpAddress: string,
  startUtc: string,
  endUtc: string,
): string {
  return (
    "<m:GetUserAvailabilityRequest>" +
    buildSerializableUtcTimeZone() +
    "<m:MailboxDataArray>" +
    "<t:MailboxData>" +
    "<t:Email>" +
    `<t:Address>${escapeXml(smtpAddress)}</t:Address>` +
    "</t:Email>" +
    "<t:AttendeeType>Required</t:AttendeeType>" +
    "<t:ExcludeConflicts>false</t:ExcludeConflicts>" +
    "</t:MailboxData>" +
    "</m:MailboxDataArray>" +
    "<t:FreeBusyViewOptions>" +
    "<t:TimeWindow>" +
    `<t:StartTime>${startUtc}</t:StartTime>` +
    `<t:EndTime>${endUtc}</t:EndTime>` +
    "</t:TimeWindow>" +
    "<t:MergedFreeBusyIntervalInMinutes>30</t:MergedFreeBusyIntervalInMinutes>" +
    "<t:RequestedView>Detailed</t:RequestedView>" +
    "</t:FreeBusyViewOptions>" +
    "</m:GetUserAvailabilityRequest>"
  );
}

// --- Response parsing ------------------------------------------------------

export function parseCalendarView(doc: Document): RawCalendarItem[] {
  const items: RawCalendarItem[] = [];
  for (const responseMessage of allMessagesEls(
    doc,
    "FindItemResponseMessage",
  )) {
    assertResponseOk(responseMessage);
    const rootFolder = firstMessagesEl(responseMessage, "RootFolder");
    if (rootFolder?.getAttribute("IncludesLastItemInRange") === "false") {
      console.warn(
        "[parseCalendarView] FindItem results truncated (IncludesLastItemInRange=false); some calendar items were dropped",
      );
    }
    for (const calendarItem of allTypesEls(responseMessage, "CalendarItem")) {
      const start = typesText(calendarItem, "Start");
      const end = typesText(calendarItem, "End");
      // Skip malformed rows rather than emit an interval with missing bounds.
      if (!start || !end) continue;
      items.push({
        start,
        end,
        subject: typesText(calendarItem, "Subject") ?? "",
        isRecurring: typesText(calendarItem, "IsRecurring") === "true",
        legacyFreeBusyStatus: typesText(calendarItem, "LegacyFreeBusyStatus"),
        isAllDay: typesText(calendarItem, "IsAllDayEvent") === "true",
        startTimeZoneId:
          firstTypesEl(calendarItem, "StartTimeZone")?.getAttribute("Id") ??
          undefined,
      });
    }
  }
  return items;
}

/**
 * `NormalizedWorkingHours` carries a SINGLE window (as does Graph), so multiple
 * WorkingPeriods collapse lossily: the window comes from the FIRST period and
 * only days of same-window periods are kept — dropping a day understates
 * availability, which is safe; unioning it under the wrong hours is not.
 */
export function parseAvailability(
  doc: Document,
): NormalizedWorkingHours | null {
  const freeBusyResponse = allMessagesEls(doc, "FreeBusyResponse")[0];
  if (!freeBusyResponse) return null;
  const responseMessage = firstMessagesEl(freeBusyResponse, "ResponseMessage");
  if (responseMessage) {
    assertResponseOk(responseMessage);
  }
  const workingHours = firstTypesEl(freeBusyResponse, "WorkingHours");
  if (!workingHours) return null;
  const periods = allTypesEls(workingHours, "WorkingPeriod");
  if (periods.length === 0) return null;

  const first = periods[0];
  const startMinutes = Number(typesText(first, "StartTimeInMinutes"));
  const endMinutes = Number(typesText(first, "EndTimeInMinutes"));
  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) return null;

  const daysOfWeek = new Set<string>();
  let droppedPeriods = 0;
  for (const period of periods) {
    if (
      Number(typesText(period, "StartTimeInMinutes")) !== startMinutes ||
      Number(typesText(period, "EndTimeInMinutes")) !== endMinutes
    ) {
      droppedPeriods += 1;
      continue;
    }
    // DayOfWeek is a space-separated list; lowercased to match Graph's day names.
    for (const day of (typesText(period, "DayOfWeek") ?? "").split(/\s+/)) {
      if (day) daysOfWeek.add(day.toLowerCase());
    }
  }
  if (droppedPeriods > 0) {
    console.warn(
      `[parseAvailability] dropped ${droppedPeriods} WorkingPeriod(s) with hours differing from the first; workingHours understates availability`,
    );
  }
  return {
    daysOfWeek: Array.from(daysOfWeek),
    startMinutes,
    endMinutes,
  };
}

// --- Normalization helpers -------------------------------------------------

/** EWS dateTime → millis-free UTC `…Z`. Values with an explicit offset (as a
 * TimeZoneContext'd box would emit) are re-serialized as UTC; only a bare value
 * (no designator) is assumed already-UTC. */
function toUtcIso(value: string): string {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return `${value}Z`;
}

/** All-day civil dates are recovered by localizing the UTC instant to the
 * item's authoring zone, falling back to the mailbox `displayTimeZone`.
 * Resolution is strict — the `toIana` fallback would anchor to the VIEWER's OS
 * zone and shift all-day dates by ±1 day. */
function normalizeWhen(
  item: RawCalendarItem,
  displayTimeZone: string,
): { when: NormalizedEventWhen; authoringTimeZone: string | null } {
  const authoringTimeZone = toIanaStrict(item.startTimeZoneId);
  if (item.isAllDay) {
    const anchor = authoringTimeZone ?? displayTimeZone;
    return {
      when: {
        kind: "date",
        startDate: utcInstantToCivilDate(toUtcIso(item.start), anchor),
        endDateExclusive: utcInstantToCivilDate(toUtcIso(item.end), anchor),
      },
      authoringTimeZone,
    };
  }
  return {
    when: {
      kind: "date-time",
      startUtc: toUtcIso(item.start),
      endUtc: toUtcIso(item.end),
    },
    authoringTimeZone,
  };
}

const BUSY_TYPES: ReadonlySet<string> = new Set([
  "Free",
  "Tentative",
  "Busy",
  "OOF",
  "WorkingElsewhere",
] satisfies NormalizedBusyType[]);

function mapBusyType(
  legacyFreeBusyStatus: string | undefined,
): NormalizedBusyType {
  return legacyFreeBusyStatus && BUSY_TYPES.has(legacyFreeBusyStatus)
    ? (legacyFreeBusyStatus as NormalizedBusyType)
    : "Busy";
}

// --- Public per-leg fetchers -----------------------------------------------

/** Past meetings in `range` (the look-back window). */
export async function fetchCalendarHistoryViaEws(
  range: CalendarRange,
  options: CalendarFetchOptions = {},
): Promise<NormalizedHistoryMeeting[]> {
  throwIfAborted(options.signal);
  const displayTimeZone = resolveTimezone();
  const doc = await ewsHostFetch(
    buildSoapEnvelope(
      buildCalendarViewFindItemBody(range.startUtc, range.endUtc),
    ),
  );
  return parseCalendarView(doc).map((item) => {
    const { when, authoringTimeZone } = normalizeWhen(item, displayTimeZone);
    // No attendeeCount: FindItem never returns recipient lists (GetItem-only),
    // so a count derived here would always read 0 — a false "solo meeting" claim.
    return {
      when,
      subject: item.subject,
      isRecurring: item.isRecurring,
      authoringTimeZone,
    };
  });
}

/** Busy blocks in `range`. busyType is faithful (Free included); the prompt
 * decides policy. */
export async function fetchCalendarBusyViaEws(
  range: CalendarRange,
  options: CalendarFetchOptions = {},
): Promise<NormalizedBusyBlock[]> {
  throwIfAborted(options.signal);
  const displayTimeZone = resolveTimezone();
  const doc = await ewsHostFetch(
    buildSoapEnvelope(
      buildCalendarViewFindItemBody(range.startUtc, range.endUtc),
    ),
  );
  return parseCalendarView(doc).map((item) => {
    const { when, authoringTimeZone } = normalizeWhen(item, displayTimeZone);
    return {
      when,
      busyType: mapBusyType(item.legacyFreeBusyStatus),
      subject: item.subject || undefined,
      authoringTimeZone,
    };
  });
}

/** Working hours from GetUserAvailability. Returns null when genuinely absent;
 * THROWS on a hard EWS failure. */
export async function fetchWorkingHoursViaEws(
  range: CalendarRange,
  options: CalendarFetchOptions = {},
): Promise<NormalizedWorkingHours | null> {
  const smtpAddress = Office.context.mailbox.userProfile?.emailAddress;
  if (!smtpAddress) return null;
  throwIfAborted(options.signal);
  const doc = await ewsHostFetch(
    buildSoapEnvelope(
      buildGetUserAvailabilityBody(smtpAddress, range.startUtc, range.endUtc),
    ),
  );
  return parseAvailability(doc);
}

/** The full EWS calendar snapshot. After the `getEwsUrl()` precheck this NEVER
 * throws except to propagate an abort — a failed leg degrades to `[]` / null
 * and is named in `degradedLegs`. */
export async function fetchOutlookCalendarViaEws(
  options: CalendarFetchOptions = {},
): Promise<NormalizedCalendar> {
  // Precheck: EWS must be reachable on this mailbox (throws if `ewsUrl` absent).
  getEwsUrl();

  const { historyRange, busyRange } = computeCalendarRanges(
    new Date(),
    options,
  );
  const displayTimeZone = resolveTimezone();

  const { historyMeetings, busyBlocks, workingHours, degradedLegs } =
    await runCalendarLegs(
      {
        history: () => fetchCalendarHistoryViaEws(historyRange, options),
        busy: () => fetchCalendarBusyViaEws(busyRange, options),
        workingHours: () => fetchWorkingHoursViaEws(busyRange, options),
      },
      options.signal,
      "[fetchOutlookCalendarViaEws]",
    );

  return {
    workingHours,
    busyBlocks,
    historyMeetings,
    displayTimeZone,
    degradedLegs,
  };
}
