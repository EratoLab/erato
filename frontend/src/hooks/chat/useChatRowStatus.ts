import { resolveSessionRowStatus } from "@/utils/chatHistoryGrouping";

import { useGenerationStatusFor } from "./store/generationStatusStore";
import { useChatAsksForDecision } from "./useChatAsksForDecision";

import type {
  ChatAttentionStatus,
  SessionRowStatusInput,
} from "@/utils/chatHistoryGrouping";

/**
 * A listed row's attention status, however the row was fetched. Search passes
 * no provenance, so it takes the ordinary-chat branch — which is what it lists.
 */
export const useChatRowStatus = (
  chatId: string,
  provenance: SessionRowStatusInput = {},
): ChatAttentionStatus | null => {
  const storeStatus = useGenerationStatusFor(chatId);
  const asksForDecision = useChatAsksForDecision(chatId);
  return resolveSessionRowStatus(provenance, storeStatus, asksForDecision);
};
