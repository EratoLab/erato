import clsx from "clsx";

import type { ReactNode } from "react";

export type StatusPillTone = "info" | "success" | "warning" | "error" | "muted";

const TONE_CLASS: Record<StatusPillTone, string> = {
  info: "border-theme-info-border bg-theme-info-bg text-theme-info-fg",
  success:
    "border-theme-success-border bg-theme-success-bg text-theme-success-fg",
  warning:
    "border-theme-warning-border bg-theme-warning-bg text-theme-warning-fg",
  error: "border-theme-error-border bg-theme-error-bg text-theme-error-fg",
  // The muted foreground sits just under 4.5:1 on the secondary fill in the
  // stock light theme, so the grey pill reads its text from one step darker.
  muted: "border-theme-border bg-theme-bg-secondary text-theme-fg-secondary",
};

export interface StatusPillProps {
  tone: StatusPillTone;
  children: ReactNode;
  className?: string;
}

/** A bordered pill naming an item's state, one tone per state. */
export function StatusPill({ tone, children, className }: StatusPillProps) {
  return (
    <span
      data-ui="status-pill"
      data-tone={tone}
      className={clsx(
        "pill-geometry inline-flex shrink-0 items-center whitespace-nowrap border px-2 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
