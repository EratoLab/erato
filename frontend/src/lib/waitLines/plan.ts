/**
 * What the voice says next while the user waits for an answer, from what
 * has happened in the turn so far. Pure: the player asks again after every
 * event and when the returned time comes.
 *
 * Rules (times from the end of the user's speech):
 * - Nothing once the answer has started or the turn has ended.
 * - The opener when `firstAfterMs` has passed and the transcript is back,
 *   only as the turn's first line and only in the `normal` amount.
 * - A tool call's line when the call has run `toolAfterMs` and its audio is
 *   ready; never after the call ended.
 * - "Still on it" from `stillAfterMs`, once nothing was said for
 *   `stillQuietMs`; "this takes longer" from `longAfterMs`.
 * - At most `maxPerTurn` lines, `minGapMs` apart, one at a time.
 */

export type WaitAmount = "normal" | "long_only" | "off";

export interface WaitTiming {
  firstAfterMs: number;
  toolAfterMs: number;
  stillAfterMs: number;
  stillQuietMs: number;
  longAfterMs: number;
  minGapMs: number;
  maxPerTurn: number;
}

export type WaitLineKind = "opener" | "tool" | "still" | "long";

export interface SaidLine {
  kind: WaitLineKind;
  toolCallId?: string;
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
}

export interface WaitTurnState {
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
  | { kind: "say"; line: Exclude<WaitLineKind, "tool"> }
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
  if (amount === "off" || turn.answerStarted || turn.ended) {
    return { kind: "done" };
  }
  if (turn.said.length >= timing.maxPerTurn) return { kind: "done" };
  if (turn.said.some((line) => line.endedAt === undefined)) {
    return { kind: "wait" };
  }
  const lastEnd = Math.max(
    -Infinity,
    ...turn.said.map((line) => line.endedAt ?? -Infinity),
  );
  const gapReady = lastEnd + timing.minGapMs;
  const saidKind = (kind: WaitLineKind) =>
    turn.said.some((line) => line.kind === kind);
  const usable = (kind: WaitLineKind) => !turn.unavailable.includes(kind);

  const due: { step: WaitStep; at: number }[] = [];
  let toolLoading = false;
  for (const tool of turn.tools) {
    if (tool.endedAt !== undefined || !usable("tool")) continue;
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
  if (amount === "normal" && turn.said.length === 0 && usable("opener")) {
    due.push({
      step: { kind: "say", line: "opener" },
      at: Math.max(
        turn.speechEndedAt + timing.firstAfterMs,
        turn.transcriptAt,
        gapReady,
      ),
    });
  }
  if (!saidKind("still") && usable("still")) {
    due.push({
      step: { kind: "say", line: "still" },
      at: Math.max(
        turn.speechEndedAt + timing.stillAfterMs,
        lastEnd + timing.stillQuietMs,
        gapReady,
      ),
    });
  }
  if (!saidKind("long") && usable("long")) {
    due.push({
      step: { kind: "say", line: "long" },
      at: Math.max(turn.speechEndedAt + timing.longAfterMs, gapReady),
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
