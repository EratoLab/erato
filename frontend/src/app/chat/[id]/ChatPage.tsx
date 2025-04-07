"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";

import { ChatWidget } from "@/components/ui/Chat/ChatWidget";
import { useSidebar } from "@/hooks/ui/useSidebar";
import { useChatContext } from "@/providers/ChatProvider";

export default function ChatPage() {
  const params = useParams();
  const chatId = params.id as string;

  // Use our chat context
  const {
    messages,
    isStreaming,
    isMessagingLoading,
    sendMessage,
    cancelMessage,
    currentChatId,
    navigateToChat,
  } = useChatContext();

  // Use our sidebar hook
  const { isOpen: isSidebarOpen, toggle: toggleSidebar } = useSidebar();

  // Set the current chat ID when the page loads
  useEffect(() => {
    if (chatId && chatId !== currentChatId) {
      navigateToChat(chatId);
    }
  }, [chatId, currentChatId, navigateToChat]);

  // Handle sending a message
  const handleSendMessage = (content: string) => {
    void sendMessage(content);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center border-b px-4">
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
      </div>

      <div className="flex-1">
        <ChatWidget
          messages={messages}
          onSendMessage={handleSendMessage}
          controlsContext={{
            currentUserId: "user1",
            dialogOwnerId: "user1",
            isSharedDialog: false,
          }}
          className="h-full"
          isLoading={isMessagingLoading || isStreaming}
        />
      </div>
    </div>
  );
}
