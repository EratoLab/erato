import { DefaultMessageControls } from "../../components/ui/Message/DefaultMessageControls";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "Chat/DefaultMessageControls/Variations",
  component: DefaultMessageControls,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="group relative min-w-[200px] bg-theme-bg-secondary p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DefaultMessageControls>;

export default meta;
type Story = StoryObj<typeof DefaultMessageControls>;

// Different permission scenarios
export const ViewOnlyControls: Story = {
  args: {
    messageId: "msg_1",
    messageType: "user",
    authorId: "other_user",
    createdAt: new Date(),
    context: {
      currentUserId: "user_1",
      dialogOwnerId: "other_user",
      isSharedDialog: true,
    },
  },
};

// Custom positioning
export const CustomPosition: Story = {
  args: {
    messageId: "msg_1",
    messageType: "assistant",
    authorId: "assistant_1",
    context: {
      currentUserId: "user_1",
      dialogOwnerId: "user_1",
      isSharedDialog: false,
    },
    className: "top-auto bottom-2 left-2 right-auto",
  },
};

// Always visible controls
export const AlwaysVisible: Story = {
  args: {
    messageId: "msg_1",
    messageType: "assistant",
    authorId: "assistant_1",
    context: {
      currentUserId: "user_1",
      dialogOwnerId: "user_1",
      isSharedDialog: false,
    },
    className: "opacity-100",
    showOnHover: false,
  },
  parameters: {
    docs: {
      description: {
        story: "Controls that are always visible. Useful for touch devices.",
      },
    },
  },
};

// Dialog owner controls
export const DialogOwnerControls: Story = {
  args: {
    messageId: "msg_1",
    messageType: "assistant",
    authorId: "assistant_1",
    context: {
      currentUserId: "owner_1",
      dialogOwnerId: "owner_1",
      isSharedDialog: false,
    },
  },
  parameters: {
    docs: {
      description: {
        story: "Shows all available controls for dialog owner.",
      },
    },
  },
};
