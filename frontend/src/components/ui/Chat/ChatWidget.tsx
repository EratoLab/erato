import React, { useRef, useEffect } from "react";

import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { useChat } from "../../containers/ChatProvider";
import { useMessageStream } from "../../containers/MessageStreamProvider";

import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "../../../types/message-controls";

interface ChatWidgetProps {
  className?: string;
  showControlsOnHover?: boolean;
  showAvatars?: boolean;
  showTimestamps?: boolean;
  controls?: MessageControlsComponent;
  controlsContext: MessageControlsContext;
  onMessageAction?: (action: MessageAction) => void | Promise<void>;
  onAddFile?: () => void;
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
  onAddFile,
  onRegenerate,
}) => {
  const { messages, messageOrder, sendMessage, isLoading } = useChat();
  const { currentStreamingMessage } = useMessageStream();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messageOrder, currentStreamingMessage]);

  return (
    <div
      className={`flex flex-col h-full ${className}`}
      role="region"
      aria-label="Chat messages"
    >
      <div className="flex-1 overflow-y-auto p-4">
        {messageOrder.map((messageId) => (
          <ChatMessage
            key={messageId}
            message={messages[messageId]}
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
        onAddFile={onAddFile}
        onRegenerate={onRegenerate}
        className="border-t bg-white"
        isLoading={isLoading}
      />
    </div>
  );
};
