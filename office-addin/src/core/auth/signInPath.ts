import {
  InteractionRequiredError,
  NestedAppAuthUnavailableError,
} from "./AuthSource";
import { Oauth2ProxySessionRedeemError } from "./oauth2ProxySession";

/**
 * How the pane signs in: Office's nested app authentication (NAA), or the
 * oauth2-proxy's own Entra login in a popup.
 */
export type SignInPath = "naa" | "oauth2-proxy";

const PROXY_LOGIN_SWITCH_STORAGE_KEY = "erato.officeAddin.useOauth2ProxyLogin";

// MSAL spells the cancel code differently in the browser and NAA bridge paths.
const STAY_ON_NAA_ERROR_CODES = new Set([
  "user_cancelled",
  "user_canceled",
  "no_network_connectivity",
  "interaction_in_progress",
]);

function errorCodeOf(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "errorCode" in error &&
    typeof error.errorCode === "string" &&
    error.errorCode
  ) {
    return error.errorCode;
  }
  return null;
}

function isInteractionRequired(error: unknown): boolean {
  return (
    error instanceof InteractionRequiredError ||
    (error instanceof Error && error.name === "InteractionRequiredAuthError")
  );
}

/**
 * A short, token-free label for a NAA sign-in failure, for logs. MSAL errors
 * carry their code in `errorCode`; Entra server errors add an `AADSTS` code to
 * the message.
 */
export function describeSignInFailure(error: unknown): string {
  if (error instanceof NestedAppAuthUnavailableError) {
    return "naa_bridge_unavailable";
  }
  if (error instanceof Oauth2ProxySessionRedeemError) {
    return `redeem_${error.status ?? "network_error"}`;
  }
  if (error instanceof InteractionRequiredError) {
    return `interaction_required:${error.reason}`;
  }
  const code = errorCodeOf(error);
  const aadsts =
    error instanceof Error ? /AADSTS\d+/.exec(error.message)?.[0] : undefined;
  if (code && aadsts) {
    return `${code}:${aadsts}`;
  }
  return (
    code ?? aadsts ?? (error instanceof Error ? error.name : "unknown_error")
  );
}

/**
 * Whether a failed NAA sign-in should hand over to the oauth2-proxy login.
 * Interaction-required and cancelled sign-ins stay on NAA (the user can just
 * try again), and so does a network outage, which the popup can't fix either.
 * Bridge errors, Entra (AADSTS) errors, MSAL timeouts and a token the proxy
 * refused all switch.
 */
export function shouldSwitchToProxyLogin(error: unknown): boolean {
  if (isInteractionRequired(error)) {
    return false;
  }
  if (error instanceof Oauth2ProxySessionRedeemError) {
    return error.status !== null;
  }
  const code = errorCodeOf(error);
  return code === null || !STAY_ON_NAA_ERROR_CODES.has(code);
}

/**
 * The switch lives in sessionStorage: it survives reloads of this pane, and a
 * new pane probes NAA again.
 */
export function readRememberedProxyLogin(): boolean {
  try {
    return (
      window.sessionStorage.getItem(PROXY_LOGIN_SWITCH_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function rememberProxyLogin(): void {
  try {
    window.sessionStorage.setItem(PROXY_LOGIN_SWITCH_STORAGE_KEY, "1");
  } catch {
    // Best effort: without storage the next reload probes NAA again.
  }
}
