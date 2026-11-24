import { createApplyCallMarkers } from "./applyCallMarkers";
import { CLIENT_ACTION_TOOL_NAME } from "./proposedClientAction";

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
  | "unconfirmed"
  | "needs_decision"
  | "failed"
  | "unavailable";

/**
 * The reason of an action whose answer offers several versions: the user picks one with its own
 * button, so the server ends the answer without asking the model.
 */
export const USER_PICKS = "user_picks";

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

/**
 * Whether the server carries out the message's proposal through a tool of its own: then the
 * user decides in the chat's decision place, and the pane does not prompt on its own.
 */
export function isProposalChained(
  content: readonly ContentPart[] | undefined,
): boolean {
  return (content ?? []).some(
    (part) =>
      part.content_type === "tool_use" &&
      part.tool_name === CLIENT_ACTION_TOOL_NAME &&
      part.status === "success" &&
      object(part.output) &&
      object(part.output.apply) &&
      typeof part.output.apply.call_id === "string",
  );
}

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

export const PROPOSAL_CALLS_KEY = "erato.addin.proposalCalls";
const proposalCalls = createApplyCallMarkers(PROPOSAL_CALLS_KEY);

/** What an executor tells the guard: the write is about to start. */
export type ProposalWriteStarts = () => void;

/**
 * Runs a call at most once per call id, also across a pane reload: a call the server sends again
 * gets the first run's answer, and one whose write had started answers `unconfirmed` instead of
 * opening a second form or inserting twice.
 */
export function proposalOnceByCallId(
  execute: (
    input: ProposalApplyInput,
    context: ClientToolCallContext,
    writeStarts: ProposalWriteStarts,
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
    const { toolCallId, messageId } = context;
    const running = calls.get(toolCallId);
    if (running) return running;
    const marker = proposalCalls.marker(toolCallId);
    if (marker?.state === "done")
      return Promise.resolve(
        proposalAnswer(marker.result as ProposalApplyResult),
      );
    if (marker?.state === "writing")
      return Promise.resolve(
        proposalAnswer({
          status: "unconfirmed",
          reason: "reloaded_during_write",
        }),
      );
    let started = false;
    const call = execute(parsed, context, () => {
      started = true;
      proposalCalls.markWriting(toolCallId, messageId);
    }).then(
      (result) => {
        // The server sends the same call again once the user decided on screen.
        if (result.status === "needs_decision") {
          calls.delete(toolCallId);
          proposalCalls.forget(toolCallId);
        } else proposalCalls.markDone(toolCallId, messageId, result);
        return proposalAnswer(result);
      },
      () => {
        const result: ProposalApplyResult = started
          ? { status: "unconfirmed", reason: "host_error" }
          : { status: "failed", reason: "host_error" };
        proposalCalls.markDone(toolCallId, messageId, result);
        return proposalAnswer(result);
      },
    );
    calls.set(toolCallId, call);
    return call;
  };
}

/** One fenced block of an answer: its tag as written and its body. */
export interface AnswerFence {
  language: string;
  body: string;
}

const FENCE_OPENING = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*$/;

/**
 * The fenced blocks of an answer's text, in order, read as the answer's markdown shows them: a
 * body loses up to the opening fence's indentation, and an unterminated fence runs to the end.
 */
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
    const [, indent, run, language] = opening;
    const closing = new RegExp(`^[ \\t]*${run[0]}{${run.length},}[ \\t]*$`);
    const found = lines.findIndex(
      (line, at) => at > index && closing.test(line),
    );
    const end = found < 0 ? lines.length : found;
    const strip = new RegExp(`^[ \\t]{0,${indent.length}}`);
    fences.push({
      language,
      body: lines
        .slice(index + 1, end)
        .map((line) => line.replace(strip, ""))
        .join("\n"),
    });
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

/** The pane actions the server decides for a host: those its approval tools carry out. */
export function serverDecidedActions(
  mappings: readonly CarryOverMapping[],
): ReadonlySet<string> {
  return new Set(mappings.flatMap((mapping) => mapping.actions));
}
