/**
 * Custom hook for searching organization members (users and groups)
 *
 * Uses backend search to filter users and groups instead of client-side filtering.
 * Only fetches data when a search query with minimum length is provided.
 */
import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  useListOrganizationUsers,
  useListOrganizationGroups,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { SubjectTypeFilter } from "@/components/ui/Sharing/SubjectSelector";
import type { OrganizationMember } from "@/types/sharing";

interface UseOrganizationMembersSearchResult {
  members: OrganizationMember[];
  isLoading: boolean;
  error: unknown;
  isSearching: boolean;
}

interface UseOrganizationMembersSearchParams {
  query: string;
  subjectTypeFilter: SubjectTypeFilter;
  minQueryLength?: number;
}

/**
 * Hook for searching organization users and groups with backend filtering
 *
 * Only fetches when query meets minimum length requirement (default: 2 characters).
 * Filters by subject type (users, groups, or all).
 *
 * @param query - Search query string
 * @param subjectTypeFilter - Filter to show only users, only groups, or all
 * @param minQueryLength - Minimum query length before triggering search (default: 2)
 */
export function useOrganizationMembersSearch({
  query,
  subjectTypeFilter,
  minQueryLength = 2,
}: UseOrganizationMembersSearchParams): UseOrganizationMembersSearchResult {
  // Only search if query meets minimum length
  const shouldSearch = query.trim().length >= minQueryLength;
  const trimmedQuery = query.trim();

  // Determine which endpoints to call based on filter
  const shouldFetchUsers =
    shouldSearch &&
    (subjectTypeFilter === "all" || subjectTypeFilter === "user");
  const shouldFetchGroups =
    shouldSearch &&
    (subjectTypeFilter === "all" || subjectTypeFilter === "group");

  // Fetch users with search query
  // Note: is_involved filter is NOT used here - backend search returns relevant results
  // based on the query. is_involved is only for the "fetch all" scenario.
  const {
    data: usersData,
    isLoading: isLoadingUsers,
    error: usersError,
    isFetching: isFetchingUsers,
  } = useListOrganizationUsers(
    shouldFetchUsers
      ? {
          queryParams: {
            query: trimmedQuery,
          },
        }
      : skipToken,
  );

  // Fetch groups with search query
  // Note: is_involved filter is NOT used here - backend search returns relevant results
  // based on the query. is_involved is only for the "fetch all" scenario.
  const {
    data: groupsData,
    isLoading: isLoadingGroups,
    error: groupsError,
    isFetching: isFetchingGroups,
  } = useListOrganizationGroups(
    shouldFetchGroups
      ? {
          queryParams: {
            query: trimmedQuery,
          },
        }
      : skipToken,
  );

  // Combine loading states
  const isLoading = isLoadingUsers || isLoadingGroups;
  const isSearching = isFetchingUsers || isFetchingGroups;

  // Combine errors (prefer users error if both exist)
  const error = usersError ?? groupsError;

  // Combine users and groups with type discriminator
  const members = useMemo((): OrganizationMember[] => {
    if (!shouldSearch) {
      return [];
    }

    const usersWithType: OrganizationMember[] =
      usersData?.users.map((user) => ({
        ...user,
        type: "user" as const,
      })) ?? [];

    const groupsWithType: OrganizationMember[] =
      groupsData?.groups.map((group) => ({
        ...group,
        type: "group" as const,
      })) ?? [];

    // Backend already handles sorting, but we'll ensure consistent ordering
    // Return users first, then groups (already sorted by backend)
    return [...usersWithType, ...groupsWithType];
  }, [shouldSearch, usersData, groupsData]);

  return {
    members,
    isLoading,
    error,
    isSearching,
  };
}
