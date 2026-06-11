import { createNestablePublicClientApplication } from "@azure/msal-browser";

import { createEntraAuthSource } from "./entraAuthSource";

import type {
  AuthSource,
  GraphCapableSource,
  LoginHintResolver,
} from "./AuthSource";

interface EntraNaaAuthSourceOptions {
  /** Host-injected: Outlook adds a mailbox fallback, Excel/Word does not. */
  resolveLoginHint: LoginHintResolver;
}

/**
 * The Entra/MSAL-NAA {@link AuthSource} (EXO / Microsoft 365). A thin wrapper
 * over the shared {@link createEntraAuthSource} that injects the nestable PCA
 * factory — the only NAA-specific piece. `supportsNestedAppAuth` is assigned
 * via a spread (not a literal) so TS's excess-property check doesn't reject it;
 * the NAA-capable runtime reads it but it isn't in the published
 * `BrowserAuthOptions` type.
 */
export function createEntraNaaAuthSource(options: {
  resolveLoginHint: LoginHintResolver;
}): AuthSource & GraphCapableSource {
  const { resolveLoginHint }: EntraNaaAuthSourceOptions = options;
  return createEntraAuthSource({
    resolveLoginHint,
    createPca: (config) => {
      // Assigned to a variable (not passed as a literal) so TS's excess-property
      // check doesn't reject `supportsNestedAppAuth`, which the NAA-capable
      // runtime reads but isn't in the published BrowserAuthOptions type.
      const naaConfig = {
        ...config,
        auth: { ...config.auth, supportsNestedAppAuth: true },
      };
      return createNestablePublicClientApplication(naaConfig);
    },
  });
}
