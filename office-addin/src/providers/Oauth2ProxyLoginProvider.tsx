import { setAuthRecoveryHandler } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import { SessionAuthContext } from "./SessionAuthProvider";
import {
  OAUTH2_PROXY_SIGN_IN_PATH,
  checkOauth2ProxySession,
} from "../auth/oauth2ProxySession";

/** How often we re-probe the proxy session while the popup is open. */
const SESSION_POLL_INTERVAL_MS = 1_500;
/** Give up on the popup login after this long and return to the sign-in CTA. */
const SIGN_IN_TIMEOUT_MS = 3 * 60_000;
/** The popup posts this message back to the opener once the cookie is set. */
const LOGIN_COMPLETE_MESSAGE = "erato-oauth2-login-complete";

type LoginPhase =
  | "checking"
  | "needs-signin"
  | "signing-in"
  | "authenticated"
  | "error";

/**
 * The oauth2-proxy redirect-login {@link SessionAuthContext} provider for the
 * NAA-less hybrid mailbox (Exchange SE). Unlike the EXO path there is no
 * client-side Entra token to redeem: the add-in is served through oauth2-proxy
 * on the funnel domain, so the proxy performs the full Entra OIDC login itself
 * (with ITS OWN app registration) and sets the session cookie. This provider
 * therefore only orchestrates that login — probe the cookie, open the proxy's
 * `/oauth2/start` login in a popup, detect completion — and supplies the SAME
 * {@link SessionAuthContext} value so AuthGate, {@link useSessionAuth}, and the
 * mail-fetch hook all work unchanged.
 *
 * No {@link "./EntraGraphTokenProvider"} is mounted here: there is no
 * client-side Graph token on this path, which is correct because the SE on-prem
 * mailbox reads mail via the Exchange REST callback token, not Graph.
 */
