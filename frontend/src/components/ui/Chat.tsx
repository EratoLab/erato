import clsx from "clsx";
import React, { useRef, useEffect } from "react";

import { useProfile } from "@/hooks/useProfile";

import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { useChatHistory } from "../containers/ChatHistoryProvider";
import { useChat } from "../containers/ChatProvider";
import { useMessageStream } from "../containers/MessageStreamProvider";

import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "../../types/message-controls";
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
  const {
    messages,
    messageOrder,
    sendMessage,
    isLoading: chatLoading,
    hasOlderMessages,
    loadOlderMessages,
  } = useChat();
  const { currentStreamingMessage } = useMessageStream();
  const { profile } = useProfile();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const {
    sessions,
    currentSessionId,
    switchSession,
    deleteSession,
    isLoading: chatHistoryLoading,
    error: chatHistoryError,
  } = useChatHistory();

  const layoutStyles = {
    default: "space-y-4 p-4",
    compact: "space-y-2 p-2",
    comfortable: "space-y-6 p-6",
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageOrder, currentStreamingMessage]);

  const handleMessageAction = async (action: MessageAction) => {
    if (onMessageAction) {
      await onMessageAction(action);
    }
  };

  return (
    <div className="flex h-full w-full flex-col sm:flex-row">
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
          "flex-1 flex flex-col h-full bg-theme-bg-secondary min-w-0",
          "mt-14 sm:mt-0",
          className,
        )}
        role="region"
        aria-label="Chat conversation"
      >
        <div
          className={clsx(
            "flex-1 overflow-y-auto",
            "bg-theme-bg-secondary",
            "px-2 sm:px-4",
            layoutStyles[layout],
          )}
        >
          {hasOlderMessages && (
            <div className="sticky top-0 z-10 flex justify-center py-2 bg-theme-bg-secondary">
              <button
                onClick={loadOlderMessages}
                className="px-4 py-2 text-sm bg-theme-bg-primary text-theme-text-primary rounded-full hover:bg-theme-bg-tertiary focus:outline-none focus:ring-2 focus:ring-theme-primary transition-colors"
                disabled={chatLoading}
              >
                {chatLoading ? "Loading..." : "Load more messages"}
              </button>
            </div>
          )}
          {messageOrder.map((messageId) => {
            const message = messages[messageId];
            return (
              <ChatMessage
                key={messageId}
                message={message}
                maxWidth={maxWidth}
                showTimestamp={showTimestamps}
                showAvatar={showAvatars}
                userProfile={profile}
                controls={messageControls}
                controlsContext={controlsContext}
                onMessageAction={handleMessageAction}
                className={clsx(
                  "mx-auto w-full sm:w-[85%]",
                  layout === "compact" && "py-2",
                  layout === "comfortable" && "py-6",
                )}
              />
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <ChatInput
          onSendMessage={(message) => {
            void sendMessage(message);
          }}
          className="border-t border-theme-border bg-theme-bg-primary p-2 sm:p-4"
          isLoading={chatLoading}
          showControls
          onAddFile={onAddFile}
          onRegenerate={onRegenerate}
          acceptedFileTypes={acceptedFileTypes}
        />
      </div>
    </div>
  );
};
