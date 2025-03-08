import { action } from "@storybook/addon-actions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { ChatMessageFactory } from "./mockData";
import { ChatHistoryProvider } from "../../components/containers/ChatHistoryProvider";
import { ChatProvider } from "../../components/containers/ChatProvider";
import { Chat } from "../../components/ui/Chat/Chat";

import type { Meta, StoryObj } from "@storybook/react";

// Create a new client for Storybook
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const mockMessages = {
  "1": ChatMessageFactory.samples.assistant,
  "2": ChatMessageFactory.samples.user,
  "3": ChatMessageFactory.samples.longMessage,
};

const mockOrder = ["1", "2", "3"];

const meta = {
  title: "Chat/Chat",
  component: Chat,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Complete chat interface with messages and controls",
      },
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <ChatHistoryProvider>
          <ChatProvider
            initialMessages={mockMessages}
            initialMessageOrder={mockOrder}
          >
            <div className="mx-auto h-screen w-full max-w-6xl">
              <Story />
            </div>
          </ChatProvider>
        </ChatHistoryProvider>
      </QueryClientProvider>
    ),
  ],
  argTypes: {
    layout: {
      control: "select",
      options: ["default", "compact", "comfortable"],
    },
    showAvatars: { control: "boolean" },
    showTimestamps: { control: "boolean" },
  },
} satisfies Meta<typeof Chat>;

export default meta;
type Story = StoryObj<typeof Chat>;

export const Default: Story = {
  args: {
    layout: "default",
    showAvatars: true,
    showTimestamps: true,
    controlsContext: {
      currentUserId: "user_1",
      dialogOwnerId: "user_1",
      isSharedDialog: false,
    },
    onMessageAction: action("message action"),
    onNewChat: action("new chat"),
    onRegenerate: action("regenerate"),
  },
  render: function Wrapper(args) {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    return (
      <Chat
        {...args}
        sidebarCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
    );
  },
};

export const Compact: Story = {
  args: {
    ...Default.args,
    layout: "compact",
    showAvatars: false,
    showTimestamps: false,
  },
};

export const Comfortable: Story = {
  args: {
    ...Default.args,
    layout: "comfortable",
    showAvatars: true,
  },
};
