import { useState, useCallback, useEffect, useMemo, useRef } from "react";

// Debug flag to enable/disable logging
const DEBUG = process.env.NODE_ENV === "development";
const log = (...args: unknown[]) => DEBUG && console.log(...args);

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

  /**
   * Direction of pagination
   * - 'forward': Show most recent N items (for normal lists, newest at end)
   * - 'backward': Show oldest N items (for chat history pagination)
   */
  direction?: "forward" | "backward";
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
  direction = "forward",
}: UsePaginatedDataOptions<T>) {
  // Number of items currently displayed
  const [displayCount, setDisplayCount] = useState(initialCount);

  // Number of newly loaded items in the last batch
  const [lastLoadedCount, setLastLoadedCount] = useState(0);

  // Track previous data length to prevent unnecessary updates
  const prevDataRef = useRef<number | undefined>(undefined);
  const prevInitialCountRef = useRef<number>(initialCount);

  // Sorted data (if a sort function is provided)
  const sortedData = useMemo(() => {
    if (!data) return [];
    return sortFn ? [...data].sort(sortFn) : data;
  }, [data, sortFn]);

  // Calculate if there are more items to load
  const hasMore = useMemo(
    () => enabled && !!data && data.length > displayCount,
    [enabled, data, displayCount],
  );

  // Reset display count when data changes (e.g., switching chats)
  useEffect(() => {
    // Only reset if data length or initialCount has actually changed
    const currentDataLength = data?.length;
    const dataChanged = prevDataRef.current !== currentDataLength;
    const initialCountChanged = prevInitialCountRef.current !== initialCount;

    log(
      `Data check: previous=${prevDataRef.current}, current=${currentDataLength}, changed=${dataChanged}`,
    );

    if (dataChanged || initialCountChanged) {
      // Update refs
      prevDataRef.current = currentDataLength;
      prevInitialCountRef.current = initialCount;

      // Reset pagination state
      log(`Resetting displayCount to ${initialCount} due to data change`);
      setDisplayCount(initialCount);
      setLastLoadedCount(0);
    }
  }, [data, initialCount]);

  // Calculate the visible portion of the data - memoized for performance
  const visibleData = useMemo(() => {
    log(
      `Calculating visibleData: total=${sortedData.length}, display=${displayCount}, direction=${direction}`,
    );

    if (sortedData.length === 0) return [];

    // For chat applications, we need to ensure:
    // 1. We never lose existing messages when loading more
    // 2. When loading older messages, we want ALL loaded messages to be visible

    if (direction === "backward") {
      // For chat history with backward pagination:
      // - We want to show ALL messages we've loaded so far (not just the first N)
      // - This ensures older messages + newer messages are all visible when paginating
      log(
        `Showing all ${sortedData.length} messages loaded so far (backward pagination)`,
      );
      return sortedData;
    } else {
      // For forward pagination (normal lists):
      // - If we have fewer items than displayCount, show all
      if (sortedData.length <= displayCount) {
        log("Showing all messages (count <= displayCount)");
        return sortedData;
      }

      // Otherwise show the most recent messages (newest at end)
      log(`Showing newest ${displayCount} messages (forward pagination)`);
      return sortedData.slice(sortedData.length - displayCount);
    }
  }, [sortedData, displayCount, direction]);

  // Create a Set of indices for newly loaded items - highly optimized lookup
  const newlyLoadedIndices = useMemo(() => {
    if (lastLoadedCount === 0) return new Set<number>();

    const indices = new Set<number>();

    // Apply indices based on pagination direction
    if (direction === "backward") {
      // For backward pagination (chat history), new items appear at the beginning (0...N)
      for (let i = 0; i < lastLoadedCount; i++) {
        indices.add(i);
      }
    } else {
      // For forward pagination, new items appear at the end (length-N...length)
      for (let i = 0; i < lastLoadedCount; i++) {
        indices.add(visibleData.length - 1 - i);
      }
    }

    return indices;
  }, [lastLoadedCount, visibleData.length, direction]);

  // Function to load more items
  const loadMore = useCallback(() => {
    if (!hasMore) return;

    log(
      `loadMore called: current=${displayCount}, adding=${pageSize}, total available=${data?.length}`,
    );

    // For backward pagination (chat history), we always show ALL messages
    // We just track lastLoadedCount for highlighting but don't need to update displayCount
    if (direction === "backward") {
      // Calculate how many new messages became visible
      const newCount = Math.min(data?.length ?? 0, displayCount + pageSize);
      const addedCount = newCount - displayCount;

      log(
        `Backward pagination: tracking ${addedCount} newly loaded messages, keeping all visible`,
      );
      setLastLoadedCount(addedCount);

      // Since we're showing all messages in backward mode, we don't need to update displayCount
      // But we update it anyway to maintain the correct hasMore calculation
      setDisplayCount(newCount);
    } else {
      // Standard forward pagination
      const newCount = Math.min(data?.length ?? 0, displayCount + pageSize);
      const addedCount = newCount - displayCount;

      log(
        `Forward pagination: Increasing displayCount from ${displayCount} to ${newCount} (added ${addedCount})`,
      );

      setLastLoadedCount(addedCount);
      setDisplayCount(newCount);
    }
  }, [hasMore, data, displayCount, pageSize, direction]);

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
