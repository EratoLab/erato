"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";

import {
  ChatHistoryProvider,
  useChatHistory,
} from "../components/containers/ChatHistoryProvider";
import { ChatProvider } from "../components/containers/ChatProvider";
import { MessageStreamProvider } from "../components/containers/MessageStreamProvider";
import { ProfileProvider } from "../components/containers/ProfileProvider";

import type { FileType } from "@/utils/fileTypes";

// Dynamically import Chat with ssr disabled
const Chat = dynamic(
  () => import("../components/ui/Chat").then((mod) => mod.Chat),
  {
    ssr: false,
  },
);

const queryClient = new QueryClient();

// Create a custom hook to handle URL-based chat navigation
const useChatNavigation = () => {
  const { createSession, currentSessionId, switchSession } = useChatHistory();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Track if a programmatic URL change is happening
  const isNavigating = useRef(false);
  // Keep track of the last selected chatId to prevent loops
  const lastSelectedChatId = useRef<string | null>(null);

  // Enhanced switchSession that also updates URL
  const switchSessionWithUrl = useCallback(
    (chatId: string) => {
      // Don't do anything if we're already on this chat or navigating
      if (chatId === currentSessionId || isNavigating.current) return;

      // Set navigating flag first
      isNavigating.current = true;
      lastSelectedChatId.current = chatId;

      // First update the URL with a slight delay to ensure consistent behavior
      setTimeout(() => {
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.set("chatId", chatId);
        router.replace(`${pathname}?${newParams.toString()}`);

        // Then switch the session
        switchSession(chatId);

        // Reset flag after all operations complete
        setTimeout(() => {
          isNavigating.current = false;
        }, 200);
      }, 10);
    },
    [currentSessionId, router, pathname, searchParams, switchSession],
  );

  // Handle initial load and URL changes
  useEffect(() => {
    // Skip if we're in the middle of a programmatic navigation
    if (isNavigating.current) return;

    const chatId = searchParams.get("chatId");

    // Only process if there's a chatId in the URL
    if (chatId) {
      // Only switch if it's actually different from current and last selected
      if (
        chatId !== currentSessionId &&
        chatId !== lastSelectedChatId.current
      ) {
        // Update the last selected to prevent loops
        lastSelectedChatId.current = chatId;
        switchSession(chatId);
      }
    } else if (!currentSessionId) {
      // No chat ID in URL and no current session, create a new one
      const newId = createSession();
      lastSelectedChatId.current = newId;

      // Update URL without triggering the searchParams effect
      isNavigating.current = true;
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set("chatId", newId);
      router.replace(`${pathname}?${newParams.toString()}`);

      // Reset flag after navigation completes
      setTimeout(() => {
        isNavigating.current = false;
      }, 200);
    }
  }, [
    searchParams,
    pathname,
    router,
    currentSessionId,
    switchSession,
    createSession,
  ]);

  // Create a new chat with updated URL
  const createNewChat = useCallback(() => {
    // Skip if we're already navigating
    if (isNavigating.current) return "";

    const newId = createSession();
    lastSelectedChatId.current = newId;

    isNavigating.current = true;
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set("chatId", newId);
    router.replace(`${pathname}?${newParams.toString()}`);

    setTimeout(() => {
      isNavigating.current = false;
    }, 200);

    return newId;
  }, [createSession, pathname, router, searchParams]);

  return {
    switchSessionWithUrl,
    createNewChat,
  };
};

// Inner component to access hooks within providers
const ChatContainer = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { switchSessionWithUrl, createNewChat } = useChatNavigation();

  const handleToggleCollapse = () => {
    setSidebarCollapsed((prev) => !prev);
  };

  const handleNewChat = useCallback(() => {
    createNewChat();
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
        // Pass our enhanced session switching function that handles URL updates
        customSessionSelect={switchSessionWithUrl}
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
