import { debounce } from "lodash";
import {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useState,
  useReducer,
} from "react";

/**
 * What content that changes its own height after it has rendered, such as an
 * interactive view, dispatches from its element, bubbling, when its height
 * has changed: a list the user follows at its bottom stays there.
 */
export const CONTENT_RESIZED_EVENT = "erato:content-resized";

/**
 * How close to its bottom the user must have left the list for content that
 * grows to keep it there.
 */
const FOLLOW_BOTTOM_THRESHOLD_PX = 8;

/**
 * How long after the person's own wheel, swipe or scroll key a scroll counts
 * as theirs; a swipe keeps the list moving for a while after the finger lifts.
 */
const USER_SCROLL_WINDOW_MS = 1200;

/** How far a finger moves up or down before it scrolls rather than taps. */
const TOUCH_SLOP_PX = 10;

/** Whether a box between the target and the list can scroll up itself. */
const scrollsInside = (target: EventTarget | null, list: HTMLElement) => {
  for (
    let element = target instanceof Element ? target : null;
    element && element !== list;
    element = element.parentElement
  ) {
    if (
      element.scrollTop > 0 &&
      element.scrollHeight > element.clientHeight &&
      /(auto|scroll)/.test(window.getComputedStyle(element).overflowY)
    ) {
      return true;
    }
  }
  return false;
};

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

/* eslint-disable lingui/no-unlocalized-strings -- KeyboardEvent.key constants, not user-facing text. */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);
/* eslint-enable lingui/no-unlocalized-strings */

/**
 * Audio mode: the person talks hands-free and often does not touch the page,
 * so the view follows the conversation instead of the stream.
 */
export interface ConversationFollow {
  /**
   * Where the view rests while it follows the conversation, as a scrollTop:
   * the bottom, or above it to keep the start of a written answer in view.
   */
  target: (container: HTMLDivElement) => number;
  /** Changes when the person starts a new turn: the view goes to it. */
  turn: string;
}

/**
 * - `conversation`: the view rests where `target` puts it.
 * - `bottom`: the person went to the bottom by hand; the view stays there.
 * - `held`: the person scrolled away by hand; the view stays where they left it.
 */
