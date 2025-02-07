import type { Meta, StoryObj } from '@storybook/react';
import { ChatMessage } from '../../components/ui/ChatMessage';
import { ChatMessageFactory } from './mockData';

const meta = {
  title: 'CHAT/ChatMessage/Variations',
  component: ChatMessage,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Different variations of the ChatMessage component showcasing various configurations and use cases.'
      }
    }
  },
  argTypes: {
    maxWidth: {
      control: { type: 'number' },
      description: 'Maximum width of the message container in pixels',
    },
    showTimestamp: {
      control: { type: 'boolean' },
      description: 'Whether to show the timestamp',
    },
    showAvatar: {
      control: { type: 'boolean' },
      description: 'Whether to show the avatar',
    }
  },
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoAvatar: Story = {
  args: {
    message: ChatMessageFactory.samples.user,
    showAvatar: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'ChatMessage without an avatar, useful for compact layouts.'
      }
    }
  }
};

export const NoTimestamp: Story = {
  args: {
    message: ChatMessageFactory.samples.user,
    showTimestamp: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'ChatMessage without a timestamp display.'
      }
    }
  }
};

export const NarrowContainer: Story = {
  args: {
    message: ChatMessageFactory.samples.longMessage,
    maxWidth: 400,
  },
  parameters: {
    docs: {
      description: {
        story: 'ChatMessage in a narrow container to demonstrate text wrapping.'
      }
    }
  }
};

export const MessageSequence: Story = {
  args: {
    message: ChatMessageFactory.samples.user,
  },
  parameters: {
    docs: {
      description: {
        story: 'A sequence of messages showing a conversation flow.'
      }
    }
  },
  decorators: [
    (Story) => (
      <div className="space-y-2 w-full max-w-3xl">
        <Story />
      </div>
    )
  ],
  render: () => (
    <>
      <ChatMessage message={ChatMessageFactory.samples.user} />
      <ChatMessage message={ChatMessageFactory.samples.assistant} />
      <ChatMessage message={ChatMessageFactory.samples.longMessage} />
    </>
  ),
}; 