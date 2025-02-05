import React, { useState, KeyboardEvent } from 'react';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  className = '',
  placeholder = 'Type a message...',
  disabled = false,
  isLoading = false,
}) => {
  const [message, setMessage] = useState('');

  const handleSubmit = () => {
    const trimmedMessage = message.trim();
    if (trimmedMessage && !disabled) {
      onSendMessage(trimmedMessage);
      setMessage('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form 
      className={`flex items-end gap-2 p-4 border-t ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <textarea
        className="flex-1 resize-none rounded-lg border p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        rows={1}
        placeholder={placeholder}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled || isLoading}
        aria-label="Chat message"
      />
      <button
        type="submit"
        className={`px-4 py-2 rounded-lg bg-blue-500 text-white 
          ${(disabled || isLoading) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'}
        `}
        disabled={disabled || isLoading}
        aria-busy={isLoading}
      >
        {isLoading ? 'Sending...' : 'Send'}
      </button>
    </form>
  );
}; 