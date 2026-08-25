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
import type { ModelSwitch } from "@/utils/chat/modelSwitches";
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
  userDisplayNameOverride?: string;
  controls?: MessageControlsComponent;
  messageRenderer?: ComponentType<ChatMessageProps>;
  controlsContext: MessageControlsContext;
  onMessageAction: (action: MessageAction) => Promise<boolean>;
  onFilePreview?: (file: FileUploadItem) => void;
  onViewFeedback?: (messageId: string, feedback: MessageFeedback) => void;
  allFilesById: Record<string, FileUploadItem>;
  modelSwitches?: Record<string, ModelSwitch>;
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
  userDisplayNameOverride,
  controls,
  messageRenderer,
  controlsContext,
  onMessageAction,
  onFilePreview,
  onViewFeedback,
  allFilesById,
  modelSwitches,
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
          userDisplayNameOverride={userDisplayNameOverride}
          controls={controls}
          messageRenderer={messageRenderer}
          controlsContext={controlsContext}
          onMessageAction={onMessageAction}
          onFilePreview={onFilePreview}
          onViewFeedback={onViewFeedback}
          className={getMessageClassName(isNew)}
          allFilesById={allFilesById}
          modelSwitch={modelSwitches?.[messageId]}
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
    userDisplayNameOverride,
    controls,
    messageRenderer,
    controlsContext,
    onMessageAction,
    onFilePreview,
    onViewFeedback,
    allFilesById,
    modelSwitches,
  ]);

  return (
    <div className="flex w-full flex-col space-y-1">{renderMessages()}</div>
  );
};
