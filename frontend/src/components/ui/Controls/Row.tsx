import clsx from "clsx";
import { forwardRef } from "react";

import { InteractiveContainer } from "../Container/InteractiveContainer";

import type React from "react";

/**
 * Roving-focus marker, and the selector the menus navigate by. Only the `menu`
 * variant carries it: menus are the one family that roves, and every reader
 * scopes the selector to a popover panel. Natively-disabled rows drop out of the
 * list; `disabledMode="aria"` rows stay in it, so a row that is unavailable but
 * wants to say why is still reachable by keyboard.
 *
 * `interactive={false}` rows carry no marker either: they render as plain `<div>`s with
 * no role and no tab stop, and `.focus()` on one is a no-op — a roving walk that
 * stepped onto one would leave `document.activeElement` where it was and target
 * the same element again on the next key, freezing the menu.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS selector, not user-facing
export const ROW_ITEM_SELECTOR = "[data-row-item]:not([disabled])";

/**
 * `menu` rows live inside a popover panel and read the dropdown item channel;
 * `sidebar` rows are the app's navigation and history rows; `list` rows are a
 * plain vertical list of choices inside a modal or a card well.
 *
 * `list` is deliberately not the home for a row that only *frames* a control it
 * does not own — a checkbox row whose click belongs to the checkbox, not to the
 * row. Those hover without being clickable, which is a different contract; they
 * wait on the `settings` variant.
 */
export type RowVariant = "menu" | "sidebar" | "list";

export type RowTag = "button" | "div" | "a" | "label";

/** Cross-axis alignment, `menu` only — `sidebar` and `list` set no axis. */
export type RowAlign = "center" | "start";

export type RowTone =
  | "neutral"
  | "muted"
  | "accent"
  | "info"
  | "success"
  | "warning"
  | "error";

/**
 * `native` puts the row's unavailability on the `disabled` attribute, which
 * takes it out of the tab order and out of `ROW_ITEM_SELECTOR`. `aria` keeps
 * the row reachable and only announces it — the caller still decides whether
 * to run the click handler.
 */
export type RowDisabledMode = "native" | "aria";

const TONE_TEXT: Record<RowTone, string> = {
  neutral: "text-theme-fg-secondary",
  muted: "text-theme-fg-muted",
  accent: "text-theme-fg-accent",
  info: "text-theme-info-fg",
  success: "text-theme-success-fg",
  warning: "text-theme-warning-fg",
  error: "text-theme-error-fg",
};

// Hover and keyboard-active surface per tone. The neutral recipe is the
// ERMAIN-467 shape verbatim: a soft highlight with a faint 1px inset border,
// keyed to :focus rather than :focus-visible so an arrowed-to row reads as
// "active" and not as the old heavy "pre-selected" ring.
const NEUTRAL_MENU_TONE_STATE =
  "hover:bg-theme-bg-hover hover:text-theme-fg-primary focus:bg-theme-bg-hover focus:text-theme-fg-primary focus:ring-theme-border-dropdown";

const MENU_TONE_STATE: Record<RowTone, string> = {
  neutral: NEUTRAL_MENU_TONE_STATE,
  muted: NEUTRAL_MENU_TONE_STATE,
  accent: NEUTRAL_MENU_TONE_STATE,
  info: "hover:bg-theme-info-bg focus:bg-theme-info-bg focus:ring-theme-info-border",
  success:
    "hover:bg-theme-success-bg focus:bg-theme-success-bg focus:ring-theme-success-border",
  warning:
    "hover:bg-theme-warning-bg focus:bg-theme-warning-bg focus:ring-theme-warning-border",
  error:
    "hover:bg-theme-error-bg focus:bg-theme-error-bg focus:ring-theme-error-border",
};

