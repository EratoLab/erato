import { t } from "@lingui/core/macro";

/**
 * The closed delegation `reason` vocabulary, said in the user's words. An unknown value
 * is rendered verbatim rather than dropped: a newer backend should degrade to
 * something readable, not to silence.
 *
 * Shared by the trace step and the task-result card so the two cannot drift.
 * Lives under `lib/` rather than `components/` so the component-registry
 * generator does not put it on the kit surface.
 */
export const delegationReasonLabel = (reason: string): string => {
  switch (reason) {
    case "timeout":
      return t({
        id: "trace.delegation.reason.timeout",
        message: "The run took too long",
      });
    case "no_answer":
      return t({
        id: "trace.delegation.reason.noAnswer",
        message: "The run ended without an answer",
      });
    case "parent_abort":
      return t({
        id: "trace.delegation.reason.parentAbort",
        message: "Stopped with the message that started it",
      });
    case "cap_exceeded":
      return t({
        id: "trace.delegation.reason.capExceeded",
        message: "Stopped at its tool-call budget; the answer may be partial",
      });
    case "approval_pending":
      return t({
        id: "trace.delegation.reason.approvalPending",
        message: "Waiting for your decision on a tool it wants to use",
      });
    case "approval_unavailable":
      return t({
        id: "trace.delegation.reason.approvalUnavailable",
        message: "Needed a tool it could not ask you about",
      });
    default:
      return reason;
  }
};
