import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCHEDULING_THREAD_MAX_AGE_MS } from "../../utils/outlookScheduleTool";
import { useSchedulingThreadActive } from "../useSchedulingThreadActive";

const CREATED = "2026-07-03T12:00:00.000Z";
const createdMs = Date.parse(CREATED);

describe("useSchedulingThreadActive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(createdMs + 60_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays fresh at the boundary and ends 1 ms later without other input", () => {
    const { result, rerender } = renderHook(() =>
      useSchedulingThreadActive(CREATED),
    );
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(SCHEDULING_THREAD_MAX_AGE_MS - 60_000);
    });
    expect(Date.now()).toBe(createdMs + SCHEDULING_THREAD_MAX_AGE_MS);
    rerender();
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is off with no signal and sets no timer", () => {
    const { result } = renderHook(() => useSchedulingThreadActive(null));
    expect(result.current).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats an unparseable signal as fresh, like the send, with no timer", () => {
    const { result } = renderHook(() =>
      useSchedulingThreadActive("not a date"),
    );
    expect(result.current).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sets no timer for a signal that is already stale", () => {
    vi.setSystemTime(createdMs + SCHEDULING_THREAD_MAX_AGE_MS + 5);
    const { result } = renderHook(() => useSchedulingThreadActive(CREATED));
    expect(result.current).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
