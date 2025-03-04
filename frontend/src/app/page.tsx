"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { ChatProvider } from "../components/containers/ChatProvider";
import { ChatHistoryProvider } from "../components/containers/ChatHistoryProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageStreamProvider } from "../components/containers/MessageStreamProvider";
import { ProfileProvider } from "@/components/containers/ProfileProvider";
import { useChatHistory } from "@/components/containers/ChatHistoryProvider";

// Dynamically import Chat with ssr disabled
const Chat = dynamic(
  () => import("../components/ui/Chat").then((mod) => mod.Chat),
  {
    ssr: false,
  },
);

const queryClient = new QueryClient();

// Inner component to access hooks within providers
const ChatContainer = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { createSession, currentSessionId } = useChatHistory();

  // Create a new chat session when no session exists
  useEffect(() => {
    if (!currentSessionId) {
      createSession();
    }
  }, [currentSessionId, createSession]);

  const handleToggleCollapse = () => {
    setSidebarCollapsed((prev) => !prev);
  };

  const handleNewChat = useCallback(() => {
    // Create a new chat session
    createSession();
  }, [createSession]);

  return (
    <ChatProvider>
      <Chat
        layout="default"
        showAvatars={true}
        showTimestamps={true}
        onMessageAction={(action) => console.log("Message action:", action)}
        controlsContext={{
          currentUserId: "user_1",
          dialogOwnerId: "user_1",
          isSharedDialog: false,
        }}
        onNewChat={handleNewChat}
        onRegenerate={() => console.log("Regenerate")}
        sidebarCollapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
      />
    </ChatProvider>
  );
};

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen min-h-screen bg-theme-bg-primary">
        <ProfileProvider>
          <ChatHistoryProvider>
            <MessageStreamProvider>
              <ChatContainer />
            </MessageStreamProvider>
          </ChatHistoryProvider>
        </ProfileProvider>
      </div>
    </QueryClientProvider>
  );
}
