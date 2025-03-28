"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useDynamicParams } from "next-static-utils";
import { useEffect, useRef } from "react";

import { useChatHistory } from "../../../components/containers/ChatHistoryProvider";
import { ChatProvider } from "../../../components/containers/ChatProvider";
import { MessagingProvider } from "../../../components/containers/MessagingProvider";
import { useSidebar } from "../../../contexts/SidebarContext";

import type { FileType } from "@/utils/fileTypes";

// Dynamically import Chat with ssr disabled
const Chat = dynamic(
  () => import("../../../components/ui/Chat").then((mod) => mod.Chat),
  {
    ssr: false,
  },
);

export default function ChatPage() {
  const router = useRouter();
  const params = useDynamicParams();
  const chatId = params.id;
  const { collapsed: sidebarCollapsed, toggleCollapsed: handleToggleCollapse } =
    useSidebar();
  const { switchSession } = useChatHistory();
  const isRedirecting = useRef(false);

  useEffect(() => {
    if (typeof chatId != "undefined") {
      // Prevent redirect loops by checking if the ID is a temp ID
      if (chatId.startsWith("temp-")) {
        console.log("Warning: Accessing temp chat ID directly:", chatId);
      }

      // When the page loads, switch to the chat session based on the URL parameter
      if (chatId) {
        console.log("Switching to chat session:", chatId);
        switchSession(chatId);
      }
    }
  }, [chatId, switchSession]);

  // Define which file types are accepted in this chat
  const acceptedFileTypes: FileType[] = ["pdf", "image", "document"];

  return (
    <MessagingProvider chatId={chatId}>
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
            if (!isRedirecting.current) {
              isRedirecting.current = true;
              console.log("Creating new chat");
              router.push("/chat/new");

              // Reset the redirecting flag after a short delay
              setTimeout(() => {
                isRedirecting.current = false;
              }, 500);
            }
          }}
          onRegenerate={() => console.log("Regenerate")}
          sidebarCollapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleCollapse}
          acceptedFileTypes={acceptedFileTypes}
          customSessionSelect={(selectedChatId) => {
            // Don't navigate if already on this chat or if currently redirecting
            if (selectedChatId !== chatId && !isRedirecting.current) {
              isRedirecting.current = true;
              console.log("Navigating to chat:", selectedChatId);
              router.push(`/chat/${selectedChatId}`);

              // Reset the redirecting flag after a short delay
              setTimeout(() => {
                isRedirecting.current = false;
              }, 500);
            }
          }}
          isTransitioning={false}
        />
      </ChatProvider>
    </MessagingProvider>
  );
}
