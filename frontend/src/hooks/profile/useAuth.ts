/**
 * Custom hook for authentication
 *
 * Provides a unified interface for handling authentication state and operations.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";

import { useProfileApi } from "./useProfileApi";

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: unknown;
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { profile, isLoading, error } = useProfileApi();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Determine authentication state based on profile data
  const authState: AuthState = {
    isAuthenticated: !!profile,
    isLoading: isLoading || isLoggingOut,
    error,
  };

  /**
   * Log the user out
   */
  const logout = useCallback(async () => {
    try {
      setIsLoggingOut(true);

      // In a real implementation, this would call a logout API endpoint
      // For now, just clear the query cache
      await queryClient.invalidateQueries();
      queryClient.clear();

      // Redirect to login page in real implementation
      window.location.href = "/";
    } catch (error) {
      console.error("Failed to log out:", error);
      throw error;
    } finally {
      setIsLoggingOut(false);
    }
  }, [queryClient]);

  return {
    ...authState,
    profile,
    logout,
  };
}
