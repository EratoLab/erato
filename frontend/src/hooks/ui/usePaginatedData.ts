import { useState, useEffect, useMemo } from "react";

interface UsePaginatedDataProps<T> {
  /**
   * The complete data array
   */
  data: T[];

  /**
   * Initial number of items to show
   */
  initialCount?: number;

  /**
   * Number of items to load per page
   */
  pageSize?: number;

  /**
   * Whether pagination is enabled
   */
  enabled?: boolean;

  /**
   * Direction of pagination (forward or backward)
   */
  direction?: "forward" | "backward";
}

interface PaginationStats {
  /**
   * Number of items currently visible (displayed)
   */
  displayed: number;

  /**
   * Total number of items in the dataset (total)
   */
  total: number;

  /**
   * Whether more items are available
   */
  hasMore: boolean;

  /**
   * Percentage of items loaded (0-100)
   */
  percentLoaded: number;
}

/**
 * Hook for client-side pagination of data arrays
 */
export function usePaginatedData<T>({
  data,
  initialCount = 10,
  pageSize = 10,
  enabled = true,
  direction = "forward",
}: UsePaginatedDataProps<T>) {
  // Track how many items we're currently showing
  const [itemCount, setItemCount] = useState(initialCount);

  // Track which items were newly loaded in the current render
  const [newlyLoadedIndices, setNewlyLoadedIndices] = useState<number[]>([]);

  // Reset pagination when data source changes completely
  useEffect(() => {
    setItemCount(initialCount);
    setNewlyLoadedIndices([]);
  }, [data, initialCount]);

  // Calculate visible data slice
  const visibleData = useMemo(() => {
    if (!enabled) return data;

    if (direction === "backward") {
      // For backward pagination (chat history), we show the most recent N items
      // So we start from the end of the array
      return data.slice(Math.max(0, data.length - itemCount));
    } else {
      // For forward pagination, we show the first N items
      return data.slice(0, itemCount);
    }
  }, [data, itemCount, enabled, direction]);

  // Calculate if we have more items to load
  const hasMore = useMemo(() => {
    if (!enabled) return false;
    return direction === "backward"
      ? itemCount < data.length
      : itemCount < data.length;
  }, [data.length, itemCount, enabled, direction]);

  // Function to load more items
  const loadMore = () => {
    if (!hasMore) return;

    // Track which indices are newly loaded for animations
    const currentCount = itemCount;
    const newCount = Math.min(currentCount + pageSize, data.length);

    // Calculate the newly loaded indices
    const newIndices: number[] = [];
    if (direction === "backward") {
      // For backward, we're adding items at the beginning
      const startIdx = Math.max(0, data.length - newCount);
      const endIdx = data.length - currentCount;
      for (let i = startIdx; i < endIdx; i++) {
        newIndices.push(i);
      }
    } else {
      // For forward, we're adding at the end
      for (let i = currentCount; i < newCount; i++) {
        newIndices.push(i);
      }
    }

    setItemCount(newCount);
    setNewlyLoadedIndices(newIndices);
  };

  // Helper to check if a specific index was newly loaded
  const isNewlyLoaded = (index: number): boolean => {
    return newlyLoadedIndices.includes(index);
  };

  // Calculate stats for the pagination UI
  const paginationStats: PaginationStats = useMemo(() => {
    return {
      displayed: visibleData.length,
      total: data.length,
      hasMore,
      percentLoaded:
        data.length > 0 ? (visibleData.length / data.length) * 100 : 100,
    };
  }, [data.length, visibleData.length, hasMore]);

  return {
    visibleData,
    hasMore,
    loadMore,
    isNewlyLoaded,
    paginationStats,
  };
}
