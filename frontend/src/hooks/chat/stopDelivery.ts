import { connectivity } from "@/lib/connectivity/connectivity";

interface PendingStop {
  send: () => Promise<boolean>;
  sending: Promise<boolean> | null;
  superseded: boolean;
  waitForNetwork: AbortController;
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
 * runs in the chat, so a Stop must never reach a turn the user started after
 * pressing it: the next turn settles it first (`settle`), and from then on it
 * is not sent again.
 */
export function createStopDelivery() {
  const pendingStops = new Map<string, PendingStop>();

  const supersede = (stop: PendingStop) => {
    stop.superseded = true;
    stop.waitForNetwork.abort();
  };

  return {
    /** Sends the Stop now and, if it cannot be delivered, once more when the connection is back. */
    deliver(streamKey: string, options: StopDeliveryOptions): void {
      const previous = pendingStops.get(streamKey);
      if (previous) supersede(previous);
      const stop: PendingStop = {
        send: options.send,
        sending: null,
        superseded: false,
        waitForNetwork: new AbortController(),
      };
      pendingStops.set(streamKey, stop);
      const attempt = async () => {
        const sending = options.send();
        stop.sending = sending;
        try {
          return await sending;
        } finally {
          stop.sending = null;
        }
      };
      // Read through a call: another turn can supersede it while this awaits.
      const superseded = () => stop.superseded;
      const undelivered = () => {
        if (!superseded()) options.onUndelivered();
      };

      void (async () => {
        const fallback = setTimeout(undelivered, options.undeliveredAfterMs);
        const delivered = await attempt();
        clearTimeout(fallback);
        if (!delivered) {
          undelivered();
          const online = await connectivity
            .waitUntilOnline(stop.waitForNetwork.signal)
            .then(
              () => true,
              () => false,
            );
          if (online && !superseded() && (await attempt()) && !superseded())
            options.onDeliveredLate();
        }
        if (pendingStops.get(streamKey) === stop)
          pendingStops.delete(streamKey);
      })();
    },

    /**
     * Called as a new turn starts in the chat; its request waits for the
     * returned promise. A Stop still in flight is awaited, one waiting for the
     * connection is sent once now, and neither is sent again. `null` when none
     * is pending.
     */
    settle(streamKey: string): Promise<void> | null {
      const stop = pendingStops.get(streamKey);
      if (!stop) return null;
      pendingStops.delete(streamKey);
      supersede(stop);
      return (stop.sending ?? stop.send()).then(
        () => undefined,
        () => undefined,
      );
    },

    /** Gives up on every Stop still waiting, as the chat view goes away. */
    dropAll(): void {
      pendingStops.forEach(supersede);
      pendingStops.clear();
    },
  };
}

export type StopDelivery = ReturnType<typeof createStopDelivery>;
