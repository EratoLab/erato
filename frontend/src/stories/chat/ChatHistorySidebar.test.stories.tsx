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

    // Test collapse. The header control is the one that gets hidden, and it
    // keeps announcing the expanded state; the control that takes over under
    // the default `hidden` mode is the trigger floating over the
    // conversation, so the collapsed state has to be read off that one.
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

    // Verify the selected state. The row states it with `data-selected`,
    // beside the `aria-current` on its link — the contract a theme keys on.
    // The utility classes that used to carry it belong to the row primitive
    // now and are no longer on this element.
    await expect(sessionContainer).toHaveAttribute("data-selected", "true");
    await expect(sessionLink).toHaveAttribute("aria-current", "page");

    // Hover is painted by CSS on the row's geometry class, and synthetic
    // events never set `:hover`, so this only checks the row survives the
    // pointer interaction.
    await user.hover(sessionContainer);
    await expect(sessionContainer).toBeVisible();
  },
};

/**
 * The logo face only exists in slim mode, and the preview's feature config
 * collapses to `hidden`, so this story supplies both the mode and a logo
 * path of its own. The path is served by Storybook's static dir, which is
 * what lets the sidebar's existence check for it resolve.
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

    // The face REPLACES the toggle's own glyph rather than joining it: the
    // sidebar geometry probe measures the first aria-hidden node inside this
    // button, so a second icon span here is what it would measure instead of
    // the logo.
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
