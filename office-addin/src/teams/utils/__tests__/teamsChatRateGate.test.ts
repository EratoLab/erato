import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_CONCURRENT_CHAT_READS,
  resetTeamsChatRateGates,
  runWithChatReadSlot,
} from "../teamsChatRateGate";

beforeEach(() => {
  resetTeamsChatRateGates();
});

describe("runWithChatReadSlot", () => {
  it("never lets more than the ceiling run at once", async () => {
    const release: Array<() => void> = [];
    let running = 0;
    let peak = 0;

    const started = Array.from({ length: 12 }, () =>
      runWithChatReadSlot(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => release.push(resolve));
        running -= 1;
      }),
    );

    // Drain in waves: each release admits exactly one queued caller.
    while (release.length > 0) {
      release.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.all(started);

    expect(peak).toBe(MAX_CONCURRENT_CHAT_READS);
  });

  it("hands the slot on even when the caller rejects", async () => {
    const failures = Array.from({ length: 8 }, () =>
      runWithChatReadSlot(() => Promise.reject(new Error("throttled"))).catch(
        () => "handled",
      ),
    );

    await expect(Promise.all(failures)).resolves.toHaveLength(8);
    await expect(
      runWithChatReadSlot(() => Promise.resolve("free")),
    ).resolves.toBe("free");
  });
});
