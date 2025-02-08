import React from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChat } from '../containers/ChatProvider';
import { useRef, useEffect } from 'react';
import clsx from 'clsx';

export interface ChatProps {
  className?: string;
  /**
   * Layout configuration
   */
  layout?: 'default' | 'compact' | 'comfortable';
  /**
   * Maximum width of messages
   */
  maxWidth?: number;
  /**
   * Whether to show avatars
   */
  showAvatars?: boolean;
  /**
   * Whether to show timestamps
   */
  showTimestamps?: boolean;
  onCopyMessage?: (messageId: string) => void;
  onLikeMessage?: (messageId: string) => void;
  onDislikeMessage?: (messageId: string) => void;
  onRerunMessage?: (messageId: string) => void;
  onNewChat?: () => void;
  onRegenerate?: () => void;
}

export const Chat = ({
  className,
  layout = 'default',
  maxWidth = 768,
  showAvatars = false,
  showTimestamps = true,
  onCopyMessage,
  onLikeMessage,
  onDislikeMessage,
  onRerunMessage,
  onNewChat,
  onRegenerate,
}: ChatProps) => {
  const { messages, messageOrder, sendMessage, isLoading } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const layoutStyles = {
    default: 'space-y-4 p-4',
    compact: 'space-y-2 p-2',
    comfortable: 'space-y-6 p-6',
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messageOrder]);

  return (
    <div 
      className={clsx(
        'flex flex-col h-full bg-theme-bg-primary',
        className
      )}
      role="region"
      aria-label="Chat conversation"
    >
      <div className={clsx(
        'flex-1 overflow-y-auto',
        'bg-theme-bg-secondary',
        layoutStyles[layout]
      )}>
        {messageOrder.map((messageId) => (
          <div 
            key={messageId}
            className="group hover:bg-theme-bg-secondary transition-colors rounded-lg"
          >
            <ChatMessage
              message={messages[messageId]}
              maxWidth={maxWidth}
              showAvatar={showAvatars}
              showTimestamp={showTimestamps}
              showControlsOnHover
              onCopy={() => onCopyMessage?.(messageId)}
              onLike={() => onLikeMessage?.(messageId)}
              onDislike={() => onDislikeMessage?.(messageId)}
              onRerun={() => onRerunMessage?.(messageId)}
            />
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      <ChatInput
        onSendMessage={sendMessage}
        className="border-t border-theme-border bg-theme-bg-primary p-4"
        isLoading={isLoading}
        showControls
        onNewChat={onNewChat}
        onRegenerate={onRegenerate}
      />
    </div>
  );
}; 