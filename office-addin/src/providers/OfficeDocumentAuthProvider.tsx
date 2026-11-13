import { createEntraNaaAuthSource } from "../auth/EntraNaaAuthSource";
import { isNestedAppAuthSupported } from "../auth/isNestedAppAuthSupported";
import { NaaOrProxyLoginProvider } from "../core/NaaOrProxyLoginProvider";

import type { AuthSource, LoginHintResolver } from "../core/auth/AuthSource";

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
function createDocumentNaaSource(): AuthSource | null {
  if (!isNestedAppAuthSupported()) {
    return null;
  }
  return createEntraNaaAuthSource({ resolveLoginHint, requireBridge: true });
}

/**
 * Word, Excel and PowerPoint sign in through NAA where Office provides its
 * bridge (Windows and Mac), and otherwise through the oauth2-proxy popup
 * login: the web hosts, which report the NestedAppAuth requirement set without
 * the bridge, and desktop builds that don't report NestedAppAuth at all.
 */
export function OfficeDocumentAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NaaOrProxyLoginProvider createNaaSource={createDocumentNaaSource}>
      {children}
    </NaaOrProxyLoginProvider>
  );
}
