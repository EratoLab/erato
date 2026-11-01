/** How long a tab stays shown or hidden before the stream follows it, so a
 * quick switch between tabs moves nothing. */
const SETTLE_MS = 1_000;
const CHANNEL = "erato.executor-stream";

/** What the hand-over of a shared stream reads from the browser. */
export interface TabSignals {
  /** Whether the user uses this tab: it is visible. */
  inUse(): boolean;
  /** Reports changes of `inUse` to `changed` and the keys other tabs announce
   * to `wanted`; `announce` tells the other tabs this one waits for a key. */
  connect(
    changed: () => void,
    wanted: (key: string) => void,
  ): { announce(key: string): void; close(): void };
}

/** The document's visibility, and a BroadcastChannel between the tabs. */
export const browserTabSignals: TabSignals = {
  inUse: () => document.visibilityState !== "hidden",
  connect(changed, wanted) {
    document.addEventListener("visibilitychange", changed);
    const channel =
      "BroadcastChannel" in globalThis
        ? new BroadcastChannel(CHANNEL)
        : undefined;
    channel?.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (typeof event.data === "string") wanted(event.data);
    });
    return {
      announce: (key) => channel?.postMessage(key),
      close: () => {
        document.removeEventListener("visibilitychange", changed);
        channel?.close();
      },
    };
  },
};

export interface SharedStreamOptions {
  locks: LockManager;
  /** The serialized binding the stream serves. */
  key: string;
  /** Opens the stream until `signal` aborts; each call it delivers goes to
   * `onCall` while it runs. */
  open: (
    signal: AbortSignal,
    onCall: (call: Promise<unknown>) => void,
  ) => Promise<unknown>;
  signals: TabSignals;
  signal: AbortSignal;
}

function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * Holds a stream that one tab of the browser profile serves at a time, under
 * the Web Lock `erato.executor-stream:<key>`. Every tab queues for it, so
 * another takes over when the holder closes. The stream follows the tab the
 * user uses: a tab in use that waits holds the shared lock
 * `erato.executor-stream-wanted:<key>` and announces it, and a holder that is
 * not in use hands the stream over once no call it delivered still runs, as a
 * delivered call is sent again only to a later stream of the same tab. A tab
 * granted the lock while not in use passes it on unopened when a tab in use
 * waits. Resolves when `signal` aborts or the stream ends by itself.
 */
export function holdSharedStream({
  locks,
  key,
  open,
  signals,
  signal,
}: SharedStreamOptions): Promise<void> {
  const name = `erato.executor-stream:${key}`;
  const wanted = `erato.executor-stream-wanted:${key}`;
  return new Promise((resolve) => {
    let inUse = signals.inUse();
    let settling: ReturnType<typeof setTimeout> | undefined;
    let calls = 0;
    let holding = false;
    let ended = false;
    /** The stream's lock request: aborting it withdraws the request, or ends
     * the stream it holds. */
    let turn: AbortController | undefined;
    let marker: AbortController | undefined;

    const isWanted = async () => {
      const { held = [] } = await locks.query().catch(() => ({ held: [] }));
      return held.some((lock) => lock.name === wanted);
    };
    const handOver = async () => {
      const current = turn;
      const idle = () => current === turn && holding && !inUse && calls === 0;
      if (current && idle() && (await isWanted()) && idle()) current.abort();
    };
    const mark = () => {
      const waits = inUse && !holding && !ended;
      if (waits && !marker) {
        const current = (marker = new AbortController());
        void locks
          .request(
            wanted,
            { mode: "shared", signal: current.signal },
            async () => {
              if (current.signal.aborted) return;
              connection.announce(key);
              await untilAborted(current.signal);
            },
          )
          .catch(() => {
            /* Withdrawn before it was granted. */
          });
      } else if (!waits && marker) {
        marker.abort();
        marker = undefined;
      }
    };
    const track = (call: Promise<unknown>) => {
      calls += 1;
      const settled = () => {
        calls -= 1;
        void handOver();
      };
      void call.then(settled, settled);
    };
    const queue = () => {
      if (ended || turn) return;
      const current = (turn = new AbortController());
      void locks
        .request(name, { signal: current.signal }, async () => {
          if (current.signal.aborted || (!inUse && (await isWanted())))
            return true;
          holding = true;
          mark();
          try {
            await open(current.signal, track);
          } finally {
            holding = false;
          }
          return current.signal.aborted;
        })
        .then(
          (again: boolean) => {
            turn = undefined;
            if (!again) {
              finish();
              return;
            }
            mark();
            queue();
          },
          () => finish(),
        );
    };
    const connection = signals.connect(
      () => {
        clearTimeout(settling);
        settling = setTimeout(() => {
          if (signals.inUse() === inUse) return;
          inUse = !inUse;
          mark();
          void handOver();
        }, SETTLE_MS);
      },
      (announced) => {
        if (announced === key) void handOver();
      },
    );
    const finish = () => {
      if (ended) return;
      ended = true;
      clearTimeout(settling);
      signal.removeEventListener("abort", finish);
      connection.close();
      turn?.abort();
      marker?.abort();
      marker = undefined;
      resolve();
    };
    if (signal.aborted) {
      finish();
      return;
    }
    signal.addEventListener("abort", finish, { once: true });
    mark();
    queue();
  });
}
