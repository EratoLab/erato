import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import type { ReactNode, RefObject } from "react";

/** Matches the `duration-300` transition class below, for callers that need
 * to defer work (e.g. unmounting children) until the collapse has landed. */
export const COLLAPSE_DURATION_MS = 300;

export interface CollapseProps {
  /** When true, the children are rendered at full height. */
  isOpen: boolean;
  /** Optional class on the inner overflow-clipping wrapper. */
  className?: string;
  /**
   * Open and close at once while the content is taller than the viewport.
   * Mid-animation the grid row is a fraction of the box it sits in, so a tall
   * body shows a blank band of up to a quarter of its height.
   */
  instantWhenTall?: boolean;
  children: ReactNode;
}

const useTallerThanViewport = (
  ref: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): boolean => {
  const [isTall, setIsTall] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      setIsTall(element.offsetHeight > window.innerHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);

  return isTall;
};

/**
 * Pure-CSS expand/collapse based on `grid-template-rows: 0fr ↔ 1fr` and an
 * `overflow-hidden` clipper child. The grid row track size resolves against
 * `1fr` of the children's intrinsic height — so there's no JS measurement and
 * the animation always lands at the exact height the content wants.
 */
export const Collapse = ({
  isOpen,
  className,
  instantWhenTall = false,
  children,
}: CollapseProps) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const isTall = useTallerThanViewport(contentRef, instantWhenTall);

  return (
    <div
      className={clsx(
        "grid",
        !isTall &&
          "transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
      )}
      style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
    >
      <div className={clsx("min-w-0 overflow-hidden", className)}>
        {instantWhenTall ? <div ref={contentRef}>{children}</div> : children}
      </div>
    </div>
  );
};
