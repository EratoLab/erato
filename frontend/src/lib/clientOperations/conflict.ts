/**
 * Whether a client-operation route refused with 409. The routes answer it for
 * every attempt they can no longer act on (already settled, not claimable
 * yet, claimed elsewhere), with a plain-text reason, so the status is all a
 * caller can tell them apart by.
 */
export function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 409
  );
}
