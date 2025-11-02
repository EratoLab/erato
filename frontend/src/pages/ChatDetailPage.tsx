import { createLogger } from "@/utils/debugLogger";

const logger = createLogger("UI", "ChatDetailPage(ID)");

export default function ChatDetailPage() {
  // No sync logic needed - currentChatId is automatically derived from URL in useChatHistory
  logger.log(`ChatDetailPage mounted (currentChatId auto-derived from URL)`);

  return null; // The ChatLayout handles UI
}
