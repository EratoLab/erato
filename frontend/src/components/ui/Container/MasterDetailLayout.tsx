import clsx from "clsx";

import type { ComponentPropsWithoutRef, ReactNode, Ref } from "react";

export interface MasterDetailLayoutProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  list: ReactNode;
  /** Shown beside the list, or over it in a small window; omit to hide it. */
  detail?: ReactNode;
  /** The scrolling list column, for callers that measure its width. */
  listRef?: Ref<HTMLDivElement>;
  /** Theme hook. Defaults to `master-detail`. */
  "data-ui"?: string;
}

/**
 * A list with a detail pane beside it. Below 40rem the detail overlays the
 * list from the inline end. Set `--master-detail-width` to change the pane's
 * width. While the detail is open, list rows give the title more room.
 */
export function MasterDetailLayout({
  list,
  detail,
  listRef,
  className,
  "data-ui": dataUi,
  ...rest
}: MasterDetailLayoutProps) {
  const open = detail != null;
  return (
    <div
      {...rest}
      data-ui={dataUi ?? "master-detail"}
      data-detail-open={open || undefined}
      className={clsx("master-detail-geometry", className)}
    >
      <div
        ref={listRef}
        data-ui="master-detail-list"
        className="min-h-0 min-w-0 overflow-auto"
      >
        {list}
      </div>
      {open ? (
        <div data-ui="master-detail-detail" className="flex min-h-0 flex-col">
          {detail}
        </div>
      ) : null}
    </div>
  );
}
