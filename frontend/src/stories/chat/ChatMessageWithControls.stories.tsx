import type { Meta, StoryObj } from '@storybook/react';
import { ChatMessageWithControls } from '../../components/ui/ChatMessageWithControls';
import { ChatMessageFactory } from './mockData';

const meta = {
  title: 'Chat/ChatMessageWithControls',
  component: ChatMessageWithControls,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Enhanced ChatMessage with configurable controls for message actions.

## Technical Notes
- Composes ChatMessage with MessageControls
- Controls visibility configurable (default visible in stories)
- Maintains all ChatMessage features
- Handles user/assistant-specific actions
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
    onCopy: { action: 'copied' },
    onEdit: { action: 'edit clicked' },
    onLike: { action: 'liked' },
    onDislike: { action: 'disliked' },
    onRerun: { action: 'rerun clicked' },
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
  },
};

export const AssistantMessage: Story = {
  args: {
    message: ChatMessageFactory.samples.assistant,
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