import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { action } from "@storybook/addon-actions";
import { ChatHistorySidebar } from "../../components/ui/ChatHistorySidebar";
import type { ChatSession } from "../../types/chat";
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

// Interactive story with state management
const InteractiveTemplate = (
  args: React.ComponentProps<typeof ChatHistorySidebar>,
) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <ChatHistorySidebar
      {...args}
      collapsed={isCollapsed}
      onToggleCollapse={() => {
        setIsCollapsed(!isCollapsed);
        action("Sidebar toggled")(isCollapsed ? "expanded" : "collapsed");
      }}
      onNewChat={() => action("New chat clicked")()}
      sessions={mockSessions}
      currentSessionId="1"
      onSessionSelect={(id) => action("Session selected")(id)}
      onSessionDelete={(id) => action("Session deleted")(id)}
      isLoading={false}
    />
  );
};

export const Interactive: Story = {
  render: InteractiveTemplate,
  args: {
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: action("Session selected"),
    onSessionDelete: action("Session deleted"),
    isLoading: false,
    showTitle: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Interactive example with working collapse behavior and new chat functionality.",
      },
    },
  },
};

// Update the stories to pass required props directly
export const Default: Story = {
  args: {
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: action("Session selected"),
    onSessionDelete: action("Session deleted"),
    isLoading: false,
    showTitle: false,
  },
};

export const Collapsed: Story = {
  args: {
    collapsed: true,
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
    showTitle: false,
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: action("Session selected"),
    onSessionDelete: action("Session deleted"),
    isLoading: false,
  },
};

export const WithTitle: Story = {
  args: {
    showTitle: true,
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: action("Session selected"),
    onSessionDelete: action("Session deleted"),
    isLoading: false,
  },
};

export const Loading: Story = {
  args: {
    onNewChat: action("New chat clicked"),
    onToggleCollapse: action("Sidebar toggled"),
    sessions: [],
    currentSessionId: null,
    onSessionSelect: action("Session selected"),
    onSessionDelete: action("Session deleted"),
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    sessions: [],
    currentSessionId: null,
    onSessionSelect: action("Session selected"),
    onSessionDelete: action("Session deleted"),
    isLoading: false,
    showTitle: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Empty state when there are no chat sessions and loading is complete.",
      },
    },
  },
};
