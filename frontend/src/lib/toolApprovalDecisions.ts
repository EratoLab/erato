import type {
  ApprovalDecisionItem,
  ContinueStreamRequest,
  ToolApprovalDecision,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Body for `POST /me/messages/continuestream`.
 *
 * The legacy single-`decision` body names no approval, so the server accepts
 * it only while exactly one is open; a stop covering more has to enumerate
 * them. One decision still answers every item — per-item answers need a card
 * that can ask per item.
 */
export const buildContinueStreamBody = ({
  messageId,
  decision,
  approvalIds,
}: {
  messageId: string;
  decision: ToolApprovalDecision;
  approvalIds?: string[];
}): ContinueStreamRequest => {
  if (approvalIds && approvalIds.length > 1) {
    const decisions: ApprovalDecisionItem[] = approvalIds.map((approvalId) => ({
      approval_id: approvalId,
      decision,
    }));
    return { message_id: messageId, decisions };
  }
  return { message_id: messageId, decision };
};
