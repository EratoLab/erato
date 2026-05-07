import clsx from "clsx";

import type { ReactNode } from "react";

interface TraceCollapseProps {
  /** When true, the children are rendered at full height. */
  isOpen: boolean;
  /** Optional class on the inner overflow-clipping wrapper. */
  className?: string;
  children: ReactNode;
}

/**
 * Pure-CSS expand/collapse based on `grid-template-rows: 0fr ↔ 1fr` and an
 * `overflow-hidden` clipper child. The grid row track size resolves against
 * `1fr` of the children's intrinsic height — so there's no JS measurement and
 * the animation always lands at the exact height the content wants.
 *
 * Use this for the whole-trace toggle. Per-step "soft truncate" uses
 * `transition-[max-height]` instead (see TraceStep).
 */
export const TraceCollapse = ({
  isOpen,
  className,
  children,
}: TraceCollapseProps) => (
  <div
    className="grid transition-[grid-template-rows] duration-300 ease-out"
    style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
  >
    <div className={clsx("min-w-0 overflow-hidden", className)}>{children}</div>
  </div>
);
