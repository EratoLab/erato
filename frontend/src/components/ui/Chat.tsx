import React from "react";
import { ChatInput } from "./ChatInput";
import { useChat } from "../containers/ChatProvider";
import { useRef, useEffect } from "react";
import clsx from "clsx";
import { ChatMessage } from "./ChatMessage";
import {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "../../types/message-controls";
import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { useChatHistory } from "../containers/ChatHistoryProvider";
import { useProfile } from '@/hooks/useProfile';

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
  // Add new prop for sidebar collapsed state
  sidebarCollapsed?: boolean;
  onToggleCollapse: () => void;
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
  onRegenerate,
  sidebarCollapsed = false,
  onToggleCollapse,
}: ChatProps) => {
  const { messages, messageOrder, sendMessage, isLoading } = useChat();
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
  }, [messageOrder]);

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
          onSendMessage={sendMessage}
          className="border-t border-theme-border bg-theme-bg-primary p-2 sm:p-4"
          isLoading={isLoading}
          showControls
          onNewChat={onNewChat}
          onRegenerate={onRegenerate}
        />
      </div>
    </div>
  );
};
