import { action } from "@storybook/addon-actions";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
} from "@tanstack/react-query";
import { useState } from "react";

import { ChatHistoryProvider } from "../../components/containers/ChatHistoryProvider";
import { ChatProvider } from "../../components/containers/ChatProvider";
import { MessageStreamProvider } from "../../components/containers/MessageStreamProvider";
import { ProfileProvider } from "../../components/containers/ProfileProvider";
import { Chat } from "../../components/ui/Chat/Chat";
import { MockDataGenerator } from "../../mocks/mockDataGenerator";

import type { ChatMessage } from "../../components/containers/ChatProvider";
import type { Meta, StoryObj } from "@storybook/react";

// Create a test QueryClient factory function
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
      },
    },
    queryCache: new QueryCache(),
  });

// Generate mock data using our reusable generator
const mockData = MockDataGenerator.createMockDataset(5, 5);

// Transform API messages to the format expected by ChatProvider
const transformApiMessagesToChat = (
  apiMessages: (typeof mockData.messages)[string],
): Record<string, ChatMessage> => {
  const chatMessages: Record<string, ChatMessage> = {};

  apiMessages.forEach((apiMsg) => {
    chatMessages[apiMsg.id] = {
      id: apiMsg.id,
      content: apiMsg.full_text,
      sender: apiMsg.role as "user" | "assistant",
      createdAt: new Date(apiMsg.created_at),
      authorId:
        apiMsg.role === "user"
          ? mockData.profiles.user.id
          : mockData.profiles.assistant.id,
    };
  });

  return chatMessages;
};

// Get the first chat for the default view
const defaultChatId = mockData.chats[0].id;
const defaultChatMessages = transformApiMessagesToChat(
  mockData.messages[defaultChatId],
);
const defaultMessageOrder = mockData.messages[defaultChatId].map(
  (msg) => msg.id,
);

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
    (Story) => {
      // Create a fresh QueryClient for each story
      const queryClient = createTestQueryClient();

      // Use the helper method to populate the entire QueryClient with mock data
      MockDataGenerator.populateQueryClient(queryClient, mockData);

      return (
        <QueryClientProvider client={queryClient}>
          <ProfileProvider>
            <ChatHistoryProvider>
              <MessageStreamProvider>
                <ChatProvider
                  initialMessages={defaultChatMessages}
                  initialMessageOrder={defaultMessageOrder}
                >
                  <div className="mx-auto h-screen w-full max-w-6xl">
                    <Story />
                  </div>
                </ChatProvider>
              </MessageStreamProvider>
            </ChatHistoryProvider>
          </ProfileProvider>
        </QueryClientProvider>
      );
    },
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
      currentUserId: mockData.profiles.user.id,
      dialogOwnerId: mockData.profiles.user.id,
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

// Add a story with different data variations - more messages
export const LongConversation: Story = {
  ...Default,
  parameters: {
    reactQuery: {
      createQueryClient: () => {
        // Create a new dataset with more messages per chat
        const longMockData = MockDataGenerator.createMockDataset(5, 15);
        const queryClient = createTestQueryClient();

        // Use the helper method to populate the QueryClient with all the mock data
        MockDataGenerator.populateQueryClient(queryClient, longMockData);

        return queryClient;
      },
    },
  },
  decorators: [
    (Story) => {
      // Create a long conversation dataset
      const longMockData = MockDataGenerator.createMockDataset(1, 15);
      const chatId = longMockData.chats[0].id;
      const chatMessages = transformApiMessagesToChat(
        longMockData.messages[chatId],
      );
      const messageOrder = longMockData.messages[chatId].map((msg) => msg.id);

      return (
        <ChatProvider
          initialMessages={chatMessages}
          initialMessageOrder={messageOrder}
        >
          <Story />
        </ChatProvider>
      );
    },
  ],
};

// Add a story for the compact layout variation
export const Compact: Story = {
  ...Default,
  args: {
    ...Default.args,
    layout: "compact",
    showAvatars: false,
    showTimestamps: false,
  },
};

// Add a story for the comfortable layout variation
export const Comfortable: Story = {
  ...Default,
  args: {
    ...Default.args,
    layout: "comfortable",
    showAvatars: true,
  },
};
