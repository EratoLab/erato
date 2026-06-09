import {
  InteractionRequiredAuthError,
  createNestablePublicClientApplication,
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

interface EntraNaaAuthSourceOptions {
  /** Host-injected: Outlook adds a mailbox fallback, Excel/Word does not. */
  resolveLoginHint: LoginHintResolver;
}

/**
 * The Entra/MSAL-NAA {@link AuthSource} (EXO / Microsoft 365). All MSAL and NAA
 * coupling lives here, behind the host-agnostic `AuthSource` interface, so the
 * SessionAuth core and other hosts never import `@azure/msal-browser`.
 *
 * Also implements {@link GraphCapableSource} — the Outlook-only Graph token
 * path — because it reuses the same initialized PCA + login hint. Non-Outlook
 * hosts simply never call `acquireGraphToken`.
 */
export function createEntraNaaAuthSource(
  options: EntraNaaAuthSourceOptions,
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
      if (silentError instanceof InteractionRequiredAuthError) {
        if (allowInteraction) {
          const result = await instance.acquireTokenPopup({
            scopes,
            prompt: "select_account",
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

      // Assigned to a variable (not passed as a literal) so TS's excess-property
      // check doesn't reject `supportsNestedAppAuth`, which the NAA-capable
      // runtime reads but isn't in the published BrowserAuthOptions type.
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
      pca = await createNestablePublicClientApplication(msalConfig);
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
        account: result.account,
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
          account: result.account,
        },
      };
    },
  };
}