type ConversationFollowMode = "conversation" | "bottom" | "held";

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

  /**
   * Whether automatic dependency-driven scrolls should be paused.
   */
  autoScrollPaused?: boolean;

  /**
   * Audio mode: follow the conversation, which replaces the automatic scrolls
   * above while it is set.
   */
  conversation?: ConversationFollow | null;
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

  /** Audio mode: whether the person scrolled away from the conversation. */
  isConversationHeld: boolean;
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
  autoScrollPaused = false,
  conversation = null,
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

  // Whether the list follows its bottom: until the user scrolls up away from
  // it, and again once the list scrolls to its bottom. Read when content
  // grows, before the list has scrolled.
  const followsBottom = useRef(true);
  const holdsStill = useRef(false);
  holdsStill.current = autoScrollPaused || isTransitioning;

  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const transitioning = useRef(isTransitioning);
  transitioning.current = isTransitioning;
  const followMode = useRef<ConversationFollowMode>("conversation");
  const ownScroll = useRef<number | null>(null);
  const [isConversationHeld, setIsConversationHeld] = useState(false);

  const setFollowMode = useCallback((mode: ConversationFollowMode) => {
    followMode.current = mode;
    setIsConversationHeld(mode === "held");
    // While the view follows, its place is set on every change of size, so
    // the browser must not move it for content above; a person reading
    // further up keeps the browser's anchoring, which holds their text still.
    const container = containerRef.current;
    if (container && conversationRef.current) {
      container.style.overflowAnchor = mode === "held" ? "" : "none";
    }
  }, []);

  // Instant, and re-read on every change of size: a smooth scroll's end is
  // fixed when it starts, so content that grows meanwhile lands below it.
  const pinConversation = useCallback(() => {
    const container = containerRef.current;
    const follow = conversationRef.current;
    if (!container || !follow || transitioning.current) return;
    if (followMode.current === "held") return;
    const bottom = container.scrollHeight - container.clientHeight;
    const top = Math.max(
      0,
      followMode.current === "bottom"
        ? bottom
        : Math.min(bottom, follow.target(container)),
    );
    if (Math.abs(container.scrollTop - top) < 1) return;
    container.style.scrollBehavior = "auto";
    container.scrollTop = top;
    // The scroll event this causes is the list's, not the person's.
    ownScroll.current = container.scrollTop;
  }, []);

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
    followsBottom.current = true;

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
      followsBottom.current = true;
      dispatch({ type: "SCROLL_TO_BOTTOM" });

      // When we scroll to bottom, update scrolled up state
      setIsScrolledUp(false);
    });
  }, []);

  // Force a scroll to bottom regardless of current scroll position
  const scrollToBottom = useCallback(() => {
    if (conversationRef.current) {
      setFollowMode("bottom");
      pinConversation();
      return;
    }
    if (useSmoothScroll) {
      smoothScrollToBottom();
    } else {
      instantScrollToBottom();
    }
  }, [
    useSmoothScroll,
    smoothScrollToBottom,
    instantScrollToBottom,
    setFollowMode,
    pinConversation,
  ]);

  useEffect(() => {
    if (autoScrollPaused && containerRef.current) {
      containerRef.current.style.scrollBehavior = "auto";
    }
  }, [autoScrollPaused]);

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

  // Content that grows keeps a list the user follows at its bottom: where the
  // user left the list is read from its scrolling, which growing content
  // does not change. Scrolling up away from the bottom stops following it,
  // scrolling down to it follows it again; scrolling down elsewhere, as the
  // browser does when it keeps the content in view in place, changes
  // nothing.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    let lastScrollTop = container.scrollTop;
    const followScrolling = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const atBottom =
        scrollHeight - scrollTop - clientHeight <= FOLLOW_BOTTOM_THRESHOLD_PX;
      if (atBottom || scrollTop < lastScrollTop) {
        followsBottom.current = atBottom;
      }
      lastScrollTop = scrollTop;
    };
    const keepBottom = () => {
      if (conversationRef.current) {
        pinConversation();
        return;
      }
      if (!followsBottom.current || holdsStill.current) return;
      container.scrollTop = container.scrollHeight;
    };
    container.addEventListener("scroll", followScrolling, { passive: true });
    container.addEventListener(CONTENT_RESIZED_EVENT, keepBottom);
    return () => {
      container.removeEventListener("scroll", followScrolling);
      container.removeEventListener(CONTENT_RESIZED_EVENT, keepBottom);
    };
  }, [enabled, pinConversation]);

  const followsConversation = enabled && conversation !== null;
  const conversationTurn = conversation?.turn;
  const scrollStateRef = useRef(scrollState);
  scrollStateRef.current = scrollState;

  // Audio mode starts where the person is: reading further up stays held.
  useEffect(() => {
    if (!followsConversation) return;
    const { hasScrolledToBottom: loaded, isUserScrolledUp: away } =
      scrollStateRef.current;
    setFollowMode(loaded && away ? "held" : "conversation");
    pinConversation();
  }, [followsConversation, setFollowMode, pinConversation]);

  // A new turn, spoken or typed, brings the view to it: the person is there.
  const lastTurn = useRef(conversationTurn);
  useEffect(() => {
    const previous = lastTurn.current;
    lastTurn.current = conversationTurn;
    // Audio mode starting is not a turn: the person's place is kept above.
    if (previous === conversationTurn || previous === undefined) return;
    if (!followsConversation) return;
    setFollowMode("conversation");
    pinConversation();
  }, [conversationTurn, followsConversation, setFollowMode, pinConversation]);

  useEffect(() => {
    if (followsConversation && !isTransitioning) pinConversation();
  }, [followsConversation, isTransitioning, pinConversation]);

  // Audio mode: any change of size keeps the view where it rests (a card
  // mounting or opening, the composer changing height, an answer folding).
  // Only the person's own scrolling moves it elsewhere.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !followsConversation) return;

    const resizes = new ResizeObserver(() => pinConversation());
    const observeChildren = () => {
      resizes.disconnect();
      resizes.observe(container);
      for (const child of Array.from(container.children)) {
        resizes.observe(child);
      }
    };
    observeChildren();
    const childrenChange = new MutationObserver(observeChildren);
    childrenChange.observe(container, { childList: true });

    container.style.overflowAnchor =
      followMode.current === "held" ? "" : "none";

    let userScrollAt = Number.NEGATIVE_INFINITY;
    let dragging = false;
    let touchMoved = false;
    let touchStart: { x: number; y: number } | null = null;
    let lastTop = container.scrollTop;
    const byUser = () => {
      userScrollAt = Date.now();
    };
    // Scrolling up wins at once, before the list has moved, unless a box
    // inside the list (a card's preview) takes the scroll itself.
    const holdUp = (target: EventTarget | null) => {
      byUser();
      if (scrollsInside(target, container)) return;
      if (container.scrollTop > 0 && followMode.current !== "held") {
        setFollowMode("held");
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) holdUp(event.target);
      else byUser();
    };
    const onTouchStart = (event: TouchEvent) => {
      touchMoved = false;
      touchStart =
        event.touches.length > 0
          ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
          : null;
    };
    // A tap, or a finger drifting on a button, is not a scroll; nor is a
    // sideways swipe across a wide table.
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length === 0 || touchStart === null) return;
      const dx = event.touches[0].clientX - touchStart.x;
      const dy = event.touches[0].clientY - touchStart.y;
      if (Math.abs(dy) < TOUCH_SLOP_PX || Math.abs(dy) < Math.abs(dx)) return;
      touchMoved = true;
      if (dy > 0) holdUp(event.target);
      else byUser();
    };
    // A swipe goes on moving the list after the finger lifts.
    const onTouchEnd = () => {
      if (touchMoved) byUser();
    };
    // On the document: the list scrolls with the keys also when the page,
    // not the list, has the focus. Not while typing, in a menu elsewhere, or
    // with Space on a button, which presses it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(event.key) || event.defaultPrevented) return;
      const target = event.target;
      const onPage = target === document.body || target === container;
      if (!onPage && !(target instanceof Node && container.contains(target)))
        return;
      if (isEditable(target) || (event.key === " " && !onPage)) return;
      const up =
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home" ||
        (event.key === " " && event.shiftKey);
      if (up) holdUp(event.target);
      else byUser();
    };
    const onPointerDown = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      const scrollbarWidth = container.offsetWidth - container.clientWidth;
      if (
        scrollbarWidth > 0 &&
        event.clientX >= bounds.right - scrollbarWidth
      ) {
        dragging = true;
        byUser();
      }
    };
    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      byUser();
    };
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const movedUp = scrollTop < lastTop - 1;
      lastTop = scrollTop;
      const atBottom =
        scrollHeight - scrollTop - clientHeight <= FOLLOW_BOTTOM_THRESHOLD_PX;
      if (ownScroll.current !== null) {
        const own = Math.abs(scrollTop - ownScroll.current) < 1;
        ownScroll.current = null;
        if (own) return;
      }
      const byPerson =
        dragging || Date.now() - userScrollAt <= USER_SCROLL_WINDOW_MS;
      if (byPerson) {
        // Content shrinking moves the list up to its new bottom: that is the
        // browser, even right after the person's input.
        if (atBottom && movedUp) return;
        const mode = atBottom ? "bottom" : "held";
        if (followMode.current !== mode) setFollowMode(mode);
        return;
      }
      // Unannounced: an overlay scrollbar (phones, macOS) or the scrollbar's
      // arrows move the list up; content shrinking ends at the bottom.
      if (movedUp && !atBottom) {
        if (followMode.current !== "held") setFollowMode("held");
      } else if (atBottom && followMode.current === "held") {
        setFollowMode("bottom");
      }
    };

    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      resizes.disconnect();
      childrenChange.disconnect();
      container.style.overflowAnchor = "";
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("scroll", onScroll);
    };
  }, [followsConversation, setFollowMode, pinConversation]);

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

    if (conversationRef.current) {
      pinConversation();
      // Typed chat takes over from here when audio mode ends.
      if (followMode.current !== "held") {
        dispatch({ type: "SCROLL_TO_BOTTOM" });
        dispatch({ type: "SET_INITIALLY_LOADED", value: true });
      }
      return;
    }

    // If we haven't scrolled to bottom yet or user isn't scrolled up
    if (!autoScrollPaused && (!hasScrolledToBottom || !isUserScrolledUp)) {
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
        followsBottom.current = true;

        // Update state after scrolling
        dispatch({ type: "SCROLL_TO_BOTTOM" });

        if (!hasScrolledToBottom) {
          dispatch({ type: "SET_INITIALLY_LOADED", value: true });
        }
      }, 50);

      return () => clearTimeout(timer);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    isTransitioning,
    autoScrollPaused,
    useSmoothScroll,
    transitionDuration,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ...deps,
  ]);

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
    isConversationHeld: followsConversation && isConversationHeld,
  };
}
