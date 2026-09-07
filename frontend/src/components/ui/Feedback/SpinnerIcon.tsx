import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { memo } from "react";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

export interface SpinnerIconProps extends ComponentPropsWithoutRef<"span"> {
  /**
   * Ring diameter: 12 / 16 / 24 / 32px, or the size of the containing box.
   */
  size?: "sm" | "md" | "lg" | "xl" | "fill";

  /**
   * Visible caption rendered under the ring. It supplies the accessible name,
   * so no screen-reader-only text is rendered alongside it.
   */
  label?: ReactNode;

  /**
   * Screen-reader-only text for a ring with no visible caption.
   */
  srText?: string;
}

// Full literals: Tailwind drops @layer components rules whose class name never
// appears in the scanned sources, so a `spinner-${size}` template would compile
// away every size rule.
const SIZE_CLASSES: Record<NonNullable<SpinnerIconProps["size"]>, string> = {
  sm: "spinner-sm",
  md: "spinner-md",
  lg: "spinner-lg",
  xl: "spinner-xl",
  fill: "spinner-fill",
};

/**
 * The loading ring. Announces itself as a status region by default; pass
 * `aria-hidden` where the surrounding element already carries the live region,
 * which drops `role="status"` so nothing announces twice.
 */
export const SpinnerIcon = memo(
  ({
    size = "md",
    className,
    label,
    srText = t({ id: "common.loadingEllipsis", message: "Loading..." }),
    ...props
  }: SpinnerIconProps) => {
    const ariaHidden = props["aria-hidden"];
    const decorative = ariaHidden === true || ariaHidden === "true";
    const role = decorative ? undefined : "status";
    const ringClassName = clsx("spinner-geometry", SIZE_CLASSES[size]);

    if (label !== undefined && label !== null) {
      return (
        <span
          role={role}
          data-ui="spinner"
          data-size={size}
          {...props}
          className={clsx("inline-flex flex-col items-center gap-4", className)}
        >
          <span
            aria-hidden="true"
            data-ui="spinner-ring"
            className={ringClassName}
          />
          <span
            data-ui="spinner-label"
            className="text-sm text-theme-fg-secondary"
          >
            {label}
          </span>
        </span>
      );
    }

    return (
      <span
        role={role}
        data-ui="spinner"
        data-size={size}
        {...props}
        className={clsx(ringClassName, className)}
      >
        {decorative ? null : <span className="sr-only">{srText}</span>}
      </span>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
SpinnerIcon.displayName = "SpinnerIcon";
