import { toast } from "@erato/frontend/library";
import { createContext, useCallback, useContext, useMemo } from "react";

import { useSessionRedeem } from "../SessionAuthProvider";
import { InteractionRequiredError } from "./AuthSource";
import { shouldRefreshOauth2ProxySession } from "./oauth2ProxySession";

import type { AuthSource, GraphCapableSource } from "./AuthSource";

/**
 * Host-supplied copy for the sign-in prompt. The message ids are stable
 * contracts (catalogs and component kits key on them), so each host binds its
 * own rather than sharing one email-flavoured set.
 */
export interface GraphSignInPrompt {
  /** Dedupe key so repeated failures replace (not stack) the prompt. */
  dedupeKey: string;
  title: string;
  description: string;
  action: string;
  signedInTitle: string;
}

export interface GraphTokenContextValue {
  /**
   * Microsoft Graph access token for the given scopes (e.g. `["Mail.Read"]`).
   * Silent by default (never auto-popups). `{ forceRefresh: true }` bypasses the
   * MSAL cache (Graph 401-retry); `{ allowInteraction: true }` permits a popup
   * and is used only by the user-initiated "Sign in" action.
   * `{ suppressSignInPrompt: true }` also skips the sign-in TOAST on failure —
   * for OPTIONAL scopes (directory search) whose absence is an expected steady
   * state the caller degrades on, not something to prompt the user over.
   */
  acquireToken: (
    scopes: string[],
    options?: {
      forceRefresh?: boolean;
      allowInteraction?: boolean;
      suppressSignInPrompt?: boolean;
    },
  ) => Promise<string>;
}

const GraphTokenContext = createContext<GraphTokenContextValue | null>(null);

/**
 * Reads the Graph token context, or null when no {@link GraphTokenProvider}
 * is mounted (any non-`entra-msal` host). Callers MUST handle null and degrade
 * — never assume Graph is available. New code that needs the session should use
 * `useSessionAuth()`, mail fetching should use `useOutlookMessageFetcher()`, and
 * only raw Graph-token needs reach for this hook.
 */
export function useGraphTokenOptional(): GraphTokenContextValue | null {
  return useContext(GraphTokenContext);
}

/**
 * Provider for Microsoft Graph access tokens, mounted by whichever host
 * composition has a Graph-capable source (Outlook NAA, Teams NAA). Lives inside
 * {@link SessionAuthProvider} so it can opportunistically refresh the proxy
 * session through the shared redeem seam from the token it already holds — no
 * second MSAL acquisition.
 */
export function GraphTokenProvider({
  source,
  prompt,
  children,
}: {
  source: AuthSource & GraphCapableSource;
  prompt: GraphSignInPrompt;
  children: React.ReactNode;
}) {
  const { redeemSessionForToken, lastRedeemedAtRef } = useSessionRedeem();

  // Explicit, user-initiated interactive sign-in for Graph. Fired ONLY from the
  // toast's "Sign in" action (a real click), never automatically.
  const signInForGraph = useCallback(
    async (scopes: string[]): Promise<void> => {
      await source.acquireGraphToken(scopes, { allowInteraction: true });
      toast.success({
        dedupeKey: prompt.dedupeKey,
        title: prompt.signedInTitle,
      });
    },
    [prompt.dedupeKey, prompt.signedInTitle, source],
  );

  const acquireToken = useCallback(
    async (
      scopes: string[],
      options?: {
        forceRefresh?: boolean;
        allowInteraction?: boolean;
        suppressSignInPrompt?: boolean;
      },
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
        // mid-action — surface a deduped "Sign in" prompt and let the fetch fail
        // gracefully. The chat session is unaffected.
        if (
          error instanceof InteractionRequiredError &&
          !options?.allowInteraction &&
          !options?.suppressSignInPrompt
        ) {
          toast.warning({
            dedupeKey: prompt.dedupeKey,
            title: prompt.title,
            description: prompt.description,
            actions: [
              {
                id: "graph-signin",
                label: prompt.action,
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
    [
      lastRedeemedAtRef,
      prompt.action,
      prompt.dedupeKey,
      prompt.description,
      prompt.title,
      redeemSessionForToken,
      signInForGraph,
      source,
    ],
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
