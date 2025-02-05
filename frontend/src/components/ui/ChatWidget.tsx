import React, { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChat } from '../containers/ChatProvider';

interface ChatWidgetProps {
  className?: string;
}

export const ChatWidget: React.FC<ChatWidgetProps> = ({ className = '' }) => {
  const { messages, messageOrder, sendMessage, isLoading } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messageOrder]);

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
          />
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      <ChatInput
        onSendMessage={sendMessage}
        className="border-t bg-white"
        isLoading={isLoading}
      />
    </div>
  );
}; 