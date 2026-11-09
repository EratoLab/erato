import clsx from "clsx";

import type { ComponentPropsWithoutRef } from "react";

export interface ListGroupHeadingProps extends ComponentPropsWithoutRef<"h2"> {
  /** `overline` is the small-capitals label of a page-level list. */
  variant?: "default" | "overline";
  /** Theme hook. Defaults to `list-group-heading`. */
  "data-ui"?: string;
}

/** The heading of one group of rows inside a list. */
export function ListGroupHeading({
  variant = "default",
  className,
  children,
  "data-ui": dataUi,
  ...rest
}: ListGroupHeadingProps) {
  return (
    <h2
      {...rest}
      data-ui={dataUi ?? "list-group-heading"}
      className={clsx(
        "text-xs font-semibold",
        variant === "overline"
          ? "mb-2 px-4 uppercase tracking-wide text-theme-fg-muted"
          : "m-0 px-[var(--theme-spacing-window-gutter)] pb-1 pt-3 text-theme-fg-secondary",
        className,
      )}
    >
      {children}
    </h2>
  );
}
