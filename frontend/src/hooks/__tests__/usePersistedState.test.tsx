import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { usePersistedState } from "../usePersistedState";

// Node 25 ships an experimental top-level `localStorage` that vitest enables
// via `--localstorage-file`, but without a valid path it surfaces an object
// whose methods aren't callable. Replace it with a deterministic in-memory
// implementation for this suite.
beforeAll(() => {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: stub,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: stub,
  });
});

interface Prefs {
  mode: "a" | "b";
  count: number;
}

const parsePrefs = (value: unknown): Prefs | null => {
  if (
    value !== null &&
    typeof value === "object" &&
    "mode" in value &&
    "count" in value &&
    (value.mode === "a" || value.mode === "b") &&
    typeof value.count === "number"
  ) {
    return { mode: value.mode, count: value.count };
  }
  return null;
};

afterEach(() => {
  localStorage.clear();
});

describe("usePersistedState", () => {
  it("returns the default when nothing is stored", () => {
    const { result } = renderHook(() =>
      usePersistedState<Prefs>("test.k1", { mode: "a", count: 0 }, {
        parse: parsePrefs,
      }),
    );
    expect(result.current[0]).toEqual({ mode: "a", count: 0 });
  });

  it("persists writes and rehydrates them", () => {
    const { result } = renderHook(() =>
      usePersistedState<Prefs>("test.k2", { mode: "a", count: 0 }, {
        parse: parsePrefs,
      }),
    );
    act(() => result.current[1]({ mode: "b", count: 3 }));
    expect(result.current[0]).toEqual({ mode: "b", count: 3 });

    const rehydrated = renderHook(() =>
      usePersistedState<Prefs>("test.k2", { mode: "a", count: 0 }, {
        parse: parsePrefs,
      }),
    );
    expect(rehydrated.result.current[0]).toEqual({ mode: "b", count: 3 });
  });

  it("supports updater functions", () => {
    const { result } = renderHook(() =>
      usePersistedState<Prefs>("test.k3", { mode: "a", count: 0 }, {
        parse: parsePrefs,
      }),
    );
    act(() => result.current[1]((previous) => ({ ...previous, count: previous.count + 1 })));
    act(() => result.current[1]((previous) => ({ ...previous, count: previous.count + 1 })));
    expect(result.current[0].count).toBe(2);
  });

  it("falls back to default when stored value fails parse", () => {
    localStorage.setItem(
      "test.k4",
      JSON.stringify({ mode: "x", count: "nope" }),
    );
    const { result } = renderHook(() =>
      usePersistedState<Prefs>("test.k4", { mode: "a", count: 0 }, {
        parse: parsePrefs,
      }),
    );
    expect(result.current[0]).toEqual({ mode: "a", count: 0 });
  });

  it("clears storage when set to null", () => {
    const { result } = renderHook(() =>
      usePersistedState<Prefs>("test.k7", { mode: "a", count: 0 }, {
        parse: parsePrefs,
      }),
    );
    act(() => result.current[1]({ mode: "b", count: 9 }));
    expect(localStorage.getItem("test.k7")).not.toBeNull();
    act(() => result.current[1](null));
    expect(localStorage.getItem("test.k7")).toBeNull();
    expect(result.current[0]).toEqual({ mode: "a", count: 0 });
  });

  it("syncs multiple consumers of the same key", () => {
    const a = renderHook(() =>
      usePersistedState<Prefs>("test.k8", { mode: "a", count: 0 }, {
        parse: parsePrefs,
      }),
    );
    const b = renderHook(() =>
      usePersistedState<Prefs>("test.k8", { mode: "a", count: 0 }, {
        parse: parsePrefs,
      }),
    );
    act(() => a.result.current[1]({ mode: "b", count: 5 }));
    expect(b.result.current[0]).toEqual({ mode: "b", count: 5 });
  });
});
