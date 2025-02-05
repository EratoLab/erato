import type { Meta, StoryObj } from '@storybook/react';
import { ChatMessage } from '../components/ui/ChatMessage';

const meta = {
  title: 'UI/ChatMessage',
  component: ChatMessage,
  parameters: {
    layout: 'padded',
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#1a1a1a' },
      ],
    },
  },
  tags: ['autodocs'],
  argTypes: {
    maxWidth: {
      control: { type: 'range', min: 320, max: 1200, step: 32 },
      description: 'Maximum width of the message container in pixels',
    },
    showTimestamp: {
      control: 'boolean',
      description: 'Whether to show the timestamp',
    },
    showAvatar: {
      control: 'boolean',
      description: 'Whether to show the avatar',
    },
    className: {
      control: 'text',
      description: 'Additional CSS classes to apply',
      table: {
        category: 'Styling',
      },
    },
    message: {
      control: 'object',
      description: 'Message data object',
      table: {
        category: 'Data',
      },
    },
  },
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

const defaultMessage = {
  id: '1',
  createdAt: new Date(),
};

export const UserMessage: Story = {
  args: {
    message: {
      ...defaultMessage,
      sender: 'user',
      content: 'Hello, how are you?',
    },
  },
};

export const AssistantMessage: Story = {
  args: {
    message: {
      ...defaultMessage,
      sender: 'bot',
      content: 'I am doing well, thank you for asking! How can I help you today?',
    },
  },
};

export const LongMessage: Story = {
  args: {
    message: {
      ...defaultMessage,
      sender: 'bot',
      content: `This is a much longer message that demonstrates how the chat bubble handles multiple lines of text. It should wrap properly and maintain readability while staying within the maximum width constraints set by the component.

It even includes multiple paragraphs to show how spacing works.`,
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Demonstrates how the component handles long messages with multiple paragraphs.',
      },
    },
  },
};

export const WithCodeBlock: Story = {
  args: {
    message: {
      ...defaultMessage,
      sender: 'bot',
      content: '```javascript\nconst greeting = "Hello World";\nconsole.log(greeting);\n```',
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows how code blocks are rendered within messages.',
      },
    },
  },
};

export const Customized: Story = {
  args: {
    message: {
      ...defaultMessage,
      sender: 'bot',
      content: 'This is a customized message with different width and display options.',
    },
    maxWidth: 480,
    showTimestamp: false,
    showAvatar: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Example of a message with customized display options.',
      },
    },
  },
};

export const CompactView: Story = {
  args: {
    message: {
      ...defaultMessage,
      sender: 'user',
      content: 'A compact message without timestamp or avatar.',
    },
    showTimestamp: false,
    showAvatar: false,
  },
};

// Example of using decorators for layout testing
export const ConstrainedWidth: Story = {
  args: {
    message: {
      ...defaultMessage,
      sender: 'bot',
      content: 'This message is shown in a constrained container to test responsive behavior.',
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '400px', margin: '0 auto', border: '1px dashed #ccc' }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Shows how the message adapts to a constrained container width.',
      },
    },
  },
}; 