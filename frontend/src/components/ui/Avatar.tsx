import React, { memo } from 'react';
import clsx from 'clsx';
import { messageStyles } from './styles/chatMessageStyles';

interface AvatarProps {
  role: 'user' | 'assistant';
  isUser: boolean;
}

export const Avatar = memo(function Avatar({ role, isUser }: AvatarProps) {
  return (
    <div 
      className={clsx(
        'w-8 h-8 rounded flex items-center justify-center shrink-0',
        messageStyles.avatar[role]
      )}
      aria-hidden="true"
    >
      {isUser ? 'U' : 'A'}
    </div>
  );
}); 