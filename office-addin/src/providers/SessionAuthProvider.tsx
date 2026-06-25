import { setAuthRecoveryHandler } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  InteractionRequiredError,
  type AuthMode,
  type AuthSource,
  type BootstrapToken,
} from "../auth/AuthSource";
import {
  OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS,
  Oauth2ProxySessionRedeemError,
  readStoredOauth2ProxySessionRedeemedAt,
  redeemOauth2ProxySession,
  shouldRefreshOauth2ProxySession,
} from "../auth/oauth2ProxySession";

// When a timed refresh fails we keep the (now stale) session and retry on a
// capped exponential backoff so a transient outage doesn't permanently stop the
// refresh loop until the user interacts.
const OAUTH2_PROXY_REFRESH_RETRY_BASE_MS = 30_000;
const OAUTH2_PROXY_REFRESH_RETRY_MAX_MS = 5 * 60_000;

type Oauth2ProxySessionStatus =
  | "idle"
  | "establishing"
  | "ready"
  | "refreshing"
  | "error";

interface Oauth2ProxySessionState {
  status: Oauth2ProxySessionStatus;
  lastRedeemedAt: number | null;
  error: string | null;
}

/** The host-agnostic contract AuthGate consumes — the four fields it reads. */
export interface SessionAuthCore {
  isInitialized: boolean;
  isAuthenticated: boolean;
  retryAuthentication: () => Promise<void>;
  error: string | null;
}

interface SessionAuthContextValue extends SessionAuthCore {
  isOauth2ProxySessionReady: boolean;
  oauth2ProxySessionStatus: Oauth2ProxySessionStatus;
  /** The auth mode of the active {@link AuthSource}. The mail-fetch hook gates
   * on this (`entra-msal` vs `unsupported`) before picking a backend by mailbox
   * location. */
  mode: AuthMode;
}

export const SessionAuthContext = createContext<SessionAuthContextValue>({
  isInitialized: false,
  isAuthenticated: false,
  isOauth2ProxySessionReady: false,
  oauth2ProxySessionStatus: "idle",
  mode: "unsupported",
  retryAuthentication: () => Promise.resolve(),
  error: null,
});

export function useSessionAuth(): SessionAuthContextValue {
  return useContext(SessionAuthContext);
}

/**
 * Internal re-redeem seam. NOT exported from the package barrel — consumed only
 * by the co-located Outlook {@link "./EntraGraphTokenProvider"} so a Graph token
 * acquisition can opportunistically refresh the proxy session through the SAME
 * `redeemInFlightRef` dedup and the SAME live `lastRedeemedAtRef` gate the
 * timed/focus refreshes use (never re-derived from localStorage).
 */
interface SessionRedeemContextValue {
  redeemSessionForToken: (
    token: BootstrapToken,
    status: "refreshing",
  ) => Promise<number>;
  lastRedeemedAtRef: React.MutableRefObject<number | null>;
}

const SessionRedeemContext = createContext<SessionRedeemContextValue | null>(
  null,
);

export function useSessionRedeem(): SessionRedeemContextValue {
  const value = useContext(SessionRedeemContext);
  if (!value) {
    throw new Error("useSessionRedeem must be used within SessionAuthProvider");
  }
  return value;
}

function createInitialOauth2ProxySessionState(): Oauth2ProxySessionState {
  const lastRedeemedAt = readStoredOauth2ProxySessionRedeemedAt();
  return {
    status: lastRedeemedAt === null ? "idle" : "ready",
    lastRedeemedAt,
    error: null,
  };
}

function formatAuthenticationError(error: unknown): string {
  if (error instanceof Oauth2ProxySessionRedeemError) {
    return t({
      id: "officeAddin.auth.oauth2ProxySessionFailed",
      message:
        "Could not establish a secure Erato session. Try signing in again.",
    });
  }

  if (error instanceof InteractionRequiredError) {
    return t({
      id: "officeAddin.auth.signInToContinue",
      message: "Sign in to continue",
    });
  }

  return error instanceof Error
    ? error.message
    : t({
        id: "officeAddin.auth.authenticationFailed",
        message: "Authentication failed",
      });
}

