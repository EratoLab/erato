import {
  computeCalendarRanges,
  MS_PER_DAY,
  resolveTimezone,
  runCalendarLegs,
  throwIfAborted,
  toUtcNoMillis,
} from "./calendarLegs";
import { graphFloatingDate } from "./calendarTime";
import {
  GRAPH_BASE,
  graphFetch,
  makeGraphTokenSource,
} from "./fetchOutlookMessageGraph";
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
import type {
  AcquireGraphToken,
  GraphTokenSource,
} from "./fetchOutlookMessageGraph";

/**
 * Microsoft Graph calendar sourcing for Exchange Online (SI-2 / ERMAIN-384) —
 * the cloud sibling of the on-prem EWS backend, emitting an identical {@link
 * NormalizedCalendar} (timed events as UTC `…Z` instants, all-day events as
 * floating civil dates). v1 scope is the SIGNED-IN USER's OWN
 * calendar only; `acquireToken` is expected to be bound to the `Calendars.Read`
 * scope (the location dispatcher binds it). All legs ride the shared
 * {@link graphFetch} + {@link makeGraphTokenSource} plumbing (one cached token
 * per leg, force-refreshed once on a 401):
 *
 *   - busyBlocks + historyMeetings: paginate `GET /me/calendarView`
 *     (`startDateTime` / `endDateTime` the look-forward / look-back windows),
 *     following `@odata.nextLink` under a sane page cap. calendarView returns UTC
 *     by default and expands recurring series into their occurrences inside the
 *     window — exactly what busy / history want. `showAs` maps onto the unified
 *     busyType vocabulary (see `fetchOutlookCalendar.ts`).
 *   - workingHours: `POST /me/calendar/getSchedule` for the signed-in user (the
 *     cloud analog of SE's GetUserAvailability), reading the `workingHours` block.
 *     Deliberately NOT `/me/mailboxSettings`: getSchedule rides the SAME
 *     `Calendars.Read` token as busy/history, avoiding an extra
 *     `MailboxSettings.Read` consent in every customer tenant.
 *
 * The error contract mirrors the EWS sibling: the top-level
 * {@link fetchOutlookCalendarViaGraph} degrades each leg to `[]` / `null` and
 * NEVER throws except to propagate an abort; the per-leg helpers THROW on a hard
 * failure, which the dispatcher records in `degradedLegs` so a consumer can tell
 * "empty" from "failed" (see `fetchOutlookCalendar.ts`). The dispatcher + shared
 * `Normalized*` types live in `./fetchOutlookCalendar.ts`; the on-prem EWS sibling
 * (SI-3) in `./fetchOutlookCalendarEws.ts`.
 */

const CALENDAR_VIEW_PAGE_SIZE = 100;
/** Follow `@odata.nextLink` up to this many pages before stopping (mirrors the
 * mail fetcher's `MAX_CONVERSATION_PAGES` cap). */
const MAX_CALENDAR_VIEW_PAGES = 20;

/** Graph's `dateTimeTimeZone` value (e.g. an event's `start` / `end`). */
interface GraphDateTimeTimeZone {
  dateTime?: string;
  timeZone?: string;
}

/** A calendarView event, pared to the fields we normalize. */
interface GraphEvent {
  subject?: string;
  start?: GraphDateTimeTimeZone;
  end?: GraphDateTimeTimeZone;
  isAllDay?: boolean;
  showAs?: string;
  /** singleInstance | occurrence | exception | seriesMaster. */
  type?: string;
  attendees?: { type?: string }[];
  /** The event's authoring zone (Windows or IANA); Graph returns it inline. */
  originalStartTimeZone?: string;
}

/** One page of a calendarView response. */
interface GraphCalendarViewPage {
  value?: GraphEvent[];
  "@odata.nextLink"?: string;
}

/** The `workingHours` block off a getSchedule `scheduleInformation`. */
interface GraphWorkingHours {
  daysOfWeek?: string[];
  startTime?: string;
  endTime?: string;
  timeZone?: { name?: string };
}

/** One `scheduleInformation` entry from `POST /me/calendar/getSchedule`. */
interface GraphScheduleInformation {
  workingHours?: GraphWorkingHours;
}

interface GraphGetScheduleResponse {
  value?: GraphScheduleInformation[];
}

