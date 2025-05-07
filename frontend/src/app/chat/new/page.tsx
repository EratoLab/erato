"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { useChatContext } from "@/providers/ChatProvider";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "NewChatPage");

export default function NewChatPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { isStreaming, currentChatId } = useChatContext();
  const setNewChatPending = useChatHistoryStore(
    (state) => state.setNewChatPending,
  );
  const redirectedRef = useRef(false);

  useEffect(() => {
    logger.log("NewChatPage mounted - resetting new chat pending flag");
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
      router.replace(`/chat/${currentChatId}`);
    }

    if (!currentChatId && pathname === "/chat/new") {
      redirectedRef.current = false; // Reset if we are back on new chat page and ID is null
    }
  }, [currentChatId, router, isStreaming, pathname]);

  return null; // The ChatLayout handles UI
}
