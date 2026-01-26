import { t, msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useMemo, useState, memo } from "react";
import { useDebounce } from "use-debounce";

import { Alert } from "@/components/ui/Feedback/Alert";
import { Input } from "@/components/ui/Input/Input";
import { useOrganizationMembersSearch } from "@/hooks/sharing";

import type { ShareGrant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { OrganizationMember } from "@/types/sharing";

/** Filter type for subject selector */
export type SubjectTypeFilter = "all" | "user" | "group";

interface SubjectSelectorProps {
  selectedIds: string[];
  onToggleSubject: (subject: OrganizationMember) => void;
  disabled?: boolean;
  className?: string;
  existingGrants?: ShareGrant[];
  /** Filter to show only users, only groups, or all (default: "all") */
  subjectTypeFilter?: SubjectTypeFilter;
}

/**
 * SubjectSelector component for selecting users and groups to share with
 *
 * Provides a searchable list with checkboxes for multi-select.
 * Uses backend search to filter users and groups instead of client-side filtering.
 */
export const SubjectSelector = memo<SubjectSelectorProps>(
  ({
    selectedIds,
    onToggleSubject,
    disabled = false,
    className = "",
    existingGrants = [],
    subjectTypeFilter = "all",
  }) => {
    const [searchQuery, setSearchQuery] = useState("");
    // Use use-debounce library for consistent debounce behavior across the app
    // isPending() returns true while the debounce timer is running
    const [debouncedQuery, { isPending }] = useDebounce(searchQuery, 300);

    // Use backend search hook
    const {
      members: searchResults,
      isLoading,
      error: searchError,
      isSearching,
    } = useOrganizationMembersSearch({
      query: debouncedQuery,
      subjectTypeFilter,
      minQueryLength: 2,
    });

    // Create a set of subject IDs that already have grants
    const grantedSubjectIds = useMemo(() => {
      return new Set(existingGrants.map((grant) => grant.subject_id));
    }, [existingGrants]);

    // Filter out subjects that already have grants
    const filteredSubjects = useMemo(() => {
      return searchResults.filter(
        (subject) => !grantedSubjectIds.has(subject.id),
      );
    }, [searchResults, grantedSubjectIds]);

    // Group filtered subjects by type (only needed for "all" view)
    const { users, groups } = useMemo(() => {
      if (subjectTypeFilter !== "all") {
        // When filtered, all subjects are the same type
        return subjectTypeFilter === "user"
          ? { users: filteredSubjects, groups: [] }
          : { users: [], groups: filteredSubjects };
      }
      const usersList = filteredSubjects.filter((s) => s.type === "user");
      const groupsList = filteredSubjects.filter((s) => s.type === "group");
      return { users: usersList, groups: groupsList };
    }, [filteredSubjects, subjectTypeFilter]);

    // Check if search is still pending (debounce timer is running)
    const isSearchPending = isPending();

    // Check if query meets minimum length
    const meetsMinLength = searchQuery.trim().length >= 2;

    // Get filter-specific labels
    const getAllGrantedLabel = () => {
      switch (subjectTypeFilter) {
        case "user":
          return t({
            id: "sharing.empty.allUsersGranted",
            message: "All users already have access",
          });
        case "group":
          return t({
            id: "sharing.empty.allGroupsGranted",
            message: "All groups already have access",
          });
        default:
          return t({
            id: "sharing.empty.allGranted",
            message: "All users and groups already have access",
          });
      }
    };

    const getSearchPlaceholder = () => {
      switch (subjectTypeFilter) {
        case "user":
          return t({
            id: "sharing.searchPlaceholder.users",
            message: "Search users...",
          });
        case "group":
          return t({
            id: "sharing.searchPlaceholder.groups",
            message: "Search groups...",
          });
        default:
          return t({
            id: "sharing.searchPlaceholder",
            message: "Search users and groups...",
          });
      }
    };

    // Determine which content to show below the search input
    const allGranted =
      filteredSubjects.length === 0 &&
      searchResults.length > 0 &&
      !isLoading &&
      !isSearching;

    // Render content based on state
    const renderContent = () => {
      // Query too short or empty - don't show anything (placeholder is self-explanatory)
      if (!meetsMinLength) {
        return null;
      }

      // Error state
      if (searchError) {
        return (
          <Alert type="error">
            {t({
              id: "sharing.error.loadMembers",
              message: "Failed to load users and groups",
            })}
          </Alert>
        );
      }

      // All found subjects already have grants
      if (allGranted) {
        return (
          <div className="py-8 text-center">
            <p className="text-sm text-theme-fg-muted">
              {getAllGrantedLabel()}
            </p>
          </div>
        );
      }

      // Results list
      return (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-theme-border">
          {/* Loading state */}
          {(isLoading || isSearching) && filteredSubjects.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-sm text-theme-fg-secondary">
                {t({ id: "sharing.loading", message: "Loading..." })}
              </p>
            </div>
          )}

          {/* Empty search results */}
          {filteredSubjects.length === 0 && !isLoading && !isSearching && (
            <div className="py-8 text-center">
              <p className="text-sm text-theme-fg-muted">
                {t({
                  id: "sharing.empty.noResults",
                  message: "No matches found",
                })}
              </p>
            </div>
          )}

          {/* Users section - show header only in "all" view */}
          {users.length > 0 && (
            <>
              {subjectTypeFilter === "all" && (
                <div className="bg-theme-bg-secondary px-4 py-2 text-xs font-medium uppercase tracking-wider text-theme-fg-muted">
                  {t({ id: "sharing.section.users", message: "Users" })}
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

          {/* Groups section - show header only in "all" view */}
          {groups.length > 0 && (
            <>
              {subjectTypeFilter === "all" && (
                <div className="bg-theme-bg-secondary px-4 py-2 text-xs font-medium uppercase tracking-wider text-theme-fg-muted">
                  {t({ id: "sharing.section.groups", message: "Groups" })}
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

    // Single return - Input is always the same element, preserving focus
    return (
      <div className={className}>
        {/* Search input - always rendered to preserve focus */}
        <div className="mb-3">
          <div className="relative">
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={getSearchPlaceholder()}
              disabled={disabled}
            />
            {/* Show subtle loading indicator when search is pending or searching */}
            {meetsMinLength && (isSearchPending || isSearching) && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="size-4 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
              </div>
            )}
          </div>
        </div>

        {/* Content area - varies based on state */}
        {renderContent()}
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
SubjectSelector.displayName = "SubjectSelector";

// Individual row component
interface SubjectRowProps {
  subject: OrganizationMember;
  isSelected: boolean;
  onToggle: (subject: OrganizationMember) => void;
  disabled: boolean;
}

const SubjectRow = memo<SubjectRowProps>(
  ({ subject, isSelected, onToggle, disabled }) => {
    const { _ } = useLingui();
    const displayName = subject.display_name;

    return (
      <div className="theme-transition flex items-center gap-3 px-4 py-3 hover:bg-theme-bg-hover">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(subject)}
          disabled={disabled}
          className="size-4 rounded border-theme-border text-theme-fg-accent focus:ring-theme-focus disabled:cursor-not-allowed"
          aria-label={_(
            msg({
              id: "sharing.select.ariaLabel",
              message: `Select ${displayName}`,
            }),
          )}
        />

        {/* Subject info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-theme-fg-primary">
              {subject.display_name}
            </span>
            <span className="shrink-0 rounded-full bg-theme-bg-secondary px-2 py-0.5 text-xs text-theme-fg-secondary">
              {subject.type === "user"
                ? t({ id: "sharing.type.user", message: "User" })
                : t({ id: "sharing.type.group", message: "Group" })}
            </span>
          </div>
        </div>
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
SubjectRow.displayName = "SubjectRow";
