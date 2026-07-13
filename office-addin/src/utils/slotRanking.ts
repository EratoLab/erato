import { BLOCKING_BUSY_TYPES } from "./calendarLegs";
import {
  rulesCivilToUtcMs,
  utcInstantToCivilDate,
  zonedCivilToUtcMs,
} from "./calendarTime";

import type {
  NormalizedCalendar,
  NormalizedHistoryMeeting,
  WorkingHoursAnchor,
} from "./fetchOutlookCalendar";

/**
 * Deterministic slot ranking (SI-6 / ERMAIN-388). Hand-rolled interval math —
 * deliberately NO dependency (Cal.com's slot logic is AGPL, reference-only).
 * Produces the candidates behind the facet's "Earliest / Options / Smart
 * picks" tiers so they are computed, tested code instead of per-turn model
 * arithmetic; the tier vocabulary matches the ERMAIN-428 `erato-slots` fence.
 *
 * Heuristics (weights below, documented for tuning):
 * - buffer-before: a slot straight after a meeting needs ≥15 min clear;
 *   day-start slots and roomier buffers score higher.
 * - day-lightness: prefer days with less of the working window already booked.
 * - defragmentation: prefer slots at a gap's edges — placing mid-gap splits
 *   one long usable stretch into two short ones.
 * Ties always break on earlier start, so equal inputs give equal output.
 */

export interface RankedSlot {
  startUtc: string;
  endUtc: string;
  tier: "earliest" | "smart" | "option";
  /** Short heuristic tags ("light day, clean buffer") — the model rephrases. */
  reason?: string;
}

export interface SlotRankingResult {
  slots: RankedSlot[];
  /** True when workingHours was null and the Mon–Fri 09:00–17:00 assumption
   * (the legend's rule) was used — the caller must say so. */
  workingHoursAssumed: boolean;
}

export interface SlotRankingOptions {
  nowUtc: string;
  windowEndUtc: string;
  durationMinutes: number;
  /** Total slots across all tiers (default 8). */
  maxSlots?: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Minimum clear minutes between a preceding meeting's end and a slot start. */
export const SLOT_BUFFER_MINUTES = 15;
/** Candidate starts snap up to this wall-clock grid. */
const ALIGN_MINUTES = 15;
/** A leftover gap shorter than this is a fragment worth avoiding. */
const FRAGMENT_MINUTES = 30;
const DEFAULT_MAX_SLOTS = 8;
const SMART_PICKS = 3;

const ASSUMED_WORKING_DAYS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
]);
const ASSUMED_START_MINUTES = 9 * 60;
const ASSUMED_END_MINUTES = 17 * 60;

const WEIGHT_BUFFER = 0.3;
const WEIGHT_DAY_LIGHTNESS = 0.35;
const WEIGHT_DEFRAG = 0.35;
/** Additive bonus when a slot sits inside EVERY shared attendee working-hours
 * window — zero attendee hours shared ⇒ zero effect on the ranking. */
const WEIGHT_ATTENDEE_HOURS = 0.3;

// --- Civil-date iteration (zone conversion itself lives in calendarTime) ------

/** Weekday of a floating civil date (zone-independent), lowercase English —
 * the vocabulary both backends' `daysOfWeek` normalize to. */
function weekdayOf(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
  })
    .format(new Date(`${date}T00:00:00Z`))
    .toLowerCase();
}

function nextCivilDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// --- Interval helpers ---------------------------------------------------------

