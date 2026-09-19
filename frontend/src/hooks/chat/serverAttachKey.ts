/* eslint-disable lingui/no-unlocalized-strings -- internal cache keys, never user-facing */
/**
 * Identity of a server-started generation, for the single-socket attach guard.
 *
 * Whole seconds, never the raw string. Three producers write a `startedAt` and
 * no two of them serialize the same instant the same way:
 *
 * 1. this tab's own send — `new Date().toISOString()`, client clock,
 *    milliseconds, `Z`;
 * 2. the `/me/generating` poll — a chrono `DateTime<FixedOffset>`, server
 *    clock, microsecond fraction, numeric `+00:00` offset;
 * 3. the `409 generation_running` body — `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
 *    TRUNCATED to the whole second.
 *
 * String equality across 2 and 3 is guaranteed to miss, and `Date.parse` alone
 * misses by up to 999ms because producer 3 truncates rather than rounds. Only
 * flooring to the second agrees across all three.
 *
 * `:enter` is the honest key for "a generation may be running and we do not
 * know which" — entering a chat, or a refusal whose body carries no usable
 * start time. It is deliberately a distinct key rather than a guess.
 */
export const serverAttachKey = (
  chatId: string,
  startedAt?: string | null,
): string => {
  const parsed = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isNaN(parsed)
    ? `${chatId}:enter`
    : `${chatId}:${Math.floor(parsed / 1000)}`;
};
