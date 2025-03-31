"use client";

import { useEffect, useState } from "react";

import { ChatWidget } from "@/components/ui/Chat/ChatWidget";
import { useChatHistory } from "@/hooks/chat/useChatHistory";
import { useSidebar } from "@/hooks/ui/useSidebar";

import type { Message } from "@/types/chat";

export default function NewChatPage() {
  const { createNewChat } = useChatHistory();
  const { isOpen: isSidebarOpen, toggle: toggleSidebar } = useSidebar();

  // We use local state for messages since we don't have a chatId yet
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Create a new chat when the page loads
  useEffect(() => {
    async function initNewChat() {
      try {
        // This will navigate when the chat is created
        await createNewChat();
      } catch (error) {
        console.error("Failed to create new chat:", error);
      }
    }

    void initNewChat();
  }, [createNewChat]);

  // Handle sending a message
  // This is a simple implementation since we expect to be redirected
  // to a real chat page by the createNewChat effect
  const handleSendMessage = (content: string) => {
    setIsLoading(true);

    // Add user message
    const userMessage: Message = {
      id: `temp-user-${Date.now()}`,
      content,
      role: "user",
      createdAt: new Date().toISOString(),
      status: "sending",
    };

    setMessages((prev) => [...prev, userMessage]);

    // Simulate a response delay
    setTimeout(() => {
      // Add system message indicating redirect
      const systemMessage: Message = {
        id: `temp-system-${Date.now()}`,
        content: "Creating a new chat for you...",
        role: "system",
        createdAt: new Date().toISOString(),
        status: "complete",
      };

      setMessages((prev) => [...prev, systemMessage]);
      setIsLoading(false);

      // Redirect should happen via the createNewChat effect
    }, 1000);
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
        <h1 className="text-lg font-semibold">New Chat</h1>
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
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
