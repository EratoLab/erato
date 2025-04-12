import clsx from "clsx";
import React, { useCallback, useRef } from "react";

import { useChatActions, useChatTransition } from "@/hooks/chat";
import { useSidebar } from "@/hooks/ui/useSidebar";
import { useProfile } from "@/hooks/useProfile";
import { useChatContext } from "@/providers/ChatProvider";
import { createLogger } from "@/utils/debugLogger";

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

// Create logger for this component
const logger = createLogger("UI", "Chat");

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
    createNewChat: createChat,
    isHistoryLoading: chatHistoryLoading,
    historyError: chatHistoryError,
    refetchHistory: refreshChats,
  } = useChatContext();

  const { profile } = useProfile();

  // Convert the chat history data to the format expected by the sidebar
  const sessions: ChatSession[] = Array.isArray(chatHistory)
    ? chatHistory.map((chat) => ({
        id: chat.id,
        title: chat.title_by_summary || "New Chat", // Use title from API
        updatedAt: chat.last_message_at || new Date().toISOString(), // Use last message timestamp
        messages: [], // We don't need to populate messages here
        metadata: {
          lastMessage: {
            content: chat.title_by_summary || "", // Reuse title as a preview if no actual message available
            timestamp: chat.last_message_at || new Date().toISOString(),
          },
        },
      }))
    : [];

  // Define placeholder values for missing functionality
  const hasOlderMessages = false;
  const loadOlderMessages = () => {};
  const apiMessagesResponse: ChatMessagesResponse | undefined = undefined;
  const handleFileAttachments = () => {};

  // Use chat actions hook for handlers
  const {
    // handleSessionSelect,
    handleSendMessage: baseHandleSendMessage,
    handleMessageAction,
  } = useChatActions({
    switchSession,
    sendMessage,
    onMessageAction,
  });

  // Create a ref to store the scrollToBottom function from MessageList
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  // Enhanced sendMessage handler that refreshes the sidebar after sending
  const handleSendMessage = useCallback(
    (message: string, inputFileIds?: string[]) => {
      logger.log(
        "[CHAT_FLOW] Chat - handleSendMessage called with files:",
        inputFileIds,
      );

      // Scroll to bottom immediately when user sends a message
      if (scrollToBottomRef.current) {
        scrollToBottomRef.current();
      }

      // Send the message using the handler from useChatActions
      // Now baseHandleSendMessage returns a Promise we can chain with
      baseHandleSendMessage(message, inputFileIds)
        .then(() => {
          logger.log("[CHAT_FLOW] Message sent, refreshing chats");
          return refreshChats();
        })
        .catch((error) => {
          logger.log("[CHAT_FLOW] Error sending message:", error);
        });
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
    void refreshChats(); // Ensure void is applied
  }, [refreshChats]);

  // Handle session select with void return type
  const handleSessionSelectWrapper = (sessionId: string) => {
    logger.log(
      `[CHAT_FLOW] Handling session select in Chat component for session: ${sessionId}`,
    );
    // Call handleSessionSelect or directly use switchSession if that's not working
    if (customSessionSelect) {
      customSessionSelect(sessionId);
    } else {
      logger.log(
        `[CHAT_FLOW] Directly calling switchSession with ID: ${sessionId}`,
      );
      switchSession(sessionId);
    }
  };

  // Handle deleting a session with void return type
  const handleDeleteSession = (sessionId: string) => {
    void deleteSession(sessionId);
  };

  // Function to capture the scrollToBottom from MessageList
  const handleMessageListRef = useCallback((scrollToBottom: () => void) => {
    scrollToBottomRef.current = scrollToBottom;
  }, []);

  // Handle creating a new chat
  const handleNewChat = useCallback(async () => {
    logger.log("[CHAT_FLOW] New chat button clicked");

    try {
      if (onNewChat) {
        // Use custom handler if provided
        await onNewChat();
      } else {
        // Otherwise use the default behavior from context
        // Don't chain with then() - use await for cleaner flow
        await createChat();
        logger.log("[CHAT_FLOW] New chat creation completed");
      }
    } catch (error) {
      logger.log("[CHAT_FLOW] Error creating new chat:", error);
    }
  }, [onNewChat, createChat]);

  return (
    <div className="flex size-full flex-col sm:flex-row">
      <ChatHistorySidebar
        collapsed={sidebarCollapsed}
        onNewChat={handleNewChat}
        onToggleCollapse={onToggleCollapse}
        sessions={sessions}
        currentSessionId={currentChatId ?? ""}
        onSessionSelect={handleSessionSelectWrapper}
        onSessionDelete={handleDeleteSession}
        showTimestamps={showTimestamps}
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
            currentSessionId={currentChatId ?? ""}
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
            onScrollToBottomRef={handleMessageListRef}
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
