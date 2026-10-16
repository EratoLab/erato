import { useCallback, useEffect, useState } from "react";

import { Oauth2ProxyLoginProvider } from "./Oauth2ProxyLoginProvider";
import { SessionAuthContext, SessionAuthProvider } from "./SessionAuthProvider";
import {
  NestedAppAuthUnavailableError,
  type AuthSource,
} from "./auth/AuthSource";
import {
  describeSignInFailure,
  readRememberedProxyLogin,
  rememberProxyLogin,
  shouldSwitchToProxyLogin,
} from "./auth/signInPath";

type ProxyLoginReason =
  | "no-naa"
  | "no-naa-bridge"
  | "remembered-switch"
  | "naa-sign-in-failed";

type Plan =
  | { kind: "probing" }
  | { kind: "naa"; source: AuthSource }
  | { kind: "oauth2-proxy"; reason: ProxyLoginReason };

const PROBING_CONTEXT = {
  isInitialized: false,
  isAuthenticated: false,
  isOauth2ProxySessionReady: false,
  oauth2ProxySessionStatus: "idle",
  mode: "entra-msal",
  retryAuthentication: () => Promise.resolve(),
  error: null,
} as const;

function initialPlan(): Plan {
  return readRememberedProxyLogin()
    ? { kind: "oauth2-proxy", reason: "remembered-switch" }
    : { kind: "probing" };
}

/**
 * Lets SessionAuthProvider's first `initialize()` reuse the probe's result
 * rather than building a second MSAL client and bridge connection.
 */
function reuseProbedInitialize(
  source: AuthSource,
  probed: Promise<void>,
): AuthSource {
  let pending: Promise<void> | null = probed;
  return {
    mode: source.mode,
    initialize() {
      const result = pending ?? source.initialize();
      pending = null;
      return result;
    },
    acquireBootstrapToken: (options) => source.acquireBootstrapToken(options),
  };
}

/**
 * The shared add-in sign-in sequence for hosts that may or may not offer
 * Office's nested app authentication (NAA):
 *
 *   - NAA usable (the host bridge connected): today's NAA flow, unchanged —
 *     silent on load, an interactive NAA prompt from "Sign in". It keeps its
 *     own session lifecycle (re-redeem every 20 minutes, 401 recovery), so it
 *     still runs when a proxy session already exists.
 *   - No NAA: {@link Oauth2ProxyLoginProvider}, which first checks for an
 *     existing proxy session and otherwise signs in through the proxy's own
 *     Entra login in a popup. MSAL's standard-client fallback never runs an
 *     interactive flow in the pane.
 *
 * With `switchOnNaaFailure`, an explicit NAA sign-in that fails for a reason
 * other than interaction or cancellation hands over to the proxy login for
 * the rest of this pane session.
 */
export function NaaOrProxyLoginProvider({
  createNaaSource,
  switchOnNaaFailure = false,
  children,
}: {
  /**
   * Builds the NAA source, or returns null when the host reports no NAA at
   * all. The source's `initialize()` must reject with
   * {@link NestedAppAuthUnavailableError} when the host bridge is missing.
   */
  createNaaSource: () => AuthSource | null;
  switchOnNaaFailure?: boolean;
  children: React.ReactNode;
}) {
  const [plan, setPlan] = useState<Plan>(initialPlan);

  useEffect(() => {
    if (plan.kind !== "probing") {
      return;
    }
    const source = createNaaSource();
    if (!source) {
      setPlan({ kind: "oauth2-proxy", reason: "no-naa" });
      return;
    }
    let cancelled = false;
    const probed = source.initialize();
    probed.then(
      () => {
        if (!cancelled) {
          setPlan({
            kind: "naa",
            source: reuseProbedInitialize(source, probed),
          });
        }
      },
      (error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof NestedAppAuthUnavailableError) {
          setPlan({ kind: "oauth2-proxy", reason: "no-naa-bridge" });
          return;
        }
        // Other init failures stay on the NAA flow, which shows them with a
        // retry, exactly as before.
        setPlan({ kind: "naa", source: reuseProbedInitialize(source, probed) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [createNaaSource, plan]);

  useEffect(() => {
    if (plan.kind === "naa") {
      console.info("Add-in sign-in path: naa");
    } else if (plan.kind === "oauth2-proxy") {
      console.info(`Add-in sign-in path: oauth2-proxy (${plan.reason})`);
    }
  }, [plan]);

  const reprobe = useCallback(() => {
    setPlan({ kind: "probing" });
  }, []);

  const handleNaaSignInFailure = useCallback(
    (error: unknown) => {
      const code = describeSignInFailure(error);
      if (!switchOnNaaFailure || !shouldSwitchToProxyLogin(error)) {
        console.warn(`NAA sign-in failed (${code})`);
        return;
      }
      console.warn(
        `NAA sign-in failed (${code}); switching to the oauth2-proxy login`,
      );
      rememberProxyLogin();
      setPlan({ kind: "oauth2-proxy", reason: "naa-sign-in-failed" });
    },
    [switchOnNaaFailure],
  );

  if (plan.kind === "probing") {
    return (
      <SessionAuthContext.Provider value={PROBING_CONTEXT}>
        {children}
      </SessionAuthContext.Provider>
    );
  }

  if (plan.kind === "oauth2-proxy") {
    return <Oauth2ProxyLoginProvider>{children}</Oauth2ProxyLoginProvider>;
  }

  return (
    <SessionAuthProvider
      authSource={plan.source}
      onReinitialize={reprobe}
      onSignInFailure={handleNaaSignInFailure}
    >
      {children}
    </SessionAuthProvider>
  );
}
