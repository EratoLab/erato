import clsx from "clsx";
import { useCallback } from "react";

import { NO_ASSISTANT_TURNS } from "@/utils/chat/assistantTurns";
import { NO_TASK_RESULT_FOLDS } from "@/utils/chat/taskResultFolds";

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
import type { AssistantTurns } from "@/utils/chat/assistantTurns";
import type { ModelSwitch } from "@/utils/chat/modelSwitches";
import type { TaskResultFolds } from "@/utils/chat/taskResultFolds";
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
  taskResultFolds?: TaskResultFolds;
  assistantTurns?: AssistantTurns;
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
  taskResultFolds = NO_TASK_RESULT_FOLDS,
  assistantTurns = NO_ASSISTANT_TURNS,
}) => {
  // Message renderer
  const renderMessages = useCallback(() => {
    // The first drawn message heads its turn even when an older page holds the rest.
    let drawnAbove = false;
    return visibleData.map((messageId, index) => {
      if (taskResultFolds.foldedRowIds.has(messageId)) return null;
      const message = messages[messageId];
      const isNew = isNewlyLoaded(index);
      const fold = taskResultFolds.byReplyId[messageId];
      const continuesTurn =
        drawnAbove && assistantTurns.continuing.has(messageId);
      drawnAbove = true;

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
          className={clsx(
            getMessageClassName(isNew),
            continuesTurn && "pt-0",
            assistantTurns.continued.has(messageId) && "pb-0",
          )}
          continuesTurn={continuesTurn}
          allFilesById={allFilesById}
          modelSwitch={
            modelSwitches?.[messageId] ?? (fold && modelSwitches?.[fold.rowId])
          }
          taskResult={fold?.part}
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
    taskResultFolds,
    assistantTurns,
  ]);

  return (
    <div className="flex w-full flex-col space-y-1">{renderMessages()}</div>
  );
};
