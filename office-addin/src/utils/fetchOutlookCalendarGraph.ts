import {
  computeCalendarRanges,
  decodeMergedFreeBusyView,
  MS_PER_DAY,
  onlyBlockingBlocks,
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
import { resolveAttendeeNameViaGraph } from "./graphAttendeeResolution";
import { toIanaStrict } from "./windowsZones";

import type { CalendarRange } from "./calendarLegs";
import type {
  CalendarFetchOptions,
  NormalizedAttendeeAvailability,
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
import type {
  DirectoryCandidate,
  GraphDirectoryTokenSources,
  GraphNameResolution,
} from "./graphAttendeeResolution";

/**
 * Microsoft Graph calendar sourcing for Exchange Online (SI-2 / ERMAIN-384);
 * on-prem EWS sibling in `./fetchOutlookCalendarEws.ts`, shared contract in
 * `./fetchOutlookCalendar.ts`. v1 reads the SIGNED-IN USER's OWN calendar only;
 * `acquireToken` must be bound to `Calendars.Read` (the dispatcher binds it).
 * calendarView returns UTC by default and expands recurring series into
 * occurrences inside the window — exactly what busy / history want. Per-leg
 * fetchers THROW on hard failure; the top-level fetcher degrades each leg
 * independently and never throws except to propagate an abort.
 */

const CALENDAR_VIEW_PAGE_SIZE = 100;
/** Follow `@odata.nextLink` up to this many pages before stopping (mirrors the
 * mail fetcher's `MAX_CONVERSATION_PAGES` cap). */
const MAX_CALENDAR_VIEW_PAGES = 20;

interface GraphDateTimeTimeZone {
  dateTime?: string;
  timeZone?: string;
}

interface GraphEvent {
  subject?: string;
  start?: GraphDateTimeTimeZone;
  end?: GraphDateTimeTimeZone;
  isAllDay?: boolean;
  showAs?: string;
  /** singleInstance | occurrence | exception | seriesMaster. */
  type?: string;
  attendees?: { type?: string }[];
  /** The event's authoring zone (Windows or IANA name). */
  originalStartTimeZone?: string;
}

interface GraphCalendarViewPage {
  value?: GraphEvent[];
  "@odata.nextLink"?: string;
}

interface GraphWorkingHours {
  daysOfWeek?: string[];
  startTime?: string;
  endTime?: string;
  timeZone?: { name?: string };
}

interface GraphScheduleItem {
  /** free | tentative | busy | oof | workingElsewhere | unknown. */
  status?: string;
  start?: GraphDateTimeTimeZone;
  end?: GraphDateTimeTimeZone;
}

interface GraphScheduleInformation {
  scheduleId?: string;
  availabilityView?: string;
  scheduleItems?: GraphScheduleItem[];
  workingHours?: GraphWorkingHours;
  error?: { message?: string; responseCode?: string };
}

interface GraphGetScheduleResponse {
  value?: GraphScheduleInformation[];
}

// --- Normalization helpers ---------------------------------------------------

/**
 * Graph `dateTimeTimeZone` → millis-free UTC `…Z` (null when absent). No
 * `Prefer: outlook.timezone` header is sent, so values arrive UTC; a non-UTC
 * `timeZone` throws — relabeling a local time as UTC would silently shift every
 * event by the zone offset.
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

function clockStringToMinutes(clock: string | undefined): number | null {
  if (!clock) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(clock);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Same zone iff raw-equal or both strictly resolve to one IANA id (Windows vs
 * IANA spellings). Strict on purpose: with the `toIana` fallback, two
 * unknown-but-different zones would both become the viewer's zone and compare
 * equal. */
function sameZone(a: string, b: string): boolean {
  if (a === b) return true;
  const ianaA = toIanaStrict(a);
  return ianaA !== null && ianaA === toIanaStrict(b);
}

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

/** Authoring zone as IANA; null for UTC/absent/unmappable — strict, because the
 * `toIana` fallback would claim the VIEWER's OS zone as the authoring zone. */
function graphAuthoringTimeZone(event: GraphEvent): string | null {
  const zone = event.originalStartTimeZone;
  if (!zone || zone === "UTC") return null;
  return toIanaStrict(zone);
}

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

/** Busy blocks in `range`. Carries EVERY event including `showAs: free` —
 * busyType is faithful; the prompt decides policy. */
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
    // Skip malformed rows rather than emit an interval with missing bounds.
    const when = graphEventWhen(event);
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

/** Past meetings in `range` (the look-back window). */
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
      // Resource rooms/equipment excluded — invitee count means people.
      attendeeCount: Array.isArray(event.attendees)
        ? event.attendees.filter((a) => a.type !== "resource").length
        : undefined,
      authoringTimeZone: graphAuthoringTimeZone(event),
    });
  }
  return meetings;
}

