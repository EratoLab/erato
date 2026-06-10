import {
  createNestablePublicClientApplication,
  createStandardPublicClientApplication,
} from "@azure/msal-browser";
import { setAuthRecoveryHandler } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS } from "../../auth/oauth2ProxySession";
import { useGraphTokenOptional } from "../EntraGraphTokenProvider";
import { OutlookAuthProvider } from "../OutlookAuthProvider";
import { useSessionAuth } from "../SessionAuthProvider";

import type {
  AccountInfo,
  AuthenticationResult,
  IPublicClientApplication,
} from "@azure/msal-browser";

vi.mock("@azure/msal-browser", () => {
  class AuthError extends Error {
    errorCode: string;
    constructor(errorCode: string, message?: string) {
      super(message ?? errorCode);
      this.errorCode = errorCode;
    }
  }
  class InteractionRequiredAuthError extends AuthError {
    constructor(message?: string) {
      super("interaction_required", message);
    }
  }

  return {
    AuthError,
    InteractionRequiredAuthError,
    createNestablePublicClientApplication: vi.fn(),
    createStandardPublicClientApplication: vi.fn(),
  };
});

vi.mock("@erato/frontend/library", () => ({
  env: () => ({
    msalClientId: "client-id",
    msalAuthority: "https://login.microsoftonline.com/tenant",
  }),
  setIdToken: vi.fn(),
  setAuthRecoveryHandler: vi.fn(),
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

const account = {
  homeAccountId: "home-account",
  environment: "login.microsoftonline.com",
  tenantId: "tenant",
  username: "user@example.com",
  localAccountId: "local-account",
} as AccountInfo;

const authenticationResult = {
  account,
  idToken: "id-token",
  accessToken: "access-token",
  scopes: ["User.Read"],
  expiresOn: null,
  tokenType: "Bearer",
  uniqueId: "unique-id",
  tenantId: "tenant",
} as AuthenticationResult;

function installNaaOfficeContext() {
  (Office.context as unknown as Record<string, unknown>).requirements = {
    isSetSupported: vi.fn(
      (name: string, version: string) =>
        name === "NestedAppAuth" && version === "1.1",
    ),
  };
  (Office as unknown as Record<string, unknown>).auth = {
    getAuthContext: vi.fn(async () => ({
      userPrincipalName: "user@example.com",
    })),
  };
}

function uninstallNaaOfficeContext() {
  delete (Office.context as unknown as Record<string, unknown>).requirements;
  delete (Office as unknown as Record<string, unknown>).auth;
}

// A NAA-less mailbox (e.g. Exchange SE OWA). With NAA absent but a mailbox
// present, OutlookAuthProvider picks the oauth2-proxy redirect-login path.
function installMailbox() {
  (Office.context as unknown as Record<string, unknown>).mailbox = {
    userProfile: { accountType: "enterprise" },
  };
}

function uninstallMailbox() {
  delete (Office.context as unknown as Record<string, unknown>).mailbox;
}

function createPcaMock(
  result: AuthenticationResult = authenticationResult,
): IPublicClientApplication {
  return {
    acquireTokenSilent: vi.fn(async () => result),
    acquireTokenPopup: vi.fn(async () => result),
    setActiveAccount: vi.fn(),
  } as unknown as IPublicClientApplication;
}

function stubFetch(response: Response) {
  const fetcher = vi.fn(async () => response);
  Object.defineProperty(window, "fetch", {
    configurable: true,
    value: fetcher,
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

// Returns a fresh Response per call, advancing through the factories and
// repeating the last one. Factories avoid sharing an already-consumed body.
function stubFetchSequence(factories: Array<() => Response>) {
  let index = 0;
  const fetcher = vi.fn(async () => {
    const factory = factories[Math.min(index, factories.length - 1)];
    index += 1;
    return factory();
  });
  Object.defineProperty(window, "fetch", {
    configurable: true,
    value: fetcher,
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

// Advances fake timers and flushes the awaited microtasks the auth flow chains
// (MSAL acquisition, the redeem fetch, and the resulting state updates).
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function AuthProbe() {
  const auth = useSessionAuth();
  // Observes whether EntraGraphTokenProvider is mounted — it must be for
  // entra-msal only.
  const graph = useGraphTokenOptional();

  return (
    <dl>
      <dt>mode</dt>
      <dd data-testid="mode">{auth.mode}</dd>
      <dt>graph-mounted</dt>
      <dd data-testid="graph-mounted">{String(graph !== null)}</dd>
      <dt>initialized</dt>
      <dd data-testid="initialized">{String(auth.isInitialized)}</dd>
      <dt>authenticated</dt>
      <dd data-testid="authenticated">{String(auth.isAuthenticated)}</dd>
      <dt>cookie</dt>
      <dd data-testid="cookie">{String(auth.isOauth2ProxySessionReady)}</dd>
      <dt>status</dt>
      <dd data-testid="status">{auth.oauth2ProxySessionStatus}</dd>
      <dt>error</dt>
      <dd data-testid="error">{auth.error ?? ""}</dd>
      <dt>retry</dt>
      <dd>
        <button
          type="button"
          data-testid="retry"
          onClick={() => {
            void auth.retryAuthentication();
          }}
        >
          retry
        </button>
      </dd>
    </dl>
  );
}

describe("OutlookAuthProvider", () => {
  beforeEach(() => {
    i18n.activate("en");
    window.localStorage.clear();
    installNaaOfficeContext();
    vi.mocked(createNestablePublicClientApplication).mockResolvedValue(
      createPcaMock(),
    );
    vi.mocked(createStandardPublicClientApplication).mockResolvedValue(
      createPcaMock(),
    );
  });

  afterEach(() => {
    cleanup();
    uninstallNaaOfficeContext();
    uninstallMailbox();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("authenticates through the oauth2-proxy session cookie without Graph", async () => {
    const fetcher = stubFetch(new Response("{}", { status: 202 }));

    render(
      <OutlookAuthProvider>
        <AuthProbe />
      </OutlookAuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );

    expect(screen.getByTestId("cookie")).toHaveTextContent("true");
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
    expect(screen.getByTestId("mode")).toHaveTextContent("entra-msal");
    expect(screen.getByTestId("graph-mounted")).toHaveTextContent("true");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/oauth2/redeem-external-token",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("surfaces oauth2-proxy redemption failures as unauthenticated state", async () => {
    stubFetch(new Response("Unauthorized", { status: 401 }));

    render(
      <OutlookAuthProvider>
        <AuthProbe />
      </OutlookAuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );

    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("cookie")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent(
      "Could not establish a secure Erato session.",
    );
  });

  it("redeems a fresh session on the refresh timer before expiry", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = stubFetch(new Response("{}", { status: 202 }));

      render(
        <OutlookAuthProvider>
          <AuthProbe />
        </OutlookAuthProvider>,
      );

      await advance(0);
      expect(screen.getByTestId("status")).toHaveTextContent("ready");
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Cross the 20-minute refresh window; the timer must redeem again without
      // a reload.
      await advance(OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS + 1_000);

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("status")).toHaveTextContent("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers on the backoff timer after a transient refresh failure", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = stubFetchSequence([
        () => new Response("{}", { status: 202 }), // initial establish
        () => new Response("upstream down", { status: 503 }), // timed refresh fails
        () => new Response("{}", { status: 202 }), // backoff retry succeeds
      ]);

      render(
        <OutlookAuthProvider>
          <AuthProbe />
        </OutlookAuthProvider>,
      );

      await advance(0);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Scheduled refresh fires and fails -> recoverable error state, not silent.
      await advance(OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS + 1_000);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("status")).toHaveTextContent("error");
      // A transient background-refresh failure must NOT blank the chat: the
      // session is still established, so the user stays authenticated while the
      // backoff timer retries silently.
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true");

      // The backoff timer re-arms and the next attempt restores the session.
      // Advancing past the max backoff guarantees the retry fires.
      await advance(5 * 60_000 + 1_000);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId("status")).toHaveTextContent("ready");
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refresh after unmount", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = stubFetch(new Response("{}", { status: 202 }));

      const view = render(
        <OutlookAuthProvider>
          <AuthProbe />
        </OutlookAuthProvider>,
      );

      await advance(0);
      expect(fetcher).toHaveBeenCalledTimes(1);

      view.unmount();
      await advance(OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS + 1_000);

      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers from an MSAL initialization failure when the user retries", async () => {
    stubFetch(new Response("{}", { status: 202 }));
    vi.mocked(createNestablePublicClientApplication)
      .mockRejectedValueOnce(new Error("init boom"))
      .mockResolvedValue(createPcaMock());

    render(
      <OutlookAuthProvider>
        <AuthProbe />
      </OutlookAuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");

    // "Try again" must re-run initialization (pca is null) rather than throwing
    // "MSAL not initialized".
    fireEvent.click(screen.getByTestId("retry"));

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
  });

  it("registers a recovery handler that force-refreshes and re-redeems on a 401", async () => {
    const fetcher = stubFetch(new Response("{}", { status: 202 }));
    const pca = createPcaMock();
    vi.mocked(createNestablePublicClientApplication).mockResolvedValue(pca);

    render(
      <OutlookAuthProvider>
        <AuthProbe />
      </OutlookAuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );

    // The provider registered its recoverAuth with the shared API/SSE layer.
    const handler = vi
      .mocked(setAuthRecoveryHandler)
      .mock.calls.map((call) => call[0])
      .find(
        (arg): arg is (reason: string) => Promise<boolean> =>
          typeof arg === "function",
      );
    expect(handler).toBeDefined();

    fetcher.mockClear();
    (pca.acquireTokenSilent as Mock).mockClear();

    let recovered: boolean | undefined;
    await act(async () => {
      recovered = await handler!("rest-401");
    });

    expect(recovered).toBe(true);
    // Forced a fresh MSAL token (not the cached one that just 401'd)…
    expect(pca.acquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({ forceRefresh: true }),
    );
    // …and re-redeemed the proxy session cookie.
    expect(fetcher).toHaveBeenCalledWith(
      "/oauth2/redeem-external-token",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("authenticates a NAA-less mailbox (Exchange SE) via the oauth2-proxy session", async () => {
    uninstallNaaOfficeContext();
    installMailbox();
    // The proxy already holds a valid cookie (the user signed in to the web app
    // on the same funnel domain) so the mount probe authenticates immediately.
    const fetcher = stubFetch(new Response("{}", { status: 202 }));

    render(
      <OutlookAuthProvider>
        <AuthProbe />
      </OutlookAuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );

    // The proxy-login path reports entra-msal (an Entra identity, via the proxy)
    // but mounts NO Graph provider — SE reads mail via the REST callback token.
    expect(screen.getByTestId("mode")).toHaveTextContent("entra-msal");
    expect(screen.getByTestId("graph-mounted")).toHaveTextContent("false");
    // No client-side MSAL acquisition happens on this path — the proxy owns the
    // OIDC login. Neither PCA factory is called, and there is no redeem POST.
    expect(createStandardPublicClientApplication).not.toHaveBeenCalled();
    expect(createNestablePublicClientApplication).not.toHaveBeenCalled();
    // Authentication is established by probing the proxy auth endpoint, not by
    // redeeming a client-side token.
    expect(fetcher).toHaveBeenCalledWith(
      "/oauth2/auth",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(fetcher).not.toHaveBeenCalledWith(
      "/oauth2/redeem-external-token",
      expect.anything(),
    );
  });

  it("treats a NAA-less host without a mailbox as unsupported", async () => {
    uninstallNaaOfficeContext();
    const fetcher = stubFetch(new Response("{}", { status: 202 }));

    render(
      <OutlookAuthProvider>
        <AuthProbe />
      </OutlookAuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );

    expect(screen.getByTestId("mode")).toHaveTextContent("unsupported");
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(fetcher).not.toHaveBeenCalled();
    expect(createStandardPublicClientApplication).not.toHaveBeenCalled();
    expect(createNestablePublicClientApplication).not.toHaveBeenCalled();
  });
});
