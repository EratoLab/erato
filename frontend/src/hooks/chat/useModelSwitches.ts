/**
 * Custom hook for historical model switches
 *
 * Resolves the transcript's model transitions to display names, so every chat
 * surface derives them the same way instead of each host re-deriving its own.
 */
import { useMemo } from "react";

import { getModelSwitches } from "@/utils/chat/modelSwitches";

import type { ChatModel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type { ModelSwitch } from "@/utils/chat/modelSwitches";

export function useModelSwitches(
  messages: Record<string, Message>,
  messageOrder: readonly string[],
  availableModels: readonly ChatModel[],
): Record<string, ModelSwitch> {
  return useMemo(() => {
    const modelNames = new Map(
      availableModels.map((model) => [
        model.chat_provider_id,
        model.model_display_name,
      ]),
    );
    return getModelSwitches(messages, messageOrder, modelNames);
  }, [availableModels, messageOrder, messages]);
}