function isUnauthorizedRedeemError(error: unknown): boolean {
  return error instanceof Oauth2ProxySessionRedeemError && error.status === 401;
}

/**
 * Host-agnostic auth core. Owns Layer-2: it redeems a {@link BootstrapToken}
 * (produced by the injected {@link AuthSource}) for an oauth2-proxy session
 * cookie and runs the whole session lifecycle — redeem dedup, the 20-minute
 * timed refresh, focus/visibility recovery, capped backoff, and retry. It
 * imports nothing from Office, the mailbox, MSAL, or Graph, so Excel/Word reuse
 * it verbatim by passing a different `AuthSource`.
 */
export function SessionAuthProvider({
  authSource,
  onReinitialize,
  children,
}: {
  authSource: AuthSource;
  /**
   * Optional: asks the owner to rebuild the {@link AuthSource} (re-running mode
   * detection) when the user retries after an init failure. The Outlook wrapper
   * supplies this so a stale "unsupported" verdict can recover; standalone
   * hosts omit it and fall back to re-initializing the same source via
   * `initNonce`.
   */
  onReinitialize?: () => void;
  children: React.ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  // Replaces the old `!!pca` check. Must be state (not a ref) so the retry
  // branch and effects re-run when the source finishes (re-)initializing.
  const [isSourceInitialized, setIsSourceInitialized] = useState(false);
  // Replaces the old `!!account` check. Must be state and must appear in the
  // refresh effects' dependency arrays, or the refresh timer never arms.
  const [isBootstrapAcquired, setIsBootstrapAcquired] = useState(false);
  // True ONLY when an interactive sign-in is required (interaction-required).
  // Transient / background-refresh failures do NOT set this, so a working chat
  // stays visible while recovery retries silently; only a genuine sign-in
  // escalation (or a never-established session) gates the chat.
  const [signInRequired, setSignInRequired] = useState(false);
  const [oauth2ProxySession, setOauth2ProxySession] =
    useState<Oauth2ProxySessionState>(createInitialOauth2ProxySessionState);
  // Bumped to re-run the init effect when retrying after an init failure (which
  // leaves the source uninitialized and unrecoverable by a plain refresh).
  const [initNonce, setInitNonce] = useState(0);
  // Number of consecutive failed timed refreshes; drives the backoff delay.
  const [refreshFailureCount, setRefreshFailureCount] = useState(0);
  const lastRedeemedAtRef = useRef(oauth2ProxySession.lastRedeemedAt);
  const redeemInFlightRef = useRef<Promise<number> | null>(null);
  // Dedupes the whole acquire+redeem recovery unit so N concurrent 401s trigger
  // a single recovery (the redeem half is additionally deduped by the ref above).
  const recoverInFlightRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    lastRedeemedAtRef.current = oauth2ProxySession.lastRedeemedAt;
  }, [oauth2ProxySession.lastRedeemedAt]);

  const redeemSessionForToken = useCallback(
    async (
      token: BootstrapToken,
      status: Extract<Oauth2ProxySessionStatus, "establishing" | "refreshing">,
      // A `forced` redeem carries a freshly force-refreshed token (recoverAuth).
      // It must NOT silently coalesce onto a non-forced redeem in flight, which
      // may be re-POSTing the very token that's stale/revoked.
      forced = false,
    ): Promise<number> => {
      const inFlight = redeemInFlightRef.current;
      if (inFlight) {
        if (!forced) {
          // Non-forced callers (timed / focus / Graph-warm) coalesce.
          return inFlight;
        }
        // Forced recovery: let the in-flight redeem finish first. If it
        // establishes a session we're done; only if it FAILS do we redeem with
        // our fresh force-refreshed token below (sequentially — no concurrent
        // redeems, so no error-clobbers-success race).
        try {
          return await inFlight;
        } catch {
          // fall through to a fresh redeem with the forced token
        }
      }

      const redeemPromise = (async () => {
        setOauth2ProxySession((previous) => ({
          status,
          lastRedeemedAt: previous.lastRedeemedAt,
          error: null,
        }));

        try {
          const { redeemedAt } = await redeemOauth2ProxySession({
            idToken: token.idToken,
            accessToken: token.accessToken,
          });
          lastRedeemedAtRef.current = redeemedAt;
          setOauth2ProxySession({
            status: "ready",
            lastRedeemedAt: redeemedAt,
            error: null,
          });
          setError(null);
          setRefreshFailureCount(0);
          setSignInRequired(false);
          return redeemedAt;
        } catch (redeemError) {
          const message = formatAuthenticationError(redeemError);
          setOauth2ProxySession((previous) => ({
            status: "error",
            lastRedeemedAt: previous.lastRedeemedAt,
            error: message,
          }));
          setError(message);
          if (forced && isUnauthorizedRedeemError(redeemError)) {
            setSignInRequired(true);
          }
          throw redeemError;
        }
      })();

      redeemInFlightRef.current = redeemPromise;
      // Clear the in-flight ref once this redeem settles — but only if a later
      // (forced) recovery hasn't already superseded it mid-flight.
      const clearIfCurrent = () => {
        if (redeemInFlightRef.current === redeemPromise) {
          redeemInFlightRef.current = null;
        }
      };
      void redeemPromise.then(clearIfCurrent, clearIfCurrent);
      return redeemPromise;
    },
    [],
  );

  const acquireAndRedeemSession = useCallback(
    async ({
      allowInteraction,
      status,
      forceRefresh = false,
      shouldContinue,
    }: {
      allowInteraction: boolean;
      status: Extract<Oauth2ProxySessionStatus, "establishing" | "refreshing">;
      forceRefresh?: boolean;
      shouldContinue?: () => boolean;
    }): Promise<void> => {
      const token = await authSource.acquireBootstrapToken({
        allowInteraction,
        ...(forceRefresh ? { forceRefresh: true } : {}),
      });
      if (shouldContinue && !shouldContinue()) {
        return;
      }
      setIsBootstrapAcquired(true);

      try {
        await redeemSessionForToken(token, status, forceRefresh);
      } catch (redeemError) {
        if (forceRefresh || !isUnauthorizedRedeemError(redeemError)) {
          throw redeemError;
        }

        // A 401 from oauth2-proxy means the token we just redeemed was rejected,
        // not that the user necessarily needs interaction. Bypass the MSAL cache
        // once and retry the redeem with the fresh bootstrap token.
        const freshToken = await authSource.acquireBootstrapToken({
          allowInteraction,
          forceRefresh: true,
        });
        if (shouldContinue && !shouldContinue()) {
          return;
        }
        setIsBootstrapAcquired(true);
        await redeemSessionForToken(freshToken, status, true);
      }
    },
    [authSource, redeemSessionForToken],
  );

  useEffect(() => {
    let cancelled = false;

    setIsInitialized(false);
    setIsSourceInitialized(false);
    setError(null);

    authSource
      .initialize()
      .then(async () => {
        if (cancelled) {
          return;
        }
        setIsSourceInitialized(true);

        try {
          await acquireAndRedeemSession({
            allowInteraction: false,
            status: "establishing",
            shouldContinue: () => !cancelled,
          });
          if (cancelled) {
            return;
          }
        } catch (authenticationError) {
          if (cancelled) {
            return;
          }
          if (authenticationError instanceof InteractionRequiredError) {
            // Silent establish needs interaction we didn't allow — surface the
            // sign-in screen (this is a genuine sign-in-required, not transient).
            setError(null);
            setSignInRequired(true);
          } else if (
            authenticationError instanceof Oauth2ProxySessionRedeemError
          ) {
            // The redeem helper already set the user-facing error state.
          } else {
            console.warn("Bootstrap auth error", authenticationError);
            setError(formatAuthenticationError(authenticationError));
          }
        } finally {
          if (!cancelled) {
            setIsInitialized(true);
          }
        }
      })
      .catch((initializationError) => {
        if (cancelled) {
          return;
        }
        console.error("Auth source initialization failed", initializationError);
        setError(formatAuthenticationError(initializationError));
        setIsInitialized(true);
      });

    return () => {
      cancelled = true;
    };
  }, [acquireAndRedeemSession, authSource, initNonce]);

  const refreshSession = useCallback(
    async (allowInteraction: boolean): Promise<void> => {
      try {
        await acquireAndRedeemSession({
          allowInteraction,
          status: "refreshing",
        });
      } catch (refreshError) {
        const message = formatAuthenticationError(refreshError);
        setOauth2ProxySession((previous) => ({
          status: "error",
          lastRedeemedAt: previous.lastRedeemedAt,
          error: message,
        }));
        setError(message);
        throw refreshError;
      }
    },
    [acquireAndRedeemSession],
  );

  /**
   * 401-recovery primitive: force-refresh a fresh bootstrap token and re-redeem
   * the proxy session, deduped across concurrent callers. Silent (never opens a
   * popup). Resolves `true` when the session was refreshed (the caller may
   * replay its request once) and `false` on failure — surfacing the error so the
   * AuthGate "Try again" path is reachable. Registered with the shared API/SSE
   * layer below so a 401 anywhere drives a single recovery.
   */
  const recoverAuth = useCallback(
    async (reason: string): Promise<boolean> => {
      if (recoverInFlightRef.current) {
        return recoverInFlightRef.current;
      }
      const recoverPromise = (async () => {
        try {
          await acquireAndRedeemSession({
            allowInteraction: false,
            status: "refreshing",
            forceRefresh: true,
          });
          return true;
        } catch (recoverError) {
          const message = formatAuthenticationError(recoverError);
          setOauth2ProxySession((previous) => ({
            status: "error",
            lastRedeemedAt: previous.lastRedeemedAt,
            error: message,
          }));
          setError(message);
          // Contribute to the shared backoff curve so a recovery failure (not
          // just a timed-refresh failure) advances the retry interval.
          setRefreshFailureCount((count) => count + 1);
          // Only a genuine interaction-required failure escalates to the full
          // sign-in screen; transient failures keep the chat visible and are
          // retried by the request's caller / the backoff timer.
          if (recoverError instanceof InteractionRequiredError) {
            setSignInRequired(true);
          }
          console.warn(
            `OAuth2 proxy session recovery failed (${reason})`,
            recoverError,
          );
          return false;
        } finally {
          recoverInFlightRef.current = null;
        }
      })();
      recoverInFlightRef.current = recoverPromise;
      return recoverPromise;
    },
    [acquireAndRedeemSession],
  );

  useEffect(() => {
    // Register recovery with the shared @erato/frontend API + SSE layer so a 401
    // on any request triggers a single silent re-acquire + re-redeem, then a
    // one-shot replay. The web app registers nothing, so those sites no-op there.
    setAuthRecoveryHandler(recoverAuth);
    return () => {
      setAuthRecoveryHandler(null);
    };
  }, [recoverAuth]);

  useEffect(() => {
    // Only schedule once we hold a session to refresh. An initial establish that
    // never produced a session (lastRedeemedAt null) is recovered via the retry
    // button instead of an automatic timer.
    if (
      !isSourceInitialized ||
      !isBootstrapAcquired ||
      oauth2ProxySession.lastRedeemedAt === null
    ) {
      return;
    }

    let refreshDelayMs: number;
    if (oauth2ProxySession.status === "error") {
      // A previous refresh failed but the session may still be valid. Retry on a
      // capped exponential backoff rather than going terminal — otherwise a
      // single transient failure would silently disconnect the add-in until the
      // user reloads or hits "Try again".
      const attempt = Math.max(0, refreshFailureCount - 1);
      refreshDelayMs = Math.min(
        OAUTH2_PROXY_REFRESH_RETRY_BASE_MS * 2 ** attempt,
        OAUTH2_PROXY_REFRESH_RETRY_MAX_MS,
      );
    } else {
      const sessionAgeMs = Date.now() - oauth2ProxySession.lastRedeemedAt;
      refreshDelayMs = Math.max(
        1_000,
        OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS - sessionAgeMs,
      );
    }

    const timeoutId = window.setTimeout(() => {
      void refreshSession(false).catch((refreshError) => {
        // A successful redeem resets the counter; bump it here so the next
        // scheduled retry backs off further.
        setRefreshFailureCount((count) => count + 1);
        console.warn("OAuth2 proxy session refresh failed", refreshError);
      });
    }, refreshDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    isBootstrapAcquired,
    isSourceInitialized,
    oauth2ProxySession.lastRedeemedAt,
    oauth2ProxySession.status,
    refreshFailureCount,
    refreshSession,
  ]);

  useEffect(() => {
    function refreshIfStale() {
      // Intentionally retries even from the "error" status: regaining focus is a
      // natural recovery point, and the backoff timer may not have fired yet.
      if (
        !isSourceInitialized ||
        !isBootstrapAcquired ||
        !shouldRefreshOauth2ProxySession(lastRedeemedAtRef.current)
      ) {
        return;
      }

      void refreshSession(false).catch((refreshError) => {
        console.warn(
          "OAuth2 proxy session refresh after resume failed",
          refreshError,
        );
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshIfStale();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", refreshIfStale);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", refreshIfStale);
    };
  }, [
    isBootstrapAcquired,
    isSourceInitialized,
    oauth2ProxySession.status,
    refreshSession,
  ]);

  const retryAuthentication = useCallback(async (): Promise<void> => {
    setError(null);
    setRefreshFailureCount(0);

    // If the source never initialized (init failure) there is nothing to
    // refresh against — re-run the init effect instead of throwing. The effect
    // flips isInitialized back on. Prefer rebuilding the source (re-detects the
    // mode, so a stale "unsupported" verdict can recover); the new source
    // identity re-triggers the init effect. Fall back to a plain re-init of the
    // same source when no rebuild hook is wired.
    if (!isSourceInitialized) {
      setIsInitialized(false);
      if (onReinitialize) {
        onReinitialize();
      } else {
        setInitNonce((nonce) => nonce + 1);
      }
      return;
    }

    setIsInitialized(false);
    try {
      await refreshSession(true);
    } catch (authenticationError) {
      setError(formatAuthenticationError(authenticationError));
    } finally {
      setIsInitialized(true);
    }
  }, [isSourceInitialized, onReinitialize, refreshSession]);

  const isOauth2ProxySessionReady =
    oauth2ProxySession.lastRedeemedAt !== null &&
    oauth2ProxySession.status !== "error";
  const authError = error ?? oauth2ProxySession.error;
  // The chat stays mounted as long as we hold an established session and no
  // interactive sign-in is required. A transient background-refresh failure
  // (status "error") no longer blanks the UI — the backoff timer retries it
  // silently; only a never-established session or a sign-in-required escalation
  // gates the chat.
  const isAuthenticated =
    isBootstrapAcquired &&
    oauth2ProxySession.lastRedeemedAt !== null &&
    !signInRequired;

  return (
    <SessionAuthContext.Provider
      value={{
        isInitialized,
        isAuthenticated,
        isOauth2ProxySessionReady,
        oauth2ProxySessionStatus: oauth2ProxySession.status,
        mode: authSource.mode,
        retryAuthentication,
        error: authError,
      }}
    >
      <SessionRedeemContext.Provider
        value={{ redeemSessionForToken, lastRedeemedAtRef }}
      >
        {children}
      </SessionRedeemContext.Provider>
    </SessionAuthContext.Provider>
  );
}
