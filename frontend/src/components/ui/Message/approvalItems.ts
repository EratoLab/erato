import type { ToolApprovalStatus } from "../Trace/Trace";
import type {
  ApprovalItem,
  ChildApprovalRef,
  ToolApprovalDecision,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * One decision of a stop, with the same `input` correction the part needs: the
 * generated schema collapses `serde_json::Value` to `void`, which would make
 * every payload on the item unusable.
 */
export type ApprovalItemPart = Omit<ApprovalItem, "input" | "child"> & {
  input: unknown;
  child?: (Omit<ChildApprovalRef, "input"> & { input: unknown }) | null;
};

/**
 * Answers the user has given so far, by `approval_id`. A card that asks per
 * item holds them until the stop is fully answered, because the server takes
 * one request covering every open item.
 */
export type StagedDecisions = Record<string, ToolApprovalDecision | undefined>;

/** The fields of a `tool_approval_request` part a stop is read off. */
export type ApprovalRequestSummary = {
  tool_call_id: string;
  tool_name: string;
  input: unknown;
  display?: ApprovalItem["display"];
  approvals?: ApprovalItemPart[] | null;
};

/**
 * Every item a stop covers — the client's `approval_items()`.
 *
 * A row written before approvals were addressable carries none and answers as
 * one item keyed by the gated call, so no reader may reach for `approvals`
 * itself: it would find nothing to answer on exactly the rows that are still
 * parked.
 */
export const approvalItemsOf = (
  request: ApprovalRequestSummary,
): ApprovalItemPart[] =>
  request.approvals && request.approvals.length > 0
    ? request.approvals
    : [
        {
          approval_id: request.tool_call_id,
          tool_call_id: request.tool_call_id,
          tool_name: request.tool_name,
          input: request.input,
          ...(request.display ? { display: request.display } : {}),
          child: null,
        },
      ];

/**
 * The open items in the order they were asked: a parked child's by its own
 * request, the turn's own call by the part's. Ties keep row order, the order
 * the server settles them in.
 */
export const approvalQueueOf = (
  request: { requested_at: string },
  open: ApprovalItemPart[],
): ApprovalItemPart[] => {
  const askedAt = (item: ApprovalItemPart) => {
    const at = Date.parse(item.child?.requested_at ?? request.requested_at);
    return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
  };
  return open
    .map((item, index) => ({ item, index, at: askedAt(item) }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at - b.at))
    .map(({ item }) => item);
};

/**
 * Whether "Always allow" may be offered for one item. A child carries its own
 * policy snapshot: the part's flag describes the part's own call, and on a
 * `client_tool` part no MCP policy binds that one.
 */
export const itemAllowsAlways = (
  item: ApprovalItemPart,
  request: { allow_always: boolean },
): boolean => item.child?.allow_always ?? request.allow_always;

export interface ApprovalStopState {
  /** The items still waiting on the user; a decision must cover exactly these. */
  open: ApprovalItemPart[];
  /** How the stop settled, or `null` while any item is still open. */
  resolution: ToolApprovalStatus | null;
}

/**
 * How much of a stop is left, over every item it covers.
 *
 * `partsAfter` must be only the parts positioned after the request, as the
 * server's own reader scopes it: an earlier park of the same turn left its own
 * decision parts on the row, and a chained re-park re-asks under the same ids —
 * read unscoped, the second stop looks answered and its card vanishes over a
 * row that is still parked, with no way left to finish the turn.
 */
export const approvalStopState = (
  request: ApprovalRequestSummary,
  partsAfter: readonly { content_type: string }[],
): ApprovalStopState => {
  const items = approvalItemsOf(request);
  const decisions = partsAfter.flatMap((part) => {
    if (
      part.content_type !== "tool_approval" &&
      part.content_type !== "tool_rejection"
    ) {
      return [];
    }
    // The generated schema loses the type of the optional ids, so they are read
    // through a narrowing accessor.
    const decided = part as unknown as {
      tool_call_id?: string;
      approval_id?: string | null;
    };
    return [
      {
        status:
          part.content_type === "tool_approval"
            ? ("approved" as const)
            : ("denied" as const),
        approvalId:
          typeof decided.approval_id === "string" &&
          decided.approval_id.length > 0
            ? decided.approval_id
            : null,
        toolCallId: decided.tool_call_id,
      },
    ];
  });
  const settled = items.map(
    (item) =>
      decisions.find((decision) =>
        // Rows written before approvals were addressable carry no
        // `approval_id`; for them the tool call id is the identity.
        decision.approvalId !== null
          ? decision.approvalId === item.approval_id
          : decision.toolCallId === item.tool_call_id,
      )?.status,
  );
  return {
    open: items.filter((_item, index) => settled[index] === undefined),
    resolution: settled.some((status) => status === undefined)
      ? null
      : settled.every((status) => status === "approved")
        ? "approved"
        : "denied",
  };
};