interface Interval {
  start: number;
  end: number;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/** `window` minus `blocked` (blocked must be merged+sorted) → free gaps, each
 * tagged with whether a blocking interval directly precedes it. */
function subtract(
  window: Interval,
  blocked: Interval[],
): { gap: Interval; afterMeeting: boolean }[] {
  const gaps: { gap: Interval; afterMeeting: boolean }[] = [];
  let cursor = window.start;
  // Seed within a buffer's reach, not just at overlap: a meeting ending one
  // minute before the window start must still buffer the first gap.
  let afterMeeting = blocked.some(
    (b) =>
      b.start < window.start &&
      b.end > window.start - SLOT_BUFFER_MINUTES * MINUTE_MS,
  );
  for (const block of blocked) {
    if (block.end <= window.start || block.start >= window.end) continue;
    if (block.start > cursor) {
      gaps.push({
        gap: { start: cursor, end: Math.min(block.start, window.end) },
        afterMeeting,
      });
    }
    cursor = Math.max(cursor, block.end);
    afterMeeting = true;
  }
  if (cursor < window.end) {
    gaps.push({ gap: { start: cursor, end: window.end }, afterMeeting });
  }
  return gaps;
}

// --- Duration inference ---------------------------------------------------------

/**
 * Coarse duration calibration: the median timed meeting length, rounded to
 * the nearest 15 min and clamped to [15, 240]. Needs ≥3 samples — below that
 * the caller falls back to its default. (The facet prompt still does the
 * finer subject/attendee-similarity matching in-model; this is the code-side
 * baseline the ranking uses when the model passed no duration.)
 */
export function inferTypicalDurationMinutes(
  meetings: NormalizedHistoryMeeting[],
): number | null {
  const durations = meetings
    .map((m) =>
      m.when.kind === "date-time"
        ? (Date.parse(m.when.endUtc) - Date.parse(m.when.startUtc)) / MINUTE_MS
        : null,
    )
    .filter((d): d is number => d !== null && Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  if (durations.length < 3) return null;
  const mid = Math.floor(durations.length / 2);
  const median =
    durations.length % 2 === 1
      ? durations[mid]
      : (durations[mid - 1] + durations[mid]) / 2;
  const rounded = Math.round(median / 15) * 15;
  return Math.min(240, Math.max(15, rounded));
}

// --- Ranking ---------------------------------------------------------------------

interface Candidate {
  start: number;
  end: number;
  score: number;
  reasons: string[];
}

/**
 * Rank open slots across the user's calendar AND every loaded attendee
 * calendar (`status: "ok"` — an unknown attendee contributes nothing here;
 * the serializer flags that separately). Returns at most `maxSlots` slots,
 * tiered: the chronologically first valid slot ("earliest"), the top scored
 * picks ("smart"), the rest in time order ("option").
 */
export function rankAvailabilitySlots(
  calendar: NormalizedCalendar,
  options: SlotRankingOptions,
): SlotRankingResult {
  const zone = calendar.displayTimeZone;
  const durationMs = options.durationMinutes * MINUTE_MS;
  const nowMs = Date.parse(options.nowUtc);
  const windowEndMs = Date.parse(options.windowEndUtc);
  const maxSlots = options.maxSlots ?? DEFAULT_MAX_SLOTS;
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(windowEndMs) ||
    durationMs <= 0
  ) {
    return { slots: [], workingHoursAssumed: false };
  }

  const workingHoursAssumed = calendar.workingHours === null;
  const workingDays = workingHoursAssumed
    ? ASSUMED_WORKING_DAYS
    : new Set(calendar.workingHours!.daysOfWeek.map((d) => d.toLowerCase()));
  const startMinutes =
    calendar.workingHours?.startMinutes ?? ASSUMED_START_MINUTES;
  const endMinutes = calendar.workingHours?.endMinutes ?? ASSUMED_END_MINUTES;
  // Hours-zone is authoritative: an anchored schedule (traveler keeping home
  // hours) converts through its OWN zone, not the display zone.
  const civilToUtcInAnchor = (
    date: string,
    minutes: number,
    anchor: WorkingHoursAnchor | undefined,
  ): number =>
    anchor === undefined
      ? zonedCivilToUtcMs(date, minutes, zone)
      : anchor.kind === "iana"
        ? zonedCivilToUtcMs(date, minutes, anchor.zone)
        : rulesCivilToUtcMs(date, minutes, anchor);
  const ownAnchor = calendar.workingHours?.anchor;
  const hoursCivilToUtcMs = (date: string, minutes: number): number =>
    civilToUtcInAnchor(date, minutes, ownAnchor);

  // Attendees' shared working hours (each in its own anchor zone) — a SOFT
  // preference: slots inside everyone's hours score higher, never a filter
  // (cross-zone pairs may have no overlap, and edges are often negotiable).
  const attendeeHours = calendar.attendees
    .filter((a) => a.status === "ok" && a.workingHours !== undefined)
    .map((a) => a.workingHours!);

  // Blocking intervals: own blocking events + every loaded attendee's blocks
  // (already blocking-only by contract; own list is filtered here).
  const blockingSource = [
    ...calendar.busyBlocks.filter((b) => BLOCKING_BUSY_TYPES.has(b.busyType)),
    ...calendar.attendees
      .filter((a) => a.status === "ok")
      .flatMap((a) => a.busy),
  ];
  const blocked = mergeIntervals(
    blockingSource
      .map((block) =>
        block.when.kind === "date-time"
          ? {
              start: Date.parse(block.when.startUtc),
              end: Date.parse(block.when.endUtc),
            }
          : {
              start: zonedCivilToUtcMs(block.when.startDate, 0, zone),
              end: zonedCivilToUtcMs(block.when.endDateExclusive, 0, zone),
            },
      )
      .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end)),
  );

  const candidates: Candidate[] = [];
  let date = utcInstantToCivilDate(nowMs, zone);
  const lastDate = utcInstantToCivilDate(windowEndMs, zone);
  // Bounded by the 62-day lookahead cap; the guard keeps a malformed range finite.
  for (
    let i = 0;
    i < 100 && date <= lastDate;
    i += 1, date = nextCivilDate(date)
  ) {
    const weekday = weekdayOf(date);
    if (!workingDays.has(weekday)) continue;
    const dayStart = hoursCivilToUtcMs(date, startMinutes);
    const dayEnd = hoursCivilToUtcMs(date, endMinutes);
    // This civil date's window per attendee-with-hours; an attendee not
    // working this weekday gets no window (nothing can be "inside").
    const attendeeDayWindows = attendeeHours
      .filter((h) => h.daysOfWeek.some((d) => d.toLowerCase() === weekday))
      .map((h) => ({
        start: civilToUtcInAnchor(date, h.startMinutes, h.anchor),
        end: civilToUtcInAnchor(date, h.endMinutes, h.anchor),
      }));
    const window: Interval = {
      start: Math.max(dayStart, nowMs),
      end: Math.min(dayEnd, windowEndMs),
    };
    if (window.end - window.start < durationMs) continue;

    const busyInDay = blocked.reduce(
      (sum, b) =>
        sum +
        Math.max(0, Math.min(b.end, dayEnd) - Math.max(b.start, dayStart)),
      0,
    );
    const dayLightness = 1 - busyInDay / Math.max(1, dayEnd - dayStart);

    for (const { gap, afterMeeting } of subtract(window, blocked)) {
      const bufferMs = afterMeeting ? SLOT_BUFFER_MINUTES * MINUTE_MS : 0;
      const alignedStart = alignUp(gap.start + bufferMs, dayStart);
      if (alignedStart + durationMs > gap.end) continue;

      const gapLength = gap.end - gap.start;
      const push = (start: number, tags: string[]) => {
        const leftoverAfter = gap.end - (start + durationMs);
        const leftoverBefore = start - gap.start;
        const fragments =
          (isFragment(leftoverBefore, afterMeeting ? bufferMs : 0) ? 1 : 0) +
          (isFragment(leftoverAfter, 0) ? 1 : 0);
        const bufferScore = !afterMeeting
          ? 1
          : leftoverBefore >= 30 * MINUTE_MS
            ? 0.9
            : 0.6;
        const insideAllAttendeeHours =
          attendeeHours.length > 0 &&
          attendeeDayWindows.length === attendeeHours.length &&
          attendeeDayWindows.every(
            (w) => start >= w.start && start + durationMs <= w.end,
          );
        const score =
          WEIGHT_BUFFER * bufferScore +
          WEIGHT_DAY_LIGHTNESS * dayLightness +
          WEIGHT_DEFRAG * (1 - fragments / 2) +
          (insideAllAttendeeHours ? WEIGHT_ATTENDEE_HOURS : 0);
        const reasons = [...tags];
        if (insideAllAttendeeHours)
          reasons.push("inside everyone's working hours");
        if (!afterMeeting) reasons.push("no meeting right before");
        else if (leftoverBefore >= 30 * MINUTE_MS) reasons.push("clean buffer");
        if (dayLightness >= 0.7) reasons.push("light day");
        if (fragments === 0) reasons.push("keeps open time intact");
        candidates.push({ start, end: start + durationMs, score, reasons });
      };

      push(alignedStart, []);
      // Back edge of a roomy gap: leaves the front of the stretch open.
      const backStart = alignDown(gap.end - durationMs, dayStart);
      if (
        backStart >= alignedStart + 2 * durationMs &&
        gapLength >= 3 * durationMs
      ) {
        push(backStart, ["end of an open stretch"]);
      }
    }
  }

  candidates.sort((a, b) => a.start - b.start || b.score - a.score);
  const seen = new Set<number>();
  const unique = candidates.filter((c) =>
    seen.has(c.start) ? false : (seen.add(c.start), true),
  );
  if (unique.length === 0) {
    return { slots: [], workingHoursAssumed };
  }

  const [earliest, ...rest] = unique;
  const smart = [...rest]
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, SMART_PICKS);
  const smartStarts = new Set(smart.map((s) => s.start));
  const optionBudget = Math.max(0, maxSlots - 1 - smart.length);
  const optionSlots = rest
    .filter((c) => !smartStarts.has(c.start))
    .slice(0, optionBudget);

  const toRanked = (c: Candidate, tier: RankedSlot["tier"]): RankedSlot => ({
    startUtc: new Date(c.start).toISOString().replace(/\.\d{3}Z$/, "Z"),
    endUtc: new Date(c.end).toISOString().replace(/\.\d{3}Z$/, "Z"),
    tier,
    ...(tier === "smart" && c.reasons.length > 0
      ? { reason: c.reasons.join(", ") }
      : {}),
  });

  const slots = [
    toRanked(earliest, "earliest"),
    ...smart.map((c) => toRanked(c, "smart")),
    ...optionSlots.map((c) => toRanked(c, "option")),
  ].sort((a, b) => a.startUtc.localeCompare(b.startUtc));

  return { slots, workingHoursAssumed };
}

/** Snap up/down to the wall-clock grid, anchored at the day's window start so
 * :00/:15/:30/:45 starts survive any UTC offset. */
function alignUp(ms: number, anchor: number): number {
  const grid = ALIGN_MINUTES * MINUTE_MS;
  return anchor + Math.ceil((ms - anchor) / grid) * grid;
}

function alignDown(ms: number, anchor: number): number {
  const grid = ALIGN_MINUTES * MINUTE_MS;
  return anchor + Math.floor((ms - anchor) / grid) * grid;
}

/** A leftover shorter than FRAGMENT_MINUTES (beyond any required buffer) is
 * dead time — nonzero but unusable. */
function isFragment(leftoverMs: number, allowanceMs: number): boolean {
  const effective = leftoverMs - allowanceMs;
  return effective > 0 && effective < FRAGMENT_MINUTES * MINUTE_MS;
}
