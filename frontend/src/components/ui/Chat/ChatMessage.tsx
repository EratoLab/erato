import clsx from "clsx";
import React, { memo } from "react";

import { Avatar } from "../Feedback/Avatar";
import { LoadingIndicator } from "../Feedback/LoadingIndicator";
import { DefaultMessageControls } from "../Message/DefaultMessageControls";
import { MessageContent } from "../Message/MessageContent";
import { messageStyles } from "../styles/chatMessageStyles";

import type {
  MessageControlsComponent,
  MessageControlsContext,
  MessageAction,
} from "../../../types/message-controls";
import type { ChatMessage as ChatMessageType } from "../../containers/ChatProvider";
import type { UserProfile } from "@/types/chat";

export interface ChatMessageProps {
  message: ChatMessageType;
  className?: string;
  /**
   * Maximum width of the message container in pixels
   * @default 768 (max-w-3xl)
   */
  maxWidth?: number;
  /**
   * Whether to show the timestamp
   * @default true
   */
  showTimestamp?: boolean;
  /**
   * Whether to show the avatar
   * @default false
   */
  showAvatar?: boolean;
  showControlsOnHover?: boolean;

  // New props
  controls?: MessageControlsComponent;
  controlsContext: MessageControlsContext;
  onMessageAction: (action: MessageAction) => void | Promise<void>;
  userProfile?: UserProfile;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  className = "",
  showTimestamp = true,
  showAvatar = false,
  userProfile,
  showControlsOnHover = true,
  controls: Controls = DefaultMessageControls,
  controlsContext,
  onMessageAction,
}: ChatMessageProps) {
  const isUser = message.sender === "user";
  const role = isUser ? "user" : "assistant";

  // Content validation
  if (!message.content && !message.loading) {
    return null;
  }

  return (
    <div
      className={clsx(
        "group relative flex gap-4 rounded-lg p-4",
        "w-full min-w-[280px] shrink-0",
        "hover:bg-theme-bg-accent",
        messageStyles.container[role],
        className,
      )}
      role="log"
      aria-live="polite"
      aria-label={`${isUser ? "Your" : "Assistant"} message`}
    >
      <div className="flex w-full gap-6">
        {showAvatar && (
          <Avatar userProfile={userProfile} userOrAssistant={!!isUser} />
        )}

        <div className="min-w-0 flex-1 break-words">
          <div className="flex items-start justify-between">
            <div className="mb-1 text-sm font-semibold text-theme-fg-primary">
              {isUser ? "You" : "Assistant"}
            </div>
          </div>

          <MessageContent content={message.content} />

          {message.loading && (
            <div className="mt-2">
              <LoadingIndicator
                state={message.loading.state}
                context={message.loading.context}
              />
            </div>
          )}
          {showTimestamp && (
            <Controls
              messageId={message.id}
              messageType={message.sender}
              authorId={message.authorId}
              createdAt={message.createdAt}
              context={controlsContext}
              showOnHover={showControlsOnHover}
              onAction={onMessageAction}
              className="z-10"
            />
          )}
        </div>
      </div>
    </div>
  );
});

// Add display name for better debugging
ChatMessage.displayName = "ChatMessage";
