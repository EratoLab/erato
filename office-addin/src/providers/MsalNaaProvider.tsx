import {
  type AuthenticationResult,
  InteractionRequiredAuthError,
  createNestablePublicClientApplication,
  type AccountInfo,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import { env, setIdToken } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { useOffice } from "./OfficeProvider";
import {
  OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS,
  Oauth2ProxySessionRedeemError,
  readStoredOauth2ProxySessionRedeemedAt,
  redeemOauth2ProxySession,
  shouldRefreshOauth2ProxySession,
} from "../auth/oauth2ProxySession";

const OAUTH2_PROXY_SESSION_SCOPES = ["User.Read"];

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

interface MsalNaaContextValue {
  isInitialized: boolean;
  isAuthenticated: boolean;
  isOauth2ProxySessionReady: boolean;
  oauth2ProxySessionStatus: Oauth2ProxySessionStatus;
  account: AccountInfo | null;
  acquireToken: (scopes: string[]) => Promise<string>;
  retryAuthentication: () => Promise<void>;
  error: string | null;
}

const MsalNaaContext = createContext<MsalNaaContextValue>({
  isInitialized: false,
  isAuthenticated: false,
  isOauth2ProxySessionReady: false,
  oauth2ProxySessionStatus: "idle",
  account: null,
  acquireToken: () =>
    Promise.reject(
      new Error(
        t({
          id: "officeAddin.auth.msalProviderNotMounted",
          message: "MsalNaaProvider not mounted",
        }),
      ),
    ),
  retryAuthentication: () => Promise.resolve(),
  error: null,
});

export function useMsalNaa() {
  return useContext(MsalNaaContext);
}

function createInitialOauth2ProxySessionState(): Oauth2ProxySessionState {
  const lastRedeemedAt = readStoredOauth2ProxySessionRedeemedAt();
  return {
    status: lastRedeemedAt === null ? "idle" : "ready",
    lastRedeemedAt,
    error: null,
  };
}

function applyAuthenticationResult(
  instance: IPublicClientApplication,
  result: AuthenticationResult,
  setAccount: React.Dispatch<React.SetStateAction<AccountInfo | null>>,
) {
  if (result.account) {
    instance.setActiveAccount(result.account);
  }
  setAccount(result.account);
  setIdToken(result.idToken);
}

async function acquireMsalResult(
  instance: IPublicClientApplication,
  scopes: string[],
  loginHint: string | undefined,
  allowPopup: boolean,
): Promise<AuthenticationResult> {
  try {
    return await instance.acquireTokenSilent({
      scopes,
      ...(loginHint ? { loginHint } : {}),
    });
  } catch (silentError) {
    if (silentError instanceof InteractionRequiredAuthError && allowPopup) {
      const result = await instance.acquireTokenPopup({
        scopes,
        prompt: "select_account",
      });
      if (result.account) {
        instance.setActiveAccount(result.account);
      }
      return result;
    }

    throw silentError;
  }
}

function formatAuthenticationError(error: unknown): string {
  if (error instanceof Oauth2ProxySessionRedeemError) {
    return t({
      id: "officeAddin.auth.oauth2ProxySessionFailed",
      message:
        "Could not establish a secure Erato session. Try signing in again.",
    });
  }

  if (error instanceof InteractionRequiredAuthError) {
    return t({
      id: "officeAddin.auth.signInRequired",
      message: "Sign-in required",
    });
  }

  return error instanceof Error
    ? error.message
    : t({
        id: "officeAddin.auth.authenticationFailed",
        message: "Authentication failed",
      });
}

export function MsalNaaProvider({ children }: { children: React.ReactNode }) {
  const { mailboxUser } = useOffice();
  const [pca, setPca] = useState<IPublicClientApplication | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [loginHint, setLoginHint] = useState<string | undefined>();
  const [oauth2ProxySession, setOauth2ProxySession] =
    useState<Oauth2ProxySessionState>(createInitialOauth2ProxySessionState);
  // Bumped to re-run the MSAL initialization effect when retrying after an init
  // failure (which leaves `pca` null and cannot be recovered by a refresh).
  const [initNonce, setInitNonce] = useState(0);
  // Number of consecutive failed timed refreshes; drives the backoff delay.
  const [refreshFailureCount, setRefreshFailureCount] = useState(0);
  const lastRedeemedAtRef = useRef(oauth2ProxySession.lastRedeemedAt);
  const redeemInFlightRef = useRef<Promise<number> | null>(null);

  useEffect(() => {
    lastRedeemedAtRef.current = oauth2ProxySession.lastRedeemedAt;
  }, [oauth2ProxySession.lastRedeemedAt]);

  const redeemSessionForResult = useCallback(
    async (
      result: AuthenticationResult,
      status: Extract<Oauth2ProxySessionStatus, "establishing" | "refreshing">,
    ): Promise<number> => {
      if (redeemInFlightRef.current) {
        return redeemInFlightRef.current;
      }

      const redeemPromise = (async () => {
        setOauth2ProxySession((previous) => ({
          status,
          lastRedeemedAt: previous.lastRedeemedAt,
          error: null,
        }));

        try {
          const { redeemedAt } = await redeemOauth2ProxySession({
            idToken: result.idToken,
            accessToken: result.accessToken,
          });
          lastRedeemedAtRef.current = redeemedAt;
          setOauth2ProxySession({
            status: "ready",
            lastRedeemedAt: redeemedAt,
            error: null,
          });
          setError(null);
          setRefreshFailureCount(0);
          return redeemedAt;
        } catch (redeemError) {
          const message = formatAuthenticationError(redeemError);
          setOauth2ProxySession((previous) => ({
            status: "error",
            lastRedeemedAt: previous.lastRedeemedAt,
            error: message,
          }));
          setError(message);
          throw redeemError;
        } finally {
          redeemInFlightRef.current = null;
        }
      })();

      redeemInFlightRef.current = redeemPromise;
      return redeemPromise;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const clientId = import.meta.env.VITE_MSAL_CLIENT_ID ?? env().msalClientId;
    if (!clientId) {
      setError(
        t({
          id: "officeAddin.auth.msalClientIdMissing",
          message: "MSAL client ID is not configured",
        }),
      );
      setIsInitialized(true);
      return;
    }

    setIsInitialized(false);
    setError(null);

    let naaSupported = false;
    try {
      if (typeof Office !== "undefined" && Office.context?.requirements) {
        naaSupported = Office.context.requirements.isSetSupported(
          "NestedAppAuth",
          "1.1",
        );
      }
    } catch {
      // Office not available outside add-in host.
    }

    if (!naaSupported) {
      setError(
        t({
          id: "officeAddin.auth.naaUnsupported",
          message:
            "Nested App Authentication is not supported in this environment",
        }),
      );
      setIsInitialized(true);
      return;
    }

    const authority =
      import.meta.env.VITE_MSAL_AUTHORITY ??
      env().msalAuthority ??
      "https://login.microsoftonline.com/common";

    const msalConfig = {
      auth: {
        clientId,
        authority,
        supportsNestedAppAuth: true,
      },
      cache: {
        cacheLocation: "localStorage" as const,
      },
    };

    async function resolveLoginHint(): Promise<string | undefined> {
      try {
        if (typeof Office !== "undefined" && Office.auth?.getAuthContext) {
          const authContext = await Office.auth.getAuthContext();
          if (authContext?.userPrincipalName) {
            return authContext.userPrincipalName;
          }
        }
      } catch {
        // Fallback below.
      }

      return mailboxUser?.emailAddress;
    }

    createNestablePublicClientApplication(msalConfig)
      .then(async (instance) => {
        if (cancelled) {
          return;
        }
        setPca(instance);

        const hint = await resolveLoginHint();
        if (cancelled) {
          return;
        }
        setLoginHint(hint);

        try {
          const result = await acquireMsalResult(
            instance,
            OAUTH2_PROXY_SESSION_SCOPES,
            hint,
            false,
          );
          if (cancelled) {
            return;
          }
          applyAuthenticationResult(instance, result, setAccount);
          await redeemSessionForResult(result, "establishing");
        } catch (authenticationError) {
          if (cancelled) {
            return;
          }
          if (authenticationError instanceof InteractionRequiredAuthError) {
            setError(null);
          } else if (
            authenticationError instanceof Oauth2ProxySessionRedeemError
          ) {
            // The redeem helper already set the user-facing error state.
          } else {
            console.warn("MSAL silent auth error", authenticationError);
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
        console.error("MSAL initialization failed", initializationError);
        setError(formatAuthenticationError(initializationError));
        setIsInitialized(true);
      });

    return () => {
      cancelled = true;
    };
  }, [mailboxUser, redeemSessionForResult, initNonce]);

  const refreshOauth2ProxySession = useCallback(
    async (allowPopup: boolean): Promise<void> => {
      try {
        if (!pca) {
          throw new Error(
            t({
              id: "officeAddin.auth.msalNotInitialized",
              message: "MSAL not initialized",
            }),
          );
        }

        const result = await acquireMsalResult(
          pca,
          OAUTH2_PROXY_SESSION_SCOPES,
          loginHint,
          allowPopup,
        );
        applyAuthenticationResult(pca, result, setAccount);
        await redeemSessionForResult(result, "refreshing");
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
    [loginHint, pca, redeemSessionForResult],
  );

  useEffect(() => {
    // Only schedule once we hold a session to refresh. An initial establish that
    // never produced a session (lastRedeemedAt null) is recovered via the retry
    // button instead of an automatic timer.
    if (!pca || !account || oauth2ProxySession.lastRedeemedAt === null) {
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
      void refreshOauth2ProxySession(false).catch((refreshError) => {
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
    account,
    oauth2ProxySession.lastRedeemedAt,
    oauth2ProxySession.status,
    pca,
    refreshFailureCount,
    refreshOauth2ProxySession,
  ]);

  useEffect(() => {
    function refreshIfStale() {
      // Intentionally retries even from the "error" status: regaining focus is a
      // natural recovery point, and the backoff timer may not have fired yet.
      if (
        !pca ||
        !account ||
        !shouldRefreshOauth2ProxySession(lastRedeemedAtRef.current)
      ) {
        return;
      }

      void refreshOauth2ProxySession(false).catch((refreshError) => {
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
  }, [account, oauth2ProxySession.status, pca, refreshOauth2ProxySession]);

  const acquireToken = useCallback(
    async (scopes: string[]): Promise<string> => {
      if (!pca) {
        throw new Error(
          t({
            id: "officeAddin.auth.msalNotInitialized",
            message: "MSAL not initialized",
          }),
        );
      }

      try {
        const result = await acquireMsalResult(pca, scopes, loginHint, true);
        applyAuthenticationResult(pca, result, setAccount);
        if (shouldRefreshOauth2ProxySession(lastRedeemedAtRef.current)) {
          await redeemSessionForResult(result, "refreshing");
        }
        return result.accessToken;
      } catch (authenticationError) {
        setError(formatAuthenticationError(authenticationError));
        throw authenticationError;
      }
    },
    [loginHint, pca, redeemSessionForResult],
  );

  const retryAuthentication = useCallback(async (): Promise<void> => {
    setError(null);
    setRefreshFailureCount(0);

    // If MSAL never initialized (init failure, NAA not yet ready) there is no
    // client to refresh against — re-run the initialization effect instead of
    // throwing "MSAL not initialized". The effect flips isInitialized back on.
    if (!pca) {
      setIsInitialized(false);
      setInitNonce((nonce) => nonce + 1);
      return;
    }

    setIsInitialized(false);
    try {
      await refreshOauth2ProxySession(true);
    } catch (authenticationError) {
      setError(formatAuthenticationError(authenticationError));
    } finally {
      setIsInitialized(true);
    }
  }, [pca, refreshOauth2ProxySession]);

  const isOauth2ProxySessionReady =
    oauth2ProxySession.lastRedeemedAt !== null &&
    oauth2ProxySession.status !== "error";
  const authError = error ?? oauth2ProxySession.error;
  const isAuthenticated =
    account !== null && isOauth2ProxySessionReady && authError === null;

  return (
    <MsalNaaContext.Provider
      value={{
        isInitialized,
        isAuthenticated,
        isOauth2ProxySessionReady,
        oauth2ProxySessionStatus: oauth2ProxySession.status,
        account,
        acquireToken,
        retryAuthentication,
        error: authError,
      }}
    >
      {children}
    </MsalNaaContext.Provider>
  );
}
