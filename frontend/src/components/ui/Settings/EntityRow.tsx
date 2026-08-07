import clsx from "clsx";
import { useId, useState } from "react";

import { Collapse } from "../Controls/Collapse";
import {
  CheckCircleIcon,
  ChevronRightIcon,
  ErrorIcon,
  WarningCircleIcon,
} from "../icons";

import type { ReactNode } from "react";

export type EntityRowTone = "success" | "warning" | "error";

export interface EntityRowStatus {
  tone: EntityRowTone;
  /** Accessible status word; also shown as the row caption fallback. */
  label: string;
}

const toneIcon: Record<EntityRowTone, ReactNode> = {
  success: (
    <CheckCircleIcon className="size-5 shrink-0 text-theme-success-fg" />
  ),
  warning: (
    <WarningCircleIcon className="size-5 shrink-0 text-theme-warning-fg" />
  ),
  error: <ErrorIcon className="size-5 shrink-0 text-theme-error-fg" />,
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
 * header carries identity and health; everything else about the entity —
 * status sentence, connection actions, permission rows — lives in the
 * details, so new capability classes become rows, never new sections.
 *
 * Skin matches the settings status panes (Desktop Sidecar); the disclosure
 * idiom (leading chevron rotating 90°, `aria-expanded` button) matches the
 * thinking trace and sidebar sections.
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
          <ChevronRightIcon
            className={clsx(
              "size-4 shrink-0 text-theme-fg-muted transition-transform duration-200",
              isExpanded && "rotate-90",
            )}
          />
          {status ? (
            <span role="img" aria-label={status.label} title={status.label}>
              {toneIcon[status.tone]}
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="shrink-0">
                {icon}
              </span>
              <span className="truncate text-sm font-medium text-theme-fg-primary">
                {name}
              </span>
            </span>
            <span className="block truncate text-xs text-theme-fg-secondary">
              {caption ?? status?.label}
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
