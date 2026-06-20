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

  // Optional Bearer for shells that opt into header auth. Both the web app and
  // the Office add-in currently leave this null and authenticate via the
  // oauth2-proxy session cookie (the add-in redeems its MSAL id token for that
  // cookie at /oauth2/redeem-external-token rather than sending it per request),
  // so this branch is inert today.
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
