import type { Meta, StoryObj } from "@storybook/react";
import {
  ChatHistoryList,
  ChatHistoryListSkeleton,
} from "../../components/ui/ChatHistoryList";
import type { ChatSession } from "../../types/chat";

const meta = {
  title: "CHAT/ChatHistoryList",
  component: ChatHistoryList,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ChatHistoryList>;

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

export const Default: Story = {
  args: {
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: (sessionId: string) =>
      console.log("Selected session:", sessionId),
    onSessionDelete: (sessionId: string) =>
      console.log("Delete session:", sessionId),
    onShowDetails: (sessionId: string) =>
      console.log("Show details for session:", sessionId),
  },
};

export const Compact: Story = {
  args: {
    ...Default.args,
    layout: "compact",
  },
};

export const Loading: Story = {
  args: {
    sessions: [],
    currentSessionId: null,
    onSessionSelect: () => {},
  },
  render: () => <ChatHistoryListSkeleton />,
};

export const LoadingCompact: Story = {
  args: {
    sessions: [],
    currentSessionId: null,
    onSessionSelect: () => {},
  },
  render: () => <ChatHistoryListSkeleton layout="compact" />,
};

export const Empty: Story = {
  args: {
    ...Default.args,
    sessions: [],
  },
};
