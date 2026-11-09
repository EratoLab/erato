import clsx from "clsx";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

export interface ActionBarProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  /** The start of the bar: what is going on, such as a check's progress. */
  status?: ReactNode;
  /** The end of the bar: the buttons, in the order the caller decides. */
  children: ReactNode;
  /** Theme hook. Defaults to `action-bar`. */
  "data-ui"?: string;
}

/**
 * The bar at the bottom of a window or pane: a status on one side and the
 * decisions on the other. The fill is the modal surface rather than the
 * secondary background, which equals a primary button's fill in dark themes.
 */
export function ActionBar({
  status,
  children,
  className,
  "data-ui": dataUi,
  ...rest
}: ActionBarProps) {
  return (
    <div
      {...rest}
      data-ui={dataUi ?? "action-bar"}
      className={clsx(
        "flex min-h-14 flex-none flex-wrap items-center justify-between gap-3 border-t border-theme-border bg-[var(--theme-shell-modal,var(--theme-bg-primary))] px-[var(--theme-spacing-window-gutter)] py-3 text-sm",
        className,
      )}
    >
      <div
        data-ui="action-bar-status"
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5"
      >
        {status}
      </div>
      <div data-ui="action-bar-actions" className="flex gap-2.5">
        {children}
      </div>
    </div>
  );
}
