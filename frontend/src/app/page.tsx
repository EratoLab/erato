"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState, useCallback, Suspense } from "react";

import {
  ChatHistoryProvider,
  useChatHistory,
} from "../components/containers/ChatHistoryProvider";
import { ChatProvider } from "../components/containers/ChatProvider";
import { MessageStreamProvider } from "../components/containers/MessageStreamProvider";
import { ProfileProvider } from "../components/containers/ProfileProvider";
import { useSidebar } from "../contexts/SidebarContext";
import { useChatNavigation } from "../hooks/useChatNavigation";

import type { FileType } from "@/utils/fileTypes";

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
  // Use sidebar context instead of local state
  const { collapsed: sidebarCollapsed, toggleCollapsed: handleToggleCollapse } =
    useSidebar();

  // Add local loading state to control UI transitions
  const [isTransitioning, setIsTransitioning] = useState(false);
  const { switchSessionWithUrl, createNewChat } = useChatNavigation();

  // Create an enhanced session switcher that manages loading states
  const handleSessionSelect = useCallback(
    (chatId: string) => {
      // Start transition
      setIsTransitioning(true);

      // Set a minimum transition time to prevent flickering for fast loads
      const minTransitionTimeout = setTimeout(() => {
        switchSessionWithUrl(chatId);

        // End transition with a slight delay to ensure smooth UI
        setTimeout(() => {
          setIsTransitioning(false);
        }, 100);
      }, 200);

      return () => {
        clearTimeout(minTransitionTimeout);
      };
    },
    [switchSessionWithUrl],
  );

  // Using the same pattern for new chat creation
  const handleNewChat = useCallback(() => {
    setIsTransitioning(true);

    const minTransitionTimeout = setTimeout(() => {
      createNewChat();

      setTimeout(() => {
        setIsTransitioning(false);
      }, 100);
    }, 200);

    return () => {
      clearTimeout(minTransitionTimeout);
    };
  }, [createNewChat]);

  // Define which file types are accepted in this chat
  const acceptedFileTypes: FileType[] = ["pdf", "image", "document"];

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
        acceptedFileTypes={acceptedFileTypes}
        customSessionSelect={handleSessionSelect}
        isTransitioning={isTransitioning}
      />
    </ChatProvider>
  );
};

// ChatBridge component connects the ChatHistoryProvider with MessageStreamProvider
const ChatBridge: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { confirmSession } = useChatHistory();

  return (
    <MessageStreamProvider onChatCreated={confirmSession}>
      {children}
    </MessageStreamProvider>
  );
};

// Add a loading fallback component
const LoadingFallback = () => (
  <div className="flex h-screen items-center justify-center">
    <div className="animate-pulse text-lg">Loading chat...</div>
  </div>
);

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen min-h-screen bg-theme-bg-primary">
        <ProfileProvider>
          <ChatHistoryProvider>
            <ChatBridge>
              <Suspense fallback={<LoadingFallback />}>
                <ChatContainer />
              </Suspense>
            </ChatBridge>
          </ChatHistoryProvider>
        </ProfileProvider>
      </div>
    </QueryClientProvider>
  );
}
