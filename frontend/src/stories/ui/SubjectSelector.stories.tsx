/**
 * SubjectSelector Component Stories
 *
 * Stories showing the visual states of the subject selector component.
 * Uses a presentational wrapper to display static UI states without backend.
 */

import { useState, memo } from "react";

import { Input } from "@/components/ui/Input/Input";

import {
  mockOrganizationMembers,
  mockShareGrants,
  mockUsers,
  mockGroups,
} from "./sharing/mockSharingData";

import type { ShareGrant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { OrganizationMember } from "@/types/sharing";
import type { Meta, StoryObj } from "@storybook/react";

/**
 * Presentational SubjectSelector for Storybook
 *
 * This is a simplified version that accepts data as props for visual testing.
 * The real SubjectSelector component fetches data via useOrganizationMembersSearch.
 */
interface SubjectSelectorViewProps {
  members: OrganizationMember[];
  selectedIds: string[];
  onToggleSubject: (subject: OrganizationMember) => void;
  disabled?: boolean;
  className?: string;
  existingGrants?: ShareGrant[];
  subjectTypeFilter?: "all" | "user" | "group";
  isLoading?: boolean;
  isSearching?: boolean;
  searchQuery?: string;
  showStartTyping?: boolean;
  showError?: boolean;
}

const SubjectSelectorView = memo<SubjectSelectorViewProps>(
  ({
    members,
    selectedIds,
    onToggleSubject,
    disabled = false,
    className = "",
    existingGrants = [],
    subjectTypeFilter = "all",
    isLoading = false,
    isSearching = false,
    searchQuery = "",
    showStartTyping = false,
    showError = false,
  }) => {
    const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);

    // Filter out already granted subjects
    const grantedSubjectIds = new Set(
      existingGrants.map((grant) => grant.subject_id),
    );
    const filteredSubjects = members.filter(
      (subject) => !grantedSubjectIds.has(subject.id),
    );

    // Group by type
    const users =
      subjectTypeFilter === "group"
        ? []
        : filteredSubjects.filter((s) => s.type === "user");
    const groups =
      subjectTypeFilter === "user"
        ? []
        : filteredSubjects.filter((s) => s.type === "group");

    const getSearchPlaceholder = () => {
      switch (subjectTypeFilter) {
        case "user":
          return "Search users...";
        case "group":
          return "Search groups...";
        default:
          return "Search users and groups...";
      }
    };

    const getStartTypingLabel = () => {
      switch (subjectTypeFilter) {
        case "user":
          return "Start typing to search for users";
        case "group":
          return "Start typing to search for groups";
        default:
          return "Start typing to search for users or groups";
      }
    };

    const renderContent = () => {
      if (showStartTyping) {
        return (
          <div className="py-12 text-center">
            <p className="text-sm text-theme-fg-muted">
              {getStartTypingLabel()}
            </p>
          </div>
        );
      }

      if (showError) {
        return (
          <div className="py-8 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">
              Failed to load users and groups
            </p>
          </div>
        );
      }

      return (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-theme-border">
          {(isLoading || isSearching) && filteredSubjects.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-sm text-theme-fg-secondary">Loading...</p>
            </div>
          )}

          {filteredSubjects.length === 0 && !isLoading && !isSearching && (
            <div className="py-8 text-center">
              <p className="text-sm text-theme-fg-muted">No matches found</p>
            </div>
          )}

          {users.length > 0 && (
            <>
              {subjectTypeFilter === "all" && (
                <div className="bg-theme-bg-secondary px-4 py-2 text-xs font-medium uppercase tracking-wider text-theme-fg-muted">
                  Users
                </div>
              )}
              <div className="divide-y divide-theme-border">
                {users.map((user) => (
                  <SubjectRow
                    key={user.id}
                    subject={user}
                    isSelected={selectedIds.includes(user.id)}
                    onToggle={onToggleSubject}
                    disabled={disabled}
                  />
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
                  <SubjectRow
                    key={group.id}
                    subject={group}
                    isSelected={selectedIds.includes(group.id)}
                    onToggle={onToggleSubject}
                    disabled={disabled}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      );
    };

    return (
      <div className={className}>
        <div className="mb-3">
          <div className="relative">
            <Input
              type="search"
              value={localSearchQuery}
              onChange={(e) => setLocalSearchQuery(e.target.value)}
              placeholder={getSearchPlaceholder()}
              disabled={disabled}
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="size-4 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
              </div>
            )}
          </div>
        </div>
        {renderContent()}
      </div>
    );
  },
);
SubjectSelectorView.displayName = "SubjectSelectorView";

// Row component
interface SubjectRowProps {
  subject: OrganizationMember;
  isSelected: boolean;
  onToggle: (subject: OrganizationMember) => void;
  disabled: boolean;
}

const SubjectRow = memo<SubjectRowProps>(
  ({ subject, isSelected, onToggle, disabled }) => {
    return (
      <div className="theme-transition flex items-center gap-3 px-4 py-3 hover:bg-theme-bg-hover">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(subject)}
          disabled={disabled}
          className="size-4 rounded border-theme-border text-theme-fg-accent focus:ring-theme-focus disabled:cursor-not-allowed"
          aria-label={`Select ${subject.display_name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-theme-fg-primary">
              {subject.display_name}
            </span>
            <span className="shrink-0 rounded-full bg-theme-bg-secondary px-2 py-0.5 text-xs text-theme-fg-secondary">
              {subject.type === "user" ? "User" : "Group"}
            </span>
          </div>
        </div>
      </div>
    );
  },
);
SubjectRow.displayName = "SubjectRow";

// Story metadata
const meta = {
  title: "UI/Sharing/SubjectSelector",
  component: SubjectSelectorView,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
Sub-component for selecting users and groups to share with.

**Features:**
- Search input with typeahead
- Type badges (User/Group)
- Multi-select with checkboxes
- Grouped display (Users first, then Groups)
- Loading states during search
- Empty states for no query and no results

**Note:** These stories use a presentational wrapper with mock data.
The real component uses \`useOrganizationMembersSearch\` for backend search.
        `,
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof SubjectSelectorView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Interactive wrapper
function SubjectSelectorStory(
  args: React.ComponentProps<typeof SubjectSelectorView>,
) {
  const [selectedIds, setSelectedIds] = useState<string[]>(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- storybook args may be undefined
    args.selectedIds || [],
  );

  const handleToggle = (subject: OrganizationMember) => {
    setSelectedIds((prev) =>
      prev.includes(subject.id)
        ? prev.filter((id) => id !== subject.id)
        : [...prev, subject.id],
    );
  };

  return (
    <SubjectSelectorView
      {...args}
      selectedIds={selectedIds}
      onToggleSubject={handleToggle}
    />
  );
}

/**
 * Initial empty state - prompts user to start typing
 */
export const StartTyping: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    members: [],
    selectedIds: [],
    onToggleSubject: () => {},
    showStartTyping: true,
  },
};

/**
 * Loading state while searching
 */
export const Loading: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    members: [],
    selectedIds: [],
    onToggleSubject: () => {},
    isSearching: true,
    searchQuery: "alice",
  },
};

/**
 * Error state when search fails
 */
export const Error: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    members: [],
    selectedIds: [],
    onToggleSubject: () => {},
    showError: true,
    searchQuery: "test",
  },
};

