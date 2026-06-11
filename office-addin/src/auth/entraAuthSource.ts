import {
  AuthError,
  InteractionRequiredAuthError,
  type AuthenticationResult,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import { env } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import {
  InteractionRequiredError,
  type AcquireBootstrapOptions,
  type AuthSource,
  type BootstrapToken,
  type GraphCapableSource,
  type LoginHintResolver,
} from "./AuthSource";

/** Scopes for the Layer-1 bootstrap token that gets redeemed for the session. */
const OAUTH2_PROXY_SESSION_SCOPES = ["User.Read"];

/**
 * MSAL silent-acquire failures that mean "no usable session yet — fall to an
 * interactive sign-in", as opposed to a real error to surface. Besides the
 * explicit `InteractionRequiredAuthError`, a standard (non-nestable) PCA on its
 * FIRST run has an empty account cache, so `acquireTokenSilent` throws
 * `no_account_error` / `no_tokens_found` — which must drive the popup, not get
 * re-thrown raw. The NAA PCA (the sole current consumer) rarely hits this
 * because the Office host seeds an account for SSO, but it is handled defensively
 * so a future standard-PCA host inherits the correct first-login behaviour.
 */
function requiresInteractiveSignIn(error: unknown): boolean {
  if (error instanceof InteractionRequiredAuthError) {
    return true;
  }
  return (
    error instanceof AuthError &&
    (error.errorCode === "no_account_error" ||
      error.errorCode === "no_tokens_found")
  );
}

/** The MSAL config the factory assembles and hands to {@link CreatePca}. */
export interface EntraMsalConfig {
  auth: {
    clientId: string;
    authority: string;
  };
  cache: {
    cacheLocation: "localStorage";
  };
}

/**
 * Builds the MSAL {@link IPublicClientApplication} for a given config. This is
 * the one knob that varies the PCA kind: the NAA source (the sole current
 * consumer) passes a nestable PCA plus `supportsNestedAppAuth`; a future
 * standard-PCA host would pass a standard PCA. Injecting it keeps every other
 * line of the Entra flow shared.
 */
export type CreatePca = (
  config: EntraMsalConfig,
) => Promise<IPublicClientApplication>;

export interface EntraAuthSourceOptions {
  /** Host-injected: Outlook adds a mailbox fallback, Excel/Word does not. */
  resolveLoginHint: LoginHintResolver;
  /**
   * The PCA factory carrying the NAA-vs-standard difference (nestable +
   * `supportsNestedAppAuth` for NAA, standard for interactive).
   */
  createPca: CreatePca;
}

/**
 * The shared Entra/MSAL {@link AuthSource} factory. All MSAL coupling lives here,
 * behind the host-agnostic `AuthSource` interface, so the SessionAuth core and
 * other hosts never import `@azure/msal-browser`. The PCA kind is injected via
 * `createPca` (today only the NAA source uses it; the seam stays generic for a
 * future standard-PCA host); everything else (silent→popup acquire,
 * `InteractionRequiredError` translation, active-account handling, bootstrap +
 * Graph token acquisition) is shared.
 *
 * Also implements {@link GraphCapableSource} — the Outlook-only Graph token
 * path — because it reuses the same initialized PCA + login hint. Non-Outlook
 * hosts simply never call `acquireGraphToken`.
 */
export function createEntraAuthSource(
  options: EntraAuthSourceOptions,
): AuthSource & GraphCapableSource {
  let pca: IPublicClientApplication | null = null;
  let loginHint: string | undefined;

  async function acquireMsalResult(
    instance: IPublicClientApplication,
    scopes: string[],
    allowInteraction: boolean,
    forceRefresh: boolean,
  ): Promise<AuthenticationResult> {
    try {
      return await instance.acquireTokenSilent({
        scopes,
        ...(loginHint ? { loginHint } : {}),
        ...(forceRefresh ? { forceRefresh: true } : {}),
      });
    } catch (silentError) {
      if (requiresInteractiveSignIn(silentError)) {
        if (allowInteraction) {
          const result = await instance.acquireTokenPopup({
            scopes,
            prompt: "select_account",
            ...(loginHint ? { loginHint } : {}),
          });
          if (result.account) {
            instance.setActiveAccount(result.account);
          }
          return result;
        }
        // Translate to a host-agnostic signal so the core stays MSAL-free.
        throw new InteractionRequiredError("MSAL interaction required", {
          cause: silentError,
        });
      }
      throw silentError;
    }
  }

  // Sets the MSAL active account so subsequent silent acquisitions resolve it.
  // Deliberately does NOT push the id token into the shared token store: the
  // add-in authenticates via the oauth2-proxy session cookie (the id token is
  // redeemed for that cookie, not sent as a per-request Bearer), matching the
  // cookie-only on-prem Exchange SE path.
  function applyResult(
    instance: IPublicClientApplication,
    result: AuthenticationResult,
  ): void {
    if (result.account) {
      instance.setActiveAccount(result.account);
    }
  }

  function requirePca(): IPublicClientApplication {
    if (!pca) {
      throw new Error(
        t({
          id: "officeAddin.auth.msalNotInitialized",
          message: "MSAL not initialized",
        }),
      );
    }
    return pca;
  }

  return {
    mode: "entra-msal",

    async initialize(): Promise<void> {
      const clientId =
        import.meta.env.VITE_MSAL_CLIENT_ID ?? env().msalClientId;
      if (!clientId) {
        throw new Error(
          t({
            id: "officeAddin.auth.msalClientIdMissing",
            message: "MSAL client ID is not configured",
          }),
        );
      }

      const authority =
        import.meta.env.VITE_MSAL_AUTHORITY ??
        env().msalAuthority ??
        "https://login.microsoftonline.com/common";

      const msalConfig: EntraMsalConfig = {
        auth: {
          clientId,
          authority,
        },
        cache: {
          cacheLocation: "localStorage" as const,
        },
      };
      pca = await options.createPca(msalConfig);
      loginHint = await options.resolveLoginHint();
    },

    async acquireBootstrapToken(
      opts: AcquireBootstrapOptions = {},
    ): Promise<BootstrapToken> {
      const instance = requirePca();
      const result = await acquireMsalResult(
        instance,
        OAUTH2_PROXY_SESSION_SCOPES,
        opts.allowInteraction ?? false,
        opts.forceRefresh ?? false,
      );
      applyResult(instance, result);
      return {
        idToken: result.idToken,
        accessToken: result.accessToken,
      };
    },

    async acquireGraphToken(
      scopes: string[],
      options: { forceRefresh?: boolean; allowInteraction?: boolean } = {},
    ): Promise<{
      accessToken: string;
      bootstrap: BootstrapToken;
    }> {
      const instance = requirePca();
      // Silent by default: a failed silent acquire surfaces as
      // InteractionRequiredError so the caller can show an inline "Sign in"
      // prompt instead of auto-popping a window mid email-drop. A popup happens
      // only when the user explicitly opts in via `allowInteraction`.
      const result = await acquireMsalResult(
        instance,
        scopes,
        options.allowInteraction ?? false,
        options.forceRefresh ?? false,
      );
      applyResult(instance, result);
      return {
        accessToken: result.accessToken,
        bootstrap: {
          idToken: result.idToken,
          accessToken: result.accessToken,
        },
      };
    },
  };
}
