import React, { memo } from 'react';
import { ChatMessage as ChatMessageType } from '../containers/ChatProvider';
import clsx from 'clsx';

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
   * @default true
   */
  showAvatar?: boolean;
}

const messageStyles = {
  container: {
    user: 'bg-theme-bg-primary',
    assistant: 'bg-theme-bg-secondary',
  },
  avatar: {
    user: 'bg-[var(--theme-avatar-user-bg)] text-[var(--theme-avatar-user-fg)]',
    assistant: 'bg-[var(--theme-avatar-assistant-bg)] text-[var(--theme-avatar-assistant-fg)]',
  },
} as const;

export const ChatMessage = memo(function ChatMessage({ 
  message,
  className = '',
  maxWidth = 768,
  showTimestamp = true,
  showAvatar = true,
}: ChatMessageProps) {
  const isUser = message.sender === 'user';
  const role = isUser ? 'user' : 'assistant';
  
  return (
    <article 
      className={clsx(
        'w-full px-4 py-6',
        messageStyles.container[role],
        className
      )}
      role="log"
      aria-label={`${isUser ? 'Your' : 'Assistant'} message`}
    >
      <div 
        className="mx-auto flex gap-6"
        style={{ maxWidth: `${maxWidth}px` }}
      >
        {showAvatar && (
          <div 
            className={clsx(
              'w-8 h-8 rounded flex items-center justify-center shrink-0',
              messageStyles.avatar[role]
            )}
            aria-hidden="true"
          >
            {isUser ? 'U' : 'A'}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="font-semibold mb-1 text-sm text-theme-fg-primary">
            {isUser ? 'You' : 'Assistant'}
          </div>
          
          {/* Using article for semantic meaning of self-contained content */}
          <article className="prose prose-slate max-w-none">
            <p className="whitespace-pre-wrap break-words text-theme-fg-secondary">
              {message.content}
            </p>
          </article>
          
          {showTimestamp && (
            <time 
              className="text-xs text-theme-fg-muted mt-2 block"
              dateTime={message.createdAt.toISOString()}
              title={message.createdAt.toLocaleString()}
            >
              {message.createdAt.toLocaleTimeString()}
            </time>
          )}
        </div>
      </div>
    </article>
  );
});

// Add display name for better debugging
ChatMessage.displayName = 'ChatMessage'; 