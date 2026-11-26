import { isStillSignedIn, SignedOutError } from "@/auth/authRecovery";

import {
  connectivity as defaultConnectivity,
  isNetworkFailure,
  markNetworkFailure,
  waitToSendAgain,
  type ConnectivityMonitor,
} from "./connectivity";

export const MAX_SEND_ATTEMPTS = 3;
/** How long a send waits for the server to be reachable again. */
export const NETWORK_WAIT_MS = 2 * 60_000;

export interface SendWhenOnlineOptions {
  /** Ends the wait and the next tries; the error is the signal's reason. */
  signal?: AbortSignal;
  /** Called with true while the send waits for the network, false when it goes on. */
  onWaitingForNetwork?: (waiting: boolean) => void;
  /**
   * Whether a try that got no answer may be sent again. A write whose answer
   * was lost may already have arrived; refuse when a second copy would hurt.
   */
  mayResend?: (error: unknown) => boolean;
  connectivity?: ConnectivityMonitor;
  maxAttempts?: number;
  networkWaitMs?: number;
  stillSignedIn?: () => Promise<boolean>;
}

/**
 * Sends once the server is reachable, and after a try that got no answer
 * waits until it is reachable again and sends again. An answer from the
 * server (an error status included) ends it. Before each resend it checks the
 * sign-in, since an expired session also looks like a network failure.
 */
export async function sendWhenOnline<T>(
  send: () => Promise<T>,
  {
    signal,
    onWaitingForNetwork,
    mayResend = () => true,
    connectivity = defaultConnectivity,
    maxAttempts = MAX_SEND_ATTEMPTS,
    networkWaitMs = NETWORK_WAIT_MS,
    stillSignedIn = isStillSignedIn,
  }: SendWhenOnlineOptions = {},
): Promise<T> {
  const waitForServer = async (failures: number, lastError: unknown) => {
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(), networkWaitMs);
    const forwardAbort = () => limit.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const notice = { shown: false };
    // Said only while the server is known unreachable: a probe that is still
    // out, or the back-off between tries, shows nothing.
    const showIfOffline = () => {
      if (notice.shown || connectivity.getStatus() === "online") return;
      notice.shown = true;
      onWaitingForNetwork?.(true);
    };
    const unsubscribe = connectivity.subscribe(showIfOffline);
    showIfOffline();
    try {
      await waitToSendAgain(failures, limit.signal, connectivity);
    } catch {
      if (signal?.aborted) throw signal.reason;
      throw lastError ?? markNetworkFailure(new Error("Network error"));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
      unsubscribe();
      if (notice.shown) onWaitingForNetwork?.(false);
    }
  };

  let lastError: unknown;
  for (let attempt = 1; ; attempt += 1) {
    await waitForServer(attempt - 1, lastError);
    if (attempt > 1 && !(await stillSignedIn())) throw new SignedOutError();
    signal?.throwIfAborted();
    try {
      return await send();
    } catch (error) {
      if (
        signal?.aborted ||
        !isNetworkFailure(error) ||
        attempt >= maxAttempts ||
        !mayResend(error)
      ) {
        throw error;
      }
      lastError = error;
    }
  }
}
