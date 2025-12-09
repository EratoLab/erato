/**
 * SharingDialog Component Stories
 *
 * Stories for the complete sharing dialog
 *
 * Note: Since SharingDialog uses React Query hooks internally, we provide
 * mock implementations using a standalone component version for Storybook.
 */

import { useState, useCallback } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { ShareGrantsList } from "@/components/ui/Sharing/ShareGrantsList";
import { SubjectSelector } from "@/components/ui/Sharing/SubjectSelector";
import { ShareIcon } from "@/components/ui/icons";

import {
  mockOrganizationMembers,
  mockShareGrants,
} from "./sharing/mockSharingData";

import type { ShareGrant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { OrganizationMember } from "@/types/sharing";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Sharing/SharingDialog",
  component: MockSharingDialog,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
Complete dialog for managing resource sharing.

**Features:**
- Modal with overlay and focus trap
- Subject selector with search
- Current grants list
- Add and remove functionality
- Success/error message handling
- Loading states
- Resource-agnostic design (works for assistants, chats, etc.)

**Note:** These stories use mock data and a standalone implementation.
In production, the SharingDialog component uses real API calls via
the \`useShareGrants\` and \`useOrganizationMembers\` hooks.
        `,
      },
      story: {
        inline: false,
        iframeHeight: 700,
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof MockSharingDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mock dialog implementation for Storybook
interface MockSharingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  resourceType: "assistant";
  resourceId: string;
  resourceName: string;
  initialGrants?: ShareGrant[];
  initialMembers?: OrganizationMember[];
  showLoadingMembers?: boolean;
  showLoadingGrants?: boolean;
}

function MockSharingDialog({
  isOpen,
  onClose,
  resourceName,
  initialGrants = mockShareGrants,
  initialMembers = mockOrganizationMembers,
  showLoadingMembers = false,
  showLoadingGrants = false,
}: MockSharingDialogProps) {
  const [selectedSubjects, setSelectedSubjects] = useState<
    OrganizationMember[]
  >([]);
  const [grants, setGrants] = useState<ShareGrant[]>(initialGrants);
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const selectedIds = selectedSubjects.map((s) => s.id);

  const handleToggleSubject = useCallback((subject: OrganizationMember) => {
    setSelectedSubjects((prev) => {
      const isSelected = prev.some((s) => s.id === subject.id);
      if (isSelected) {
        return prev.filter((s) => s.id !== subject.id);
      }
      return [...prev, subject];
    });
  }, []);

  const handleAdd = useCallback(async () => {
    if (selectedSubjects.length === 0) return;

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Add new grants
    const newGrants: ShareGrant[] = selectedSubjects.map((subject) => ({
      id: `grant-${Date.now()}-${subject.id}`,
      resource_type: "assistant",
      resource_id: "assistant-123",
      subject_type: subject.type === "user" ? "user" : "organization_group",
      subject_id_type: subject.subject_type_id,
      subject_id: subject.id,
      role: "viewer",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    setGrants((prev) => [...prev, ...newGrants]);
    setSelectedSubjects([]);
    setSuccessMessage("Access granted successfully");
    setTimeout(() => setSuccessMessage(""), 3000);
  }, [selectedSubjects]);

  const handleRemove = useCallback(async (grantId: string) => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500));

    setGrants((prev) => prev.filter((g) => g.id !== grantId));
    setSuccessMessage("Access removed successfully");
    setTimeout(() => setSuccessMessage(""), 3000);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedSubjects([]);
    setSuccessMessage("");
    setErrorMessage("");
    onClose();
  }, [onClose]);

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      title={`Share ${resourceName}`}
    >
      <div className="space-y-5">
        {successMessage && <Alert type="success">{successMessage}</Alert>}
        {errorMessage && <Alert type="error">{errorMessage}</Alert>}

        <div>
          <h3 className="mb-2 text-sm font-medium text-theme-fg-primary">
            Add people
          </h3>
          <SubjectSelector
            availableSubjects={initialMembers}
            selectedIds={selectedIds}
            onToggleSubject={handleToggleSubject}
            isLoading={showLoadingMembers}
          />
          <Button
            variant="primary"
            onClick={() => {
              void handleAdd();
            }}
            className="mt-3"
            disabled={selectedSubjects.length === 0}
          >
            Add
          </Button>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-theme-fg-primary">
            Current access
          </h3>
          <ShareGrantsList
            grants={grants}
            onRemove={(grantId: string) => {
              void handleRemove(grantId);
            }}
            canManage={true}
            isLoading={showLoadingGrants}
            availableSubjects={initialMembers}
          />
        </div>
      </div>
    </ModalBase>
  );
}

