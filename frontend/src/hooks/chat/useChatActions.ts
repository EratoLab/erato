import { useCallback } from "react";

import type { MessageAction } from "@/types/message-controls";

interface UseChatActionsProps {
  switchSession: (sessionId: string) => void;
  sendMessage: (content: string) => Promise<string | undefined>;
  onMessageAction?: (action: MessageAction) => void | Promise<void>;
}

export function useChatActions({
  switchSession,
  sendMessage,
  onMessageAction,
}: UseChatActionsProps) {
  const handleSessionSelect = useCallback(
    (sessionId: string, customHandler?: (sessionId: string) => void) => {
      console.log(`[CHAT_FLOW] Session select: ${sessionId}`);

      // Don't try to navigate to null or empty strings
      if (!sessionId || sessionId === "null") {
        console.warn(
          "[CHAT_FLOW] Attempted to select a session with invalid ID:",
          sessionId,
        );
        return;
      }

      if (customHandler) {
        // Use custom handler if provided
        console.log("[CHAT_FLOW] Using custom session select handler");
        customHandler(sessionId);
      } else {
        // Otherwise use the default behavior
        console.log(
          "[CHAT_FLOW] Using default session select handler to switch session",
        );
        // Explicitly call switchSession to navigate to the selected chat
        switchSession(sessionId);
      }
    },
    [switchSession],
  );

  const handleSendMessage = useCallback(
    (message: string) => {
      if (message.trim()) {
        return sendMessage(message);
      }
      return Promise.resolve(undefined);
    },
    [sendMessage],
  );

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
