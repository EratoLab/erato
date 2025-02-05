import React from 'react';
import { ChatMessage as ChatMessageType } from '../containers/ChatProvider';

interface ChatMessageProps {
  message: ChatMessageType;
  className?: string;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ 
  message,
  className = ''
}) => {
  const isUser = message.sender === 'user';
  
  return (
    <article 
      className={`
        w-full px-4 py-6 
        ${isUser ? 'bg-white' : 'bg-gray-50'} 
        ${className}
      `}
      role="log"
      aria-label={`${isUser ? 'Your' : 'Assistant'} message`}
    >
      <div className="max-w-3xl mx-auto flex gap-6">
        {/* Avatar placeholder - replace with actual avatar component later */}
        <div className={`
          w-8 h-8 rounded flex items-center justify-center shrink-0
          ${isUser ? 'bg-gray-300' : 'bg-teal-600 text-white'}
        `}>
          {isUser ? 'U' : 'A'}
        </div>

        <div className="min-w-0 flex-1">
          <div className="font-semibold mb-1 text-sm">
            {isUser ? 'You' : 'Assistant'}
          </div>
          <div className="prose prose-slate max-w-none">
            <p className="whitespace-pre-wrap break-words text-gray-800">
              {message.content}
            </p>
          </div>
          <time 
            className="text-xs text-gray-400 mt-2 block"
            dateTime={message.createdAt.toISOString()}
          >
            {message.createdAt.toLocaleTimeString()}
          </time>
        </div>
      </div>
    </article>
  );
}; 