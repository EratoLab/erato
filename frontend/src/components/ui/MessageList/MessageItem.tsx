import { memo } from "react";

import { mapMessageToUiMessage } from "@/utils/adapters/messageAdapter";

import { ChatMessage } from "../Chat/ChatMessage";

import type {
  UserProfile,
  FileUploadItem,
  MessageFeedback,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";

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
  onMessageAction: (action: MessageAction) => Promise<boolean>;
  className?: string;
  onFilePreview?: (file: FileUploadItem) => void;
  onViewFeedback?: (messageId: string, feedback: MessageFeedback) => void;
  allFileDownloadUrls: Record<string, string>;
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
    onFilePreview,
    onViewFeedback,
    allFileDownloadUrls,
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
          onFilePreview={onFilePreview}
          onViewFeedback={onViewFeedback}
          allFileDownloadUrls={allFileDownloadUrls}
        />
      </div>
    );
  },
  // Custom comparison function
  (prevProps, nextProps) => {
    // Basic shallow comparison for most props
    const shallowEqual = Object.keys(nextProps).every((key) => {
      return (
        prevProps[key as keyof MessageItemProps] ===
        nextProps[key as keyof MessageItemProps]
      );
    });

    // Deep comparison specifically for the message object, using UiChatMessage type assertion
    const msgPrev = prevProps.message as UiChatMessage;
    const msgNext = nextProps.message as UiChatMessage;
    const messageEqual =
      msgPrev.id === msgNext.id &&
      msgPrev.content === msgNext.content &&
      msgPrev.loading?.state === msgNext.loading?.state &&
      // msgPrev.error === msgNext.error && // Error comparison might be tricky, skip for now
      JSON.stringify(msgPrev.input_files_ids) ===
        JSON.stringify(msgNext.input_files_ids);

    return shallowEqual && messageEqual;
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
MessageItem.displayName = "MessageItem";
