"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { Chat } from "@/components/ui/Chat/Chat";
import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { useChatContext } from "@/providers/ChatProvider";

export default function NewChatPage() {
  const router = useRouter();
  const { isStreaming, currentChatId } = useChatContext();
  const setNewChatPending = useChatHistoryStore(
    (state) => state.setNewChatPending,
  );
  const redirectedRef = useRef(false);

  // Reset the new chat pending flag when this page loads
  useEffect(() => {
    console.log(
      "[CHAT_FLOW] NewChatPage mounted - resetting new chat pending flag",
    );
    setNewChatPending(false);
  }, [setNewChatPending]);

  // Navigate to the chat page when a chat ID is available AND streaming has stopped
  useEffect(() => {
    console.log(
      `[CHAT_FLOW_REDIRECT_CHECK] Effect triggered. chatId: ${currentChatId ?? "null"}, isStreaming: ${isStreaming}, redirected: ${redirectedRef.current}`,
    );

    // Check if this is explicitly a new chat (null ID)
    const isNewChat = currentChatId === null;

    if (isNewChat) {
      console.log(
        "[CHAT_FLOW] NewChatPage - This is a new chat. Not redirecting until messages are sent.",
      );
      return; // Don't redirect for new chats
    }

    // Only redirect if:
    // 1. We have a currentChatId that is not null
    // 2. We're not currently streaming (meaning the response completed)
    // 3. We haven't already redirected (prevents double redirects)
    if (currentChatId && !isStreaming && !redirectedRef.current) {
      console.log(
        `[CHAT_FLOW] NewChatPage - Ready to redirect to: /chat/${currentChatId}`,
      );
      // Set the flag to prevent multiple redirects
      redirectedRef.current = true;

      // Directly navigate using Next.js router - no need for a timeout
      console.log(
        `[CHAT_FLOW] NewChatPage - Executing redirect to: /chat/${currentChatId}`,
      );
      router.push(`/chat/${currentChatId}`);
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
