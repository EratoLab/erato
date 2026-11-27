/**
 * Hook for fetching and managing budget status
 *
 * Uses TanStack Query for automatic caching and refetching.
 * Multiple components can use this hook and will share the same cache.
 */
import { useQuery } from "@tanstack/react-query";
import { useContext } from "react";

import { fetchBudgetStatus } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { ProfileContext } from "@/providers/ProfileProvider";

import type { BudgetUserSettings } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface BudgetStatusResponse {
  /** Whether the budget feature is enabled */
  enabled: boolean;
  /** Number of days in the rolling budget window */
  budget_period_days: number | null;
  /** Known spending in the rolling window (unit-less) */
  current_spending: number | null;
  /** The warning threshold (0.0 to 1.0) */
  warn_threshold: number | null;
  /** The budget limit for the rolling window (unit-less) */
  budget_limit: number | null;
  /** The currency configured for display purposes */
  budget_currency: "USD" | "EUR" | null;
  user_settings: BudgetUserSettings | null;
}

interface UseBudgetStatusOptions {
  /** Whether the query should be enabled (default: true) */
  enabled?: boolean;
  /** Interval to automatically refetch (in milliseconds, or false to disable) */
  refetchInterval?:
    | number
    | false
    | ((status: BudgetStatusResponse | undefined) => number | false);
  /** Refresh when this observer mounts, even with a recent cached result. */
  refreshOnMount?: boolean;
}

/**
 * Query key prefix used to invalidate the cache after a chat response.
 */
export const BUDGET_QUERY_KEY = ["budget-status"] as const;
export const BUDGET_REFRESH_INTERVAL = 60_000;

const normalizeBudgetStatusResponse = (
  response: Awaited<ReturnType<typeof fetchBudgetStatus>>,
): BudgetStatusResponse => ({
  enabled: response.enabled,
  budget_period_days: response.budget_period_days ?? null,
  current_spending: response.current_spending ?? null,
  warn_threshold: response.warn_threshold ?? null,
  budget_limit: response.budget_limit ?? null,
  budget_currency: response.budget_currency ?? null,
  user_settings: response.user_settings ?? null,
});

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
  const { enabled = true, refetchInterval = false, refreshOnMount } = options;
  const profileContext = useContext(ProfileContext);
  const profileId = profileContext?.profile?.id;

  return useQuery({
    queryKey: profileContext
      ? [...BUDGET_QUERY_KEY, profileId ?? null]
      : BUDGET_QUERY_KEY,
    queryFn: async ({ signal }) =>
      normalizeBudgetStatusResponse(await fetchBudgetStatus({}, signal)),
    enabled: enabled && (!profileContext || !!profileId),
    refetchInterval:
      typeof refetchInterval === "function"
        ? (query) => refetchInterval(query.state.data)
        : refetchInterval,
    refetchOnMount: refreshOnMount ? "always" : true,
    refetchOnWindowFocus: "always",
    staleTime: 30 * 1000, // Data is fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes (formerly cacheTime)
    retry: 1, // Only retry once on failure
  });
}