// --- Normalization helpers ---------------------------------------------------

/**
 * Normalizes a Graph `dateTimeTimeZone` to a millis-free UTC `…Z` ISO-8601 (null
 * when absent). calendarView returns UTC by default (no `Prefer: outlook.timezone`
 * header sent), so a value lacking the `Z` designator is assumed UTC and given
 * one; fractional seconds are stripped. A non-UTC `timeZone` throws — degrading
 * the leg loudly — because relabeling a local time as UTC would silently shift
 * every event by the zone offset (a `Prefer` header added later must not do that).
 */
function toUtcIso(value: GraphDateTimeTimeZone | undefined): string | null {
  const dateTime = value?.dateTime?.trim();
  if (!dateTime) return null;
  if (value?.timeZone && value.timeZone !== "UTC") {
    throw new Error(
      `Graph returned a non-UTC dateTimeTimeZone (${value.timeZone}); expected UTC`,
    );
  }
  const stripped = dateTime.replace(/\.\d+Z?$/, "");
  return stripped.endsWith("Z") ? stripped : `${stripped}Z`;
}

/**
 * Maps Graph's `showAs` (free / tentative / busy / oof / workingElsewhere) onto
 * the unified busyType vocabulary; anything unknown degrades to `Busy` (a block
 * occupying time should never read as free). See `fetchOutlookCalendar.ts`.
 */
function mapShowAs(showAs: string | undefined): NormalizedBusyType {
  switch (showAs) {
    case "free":
      return "Free";
    case "tentative":
      return "Tentative";
    case "busy":
      return "Busy";
    case "oof":
      return "OOF";
    case "workingElsewhere":
      return "WorkingElsewhere";
    default:
      return "Busy";
  }
}

/**
 * Parses a mailboxSettings clock string (`"HH:MM:SS(.fff…)"`) into minutes from
 * midnight, or null when it can't be parsed.
 */
