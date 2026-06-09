import { getIdToken } from "./tokenStore";

type HeaderRecord = Record<string, string>;

function hasHeader(headers: HeaderRecord, headerName: string): boolean {
  return Object.keys(headers).some(
    (key) => key.toLowerCase() === headerName.toLowerCase(),
  );
}

export function mergeApiAuthHeaders(
  headers: Record<string, string | undefined> = {},
): HeaderRecord {
  const definedHeaders = Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined),
  ) as HeaderRecord;

  if (hasHeader(definedHeaders, "authorization")) {
    return definedHeaders;
  }

  // The web app leaves this null (cookie auth). The Office add-in populates it,
  // but for the add-in this Bearer is INCIDENTAL, not the auth source of truth:
  // requests are authenticated by the oauth2-proxy session cookie minted at
  // /oauth2/redeem-external-token. The add-in's MSAL token is a separate app
  // registration from oauth2-proxy's, and there is no `oidc_extra_audiences`, so
  // the proxy does not accept this Bearer — it falls through to the cookie. Kept
  // as a harmless best-effort header; do not treat its freshness as load-bearing.
  const idToken = getIdToken();
  if (!idToken) {
    return definedHeaders;
  }

  return {
    ...definedHeaders,
    // eslint-disable-next-line lingui/no-unlocalized-strings -- HTTP auth scheme literal
    Authorization: `Bearer ${idToken}`,
  };
}
