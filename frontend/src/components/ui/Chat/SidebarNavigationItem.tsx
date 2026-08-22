import clsx from "clsx";

import {
  sidebarInsetClassName,
  sidebarItemClassName,
} from "./SidebarCollapsibleSection";
import { InteractiveContainer } from "../Container/InteractiveContainer";

const activeSidebarItemClassName = "sidebar-row-geometry sidebar-row-selected";
// Inset ring for the same reason as the chat rows: the row inset is
// themeable and can be narrower than an outside-drawn ring.
const sidebarLinkClassName =
  "focus-ring-inset block rounded-[var(--theme-radius-shell)]";

/** Icon geometry every sidebar nav row shares; apply it to the `icon` node. */
export const sidebarNavigationIconClassName =
  "size-4 shrink-0 text-theme-fg-secondary";

export interface SidebarNavigationItemProps {
  /** Accessible name, visible label and slim-mode tooltip. */
  label: string;
  /** Sized icon node, e.g. a ResolvedIcon with sidebarNavigationIconClassName. */
  icon: React.ReactNode;
  /**
   * Plain-click action. With `href` set it replaces the default navigation;
   * cmd/ctrl-clicks still reach the browser so the link can open in a tab.
   */
  onClick?: () => void;
  /** Renders the row as a real link so modified clicks work on it. */
  href?: string;
  /** Selected, non-interactive presentation for the page currently shown. */
  active?: boolean;
  isSlimMode?: boolean;
  /** Test/theme hook on the row container. */
  "data-ui"?: string;
}

/**
 * One sidebar navigation row: sidebar row/content-column geometry channels,
 * themeable hover surface and the slim-mode label collapse, shared by the web
 * sidebar's nav rows and the add-in's history drawer.
 */
export const SidebarNavigationItem = ({
  label,
  icon,
  onClick,
  href,
  active = false,
  isSlimMode = false,
  "data-ui": dataUi,
}: SidebarNavigationItemProps) => {
  const labelNode = (
    <span
      className={clsx(
        "whitespace-nowrap font-medium text-theme-fg-primary transition-opacity duration-150",
        isSlimMode ? "w-0 overflow-hidden opacity-0" : "opacity-100 delay-150",
      )}
    >
      {label}
    </span>
  );

  if (active) {
    return (
      <div className={clsx(sidebarInsetClassName, "py-1")}>
        <InteractiveContainer
          useDiv={true}
          interactive={false}
          className={clsx(
            activeSidebarItemClassName,
            "flex items-center text-left",
            "sidebar-content-col-geometry gap-3 py-2 pr-3",
          )}
          aria-label={label}
          title={isSlimMode ? label : undefined}
          data-ui={dataUi}
        >
          {icon}
          {labelNode}
        </InteractiveContainer>
      </div>
    );
  }

  if (href != null) {
    return (
      <div className={clsx(sidebarInsetClassName, "py-1")}>
        <a
          href={href}
          onClick={(e) => {
            // Allow cmd/ctrl-click to open in new tab
            if (e.metaKey || e.ctrlKey) {
              return;
            }
            // Prevent default navigation for normal clicks
            e.preventDefault();
            onClick?.();
          }}
          className={sidebarLinkClassName}
          aria-label={label}
          title={isSlimMode ? label : undefined}
        >
          <InteractiveContainer
            useDiv={true}
            showFocusRing={false}
            className={clsx(
              sidebarItemClassName,
              "theme-transition flex items-center text-left hover:bg-[var(--theme-shell-sidebar-hover)]",
              "sidebar-content-col-geometry gap-3 py-2 pr-3",
            )}
            data-ui={dataUi}
          >
            {icon}
            {labelNode}
          </InteractiveContainer>
        </a>
      </div>
    );
  }

  return (
    <div className={clsx(sidebarInsetClassName, "py-1")}>
      <InteractiveContainer
        useDiv={true}
        showFocusRing={false}
        onClick={() => onClick?.()}
        className={clsx(
          sidebarItemClassName,
          "focus-ring-inset theme-transition flex items-center text-left hover:bg-[var(--theme-shell-sidebar-hover)]",
          "sidebar-content-col-geometry gap-3 py-2 pr-3",
        )}
        aria-label={label}
        title={isSlimMode ? label : undefined}
        data-ui={dataUi}
      >
        {icon}
        {labelNode}
      </InteractiveContainer>
    </div>
  );
};
