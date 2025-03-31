/**
 * Custom hook for profile management
 *
 * Uses the generated API hooks to fetch and manage user profile data
 * while adding application-specific logic.
 */
import { useProfile as useProfileQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";

export function useProfile() {
  // Use the generated API hook to fetch profile data
  const {
    data: profile,
    isLoading,
    isError,
    error,
    refetch,
  } = useProfileQuery(
    {},
    {
      // Set up error retry behavior
      retry: (failureCount, _error) => {
        // Retry up to 3 times
        return failureCount < 3;
      },
    },
  );

  return {
    profile,
    isLoading,
    isError,
    error,
    refetch,
  };
}
