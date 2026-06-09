import { toast } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { createContext, useCallback, useContext, useMemo } from "react";

import { useSessionRedeem } from "./SessionAuthProvider";
import {
  InteractionRequiredError,
  type AuthSource,
  type GraphCapableSource,
} from "../auth/AuthSource";
import { shouldRefreshOauth2ProxySession } from "../auth/oauth2ProxySession";

/** Dedupe key so repeated failed email drops replace (not stack) the prompt. */
const GRAPH_SIGNIN_TOAST_KEY = "graph-email-signin";

export interface GraphTokenContextValue {
  /**
   * Microsoft Graph access token for the given scopes (e.g. `["Mail.Read"]`).
   * Silent by default (never auto-popups). `{ forceRefresh: true }` bypasses the
   * MSAL cache (Graph 401-retry); `{ allowInteraction: true }` permits a popup
   * and is used only by the user-initiated "Sign in" action.
   */
  acquireToken: (
    scopes: string[],
    options?: { forceRefresh?: boolean; allowInteraction?: boolean },
  ) => Promise<string>;
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

  // Explicit, user-initiated interactive sign-in for Graph (Mail.Read). Fired
  // ONLY from the toast's "Sign in" action (a real click), never automatically.
  const signInForGraph = useCallback(
    async (scopes: string[]): Promise<void> => {
      await source.acquireGraphToken(scopes, { allowInteraction: true });
      toast.success({
        dedupeKey: GRAPH_SIGNIN_TOAST_KEY,
        title: t({
          id: "officeAddin.email.signedIn.title",
          message: "Signed in. Add the email again to attach it.",
        }),
      });
    },
    [source],
  );

  const acquireToken = useCallback(
    async (
      scopes: string[],
      options?: { forceRefresh?: boolean; allowInteraction?: boolean },
    ): Promise<string> => {
      try {
        const { accessToken, bootstrap } = await source.acquireGraphToken(
          scopes,
          options,
        );
        // Opportunistically warm the proxy session from the token we just got,
        // but only if it's gone stale — reusing the core's dedup + staleness ref.
        if (shouldRefreshOauth2ProxySession(lastRedeemedAtRef.current)) {
          await redeemSessionForToken(bootstrap, "refreshing");
        }
        return accessToken;
      } catch (error) {
        // Silent Graph acquire needs the user to sign in (first-run consent or a
        // Conditional-Access policy on the Graph resource). Do NOT auto-popup
        // mid-drop — surface a deduped, email-scoped "Sign in" prompt and let the
        // email fetch fail gracefully (it just doesn't attach). The chat session
        // is unaffected.
        if (
          error instanceof InteractionRequiredError &&
          !options?.allowInteraction
        ) {
          toast.warning({
            dedupeKey: GRAPH_SIGNIN_TOAST_KEY,
            title: t({
              id: "officeAddin.email.signInToLoad.title",
              message: "Sign in to load email",
            }),
            description: t({
              id: "officeAddin.email.signInToLoad.description",
              message:
                "This email wasn't attached because reading it needs a quick sign-in.",
            }),
            actions: [
              {
                id: "graph-signin",
                label: t({
                  id: "officeAddin.email.signInToLoad.action",
                  message: "Sign in",
                }),
                variant: "primary",
                onClick: () => {
                  void signInForGraph(scopes).catch(() => {
                    // Popup cancelled/blocked — leave the prompt in place.
                  });
                },
              },
            ],
          });
        }
        throw error;
      }
    },
    [lastRedeemedAtRef, redeemSessionForToken, signInForGraph, source],
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
