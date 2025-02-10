import type { Meta, StoryObj } from "@storybook/react";
import { Chat } from "../../components/ui/Chat";
import { ChatProvider } from "../../components/containers/ChatProvider";
import { ChatMessageFactory } from "./mockData";
import { action } from "@storybook/addon-actions";

const mockMessages = {
  "1": ChatMessageFactory.samples.assistant,
  "2": ChatMessageFactory.samples.user,
  "3": ChatMessageFactory.samples.longMessage,
};

const mockOrder = ["1", "2", "3"];

const meta = {
  title: "Chat/Chat",
  component: Chat,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: "Complete chat interface with messages and controls",
      },
    },
  },
  decorators: [
    (Story) => (
      <ChatProvider
        initialMessages={mockMessages}
        initialMessageOrder={mockOrder}
      >
        <div className="h-[600px] w-full max-w-4xl mx-auto">
          <Story />
        </div>
      </ChatProvider>
    ),
  ],
  argTypes: {
    layout: {
      control: "select",
      options: ["default", "compact", "comfortable"],
    },
    showAvatars: { control: "boolean" },
    showTimestamps: { control: "boolean" },
  },
} satisfies Meta<typeof Chat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    layout: "default",
    showAvatars: true,
    showTimestamps: true,
    onCopyMessage: action("copy message"),
    onLikeMessage: action("like message"),
    onDislikeMessage: action("dislike message"),
    onRerunMessage: action("rerun message"),
    onNewChat: action("new chat"),
    onRegenerate: action("regenerate"),
  },
};

export const Compact: Story = {
  args: {
    ...Default.args,
    layout: "compact",
    showAvatars: false,
    showTimestamps: false,
  },
};

export const Comfortable: Story = {
  args: {
    ...Default.args,
    layout: "comfortable",
    showAvatars: true,
  },
};
