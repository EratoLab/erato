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
 * Fetches initial results when query is empty, then filters when query is provided.
 * Filters by subject type (users, groups, or all).
 *
 * @param query - Search query string (empty string fetches first page)
 * @param subjectTypeFilter - Filter to show only users, only groups, or all
 * @param minQueryLength - Minimum query length before triggering search (default: 0 to load initial results)
 */
export function useOrganizationMembersSearch({
  query,
  subjectTypeFilter,
  minQueryLength = 0,
}: UseOrganizationMembersSearchParams): UseOrganizationMembersSearchResult {
  // Search if query is empty (initial load) or meets minimum length
  const trimmedQuery = query.trim();
  const shouldSearch =
    trimmedQuery.length === 0 || trimmedQuery.length >= minQueryLength;

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
            // Pass empty string for initial load to get first page
            query: trimmedQuery,
          },
        }
      : skipToken,
  );

  // Fetch groups with search query
  // Note: is_involved filter is used for groups to only show groups the user is a member of
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
            is_involved: true,
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
