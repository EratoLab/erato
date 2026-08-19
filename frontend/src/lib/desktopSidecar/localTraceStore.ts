/**
 * Session store for desktop-sidecar traces, keyed by tool call.
 *
 * A sidecar-backed client tool reports what it did on the device (steps,
 * models, durations, counts — never content). When the user consents to
 * sharing the tool result, the executor also puts the trace in the result, so
 * it is persisted server-side and survives a reload. When the user DECLINES,
 * the result never reaches the backend — but the local work still happened,
 * and the trace is metadata only, so it stays visible for this session from
 * here.
 *
 * Host-agnostic: any surface running sidecar client tools (Outlook add-in
 * today, web app tomorrow) records into the same store, and the trace subtree
 * under the tool-call step reads it without knowing the tool.
 *
 * Everything entering the store passes `sanitizeSidecarLocalTrace`: the live
 * path is already schema-validated by the protocol client, but persisted tool
 * outputs replayed from the backend are not, and a trace that claims "this
 * ran on your device" must never render unvalidated shapes or unbounded
 * strings.
 */

import { useMemo } from "react";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import { DELEGATION_TOOL_NAME } from "@/lib/delegation/delegationEnvelope";

import { isSidecarStepRunning, mergeSidecarTraces } from "./traceEvents";

import type {
  SidecarLocalTrace,
  SidecarLocalTraceStep,
} from "@erato/desktop-sidecar-protocol";

const MAX_ENTRIES = 50;
/** Bounds from the trace schemas, enforced again at this trust boundary. */
const MAX_STEPS = 32;
const MAX_COUNT_ENTRIES = 16;
const MAX_COUNT_KEY_CHARS = 64;

/**
 * Tools whose results may carry a trustworthy `localTrace`. The session store
 * is written only by our own executors, but an output is whatever the tool
 * returned — without this gate, any tool could dress its output up as an
 * authoritative nested trace.
 */
const SIDECAR_TRACE_RESULT_TOOLS = new Set([
  // eslint-disable-next-line lingui/no-unlocalized-strings -- tool identifier
  "search_sidecar_mailbox",
  DELEGATION_TOOL_NAME,
]);

export function isSidecarTraceResultTool(
  toolName: string | undefined,
): boolean {
  return toolName !== undefined && SIDECAR_TRACE_RESULT_TOOLS.has(toolName);
}

function boundedString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  if (value.length <= maxChars) {
    return value;
  }
  return [...value].slice(0, maxChars).join("");
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function sanitizeStep(value: unknown): SidecarLocalTraceStep | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const sequence = nonNegativeInteger(record.sequence);
  const id = boundedString(record.id, 128);
  const status = boundedString(record.status, 64);
  if (sequence === undefined || id === undefined || status === undefined) {
    return undefined;
  }
  const step: SidecarLocalTraceStep = { sequence, id, status };
  const parentSequence = nonNegativeInteger(record.parentSequence);
  if (parentSequence !== undefined) {
    step.parentSequence = parentSequence;
  }
  const startedAtOffsetMs = nonNegativeInteger(record.startedAtOffsetMs);
  if (startedAtOffsetMs !== undefined) {
    step.startedAtOffsetMs = startedAtOffsetMs;
  }
  const durationMs = nonNegativeInteger(record.durationMs);
  if (durationMs !== undefined) {
    step.durationMs = durationMs;
  }
  const model = boundedString(record.model, 256);
  if (model !== undefined) {
    step.model = model;
  }
  if (typeof record.cacheHit === "boolean") {
    step.cacheHit = record.cacheHit;
  }
  const detail = boundedString(record.detail, 512);
  if (detail !== undefined) {
    step.detail = detail;
  }
  if (
    typeof record.counts === "object" &&
    record.counts !== null &&
    !Array.isArray(record.counts)
  ) {
    const counts: Record<string, number> = {};
    for (const [key, count] of Object.entries(record.counts)) {
      if (Object.keys(counts).length >= MAX_COUNT_ENTRIES) {
        break;
      }
      const value = nonNegativeInteger(count);
      if (value !== undefined && key.length <= MAX_COUNT_KEY_CHARS) {
        counts[key] = value;
      }
    }
    if (Object.keys(counts).length > 0) {
      step.counts = counts;
    }
  }
  return step;
}

/**
 * Reduce an untrusted value to a renderable trace: schema-required fields
 * enforced, strings bounded, unknown extras dropped. Returns `undefined`
 * when the value is not trace-shaped at all.
 */
export function sanitizeSidecarLocalTrace(
  value: unknown,
): SidecarLocalTrace | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.steps)) {
    return undefined;
  }
  const steps = record.steps
    .slice(0, MAX_STEPS)
    .map(sanitizeStep)
    .filter((step): step is SidecarLocalTraceStep => step !== undefined);
  const trace: SidecarLocalTrace = { steps };
  const totalDurationMs = nonNegativeInteger(record.totalDurationMs);
  if (totalDurationMs !== undefined) {
    trace.totalDurationMs = totalDurationMs;
  }
  return trace;
}

/* eslint-disable lingui/no-unlocalized-strings -- devtools action names */
const ACTION = {
  record: "sidecarLocalTrace/record",
  clear: "sidecarLocalTrace/clear",
  markStopped: "sidecarLocalTrace/markStopped",
} as const;
/* eslint-enable lingui/no-unlocalized-strings */

