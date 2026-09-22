import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";

import type { LogicalStep, TraceStepStatus } from "../types";

/**
 * Whether the chat on screen still owes its trace an outcome.
 *
 * `action_required` counts as busy alongside `running`: a turn parked on an
 * approval has left its tool part unsettled deliberately, and that park is
 * server-durable, so reading "not generating" as "the writer died" would mark
 * every parked turn interrupted. A chat the poll knows nothing about reads as
 * not busy, which is the honest answer for a cold load of an old chat.
 */
export const useIsCurrentChatBusy = (): boolean =>
  useGenerationStatusStore((state) => {
    const chatId = state.currentChatId;
    if (chatId === null) return false;
    const kind = state.statusByChatId[chatId]?.kind;
    return kind === "running" || kind === "action_required";
  });

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
  isChatBusy = false,
): TraceStepStatus => {
  if (step.kind === "tool_use") {
    if (step.part.status === "error") return "error";
    if (step.part.status === "success") return "done";
    if (isTraceActive) return "running";
    // Unfinished on a trace that is no longer being written. Only a chat that
    // still owes an outcome can be trusted to settle the part later; with no
    // such writer left the call was abandoned mid-flight, and calling that
    // `done` would put a green check on a call that never returned.
    return isChatBusy ? "done" : "interrupted";
  }
  // reasoning
  return isLastStep && isTraceActive ? "running" : "done";
};
