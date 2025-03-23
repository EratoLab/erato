import { useEffect, useRef } from "react";

import type { VariableSizeList as VirtualList } from "react-window";

/**
 * Hook to manage virtualized list functionality
 */
export function useVirtualizedList(visibleData: string[]) {
  // Virtual list ref for scrolling and resizing
  const listRef = useRef<VirtualList>(null);

  // Reset the list when message heights might have changed
  useEffect(() => {
    if (listRef.current) {
      listRef.current.resetAfterIndex(0);
    }
  }, [visibleData.length]);

  return {
    listRef,
  };
}
