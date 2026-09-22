import { useCallback, useMemo, useState } from "react";

import { createEntraNaaAuthSource } from "../../auth/EntraNaaAuthSource";
import { UnsupportedAuthSource } from "../../auth/UnsupportedAuthSource";
import { isNestedAppAuthSupported } from "../../auth/isNestedAppAuthSupported";
import { SessionAuthProvider } from "../../core/SessionAuthProvider";

import type {
  AuthSource,
  GraphCapableSource,
  LoginHintResolver,
} from "../../core/auth/AuthSource";

export function WordAuthProvider({ children }: { children: React.ReactNode }) {
  // Re-probe on retry: a cached result would survive a repaired NAA bridge.
  const [rebuildNonce, setRebuildNonce] = useState(0);

  const resolveLoginHint = useCallback<LoginHintResolver>(async () => {
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
  }, []);

  const plan = useMemo<
    | { kind: "naa"; source: AuthSource & GraphCapableSource }
    | { kind: "unsupported"; source: AuthSource }
  >(() => {
    if (!isNestedAppAuthSupported()) {
      return {
        kind: "unsupported",
        source: new UnsupportedAuthSource("unsupported"),
      };
    }
    return {
      kind: "naa",
      source: createEntraNaaAuthSource({ resolveLoginHint }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildNonce is a recompute trigger, not read in the body
  }, [resolveLoginHint, rebuildNonce]);

  return (
    <SessionAuthProvider
      authSource={plan.source}
      onReinitialize={() => setRebuildNonce((nonce) => nonce + 1)}
    >
      {children}
    </SessionAuthProvider>
  );
}
