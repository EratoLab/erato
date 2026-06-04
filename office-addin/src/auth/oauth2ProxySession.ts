export const OAUTH2_PROXY_REDEEM_EXTERNAL_TOKEN_PATH =
  "/oauth2/redeem-external-token";

export const OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS = 20 * 60 * 1000;

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
}

export class Oauth2ProxySessionRedeemError extends Error {
  readonly status: number | null;
  readonly responseBody: string | null;

  constructor(
    message: string,
    options: { status?: number; body?: string } = {},
  ) {
    super(message);
    this.name = "Oauth2ProxySessionRedeemError";
    this.status = options.status ?? null;
    this.responseBody = options.body ?? null;
  }
}

export function shouldRefreshOauth2ProxySession(
  lastRedeemedAt: number | null,
  now = Date.now(),
): boolean {
  return (
    lastRedeemedAt === null ||
    now - lastRedeemedAt >= OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS
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
  const response = await fetcher(OAUTH2_PROXY_REDEEM_EXTERNAL_TOKEN_PATH, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRedeemRequestBody(input)),
  });

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
  storeOauth2ProxySessionRedeemedAt(redeemedAt);
  return { redeemedAt };
}
