/**
 * SharingDialog Component Stories
 *
 * Stories showing the visual states of the sharing dialog.
 * Uses mock data and a presentational implementation for Storybook.
 */

import { useState, useCallback, memo } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { SegmentedControl } from "@/components/ui/Controls/SegmentedControl";
import { Alert } from "@/components/ui/Feedback/Alert";
import { Input } from "@/components/ui/Input/Input";
import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { ShareGrantsList } from "@/components/ui/Sharing/ShareGrantsList";
import { ShareIcon } from "@/components/ui/icons";

import {
  mockShareGrants,
  mockUsers,
  mockGroups,
} from "./sharing/mockSharingData";

import type { ShareGrant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { OrganizationMember } from "@/types/sharing";
import type { Meta, StoryObj } from "@storybook/react";

/**
 * Presentational SubjectSelector for stories
 * Accepts data as props instead of using hooks
 */
interface MockSubjectSelectorProps {
  members: OrganizationMember[];
  selectedIds: string[];
  onToggleSubject: (subject: OrganizationMember) => void;
  existingGrants?: ShareGrant[];
  subjectTypeFilter?: "all" | "user" | "group";
}

const MockSubjectSelector = memo<MockSubjectSelectorProps>(
  ({
    members,
    selectedIds,
    onToggleSubject,
    existingGrants = [],
    subjectTypeFilter = "all",
  }) => {
    const [searchQuery, setSearchQuery] = useState("");

    // Filter by search and existing grants
    const grantedIds = new Set(existingGrants.map((g) => g.subject_id));
    const filtered = members.filter((m) => {
      if (grantedIds.has(m.id)) return false;
      if (
        searchQuery &&
        !m.display_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;
      if (subjectTypeFilter !== "all" && m.type !== subjectTypeFilter)
        return false;
      return true;
    });

    const users = filtered.filter((m) => m.type === "user");
    const groups = filtered.filter((m) => m.type === "group");
    const meetsMinLength = searchQuery.trim().length >= 2;

    const getPlaceholder = () => {
      switch (subjectTypeFilter) {
        case "user":
          return "Search users...";
        case "group":
          return "Search groups...";
        default:
          return "Search users and groups...";
      }
    };

    return (
      <div>
        <div className="mb-3">
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={getPlaceholder()}
          />
        </div>

        {!meetsMinLength ? null : filtered.length === 0 ? (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-theme-border">
            <div className="py-8 text-center">
              <p className="text-sm text-theme-fg-muted">No matches found</p>
            </div>
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-theme-border">
            {users.length > 0 && (
              <>
                {subjectTypeFilter === "all" && (
                  <div className="bg-theme-bg-secondary px-4 py-2 text-xs font-medium uppercase tracking-wider text-theme-fg-muted">
                    Users
                  </div>
                )}
                <div className="divide-y divide-theme-border">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-theme-bg-hover"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(user.id)}
                        onChange={() => onToggleSubject(user)}
                        className="size-4 rounded border-theme-border"
                      />
                      <span className="font-medium text-theme-fg-primary">
                        {user.display_name}
                      </span>
                      <span className="rounded-full bg-theme-bg-secondary px-2 py-0.5 text-xs text-theme-fg-secondary">
                        User
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {groups.length > 0 && (
              <>
                {subjectTypeFilter === "all" && (
                  <div className="bg-theme-bg-secondary px-4 py-2 text-xs font-medium uppercase tracking-wider text-theme-fg-muted">
                    Groups
                  </div>
                )}
                <div className="divide-y divide-theme-border">
                  {groups.map((group) => (
                    <div
                      key={group.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-theme-bg-hover"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(group.id)}
                        onChange={() => onToggleSubject(group)}
                        className="size-4 rounded border-theme-border"
                      />
                      <span className="font-medium text-theme-fg-primary">
                        {group.display_name}
                      </span>
                      <span className="rounded-full bg-theme-bg-secondary px-2 py-0.5 text-xs text-theme-fg-secondary">
                        Group
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  },
);
MockSubjectSelector.displayName = "MockSubjectSelector";

/**
 * Mock SharingDialog for Storybook
 */
interface MockSharingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  resourceName: string;
  initialGrants?: ShareGrant[];
  showLoadingGrants?: boolean;
}

function MockSharingDialog({
  isOpen,
  onClose,
  resourceName,
  initialGrants = mockShareGrants,
  showLoadingGrants = false,
}: MockSharingDialogProps) {
  const [selectedSubjects, setSelectedSubjects] = useState<
    OrganizationMember[]
  >([]);
  const [grants, setGrants] = useState<ShareGrant[]>(initialGrants);
  const [successMessage, setSuccessMessage] = useState("");
  const [subjectTypeFilter, setSubjectTypeFilter] = useState<"user" | "group">(
    "user",
  );

  const selectedIds = selectedSubjects.map((s) => s.id);

  const handleToggle = useCallback((subject: OrganizationMember) => {
    setSelectedSubjects((prev) =>
      prev.some((s) => s.id === subject.id)
        ? prev.filter((s) => s.id !== subject.id)
        : [...prev, subject],
    );
  }, []);

  const handleAdd = useCallback(async () => {
    if (selectedSubjects.length === 0) return;
    await new Promise((r) => setTimeout(r, 300));

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
    await new Promise((r) => setTimeout(r, 300));
    setGrants((prev) => prev.filter((g) => g.id !== grantId));
    setSuccessMessage("Access removed successfully");
    setTimeout(() => setSuccessMessage(""), 3000);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedSubjects([]);
    setSuccessMessage("");
    setSubjectTypeFilter("user");
    onClose();
  }, [onClose]);

  // Get members based on filter
  const members = subjectTypeFilter === "user" ? mockUsers : mockGroups;

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      title={`Share "${resourceName}"`}
    >
      <div className="space-y-5">
        {successMessage && <Alert type="success">{successMessage}</Alert>}

        <div>
          <h3 className="mb-2 text-sm font-medium text-theme-fg-primary">
            Add people
          </h3>

          <div className="mb-3">
            <SegmentedControl
              options={[
                { value: "user" as const, label: "Users" },
                { value: "group" as const, label: "Groups" },
              ]}
              value={subjectTypeFilter}
              onChange={setSubjectTypeFilter}
              aria-label="Filter by users or groups"
            />
          </div>

          <MockSubjectSelector
            members={members}
            selectedIds={selectedIds}
            onToggleSubject={handleToggle}
            existingGrants={grants}
            subjectTypeFilter={subjectTypeFilter}
          />

          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              onClick={() => void handleAdd()}
              disabled={selectedSubjects.length === 0}
            >
              Add
            </Button>
          </div>
        </div>

        {/* Current access section - only show when there are grants or loading */}
        {(showLoadingGrants || grants.length > 0) && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-theme-fg-primary">
              Current access
            </h3>
            <ShareGrantsList
              grants={grants}
              onRemove={(id) => void handleRemove(id)}
              canManage={true}
              isLoading={showLoadingGrants}
            />
          </div>
        )}
      </div>
    </ModalBase>
  );
}

// Story metadata
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
- User/Group filter toggle
- Current grants list
- Add and remove functionality
- Success/error messages

**Note:** These stories use mock data. The real component uses
\`useShareGrants\` and backend search via \`useOrganizationMembersSearch\`.
        `,
      },
      story: { inline: false, iframeHeight: 700 },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof MockSharingDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// Wrapper for button trigger
function DialogWithTrigger(
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
 * Default - click button to open dialog
 */
export const Default: Story = {
  render: (args) => <DialogWithTrigger {...args} />,
  args: {
    isOpen: false,
    onClose: () => {},
    resourceName: "My Research Assistant",
  },
};

/**
 * Already open with grants
 */
export const AlreadyOpen: Story = {
  render: (args) => <MockSharingDialog {...args} />,
  args: {
    isOpen: true,
    onClose: () => {},
    resourceName: "Customer Support Assistant",
    initialGrants: mockShareGrants,
  },
};

/**
 * Empty grants - no one has access yet
 */
export const EmptyGrants: Story = {
  render: (args) => <MockSharingDialog {...args} />,
  args: {
    isOpen: true,
    onClose: () => {},
    resourceName: "New Assistant",
    initialGrants: [],
  },
};

/**
 * Loading grants state
 */
export const LoadingGrants: Story = {
  render: (args) => <MockSharingDialog {...args} />,
  args: {
    isOpen: true,
    onClose: () => {},
    resourceName: "Loading Demo",
    showLoadingGrants: true,
  },
};

/**
 * Long resource name
 */
export const LongResourceName: Story = {
  render: (args) => <DialogWithTrigger {...args} />,
  args: {
    isOpen: false,
    onClose: () => {},
    resourceName:
      "Advanced Data Analysis and Visualization Assistant with Multiple Capabilities",
  },
};
