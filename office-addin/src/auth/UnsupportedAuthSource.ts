import { t } from "@lingui/core/macro";

import type { AuthMode, AuthSource, BootstrapToken } from "./AuthSource";

/** The modes Step 0 recognises but can't authenticate yet — every `AuthMode`
 * except the one working source. Derived from {@link AuthMode} so a new mode
 * can't silently fall out of sync. */
type UnsupportedReason = Exclude<AuthMode, "entra-msal">;

/** The localized "can't sign in here yet" error for an unsupported mode. */
function unsupportedReasonError(mode: UnsupportedReason): Error {
  if (mode === "exchange-callback") {
    return new Error(
      t({
        id: "officeAddin.auth.onPremNotSupported",
        message: "On-prem (legacy Exchange) sign-in isn't supported yet.",
      }),
    );
  }
  return new Error(
    t({
      id: "officeAddin.auth.naaUnsupported",
      message: "Nested App Authentication is not supported in this environment",
    }),
  );
}

/**
 * An {@link AuthSource} for environments Step 0 can't authenticate yet. Its
 * `initialize()` throws a typed, localized message that the SessionAuth core
 * surfaces through the existing error + "Try again" UI — no new component.
 *
 * - `exchange-callback`: on-prem Exchange (callback-token path) — recognised but
 *   not implemented yet (a future step wires the Exchange callback token).
 * - `unsupported`: genuinely unsupported host (no NAA, no mailbox) — preserves
 *   the previous "Nested App Authentication is not supported" behaviour.
 */
export class UnsupportedAuthSource implements AuthSource {
  readonly mode: UnsupportedReason;

  constructor(reason: UnsupportedReason) {
    this.mode = reason;
  }

  initialize(): Promise<void> {
    return Promise.reject(unsupportedReasonError(this.mode));
  }

  acquireBootstrapToken(): Promise<BootstrapToken> {
    // Unreachable on the happy path — the core never advances to bootstrap once
    // initialize() rejects — but the AuthSource contract requires it.
    return Promise.reject(unsupportedReasonError(this.mode));
  }
}
