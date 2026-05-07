import clsx from "clsx";

import type { ReactNode } from "react";

interface TraceRailIconProps {
  icon: ReactNode;
  /** When true, the rail line below the icon is drawn (i.e. more steps follow). */
  hasTrailingLine: boolean;
  /** When true, applies a subtle pulse to the icon to signal in-flight work. */
  isActive?: boolean;
}

/**
 * The left-rail content for a single step: an icon, then a `flex-1` filler
 * line that stretches down to the bottom of the step row — guaranteeing the
 * connecting line aligns visually with the next connector / step.
 */
export const TraceRailIcon = ({
  icon,
  hasTrailingLine,
  isActive = false,
}: TraceRailIconProps) => (
  <div className="flex w-5 shrink-0 justify-center">
    <div className="flex flex-col items-center pt-1">
      <span
        aria-hidden="true"
        className={clsx(
          "text-theme-fg-secondary",
          isActive && "animate-pulse",
        )}
      >
        {icon}
      </span>
      <div
        className={clsx(
          "mt-1 w-px flex-1",
          hasTrailingLine ? "bg-theme-border" : undefined,
        )}
      />
    </div>
  </div>
);
