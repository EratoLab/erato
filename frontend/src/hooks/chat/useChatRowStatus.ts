import { resolveSessionRowStatus } from "@/utils/chatHistoryGrouping";

import { useHasPendingConfirmation } from "./store/confirmationRegistryStore";
import { useGenerationStatusFor } from "./store/generationStatusStore";

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
  const hasPendingConfirmation = useHasPendingConfirmation(chatId);
  return resolveSessionRowStatus(
    provenance,
    storeStatus,
    hasPendingConfirmation,
  );
};
