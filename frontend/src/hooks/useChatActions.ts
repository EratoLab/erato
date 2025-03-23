import { useCallback } from "react";

import type { MessageAction } from "@/types/message-controls";

/**
 * Hook for managing chat actions like session selection and message sending
 */
export function useChatActions(
  switchSession: (sessionId: string) => void,
  sendMessage: (message: string) => Promise<void>,
  onMessageAction?: (action: MessageAction) => Promise<void> | void,
) {
  /**
   * Handle session selection with optional custom behavior
   */
  const handleSessionSelect = useCallback(
    (sessionId: string, customHandler?: (sessionId: string) => void) => {
      if (customHandler) {
        customHandler(sessionId);
      } else {
        switchSession(sessionId);
      }
    },
    [switchSession],
  );

  /**
   * Wrap the sendMessage to make it synchronous for form handlers
   */
  const handleSendMessage = useCallback(
    (message: string) => {
      void sendMessage(message);
    },
    [sendMessage],
  );

  /**
   * Process message actions with proper promise handling
   */
  const handleMessageAction = useCallback(
    async (action: MessageAction) => {
      if (onMessageAction) {
        await onMessageAction(action);
      }
    },
    [onMessageAction],
  );

  return {
    handleSessionSelect,
    handleSendMessage,
    handleMessageAction,
  };
}
