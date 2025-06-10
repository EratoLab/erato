import { action } from "@storybook/addon-actions";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
} from "@tanstack/react-query";
import { useState } from "react";

import { Chat } from "../../components/ui/Chat/Chat";
import { MockDataGenerator } from "../../mocks/mockDataGenerator";

import type {
  ContentPart,
  ContentPartText,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";
import type { MessageAction } from "@/types/message-controls";
import type { Meta, StoryObj } from "@storybook/react";
import type { QueryKey } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Define ChatMessage type locally
interface ChatMessage {
  id: string;
  content: string;
  sender: "user" | "assistant" | "system";
  createdAt: string;
  authorId: string;
  role: "user" | "assistant" | "system";
}

// Mock providers
const ChatProvider = ({
  children,
}: {
  children: ReactNode;
  initialMessages?: Record<string, ChatMessage>;
  initialMessageOrder?: string[];
}) => {
  return <>{children}</>;
};

const MessageStreamProvider = ({ children }: { children: ReactNode }) => {
  return <>{children}</>;
};

const ProfileProvider = ({ children }: { children: ReactNode }) => {
  return <>{children}</>;
};

const SidebarProvider = ({ children }: { children: ReactNode }) => {
  return <>{children}</>;
};

// Create ChatHistoryContext
const ChatHistoryContext = {
  Provider: ({ children }: { children: ReactNode; value: unknown }) => {
    return <>{children}</>;
  },
};

// Extend the Window interface for our debugging property
interface ExtendedWindow extends Window {
  __lastFailedQueryKey?: QueryKey;
}

/**
 * Safely transforms any value into a valid Date object
 * If the input is invalid, returns the current date
 */
const ensureValidDate = (dateInput: unknown): Date => {
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? new Date() : dateInput;
  }

  try {
    const dateObj = new Date(dateInput as string | number);
    return isNaN(dateObj.getTime()) ? new Date() : dateObj;
  } catch {
    return new Date();
  }
};

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
    queryCache: new QueryCache({
      // Add a custom onError handler to debug 404 errors in Storybook
      onError: (error, query) => {
        if (error instanceof Error && error.message.includes("404")) {
          console.warn("404 Error caught for query:", query.queryKey);
          console.warn("Consider adding this query pattern to your mock setup");

          // For debugging - you can add this to expose the queryKey to the window
          // This helps when troubleshooting in the browser console
          (window as ExtendedWindow).__lastFailedQueryKey = query.queryKey;
        }
      },
    }),
  });

// Generate mock data using our reusable generator
const mockData = MockDataGenerator.createMockDataset(5, 5);

/**
 * Extracts text content from ContentPart array
 * @param content Array of ContentPart objects (optional)
 * @returns Combined text from all text parts
 */
function extractTextFromContent(content?: ContentPart[] | null): string {
  if (!content || !Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part) => part.content_type === "text")
    .map((part) => (part as ContentPartText).text)
    .join("");
}

// Transform API messages to the format expected by ChatProvider
const transformApiMessagesToChat = (
  apiMessages: (typeof mockData.messages)[string],
): Record<string, ChatMessage> => {
  const chatMessages: Record<string, ChatMessage> = {};

  apiMessages.forEach((apiMsg) => {
    // Ensure created_at is a valid date using our utility function
    const createdAt = ensureValidDate(apiMsg.created_at);

    chatMessages[apiMsg.id] = {
      id: apiMsg.id,
      content: extractTextFromContent(apiMsg.content),
      sender: apiMsg.role as "user" | "assistant",
      createdAt: createdAt.toISOString(),
      authorId:
        apiMsg.role === "user"
          ? mockData.profiles.user.id
          : mockData.profiles.assistant.id,
      role: apiMsg.role as "user" | "assistant" | "system",
    };
  });

  return chatMessages;
};

// Get the first chat for the default view
const defaultChatId = mockData.chats[0].id;

