import {
  PublicClientApplication,
  createNestablePublicClientApplication,
} from "@azure/msal-browser";

import { createEntraAuthSource } from "./entraAuthSource";
import { NestedAppAuthUnavailableError } from "../core/auth/AuthSource";

import type {
  AuthSource,
  GraphCapableSource,
  LoginHintResolver,
} from "../core/auth/AuthSource";

interface EntraNaaAuthSourceOptions {
  /** Host-injected: Outlook adds a mailbox fallback, Excel/Word does not. */
  resolveLoginHint: LoginHintResolver;
  /**
   * Reject `initialize()` with {@link NestedAppAuthUnavailableError} when the
   * host has no NAA bridge, instead of continuing with the standard client
   * MSAL silently falls back to.
   */
  requireBridge?: boolean;
}

/**
 * The Entra/MSAL-NAA {@link AuthSource} (EXO / Microsoft 365). A thin wrapper
 * over the shared {@link createEntraAuthSource} that injects the nestable PCA
 * factory — the only NAA-specific piece. `supportsNestedAppAuth` is assigned
 * via a spread (not a literal) so TS's excess-property check doesn't reject it;
 * the NAA-capable runtime reads it but it isn't in the published
 * `BrowserAuthOptions` type.
 */
export function createEntraNaaAuthSource(
  options: EntraNaaAuthSourceOptions,
): AuthSource & GraphCapableSource {
  const { resolveLoginHint, requireBridge = false } = options;
  return createEntraAuthSource({
    resolveLoginHint,
    createPca: async (config) => {
      // Assigned to a variable (not passed as a literal) so TS's excess-property
      // check doesn't reject `supportsNestedAppAuth`, which the NAA-capable
      // runtime reads but isn't in the published BrowserAuthOptions type.
      const naaConfig = {
        ...config,
        auth: { ...config.auth, supportsNestedAppAuth: true },
      };
      if (!requireBridge) {
        return createNestablePublicClientApplication(naaConfig);
      }
      // MSAL calls the factory only once its NAA operating context has
      // connected to the host bridge (after `__initializeNestedAppAuth` and the
      // bridge handshake); otherwise it returns a standard client instead.
      let usesBridge = false;
      const pca = await createNestablePublicClientApplication(
        naaConfig,
        undefined,
        (configuration, controller) => {
          usesBridge = true;
          return new PublicClientApplication(configuration, controller);
        },
      );
      if (!usesBridge) {
        throw new NestedAppAuthUnavailableError();
      }
      return pca;
    },
  });
}
