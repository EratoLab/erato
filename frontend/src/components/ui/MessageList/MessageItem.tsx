import React, { memo } from "react";

import { ChatMessage } from "../Chat/ChatMessage";

import type { ChatMessage as ChatMessageType } from "../../containers/ChatProvider";
import type { UserProfile } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";

export interface MessageItemProps {
  messageId: string;
  message: ChatMessageType;
  isNew: boolean;
  style?: React.CSSProperties;
  maxWidth?: number;
  showTimestamp?: boolean;
  showAvatar?: boolean;
  userProfile?: UserProfile;
  controls?: MessageControlsComponent;
  controlsContext: MessageControlsContext;
  onMessageAction: (action: MessageAction) => Promise<void>;
  className?: string;
}

// Memoized message item component with custom comparison
export const MessageItem = memo<MessageItemProps>(
  ({
    messageId,
    message,
    // Used in parent component via getMessageClassName
    isNew: _isNew,
    style,
    maxWidth,
    showTimestamp,
    showAvatar,
    userProfile,
    controls: Controls,
    controlsContext,
    onMessageAction,
    className,
  }) => (
    <div style={style} className={className}>
      <ChatMessage
        key={messageId}
        message={message}
        showTimestamp={showTimestamp}
        showAvatar={showAvatar}
        maxWidth={maxWidth}
        userProfile={userProfile}
        controls={Controls}
        controlsContext={controlsContext}
        onMessageAction={onMessageAction}
      />
    </div>
  ),
  // Custom comparison function to optimize rendering
  (prevProps, nextProps) => {
    // Always re-render if message ID changes
    if (prevProps.messageId !== nextProps.messageId) return false;

    // Always re-render if isNew status changes
    if (prevProps.isNew !== nextProps.isNew) return false;

    const prevMessage = prevProps.message;
    const nextMessage = nextProps.message;

    // Re-render if content changes
    if (prevMessage.content !== nextMessage.content) return false;

    // Re-render if loading or error state changes
    if (!!prevMessage.loading !== !!nextMessage.loading) return false;
    if (!!prevMessage.error !== !!nextMessage.error) return false;

    // Re-render if style changes (for virtualization)
    if (JSON.stringify(prevProps.style) !== JSON.stringify(nextProps.style))
      return false;

    // Otherwise, prevent re-render
    return true;
  },
);

MessageItem.displayName = "MessageItem";
