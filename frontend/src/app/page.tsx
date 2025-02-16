"use client";

import dynamic from "next/dynamic";
import { ChatProvider } from "../components/containers/ChatProvider";
import { ChatHistoryProvider } from "../components/containers/ChatHistoryProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Dynamically import Chat with ssr disabled
const Chat = dynamic(
  () => import("../components/ui/Chat").then((mod) => mod.Chat),
  {
    ssr: false,
  },
);

const queryClient = new QueryClient();

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen min-h-screen bg-theme-bg-primary">
        <ChatHistoryProvider>
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
              onToggleCollapse={() => console.log("Toggle collapse")}
            />
          </ChatProvider>
        </ChatHistoryProvider>
      </div>
    </QueryClientProvider>
  );
}
