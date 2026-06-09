import { t } from "@lingui/core/macro";
import { createContext, useCallback, useContext, useMemo } from "react";

import { useSessionRedeem } from "./SessionAuthProvider";
import { type AuthSource, type GraphCapableSource } from "../auth/AuthSource";
import { shouldRefreshOauth2ProxySession } from "../auth/oauth2ProxySession";

export interface GraphTokenContextValue {
  /** Microsoft Graph access token for the given scopes (e.g. `["Mail.Read"]`). */
  acquireToken: (scopes: string[]) => Promise<string>;
}

const GraphTokenContext = createContext<GraphTokenContextValue | null>(null);

/** The error raised when Graph auth is requested on a host without it (no
 * EntraGraphTokenProvider mounted). Shared so the throwing `useGraphToken` and
 * the back-compat `useMsalNaa` shim surface an identical message. */
export function graphUnavailableError(): Error {
  return new Error(
    t({
      id: "officeAddin.auth.graphUnavailable",
      message: "Graph auth is not available on this host",
    }),
  );
}

export function useGraphToken(): GraphTokenContextValue {
  const value = useContext(GraphTokenContext);
  if (!value) {
    throw graphUnavailableError();
  }
  return value;
}

/**
 * Non-throwing variant for callers that may run outside the Graph provider
 * (e.g. the back-compat `useMsalNaa()` shim in unsupported/non-Outlook modes).
 */
export function useGraphTokenOptional(): GraphTokenContextValue | null {
  return useContext(GraphTokenContext);
}

/**
 * Outlook-only provider for Microsoft Graph access tokens. Mounted ONLY in the
 * Outlook subtree; Excel/Word never reference it. Lives inside
 * {@link SessionAuthProvider} so it can opportunistically refresh the proxy
 * session through the shared redeem seam from the token it already holds — no
 * second MSAL acquisition.
 */
export function EntraGraphTokenProvider({
  source,
  children,
}: {
  source: AuthSource & GraphCapableSource;
  children: React.ReactNode;
}) {
  const { redeemSessionForToken, lastRedeemedAtRef } = useSessionRedeem();

  const acquireToken = useCallback(
    async (scopes: string[]): Promise<string> => {
      const { accessToken, bootstrap } = await source.acquireGraphToken(scopes);
      // Opportunistically warm the proxy session from the token we just got,
      // but only if it's gone stale — reusing the core's dedup + staleness ref.
      if (shouldRefreshOauth2ProxySession(lastRedeemedAtRef.current)) {
        await redeemSessionForToken(bootstrap, "refreshing");
      }
      return accessToken;
    },
    [lastRedeemedAtRef, redeemSessionForToken, source],
  );

  const value = useMemo<GraphTokenContextValue>(
    () => ({ acquireToken }),
    [acquireToken],
  );

  return (
    <GraphTokenContext.Provider value={value}>
      {children}
    </GraphTokenContext.Provider>
  );
}
