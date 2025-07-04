import { action } from "@storybook/addon-actions";
import { useState } from "react";

import { ChatHistorySidebar } from "@/components/ui";

import type { ChatSession } from "@/types/chat";
import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof ChatHistorySidebar> = {
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
};

export default meta;
type Story = StoryObj<typeof meta>;

const mockSessions: ChatSession[] = [
  {
    id: "1",
    title: "Chat about React Performance",
    messages: [],
    updatedAt: new Date("2024-01-01").toISOString(),
    metadata: {
      ownerId: "user-1",
      lastMessage: {
        content: "Let's discuss React performance optimization techniques",
        timestamp: new Date("2024-01-01").toISOString(),
      },
    },
  },
  {
    id: "2",
    title: "TypeScript Best Practices",
    messages: [],
    updatedAt: new Date("2024-01-02").toISOString(),
    metadata: {
      ownerId: "user-1",
      lastMessage: {
        content: "What are your thoughts on TypeScript strict mode?",
        timestamp: new Date("2024-01-02").toISOString(),
      },
    },
  },
];

// Interactive story with state management
const InteractiveTemplate = (args: Story["args"]) => {
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
      onSessionArchive={(id) => action("Session deleted")(id)}
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
    onSessionArchive: action("Session archived"),
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
    onSessionArchive: action("Session archived"),
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
    onSessionArchive: action("Session archived"),
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
    onSessionArchive: action("Session archived"),
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
    onSessionArchive: action("Session archived"),
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    sessions: [],
    currentSessionId: null,
    onSessionSelect: action("Session selected"),
    onSessionArchive: action("Session archived"),
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