function clockStringToMinutes(clock: string | undefined): number | null {
  if (!clock) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(clock);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** True when two zone strings name the same zone: raw-equal, or both strictly
 * resolving to the same IANA id (Windows vs IANA spellings of one zone). */
function sameZone(a: string, b: string): boolean {
  if (a === b) return true;
  const ianaA = toIanaStrict(a);
  return ianaA !== null && ianaA === toIanaStrict(b);
}

/** Build the normalized `when` from a Graph event (all-day → floating date). */
function graphEventWhen(event: GraphEvent): NormalizedEventWhen | null {
  if (event.isAllDay === true) {
    const start = event.start?.dateTime;
    const end = event.end?.dateTime;
    if (!start || !end) return null;
    return {
      kind: "date",
      startDate: graphFloatingDate(start),
      endDateExclusive: graphFloatingDate(end),
    };
  }
  const startUtc = toUtcIso(event.start);
  const endUtc = toUtcIso(event.end);
  if (!startUtc || !endUtc) return null;
  return { kind: "date-time", startUtc, endUtc };
}

/** The event's authoring zone (IANA) when Graph reports it; null for
 * UTC/absent/unmappable (strict — the {@link toIana} fallback would claim the
 * VIEWER's OS zone as the authoring zone). */
function graphAuthoringTimeZone(event: GraphEvent): string | null {
  const zone = event.originalStartTimeZone;
  if (!zone || zone === "UTC") return null;
  return toIanaStrict(zone);
}

/**
 * Pages through a calendarView query following `@odata.nextLink` up to {@link
 * MAX_CALENDAR_VIEW_PAGES}, checking the abort signal between round-trips.
 * THROWS on a non-OK status — the per-leg callers turn that into a hard failure.
 */
async function fetchCalendarViewPages(
  initialUrl: string,
  tokenSource: GraphTokenSource,
  options: CalendarFetchOptions,
): Promise<GraphEvent[]> {
  const events: GraphEvent[] = [];
  let nextUrl: string | null = initialUrl;
  let pages = 0;
  while (nextUrl && pages < MAX_CALENDAR_VIEW_PAGES) {
    throwIfAborted(options.signal);
    const response = await graphFetch(
      nextUrl,
      tokenSource,
      "application/json",
      options.signal,
      options.transport,
    );
    if (!response.ok) {
      throw new Error(
        `Graph calendarView fetch failed: ${response.status} ${response.statusText}`,
      );
    }
    const payload = (await response.json()) as GraphCalendarViewPage;
    events.push(...(payload.value ?? []));
    nextUrl = payload["@odata.nextLink"] ?? null;
    pages += 1;
  }
  if (nextUrl) {
    console.warn(
      `[fetchCalendarViewPages] hit the ${MAX_CALENDAR_VIEW_PAGES}-page cap with more pages remaining; results are truncated`,
    );
  }
  return events;
}

/** Builds a calendarView URL for `range` with the requested `$select` fields. */
function buildCalendarViewUrl(range: CalendarRange, select: string): string {
  return (
    `${GRAPH_BASE}/me/calendarView` +
    `?startDateTime=${encodeURIComponent(range.startUtc)}` +
    `&endDateTime=${encodeURIComponent(range.endUtc)}` +
    `&$select=${select}` +
    `&$top=${CALENDAR_VIEW_PAGE_SIZE}` +
    `&$orderby=${encodeURIComponent("start/dateTime")}`
  );
}

// --- Public per-leg fetchers -----------------------------------------------

/**
 * Busy blocks in `range` (the look-forward window) from the user's own calendar.
 * Carries EVERY event including `showAs: free` (busyType faithful, mirroring the
 * EWS sibling); the prompt decides policy. THROWS on a hard Graph failure — the
 * dispatcher {@link fetchOutlookCalendarViaGraph} decides whether to degrade.
 */
export async function fetchCalendarBusyViaGraph(
  acquireToken: AcquireGraphToken,
  range: CalendarRange,
  options: CalendarFetchOptions = {},
): Promise<NormalizedBusyBlock[]> {
  throwIfAborted(options.signal);
  const tokenSource = makeGraphTokenSource(acquireToken);
  const url = buildCalendarViewUrl(
    range,
    "subject,start,end,isAllDay,showAs,originalStartTimeZone",
  );
  const events = await fetchCalendarViewPages(url, tokenSource, options);

  const blocks: NormalizedBusyBlock[] = [];
  for (const event of events) {
    const when = graphEventWhen(event);
    // start/end are mandatory; skip a malformed row rather than emit bad bounds.
    if (!when) continue;
    blocks.push({
      when,
      busyType: mapShowAs(event.showAs),
      subject: event.subject || undefined,
      authoringTimeZone: graphAuthoringTimeZone(event),
    });
  }
  return blocks;
}

/**
 * Past meetings in `range` (the look-back window) from the user's own calendar.
 * THROWS on a hard Graph failure.
 */
export async function fetchCalendarHistoryViaGraph(
  acquireToken: AcquireGraphToken,
  range: CalendarRange,
  options: CalendarFetchOptions = {},
): Promise<NormalizedHistoryMeeting[]> {
  throwIfAborted(options.signal);
  const tokenSource = makeGraphTokenSource(acquireToken);
  const url = buildCalendarViewUrl(
    range,
    "subject,start,end,isAllDay,attendees,type,originalStartTimeZone",
  );
  const events = await fetchCalendarViewPages(url, tokenSource, options);

  const meetings: NormalizedHistoryMeeting[] = [];
  for (const event of events) {
    const when = graphEventWhen(event);
    if (!when) continue;
    meetings.push({
      when,
      subject: event.subject ?? "",
      isRecurring:
        event.type === "occurrence" ||
        event.type === "exception" ||
        event.type === "seriesMaster",
      // Exclude resource rooms/equipment — invitee count means people. Graph-only
      // enrichment: the EWS backend omits attendeeCount (FindItem can't return it).
      attendeeCount: Array.isArray(event.attendees)
        ? event.attendees.filter((a) => a.type !== "resource").length
        : undefined,
      authoringTimeZone: graphAuthoringTimeZone(event),
    });
  }
  return meetings;
}

/**
 * Working hours for the signed-in user via `POST /me/calendar/getSchedule` — the
 * cloud analog of SE's GetUserAvailability, readable with the SAME `Calendars.Read`
 * token as busy/history (NOT `/me/mailboxSettings`, which would need an extra
 * `MailboxSettings.Read` consent per tenant). Rides the shared {@link graphFetch}
 * so the POST gets the same 401 → force-refresh → single-retry as the other legs.
 *
 * Returns null when working hours are genuinely absent or untrustworthy (no
 * mailbox, no `workingHours` block, or a zone that would make the minutes wrong).
 * THROWS on a hard fetch failure (non-OK status / network error) so the dispatcher
 * can flag the `workingHours` leg degraded; only an abort is re-thrown verbatim.
 */
export async function fetchWorkingHoursViaGraph(
  acquireToken: AcquireGraphToken,
  options: CalendarFetchOptions = {},
): Promise<NormalizedWorkingHours | null> {
  throwIfAborted(options.signal);
  const smtp = Office.context.mailbox.userProfile?.emailAddress;
  if (!smtp) return null;
  const now = new Date();
  const body = JSON.stringify({
    schedules: [smtp],
    startTime: { dateTime: toUtcNoMillis(now), timeZone: "UTC" },
    endTime: {
      dateTime: toUtcNoMillis(new Date(now.getTime() + MS_PER_DAY)),
      timeZone: "UTC",
    },
    availabilityViewInterval: 60,
  });
  const response = await graphFetch(
    `${GRAPH_BASE}/me/calendar/getSchedule`,
    makeGraphTokenSource(acquireToken),
    "application/json",
    options.signal,
    options.transport,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Graph getSchedule failed: ${response.status} ${response.statusText}`,
    );
  }
  const payload = (await response.json()) as GraphGetScheduleResponse;
  const workingHours = payload.value?.[0]?.workingHours;
  if (!workingHours) return null;
  // getSchedule reports start/end as clock times in workingHours.timeZone; if
  // that names a different zone than the mailbox zone the calendar is labeled
  // with, the minutes would be wrong — degrade rather than mislead. The two
  // sources may spell the SAME zone differently (Windows vs IANA), so zones
  // count as equivalent when raw-equal or when BOTH strictly resolve to one
  // IANA id. Strict on purpose: with the toIana fallback, two unknown-but-
  // different zones would both become the viewer's zone and compare equal.
  const scheduleZone = workingHours.timeZone?.name;
  const mailboxZone = Office.context.mailbox.userProfile?.timeZone;
  if (scheduleZone && mailboxZone && !sameZone(scheduleZone, mailboxZone)) {
    console.warn(
      "[fetchWorkingHoursViaGraph] getSchedule zone differs from mailbox zone; degrading working hours to null:",
      scheduleZone,
      mailboxZone,
    );
    return null;
  }
  const startMinutes = clockStringToMinutes(workingHours.startTime);
  const endMinutes = clockStringToMinutes(workingHours.endTime);
  if (startMinutes === null || endMinutes === null) return null;
  return {
    daysOfWeek: Array.isArray(workingHours.daysOfWeek)
      ? workingHours.daysOfWeek
      : [],
    startMinutes,
    endMinutes,
  };
}

/**
 * Sources the signed-in user's own calendar via Graph into a {@link
 * NormalizedCalendar}: busy blocks (now → +freeBusyWindowDays) and meeting
 * history (now-historyWindowDays → now) from calendarView, plus best-effort
 * working hours. The three legs run concurrently via {@link runCalendarLegs}.
 * NEVER throws except to propagate an abort — a restricted or failed leg
 * degrades to `[]` / null.
 */
export async function fetchOutlookCalendarViaGraph(
  acquireToken: AcquireGraphToken,
  options: CalendarFetchOptions = {},
): Promise<NormalizedCalendar> {
  const { historyRange, busyRange } = computeCalendarRanges(
    new Date(),
    options,
  );
  const displayTimeZone = resolveTimezone();

  const { historyMeetings, busyBlocks, workingHours, degradedLegs } =
    await runCalendarLegs(
      {
        history: () =>
          fetchCalendarHistoryViaGraph(acquireToken, historyRange, options),
        busy: () => fetchCalendarBusyViaGraph(acquireToken, busyRange, options),
        workingHours: () => fetchWorkingHoursViaGraph(acquireToken, options),
      },
      options.signal,
      "[fetchOutlookCalendarViaGraph]",
    );

  return {
    workingHours,
    busyBlocks,
    historyMeetings,
    displayTimeZone,
    degradedLegs,
  };
}
