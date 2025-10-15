/**
 * Hook for fetching and managing budget status
 *
 * Uses TanStack Query for automatic caching and refetching.
 * Multiple components can use this hook and will share the same cache.
 */
import { useQuery } from "@tanstack/react-query";

export interface BudgetStatusResponse {
  /** Whether the budget feature is enabled */
  enabled: boolean;
  /** Number of days in the current budget period */
  budget_period_days: number | null;
  /** Current spending in the budget period (unit-less) */
  current_spending: number | null;
  /** The warning threshold (0.0 to 1.0) */
  warn_threshold: number | null;
  /** The budget limit for the time period (unit-less) */
  budget_limit: number | null;
  /** The currency configured for display purposes */
  budget_currency: "USD" | "EUR" | null;
}

interface UseBudgetStatusOptions {
  /** Whether the query should be enabled (default: true) */
  enabled?: boolean;
  /** Interval to automatically refetch (in milliseconds, or false to disable) */
  refetchInterval?: number | false;
}

/**
 * Query key for budget status
 * Exported so other code can invalidate the cache
 */
export const BUDGET_QUERY_KEY = ["budget-status"] as const;

/**
 * Hook to fetch the current user's budget status
 *
 * @example
 * ```tsx
 * const { data: budgetStatus, isLoading } = useBudgetStatus();
 *
 * if (budgetStatus?.enabled) {
 *   // Show budget indicator
 * }
 * ```
 *
 * @example Trigger refetch from another component:
 * ```tsx
 * import { useQueryClient } from "@tanstack/react-query";
 * import { BUDGET_QUERY_KEY } from "@/hooks/budget/useBudgetStatus";
 *
 * const queryClient = useQueryClient();
 * queryClient.invalidateQueries({ queryKey: BUDGET_QUERY_KEY });
 * ```
 */
export function useBudgetStatus(options: UseBudgetStatusOptions = {}) {
  const { enabled = true, refetchInterval = false } = options;

  return useQuery({
    queryKey: BUDGET_QUERY_KEY,
    queryFn: async (): Promise<BudgetStatusResponse> => {
      // eslint-disable-next-line lingui/no-unlocalized-strings
      const response = await fetch("/api/v1beta/me/budget", {
        method: "GET",
        credentials: "include", // Include cookies for authentication
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Budget API error: ${response.status}`);
      }

      return response.json();
    },
    enabled,
    refetchInterval,
    staleTime: 30 * 1000, // Data is fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes (formerly cacheTime)
    retry: 1, // Only retry once on failure
  });
}
