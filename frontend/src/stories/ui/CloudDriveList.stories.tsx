/**
 * CloudDriveList Component Stories
 *
 * Individual stories for the drive list sub-component
 */

import { CloudDriveList } from "@/components/ui/CloudFilePicker/CloudDriveList";

import { mockDrives } from "./cloud/mockCloudData";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Cloud File Picker/CloudDriveList",
  component: CloudDriveList,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
Sub-component that displays a list of available drives (OneDrive, SharePoint document libraries, etc.).

**Features:**
- Drive cards with icons and badges
- Shows drive type (Personal, Shared) and owner information
- Loading skeleton states
- Empty state for no drives
- Hover effects and focus states
        `,
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    isLoading: {
      control: "boolean",
      description: "Show loading skeleton",
    },
  },
} satisfies Meta<typeof CloudDriveList>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default drive list with multiple drives
 */
export const Default: Story = {
  args: {
    drives: mockDrives.map((d) => ({ ...d, provider: "sharepoint" as const })),
    onSelectDrive: (drive) => console.log("Selected drive:", drive),
    isLoading: false,
  },
};

/**
 * Loading state with skeleton loaders
 */
export const Loading: Story = {
  args: {
    drives: [],
    onSelectDrive: (drive) => console.log("Selected drive:", drive),
    isLoading: true,
  },
};

/**
 * Empty state - no drives available
 */
export const Empty: Story = {
  args: {
    drives: [],
    onSelectDrive: (drive) => console.log("Selected drive:", drive),
    isLoading: false,
  },
};

/**
 * Single drive only
 */
export const SingleDrive: Story = {
  args: {
    drives: [{ ...mockDrives[0], provider: "sharepoint" as const }],
    onSelectDrive: (drive) => console.log("Selected drive:", drive),
    isLoading: false,
  },
};
