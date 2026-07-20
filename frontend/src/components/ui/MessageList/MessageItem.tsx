import { memo, useState } from "react";

import { mapMessageToUiMessage } from "@/utils/adapters/messageAdapter";

import { useMessageEdit } from "./MessageEditContext";
import { MessageEditor } from "./MessageEditor";
import { ChatInputTokenUsage } from "../Chat/ChatInputTokenUsage";
import { CHAT_MESSAGE_HOST_COMPONENTS, ChatMessage } from "../Chat/ChatMessage";

import type { MessageEditContextValue } from "./MessageEditContext";
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
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";
import type { ComponentType } from "react";

export interface MessageItemProps {
  messageId: string;
  message: Message;
  isNew: boolean;
  maxWidth?: number;
  showTimestamp?: boolean;
  showAvatar?: boolean;
  userProfile?: UserProfile;
  userDisplayNameOverride?: string;
  controls?: MessageControlsComponent;
  messageRenderer?: ComponentType<ChatMessageProps>;
  controlsContext: MessageControlsContext;
  onMessageAction: (action: MessageAction) => Promise<boolean>;
  className?: string;
  onFilePreview?: (file: FileUploadItem) => void;
  onViewFeedback?: (messageId: string, feedback: MessageFeedback) => void;
  allFilesById: Record<string, FileUploadItem>;
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
    userDisplayNameOverride,
    controls: Controls,
    messageRenderer: Renderer = ChatMessage,
    controlsContext,
    onMessageAction,
    className,
    onFilePreview,
    onViewFeedback,
    allFilesById,
  }) => {
    const messageEdit = useMessageEdit();

    // Replacing the renderer (rather than editing inside it) keeps editing
    // available to kits that override ChatMessageRenderer.
    if (messageEdit?.editingMessageId === messageId) {
      return (
        <div className={className}>
          <MessageEditorRow
            message={message}
            messageEdit={messageEdit}
            messageId={messageId}
            onFilePreview={onFilePreview}
          />
        </div>
      );
    }

    return (
      <div className={className}>
        <Renderer
          key={messageId}
          message={mapMessageToUiMessage(message)}
          showTimestamp={showTimestamp}
          showAvatar={showAvatar}
          maxWidth={maxWidth}
          userProfile={userProfile}
          userDisplayNameOverride={userDisplayNameOverride}
          controls={Controls}
          controlsContext={controlsContext}
          onMessageAction={onMessageAction}
          onFilePreview={onFilePreview}
          onViewFeedback={onViewFeedback}
          allFilesById={allFilesById}
          hostComponents={CHAT_MESSAGE_HOST_COMPONENTS}
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

/**
 * Owns the draft-dependent token check for the row being edited. Separate from
 * MessageItem so the state only exists while a row is open, and so the draft
 * never lives above the row (a list-level draft would re-render every message
 * on each keystroke).
 */
const MessageEditorRow = ({
  message,
  messageEdit,
  messageId,
  onFilePreview,
}: {
  message: Message;
  messageEdit: MessageEditContextValue;
  messageId: string;
  onFilePreview?: (file: FileUploadItem) => void;
}) => {
  const [isTokenLimitExceeded, setIsTokenLimitExceeded] = useState(false);
  const messageFiles =
    (message as Message & { files?: FileUploadItem[] }).files ?? [];

  return (
    <MessageEditor
      message={message}
      onCancel={messageEdit.cancelEdit}
      onSubmit={(content, inputFileIds) =>
        messageEdit.submitEdit(messageId, content, inputFileIds)
      }
      isSubmitBlocked={isTokenLimitExceeded || messageEdit.isStreaming === true}
      initialFiles={messageFiles}
      onFilePreview={onFilePreview}
      renderTokenUsage={(draft) => (
        <ChatInputTokenUsage
          message={draft}
          attachedFiles={messageFiles}
          chatId={messageEdit.chatId}
          assistantId={messageEdit.assistantId}
          previousMessageId={message.previous_message_id}
          chatProviderId={messageEdit.chatProviderId}
          onLimitExceeded={setIsTokenLimitExceeded}
        />
      )}
    />
  );
};
