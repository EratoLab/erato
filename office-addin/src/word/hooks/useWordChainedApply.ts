import { useConversationSelector } from "@erato/frontend/library";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  answerFences,
  USER_PICKS,
} from "../../core/clientActions/proposalApply";
import {
  wordChainedApplyCallId,
  wordChainedApplyState,
} from "../utils/wordChainedApply";
import {
  CLIENT_ACTION_TOOL_NAME,
  WORD_CLIENT_ACTIONS,
} from "../utils/wordClientActions";
import { wordDocumentReadSession } from "../utils/wordDocumentReadTool";

import type { WordChainedApplyState } from "../utils/wordChainedApply";
import type { WordClientAction } from "../utils/wordClientActions";
import type { ContentPart } from "@erato/frontend/library";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

/**
 * Where the server's apply of this card's submission stands, or undefined when the server applies
 * none (today's card, which applies itself). Read as one string, so streamed text does not redraw
 * the card.
 */
export function useWordChainedApply(
  messageId: string | undefined,
  submissionCallId: string | undefined,
): WordChainedApplyState | undefined {
  const selected = useConversationSelector((messages) => {
    const content = messageId ? messages[messageId]?.content : undefined;
    const applyCallId = wordChainedApplyCallId(content, submissionCallId);
    return applyCallId
      ? JSON.stringify(wordChainedApplyState(content, applyCallId))
      : "";
  }, Object.is);
  return useMemo(
    () =>
      selected ? (JSON.parse(selected) as WordChainedApplyState) : undefined,
    [selected],
  );
}

/**
 * Where the server's call for the answer's proposed action stands, as the stored answer has it.
 * Undefined when the server makes none, or when the answer offers several versions: the user then
 * picks one with its own button.
 */
export function wordChainedProposalState(
  content: readonly ContentPart[] | undefined,
  action: WordClientAction,
): WordChainedApplyState | undefined {
  const proposal = (content ?? []).find(
    (part) =>
      part.content_type === "tool_use" &&
      part.tool_name === CLIENT_ACTION_TOOL_NAME &&
      typeof part.input === "object" &&
      part.input !== null &&
      (part.input as Record<string, unknown>).action === action,
  );
  const applyCallId =
    proposal?.content_type === "tool_use"
      ? wordChainedApplyCallId(content, proposal.tool_call_id)
      : undefined;
  if (!applyCallId) return undefined;
  const language = WORD_CLIENT_ACTIONS.get(action)?.fenceLanguage;
  const versions = answerFences(content).filter(
    (fence) => fence.language === language,
  ).length;
  if (versions > 1) return undefined;
  const state = wordChainedApplyState(content, applyCallId);
  return state.kind === "done" && state.result.reason === USER_PICKS
    ? undefined
    : state;
}

/** {@link wordChainedProposalState} for a card in the answer, read as one string. */
export function useWordChainedProposal(
  messageId: string | undefined,
  action: WordClientAction,
): WordChainedApplyState | undefined {
  const selected = useConversationSelector((messages) => {
    const state = wordChainedProposalState(
      messageId ? messages[messageId]?.content : undefined,
      action,
    );
    return state ? JSON.stringify(state) : "";
  }, Object.is);
  return useMemo(
    () =>
      selected ? (JSON.parse(selected) as WordChainedApplyState) : undefined,
    [selected],
  );
}

/** The pane's live copy with this token, redrawn when the answer's copy changes. */
export function useWordLiveCapture(
  token: string | undefined,
): WordDocumentCapture | undefined {
  const subscribe = useCallback(
    (listener: () => void) => wordDocumentReadSession.subscribe(listener),
    [],
  );
  const read = useCallback(
    () => wordDocumentReadSession.liveCapture(token),
    [token],
  );
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The copy a plan card reviews: the message's own when the plan was made on it, else a later copy
 * of the same answer that a step after an applied change read, else the one its review kept.
 */
export function useWordPlanCapture(
  messageCapture: WordDocumentCapture | undefined,
  token: string | undefined,
  reviewCapture: WordDocumentCapture | undefined,
): WordDocumentCapture | undefined {
  const live = useWordLiveCapture(token);
  if (messageCapture?.authoring && messageCapture.authoring.token === token)
    return messageCapture;
  return live ?? reviewCapture ?? messageCapture;
}
