import { useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";

import { Chat } from "@/components/ui/Chat/Chat";
import { WelcomeScreen } from "@/components/ui/WelcomeScreen";
import { useChatContext } from "@/providers/ChatProvider";
import { createLogger } from "@/utils/debugLogger";

import type { MessageAction } from "@/types/message-controls";

const logger = createLogger("UI", "ChatPageStructure");

// This component contains the actual UI and logic that uses chat context
export default function ChatPageStructure({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    messages: contextMessages,
    messageOrder: contextMessageOrder,
    currentChatId,
    mountKey,
  } = useChatContext();
  const location = useLocation();
  const pathname = location.pathname;
  const prevChatIdRef = useRef<string | null | undefined>(currentChatId);

  useEffect(() => {
    if (prevChatIdRef.current !== currentChatId) {
      logger.log(
        `ChatPageStructure: currentChatId changed from ${prevChatIdRef.current ?? "null"} to ${currentChatId ?? "null"}.`,
      );
      prevChatIdRef.current = currentChatId;
    }
  }, [currentChatId]);

  const displayMessages = contextMessages;
  const displayMessageOrder = contextMessageOrder;

  logger.log(
    `ChatPageStructure render. Path: ${pathname}, currentChatId: ${currentChatId ?? "null"}`,
  );

  return (
    <div className="flex size-full flex-col">
      <Chat
        key={mountKey}
        messages={displayMessages}
        messageOrder={displayMessageOrder}
        controlsContext={{
          currentUserId: "user1",
          dialogOwnerId: "user1",
          isSharedDialog: false,
        }}
        className="h-full"
        showAvatars={true}
        showTimestamps={true}
        layout="default"
        maxWidth={768}
        emptyStateComponent={<WelcomeScreen />}
        onMessageAction={async (action: MessageAction) => {
          logger.log("Handling message action in ChatPageStructure:", action);
          if (action.type === "copy") {
            const messageToCopy = displayMessages[action.messageId];
            if (messageToCopy.content) {
              try {
                await navigator.clipboard.writeText(messageToCopy.content);
                if (typeof navigator.vibrate === "function") {
                  navigator.vibrate(50);
                }
                return true;
              } catch (err) {
                console.error("Failed to copy message content:", err);
                return false;
              }
            } else {
              console.warn(
                "Could not find message content to copy for id:",
                action.messageId,
              );
              return false;
            }
          }
          logger.log(`Unhandled message action type: ${action.type}`);
          return false;
        }}
      />
      {/* Page specific content (new/page.tsx or [id]/page.tsx) will be minimal and rendered invisibly if not needed */}
      <div style={{ display: "none" }}>{children}</div>
    </div>
  );
}
