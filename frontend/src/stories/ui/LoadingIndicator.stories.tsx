import type { Meta, StoryObj } from '@storybook/react';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { LoadingState } from '../../types/chat';

const meta = {
  title: 'UI/LoadingIndicator',
  component: LoadingIndicator,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Loading indicator that shows different states with contextual information.

## States
- Loading (⏳): Default loading state
- Tool Calling (🔧): When using external tools
- Reasoning (💭): When processing information
        `
      }
    }
  },
  argTypes: {
    state: {
      control: 'radio',
      options: ['loading', 'tool-calling', 'reasoning'] as LoadingState[],
      description: 'Current loading state',
    },
    context: {
      control: 'text',
      description: 'Additional context about the current operation',
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof LoadingIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    state: 'loading',
    context: 'Processing request...',
  },
};

export const ToolCalling: Story = {
  args: {
    state: 'tool-calling',
    context: 'Fetching weather data...',
  },
};

export const Reasoning: Story = {
  args: {
    state: 'reasoning',
    context: 'Analyzing results...',
  },
};

export const WithoutContext: Story = {
  args: {
    state: 'loading',
  },
};

export const LongContext: Story = {
  args: {
    state: 'reasoning',
    context: 'Processing a very long context message that might need to wrap to multiple lines...',
  },
}; 