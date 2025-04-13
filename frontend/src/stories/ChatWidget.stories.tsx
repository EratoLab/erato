import { action } from "@storybook/addon-actions";

import { ChatWidget } from "../components/ui/Chat/ChatWidget";
import { DefaultMessageControls } from "../components/ui/Message/DefaultMessageControls";

import type { Message } from "@/types/chat";
import type { MessageAction } from "@/types/message-controls";
import type { Meta, StoryObj } from "@storybook/react";

const mockMessages: Message[] = [
  {
    id: "1",
    role: "assistant",
    content: "Hello! How can I help you today?",
    createdAt: new Date(2024, 0, 1, 12, 0).toISOString(),
  },
  {
    id: "2",
    role: "user",
    content: "I have a question about my account",
    createdAt: new Date(2024, 0, 1, 12, 1).toISOString(),
  },
  {
    id: "3",
    role: "assistant",
    content: "Sure, I'd be happy to help with any account-related questions.",
    createdAt: new Date(2024, 0, 1, 12, 2).toISOString(),
  },
];

const meta: Meta<typeof ChatWidget> = {
  title: "UI/ChatWidget",
  component: ChatWidget,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="size-[400px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    messages: [],
    onSendMessage: action("message sent"),
    onRegenerate: action("regenerate"),
    isLoading: false,
    controlsContext: {
      currentUserId: "user-123",
      dialogOwnerId: "user-123",
      isSharedDialog: false,
    },
    controls: DefaultMessageControls,
    onMessageAction: async (msgAction: MessageAction) => {
      action("message action")(msgAction);
      return true;
    },
  },
};

export const WithConversation: Story = {
  args: {
    messages: mockMessages,
    onSendMessage: action("message sent"),
    onRegenerate: action("regenerate"),
    isLoading: false,
    controlsContext: {
      currentUserId: "user-123",
      dialogOwnerId: "user-123",
      isSharedDialog: false,
    },
    controls: DefaultMessageControls,
    onMessageAction: async (msgAction: MessageAction) => {
      action("message action")(msgAction);
      return true;
    },
  },
};

export const Loading: Story = {
  args: {
    messages: mockMessages,
    onSendMessage: action("message sent"),
    onRegenerate: action("regenerate"),
    isLoading: true,
    controlsContext: {
      currentUserId: "user-123",
      dialogOwnerId: "user-123",
      isSharedDialog: false,
    },
    controls: DefaultMessageControls,
    onMessageAction: async (msgAction: MessageAction) => {
      action("message action")(msgAction);
      return true;
    },
  },
};
