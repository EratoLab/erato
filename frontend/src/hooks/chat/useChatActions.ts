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
      if (customHandler) {
        customHandler(sessionId);
      } else {
        switchSession(sessionId);
      }
    },
    [switchSession],
  );

  const handleSendMessage = useCallback(
    (message: string) => {
      if (message.trim()) {
        void sendMessage(message);
      }
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
