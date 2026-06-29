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

import type {
  CalendarFetchOptions,
  NormalizedBusyBlock,
  NormalizedCalendar,
  NormalizedHistoryMeeting,
  NormalizedWorkingHours,
} from "./fetchOutlookCalendar";

/**
 * EWS SOAP calendar sourcing for Exchange on-premises / Subscription Edition
 * (SI-3 / ERMAIN-385), where Microsoft Graph does not exist. The reliable core —
 * busy blocks + meeting history — comes from FindItem + CalendarView over the
 * signed-in user's OWN `calendar` distinguished folder, PROVEN against a live SE
 * box (Exchange 2019 / SE 15.2.2562) at RequestServerVersion Exchange2013_SP1:
 * each `t:CalendarItem` returns item:Subject, calendar:Start, calendar:End,
 * calendar:IsRecurring, calendar:LegacyFreeBusyStatus, with Start/End already in
 * UTC (`…Z`). CalendarView expands recurring series into their occurrences inside
 * the requested window, which is exactly what busy / history want. We
 * additionally request calendar:IsAllDayEvent + the Required/Optional attendee
 * collections to populate the `isAllDay` / `attendeeCount` enrichment on the
 * shared shapes (Graph carries the same fields); these are best-effort reads —
 * an item without them simply omits the optional field.
 *
 * Working hours come from GetUserAvailability over the same (own) mailbox, but as
 * a BEST-EFFORT leg that degrades to `workingHours: null` on ANY failure — its
 * TimeZone block is confirmed live on Exchange 2019/SE (see
 * {@link buildSerializableUtcTimeZone}), but the degrade keeps a restricted or
 * older mailbox from ever breaking the proven busy / history core.
 *
 * v1 scope is the SIGNED-IN USER's OWN calendar only. Every operation goes
 * through the HOST transport ({@link ewsHostFetch} → `makeEwsRequestAsync`), NOT
 * the item-scoped callback-token proxy: calendar / availability reads are
 * mailbox-wide, which the item-scoped callback token does not authorize. All
 * emitted start/end values are UTC ISO-8601 ending in `Z` (CalendarView already
 * returns `…Z`; we only strip millis if present).
 *
 * The environment dispatcher + shared `Normalized*` types live in
 * `./fetchOutlookCalendar.ts`; the Graph sibling (SI-2) lives in
 * `./fetchOutlookCalendarGraph.ts`.
 */

/** Default look-back (history) and look-forward (busy) window, in days. */
const DEFAULT_WINDOW_DAYS = 21;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A UTC time range for a single CalendarView / availability query. Both bounds
 * are EWS dateTime strings (UTC, `…Z`).
 */
export interface CalendarRange {
  startUtc: string;
  endUtc: string;
}

/**
 * A CalendarItem as parsed straight off a CalendarView FindItem response, before
 * normalization to the backend-agnostic shapes.
 */
interface RawCalendarItem {
  start: string;
  end: string;
  subject: string;
  isRecurring: boolean;
  legacyFreeBusyStatus: string | undefined;
  isAllDay: boolean;
  attendeeCount: number;
}

// --- SOAP body builders ----------------------------------------------------

/**
 * FindItem + CalendarView over the user's OWN `calendar` distinguished folder —
 * the PROVEN path. IdOnly shape plus the calendar fields we normalize. The inline
 * `<m:ParentFolderIds>` carries the single `calendar` DistinguishedFolderId; we
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
      "calendar:RequiredAttendees",
      "calendar:OptionalAttendees",
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
 * so, {@link fetchWorkingHoursViaEws} still degrades working hours to null on ANY
 * failure, so a restricted or older mailbox can never break the proven busy /
 * history core.
 */
