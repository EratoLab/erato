import { createNestablePublicClientApplication } from "@azure/msal-browser";
import { setIdToken } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS } from "../../auth/oauth2ProxySession";
import { MsalNaaProvider, useMsalNaa } from "../MsalNaaProvider";

import type {
  AccountInfo,
  AuthenticationResult,
  IPublicClientApplication,
} from "@azure/msal-browser";

vi.mock("@azure/msal-browser", () => {
  class InteractionRequiredAuthError extends Error {}

  return {
    InteractionRequiredAuthError,
    createNestablePublicClientApplication: vi.fn(),
  };
});

vi.mock("@erato/frontend/library", () => ({
  env: () => ({
    msalClientId: "client-id",
    msalAuthority: "https://login.microsoftonline.com/tenant",
  }),
  setIdToken: vi.fn(),
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
  const auth = useMsalNaa();

  return (
    <dl>
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

describe("MsalNaaProvider", () => {
  beforeEach(() => {
    i18n.activate("en");
    window.localStorage.clear();
    installNaaOfficeContext();
    vi.mocked(createNestablePublicClientApplication).mockResolvedValue(
      createPcaMock(),
    );
  });

  afterEach(() => {
    cleanup();
    uninstallNaaOfficeContext();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("authenticates through the oauth2-proxy session cookie without Graph", async () => {
    const fetcher = stubFetch(new Response("{}", { status: 202 }));

    render(
      <MsalNaaProvider>
        <AuthProbe />
      </MsalNaaProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );

    expect(screen.getByTestId("cookie")).toHaveTextContent("true");
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
    expect(setIdToken).toHaveBeenCalledWith("id-token");
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
      <MsalNaaProvider>
        <AuthProbe />
      </MsalNaaProvider>,
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
        <MsalNaaProvider>
          <AuthProbe />
        </MsalNaaProvider>,
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
        <MsalNaaProvider>
          <AuthProbe />
        </MsalNaaProvider>,
      );

      await advance(0);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Scheduled refresh fires and fails -> recoverable error state, not silent.
      await advance(OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS + 1_000);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("status")).toHaveTextContent("error");
      expect(screen.getByTestId("authenticated")).toHaveTextContent("false");

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
        <MsalNaaProvider>
          <AuthProbe />
        </MsalNaaProvider>,
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
      <MsalNaaProvider>
        <AuthProbe />
      </MsalNaaProvider>,
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
});
