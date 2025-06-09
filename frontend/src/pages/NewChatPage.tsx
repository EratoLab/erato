import { useEffect } from "react";

import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "NewChatPage");

export default function NewChatPage() {
  const setNewChatPending = useChatHistoryStore(
    (state) => state.setNewChatPending,
  );

  useEffect(() => {
    logger.log(
      "[DEBUG_REDIRECT] NewChatPage mounted - resetting new chat pending flag to false",
    );
    setNewChatPending(false);
  }, [setNewChatPending]);

  // Removed automatic navigation logic - now handled explicitly in message completion

  return null; // The ChatLayout (to be created) handles UI
}
