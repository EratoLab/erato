/**
 * Reusable fuzzy search hook using fuse.js
 *
 * Provides fuzzy matching with configurable options for different use cases
 *
 * Note: For optimal performance, memoize `items`, `keys`, and `sortFn` in the parent component
 * to avoid recreating the Fuse instance on every render.
 */
import Fuse from "fuse.js";
import { useMemo } from "react";

export interface FuzzySearchOptions<T> {
  /** Items to search through (should be memoized in parent) */
  items: T[];
  /** Keys to search in (e.g., ['name', 'email']) - should be memoized in parent */
  keys: string[];
  /** Search query */
  query: string;
  /** Match threshold: 0 (exact) to 1 (match anything). Default: 0.3 */
  threshold?: number;
  /** Custom sort function to apply after fuzzy search (should be memoized in parent) */
  sortFn?: (a: T, b: T) => number;
}

/**
 * Hook for fuzzy searching through a list of items
 *
 * @example
 * ```tsx
 * const results = useFuzzySearch({
 *   items: users,
 *   keys: ['name', 'email'],
 *   query: searchQuery,
 * });
 * ```
 */
export function useFuzzySearch<T>({
  items,
  keys,
  query,
  threshold = 0.3,
  sortFn,
}: FuzzySearchOptions<T>): T[] {
  // Create fuse instance
  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys,
        threshold,
        ignoreLocation: true, // Don't care where in string the match occurs
        minMatchCharLength: 2, // Need at least 2 characters to match
      }),
    [items, keys, threshold],
  );

  // Perform search and apply custom sorting if provided
  const results = useMemo(() => {
    // Empty query returns all items
    if (!query.trim()) {
      return sortFn ? [...items].sort(sortFn) : items;
    }

    // Fuzzy search
    const fuseResults = fuse.search(query).map((result) => result.item);

    // Apply custom sorting if provided
    return sortFn ? [...fuseResults].sort(sortFn) : fuseResults;
  }, [fuse, query, items, sortFn]); // items included for empty query case; sortFn for sorting

  return results;
}
