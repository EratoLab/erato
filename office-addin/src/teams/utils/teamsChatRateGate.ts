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

/**
 * Graph's List chats / Get chat ceiling is 5 request STARTS per second per
 * user. A concurrency cap alone cannot honour that — fast responses hand
 * slots on faster than 5/s — so starts are paced instead: 200ms plus headroom.
 */
export const MIN_CHAT_METADATA_START_INTERVAL_MS = 220;

interface ChatGate {
  /**
   * Resolves when the next entrant may proceed: at request START for the
   * metadata gate (starts are what Graph's 5 rps ceiling counts, so requests
   * may overlap), at COMPLETION for the per-chat gate (deliberate — 1 rps
   * plus headroom for in-flight overlap).
   */
  tail: Promise<void>;
  lastStartedAt: number;
}

function freshGate(): ChatGate {
  return { tail: Promise.resolve(), lastStartedAt: Number.NEGATIVE_INFINITY };
}

const gates = new Map<string, ChatGate>();

/** All chats share one metadata gate — the 5 rps ceiling is per user. */
let metadataGate = freshGate();

/** Test seam — production code never resets the module-level gates. */
export function resetTeamsChatRateGates(): void {
  gates.clear();
  metadataGate = freshGate();
  inFlightSlots = 0;
  waitingForSlot.length = 0;
}

/**
 * Chat reads in flight across DIFFERENT chats. The per-chat gate does not
 * bound these — a search page can point at 25 unlisted chats, which would
 * otherwise resolve as one burst against the per-user ceiling.
 */
export const MAX_CONCURRENT_CHAT_READS = 4;

let inFlightSlots = 0;
const waitingForSlot: Array<() => void> = [];

export async function runWithChatReadSlot<T>(
  run: () => Promise<T>,
): Promise<T> {
  if (inFlightSlots >= MAX_CONCURRENT_CHAT_READS) {
    await new Promise<void>((resolve) => waitingForSlot.push(resolve));
  } else {
    inFlightSlots += 1;
  }
  try {
    return await run();
  } finally {
    // Hand the slot straight to the next waiter: releasing it first would let
    // an arriving caller take it and put one more request over the ceiling.
    const next = waitingForSlot.shift();
    if (next) next();
    else inFlightSlots -= 1;
  }
}

async function runPaced<T>(
  gate: ChatGate,
  intervalMs: number,
  releaseOnStart: boolean,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previous = gate.tail;
  let release: () => void = () => undefined;
  gate.tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    await previous;
    const waitMs = gate.lastStartedAt + intervalMs - Date.now();
    if (Number.isFinite(waitMs) && waitMs > 0) {
      await sleep(waitMs, signal);
    }
    gate.lastStartedAt = Date.now();
    if (releaseOnStart) release();
    return await run();
  } finally {
    // Resolving twice is a no-op, so for a start-released gate this is only
    // the abort path: an entrant that dies queued must still free the tail.
    release();
  }
}

export async function runGatedByChat<T>(
  chatId: string,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const gate = gates.get(chatId) ?? freshGate();
  gates.set(chatId, gate);
  return runPaced(gate, MIN_CHAT_REQUEST_INTERVAL_MS, false, signal, run);
}

/** Paces the start of a List chats / Get chat call under the per-user ceiling. */
export async function runAtChatMetadataRate<T>(
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  return runPaced(
    metadataGate,
    MIN_CHAT_METADATA_START_INTERVAL_MS,
    true,
    signal,
    run,
  );
}
