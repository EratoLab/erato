import { t } from "@lingui/core/macro";
import { useMemo, useState, memo, useCallback } from "react";

import { Input } from "@/components/ui/Input/Input";
import { useFuzzySearch } from "@/utils/search/useFuzzySearch";

import type { ShareGrant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { OrganizationMember } from "@/types/sharing";

interface SubjectSelectorProps {
  availableSubjects: OrganizationMember[];
  selectedIds: string[];
  onToggleSubject: (subject: OrganizationMember) => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  existingGrants?: ShareGrant[];
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
  }) => {
    const [searchQuery, setSearchQuery] = useState("");

    // Create a set of subject IDs that already have grants
    const grantedSubjectIds = useMemo(() => {
      return new Set(existingGrants.map((grant) => grant.subject_id));
    }, [existingGrants]);

    // Filter out subjects that already have grants
    const unGrantedSubjects = useMemo(() => {
      return availableSubjects.filter(
        (subject) => !grantedSubjectIds.has(subject.id),
      );
    }, [availableSubjects, grantedSubjectIds]);

    // Sort function: prioritize users over groups, then alphabetically
    // Memoized with empty deps since it's a pure function with no external dependencies
    const sortByTypeAndName = useCallback(
      (a: OrganizationMember, b: OrganizationMember) => {
        // Users come before groups
        if (a.type !== b.type) {
          return a.type === "user" ? -1 : 1;
        }
        // Within same type, sort alphabetically
        return a.display_name.localeCompare(b.display_name);
      },
      [], // Empty deps: pure function, no external dependencies
    );

    // Memoize search keys array to prevent Fuse instance recreation
    // eslint-disable-next-line lingui/no-unlocalized-strings
    const searchKeys = useMemo(() => ["display_name"], []);

    // Fuzzy search with user prioritization (using unGranted subjects)
    const filteredSubjects = useFuzzySearch({
      items: unGrantedSubjects,
      keys: searchKeys,
      query: searchQuery,
      threshold: 0.3,
      sortFn: sortByTypeAndName,
    });

    // Group filtered subjects by type
    const { users, groups } = useMemo(() => {
      const usersList = filteredSubjects.filter((s) => s.type === "user");
      const groupsList = filteredSubjects.filter((s) => s.type === "group");
      return { users: usersList, groups: groupsList };
    }, [filteredSubjects]);

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

    // Empty state (no subjects available)
    if (availableSubjects.length === 0) {
      return (
        <div className={`py-8 text-center ${className}`}>
          <p className="text-sm text-theme-fg-muted">
            {t({
              id: "sharing.empty.noMembers",
              message: "No users or groups available",
            })}
          </p>
        </div>
      );
    }

    // All subjects already have grants
    if (unGrantedSubjects.length === 0) {
      return (
        <div className={`py-8 text-center ${className}`}>
          <p className="text-sm text-theme-fg-muted">
            {t({
              id: "sharing.empty.allGranted",
              message: "All users and groups already have access",
            })}
          </p>
        </div>
      );
    }

    return (
      <div className={className}>
        {/* Search input */}
        <div className="mb-3">
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t({
              id: "sharing.searchPlaceholder",
              message: "Search users and groups...",
            })}
            disabled={disabled}
          />
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

          {/* Users section */}
          {users.length > 0 && (
            <>
              <div className="bg-theme-bg-secondary px-4 py-2 text-xs font-medium uppercase tracking-wider text-theme-fg-muted">
                {t({ id: "sharing.section.users", message: "Users" })}
              </div>
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

          {/* Groups section */}
          {groups.length > 0 && (
            <>
              <div className="bg-theme-bg-secondary px-4 py-2 text-xs font-medium uppercase tracking-wider text-theme-fg-muted">
                {t({ id: "sharing.section.groups", message: "Groups" })}
              </div>
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
    return (
      <div className="theme-transition flex items-center gap-3 px-4 py-3 hover:bg-theme-bg-hover">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(subject)}
          disabled={disabled}
          className="size-4 rounded border-theme-border text-theme-fg-accent focus:ring-theme-focus disabled:cursor-not-allowed"
          aria-label={t({
            id: "sharing.select.ariaLabel",
            message: "Select {name}",
            values: { name: subject.display_name },
          })}
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
