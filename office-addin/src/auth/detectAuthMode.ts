/**
 * Host-agnostic auth-mode probe. Reasons ONLY about Nested App Auth support —
 * it deliberately knows nothing about the mailbox, Exchange, or Graph so the
 * seam stays reusable across Office hosts (Outlook today, Excel/Word later).
 *
 * The host-specific decision "no NAA but this is a mailbox ⇒ legacy on-prem
 * Exchange" lives in the Outlook wrapper, which is allowed to read Outlook
 * surfaces. Here we return only the host-agnostic verdict.
 */
export function detectAuthMode(): "entra-msal" | "unsupported" {
  try {
    const naaSupported =
      typeof Office !== "undefined" &&
      !!Office.context?.requirements?.isSetSupported("NestedAppAuth", "1.1");
    return naaSupported ? "entra-msal" : "unsupported";
  } catch {
    // Office absent (outside an add-in host) — nothing to authenticate against.
    return "unsupported";
  }
}
