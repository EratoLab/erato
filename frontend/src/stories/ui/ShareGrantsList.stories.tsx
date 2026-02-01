/**
 * ShareGrantsList Component Stories
 *
 * Stories for displaying current share grants
 */

import { ShareGrantsList } from "@/components/ui/Sharing/ShareGrantsList";

import {
  mockShareGrants,
  mockOrganizationMembers,
  mockShareGrantsWithProfiles,
} from "./sharing/mockSharingData";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Sharing/ShareGrantsList",
  component: ShareGrantsList,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
Component that displays current share grants for a resource.

**Features:**
- List of users/groups with access
- Type badges (User/Group) and role badges (Viewer)
- Created timestamp for each grant
- Remove button with confirmation dialog
- Loading skeleton states
- Empty state for no grants
        `,
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    canManage: {
      control: "boolean",
      description: "Allow removing grants",
    },
    isLoading: {
      control: "boolean",
      description: "Show loading skeleton",
    },
  },
} satisfies Meta<typeof ShareGrantsList>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default list with multiple grants
 */
export const Default: Story = {
  args: {
    grants: mockShareGrants,
    onRemove: (grantId) => console.log("Remove grant:", grantId),
    canManage: true,
    isLoading: false,
    availableSubjects: mockOrganizationMembers,
  },
};

/**
 * Read-only view (cannot manage)
 */
export const ReadOnly: Story = {
  args: {
    grants: mockShareGrants,
    onRemove: (grantId) => console.log("Remove grant:", grantId),
    canManage: false,
    isLoading: false,
    availableSubjects: mockOrganizationMembers,
  },
};

/**
 * Loading state
 */
export const Loading: Story = {
  args: {
    grants: [],
    onRemove: (grantId) => console.log("Remove grant:", grantId),
    canManage: true,
    isLoading: true,
    availableSubjects: [],
  },
};

/**
 * Empty state - no grants yet
 */
export const Empty: Story = {
  args: {
    grants: [],
    onRemove: (grantId) => console.log("Remove grant:", grantId),
    canManage: true,
    isLoading: false,
    availableSubjects: mockOrganizationMembers,
  },
};

/**
 * Single grant only
 */
export const SingleGrant: Story = {
  args: {
    grants: [mockShareGrants[0]],
    onRemove: (grantId) => console.log("Remove grant:", grantId),
    canManage: true,
    isLoading: false,
    availableSubjects: mockOrganizationMembers,
  },
};

/**
 * Grants with profile display names coming from the API.
 */
export const WithProfileDisplayNames: Story = {
  args: {
    grants: mockShareGrantsWithProfiles,
    onRemove: (grantId) => console.log("Remove grant:", grantId),
    canManage: true,
    isLoading: false,
    availableSubjects: [],
  },
};

/**
 * Large list with many grants
 */
export const LargeList: Story = {
  args: {
    grants: [
      ...mockShareGrants,
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `grant-${100 + i}`,
        resource_type: "assistant",
        resource_id: "assistant-123",
        subject_type: "user" as const,
        subject_id_type: "organization_user_id",
        subject_id: `user-${100 + i}`,
        role: "viewer" as const,
        created_at: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      })),
    ],
    onRemove: (grantId) => console.log("Remove grant:", grantId),
    canManage: true,
    isLoading: false,
    availableSubjects: [
      ...mockOrganizationMembers,
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `user-${100 + i}`,
        display_name: `User ${100 + i}`,
        subject_type_id: "organization_user_id" as const,
        type: "user" as const,
      })),
    ],
  },
};
