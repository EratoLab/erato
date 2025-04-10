/**
 * Custom hook for profile management
 *
 * Uses the generated API hooks to fetch and manage user profile data
 * while adding application-specific logic.
 */
import { useCallback } from "react";

import { useProfile as useProfileQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";

/**
 * Hook for fetching profile data from the API
 */
export function useProfileApi() {
  const {
    data: profile,
    isLoading,
    error,
    refetch,
  } = useProfileQuery(
    {},
    {
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  const refreshProfile = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    profile,
    isLoading,
    error,
    refreshProfile,
  };
}
