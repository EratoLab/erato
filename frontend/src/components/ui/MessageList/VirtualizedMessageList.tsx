import { useCallback } from "react";

import { MessageItem } from "./MessageItem";

import type { ChatMessageProps } from "../Chat/ChatMessage";
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
import type { ComponentType } from "react";
import type React from "react";

interface VirtualizedMessageListProps {
  messages: Record<string, Message>;
  visibleData: string[];
  containerSize: { width: number; height: number };
  isNewlyLoaded: (index: number) => boolean;
  getMessageClassName: (isNew: boolean) => string;
  maxWidth?: number;
  showTimestamps?: boolean;
  showAvatars?: boolean;
  userProfile?: UserProfile;
  controls?: MessageControlsComponent;
  messageRenderer?: ComponentType<ChatMessageProps>;
  controlsContext: MessageControlsContext;
  onMessageAction: (action: MessageAction) => Promise<boolean>;
  onFilePreview?: (file: FileUploadItem) => void;
  onViewFeedback?: (messageId: string, feedback: MessageFeedback) => void;
  allFileDownloadUrls: Record<string, string>;
}

export const VirtualizedMessageList: React.FC<VirtualizedMessageListProps> = ({
  messages,
  visibleData,
  isNewlyLoaded,
  getMessageClassName,
  maxWidth,
  showTimestamps,
  showAvatars,
  userProfile,
  controls,
  messageRenderer,
  controlsContext,
  onMessageAction,
  onFilePreview,
  onViewFeedback,
  allFileDownloadUrls,
}) => {
  // Message renderer
  const renderMessages = useCallback(() => {
    return visibleData.map((messageId, index) => {
      const message = messages[messageId];
      const isNew = isNewlyLoaded(index);

      return (
        <MessageItem
          key={messageId}
          messageId={messageId}
          message={message}
          isNew={isNew}
          maxWidth={maxWidth}
          showTimestamp={showTimestamps}
          showAvatar={showAvatars}
          userProfile={userProfile}
          controls={controls}
          messageRenderer={messageRenderer}
          controlsContext={controlsContext}
          onMessageAction={onMessageAction}
          onFilePreview={onFilePreview}
          onViewFeedback={onViewFeedback}
          className={getMessageClassName(isNew)}
          allFileDownloadUrls={allFileDownloadUrls}
        />
      );
    });
  }, [
    visibleData,
    messages,
    isNewlyLoaded,
    getMessageClassName,
    maxWidth,
    showTimestamps,
    showAvatars,
    userProfile,
    controls,
    messageRenderer,
    controlsContext,
    onMessageAction,
    onFilePreview,
    onViewFeedback,
    allFileDownloadUrls,
  ]);

  return (
    <div className="flex w-full flex-col space-y-1">{renderMessages()}</div>
  );
};