function buildSerializableUtcTimeZone(): string {
  // Month=0 + DayOrder=0 ⇒ "no transition" for this rule.
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
 * Parses a CalendarView FindItem response into raw calendar items. EWS returns
 * one FindItemResponseMessage for the single `calendar` folder; each
 * `t:CalendarItem` carries the requested calendar fields. Throws (via
 * {@link assertResponseOk}) on a hard response error.
 */
export function parseCalendarView(doc: Document): RawCalendarItem[] {
  const items: RawCalendarItem[] = [];
  for (const responseMessage of allMessagesEls(
    doc,
    "FindItemResponseMessage",
  )) {
    assertResponseOk(responseMessage);
    for (const calendarItem of allTypesEls(responseMessage, "CalendarItem")) {
      const start = typesText(calendarItem, "Start");
      const end = typesText(calendarItem, "End");
      // Start/End are mandatory on a CalendarItem; skip any malformed row rather
      // than emitting an interval with missing bounds.
      if (!start || !end) continue;
      // `t:Attendee` lives under both RequiredAttendees and OptionalAttendees;
      // `allTypesEls` walks all descendants, so this counts invitees across both
      // collections (each Attendee wraps exactly one Mailbox).
      const attendeeCount = allTypesEls(calendarItem, "Attendee").length;
      items.push({
        start,
        end,
        subject: typesText(calendarItem, "Subject") ?? "",
        isRecurring: typesText(calendarItem, "IsRecurring") === "true",
        legacyFreeBusyStatus: typesText(calendarItem, "LegacyFreeBusyStatus"),
        isAllDay: typesText(calendarItem, "IsAllDayEvent") === "true",
        attendeeCount,
      });
    }
  }
  return items;
}

/**
 * Parses the WorkingHours out of a GetUserAvailability response. `DayOfWeek`
 * inside a WorkingPeriod is a SPACE-SEPARATED list and there may be several
 * WorkingPeriods, so the days are split on whitespace and unioned; the
 * start/end-minute window is read from the FIRST period. Returns null when the
 * response carries no WorkingHours.
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

  const daysOfWeek = new Set<string>();
  for (const period of periods) {
    for (const day of (typesText(period, "DayOfWeek") ?? "").split(/\s+/)) {
      if (day) daysOfWeek.add(day);
    }
  }
  const first = periods[0];
  return {
    daysOfWeek: Array.from(daysOfWeek),
    startMinutes: Number(typesText(first, "StartTimeInMinutes")),
    endMinutes: Number(typesText(first, "EndTimeInMinutes")),
  };
}

// --- Normalization helpers -------------------------------------------------

/**
 * CalendarView already returns UTC (`…Z`); normalize to a millis-free `…Z`
 * ISO-8601. A value that somehow lacks the designator is assumed UTC and gets a
 * `Z` appended.
 */
function toUtcIso(value: string): string {
  return value.endsWith("Z") ? value.replace(/\.\d{3}Z$/, "Z") : `${value}Z`;
}

/** A `Date` as an EWS dateTime string: millis-free UTC ISO-8601 (`…Z`). */
function toEwsDateTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The mailbox's own time zone, preferring the Office user profile and falling
 * back to the runtime's resolved zone.
 */
function resolveTimezone(): string {
  return (
    Office.context.mailbox.userProfile?.timeZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}

/**
 * `LegacyFreeBusyStatus` is already the unified vocabulary (Free / Tentative /
 * Busy / OOF / WorkingElsewhere), bar EWS's extra `NoData`. Pass the unified
 * values through; map `NoData` and any absent value to `Busy` conservatively (a
 * calendar block with no status still occupies time). See the busyType vocab
 * note in `fetchOutlookCalendar.ts`.
 */
function mapBusyType(legacyFreeBusyStatus: string | undefined): string {
  if (!legacyFreeBusyStatus || legacyFreeBusyStatus === "NoData") {
    return "Busy";
  }
  return legacyFreeBusyStatus;
}

// --- Public per-leg fetchers -----------------------------------------------

/**
 * Past meetings in `range` (the look-back window) from the user's own calendar.
 * THROWS `EwsRequestError` on a hard EWS failure — the dispatcher
 * {@link fetchOutlookCalendarViaEws} decides whether to degrade.
 */
export async function fetchCalendarHistoryViaEws(
  range: CalendarRange,
  options: CalendarFetchOptions = {},
): Promise<NormalizedHistoryMeeting[]> {
  throwIfAborted(options.signal);
  const doc = await ewsHostFetch(
    buildSoapEnvelope(
      buildCalendarViewFindItemBody(range.startUtc, range.endUtc),
    ),
  );
  return parseCalendarView(doc).map((item) => ({
    start: toUtcIso(item.start),
    end: toUtcIso(item.end),
    subject: item.subject,
    isRecurring: item.isRecurring,
    isAllDay: item.isAllDay,
    attendeeCount: item.attendeeCount,
  }));
}

/**
 * Busy blocks in `range` (the look-forward window) from the user's own calendar.
 * THROWS `EwsRequestError` on a hard EWS failure.
 */
export async function fetchCalendarBusyViaEws(
  range: CalendarRange,
  options: CalendarFetchOptions = {},
): Promise<NormalizedBusyBlock[]> {
  throwIfAborted(options.signal);
  const doc = await ewsHostFetch(
    buildSoapEnvelope(
      buildCalendarViewFindItemBody(range.startUtc, range.endUtc),
    ),
  );
  return parseCalendarView(doc).map((item) => ({
    start: toUtcIso(item.start),
    end: toUtcIso(item.end),
    busyType: mapBusyType(item.legacyFreeBusyStatus),
    subject: item.subject || undefined,
    isAllDay: item.isAllDay,
  }));
}

/**
 * Working hours from GetUserAvailability over the user's own mailbox.
 * BEST-EFFORT: returns null on ANY failure (defensive — though the TimeZone block
 * is confirmed live on Exchange 2019/SE, see {@link buildSerializableUtcTimeZone})
 * so a restricted/older mailbox can never break the proven busy / history core.
 * An abort is the one thing it re-throws.
 */
export async function fetchWorkingHoursViaEws(
  range: CalendarRange,
  options: CalendarFetchOptions = {},
): Promise<NormalizedWorkingHours | null> {
  const smtpAddress = Office.context.mailbox.userProfile?.emailAddress;
  if (!smtpAddress) return null;
  try {
    throwIfAborted(options.signal);
    const doc = await ewsHostFetch(
      buildSoapEnvelope(
        buildGetUserAvailabilityBody(smtpAddress, range.startUtc, range.endUtc),
      ),
    );
    return parseAvailability(doc);
  } catch (error) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? error;
    }
    console.warn(
      "[fetchWorkingHoursViaEws] working hours unavailable (best-effort):",
      error,
    );
    return null;
  }
}

