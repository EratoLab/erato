import { describe, expect, it, vi } from "vitest";

import {
  restoreWordContentControlLocks,
  unlockWordContentControlsForImport,
} from "../wordContentControlWrite";

import type { WordContentControlLocks } from "../wordContentControlWrite";

interface NativeState {
  id: number;
  parentId?: number;
  cannotEdit: boolean;
  cannotDelete: boolean;
}

/** Simulates queued Office setters, an outer content lock, and a poisoned
 * context after a failing sync. Each run has fresh native object proxies. */
function nativeWord(initial: NativeState[], listedIds?: number[]) {
  const controls = new Map(initial.map((state) => [state.id, { ...state }]));
  const events: string[] = [];
  let nextContext = 0;
  let failId: number | undefined;
  let failAfterWrite = false;
  let ignoreWrites = false;
  let protectedDocument = false;
  const unprotect = vi.fn();
  const makeContext = () => {
    const contextId = ++nextContext;
    let poisoned = false;
    const writes: {
      id: number;
      key: "cannotEdit" | "cannotDelete";
      value: boolean;
    }[] = [];
    const proxy = (id: number | undefined): Word.ContentControl => {
      const object = {
        get id() {
          return id;
        },
        get isNullObject() {
          return id === undefined || !controls.has(id);
        },
        get cannotEdit() {
          return controls.get(id!)!.cannotEdit;
        },
        set cannotEdit(value: boolean) {
          events.push(`queue:${contextId}:${id}:cannotEdit=${value}`);
          writes.push({ id: id!, key: "cannotEdit", value });
        },
        get cannotDelete() {
          return controls.get(id!)!.cannotDelete;
        },
        set cannotDelete(value: boolean) {
          events.push(`queue:${contextId}:${id}:cannotDelete=${value}`);
          writes.push({ id: id!, key: "cannotDelete", value });
        },
        get parentContentControlOrNullObject() {
          return proxy(controls.get(id!)?.parentId);
        },
        load: vi.fn(() => object),
      };
      return object as unknown as Word.ContentControl;
    };
    const collection = {
      get items() {
        return (listedIds ?? [...controls.keys()]).map(proxy);
      },
      getByIdOrNullObject: (id: number) => proxy(id),
      load: vi.fn(),
    };
    const context = {
      document: {
        contentControls: collection,
        unprotect,
        get body() {
          throw new Error(
            "Control recovery must include every document story.",
          );
        },
      },
      sync: vi.fn(async () => {
        events.push(`sync:${contextId}`);
        if (poisoned) throw new Error("Do not reuse a failed context.");
        while (writes.length) {
          const write = writes.shift()!;
          const state = controls.get(write.id)!;
          let ancestor = state.parentId;
          while (ancestor !== undefined) {
            if (controls.get(ancestor)?.cannotEdit) {
              poisoned = true;
              throw new Error("An outer content lock prevents this mutation.");
            }
            ancestor = controls.get(ancestor)?.parentId;
          }
          if (protectedDocument || (failId === write.id && !failAfterWrite)) {
            poisoned = true;
            throw Object.assign(
              new Error("Native protection or write failure."),
              {
                code: protectedDocument ? "AccessDenied" : "GeneralException",
              },
            );
          }
          if (!ignoreWrites) state[write.key] = write.value;
          events.push(
            `write:${contextId}:${write.id}:${write.key}=${write.value}`,
          );
          if (failId === write.id && failAfterWrite) {
            poisoned = true;
            throw new Error("The host failed after a partial native mutation.");
          }
        }
      }),
    };
    return context as unknown as Word.RequestContext;
  };
  return {
    controls,
    events,
    unprotect,
    makeContext,
    run: async <T>(fn: (context: Word.RequestContext) => Promise<T>) =>
      fn(makeContext()),
    fail: (id: number, afterWrite = false) => {
      failId = id;
      failAfterWrite = afterWrite;
    },
    resume: () => {
      failId = undefined;
    },
    protect: () => {
      protectedDocument = true;
    },
    ignoreWrites: () => {
      ignoreWrites = true;
    },
  };
}

const both = (id: number, parentId?: number): NativeState => ({
  id,
  parentId,
  cannotEdit: true,
  cannotDelete: true,
});

