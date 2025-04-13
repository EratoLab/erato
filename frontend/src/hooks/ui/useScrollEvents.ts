import { useEffect } from "react";

import type { RefObject, DependencyList } from "react";

/**
 * Hook to register and handle scroll events for a container
 */
export function useScrollEvents({
  containerRef,
  onScroll,
  deps = [],
}: {
  containerRef: RefObject<HTMLElement | null>;
  onScroll: (event: Event) => void;
  deps?: DependencyList;
}) {
  // Register scroll handler to update position markers
  useEffect(() => {
    // Check if we're in the browser environment
    const isBrowser = typeof window !== "undefined";
    if (!isBrowser || !containerRef.current) return;

    // Capture the ref in a local variable to avoid closure issues
    const container = containerRef.current;

    // Check scroll position on scroll events
    container.addEventListener("scroll", onScroll);

    // Cleanup
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, onScroll, ...deps]);
}
