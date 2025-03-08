"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState, useCallback } from "react";

import {
  ChatHistoryProvider,
  useChatHistory,
} from "../components/containers/ChatHistoryProvider";
import { ChatProvider } from "../components/containers/ChatProvider";
import { MessageStreamProvider } from "../components/containers/MessageStreamProvider";
import { ProfileProvider } from "../components/containers/ProfileProvider";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Add local loading state to control UI transitions
  const [isTransitioning, setIsTransitioning] = useState(false);
  const { switchSessionWithUrl, createNewChat } = useChatNavigation();

  const handleToggleCollapse = () => {
    setSidebarCollapsed((prev) => !prev);
  };

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
        }, 50);
      }, 50);

      // Cleanup timeout if component unmounts during transition
      return () => clearTimeout(minTransitionTimeout);
    },
    [switchSessionWithUrl],
  );

  const handleNewChat = useCallback(() => {
    // Start transition
    setIsTransitioning(true);

    // Create new chat with minimum transition time
    setTimeout(() => {
      createNewChat();

      // End transition with a slight delay
      setTimeout(() => {
        setIsTransitioning(false);
      }, 50);
    }, 50);
  }, [createNewChat]);

  // Define which file types are accepted in this chat
  const acceptedFileTypes: FileType[] = ["pdf", "image", "document", "text"];

  const handleAddFiles = useCallback((files: File[]) => {
    // Process the selected files
    console.log(
      "Files selected:",
      files.map((f) => f.name),
    );

    // TODO: Implement file upload to backend server
  }, []);

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
        onAddFile={handleAddFiles}
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

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen min-h-screen bg-theme-bg-primary">
        <ProfileProvider>
          <ChatHistoryProvider>
            <ChatBridge>
              <ChatContainer />
            </ChatBridge>
          </ChatHistoryProvider>
        </ProfileProvider>
      </div>
    </QueryClientProvider>
  );
}
