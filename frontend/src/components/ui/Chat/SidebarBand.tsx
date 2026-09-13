import clsx from "clsx";
import { forwardRef } from "react";

import type { ReactNode } from "react";

/**
 * Which edge of the sidebar shell the band sits on. It decides the divider
 * side and the default `data-ui` hook — nothing else: both bands share one
 * skin and one height formula so they stay equal for any token values.
 */
export type SidebarBandEdge = "header" | "footer";

export interface SidebarBandProps {
  edge: SidebarBandEdge;
  /**
   * Layout mode, not only a padding switch. A flush band drops its padding
   * AND `flex` AND `.sidebar-band-geometry`, because its single child carries
   * the sidebar inset and the band height itself (the add-in drawer's
   * Settings row). Inside a flex row that child — which has no width class —
   * would shrink to its content and leave its hover surface short of the
   * drawer's edge.
   */
  flush?: boolean;
  /** Theme hook. Overrides the per-edge default. */
  dataUi?: string;
  /** Merged last, so a caller's utilities win over the band's own. */
  className?: string;
  children?: ReactNode;
}

const DEFAULT_DATA_UI: Record<SidebarBandEdge, string> = {
  header: "sidebar-header",
  footer: "sidebar-footer",
};

/**
 * The sidebar's header and footer bands, on the host and in the add-in's
 * history drawer alike.
 *
 * Everything paintable lives in classes, never inline: `style` must stay
 * empty so a customer theme can reach the band at all, and the shared
 * `.sidebar-band-geometry` height formula is what keeps header and footer
 * within a pixel of each other (an e2e spec asserts exactly that).
 *
 * The normal-mode class string is pinned by both a unit test and a geometry
 * spec, so a "harmless" reorder of it is a visible change.
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
          // `.sidebar-band-flush` must follow `.sidebar-section-skin` in the
          // stylesheet: both are specificity 0,1,0, so source order is what
          // zeroes the skin's padding — no `!important` needed.
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
