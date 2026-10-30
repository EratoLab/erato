import type { ToolApprovalStatus } from "../Trace/Trace";
import type {
  ApprovalItem,
  ChildApprovalRef,
  ToolApprovalDecision,
  ToolApprovalKind,
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
 * Whether an item is settled by resuming a parked child rather than by this
 * turn: any item that names a child, and every item of a `delegated_task` stop,
 * including one whose child was never recorded.
 */
export const isChildItem = (
  item: { child?: unknown },
  kind: ToolApprovalKind | undefined,
): boolean => item.child != null || kind === "delegated_task";

/**
 * Whether an item names a task child that waits for a client on the device
 * rather than for a decision. Nobody decides it: it settles once the child's
 * call ran and the child stopped again.
 */
export const isWaitingItem = (item: ApprovalItemPart): boolean =>
  item.child?.waiting_for != null;

/**
 * The digits below the millisecond of an RFC 3339 time. `Date.parse` stops at
 * the millisecond, and the server writes microseconds. Anchored, so matching
 * stays linear on any input.
 */
const subMillisecondOf = (time: string): number => {
  const fraction =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(\d+)/.exec(time)?.[1] ?? "";
  return Number(fraction.slice(3, 9).padEnd(6, "0"));
};

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
    const time = item.child?.requested_at ?? request.requested_at;
    const at = Date.parse(time);
    return Number.isNaN(at)
      ? { at: Number.POSITIVE_INFINITY, below: 0 }
      : { at, below: subMillisecondOf(time) };
  };
  return open
    .map((item, index) => ({ item, index, ...askedAt(item) }))
    .sort((a, b) => a.at - b.at || a.below - b.below || a.index - b.index)
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
  /** The task children this stop still waits for on the device. */
  waiting: ApprovalItemPart[];
  /** How the stop settled, or `null` while any item is still open. */
  resolution: ToolApprovalStatus | null;
}

/** Where a stop sits in its message, which decides its waiting items. */
export interface ApprovalStopPlacement {
  /**
   * The status of the message's last `tool_use` for each tool call id. A
   * waiting item is open while its task's slot is `in_progress`. Without it,
   * every waiting item of the last stop counts as open.
   */
  slots?: Readonly<Record<string, string | undefined>>;
  /**
   * Whether this is the message's last `tool_approval_request`. An earlier
   * stop's waiting items were carried onto a later one or settled, so they
   * never count.
   */
  isLastStop?: boolean;
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
  { slots, isLastStop = true }: ApprovalStopPlacement = {},
): ApprovalStopState => {
  const all = approvalItemsOf(request);
  const items = all.filter((item) => !isWaitingItem(item));
  const waiting = isLastStop
    ? all.filter(
        (item) =>
          isWaitingItem(item) &&
          (slots === undefined || slots[item.tool_call_id] === "in_progress"),
      )
    : [];
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
    waiting,
    // A stop of waiting children alone is settled by their slots, and nothing
    // on it was ever denied.
    resolution:
      waiting.length > 0 || settled.some((status) => status === undefined)
        ? null
        : settled.every((status) => status === "approved")
          ? "approved"
          : "denied",
  };
};
