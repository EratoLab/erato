import { t, msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useMemo, useState, memo, useDeferredValue } from "react";

import { Input } from "@/components/ui/Input/Input";
import { useFuzzySearch } from "@/hooks/search/useFuzzySearch";

import type { ShareGrant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { OrganizationMember } from "@/types/sharing";

// Module-level constants - stable references, no need for useMemo/useCallback
// eslint-disable-next-line lingui/no-unlocalized-strings
const SEARCH_KEYS = ["display_name"];

// Pure sorting function - prioritize users over groups, then alphabetically
const sortByTypeAndName = (a: OrganizationMember, b: OrganizationMember) => {
  // Users come before groups
  if (a.type !== b.type) {
    return a.type === "user" ? -1 : 1;
  }
  // Within same type, sort alphabetically
  return a.display_name.localeCompare(b.display_name);
};

// Sort alphabetically only (for single-type views)
const sortByName = (a: OrganizationMember, b: OrganizationMember) => {
  return a.display_name.localeCompare(b.display_name);
};

/** Filter type for subject selector */
export type SubjectTypeFilter = "all" | "user" | "group";

interface SubjectSelectorProps {
  availableSubjects: OrganizationMember[];
  selectedIds: string[];
  onToggleSubject: (subject: OrganizationMember) => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  existingGrants?: ShareGrant[];
  /** Filter to show only users, only groups, or all (default: "all") */
  subjectTypeFilter?: SubjectTypeFilter;
}

/**
 * SubjectSelector component for selecting users and groups to share with
 *
 * Provides a searchable list with checkboxes for multi-select
 */
export const SubjectSelector = memo<SubjectSelectorProps>(
  ({
    availableSubjects,
    selectedIds,
    onToggleSubject,
    isLoading = false,
    disabled = false,
    className = "",
    existingGrants = [],
    subjectTypeFilter = "all",
  }) => {
    const [searchQuery, setSearchQuery] = useState("");

    // Defer search query to keep input responsive during expensive search operations
    // React 18 concurrent feature - search runs with lower priority than typing
    const deferredSearchQuery = useDeferredValue(searchQuery);

    // Create a set of subject IDs that already have grants
    const grantedSubjectIds = useMemo(() => {
      return new Set(existingGrants.map((grant) => grant.subject_id));
    }, [existingGrants]);

    // Filter out subjects that already have grants and apply type filter
    const unGrantedSubjects = useMemo(() => {
      return availableSubjects.filter((subject) => {
        // Filter out already granted subjects
        if (grantedSubjectIds.has(subject.id)) {
          return false;
        }
        // Apply type filter
        if (subjectTypeFilter !== "all" && subject.type !== subjectTypeFilter) {
          return false;
        }
        return true;
      });
    }, [availableSubjects, grantedSubjectIds, subjectTypeFilter]);

    // Determine sort function based on filter - no need for type grouping when showing single type
    const sortFn = subjectTypeFilter === "all" ? sortByTypeAndName : sortByName;

    // Fuzzy search with user prioritization (using unGranted subjects)
    // Using module-level constants for keys and sortFn - stable references
    // Search uses deferred query to prevent blocking the input field
    const filteredSubjects = useFuzzySearch({
      items: unGrantedSubjects,
      keys: SEARCH_KEYS,
      query: deferredSearchQuery,
      threshold: 0.3,
      sortFn,
    });

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

    // Check if search is still pending (input is ahead of deferred value)
    const isSearchPending = searchQuery !== deferredSearchQuery;

    // Get filter-specific labels
    const getEmptyLabel = () => {
      switch (subjectTypeFilter) {
        case "user":
          return t({
            id: "sharing.empty.noUsers",
            message: "No users available",
          });
        case "group":
          return t({
            id: "sharing.empty.noGroups",
            message: "No groups available",
          });
        default:
          return t({
            id: "sharing.empty.noMembers",
            message: "No users or groups available",
          });
      }
    };

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

    // Loading state
    if (isLoading) {
      return (
        <div className={`py-12 text-center ${className}`}>
          <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
          <p className="text-sm text-theme-fg-secondary">
            {t({ id: "sharing.loading", message: "Loading..." })}
          </p>
        </div>
      );
    }

    // Empty state (no subjects available for this filter)
    if (unGrantedSubjects.length === 0 && availableSubjects.length === 0) {
      return (
        <div className={`py-8 text-center ${className}`}>
          <p className="text-sm text-theme-fg-muted">{getEmptyLabel()}</p>
        </div>
      );
    }

    // All subjects already have grants
    if (unGrantedSubjects.length === 0) {
      return (
        <div className={`py-8 text-center ${className}`}>
          <p className="text-sm text-theme-fg-muted">{getAllGrantedLabel()}</p>
        </div>
      );
    }

    return (
      <div className={className}>
        {/* Search input */}
        <div className="mb-3">
          <div className="relative">
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={getSearchPlaceholder()}
              disabled={disabled}
            />
            {/* Show subtle loading indicator when search is pending */}
            {isSearchPending && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="size-4 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
              </div>
            )}
          </div>
        </div>

        {/* Results list */}
        <div className="max-h-64 overflow-y-auto rounded-lg border border-theme-border">
          {/* Empty search results */}
          {filteredSubjects.length === 0 && searchQuery.trim() && (
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