/**
 * No results found
 */
export const NoResults: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    members: [],
    selectedIds: [],
    onToggleSubject: () => {},
    searchQuery: "xyz",
  },
};

/**
 * With search results - all types
 */
export const WithResults: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    members: mockOrganizationMembers,
    selectedIds: [],
    onToggleSubject: () => {},
    searchQuery: "a",
  },
};

/**
 * Users only filter
 */
export const UsersOnly: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    members: mockUsers,
    selectedIds: [],
    onToggleSubject: () => {},
    subjectTypeFilter: "user",
    searchQuery: "a",
  },
};

/**
 * Groups only filter
 */
export const GroupsOnly: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    members: mockGroups,
    selectedIds: [],
    onToggleSubject: () => {},
    subjectTypeFilter: "group",
    searchQuery: "team",
  },
};

/**
 * With selections
 */
export const WithSelections: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    members: mockOrganizationMembers,
    selectedIds: ["user-001", "group-002"],
    onToggleSubject: () => {},
    searchQuery: "a",
  },
};

/**
 * Disabled state
 */
export const Disabled: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    members: mockOrganizationMembers,
    selectedIds: ["user-001"],
    onToggleSubject: () => {},
    disabled: true,
    searchQuery: "a",
  },
};

/**
 * With existing grants filtered out
 */
export const WithExistingGrants: Story = {
  render: (args) => <SubjectSelectorStory {...args} />,
  args: {
    members: mockOrganizationMembers,
    selectedIds: [],
    onToggleSubject: () => {},
    existingGrants: mockShareGrants,
    searchQuery: "a",
  },
};
