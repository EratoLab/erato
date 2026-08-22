/**
 * Minimal external store gating the Outlook anchor-policy evaluation.
 *
 * While held (the history drawer is open), mail-item switches defer instead
 * of interleaving a session toast under the drawer: the anchor effect
 * returns early without recording the anchor, so releasing re-evaluates the
 * latest state exactly once — and an explicit pick made during the hold has
 * already re-anchored, so that evaluation resolves silently.
 *
 * Counted rather than boolean so independent holders can never release each
 * other's hold.
 */
let holdCount = 0;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

export function holdSessionPolicy(): void {
  holdCount += 1;
  notify();
}

export function releaseSessionPolicy(): void {
  holdCount = Math.max(0, holdCount - 1);
  notify();
}

export function isSessionPolicyHeld(): boolean {
  return holdCount > 0;
}

export function subscribeSessionPolicyGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
