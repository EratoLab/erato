import clsx from "clsx";
import { useEffect, useState } from "react";

import { ChevronRightIcon } from "@/components/ui/icons";

import { TraceCollapse } from "./TraceCollapse";
import { TraceRailIcon } from "./TraceRailIcon";

import type { ReactNode } from "react";

interface TraceStepProps {
  /** Icon rendered in the rail column. */
  railIcon: ReactNode;
  /** Whether the rail's vertical line continues below this step. */
  hasTrailingRailLine: boolean;
  /** A short, single-line label rendered in the step header. */
  title: ReactNode;
  /** Optional inline node next to the title (e.g. a tool status pill). */
  titleSlot?: ReactNode;
  /**
   * Optional node trailing the header, outside the toggle. Interactive
   * content belongs here: nested inside the toggle it would be invalid
   * markup, and its clicks would fold the step.
   */
  headerSlot?: ReactNode;
  /**
   * Body content — collapsed by default after streaming finishes. A step
   * without body content renders as a plain row: no chevron, no toggle.
   */
  children?: ReactNode;
  /** Default-open state. Pass `true` for the live (still-streaming) step. */
  defaultOpen?: boolean;
  /**
   * One-shot expand on transition to `true` — for body content that appears
   * after mount and should be seen without a click (e.g. a nested step log
   * streaming in). The user's manual toggle stays authoritative afterwards.
   */
  autoExpand?: boolean;
  /**
   * Auto-collapse trigger: when this transitions from `false` → `true` the
   * step collapses (because a later step appeared and stole the focus). The
   * user can re-open manually afterwards — this is a one-way nudge, not a
   * permanent lock.
   */
  autoCollapse?: boolean;
  /** Pulses the rail icon to signal in-flight work. */
  isActive?: boolean;
}

/**
 * Visual primitive for a single trace row: rail (icon + connecting line) +
 * collapsible body. Stateless about content type — just a layout shell.
 *
 * Open/close behaviour:
 * - `defaultOpen` seeds the initial state (true for the live writer).
 * - `autoCollapse` going `true` triggers a one-shot collapse — useful when
 *   later content appears. The user can manually re-expand at any time.
 * - The user's manual click is always authoritative.
 */
export const TraceStep = ({
  railIcon,
  hasTrailingRailLine,
  title,
  titleSlot,
  headerSlot,
  children,
  defaultOpen = false,
  autoExpand = false,
  autoCollapse = false,
  isActive = false,
}: TraceStepProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    if (autoExpand) {
      setIsOpen(true);
    }
  }, [autoExpand]);

  // One-shot auto-collapse on transition: when later content appears, fold
  // up. Doesn't lock the state — clicking afterwards expands again. Ordered
  // after auto-expand so a tie folds rather than opens.
  useEffect(() => {
    if (autoCollapse) {
      setIsOpen(false);
    }
  }, [autoCollapse]);

  return (
    <div className="flex flex-row">
      <TraceRailIcon
        icon={railIcon}
        hasTrailingLine={hasTrailingRailLine}
        isActive={isActive}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          {children == null ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-2.5 text-left text-sm text-theme-fg-secondary">
              <span className="truncate font-medium">{title}</span>
              {titleSlot}
            </div>
          ) : (
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setIsOpen((prev) => !prev)}
              className={clsx(
                "flex flex-1 items-center gap-2 py-1 pl-2.5 text-left text-sm text-theme-fg-secondary",
                "cursor-pointer transition-colors hover:text-theme-fg-primary",
                "min-w-0",
              )}
            >
              <span className="truncate font-medium">{title}</span>
              {titleSlot}
              <ChevronRightIcon
                aria-hidden="true"
                className={clsx(
                  "ml-auto size-3 shrink-0 text-theme-fg-muted transition-transform",
                  isOpen ? "rotate-90" : "rotate-0",
                )}
              />
            </button>
          )}
          {headerSlot}
        </div>
        {children != null && (
          <TraceCollapse isOpen={isOpen}>
            <div className="pl-2.5 pt-0.5 text-sm text-theme-fg-primary">
              {children}
            </div>
          </TraceCollapse>
        )}
      </div>
    </div>
  );
};
