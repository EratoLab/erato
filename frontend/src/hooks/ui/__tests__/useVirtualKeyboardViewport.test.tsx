import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useVirtualKeyboardViewport,
  visibleBoxAboveKeyboard,
} from "../useVirtualKeyboardViewport";

describe("visibleBoxAboveKeyboard", () => {
  it("is null while nothing covers the page", () => {
    expect(
      visibleBoxAboveKeyboard(852, { height: 852, offsetTop: 0, scale: 1 }),
    ).toBeNull();
  });

  it("is the visual viewport while a keyboard covers the page", () => {
    expect(
      visibleBoxAboveKeyboard(852, { height: 456, offsetTop: 150, scale: 1 }),
    ).toEqual({ top: 150, height: 456 });
  });

  it("ignores a zoomed page, whose visual viewport is small too", () => {
    expect(
      visibleBoxAboveKeyboard(852, { height: 426, offsetTop: 100, scale: 2 }),
    ).toBeNull();
  });
});

describe("useVirtualKeyboardViewport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks <html> while the keyboard is open and clears it afterwards", () => {
    const viewport = Object.assign(new EventTarget(), {
      height: 852,
      offsetTop: 0,
      scale: 1,
    });
    vi.stubGlobal("visualViewport", viewport);
    const root = document.documentElement;
    vi.spyOn(root, "clientHeight", "get").mockReturnValue(852);

    const { unmount } = renderHook(() => useVirtualKeyboardViewport());
    expect(root.dataset.virtualKeyboard).toBeUndefined();

    viewport.height = 456;
    viewport.offsetTop = 68;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.dataset.virtualKeyboard).toBe("open");
    expect(root.style.getPropertyValue("--visual-viewport-height")).toBe(
      "456px",
    );
    expect(root.style.getPropertyValue("--visual-viewport-top")).toBe("68px");

    viewport.height = 852;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.dataset.virtualKeyboard).toBeUndefined();
    expect(root.style.getPropertyValue("--visual-viewport-height")).toBe("");

    unmount();
  });
});
