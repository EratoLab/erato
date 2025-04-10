import { faker } from "@faker-js/faker";

interface ChatMessage {
  id: string;
  content: string;
  sender: "user" | "assistant" | "system";
  role: "user" | "assistant" | "system";
  createdAt: string;
  authorId: string;
  status?: "sending" | "complete" | "error";
  previous_message_id?: string;
}

// Factory function to create a chat message
const createChatMessage = (overrides?: Partial<ChatMessage>): ChatMessage => {
  const sender = overrides?.sender ?? "assistant";
  return {
    id: faker.string.uuid(),
    content: faker.lorem.paragraph(),
    sender: sender,
    role: sender,
    createdAt: overrides?.createdAt ?? faker.date.recent().toISOString(),
    authorId: sender === "user" ? "user_1" : "assistant_1",
    ...overrides,
  };
};

// Export factory for use in stories
export const ChatMessageFactory = {
  create: createChatMessage,

  // Convenience methods for common scenarios
  createUserMessage: (overrides?: Partial<ChatMessage>) =>
    createChatMessage({ sender: "user", ...overrides }),

  createBotMessage: (overrides?: Partial<ChatMessage>) =>
    createChatMessage({ sender: "assistant", ...overrides }),

  // Sample messages for quick reference
  samples: {
    user: createChatMessage({
      id: "1",
      content:
        "Hello! I have a question about implementing the new theme system.",
      sender: "user",
      createdAt: new Date(2024, 0, 1, 12, 0).toISOString(),
    }),

    assistant: createChatMessage({
      id: "2",
      content:
        "I'd be happy to help you with the theme system implementation. What specific aspects would you like to know more about?",
      sender: "assistant",
      createdAt: new Date(2024, 0, 1, 12, 1).toISOString(),
    }),

    longMessage: createChatMessage({
      id: "3",
      content:
        "This is a very long message that should demonstrate how the component handles text wrapping and spacing. It contains multiple sentences and should span multiple lines when rendered in the UI. This helps us verify that the layout remains consistent with longer content.",
      sender: "assistant",
      createdAt: new Date(2024, 0, 1, 12, 2).toISOString(),
    }),
  },
};
