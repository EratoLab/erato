import { useCallback } from "react";
import { useLocation } from "react-router-dom";

import { useMessagingStore } from "./store/messagingStore";
import { useChatHistory } from "./useChatHistory";
import { useFileUploadStore } from "../files";

export function useExplicitNavigation() {
  const location = useLocation();
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

  const performNavigation = useCallback(
    (chatId: string, reason: string = "") => {
      console.log(
        `[EXPLICIT_NAV] Performing explicit navigation to chat: ${chatId}. Reason: ${reason}`,
      );

      // Set transition flag to preserve optimistic state during navigation
      console.log(
        `[EXPLICIT_NAV] Setting navigation transition flag to preserve state during navigation`,
      );
      setNavigationTransition(true);

      // Clean up states before navigation
      setStoreSilentChatId(null);
      setNewlyCreatedChatIdInStore(null);

      // Perform navigation
      navigateToChat(chatId);

      // Clear transition flag after a brief delay to allow navigation to complete
      setTimeout(() => {
        console.log(
          `[EXPLICIT_NAV] Clearing navigation transition flag after navigation`,
        );
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

  return {
    performNavigation,
    shouldNavigateFromNewChat,
  };
}
