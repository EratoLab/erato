import { VIEWPORT_PADDING_FALLBACK_PX, resolvePopoverLengths } from "./PopoverPanel";

/** Edges in viewport px, each already moved in by the padding. */
export interface PopoverViewport {
  padding: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** The layout viewport's height, for panels anchored by `bottom`. */
  layoutHeight: number;
  /** The `extra` lengths, resolved in the same layout pass. */
  extra: number[];
}

/**
 * The part of the window a popover may use. Where the page runs under the
 * status bar, the home bar or a landscape notch, a panel kept only off the
 * window edge ends up behind them; an on-screen keyboard covers the bottom of
 * the window without making it shorter, and only the visual viewport ends
 * where the keyboard begins.
 */
export function resolvePopoverViewport(
  paddingValue: string,
  referenceElement: HTMLElement | null | undefined,
  extra: ReadonlyArray<{ value: string; fallback: number }> = [],
): PopoverViewport {
  const [padding, safeTop, safeRight, safeBottom, safeLeft, ...resolved] =
    resolvePopoverLengths(
      [
        { value: paddingValue, fallback: VIEWPORT_PADDING_FALLBACK_PX },
        { value: "var(--safe-area-top)", fallback: 0 },
        { value: "var(--safe-area-right)", fallback: 0 },
        { value: "var(--safe-area-bottom)", fallback: 0 },
        { value: "var(--safe-area-left)", fallback: 0 },
        ...extra,
      ],
      referenceElement,
    );
  const layoutHeight = window.innerHeight;
  const visualViewport = window.visualViewport;
  const visibleBottom = visualViewport
    ? Math.min(layoutHeight, visualViewport.offsetTop + visualViewport.height)
    : layoutHeight;
  return {
    padding,
    top: safeTop + padding,
    right: window.innerWidth - safeRight - padding,
    bottom: visibleBottom - safeBottom - padding,
    left: safeLeft + padding,
    layoutHeight,
    extra: resolved,
  };
}

/**
 * Calls `onChange` on what moves a popover's usable area: a resize, a scroll
 * and the on-screen keyboard coming or going.
 */
export function observePopoverViewport(onChange: () => void): () => void {
  const visualViewport = window.visualViewport;
  window.addEventListener("resize", onChange);
  window.addEventListener("scroll", onChange, true);
  visualViewport?.addEventListener("resize", onChange);
  visualViewport?.addEventListener("scroll", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("scroll", onChange, true);
    visualViewport?.removeEventListener("resize", onChange);
    visualViewport?.removeEventListener("scroll", onChange);
  };
}
