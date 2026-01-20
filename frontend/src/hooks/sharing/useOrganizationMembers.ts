/**
 * Custom hook for fetching organization members (users and groups)
 *
 * Combines users and groups from Entra ID integration into a unified list
 */
import { useMemo } from "react";

import {
  useListOrganizationUsers,
  useListOrganizationGroups,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { OrganizationMember } from "@/types/sharing";

interface UseOrganizationMembersResult {
  members: OrganizationMember[];
  isLoading: boolean;
  error: unknown;
}

/**
 * Hook for fetching all organization users and groups
 *
 * Only fetches users and groups that the current user is "involved" with:
 * - Groups: only groups the user is a member of
 * - Users: only users who share at least one group with the current user
 */
export function useOrganizationMembers(): UseOrganizationMembersResult {
  // Fetch users (only those sharing groups with the current user)
  const {
    data: usersData,
    isLoading: isLoadingUsers,
    error: usersError,
  } = useListOrganizationUsers({
    queryParams: { is_involved: true },
  });

  // Fetch groups (only those the user is a member of)
  const {
    data: groupsData,
    isLoading: isLoadingGroups,
    error: groupsError,
  } = useListOrganizationGroups({
    queryParams: { is_involved: true },
  });

  // Combine loading states
  const isLoading = isLoadingUsers || isLoadingGroups;

  // Combine errors (prefer users error if both exist)
  const error = usersError ?? groupsError;

  // Combine users and groups with type discriminator
  const members = useMemo((): OrganizationMember[] => {
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

    // Return users first, then groups (sorted alphabetically within each type)
    const sortedUsers = usersWithType.sort((a, b) =>
      a.display_name.localeCompare(b.display_name),
    );
    const sortedGroups = groupsWithType.sort((a, b) =>
      a.display_name.localeCompare(b.display_name),
    );

    return [...sortedUsers, ...sortedGroups];
  }, [usersData, groupsData]);

  return {
    members,
    isLoading,
    error,
  };
}
