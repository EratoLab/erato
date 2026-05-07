import type { LogicalStep, TraceStepStatus } from "../types";

/**
 * Compute the visual status of a logical step given its position in the
 * timeline and whether the trace cluster is the active writer.
 *
 * "running" only ever applies to the LAST step of an active trace — earlier
 * steps are by definition past, so they are `done` (or `error` for failed
 * tool calls).
 */
export const stepStatus = (
  step: LogicalStep,
  isLastStep: boolean,
  isTraceActive: boolean,
): TraceStepStatus => {
  if (step.kind === "tool_use") {
    if (step.part.status === "error") return "error";
    if (step.part.status === "success") return "done";
    return isLastStep && isTraceActive ? "running" : "done";
  }
  // reasoning
  return isLastStep && isTraceActive ? "running" : "done";
};
