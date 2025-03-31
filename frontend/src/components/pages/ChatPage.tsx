"use client";

import React from "react";

import { useChat } from "@/hooks/chat/useChat";

import { Chat } from "../ui/Chat/Chat";
import { ChatErrorBoundary } from "../ui/Feedback/ChatErrorBoundary";

import type {
  MessageControlsContext,
  MessageAction,
} from "@/types/message-controls";

/**
 * ChatPage component that demonstrates using our custom hooks
 *
 * This component uses our useChat hook to access chat functionality
 * and renders the Chat UI component.
 */
export function ChatPage() {
  const {
    // Only destructure what we're actually using
    createNewChat,
    // Other properties are available but not used directly in this component:
    // chats, currentChatId, messages, isLoading, error, isStreaming,
    // deleteChat, navigateToChat, sendMessage, cancelMessage
  } = useChat();

  // Basic message controls context
  const controlsContext: MessageControlsContext = {
    currentUserId: "user-123",
    dialogOwnerId: "user-123",
    isSharedDialog: false,
  };

  // Handle message actions (edit, delete, copy)
  const handleMessageAction = async (action: MessageAction) => {
    switch (action) {
      case "copy":
        try {
          // In a real implementation, we would get the content from the message
          await navigator.clipboard.writeText("Message content");
          console.log("Copied to clipboard");
        } catch (err) {
          console.error("Failed to copy:", err);
        }
        break;

      case "delete":
        // In a real app, you would call an API to delete the message
        console.log("Delete message action triggered");
        break;

      case "edit":
        // In a real app, you would call an API to edit the message
        console.log("Edit message action triggered");
        break;

      case "regenerate":
        console.log("Regenerate message action triggered");
        break;

      case "share":
        console.log("Share message action triggered");
        break;

      case "flag":
        console.log("Flag message action triggered");
        break;

      default:
        console.warn("Unknown action type:", action);
    }
  };

  // Handle creating a new chat
  const handleNewChat = () => {
    void createNewChat();
  };

  // Handle regenerating the last message
  const handleRegenerate = () => {
    // In a real app, you would call an API to regenerate the message
    console.log("Regenerate message");
  };

  return (
    <ChatErrorBoundary>
      <div className="flex h-screen w-full flex-col">
        <Chat
          onNewChat={handleNewChat}
          onRegenerate={handleRegenerate}
          controlsContext={controlsContext}
          onMessageAction={handleMessageAction}
          showAvatars={true}
          showTimestamps={true}
        />
      </div>
    </ChatErrorBoundary>
  );
}
