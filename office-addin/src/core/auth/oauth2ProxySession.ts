export const OAUTH2_PROXY_REDEEM_EXTERNAL_TOKEN_PATH =
  "/oauth2/redeem-external-token";

/** Probes whether the oauth2-proxy session cookie is currently valid. */
export const OAUTH2_PROXY_AUTH_PATH = "/oauth2/auth";

/**
 * The proxy's sign-in page — a first-party 200 HTML page on the proxy origin
 * (when `skip_provider_button` is false). The login popup MUST enter here, NOT
 * at `/oauth2/start`: loading this same-origin page first establishes the
 * first-party cookie context so the CSRF cookie (`SameSite=None; Secure`, set on
 * the same 302 that cross-navigates to Entra) round-trips and the FIRST
 * `/oauth2/callback` succeeds. Entering at `/oauth2/start` (an immediate
 * cross-site 302) drops the CSRF cookie on the first pass → 403 "Unable to find
 * a valid CSRF token" → the double-login. Requires `skip_provider_button=false`.
 */
export const OAUTH2_PROXY_SIGN_IN_PATH = "/oauth2/sign_in";

export const OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS = 20 * 60 * 1000;
/** A session is renewed this long before it ends. A silent MSAL acquire hands out the cached token
 * until its last 5 minutes (tokenRenewalOffsetSeconds), so a renewal inside them gets a fresh one. */
export const OAUTH2_PROXY_SESSION_RENEW_BEFORE_END_MS = 4 * 60 * 1000;
/** A session redeemed from a token already in its last minutes is renewed this long after it ends,
 * when the host has to mint a fresh token. */
export const OAUTH2_PROXY_SESSION_RENEW_AFTER_END_MS = 2_000;
/** Timed renewals never come closer than this, whatever token the host hands out. */
export const OAUTH2_PROXY_SESSION_MIN_RENEW_INTERVAL_MS = 30_000;

const OAUTH2_PROXY_SESSION_REDEEMED_AT_STORAGE_KEY =
  "erato.officeAddin.oauth2ProxySessionRedeemedAt";

export interface RedeemOauth2ProxySessionInput {
  idToken: string;
  accessToken?: string;
  fetcher?: typeof fetch;
  now?: () => number;
}

export interface RedeemOauth2ProxySessionResult {
  redeemedAt: number;
  /** When the proxy ends the session; null when the tokens carry no expiry. */
  endsAt: number | null;
}

export class Oauth2ProxySessionRedeemError extends Error {
  readonly status: number | null;
  readonly responseBody: string | null;

  constructor(
    message: string,
    options: { status?: number; body?: string; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "Oauth2ProxySessionRedeemError";
    this.status = options.status ?? null;
    this.responseBody = options.body ?? null;
  }
}

function jwtExpiresAt(token: string | undefined): number | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    ) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** When oauth2-proxy ends a session redeemed from these tokens: at the access token's expiry, and at
 * the ID token's only without one (Erato's fork, CreateSessionFromExternalToken). */
export function oauth2ProxySessionEndsAt(token: {
  idToken: string;
  accessToken?: string;
}): number | null {
  return token.accessToken
    ? jwtExpiresAt(token.accessToken)
    : jwtExpiresAt(token.idToken);
}

/** When a session redeemed at `redeemedAt` is renewed: after the fixed interval, or before it ends
 * if that comes first. One redeemed from a token already in its last minutes is renewed just after
 * it ends, rather than over and over with the same cached token. */
export function oauth2ProxySessionRenewAt(
  redeemedAt: number,
  endsAt: number | null,
): number {
  const timed = redeemedAt + OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS;
  if (endsAt === null) return timed;
  const beforeEnd = endsAt - OAUTH2_PROXY_SESSION_RENEW_BEFORE_END_MS;
  return Math.max(
    redeemedAt + OAUTH2_PROXY_SESSION_MIN_RENEW_INTERVAL_MS,
    Math.min(
      timed,
      beforeEnd > redeemedAt
        ? beforeEnd
        : endsAt + OAUTH2_PROXY_SESSION_RENEW_AFTER_END_MS,
    ),
  );
}

