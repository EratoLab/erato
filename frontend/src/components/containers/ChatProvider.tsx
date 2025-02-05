import React, { createContext, useContext, useState, useCallback } from 'react';

// TODO: move later to types folder, that we can align with what we have from the backend programmaticaly
/**
 * ChatMessage represents a single chat message.
 */
export interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  content: string;
  createdAt: Date;
}

interface MessageMap {
  [messageId: string]: ChatMessage;
}

/**
 * ChatContextType describes the shape of the chat state and actions.
 */
export interface ChatContextType {
  messages: MessageMap;
  messageOrder: string[];  // Preserve message order
  sendMessage: (message: string) => void;
  updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void;
}

/**
 * Create the ChatContext with no default value, forcing consumers to wrap in ChatProvider.
 */
const ChatContext = createContext<ChatContextType | undefined>(undefined);

/**
 * ChatProvider is responsible for managing and providing chat state logic.
 */
export const ChatProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [messages, setMessages] = useState<MessageMap>({});
  const [messageOrder, setMessageOrder] = useState<string[]>([]);

  const updateMessage = useCallback((messageId: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => ({
      ...prev,
      [messageId]: { ...prev[messageId], ...updates }
    }));
  }, []);

  /**
   * sendMessage adds the user's new message to the state.
   * Later on, we can integrate websocket functionality here to stream responses.
   */
  const sendMessage = (content: string) => {
    const id = new Date().toISOString();
    const newMessage: ChatMessage = {
      id,
      sender: 'user',
      content,
      createdAt: new Date(),
    };
    
    setMessages(prev => ({
      ...prev,
      [id]: newMessage
    }));
    setMessageOrder(prev => [...prev, id]);

    // TODO: Integrate websocket call to send the message and handle a streaming response.
  };

  return (
    <ChatContext.Provider value={{ 
      messages, 
      messageOrder,
      sendMessage,
      updateMessage 
    }}>
      {children}
    </ChatContext.Provider>
  );
};

/**
 * useChat is a custom hook that provides easy access to the ChatContext.
 * Ensure that you call this hook within a component wrapped by <ChatProvider>.
 */
export const useChat = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}; 