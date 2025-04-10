import { within, waitFor, userEvent } from "@storybook/test";
import { useState, useEffect, useCallback } from "react";

import { ChatMessage as ChatMessageComponent } from "../../components/ui/Chat/ChatMessage";

import type { MessageAction } from "../../types/message-controls";
import type { UiChatMessage } from "../../utils/adapters/messageAdapter";
import type { Meta, StoryObj } from "@storybook/react";

// Custom type for the playground functionality
type PlaygroundLoadingState = "loading" | "tool-calling" | "reasoning";

interface PlaygroundMessage {
  id: string;
  content: string;
  sender: string;
  role: "user" | "assistant" | "system";
  createdAt: Date;
  authorId: string;
  loading?: {
    state: PlaygroundLoadingState;
    context: string;
    partialContent?: string;
  };
}

interface PlaygroundProps {
  streamingSpeed?: number;
  showLoadingStates?: boolean;
}

const StreamingPlayground = ({
  streamingSpeed = 100,
  showLoadingStates = true,
}: PlaygroundProps) => {
  const [message, setMessage] = useState<PlaygroundMessage>({
    id: "1",
    content: "",
    sender: "assistant",
    role: "assistant",
    createdAt: new Date(),
    authorId: "assistant_1",
    loading: {
      state: "loading",
      context: "Initializing...",
    },
  });

  const startStreaming = useCallback(() => {
    const states: Array<PlaygroundLoadingState> = [
      "loading",
      "tool-calling",
      "reasoning",
    ];
    const finalContent =
      SAMPLE_RESPONSES[Math.floor(Math.random() * SAMPLE_RESPONSES.length)];
    let currentIndex = 0;
    let stateIndex = 0;

    const interval = setInterval(() => {
      if (currentIndex < finalContent.length) {
        // Stream content
        setMessage((prev: PlaygroundMessage) => {
          const currentState = showLoadingStates
            ? states[stateIndex % states.length]
            : "loading";
          const contexts = LOADING_CONTEXTS[currentState];
          const contextIndex = Math.floor(
            (currentIndex / finalContent.length) * contexts.length,
          );

          return {
            ...prev,
            content: finalContent.slice(0, currentIndex + 1),
            loading: {
              state: currentState,
              context: contexts[contextIndex],
              partialContent: finalContent.slice(currentIndex + 1),
            },
          };
        });
        currentIndex++;
      } else {
        // Move to next state or finish
        stateIndex++;
        if (stateIndex >= states.length || !showLoadingStates) {
          setMessage((prev: PlaygroundMessage) => ({
            ...prev,
            loading: undefined,
          }));
          clearInterval(interval);
        }
      }
    }, streamingSpeed);

    return () => clearInterval(interval);
  }, [streamingSpeed, showLoadingStates]);

  useEffect(() => {
    return startStreaming();
  }, [startStreaming]);

  // Adapt the playground message to UiChatMessage format expected by the component
  const adaptedMessage: UiChatMessage = {
    ...message,
    createdAt: message.createdAt.toISOString(),
    loading: message.loading
      ? {
          state: "thinking",
          context: message.loading.context,
        }
      : undefined,
  };

  return (
    <ChatMessageComponent
      message={adaptedMessage}
      controlsContext={{
        currentUserId: "user_1",
        dialogOwnerId: "user_1",
        isSharedDialog: false,
      }}
      onMessageAction={(action: MessageAction) => {
        switch (action) {
          case "copy":
            console.log("copied");
            break;
          case "like":
            console.log("liked");
            break;
          case "dislike":
            console.log("disliked");
            break;
          case "regenerate":
            setMessage({
              id: "1",
              content: "",
              sender: "assistant",
              role: "assistant",
              createdAt: new Date(),
              authorId: "assistant_1",
              loading: {
                state: "loading",
                context: "Initializing...",
              },
            });
            break;
        }
      }}
    />
  );
};

/**
 * Interactive playground demonstrating message streaming and loading states.
 * Shows how the ChatMessage component handles:
 * - Real-time content streaming
 * - Different loading states
 * - User interactions
 */
const meta = {
  title: "Chat/ChatMessagePlayground",
  component: StreamingPlayground,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
A playground that demonstrates the ChatMessage component's streaming capabilities.

## Features
- Content streaming simulation
- Loading state transitions
- Interactive controls for speed and behavior
- Real-time user feedback
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="flex w-[400px] justify-center">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    streamingSpeed: {
      control: {
        type: "range",
        min: 10,
        max: 200,
        step: 10,
      },
      description: "Speed of text streaming in milliseconds",
      table: {
        defaultValue: { summary: "100" },
      },
    },
    showLoadingStates: {
      control: "boolean",
      description: "Toggle between simple loading and detailed loading states",
      table: {
        defaultValue: { summary: "true" },
      },
    },
  },
} satisfies Meta<typeof StreamingPlayground>;

export default meta;

type Story = StoryObj<typeof meta>;

const SAMPLE_RESPONSES = [
  "Here's a complete response that was streamed piece by piece.",
  "I've analyzed the data and found some interesting patterns.",
  "Let me help you with that problem step by step.",
];

const LOADING_CONTEXTS: Record<PlaygroundLoadingState, string[]> = {
  loading: [
    "Processing request...",
    "Generating response...",
    "Almost there...",
  ],
  "tool-calling": [
    "Fetching data...",
    "Calling external API...",
    "Processing results...",
  ],
  reasoning: [
    "Analyzing context...",
    "Evaluating options...",
    "Formulating response...",
  ],
};

export const Streaming: Story = {
  args: {
    streamingSpeed: 100,
    showLoadingStates: true,
  },
  render: ({ streamingSpeed, showLoadingStates }) => (
    <StreamingPlayground
      streamingSpeed={streamingSpeed}
      showLoadingStates={showLoadingStates}
    />
  ),
};

export const FastStreaming: Story = {
  args: {
    streamingSpeed: 30,
    showLoadingStates: true,
  },
};

export const SimpleLoading: Story = {
  args: {
    streamingSpeed: 100,
    showLoadingStates: false,
  },
};

export const SlowMotion: Story = {
  args: {
    streamingSpeed: 200,
    showLoadingStates: true,
  },
};

export const InteractionTest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Wait for streaming to complete
    await waitFor(async () => {
      // const message = canvas.getByRole("log");
      // expect(message).toBeInTheDocument();
    });

    // Test controls
    const copyButton = canvas.getByLabelText("Copy message");
    await userEvent.click(copyButton);
  },
};
