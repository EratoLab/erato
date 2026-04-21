import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEmailDedupSet } from "../useEmailDedupSet";

describe("useEmailDedupSet", () => {
  it("tryAdd returns true on first call and false on duplicate", () => {
    const { result } = renderHook(() => useEmailDedupSet());

    let first = false;
    let second = false;
    act(() => {
      first = result.current.tryAdd("msg1@example.com");
      second = result.current.tryAdd("msg1@example.com");
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(result.current.has("msg1@example.com")).toBe(true);
    expect(result.current.ids.has("msg1@example.com")).toBe(true);
  });

  // Reproduces the cross-await race that motivated this hook: two async
  // handlers each crossed an `await`, then both call into the dedup. With a
  // `useState<Set>` the second call would see stale state and also pass.
  // Here, the captured callback writes to the ref synchronously, so the
  // second call sees the first call's mutation regardless of render cycle.
  it("survives the stale-closure race across awaits", async () => {
    const { result } = renderHook(() => useEmailDedupSet());
    const tryAddBeforeAwait = result.current.tryAdd;

    let addedA = false;
    let addedB = false;
    await act(async () => {
      await Promise.resolve();
      addedA = tryAddBeforeAwait("shared-id");
      await Promise.resolve();
      addedB = tryAddBeforeAwait("shared-id");
    });

    expect(addedA).toBe(true);
    expect(addedB).toBe(false);
  });

  it("remove rolls back tryAdd so the same id can be re-added", () => {
    const { result } = renderHook(() => useEmailDedupSet());

    act(() => {
      result.current.tryAdd("msg1");
    });
    expect(result.current.ids.has("msg1")).toBe(true);

    act(() => {
      result.current.remove("msg1");
    });
    expect(result.current.ids.has("msg1")).toBe(false);
    expect(result.current.has("msg1")).toBe(false);

    let readded = false;
    act(() => {
      readded = result.current.tryAdd("msg1");
    });
    expect(readded).toBe(true);
  });

  it("remove on an absent id is a no-op", () => {
    const { result } = renderHook(() => useEmailDedupSet());
    const initialIds = result.current.ids;

    act(() => {
      result.current.remove("never-added");
    });

    expect(result.current.ids).toBe(initialIds);
  });

  it("ids state mirrors the ref after multiple adds", () => {
    const { result } = renderHook(() => useEmailDedupSet());

    act(() => {
      result.current.tryAdd("a");
      result.current.tryAdd("b");
      result.current.tryAdd("c");
    });

    expect(Array.from(result.current.ids).sort()).toEqual(["a", "b", "c"]);
  });
});
