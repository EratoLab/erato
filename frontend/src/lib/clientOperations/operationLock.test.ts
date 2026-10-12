import { describe, expect, it, vi } from "vitest";

import { fakeWebLocks } from "@/test/webLocks";

import { withClientCallLock } from "./operationLock";

describe("withClientCallLock", () => {
  it("runs without Web Locks", async () => {
    const run = vi.fn(async () => {});
    await expect(withClientCallLock("msg", "call", run)).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs a free call and skips one held elsewhere", async () => {
    const restore = fakeWebLocks(new Set(["erato.client-call:msg:held"]));
    try {
      const run = vi.fn(async () => {});
      await expect(withClientCallLock("msg", "free", run)).resolves.toBe(true);
      await expect(withClientCallLock("msg", "held", run)).resolves.toBe(false);
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
