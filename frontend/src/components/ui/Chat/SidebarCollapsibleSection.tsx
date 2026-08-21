import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { memo, useEffect, useState } from "react";

import { Collapse, COLLAPSE_DURATION_MS } from "../Controls/Collapse";
import { DisclosureChevron } from "../Controls/DisclosureChevron";

// Nav rows and chat rows share one themeable geometry class so a single
// theme.css channel reaches both row families.
export const sidebarItemClassName = "sidebar-row-geometry";
// Horizontal inset for every row surface; see .sidebar-inset-geometry.
export const sidebarInsetClassName = "sidebar-inset-geometry";

export const parsePersistedBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : null;

export const SidebarCollapsibleSection = memo<{
  title: string;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Right-aligned header controls; a sibling of the collapse toggle so they
   * never sit inside its click target. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}>(
  ({
    title,
    defaultExpanded = true,
    expanded,
    onExpandedChange,
    actions,
    children,
    className,
  }) => {
    const [uncontrolledExpanded, setUncontrolledExpanded] =
      useState(defaultExpanded);
    const isExpanded = expanded ?? uncontrolledExpanded;
    const setIsExpanded = onExpandedChange ?? setUncontrolledExpanded;
    // Collapsed children must leave the DOM (the load-more sentinel may not
    // linger inside a zero-height clip box), but only after the height
    // transition has landed — an immediate unmount would snap the section
    // closed with nothing to animate.
    const [renderCollapsedChildren, setRenderCollapsedChildren] =
      useState(isExpanded);

    useEffect(() => {
      if (isExpanded) {
        setRenderCollapsedChildren(true);
        return;
      }
      const timeout = setTimeout(
        () => setRenderCollapsedChildren(false),
        COLLAPSE_DURATION_MS,
      );
      return () => clearTimeout(timeout);
    }, [isExpanded]);

    return (
      <div className={className}>
        <div
          className={clsx(
            sidebarInsetClassName,
            "group flex items-center gap-1 py-1",
          )}
        >
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={clsx(
              sidebarItemClassName,
              "sidebar-content-col-geometry group/toggle flex min-w-0 flex-1 items-center gap-1.5 py-2 pr-3 text-left",
            )}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? t`Collapse ${title}` : t`Expand ${title}`}
            type="button"
          >
            <h3 className="theme-transition truncate text-xs font-semibold uppercase tracking-wide text-theme-fg-muted group-hover/toggle:text-theme-fg-primary group-focus-visible/toggle:text-theme-fg-primary">
              {title}
            </h3>
            <DisclosureChevron
              open={isExpanded}
              className={clsx(
                "group-hover/toggle:text-theme-fg-primary group-focus-visible/toggle:text-theme-fg-primary",
                "opacity-0 group-hover:opacity-100 group-focus-visible/toggle:opacity-100",
                // Touch devices get no hover reveal, so the non-default
                // collapsed state must stay visible on its own.
                !isExpanded && "opacity-100",
              )}
            />
          </button>
          {actions != null && (
            <div className="sidebar-trailing-col-geometry flex shrink-0 items-center">
              {actions}
            </div>
          )}
        </div>
        {/* The chat-list inset lives on this host-owned wrapper rather than
            inside ChatHistoryList, which customers replace wholesale via the
            registry slot. */}
        <Collapse isOpen={isExpanded}>
          {(isExpanded || renderCollapsedChildren) && (
            <div className={sidebarInsetClassName}>{children}</div>
          )}
        </Collapse>
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
SidebarCollapsibleSection.displayName = "SidebarCollapsibleSection";
