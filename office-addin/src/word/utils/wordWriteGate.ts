import type { WordDocumentCapture } from "./wordDocumentCapture";

/**
 * Why a write is not available for a message. The card maps each code to a
 * stated reason; nothing is ever silently disabled.
 */
export type WordWriteBlockReason =
  /**
   * This pane no longer knows what was sent — the capture map is in-memory,
   * so a pane reload empties it. Never degraded into a text search.
   */
  | "no-capture"
  /**
   * The open document is not the one the answer was written about (or the
   * identity is unknown on one side). Unknown fails closed: a missed apply is
   * recoverable, a write into the wrong document is not.
   */
  | "identity-mismatch";

export type WordWriteGate =
  | { allowed: true; capture: WordDocumentCapture }
  | { allowed: false; reason: WordWriteBlockReason };

/**
 * Shared check for card availability and execution. Recheck during execution
 * because the user may switch documents while a confirmation is open.
 * Insertion also requires the original capture even though it uses no ordinals.
 */
export function resolveWordWriteGate(args: {
  capture: WordDocumentCapture | undefined;
  /** Identity stamped on the message at send time (`HostArtifact.itemIdentity`). */
  expectedIdentity: string | undefined;
  /** Identity of the document this pane has open right now. */
  currentIdentity: string | null;
}): WordWriteGate {
  if (!args.capture) {
    return { allowed: false, reason: "no-capture" };
  }
  if (
    !args.expectedIdentity ||
    !args.currentIdentity ||
    args.expectedIdentity !== args.currentIdentity ||
    args.capture.identity !== args.currentIdentity
  ) {
    return { allowed: false, reason: "identity-mismatch" };
  }
  return { allowed: true, capture: args.capture };
}
