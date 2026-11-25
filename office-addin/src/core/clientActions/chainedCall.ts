import { useConversationSelector } from "@erato/frontend/library";
import { useMemo } from "react";

import { USER_PICKS } from "./proposalApply";
import { CLIENT_ACTION_TOOL_NAME } from "./proposedClientAction";

import type { ProposalApplyResult } from "./proposalApply";
import type { ContentPart } from "@erato/frontend/library";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The stored answer's tool call with this id. */
export function toolUseOf(
  content: readonly ContentPart[] | undefined,
  callId: string,
): Extract<ContentPart, { content_type: "tool_use" }> | undefined {
  const part = (content ?? []).find(
    (candidate) =>
      candidate.content_type === "tool_use" &&
      candidate.tool_call_id === callId,
  );
  return part?.content_type === "tool_use" ? part : undefined;
}

/** The server's call for an accepted submission or proposal, when the server chained one. */
export function chainedCallId(
  content: readonly ContentPart[] | undefined,
  proposalCallId: string | undefined,
): string | undefined {
  if (!proposalCallId) return undefined;
  const part = toolUseOf(content, proposalCallId);
  if (!part || !object(part.output)) return undefined;
  const apply = part.output.apply;
  return object(apply) && typeof apply.call_id === "string"
    ? apply.call_id
    : undefined;
}

/** What a host's call answers: at least how it ended. */
interface ChainedCallResult {
  status: string;
  reason?: string;
}

export type ChainedCallState<R extends ChainedCallResult> =
  | { kind: "waiting" }
  | { kind: "applying" }
  | { kind: "cancelled" }
  | { kind: "done"; result: R | ProposalApplyResult };

/** Where the server's call stands, as the stored answer has it. */
export function chainedCallState<R extends ChainedCallResult>(
  content: readonly ContentPart[] | undefined,
  callId: string,
): ChainedCallState<R> {
  const part = toolUseOf(content, callId);
  if (!part) return { kind: "waiting" };
  const raw: unknown = part.output;
  const output = object(raw) ? raw : undefined;
  if (output?.status === "rejected") return { kind: "cancelled" };
  const result = output?.result;
  if (part.status === "success" && object(result))
    return { kind: "done", result: result as unknown as R };
  if (part.status === "error")
    return {
      kind: "done",
      result:
        output?.status === "cancelled"
          ? cancelledResult(output.reason)
          : { status: "failed", reason: "host_error" },
    };
  return { kind: "applying" };
}

// Reasons the server ends a call with before the pane could have acted.
const NEVER_ACTED = new Set([
  "context_unavailable",
  "withdrawn",
  "expired",
  "scope_changed",
]);

/** The server's own end of the call, as it reports it: a pane that did not answer in time may
 * still have acted. */
function cancelledResult(reason: unknown): ProposalApplyResult {
  const why = typeof reason === "string" ? reason : undefined;
  if (why === "pane_gone") return { status: "unavailable", reason: why };
  if (why === "aborted") return { status: "failed", reason: "stopped" };
  if (why && NEVER_ACTED.has(why)) return { status: "failed", reason: why };
  return { status: "unconfirmed", reason: why };
}

/**
 * Where the server's call for the answer's proposed action stands. Undefined when the server
 * makes none, or when the card's own buttons are the way to act on what it shows.
 */
export function chainedProposalState<R extends ChainedCallResult>(
  content: readonly ContentPart[] | undefined,
  actions: readonly string[],
  /** The card's own buttons act: the answer holds several versions, or the card shows another. */
  leftToCard: (content: readonly ContentPart[] | undefined) => boolean,
): ChainedCallState<R> | undefined {
  // A change asked for on the card lets Erato propose again, so the newest chained proposal is the
  // one asked; a second proposal the server refused has no call and never replaces it.
  let callId: string | undefined;
  for (let index = (content?.length ?? 0) - 1; index >= 0 && !callId; index--) {
    const part = content![index];
    if (
      part.content_type === "tool_use" &&
      part.tool_name === CLIENT_ACTION_TOOL_NAME &&
      object(part.input) &&
      actions.includes(part.input.action as string)
    )
      callId = chainedCallId(content, part.tool_call_id);
  }
  if (!callId || leftToCard(content)) return undefined;
  const state = chainedCallState<R>(content, callId);
  return state.kind === "done" && state.result.reason === USER_PICKS
    ? undefined
    : state;
}

/**
 * A card's reading of where a chained call stands, taken as one string, so text streamed into
 * the answer does not redraw the card.
 */
export function useChainedState<R extends ChainedCallResult>(
  messageId: string | undefined,
  read: (
    content: readonly ContentPart[] | undefined,
  ) => ChainedCallState<R> | undefined,
): ChainedCallState<R> | undefined {
  const selected = useConversationSelector((messages) => {
    const state = read(messageId ? messages[messageId]?.content : undefined);
    return state ? JSON.stringify(state) : "";
  }, Object.is);
  return useMemo(
    () =>
      selected ? (JSON.parse(selected) as ChainedCallState<R>) : undefined,
    [selected],
  );
}
