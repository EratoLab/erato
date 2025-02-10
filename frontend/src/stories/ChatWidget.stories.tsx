import type { Meta, StoryObj } from "@storybook/react";
import { ChatWidget } from "../components/ui/ChatWidget";
import { ChatProvider } from "../components/containers/ChatProvider";
import type { ChatMessage } from "../components/containers/ChatProvider";

const mockMessages: Record<string, ChatMessage> = {
  "1": {
    id: "1",
    content: "Hello! How can I help you today?",
    sender: "assistant",
    createdAt: new Date(2024, 0, 1, 12, 0),
  },
  "2": {
    id: "2",
    content: "I have a question about my account",
    sender: "user",
    createdAt: new Date(2024, 0, 1, 12, 1),
  },
  "3": {
    id: "3",
    content: "Sure, I'd be happy to help with any account-related questions.",
    sender: "assistant",
    createdAt: new Date(2024, 0, 1, 12, 2),
  },
};

const mockMessageOrder = ["1", "2", "3"];

const meta = {
  title: "Containers/ChatWidget",
  component: ChatWidget,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <ChatProvider
        initialMessages={mockMessages}
        initialMessageOrder={mockMessageOrder}
      >
        <div className="w-[400px] h-[400px]">
          <Story />
        </div>
      </ChatProvider>
    ),
  ],
} satisfies Meta<typeof ChatWidget>;

export default meta;
type Story = StoryObj<typeof ChatWidget>;

export const Empty: Story = {
  decorators: [
    (Story) => (
      <ChatProvider>
        <div className="w-[400px] h-[400px]">
          <Story />
        </div>
      </ChatProvider>
    ),
  ],
};

export const WithConversation: Story = {};
