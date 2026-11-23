import { useConversationSelector } from "@erato/frontend/library";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  wordChainedApplyCallId,
  wordChainedApplyState,
} from "../utils/wordChainedApply";
import { wordDocumentReadSession } from "../utils/wordDocumentReadTool";

import type { WordChainedApplyState } from "../utils/wordChainedApply";
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
