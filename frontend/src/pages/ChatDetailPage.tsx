import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { useChatContext } from "@/providers/ChatProvider";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "ChatDetailPage(ID)");

export default function ChatDetailPage() {
  const params = useParams<{ id: string }>(); // Get id from route parameters
  const chatIdFromUrl = params.id;

  const { currentChatId } = useChatContext();
  const { setCurrentChatId } = useChatHistoryStore();

  // When URL changes, sync the context state without triggering another navigation
  useEffect(() => {
    if (chatIdFromUrl && chatIdFromUrl !== currentChatId) {
      logger.log(
        `ChatDetailPage [id]: URL chatId (${chatIdFromUrl}) differs from context (${currentChatId ?? "null"}). Syncing context state only.`,
      );
      // Just sync the state, don't navigate again since we're already here
      setCurrentChatId(chatIdFromUrl);
    }
    // currentChatId excluded on purpose, as we don't want to use it as trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatIdFromUrl, setCurrentChatId]);

  return null; // The ChatLayout handles UI
}
