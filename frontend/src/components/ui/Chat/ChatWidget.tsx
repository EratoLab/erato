import React, { useRef, useEffect, useMemo } from "react";

import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { useChat } from "../../containers/ChatProvider";
import { useMessagingContext } from "../../containers/MessagingProvider";

import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "../../../types/message-controls";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface ChatWidgetProps {
  className?: string;
  showControlsOnHover?: boolean;
  showAvatars?: boolean;
  showTimestamps?: boolean;
  controls?: MessageControlsComponent;
  controlsContext: MessageControlsContext;
  onMessageAction?: (action: MessageAction) => void | Promise<void>;
  handleFileAttachments?: (files: FileUploadItem[]) => void;
  onRegenerate?: () => void;
}

export const ChatWidget: React.FC<ChatWidgetProps> = ({
  className = "",
  showControlsOnHover = true,
  showAvatars = false,
  showTimestamps = true,
  controls,
  controlsContext,
  onMessageAction,
  handleFileAttachments,
  onRegenerate,
}) => {
  const { messages, messageOrder, sendMessage, isPending } = useChat();
  const { currentStreamingMessageId, streamingStatus } = useMessagingContext();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Memoize the messages to display to avoid unnecessary re-renders
  const displayMessages = useMemo(() => {
    return messageOrder.map((messageId) => ({
      messageId,
      message: messages[messageId],
    }));
  }, [messageOrder, messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [displayMessages, currentStreamingMessageId, streamingStatus]);

  return (
    <div
      className={`flex h-full flex-col ${className}`}
      role="region"
      aria-label="Chat messages"
    >
      <div className="flex-1 overflow-y-auto p-4">
        {displayMessages.map(({ messageId, message }) => (
          <ChatMessage
            key={messageId}
            message={message}
            className="mb-4"
            showAvatar={showAvatars}
            showTimestamp={showTimestamps}
            controls={controls}
            controlsContext={controlsContext}
            onMessageAction={onMessageAction ?? (() => {})}
            showControlsOnHover={showControlsOnHover}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSendMessage={(message) => {
          void sendMessage(message);
        }}
        handleFileAttachments={handleFileAttachments}
        onRegenerate={onRegenerate}
        className="border-t bg-white"
        isLoading={isPending}
        showFileTypes={true}
        initialFiles={[]}
      />
    </div>
  );
};
