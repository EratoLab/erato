import type { Meta, StoryObj } from '@storybook/react';
import { ChatMessage } from '../../components/ui/ChatMessage';
import { ChatMessageFactory } from './mockData';

const meta = {
  title: 'UI/ChatMessage',
  component: ChatMessage,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A ChatMessage component that displays messages in a chat interface.

## Usage
\`\`\`jsx
<ChatMessage 
  message={message}
  showAvatar={true}
  showTimestamp={true}
  maxWidth={768}
/>
\`\`\`
        `
      }
    }
  },
  argTypes: {
    message: {
      control: 'object',
      description: 'The message object containing content, sender, and timestamp',
    },
    maxWidth: {
      control: { type: 'number' },
      description: 'Maximum width of the message container in pixels',
    },
    showTimestamp: {
      control: 'boolean',
      description: 'Whether to show the timestamp',
    },
    showAvatar: {
      control: 'boolean',
      description: 'Whether to show the avatar',
    }
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    message: ChatMessageFactory.samples.user
  },
};

export const LongMessage: Story = {
  args: {
    message: ChatMessageFactory.samples.longMessage
  }
};

export const Dynamic: Story = {
  args: {
    message: ChatMessageFactory.create({
      content: 'This content can be changed via controls'
    })
  }
};
