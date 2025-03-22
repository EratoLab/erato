"use client";

import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

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

export default function ChatPage() {
  const router = useRouter();
  const params = useParams();
  const chatId = params.id as string;
  const { collapsed: sidebarCollapsed, toggleCollapsed: handleToggleCollapse } =
    useSidebar();
  const { switchSession } = useChatHistory();

  useEffect(() => {
    // When the page loads, switch to the chat session based on the URL parameter
    if (chatId) {
      switchSession(chatId);
    }
  }, [chatId, switchSession]);

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
        onNewChat={() => router.push("/chat/new")}
        onRegenerate={() => console.log("Regenerate")}
        sidebarCollapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
        acceptedFileTypes={acceptedFileTypes}
        customSessionSelect={(selectedChatId) => {
          router.push(`/chat/${selectedChatId}`);
        }}
        isTransitioning={false}
      />
    </ChatProvider>
  );
}
