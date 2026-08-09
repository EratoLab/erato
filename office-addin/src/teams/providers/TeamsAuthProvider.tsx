import { nestedAppAuth } from "@microsoft/teams-js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useTeams } from "./TeamsProvider";
import { createEntraNaaAuthSource } from "../../auth/EntraNaaAuthSource";
import { UnsupportedAuthSource } from "../../auth/UnsupportedAuthSource";
import { SessionAuthProvider } from "../../core/SessionAuthProvider";
import { isTeamsNestedAppAuthSupported } from "../auth/isTeamsNestedAppAuthSupported";

import type { AuthSource, LoginHintResolver } from "../../core/auth/AuthSource";

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

  const source = useMemo<AuthSource>(() => {
    // Probed per rebuild, so a retry re-runs mode detection instead of being
    // answered from a verdict frozen at handshake time.
    if (!isTeamsNestedAppAuthSupported()) {
      return new UnsupportedAuthSource("unsupported");
    }
    return createEntraNaaAuthSource({ resolveLoginHint });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildNonce is a recompute trigger, not read in the body
  }, [resolveLoginHint, rebuildNonce]);

  useEffect(() => {
    if (source.mode !== "unsupported") {
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
  }, [hostClientType, hostName, source]);

  return (
    <SessionAuthProvider
      authSource={source}
      onReinitialize={() => setRebuildNonce((nonce) => nonce + 1)}
    >
      {children}
    </SessionAuthProvider>
  );
}
