/**
 * Hook to safely adapt between our app and the auto-generated API hooks
 */
import { useCallback } from "react";

/**
 * Generic type for API error handling
 */
export type APIError = Error & { status?: number; data?: unknown };

/**
 * Helper function to safely wrap the deepMerge functionality
 * without modifying the generated code
 */
export function safeDeepMerge<T, U>(target: T, source: U): T & U {
  // Handle nullish cases
  if (!target) return source as T & U;
  if (!source) return target as T & U;

  try {
    // Create a shallow copy of target
    const result = { ...target } as T & U;

    // Copy source properties
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = target[key as keyof T];

        // Handle object merging
        if (
          sourceValue &&
          typeof sourceValue === "object" &&
          targetValue &&
          typeof targetValue === "object"
        ) {
          result[key as keyof (T & U)] = safeDeepMerge(
            targetValue as Record<string, unknown>,
            sourceValue as Record<string, unknown>,
          ) as unknown as (T & U)[keyof (T & U)];
        } else {
          result[key as keyof (T & U)] = sourceValue as unknown as (T &
            U)[keyof (T & U)];
        }
      }
    }

    return result;
  } catch (error) {
    console.error("Error in safeDeepMerge:", error);
    // Fallback to shallow merge
    return { ...target, ...source } as T & U;
  }
}

/**
 * Custom hook to safely adapt between our app and the generated API
 */
export function useAPIAdapter() {
  /**
   * Safely wraps a mutation function to handle potential errors
   */
  const wrapMutation = useCallback(
    <T, P>(mutationFn: (params: P) => Promise<T>, params: P): Promise<T> => {
      try {
        return mutationFn(params);
      } catch (error) {
        console.error("Error in API mutation:", error);
        throw new Error(
          error instanceof Error ? error.message : "Unknown error in API call",
        );
      }
    },
    [],
  );

  return {
    safeDeepMerge,
    wrapMutation,
  };
}

/**
 * Helper to create a safe AbortController with error handling
 */
export function createSafeAbortController(): {
  controller: AbortController;
  signal: AbortSignal;
  abort: () => void;
} {
  try {
    const controller = new AbortController();
    return {
      controller,
      signal: controller.signal,
      abort: () => {
        try {
          controller.abort();
        } catch (error) {
          console.error("Error aborting controller:", error);
        }
      },
    };
  } catch (error) {
    console.error("Error creating AbortController:", error);
    // Create a dummy controller that does nothing
    return {
      controller: {} as AbortController,
      signal: {} as AbortSignal,
      abort: () => {
        /* noop */
      },
    };
  }
}
