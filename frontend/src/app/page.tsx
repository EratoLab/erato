"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ChatProvider } from "../components/containers/ChatProvider";
import { ChatHistoryProvider } from "../components/containers/ChatHistoryProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageStreamProvider } from "../components/containers/MessageStreamProvider";
import { ProfileProvider } from "@/components/containers/ProfileProvider";

// Dynamically import Chat with ssr disabled
const Chat = dynamic(
  () => import("../components/ui/Chat").then((mod) => mod.Chat),
  {
    ssr: false,
  },
);

const queryClient = new QueryClient();

export default function Home() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleToggleCollapse = () => {
    setSidebarCollapsed((prev) => !prev);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen min-h-screen bg-theme-bg-primary">
        <ProfileProvider>
          <ChatHistoryProvider>
            <MessageStreamProvider>
              <ChatProvider>
                <Chat
                  layout="default"
                  showAvatars={true}
                  showTimestamps={true}
                  onMessageAction={(action) =>
                    console.log("Message action:", action)
                  }
                  controlsContext={{
                    currentUserId: "user_1",
                    dialogOwnerId: "user_1",
                    isSharedDialog: false,
                  }}
                  onNewChat={() => console.log("New chat")}
                  onRegenerate={() => console.log("Regenerate")}
                  sidebarCollapsed={sidebarCollapsed}
                  onToggleCollapse={handleToggleCollapse}
                />
              </ChatProvider>
            </MessageStreamProvider>
          </ChatHistoryProvider>
        </ProfileProvider>
      </div>
    </QueryClientProvider>
  );
}
