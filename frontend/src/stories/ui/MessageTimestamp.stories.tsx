import { MessageTimestamp } from "../../components/ui/Message/MessageTimestamp";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/MessageTimestamp",
  component: MessageTimestamp,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
Locale-aware timestamp component for chat messages.

## Technical Notes
- Uses semantic \`time\` element with machine-readable \`datetime\` attribute
- Provides both tooltip (full date) and visible time format
- Supports relative time display ("2 minutes ago") and exact time display
- Auto-updates relative timestamps with smart intervals
- Memoized to prevent unnecessary re-renders
- Implements i18n requirements from CREQ-0003

## Time Handling
- Stores dates in UTC internally
- Displays in user's local timezone
- Supports both 12h/24h formats based on locale
- Relative time updates automatically based on age
        `,
      },
    },
  },
  argTypes: {
    createdAt: {
      control: "date",
      description: "The timestamp to display",
    },
    displayStyle: {
      control: "radio",
      options: ["relative", "time"],
      description: "Display style for the timestamp",
    },
    autoUpdate: {
      control: "boolean",
      description: "Enable auto-updates for relative timestamps",
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof MessageTimestamp>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RelativeTime: Story = {
  args: {
    createdAt: new Date(),
    displayStyle: "relative",
    autoUpdate: false,
  },
};

export const ExactTime: Story = {
  args: {
    createdAt: new Date(),
    displayStyle: "time",
  },
};

export const RelativeTimeNoAutoUpdate: Story = {
  args: {
    createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    displayStyle: "relative",
    autoUpdate: false,
  },
};

// Different time ranges for relative display
export const MinutesAgo: Story = {
  args: {
    createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
  },
};

export const HoursAgo: Story = {
  args: {
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
  },
};

export const DaysAgo: Story = {
  args: {
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
  },
};

export const MonthsAgo: Story = {
  args: {
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // ~2 months ago
  },
};
