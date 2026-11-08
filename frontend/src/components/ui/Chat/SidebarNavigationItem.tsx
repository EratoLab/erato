import clsx from "clsx";

import { sidebarInsetClassName } from "./SidebarCollapsibleSection";
import { Row } from "../Controls/Row";

// Inset ring for the same reason as the chat rows: the row inset is
// themeable and can be narrower than an outside-drawn ring.
const sidebarLinkClassName =
  "focus-ring-inset block rounded-[var(--theme-radius-shell)]";

/**
 * Flow the row body keeps for itself: Row's sidebar variant emits nothing on
 * the cross axis, because the history rows stack and these rows do not.
 */
const sidebarNavigationRowClassName =
  "sidebar-content-col-geometry items-center gap-3 py-2 pr-3";

/**
 * Icon geometry every sidebar nav row shares; apply it to the `icon` node.
 * A bundle of utilities rather than a declared host class, so it is deliberately
 * absent from ERATO_GEOMETRY_CLASS — themes reach the icon column through
 * `.sidebar-icon-col-geometry` instead.
 */
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
  /**
   * Why the row needs attention, shown as a warning dot on the icon. The dot is
   * visual only, so the reason joins the accessible name and the slim-mode
   * tooltip.
   */
  warning?: string;
  /** Test/theme hook on the row container. */
  "data-ui"?: string;
}

/**
 * One sidebar navigation row: sidebar row/content-column geometry channels,
 * themeable hover surface and the slim-mode label collapse, shared by the web
 * sidebar's nav rows and the add-in's history drawer.
 *
 * Three elements, deliberately, and the shape is the row-alignment contract:
 * the inset div sets the themeable margin, the link (where there is one) takes
 * focus, and the Row paints.
 */
export const SidebarNavigationItem = ({
  label,
  icon,
  onClick,
  href,
  active = false,
  isSlimMode = false,
  warning,
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

  // `active` wins over `href`: the current page gets no link at all.
  const isLink = !active && href != null;
  const accessibleName = warning ? `${label}, ${warning}` : label;
  const tooltip = isSlimMode ? accessibleName : undefined;

  const row = (
    <Row
      variant="sidebar"
      as="div"
      // The active row only presents. Everything else takes the hover tint,
      // and the unlinked row takes the focus ring too, because there it is
      // the element that receives focus.
      interactive={!active}
      selected={active}
      // The active branch renders no link, so the row itself has to announce
      // that it is the current page.
      current={active}
      className={sidebarNavigationRowClassName}
      // In the linked branch the <a> is what focus lands on, so it carries the
      // name and the slim-mode tooltip and the row would only repeat them.
      aria-label={isLink ? undefined : accessibleName}
      title={isLink ? undefined : tooltip}
      onClick={active || isLink ? undefined : () => onClick?.()}
      data-ui={dataUi}
    >
      {warning ? (
        // The dot sits on the icon so it stays visible in slim mode.
        <span className="relative flex shrink-0">
          {icon}
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-theme-warning-fg ring-2 ring-theme-bg-sidebar"
            data-testid="sidebar-navigation-warning"
          />
        </span>
      ) : (
        icon
      )}
      {labelNode}
    </Row>
  );

  return (
    <div className={clsx(sidebarInsetClassName, "py-1")}>
      {isLink ? (
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
          aria-label={accessibleName}
          title={tooltip}
        >
          {row}
        </a>
      ) : (
        row
      )}
    </div>
  );
};
