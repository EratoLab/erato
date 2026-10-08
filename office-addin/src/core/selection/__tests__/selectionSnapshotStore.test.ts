import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSelectionSnapshotStore } from "../selectionSnapshotStore";

interface Snapshot {
  text: string;
}

const EMPTY: Snapshot = { text: "" };

function createStore() {
  return createSelectionSnapshotStore<Snapshot>({
    empty: EMPTY,
    equals: (a, b) => a.text === b.text,
  });
}

afterEach(cleanup);

function renderSnapshot(store: ReturnType<typeof createStore>) {
  let renders = 0;
  const hook = renderHook(() => {
    renders += 1;
    return store.useSnapshot();
  });
  return { ...hook, renders: () => renders };
}

describe("createSelectionSnapshotStore", () => {
  it("starts empty and re-renders readers on a changed publish", () => {
    const store = createStore();
    const { result } = renderSnapshot(store);
    expect(result.current).toBe(EMPTY);

    const first = { text: "alpha" };
    act(() => store.publish(first));

    expect(result.current).toBe(first);
    expect(store.getSnapshot()).toBe(first);
  });

  it("keeps the current snapshot and does not re-render on an equal publish", () => {
    const store = createStore();
    const first = { text: "alpha" };
    store.publish(first);
    const { result, renders } = renderSnapshot(store);
    const rendersBefore = renders();

    act(() => store.publish({ text: "alpha" }));

    expect(store.getSnapshot()).toBe(first);
    expect(result.current).toBe(first);
    expect(renders()).toBe(rendersBefore);
  });

  it("fans a publish out to every reader", () => {
    const store = createStore();
    const a = renderSnapshot(store);
    const b = renderSnapshot(store);

    act(() => store.publish({ text: "beta" }));

    expect(a.result.current.text).toBe("beta");
    expect(b.result.current.text).toBe("beta");
  });

  it("passes the rearm flag to every refresh listener", () => {
    const store = createStore();
    const first = vi.fn();
    const second = vi.fn();
    store.subscribeRefresh(first);
    store.subscribeRefresh(second);

    store.requestRefresh();
    store.requestRefresh({ rearm: true });

    for (const listener of [first, second]) {
      expect(listener.mock.calls).toEqual([
        [{ rearm: false }],
        [{ rearm: true }],
      ]);
    }
  });

  it("stops calling a refresh listener after it unsubscribes", () => {
    const store = createStore();
    const kept = vi.fn();
    const removed = vi.fn();
    store.subscribeRefresh(kept);
    const unsubscribe = store.subscribeRefresh(removed);

    unsubscribe();
    store.requestRefresh();

    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("resets the snapshot and drops refresh listeners", () => {
    const store = createStore();
    const listener = vi.fn();
    store.publish({ text: "gamma" });
    store.subscribeRefresh(listener);

    store.resetForTests();
    store.requestRefresh();

    expect(store.getSnapshot()).toBe(EMPTY);
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps two stores independent", () => {
    const left = createStore();
    const right = createStore();
    const rightRefresh = vi.fn();
    right.subscribeRefresh(rightRefresh);
    const rightReader = renderSnapshot(right);

    act(() => left.publish({ text: "left only" }));
    left.requestRefresh({ rearm: true });

    expect(left.getSnapshot().text).toBe("left only");
    expect(right.getSnapshot()).toBe(EMPTY);
    expect(rightReader.result.current).toBe(EMPTY);
    expect(rightRefresh).not.toHaveBeenCalled();
  });
});
