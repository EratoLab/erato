import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

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
  /**
   * Text that belongs after the title and must stay readable, such as a tool
   * call's counts: it is never cut off with the title, and drops below it
   * when the row is too narrow for both.
   */
  titleAfter?: ReactNode;
  /** Optional inline node next to the title (e.g. a tool status pill). */
  titleSlot?: ReactNode;
  /**
   * The title wraps to a second line instead of being cut, for a sentence
   * whose verb can come last, as in German.
   */
  titleWraps?: boolean;
  /**
   * Optional node trailing the header, outside the toggle. Interactive
   * content belongs here: nested inside the toggle it would be invalid
   * markup, and its clicks would fold the step.
   */
  headerSlot?: ReactNode;
  /**
   * Optional node under the header that stays visible when the body is
   * folded, e.g. the key values of a tool call.
   */
  detailSlot?: ReactNode;
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
  /**
   * The body is still being written: it shows its newest lines in a window of
   * bounded height, and keeps that window until the user opens the step
   * again, so the fold that ends the live phase stays short.
   */
  liveBody?: boolean;
}

const BodyWindow = ({
  isWindowed,
  children,
}: {
  isWindowed: boolean;
  children: ReactNode;
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    const content = contentRef.current;
    if (
      !isWindowed ||
      !frame ||
      !content ||
      typeof ResizeObserver === "undefined"
    ) {
      setOverflows(false);
      return;
    }
    const observer = new ResizeObserver(() => {
      setOverflows(content.offsetHeight > frame.clientHeight + 1);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [isWindowed]);

  return (
    <div
      ref={frameRef}
      data-testid={isWindowed ? "trace-step-live-window" : undefined}
      className={clsx(
        isWindowed && "flex max-h-64 flex-col justify-end overflow-hidden",
        isWindowed &&
          overflows &&
          "[mask-image:linear-gradient(to_bottom,transparent,black_2.5rem)]",
      )}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
};

const TraceStepTitle = ({
  title,
  after,
  wraps,
}: {
  title: ReactNode;
  after: ReactNode;
  wraps: boolean;
}) => {
  return after == null ? (
    <span
      className={clsx(
        wraps
          ? "line-clamp-2 min-w-0 break-words [overflow-wrap:anywhere]"
          : "truncate",
        "font-medium",
      )}
    >
      {title}
    </span>
  ) : (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span
        className={clsx(
          wraps
            ? "line-clamp-2 break-words [overflow-wrap:anywhere]"
            : "truncate",
          "min-w-0 max-w-full font-medium",
        )}
      >
        {title}
      </span>
      <span
        className="min-w-0 max-w-full whitespace-normal break-words font-normal text-theme-fg-muted"
        data-testid="trace-step-title-after"
      >
        {after}
      </span>
    </span>
  );
};

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
  titleAfter,
  titleSlot,
  titleWraps = false,
  headerSlot,
  detailSlot,
  children,
  defaultOpen = false,
  autoExpand = false,
  autoCollapse = false,
  isActive = false,
  liveBody = false,
}: TraceStepProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [keepsWindow, setKeepsWindow] = useState(liveBody);

  useEffect(() => {
    if (liveBody) {
      setKeepsWindow(true);
    }
  }, [liveBody]);

  const toggle = () => {
    if (!isOpen && !liveBody) {
      setKeepsWindow(false);
    }
    setIsOpen((prev) => !prev);
  };

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
              <TraceStepTitle
                title={title}
                after={titleAfter}
                wraps={titleWraps}
              />
              {titleSlot}
            </div>
          ) : (
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={toggle}
              className={clsx(
                "flex flex-1 items-center gap-2 py-1 pl-2.5 text-left text-sm text-theme-fg-secondary",
                "cursor-pointer transition-colors hover:text-theme-fg-primary",
                "min-w-0",
              )}
            >
              <TraceStepTitle
                title={title}
                after={titleAfter}
                wraps={titleWraps}
              />
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
        {detailSlot != null && (
          <div className="pb-1 pl-2.5 text-sm">{detailSlot}</div>
        )}
        {children != null && (
          <TraceCollapse isOpen={isOpen} instantWhenTall>
            <div className="pl-2.5 pt-0.5 text-sm text-theme-fg-primary">
              <BodyWindow isWindowed={liveBody || keepsWindow}>
                {children}
              </BodyWindow>
            </div>
          </TraceCollapse>
        )}
      </div>
    </div>
  );
};
