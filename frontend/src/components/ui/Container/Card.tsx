import clsx from "clsx";
import { forwardRef } from "react";

import { Collapse } from "../Controls/Collapse";

import type React from "react";

/**
 * `surface` frames content and answers nothing. `interactive` is the frame that
 * is itself the click target. `selectable` frames a native radio or checkbox and
 * reports the choice on the frame, because the input inside is the widget.
 * `expandable` owns a body that opens and closes; the disclosure control sits in
 * the header and stays the caller's.
 */
export type CardVariant =
  | "surface"
  | "interactive"
  | "selectable"
  | "expandable";

/**
 * Rendered element, always named by the caller. A card is a `<section>` on a
 * settings page, an `<article>` in a list, an `<a>` in search results and a
 * `<label>` around a radio; welding one of those to a variant is what kept the
 * two card components already in the tree from being used anywhere else.
 */
export type CardTag =
  | "div"
  | "section"
  | "article"
  | "a"
  | "button"
  | "label"
  | "p"
  | "ul"
  | "pre";

/**
 * Which native control carries the selection. `radio` and `checkbox` say one
 * lives inside the frame: the frame then draws the focus ring for it — the
 * input is either visually hidden or a 16px dot, so focus has to show on the
 * shape the user sees — states the choice with `data-selected`, and takes no
 * ARIA of its own. `none` says there is no native control, so the frame is the
 * toggle and announces itself with `aria-pressed`; pass `as="button"` with it.
 */
export type CardControl = "radio" | "checkbox" | "none";

export type CardTone =
  | "neutral"
  | "muted"
  | "accent"
  | "info"
  | "success"
  | "warning"
  | "error";

/** Body inset, and the step the corner of a card nested inside derives from. */
export type CardSize = "none" | "xs" | "sm" | "md" | "lg" | "xl";

const INSET_CLASS: Record<CardSize, string> = {
  none: "card-inset-none",
  xs: "card-inset-xs",
  sm: "card-inset-sm",
  md: "card-inset-md",
  lg: "card-inset-lg",
  xl: "card-inset-xl",
};

// The ring the frame draws on behalf of the native input inside it.
const CONTROL_FOCUS_RING =
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind has-selector for keyboard focus
  "[&:has(input:focus-visible)]:ring-2 [&:has(input:focus-visible)]:ring-theme-focus";

type CardOwnProps = {
  variant: CardVariant;
  /** Rendered element. Defaults to `div`; see `CardTag`. */
  as?: CardTag;
  control?: CardControl;
  tone?: CardTone;
  /**
   * The 1px hairline. Off for a card that separates itself from the page by
   * fill alone.
   */
  bordered?: boolean;
  /**
   * Body inset. Omitted on a `nested` card so the enclosing card's published
   * step applies; anywhere off this scale, set `--card-inset` at the site.
   */
  size?: CardSize;
  /** Derive corner and inset from the card this one sits inside. */
  nested?: boolean;
  /** `data-selected`, emitted only when true — never `="false"`. */
  selected?: boolean;
  /** `data-expanded` on the frame. The disclosure control has `aria-expanded`. */
  expanded?: boolean;
  disabled?: boolean;
  /** Pin the header band to the top of the nearest scroll region. */
  stickyHeader?: boolean;
  /**
   * Drop the body from the DOM while the card is closed. `Collapse` animates
   * the height and clips the overflow but sets neither `inert` nor
   * `visibility: hidden`, so a closed body keeps its tab stops and its place in
   * the accessibility tree, and any media inside it still loads. Off by
   * default: unmounting also discards whatever state the body held and snaps
   * the closing animation shut, so it is the caller's call.
   */
  unmountOnCollapse?: boolean;
  /** Band above the body. Carries the disclosure control on an expandable card. */
  header?: React.ReactNode;
  /** Trailing node in the header band, outside the caller's own header control. */
  action?: React.ReactNode;
  /** Full-bleed band above the header — a thumbnail, a preview strip. */
  media?: React.ReactNode;
  /** Band below the body. */
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * Layout only — flow, width, margins. There is no `tailwind-merge` here, so a
   * utility that collides with the frame's own classes does not replace it; the
   * corner in particular has to stay in the geometry class.
   */
  className?: string;
  /** Layout on the body wrapper, for the flow the card's content needs. */
  bodyClassName?: string;
  /** `id` of the body, for the `aria-controls` of a disclosure in the header. */
  bodyId?: string;
  /** Theme hook. Overrides the family default `card`. */
  "data-ui"?: string;
};

export type CardProps = CardOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof CardOwnProps> & {
    href?: string;
    target?: string;
    rel?: string;
    htmlFor?: string;
  };

