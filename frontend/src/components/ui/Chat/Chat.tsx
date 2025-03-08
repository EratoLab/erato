import clsx from "clsx";
import React, { useCallback, useMemo } from "react";

import { useProfile } from "@/hooks/useProfile";

import { useChatHistory } from "../../containers/ChatHistoryProvider";
import { useChat } from "../../containers/ChatProvider";
import { MessageList } from "../MessageList";
import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { ChatInput } from "./ChatInput";

import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "../../../types/message-controls";
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
  onAddFile?: (files: File[]) => void;
  onRegenerate?: () => void;
  // Add new prop for sidebar collapsed state
  sidebarCollapsed?: boolean;
  onToggleCollapse: () => void;
  /** Optional array of accepted file types */
  acceptedFileTypes?: FileType[];
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
  onAddFile,
  onRegenerate,
  sidebarCollapsed = false,
  onToggleCollapse,
  acceptedFileTypes,
}: ChatProps) => {
  // Get chat data and actions from context providers
  const {
    messages,
    messageOrder,
    sendMessage,
    isLoading: chatLoading,
    hasOlderMessages,
    loadOlderMessages,
    apiMessagesResponse,
  } = useChat();
  const { profile } = useProfile();
  const {
    sessions,
    currentSessionId,
    switchSession,
    deleteSession,
    isLoading: chatHistoryLoading,
    error: chatHistoryError,
  } = useChatHistory();

  // Wrap the sendMessage with a void handler for ChatInput
  const handleSendMessage = useCallback(
    (message: string) => {
      void sendMessage(message);
    },
    [sendMessage],
  );

  // Memoize message action handler
  const handleMessageAction = useCallback(
    async (action: MessageAction) => {
      if (onMessageAction) {
        await onMessageAction(action);
      }
    },
    [onMessageAction],
  );

  // Determine if we should use virtualization based on message count
  const useVirtualization = useMemo(
    () => messageOrder.length > 30,
    [messageOrder.length],
  );

  // Define a constant for the page size
  const messagePageSize = 6;

  return (
    <div className="flex size-full flex-col sm:flex-row">
      <ChatHistorySidebar
        collapsed={sidebarCollapsed}
        onNewChat={onNewChat}
        onToggleCollapse={onToggleCollapse}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSessionSelect={switchSession}
        onSessionDelete={deleteSession}
        isLoading={chatHistoryLoading}
        error={chatHistoryError}
        className="fixed inset-0 z-50 sm:relative sm:z-auto"
        userProfile={profile}
      />
      <div
        className={clsx(
          "flex h-full min-w-0 flex-1 flex-col bg-theme-bg-secondary",
          "mt-14 sm:mt-0",
          className,
        )}
        role="region"
        aria-label="Chat conversation"
      >
        {/* Use the new MessageList component with virtualization */}
        <MessageList
          messages={messages}
          messageOrder={messageOrder}
          loadOlderMessages={loadOlderMessages}
          hasOlderMessages={hasOlderMessages}
          isLoading={chatLoading}
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
          onAddFile={onAddFile}
          className="border-t border-theme-border bg-theme-bg-primary p-2 sm:p-4"
          isLoading={chatLoading}
          showControls
          onRegenerate={onRegenerate}
        />
      </div>
    </div>
  );
};
