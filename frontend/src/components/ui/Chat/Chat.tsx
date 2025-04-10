import clsx from "clsx";
import React, { useCallback } from "react";

import { useChatActions, useChatTransition } from "@/hooks/chat";
import { useSidebar } from "@/hooks/ui/useSidebar";
import { useProfile } from "@/hooks/useProfile";
import { useChatContext } from "@/providers/ChatProvider";

import { MessageList } from "../MessageList";
import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { ChatInput } from "./ChatInput";
import { ChatErrorBoundary } from "../Feedback/ChatErrorBoundary";

import type { ChatMessagesResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";
import type { FileType } from "@/utils/fileTypes";

export interface ChatProps {
  className?: string;
  /**
   * Layout configuration
   */
  layout?: "default" | "compact" | "comfortable";
  /**
   * Maximum width of messages
   */
  maxWidth?: number;
  /**
   * Whether to show avatars
   */
  showAvatars?: boolean;
  /**
   * Whether to show timestamps
   */
  showTimestamps?: boolean;
  // New unified handler
  onMessageAction?: (action: MessageAction) => void | Promise<void>;
  // Context for controls
  controlsContext: MessageControlsContext;
  // Optional custom controls component
  messageControls?: MessageControlsComponent;
  onNewChat?: () => void;
  onRegenerate?: () => void;
  // Sidebar collapsed state is now handled by context, so these are optional
  sidebarCollapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Optional array of accepted file types */
  acceptedFileTypes?: FileType[];
  /** Optional custom session select handler to override default behavior */
  customSessionSelect?: (sessionId: string) => void;
  /** Flag to indicate if the chat is currently transitioning between sessions */
  isTransitioning?: boolean;
}

/**
 * Main Chat component that integrates chat UI, history, and messaging functionality.
 * This is the top-level component that coordinates all chat-related components.
 */
export const Chat = ({
  className,
  layout = "default",
  maxWidth = 768,
  showAvatars = false,
  showTimestamps = true,
  onMessageAction,
  controlsContext,
  messageControls,
  onNewChat,
  onRegenerate,
  // Prefix unused props with underscore
  sidebarCollapsed: _sidebarCollapsed,
  onToggleCollapse: _onToggleCollapse,
  acceptedFileTypes,
  customSessionSelect,
  isTransitioning = false,
}: ChatProps) => {
  // Use the sidebar context
  const { isOpen: sidebarCollapsed, toggle: onToggleCollapse } = useSidebar();

  // Get chat data and actions from context provider
  const {
    // Chat messaging
    messages,
    messageOrder,
    sendMessage,
    isMessagingLoading: chatLoading,
    // Chat history
    chats: chatHistory,
    currentChatId,
    navigateToChat: switchSession,
    deleteChat: deleteSession,
    isHistoryLoading: chatHistoryLoading,
    historyError: chatHistoryError,
    refetchHistory: refreshChats,
  } = useChatContext();

  const { profile } = useProfile();

  // Convert the chat history data to the format expected by the sidebar
  const sessions: ChatSession[] = Array.isArray(chatHistory)
    ? chatHistory.map((chat) => ({
        id: chat.id,
        title: "New Chat", // Default title
        updatedAt: new Date().toISOString(), // Default date
        messages: [],
      }))
    : [];

  // Define placeholder values for missing functionality
  const hasOlderMessages = false;
  const loadOlderMessages = () => {};
  const apiMessagesResponse: ChatMessagesResponse | undefined = undefined;
  const handleFileAttachments = () => {};

  // Use chat actions hook for handlers
  const {
    handleSessionSelect,
    handleSendMessage: baseHandleSendMessage,
    handleMessageAction,
  } = useChatActions({
    switchSession,
    sendMessage,
    onMessageAction,
  });

  // Enhanced sendMessage handler that refreshes the sidebar after sending
  const handleSendMessage = useCallback(
    (message: string) => {
      console.log("[CHAT_FLOW] Chat - handleSendMessage called");
      // Send the message
      baseHandleSendMessage(message);

      // Schedule a refresh of the chat history sidebar after a short delay
      // This allows time for the message to be processed and confirmed
      setTimeout(() => {
        // Remove noisy logging
        void refreshChats();
      }, 2500); // 2.5 second delay
    },
    [baseHandleSendMessage, refreshChats],
  );

  // Use our transition hook to handle message transitions
  const { displayMessages, displayMessageOrder, useVirtualization } =
    useChatTransition({
      messages,
      messageOrder,
      isTransitioning,
    });

  // Define a constant for the page size
  const messagePageSize = 6;

  // Handler for when the error boundary resets
  const handleErrorReset = useCallback(() => {
    // Refresh chats on error reset
    void refreshChats();
  }, [refreshChats]);

  // Handle session select with void return type
  const handleSessionSelectWrapper = (sessionId: string) => {
    handleSessionSelect(sessionId, customSessionSelect);
  };

  // Handle deleting a session with void return type
  const handleDeleteSession = (sessionId: string) => {
    void deleteSession(sessionId);
  };

  return (
    <div className="flex size-full flex-col sm:flex-row">
      <ChatHistorySidebar
        collapsed={sidebarCollapsed}
        onNewChat={onNewChat}
        onToggleCollapse={onToggleCollapse}
        sessions={sessions}
        currentSessionId={currentChatId || ""}
        onSessionSelect={handleSessionSelectWrapper}
        onSessionDelete={handleDeleteSession}
        isLoading={isTransitioning ? false : chatHistoryLoading}
        error={chatHistoryError instanceof Error ? chatHistoryError : undefined}
        className="fixed inset-0 z-50 sm:relative sm:z-auto"
        userProfile={profile}
      />
      <ChatErrorBoundary onReset={handleErrorReset}>
        <div
          className={clsx(
            "flex h-full min-w-0 flex-1 flex-col bg-theme-bg-secondary",
            "sm:mt-0",
            className,
          )}
          role="region"
          aria-label="Chat conversation"
        >
          {/* Use the MessageList component */}
          <MessageList
            messages={displayMessages}
            messageOrder={displayMessageOrder}
            loadOlderMessages={loadOlderMessages}
            hasOlderMessages={hasOlderMessages}
            isPending={isTransitioning ? false : chatLoading}
            currentSessionId={currentChatId || ""}
            apiMessagesResponse={apiMessagesResponse}
            pageSize={messagePageSize}
            maxWidth={maxWidth}
            showTimestamps={showTimestamps}
            showAvatars={showAvatars}
            userProfile={profile}
            controls={messageControls}
            controlsContext={controlsContext}
            onMessageAction={handleMessageAction}
            className={layout}
            useVirtualization={useVirtualization}
            virtualizationThreshold={30}
          />

          <ChatInput
            onSendMessage={handleSendMessage}
            acceptedFileTypes={acceptedFileTypes}
            handleFileAttachments={handleFileAttachments}
            className="p-2 sm:p-4"
            isLoading={chatLoading}
            showControls
            onRegenerate={onRegenerate}
            showFileTypes={true}
            initialFiles={[]}
          />
        </div>
      </ChatErrorBoundary>
    </div>
  );
};
