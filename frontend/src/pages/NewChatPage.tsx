import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";

import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { useChatContext } from "@/providers/ChatProvider";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "NewChatPage");

export default function NewChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;

  const { isStreaming, currentChatId } = useChatContext();
  const setNewChatPending = useChatHistoryStore(
    (state) => state.setNewChatPending,
  );
  const redirectedRef = useRef(false);

  useEffect(() => {
    logger.log(
      "[DEBUG_REDIRECT] NewChatPage mounted - resetting new chat pending flag to false",
    );
    setNewChatPending(false);
  }, [setNewChatPending]);

  useEffect(() => {
    if (
      currentChatId &&
      !isStreaming &&
      !redirectedRef.current &&
      pathname === "/chat/new"
    ) {
      logger.log(
        `NewChatPage - currentChatId is now ${currentChatId}. Updating URL from /chat/new.`,
      );
      redirectedRef.current = true;
      navigate(`/chat/${currentChatId}`, { replace: true });
    }

    if (!currentChatId && pathname === "/chat/new") {
      redirectedRef.current = false; // Reset if we are back on new chat page and ID is null
    }
  }, [currentChatId, navigate, isStreaming, pathname]);

  return null; // The ChatLayout (to be created) handles UI
} 