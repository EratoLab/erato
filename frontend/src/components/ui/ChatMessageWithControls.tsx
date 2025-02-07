import React, { memo } from 'react';
import { ChatMessage } from './ChatMessage';
import { MessageControls } from './MessageControls';
import { ChatMessage as ChatMessageType } from '../containers/ChatProvider';
import clsx from 'clsx';

interface ChatMessageWithControlsProps {
  message: ChatMessageType;
  className?: string;
  maxWidth?: number;
  showTimestamp?: boolean;
  showAvatar?: boolean;
  showControlsOnHover?: boolean;
  onCopy?: () => void;
  onEdit?: () => void;
  onLike?: () => void;
  onDislike?: () => void;
  onRerun?: () => void;
}

export const ChatMessageWithControls = memo(function ChatMessageWithControls({
  message,
  className,
  maxWidth,
  showTimestamp = true,
  showAvatar = false,
  showControlsOnHover = true,
  onCopy,
  onEdit,
  onLike,
  onDislike,
  onRerun,
}: ChatMessageWithControlsProps) {
  const isUser = message.sender === 'user';

  return (
    <div className={clsx('relative group', className)}>
      <ChatMessage
        message={message}
        maxWidth={maxWidth}
        showTimestamp={showTimestamp}
        showAvatar={showAvatar}
      />
      
      <MessageControls
        isUser={isUser}
        showOnHover={showControlsOnHover}
        onCopy={onCopy}
        onEdit={isUser ? onEdit : undefined}
        onLike={!isUser ? onLike : undefined}
        onDislike={!isUser ? onDislike : undefined}
        onRerun={!isUser ? onRerun : undefined}
        className="z-10"
      />
    </div>
  );
}); 