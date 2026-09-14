import {
  expect,
  waitForElementToBeRemoved,
  within,
  userEvent,
} from "@storybook/test";
import { useState } from "react";

import { ChatHistorySidebar } from "../../components/ui/Chat/ChatHistorySidebar";
import { FeatureConfigProvider } from "../../providers/FeatureConfigProvider";

import type { ChatSession } from "@/types/chat";
import type { Decorator, Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof ChatHistorySidebar> = {
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
};

export default meta;
type Story = StoryObj<typeof meta>;

const waitForSidebarCanvas = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  const loadingText = canvas.queryByText(/loading locale:/i);

  if (loadingText) {
    await waitForElementToBeRemoved(loadingText);
  }

  return canvas;
};

const mockSessions: ChatSession[] = [
  {
    id: "1",
    title: "Chat about React Performance",
    messages: [],
    updatedAt: new Date("2024-01-01").toISOString(),
    metadata: {
      lastMessage: {
        content: "Let's discuss React performance optimization techniques",
        timestamp: new Date("2024-01-01").toISOString(),
      },
    },
  },
];

export const AccessibilityTest: Story = {
  args: {
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: () => {},
    onSessionArchive: () => {},
    onSessionUnarchive: () => {},
    isLoading: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = await waitForSidebarCanvas(canvasElement);

    // Check ARIA labels
    const toggleButton = canvas.getByLabelText(/collapse sidebar/i);
    await expect(toggleButton).toBeInTheDocument();

    const newChatButton = canvas.getByLabelText(/new chat/i);
    await expect(newChatButton).toBeInTheDocument();
  },
};

export const InteractionTest: Story = {
  args: AccessibilityTest.args,
  play: async ({ canvasElement }) => {
    const canvas = await waitForSidebarCanvas(canvasElement);
    const user = userEvent.setup();

    // Test session selection
    const sessionTitle = canvas.getByText("Chat about React Performance");
    await expect(sessionTitle).toBeInTheDocument();
    await user.click(sessionTitle);
  },
};

export const LoadingStateTest: Story = {
  args: {
    sessions: [],
    currentSessionId: null,
    onSessionSelect: () => {},
    onSessionArchive: () => {},
    onSessionUnarchive: () => {},
    isLoading: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = await waitForSidebarCanvas(canvasElement);

    // Check for the skeleton container
    const skeletonContainer = canvas.getByTestId("chat-history-skeleton");
    await expect(skeletonContainer).toBeInTheDocument();

    // Check for skeleton items
    const skeletonItems = canvas.getAllByTestId("chat-history-skeleton-item");
    await expect(skeletonItems).toHaveLength(5);
  },
};

// Create a proper component for the CollapseTest
const CollapseTestComponent = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <ChatHistorySidebar
      collapsed={isCollapsed}
      onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      showTitle={true}
      sessions={mockSessions}
      currentSessionId="1"
      onSessionSelect={() => {}}
      onSessionArchive={() => {}}
      onSessionUnarchive={() => {}}
      isLoading={false}
    />
  );
};

export const CollapseTest: Story = {
  args: {
    sessions: mockSessions,
    currentSessionId: "1",
    onSessionSelect: () => {},
    onSessionArchive: () => {},
    onSessionUnarchive: () => {},
    isLoading: false,
    showTitle: true,
  },
  render: () => <CollapseTestComponent />,
  play: async ({ canvasElement }) => {
    const canvas = await waitForSidebarCanvas(canvasElement);
    const user = userEvent.setup();

    // Initial state check
    const sidebar = canvas.getByRole("complementary");
    await expect(sidebar.clientWidth).toBeGreaterThan(200);

    const collapseButton = canvas.getByLabelText(/collapse sidebar/i);
    await expect(collapseButton).toHaveAttribute("aria-expanded", "true");

    // The header control keeps announcing `expanded`; under the default
    // `hidden` mode the floating trigger is what reports the collapsed state.
    await user.click(collapseButton);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const expandButton = await canvas.findByLabelText(/expand sidebar/i);
    await expect(expandButton).toHaveAttribute("aria-expanded", "false");

    // Test expanding again
    await user.click(expandButton);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(canvas.getByLabelText(/collapse sidebar/i)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  },
};

export const SessionInteractionTest: Story = {
  args: AccessibilityTest.args,
  play: async ({ canvasElement }) => {
    const canvas = await waitForSidebarCanvas(canvasElement);
    const user = userEvent.setup();

    const sessionLink = canvas.getByRole("link", {
      name: "Chat about React Performance",
    });
    const sessionContainer = sessionLink.querySelector(
      '[data-ui="chat-history-item"]',
    );

    if (!sessionContainer) {
      throw new Error("Session container not found");
    }

    await user.click(sessionLink);

    // `data-selected` beside the link's `aria-current` is the theme contract.
    await expect(sessionContainer).toHaveAttribute("data-selected", "true");
    await expect(sessionLink).toHaveAttribute("aria-current", "page");

    // Synthetic events never set `:hover`, so this only checks it survives.
    await user.hover(sessionContainer);
    await expect(sessionContainer).toBeVisible();
  },
};

/**
 * The logo face exists only in slim mode, and the preview defaults to
 * `hidden`, so this story supplies the mode and a static-dir logo path.
 */
const withSlimLogoConfig: Decorator = (Story) => (
  <FeatureConfigProvider
    config={{
      sidebar: {
        collapsedMode: "slim",
        logoPath: "/erato-e.svg",
        logoDarkPath: "/erato-e-dark.svg",
      },
    }}
  >
    <Story />
  </FeatureConfigProvider>
);

export const SlimLogoFaceTest: Story = {
  args: {
    ...AccessibilityTest.args,
    collapsed: true,
  },
  decorators: [withSlimLogoConfig],
  play: async ({ canvasElement }) => {
    const canvas = await waitForSidebarCanvas(canvasElement);

    // The logo reaches the DOM only after its existence check resolves.
    const logo = await canvas.findByAltText(/logo/i);
    const toggle = canvas.getByLabelText(/expand sidebar/i);
    await expect(toggle).toContainElement(logo);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // The face replaces the glyph rather than joining it: the geometry probe
    // would otherwise measure a second icon span.
    await expect(toggle.querySelector('[aria-hidden="true"]')).toBeNull();

    const glyph = toggle.querySelector("svg");

    if (!glyph) {
      throw new Error("Logo face lost its toggle glyph");
    }

    // The glyph stays mounted behind the logo and CSS reveals it on :hover,
    // which synthetic events never set — so this asserts the resting state,
    // and the swap itself is checked by eye in
    // CHAT/ChatHistorySidebar → Slim mode with logo.
    await expect(glyph.parentElement).not.toBeVisible();
    await expect(logo).toBeVisible();
  },
};

export const KeyboardNavigationTest: Story = {
  args: AccessibilityTest.args,
  play: async ({ canvasElement }) => {
    const canvas = await waitForSidebarCanvas(canvasElement);
    const user = userEvent.setup();

    // Test keyboard navigation
    await user.tab(); // Focus first interactive element
    const toggleButton = canvas.getByLabelText(/collapse sidebar/i);
    await expect(toggleButton).toHaveFocus();

    await user.tab(); // Move to new chat button
    const newChatButton = canvas.getByLabelText(/new chat/i);
    await expect(newChatButton).toHaveFocus();

    const sessionLink = canvas.getByRole("link", {
      name: "Chat about React Performance",
    });

    for (let i = 0; i < 8 && document.activeElement !== sessionLink; i++) {
      await user.tab();
    }

    await expect(sessionLink).toHaveFocus();
  },
};
