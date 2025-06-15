import { LoadingIndicator } from "../../components/ui/Feedback/LoadingIndicator";

import type { LoadingState } from "../../components/ui/Feedback/LoadingIndicator";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/LoadingIndicator",
  component: LoadingIndicator,
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
        `,
      },
    },
  },
  argTypes: {
    state: {
      control: "radio",
      options: ["thinking", "tool-calling", "reasoning"] as LoadingState[],
      description: "Current loading state",
    },
    context: {
      control: "text",
      description: "Additional context about the current operation",
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LoadingIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    state: "thinking",
    context: "Processing request...",
  },
};

export const ToolCalling: Story = {
  args: {
    state: "tool-calling",
    context: "Fetching weather data...",
  },
};

export const Reasoning: Story = {
  args: {
    state: "reasoning",
    context: "Analyzing results...",
  },
};

export const WithoutContext: Story = {
  args: {
    state: "thinking",
  },
};

export const LongContext: Story = {
  args: {
    state: "reasoning",
    context:
      "Processing a very long context message that might need to wrap to multiple lines...",
  },
};
