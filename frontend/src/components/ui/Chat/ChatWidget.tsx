import { t } from "@lingui/core/macro";
import { useRef } from "react";

import { mapMessageToUiMessage } from "@/utils/adapters/messageAdapter";

import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { ChatErrorBoundary } from "../Feedback/ChatErrorBoundary";

import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "../../../types/message-controls";
import type { Message } from "@/types/chat";
import type React from "react";

interface ChatWidgetProps {
  className?: string;
  showControlsOnHover?: boolean;
  showAvatars?: boolean;
  showTimestamps?: boolean;
  controls?: MessageControlsComponent;
  controlsContext: MessageControlsContext;
  onMessageAction?: (action: MessageAction) => Promise<boolean>;
  onSendMessage: (message: string) => void;
  onRegenerate?: () => void;
  messages: Message[];
  isLoading?: boolean;
  onErrorReset?: () => void;
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
  onErrorReset,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  return (
    <ChatErrorBoundary onReset={onErrorReset}>
      <div
        className={`flex h-full flex-col ${className}`}
        role="region"
        aria-label={t`Chat messages`}
      >
        <div className="flex-1 overflow-y-auto p-4">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={mapMessageToUiMessage(message)}
              className="mb-4"
              showAvatar={showAvatars}
              showTimestamp={showTimestamps}
              controls={controls}
              controlsContext={controlsContext}
              onMessageAction={onMessageAction ?? (async () => false)}
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
    </ChatErrorBoundary>
  );
};