interface SidecarLocalTraceStore {
  /**
   * Traces keyed by tool call. Key insertion order doubles as the recency
   * order (tool call ids are never integer-like, so the engine preserves
   * it): recording re-inserts the key, and eviction above MAX_ENTRIES drops
   * the first key — so an actively streaming trace is never the victim.
   */
  traces: Partial<Record<string, SidecarLocalTrace>>;
  record: (toolCallId: string, trace: SidecarLocalTrace) => void;
  clear: (toolCallId: string) => void;
  markStopped: (toolCallId: string) => void;
}

export const useSidecarLocalTraceStore = create<SidecarLocalTraceStore>()(
  devtools(
    (set) => ({
      traces: {},

      // Steps merge by sequence rather than replacing the log, so recording
      // the same result twice is a no-op and a partial delivery simply
      // extends what is already shown.
      record: (toolCallId, trace) =>
        set(
          (prev) => {
            const clean = sanitizeSidecarLocalTrace(trace);
            if (!clean) {
              return prev;
            }
            const merged = mergeSidecarTraces(prev.traces[toolCallId], clean);
            const { [toolCallId]: _replaced, ...rest } = prev.traces;
            const traces: SidecarLocalTraceStore["traces"] = {
              ...rest,
              [toolCallId]: merged,
            };
            const keys = Object.keys(traces);
            if (keys.length > MAX_ENTRIES) {
              delete traces[keys[0]];
            }
            return { traces };
          },
          false,
          ACTION.record,
        ),

      clear: (toolCallId) =>
        set(
          (prev) => {
            if (prev.traces[toolCallId] === undefined) {
              return prev;
            }
            const { [toolCallId]: _removed, ...traces } = prev.traces;
            return { traces };
          },
          false,
          ACTION.clear,
        ),

      // Settle steps still marked running as `skipped · cancelled`, the same
      // vocabulary the sidecar itself uses for work stopped by cancellation.
      // Without this, an aborted call would show a spinning step forever.
      markStopped: (toolCallId) =>
        set(
          (prev) => {
            const trace = prev.traces[toolCallId];
            if (
              !trace?.steps.some((step) => isSidecarStepRunning(step.status))
            ) {
              return prev;
            }
            const steps = trace.steps.map((step) =>
              isSidecarStepRunning(step.status)
                ? {
                    ...step,
                    status: "skipped",
                    detail: step.detail ?? "cancelled",
                  }
                : step,
            );
            return {
              traces: { ...prev.traces, [toolCallId]: { ...trace, steps } },
            };
          },
          false,
          ACTION.markStopped,
        ),
    }),
    { name: "sidecarLocalTraceStore" },
  ),
);

/**
 * Imperative surface for executors and hosts running outside React — the
 * same store the trace subtree renders from.
 */
export function recordSidecarLocalTrace(
  toolCallId: string,
  trace: SidecarLocalTrace,
): void {
  useSidecarLocalTraceStore.getState().record(toolCallId, trace);
}

/**
 * Forget a tool call's trace. Executors call this when they start a fresh
 * sidecar request for a tool call that may already have one (a replay after
 * a failed result delivery), so two runs' sequence numbers never merge into
 * one chimera log.
 */
export function clearSidecarLocalTrace(toolCallId: string): void {
  useSidecarLocalTraceStore.getState().clear(toolCallId);
}

/**
 * Settle a trace whose request ended without a final observation (abort,
 * timeout, transport loss).
 */
export function markSidecarLocalTraceStopped(toolCallId: string): void {
  useSidecarLocalTraceStore.getState().markStopped(toolCallId);
}

export function getSidecarLocalTrace(
  toolCallId: string,
): SidecarLocalTrace | undefined {
  return useSidecarLocalTraceStore.getState().traces[toolCallId];
}

/**
 * The trace carried by a tool output, if any. A client tool's output is the
 * backend's `{status, result}` envelope and an executor that shares its trace
 * puts it at `result.localTrace`; a tool whose result is not an object
 * carries the trace next to it instead. The payload is whatever reached the
 * client, so it is sanitized before anything renders.
 */
export function persistedSidecarLocalTrace(
  output: unknown,
): SidecarLocalTrace | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  const result = record.result;
  const nested =
    typeof result === "object" && result !== null
      ? (result as Record<string, unknown>).localTrace
      : undefined;
  return sanitizeSidecarLocalTrace(nested ?? record.localTrace);
}

/**
 * The trace to render for one tool call — the single home of the resolution
 * order shared by the tool step and the subtree: the persisted result's
 * trace when the tool is allowlisted to carry one (survives reloads once the
 * user consented to sharing), else this session's store entry (covers the
 * in-flight and declined cases, where no result reached the backend).
 */
export function useSidecarLocalTrace(
  toolCallId: string | undefined,
  toolName: string | undefined,
  output: unknown,
): SidecarLocalTrace | undefined {
  const ephemeral = useSidecarLocalTraceStore((state) =>
    toolCallId ? state.traces[toolCallId] : undefined,
  );
  const persisted = useMemo(
    () =>
      isSidecarTraceResultTool(toolName)
        ? persistedSidecarLocalTrace(output)
        : undefined,
    [toolName, output],
  );
  return persisted ?? ephemeral;
}
