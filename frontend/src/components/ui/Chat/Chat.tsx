import clsx from "clsx";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useProfile } from "@/hooks/useProfile";

import { MessageList } from "../MessageList";
import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { ChatInput } from "./ChatInput";

import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "../../../types/message-controls";
import type { FileType } from "@/utils/fileTypes";

import { useChatHistory } from "@/components/containers/ChatHistoryProvider";
import { useChat } from "@/components/containers/ChatProvider";
import { useSidebar } from "@/contexts/SidebarContext";
import { useChatActions } from "@/hooks/useChatActions";

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
  const sidebarContext = useSidebar();

  // These values are guaranteed to exist from the context
  const sidebarCollapsed = sidebarContext.collapsed;
  const onToggleCollapse = sidebarContext.toggleCollapsed;

  // Get chat data and actions from context providers
  const {
    messages,
    messageOrder,
    sendMessage,
    isPending: chatLoading,
    hasOlderMessages,
    loadOlderMessages,
    apiMessagesResponse,
    handleFileAttachments,
    performFileUpload,
    isUploadingFiles,
    uploadError,
  } = useChat();
  const { profile } = useProfile();
  const {
    sessions,
    currentSessionId,
    switchSession,
    deleteSession,
    isPending: chatHistoryLoading,
    error: chatHistoryError,
    refreshChats,
  } = useChatHistory();

  // Use chat actions hook for handlers
  const {
    handleSessionSelect: baseHandleSessionSelect,
    handleSendMessage: baseHandleSendMessage,
    handleMessageAction,
  } = useChatActions(switchSession, sendMessage, onMessageAction);

  // Enhanced sendMessage handler that refreshes the sidebar after sending
  const handleSendMessage = useCallback(
    (message: string) => {
      // Send the message
      baseHandleSendMessage(message);

      // Schedule a refresh of the chat history sidebar after a short delay
      // This allows time for the message to be processed and confirmed
      setTimeout(() => {
        console.log("Refreshing chat history");
        void refreshChats();
      }, 2500); // 1.5 second delay
    },
    [baseHandleSendMessage, refreshChats],
  );

  // Customize session select handler to use custom handler if provided
  const handleSessionSelect = (sessionId: string) => {
    baseHandleSessionSelect(sessionId, customSessionSelect);
  };

  // Create a state to maintain previous messages during transitions
  const [prevMessages, setPrevMessages] = useState<typeof messages>({});
  const [prevMessageOrder, setPrevMessageOrder] = useState<string[]>([]);

  // Keep previous messages during transitions to prevent flickering
  useEffect(() => {
    // Only update the state if we have messages and they've actually changed
    if (
      Object.keys(messages).length > 0 &&
      (JSON.stringify(Object.keys(messages)) !==
        JSON.stringify(Object.keys(prevMessages)) ||
        JSON.stringify(messageOrder) !== JSON.stringify(prevMessageOrder))
    ) {
      setPrevMessages(messages);
      setPrevMessageOrder(messageOrder);
    }
  }, [messages, messageOrder, prevMessages, prevMessageOrder]);

  // Determine which messages to display - current or previous during transitions
  const displayMessages = useMemo(() => {
    return isTransitioning && Object.keys(messages).length === 0
      ? prevMessages
      : messages;
  }, [isTransitioning, messages, prevMessages]);

  const displayMessageOrder = useMemo(() => {
    return isTransitioning && messageOrder.length === 0
      ? prevMessageOrder
      : messageOrder;
  }, [isTransitioning, messageOrder, prevMessageOrder]);

  // Determine if we should use virtualization based on message count
  const useVirtualization = useMemo(
    () => displayMessageOrder.length > 30,
    [displayMessageOrder.length],
  );

  // Define a constant for the page size
  const messagePageSize = 6;

  return (
    <div className="flex size-full flex-col sm:flex-row">
      <ChatHistorySidebar
        collapsed={sidebarCollapsed}
        onNewChat={onNewChat}
        onToggleCollapse={onToggleCollapse}
        sessions={sessions.filter(
          (session) => session.metadata?.isTemporary !== true,
        )}
        currentSessionId={currentSessionId}
        onSessionSelect={handleSessionSelect}
        onSessionDelete={deleteSession}
        isLoading={isTransitioning ? false : chatHistoryLoading}
        error={chatHistoryError}
        className="fixed inset-0 z-50 sm:relative sm:z-auto"
        userProfile={profile}
      />
      <div
        className={clsx(
          "flex h-full min-w-0 flex-1 flex-col bg-theme-bg-secondary",
          "sm:mt-0",
          className,
        )}
        role="region"
        aria-label="Chat conversation"
      >
        {/* Use the new MessageList component with virtualization */}
        <MessageList
          messages={displayMessages}
          messageOrder={displayMessageOrder}
          loadOlderMessages={loadOlderMessages}
          hasOlderMessages={hasOlderMessages}
          isPending={isTransitioning ? false : chatLoading}
          currentSessionId={currentSessionId}
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
          performFileUpload={performFileUpload}
          isUploading={isUploadingFiles}
          uploadError={uploadError}
        />
      </div>
    </div>
  );
};
