import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerContextDetail } from "../ComposerContextDetail";

import type { ComposerContextItem } from "../types";

const item: ComposerContextItem = {
  id: "doc",
  kind: "word.document",
  origin: "ambient",
  dismissScope: "chat",
  state: "included",
  label: "Supply agreement",
  icon: "document",
  detail: {
    title: "Document details",
    render: () => <p>Covers the whole document.</p>,
  },
};

describe("ComposerContextDetail as a popover", () => {
  // A probe that resolves a length reports that length as its width; the
  // anchor reports `chip`.
  let lengths: Record<string, number> = {};
  let chip = DOMRect.fromRect();

  const renderAt = (rect: DOMRect, safe: Record<string, number>) => {
    chip = rect;
    lengths = {
      "var(--theme-layout-dropdown-viewport-margin)": 8,
      "var(--theme-layout-composer-context-detail-width)": 384,
      "var(--safe-area-top)": 0,
      "var(--safe-area-right)": 0,
      "var(--safe-area-bottom)": 0,
      "var(--safe-area-left)": 0,
      ...safe,
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.style.width
          ? DOMRect.fromRect({ width: lengths[this.style.width] ?? 0 })
          : chip;
      },
    );
    const anchor = document.createElement("div");
    document.body.append(anchor);
    render(
      <ComposerContextDetail
        item={item}
        anchor={anchor}
        trigger={null}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    return screen.getByRole("dialog", { name: "Document details" });
  };

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    Reflect.deleteProperty(window, "visualViewport");
    vi.restoreAllMocks();
  });

  it("stops below the status bar when it opens above the chip", () => {
    const detail = renderAt(
      DOMRect.fromRect({ x: 100, y: 400, width: 120, height: 28 }),
      { "var(--safe-area-top)": 59 },
    );

    // 400 - 8 above the chip, down to 59 + 8.
    expect(detail.style.bottom).toBe(`${window.innerHeight - 400 + 8}px`);
    expect(detail.style.maxHeight).toBe(`${400 - 8 - 67}px`);
  });

  it("stops above the on-screen keyboard and the home bar when it opens below", () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        offsetTop: 0,
        height: 500,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    const detail = renderAt(
      DOMRect.fromRect({ x: 100, y: 120, width: 120, height: 28 }),
      { "var(--safe-area-top)": 59, "var(--safe-area-bottom)": 34 },
    );

    // Below the chip at 148 + 8, down to the keyboard at 500 less 34 + 8.
    expect(detail.style.top).toBe("156px");
    expect(detail.style.maxHeight).toBe(`${500 - 42 - 156}px`);
  });

  it("stops below the status bar where the page has slid up under the keyboard", () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        offsetTop: 200,
        height: 400,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    const detail = renderAt(
      DOMRect.fromRect({ x: 100, y: 500, width: 120, height: 28 }),
      { "var(--safe-area-top)": 59 },
    );

    // The visible part starts 200 down the page; then the status bar.
    expect(detail.style.maxHeight).toBe(`${500 - 8 - (200 + 59 + 8)}px`);
  });

  it("keeps clear of a notch at the side", () => {
    const detail = renderAt(
      DOMRect.fromRect({ x: 10, y: 400, width: 120, height: 28 }),
      { "var(--safe-area-left)": 47, "var(--safe-area-right)": 47 },
    );

    expect(detail.style.left).toBe("55px");
    expect(detail.style.width).toBe(
      `${Math.min(384, window.innerWidth - 2 * 55)}px`,
    );
  });
});
