/**
 * Applying a sidecar trace as an event log.
 *
 * The protocol delivers the whole log with the result today, but the log is
 * append-only and each step carries a stable `sequence`: a later step with an
 * existing sequence supersedes the earlier one. Rendering goes through this
 * reducer rather than mapping the array directly, so a log that arrives
 * complete and a log that arrives in parts produce the same view — and
 * incremental delivery, if it ever lands, is a transport change rather than a
 * re-render.
 */

import type {
  SidecarLocalTrace,
  SidecarLocalTraceStep,
} from "@erato/desktop-sidecar-protocol";

/** A step plus its depth, ready to render. */
export interface SidecarTraceRow {
  step: SidecarLocalTraceStep;
  /** Nesting level derived from `parentSequence` chains. */
  depth: number;
}

/**
 * Merge `incoming` steps into `previous` by sequence (last one wins) and keep
 * the result ordered. Applying the same log twice is a no-op, so a replayed
 * or re-recorded result cannot duplicate steps.
 */
export function applySidecarTraceSteps(
  previous: readonly SidecarLocalTraceStep[],
  incoming: readonly SidecarLocalTraceStep[],
): SidecarLocalTraceStep[] {
  const bySequence = new Map<number, SidecarLocalTraceStep>();
  for (const step of [...previous, ...incoming]) {
    bySequence.set(step.sequence, step);
  }
  return [...bySequence.values()].sort((left, right) => {
    const byStart =
      (left.startedAtOffsetMs ?? 0) - (right.startedAtOffsetMs ?? 0);
    return byStart === 0 ? left.sequence - right.sequence : byStart;
  });
}

export function mergeSidecarTraces(
  previous: SidecarLocalTrace | undefined,
  incoming: SidecarLocalTrace,
): SidecarLocalTrace {
  return {
    ...previous,
    ...incoming,
    steps: applySidecarTraceSteps(previous?.steps ?? [], incoming.steps),
  };
}

/** Statuses the protocol defines as settled; anything unknown is in flight. */
const SETTLED_STEP_STATUSES = new Set(["ok", "degraded", "skipped", "error"]);

export function isSidecarStepRunning(status: string): boolean {
  return !SETTLED_STEP_STATUSES.has(status);
}

/**
 * Whether the trace currently shows a local model working. That is the
 * reasoning-like activity worth surfacing live while a call runs; plain
 * input/output stages present only their result, like any other tool call.
 */
export function hasLiveLocalModelStep(
  trace: SidecarLocalTrace | undefined,
): boolean {
  if (!trace) {
    return false;
  }
  return applySidecarTraceSteps([], trace.steps).some(
    (step) =>
      typeof step.model === "string" && isSidecarStepRunning(step.status),
  );
}

/**
 * Flatten a trace into render rows: parents followed by the steps that ran
 * inside them, each with its nesting depth. A step whose parent is unknown is
 * treated as top level, so a partial log never hides work.
 */
export function sidecarTraceRows(trace: SidecarLocalTrace): SidecarTraceRow[] {
  const steps = applySidecarTraceSteps([], trace.steps);
  const childrenByParent = new Map<number, SidecarLocalTraceStep[]>();
  const known = new Set(steps.map((step) => step.sequence));
  const roots: SidecarLocalTraceStep[] = [];
  for (const step of steps) {
    const parent = step.parentSequence;
    if (
      parent === undefined ||
      !known.has(parent) ||
      parent === step.sequence
    ) {
      roots.push(step);
      continue;
    }
    const siblings = childrenByParent.get(parent);
    if (siblings) {
      siblings.push(step);
    } else {
      childrenByParent.set(parent, [step]);
    }
  }

  const rows: SidecarTraceRow[] = [];
  const visit = (step: SidecarLocalTraceStep, depth: number): void => {
    rows.push({ step, depth });
    // Depth is bounded by the log's own nesting; a cycle is impossible
    // because a child's parent always precedes it in the sorted order.
    for (const child of childrenByParent.get(step.sequence) ?? []) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots) {
    visit(root, 0);
  }
  return rows;
}
