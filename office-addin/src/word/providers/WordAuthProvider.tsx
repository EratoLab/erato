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

/**
 * Word's auth composition — the mailbox-less host `OutlookAuthProvider`'s doc
 * comment anticipates. Two branches, not Outlook's three:
 *
 *   - Nested App Auth, where the Office host brokers an Entra token. This is
 *     every supported Word surface: the activation floor already excludes the
 *     builds that predate NAA.
 *   - {@link UnsupportedAuthSource} otherwise.
 *
 * Deliberately absent: the Exchange on-prem / oauth2-proxy branch (there is no
 * mailbox to be on premises), and any Graph token provider (nothing in Word v1
 * reads Graph — the document arrives through Office.js).
 *
 * On Word for the web this path additionally depends on a per-deployment SPA
 * redirect URI registration; without it the shell renders and never clears
 * `AuthGate`. The setup page surfaces that step.
 */
export function WordAuthProvider({ children }: { children: React.ReactNode }) {
  // Bumped on a retry-after-init-failure so the plan memo re-runs the NAA
  // probe — without it the verdict is frozen at first render and a stale
  // "unsupported" verdict could never recover.
  const [rebuildNonce, setRebuildNonce] = useState(0);

  /**
   * The host's own identity claim. Word has no mailbox profile to fall back
   * to, so an absent auth context simply means "no hint" and MSAL prompts for
   * the account. Never throws: a missing hint must not take down the tree.
   */
  const resolveLoginHint = useCallback<LoginHintResolver>(async () => {
    try {
      if (typeof Office !== "undefined" && Office.auth?.getAuthContext) {
        const authContext = await Office.auth.getAuthContext();
        if (authContext?.userPrincipalName) {
          return authContext.userPrincipalName;
        }
      }
    } catch {
      // No hint available; fall through.
    }
    return undefined;
  }, []);

  const plan = useMemo<
    | { kind: "naa"; source: AuthSource & GraphCapableSource }
    | { kind: "unsupported"; source: AuthSource }
  >(() => {
    // Probed per rebuild, so an AuthGate retry re-runs mode detection instead
    // of being answered from a verdict frozen at mount.
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
