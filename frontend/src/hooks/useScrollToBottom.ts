import { debounce } from "lodash";
import {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useState,
  useReducer,
} from "react";

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
 * Types for scroll state tracking
 */
interface ScrollState {
  hasScrolledToBottom: boolean;
  isUserScrolledUp: boolean;
  isNearTop: boolean;
  initiallyLoaded: boolean;
}

// Actions for the scroll state reducer
type ScrollAction =
  | { type: "SCROLL_TO_BOTTOM" }
  | { type: "SET_SCROLLED_UP"; value: boolean }
  | { type: "SET_NEAR_TOP"; value: boolean }
  | { type: "SET_INITIALLY_LOADED"; value: boolean }
  | { type: "RESET_SCROLL_STATE" };

// Reducer function for scroll state
function scrollReducer(state: ScrollState, action: ScrollAction): ScrollState {
  switch (action.type) {
    case "SCROLL_TO_BOTTOM":
      return {
        ...state,
        hasScrolledToBottom: true,
        isUserScrolledUp: false,
      };
    case "SET_SCROLLED_UP":
      return {
        ...state,
        isUserScrolledUp: action.value,
      };
    case "SET_NEAR_TOP":
      return {
        ...state,
        isNearTop: action.value,
      };
    case "SET_INITIALLY_LOADED":
      return {
        ...state,
        initiallyLoaded: action.value,
      };
    case "RESET_SCROLL_STATE":
      return {
        ...state,
        hasScrolledToBottom: false,
      };
    default:
      return state;
  }
}

/**
 * Return type for the useScrollToBottom hook
 */
interface ScrollToBottomResult {
  /** Ref to attach to the scrollable container */
  containerRef: React.RefObject<HTMLDivElement | null>;

  /** Function to force scroll to bottom regardless of current position */
  scrollToBottom: () => void;

  /** Whether the user has scrolled up and is reading history */
  isScrolledUp: boolean;

  /** Whether the user is near the top of the message list */
  isNearTop: boolean;

  /** Whether the initial loading has completed */
  initiallyLoaded: boolean;

  /** Function to manually check and update scroll position */
  checkScrollPosition: () => void;
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
}: UseScrollToBottomOptions = {}): ScrollToBottomResult {
  // Ref for the scrollable container element - use more specific type
  const containerRef = useRef<HTMLDivElement>(null);

  // Use reducer for managing scroll state
  const [scrollState, dispatch] = useReducer(scrollReducer, {
    hasScrolledToBottom: false,
    isUserScrolledUp: false,
    isNearTop: false,
    initiallyLoaded: false,
  });

  // Extract values from scroll state for convenience and backward compatibility
  const { hasScrolledToBottom, isUserScrolledUp, isNearTop, initiallyLoaded } =
    scrollState;

  // Also provide separate state values for UI updates
  const [isScrolledUp, setIsScrolledUp] = useState(false);

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

    // If user was scrolled up but is now at the bottom, re-enable auto-scroll
    // This allows users to manually scroll to bottom to resume auto-scroll
    if (isUserScrolledUp && !scrolledUp) {
      // User has manually scrolled back to bottom, reset scroll state to re-enable auto-scroll
      dispatch({ type: "SCROLL_TO_BOTTOM" });
    } else {
      // Update state with new values
      dispatch({ type: "SET_SCROLLED_UP", value: scrolledUp });
    }

    dispatch({ type: "SET_NEAR_TOP", value: nearTop });

    // Also update the UI state for backward compatibility
    setIsScrolledUp(scrolledUp);
  }, [scrollUpThreshold, isUserScrolledUp]);

  // Memoized implementation of smooth scrolling
  const smoothScrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use CSS smooth scrolling for better performance
    container.style.scrollBehavior = "smooth";
    container.scrollTop = container.scrollHeight;

    // Reset after transition completes to not interfere with other scrolling
    setTimeout(() => {
      container.style.scrollBehavior = "auto";
    }, transitionDuration);

    dispatch({ type: "SCROLL_TO_BOTTOM" });
    setIsScrolledUp(false);
  }, [transitionDuration]);

  // Memoized implementation of instant scrolling
  const instantScrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use requestAnimationFrame for smoother scrolling
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      dispatch({ type: "SCROLL_TO_BOTTOM" });

      // When we scroll to bottom, update scrolled up state
      setIsScrolledUp(false);
    });
  }, []);

  // Force a scroll to bottom regardless of current scroll position
  const scrollToBottom = useCallback(() => {
    if (useSmoothScroll) {
      smoothScrollToBottom();
    } else {
      instantScrollToBottom();
    }
  }, [useSmoothScroll, smoothScrollToBottom, instantScrollToBottom]);

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

    // During transitions, we just reset state but don't scroll yet
    if (isTransitioning) {
      dispatch({ type: "RESET_SCROLL_STATE" });
      return;
    }

    // If we haven't scrolled to bottom yet or user isn't scrolled up
    if (!hasScrolledToBottom || !isUserScrolledUp) {
      // Add a small delay to ensure content is fully rendered
      const timer = setTimeout(() => {
        if (useSmoothScroll) {
          updateContainerStyle(container, { scrollBehavior: "smooth" });
          container.scrollTop = container.scrollHeight;

          // Reset scroll behavior after animation completes
          setTimeout(() => {
            updateContainerStyle(container, { scrollBehavior: "auto" });
          }, transitionDuration);
        } else {
          container.scrollTop = container.scrollHeight;
        }

        // Update state after scrolling
        dispatch({ type: "SCROLL_TO_BOTTOM" });

        if (!hasScrolledToBottom) {
          dispatch({ type: "SET_INITIALLY_LOADED", value: true });
        }
      }, 50);

      return () => clearTimeout(timer);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isTransitioning, useSmoothScroll, transitionDuration, ...deps]);

  // Helper function for managing container styles
  const updateContainerStyle = useCallback(
    (container: HTMLDivElement, styles: Partial<CSSStyleDeclaration>) => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isUserMessage can be undefined based on props type
      if (!container) return;

      Object.entries(styles).forEach(([property, value]) => {
        if (value !== undefined && value !== null) {
          // @ts-ignore - we know these styles exist
          container.style[property] = value;
        }
      });
    },
    [],
  );

  return {
    containerRef,
    scrollToBottom,
    isScrolledUp,
    isNearTop,
    initiallyLoaded,
    checkScrollPosition: checkIfUserIsScrolledUp,
  };
}
