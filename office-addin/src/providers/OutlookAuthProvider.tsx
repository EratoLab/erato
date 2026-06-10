import { useCallback, useMemo, useState } from "react";

import { EntraGraphTokenProvider } from "./EntraGraphTokenProvider";
import { Oauth2ProxyLoginProvider } from "./Oauth2ProxyLoginProvider";
import { useOffice } from "./OfficeProvider";
import { SessionAuthProvider } from "./SessionAuthProvider";
import { createEntraNaaAuthSource } from "../auth/EntraNaaAuthSource";
import { UnsupportedAuthSource } from "../auth/UnsupportedAuthSource";
import { isNestedAppAuthSupported } from "../auth/isNestedAppAuthSupported";

import type {
  AuthSource,
  GraphCapableSource,
  LoginHintResolver,
} from "../auth/AuthSource";

/**
 * The Outlook host's auth composition root. This is the single place Outlook
 * globals are read for auth: it detects whether Nested App Auth is available,
 * reads Outlook surfaces (the mailbox-aware login hint, the mailbox probe), and
 * picks one of three auth paths:
 *
 *   - EXO (Microsoft 365): silent NAA → {@link createEntraNaaAuthSource}
 *     (mode `entra-msal`), redeemed for the proxy session via the client-side
 *     id_token, with the Outlook-only {@link EntraGraphTokenProvider} (Graph
 *     mail tokens) layered on top.
 *   - On-prem-but-hybrid SE (a NAA-less mailbox): the oauth2-proxy redirect
 *     login (popup) via {@link Oauth2ProxyLoginProvider}. NAA is unavailable
 *     here and the add-in is served through oauth2-proxy, so the proxy already
 *     federates to the same Entra tenant and performs the full OIDC login with
 *     ITS OWN app registration — no add-in MSAL app reg, no client-side token,
 *     no redeem-external-token. That provider supplies the {@link
 *     SessionAuthProvider} context itself, so no `AuthSource` and no Graph
 *     provider are mounted on this path.
 *   - The residual no-mailbox case: {@link UnsupportedAuthSource}.
 *
 * All the Outlook coupling stays here. A future host (Excel/Word) writes its own
 * `<Host>AuthProvider` that wires its host-scoped probes into the same shared
 * sources and mounts the same `SessionAuthProvider` — typically with a
 * mailbox-less source and no Graph provider.
 */
export function OutlookAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { mailboxUser } = useOffice();
  // Bumped on a retry-after-init-failure so the `source` memo re-runs the NAA
  // probe — without it the verdict is frozen at first render and a stale
  // "unsupported" verdict could never recover.
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

  // The chosen path. NAA and the unsupported fallback build a host-agnostic
  // AuthSource for SessionAuthProvider; the SE path renders the proxy-login
  // provider instead (it supplies the session context itself, with no
  // client-side AuthSource and no Graph token).
  const plan = useMemo<
    | { kind: "naa"; source: AuthSource & GraphCapableSource }
    | { kind: "oauth2-proxy" }
    | { kind: "unsupported"; source: AuthSource }
  >(() => {
    if (isNestedAppAuthSupported()) {
      return {
        kind: "naa",
        source: createEntraNaaAuthSource({ resolveLoginHint }),
      };
    }
    // No NAA. If a mailbox is present, the user is on OWA with an Entra
    // identity served through oauth2-proxy (hybrid on-prem Exchange SE): the
    // proxy performs its own OIDC redirect login and sets the session cookie,
    // so we run that popup flow rather than a client-side MSAL acquisition. A
    // non-mailbox host has no Entra identity to log in with, so it stays
    // unsupported.
    const isOutlookMailbox = (() => {
      try {
        return typeof Office !== "undefined" && !!Office.context?.mailbox;
      } catch {
        return false;
      }
    })();
    if (isOutlookMailbox) {
      return { kind: "oauth2-proxy" };
    }
    return {
      kind: "unsupported",
      source: new UnsupportedAuthSource("unsupported"),
    };
    // rebuildNonce is intentionally a dep: a retry-after-init-failure bumps it
    // to force re-detection of the mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildNonce is a recompute trigger, not read in the body
  }, [resolveLoginHint, rebuildNonce]);

  if (plan.kind === "oauth2-proxy") {
    return <Oauth2ProxyLoginProvider>{children}</Oauth2ProxyLoginProvider>;
  }

  return (
    <SessionAuthProvider
      authSource={plan.source}
      onReinitialize={() => setRebuildNonce((nonce) => nonce + 1)}
    >
      {plan.kind === "naa" ? (
        <EntraGraphTokenProvider source={plan.source}>
          {children}
        </EntraGraphTokenProvider>
      ) : (
        children
      )}
    </SessionAuthProvider>
  );
}
