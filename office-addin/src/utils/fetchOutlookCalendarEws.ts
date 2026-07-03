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
 * EWS SOAP calendar sourcing for Exchange on-premises / Subscription Edition
 * (SI-3 / ERMAIN-385), where Microsoft Graph does not exist. Busy blocks + meeting
 * history come from FindItem + CalendarView over the signed-in user's OWN
 * `calendar` distinguished folder — PROVEN against a live SE box (Exchange 2019 /
 * SE 15.2.2562) at RequestServerVersion Exchange2013_SP1. Each `t:CalendarItem`
 * returns Subject/Start/End/IsRecurring/LegacyFreeBusyStatus, with timed Start/End
 * already in UTC (`…Z`); CalendarView expands recurring series into their
 * occurrences inside the requested window (exactly what busy / history want). We
 * also request IsAllDayEvent and StartTimeZone (the authoring zone, returned inline
 * by FindItem — CONFIRMED on the live SE box).
 * All-day events are stored as the UTC instant of authoring-zone midnight, so they
 * are localized back to that zone and emitted as floating dates — never `.slice`d
 * off the raw `Z` string (the classic off-by-one all-day bug).
 *
 * Working hours come from GetUserAvailability over the same (own) mailbox. A hard
 * failure there degrades to `workingHours: null` + a `degradedLegs` flag rather
 * than breaking the proven busy / history core; every leg degrades independently.
 *
 * v1 scope is the SIGNED-IN USER's OWN calendar only. Every operation goes through
 * the HOST transport ({@link ewsHostFetch} → `makeEwsRequestAsync`), NOT the
 * item-scoped callback-token proxy: calendar / availability reads are mailbox-wide,
 * which the item-scoped callback token does not authorize. Emitted start/end values
 * are UTC ISO-8601 ending in `Z` (we only strip millis if present).
 *
 * The environment dispatcher + shared `Normalized*` types live in
 * `./fetchOutlookCalendar.ts`; the Graph sibling (SI-2) in
 * `./fetchOutlookCalendarGraph.ts`.
 */

/** A CalendarItem parsed straight off a CalendarView FindItem response, pre-normalization. */
interface RawCalendarItem {
  start: string;
  end: string;
  subject: string;
  isRecurring: boolean;
  legacyFreeBusyStatus: string | undefined;
  isAllDay: boolean;
  /** The `Id` of the item's StartTimeZone (a Windows zone name), when present. */
  startTimeZoneId: string | undefined;
}

// --- SOAP body builders ----------------------------------------------------

