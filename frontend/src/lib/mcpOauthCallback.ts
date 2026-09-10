/* eslint-disable lingui/no-unlocalized-strings -- OAuth parameters and session storage keys */
const storageKey = (state: string) => `mcpOauthCallback:${state}`;

// Keep the server association across the redirect without adding it to the
// registered callback URL. The backend still validates the OAuth state.
export function storeMcpOauthCallback(
  authorizationUrl: string,
  serverId: string,
) {
  const state = new URL(authorizationUrl).searchParams.get("state");
  if (!state) throw new Error("Missing MCP OAuth state");
  sessionStorage.setItem(storageKey(state), serverId);
}

export function getMcpOauthServerId(state: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(state));
  } catch {
    return null;
  }
}

export function clearMcpOauthCallback(state: string) {
  try {
    sessionStorage.removeItem(storageKey(state));
  } catch {
    // URL cleanup must still work when browser storage is unavailable.
  }
}
