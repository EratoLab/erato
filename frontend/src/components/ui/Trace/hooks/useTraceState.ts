import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { submissionEnd } from "@/lib/trace/submissionSteps";

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

/** A call that has not returned: the turn is parked on it, still writes it, or abandoned it. */
const unsettledStatus = (
  waits: boolean,
  isTraceActive: boolean,
  isChatBusy: boolean,
): TraceStepStatus => {
  if (waits) return "waiting";
  if (isTraceActive) return "running";
  // Only a chat that still owes an outcome can be trusted to settle the call
  // later; with no such writer left it was abandoned mid-flight, and calling
  // that `done` would put a green check on a call that never returned.
  return isChatBusy ? "done" : "interrupted";
};

/**
 * Compute the visual status of a logical step given its position in the
 * timeline and whether the trace cluster is the active writer.
 *
 * A tool call carries its own liveness, so an unfinished one is running
 * wherever it sits: several may be in flight at once and only one of them
 * can be last. Reasoning has no such marker — it is only ever the tail of
 * the timeline that is still being written, so there position is the signal.
 *
 * `waitingToolCallId` is the call the message's own last `client_tool_pending`
 * part names (`waitingCallOf`). The turn is parked on that call, so it waits
 * whatever the chat-wide flag says: the flag is the page's, and it can read
 * busy (a check) or idle (Interrupted) while the call has not returned.
 */
export const stepStatus = (
  step: LogicalStep,
  isLastStep: boolean,
  isTraceActive: boolean,
  isChatBusy = false,
  waitingToolCallId?: string,
): TraceStepStatus => {
  if (step.kind === "tool_use") {
    if (step.part.status === "error") return "error";
    if (step.part.status === "success") return "done";
    return unsettledStatus(
      waitingToolCallId !== undefined &&
        step.part.tool_call_id === waitingToolCallId,
      isTraceActive,
      isChatBusy,
    );
  }
  if (step.kind === "submission") {
    // Only how the submission ended is the step's outcome; a part sent again is no failure.
    const end = submissionEnd(step.calls);
    if (end) return end === "accepted" ? "done" : "error";
    // Without a recorded end it is open like a call that has not returned, also once every call
    // has: the model stopped, the provider failed or the budget ran out before it finished.
    return unsettledStatus(
      waitingToolCallId !== undefined &&
        step.calls.some(
          (call) =>
            call.tool_call_id === waitingToolCallId &&
            call.status !== "success" &&
            call.status !== "error",
        ),
      isTraceActive,
      isChatBusy,
    );
  }
  // reasoning
  return isLastStep && isTraceActive ? "running" : "done";
};
