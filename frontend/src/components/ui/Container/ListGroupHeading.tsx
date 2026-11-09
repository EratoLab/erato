import clsx from "clsx";

import type { ComponentPropsWithoutRef } from "react";

export type ListGroupHeadingProps = ComponentPropsWithoutRef<"h2">;

/** The heading of one group of rows inside a list. */
export function ListGroupHeading({
  className,
  children,
  ...rest
}: ListGroupHeadingProps) {
  return (
    <h2
      {...rest}
      data-ui="list-group-heading"
      className={clsx(
        "m-0 px-6 pb-1 pt-3 text-xs font-semibold text-theme-fg-secondary",
        className,
      )}
    >
      {children}
    </h2>
  );
}
