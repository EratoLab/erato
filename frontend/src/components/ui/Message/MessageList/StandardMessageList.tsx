import React from "react";

import { MessageItem } from "./MessageItem";

import type { ChatMessage as ChatMessageType } from "../../../containers/ChatProvider";
import type { UserProfile } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";

interface StandardMessageListProps {
  messages: Record<string, ChatMessageType>;
  visibleData: string[];
  isNewlyLoaded: (index: number) => boolean;
  getMessageClassName: (isNew: boolean) => string;
  maxWidth?: number;
  showTimestamps?: boolean;
  showAvatars?: boolean;
  userProfile?: UserProfile;
  controls?: MessageControlsComponent;
  controlsContext: MessageControlsContext;
  onMessageAction: (action: MessageAction) => Promise<void>;
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
            className={getMessageClassName(isNew)}
          />
        );
      })}
    </>
  );
};
