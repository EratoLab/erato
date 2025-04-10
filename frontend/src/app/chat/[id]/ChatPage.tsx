"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Chat } from "@/components/ui/Chat/Chat";
import { useChatContext } from "@/providers/ChatProvider";

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
      console.log(
        `[CHAT_FLOW] ChatPage initial load: setting currentChatId to URL param (${chatId})`,
      );

      // Set transitioning state to true during navigation
      setIsTransitioning(true);
      navigateToChat(chatId);

      // After a brief delay to allow content to load, set transitioning to false
      const timer = setTimeout(() => {
        setIsTransitioning(false);
        isFirstRender.current = false;
      }, 150);

      return () => clearTimeout(timer);
    } else if (isFirstRender.current) {
      // If we don't need to navigate but it's still first render,
      // just mark as not transitioning after a brief delay
      const timer = setTimeout(() => {
        setIsTransitioning(false);
        isFirstRender.current = false;
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [chatId, currentChatId, navigateToChat]);

  return (
    <div className="flex size-full flex-col">
      {/* <div className="flex h-12 items-center border-b px-4">
        <button
          onClick={toggleSidebar}
          className="mr-4 p-2"
          aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          {isSidebarOpen ? "✕" : "☰"}
        </button>
        <h1 className="text-lg font-semibold">Chat</h1>
        {isStreaming && (
          <button
            onClick={cancelMessage}
            className="ml-auto rounded bg-red-500 px-3 py-1 text-white"
          >
            Stop generating
          </button>
        )}
      </div> */}

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
          console.log("Message action:", action);
        }}
      />
    </div>
  );
}