export function Oauth2ProxyLoginProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [phase, setPhase] = useState<LoginPhase>("checking");
  const [error, setError] = useState<string | null>(null);
  // Tracks the live popup so the message/poll handlers and unmount can close it.
  const popupRef = useRef<Window | null>(null);
  // Dedupes concurrent 401-recovery probes (authRecovery contract).
  const recoverInFlightRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Initial probe: the proxy may already hold a valid cookie (e.g. the user
    // signed in to the web app on the same funnel domain), so we never force a
    // popup before checking.
    checkOauth2ProxySession()
      .then((authenticated) => {
        if (cancelled) {
          return;
        }
        setPhase(authenticated ? "authenticated" : "needs-signin");
      })
      .catch((probeError) => {
        if (cancelled) {
          return;
        }
        console.warn("OAuth2 proxy session probe failed", probeError);
        setError(
          t({
            id: "officeAddin.auth.oauth2ProxyProbeFailed",
            message: "Could not reach the sign-in service. Try again.",
          }),
        );
        setPhase("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (): Promise<void> => {
    // Re-entrancy guard: AuthGate keeps the "Sign in" button mounted during the
    // "signing-in" phase, so a second click would otherwise open a second popup
    // and leak a parallel listener + poll interval + timeout. Ignore clicks
    // while a popup flow is already in flight.
    if (popupRef.current && !popupRef.current.closed) {
      return;
    }

    setError(null);
    setPhase("signing-in");

    // Enter at the proxy's sign-in PAGE (a first-party 200), not /oauth2/start:
    // the same-origin page load primes the CSRF cookie context so the first
    // /oauth2/callback succeeds instead of dropping the CSRF cookie on a direct
    // cross-site 302 (the double-login). See OAUTH2_PROXY_SIGN_IN_PATH; requires
    // the proxy's skip_provider_button=false.
    const popup = window.open(
      `${OAUTH2_PROXY_SIGN_IN_PATH}?rd=${encodeURIComponent(
        import.meta.env.BASE_URL + "auth-complete.html",
      )}`,
      "erato-oauth2-login",
      "width=520,height=680",
    );

    if (!popup) {
      // Popup blocked: there is nothing to poll. Ask the user to allow popups
      // and retry rather than spinning on a window that never opened.
      setError(
        t({
          id: "officeAddin.auth.oauth2ProxyPopupBlocked",
          message:
            "Sign-in popup was blocked. Allow popups for this site and try again.",
        }),
      );
      setPhase("needs-signin");
      return;
    }

    popupRef.current = popup;

    // Completion is detected by BOTH the auth-complete page's postMessage and a
    // polling fallback, since postMessage can be missed if the listener is gone
    // or the browser drops the cross-window message.
    await new Promise<void>((resolve) => {
      let settled = false;
      let pollId: number | undefined;
      let timeoutId: number | undefined;

      const cleanup = () => {
        window.removeEventListener("message", handleMessage);
        if (pollId !== undefined) {
          window.clearInterval(pollId);
        }
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
      };

      const succeed = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        try {
          popup.close();
        } catch {
          // Best effort: the user can close it manually.
        }
        popupRef.current = null;
        setError(null);
        setPhase("authenticated");
        resolve();
      };

      const giveUp = (message: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        // Close the popup on timeout too — once we null the ref the unmount
        // effect can no longer reach it, so an un-closed window would be
        // orphaned (the user-closed branch already has it gone; succeed() closes
        // it). Best effort.
        try {
          popup.close();
        } catch {
          // The user can close it manually.
        }
        popupRef.current = null;
        setError(message);
        setPhase("needs-signin");
        resolve();
      };

      function handleMessage(event: MessageEvent) {
        if (
          event.origin === window.location.origin &&
          event.data === LOGIN_COMPLETE_MESSAGE
        ) {
          succeed();
        }
      }
      window.addEventListener("message", handleMessage);

      pollId = window.setInterval(() => {
        if (popup.closed) {
          // The user closed the popup before completing — re-probe once in case
          // the cookie was actually set, otherwise return to the sign-in CTA.
          // Stop the interval first so a slow probe can't spawn concurrent
          // re-probes on subsequent ticks.
          if (pollId !== undefined) {
            window.clearInterval(pollId);
            pollId = undefined;
          }
          void checkOauth2ProxySession()
            .then((authenticated) => {
              if (authenticated) {
                succeed();
              } else {
                giveUp(null);
              }
            })
            .catch(() => giveUp(null));
          return;
        }
        void checkOauth2ProxySession()
          .then((authenticated) => {
            if (authenticated) {
              succeed();
            }
          })
          .catch(() => {
            // Transient probe failure while signing in: keep polling.
          });
      }, SESSION_POLL_INTERVAL_MS);

      timeoutId = window.setTimeout(() => {
        giveUp(
          t({
            id: "officeAddin.auth.oauth2ProxySignInTimedOut",
            message: "Sign-in timed out. Try again.",
          }),
        );
      }, SIGN_IN_TIMEOUT_MS);
    });
  }, []);

  useEffect(() => {
    // Register recovery with the shared @erato/frontend API + SSE layer so a 401
    // on any request re-probes the proxy session. If the proxy refreshed the
    // cookie server-side the caller replays; otherwise we escalate to sign-in.
    const recover = async (reason: string): Promise<boolean> => {
      // Dedupe concurrent recoveries (the authRecovery contract expects the
      // handler to do this): N simultaneous 401s share one probe.
      if (recoverInFlightRef.current) {
        return recoverInFlightRef.current;
      }
      const promise = (async () => {
        try {
          const authenticated = await checkOauth2ProxySession();
          if (authenticated) {
            return true;
          }
          // Definitive 401/403: the cookie is gone — escalate to sign-in.
          setPhase("needs-signin");
          return false;
        } catch (recoverError) {
          // Transient probe failure (offline / 5xx / CORS): don't blank the
          // chat — the cookie may still be valid. Tell the caller not to replay,
          // but leave the session visible; a real 401 next time escalates.
          console.warn(
            `OAuth2 proxy session recovery probe failed (${reason})`,
            recoverError,
          );
          return false;
        } finally {
          recoverInFlightRef.current = null;
        }
      })();
      recoverInFlightRef.current = promise;
      return promise;
    };
    setAuthRecoveryHandler(recover);
    return () => {
      setAuthRecoveryHandler(null);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (popupRef.current && !popupRef.current.closed) {
        try {
          popupRef.current.close();
        } catch {
          // Best effort on unmount.
        }
      }
      popupRef.current = null;
    };
  }, []);

  return (
    <SessionAuthContext.Provider
      value={{
        isInitialized: phase !== "checking",
        isAuthenticated: phase === "authenticated",
        retryAuthentication: signIn,
        error,
        isOauth2ProxySessionReady: phase === "authenticated",
        oauth2ProxySessionStatus:
          phase === "authenticated"
            ? "ready"
            : phase === "signing-in"
              ? "establishing"
              : "idle",
        // Deliberately "entra-msal": the user IS authenticated with an Entra
        // identity (via the proxy's own OIDC login), so useOutlookMessageFetcher
        // treats SE as authenticated and detectExchangeOnPrem() routes mail to
        // the REST callback-token backend.
        mode: "entra-msal",
      }}
    >
      {children}
    </SessionAuthContext.Provider>
  );
}
