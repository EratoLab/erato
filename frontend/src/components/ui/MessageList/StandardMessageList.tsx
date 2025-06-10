import { MessageItem } from "./MessageItem";

import type {
  UserProfile,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";
import type React from "react";

interface StandardMessageListProps {
  messages: Record<string, Message>;
  visibleData: string[];
  isNewlyLoaded: (index: number) => boolean;
  getMessageClassName: (isNew: boolean) => string;
  maxWidth?: number;
  showTimestamps?: boolean;
  showAvatars?: boolean;
  userProfile?: UserProfile;
  controls?: MessageControlsComponent;
  controlsContext: MessageControlsContext;
  onMessageAction: (action: MessageAction) => Promise<boolean>;
  onFilePreview?: (file: FileUploadItem) => void;
}

export const StandardMessageList: React.FC<StandardMessageListProps> = ({
  messages,
  visibleData,
  isNewlyLoaded,
  getMessageClassName,
  maxWidth,
  showTimestamps,
  showAvatars,
  userProfile,
  controls,
  controlsContext,
  onMessageAction,
  onFilePreview,
}) => {
  return (
    <>
      {visibleData.map((messageId, index) => {
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
            controlsContext={controlsContext}
            onMessageAction={onMessageAction}
            onFilePreview={onFilePreview}
            className={getMessageClassName(isNew)}
          />
        );
      })}
    </>
  );
};
