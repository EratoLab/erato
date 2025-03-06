"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";

import {
  useChatHistory,
  ChatHistoryProvider,
} from "@/components/containers/ChatHistoryProvider";
import { ProfileProvider } from "@/components/containers/ProfileProvider";

import { ChatProvider } from "../components/containers/ChatProvider";
import { MessageStreamProvider } from "../components/containers/MessageStreamProvider";

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

  // Define which file types are accepted in this chat
  const acceptedFileTypes: FileType[] = ["pdf", "image", "document", "text"];

  const handleAddFiles = useCallback((files: File[]) => {
    // Process the selected files
    console.log(
      "Files selected:",
      files.map((f) => f.name),
    );

    // TODO: Implement file upload to backend server
    // Example implementation:
    // 1. Create FormData object
    // const formData = new FormData();
    // files.forEach(file => {
    //   formData.append('files', file);
    // });
    // formData.append('sessionId', currentSessionId || '');
    //
    // 2. Send to backend
    // fetch('/api/upload', {
    //   method: 'POST',
    //   body: formData
    // }).then(response => response.json())
    //   .then(data => {
    //     console.log('Files uploaded:', data);
    //     // Update UI with file references or trigger a message with attachments
    //   })
    //   .catch(error => {
    //     console.error('Error uploading files:', error);
    //     // Handle error state
    //   });
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
