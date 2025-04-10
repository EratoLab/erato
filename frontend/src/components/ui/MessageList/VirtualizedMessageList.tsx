import React, { useCallback, useEffect, useRef } from "react";
import { VariableSizeList as VirtualList } from "react-window";

import { MessageItem } from "./MessageItem";
import { useMessageSizeEstimation } from "./MessageListUtils";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";

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
  controlsContext: MessageControlsContext;
  onMessageAction: (action: MessageAction) => Promise<void>;
}

export const VirtualizedMessageList: React.FC<VirtualizedMessageListProps> = ({
  messages,
  visibleData,
  containerSize,
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
  // Virtual list ref for scrolling and resizing
  const listRef = useRef<VirtualList>(null);

  // Get message size estimation function
  const estimateMessageSize = useMessageSizeEstimation(messages);

  // Item size getter for variable list
  const getItemSize = useCallback(
    (index: number) => {
      const messageId = visibleData[index];
      return estimateMessageSize(messageId);
    },
    [visibleData, estimateMessageSize],
  );

  // Reset the list when message heights might have changed
  useEffect(() => {
    if (listRef.current) {
      listRef.current.resetAfterIndex(0);
    }
  }, [visibleData.length]);

  // Message renderer for virtualized list
  const renderMessage = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const messageId = visibleData[index];
      const message = messages[messageId];
      const isNew = isNewlyLoaded(index);

      return (
        <MessageItem
          messageId={messageId}
          message={message}
          isNew={isNew}
          style={style}
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
    },
    [
      visibleData,
      messages,
      isNewlyLoaded,
      getMessageClassName,
      maxWidth,
      showTimestamps,
      showAvatars,
      userProfile,
      controls,
      controlsContext,
      onMessageAction,
    ],
  );

  return (
    <VirtualList
      ref={listRef}
      height={containerSize.height || 600}
      width="100%"
      itemCount={visibleData.length}
      itemSize={getItemSize}
      overscanCount={5}
    >
      {renderMessage}
    </VirtualList>
  );
};
