"use client";

import { Chat } from "../components/ui/Chat";
import { ChatProvider } from "../components/containers/ChatProvider";
import { ChatHistoryProvider } from "../components/containers/ChatHistoryProvider";
import { MessageAction } from "../types/message-controls";
import { useState } from "react";

export default function Home() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleMessageAction = async (action: MessageAction) => {
    switch (action.type) {
      case "copy":
        console.log("Copy message:", action.messageId);
        break;
      case "edit":
        console.log("Edit message:", action.messageId);
        break;
      case "like":
        console.log("Like message:", action.messageId);
        break;
      case "dislike":
        console.log("Dislike message:", action.messageId);
        break;
      case "rerun":
        console.log("Rerun message:", action.messageId);
        break;
    }
  };

  return (
    <div className="min-h-screen bg-theme-bg-primary">
      <ChatHistoryProvider>
        <ChatProvider>
          <main className="container mx-auto h-screen p-4">
            <Chat
              layout="default"
              showAvatars={true}
              showTimestamps={true}
              onMessageAction={handleMessageAction}
              controlsContext={{
                currentUserId: "user_1", // This would come from your auth system
                dialogOwnerId: "user_1",
                isSharedDialog: false,
              }}
              onNewChat={() => console.log("New chat")}
              onRegenerate={() => console.log("Regenerate")}
              sidebarCollapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
          </main>
        </ChatProvider>
      </ChatHistoryProvider>
    </div>
  );
}
