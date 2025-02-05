import type { Meta, StoryObj } from '@storybook/react';
import { ChatInput } from '../components/ui/ChatInput';
import { action } from '@storybook/addon-actions';

const meta = {
  title: 'UI/ChatInput',
  component: ChatInput,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    onSendMessage: { action: 'message sent' },
    isLoading: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof ChatInput>;

export default meta;
type Story = StoryObj<typeof meta>;

const defaultArgs = {
  onSendMessage: action('onSendMessage'),
};

export const Default: Story = {
  args: {
    ...defaultArgs,
  },
};

export const Loading: Story = {
  args: {
    ...defaultArgs,
    isLoading: true,
  },
};

export const WithCustomPlaceholder: Story = {
  args: {
    placeholder: 'Ask me anything...',
    ...defaultArgs,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    ...defaultArgs,
  },
};

export const WithCustomClassName: Story = {
  args: {
    className: 'bg-gray-100',
    ...defaultArgs,
  },
}; 