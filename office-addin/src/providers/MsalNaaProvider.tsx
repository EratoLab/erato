import { useCallback, useMemo, useState } from "react";

import {
  EntraGraphTokenProvider,
  graphUnavailableError,
  useGraphTokenOptional,
} from "./EntraGraphTokenProvider";
import { useOffice } from "./OfficeProvider";
import { SessionAuthProvider, useSessionAuth } from "./SessionAuthProvider";
import { createEntraNaaAuthSource } from "../auth/EntraNaaAuthSource";
import { UnsupportedAuthSource } from "../auth/UnsupportedAuthSource";
import { detectAuthMode } from "../auth/detectAuthMode";

import type {
  AuthSource,
  GraphCapableSource,
  LoginHintResolver,
} from "../auth/AuthSource";

/**
 * Back-compat hook: merges the host-agnostic session contract with the
 * Outlook-only Graph token. New code should prefer `useSessionAuth()` (session)
 * and `useGraphToken()` (Graph) directly; this keeps existing callers and tests
 * working unchanged while the seam lands.
 */
export function useMsalNaa() {
  const session = useSessionAuth();
  const graph = useGraphTokenOptional();

  const acquireToken = useCallback(
    (scopes: string[]): Promise<string> => {
      if (graph) {
        return graph.acquireToken(scopes);
      }
      return Promise.reject(graphUnavailableError());
    },
    [graph],
  );

  return {
    ...session,
    acquireToken,
  };
}

/**
 * Compatibility shim. The real work now lives in the host-agnostic
 * {@link SessionAuthProvider} (session lifecycle) + the Outlook-only
 * {@link EntraGraphTokenProvider} (Graph tokens). This wrapper is the single
 * place Outlook globals are read for auth: it builds the mailbox-aware login
 * hint and picks the {@link AuthSource} for the detected mode, then composes the
 * two providers. Excel/Word will eventually mount `SessionAuthProvider`
 * directly with a mailbox-less source and skip the Graph provider entirely.
 */
export function MsalNaaProvider({ children }: { children: React.ReactNode }) {
  const { mailboxUser } = useOffice();
  // Bumped on a retry-after-init-failure so the `source` memo re-runs
  // `detectAuthMode()` — without it the mode is frozen at first render and a
  // stale "unsupported" verdict could never recover.
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
      // Fall back to the mailbox profile below.
    }
    return mailboxUser?.emailAddress;
  }, [mailboxUser]);

  const source = useMemo<AuthSource>(() => {
    if (detectAuthMode() === "entra-msal") {
      return createEntraNaaAuthSource({ resolveLoginHint });
    }
    // No NAA. Host-aware heuristic: an Outlook mailbox surface means this is the
    // legacy on-prem / Exchange-callback case (not implemented yet); anything
    // else is a genuinely unsupported environment (keeps the existing NAA
    // message).
    //
    // TODO(exchange-se): this is NAA-presence + mailbox-presence only, NOT a
    // true cloud-vs-on-prem probe. In Step 0 both Unsupported reasons are
    // dead-end "not supported yet" states, so the label only changes the error
    // string — harmless. Replace with a real mailbox-environment probe (e.g.
    // accountType / ewsUrl host) when Exchange SE auth is actually wired, so a
    // NAA-less cloud host isn't mislabelled on-prem and vice versa.
    const isOutlookMailbox = (() => {
      try {
        return typeof Office !== "undefined" && !!Office.context?.mailbox;
      } catch {
        return false;
      }
    })();
    return new UnsupportedAuthSource(
      isOutlookMailbox ? "exchange-callback" : "unsupported",
    );
    // rebuildNonce is intentionally a dep: a retry-after-init-failure bumps it
    // to force re-detection of the mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildNonce is a recompute trigger, not read in the body
  }, [resolveLoginHint, rebuildNonce]);

  return (
    <SessionAuthProvider
      authSource={source}
      onReinitialize={() => setRebuildNonce((nonce) => nonce + 1)}
    >
      {source.mode === "entra-msal" ? (
        <EntraGraphTokenProvider
          source={source as AuthSource & GraphCapableSource}
        >
          {children}
        </EntraGraphTokenProvider>
      ) : (
        children
      )}
    </SessionAuthProvider>
  );
}
