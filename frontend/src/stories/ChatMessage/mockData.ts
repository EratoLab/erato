import { faker } from '@faker-js/faker';
import { ChatMessage } from '../../components/containers/ChatProvider';

// Factory function to create a chat message
const createChatMessage = (overrides?: Partial<ChatMessage>): ChatMessage => ({
  id: faker.string.uuid(),
  content: faker.lorem.paragraph(),
  sender: 'bot',
  createdAt: faker.date.recent(),
  ...overrides
});

// Export factory for use in stories
export const ChatMessageFactory = {
  create: createChatMessage,
  
  // Convenience methods for common scenarios
  createUserMessage: (overrides?: Partial<ChatMessage>) => 
    createChatMessage({ sender: 'user', ...overrides }),
    
  createBotMessage: (overrides?: Partial<ChatMessage>) => 
    createChatMessage({ sender: 'bot', ...overrides }),
    
  // Sample messages for quick reference
  samples: {
    user: createChatMessage({
      id: '1',
      content: 'Hello! I have a question about implementing the new theme system.',
      sender: 'user',
      createdAt: new Date(2024, 0, 1, 12, 0),
    }),
    
    assistant: createChatMessage({
      id: '2',
      content: 'I\'d be happy to help you with the theme system implementation. What specific aspects would you like to know more about?',
      sender: 'bot',
      createdAt: new Date(2024, 0, 1, 12, 1),
    }),
    
    longMessage: createChatMessage({
      id: '3',
      content: 'This is a very long message that should demonstrate how the component handles text wrapping and spacing. It contains multiple sentences and should span multiple lines when rendered in the UI. This helps us verify that the layout remains consistent with longer content.',
      sender: 'bot',
      createdAt: new Date(2024, 0, 1, 12, 2),
    })
  }
}; 