import type { CarryOverMapping } from "./carryOverDecisions";
import type {
  ApprovalToolInfo,
  ClientToolCallContext,
  ClientToolExecutionResult,
  ClientToolExecutor,
  ContentPart,
} from "@erato/frontend/library";

/** What the server's call for a proposed client action names. */
export interface ProposalApplyInput {
  proposalCallId: string;
  action: string;
  /** The open item the answer was made for, when the request carried one. */
  itemIdentity: string | null;
  /** What the user confirmed on the decision-place card, sent with the approval. */
  confirmation: Record<string, unknown>;
}

export type ProposalApplyStatus =
  | "applied"
  | "needs_decision"
  | "failed"
  | "unavailable";

/** What a proposed action's call tells the server and the model: no content. */
export interface ProposalApplyResult {
  status: ProposalApplyStatus;
  reason?: string;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseProposalApplyInput(
  input: unknown,
): ProposalApplyInput | null {
  if (!object(input)) return null;
  const {
    proposal_call_id: callId,
    action,
    item_identity: identity,
    confirmation,
  } = input;
  if (typeof callId !== "string" || !callId) return null;
  if (typeof action !== "string" || !action) return null;
  return {
    proposalCallId: callId,
    action,
    itemIdentity: typeof identity === "string" && identity ? identity : null,
    confirmation: object(confirmation) ? confirmation : {},
  };
}

export const proposalAnswer = (
  result: ProposalApplyResult,
): ClientToolExecutionResult => ({ ok: true, result });

/** Whether `messageId` is the chat's latest assistant message. */
export function isLatestAssistantMessage(
  messages: Readonly<Record<string, { role?: string } | undefined>>,
  messageOrder: readonly string[],
  messageId: string,
): boolean {
  for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
    const id = messageOrder[index];
    if (messages[id]?.role === "assistant") return id === messageId;
  }
  return false;
}

/**
 * The open item is the one the answer was made for. Either side missing counts as another item:
 * a missed action is better than an action on the wrong email or document.
 */
export const sameItem = (
  expected: string | null | undefined,
  current: string | null | undefined,
): boolean => !!expected && !!current && expected === current;

/**
 * Runs a call at most once per call id: a call the server sends again after a reload or a
 * replayed stream gets the first run's answer instead of a second form or insert.
 */
export function proposalOnceByCallId(
  execute: (
    input: ProposalApplyInput,
    context: ClientToolCallContext,
  ) => Promise<ProposalApplyResult>,
): ClientToolExecutor {
  const calls = new Map<string, Promise<ClientToolExecutionResult>>();
  return (input, context) => {
    if (!context)
      return Promise.resolve(
        proposalAnswer({ status: "unavailable", reason: "no_request" }),
      );
    const parsed = parseProposalApplyInput(input);
    if (!parsed)
      return Promise.resolve(
        proposalAnswer({ status: "failed", reason: "invalid_input" }),
      );
    const running = calls.get(context.toolCallId);
    if (running) return running;
    const call = execute(parsed, context).then(
      (result) => {
        // The server sends the same call again once the user decided on screen.
        if (result.status === "needs_decision")
          calls.delete(context.toolCallId);
        return proposalAnswer(result);
      },
      () => proposalAnswer({ status: "failed", reason: "host_error" }),
    );
    calls.set(context.toolCallId, call);
    return call;
  };
}

/** One fenced block of an answer: its tag as written and its body. */
export interface AnswerFence {
  language: string;
  body: string;
}

const FENCE_OPENING = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*$/;

/** The fenced blocks of an answer's text, in order. An unterminated one is left out. */
export function answerFences(
  content: readonly ContentPart[] | undefined,
): AnswerFence[] {
  const text = (content ?? [])
    .flatMap((part) => (part.content_type === "text" ? [part.text] : []))
    .join("\n\n");
  const lines = text.split("\n");
  const fences: AnswerFence[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = FENCE_OPENING.exec(lines[index]);
    if (!opening) continue;
    const [, run, language] = opening;
    const closing = new RegExp(`^[ \\t]*${run}[ \\t]*$`);
    const end = lines.findIndex((line, at) => at > index && closing.test(line));
    if (end < 0) break;
    fences.push({ language, body: lines.slice(index + 1, end).join("\n") });
    index = end;
  }
  return fences;
}

/**
 * The carry-over mappings of a host from the server's approval tools: each tool of the host's
 * namespace and the pane actions it carries out.
 */
export function carryOverMappingsFor(
  tools: readonly ApprovalToolInfo[],
  namespace: string,
): CarryOverMapping[] {
  return tools.flatMap((tool) =>
    tool.qualified_name.startsWith(`${namespace}/`) &&
    (tool.client_actions?.length ?? 0) > 0
      ? [{ serverKey: tool.qualified_name, actions: tool.client_actions! }]
      : [],
  );
}
