import { ChatMessage } from '../../components/containers/ChatProvider';

export const mockMessages = {
  user: {
    id: '1',
    content: 'Hello! I have a question about implementing the new theme system.',
    sender: 'user',
    createdAt: new Date(2024, 0, 1, 12, 0),
  } as ChatMessage,
  
  assistant: {
    id: '2',
    content: 'I\'d be happy to help you with the theme system implementation. What specific aspects would you like to know more about?',
    sender: 'bot',
    createdAt: new Date(2024, 0, 1, 12, 1),
  } as ChatMessage,
  
  longMessage: {
    id: '3',
    content: 'This is a very long message that should demonstrate how the component handles text wrapping and spacing. It contains multiple sentences and should span multiple lines when rendered in the UI. This helps us verify that the layout remains consistent with longer content.',
    sender: 'bot',
    createdAt: new Date(2024, 0, 1, 12, 2),
  } as ChatMessage,
}; 