import { debounce } from "lodash";
import { useRef, useEffect, useCallback, useMemo, useState } from "react";

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

  /**
   * Whether to use CSS smooth scrolling
   * This can be more performant than manual animation in some cases
   */
  useSmoothScroll?: boolean;

  /**
   * Duration in ms for smooth scroll transitions
   */
  transitionDuration?: number;

  /**
   * Whether the component is in a transition state
   * (e.g., navigating between chats)
   */
  isTransitioning?: boolean;
}

/**
 * Hook for managing scroll-to-bottom behavior in chat interfaces
 *
 * This hook handles:
 * 1. Auto-scrolling to bottom on initial load
 * 2. Auto-scrolling when new messages arrive (only if user hasn't scrolled up)
 * 3. Tracking scroll position to determine user intent (reading history vs. following latest)
 * 4. Managing visibility transitions to prevent flickering on load
 *
 * @param options Configuration options
 * @returns An object containing the ref to attach to the scrollable container and controls
 */
export function useScrollToBottom({
  enabled = true,
  deps = [],
  scrollUpThreshold = 100,
  debounceMs = 50,
  useSmoothScroll = false,
  transitionDuration = 300,
  isTransitioning = false,
}: UseScrollToBottomOptions = {}) {
  // Ref for the scrollable container element - use more specific type
  const containerRef = useRef<HTMLDivElement>(null);

  // Track if we've performed the initial scroll to bottom
  const hasScrolledToBottomRef = useRef(false);

  // Track if the user is currently scrolled up (viewing history)
  const isUserScrolledUpRef = useRef(false);

  // Also track if user is near the top of the message list
  const isNearTopRef = useRef(false);
  const [isNearTop, setIsNearTop] = useState(false);

  // We need a state value to trigger re-renders when this changes
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  // State to track initial loading state for visibility control
  const [initiallyLoaded, setInitiallyLoaded] = useState(false);

  // Memoize the scroll position check function for performance
  const checkIfUserIsScrolledUp = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const distanceFromTop = scrollTop;

    // Consider user as scrolled up if they're not at the bottom
    const scrolledUp = distanceFromBottom > scrollUpThreshold;

    // Consider user near top if they're within 50px of the top of the message list
    const nearTop = distanceFromTop < 50;

    // Store the values in both refs and state
    isUserScrolledUpRef.current = scrolledUp;
    isNearTopRef.current = nearTop;

    setIsScrolledUp(scrolledUp);
    setIsNearTop(nearTop);
  }, [scrollUpThreshold]);

  // Force a scroll to bottom regardless of current scroll position
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (useSmoothScroll) {
      // Use CSS smooth scrolling for better performance
      container.style.scrollBehavior = "smooth";
      container.scrollTop = container.scrollHeight;

      // Reset after transition completes to not interfere with other scrolling
      setTimeout(() => {
        container.style.scrollBehavior = "auto";
      }, transitionDuration);

      hasScrolledToBottomRef.current = true;
      setIsScrolledUp(false);
      isUserScrolledUpRef.current = false;
    } else {
      // Use requestAnimationFrame for smoother scrolling
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        hasScrolledToBottomRef.current = true;

        // When we scroll to bottom, update scrolled up state
        setIsScrolledUp(false);
        isUserScrolledUpRef.current = false;
      });
    }
  }, [useSmoothScroll, transitionDuration]);

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

    // Check initial scroll position
    checkIfUserIsScrolledUp();

    return () => {
      container.removeEventListener("scroll", handleScroll);
      // Make sure to cancel any pending debounced calls on cleanup
      debouncedCheckScrollPosition.cancel();
    };
  }, [
    enabled,
    handleScroll,
    debouncedCheckScrollPosition,
    checkIfUserIsScrolledUp,
  ]);

  // Handle automatic scrolling on initial load and when new messages arrive
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    // Handle visibility during transitions
    if (isTransitioning) {
      // During transition, hide the container temporarily
      container.style.opacity = "0";
      hasScrolledToBottomRef.current = false; // Reset to force scroll after transition
      return;
    }

    // Control visibility during initial load or content changes
    if (!hasScrolledToBottomRef.current || !isUserScrolledUpRef.current) {
      // Immediately hide container during content load
      if (!hasScrolledToBottomRef.current) {
        container.style.opacity = "0";
      }

      // Small delay to ensure content is ready before scrolling
      const timer = setTimeout(() => {
        // Scroll to bottom
        if (useSmoothScroll) {
          container.style.scrollBehavior = "smooth";
          container.scrollTop = container.scrollHeight;

          // Reset after transition
          setTimeout(() => {
            container.style.scrollBehavior = "auto";
          }, transitionDuration);
        } else {
          container.scrollTop = container.scrollHeight;
        }

        // After scrolling, fade in if needed
        if (!hasScrolledToBottomRef.current) {
          container.style.opacity = "1";
          container.style.transition = "opacity 0.2s ease-in-out";
          setInitiallyLoaded(true);
        }

        hasScrolledToBottomRef.current = true;
      }, 50); // Small delay for layout to complete

      return () => clearTimeout(timer);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isTransitioning, useSmoothScroll, transitionDuration, ...deps]);

  return {
    containerRef,
    scrollToBottom,
    isScrolledUp, // Return the state value, not the ref value
    isNearTop, // Add the isNearTop state value to help with "Load More" visibility
    initiallyLoaded, // Export the loaded state for consumers
    // Expose the check function so consumers can manually check scroll position
    checkScrollPosition: checkIfUserIsScrolledUp,
  };
}
