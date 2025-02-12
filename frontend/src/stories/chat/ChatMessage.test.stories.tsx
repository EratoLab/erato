import type { Meta, StoryObj } from "@storybook/react";
import { ChatMessage } from "../../components/ui/ChatMessage";
import { ChatMessageFactory } from "./mockData";
import { expect, within } from "@storybook/test";
import { userEvent } from "@storybook/test";

const meta = {
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
} satisfies Meta<typeof ChatMessage>;

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
    onMessageAction: () => {},
    showTimestamp: true,
    showControlsOnHover: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Check ARIA attributes
    const article = canvas.getByRole("log");
    expect(article).toBeInTheDocument();
    expect(article.getAttribute("aria-live")).toBe("polite");
    expect(article.getAttribute("aria-label")).toBe("Assistant message");

    // Check if timestamp is accessible
    const timestamp = canvas.getByTitle(
      ChatMessageFactory.samples.assistant.createdAt.toLocaleString(),
    );
    expect(timestamp).toBeInTheDocument();
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
    onMessageAction: (action) => {
      console.log("Action triggered:", action);
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Find controls
    const copyButton = canvas.getByLabelText("Copy message");

    // Verify initial state (controls should be hidden)
    const controls = copyButton.closest('[class*="group-hover"]');
    expect(controls).toBeInTheDocument();
    expect(controls?.className).toContain("opacity-0");

    // Simulate hover
    await user.hover(controls!.parentElement!);

    // Verify controls become visible
    expect(controls?.className).toContain("group-hover:opacity-100");

    // Test button interaction
    await user.click(copyButton);

    // Test hover exit
    await user.unhover(controls!.parentElement!);
    expect(controls?.className).toContain("opacity-0");
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
    onMessageAction: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Verify message container is properly sized
    const container = canvas.getByRole("log");
    const styles = window.getComputedStyle(container);
    expect(styles.minWidth).toBe("280px");
    expect(styles.maxWidth).toBe("768px");

    // Verify text wrapping
    const messageText = canvas.getByText(
      ChatMessageFactory.samples.longMessage.content,
    );
    const textStyles = window.getComputedStyle(messageText);
    expect(textStyles.whiteSpace).toBe("pre-wrap");
  },
};

export const LoadingStateTest: Story = {
  args: {
    message: {
      id: "1",
      content: "Processing",
      sender: "assistant",
      createdAt: new Date(),
      authorId: "assistant_1",
      loading: {
        state: "loading",
        context: "Test loading state",
      },
    },
    controlsContext: {
      currentUserId: "user_1",
      dialogOwnerId: "user_1",
      isSharedDialog: false,
    },
    onMessageAction: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Verify loading indicator is present
    const loadingIndicator = canvas.getByText("Loading");
    expect(loadingIndicator).toBeInTheDocument();

    // Verify loading context
    const context = canvas.getByText("Test loading state");
    expect(context).toBeInTheDocument();
  },
};
