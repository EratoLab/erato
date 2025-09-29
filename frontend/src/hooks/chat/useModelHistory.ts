/**
 * Custom hook for chat model history
 *
 * Provides historical model information for displaying what models were used in past chats.
 * This is a read-only hook focused on historical context, not interactive selection.
 */
import { useMemo } from "react";

import { useAvailableModels } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface UseModelHistoryParams {
  currentChatId: string | null;
  chats: RecentChat[];
}

export function useModelHistory({
  currentChatId,
  chats,
}: UseModelHistoryParams) {
  // Fetch available models to validate historical models still exist
  const { data: availableModels = [] } = useAvailableModels({});

  // Resolve current chat's last used model (historical context)
  const currentChatLastModel = useMemo(() => {
    if (!currentChatId || chats.length === 0) {
      return null;
    }

    const currentChat = chats.find((chat) => chat.id === currentChatId);
    const lastModel = currentChat?.last_model;

    // Validate the historical model still exists in available models
    if (lastModel && availableModels.length > 0) {
      const modelExists = availableModels.find(
        (model) => model.chat_provider_id === lastModel.chat_provider_id,
      );
      if (modelExists) {
        console.log("[MODEL_HISTORY] Found last used model for current chat:", {
          chatId: currentChatId,
          modelId: lastModel.chat_provider_id,
          modelName: lastModel.model_display_name,
        });
        return lastModel;
      } else {
        console.log("[MODEL_HISTORY] Last used model no longer available:", {
          chatId: currentChatId,
          unavailableModelId: lastModel.chat_provider_id,
          availableModels: availableModels.map((m) => m.chat_provider_id),
        });
      }
    }

    return null;
  }, [currentChatId, chats, availableModels]);

  return {
    // Historical model information
    currentChatLastModel,
  };
}
