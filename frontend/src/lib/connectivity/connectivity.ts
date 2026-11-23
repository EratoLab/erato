import { createValueStore, type ValueStore } from "@/utils/chat/valueStore";

/**
 * Shared view of whether the server can be reached.
 *
 * Signals come from the browser (`online`/`offline` events) and from requests
 * (a network-level failure or a response). A failed request alone never flips
 * the state: it starts a probe, and only a failed probe marks the connection
 * as lost. While lost, probes continue with backoff until one gets any HTTP
 * response back.
 */

export type ConnectivityStatus = "online" | "offline";

export interface ConnectivityMonitorOptions {
  probeUrl?: string;
  probeTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ConnectivityMonitor {
  getStatus: () => ConnectivityStatus;
  subscribe: (listener: () => void) => () => void;
  reportNetworkFailure: () => void;
  reportNetworkSuccess: () => void;
  /** Resolves once the server is reachable; rejects when `signal` aborts. */
  waitUntilOnline: (signal?: AbortSignal) => Promise<void>;
}

// Any HTTP status proves the network path works, so an unauthenticated or
// redirected probe is as good as a 200.
// eslint-disable-next-line lingui/no-unlocalized-strings -- URL path
const DEFAULT_PROBE_URL = "/health";

/** Wait before the next try after `failures` failed ones: 1 s, doubling, at most 15 s. */
export const reconnectBackoffMs = (failures: number): number =>
  Math.min(1_000 * 2 ** failures, 15_000);

export function createConnectivityMonitor(
  options: ConnectivityMonitorOptions = {},
): ConnectivityMonitor {
  const {
    probeUrl = DEFAULT_PROBE_URL,
    probeTimeoutMs = 5_000,
    fetchImpl,
  } = options;

  const status = createValueStore<ConnectivityStatus>("online");
  let probeInFlight: Promise<void> | null = null;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let failedProbes = 0;
  let browserEventsAttached = false;
  let lastSuccessAt = 0;

  const clearProbeTimer = () => {
    if (probeTimer !== null) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
  };

  const scheduleProbe = (delayMs: number) => {
    if (probeTimer !== null) {
      return;
    }
    probeTimer = setTimeout(() => {
      probeTimer = null;
      void probe();
    }, delayMs);
  };

  const markReachable = () => {
    failedProbes = 0;
    clearProbeTimer();
    status.set("online");
  };

  const probe = () => {
    probeInFlight ??= runProbe().finally(() => {
      probeInFlight = null;
    });
    return probeInFlight;
  };

  const runProbe = async () => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);
    let reachable = false;
    try {
      await (fetchImpl ?? fetch)(probeUrl, {
        method: "HEAD",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "manual",
        signal: controller.signal,
      });
      reachable = true;
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timeout);
    }

    // A request that succeeded while this probe was out outranks its failure.
    if (reachable || lastSuccessAt >= startedAt) {
      markReachable();
      return;
    }
    status.set("offline");
    scheduleProbe(reconnectBackoffMs(failedProbes));
    failedProbes += 1;
  };

  const probeNow = () => {
    clearProbeTimer();
    void probe();
  };

  const attachBrowserEvents = () => {
    if (browserEventsAttached || typeof window === "undefined") {
      return;
    }
    browserEventsAttached = true;
    window.addEventListener("offline", () => {
      status.set("offline");
      scheduleProbe(reconnectBackoffMs(0));
    });
    window.addEventListener("online", probeNow);
  };

  const subscribe = (listener: () => void) => {
    attachBrowserEvents();
    return status.subscribe(listener);
  };

  return {
    getStatus: status.get,

    subscribe,

    reportNetworkFailure() {
      attachBrowserEvents();
      if (status.get() === "online") {
        probeNow();
      }
    },

    reportNetworkSuccess() {
      lastSuccessAt = Date.now();
      if (status.get() === "offline" || probeTimer !== null) {
        markReachable();
      }
    },

    waitUntilOnline(signal) {
      if (signal?.aborted) {
        return Promise.reject(signal.reason);
      }
      // A probe still running may be about to find the connection gone, so
      // "online" only counts once it has settled.
      if (status.get() === "online" && probeInFlight === null) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (settle: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          unsubscribe();
          signal?.removeEventListener("abort", onAbort);
          settle();
        };
        const onAbort = () => finish(() => reject(signal?.reason));
        const unsubscribe = subscribe(() => {
          if (status.get() === "online") {
            finish(resolve);
          }
        });
        signal?.addEventListener("abort", onAbort, { once: true });
        void probeInFlight?.then(() => {
          if (status.get() === "online") {
            finish(resolve);
          }
        });
      });
    },
  };
}

export const connectivity = createConnectivityMonitor();

export const connectivityStatus: ValueStore<ConnectivityStatus> = {
  get: () => connectivity.getStatus(),
  subscribe: (listener) => connectivity.subscribe(listener),
};

const networkFailures = new WeakSet<object>();

/** Tags an error as a network-level failure (no usable HTTP response). */
export function markNetworkFailure<T extends object>(error: T): T {
  networkFailures.add(error);
  return error;
}

export function isNetworkFailure(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && networkFailures.has(error)
  );
}

const stalledStreams = new WeakSet<object>();

/** Tags a network failure as a stream that went silent rather than broke. */
export function markStalledStream<T extends object>(error: T): T {
  stalledStreams.add(error);
  return markNetworkFailure(error);
}

export function isStalledStream(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && stalledStreams.has(error)
  );
}
