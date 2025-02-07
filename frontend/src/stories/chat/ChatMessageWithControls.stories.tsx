import type { Meta, StoryObj } from '@storybook/react';
import { ChatMessageWithControls } from '../../components/ui/ChatMessageWithControls';
import { ChatMessageFactory } from './mockData';
import { action } from '@storybook/addon-actions';

const meta = {
  title: 'Chat/ChatMessageWithControls',
  component: ChatMessageWithControls,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Enhanced ChatMessage with configurable controls and loading states.

## Technical Notes
- Supports streaming responses with different loading states
- Shows contextual information during processing
- Handles tool calling and reasoning states
- Maintains all ChatMessage features
        `
      }
    }
  },
  argTypes: {
    showControlsOnHover: {
      control: 'boolean',
      description: 'Whether controls should only show on hover',
      defaultValue: false,
    },
    showAvatar: {
      control: 'boolean',
      description: 'Whether to show the avatar',
      defaultValue: false,
    },
    showTimestamp: {
      control: 'boolean',
      description: 'Whether to show the timestamp',
      defaultValue: true,
    },
    onCopy: { 
      action: 'copied',
      description: 'Callback when copy button is clicked',
    },
    onEdit: { 
      action: 'edited',
      description: 'Callback when edit button is clicked (user messages only)',
    },
    onLike: { 
      action: 'liked',
      description: 'Callback when like button is clicked (assistant messages only)',
    },
    onDislike: { 
      action: 'disliked',
      description: 'Callback when dislike button is clicked (assistant messages only)',
    },
    onRerun: { 
      action: 'rerun',
      description: 'Callback when regenerate button is clicked (assistant messages only)',
    },
  },
  args: {
    showControlsOnHover: false,
    showAvatar: false,
    showTimestamp: true,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ChatMessageWithControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UserMessage: Story = {
  args: {
    message: ChatMessageFactory.samples.user,
    onCopy: action('copy'),
    onEdit: action('edit'),
  },
};

export const AssistantMessage: Story = {
  args: {
    message: ChatMessageFactory.samples.assistant,
    onCopy: action('copy'),
    onLike: action('like'),
    onDislike: action('dislike'),
    onRerun: action('rerun'),
  },
};

export const LongMessage: Story = {
  args: {
    message: ChatMessageFactory.samples.longMessage,
  },
};

export const PermanentControls: Story = {
  args: {
    message: ChatMessageFactory.samples.assistant,
    showControlsOnHover: false,
  },
};

export const HoverControls: Story = {
  args: {
    message: ChatMessageFactory.samples.assistant,
    showControlsOnHover: true,
  },
}; 