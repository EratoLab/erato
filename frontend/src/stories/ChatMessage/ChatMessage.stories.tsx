import type { Meta, StoryObj } from '@storybook/react';
import { ChatMessage } from '../../components/ui/ChatMessage';
import { mockMessages } from './mockData';

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
      description: 'The message object containing content, sender, and timestamp',
      control: 'object',
    },
    maxWidth: {
      control: { type: 'number' },
      description: 'Maximum width of the message container in pixels',
      table: {
        defaultValue: { summary: '768' }
      }
    },
    showTimestamp: {
      control: 'boolean',
      description: 'Whether to show the timestamp',
      table: {
        defaultValue: { summary: 'true' }
      }
    },
    showAvatar: {
      control: 'boolean',
      description: 'Whether to show the avatar',
      table: {
        defaultValue: { summary: 'true' }
      }
    }
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    message: mockMessages.assistant,
  },
};

// Force dark theme for this specific story
export const DarkTheme: Story = {
  args: {
    message: mockMessages.assistant,
  },
  parameters: {
    themes: { theme: 'dark' }
  }
}; 