import { t } from "@lingui/core/macro";

import type { AuthMode, AuthSource, BootstrapToken } from "./AuthSource";

/** The single mode with no working {@link AuthSource}: no NAA and no mailbox to
 * log in against. The `entra-msal` mode authenticates (NAA or interactive), so
 * the only residual unsupported `AuthMode` is `"unsupported"` itself. */
type UnsupportedReason = Extract<AuthMode, "unsupported">;

/** The localized "can't sign in here" error for an unsupported environment.
 * Host-neutral on purpose: this state is now reached only when there is neither
 * NAA nor a mailbox to run an interactive Entra login against, so the older
 * NAA-specific wording would misattribute the cause. */
function unsupportedReasonError(): Error {
  return new Error(
    t({
      id: "officeAddin.auth.signInUnavailable",
      message: "Sign-in isn't available in this environment",
    }),
  );
}

/**
 * An {@link AuthSource} for `unsupported` environments — a host with no NAA and
 * no mailbox to run an interactive Entra login against, so neither Entra source
 * applies. Its `initialize()` throws a typed, localized message that the
 * SessionAuth core surfaces through the existing error + "Try again" UI — no
 * new component.
 */
export class UnsupportedAuthSource implements AuthSource {
  readonly mode: UnsupportedReason;

  constructor(reason: UnsupportedReason) {
    this.mode = reason;
  }

  initialize(): Promise<void> {
    return Promise.reject(unsupportedReasonError());
  }

  acquireBootstrapToken(): Promise<BootstrapToken> {
    // Unreachable on the happy path — the core never advances to bootstrap once
    // initialize() rejects — but the AuthSource contract requires it.
    return Promise.reject(unsupportedReasonError());
  }
}
