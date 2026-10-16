import { createEntraNaaAuthSource } from "../../auth/EntraNaaAuthSource";
import { isNestedAppAuthSupported } from "../../auth/isNestedAppAuthSupported";
import { NaaOrProxyLoginProvider } from "../../core/NaaOrProxyLoginProvider";

import type { AuthSource, LoginHintResolver } from "../../core/auth/AuthSource";

const resolveLoginHint: LoginHintResolver = async () => {
  try {
    if (typeof Office !== "undefined" && Office.auth?.getAuthContext) {
      const authContext = await Office.auth.getAuthContext();
      if (authContext?.userPrincipalName) {
        return authContext.userPrincipalName;
      }
    }
  } catch {
    // MSAL can prompt for an account when the optional profile hint is unavailable.
  }
  return undefined;
};

// Re-run on every probe: a cached verdict would survive a repaired NAA host.
function createWordNaaSource(): AuthSource | null {
  if (!isNestedAppAuthSupported()) {
    return null;
  }
  return createEntraNaaAuthSource({ resolveLoginHint, requireBridge: true });
}

/**
 * Word signs in through NAA where Office provides its bridge (Word on Windows
 * and Mac), and through the oauth2-proxy popup login where it doesn't (Word on
 * the web, which still reports the NestedAppAuth requirement set).
 */
export function WordAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <NaaOrProxyLoginProvider createNaaSource={createWordNaaSource}>
      {children}
    </NaaOrProxyLoginProvider>
  );
}
