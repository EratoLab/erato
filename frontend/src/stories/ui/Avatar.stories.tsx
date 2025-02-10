import type { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "../../components/ui/Avatar";

const meta = {
  title: "UI/Avatar",
  component: Avatar,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
A role-based avatar component optimized for chat interfaces.

## Technical Notes
- Implements CSS-based theming for runtime color updates
- Memoized to prevent re-renders in message lists
- Maintains consistent dimensions to prevent CLS
- Uses \`aria-hidden\` as it's decorative content

## Theme Variables
Requires role-specific color variables:
\`\`\`css
--theme-avatar-{role}-bg
--theme-avatar-{role}-fg
\`\`\`
        `,
      },
    },
  },
  argTypes: {
    role: {
      control: "radio",
      options: ["user", "assistant"],
      description: "The role determines the avatar styling",
    },
    isUser: {
      control: "boolean",
      description: "Whether the avatar represents a user",
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UserAvatar: Story = {
  args: {
    role: "user",
    isUser: true,
  },
};

export const AssistantAvatar: Story = {
  args: {
    role: "assistant",
    isUser: false,
  },
};
