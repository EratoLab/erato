import type { Meta, StoryObj } from "@storybook/react";
import { MessageControls } from "../../components/ui/MessageControls";

const meta = {
  title: "CHAT/MessageControls",
  component: MessageControls,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
Message control buttons with configurable visibility.

## Technical Notes
- Controls visibility configurable (default visible in stories)
- Different controls for user/assistant messages
- Positioned absolutely within parent container
- Supports hover mode for production use
        `,
      },
      story: {
        inline: true,
      },
    },
  },
  argTypes: {
    showOnHover: {
      control: "boolean",
      description: "Whether controls should only show on hover",
      defaultValue: false,
    },
    isUser: {
      control: "boolean",
      description: "Whether the controls are for a user message",
      defaultValue: false,
    },
    onCopy: {
      action: "copied",
      description: "Callback when copy button is clicked",
    },
    onEdit: {
      action: "edited",
      description: "Callback when edit button is clicked (user messages only)",
    },
    onLike: {
      action: "liked",
      description:
        "Callback when like button is clicked (assistant messages only)",
    },
    onDislike: {
      action: "disliked",
      description:
        "Callback when dislike button is clicked (assistant messages only)",
    },
    onRerun: {
      action: "rerun",
      description:
        "Callback when rerun button is clicked (assistant messages only)",
    },
  },
  args: {
    showOnHover: false,
    isUser: false,
  },
  decorators: [
    (Story) => (
      <div className="relative group p-8 rounded">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof MessageControls>;

export default meta;
type Story = StoryObj<typeof meta>;

// Show all possible controls
export const AllControls: Story = {
  args: {
    isUser: false,
  },
};

// User-specific controls
export const UserControls: Story = {
  args: {
    isUser: true,
  },
};

// Assistant-specific controls
export const AssistantControls: Story = {
  args: {
    isUser: false,
  },
};

// Hover behavior example
export const HoverControls: Story = {
  args: {
    ...AllControls.args,
    showOnHover: true,
  },
};

// Disabled state example
export const DisabledControls: Story = {
  args: {
    isUser: false,
    onCopy: undefined,
    onEdit: undefined,
    onLike: undefined,
    onDislike: undefined,
    onRerun: undefined,
  },
};
