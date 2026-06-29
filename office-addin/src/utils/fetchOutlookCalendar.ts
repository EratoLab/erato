import { fetchOutlookCalendarViaEws } from "./fetchOutlookCalendarEws";
import { fetchOutlookCalendarViaGraph } from "./fetchOutlookCalendarGraph";

import type {
  AcquireGraphToken,
  GraphTransport,
} from "./fetchOutlookMessageGraph";

/**
 * A mailbox's working-hours window, normalized to a backend-agnostic shape.
 * `daysOfWeek` are EWS/Graph day names ("Monday" … "Sunday"); `startMinutes`
 * and `endMinutes` are minutes-from-midnight in the mailbox's own time zone.
 */
export interface NormalizedWorkingHours {
  daysOfWeek: string[];
  startMinutes: number;
  endMinutes: number;
}

/**
 * The backend-agnostic `busyType` vocabulary BOTH backends UNIFY onto, so the
 * facet prompt reasons over one set of values regardless of source:
 *
 *   "Free" | "Tentative" | "Busy" | "OOF" | "WorkingElsewhere"
 *
 * EWS emits this directly from `LegacyFreeBusyStatus` (its `NoData` is mapped to
 * `"Busy"` conservatively); Graph maps `showAs` (free/tentative/busy/oof/
 * workingElsewhere, anything else → `"Busy"`). An absent / unknown status always
 * degrades to `"Busy"` — a block occupying time should never read as free.
 */

/**
 * A single busy interval on the user's calendar, looking FORWARD from now.
 * `start`/`end` are UTC ISO-8601 (`…Z`); `busyType` is the unified vocabulary
 * documented above (Free / Tentative / Busy / OOF / WorkingElsewhere);
 * `subject` is omitted when the event has none; `isAllDay` flags an all-day
 * block when the backend reports it.
 */
export interface NormalizedBusyBlock {
  start: string;
  end: string;
  busyType: string;
  subject?: string;
  isAllDay?: boolean;
}

/**
 * A past meeting, looking BACKWARD from now. `start`/`end` are UTC ISO-8601
 * (`…Z`); `isRecurring` reflects whether the event is part of a series;
 * `isAllDay` flags an all-day event; `attendeeCount` is the number of invitees
 * when the backend reports them (omitted when unknown).
 */
export interface NormalizedHistoryMeeting {
  start: string;
  end: string;
  subject: string;
  isRecurring?: boolean;
  isAllDay?: boolean;
  attendeeCount?: number;
}

/**
 * The backend-agnostic calendar snapshot both mail backends emit. `workingHours`
 * is null when it could not be sourced (the EWS GetUserAvailability leg is
 * best-effort; see `fetchOutlookCalendarEws.ts`). `timezone` is the IANA /
 * Windows zone id the times should be displayed in.
 */
export interface NormalizedCalendar {
  workingHours: NormalizedWorkingHours | null;
  busyBlocks: NormalizedBusyBlock[];
  historyMeetings: NormalizedHistoryMeeting[];
  timezone: string;
}

export interface CalendarFetchOptions {
  signal?: AbortSignal;
  /** Optional injected transport (Graph backend); the EWS backend ignores it,
   * its host leg goes through `makeEwsRequestAsync`. */
  transport?: GraphTransport;
  /** Days of history to look back for `historyMeetings` (default 21). */
  historyWindowDays?: number;
  /** Days forward to look for `busyBlocks` (default 21). */
  freeBusyWindowDays?: number;
}

export interface OutlookCalendarFetcher {
  fetchCalendar(options?: CalendarFetchOptions): Promise<NormalizedCalendar>;
}

/**
 * Environment dispatcher for Outlook calendar sourcing — the calendar sibling of
 * `fetchOutlookMessage.ts`. The add-in talks to exactly one of two mutually
 * exclusive backends, selected by where the mailbox lives (NOT by auth mode — SE
 * and EXO both authenticate via Entra):
 *
 *   - Cloud mailbox (Exchange Online): Microsoft Graph with a `Calendars.Read`
 *     token from MSAL (`./fetchOutlookCalendarGraph.ts` — SI-2/ERMAIN-384, not
 *     yet implemented).
 *   - On-prem mailbox (Exchange on-premises / Subscription Edition): EWS SOAP
 *     (`./fetchOutlookCalendarEws.ts`) over the host-brokered
 *     `makeEwsRequestAsync` transport (SI-3/ERMAIN-385).
 *
 * The `Normalized*` types live HERE (a neutral home) so both backends depend on
 * this seam, not on each other; the runtime imports of the two backend entry
 * points are fine, the backends in turn import these types `type`-only to avoid
 * a runtime cycle. Location-aware selection lives in `useOutlookCalendarFetcher`.
 */
export function createEwsOutlookCalendarFetcher(): OutlookCalendarFetcher {
  return {
    fetchCalendar: (options) => fetchOutlookCalendarViaEws(options),
  };
}

/**
 * Microsoft Graph backing (Exchange Online). `acquireToken` is expected to be
 * bound to the `Calendars.Read` scope.
 */
export function createGraphOutlookCalendarFetcher(
  acquireToken: AcquireGraphToken,
): OutlookCalendarFetcher {
  return {
    fetchCalendar: (options) =>
      fetchOutlookCalendarViaGraph(acquireToken, options),
  };
}
