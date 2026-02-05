import { ChatMessageFactory } from "./mockData";
import { ChatMessage } from "../../components/ui/Chat/ChatMessage";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

// Helper to convert string to ContentPart[]
const textContent = (text: string): ContentPart[] => [
  { content_type: "text", text },
];

const meta: Meta<typeof ChatMessage> = {
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
};

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
    onMessageAction: async () => true,
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
    onMessageAction: async () => true,
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
    onMessageAction: async () => true,
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
    onMessageAction: async () => true,
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
      <div className="w-full max-w-3xl space-y-2">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <>
      <ChatMessage
        message={ChatMessageFactory.samples.user}
        controlsContext={defaultControlsContext}
        onMessageAction={async () => true}
      />
      <ChatMessage
        message={ChatMessageFactory.samples.assistant}
        controlsContext={defaultControlsContext}
        onMessageAction={async () => true}
      />
      <ChatMessage
        message={ChatMessageFactory.samples.longMessage}
        controlsContext={defaultControlsContext}
        onMessageAction={async () => true}
      />
    </>
  ),
};

export const MinimumWidth: Story = {
  args: {
    message: ChatMessageFactory.createBotMessage({
      content: textContent("Short"),
    }),
    controlsContext: defaultControlsContext,
    onMessageAction: async () => true,
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
      content: textContent("Initial content"),
      role: "assistant",
      createdAt: new Date().toISOString(),
      sender: "assistant",
      authorId: "assistant_1",
      loading: {
        state: "typing",
        context: "Processing request...",
      },
    },
    controlsContext: defaultControlsContext,
    onMessageAction: async () => true,
  },
};

export const ToolCalling: Story = {
  args: {
    message: {
      id: "2",
      content: textContent("Fetching weather data"),
      role: "assistant",
      createdAt: new Date().toISOString(),
      sender: "assistant",
      authorId: "assistant_1",
      loading: {
        state: "thinking",
        context: "Accessing weather API...",
      },
    },
    controlsContext: defaultControlsContext,
    onMessageAction: async () => true,
  },
};

export const Reasoning: Story = {
  args: {
    message: {
      id: "3",
      content: textContent("Analyzing data"),
      role: "assistant",
      createdAt: new Date().toISOString(),
      sender: "assistant",
      authorId: "assistant_1",
      loading: {
        state: "thinking",
        context: "Processing results...",
      },
    },
    controlsContext: defaultControlsContext,
    onMessageAction: async () => true,
  },
};

export const ContentFilterError: Story = {
  args: {
    message: ChatMessageFactory.samples.assistantError,
    controlsContext: defaultControlsContext,
    onMessageAction: async () => true,
  },
  parameters: {
    docs: {
      description: {
        story: "Assistant message with a content filter error state.",
      },
    },
  },
};

export const RateLimitError: Story = {
  args: {
    message: ChatMessageFactory.samples.assistantRateLimitError,
    controlsContext: defaultControlsContext,
    onMessageAction: async () => true,
  },
  parameters: {
    docs: {
      description: {
        story: "Assistant message with a rate limit error state.",
      },
    },
  },
};
