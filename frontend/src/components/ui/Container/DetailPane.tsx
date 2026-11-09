import clsx from "clsx";

import { Button } from "../Controls/Button";
import { CloseIcon } from "../icons";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

export interface DetailPaneProps
  extends Omit<ComponentPropsWithoutRef<"section">, "title"> {
  title: ReactNode;
  /** The heading's id; the pane is labelled by it. */
  titleId: string;
  /** Shows a close button. */
  onClose?: () => void;
  closeLabel?: string;
  /** Theme hook. Defaults to `detail-pane`. */
  "data-ui"?: string;
}

/** A pane showing one item: its heading, a close button and its sections. */
export function DetailPane({
  title,
  titleId,
  onClose,
  closeLabel,
  children,
  className,
  "data-ui": dataUi,
  ...rest
}: DetailPaneProps) {
  return (
    <section
      {...rest}
      aria-labelledby={titleId}
      data-ui={dataUi ?? "detail-pane"}
      className={clsx(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-auto border-s border-theme-border bg-[var(--theme-shell-modal,var(--theme-bg-primary))] px-[1.125rem] py-3.5 text-sm",
        className,
      )}
    >
      <div
        data-ui="detail-pane-head"
        className="flex items-start justify-between gap-2"
      >
        <h2
          id={titleId}
          className="m-0 min-w-0 text-sm font-semibold [overflow-wrap:anywhere]"
        >
          {title}
        </h2>
        {onClose ? (
          <Button
            variant="ghost"
            size="sm"
            geometry="icon"
            tabIndex={0}
            aria-label={closeLabel}
            icon={<CloseIcon className="size-4" />}
            onClick={onClose}
          />
        ) : null}
      </div>
      {children}
    </section>
  );
}

export interface DetailPaneSectionProps
  extends Omit<ComponentPropsWithoutRef<"div">, "title"> {
  title: ReactNode;
  /** A lighter note after the title. */
  hint?: ReactNode;
}

/** A titled part of a detail pane. */
export function DetailPaneSection({
  title,
  hint,
  children,
  ...rest
}: DetailPaneSectionProps) {
  return (
    <div {...rest} data-ui="detail-pane-section">
      <h3 className="m-0 mb-1.5 text-sm font-semibold">
        {title}
        {hint ? (
          <>
            {" "}
            <span className="font-normal text-theme-fg-muted">{hint}</span>
          </>
        ) : null}
      </h3>
      {children}
    </div>
  );
}
