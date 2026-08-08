import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "../useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays trailing updates by `delayMs` (default behaviour)", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 400),
      { initialProps: { value: "a" } },
    );

    expect(result.current).toBe("a");

    rerender({ value: "b" });
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("b");
  });

  it("collapses rapid changes to a single trailing update", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 400),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "b" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ value: "c" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ value: "d" });

    // Only the latest value should land, after the timer settles from `d`.
    expect(result.current).toBe("a");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe("d");
  });

  it("forwards the first transition immediately when `leading` is set", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string | null }) =>
        useDebouncedValue(value, 400, { leading: true }),
      { initialProps: { value: null as string | null } },
    );

    // Cold-open simulation: hook starts with null (item loading), the real
    // anchor lands a moment later.
    expect(result.current).toBeNull();

    rerender({ value: "anchor-1" });

    // Without leading-edge, this would still be null until the timer fires.
    // With leading-edge on the first transition, it lands on the next tick.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe("anchor-1");
  });

  it("debounces subsequent transitions even with `leading` set", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string | null }) =>
        useDebouncedValue(value, 400, { leading: true }),
      { initialProps: { value: null as string | null } },
    );

    // Burn the leading shot on the first transition.
    rerender({ value: "anchor-1" });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe("anchor-1");

    // Subsequent change must debounce, not pass through.
    rerender({ value: "anchor-2" });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(result.current).toBe("anchor-1");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("anchor-2");
  });

  it("does not consume the leading shot on no-op renders", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string | null }) =>
        useDebouncedValue(value, 400, { leading: true }),
      { initialProps: { value: null as string | null } },
    );

    // Re-render without changing the value — must not consume leading.
    rerender({ value: null });
    rerender({ value: null });

    rerender({ value: "anchor-1" });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe("anchor-1");
  });
});
