import { debounce } from "lodash";
import { useRef, useEffect, useCallback, useMemo } from "react";

interface UseScrollToBottomOptions {
  /**
   * Whether to enable auto-scrolling to bottom
   */
  enabled?: boolean;

  /**
   * Dependencies that should trigger a re-evaluation of scroll position
   */
  deps?: React.DependencyList;

  /**
   * Pixel threshold for considering user as "scrolled up" (reading history)
   * When scrolled further up than this value, auto-scroll is disabled
   */
  scrollUpThreshold?: number;

  /**
   * Debounce time in ms for scroll events
   */
  debounceMs?: number;
}

/**
 * Hook for managing scroll-to-bottom behavior in chat interfaces
 *
 * This hook handles:
 * 1. Auto-scrolling to bottom on initial load
 * 2. Auto-scrolling when new messages arrive (only if user hasn't scrolled up)
 * 3. Tracking scroll position to determine user intent (reading history vs. following latest)
 *
 * @param options Configuration options
 * @returns An object containing the ref to attach to the scrollable container and controls
 */
export function useScrollToBottom({
  enabled = true,
  deps = [],
  scrollUpThreshold = 100,
  debounceMs = 50,
}: UseScrollToBottomOptions = {}) {
  // Ref for the scrollable container element - use more specific type
  const containerRef = useRef<HTMLDivElement>(null);

  // Track if we've performed the initial scroll to bottom
  const hasScrolledToBottomRef = useRef(false);

  // Track if the user is currently scrolled up (viewing history)
  const isUserScrolledUpRef = useRef(false);

  // Memoize the scroll position check function for performance
  const checkIfUserIsScrolledUp = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    isUserScrolledUpRef.current = distanceFromBottom > scrollUpThreshold;
  }, [scrollUpThreshold]);

  // Force a scroll to bottom regardless of current scroll position
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      hasScrolledToBottomRef.current = true;
    });
  }, []);

  // Debounced scroll handler to minimize performance impact
  const debouncedCheckScrollPosition = useMemo(
    () =>
      debounce(() => {
        checkIfUserIsScrolledUp();
      }, debounceMs),
    [checkIfUserIsScrolledUp, debounceMs],
  );

  const handleScroll = useCallback(() => {
    debouncedCheckScrollPosition();
  }, [debouncedCheckScrollPosition]);

  // Handle scroll events to detect if user is reading history
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    container.addEventListener("scroll", handleScroll);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      // Make sure to cancel any pending debounced calls on cleanup
      debouncedCheckScrollPosition.cancel();
    };
  }, [enabled, handleScroll, debouncedCheckScrollPosition]);

  // Handle automatic scrolling on initial load and when new messages arrive
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    // On initial load or if specifically following latest messages
    if (!hasScrolledToBottomRef.current || !isUserScrolledUpRef.current) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        hasScrolledToBottomRef.current = true;
      });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return {
    containerRef,
    scrollToBottom,
    isScrolledUp: isUserScrolledUpRef.current,
    // Expose the check function so consumers can manually check scroll position
    checkScrollPosition: checkIfUserIsScrolledUp,
  };
}
