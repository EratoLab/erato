import { isChildItem } from "@/components/ui/Message/approvalItems";
import { isApprovalDecision } from "@/lib/toolApprovalDecisions";

import type {
  ContentPart,
  ToolApprovalDecision,
  ToolApprovalKind,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface SeedableApprovalItem {
  approval_id: string;
  tool_call_id: string;
  tool_name: string;
  input: unknown;
  child?: {
    child_chat_id: string;
    mcp_server_id: string;
    kind?: ToolApprovalKind | null;
  } | null;
}

/** One open item of a stop with the answer given for it. */
export interface SettledApproval {
  item: SeedableApprovalItem;
  decision: ToolApprovalDecision;
}

const decisionPart = (
  { item, decision }: SettledApproval,
  now: string,
): ContentPart =>
  // The generated schema collapses both `serde_json::Value` and
  // `Option<String>` to `void`/`null`, which makes a typed literal impossible
  // for `input`, `approval_id` and `reason`; the shapes are the parts the
  // server persists.
  (isApprovalDecision(decision)
    ? {
        // eslint-disable-next-line lingui/no-unlocalized-strings -- API wire value
        content_type: "tool_approval",
        tool_call_id: item.tool_call_id,
        always_allow: decision === "approve_always",
        approved_at: now,
        approval_id: item.approval_id,
        child_chat_id: item.child?.child_chat_id ?? null,
      }
    : {
        // eslint-disable-next-line lingui/no-unlocalized-strings -- API wire value
        content_type: "tool_rejection",
        tool_call_id: item.tool_call_id,
        never_allow: decision === "reject_always",
        rejected_at: now,
        approval_id: item.approval_id,
        child_chat_id: item.child?.child_chat_id ?? null,
        reason: decision === "withdraw" ? "withdrawn" : null,
      }) as unknown as ContentPart;

const toolUsePart = (item: SeedableApprovalItem, approved: boolean) =>
  ({
    // eslint-disable-next-line lingui/no-unlocalized-strings -- API wire value
    content_type: "tool_use",
    tool_call_id: item.tool_call_id,
    tool_name: item.tool_name,
    input: item.input ?? null,
    output: null,
    progress_message: null,
    // A denial never calls the tool: the server records the refusal as a
    // failed call, so show it that way instead of a spinner that can only ever
    // resolve to an error.
    // eslint-disable-next-line lingui/no-unlocalized-strings -- API wire value
    status: approved ? "in_progress" : "error",
  }) as ContentPart;

/**
 * The parts a continuation appends before it contacts the model, in the order
 * the server writes them, so the streamed `content_index` values land where the
 * server numbered them.
 *
 * The turn's own items settle first: an MCP call runs at once, so it gets its
 * decision and its call, and a refused plan or client-tool call gets its
 * refusal. The parked children come next, decision only, because each child's
 * slot already sits on the row and is overwritten where it stands. An approved
 * client-tool call is dispatched last, once the turn resumes; an approved plan
 * item gets its slot from the dispatch itself.
 */
export const seedDecisionParts = (
  settled: readonly SettledApproval[],
  kind: ToolApprovalKind | undefined,
  now: string,
): ContentPart[] => {
  const own = settled.filter(({ item }) => !isChildItem(item, kind));
  const children = settled.filter(({ item }) => isChildItem(item, kind));
  const ownParts = own.flatMap((answer) => {
    const approved = isApprovalDecision(answer.decision);
    if (
      kind === "tool_call_limit" ||
      ((kind === "task_plan" || kind === "client_tool") && approved)
    ) {
      return [decisionPart(answer, now)];
    }
    return [decisionPart(answer, now), toolUsePart(answer.item, approved)];
  });
  const dispatched =
    kind === "client_tool"
      ? own
          .filter(({ decision }) => isApprovalDecision(decision))
          .map(({ item }) => toolUsePart(item, true))
      : [];
  return [
    ...ownParts,
    ...children.map((answer) => decisionPart(answer, now)),
    ...dispatched,
  ];
};

/**
 * Where a set of standing answers was saved, per item. A parked child's answer
 * lands on the child's own MCP server, so one stop can touch several rosters; a
 * client tool's answer, the turn's own or a child's, is a preference on the
 * user's profile instead.
 */
export const standingAnswerTargets = (
  answers: readonly {
    item: Pick<SeedableApprovalItem, "child"> | undefined;
    decision: ToolApprovalDecision;
  }[],
  kind: ToolApprovalKind | undefined,
  ownServerId: string,
): { clientPreference: boolean; mcpStanding: boolean; rosters: string[] } => {
  const standing = answers.filter(
    ({ decision }) =>
      decision === "approve_always" || decision === "reject_always",
  );
  const savesClientPreference = ({
    item,
  }: {
    item: Pick<SeedableApprovalItem, "child"> | undefined;
  }) =>
    item?.child == null
      ? kind === "client_tool"
      : item.child.kind === "client_tool";
  const mcpAnswers = standing.filter(
    (answer) => !savesClientPreference(answer),
  );
  // A kind that names no MCP server of its own — a task plan — has no roster
  // to drop, and the empty id would name a listing that does not exist.
  const rosters = [
    ...new Set(
      mcpAnswers
        .map(({ item }) => item?.child?.mcp_server_id ?? ownServerId)
        .filter((serverId) => serverId !== ""),
    ),
  ];
  return {
    clientPreference: standing.some(savesClientPreference),
    mcpStanding: mcpAnswers.length > 0,
    rosters,
  };
};
