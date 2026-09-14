import clsx from "clsx";
import { forwardRef } from "react";

import { Button } from "../Controls/Button";
import { CountBadge } from "../Controls/CountBadge";
import { SidebarToggleIcon } from "../icons";

import type { AriaAttributes, MouseEvent, ReactNode } from "react";

/**
 * How the control is painted, not where it sits: placement stays with the
 * caller, because the two floating sites disagree about z-index.
 *
 * Emitted as `data-surface`, never `data-variant` — Button writes
 * `data-variant` before it spreads props, so a `data-variant` here would
 * overwrite the `sidebar-icon` that both customer themes key their rules on.
 */
export type SidebarToggleSurface = "floating" | "flush" | "framed";

export interface SidebarToggleProps {
  surface: SidebarToggleSurface;
  expanded: boolean;
  /** Whether `expanded` also turns the glyph. The add-in's drawer trigger
   * opts out: it sits behind the open drawer, and it never rotated. */
  flipOnExpand?: boolean;
  /** e2e looks this control up by name with a substring match, so a counted
   * label keeps the bare phrase as a prefix: "expand sidebar, 3 chats …". */
  label: string;
  attentionCount?: number;
  /** The host and the add-in assert different ids on the badge. */
  badgeTestId?: string;
  /** A custom face (the host's sidebar logo), rendered instead of the default
   * glyph. A face carrying a badge must mark its own glyph `aria-hidden` — see
   * the badge note below. */
  children?: ReactNode;
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  "aria-haspopup"?: AriaAttributes["aria-haspopup"];
  "aria-controls"?: string;
  tabIndex?: number;
  "data-testid"?: string;
  dataUi?: string;
}

// The skin sets `border-color` only, which is inert without a width.
const SURFACE_CLASSES: Record<SidebarToggleSurface, string | false> = {
  floating: "floating-control-skin border",
  framed: "floating-control-skin border",
  flush: false,
};

// Tailwind emits `.relative` after `.absolute`, so adding it unconditionally
// would outrank a caller that positions the control itself.
const POSITIONED_BY_CALLER = /(?:^|\s)(?:absolute|fixed|sticky)(?:\s|$)/;

/**
 * The sidebar's open/close control, everywhere it appears: the host header in
 * both states, the host's hidden-mode floating trigger, the add-in pane
 * trigger and the add-in drawer header.
 *
 * Two seams are load-bearing. The flip rides the glyph, not the button —
 * rotating the button would turn its badge upside down and move it corner to
 * corner. And the badge reaches the DOM through `children`, after Button's
 * icon span: the e2e geometry probe measures the first `[aria-hidden="true"]`
 * node in the button, and CountBadge is aria-hidden too.
 */
export const SidebarToggle = forwardRef<HTMLButtonElement, SidebarToggleProps>(
  function SidebarToggle(
    {
      surface,
      expanded,
      flipOnExpand = true,
      label,
      attentionCount = 0,
      badgeTestId,
      children,
      className,
      onClick,
      "aria-haspopup": ariaHasPopup,
      "aria-controls": ariaControls,
      tabIndex,
      "data-testid": dataTestId,
      dataUi,
    },
    ref,
  ) {
    const hasBadge = attentionCount > 0;
    const hasFace = Boolean(children);

    return (
      <Button
        ref={ref}
        variant="sidebar-icon"
        onClick={onClick}
        icon={hasFace ? undefined : <SidebarToggleIcon />}
        iconClassName={expanded && flipOnExpand ? "rotate-180" : undefined}
        aria-label={label}
        aria-expanded={expanded}
        aria-haspopup={ariaHasPopup}
        aria-controls={ariaControls}
        tabIndex={tabIndex}
        data-ui={dataUi ?? "sidebar-toggle"}
        data-surface={surface}
        data-testid={dataTestId}
        className={clsx(
          SURFACE_CLASSES[surface],
          hasBadge && !POSITIONED_BY_CALLER.test(className ?? "") && "relative",
          className,
        )}
      >
        {children}
        {hasBadge && (
          <CountBadge
            variant="attention"
            data-testid={badgeTestId}
            className="absolute -right-0.5 -top-0.5"
          >
            {attentionCount}
          </CountBadge>
        )}
      </Button>
    );
  },
);