export function shouldRefreshOauth2ProxySession(
  lastRedeemedAt: number | null,
  now = Date.now(),
  endsAt: number | null = null,
): boolean {
  return (
    lastRedeemedAt === null ||
    now >= oauth2ProxySessionRenewAt(lastRedeemedAt, endsAt)
  );
}

export function readStoredOauth2ProxySessionRedeemedAt(): number | null {
  try {
    const raw = window.localStorage.getItem(
      OAUTH2_PROXY_SESSION_REDEEMED_AT_STORAGE_KEY,
    );
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function storeOauth2ProxySessionRedeemedAt(redeemedAt: number) {
  try {
    window.localStorage.setItem(
      OAUTH2_PROXY_SESSION_REDEEMED_AT_STORAGE_KEY,
      String(redeemedAt),
    );
  } catch {
    // Best effort only. The in-memory state remains authoritative.
  }
}

function buildRedeemRequestBody(input: RedeemOauth2ProxySessionInput) {
  const idToken = input.idToken.trim();
  const accessToken = input.accessToken?.trim();

  if (!idToken) {
    throw new Oauth2ProxySessionRedeemError("Missing Microsoft ID token");
  }

  return accessToken
    ? { id_token: idToken, access_token: accessToken }
    : { id_token: idToken };
}

export async function redeemOauth2ProxySession({
  fetcher = window.fetch.bind(window),
  now = Date.now,
  ...input
}: RedeemOauth2ProxySessionInput): Promise<RedeemOauth2ProxySessionResult> {
  // Build the body before the request so a missing-token rejection surfaces as
  // a typed error rather than being reclassified as a network failure below.
  const body = JSON.stringify(buildRedeemRequestBody(input));

  let response: Response;
  try {
    response = await fetcher(OAUTH2_PROXY_REDEEM_EXTERNAL_TOKEN_PATH, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (networkError) {
    // fetch() rejects (offline, DNS, CORS, aborted) with a raw TypeError. Map it
    // onto the same typed error the callers already handle, preserving the cause.
    throw new Oauth2ProxySessionRedeemError(
      "OAuth2 session redemption could not reach oauth2-proxy",
      { cause: networkError },
    );
  }

  if (response.status !== 202) {
    let body: string | undefined;
    try {
      body = await response.text();
    } catch {
      body = undefined;
    }
    throw new Oauth2ProxySessionRedeemError(
      `OAuth2 session redemption failed with status ${response.status}`,
      { status: response.status, body },
    );
  }

  const redeemedAt = now();
  const endsAt = oauth2ProxySessionEndsAt(input);
  storeOauth2ProxySessionRedeemedAt(redeemedAt);
  return { redeemedAt, endsAt };
}

export interface CheckOauth2ProxySessionInput {
  fetcher?: typeof fetch;
  /** Optional abort signal threaded into the probe request so a caller's
   * timeout/teardown cancels the probe (it then rejects with the abort
   * reason) instead of leaving it running. */
  signal?: AbortSignal;
}

/**
 * Probes the proxy auth endpoint to learn whether the current oauth2-proxy
 * session cookie is valid. Used by the proxy-login path (which has no
 * client-side token to redeem): the proxy itself owns the OIDC login, so the
 * only client-side signal of "are we signed in" is whether the cookie passes.
 *
 * A 2xx (proxy returns 202 Accepted on success) resolves `true`; a 401/403
 * resolves `false` (sign-in required). A network failure rejects so the caller
 * can surface a recoverable error rather than silently treating the user as
 * signed out.
 */
export async function checkOauth2ProxySession({
  fetcher = window.fetch.bind(window),
  signal,
}: CheckOauth2ProxySessionInput = {}): Promise<boolean> {
  const response = await fetcher(OAUTH2_PROXY_AUTH_PATH, {
    method: "GET",
    credentials: "include",
    signal,
  });
  if (response.ok || response.status === 202) {
    return true;
  }
  if (response.status === 401 || response.status === 403) {
    return false;
  }
  throw new Oauth2ProxySessionRedeemError(
    `OAuth2 session probe failed with status ${response.status}`,
    { status: response.status },
  );
}
