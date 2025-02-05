import type { Meta, StoryObj } from '@storybook/react';
import { ChatMessage } from '../components/ui/ChatMessage';

const meta = {
  title: 'UI/ChatMessage',
  component: ChatMessage,
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#1a1a1a' },
      ],
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UserMessage: Story = {
  args: {
    message: {
      id: '1',
      sender: 'user',
      content: 'Hello, how are you?',
      createdAt: new Date(),
    },
  },
};

export const BotMessage: Story = {
  args: {
    message: {
      id: '2',
      sender: 'bot',
      content: 'I am doing well, thank you for asking! How can I help you today?',
      createdAt: new Date(),
    },
  },
};

export const LongMessage: Story = {
  args: {
    message: {
      id: '3',
      sender: 'bot',
      content: `This is a much longer message that demonstrates how the chat bubble handles multiple lines of text. It should wrap properly and maintain readability while staying within the maximum width constraints set by the component.

It even includes multiple paragraphs to show how spacing works.`,
      createdAt: new Date(),
    },
  },
};

export const WithCodeBlock: Story = {
  args: {
    message: {
      id: '4',
      sender: 'bot',
      content: '```javascript\nconst greeting = "Hello World";\nconsole.log(greeting);\n```',
      createdAt: new Date(),
    },
  },
};

export const WithMarkdown: Story = {
  args: {
    message: {
      id: '5',
      sender: 'bot',
      content: '**Bold text** and *italic text* with a [link](https://example.com)',
      createdAt: new Date(),
    },
  },
}; 