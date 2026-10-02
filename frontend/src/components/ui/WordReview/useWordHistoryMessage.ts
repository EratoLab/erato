import { useMemo } from "react";

import {
  useConversationMessage,
  useConversationSelector,
} from "@/components/ui/Message/ConversationMessages";
import {
  WORD_ACTION_FACET_IDS,
  WORD_READ_TOOL,
  WORD_SUBMIT_PLAN_TOOL,
} from "@/lib/wordReview/wordHistoryNames";
import { wordMessageLineage } from "@/lib/wordReview/wordHistoryParts";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { HostArtifact, Message } from "@/types/chat";

export interface WordHistoryMessage {
  /** The request the answer was written for; its facet args hold the document context. */
  previousUserMessage: Message;
  documentName?: string;
}

let wordLiveCards = false;

/**
 * Declares that this host renders Word answers with live cards of its own
 * (the Word add-in). Every other host shows them read-only.
 */
export function setWordLiveCards(enabled: boolean): void {
  wordLiveCards = enabled;
}

/**
 * The Word request an assistant message answered, when the message is shown
 * outside the Word host. The Word add-in owns these messages, stamped or not,
 * so it sees none.
 */
export function useWordHistoryMessage(
  messageId: string | undefined,
  hostArtifact: HostArtifact | undefined,
): WordHistoryMessage | null {
  const message = useConversationMessage(messageId);
  const previous = useConversationMessage(message?.previous_message_id);
  const request =
    !hostArtifact &&
    !wordLiveCards &&
    message?.role === "assistant" &&
    previous?.action_facet_id &&
    WORD_ACTION_FACET_IDS.has(previous.action_facet_id)
      ? previous
      : undefined;
  return useMemo(() => {
    if (!request) return null;
    const documentName = request.action_facet_args?.document_name;
    return {
      previousUserMessage: request,
      ...(documentName ? { documentName } : {}),
    };
  }, [request]);
}

export const isWordPlanToolPart = (part: ContentPart): boolean =>
  part.content_type === "tool_use" &&
  (part.tool_name === WORD_READ_TOOL ||
    part.tool_name === WORD_SUBMIT_PLAN_TOOL);

export const isWordSubmitPlanPart = (part: ContentPart): boolean =>
  part.content_type === "tool_use" && part.tool_name === WORD_SUBMIT_PLAN_TOOL;

const sameMessages = (a: readonly Message[], b: readonly Message[]) =>
  a.length === b.length && a.every((message, i) => message === b[i]);

/**
 * A message and the ones before it on its branch, oldest first. Re-renders
 * only when one of those messages changes, not on tokens streamed elsewhere.
 */
export function useWordMessageLineage(
  messageId: string | undefined,
): readonly Message[] {
  return useConversationSelector(
    (messages) => wordMessageLineage(messages, messageId),
    sameMessages,
  );
}
