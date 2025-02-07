import type { Meta, StoryObj } from '@storybook/react';
import { MessageControls } from '../../components/ui/MessageControls';

const meta = {
  title: 'CHAT/MessageControls',
  component: MessageControls,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Message control buttons with configurable visibility.

## Technical Notes
- Controls visibility configurable (default visible in stories)
- Different controls for user/assistant messages
- Positioned absolutely within parent container
- Supports hover mode for production use
        `
      },
      story: {
        inline: true,
        iframeHeight: 200,
      },
    }
  },
  argTypes: {
    showOnHover: {
      control: 'boolean',
      description: 'Whether controls should only show on hover',
      defaultValue: false,
      table: {
        defaultValue: { summary: 'false' },
      }
    },
  },
  args: {
    showOnHover: false,
  },
  decorators: [
    (Story) => (
      <div className="relative group p-8 bg-theme-bg-secondary inline-block min-w-[300px] min-h-[100px] mb-20 rounded">
        <Story />
      </div>
    )
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof MessageControls>;

export default meta;
type Story = StoryObj<typeof meta>;

// Show all possible controls
export const AllControls: Story = {
  args: {
    isUser: false,
    onCopy: () => console.log('copy'),
    onEdit: () => console.log('edit'),
    onLike: () => console.log('like'),
    onDislike: () => console.log('dislike'),
    onRerun: () => console.log('rerun'),
  },
};

// User-specific controls
export const UserControls: Story = {
  args: {
    isUser: true,
    onCopy: () => console.log('copy'),
    onEdit: () => console.log('edit'),
  },
};

// Assistant-specific controls
export const AssistantControls: Story = {
  args: {
    isUser: false,
    onCopy: () => console.log('copy'),
    onLike: () => console.log('like'),
    onDislike: () => console.log('dislike'),
    onRerun: () => console.log('rerun'),
  },
};

// Hover behavior example
export const HoverControls: Story = {
  args: {
    ...AllControls.args,
    showOnHover: true,
  },
};

// Disabled state example
export const DisabledControls: Story = {
  args: {
    isUser: false,
    onCopy: undefined,
    onEdit: undefined,
    onLike: undefined,
    onDislike: undefined,
    onRerun: undefined,
  },
}; 