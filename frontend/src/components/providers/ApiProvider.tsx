"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, type ReactNode } from "react";

interface ApiProviderProps {
  children: ReactNode;
}

// Define a type for API errors
interface ApiError {
  status?: number;
  message?: string;
}

/**
 * Provider component that sets up React Query for API interactions
 *
 * Configures global settings for all React Query hooks:
 * - Caching time
 * - Retry behavior
 * - Refetch policies
 */
export function ApiProvider({ children }: ApiProviderProps) {
  // Create a client that persists across renders but is unique per component instance
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: true,
            retry: (failureCount, error: ApiError) => {
              // Don't retry on 401/403 errors (authentication issues)
              if (error.status === 401 || error.status === 403) {
                return false;
              }
              // Retry other errors up to 2 times
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Only show React Query devtools in development */}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
