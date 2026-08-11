/**
 * The Office probe reads `Office.context.requirements`, absent in a Teams tab.
 * The bridge TeamsJS installs is the only reliable signal here:
 * `isNAAChannelRecommended()` reports a host preference and is false on hosts
 * where NAA works.
 */
export function isTeamsNestedAppAuthSupported(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const { nestedAppAuthBridge } = window as unknown as {
    nestedAppAuthBridge?: unknown;
  };
  return nestedAppAuthBridge !== undefined;
}
