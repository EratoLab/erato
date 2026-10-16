/**
 * Host-agnostic Nested App Auth (NAA) probe. Reasons ONLY about whether NAA is
 * available in the current Office host — it deliberately knows nothing about the
 * mailbox, Exchange, or Graph so the seam stays reusable across Office hosts
 * (Outlook today, Excel/Word later).
 *
 * NAA is no longer the only Entra path: a NAA-less host that still has an Entra
 * identity (Exchange SE OWA) authenticates via the oauth2-proxy redirect login
 * (see OutlookAuthProvider / Oauth2ProxyLoginProvider), not MSAL. That
 * host-specific decision lives in OutlookAuthProvider, which is allowed to read
 * Outlook surfaces. Here we return only the host-agnostic "is NAA available"
 * verdict.
 *
 * The requirement set is necessary but not sufficient: Word, Excel and
 * PowerPoint on the web report it without providing the NAA bridge. Word
 * therefore also requires the bridge (`createEntraNaaAuthSource`'s
 * `requireBridge`).
 */
export function isNestedAppAuthSupported(): boolean {
  try {
    return (
      typeof Office !== "undefined" &&
      !!Office.context?.requirements?.isSetSupported("NestedAppAuth", "1.1")
    );
  } catch {
    // Office absent (outside an add-in host) — no NAA.
    return false;
  }
}