/**
 * One framed surface: the settings panels, the hub cards, the search results,
 * the option cards, the attachment frames. It owns the corner, the skin and the
 * state attributes a customer theme keys on, and it publishes the step a card
 * nested inside it derives its own corner from, so a nest stays concentric at
 * any theme radius.
 *
 * The bands are named slots rather than free children because the corner policy
 * depends on their order: `.card-section` rounds the first and last band to the
 * frame, which is what lets the frame skip `overflow: hidden` — clipping there
 * would crop the offset focus ring of any control inside a band.
 *
 * Card renders the tag it is given and spreads everything it does not consume,
 * so a `data-testid`, a dropzone's `getRootProps()` or a caller's own `role`
 * reaches the element intact.
 */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    variant,
    as = "div",
    control,
    tone = "neutral",
    bordered = true,
    size,
    nested = false,
    selected = false,
    expanded = false,
    disabled = false,
    stickyHeader = false,
    unmountOnCollapse = false,
    header,
    action,
    media,
    footer,
    children,
    className,
    bodyClassName,
    bodyId,
    "data-ui": dataUi,
    ...rest
  },
  ref,
) {
  // A tag union cannot narrow the intrinsic element's props from a variable, so
  // the tag is forwarded unchanged and only the props branch is pinned, to the
  // one that carries every attribute a card can take.
  const Tag = as as "button";
  const domProps: React.HTMLAttributes<HTMLElement> = rest;
  const nativeButton = as === "button";

  // The offset ring, not the inset one: a card's own corner is the outer edge
  // here, and the bands inside it already keep clear of the ring by never
  // clipping.
  const drawsFocusRing =
    nativeButton || as === "a" || typeof rest.onClick === "function";

  // A nested card with no size of its own reads the step its parent published;
  // naming a size opts back out of the derivation, because the inset classes
  // are declared after `.card-nested` at the same specificity.
  const insetClass = size
    ? INSET_CLASS[size]
    : nested
      ? undefined
      : INSET_CLASS.md;

  const frameClassName = clsx(
    "card-geometry card-skin",
    bordered && "border",
    nested && "card-nested",
    insetClass,
    variant !== "surface" && "theme-transition",
    variant === "interactive" && !disabled && "cursor-pointer",
    drawsFocusRing && "focus-ring",
    (control === "radio" || control === "checkbox") && CONTROL_FOCUS_RING,
    disabled && "opacity-60",
    className,
  );

  const bodyElement =
    children == null ? null : (
      <div
        id={bodyId}
        data-ui="card-body"
        className={clsx(
          "card-body-geometry",
          // The corner policy needs the band to be a direct child of the
          // frame, and an expandable card puts Collapse's own wrapper in
          // between: the position selectors would resolve against that wrapper
          // and round a body sitting under a header.
          variant !== "expandable" && "card-section",
          bodyClassName,
        )}
      >
        {children}
      </div>
    );

  // The guard goes inside Collapse, never around it: Collapse is what animates
  // the height, so a card that unmounted it would open and close with no
  // transition at all.
  const body =
    variant === "expandable" ? (
      <Collapse isOpen={expanded}>
        {(expanded || !unmountOnCollapse) && bodyElement}
      </Collapse>
    ) : (
      bodyElement
    );

  return (
    <Tag
      ref={ref as React.Ref<HTMLButtonElement>}
      className={frameClassName}
      type={nativeButton ? "button" : undefined}
      disabled={nativeButton ? disabled || undefined : undefined}
      data-ui={dataUi ?? "card"}
      data-variant={variant}
      data-tone={tone === "neutral" ? undefined : tone}
      data-selected={selected || undefined}
      data-expanded={expanded || undefined}
      // A native button says it on the `disabled` attribute; every other tag
      // has nowhere else to put it.
      data-disabled={(!nativeButton && disabled) || undefined}
      aria-pressed={control === "none" ? selected : undefined}
      {...domProps}
    >
      {media == null ? null : (
        <div data-ui="card-media" className="card-section">
          {media}
        </div>
      )}
      {header == null && action == null ? null : (
        <div
          data-ui="card-header"
          className={clsx(
            "card-section",
            action != null && "flex items-center gap-2",
            stickyHeader && "sticky top-0 z-10",
          )}
        >
          {header}
          {action == null ? null : (
            <span className="ml-auto shrink-0">{action}</span>
          )}
        </div>
      )}
      {body}
      {footer == null ? null : (
        <div data-ui="card-footer" className="card-section">
          {footer}
        </div>
      )}
    </Tag>
  );
});
