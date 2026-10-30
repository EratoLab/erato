import type {
  ApprovalDecisionItem,
  ContinueStreamRequest,
  ToolApprovalDecision,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface DecidedApproval {
  approvalId: string;
  decision: ToolApprovalDecision;
}

/**
 * Whether a decision lets the gated call run.
 *
 * Named positively, and spelled once: `withdraw` is a denial carrying a reason,
 * so anything phrased as "everything but reject" counts a withdrawal as an
 * approval.
 */
export const isApprovalDecision = (decision: ToolApprovalDecision): boolean =>
  decision === "approve" || decision === "approve_always";

/**
 * Body for `POST /me/messages/continuestream`.
 *
 * The legacy single-`decision` body names no approval, so the server accepts
 * it only while exactly one is open; a stop covering more has to enumerate
 * them. `itemDecisions` is how a card that asks per item — a task plan, one
 * row per task — answers them differently; a card with one question for the
 * whole stop passes `approvalIds` and the one decision instead.
 *
 * `shows_child_items` tells the server this client shows each parked child as
 * an item of its own; without it, a stop that carries children beside the
 * turn's own call is refused.
 *
 * `enumerate` names even a single item: a stop with tasks still waiting can
 * gain a question while the card is open, and only an enumerated body comes
 * back as `decisions_mismatch` naming it.
 */
export const buildContinueStreamBody = ({
  messageId,
  decision,
  approvalIds,
  itemDecisions,
  enumerate = false,
}: {
  messageId: string;
  decision: ToolApprovalDecision;
  approvalIds?: string[];
  itemDecisions?: DecidedApproval[];
  enumerate?: boolean;
}): ContinueStreamRequest => {
  const decided: DecidedApproval[] =
    itemDecisions && itemDecisions.length > 0
      ? itemDecisions
      : (approvalIds ?? []).map((approvalId) => ({ approvalId, decision }));
  if (decided.length > 1 || (enumerate && decided.length > 0)) {
    const decisions: ApprovalDecisionItem[] = decided.map((item) => ({
      approval_id: item.approvalId,
      decision: item.decision,
    }));
    return { message_id: messageId, decisions, shows_child_items: true };
  }
  // A single open item needs no enumeration, but it still has to be answered
  // with its own decision rather than the caller's default: a one-row plan is
  // answered per row like any other.
  return {
    message_id: messageId,
    decision: decided[0]?.decision ?? decision,
    shows_child_items: true,
  };
};
