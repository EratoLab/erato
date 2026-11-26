import {
  connectivity as defaultConnectivity,
  isNetworkFailure,
  markNetworkFailure,
  reconnectBackoffMs,
  type ConnectivityMonitor,
} from "@/lib/connectivity/connectivity";

export const MAX_UPLOAD_ATTEMPTS = 3;
/** How long an upload waits for the server to be reachable again. */
export const UPLOAD_NETWORK_WAIT_MS = 2 * 60_000;

/**
 * Time limit for one upload request. Generous, because fetch reports no
 * progress: a minute plus the time the files take at 50 KB/s, so a slow but
 * moving upload finishes while one on a connection that died silently ends.
 */
export function uploadTimeLimitMs(totalBytes: number): number {
  return 60_000 + Math.ceil(totalBytes / 50);
}

export class UploadTimedOutError extends Error {
  constructor() {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- matched by plainErrorMessage
    super("Network error (request timed out)");
    // eslint-disable-next-line lingui/no-unlocalized-strings
    this.name = "UploadTimedOutError";
  }
}

interface UploadRetryOptions {
  timeLimitMs: number;
  /** Called with true while the upload waits for the network, false when it goes on. */
  onWaitingForNetwork?: (waiting: boolean) => void;
  connectivity?: ConnectivityMonitor;
  maxAttempts?: number;
  networkWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends an upload, and when the network drops (no answer, or no answer within
 * the time limit) waits until the server is reachable and sends it again.
 * Errors with an HTTP answer (too large, rejected) are thrown at once. A
 * repeated send may store the file twice on the server; only the copy whose
 * answer arrives is attached, so the other is never used.
 */
export async function uploadWithNetworkRetry<T>(
  send: (signal: AbortSignal) => Promise<T>,
  {
    timeLimitMs,
    onWaitingForNetwork,
    connectivity = defaultConnectivity,
    maxAttempts = MAX_UPLOAD_ATTEMPTS,
    networkWaitMs = UPLOAD_NETWORK_WAIT_MS,
    sleep = defaultSleep,
  }: UploadRetryOptions,
): Promise<T> {
  const waitForServer = async (lastError: unknown) => {
    if (connectivity.getStatus() === "online") {
      // A probe may still be deciding; this settles at once when none runs.
      await connectivity.waitUntilOnline();
      if (connectivity.getStatus() === "online") return;
    }
    onWaitingForNetwork?.(true);
    try {
      await connectivity.waitUntilOnline(AbortSignal.timeout(networkWaitMs));
    } catch {
      throw lastError ?? markNetworkFailure(new Error("Network error"));
    } finally {
      onWaitingForNetwork?.(false);
    }
  };

  let lastError: unknown;
  for (let attempt = 1; ; attempt += 1) {
    await waitForServer(lastError);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeLimitMs);
    try {
      return await send(controller.signal);
    } catch (error) {
      const timedOut = controller.signal.aborted;
      if (!timedOut && !isNetworkFailure(error)) throw error;
      lastError = timedOut
        ? markNetworkFailure(new UploadTimedOutError())
        : error;
      if (attempt >= maxAttempts) throw lastError;
      // A silent timeout never reached the request layer's own report.
      if (timedOut) connectivity.reportNetworkFailure();
      await sleep(reconnectBackoffMs(attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
}
