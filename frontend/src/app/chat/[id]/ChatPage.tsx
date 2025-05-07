"use client";

import { useDynamicParams } from "next-static-utils";
import { useEffect } from "react";

import { useChatContext } from "@/providers/ChatProvider";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "ChatPage(ID)");

export default function ChatPage() {
  const params = useDynamicParams();
  const chatIdFromUrl = params.id;

  const { currentChatId, navigateToChat } = useChatContext();

  // When navigation was changed via the URL (e.g. router push) navigate to the chat.
  useEffect(() => {
    if (chatIdFromUrl && chatIdFromUrl !== currentChatId) {
      logger.log(
        `ChatPage [id]: URL chatId (${chatIdFromUrl}) differs from context (${currentChatId ?? "null"}). Syncing context.`,
      );
      // Navigate to the chatId that was newly set in state
      navigateToChat(chatIdFromUrl);
    }
    // currentChatId excluded on purpose, as we don't want to use it as trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatIdFromUrl, navigateToChat]);

  return null; // The ChatLayout handles UI
}
