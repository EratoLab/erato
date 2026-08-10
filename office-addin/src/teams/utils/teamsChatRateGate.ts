/**
 * Serialises Graph requests per chat. Graph allows 20 rps per app for chat
 * message reads but only **1 rps against a single chat**, so paging one
 * conversation is inherently sequential; different chats still overlap.
 *
 * The gate chains onto the previous request's tail rather than comparing a
 * bare timestamp: two callers reaching the gate together would otherwise both
 * read the same stale `lastStartedAt` and fire simultaneously.
 */

import { sleep } from "../../utils/graph/graphClient";

/** 1 rps plus headroom for clock skew and in-flight request overlap. */
export const MIN_CHAT_REQUEST_INTERVAL_MS = 1100;

interface ChatGate {
  /** Resolves once the currently queued request has started. */
  tail: Promise<void>;
  lastStartedAt: number;
}

const gates = new Map<string, ChatGate>();

/** Test seam — production code never resets the module-level gates. */
export function resetTeamsChatRateGates(): void {
  gates.clear();
}

export async function runGatedByChat<T>(
  chatId: string,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const gate = gates.get(chatId) ?? {
    tail: Promise.resolve(),
    lastStartedAt: Number.NEGATIVE_INFINITY,
  };
  gates.set(chatId, gate);

  const previous = gate.tail;
  let release: () => void = () => undefined;
  gate.tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    await previous;
    const waitMs =
      gate.lastStartedAt + MIN_CHAT_REQUEST_INTERVAL_MS - Date.now();
    if (Number.isFinite(waitMs) && waitMs > 0) {
      await sleep(waitMs, signal);
    }
    gate.lastStartedAt = Date.now();
    return await run();
  } finally {
    release();
  }
}