/**
 * FindItem + CalendarView over the user's OWN `calendar` distinguished folder —
 * the PROVEN path. IdOnly shape plus the calendar fields we normalize. We
 * deliberately do NOT reuse the mail `buildParentFolderIdsXml`, which fans out
 * over the well-known MAIL folders.
 */
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
 * A no-DST, UTC `SerializableTimeZone` for GetUserAvailability.
 *
 * CONFIRMED LIVE on Exchange 2019/SE (build 15.2.2562, 2026-06-19): both
 * transitions carry `Month=0` / `DayOrder=0`, which signals "no transition" (a
 * flat UTC zone) and is ACCEPTED — GetUserAvailability returns a clean
 * FreeBusyView + WorkingHours. (SI-1 had earlier seen a DEGENERATE TimeZone with
 * StandardTime & DaylightTime sharing the same Jan-1 transition rejected as "The
 * specified time zone isn't valid"; `Month=0` / `DayOrder=0` avoids that.) Even
 * so, a GetUserAvailability failure only degrades the working-hours leg (null +
 * `degradedLegs`), never the busy / history core.
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

/**
 * GetUserAvailability for a single mailbox (the signed-in user). Element order is
 * STRICT per the schema: TimeZone → MailboxDataArray → FreeBusyViewOptions, and
 * inside FreeBusyViewOptions: TimeWindow → MergedFreeBusyIntervalInMinutes →
 * RequestedView. RequestedView is `Detailed` so the response carries WorkingHours.
 */
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

/**
 * Parses a CalendarView FindItem response into raw calendar items. EWS returns one
 * FindItemResponseMessage for the single `calendar` folder. Throws (via
 * {@link assertResponseOk}) on a hard response error.
 */
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
      // Start/End are mandatory on a CalendarItem; skip malformed rows rather than
      // emitting an interval with missing bounds.
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
 * Parses WorkingHours out of a GetUserAvailability response. `DayOfWeek` inside a
 * WorkingPeriod is a SPACE-SEPARATED list and there may be several WorkingPeriods,
 * but {@link NormalizedWorkingHours} carries a SINGLE start/end window (as does
 * Graph), so the collapse is lossy by necessity: the window comes from the FIRST
 * period and only days from periods with the SAME window are kept. Days with
 * different hours are dropped — understating availability is safe; unioning them
 * under the first window would propose hours the user doesn't work. Returns null
 * when the response carries no WorkingHours.
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
    for (const day of (typesText(period, "DayOfWeek") ?? "").split(/\s+/)) {
      // Lowercase to match the Graph backend's day names (unified contract).
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

/**
 * Normalize an EWS dateTime to a millis-free UTC `…Z` instant. CalendarView
 * returns UTC (`…Z`) on our path, but a value carrying an explicit offset
 * (`…+02:00`, as a TimeZoneContext'd box would emit) is an equally valid instant —
 * both are parsed and re-serialized as UTC. Only a bare value (no designator) is
 * assumed already-UTC and gets a `Z` appended.
 */
function toUtcIso(value: string): string {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return `${value}Z`;
}

/**
 * Projects a raw item's start/end onto the {@link NormalizedEventWhen} union.
 * Timed events are true UTC instants; all-day events are floating civil dates
 * recovered by localizing the UTC instant to the item's AUTHORING zone (its
 * StartTimeZone, falling back to the mailbox `displayTimeZone`). `authoringTimeZone`
 * is the IANA form of that zone, or null when EWS didn't report one or it can't
 * be mapped — strict resolution, because the {@link toIana} fallback would
 * anchor to the VIEWER's OS zone and shift all-day dates by ±1 day.
 */
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

/**
 * `LegacyFreeBusyStatus` is already the unified vocabulary (Free / Tentative / Busy
 * / OOF / WorkingElsewhere), bar EWS's extra `NoData`. Pass unified values through;
 * map absent / `NoData` / anything off-vocabulary to `Busy` conservatively (a block
 * with no status still occupies time). See the busyType vocab note in
 * `fetchOutlookCalendar.ts`.
 */
function mapBusyType(
  legacyFreeBusyStatus: string | undefined,
): NormalizedBusyType {
  return legacyFreeBusyStatus && BUSY_TYPES.has(legacyFreeBusyStatus)
    ? (legacyFreeBusyStatus as NormalizedBusyType)
    : "Busy";
}

// --- Public per-leg fetchers -----------------------------------------------

/**
 * Past meetings in `range` (look-back window) from the user's own calendar. THROWS
 * `EwsRequestError` on a hard EWS failure — the dispatcher
 * {@link fetchOutlookCalendarViaEws} decides whether to degrade.
 */
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

/**
 * Busy blocks in `range` (look-forward window) from the user's own calendar. THROWS
 * `EwsRequestError` on a hard EWS failure.
 */
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

/**
 * Working hours from GetUserAvailability over the user's own mailbox. Returns null
 * when working hours are genuinely absent (no mailbox address, or a successful
 * response carrying no WorkingHours). THROWS on a hard EWS failure so the
 * dispatcher can flag the `workingHours` leg degraded; only an abort is re-thrown
 * verbatim.
 */
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

/**
 * Sources the signed-in user's own calendar via EWS into a
 * {@link NormalizedCalendar}: busy blocks (now → +freeBusyWindowDays) and meeting
 * history (now-historyWindowDays → now) from the PROVEN CalendarView path, plus
 * working hours. The three legs run concurrently via {@link runCalendarLegs}.
 * After the `getEwsUrl()` precheck this NEVER throws except to propagate an
 * abort — a failed leg degrades to `[]` / null AND is named in `degradedLegs`
 * so a single unavailable capability can't sink the whole snapshot (nor be
 * mistaken for a genuinely empty one).
 */
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
