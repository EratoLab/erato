import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ProfileContext } from "@/providers/ProfileProvider";

import { useBudgetStatus, BUDGET_QUERY_KEY } from "../useBudgetStatus";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

describe("useBudgetStatus", () => {
  let queryClient: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false, // Disable retries for tests
        },
      },
    });

    // Create a proper mock function
    fetchMock = vi.fn();
    // Replace global fetch with our mock
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    // Restore global fetch
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const createJsonResponse = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("should fetch budget status successfully", async () => {
    const mockData = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 500,
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD" as const,
    };

    fetchMock.mockResolvedValueOnce(createJsonResponse(mockData));

    const { result } = renderHook(() => useBudgetStatus(), { wrapper });

    // Should start loading
    expect(result.current.isLoading).toBe(true);

    // Wait for data to load
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should have the correct data
    expect(result.current.data).toEqual(mockData);
    expect(result.current.isLoading).toBe(false);
  });

  it("should handle API errors gracefully", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({}, 500));

    const { result } = renderHook(() => useBudgetStatus(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 3000,
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();
  });

  it("should respect the enabled option", () => {
    const { result } = renderHook(() => useBudgetStatus({ enabled: false }), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should use the correct query key", () => {
    expect(BUDGET_QUERY_KEY).toEqual(["budget-status"]);
  });

  it("keeps cached budget data scoped to the signed-in profile", async () => {
    function CurrentSpending() {
      const { data } = useBudgetStatus();
      return <output>{data?.current_spending ?? "Loading budget"}</output>;
    }

    const budgetFor = (id: string) => (
      <QueryClientProvider client={queryClient}>
        <ProfileContext.Provider
          value={{
            profile: { id } as UserProfile,
            isLoading: false,
            error: null,
          }}
        >
          <CurrentSpending />
        </ProfileContext.Provider>
      </QueryClientProvider>
    );
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({ enabled: true, current_spending: 80 }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({ enabled: true, current_spending: 20 }),
      );

    const { rerender } = render(budgetFor("first-account"));
    expect(await screen.findByText("80")).toBeInTheDocument();

    rerender(budgetFor("second-account"));
    expect(screen.getByText("Loading budget")).toBeInTheDocument();
    expect(await screen.findByText("20")).toBeInTheDocument();

    rerender(budgetFor("first-account"));
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("should handle disabled budget feature", async () => {
    const mockData = {
      enabled: false,
      budget_period_days: null,
      current_spending: null,
      warn_threshold: null,
      budget_limit: null,
      budget_currency: null,
    };

    fetchMock.mockResolvedValueOnce(createJsonResponse(mockData));

    const { result } = renderHook(() => useBudgetStatus(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.enabled).toBe(false);
    expect(result.current.data?.current_spending).toBeNull();
  });

  it("normalizes omitted optional budget fields to null", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({ enabled: true }));

    const { result } = renderHook(() => useBudgetStatus(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      enabled: true,
      budget_period_days: null,
      current_spending: null,
      warn_threshold: null,
      budget_limit: null,
      budget_currency: null,
    });
  });
});
