import type { Meta, StoryObj } from "@storybook/react";
import { ChatMessage } from "../../components/ui/ChatMessage";
import { ChatMessageFactory } from "./mockData";

const meta = {
  title: "Chat/ChatMessage",
  component: ChatMessage,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
A themeable chat message component with built-in performance optimizations.

## Technical Notes
- Uses CSS variables for runtime theme changes without re-renders
- Memoized sub-components to prevent unnecessary re-renders in long chat lists
- Content validation to handle edge cases (empty messages, malformed data)
- Timezone-aware timestamp handling (see CREQ-0003)

## Theme Integration
Component expects these CSS variables:
\`\`\`css
--theme-bg-primary
--theme-bg-secondary
--theme-avatar-user-bg/fg
--theme-avatar-assistant-bg/fg
\`\`\`

## Caveats
- Large message lists may require virtualization
- Custom styling should maintain WCAG 2.1 AA contrast ratios
        `,
      },
    },
  },
  argTypes: {
    message: {
      control: "object",
      description:
        "The message object containing content, sender, and timestamp",
    },
    maxWidth: {
      control: "number",
      description: "Maximum width of the message container in pixels",
      defaultValue: 768,
    },
    showTimestamp: {
      control: "boolean",
      description: "Whether to show the timestamp",
      defaultValue: true,
    },
    showAvatar: {
      control: "boolean",
      description: "Whether to show the avatar",
      defaultValue: false,
    },
    className: {
      control: "text",
      description: "Additional CSS classes to apply",
    },
  },
  args: {
    showAvatar: false,
    showTimestamp: true,
    maxWidth: 768,
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default story showing a user message
export const UserMessage: Story = {
  args: {
    message: ChatMessageFactory.samples.user,
    showAvatar: true,
  },
};

// Assistant message story
export const AssistantMessage: Story = {
  args: {
    message: ChatMessageFactory.samples.assistant,
  },
};

// Long message to test wrapping
export const LongMessage: Story = {
  args: {
    message: ChatMessageFactory.samples.longMessage,
  },
};

// Message without avatar
export const WithoutAvatar: Story = {
  args: {
    message: ChatMessageFactory.samples.user,
    showAvatar: false,
  },
};

// Message without timestamp
export const WithoutTimestamp: Story = {
  args: {
    message: ChatMessageFactory.samples.user,
    showTimestamp: false,
  },
};

// Custom width message
export const CustomWidth: Story = {
  args: {
    message: ChatMessageFactory.samples.longMessage,
    maxWidth: 400,
  },
};
