"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useChatHistory } from "../../../components/containers/ChatHistoryProvider";
import { ChatProvider } from "../../../components/containers/ChatProvider";
import { useSidebar } from "../../../contexts/SidebarContext";

import type { FileType } from "@/utils/fileTypes";

// Dynamically import Chat with ssr disabled
const Chat = dynamic(
  () => import("../../../components/ui/Chat").then((mod) => mod.Chat),
  {
    ssr: false,
  },
);

export default function NewChatPage() {
  const router = useRouter();
  const { collapsed: sidebarCollapsed, toggleCollapsed: handleToggleCollapse } =
    useSidebar();
  const { createSession } = useChatHistory();
  const isRedirecting = useRef(false);

  useEffect(() => {
    // Prevent redirect loops
    if (isRedirecting.current) {
      console.log("Already redirecting, skipping");
      return;
    }

    // Create a new session when the page loads
    const newSessionId = createSession();
    console.log("Created new session with ID:", newSessionId);

    // If we got a session ID, redirect to the chat page for that session
    if (newSessionId) {
      isRedirecting.current = true;
      console.log("Redirecting to:", `/chat/${newSessionId}`);
      router.replace(`/chat/${newSessionId}`);
    }

    return () => {
      // Reset the redirecting flag when component unmounts
      isRedirecting.current = false;
    };
  }, [createSession, router]);

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
        onNewChat={() => {
          // Prevent creating multiple new chats in quick succession
          if (!isRedirecting.current) {
            console.log("onNewChat clicked, navigating to /chat/new");
            router.push("/chat/new");
          }
        }}
        onRegenerate={() => console.log("Regenerate")}
        sidebarCollapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
        acceptedFileTypes={acceptedFileTypes}
        customSessionSelect={(selectedChatId) => {
          if (!isRedirecting.current) {
            console.log("Selecting chat:", selectedChatId);
            router.push(`/chat/${selectedChatId}`);
          }
        }}
        isTransitioning={true}
      />
    </ChatProvider>
  );
}
