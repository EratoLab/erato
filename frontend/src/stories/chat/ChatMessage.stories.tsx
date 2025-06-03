import { ChatMessageFactory } from "./mockData";
import { ChatMessage } from "../../components/ui/Chat/ChatMessage";
import { DefaultMessageControls } from "../../components/ui/Message/DefaultMessageControls";

import type { MessageAction } from "../../types/message-controls";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Chat/ChatMessage",
  component: ChatMessage,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
A themeable chat message component with configurable controls.

## Technical Notes
- Uses dependency injection for message controls
- Supports custom control implementations
- Permission-based control visibility
- Unified action handling
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
    controls: {
      description: "Custom controls component (optional)",
    },
    controlsContext: {
      description: "Context for controls rendering",
    },
  },
  args: {
    showAvatar: false,
    showTimestamp: true,
    maxWidth: 768,
    controls: DefaultMessageControls,
    controlsContext: {
      currentUserId: "user_1",
      dialogOwnerId: "user_1",
      isSharedDialog: false,
    },
    onMessageAction: async (action: MessageAction) => {
      console.log("Message action:", action);
      return true;
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof ChatMessage>;

export const UserMessage: Story = {
  args: {
    message: ChatMessageFactory.createUserMessage({
      authorId: "user_1",
    }),
  },
};

export const AssistantMessage: Story = {
  args: {
    message: ChatMessageFactory.createBotMessage({
      authorId: "assistant_1",
    }),
  },
};

export const SharedMessage: Story = {
  args: {
    message: ChatMessageFactory.createUserMessage({
      authorId: "other_user",
    }),
    controlsContext: {
      currentUserId: "user_1",
      dialogOwnerId: "other_user",
      isSharedDialog: true,
    },
  },
};

export const HoverComparison: Story = {
  args: {
    ...UserMessage.args,
    showControlsOnHover: true,
  },
  parameters: {
    docs: {
      description: {
        story: `
Demonstrates the improved hover effect on messages:
- Light mode: Uses neutral.200 (#e5e7eb) for a subtle hover
- Dark mode: Uses neutral.700 (#374151) for a gentle highlight

The hover effect is now properly aligned with the theme's color scale, providing just enough contrast without being too bright or too subtle.
        `,
      },
    },
  },
};
