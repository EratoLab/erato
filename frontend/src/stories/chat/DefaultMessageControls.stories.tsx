import { useEffect } from "react";

import { DefaultMessageControls } from "../../components/ui/Message/DefaultMessageControls";
import { useReadAloud } from "../../hooks/audio/readAloud";
import { StaticFeatureConfigProvider } from "../../providers/FeatureConfigProvider";

import type { ReadAloudStatus } from "../../hooks/audio/readAloud";
import type { MessageAction } from "../../types/message-controls";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";

const meta = {
  title: "Chat/DefaultMessageControls",
  component: DefaultMessageControls,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
Default implementation of message controls with permission-based visibility.

## Technical Notes
- Permission-based control visibility
- Supports hover mode for production use
- Unified action handling
- Context-aware rendering
- Interactive button states for better UX
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
    messageType: {
      control: "radio",
      options: ["user", "assistant"],
      description: "Type of message the controls are for",
    },
    onAction: {
      action: "action",
      description: "Unified action handler",
    },
  },
  args: {
    messageId: "msg_1",
    showOnHover: false,
    messageType: "assistant",
    authorId: "assistant_1",
    createdAt: new Date(),
    context: {
      currentUserId: "user_1",
      dialogOwnerId: "user_1",
      isSharedDialog: false,
    },
    onAction: async (action: MessageAction) => {
      console.log("Action:", action);
      return Promise.resolve(true);
    },
  },
  decorators: [
    (Story) => (
      <div className="group relative rounded p-8">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof DefaultMessageControls>;

export default meta;
type Story = StoryObj<typeof DefaultMessageControls>;

// Show all possible controls for assistant message
export const AssistantControls: Story = {
  args: {
    messageType: "assistant",
    authorId: "assistant_1",
  },
};

// User message controls
export const UserControls: Story = {
  args: {
    messageType: "user",
    authorId: "user_1",
  },
};

// Shared dialog controls
export const SharedDialogControls: Story = {
  args: {
    messageType: "user",
    authorId: "other_user",
    context: {
      currentUserId: "user_1",
      dialogOwnerId: "other_user",
      isSharedDialog: true,
    },
  },
};

// Hover behavior
export const HoverControls: Story = {
  args: {
    ...AssistantControls.args,
    showOnHover: true,
  },
};

// Read aloud is off by default; these stories switch it on and pin the state
// the button shows for message "msg_1".
function ReadAloudPreview({
  status,
  children,
}: {
  status: ReadAloudStatus | null;
  children: ReactNode;
}) {
  useEffect(() => {
    useReadAloud.setState({ messageId: status ? "msg_1" : null, status });
    return () => useReadAloud.setState({ messageId: null, status: null });
  }, [status]);
  return (
    <StaticFeatureConfigProvider
      config={{ messageActions: { readAloudEnabled: true } }}
    >
      {children}
    </StaticFeatureConfigProvider>
  );
}

const readAloudStory = (status: ReadAloudStatus | null): Story => ({
  args: {
    ...AssistantControls.args,
    isUserMessage: false,
    showFeedbackButtons: true,
    readAloud: { isFinished: true, hasText: true, hasSpokenAudio: false },
  },
  render: (args) => (
    <ReadAloudPreview status={status}>
      <div className="flex flex-col gap-6">
        <DefaultMessageControls {...args} />
        {/* A user message row never shows the button. */}
        <DefaultMessageControls
          {...args}
          messageId="msg_user"
          isUserMessage
          readAloud={undefined}
        />
      </div>
    </ReadAloudPreview>
  ),
});

export const ReadAloud: Story = readAloudStory(null);
export const ReadAloudLoading: Story = readAloudStory("loading");
export const ReadAloudPlaying: Story = readAloudStory("playing");
export const ReadAloudFailed: Story = readAloudStory("failed");
