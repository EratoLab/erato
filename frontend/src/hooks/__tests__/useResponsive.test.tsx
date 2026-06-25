import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIsMobile, useResponsive } from "../useResponsive";

/**
 * Install a matchMedia stub that reports the given mobile state and records the
 * listeners so we can assert subscription/teardown.
 */
function stubMatchMedia(isMobile: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: isMobile,
    media: "",
    onchange: null,
    addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) =>
      listeners.delete(cb),
    addListener: (cb: () => void) => listeners.add(cb),
    removeListener: (cb: () => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as typeof window.matchMedia;
  return { listeners };
}

/** Renders a hook and records the committed value on every render. */
function recordRenders<T>(useHook: () => T) {
  const values: T[] = [];
  function Probe() {
    values.push(useHook());
    return null;
  }
  return { values, Probe };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useIsMobile", () => {
  it("reports the real viewport on the FIRST committed render (no desktop flash)", () => {
    stubMatchMedia(true);
    const { values, Probe } = recordRenders(useIsMobile);

    render(<Probe />);

    // The first commit must already be mobile — the pre-useSyncExternalStore
    // implementation seeded desktop and corrected after mount, which is the
    // flash this guards against.
    expect(values[0]).toBe(true);
    expect(values).toEqual([true]);
  });

  it("reports false when above the mobile breakpoint", () => {
    stubMatchMedia(false);
    const { values, Probe } = recordRenders(useIsMobile);

    render(<Probe />);

    expect(values[0]).toBe(false);
  });
});

describe("useResponsive", () => {
  it("derives isMobile from the real innerWidth on the first render", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(375);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const { values, Probe } = recordRenders(useResponsive);

    render(<Probe />);

    expect(values[0]?.isMobile).toBe(true);
    expect(values[0]?.isDesktop).toBe(false);
    expect(values[0]?.width).toBe(375);
  });
});
