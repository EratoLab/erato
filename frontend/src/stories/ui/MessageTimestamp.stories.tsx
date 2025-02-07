import type { Meta, StoryObj } from '@storybook/react';
import { MessageTimestamp } from '../../components/ui/MessageTimestamp';

const meta = {
  title: 'UI/MessageTimestamp',
  component: MessageTimestamp,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Locale-aware timestamp component for chat messages.

## Technical Notes
- Uses semantic \`time\` element with machine-readable \`datetime\` attribute
- Provides both tooltip (full date) and visible time format
- Memoized to prevent unnecessary re-renders
- Implements i18n requirements from CREQ-0003

## Time Handling
- Stores dates in UTC internally
- Displays in user's local timezone
- Supports both 12h/24h formats based on locale
        `
      }
    }
  },
  argTypes: {
    createdAt: {
      control: 'date',
      description: 'The timestamp to display',
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof MessageTimestamp>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {
  args: {
    createdAt: new Date(),
  },
};

export const SpecificTime: Story = {
  args: {
    createdAt: new Date('2024-03-20T15:30:00'),
  },
};

export const PastDate: Story = {
  args: {
    createdAt: new Date('2024-01-01T12:00:00'),
  },
}; 