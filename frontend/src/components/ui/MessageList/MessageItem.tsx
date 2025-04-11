import React, { memo } from "react";

import { mapMessageToUiMessage } from "@/utils/adapters/messageAdapter";

import { ChatMessage } from "../Chat/ChatMessage";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";

// Enable/disable verbose debugging
const ENABLE_VERBOSE_DEBUG = true;

export interface MessageItemProps {
  messageId: string;
  message: Message;
  isNew: boolean;
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
    maxWidth,
    showTimestamp,
    showAvatar,
    userProfile,
    controls: Controls,
    controlsContext,
    onMessageAction,
    className,
  }) => {
    // Debug message loading state
    // useEffect(() => {
    //   if (message.sender === "assistant" && message.loading) {
    //     debugLog("RENDER", `Assistant message ${messageId} is loading`, {
    //       loadingState: message.loading.state,
    //       content:
    //         message.content.substring(0, 30) +
    //         (message.content.length > 30 ? "..." : ""),
    //     });
    //   }
    // }, [messageId, message]);

    // Log rendering for assistant messages
    // if (message.sender === "assistant") {
    //   // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    //   if (ENABLE_VERBOSE_DEBUG) {
    //     console.log(
    //       `%c🔄 RENDERING MESSAGE ${messageId}`,
    //       "background: #121; color: #4af; font-size: 12px; padding: 2px 6px; border-radius: 3px;",
    //       {
    //         isLoading: !!message.loading,
    //         loadingState: message.loading?.state,
    //         contentLength: message.content.length,
    //         hasError: !!message.error,
    //       },
    //     );
    //   }
    // }

    return (
      <div className={className}>
        <ChatMessage
          key={messageId}
          message={mapMessageToUiMessage(message)}
          showTimestamp={showTimestamp}
          showAvatar={showAvatar}
          maxWidth={maxWidth}
          userProfile={userProfile}
          controls={Controls}
          controlsContext={controlsContext}
          onMessageAction={onMessageAction}
        />
      </div>
    );
  },
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

    // Re-render if status changes
    if (prevMessage.status !== nextMessage.status) {
      if (ENABLE_VERBOSE_DEBUG) {
        console.log(
          `%c⚡ STATUS CHANGED for ${nextProps.messageId}`,
          "background: #121; color: #f93; font-size: 12px; padding: 2px 6px; border-radius: 3px;",
          {
            from: prevMessage.status,
            to: nextMessage.status,
          },
        );
      }
      return false;
    }

    // Otherwise, prevent re-render
    return true;
  },
);

MessageItem.displayName = "MessageItem";
