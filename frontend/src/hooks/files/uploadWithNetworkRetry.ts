import {
  connectivity as defaultConnectivity,
  isNetworkFailure,
  markNetworkFailure,
  reconnectBackoffMs,
  type ConnectivityMonitor,
} from "@/lib/connectivity/connectivity";
import { abortableDelay } from "@/utils/abortableDelay";

export const MAX_UPLOAD_ATTEMPTS = 3;
/** How long an upload waits for the server to be reachable again. */
export const UPLOAD_NETWORK_WAIT_MS = 2 * 60_000;
/** A wait shorter than this (a probe that succeeds) shows no notice. */
const WAITING_NOTICE_DELAY_MS = 500;

/**
 * Time limit for one upload request. Generous, because fetch reports no
 * progress: two minutes plus the time the files take at 20 KB/s, so a slow
 * but moving upload finishes while one on a connection that died silently
 * ends.
 */
export function uploadTimeLimitMs(totalBytes: number): number {
  return 120_000 + Math.ceil(totalBytes / 20);
}

interface UploadRetryOptions {
  /** Called with true while the upload waits for the network, false when it goes on. */
  onWaitingForNetwork?: (waiting: boolean) => void;
  connectivity?: ConnectivityMonitor;
  maxAttempts?: number;
  networkWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Sends an upload, and when it gets no answer (the network dropped, or the
 * request's time limit ran out) waits until the server is reachable and sends
 * it again. Errors with an HTTP answer (too large, rejected) are thrown at
 * once. When an answer was lost rather than never sent, the server keeps a
 * second copy of the file in the chat; only the copy whose answer arrives is
 * attached to the message.
 */
export async function uploadWithNetworkRetry<T>(
  send: () => Promise<T>,
  {
    onWaitingForNetwork,
    connectivity = defaultConnectivity,
    maxAttempts = MAX_UPLOAD_ATTEMPTS,
    networkWaitMs = UPLOAD_NETWORK_WAIT_MS,
    sleep = abortableDelay,
  }: UploadRetryOptions = {},
): Promise<T> {
  const waitForServer = async (lastError: unknown) => {
    const shown = { waiting: false };
    const notice = setTimeout(() => {
      shown.waiting = true;
      onWaitingForNetwork?.(true);
    }, WAITING_NOTICE_DELAY_MS);
    try {
      await connectivity.waitUntilOnline(AbortSignal.timeout(networkWaitMs));
    } catch {
      throw lastError ?? markNetworkFailure(new Error("Network error"));
    } finally {
      clearTimeout(notice);
      if (shown.waiting) onWaitingForNetwork?.(false);
    }
  };

  let lastError: unknown;
  for (let attempt = 1; ; attempt += 1) {
    await waitForServer(lastError);
    try {
      return await send();
    } catch (error) {
      if (!isNetworkFailure(error) || attempt >= maxAttempts) throw error;
      lastError = error;
      await sleep(reconnectBackoffMs(attempt - 1));
    }
  }
}
