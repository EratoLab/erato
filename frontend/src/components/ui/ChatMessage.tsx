import React, { memo } from 'react';
import { ChatMessage as ChatMessageType } from '../containers/ChatProvider';
import clsx from 'clsx';
import { messageStyles } from './styles/chatMessageStyles';
import { Avatar } from './Avatar';
import { MessageContent } from './MessageContent';
import { MessageTimestamp } from './MessageTimestamp';
import { LoadingIndicator } from './LoadingIndicator';

export interface ChatMessageProps {
  message: ChatMessageType;
  className?: string;
  /**
   * Maximum width of the message container in pixels
   * @default 768 (max-w-3xl)
   */
  maxWidth?: number;
  /**
   * Whether to show the timestamp
   * @default true
   */
  showTimestamp?: boolean;
  /**
   * Whether to show the avatar
   * @default false
   */
  showAvatar?: boolean;
}

export const ChatMessage = memo(function ChatMessage({ 
  message,
  className = '',
  maxWidth = 768,
  showTimestamp = true,
  showAvatar = false,
}: ChatMessageProps) {
  const isUser = message.sender === 'user';
  const role = isUser ? 'user' : 'assistant';
  
  // Content validation
  if (!message?.content && !message?.loading) {
    return null;
  }

  return (
    <div 
      className={clsx(
        'relative flex gap-4 p-4 rounded-lg',
        'min-w-[280px] w-full shrink-0',
        messageStyles.container[role],
        className
      )}
      style={{ 
        maxWidth: maxWidth ? `${maxWidth}px` : undefined,
        width: maxWidth ? `${maxWidth}px` : undefined
      }}
      role="log"
      aria-live="polite"
      aria-label={`${isUser ? 'Your' : 'Assistant'} message`}
    >
      <div className="w-full flex gap-6">
        {showAvatar && (
          <Avatar role={role} isUser={isUser} />
        )}

        <div className="min-w-0 flex-1 break-words">
          <div className="font-semibold mb-1 text-sm text-theme-fg-primary">
            {isUser ? 'You' : 'Assistant'}
          </div>
          
          <MessageContent content={message.content} />
          
          {message.loading && (
            <div className="mt-2">
              <LoadingIndicator 
                state={message.loading.state}
                context={message.loading.context}
              />
            </div>
          )}
          
          {showTimestamp && (
            <MessageTimestamp createdAt={message.createdAt} />
          )}
        </div>
      </div>
    </div>
  );
});

// Add display name for better debugging
ChatMessage.displayName = 'ChatMessage'; 