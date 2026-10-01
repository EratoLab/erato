import { useMemo } from "react";

import { useConversationMessage } from "@/components/ui/Message/ConversationMessages";
import { componentRegistry } from "@/config/componentRegistry";
import {
  WORD_ACTION_FACET_IDS,
  WORD_READ_TOOL,
  WORD_SUBMIT_PLAN_TOOL,
} from "@/lib/wordReview/wordHistoryNames";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { HostArtifact, Message } from "@/types/chat";

export interface WordHistoryMessage {
  /** The request the answer was written for; its facet args hold the document context. */
  previousUserMessage: Message;
  documentName?: string;
}

/**
 * The Word request an assistant message answered, when the message is shown
 * outside the Word host. A host that renders card fences itself (the Word
 * add-in) owns these messages, stamped or not, so it sees none.
 */
export function useWordHistoryMessage(
  messageId: string | undefined,
  hostArtifact: HostArtifact | undefined,
): WordHistoryMessage | null {
  const message = useConversationMessage(messageId);
  const previous = useConversationMessage(message?.previous_message_id);
  const request =
    !hostArtifact &&
    !componentRegistry.HostCardCodeBlock &&
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
