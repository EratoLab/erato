import { fetchOutlookCalendarViaEws } from "./fetchOutlookCalendarEws";
import { fetchOutlookCalendarViaGraph } from "./fetchOutlookCalendarGraph";

import type {
  AcquireGraphToken,
  GraphTransport,
} from "./fetchOutlookMessageGraph";

export interface NormalizedWorkingHours {
  daysOfWeek: string[];
  /** Minutes from midnight in the mailbox's own time zone. */
  startMinutes: number;
  endMinutes: number;
}

/**
 * Unified `busyType` vocabulary both backends normalize onto:
 * "Free" | "Tentative" | "Busy" | "OOF" | "WorkingElsewhere". EWS emits it from
 * `LegacyFreeBusyStatus`, Graph maps `showAs`; absent/unknown/NoData → "Busy"
 * (a block occupying time must never read as free).
 */
export interface NormalizedBusyBlock {
  /** UTC ISO-8601 (`…Z`); looks forward from now. */
  start: string;
  end: string;
  busyType: string;
  subject?: string;
  isAllDay?: boolean;
}

export interface NormalizedHistoryMeeting {
  /** UTC ISO-8601 (`…Z`); a past meeting (looks backward from now). */
  start: string;
  end: string;
  subject: string;
  isRecurring?: boolean;
  isAllDay?: boolean;
  /** Invitee count when the backend reports it. */
  attendeeCount?: number;
}

export interface NormalizedCalendar {
  /** null when it couldn't be sourced (the EWS working-hours leg is best-effort). */
  workingHours: NormalizedWorkingHours | null;
  busyBlocks: NormalizedBusyBlock[];
  historyMeetings: NormalizedHistoryMeeting[];
  /** IANA / Windows zone id the times should be displayed in. */
  timezone: string;
}

export interface CalendarFetchOptions {
  signal?: AbortSignal;
  /** Graph transport; the EWS backend ignores it (uses `makeEwsRequestAsync`). */
  transport?: GraphTransport;
  historyWindowDays?: number;
  freeBusyWindowDays?: number;
}

export interface OutlookCalendarFetcher {
  fetchCalendar(options?: CalendarFetchOptions): Promise<NormalizedCalendar>;
}

// The two backends are selected by mailbox location, not auth mode (SE and EXO
// both use Entra). The Normalized* types live here so neither backend depends on
// the other — they import these type-only, avoiding a runtime cycle.

export function createEwsOutlookCalendarFetcher(): OutlookCalendarFetcher {
  return {
    fetchCalendar: (options) => fetchOutlookCalendarViaEws(options),
  };
}

/** `acquireToken` must be bound to the `Calendars.Read` scope. */
export function createGraphOutlookCalendarFetcher(
  acquireToken: AcquireGraphToken,
): OutlookCalendarFetcher {
  return {
    fetchCalendar: (options) =>
      fetchOutlookCalendarViaGraph(acquireToken, options),
  };
}
