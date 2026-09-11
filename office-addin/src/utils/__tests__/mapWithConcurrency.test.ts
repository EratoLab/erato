import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "../mapWithConcurrency";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe("mapWithConcurrency", () => {
  it("never runs more than the limit at once and preserves input order", async () => {
    const gates = Array.from({ length: 6 }, deferred);
    let active = 0;
    let maxActive = 0;
    const started: number[] = [];

    const run = mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(item);
      await gates[item].promise;
      active -= 1;
      return `r${item}`;
    });

    await flush();
    expect(started).toEqual([0, 1]);

    // Finishing out of order must not reorder the results.
    gates[1].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);
    gates[2].resolve();
    await flush();
    gates[0].resolve();
    await flush();
    gates[4].resolve();
    gates[3].resolve();
    gates[5].resolve();

    const results = await run;
    expect(results).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
    expect(maxActive).toBe(2);
  });

  it("passes the input index to the mapper", async () => {
    const seen: number[] = [];
    await mapWithConcurrency(["a", "b", "c"], 4, async (_item, index) => {
      seen.push(index);
    });
    expect(seen).toEqual([0, 1, 2]);
  });

  it("handles an empty input and a limit above the item count", async () => {
    expect(await mapWithConcurrency([], 4, async (x: number) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 10, async (x) => x * 2)).toEqual([
      2, 4,
    ]);
  });

  it("treats a limit below one as sequential", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency([1, 2, 3], 0, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
    });
    expect(maxActive).toBe(1);
  });

  it("rejects when a mapper rejects", async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      }),
    ).rejects.toThrow("boom");
  });
});
