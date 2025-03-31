import React, { useRef } from "react";

import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";

import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "../../../types/message-controls";
import type { Message } from "@/types/chat";

interface ChatWidgetProps {
  className?: string;
  showControlsOnHover?: boolean;
  showAvatars?: boolean;
  showTimestamps?: boolean;
  controls?: MessageControlsComponent;
  controlsContext: MessageControlsContext;
  onMessageAction?: (action: MessageAction) => void | Promise<void>;
  onSendMessage: (message: string) => void;
  onRegenerate?: () => void;
  messages: Message[];
  isLoading?: boolean;
}

export const ChatWidget: React.FC<ChatWidgetProps> = ({
  className = "",
  showControlsOnHover = true,
  showAvatars = false,
  showTimestamps = true,
  controls,
  controlsContext,
  onMessageAction,
  onSendMessage,
  onRegenerate,
  messages = [],
  isLoading = false,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={`flex h-full flex-col ${className}`}
      role="region"
      aria-label="Chat messages"
    >
      <div className="flex-1 overflow-y-auto p-4">
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
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
        onSendMessage={onSendMessage}
        onRegenerate={onRegenerate}
        className="border-t bg-white"
        isLoading={isLoading}
        showFileTypes={true}
        initialFiles={[]}
      />
    </div>
  );
};
