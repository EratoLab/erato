/**
 * Custom hook for profile management
 *
 * Uses the generated API hooks to fetch and manage user profile data
 * while adding application-specific logic.
 */
import { useCallback, useEffect } from "react";

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
      refetchOnWindowFocus: "always",
    },
  );

  const refreshProfile = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Handle session expiry by reloading the page when we get a 401/403 error
  // This will trigger a redirect to the login page
  useEffect(() => {
    if (error) {
      console.error("Profile fetch error:", error);
      const errorObj = error as { status?: number | string };
      const status = errorObj.status;
      if (status === 401 || status === 403) {
        console.log("Session expired, reloading page to redirect to login");
        window.location.reload();
      }
    }
  }, [error]);

  return {
    profile,
    isLoading,
    error,
    refreshProfile,
  };
}
