import { ChatHistoryList, ChatHistoryListSkeleton } from "@/components/ui";

import type { ChatSession } from "@/types/chat";
import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof ChatHistoryList> = {
  title: "CHAT/ChatHistoryList",
  component: ChatHistoryList,
  parameters: {
    layout: "centered",
  },
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
        sender: "user" as const,
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
    onSessionArchive: (sessionId: string) =>
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
