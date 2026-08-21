import clsx from "clsx";
import { useId, useState } from "react";

import { Collapse } from "../Controls/Collapse";
import { DisclosureChevron } from "../Controls/DisclosureChevron";
import { CheckCircleIcon, ErrorIcon, WarningCircleIcon } from "../icons";

import type { ReactNode } from "react";

export type EntityRowTone = "success" | "warning" | "error";

export interface EntityRowStatus {
  tone: EntityRowTone;
  /** Status word on the caption line; also the caption fallback. */
  label: string;
}

// Icons inherit the caption's tone color via currentColor.
const toneIcon: Record<EntityRowTone, ReactNode> = {
  success: <CheckCircleIcon className="size-3.5 shrink-0" />,
  warning: <WarningCircleIcon className="size-3.5 shrink-0" />,
  error: <ErrorIcon className="size-3.5 shrink-0" />,
};

const toneText: Record<EntityRowTone, string> = {
  success: "text-theme-success-fg",
  warning: "text-theme-warning-fg",
  error: "text-theme-error-fg",
};

interface EntityRowProps {
  /** Kind glyph for the entity (MCP mark, computer, mail, ...). */
  icon: ReactNode;
  name: ReactNode;
  /**
   * Connection state; omit for entities with nothing to connect (their
   * `caption` says why, e.g. "Built into Outlook").
   */
  status?: EntityRowStatus | null;
  /** One-line muted caption; defaults to the status label. */
  caption?: ReactNode;
  /** Trailing primary action (e.g. Authorize); NOT part of the toggle. */
  action?: ReactNode;
  defaultExpanded?: boolean;
  "data-testid"?: string;
  /** Expanded details. */
  children: ReactNode;
}

/**
 * One expandable capability-provider row of the Servers & Tools pane. The
 * header carries identity (kind icon + name) with a one-line caption below
 * that doubles as the status line — toned icon and text on the same line;
 * everything else about the entity (connection actions, permission rows)
 * lives in the details, so new capability classes become rows, never new
 * sections.
 *
 * The disclosure idiom (leading chevron rotating 90°, `aria-expanded`
 * button) matches the thinking trace and sidebar sections.
 */
export function EntityRow({
  icon,
  name,
  status,
  caption,
  action,
  defaultExpanded = false,
  "data-testid": dataTestId,
  children,
}: EntityRowProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const panelId = useId();

  return (
    <article
      className="rounded-[var(--theme-radius-control)] border border-theme-border bg-theme-bg-secondary"
      data-testid={dataTestId}
    >
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={panelId}
          onClick={() => setIsExpanded((value) => !value)}
          className="theme-transition focus-ring-tight flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <DisclosureChevron open={isExpanded} size="md" />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="shrink-0">
                {icon}
              </span>
              <span className="truncate text-sm font-medium text-theme-fg-primary">
                {name}
              </span>
            </span>
            <span
              className={clsx(
                "flex items-center gap-1 text-xs",
                status ? toneText[status.tone] : "text-theme-fg-secondary",
              )}
            >
              {status ? (
                <span aria-hidden="true">{toneIcon[status.tone]}</span>
              ) : null}
              <span className="truncate">{caption ?? status?.label}</span>
            </span>
          </span>
        </button>
        {action ? <span className="shrink-0">{action}</span> : null}
      </div>
      <Collapse isOpen={isExpanded}>
        <div
          id={panelId}
          className="space-y-3 border-t border-theme-border p-4 pt-3"
        >
          {children}
        </div>
      </Collapse>
    </article>
  );
}
