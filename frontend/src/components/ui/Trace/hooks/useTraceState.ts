import type { TraceStepStatus, TraceablePart } from "../types";

/**
 * Compute the visual status of a single step based on its position in the
 * trace, the part itself, and whether the message is still streaming.
 *
 * The "running" status only ever applies to the LAST step of a still-streaming
 * message — earlier steps are already past, so they are `done` (or `error`
 * for failed tool calls).
 */
export const stepStatus = (
  part: TraceablePart,
  isLastStep: boolean,
  isStreaming: boolean,
): TraceStepStatus => {
  if (part.content_type === "tool_use") {
    if (part.status === "error") return "error";
    if (part.status === "success") return "done";
    return isLastStep && isStreaming ? "running" : "done";
  }

  // reasoning
  return isLastStep && isStreaming ? "running" : "done";
};