describe("full-document content-control write preparation", () => {
  it("saves immutable lock identities before any setter and unlocks nested controls outside-in", async () => {
    const host = nativeWord([both(3, 2), both(1), both(2, 1)]);
    let captured: WordContentControlLocks = [];
    const locks = await host.run((context) =>
      unlockWordContentControlsForImport(context, {
        onLocksCaptured: (value) => {
          host.events.push("captured-locks");
          expect(host.events.some((e) => e.startsWith("queue:"))).toBe(false);
          captured = value;
        },
        onMutationStart: () => {
          host.events.push("mutation-start");
          expect(captured.map((c) => c.id)).toEqual([1, 2, 3]);
        },
      }),
    );
    expect(locks).toBe(captured);
    expect(locks.map((c) => [c.id, c.depth])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
    expect(Object.isFrozen(locks)).toBe(true);
    expect(Object.isFrozen(locks[0])).toBe(true);
    expect(
      [...host.controls.values()].every(
        (c) => !c.cannotEdit && !c.cannotDelete,
      ),
    ).toBe(true);
    expect(host.events.indexOf("captured-locks")).toBeLessThan(
      host.events.indexOf("mutation-start"),
    );
    expect(host.events.indexOf("mutation-start")).toBeLessThan(
      host.events.findIndex((e) => e.startsWith("queue:")),
    );
    expect(host.events.filter((e) => e.startsWith("write:"))).toEqual([
      "write:1:1:cannotEdit=false",
      "write:1:1:cannotDelete=false",
      "write:1:2:cannotEdit=false",
      "write:1:2:cannotDelete=false",
      "write:1:3:cannotEdit=false",
      "write:1:3:cannotDelete=false",
    ]);
  });

  it("follows a parent omitted from the document collection before unlocking its child", async () => {
    const host = nativeWord([both(11, 10), both(10)], [11]);
    const locks = await host.run((context) =>
      unlockWordContentControlsForImport(context, {
        onLocksCaptured: vi.fn(),
        onMutationStart: vi.fn(),
      }),
    );
    expect(locks.map((c) => c.id)).toEqual([10, 11]);
    expect(host.controls.get(10)?.cannotEdit).toBe(false);
    expect(host.controls.get(11)?.cannotEdit).toBe(false);
  });

  it("keeps unlocked controls and a document without locks entirely read-only", async () => {
    const host = nativeWord([
      { id: 4, cannotEdit: false, cannotDelete: false },
    ]);
    const onMutationStart = vi.fn();
    const onLocksCaptured = vi.fn();
    const locks = await host.run((context) =>
      unlockWordContentControlsForImport(context, {
        onLocksCaptured,
        onMutationStart,
      }),
    );
    expect(locks).toEqual([]);
    expect(onLocksCaptured).toHaveBeenCalledWith([]);
    expect(onMutationStart).not.toHaveBeenCalled();
    expect(host.events.filter((e) => e.startsWith("queue:"))).toEqual([]);
  });

  it("does not queue setters if saving restoration metadata fails", async () => {
    const host = nativeWord([both(1)]);
    const onMutationStart = vi.fn();
    await expect(
      host.run((context) =>
        unlockWordContentControlsForImport(context, {
          onLocksCaptured: () => {
            throw new Error("Backup persistence failed.");
          },
          onMutationStart,
        }),
      ),
    ).rejects.toThrow("Backup persistence failed.");
    expect(onMutationStart).not.toHaveBeenCalled();
    expect(host.events.filter((e) => e.startsWith("queue:"))).toEqual([]);
  });

  it("rejects an inconsistent native hierarchy before changing any flags", async () => {
    const host = nativeWord([both(1, 2), both(2, 1)]);
    const onMutationStart = vi.fn();
    await expect(
      host.run((context) =>
        unlockWordContentControlsForImport(context, {
          onLocksCaptured: vi.fn(),
          onMutationStart,
        }),
      ),
    ).rejects.toThrow("invalid content control hierarchy");
    expect(onMutationStart).not.toHaveBeenCalled();
    expect(host.events.filter((e) => e.startsWith("queue:"))).toEqual([]);
  });

  it("retains all original flags when a native sync only partially unlocks a control", async () => {
    const host = nativeWord([both(1), both(2, 1)]);
    host.fail(2, true);
    let captured: WordContentControlLocks = [];
    const onMutationStart = vi.fn();
    await expect(
      host.run((context) =>
        unlockWordContentControlsForImport(context, {
          onLocksCaptured: (value) => {
            captured = value;
          },
          onMutationStart,
        }),
      ),
    ).rejects.toThrow("partial native mutation");
    expect(onMutationStart).toHaveBeenCalledOnce();
    expect(captured.every((c) => c.cannotEdit && c.cannotDelete)).toBe(true);
    host.resume();
    const restored = await restoreWordContentControlLocks(host, captured);
    expect(restored).toEqual({ restored: [2, 1], missing: [], failed: [] });
    expect(
      [...host.controls.values()].every((c) => c.cannotEdit && c.cannotDelete),
    ).toBe(true);
  });

  it("propagates genuine document-protection failure without trying to unprotect it", async () => {
    const host = nativeWord([both(1)]);
    host.protect();
    await expect(
      host.run((context) =>
        unlockWordContentControlsForImport(context, {
          onLocksCaptured: vi.fn(),
          onMutationStart: vi.fn(),
        }),
      ),
    ).rejects.toMatchObject({ code: "AccessDenied" });
    expect(host.unprotect).not.toHaveBeenCalled();
    expect(host.controls.get(1)).toMatchObject({
      cannotEdit: true,
      cannotDelete: true,
    });
  });

  it("does not proceed to import when a host silently leaves a lock enabled", async () => {
    const host = nativeWord([both(1)]);
    host.ignoreWrites();
    await expect(
      host.run((context) =>
        unlockWordContentControlsForImport(context, {
          onLocksCaptured: vi.fn(),
          onMutationStart: vi.fn(),
        }),
      ),
    ).rejects.toThrow("did not unlock");
  });
});

describe("content-control lock recovery after an interrupted import", () => {
  it("restores independent flags in reverse nesting order without relocking unrelated controls", async () => {
    const host = nativeWord([
      { id: 1, cannotEdit: true, cannotDelete: false },
      { id: 2, parentId: 1, cannotEdit: false, cannotDelete: true },
      { id: 3, cannotEdit: false, cannotDelete: false },
    ]);
    const locks = await host.run((context) =>
      unlockWordContentControlsForImport(context, {
        onLocksCaptured: vi.fn(),
        onMutationStart: vi.fn(),
      }),
    );
    host.events.length = 0;
    const result = await restoreWordContentControlLocks(host, locks);
    expect(result).toEqual({ restored: [2, 1], missing: [], failed: [] });
    expect(host.events.filter((e) => e.startsWith("write:"))).toEqual([
      "write:2:2:cannotDelete=true",
      "write:3:1:cannotEdit=true",
    ]);
    expect(host.controls.get(3)).toMatchObject({
      cannotEdit: false,
      cannotDelete: false,
    });
  });

  it("skips a deleted ID and isolates a failed control from successful sibling recovery", async () => {
    const host = nativeWord([both(1), both(2), both(3)]);
    const locks = await host.run((context) =>
      unlockWordContentControlsForImport(context, {
        onLocksCaptured: vi.fn(),
        onMutationStart: vi.fn(),
      }),
    );
    host.controls.delete(1);
    host.fail(2);
    const result = await restoreWordContentControlLocks(host, locks);
    expect(result).toEqual({ restored: [3], missing: [1], failed: [2] });
    expect(host.controls.has(1)).toBe(false);
    expect(host.controls.get(3)).toMatchObject({
      cannotEdit: true,
      cannotDelete: true,
    });
  });

  it("does not restore flags in another document when the caller's identity check fails", async () => {
    const host = nativeWord([both(1)]);
    const locks = await host.run((context) =>
      unlockWordContentControlsForImport(context, {
        onLocksCaptured: vi.fn(),
        onMutationStart: vi.fn(),
      }),
    );
    host.events.length = 0;
    const result = await restoreWordContentControlLocks(host, locks, {
      canRestore: () => false,
    });
    expect(result).toEqual({ restored: [], missing: [], failed: [1] });
    expect(host.events.filter((e) => e.startsWith("queue:"))).toEqual([]);
  });

  it("rechecks document identity after reading the target control and before queuing setters", async () => {
    const host = nativeWord([both(1)]);
    const locks = await host.run((context) =>
      unlockWordContentControlsForImport(context, {
        onLocksCaptured: vi.fn(),
        onMutationStart: vi.fn(),
      }),
    );
    host.events.length = 0;
    const canRestore = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const result = await restoreWordContentControlLocks(host, locks, {
      canRestore,
    });
    expect(result.failed).toEqual([1]);
    expect(host.events.filter((e) => e.startsWith("queue:"))).toEqual([]);
  });
});
