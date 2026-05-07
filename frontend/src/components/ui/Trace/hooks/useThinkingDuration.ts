import { t } from "@lingui/core/macro";
import { useMemo } from "react";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
// Drop seconds from the label once we cross this threshold — beyond ~10
// minutes, the seconds component is noise.
const SECONDS_THRESHOLD_MS = 10 * MS_PER_MINUTE;

/**
 * Format a duration in milliseconds as a compact human-readable label
 * (e.g. "23s", "3m 7s", "12m", "1h 5m"). Returns `null` when the duration is
 * non-positive or invalid, signalling "no usable duration to display".
 */
export const formatThinkingDuration = (ms: number | null): string | null => {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;

  if (ms < MS_PER_SECOND) return t`less than a second`;

  const totalSeconds = Math.round(ms / MS_PER_SECOND);

  if (ms >= MS_PER_HOUR) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.round((totalSeconds % 3600) / 60);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }

  if (ms >= MS_PER_MINUTE) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (ms >= SECONDS_THRESHOLD_MS) return `${minutes}m`;
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }

  return `${totalSeconds}s`;
};

/**
 * Compute the duration in milliseconds between two ISO-8601 timestamps, or
 * `null` if either is missing or unparseable.
 */
export const durationBetween = (
  startIso: string | undefined,
  endIso: string | undefined,
): number | null => {
  if (!startIso || !endIso) return null;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const ms = end - start;
  return ms > 0 ? ms : null;
};

/**
 * Hook variant returning a memoized duration in ms between the two timestamps.
 */
export const useDurationBetween = (
  startIso: string | undefined,
  endIso: string | undefined,
): number | null =>
  useMemo(() => durationBetween(startIso, endIso), [startIso, endIso]);