// The hook each family emits when the caller names none. `sidebar` emits
// nothing: its rows are addressed by per-instance hooks a theme already keys on
// by exact value (`chat-history-item`, `sidebar-search-item`), and the new-chat
// row deliberately carries none at all.
const FAMILY_DATA_UI: Record<RowVariant, string | undefined> = {
  menu: "menu-item",
  sidebar: undefined,
  list: "list-row",
};

type RowOwnProps = {
  variant: RowVariant;
  /**
   * Rendered element. Defaults to `button`, which is what every menu row is;
   * sidebar rows nest inside a link or a click-swallowing wrapper and pass
   * `as="div"` explicitly.
   */
  as?: RowTag;
  /**
   * Off for a row that only presents. The `menu` variant then drops its hover
   * tint, its focus recipe, `cursor-pointer` and `theme-transition`, so a
   * static info line inside a menu keeps the item geometry and nothing else.
   * It also drops the roving marker and the family-default `data-ui`, both of
   * which say "this is a row you can act on".
   */
  interactive?: boolean;
  align?: RowAlign;
  tone?: RowTone;
  disabled?: boolean;
  disabledMode?: RowDisabledMode;
  /** `aria-checked`; for `menuitemcheckbox` / `menuitemradio` rows only. */
  checked?: boolean;
  /** `data-selected`, emitted only when true — never `="false"`. */
  selected?: boolean;
  /** `aria-current="page"`, for a row that is the page being shown. */
  current?: boolean;
  expanded?: boolean;
  /** Icon or control before the body. Rendered as passed — size it yourself. */
  leading?: React.ReactNode;
  /** Second line under the body. Wraps `children` in a truncating two-line block. */
  description?: React.ReactNode;
  /** Single node pushed to the end of the row. */
  trailing?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * Layout only — padding, flow, width. There is no `tailwind-merge` here, so
   * a utility that collides with the variant's own classes does not replace
   * it; the corner radius in particular has to stay in the geometry class.
   */
  className?: string;
  /** Theme hook. Overrides the family default (see `FAMILY_DATA_UI`). */
  "data-ui"?: string;
};

export type RowProps = RowOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof RowOwnProps> & {
    href?: string;
    target?: string;
    rel?: string;
    htmlFor?: string;
  };

/**
 * One row, for the families that have one: the rows inside a popover menu, the
 * rows in the sidebar, and a plain list of choices in a modal or a card well.
 * It owns the geometry class, the state attributes and the family's hover and
 * focus recipe; the site keeps its own flow (`flex-col gap-1`,
 * `items-center gap-3`) because the families disagree about the cross axis and
 * Row sets none for `sidebar` or `list`.
 *
 * Row never writes an inline `style`: the sidebar rows are reachable from a
 * customer theme only because their height and radius come from a class.
 */
