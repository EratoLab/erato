/**
 * Optional, injectable auth-recovery hook.
 *
 * The normal web app uses cookie auth with no client-side refresh, so it
 * registers NOTHING here and every export is a no-op for it. Alternate shells —
 * the Office add-in — register a handler that, on a 401, re-acquires a fresh
 * bootstrap token and re-redeems the oauth2-proxy session so the caller can
 * replay the failed request once. Mirrors the {@link "./tokenStore"} injection
 * pattern.
 */

/**
 * Attempts to recover authentication after a 401. Resolves `true` when the
 * session was refreshed (the caller may replay the request once) and `false`
 * when recovery is unavailable or failed (the caller keeps its existing
 * behaviour).
 */
export type AuthRecoveryHandler = (reason: string) => Promise<boolean>;

let handler: AuthRecoveryHandler | null = null;

/** Register (or clear, with `null`) the recovery handler. Add-in shell only. */
export function setAuthRecoveryHandler(next: AuthRecoveryHandler | null) {
  handler = next;
}

/**
 * Runs the registered recovery handler, if any. Returns `false` immediately
 * when none is registered (the web app), which makes every 401 call site a
 * no-op there. Swallows handler errors as a failed recovery. The handler is
 * expected to dedupe concurrent recoveries itself.
 */
export async function tryRecoverAuth(reason: string): Promise<boolean> {
  if (!handler) {
    return false;
  }
  try {
    return await handler(reason);
  } catch {
    return false;
  }
}
