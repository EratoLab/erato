/**
 * SubjectSelector Component Stories
 *
 * Stories for the subject (user/group) selector component used in sharing
 */

import { useState } from "react";

import { SubjectSelector } from "@/components/ui/Sharing/SubjectSelector";

import {
  mockOrganizationMembers,
  mockUsers,
  mockGroups,
  mockShareGrants,
} from "./sharing/mockSharingData";

import type { OrganizationMember } from "@/types/sharing";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Sharing/SubjectSelector",
  component: SubjectSelector,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
Sub-component for selecting users and groups to share with.

**Features:**
- Searchable list with fuzzy filtering
- Type badges (User/Group)
- Multi-select with checkboxes
- Grouped display (Users first, then Groups)
- Loading skeleton states
- Empty states for no results and no members
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
    disabled: {
      control: "boolean",
      description: "Disable selection",
    },
  },
} satisfies Meta<typeof SubjectSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

// Wrapper to handle selection state
function SubjectSelectorStory(
  args: React.ComponentProps<typeof SubjectSelector>,
) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleToggle = (subject: OrganizationMember) => {
    setSelectedIds((prev) =>
      prev.includes(subject.id)
        ? prev.filter((id) => id !== subject.id)
        : [...prev, subject.id],
    );
  };

  return (
    <SubjectSelector
      {...args}
      selectedIds={selectedIds}
      onToggleSubject={handleToggle}
    />
  );
}

/**
 * Default selector with users and groups
 */
export const Default: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    availableSubjects: mockOrganizationMembers,
    selectedIds: [],
    onToggleSubject: (subject) => console.log("Toggled:", subject),
    isLoading: false,
    disabled: false,
  },
};

/**
 * With some pre-selected subjects
 */
export const WithSelection: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    availableSubjects: mockOrganizationMembers,
    selectedIds: ["user-001", "group-001"],
    onToggleSubject: (subject) => console.log("Toggled:", subject),
    isLoading: false,
    disabled: false,
  },
};

/**
 * Loading state with skeleton
 */
export const Loading: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    availableSubjects: [],
    selectedIds: [],
    onToggleSubject: (subject) => console.log("Toggled:", subject),
    isLoading: true,
    disabled: false,
  },
};

/**
 * Empty state - no members available
 */
export const Empty: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    availableSubjects: [],
    selectedIds: [],
    onToggleSubject: (subject) => console.log("Toggled:", subject),
    isLoading: false,
    disabled: false,
  },
};

/**
 * Only users (no groups)
 */
export const UsersOnly: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    availableSubjects: mockUsers,
    selectedIds: [],
    onToggleSubject: (subject) => console.log("Toggled:", subject),
    isLoading: false,
    disabled: false,
  },
};

/**
 * Only groups (no users)
 */
export const GroupsOnly: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    availableSubjects: mockGroups,
    selectedIds: [],
    onToggleSubject: (subject) => console.log("Toggled:", subject),
    isLoading: false,
    disabled: false,
  },
};

/**
 * Disabled state
 */
export const Disabled: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    availableSubjects: mockOrganizationMembers,
    selectedIds: ["user-001"],
    onToggleSubject: (subject) => console.log("Toggled:", subject),
    isLoading: false,
    disabled: true,
  },
};

/**
 * Large list with many members
 */
export const LargeList: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    availableSubjects: [
      ...mockOrganizationMembers,
      // Add more mock users to demonstrate scrolling
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `user-${100 + i}`,
        display_name: `User ${100 + i}`,
        subject_type_id: "organization_user_id" as const,
        type: "user" as const,
      })),
    ],
    selectedIds: [],
    onToggleSubject: (subject) => console.log("Toggled:", subject),
    isLoading: false,
    disabled: false,
  },
};

/**
 * With existing grants (filtered out)
 * Shows that already-granted subjects are filtered from the list
 */
export const WithExistingGrants: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    availableSubjects: mockOrganizationMembers,
    selectedIds: [],
    onToggleSubject: (subject) => console.log("Toggled:", subject),
    isLoading: false,
    disabled: false,
    existingGrants: mockShareGrants,
  },
};

/**
 * All subjects already granted (empty state)
 */
export const AllGranted: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    availableSubjects: mockOrganizationMembers,
    selectedIds: [],
    onToggleSubject: (subject) => console.log("Toggled:", subject),
    isLoading: false,
    disabled: false,
    existingGrants: mockOrganizationMembers.map((member, i) => ({
      id: `grant-${i}`,
      resource_type: "assistant",
      resource_id: "assistant-123",
      subject_type:
        member.type === "user"
          ? ("user" as const)
          : ("organization_group" as const),
      subject_id_type: member.subject_type_id,
      subject_id: member.id,
      role: "viewer" as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
  },
};
