import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { createLogger } from "@/utils/debugLogger";

import { useFileUploadStore } from "../files";
import { useMessagingStore } from "./store/messagingStore";
import { useChatHistory } from "./useChatHistory";

const logger = createLogger("HOOK", "useExplicitNavigation");

export function useExplicitNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { navigateToChat } = useChatHistory();
  const setStoreSilentChatId = useFileUploadStore(
    (state) => state.setSilentChatId,
  );
  const setNewlyCreatedChatIdInStore = useMessagingStore(
    (state) => state.setNewlyCreatedChatIdInStore,
  );
  const setNavigationTransition = useMessagingStore(
    (state) => state.setNavigationTransition,
  );

  // Extract assistantId from URL if we're on an assistant page
  const currentAssistantId = useMemo(() => {
    const match = location.pathname.match(/^\/a\/([^/]+)(?:\/|$)/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const performNavigation = useCallback(
    (chatId: string, reason: string = "") => {
      logger.log(
        `Performing explicit navigation to chat: ${chatId}. Reason: ${reason}`,
      );

      // Set transition flag to preserve optimistic state during navigation
      logger.log(
        `Setting navigation transition flag to preserve state during navigation`,
      );
      setNavigationTransition(true);

      // Clean up states before navigation
      setStoreSilentChatId(null);
      setNewlyCreatedChatIdInStore(null);

      // Perform navigation
      navigateToChat(chatId);

      // Clear transition flag after a brief delay to allow navigation to complete
      setTimeout(() => {
        logger.log(`Clearing navigation transition flag after navigation`);
        setNavigationTransition(false);
      }, 100);
    },
    [
      navigateToChat,
      setStoreSilentChatId,
      setNewlyCreatedChatIdInStore,
      setNavigationTransition,
    ],
  );

  const shouldNavigateFromNewChat = useCallback(
    (chatId: string) => {
      return location.pathname === "/chat/new" && chatId;
    },
    [location.pathname],
  );

  const shouldNavigateFromAssistant = useCallback(
    (chatId: string) => {
      // Check if we're on an assistant page without a chatId in the URL
      return (
        currentAssistantId !== null &&
        location.pathname === `/a/${currentAssistantId}` &&
        chatId
      );
    },
    [location.pathname, currentAssistantId],
  );

  const navigateToAssistantChat = useCallback(
    (assistantId: string, chatId: string, reason: string = "") => {
      logger.log(
        `Navigating to assistant chat: /a/${assistantId}/${chatId}. Reason: ${reason}`,
      );

      // Set transition flag
      setNavigationTransition(true);

      // Clean up states
      setStoreSilentChatId(null);
      setNewlyCreatedChatIdInStore(null);

      // Navigate to assistant chat URL directly
      navigate(`/a/${assistantId}/${chatId}`, { replace: false });

      // Clear transition flag
      setTimeout(() => {
        setNavigationTransition(false);
      }, 100);
    },
    [
      navigate,
      setStoreSilentChatId,
      setNewlyCreatedChatIdInStore,
      setNavigationTransition,
    ],
  );

  return {
    performNavigation,
    shouldNavigateFromNewChat,
    shouldNavigateFromAssistant,
    navigateToAssistantChat,
    currentAssistantId,
  };
}
