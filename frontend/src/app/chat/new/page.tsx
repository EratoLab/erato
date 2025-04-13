"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { Chat } from "@/components/ui/Chat/Chat";
import { WelcomeScreen } from "@/components/ui/WelcomeScreen";
import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { useChatContext } from "@/providers/ChatProvider";

import type { MessageAction } from "@/types/message-controls";

export default function NewChatPage() {
  const router = useRouter();
  // Get messages and order from context (will be empty for new chat)
  const { isStreaming, currentChatId, messages, messageOrder } =
    useChatContext();
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
      <Chat
        messages={messages}
        messageOrder={messageOrder}
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
        onMessageAction={async (action: MessageAction) => {
          // Handle message actions here
          console.log("Message action:", action);
          return true; // Return true to satisfy Promise<boolean>
        }}
        emptyStateComponent={<WelcomeScreen />}
      />
    </div>
  );
}
