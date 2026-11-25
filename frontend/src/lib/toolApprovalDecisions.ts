import type {
  ApprovalDecisionItem,
  ContinueStreamRequest,
  ToolApprovalDecision,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface DecidedApproval {
  approvalId: string;
  decision: ToolApprovalDecision;
  /**
   * For `approve_context` on a scope the host checks on the device: the host's
   * position at the click, sent as `scope_position`.
   */
  scopePosition?: unknown;
  /** For `request_change`: what the user wants different, in their words. */
  changeRequest?: string;
  /** For `approve` or `reject` said by voice: the endpoint's receipt. */
  voiceReceipt?: string;
  /**
   * For `approve` or `approve_always` of an item the server chained: what the
   * user chose on the host's own card, sent as `client_confirmation`.
   */
  clientConfirmation?: unknown;
}

/** The decisions that may carry a host card's `client_confirmation`. */
const takesClientConfirmation = (decision: ToolApprovalDecision): boolean =>
  decision === "approve" || decision === "approve_always";

/** What a body needs of an open item: a task's item names its question. */
export interface DecidedItem {
  approval_id: string;
  child?: { child_tool_call_id?: string } | null;
}

/**
 * Whether a decision lets the gated call run.
 *
 * Named positively, and spelled once: `withdraw` is a denial carrying a reason,
 * so anything phrased as "everything but reject" counts a withdrawal as an
 * approval.
 */
export const isApprovalDecision = (decision: ToolApprovalDecision): boolean =>
  decision === "approve" ||
  decision === "approve_always" ||
  decision === "approve_context";

/**
 * Body for `POST /me/messages/continuestream`.
 *
 * Every decided item is named by its approval id, a single one included: the
 * server takes a decision only for the card it names, so a tap that arrives
 * late, from a tab still showing an earlier card of the turn, cannot answer
 * the card that replaced it. The legacy single-`decision` body is left for a
 * caller that knows no approval id. `itemDecisions` is how a card that asks
 * per item — a task plan, one row per task — answers them differently; a card
 * with one question for the whole stop passes `approvalIds` and the one
 * decision instead.
 *
 * `shows_child_items` tells the server this client shows each parked child as
 * an item of its own; without it, a stop that carries children beside the
 * turn's own call is refused. `shows_limit_and_builtin_child_items` says the
 * same of the tool-call limit's stop and a built-in call's: a client that
 * predates those shows the limit's choice, or a generic card, alone, so the
 * server refuses such a stop with a child open without it.
 *
 * `items` are the card's open items: a delegated task's decision also names
 * the task's question the card showed, since a task that asks again keeps its
 * approval id.
 *
 * `readBack` asks for the continued answer to be spoken; the caller sets it
 * when the turn that stopped was spoken.
 */
export const buildContinueStreamBody = ({
  messageId,
  decision,
  approvalIds,
  itemDecisions,
  items = [],
  readBack = false,
}: {
  messageId: string;
  decision: ToolApprovalDecision;
  approvalIds?: string[];
  itemDecisions?: DecidedApproval[];
  items?: readonly DecidedItem[];
  readBack?: boolean;
}): ContinueStreamRequest => {
  const spoken = readBack ? { conversational_audio_back: true } : {};
  const decided: DecidedApproval[] =
    itemDecisions && itemDecisions.length > 0
      ? itemDecisions
      : (approvalIds ?? []).map((approvalId) => ({ approvalId, decision }));
  if (decided.length > 0) {
    const decisions: ApprovalDecisionItem[] = decided.map((item) => ({
      approval_id: item.approvalId,
      decision: item.decision,
      ...(item.scopePosition === undefined
        ? {}
        : {
            scope_position: item.scopePosition as NonNullable<
              ApprovalDecisionItem["scope_position"]
            >,
          }),
      ...(item.decision === "request_change" && item.changeRequest
        ? { change_request: item.changeRequest }
        : {}),
      ...(item.voiceReceipt ? { voice_receipt: item.voiceReceipt } : {}),
      ...(item.clientConfirmation !== undefined &&
      takesClientConfirmation(item.decision)
        ? {
            client_confirmation: item.clientConfirmation as NonNullable<
              ApprovalDecisionItem["client_confirmation"]
            >,
          }
        : {}),
      ...questionOf(items, item.approvalId),
    }));
    return {
      message_id: messageId,
      decisions,
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
      ...spoken,
    };
  }
  return {
    message_id: messageId,
    decision,
    shows_child_items: true,
    shows_limit_and_builtin_child_items: true,
    ...spoken,
  };
};

const questionOf = (
  items: readonly DecidedItem[],
  approvalId: string,
): { child_tool_call_id?: string } => {
  const question = items.find((item) => item.approval_id === approvalId)?.child
    ?.child_tool_call_id;
  return question ? { child_tool_call_id: question } : {};
};
