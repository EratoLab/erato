import {
  connectivity,
  reconnectBackoffMs,
} from "@/lib/connectivity/connectivity";
import { abortableDelay } from "@/utils/abortableDelay";
import { createValueStore } from "@/utils/chat/valueStore";

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
 * runs in the chat, so nothing new is sent in a chat while its Stop is
 * pending: the Stop can never land after a newer turn.
 */
export function createStopDelivery() {
  const pending = createValueStore<ReadonlySet<string>>(new Set());
  const deliveries = new Map<string, AbortController>();

  const settle = (streamKey: string, delivery: AbortController) => {
    if (deliveries.get(streamKey) !== delivery) return;
    deliveries.delete(streamKey);
    const next = new Set(pending.get());
    next.delete(streamKey);
    pending.set(next);
  };

  return {
    /** The chats whose Stop is still on its way to the server. */
    pending,

    /** Sends the Stop now, and again whenever the connection is back, until delivered. */
    deliver(streamKey: string, options: StopDeliveryOptions): void {
      deliveries.get(streamKey)?.abort();
      const delivery = new AbortController();
      deliveries.set(streamKey, delivery);
      pending.set(new Set(pending.get()).add(streamKey));
      const { signal } = delivery;
      const undelivered = () => {
        if (!signal.aborted) options.onUndelivered();
      };

      void (async () => {
        const fallback = setTimeout(undelivered, options.undeliveredAfterMs);
        let delivered = await options.send();
        clearTimeout(fallback);
        if (!delivered) {
          undelivered();
          try {
            for (let failures = 0; !delivered; failures += 1) {
              await connectivity.waitUntilOnline(signal);
              if (failures > 0)
                await abortableDelay(reconnectBackoffMs(failures - 1), signal);
              delivered = await options.send();
            }
            options.onDeliveredLate();
          } catch {
            // Dropped: a newer Stop took over, or the chat view went away.
          }
        }
        settle(streamKey, delivery);
      })();
    },

    /** Gives up on every Stop still pending, as the chat view goes away. */
    dropAll(): void {
      deliveries.forEach((delivery) => delivery.abort());
      deliveries.clear();
      pending.set(new Set());
    },
  };
}
