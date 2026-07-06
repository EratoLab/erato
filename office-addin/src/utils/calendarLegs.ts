import { throwIfAborted } from "./fetchOutlookMessageEws";
import { toIana } from "./windowsZones";

import type {
  CalendarFetchOptions,
  CalendarLeg,
  NormalizedAttendeeAvailability,
  NormalizedBusyBlock,
  NormalizedBusyType,
  NormalizedHistoryMeeting,
  NormalizedWorkingHours,
} from "./fetchOutlookCalendar";

/**
 * Scaffolding shared by the Graph and EWS calendar backends. Deliberately a
 * SIBLING of `fetchOutlookCalendar.ts`, never part of it — that file
 * runtime-imports both backends for its factories, so runtime exports there
 * that the backends import back would close a cycle.
 */

export const DEFAULT_WINDOW_DAYS = 21;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Upper bound on attendees per fetch — under Graph getSchedule's 20-schedule
 * cap and keeps the serialized result within token reason. */
export const MAX_ATTENDEES = 15;

/** busyType values that OCCUPY time (the legend's blocking rule, as code). */
export const BLOCKING_BUSY_TYPES: ReadonlySet<NormalizedBusyType> = new Set([
  "Busy",
  "OOF",
  "Tentative",
]);

export interface CalendarRange {
  startUtc: string;
  endUtc: string;
}

export { throwIfAborted };

/** Millis-free UTC ISO-8601 (`…Z`) — the query-bound format both Graph
 * calendarView and EWS dateTime accept. */
export function toUtcNoMillis(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function computeCalendarRanges(
  now: Date,
  options: CalendarFetchOptions,
): { historyRange: CalendarRange; busyRange: CalendarRange } {
  const historyWindowDays = options.historyWindowDays ?? DEFAULT_WINDOW_DAYS;
  const freeBusyWindowDays = options.freeBusyWindowDays ?? DEFAULT_WINDOW_DAYS;
  const nowUtc = toUtcNoMillis(now);
  return {
    historyRange: {
      startUtc: toUtcNoMillis(
        new Date(now.getTime() - historyWindowDays * MS_PER_DAY),
      ),
      endUtc: nowUtc,
    },
    busyRange: {
      startUtc: nowUtc,
      endUtc: toUtcNoMillis(
        new Date(now.getTime() + freeBusyWindowDays * MS_PER_DAY),
      ),
    },
  };
}

/** The mailbox zone as IANA — `userProfile.timeZone` is a Windows zone name on
 * desktop hosts; `toIana` falls back to the client OS zone when unmappable. */
export function resolveTimezone(): string {
  return toIana(Office.context.mailbox.userProfile?.timeZone);
}

export interface CalendarLegThunks {
  history: () => Promise<NormalizedHistoryMeeting[]>;
  busy: () => Promise<NormalizedBusyBlock[]>;
  workingHours: () => Promise<NormalizedWorkingHours | null>;
  /** Resolves `[]` immediately when no attendees were requested. */
  attendees: () => Promise<NormalizedAttendeeAvailability[]>;
}

export interface CalendarLegResults {
  historyMeetings: NormalizedHistoryMeeting[];
  busyBlocks: NormalizedBusyBlock[];
  workingHours: NormalizedWorkingHours | null;
  attendeeAvailability: NormalizedAttendeeAvailability[];
  degradedLegs: CalendarLeg[];
}

/**
 * Runs the four legs concurrently under the shared degrade contract: an abort
 * propagates — never degrades; any other rejection degrades that leg to
 * `[]` / null and names it in `degradedLegs`.
 */
export async function runCalendarLegs(
  thunks: CalendarLegThunks,
  signal: AbortSignal | undefined,
  warnPrefix: string,
): Promise<CalendarLegResults> {
  const [history, busy, workingHours, attendees] = await Promise.allSettled([
    thunks.history(),
    thunks.busy(),
    thunks.workingHours(),
    thunks.attendees(),
  ]);

  if (signal?.aborted) {
    const rejected = [history, busy, workingHours, attendees].find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw (
      signal.reason ??
      rejected?.reason ??
      new DOMException("Aborted", "AbortError")
    );
  }

  const degradedLegs: CalendarLeg[] = [];
  const settle = <T>(
    result: PromiseSettledResult<T>,
    leg: CalendarLeg,
    label: string,
    fallback: T,
  ): T => {
    if (result.status === "fulfilled") return result.value;
    degradedLegs.push(leg);
    console.warn(`${warnPrefix} ${label} leg degraded:`, result.reason);
    return fallback;
  };

  return {
    historyMeetings: settle(history, "history", "history", []),
    busyBlocks: settle(busy, "busy", "busy", []),
    workingHours: settle(workingHours, "workingHours", "working-hours", null),
    attendeeAvailability: settle(attendees, "attendees", "attendees", []),
    degradedLegs,
  };
}

/**
 * Decode a merged free/busy string (Graph `availabilityView` / EWS
 * `MergedFreeBusy`) into busy blocks: one digit per `intervalMinutes` slice
 * from the window start, run-length grouped. `'0'` (free) never emits. The two
 * protocols disagree ONLY on `'4'` — Graph: workingElsewhere (non-blocking),
 * EWS: NoData (must read as Busy) — so the caller says what `'4'` means.
 */
export function decodeMergedFreeBusyView(
  view: string,
  windowStartUtc: string,
  intervalMinutes: number,
  charFour: NormalizedBusyType,
): NormalizedBusyBlock[] {
  const startMs = Date.parse(windowStartUtc);
  if (!Number.isFinite(startMs)) return [];
  const byChar: Record<string, NormalizedBusyType | undefined> = {
    "1": "Tentative",
    "2": "Busy",
    "3": "OOF",
    "4": charFour,
  };
  const blocks: NormalizedBusyBlock[] = [];
  let runStart = 0;
  for (let i = 0; i <= view.length; i += 1) {
    if (i < view.length && view[i] === view[runStart]) continue;
    const busyType = byChar[view[runStart]];
    if (busyType !== undefined) {
      blocks.push({
        when: {
          kind: "date-time",
          startUtc: toUtcNoMillis(
            new Date(startMs + runStart * intervalMinutes * 60_000),
          ),
          endUtc: toUtcNoMillis(
            new Date(startMs + i * intervalMinutes * 60_000),
          ),
        },
        busyType,
      });
    }
    runStart = i;
  }
  return blocks;
}

/** The attendee-leg privacy/economy filter: keep only intervals that BLOCK. */
export function onlyBlockingBlocks(
  blocks: NormalizedBusyBlock[],
): NormalizedBusyBlock[] {
  return blocks.filter((block) => BLOCKING_BUSY_TYPES.has(block.busyType));
}