export const Row = forwardRef<HTMLElement, RowProps>(function Row(
  {
    variant,
    as = "button",
    interactive = true,
    align = "center",
    tone = "neutral",
    disabled = false,
    disabledMode = "native",
    checked,
    selected = false,
    current = false,
    expanded,
    leading,
    description,
    trailing,
    children,
    className,
    "data-ui": dataUi,
    ...rest
  },
  ref,
) {
  // The sidebar ring is drawn only where the row itself takes focus. In the
  // linked branches the surrounding <a> carries it, and a second ring on the
  // inner element would double up inside the same corner.
  const isFocusable =
    as === "button" || as === "a" || typeof rest.onClick === "function";

  // InteractiveContainer's props are a union keyed on `as`, and a variable
  // cannot narrow it. The tag itself is forwarded unchanged; only the props
  // branch is pinned, to the one that carries every attribute a row can take.
  const containerTag = as as "button";

  // A plain list has no roving focus, so `:focus-visible` is the right signal
  // here — unlike `menu`, where arrowing between rows makes `:focus` itself the
  // "active" state. Cross axis is left to the site, as with `sidebar`: these
  // rows stack their lines (`flex-col`) where a sidebar row lays them out in a
  // line, and Row has no business choosing.
  const listClassName = clsx(
    "list-row-geometry",
    "flex text-left",
    tone !== "neutral" && TONE_TEXT[tone],
    interactive && [
      "theme-transition cursor-pointer hover:bg-theme-bg-hover",
      isFocusable && "focus-ring-inset",
    ],
  );

  const variantClassName =
    variant === "list"
      ? listClassName
      : variant === "menu"
        ? clsx(
            "dropdown-item-geometry",
            "flex gap-2 text-left text-sm",
            align === "start" ? "items-start" : "items-center",
            TONE_TEXT[tone],
            interactive && [
              "theme-transition cursor-pointer",
              "focus:outline-none focus:ring-1 focus:ring-inset",
              MENU_TONE_STATE[tone],
              // An open submenu row stays lit while the flyout is up. Keyed off
              // the attribute rather than a caller's `isOpen && "…"` branch:
              // without tailwind-merge that conditional class races the resting
              // `text-theme-fg-secondary` on stylesheet position and loses, so an
              // open row never brightens. `aria-expanded:` compiles to
              // `.aria-expanded\:text-…[aria-expanded="true"]`, and (0,2,0) beats
              // (0,1,0) whatever the order.
              "aria-expanded:bg-theme-bg-hover aria-expanded:text-theme-fg-primary",
            ],
            disabledMode === "aria" &&
              "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
          )
        : clsx(
            "sidebar-row-geometry",
            "flex text-left",
            selected && "sidebar-row-selected",
            // Neutral is the absence of a tone here: every sidebar row inherits
            // its text colour from the shell.
            tone !== "neutral" && TONE_TEXT[tone],
            interactive && "theme-transition",
            interactive &&
              !selected &&
              "hover:bg-[var(--theme-shell-sidebar-hover)]",
            interactive && isFocusable && "focus-ring-inset",
          );

  const body =
    description == null ? (
      children
    ) : (
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        <span className="block truncate text-xs text-theme-fg-muted">
          {description}
        </span>
      </span>
    );

  return (
    <InteractiveContainer
      ref={ref as React.Ref<HTMLButtonElement>}
      as={containerTag}
      interactive={interactive}
      // The button reset's `p-0` is a utility and the geometry classes sit in
      // `@layer components`, so the reset would zero the row's padding.
      resetAppearance={false}
      // Row draws its own focus recipe, one per family; the shared outset ring
      // is the wrong shape for both.
      showFocusRing={false}
      className={clsx(variantClassName, className)}
      // Menus are the only family that roves, and every reader of the selector
      // scopes it to a popover panel. Sidebar and list rows carried the marker
      // as dead weight; a list row wearing it is worse than dead, because it
      // reads as "a menu could walk here".
      data-row-item={interactive && variant === "menu" ? "" : undefined}
      data-ui={dataUi ?? (interactive ? FAMILY_DATA_UI[variant] : undefined)}
      data-selected={selected || undefined}
      data-tone={tone === "neutral" ? undefined : tone}
      aria-checked={checked}
      aria-current={current ? "page" : undefined}
      aria-expanded={expanded}
      disabled={disabledMode === "native" ? disabled || undefined : undefined}
      aria-disabled={
        disabledMode === "aria" ? disabled || undefined : undefined
      }
      {...(rest as React.ButtonHTMLAttributes<HTMLElement>)}
    >
      {leading}
      {body}
      {trailing == null ? null : (
        // A flex box, not a bare inline span: preflight makes an `<svg>` mark
        // `display: block`, which inside an inline wrapper breaks the row onto
        // a second line, and an inline wrapper also imposes the row's `text-sm`
        // line box on a `text-xs` label and drops it a few pixels. `shrink-0`
        // sits here because the wrapper — not the caller's node — is the flex
        // item now, and `gap-2` keeps two marks apart the way the row's own
        // gap used to.
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {trailing}
        </span>
      )}
    </InteractiveContainer>
  );
});
