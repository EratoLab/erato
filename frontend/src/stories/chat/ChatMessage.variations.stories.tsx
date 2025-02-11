import type { Meta, StoryObj } from "@storybook/react";
import { ChatMessage } from "../../components/ui/ChatMessage";
import { ChatMessageFactory } from "./mockData";

const meta = {
  title: "CHAT/ChatMessage/Variations",
  component: ChatMessage,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Different variations of the ChatMessage component showcasing various configurations and use cases.",
      },
    },
  },
  argTypes: {
    maxWidth: {
      control: { type: "number" },
      description: "Maximum width of the message container in pixels",
    },
    showTimestamp: {
      control: { type: "boolean" },
      description: "Whether to show the timestamp",
    },
    showAvatar: {
      control: { type: "boolean" },
      description: "Whether to show the avatar",
    },
  },
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

const defaultControlsContext = {
  currentUserId: "user_1",
  dialogOwnerId: "user_1",
  isSharedDialog: false,
};

export const NoAvatar: Story = {
  args: {
    message: ChatMessageFactory.samples.user,
    showAvatar: false,
    controlsContext: defaultControlsContext,
    onMessageAction: () => {},
  },
  parameters: {
    docs: {
      description: {
        story: "ChatMessage without an avatar, useful for compact layouts.",
      },
    },
  },
};

export const NoTimestamp: Story = {
  args: {
    message: ChatMessageFactory.samples.user,
    showTimestamp: false,
    controlsContext: defaultControlsContext,
    onMessageAction: () => {},
  },
  parameters: {
    docs: {
      description: {
        story: "ChatMessage without a timestamp display.",
      },
    },
  },
};

export const NarrowContainer: Story = {
  args: {
    message: ChatMessageFactory.samples.longMessage,
    maxWidth: 400,
    controlsContext: defaultControlsContext,
    onMessageAction: () => {},
  },
  parameters: {
    docs: {
      description: {
        story:
          "ChatMessage in a narrow container to demonstrate text wrapping.",
      },
    },
  },
};

export const MessageSequence: Story = {
  args: {
    message: ChatMessageFactory.samples.user,
    controlsContext: defaultControlsContext,
    onMessageAction: () => {},
  },
  parameters: {
    docs: {
      description: {
        story: "A sequence of messages showing a conversation flow.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="space-y-2 w-full max-w-3xl">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <>
      <ChatMessage
        message={ChatMessageFactory.samples.user}
        controlsContext={defaultControlsContext}
        onMessageAction={() => {}}
      />
      <ChatMessage
        message={ChatMessageFactory.samples.assistant}
        controlsContext={defaultControlsContext}
        onMessageAction={() => {}}
      />
      <ChatMessage
        message={ChatMessageFactory.samples.longMessage}
        controlsContext={defaultControlsContext}
        onMessageAction={() => {}}
      />
    </>
  ),
};

export const MinimumWidth: Story = {
  args: {
    message: ChatMessageFactory.createBotMessage({
      content: "Short",
    }),
    controlsContext: defaultControlsContext,
    onMessageAction: () => {},
  },
  parameters: {
    docs: {
      description: {
        story:
          "Shows message with very short content to verify minimum width constraint",
      },
    },
  },
};

export const Loading: Story = {
  args: {
    message: {
      id: "1",
      content: "Initial content",
      sender: "assistant",
      authorId: "assistant_1",
      createdAt: new Date(),
      loading: {
        state: "loading",
        context: "Processing request...",
      },
    },
    controlsContext: defaultControlsContext,
    onMessageAction: () => {},
  },
};

export const ToolCalling: Story = {
  args: {
    message: {
      id: "2",
      content: "Fetching weather data",
      sender: "assistant",
      authorId: "assistant_1",
      createdAt: new Date(),
      loading: {
        state: "tool-calling",
        context: "Accessing weather API...",
      },
    },
    controlsContext: defaultControlsContext,
    onMessageAction: () => {},
  },
};

export const Reasoning: Story = {
  args: {
    message: {
      id: "3",
      content: "Analyzing data",
      sender: "assistant",
      authorId: "assistant_1",
      createdAt: new Date(),
      loading: {
        state: "reasoning",
        context: "Processing results...",
      },
    },
    controlsContext: defaultControlsContext,
    onMessageAction: () => {},
  },
};
