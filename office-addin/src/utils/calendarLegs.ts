import { throwIfAborted } from "./fetchOutlookMessageEws";
import { toIana } from "./windowsZones";

import type {
  CalendarFetchOptions,
  CalendarLeg,
  NormalizedBusyBlock,
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
}

export interface CalendarLegResults {
  historyMeetings: NormalizedHistoryMeeting[];
  busyBlocks: NormalizedBusyBlock[];
  workingHours: NormalizedWorkingHours | null;
  degradedLegs: CalendarLeg[];
}

/**
 * Runs the three legs concurrently under the shared degrade contract: an abort
 * propagates — never degrades; any other rejection degrades that leg to
 * `[]` / null and names it in `degradedLegs`.
 */
export async function runCalendarLegs(
  thunks: CalendarLegThunks,
  signal: AbortSignal | undefined,
  warnPrefix: string,
): Promise<CalendarLegResults> {
  const [history, busy, workingHours] = await Promise.allSettled([
    thunks.history(),
    thunks.busy(),
    thunks.workingHours(),
  ]);

  if (signal?.aborted) {
    const rejected = [history, busy, workingHours].find(
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
    degradedLegs,
  };
}
