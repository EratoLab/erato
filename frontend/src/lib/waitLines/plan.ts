/**
 * What the voice says next while the user waits for an answer, from what
 * has happened in the turn so far. Pure: the player asks again after every
 * event and when the returned time comes.
 *
 * Rules (times from the start of the wait: the end of the user's speech
 * that became the turn, or the tap that started a continuation):
 * - Nothing once the answer has started or the turn has ended.
 * - The opener when `firstAfterMs` has passed and the transcript is back,
 *   only as the turn's first line and only in the `normal` amount.
 * - A tool call's line when the call has run `toolAfterMs` and its audio is
 *   ready; never after the call ended.
 * - "Still on it" from `stillAfterMs`, once nothing was said for
 *   `stillQuietMs`; "this takes longer" from `longAfterMs`.
 * - At most `maxPerTurn` of the opener, tool and first "still" lines. The
 *   long line is outside that cap, so a long wait always hears it; after it,
 *   "still on it" again every `stillRepeatMs`, at most `stillRepeatMax`
 *   times, so a turn that hangs goes quiet while the screen shows the wait.
 * - The opener is said only close to when it was due: a check of the lines
 *   that answers late leaves it out rather than say "one moment" at 20 s.
 * - Lines `minGapMs` apart, one at a time. `maxPerTurn` 0 says nothing.
 * - The reply's own spoken part counts as a line said, so the opener is not
 *   said after it and it counts toward `maxPerTurn`. It may be the answer or
 *   a line before a tool call, so it pauses the wait: nothing more is said
 *   until a tool call starts after it.
 */

export type WaitAmount = "normal" | "long_only" | "off";

/** Later than this after it was due, the opener is not said at all. */
export const OPENER_LATE_MS = 3000;

export interface WaitTiming {
  firstAfterMs: number;
  toolAfterMs: number;
  stillAfterMs: number;
  stillQuietMs: number;
  longAfterMs: number;
  /** After the long line, between "still on it" lines; 0 says it no more. */
  stillRepeatMs: number;
  /** How many "still on it" lines at most after the long line. */
  stillRepeatMax: number;
  minGapMs: number;
  maxPerTurn: number;
}

export type WaitLineKind = "opener" | "tool" | "still" | "long";

export interface SaidLine {
  /** `reply`: the reply's own spoken part. */
  kind: WaitLineKind | "reply";
  toolCallId?: string;
  /** A "still on it" said again after the long line. */
  repeat?: boolean;
  startedAt: number;
  /** Absent while it plays. */
  endedAt?: number;
}

export interface WaitTool {
  id: string;
  startedAt: number;
  endedAt?: number;
  /** Its line's audio has fully arrived. */
  ready: boolean;
  /** It has no line, or its line failed: it only counts as a call made. */
  silent?: boolean;
}

export interface WaitTurnState {
  /** When the wait began: the end of the speech, or the tap. */
  speechEndedAt: number;
  /** When the user's words were sent; nothing is said before. */
  transcriptAt: number;
  answerStarted: boolean;
  ended: boolean;
  said: SaidLine[];
  tools: WaitTool[];
  /** Kinds that cannot be said in this turn, such as a slot without lines. */
  unavailable: WaitLineKind[];
}

export type WaitStep =
  | { kind: "say"; line: "opener" | "long" }
  | { kind: "say"; line: "still"; repeat: boolean }
  | { kind: "say"; line: "tool"; toolCallId: string }
  | { kind: "wake"; at: number }
  /** A line plays, or a tool line is still loading: ask again on the event. */
  | { kind: "wait" }
  | { kind: "done" };

export function nextWaitStep(
  amount: WaitAmount,
  timing: WaitTiming,
  turn: WaitTurnState,
  now: number,
): WaitStep {
  if (
    amount === "off" ||
    timing.maxPerTurn <= 0 ||
    turn.answerStarted ||
    turn.ended
  ) {
    return { kind: "done" };
  }
  if (turn.said.some((line) => line.endedAt === undefined)) {
    return { kind: "wait" };
  }
  const reply = turn.said.findLast((line) => line.kind === "reply");
  if (reply && !turn.tools.some((tool) => tool.startedAt >= reply.startedAt)) {
    return { kind: "wait" };
  }
  const lastEnd = Math.max(
    -Infinity,
    ...turn.said.map((line) => line.endedAt ?? -Infinity),
  );
  const gapReady = lastEnd + timing.minGapMs;
  const usable = (kind: WaitLineKind) => !turn.unavailable.includes(kind);
  const longSaid = turn.said.some((line) => line.kind === "long");
  const capped = turn.said.filter(
    (line) => line.kind !== "long" && !line.repeat,
  ).length;
  const underCap = capped < timing.maxPerTurn;

  const due: { step: WaitStep; at: number }[] = [];
  let toolLoading = false;
  if (underCap && usable("tool")) {
    for (const tool of turn.tools) {
      if (tool.endedAt !== undefined || tool.silent) continue;
      if (turn.said.some((line) => line.toolCallId === tool.id)) continue;
      if (!tool.ready) {
        toolLoading = true;
        continue;
      }
      due.push({
        step: { kind: "say", line: "tool", toolCallId: tool.id },
        at: Math.max(tool.startedAt + timing.toolAfterMs, gapReady),
      });
    }
  }
  if (
    underCap &&
    amount === "normal" &&
    turn.said.length === 0 &&
    usable("opener")
  ) {
    const at = Math.max(
      turn.speechEndedAt + timing.firstAfterMs,
      turn.transcriptAt,
      gapReady,
    );
    if (now <= at + OPENER_LATE_MS) {
      due.push({ step: { kind: "say", line: "opener" }, at });
    }
  }
  if (
    underCap &&
    !longSaid &&
    !turn.said.some((line) => line.kind === "still") &&
    usable("still")
  ) {
    due.push({
      step: { kind: "say", line: "still", repeat: false },
      at: Math.max(
        turn.speechEndedAt + timing.stillAfterMs,
        lastEnd + timing.stillQuietMs,
        gapReady,
      ),
    });
  }
  if (!longSaid && usable("long")) {
    due.push({
      step: { kind: "say", line: "long" },
      at: Math.max(turn.speechEndedAt + timing.longAfterMs, gapReady),
    });
  }
  const repeats = turn.said.filter((line) => line.repeat).length;
  if (
    longSaid &&
    timing.stillRepeatMs > 0 &&
    repeats < timing.stillRepeatMax &&
    usable("still")
  ) {
    due.push({
      step: { kind: "say", line: "still", repeat: true },
      at: Math.max(lastEnd + timing.stillRepeatMs, gapReady),
    });
  }

  // Order of preference when several are due: what a tool does says more
  // than any fixed line.
  const ready = due.filter((entry) => entry.at <= now);
  if (ready.length > 0) return ready[0].step;
  if (due.length === 0)
    return toolLoading ? { kind: "wait" } : { kind: "done" };
  return { kind: "wake", at: Math.min(...due.map((entry) => entry.at)) };
}
