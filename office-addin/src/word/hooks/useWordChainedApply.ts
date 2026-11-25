import { useCallback, useSyncExternalStore } from "react";

import {
  chainedCallId,
  chainedCallState,
  chainedProposalState,
  useChainedState,
} from "../../core/clientActions/chainedCall";
import { answerFences } from "../../core/clientActions/proposalApply";
import { WORD_CLIENT_ACTIONS } from "../utils/wordClientActions";
import { wordDocumentReadSession } from "../utils/wordDocumentReadTool";

import type { WordApplyCallResult } from "../utils/wordApplyCall";
import type { WordChainedApplyState } from "../utils/wordChainedApply";
import type { WordClientAction } from "../utils/wordClientActions";
import type { ContentPart } from "@erato/frontend/library";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

/**
 * Where the server's apply of this card's submission stands, or undefined when the server applies
 * none (today's card, which applies itself).
 */
export function useWordChainedApply(
  messageId: string | undefined,
  submissionCallId: string | undefined,
): WordChainedApplyState | undefined {
  return useChainedState<WordApplyCallResult>(messageId, (content) => {
    const applyCallId = chainedCallId(content, submissionCallId);
    return applyCallId ? chainedCallState(content, applyCallId) : undefined;
  });
}

/**
 * Where the server's call for the answer's proposed action stands. Undefined when the server
 * makes none, or when the answer offers several versions: the user then picks one with its own
 * button.
 */
export function wordChainedProposalState(
  content: readonly ContentPart[] | undefined,
  action: WordClientAction,
): WordChainedApplyState | undefined {
  const language = WORD_CLIENT_ACTIONS.get(action)?.fenceLanguage;
  return chainedProposalState<WordApplyCallResult>(
    content,
    [action],
    (answer) =>
      answerFences(answer).filter((fence) => fence.language === language)
        .length > 1,
  );
}

/** {@link wordChainedProposalState} for a card in the answer. */
export function useWordChainedProposal(
  messageId: string | undefined,
  action: WordClientAction,
): WordChainedApplyState | undefined {
  return useChainedState<WordApplyCallResult>(messageId, (content) =>
    wordChainedProposalState(content, action),
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
