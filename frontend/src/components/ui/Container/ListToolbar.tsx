import clsx from "clsx";

import type { ComponentPropsWithoutRef } from "react";

export interface ListToolbarProps extends ComponentPropsWithoutRef<"div"> {
  /** Theme hook. Defaults to `list-toolbar`. */
  "data-ui"?: string;
}

/** The band above a list, for list-wide controls such as select-all and filters. */
export function ListToolbar({
  className,
  children,
  "data-ui": dataUi,
  ...rest
}: ListToolbarProps) {
  return (
    <div
      {...rest}
      data-ui={dataUi ?? "list-toolbar"}
      className={clsx(
        "flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-y border-theme-border bg-theme-bg-secondary px-6 py-2 text-sm text-theme-fg-secondary",
        className,
      )}
    >
      {children}
    </div>
  );
}