/** Shared `POST /me/calendar/getSchedule` (working-hours and attendee legs).
 * THROWS on a hard HTTP failure; per-schedule errors stay in the payload. */
async function postGetSchedule(
  acquireToken: AcquireGraphToken,
  schedules: string[],
  startUtc: string,
  endUtc: string,
  availabilityViewInterval: number,
  options: CalendarFetchOptions,
): Promise<GraphGetScheduleResponse> {
  const body = JSON.stringify({
    schedules,
    startTime: { dateTime: startUtc, timeZone: "UTC" },
    endTime: { dateTime: endUtc, timeZone: "UTC" },
    availabilityViewInterval,
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
  return (await response.json()) as GraphGetScheduleResponse;
}

/**
 * Working hours via `POST /me/calendar/getSchedule` — deliberately NOT
 * `/me/mailboxSettings`, which would need an extra `MailboxSettings.Read`
 * consent per tenant while getSchedule rides the same `Calendars.Read` token.
 * Returns null when working hours are genuinely absent or untrustworthy;
 * THROWS on a hard fetch failure.
 */
export async function fetchWorkingHoursViaGraph(
  acquireToken: AcquireGraphToken,
  options: CalendarFetchOptions = {},
): Promise<NormalizedWorkingHours | null> {
  throwIfAborted(options.signal);
  const smtp = Office.context.mailbox.userProfile?.emailAddress;
  if (!smtp) return null;
  const now = new Date();
  const payload = await postGetSchedule(
    acquireToken,
    [smtp],
    toUtcNoMillis(now),
    toUtcNoMillis(new Date(now.getTime() + MS_PER_DAY)),
    60,
    options,
  );
  const workingHours = payload.value?.[0]?.workingHours;
  if (!workingHours) return null;
  // start/end are clock times in workingHours.timeZone; under a different zone
  // than the mailbox's the minutes would be wrong — degrade rather than mislead.
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

/** Interval sized so the window never exceeds getSchedule's 1000-slot
 * `availabilityView` cap (error 5006): doubled from 30 min until it fits. */
export function availabilityViewIntervalFor(windowMinutes: number): number {
  let interval = 30;
  while (windowMinutes / interval > 1000 && interval < 1440) {
    interval *= 2;
  }
  return Math.min(interval, 1440);
}

const unknownAttendee = (
  requested: string,
  reason: string,
): NormalizedAttendeeAvailability => ({
  requested,
  status: "unknown",
  reason,
  busy: [],
});

const listCandidates = (candidates: DirectoryCandidate[]): string =>
  candidates.map((c) => `${c.name} <${c.smtp}>`).join(", ");

/**
 * Colleague free/busy over `range` (ERMAIN-434): one getSchedule call with all
 * attendee SMTP addresses. Per-schedule failures become `status: "unknown"`
 * entries — never silently free; only the whole-call failure THROWS (and
 * degrades the leg). Results are OPAQUE — blocking intervals, no subjects.
 *
 * getSchedule needs SMTP; a display name resolves through the OPTIONAL
 * directory scopes first (`graphAttendeeResolution.ts` — People.Read /
 * User.ReadBasic.All). Without those consents (or without `directory` at
 * all) a non-address input degrades to "unknown" with a use-an-address hint,
 * and an ambiguous name surfaces its candidates so the user can pick one —
 * name lookup is a nicety that must never sink the calendar read.
 */
export async function fetchAttendeeAvailabilityViaGraph(
  acquireToken: AcquireGraphToken,
  range: CalendarRange,
  attendees: string[],
  options: CalendarFetchOptions = {},
  directory: GraphDirectoryTokenSources = {},
): Promise<NormalizedAttendeeAvailability[]> {
  if (attendees.length === 0) return [];
  throwIfAborted(options.signal);

  const names = attendees.filter((entry) => !entry.includes("@"));
  const resolutions = new Map<string, GraphNameResolution>();
  if (names.length > 0 && (directory.people || directory.users)) {
    await Promise.all(
      names.map(async (name) => {
        resolutions.set(
          name,
          await resolveAttendeeNameViaGraph(directory, name, options),
        );
      }),
    );
    throwIfAborted(options.signal);
  }

  const smtpFor = (requested: string): string | null => {
    if (requested.includes("@")) return requested;
    const resolution = resolutions.get(requested);
    return resolution?.kind === "resolved" ? resolution.smtp : null;
  };

  // Two inputs may resolve to one mailbox — query each address once.
  const toQuery: string[] = [];
  const queried = new Set<string>();
  for (const requested of attendees) {
    const smtp = smtpFor(requested);
    if (smtp !== null && !queried.has(smtp.toLowerCase())) {
      queried.add(smtp.toLowerCase());
      toQuery.push(smtp);
    }
  }

  const scheduleBySmtp = new Map<string, GraphScheduleInformation>();
  const windowMinutes =
    (Date.parse(range.endUtc) - Date.parse(range.startUtc)) / 60_000;
  const interval = availabilityViewIntervalFor(windowMinutes);
  if (toQuery.length > 0) {
    const payload = await postGetSchedule(
      acquireToken,
      toQuery,
      range.startUtc,
      range.endUtc,
      interval,
      options,
    );
    (payload.value ?? []).forEach((schedule, index) => {
      // scheduleId echoes the request; fall back to request order.
      const smtp =
        toQuery.find(
          (s) => s.toLowerCase() === schedule.scheduleId?.toLowerCase(),
        ) ?? toQuery[index];
      if (smtp !== undefined) scheduleBySmtp.set(smtp.toLowerCase(), schedule);
    });
  }

  return attendees.map((requested) => {
    if (!requested.includes("@")) {
      const resolution = resolutions.get(requested);
      if (resolution === undefined) {
        return unknownAttendee(
          requested,
          "not an email address — Exchange Online availability needs an SMTP address",
        );
      }
      if (resolution.kind === "ambiguous") {
        return unknownAttendee(
          requested,
          `ambiguous in the directory — matches: ${listCandidates(resolution.candidates)}. Ask the user which address to use.`,
        );
      }
      if (resolution.kind === "not-found") {
        return unknownAttendee(requested, "not found in the directory");
      }
      if (resolution.kind === "unavailable") {
        return unknownAttendee(
          requested,
          `directory name search unavailable (${resolution.detail}) — use an email address`,
        );
      }
    }
    const smtp = smtpFor(requested) as string;
    const schedule = scheduleBySmtp.get(smtp.toLowerCase());
    if (schedule === undefined) {
      return {
        // The address is known even though the read failed — parity with EWS.
        ...unknownAttendee(requested, "no availability data returned"),
        smtp,
      };
    }
    return normalizeSchedule(
      requested,
      smtp,
      schedule,
      range.startUtc,
      interval,
    );
  });
}

function normalizeSchedule(
  requested: string,
  smtp: string,
  schedule: GraphScheduleInformation,
  windowStartUtc: string,
  intervalMinutes: number,
): NormalizedAttendeeAvailability {
  if (schedule.error) {
    return {
      ...unknownAttendee(
        requested,
        schedule.error.message ??
          schedule.error.responseCode ??
          "availability lookup failed",
      ),
      smtp,
    };
  }
  if (Array.isArray(schedule.scheduleItems)) {
    const blocks: NormalizedBusyBlock[] = [];
    for (const item of schedule.scheduleItems) {
      const startUtc = toUtcIso(item.start);
      const endUtc = toUtcIso(item.end);
      if (!startUtc || !endUtc) continue;
      blocks.push({
        // No subject on purpose: colleague calendars surface opaquely.
        when: { kind: "date-time", startUtc, endUtc },
        // "unknown" status falls through mapShowAs to Busy — never read as free.
        busyType: mapShowAs(item.status),
      });
    }
    return {
      requested,
      smtp,
      status: "ok",
      busy: onlyBlockingBlocks(blocks),
    };
  }
  if (typeof schedule.availabilityView === "string") {
    // Sharing policies that only publish merged free/busy omit scheduleItems.
    return {
      requested,
      smtp,
      status: "ok",
      busy: onlyBlockingBlocks(
        decodeMergedFreeBusyView(
          schedule.availabilityView,
          windowStartUtc,
          intervalMinutes,
          "WorkingElsewhere",
        ),
      ),
    };
  }
  return {
    ...unknownAttendee(requested, "no availability data returned"),
    smtp,
  };
}

/** The full Graph calendar snapshot; NEVER throws except to propagate an
 * abort — a failed leg degrades to `[]` / null and is named in `degradedLegs`. */
export async function fetchOutlookCalendarViaGraph(
  acquireToken: AcquireGraphToken,
  options: CalendarFetchOptions = {},
  directory: GraphDirectoryTokenSources = {},
): Promise<NormalizedCalendar> {
  const { historyRange, busyRange } = computeCalendarRanges(
    new Date(),
    options,
  );
  const displayTimeZone = resolveTimezone();

  const {
    historyMeetings,
    busyBlocks,
    workingHours,
    attendeeAvailability,
    degradedLegs,
  } = await runCalendarLegs(
    {
      history: () =>
        fetchCalendarHistoryViaGraph(acquireToken, historyRange, options),
      busy: () => fetchCalendarBusyViaGraph(acquireToken, busyRange, options),
      workingHours: () => fetchWorkingHoursViaGraph(acquireToken, options),
      attendees: () =>
        fetchAttendeeAvailabilityViaGraph(
          acquireToken,
          busyRange,
          options.attendees ?? [],
          options,
          directory,
        ),
    },
    options.signal,
    "[fetchOutlookCalendarViaGraph]",
  );

  return {
    workingHours,
    busyBlocks,
    historyMeetings,
    attendees: attendeeAvailability,
    displayTimeZone,
    degradedLegs,
  };
}
