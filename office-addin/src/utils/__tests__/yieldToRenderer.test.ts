import { afterEach, describe, expect, it, vi } from "vitest";

import { yieldToRenderer } from "../yieldToRenderer";

describe("yieldToRenderer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves through a timer when no scheduler is available", async () => {
    vi.stubGlobal("scheduler", undefined);
    await expect(yieldToRenderer()).resolves.toBeUndefined();
  });

  it("uses scheduler.yield as a method call when present", async () => {
    const scheduler = { yield: vi.fn(() => Promise.resolve()) };
    vi.stubGlobal("scheduler", scheduler);

    await yieldToRenderer();

    expect(scheduler.yield).toHaveBeenCalledTimes(1);
    expect(scheduler.yield.mock.contexts[0]).toBe(scheduler);
  });
});
