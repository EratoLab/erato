import { useState, useEffect } from "react";

import type { RefObject } from "react";

/**
 * Hook for managing virtualization of message lists
 * Handles container resizing and size measurement for virtualized lists
 */
export function useMessageListVirtualization({
  containerRef,
  shouldUseVirtualization,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  shouldUseVirtualization: boolean;
}) {
  // Track container dimensions for virtualization calculations
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Check if we're in the browser environment
  const isBrowser = typeof window !== "undefined";

  // Update container size when container ref changes or on resize
  useEffect(() => {
    if (!isBrowser || !containerRef.current || !shouldUseVirtualization) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [containerRef, shouldUseVirtualization, isBrowser]);

  // Update container size on window resize
  useEffect(() => {
    if (!isBrowser || !shouldUseVirtualization) return;

    const updateSize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        setContainerSize({
          width: clientWidth,
          height: clientHeight,
        });
      }
    };

    // Initial size calculation
    updateSize();

    // Add window resize listener
    window.addEventListener("resize", updateSize);

    // Cleanup
    return () => window.removeEventListener("resize", updateSize);
  }, [containerRef, shouldUseVirtualization, isBrowser]);

  return {
    containerSize,
  };
}
