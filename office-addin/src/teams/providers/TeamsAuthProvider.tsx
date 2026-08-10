import { t } from "@lingui/core/macro";
import { nestedAppAuth } from "@microsoft/teams-js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useTeams } from "./TeamsProvider";
import { createEntraNaaAuthSource } from "../../auth/EntraNaaAuthSource";
import { UnsupportedAuthSource } from "../../auth/UnsupportedAuthSource";
import { SessionAuthProvider } from "../../core/SessionAuthProvider";
import { GraphTokenProvider } from "../../core/auth/GraphTokenProvider";
import { isTeamsNestedAppAuthSupported } from "../auth/isTeamsNestedAppAuthSupported";

import type {
  AuthSource,
  GraphCapableSource,
  LoginHintResolver,
} from "../../core/auth/AuthSource";
import type { GraphSignInPrompt } from "../../core/auth/GraphTokenProvider";

/** Never throws: a diagnostic must not take down the tree it is explaining. */
function readNaaChannelRecommendation(): boolean | "unknown" {
  try {
    return nestedAppAuth.isNAAChannelRecommended();
  } catch {
    return "unknown";
  }
}

/**
 * Builds MSAL below `TeamsProvider`: the NAA bridge only exists after the
 * TeamsJS handshake, and a client built earlier degrades to a non-nested one
 * permanently. Teams has no Exchange or oauth2-proxy fallback.
 */
export function TeamsAuthProvider({ children }: { children: React.ReactNode }) {
  const { hostName, hostClientType, userPrincipalName } = useTeams();
  const [rebuildNonce, setRebuildNonce] = useState(0);

  const resolveLoginHint = useCallback<LoginHintResolver>(
    () => Promise.resolve(userPrincipalName ?? undefined),
    [userPrincipalName],
  );

  const plan = useMemo<
    | { kind: "naa"; source: AuthSource & GraphCapableSource }
    | { kind: "unsupported"; source: AuthSource }
  >(() => {
    // Probed per rebuild, so a retry re-runs mode detection instead of being
    // answered from a verdict frozen at handshake time.
    if (!isTeamsNestedAppAuthSupported()) {
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

  useEffect(() => {
    if (plan.source.mode !== "unsupported") {
      return;
    }
    console.warn(
      "Teams tab has no nested app auth bridge; sign-in is unavailable",
      {
        hostName,
        hostClientType,
        isNaaChannelRecommended: readNaaChannelRecommendation(),
      },
    );
  }, [hostClientType, hostName, plan]);

  // Rebuilt every render so a locale switch re-translates; the provider's
  // callbacks depend on the string fields, not this object's identity.
  const graphPrompt: GraphSignInPrompt = {
    dedupeKey: "graph-teams-signin",
    title: t({
      id: "officeAddin.teams.signInToLoad.title",
      message: "Sign in to load Teams chats",
    }),
    description: t({
      id: "officeAddin.teams.signInToLoad.description",
      message: "Reading your Teams chats needs a quick sign-in.",
    }),
    action: t({
      id: "officeAddin.teams.signInToLoad.action",
      message: "Sign in",
    }),
    signedInTitle: t({
      id: "officeAddin.teams.signedIn.title",
      message: "Signed in. Try adding the chat again.",
    }),
  };

  return (
    <SessionAuthProvider
      authSource={plan.source}
      onReinitialize={() => setRebuildNonce((nonce) => nonce + 1)}
    >
      {plan.kind === "naa" ? (
        <GraphTokenProvider source={plan.source} prompt={graphPrompt}>
          {children}
        </GraphTokenProvider>
      ) : (
        children
      )}
    </SessionAuthProvider>
  );
}
