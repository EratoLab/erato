import { useEffect, useMemo, useState } from "react";

import type { TraceablePart } from "../types";

const DEFAULT_THINKING_GAP_MS = 1500;

/**
 * Build a fingerprint of the parts that changes whenever ANY meaningful
 * activity happens — a new part appears, a reasoning text grows by even one
 * character, or a tool call's status flips. Reference equality on the parts
 * array isn't enough: parents may produce a fresh array each render even when
 * the content hasn't changed.
 */
const buildActivityFingerprint = (parts: TraceablePart[]): string =>
  parts
    .map((part) =>
      part.content_type === "reasoning"
        ? `r:${part.text.length}`
        : `t:${part.tool_call_id}:${part.status}`,
    )
    .join("|");

/**
 * Returns `true` once a quiet period (no streaming activity) has lasted long
 * enough to warrant showing a "Thinking…" placeholder step at the tail of the
 * timeline. The timer resets every time the parts fingerprint changes — so
 * during a busy stream of deltas it never fires, but after a tool call
 * completes (or any other lull) the placeholder appears.
 *
 * Only active during streaming AND while the trace is the live writer; for
 * cold-load and once text has begun, this always returns `false`.
 */
export const useThinkingGap = (
  parts: TraceablePart[],
  isStreaming: boolean,
  hasLaterContent: boolean,
  thresholdMs: number = DEFAULT_THINKING_GAP_MS,
): boolean => {
  const fingerprint = useMemo(() => buildActivityFingerprint(parts), [parts]);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isStreaming || hasLaterContent) {
      setShow(false);
      return;
    }
    setShow(false);
    const id = window.setTimeout(() => setShow(true), thresholdMs);
    return () => window.clearTimeout(id);
  }, [fingerprint, isStreaming, hasLaterContent, thresholdMs]);

  return show;
};
