/**
 * CloudItemBrowser Component Stories
 *
 * Individual stories for the item browser sub-component
 */

import { useState } from "react";

import { CloudItemBrowser } from "@/components/ui/CloudFilePicker/CloudItemBrowser";

import {
  mockPersonalDriveItems,
  mockDocumentsFolderItems,
  mockItemsWithUnsupportedTypes,
  mockEmptyFolderItems,
} from "./cloud/mockCloudData";

import type { CloudItem } from "@/lib/api/cloudProviders/types";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Cloud File Picker/CloudItemBrowser",
  component: CloudItemBrowser,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
Sub-component that displays files and folders in a table layout.

**Features:**
- Folders listed first, then files (alphabetically sorted)
- Checkboxes (multi-select) or radio buttons (single-select)
- File metadata: size, last modified date
- Disabled state for unsupported file types
- Info tooltips for disabled files
- Loading skeleton states
- Empty state for empty folders
- Responsive columns (hide Size/Modified on small screens)
        `,
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    multiple: {
      control: "boolean",
      description: "Allow multiple file selection",
    },
    isLoading: {
      control: "boolean",
      description: "Show loading skeleton",
    },
  },
} satisfies Meta<typeof CloudItemBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

// Wrapper to handle selection state
function ItemBrowserStory(args: React.ComponentProps<typeof CloudItemBrowser>) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleToggle = (item: CloudItem) => {
    if (args.multiple) {
      setSelectedIds((prev) =>
        prev.includes(item.id)
          ? prev.filter((id) => id !== item.id)
          : [...prev, item.id],
      );
    } else {
      setSelectedIds([item.id]);
    }
  };

  return (
    <CloudItemBrowser
      {...args}
      selectedIds={selectedIds}
      onToggleItem={handleToggle}
    />
  );
}

const items = mockPersonalDriveItems.map((item) => ({
  ...item,
  provider: "sharepoint" as const,
  drive_id: "drive_001",
}));

/**
 * Default item browser with folders and files
 */
export const Default: Story = {
  render: (args) => <ItemBrowserStory {...args} />,
  args: {
    items,
    selectedIds: [],
    onToggleItem: (item) => console.log("Toggled:", item),
    onOpenFolder: (item) => console.log("Open folder:", item),
    canSelect: () => true,
    getDisabledReason: () => null,
    isLoading: false,
    multiple: true,
  },
};

/**
 * Loading state with skeleton loaders
 */
export const Loading: Story = {
  render: (args) => <ItemBrowserStory {...args} />,
  args: {
    items: [],
    selectedIds: [],
    onToggleItem: (item) => console.log("Toggled:", item),
    onOpenFolder: (item) => console.log("Open folder:", item),
    canSelect: () => true,
    getDisabledReason: () => null,
    isLoading: true,
    multiple: true,
  },
};

/**
 * Empty folder state
 */
export const Empty: Story = {
  render: (args) => <ItemBrowserStory {...args} />,
  args: {
    items: mockEmptyFolderItems.map((item) => ({
      ...item,
      provider: "sharepoint" as const,
      drive_id: "drive_001",
    })),
    selectedIds: [],
    onToggleItem: (item) => console.log("Toggled:", item),
    onOpenFolder: (item) => console.log("Open folder:", item),
    canSelect: () => true,
    getDisabledReason: () => null,
    isLoading: false,
    multiple: true,
  },
};

/**
 * With unsupported file types (disabled)
 */
export const WithUnsupportedTypes: Story = {
  render: (args) => <ItemBrowserStory {...args} />,
  args: {
    items: mockItemsWithUnsupportedTypes.map((item) => ({
      ...item,
      provider: "sharepoint" as const,
      drive_id: "drive_001",
    })),
    selectedIds: [],
    onToggleItem: (item) => console.log("Toggled:", item),
    onOpenFolder: (item) => console.log("Open folder:", item),
    canSelect: (item) => {
      if (item.is_folder) return true;
      const supportedTypes = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      return item.mime_type ? supportedTypes.includes(item.mime_type) : false;
    },
    getDisabledReason: (item) => {
      if (item.is_folder) return null;
      const supportedTypes = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      if (!item.mime_type || !supportedTypes.includes(item.mime_type)) {
        return "File type not supported at the moment";
      }
      return null;
    },
    isLoading: false,
    multiple: true,
  },
};

/**
 * Single selection mode (radio buttons)
 */
export const SingleSelect: Story = {
  render: (args) => <ItemBrowserStory {...args} />,
  args: {
    items: mockDocumentsFolderItems.map((item) => ({
      ...item,
      provider: "sharepoint" as const,
      drive_id: "drive_001",
    })),
    selectedIds: [],
    onToggleItem: (item) => console.log("Toggled:", item),
    onOpenFolder: (item) => console.log("Open folder:", item),
    canSelect: (item) => !item.is_folder,
    getDisabledReason: () => null,
    isLoading: false,
    multiple: false,
  },
};

/**
 * With some files pre-selected
 */
export const WithSelection: Story = {
  render: (args) => <ItemBrowserStory {...args} />,
  args: {
    items,
    selectedIds: ["file_budget_2024", "file_meeting_notes"],
    onToggleItem: (item) => console.log("Toggled:", item),
    onOpenFolder: (item) => console.log("Open folder:", item),
    canSelect: () => true,
    getDisabledReason: () => null,
    isLoading: false,
    multiple: true,
  },
};
