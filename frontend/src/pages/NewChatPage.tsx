import { t } from "@lingui/core/macro";
import { useEffect, useLayoutEffect } from "react";

import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "NewChatPage");

export default function NewChatPage() {
  const setNewChatPending = useChatHistoryStore(
    (state) => state.setNewChatPending,
  );

  const isNewChatPending = useChatHistoryStore(
    (state) => state.isNewChatPending,
  );

  // CRITICAL FIX: Use useLayoutEffect to reset flag synchronously before paint
  // This ensures the flag is reset even on same-route navigation (/chat/new → /chat/new)
  // where React Router doesn't remount the component
  // No dependency array - runs on every render to catch same-route navigations
  useLayoutEffect(() => {
    if (isNewChatPending) {
      logger.log(
        "[DEBUG_REDIRECT] NewChatPage: Resetting isNewChatPending flag to false",
      );
      setNewChatPending(false);
    }
  }); // Intentionally no deps - must run every render to catch flag changes

  useEffect(() => {
    const pageTitle = t({ id: "branding.page_title_suffix" });
    const pageTitlePart = t({
      id: "navigation.page.new_chat",
      message: "New chat",
    });
    document.title = `${pageTitlePart} - ${pageTitle}`;
  }, []);

  // Removed automatic navigation logic - now handled explicitly in message completion

  return null; // The ChatLayout (to be created) handles UI
}
