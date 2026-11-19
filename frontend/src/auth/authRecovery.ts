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
/** After a recovery renewed the session, signed-out answers within this span are replayed without
 * another: a 403 page that outlives a fresh renewal (an authorization page, a WAF, a dropped cookie)
 * would otherwise cost every request a forced token refresh. */
const RECOVERED_REPLAY_MS = 30_000;
let recoveredAt = Number.NEGATIVE_INFINITY;

/** Register (or clear, with `null`) the recovery handler. Add-in shell only. */
export function setAuthRecoveryHandler(next: AuthRecoveryHandler | null) {
  handler = next;
  recoveredAt = Number.NEGATIVE_INFINITY;
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
  if (Date.now() - recoveredAt < RECOVERED_REPLAY_MS) return true;
  try {
    const recovered = await handler(reason);
    if (recovered) recoveredAt = Date.now();
    return recovered;
  } catch {
    return false;
  }
}

/**
 * The proxy turned the request away for want of a session: a 401, or the 403 sign-in page
 * oauth2-proxy serves to a request that does not ask for JSON (no `api_routes` in a deployment).
 * The backend's own 403s carry JSON or no body, never an HTML page.
 */
export function isSignedOutResponse(response: Response): boolean {
  return (
    response.status === 401 ||
    (response.status === 403 &&
      (response.headers.get("content-type") ?? "").includes("text/html"))
  );
}

/**
 * Sends a request, and once the proxy turns it away as signed out, recovers the session and sends
 * it again. Safe for any request: a signed-out answer never reached the backend. `send` must build
 * the request afresh, so the resend carries the renewed session's headers.
 */
export async function fetchWithAuthRecovery(
  send: () => Promise<Response>,
  reason: string,
): Promise<Response> {
  const response = await send();
  if (!isSignedOutResponse(response) || !(await tryRecoverAuth(reason)))
    return response;
  return send();
}
