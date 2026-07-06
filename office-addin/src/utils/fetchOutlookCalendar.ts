import { fetchOutlookCalendarViaEws } from "./fetchOutlookCalendarEws";
import { fetchOutlookCalendarViaGraph } from "./fetchOutlookCalendarGraph";

import type {
  AcquireGraphToken,
  GraphTransport,
} from "./fetchOutlookMessageGraph";
import type { GraphDirectoryTokenSources } from "./graphAttendeeResolution";

export interface NormalizedWorkingHours {
  daysOfWeek: string[];
  /** Minutes from midnight in the mailbox's own time zone. */
  startMinutes: number;
  endMinutes: number;
}

/**
 * When an event happens, discriminated by TYPE — never by an `isAllDay` flag on
 * an instant. This is the iCalendar RFC 5545 DATE-vs-DATE-TIME model both
 * backends normalize onto: an all-day event is a floating civil date and can
 * never be offset-shifted or mistaken for a UTC moment.
 * - `date-time`: a timed event, as true UTC instants (`…Z`).
 * - `date`: an all-day event, as floating dates (`YYYY-MM-DD`, no time/zone),
 *   half-open — `endDateExclusive` is the day AFTER the last all-day date.
 * Consumers branch on `kind`; treat `date` as a whole-day block in
 * `displayTimeZone`, never as a `[midnightZ, midnightZ]` interval.
 */
export type NormalizedEventWhen =
  | { kind: "date-time"; startUtc: string; endUtc: string }
  | { kind: "date"; startDate: string; endDateExclusive: string };

/**
 * Unified `busyType` vocabulary both backends normalize onto. EWS emits it from
 * `LegacyFreeBusyStatus`, Graph maps `showAs`; absent/unknown/NoData → "Busy"
 * (a block occupying time must never read as free).
 */
export type NormalizedBusyType =
  | "Free"
  | "Tentative"
  | "Busy"
  | "OOF"
  | "WorkingElsewhere";

export interface NormalizedBusyBlock {
  when: NormalizedEventWhen;
  busyType: NormalizedBusyType;
  subject?: string;
  /** IANA zone the event was authored in, when known; null otherwise. */
  authoringTimeZone?: string | null;
}

export interface NormalizedHistoryMeeting {
  when: NormalizedEventWhen;
  subject: string;
  isRecurring?: boolean;
  /** Invitee count when the backend reports it (Graph only — EWS FindItem
   * cannot return recipient lists, so the EWS backend omits it). */
  attendeeCount?: number;
  authoringTimeZone?: string | null;
}

/**
 * One requested attendee's free/busy (ERMAIN-434). Colleague calendars are
 * OPAQUE by contract: `busy` carries only BLOCKING intervals (Busy/OOF/
 * Tentative), never subjects or details, and never `Free`/`WorkingElsewhere`
 * rows — what Exchange free/busy sharing permits is exactly what surfaces.
 * A DL input expands to one entry per member, all sharing `requested`.
 */
export interface NormalizedAttendeeAvailability {
  /** The attendee string exactly as the tool call requested it. */
  requested: string;
  /** Resolved SMTP address; absent when resolution failed. */
  smtp?: string;
  /**
   * "ok" — `busy` is authoritative: time outside the listed intervals is free.
   * "unknown" — free/busy could not be read (resolution failure, access
   * denied, no data); the attendee must be treated as NOT free at any time.
   */
  status: "ok" | "unknown";
  /** Why status is "unknown"; also used for non-fatal caveats (truncation). */
  reason?: string;
  busy: NormalizedBusyBlock[];
}

/** The independently-sourced legs of a calendar snapshot. */
export type CalendarLeg = "busy" | "history" | "workingHours" | "attendees";

export interface NormalizedCalendar {
  /** null when it couldn't be sourced (the EWS working-hours leg is best-effort). */
  workingHours: NormalizedWorkingHours | null;
  busyBlocks: NormalizedBusyBlock[];
  historyMeetings: NormalizedHistoryMeeting[];
  /** Per-attendee free/busy, in request order; empty when none were requested.
   * Per-attendee read failures live INSIDE entries (`status: "unknown"`); the
   * `"attendees"` degraded leg means the whole fetch hard-failed. */
  attendees: NormalizedAttendeeAvailability[];
  /**
   * Canonical IANA id (e.g. `Europe/Berlin`) to display times in and the anchor
   * used to project `date` events onto the timeline. Always present (falls back
   * to the client zone when the mailbox zone can't be resolved).
   */
  displayTimeZone: string;
  /**
   * Legs whose FETCH HARD-FAILED — their `[]` / `null` is NOT authoritative and
   * must not be read as "nothing there". Load-bearing for availability: an empty
   * `busyBlocks` with `"busy"` degraded means "busy data unavailable", NOT "free",
   * so a consumer must refuse to assert freedom rather than propose an occupied
   * slot. Empty array = every leg was sourced cleanly. (A leg that fetched fine
   * but had nothing to report — e.g. no working hours configured — is NOT listed.)
   */
  degradedLegs: CalendarLeg[];
}

export interface CalendarFetchOptions {
  signal?: AbortSignal;
  /** Graph transport; the EWS backend ignores it (uses `makeEwsRequestAsync`). */
  transport?: GraphTransport;
  historyWindowDays?: number;
  freeBusyWindowDays?: number;
  /** Other people whose free/busy to read alongside the user's own calendar
   * (SMTP addresses; on EWS also GAL display names / DLs). Already deduped
   * and capped by the caller. */
  attendees?: string[];
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

/**
 * `acquireToken` must be bound to the `Calendars.Read` scope. `directory`
 * carries the OPTIONAL name-search acquirers (People.Read / User.ReadBasic.All,
 * each prebound separately) — omit or pass `{}` when the deployment doesn't
 * hold those consents; attendee display names then degrade to "unknown"
 * instead of resolving.
 */
export function createGraphOutlookCalendarFetcher(
  acquireToken: AcquireGraphToken,
  directory?: GraphDirectoryTokenSources,
): OutlookCalendarFetcher {
  return {
    fetchCalendar: (options) =>
      fetchOutlookCalendarViaGraph(acquireToken, options, directory),
  };
}
