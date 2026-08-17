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

const traces = new Map<string, SidecarLocalTrace>();
const listeners = new Set<() => void>();

/**
 * Tools whose persisted results may carry a trustworthy `localTrace`. The
 * session store is written only by our own executors, but a persisted output
 * is whatever the tool returned — without this gate, any server-side tool
 * could dress its output up as an authoritative on-device trace.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- tool identifier
const SIDECAR_TRACE_RESULT_TOOLS = new Set(["search_sidecar_mailbox"]);

export function isSidecarTraceResultTool(
  toolName: string | undefined,
): boolean {
  return toolName !== undefined && SIDECAR_TRACE_RESULT_TOOLS.has(toolName);
}

function emit(): void {
  for (const listener of [...listeners]) {
    listener();
  }
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

/**
 * Record what the sidecar reported. Steps merge by sequence rather than
 * replacing the log, so recording the same result twice is a no-op and a
 * partial delivery simply extends what is already shown. Recording touches
 * the entry's recency, so an actively streaming trace is never the eviction
 * victim.
 */
export function recordSidecarLocalTrace(
  toolCallId: string,
  trace: SidecarLocalTrace,
): void {
  const clean = sanitizeSidecarLocalTrace(trace);
  if (!clean) {
    return;
  }
  const merged = mergeSidecarTraces(traces.get(toolCallId), clean);
  traces.delete(toolCallId);
  traces.set(toolCallId, merged);
  if (traces.size > MAX_ENTRIES) {
    const oldest = traces.keys().next().value;
    if (oldest !== undefined) {
      traces.delete(oldest);
    }
  }
  emit();
}

/**
 * Forget a tool call's trace. Executors call this when they start a fresh
 * sidecar request for a tool call that may already have one (a replay after
 * a failed result delivery), so two runs' sequence numbers never merge into
 * one chimera log.
 */
export function clearSidecarLocalTrace(toolCallId: string): void {
  if (traces.delete(toolCallId)) {
    emit();
  }
}

/**
 * Settle a trace whose request ended without a final observation (abort,
 * timeout, transport loss): steps still marked running become
 * `skipped · cancelled`, the same vocabulary the sidecar itself uses for
 * work stopped by cancellation. Without this, an aborted call would show a
 * spinning step forever.
 */
export function markSidecarLocalTraceStopped(toolCallId: string): void {
  const trace = traces.get(toolCallId);
  if (!trace?.steps.some((step) => isSidecarStepRunning(step.status))) {
    return;
  }
  const steps = trace.steps.map((step) =>
    isSidecarStepRunning(step.status)
      ? { ...step, status: "skipped", detail: step.detail ?? "cancelled" }
      : step,
  );
  traces.set(toolCallId, { ...trace, steps });
  emit();
}

export function getSidecarLocalTrace(
  toolCallId: string,
): SidecarLocalTrace | undefined {
  return traces.get(toolCallId);
}

export function subscribeSidecarLocalTraces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The trace carried by a persisted tool result, if any. `output` is the
 * backend's `{status, result}` envelope for a client-tool call; an executor
 * that shares its trace puts it at `result.localTrace`. The payload is
 * whatever reached the backend, so it is sanitized before anything renders.
 */
export function persistedSidecarLocalTrace(
  output: unknown,
): SidecarLocalTrace | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }
  const result = (output as Record<string, unknown>).result;
  if (typeof result !== "object" || result === null) {
    return undefined;
  }
  return sanitizeSidecarLocalTrace(
    (result as Record<string, unknown>).localTrace,
  );
}

export function resetSidecarLocalTracesForTests(): void {
  traces.clear();
  listeners.clear();
}
