import { useState, useCallback, useEffect, useMemo } from "react";

interface UsePaginatedDataOptions<T> {
  /**
   * The complete dataset available
   */
  data: T[] | undefined;

  /**
   * Initial number of items to display
   */
  initialCount?: number;

  /**
   * Number of additional items to load per "load more" action
   */
  pageSize?: number;

  /**
   * Whether pagination is enabled
   */
  enabled?: boolean;

  /**
   * Time in ms before "newly loaded" status is cleared
   */
  newItemHighlightDuration?: number;

  /**
   * Optional custom sort function
   */
  sortFn?: (a: T, b: T) => number;
}

/**
 * Hook for managing paginated data with a "load more" pattern
 * Useful for infinite scrolling or manual load-more interfaces
 *
 * @param options Configuration options
 * @returns Pagination state and controls
 */
export function usePaginatedData<T>({
  data,
  initialCount = 6,
  pageSize = 6,
  enabled = true,
  newItemHighlightDuration = 5000,
  sortFn,
}: UsePaginatedDataOptions<T>) {
  // Number of items currently displayed
  const [displayCount, setDisplayCount] = useState(initialCount);

  // Reset display count when data changes (e.g., switching chats)
  useEffect(() => {
    setDisplayCount(initialCount);
    setLastLoadedCount(0);
  }, [data, initialCount]);

  // Calculate if there are more items to load
  const hasMore = useMemo(
    () => enabled && !!data && data.length > displayCount,
    [enabled, data, displayCount],
  );

  // Sorted data (if a sort function is provided)
  const sortedData = useMemo(() => {
    if (!data) return [];
    return sortFn ? [...data].sort(sortFn) : data;
  }, [data, sortFn]);

  // Calculate the visible portion of the data - memoized for performance
  const visibleData = useMemo(
    () => sortedData.slice(-displayCount),
    [sortedData, displayCount],
  );

  // Number of newly loaded items in the last batch
  const [lastLoadedCount, setLastLoadedCount] = useState(0);

  // Create a Set of indices for newly loaded items - highly optimized lookup
  const newlyLoadedIndices = useMemo(() => {
    if (lastLoadedCount === 0) return new Set<number>();
    const indices = new Set<number>();
    for (let i = 0; i < lastLoadedCount; i++) {
      indices.add(i);
    }
    return indices;
  }, [lastLoadedCount]);

  // Function to load more items
  const loadMore = useCallback(() => {
    if (!hasMore) return;

    const newCount = Math.min(data?.length ?? 0, displayCount + pageSize);
    const addedCount = newCount - displayCount;

    setLastLoadedCount(addedCount);
    setDisplayCount(newCount);
  }, [hasMore, data, displayCount, pageSize]);

  // Reset lastLoadedCount when data changes or after a short delay
  useEffect(() => {
    if (lastLoadedCount > 0) {
      const timer = setTimeout(() => {
        setLastLoadedCount(0);
      }, newItemHighlightDuration);

      return () => clearTimeout(timer);
    }
  }, [lastLoadedCount, newItemHighlightDuration]);

  // Optimized isNewlyLoaded check using the Set
  const isNewlyLoaded = useCallback(
    (index: number) => newlyLoadedIndices.has(index),
    [newlyLoadedIndices],
  );

  // Expose pagination stats for UI feedback
  const paginationStats = useMemo(
    () => ({
      total: data?.length ?? 0,
      displayed: visibleData.length,
      remaining: (data?.length ?? 0) - visibleData.length,
      pageSize,
    }),
    [data, visibleData.length, pageSize],
  );

  return {
    visibleData,
    hasMore,
    loadMore,
    displayCount,
    lastLoadedCount,
    isNewlyLoaded,
    paginationStats,
    // Reset function for manual control
    reset: useCallback(() => setDisplayCount(initialCount), [initialCount]),
  };
}
