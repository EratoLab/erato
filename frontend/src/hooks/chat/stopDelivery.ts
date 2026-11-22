import {
  connectivity,
  reconnectBackoffMs,
} from "@/lib/connectivity/connectivity";
import { abortableDelay } from "@/utils/abortableDelay";

interface PendingStop {
  attempt: () => Promise<boolean>;
  delivered: boolean;
  /** Replaced by a newer Stop, or the chat view went away. */
  dropped: boolean;
  /** A newer turn in the chat waits for this Stop. */
  newerTurn: boolean;
  dropSignal: AbortController;
}

export interface StopDeliveryOptions {
  /** Resolves to whether the server answered. */
  send: () => Promise<boolean>;
  /** The server has not answered after `undeliveredAfterMs`, or could not be reached. */
  onUndelivered: () => void;
  undeliveredAfterMs: number;
  /** It reached the server only once the connection was back. */
  onDeliveredLate: () => void;
}

/**
 * Stops the server has not heard yet, per chat. The server stops whatever turn
 * runs in the chat, so a Stop stays pending until it is delivered, and a newer
 * turn in the chat goes out only after that (`settle`): the Stop can never
 * land after it.
 */
export function createStopDelivery() {
  const pendingStops = new Map<string, PendingStop>();

  const drop = (stop: PendingStop) => {
    stop.dropped = true;
    stop.dropSignal.abort();
  };

  /** Tries until delivered, waiting for the connection between tries. */
  const deliverWhenOnline = async (
    stop: PendingStop,
    signal: AbortSignal,
  ): Promise<void> => {
    for (let failures = 0; ; failures += 1) {
      await connectivity.waitUntilOnline(signal);
      if (failures > 0)
        await abortableDelay(reconnectBackoffMs(failures - 1), signal);
      if (stop.delivered || (await stop.attempt())) return;
    }
  };

  return {
    /** Sends the Stop now, and again whenever the connection is back, until delivered. */
    deliver(streamKey: string, options: StopDeliveryOptions): void {
      const previous = pendingStops.get(streamKey);
      if (previous) drop(previous);
      let sending: Promise<boolean> | null = null;
      const stop: PendingStop = {
        // Tries running at once share one request.
        attempt: () => {
          sending ??= options
            .send()
            .catch(() => false)
            .then((delivered) => {
              sending = null;
              if (delivered) {
                stop.delivered = true;
                if (pendingStops.get(streamKey) === stop)
                  pendingStops.delete(streamKey);
              }
              return delivered;
            });
          return sending;
        },
        delivered: false,
        dropped: false,
        newerTurn: false,
        dropSignal: new AbortController(),
      };
      pendingStops.set(streamKey, stop);
      // Read through a call: a newer turn can start while this awaits.
      const quiet = () => stop.newerTurn || stop.dropped;
      const undelivered = () => {
        if (!quiet()) options.onUndelivered();
      };

      void (async () => {
        const fallback = setTimeout(undelivered, options.undeliveredAfterMs);
        const delivered = await stop.attempt();
        clearTimeout(fallback);
        if (delivered) return;
        undelivered();
        try {
          await deliverWhenOnline(stop, stop.dropSignal.signal);
        } catch {
          return;
        }
        if (!quiet()) options.onDeliveredLate();
      })();
    },

    /**
     * Called as a new turn starts in the chat; its request waits for the
     * returned promise, which resolves once the pending Stop is delivered and
     * rejects when `signal` aborts or the Stop is dropped. `null` when no Stop
     * is pending.
     */
    settle(streamKey: string, signal: AbortSignal): Promise<void> | null {
      const stop = pendingStops.get(streamKey);
      if (!stop) return null;
      stop.newerTurn = true;
      const stopped = new AbortController();
      const stopWaiting = () => stopped.abort();
      signal.addEventListener("abort", stopWaiting, { once: true });
      stop.dropSignal.signal.addEventListener("abort", stopWaiting, {
        once: true,
      });
      if (signal.aborted || stop.dropped) stopWaiting();
      return (async () => {
        try {
          if (stop.delivered || (await stop.attempt())) return;
          await deliverWhenOnline(stop, stopped.signal);
        } finally {
          signal.removeEventListener("abort", stopWaiting);
          stop.dropSignal.signal.removeEventListener("abort", stopWaiting);
        }
      })();
    },

    /** Gives up on every Stop still pending, as the chat view goes away. */
    dropAll(): void {
      pendingStops.forEach(drop);
      pendingStops.clear();
    },
  };
}

export type StopDelivery = ReturnType<typeof createStopDelivery>;
