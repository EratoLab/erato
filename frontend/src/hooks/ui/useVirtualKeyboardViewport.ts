import { useEffect } from "react";

/** A keyboard covers more than this; a scrollbar or a rounding error less. */
const MIN_KEYBOARD_HEIGHT = 100;

export interface VisibleBox {
  top: number;
  height: number;
}

/**
 * The part of the page an on-screen keyboard leaves visible, or null when
 * none is open. A zoomed page also has a small visual viewport, so only an
 * unzoomed one counts.
 */
export function visibleBoxAboveKeyboard(
  layoutHeight: number,
  viewport: Pick<VisualViewport, "height" | "offsetTop" | "scale">,
): VisibleBox | null {
  if (Math.abs(viewport.scale - 1) > 0.01) {
    return null;
  }
  if (layoutHeight - viewport.height < MIN_KEYBOARD_HEIGHT) {
    return null;
  }
  return { top: viewport.offsetTop, height: viewport.height };
}

/**
 * Keeps the app inside what an on-screen keyboard leaves visible.
 *
 * A phone browser does not resize the page for its keyboard. It slides the
 * page up, which pushes the top of the app off screen and can leave the
 * composer behind the keyboard. While a keyboard is open, <html> carries
 * `data-virtual-keyboard="open"` and the visible box in
 * `--visual-viewport-top` and `--visual-viewport-height`; `.app-viewport`
 * takes that box.
 */
export function useVirtualKeyboardViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }
    const root = document.documentElement;

    const clear = () => {
      delete root.dataset.virtualKeyboard;
      root.style.removeProperty("--visual-viewport-top");
      root.style.removeProperty("--visual-viewport-height");
    };
    const update = () => {
      const box = visibleBoxAboveKeyboard(root.clientHeight, viewport);
      if (!box) {
        clear();
        return;
      }
      root.dataset.virtualKeyboard = "open";
      root.style.setProperty("--visual-viewport-top", `${box.top}px`);
      root.style.setProperty("--visual-viewport-height", `${box.height}px`);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      clear();
    };
  }, []);
}
