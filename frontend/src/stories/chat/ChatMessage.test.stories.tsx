import { expect, within, userEvent } from "@storybook/test";

import { ChatMessageFactory } from "./mockData";
import { ChatMessage } from "../../components/ui/Chat/ChatMessage";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof ChatMessage> = {
  title: "CHAT/ChatMessage/Tests",
  component: ChatMessage,
  parameters: {
    layout: "centered",
    a11y: {
      config: {
        rules: [
          {
            // Ensure proper ARIA roles
            id: "aria-roles",
            enabled: true,
          },
        ],
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const AccessibilityChecks: Story = {
  args: {
    message: ChatMessageFactory.samples.assistant,
    controlsContext: {
      currentUserId: "user_1",
      dialogOwnerId: "user_1",
      isSharedDialog: false,
    },
    onMessageAction: async () => true,
    showTimestamp: true,
    showControlsOnHover: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Check ARIA attributes
    const article = canvas.getByRole("log");
    await expect(article).toBeInTheDocument();
    await expect(article.getAttribute("aria-live")).toBe("polite");
    await expect(article.getAttribute("aria-label")).toBe("Assistant message");

    // Check if timestamp is accessible
    const timestamp = canvas.getByTitle(
      ChatMessageFactory.samples.assistant.createdAt.toLocaleString(),
    );
    await expect(timestamp).toBeInTheDocument();
  },
};

export const InteractionTest: Story = {
  args: {
    message: ChatMessageFactory.samples.assistant,
    showAvatar: true,
    showControlsOnHover: true,
    controlsContext: {
      currentUserId: "user_1",
      dialogOwnerId: "user_1",
      isSharedDialog: false,
    },
    onMessageAction: async (action) => {
      console.log("Action triggered:", action);
      return true;
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Find controls
    const copyButton = canvas.getByLabelText("Copy message");

    // Verify initial state (controls should be hidden)
    const controls = copyButton.closest('[class*="group-hover"]');
    await expect(controls).toBeInTheDocument();
    await expect(controls?.className).toContain("opacity-0");

    // Simulate hover - replace non-null assertion
    const controlParent = controls?.parentElement;
    if (controlParent) {
      await user.hover(controlParent);
    }

    // Verify controls become visible
    await expect(controls?.className).toContain("group-hover:opacity-100");

    // Test button interaction
    await user.click(copyButton);

    // Test hover exit - replace non-null assertion
    if (controlParent) {
      await user.unhover(controlParent);
    }
    await expect(controls?.className).toContain("opacity-0");
  },
};

export const ResponsiveTest: Story = {
  args: {
    message: ChatMessageFactory.samples.longMessage,
    maxWidth: 768,
    controlsContext: {
      currentUserId: "user_1",
      dialogOwnerId: "user_1",
      isSharedDialog: false,
    },
    onMessageAction: async () => true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Verify message container is properly sized
    const container = canvas.getByRole("log");
    const styles = window.getComputedStyle(container);
    await expect(styles.minWidth).toBe("280px");
    await expect(styles.maxWidth).toBe("768px");

    // Verify text wrapping
    const messageText = canvas.getByText(
      ChatMessageFactory.samples.longMessage.content,
    );
    const textStyles = window.getComputedStyle(messageText);
    await expect(textStyles.whiteSpace).toBe("pre-wrap");
  },
};

export const LoadingStateTest: Story = {
  args: {
    message: {
      id: "1",
      content: "Processing",
      role: "assistant",
      createdAt: new Date().toISOString(),
      sender: "assistant",
      authorId: "assistant_1",
      loading: {
        state: "thinking",
        context: "Test loading state",
      },
    },
    controlsContext: {
      currentUserId: "user_1",
      dialogOwnerId: "user_1",
      isSharedDialog: false,
    },
    onMessageAction: async () => true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Verify loading indicator is present
    const loadingIndicator = canvas.getByText("Loading");
    await expect(loadingIndicator).toBeInTheDocument();

    // Verify loading context
    const context = canvas.getByText("Test loading state");
    await expect(context).toBeInTheDocument();
  },
};
