import { useCallback } from "react";

import { createLogger } from "@/utils/debugLogger";

import type { MessageAction } from "@/types/message-controls";

const logger = createLogger("HOOK", "useChatActions");

interface UseChatActionsProps {
  switchSession: (sessionId: string) => void;
  sendMessage: (
    content: string,
    inputFileIds?: string[],
    modelId?: string,
    assistantId?: string,
    selectedFacetIds?: string[],
  ) => Promise<string | undefined>;
  onMessageAction?: (action: MessageAction) => Promise<boolean>;
}

export function useChatActions({
  switchSession,
  sendMessage,
  onMessageAction,
}: UseChatActionsProps) {
  const handleSessionSelect = useCallback(
    (sessionId: string, customHandler?: (sessionId: string) => void) => {
      logger.log(`Session select: ${sessionId}`);

      // Don't try to navigate to null or empty strings
      if (!sessionId || sessionId === "null") {
        logger.warn(
          "Attempted to select a session with invalid ID:",
          sessionId,
        );
        return;
      }

      if (customHandler) {
        // Use custom handler if provided
        logger.log("Using custom session select handler");
        customHandler(sessionId);
      } else {
        // Otherwise use the default behavior
        logger.log("Using default session select handler to switch session");
        // Explicitly call switchSession to navigate to the selected chat
        switchSession(sessionId);
      }
    },
    [switchSession],
  );

  const handleSendMessage = useCallback(
    (
      message: string,
      inputFileIds?: string[],
      modelId?: string,
      assistantId?: string,
      selectedFacetIds?: string[],
    ) => {
      if (message.trim() || (inputFileIds && inputFileIds.length > 0)) {
        return sendMessage(
          message,
          inputFileIds,
          modelId,
          assistantId,
          selectedFacetIds,
        );
      }
      return Promise.resolve(undefined);
    },
    [sendMessage],
  );

  const handleMessageAction = useCallback(
    async (action: MessageAction) => {
      if (onMessageAction) {
        return await onMessageAction(action);
      }
      return false;
    },
    [onMessageAction],
  );

  return {
    handleSessionSelect,
    handleSendMessage,
    handleMessageAction,
  };
}
