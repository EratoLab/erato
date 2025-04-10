"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Chat } from "@/components/ui/Chat/Chat";
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
  const {
    // Remove unused variables - Chat component gets them from context
    currentChatId,
    navigateToChat,
  } = useChatContext();

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

  return (
    <div className="flex size-full flex-col">
      <Chat
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
        isTransitioning={isTransitioning}
        onMessageAction={async (action) => {
          // Handle message actions here
          logger.log("Message action", action);
        }}
      />
    </div>
  );
}
