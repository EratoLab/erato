import clsx from "clsx";

import type { ComponentPropsWithoutRef } from "react";

const VARIANT_STYLES = {
  // Overlay badge on a control (collapsed rail, menu trigger): something
  // offscreen wants the user's eye, so it carries the action-primary tone.
  attention: "bg-theme-action-primary-bg text-theme-action-primary-fg",
  // Inline passive count next to a label the user is already reading;
  // attention on such a row travels separately (e.g. a status dot).
  count: "bg-theme-bg-secondary text-theme-fg-secondary",
} as const;

export type CountBadgeVariant = keyof typeof VARIANT_STYLES;

export interface CountBadgeProps extends ComponentPropsWithoutRef<"span"> {
  variant: CountBadgeVariant;
}

/**
 * The rounded numeric badge. Hidden from the accessibility tree by default —
 * a bare number is noise in an accessible name, so the owning control should
 * say the count in its own label. Pass `aria-hidden={false}` only where that
 * label does not carry the count.
 */
export const CountBadge = ({
  variant,
  className,
  children,
  ...props
}: CountBadgeProps) => (
  <span
    aria-hidden="true"
    {...props}
    className={clsx(
      "flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4",
      VARIANT_STYLES[variant],
      className,
    )}
  >
    {children}
  </span>
);