const meta: Meta<typeof Chat> = {
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

      // Add additional mocking for the specific query patterns used by the application
      // This is important to prevent 404 errors
      mockData.chats.forEach((chat) => {
        const messagesResponse = mockData.getChatMessagesResponse(chat.id);

        // Ensure messages have valid dates
        messagesResponse.messages = messagesResponse.messages.map((msg) => {
          const msgCopy = { ...msg };
          msgCopy.created_at = ensureValidDate(msg.created_at).toISOString();
          msgCopy.updated_at = ensureValidDate(msg.updated_at).toISOString();
          return msgCopy;
        });

        // Mock the specific query pattern that's causing the 404
        queryClient.setQueryData(
          [
            "api",
            "v1beta",
            "chats",
            chat.id,
            "messages",
            { limit: 6, offset: 0 },
          ],
          messagesResponse,
        );

        // Mock for sessionId parameter - this is also used in the app
        queryClient.setQueryData(
          ["api", "v1beta", "messages", { sessionId: chat.id }],
          messagesResponse,
        );
      });

      // State for currently selected chat
      const [selectedChatId, setSelectedChatId] = useState(defaultChatId);
      const [chatSessions] = useState<ChatSession[]>(
        mockData.chats.map((chat) => {
          return {
            id: chat.id,
            title: chat.title_by_summary || "Untitled Chat",
            messages: [],
            createdAt: new Date().toISOString(), // Convert to string
            updatedAt: ensureValidDate(chat.last_message_at).toISOString(), // Convert to string
          };
        }),
      );

      // Create chat messages for the initially selected chat (current session)
      // Make sure these date formats match what the API would return
      const selectedChatMessages = transformApiMessagesToChat(
        mockData.messages[selectedChatId],
      );
      const selectedMessageOrder = mockData.messages[selectedChatId].map(
        (msg) => msg.id,
      );

      // Manually add specific data for the initial messages endpoint
      // This is crucial to prevent the 404 error on first load
      const defaultChatMessagesResponse =
        mockData.getChatMessagesResponse(defaultChatId);
      // Ensure dates are valid
      defaultChatMessagesResponse.messages =
        defaultChatMessagesResponse.messages.map((msg) => {
          const msgCopy = { ...msg };
          msgCopy.created_at = ensureValidDate(msg.created_at).toISOString();
          msgCopy.updated_at = ensureValidDate(msg.updated_at).toISOString();
          return msgCopy;
        });

      // Set up the specific endpoint that's used when loading the initial chat
      queryClient.setQueryData(
        [
          "api",
          "v1beta",
          "messages",
          { sessionId: defaultChatId, limit: 6, offset: 0 },
        ],
        defaultChatMessagesResponse,
      );

      // Mock the ChatHistoryProvider with a custom implementation
      const chatHistoryValue = {
        sessions: chatSessions,
        currentSessionId: selectedChatId,
        createSession: () => {
          action("createSession")();
          return "new-session-id";
        },
        updateSession: (sessionId: string, updates: Partial<ChatSession>) => {
          action("updateSession")(sessionId, updates);
        },
        deleteSession: (sessionId: string) => {
          action("deleteSession")(sessionId);
        },
        switchSession: (sessionId: string) => {
          action("switchSession")(sessionId);

          // Update the selected chat ID
          setSelectedChatId(sessionId);

          // Update the query client with the messages for the selected chat
          // This simulates what happens in the real app when a user clicks on a chat
          const messagesResponse = mockData.getChatMessagesResponse(sessionId);

          // Ensure message dates are valid before setting in the query client
          messagesResponse.messages = messagesResponse.messages.map((msg) => {
            // Make a copy of the message to avoid modifying the original
            const msgCopy = { ...msg };

            // Use our safe date utility to ensure valid dates
            msgCopy.created_at = ensureValidDate(msg.created_at).toISOString();
            msgCopy.updated_at = ensureValidDate(msg.updated_at).toISOString();

            return msgCopy;
          });

          // Update the query client with the new messages for this chat
          // Use all common query key formats that might be used in the application
          queryClient.setQueryData(
            ["api", "v1beta", "chats", sessionId, "messages"],
            messagesResponse,
          );

          // Set the data with common query params variations
          [6, 10, 20, 50, 100].forEach((limit) => {
            // Mock for limit only
            queryClient.setQueryData(
              ["api", "v1beta", "chats", sessionId, "messages", { limit }],
              messagesResponse,
            );

            // Mock for limit and offset combinations
            [0, 6, 10, 20].forEach((offset) => {
              queryClient.setQueryData(
                [
                  "api",
                  "v1beta",
                  "chats",
                  sessionId,
                  "messages",
                  { limit, offset },
                ],
                messagesResponse,
              );
            });
          });

          // Update the currentSessionId in the query client
          queryClient.setQueryData(["currentSessionId"], sessionId);
        },
        getCurrentSession: () =>
          chatSessions.find((s) => s.id === selectedChatId) ?? null,
        confirmSession: (tempId: string, permanentId: string) => {
          action("confirmSession")(tempId, permanentId);
        },
        loadMoreChats: async () => {
          action("loadMoreChats")();
          return Promise.resolve();
        },
        hasMoreChats: false,
        isLoading: false,
        isPending: false,
        error: undefined,
        refreshChats: async () => {
          action("refreshChats")();
          return Promise.resolve();
        },
      };

      return (
        <QueryClientProvider client={queryClient}>
          <ProfileProvider>
            <ChatHistoryContext.Provider value={chatHistoryValue}>
              <MessageStreamProvider>
                <ChatProvider
                  initialMessages={selectedChatMessages}
                  initialMessageOrder={selectedMessageOrder}
                  key={selectedChatId}
                >
                  <div className="mx-auto h-screen w-full max-w-6xl">
                    <Story />
                  </div>
                </ChatProvider>
              </MessageStreamProvider>
            </ChatHistoryContext.Provider>
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
};

export default meta;
type Story = StoryObj<typeof meta>;

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
    onMessageAction: async (messageAction: MessageAction) => {
      // Call the Storybook action logger
      action("message action")(messageAction);
      // Return true to satisfy the Promise<boolean> type
      return true;
    },
    onNewChat: action("new chat"),
    onRegenerate: action("regenerate"),
  },
  render: function Wrapper(args) {
    // Get the messages and message order from the context
    const selectedChatMessages = transformApiMessagesToChat(
      mockData.messages[defaultChatId],
    );
    const selectedMessageOrder = mockData.messages[defaultChatId].map(
      (msg) => msg.id,
    );

    return (
      <SidebarProvider>
        <Chat
          {...args}
          messages={selectedChatMessages}
          messageOrder={selectedMessageOrder}
          controlsContext={args.controlsContext}
        />
      </SidebarProvider>
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
