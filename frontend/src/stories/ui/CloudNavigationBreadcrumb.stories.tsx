/**
 * CloudNavigationBreadcrumb Component Stories
 *
 * Individual stories for the breadcrumb navigation sub-component
 */

import { CloudNavigationBreadcrumb } from "@/components/ui/CloudFilePicker/CloudNavigationBreadcrumb";

import type { BreadcrumbSegment } from "@/lib/api/cloudProviders/types";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Cloud File Picker/CloudNavigationBreadcrumb",
  component: CloudNavigationBreadcrumb,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
Breadcrumb navigation component showing the current location path.

**Features:**
- Clickable segments to navigate up the hierarchy
- Current location highlighted
- Chevron separators between segments
- Empty state message when no breadcrumbs
- Responsive design with horizontal scrolling
        `,
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CloudNavigationBreadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockBreadcrumbs: BreadcrumbSegment[] = [
  { id: "drive_001", name: "My OneDrive", type: "drive" },
  { id: "folder_docs", name: "Documents", type: "folder" },
  { id: "folder_reports", name: "Reports", type: "folder" },
];

/**
 * No breadcrumbs - initial state
 */
export const Empty: Story = {
  args: {
    breadcrumbs: [],
    onNavigate: (segmentId) => console.log("Navigate to:", segmentId),
  },
};

/**
 * Single segment - at drive root
 */
export const DriveRoot: Story = {
  args: {
    breadcrumbs: [{ id: "drive_001", name: "My OneDrive", type: "drive" }],
    onNavigate: (segmentId) => console.log("Navigate to:", segmentId),
  },
};

/**
 * Two segments - drive and one folder
 */
export const OneFolder: Story = {
  args: {
    breadcrumbs: [
      { id: "drive_001", name: "My OneDrive", type: "drive" },
      { id: "folder_docs", name: "Documents", type: "folder" },
    ],
    onNavigate: (segmentId) => console.log("Navigate to:", segmentId),
  },
};

/**
 * Deep nesting - multiple folders
 */
export const DeepNesting: Story = {
  args: {
    breadcrumbs: mockBreadcrumbs,
    onNavigate: (segmentId) => console.log("Navigate to:", segmentId),
  },
};

/**
 * Very long path with many segments
 */
export const LongPath: Story = {
  args: {
    breadcrumbs: [
      { id: "drive_001", name: "My OneDrive", type: "drive" },
      { id: "folder_1", name: "Work Projects", type: "folder" },
      { id: "folder_2", name: "2024", type: "folder" },
      { id: "folder_3", name: "Q4", type: "folder" },
      { id: "folder_4", name: "Client Documents", type: "folder" },
      { id: "folder_5", name: "Final Deliverables", type: "folder" },
    ],
    onNavigate: (segmentId) => console.log("Navigate to:", segmentId),
  },
};
