/**
 * The auth strategy in effect for the current host/environment. The `entra-msal`
 * mode covers the EXO NAA {@link AuthSource} ({@link "./EntraNaaAuthSource"}),
 * which redeems an Entra id_token + Graph token for the proxy session. The
 * NAA-less hybrid mailbox (Exchange SE) ALSO reports `entra-msal` — but via the
 * oauth2-proxy redirect login (see
 * {@link "../providers/Oauth2ProxyLoginProvider"}), which has no client-side
 * `AuthSource`: the user is still an Entra identity, so the mail-fetch hook
 * treats it as authenticated and routes SE mail to the EWS SOAP backend
 * (Erato backend proxy + host-brokered `makeEwsRequestAsync`).
 * `unsupported` is the one residual "can't sign in here" state — no NAA and no
 * mailbox to log in against (see {@link "./UnsupportedAuthSource"}).
 */
export type AuthMode = "entra-msal" | "unsupported";

/**
 * Layer-1 bootstrap token plus the identity it was minted for. This is the
 * input to oauth2-proxy session redemption (Layer-2) and the ONLY thing the
 * host-agnostic SessionAuth core receives from an {@link AuthSource}.
 */
export interface BootstrapToken {
  /** Redeemed at `/oauth2/redeem-external-token` as `id_token`. */
  idToken: string;
  /** Redeemed as `access_token` when present. EXO has it; on-prem won't. */
  accessToken?: string;
}

export interface AcquireBootstrapOptions {
  /**
   * Re-mint even if a silent/cached token exists. Drives `recoverAuth` in a
   * later step; unused on the Step-0 happy path.
   */
  forceRefresh?: boolean;
  /**
   * Skip the silent MSAL acquire and ask the user to authenticate immediately.
   * This is reserved for an explicit user action (the AuthGate sign-in button):
   * MSAL's silent `forceRefresh` refreshes the access token, but some NAA hosts
   * can keep returning the same expired ID token that oauth2-proxy rejected.
   * An interactive acquire is then required to mint a new identity token.
   */
  forceInteraction?: boolean;
  /**
   * When true the source MAY open interactive UI (popup) if a silent acquire
   * fails. Maps to the old `allowPopup`: init/timed-refresh pass false, the
   * user-driven retry passes true. Background timers/focus must pass false.
   */
  allowInteraction?: boolean;
}

/**
 * Host-agnostic Layer-1 token source — one instance per auth mode. The
 * SessionAuth core depends ONLY on this interface, never on Office, the
 * mailbox, MSAL, or Microsoft Graph.
 */
export interface AuthSource {
  readonly mode: AuthMode;

  /**
   * Prepare the source (MSAL: create the nestable PCA + resolve the login
   * hint). MUST be re-runnable after a failure so the retry flow can re-init.
   * Throws on hard init failure; the core catches it and surfaces it via
   * `error`.
   */
  initialize(): Promise<void>;

  /**
   * Acquire/re-acquire the Layer-1 bootstrap token. Silent unless
   * `allowInteraction` is set. Throws {@link InteractionRequiredError} when
   * interaction is required but not allowed — the core maps that to the
   * sign-in-required state.
   */
  acquireBootstrapToken(
    options?: AcquireBootstrapOptions,
  ): Promise<BootstrapToken>;
}

/**
 * Resolves an optional login hint for the bootstrap acquire. Injected per host:
 * {@link "../providers/OutlookAuthProvider"} adds a mailbox fallback; Excel/Word
 * supply a mailbox-less resolver (or none). Keeping this injected is what stops
 * the mailbox from leaking into the Entra source.
 */
export type LoginHintResolver = () => Promise<string | undefined>;

/**
 * Outlook-only capability bolted onto the Entra source: acquires a Microsoft
 * Graph access token for arbitrary scopes (`Mail.Read`, …) reusing the SAME
 * initialized PCA + login hint. Returns the full bootstrap so the caller can
 * re-redeem the proxy session from the token it ALREADY holds — no second MSAL
 * acquisition. Excel/Word never reference this.
 */
export interface GraphCapableSource {
  acquireGraphToken(
    scopes: string[],
    options?: { forceRefresh?: boolean; allowInteraction?: boolean },
  ): Promise<{
    accessToken: string;
    bootstrap: BootstrapToken;
  }>;
}

/**
 * Host-agnostic "interaction required" signal. The Entra source translates
 * MSAL's `InteractionRequiredAuthError` into this so the SessionAuth core can
 * recognise "sign-in required" without importing `@azure/msal-browser`.
 */
export class InteractionRequiredError extends Error {
  constructor(message = "Interaction required", options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : options);
    this.name = "InteractionRequiredError";
  }
}
