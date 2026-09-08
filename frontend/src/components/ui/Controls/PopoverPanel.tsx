import clsx from "clsx";
import { forwardRef } from "react";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * Panel width dialect. `min` and `wide` resolve theme tokens; `content` sizes
 * to the rows. A caller that needs some other width passes a `w-*` utility
 * through `className` — the attribute rules are layered so the utility wins.
 */
export type PopoverWidth = "min" | "content" | "wide";

export type PopoverPosition = "fixed" | "absolute";

export interface PopoverPanelProps extends ComponentPropsWithoutRef<"div"> {
  positioned: PopoverPosition;
  width?: PopoverWidth;
  /** Inset the panel's own children, for panels that render no PopoverChrome. */
  padded?: boolean;
  dataUi: string;
}

/**
 * The floating surface every popover in the app shares: skin, shape and the
 * two shape attributes the stylesheet keys on. It never portals and never
 * positions — the owner writes coordinates onto the node.
 *
 * It must stay exactly one element with `children` directly inside it: callers
 * measure and reach into the panel through `firstElementChild` /
 * `parentElement`, so an extra wrapper is a breaking change.
 */
export const PopoverPanel = forwardRef<HTMLDivElement, PopoverPanelProps>(
  function PopoverPanel(
    {
      positioned,
      width = "min",
      padded = false,
      dataUi,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        // popover-panel-geometry deliberately has no rule of its own: it is the
        // class a theme reaches every panel by, while the shape it would
        // otherwise hold lives on the two attributes below, one specificity
        // step lower so a caller's utility still wins.
        // eslint-disable-next-line tailwindcss/no-custom-classname
        className={clsx(
          "anchored-popover-skin theme-transition popover-panel-geometry border focus:outline-none",
          padded && "dropdown-panel-chrome-geometry",
          className,
        )}
        {...rest}
        data-ui={dataUi}
        data-popover-width={width}
        data-popover-position={positioned}
      >
        {children}
      </div>
    );
  },
);

export interface PopoverChromeProps extends ComponentPropsWithoutRef<"div"> {
  /** Contain the rows' overflow instead of letting them grow the panel. */
  scroll?: boolean;
  column?: boolean;
  dataUi?: string;
}

/**
 * The scrolling body inside a PopoverPanel. `scroll` only works while the
 * panel above it is a flex column that owns a max-height — without that,
 * `flex-1` has nothing to shrink against and the rows overflow the viewport.
 */
export function PopoverChrome({
  scroll = true,
  column = true,
  dataUi,
  role = "none",
  className,
  children,
  ...rest
}: PopoverChromeProps) {
  return (
    <div
      className={clsx(
        "dropdown-panel-chrome-geometry",
        column && "flex flex-col",
        scroll && "min-h-0 flex-1 overflow-y-auto overscroll-contain",
        className,
      )}
      role={role}
      data-ui={dataUi}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface PopoverSectionHeaderProps {
  id?: string;
  children: ReactNode;
}

/**
 * Label above a run of rows. `role="presentation"` keeps it out of the menu's
 * item list; the run itself is grouped by the caller, which owns the
 * `aria-labelledby` pairing.
 */
export function PopoverSectionHeader({
  id,
  children,
}: PopoverSectionHeaderProps) {
  return (
    <div
      id={id}
      role="presentation"
      data-ui="popover-section-header"
      className="px-[var(--theme-spacing-dropdown-padding-x)] pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-theme-fg-muted"
    >
      {children}
    </div>
  );
}

export type PopoverSeparatorProps = ComponentPropsWithoutRef<"div">;

export function PopoverSeparator({
  role = "separator",
  className,
  ...rest
}: PopoverSeparatorProps) {
  return (
    <div
      role={role}
      data-ui="popover-separator"
      className={clsx("my-1 h-px bg-theme-border", className)}
      {...rest}
    />
  );
}

const VIEWPORT_PADDING_FALLBACK_PX = 8;

/**
 * Resolve a CSS length — a theme token, in practice — to pixels by measuring a
 * hidden probe inside `referenceElement`, so custom properties resolve from
 * where the popover actually lives rather than from the document root.
 * Falls back to a pixel value whenever there is nothing to measure against.
 */
export function resolvePopoverViewportPadding(
  value: string,
  referenceElement: HTMLElement | null | undefined,
  fallback: number = VIEWPORT_PADDING_FALLBACK_PX,
) {
  if (typeof window === "undefined" || !referenceElement) {
    return fallback;
  }

  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.width = value;

  referenceElement.appendChild(probe);
  const resolvedWidth = probe.getBoundingClientRect().width;
  probe.remove();

  return Number.isFinite(resolvedWidth) && resolvedWidth > 0
    ? resolvedWidth
    : fallback;
}
