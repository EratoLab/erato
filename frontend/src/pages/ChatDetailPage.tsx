import { useParams } from "react-router-dom";
import { useEffect } from "react";

import { useChatContext } from "@/providers/ChatProvider";
import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "ChatDetailPage(ID)");

export default function ChatDetailPage() {
  const params = useParams<{ id: string }>(); // Get id from route parameters
  const chatIdFromUrl = params.id;

  const { currentChatId, navigateToChat } = useChatContext();

  // When navigation was changed via the URL (e.g. router push) navigate to the chat.
  useEffect(() => {
    if (chatIdFromUrl && chatIdFromUrl !== currentChatId) {
      logger.log(
        `ChatDetailPage [id]: URL chatId (${chatIdFromUrl}) differs from context (${currentChatId ?? "null"}). Syncing context.`,
      );
      // Navigate to the chatId that was newly set in state
      navigateToChat(chatIdFromUrl);
    }
    // currentChatId excluded on purpose, as we don't want to use it as trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatIdFromUrl, navigateToChat]);

  return null; // The ChatLayout (to be created) handles UI
} 