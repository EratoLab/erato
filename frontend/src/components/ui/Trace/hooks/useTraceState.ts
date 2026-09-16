import type { LogicalStep, TraceStepStatus } from "../types";

/**
 * Compute the visual status of a logical step given its position in the
 * timeline and whether the trace cluster is the active writer.
 *
 * A tool call carries its own liveness, so an unfinished one is running
 * wherever it sits: several may be in flight at once and only one of them
 * can be last. Reasoning has no such marker — it is only ever the tail of
 * the timeline that is still being written, so there position is the signal.
 */
export const stepStatus = (
  step: LogicalStep,
  isLastStep: boolean,
  isTraceActive: boolean,
): TraceStepStatus => {
  if (step.kind === "tool_use") {
    if (step.part.status === "error") return "error";
    if (step.part.status === "success") return "done";
    return isTraceActive ? "running" : "done";
  }
  // reasoning
  return isLastStep && isTraceActive ? "running" : "done";
};
