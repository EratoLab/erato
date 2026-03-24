import { LoadingIndicator } from "../../components/ui/Feedback/LoadingIndicator";

import type { LoadingState } from "../../components/ui/Feedback/LoadingIndicator";
import type { ToolCall } from "../../hooks/chat/store/messagingStore";
import type { Meta, StoryObj } from "@storybook/react";
import type { ComponentProps } from "react";

type LoadingIndicatorStoryArgs = ComponentProps<typeof LoadingIndicator> & {
  variant?: "loading" | "tool-call";
  toolCallStatus?: ToolCall["status"];
  toolCallName?: string;
  toolCallProgressMessage?: string;
};

const meta = {
  title: "UI/LoadingIndicator",
  component: LoadingIndicator,
  render: ({
    variant = "loading",
    toolCallStatus = "in_progress",
    toolCallName = "Weather lookup",
    toolCallProgressMessage = "Fetching current conditions...",
    ...args
  }) => {
    const toolCalls =
      variant === "tool-call"
        ? {
            demo: {
              id: "demo-tool-call",
              name: toolCallName,
              status: toolCallStatus,
              progressMessage:
                toolCallStatus === "in_progress"
                  ? toolCallProgressMessage
                  : undefined,
            },
          }
        : undefined;

    return <LoadingIndicator {...args} toolCalls={toolCalls} />;
  },
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
Loading indicator that shows different states with contextual information.

## States
- Loading: Default loading state with timer icon
- Tool Calling: When using external tools with tools icon
- Reasoning: When processing information with brain icon

Use the "variant" control to switch between the default loading row and the tool-call row so Storybook can preview the full component behavior from one place.
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: "radio",
      options: ["loading", "tool-call"] as const,
      description: "Choose which LoadingIndicator branch to preview",
    },
    state: {
      control: "radio",
      options: [
        "thinking",
        "typing",
        "tool-calling",
        "reasoning",
        "done",
        "error",
      ] as LoadingState[],
      description: "Current loading state",
    },
    context: {
      control: "text",
      description: "Additional context about the current operation",
    },
    toolCallStatus: {
      control: "radio",
      options: [
        "proposed",
        "in_progress",
        "success",
        "error",
      ] as ToolCall["status"][],
      description: "Semantic status color for the demo tool-call row",
      if: { arg: "variant", eq: "tool-call" },
    },
    toolCallName: {
      control: "text",
      description: "Name for the demo tool-call row",
      if: { arg: "variant", eq: "tool-call" },
    },
    toolCallProgressMessage: {
      control: "text",
      description: "Progress message shown for the in-progress tool-call row",
      if: { arg: "variant", eq: "tool-call" },
    },
    toolCalls: {
      table: {
        disable: true,
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<LoadingIndicatorStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    variant: "loading",
    state: "thinking",
    context: "Processing request...",
  },
};

export const ToolCalling: Story = {
  args: {
    variant: "loading",
    state: "tool-calling",
    context: "Fetching weather data...",
  },
};

export const Reasoning: Story = {
  args: {
    variant: "loading",
    state: "reasoning",
    context: "Analyzing results...",
  },
};

export const WithoutContext: Story = {
  args: {
    variant: "loading",
    state: "thinking",
  },
};

export const LongContext: Story = {
  args: {
    variant: "loading",
    state: "reasoning",
    context:
      "Processing a very long context message that might need to wrap to multiple lines...",
  },
};

export const StatusPreview: Story = {
  args: {
    variant: "tool-call",
    state: "tool-calling",
    toolCallStatus: "in_progress",
    toolCallName: "Weather lookup",
    toolCallProgressMessage: "Fetching current conditions...",
  },
};

export const Playground: Story = {
  args: {
    variant: "loading",
    state: "thinking",
    context: "Processing request...",
    toolCallStatus: "in_progress",
    toolCallName: "Weather lookup",
    toolCallProgressMessage: "Fetching current conditions...",
  },
};
