import { useEffect, useLayoutEffect, useRef } from "react";

/** Restore a Word action's lost focus without interrupting work elsewhere. */
export function useWordReviewFocus(transition: string) {
  const cardRef = useRef<HTMLElement>(null);
  const ownedFocus = useRef(false);
  const previous = useRef(transition);

  useEffect(() => {
    const trackFocus = (event: FocusEvent) => {
      // Removing a focused control falls back to body. Retain ownership until
      // the result renders, unless the user has focused another actual control.
      if (event.target !== document.body && event.target instanceof Node) {
        ownedFocus.current = !!cardRef.current?.contains(event.target);
      }
    };
    const trackPointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !cardRef.current?.contains(event.target)
      )
        ownedFocus.current = false;
    };
    document.addEventListener("focusin", trackFocus);
    document.addEventListener("pointerdown", trackPointer);
    return () => {
      document.removeEventListener("focusin", trackFocus);
      document.removeEventListener("pointerdown", trackPointer);
    };
  }, []);

  useLayoutEffect(() => {
    const changed = previous.current !== transition;
    previous.current = transition;
    if (
      changed &&
      ownedFocus.current &&
      cardRef.current &&
      (document.activeElement === document.body ||
        document.activeElement === cardRef.current ||
        (cardRef.current.contains(document.activeElement) &&
          document.activeElement?.closest("[hidden]")))
    ) {
      const result = cardRef.current.querySelector<HTMLElement>(
        "[data-word-review-result]",
      );
      (result ?? cardRef.current).focus({ preventScroll: true });
    }
  }, [transition]);

  return cardRef;
}
