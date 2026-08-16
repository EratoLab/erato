import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CONCURRENT_CHAT_READS,
  MIN_CHAT_METADATA_START_INTERVAL_MS,
  resetTeamsChatRateGates,
  runAtChatMetadataRate,
  runWithChatReadSlot,
} from "../teamsChatRateGate";

beforeEach(() => {
  resetTeamsChatRateGates();
});

afterEach(() => {
  vi.useRealTimers();
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

describe("runAtChatMetadataRate", () => {
  // Graph's List/Get chat ceiling counts request STARTS per second, so the
  // assertion is on start timestamps — a concurrency peak proves nothing.
  it("spaces request starts by the metadata interval", async () => {
    vi.useFakeTimers();
    const startedAt: number[] = [];

    const runs = Array.from({ length: 4 }, () =>
      runAtChatMetadataRate(undefined, async () => {
        startedAt.push(Date.now());
      }),
    );
    await vi.runAllTimersAsync();
    await Promise.all(runs);

    expect(startedAt).toHaveLength(4);
    for (let i = 1; i < startedAt.length; i += 1) {
      expect(startedAt[i] - startedAt[i - 1]).toBeGreaterThanOrEqual(
        MIN_CHAT_METADATA_START_INTERVAL_MS,
      );
    }
  });

  it("admits the next start while a slow call is still in flight", async () => {
    vi.useFakeTimers();
    const startedAt: number[] = [];
    let finishFirst: () => void = () => undefined;

    const first = runAtChatMetadataRate(undefined, () => {
      startedAt.push(Date.now());
      return new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    });
    const second = runAtChatMetadataRate(undefined, async () => {
      startedAt.push(Date.now());
    });

    // The second start must not wait for the first request to COMPLETE —
    // Graph's ceiling counts starts, and completion-chaining would serialize
    // the whole metadata family at one request per round-trip.
    await vi.advanceTimersByTimeAsync(MIN_CHAT_METADATA_START_INTERVAL_MS);
    expect(startedAt).toHaveLength(2);

    finishFirst();
    await Promise.all([first, second]);
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(
      MIN_CHAT_METADATA_START_INTERVAL_MS,
    );
  });

  it("keeps pacing when a call rejects", async () => {
    vi.useFakeTimers();
    const startedAt: number[] = [];

    const failed = runAtChatMetadataRate(undefined, () => {
      startedAt.push(Date.now());
      return Promise.reject(new Error("throttled"));
    }).catch(() => "handled");
    const next = runAtChatMetadataRate(undefined, async () => {
      startedAt.push(Date.now());
      return "ok";
    });
    await vi.runAllTimersAsync();

    await expect(failed).resolves.toBe("handled");
    await expect(next).resolves.toBe("ok");
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(
      MIN_CHAT_METADATA_START_INTERVAL_MS,
    );
  });
});
