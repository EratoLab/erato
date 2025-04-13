"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Chat } from "@/components/ui/Chat/Chat";
import { useChatTransition } from "@/hooks/chat";
import { useChatContext } from "@/providers/ChatProvider";
import { createLogger } from "@/utils/debugLogger";

// Create logger for this component
const logger = createLogger("UI", "ChatPage");

export default function ChatPage() {
  const params = useParams();
  const chatId = params.id as string;
  const isFirstRender = useRef(true);
  const [isTransitioning, setIsTransitioning] = useState(true);

  // Use our chat context
  const { messages, messageOrder, currentChatId, navigateToChat } =
    useChatContext();

  // Handle only the initial setting of chat ID and page refreshes
  useEffect(() => {
    // Only on initial render or page refresh, sync with URL
    if (isFirstRender.current && chatId && chatId !== currentChatId) {
      logger.log(
        `Initial load: setting currentChatId to URL param (${chatId})`,
      );

      // Set transitioning state to true during navigation
      setIsTransitioning(true);

      // Start navigation
      navigateToChat(chatId);

      // After a brief delay to allow navigation to complete, set as not transitioning
      const timer = setTimeout(() => {
        setIsTransitioning(false);
        isFirstRender.current = false;
      }, 350);

      return () => clearTimeout(timer);
    } else if (isFirstRender.current) {
      // If we don't need to navigate but it's still first render,
      // just mark as not transitioning after a brief delay
      const timer = setTimeout(() => {
        setIsTransitioning(false);
        isFirstRender.current = false;
      }, 200);

      return () => clearTimeout(timer);
    }
  }, [chatId, currentChatId, navigateToChat]);

  // Use the chat transition hook here
  const { displayMessages, displayMessageOrder } = useChatTransition({
    messages,
    messageOrder,
    isTransitioning,
  });

  return (
    <div className="flex size-full flex-col">
      <Chat
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
        onMessageAction={async (action) => {
          logger.log("Handling message action:", action);
          if (action.type === "copy") {
            const messageToCopy = displayMessages[action.messageId];
            if (messageToCopy.content) {
              try {
                await navigator.clipboard.writeText(messageToCopy.content);
                logger.log("Message content copied to clipboard");
                console.log("Success: Copied to clipboard!"); // Temporary feedback

                // Add haptic feedback if supported
                if (typeof navigator.vibrate === "function") {
                  navigator.vibrate(50); // Vibrate for 50ms
                }

                // TODO: Add a user-facing notification (e.g., toast)
                return true; // Indicate success
              } catch (err) {
                console.error("Failed to copy message content:", err);
                // TODO: Add user-facing error feedback
                return false; // Indicate failure
              }
            } else {
              console.warn(
                "Could not find message content to copy for id:",
                action.messageId,
              );
              return false; // Indicate failure
            }
          } else {
            // Handle other actions (like, dislike, edit, etc.) if needed
            logger.log(`Unhandled message action type: ${action.type}`);
            return false; // Indicate failure for unhandled actions
          }
        }}
      />
    </div>
  );
}
