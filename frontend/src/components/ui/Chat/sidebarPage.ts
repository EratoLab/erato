import clsx from "clsx";
import { useRef } from "react";

import { useIsNarrowScreen } from "@/hooks/ui";

import { ERATO_GEOMETRY_CLASS } from "../styles/geometryClassNames";

/** Whether the sidebar is open on a narrow screen, where it pushes the page aside. */
export function useSidebarPushesPage(sidebarCollapsed: boolean): boolean {
  return useIsNarrowScreen() && !sidebarCollapsed;
}

/**
 * Props for the page rendered beside `ChatHistorySidebar`; pass `ref` to the
 * sidebar's `pageRef` as well, so a drag can move the page. From the sm
 * breakpoint up the page makes room for the sidebar with a margin; below it
 * the open sidebar pushes the page aside.
 */
export function useSidebarPage(
  sidebarCollapsed: boolean,
  collapsedMode: "hidden" | "slim",
) {
  const ref = useRef<HTMLDivElement>(null);
  const pushable = useIsNarrowScreen();
  const pushed = pushable && !sidebarCollapsed;
  return {
    ref,
    className: clsx(
      ERATO_GEOMETRY_CLASS.sidebarPageGeometry,
      "transition-[margin,transform] duration-300 ease-in-out motion-reduce:transition-none",
      !sidebarCollapsed &&
        "sm:ml-[var(--sidebar-width-override,var(--theme-layout-sidebar-width))]",
      sidebarCollapsed &&
        collapsedMode === "slim" &&
        "sm:ml-[var(--theme-layout-sidebar-slim-width)]",
    ),
    "data-sidebar-pushable": pushable ? "" : undefined,
    "data-sidebar-pushed": pushed ? "" : undefined,
  };
}
