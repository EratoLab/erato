import { useCallback } from "react";

import { useKeyboard } from "@/hooks/useKeyboard";

import type { RefObject } from "react";

interface UseRovingMenuFocusOptions {
  /** Container whose descendant items are navigated. */
  containerRef: RefObject<HTMLElement | null>;
  /** Only bind key handlers while the menu is open. */
  enabled: boolean;
  /**
   * CSS selector matching the navigable rows. Should exclude disabled items so
   * arrow-key navigation skips them (e.g. `[role="menuitem"]:not(:disabled)`).
   */
  itemSelector: string;
}

/**
 * WAI-ARIA menu roving focus: ArrowUp/Down wrap through the navigable items,
 * Home/End jump to the edges. Items carry `tabIndex={-1}`; focus roves between
 * them via `.focus()`. Shared by the chat "+" menu and `DropdownMenu` so the
 * kebab and plus menus behave identically.
 *
 * Escape-close and focus-return to the trigger are owned by `AnchoredPopover`;
 * this hook only adds the navigation keys.
 */
export function useRovingMenuFocus({
  containerRef,
  enabled,
  itemSelector,
}: UseRovingMenuFocusOptions) {
  const getNavigableItems = useCallback(
    () =>
      containerRef.current
        ? Array.from(
            containerRef.current.querySelectorAll<HTMLElement>(itemSelector),
          )
        : [],
    [containerRef, itemSelector],
  );

  const moveFocus = useCallback(
    (delta: number) => {
      const items = getNavigableItems();
      if (items.length === 0) {
        return;
      }
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex =
        currentIndex < 0
          ? delta > 0
            ? 0
            : items.length - 1
          : (currentIndex + delta + items.length) % items.length;
      items[nextIndex].focus();
    },
    [getNavigableItems],
  );

  const focusEdge = useCallback(
    (edge: "first" | "last") => {
      const items = getNavigableItems();
      if (items.length === 0) {
        return;
      }
      (edge === "first" ? items[0] : items[items.length - 1]).focus();
    },
    [getNavigableItems],
  );

  const onArrowDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      moveFocus(1);
    },
    [moveFocus],
  );
  const onArrowUp = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      moveFocus(-1);
    },
    [moveFocus],
  );
  const onHome = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      focusEdge("first");
    },
    [focusEdge],
  );
  const onEnd = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      focusEdge("last");
    },
    [focusEdge],
  );

  useKeyboard({
    target: containerRef,
    enabled,
    onArrowDown,
    onArrowUp,
    onHome,
    onEnd,
  });

  return { moveFocus, focusEdge };
}
