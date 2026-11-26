import clsx from "clsx";

import { useIsNarrowScreen } from "@/hooks/ui";

const SIDEBAR_PAGE_CLASS = "sidebar-page-geometry";

/**
 * Props for the page rendered after `ChatHistorySidebar`, in the same parent.
 * From the sm breakpoint up the page makes room for the sidebar with a
 * margin; below it the open sidebar pushes the page aside.
 */
export function useSidebarPageProps(
  sidebarCollapsed: boolean,
  collapsedMode: "hidden" | "slim",
) {
  const pushed = useIsNarrowScreen() && !sidebarCollapsed;
  return {
    className: clsx(
      SIDEBAR_PAGE_CLASS,
      "transition-[margin,transform] duration-300 ease-in-out motion-reduce:transition-none",
      !sidebarCollapsed &&
        "sm:ml-[var(--sidebar-width-override,var(--theme-layout-sidebar-width))]",
      sidebarCollapsed &&
        collapsedMode === "slim" &&
        "sm:ml-[var(--theme-layout-sidebar-slim-width)]",
    ),
    "data-sidebar-pushed": pushed ? "" : undefined,
  };
}

/** The page next to the sidebar whose outermost element is `sidebarRoot`. */
export function findSidebarPage(
  sidebarRoot: HTMLElement | null,
): HTMLElement | null {
  for (
    let sibling = sidebarRoot?.nextElementSibling;
    sibling;
    sibling = sibling.nextElementSibling
  ) {
    if (
      sibling instanceof HTMLElement &&
      sibling.classList.contains(SIDEBAR_PAGE_CLASS)
    ) {
      return sibling;
    }
  }
  return null;
}
