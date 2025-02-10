import type { Meta, StoryObj } from "@storybook/react";
import { MessageControls } from "../../components/ui/MessageControls";

const meta = {
  title: "CHAT/MessageControls/Variations",
  component: MessageControls,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="relative group p-8 bg-theme-bg-secondary min-w-[200px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessageControls>;

export default meta;
type Story = StoryObj<typeof meta>;

// Test disabled states
export const DisabledControls: Story = {
  args: {
    isUser: false,
    onCopy: undefined,
    onLike: undefined,
    onDislike: undefined,
    onRerun: undefined,
  },
};

// Test partial controls
export const PartialUserControls: Story = {
  args: {
    isUser: true,
    onCopy: () => console.log("copy"),
    // onEdit intentionally omitted
  },
};

// Test custom positioning
export const CustomPosition: Story = {
  args: {
    isUser: false,
    onCopy: () => console.log("copy"),
    onLike: () => console.log("like"),
    onDislike: () => console.log("dislike"),
    className: "top-auto bottom-2 left-2 right-auto",
  },
};

// Test with always visible controls
export const AlwaysVisible: Story = {
  args: {
    isUser: false,
    onCopy: () => console.log("copy"),
    onLike: () => console.log("like"),
    onDislike: () => console.log("dislike"),
    className: "opacity-100",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Controls that are always visible instead of only on hover. Useful for touch devices or specific UI requirements.",
      },
    },
  },
};

// Test with loading state
export const LoadingState: Story = {
  args: {
    isUser: false,
    onCopy: () => new Promise((resolve) => setTimeout(resolve, 1000)),
    onRerun: () => new Promise((resolve) => setTimeout(resolve, 2000)),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Shows how controls handle async operations with loading states.",
      },
    },
  },
};

// Test with error handling
export const WithErrorHandling: Story = {
  args: {
    isUser: false,
    onCopy: () => Promise.reject(new Error("Failed to copy")),
    onRerun: () => Promise.reject(new Error("Failed to rerun")),
  },
  parameters: {
    docs: {
      description: {
        story: "Demonstrates error handling in control actions.",
      },
    },
  },
};
