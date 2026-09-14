import clsx from "clsx";
import { forwardRef } from "react";

import type { ReactNode } from "react";

/** Decides the divider side and the default `data-ui` hook, nothing else —
 * both bands share one skin and one height formula. */
export type SidebarBandEdge = "header" | "footer";

export interface SidebarBandProps {
  edge: SidebarBandEdge;
  /** A layout mode, not just padding: drops `flex` and the height formula too,
   * because a flush band's single child owns both. That child has no width
   * class, so in a flex row it would shrink off the drawer's edge. */
  flush?: boolean;
  dataUi?: string;
  className?: string;
  children?: ReactNode;
}

const DEFAULT_DATA_UI: Record<SidebarBandEdge, string> = {
  header: "sidebar-header",
  footer: "sidebar-footer",
};

/**
 * The sidebar's header and footer bands, on the host and in the add-in's
 * history drawer alike. Everything paintable lives in classes and never
 * inline, so a customer theme can reach it.
 */
export const SidebarBand = forwardRef<HTMLDivElement, SidebarBandProps>(
  function SidebarBand(
    { edge, flush = false, dataUi, className, children },
    ref,
  ) {
    return (
      <div
        ref={ref}
        data-ui={dataUi ?? DEFAULT_DATA_UI[edge]}
        className={clsx(
          "sidebar-section-skin",
          // Source order in globals.css is what zeroes the skin's padding.
          flush ? "sidebar-band-flush" : "sidebar-band-geometry flex",
          edge === "header" ? "border-b" : "border-t",
          className,
        )}
      >
        {children}
      </div>
    );
  },
);