// Wrapper to handle open/close state
function SharingDialogStory(
  args: React.ComponentProps<typeof MockSharingDialog>,
) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-theme-bg-secondary p-8">
      <Button
        variant="primary"
        icon={<ShareIcon className="size-4" />}
        onClick={() => setIsOpen(true)}
      >
        Open Sharing Dialog
      </Button>

      <MockSharingDialog
        {...args}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </div>
  );
}

/**
 * Default sharing dialog for an assistant
 *
 * Note: This uses mock data. In production, the dialog fetches real data
 * from the backend via hooks.
 */
export const Default: Story = {
  render: (args) => <SharingDialogStory {...args} />,
  args: {
    isOpen: false,
    onClose: () => console.log("Close dialog"),
    resourceType: "assistant",
    resourceId: "assistant-123",
    resourceName: "My Research Assistant",
  },
};

/**
 * Dialog already open
 *
 * Useful for testing the dialog contents without clicking the button.
 */
export const AlreadyOpen: Story = {
  render: (args) => <MockSharingDialog {...args} />,
  args: {
    isOpen: true,
    onClose: () => console.log("Close dialog"),
    resourceType: "assistant",
    resourceId: "assistant-123",
    resourceName: "Customer Support Assistant",
    initialGrants: mockShareGrants,
    initialMembers: mockOrganizationMembers,
  },
};

/**
 * Long resource name
 *
 * Tests how the dialog handles lengthy assistant names.
 */
export const LongResourceName: Story = {
  render: (args) => <SharingDialogStory {...args} />,
  args: {
    isOpen: false,
    onClose: () => console.log("Close dialog"),
    resourceType: "assistant",
    resourceId: "assistant-456",
    resourceName:
      "Advanced Data Analysis and Visualization Assistant with Multiple Capabilities",
  },
};

/**
 * Dialog with empty grants (no one has access yet)
 */
export const EmptyGrants: Story = {
  render: (args) => <MockSharingDialog {...args} />,
  args: {
    isOpen: true,
    onClose: () => console.log("Close dialog"),
    resourceType: "assistant",
    resourceId: "assistant-456",
    resourceName: "New Assistant",
    initialGrants: [],
    initialMembers: mockOrganizationMembers,
  },
};

/**
 * Loading states
 */
export const LoadingMembers: Story = {
  render: (args) => <MockSharingDialog {...args} />,
  args: {
    isOpen: true,
    onClose: () => console.log("Close dialog"),
    resourceType: "assistant",
    resourceId: "assistant-789",
    resourceName: "Loading Demo",
    initialGrants: mockShareGrants,
    showLoadingMembers: true,
  },
};

export const LoadingGrants: Story = {
  render: (args) => <MockSharingDialog {...args} />,
  args: {
    isOpen: true,
    onClose: () => console.log("Close dialog"),
    resourceType: "assistant",
    resourceId: "assistant-789",
    resourceName: "Loading Demo",
    initialMembers: mockOrganizationMembers,
    showLoadingGrants: true,
  },
};

// Component for InteractiveDemo story
function InteractiveDemoComponent(
  args: React.ComponentProps<typeof MockSharingDialog>,
) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-theme-fg-secondary">
        Click the button below to open the sharing dialog and try:
      </p>
      <ul className="list-inside list-disc space-y-1 text-sm text-theme-fg-muted">
        <li>Searching for users and groups</li>
        <li>Selecting multiple subjects</li>
        <li>Adding them to the access list</li>
        <li>Removing existing grants (with confirmation)</li>
      </ul>
      <Button
        variant="primary"
        icon={<ShareIcon className="size-4" />}
        onClick={() => setIsOpen(true)}
      >
        Open Sharing Dialog
      </Button>
      <MockSharingDialog
        {...args}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </div>
  );
}

/**
 * Interactive demo
 *
 * Try opening the dialog and interacting with it. The dialog will show
 * mock data for users, groups, and existing grants.
 */
export const InteractiveDemo: Story = {
  render: (args) => <InteractiveDemoComponent {...args} />,
  args: {
    isOpen: false,
    onClose: () => console.log("Close dialog"),
    resourceType: "assistant",
    resourceId: "assistant-789",
    resourceName: "Interactive Demo Assistant",
    initialGrants: mockShareGrants.slice(0, 1), // Start with one grant
    initialMembers: mockOrganizationMembers,
  },
};
