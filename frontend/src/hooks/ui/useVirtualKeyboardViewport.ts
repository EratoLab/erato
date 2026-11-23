import { useEffect } from "react";

/** A keyboard covers more than this; a scrollbar or a rounding error less. */
const MIN_KEYBOARD_HEIGHT = 100;

export interface VisibleBox {
  /** From the top of the layout viewport: where a fixed layer starts. */
  offsetTop: number;
  /** From the top of the page: where a box in the page's flow starts. */
  pageTop: number;
  height: number;
}

/**
 * The part of the page an on-screen keyboard leaves visible, or null when
 * none is open. A zoomed page also has a small visual viewport, so only an
 * unzoomed one counts.
 */
export function visibleBoxAboveKeyboard(
  layoutHeight: number,
  viewport: Pick<VisualViewport, "height" | "offsetTop" | "pageTop" | "scale">,
): VisibleBox | null {
  if (Math.abs(viewport.scale - 1) > 0.01) {
    return null;
  }
  if (layoutHeight - viewport.height < MIN_KEYBOARD_HEIGHT) {
    return null;
  }
  return {
    offsetTop: viewport.offsetTop,
    pageTop: viewport.pageTop,
    height: viewport.height,
  };
}

/**
 * Reports the box an on-screen keyboard leaves visible to the stylesheet
 * (`data-virtual-keyboard` in globals.css).
 *
 * A phone browser does not resize the page for its keyboard. It slides the
 * page up, which pushes the top of the app off screen and can leave the
 * composer behind the keyboard.
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
      root.style.removeProperty("--visual-viewport-offset-top");
      root.style.removeProperty("--visual-viewport-page-top");
      root.style.removeProperty("--visual-viewport-height");
    };
    const update = () => {
      const box = visibleBoxAboveKeyboard(root.clientHeight, viewport);
      if (!box) {
        clear();
        return;
      }
      root.dataset.virtualKeyboard = "open";
      root.style.setProperty(
        "--visual-viewport-offset-top",
        `${box.offsetTop}px`,
      );
      root.style.setProperty("--visual-viewport-page-top", `${box.pageTop}px`);
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