/**
 * Sources the signed-in user's own calendar via EWS into a {@link
 * NormalizedCalendar}: busy blocks (now → +freeBusyWindowDays) and meeting
 * history (now-historyWindowDays → now) from the PROVEN CalendarView path, plus
 * best-effort working hours. After the `getEwsUrl()` precheck this NEVER throws
 * except to propagate an abort — a restricted or failed leg degrades to `[]` /
 * null so a single unavailable capability can't sink the whole snapshot.
 */
export async function fetchOutlookCalendarViaEws(
  options: CalendarFetchOptions = {},
): Promise<NormalizedCalendar> {
  // Precheck: EWS must be reachable on this mailbox (throws if `ewsUrl` absent).
  getEwsUrl();

  const { signal } = options;
  const historyWindowDays = options.historyWindowDays ?? DEFAULT_WINDOW_DAYS;
  const freeBusyWindowDays = options.freeBusyWindowDays ?? DEFAULT_WINDOW_DAYS;

  const now = new Date();
  const historyRange: CalendarRange = {
    startUtc: toEwsDateTime(
      new Date(now.getTime() - historyWindowDays * MS_PER_DAY),
    ),
    endUtc: toEwsDateTime(now),
  };
  const busyRange: CalendarRange = {
    startUtc: toEwsDateTime(now),
    endUtc: toEwsDateTime(
      new Date(now.getTime() + freeBusyWindowDays * MS_PER_DAY),
    ),
  };

  const timezone = resolveTimezone();

  let historyMeetings: NormalizedHistoryMeeting[] = [];
  try {
    historyMeetings = await fetchCalendarHistoryViaEws(historyRange, options);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    console.warn("[fetchOutlookCalendarViaEws] history leg degraded:", error);
  }

  throwIfAborted(signal);

  let busyBlocks: NormalizedBusyBlock[] = [];
  try {
    busyBlocks = await fetchCalendarBusyViaEws(busyRange, options);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    console.warn("[fetchOutlookCalendarViaEws] busy leg degraded:", error);
  }

  throwIfAborted(signal);

  // GetUserAvailability is already best-effort (resolves null on failure); keep
  // the try/catch so an abort it re-throws still propagates as an abort.
  let workingHours: NormalizedWorkingHours | null = null;
  try {
    workingHours = await fetchWorkingHoursViaEws(busyRange, options);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    console.warn(
      "[fetchOutlookCalendarViaEws] working-hours leg degraded:",
      error,
    );
  }

  return { workingHours, busyBlocks, historyMeetings, timezone };
}
