import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConnectivityMonitor,
  isNetworkFailure,
  isStalledStream,
  markStalledStream,
} from "./connectivity";

const reachable = (): Promise<Response> =>
  Promise.resolve(new Response(null, { status: 401 }));
const unreachable = (): Promise<Response> =>
  Promise.reject(new TypeError("Failed to fetch"));

describe("createConnectivityMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays online when the probe after a failed request gets a response", async () => {
    const fetchImpl = vi.fn(reachable);
    const monitor = createConnectivityMonitor({ fetchImpl });

    monitor.reportNetworkFailure();
    await vi.runOnlyPendingTimersAsync();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(monitor.getStatus()).toBe("online");
  });

  it("goes offline only once the probe fails, then recovers on a later probe", async () => {
    const fetchImpl = vi.fn(unreachable);
    const monitor = createConnectivityMonitor({
      fetchImpl,
      probeBackoffMs: [1_000, 2_000],
    });
    const seen: string[] = [];
    monitor.subscribe((status) => seen.push(status));

    monitor.reportNetworkFailure();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getStatus()).toBe("offline");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(monitor.getStatus()).toBe("offline");

    fetchImpl.mockImplementation(reachable);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(monitor.getStatus()).toBe("online");
    expect(seen).toEqual(["offline", "online"]);
  });

  it("goes back online as soon as any request gets a response", async () => {
    const monitor = createConnectivityMonitor({
      fetchImpl: vi.fn(unreachable),
    });
    monitor.reportNetworkFailure();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getStatus()).toBe("offline");

    monitor.reportNetworkSuccess();
    expect(monitor.getStatus()).toBe("online");
  });

  it("lets a request that succeeded during a probe outrank the probe's failure", async () => {
    let failProbe: (error: Error) => void = () => {};
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          failProbe = reject;
        }),
    );
    const monitor = createConnectivityMonitor({ fetchImpl });

    monitor.reportNetworkFailure();
    await vi.advanceTimersByTimeAsync(1);
    monitor.reportNetworkSuccess();
    failProbe(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(0);

    expect(monitor.getStatus()).toBe("online");
  });

  it("follows the browser's offline and online events", async () => {
    const fetchImpl = vi.fn(reachable);
    const monitor = createConnectivityMonitor({ fetchImpl });
    monitor.subscribe(() => {});

    window.dispatchEvent(new Event("offline"));
    expect(monitor.getStatus()).toBe("offline");

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getStatus()).toBe("online");
  });

  it("resolves waitUntilOnline on recovery and rejects it on abort", async () => {
    const monitor = createConnectivityMonitor({
      fetchImpl: vi.fn(unreachable),
    });
    monitor.reportNetworkFailure();
    await vi.advanceTimersByTimeAsync(0);

    const recovered = monitor.waitUntilOnline();
    const controller = new AbortController();
    const aborted = monitor.waitUntilOnline(controller.signal).then(
      () => "resolved",
      () => "rejected",
    );

    controller.abort();
    await expect(aborted).resolves.toBe("rejected");

    monitor.reportNetworkSuccess();
    await expect(recovered).resolves.toBeUndefined();
  });

  it("gives up on a probe that hangs", async () => {
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const monitor = createConnectivityMonitor({
      fetchImpl,
      probeTimeoutMs: 5_000,
    });

    monitor.reportNetworkFailure();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(monitor.getStatus()).toBe("offline");
  });
  it("does not report online while a probe that may find the connection gone is still running", async () => {
    let settleProbe: (outcome: "reachable" | "unreachable") => void = () => {};
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve, reject) => {
          settleProbe = (outcome) =>
            outcome === "reachable"
              ? resolve(new Response(null, { status: 200 }))
              : reject(new TypeError("Failed to fetch"));
        }),
    );
    const monitor = createConnectivityMonitor({ fetchImpl });
    monitor.reportNetworkFailure();
    let resolved = false;
    const waiting = monitor.waitUntilOnline().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    settleProbe("unreachable");
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getStatus()).toBe("offline");
    expect(resolved).toBe(false);

    fetchImpl.mockImplementation(reachable);
    await vi.advanceTimersByTimeAsync(1_000);
    await waiting;
    expect(resolved).toBe(true);
  });

  it("resolves a wait once a running probe confirms the connection", async () => {
    let settleProbe: () => void = () => {};
    const monitor = createConnectivityMonitor({
      fetchImpl: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            settleProbe = () => resolve(new Response(null, { status: 200 }));
          }),
      ),
    });
    monitor.reportNetworkFailure();
    const waiting = monitor.waitUntilOnline();

    settleProbe();
    await expect(waiting).resolves.toBeUndefined();
  });

  it("tags a stalled stream as a network failure too", () => {
    const error = markStalledStream(new Error("SSE stream stalled"));
    expect(isStalledStream(error)).toBe(true);
    expect(isNetworkFailure(error)).toBe(true);
    expect(isStalledStream(new Error("other"))).toBe(false);
  });
});
