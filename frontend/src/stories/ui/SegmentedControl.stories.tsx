/**
 * SegmentedControl Component Stories
 *
 * Stories demonstrating the segmented control component for toggling between options
 */
import { Group, User } from "iconoir-react";
import { useState } from "react";

import { SegmentedControl } from "@/components/ui/Controls/SegmentedControl";

import type { SegmentedControlProps } from "@/components/ui/Controls/SegmentedControl";
import type { Meta, StoryObj } from "@storybook/react";

// Use string type for stories
type StringControlProps = SegmentedControlProps<string>;

const meta = {
  title: "UI/Controls/SegmentedControl",
  component: SegmentedControl,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
A segmented control component for toggling between a small set of mutually exclusive options.

**Features:**
- Accessible with proper ARIA tablist/tab roles
- Support for icons
- Size variants (sm, md)
- Disabled state (entire control or individual options)
- Keyboard navigation support

**Usage:**
Use for switching between 2-4 views or filter states. For more options, consider a dropdown menu.
        `,
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md"],
      description: "Size variant",
    },
    disabled: {
      control: "boolean",
      description: "Disable the entire control",
    },
  },
  decorators: [
    (Story) => (
      <div className="bg-theme-bg-primary p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SegmentedControl<string>>;

export default meta;
type Story = StoryObj<typeof meta>;

// Wrapper to handle state
function SegmentedControlStory(args: StringControlProps) {
  const [value, setValue] = useState(args.value);

  return <SegmentedControl {...args} value={value} onChange={setValue} />;
}

/**
 * Default two-option toggle (like Users/Groups)
 */
export const Default: Story = {
  render: (args) => <SegmentedControlStory {...args} />,
  args: {
    options: [
      { value: "users", label: "Users" },
      { value: "groups", label: "Groups" },
    ],
    value: "users",
    onChange: () => {},
    "aria-label": "Filter by type",
  },
};

/**
 * Three options
 */
export const ThreeOptions: Story = {
  render: (args) => <SegmentedControlStory {...args} />,
  args: {
    options: [
      { value: "all", label: "All" },
      { value: "active", label: "Active" },
      { value: "archived", label: "Archived" },
    ],
    value: "all",
    onChange: () => {},
    "aria-label": "Filter by status",
  },
};

/**
 * With icons
 */
export const WithIcons: Story = {
  render: (args) => <SegmentedControlStory {...args} />,
  args: {
    options: [
      { value: "users", label: "Users", icon: <User className="size-4" /> },
      { value: "groups", label: "Groups", icon: <Group className="size-4" /> },
    ],
    value: "users",
    onChange: () => {},
    "aria-label": "Filter by type",
  },
};

/**
 * Medium size
 */
export const MediumSize: Story = {
  render: (args) => <SegmentedControlStory {...args} />,
  args: {
    options: [
      { value: "users", label: "Users" },
      { value: "groups", label: "Groups" },
    ],
    value: "users",
    onChange: () => {},
    size: "md",
    "aria-label": "Filter by type",
  },
};

/**
 * Disabled state
 */
export const Disabled: Story = {
  render: (args) => <SegmentedControlStory {...args} />,
  args: {
    options: [
      { value: "users", label: "Users" },
      { value: "groups", label: "Groups" },
    ],
    value: "users",
    onChange: () => {},
    disabled: true,
    "aria-label": "Filter by type",
  },
};

/**
 * Single option disabled
 */
export const SingleOptionDisabled: Story = {
  render: (args) => <SegmentedControlStory {...args} />,
  args: {
    options: [
      { value: "users", label: "Users" },
      { value: "groups", label: "Groups", disabled: true },
    ],
    value: "users",
    onChange: () => {},
    "aria-label": "Filter by type",
  },
};

/**
 * View toggle example (common pattern)
 */
export const ViewToggle: Story = {
  render: (args) => <SegmentedControlStory {...args} />,
  args: {
    options: [
      { value: "list", label: "List" },
      { value: "grid", label: "Grid" },
    ],
    value: "list",
    onChange: () => {},
    "aria-label": "View mode",
  },
};

/**
 * My/Shared toggle (for assistants list)
 */
export const OwnershipFilter: Story = {
  render: (args) => <SegmentedControlStory {...args} />,
  args: {
    options: [
      { value: "mine", label: "My Assistants" },
      { value: "shared", label: "Shared with me" },
    ],
    value: "mine",
    onChange: () => {},
    "aria-label": "Filter by ownership",
  },
};
