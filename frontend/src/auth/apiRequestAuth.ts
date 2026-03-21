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
