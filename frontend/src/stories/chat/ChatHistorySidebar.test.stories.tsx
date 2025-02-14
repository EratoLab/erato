import type { Meta, StoryObj } from "@storybook/react";
import { expect, within, userEvent } from "@storybook/test";
import { useState } from "react";
import { ChatHistorySidebar } from "../../components/ui/ChatHistorySidebar";

const meta = {
  title: "CHAT/ChatHistorySidebar/Tests",
  component: ChatHistorySidebar,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatHistorySidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockSessions = [
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
];

export const AccessibilityTest: Story = {
  args: {
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: () => {},
    onSessionDelete: () => {},
    isLoading: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Check ARIA labels
    const toggleButton = canvas.getByLabelText(/collapse sidebar/i);
    expect(toggleButton).toBeInTheDocument();

    const newChatButton = canvas.getByLabelText(/new chat/i);
    expect(newChatButton).toBeInTheDocument();
  },
};

export const InteractionTest: Story = {
  args: AccessibilityTest.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Test collapse functionality
    const toggleButton = canvas.getByLabelText(/collapse sidebar/i);
    await user.click(toggleButton);

    // Test new chat functionality
    const newChatButton = canvas.getByLabelText(/new chat/i);
    await user.click(newChatButton);
  },
};

export const SessionSelectionTest: Story = {
  args: AccessibilityTest.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Test session selection
    const sessionTitle = canvas.getByText("Chat about React Performance");
    expect(sessionTitle).toBeInTheDocument();
    await user.click(sessionTitle);
  },
};

export const LoadingStateTest: Story = {
  args: {
    sessions: [],
    currentSessionId: null,
    onSessionSelect: () => {},
    onSessionDelete: () => {},
    isLoading: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Check for the skeleton container
    const skeletonContainer = canvas.getByTestId("chat-history-skeleton");
    expect(skeletonContainer).toBeInTheDocument();

    // Check for skeleton items
    const skeletonItems = canvas.getAllByTestId("chat-history-skeleton-item");
    expect(skeletonItems).toHaveLength(5);
  },
};

export const CollapseTest: Story = {
  render: () => {
    const [isCollapsed, setIsCollapsed] = useState(false);

    return (
      <ChatHistorySidebar
        collapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        showTitle={true}
        sessions={mockSessions}
        currentSessionId="1"
        onSessionSelect={() => {}}
        onSessionDelete={() => {}}
        isLoading={false}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Initial state check
    const sidebar = canvas.getByRole("complementary");
    expect(sidebar.clientWidth).toBeGreaterThan(200);

    const toggleButton = canvas.getByLabelText(/collapse sidebar/i);
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");

    // Test collapse
    await user.click(toggleButton);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");

    // Test expanding again
    await user.click(toggleButton);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");
  },
};

export const SessionInteractionTest: Story = {
  args: AccessibilityTest.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Test session selection
    const sessionTitle = canvas.getByText("Chat about React Performance");
    const sessionContainer = sessionTitle.closest(
      '[class*="flex flex-col text-left"]',
    );
    await user.click(sessionContainer!);

    // Verify the selected state
    expect(sessionContainer).toHaveClass("bg-theme-bg-selected");

    // Test session hover state
    await user.hover(sessionContainer!);
    expect(sessionContainer).toHaveClass("hover:bg-theme-bg-hover");
  },
};

export const KeyboardNavigationTest: Story = {
  args: AccessibilityTest.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Test keyboard navigation
    await user.tab(); // Focus first interactive element
    const toggleButton = canvas.getByLabelText(/collapse sidebar/i);
    expect(toggleButton).toHaveFocus();

    await user.tab(); // Move to new chat button
    const newChatButton = canvas.getByLabelText(/new chat/i);
    expect(newChatButton).toHaveFocus();

    await user.tab(); // Move to first session
    const sessionTitle = canvas.getByText("Chat about React Performance");
    const sessionContainer =
      sessionTitle.closest('[role="button"]') ||
      sessionTitle.closest('[class*="flex flex-col text-left"]');
    expect(sessionContainer).toHaveFocus();
  },
};
