"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { Chat } from "@/components/ui/Chat/Chat";
import { useChatContext } from "@/providers/ChatProvider";

export default function NewChatPage() {
  const router = useRouter();
  const { isStreaming, cancelMessage, currentChatId } = useChatContext();
  const redirectedRef = useRef(false);

  // Navigate to the chat page when a chat ID is available AND streaming has stopped
  useEffect(() => {
    console.log(
      `[CHAT_FLOW_REDIRECT_CHECK] Effect triggered. chatId: ${currentChatId ?? "null"}, isStreaming: ${isStreaming}, redirected: ${redirectedRef.current}`,
    );
    // Only redirect if:
    // 1. We have a currentChatId
    // 2. We're not currently streaming (meaning the response completed)
    // 3. We haven't already redirected (prevents double redirects)
    if (currentChatId && !isStreaming && !redirectedRef.current) {
      console.log(
        `[CHAT_FLOW] NewChatPage - Ready to redirect to: /chat/${currentChatId}`,
      );
      // Set the flag to prevent multiple redirects
      redirectedRef.current = true;
      // Add a small delay to ensure all state updates are processed
      setTimeout(() => {
        console.log(
          `[CHAT_FLOW] NewChatPage - Executing redirect to: /chat/${currentChatId}`,
        );
        router.push(`/chat/${currentChatId}`);
      }, 100);
    }
  }, [currentChatId, router, isStreaming]);

  return (
    <div className="flex size-full flex-col">
      {/* {isStreaming && (
        <div className="flex h-12 items-center border-b px-4">
          <button
            onClick={cancelMessage}
            className="ml-auto rounded bg-red-500 px-3 py-1 text-white"
          >
            Stop generating
          </button>
        </div>
      )} */}
      <Chat
        controlsContext={{
          currentUserId: "user1",
          dialogOwnerId: "user1",
          isSharedDialog: false,
        }}
        className="h-full"
        showAvatars={true}
        showTimestamps={true}
        layout="default"
        maxWidth={768}
        onMessageAction={async (action) => {
          // Handle message actions here
          console.log("Message action:", action);
        }}
      />
    </div>
  );
}
