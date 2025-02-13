import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { action } from "@storybook/addon-actions";
import { ChatHistorySidebar } from "../../components/ui/ChatHistorySidebar";
import type { ChatSession } from "../../types/chat";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatHistoryContext } from "../../contexts/ChatHistoryContext";

const meta = {
  title: "CHAT/ChatHistorySidebar",
  component: ChatHistorySidebar,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `
A collapsible sidebar for chat history navigation.

## Features
- Collapsible sidebar with smooth transitions
- Consistent toggle button positioning
- Optional title display
- New chat functionality
        `,
      },
      canvas: { sourceState: "hidden" },
    },
  },
  argTypes: {
    onNewChat: { action: "New chat clicked" },
    onToggleCollapse: { action: "Sidebar toggled" },
    collapsed: { control: "boolean" },
    showTitle: { control: "boolean" },
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof ChatHistorySidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockSessions: ChatSession[] = [
  {
    id: "1",
    title: "Chat about React Performance",
    messages: [],
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    metadata: {
      ownerId: "user-1",
      lastMessage: {
        content: "Let's discuss React performance optimization techniques",
        createdAt: new Date("2024-01-01"),
        sender: "user" as const,
      },
    },
  },
  {
    id: "2",
    title: "TypeScript Best Practices",
    messages: [],
    createdAt: new Date("2024-01-02"),
    updatedAt: new Date("2024-01-02"),
    metadata: {
      ownerId: "user-1",
      lastMessage: {
        content: "What are your thoughts on TypeScript strict mode?",
        createdAt: new Date("2024-01-02"),
        sender: "assistant" as const,
      },
    },
  },
];

// Create a new QueryClient instance
const queryClient = new QueryClient();

// Create a simplified mock provider for Storybook
const MockChatHistoryProvider: React.FC<{
  children: React.ReactNode;
  initialSessions: ChatSession[];
  initialSessionId: string | undefined;
  isLoading?: boolean;
}> = ({ children, initialSessions, initialSessionId, isLoading }) => {
  const contextValue = {
    sessions: initialSessions,
    currentSessionId: initialSessionId,
    createSession: () => "new-id",
    updateSession: () => {},
    deleteSession: () => {},
    switchSession: () => {},
    getCurrentSession: () =>
      initialSessions.find((s) => s.id === initialSessionId) || null,
    isLoading: isLoading || false,
  };

  return (
    <ChatHistoryContext.Provider value={contextValue}>
      {children}
    </ChatHistoryContext.Provider>
  );
};

// Update the decorator to use the mock provider
const ChatHistoryProviderDecorator = (Story: React.ComponentType) => (
  <MockChatHistoryProvider initialSessions={mockSessions} initialSessionId="1">
    <Story />
  </MockChatHistoryProvider>
);

// Interactive story with state management
const InteractiveTemplate: React.FC<typeof ChatHistorySidebar> = (args) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <MockChatHistoryProvider
      initialSessions={mockSessions}
      initialSessionId="1"
    >
      <ChatHistorySidebar
        {...args}
        collapsed={isCollapsed}
        onToggleCollapse={() => {
          setIsCollapsed(!isCollapsed);
          action("Sidebar toggled")(isCollapsed ? "expanded" : "collapsed");
        }}
        onNewChat={() => action("New chat clicked")()}
      />
    </MockChatHistoryProvider>
  );
};

export const Interactive: Story = {
  render: InteractiveTemplate,
  parameters: {
    docs: {
      description: {
        story:
          "Interactive example with working collapse behavior and new chat functionality.",
      },
    },
  },
};

// Static stories for specific states
export const Default: Story = {
  args: {
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
    showTitle: false,
  },
  decorators: [ChatHistoryProviderDecorator],
};

export const Collapsed: Story = {
  args: {
    collapsed: true,
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
    showTitle: false,
  },
  decorators: [ChatHistoryProviderDecorator],
};

export const WithTitle: Story = {
  args: {
    showTitle: true,
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
  },
  decorators: [ChatHistoryProviderDecorator],
};

export const Loading: Story = {
  args: {
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
  },
  decorators: [
    (Story) => (
      <MockChatHistoryProvider
        initialSessions={[]}
        initialSessionId={undefined}
        isLoading={true}
      >
        <Story />
      </MockChatHistoryProvider>
    ),
  ],
};
