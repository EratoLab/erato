import type { WordDocumentCapture } from "./wordDocumentCapture";

export type WordWriteBlockReason =
  /** Pane reloads lose the in-memory capture; text search cannot reconstruct ownership. */
  "no-capture" | "identity-mismatch";

export type WordWriteGate =
  | { allowed: true; capture: WordDocumentCapture }
  | { allowed: false; reason: WordWriteBlockReason };

/** Recheck at execution: the user may switch documents while confirmation is open.
 * Insertion also requires the original capture, even though it uses no ordinals. */
export function resolveWordWriteGate(args: {
  capture: WordDocumentCapture | undefined;
  expectedIdentity: string | undefined;
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
