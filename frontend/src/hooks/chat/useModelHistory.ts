/**
 * Custom hook for chat model history
 *
 * Provides historical model information for displaying what models were used in past chats.
 * This is a read-only hook focused on historical context, not interactive selection.
 */
import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  useAvailableModels,
  useChatDetail,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface UseModelHistoryParams {
  currentChatId: string | null;
  /** @deprecated Active-chat settings are loaded independently of sidebar pages. */
  chats?: RecentChat[];
  /** @deprecated Active-chat settings are loaded independently of sidebar pages. */
  pinnedChats?: RecentChat[];
}

export function useModelHistory({ currentChatId }: UseModelHistoryParams) {
  // Fetch available models to validate historical models still exist
  const { data: availableModels = [] } = useAvailableModels({});

  const { data: currentChat } = useChatDetail(
    currentChatId ? { pathParams: { chatId: currentChatId } } : skipToken,
  );

  const currentChatLastModel = useMemo(
    () =>
      currentChatId
        ? (availableModels.find(
            (model) =>
              model.chat_provider_id === currentChat?.last_chat_provider_id,
          ) ?? null)
        : null,
    [currentChatId, currentChat, availableModels],
  );

  return {
    // Historical model information
    currentChatLastModel,
  };
}
