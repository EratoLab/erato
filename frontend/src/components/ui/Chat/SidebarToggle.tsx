import clsx from "clsx";
import { forwardRef } from "react";

import { Button } from "../Controls/Button";
import { CountBadge } from "../Controls/CountBadge";
import { SidebarToggleIcon } from "../icons";

import type { AriaAttributes, MouseEvent, ReactNode } from "react";

/**
 * How the control is painted, NOT where it sits — placement stays with the
 * caller, because the two floating sites disagree about it (`z-20` in the
 * add-in pane, `z-30` on the host shell).
 *
 * - `floating` — over the conversation, outside `[data-ui="sidebar"]`; takes
 *   the opaque `.floating-control-skin` recipe plus its frame.
 * - `framed` — the same frame in normal flow (the add-in's header row).
 * - `flush` — inside a sidebar band, where the band already paints.
 *
 * Emitted as `data-surface`, and deliberately never as `data-variant`:
 * Button writes `data-variant={variant}` BEFORE it spreads the rest of its
 * props, so anything named `data-variant` here would overwrite
 * `sidebar-icon` — the exact attribute both shipped customer themes key
 * their sidebar-control rules on.
 */
export type SidebarToggleSurface = "floating" | "flush" | "framed";

export interface SidebarToggleProps {
  surface: SidebarToggleSurface;
  /** Announced as `aria-expanded`, and the reason the glyph flips. */
  expanded: boolean;
  /**
   * Whether `expanded` also turns the glyph. Default true, which is the
   * sidebar idiom: the chevron points the way the pane will move.
   *
   * The add-in's drawer trigger opts out. It reports `aria-expanded` because
   * that is the honest ARIA state, but it sits *behind* the open drawer, so a
   * flipped chevron there points at nothing and only shows through the scrim.
   * It did not rotate before this primitive existed, and adopting the toggle
   * is not a reason to change how it looks.
   */
  flipOnExpand?: boolean;
  /**
   * The accessible name, verbatim. e2e specs look this control up by name
   * with Playwright's case-insensitive SUBSTRING match, so a counted
   * label must keep the bare phrase as a literal PREFIX
   * ("expand sidebar, 3 chats need attention"), never as a suffix.
   */
  label: string;
  /** Above zero, an attention badge rides the control. Default 0. */
  attentionCount?: number;
  /** The badge's `data-testid` — the host and the add-in assert different ones. */
  badgeTestId?: string;
  /**
   * A custom face (the host's sidebar logo with its hover overlay). Supplied,
   * it REPLACES the default glyph: a second icon inside the button would give
   * the geometry probe a different node to measure.
   *
   * A face that also carries `attentionCount` owes the probe an explicit
   * anchor. `Button` only emits its `aria-hidden` icon span when it renders an
   * `icon`, and the badge is `aria-hidden` too, so with a face the badge would
   * be the first match for the probe's
   * `querySelector('[aria-hidden="true"]')` — and the rail centerline would be
   * measured against a 16px pill pinned to the corner. Mark the face's own
   * glyph `aria-hidden` so it wins that lookup, as `SidebarLogo` does.
   */
  children?: ReactNode;
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  "aria-haspopup"?: AriaAttributes["aria-haspopup"];
  "aria-controls"?: string;
  tabIndex?: number;
  "data-testid"?: string;
  /** Theme hook. Overrides the family default `sidebar-toggle`. */
  dataUi?: string;
}

// `border` rides along with the skin: the recipe only sets `border-color`,
// which is inert without a width, and every standalone trigger wants the
// frame. Duplicating a caller's `border` is harmless; losing the 1px frame is
// silent.
const SURFACE_CLASSES: Record<SidebarToggleSurface, string | false> = {
  floating: "floating-control-skin border",
  framed: "floating-control-skin border",
  flush: false,
};

// A badge is absolutely positioned, so it needs a positioned ancestor — but
// `relative` may not be added blindly: Tailwind emits `.relative` AFTER
// `.absolute`, so an unconditional one would outrank a caller that positions
// the control itself and drag the button back into flow.
const POSITIONED_BY_CALLER = /(?:^|\s)(?:absolute|fixed|sticky)(?:\s|$)/;

/**
 * The sidebar's open/close control, in every place it appears: the host
 * header (both states), the host's hidden-mode floating trigger, the add-in
 * pane trigger and the add-in drawer header.
 *
 * Two seams are load-bearing and easy to get wrong by hand:
 *
 * 1. The rotation belongs to the GLYPH, not the button. Rotating the button
 *    flips its badge upside down and moves it from the top-right corner to
 *    the bottom-left one.
 * 2. The badge reaches the DOM through `children`, i.e. AFTER Button's icon
 *    span. The e2e geometry probe measures the first `[aria-hidden="true"]`
 *    node inside the button, and CountBadge is aria-hidden too, so a badge
 *    rendered ahead of the icon silently becomes what the rail-centerline
 *    assertion measures.
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
        // Never on the button itself — see the rotation seam above. A no-op
        // when a face is supplied: there is no icon span to turn.
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
