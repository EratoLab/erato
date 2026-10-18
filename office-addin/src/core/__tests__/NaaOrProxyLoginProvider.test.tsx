import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NaaOrProxyLoginProvider } from "../NaaOrProxyLoginProvider";
import { useSessionAuth } from "../SessionAuthProvider";
import {
  InteractionRequiredError,
  NestedAppAuthUnavailableError,
  type AuthSource,
} from "../auth/AuthSource";
import { OAUTH2_PROXY_AUTH_PATH } from "../auth/oauth2ProxySession";
import {
  readRememberedProxyLogin,
  rememberProxyLogin,
} from "../auth/signInPath";

vi.mock("@erato/frontend/library", () => ({
  setAuthRecoveryHandler: vi.fn(),
}));

const REDEEM_PATH = "/oauth2/redeem-external-token";

function msalError(errorCode: string) {
  return Object.assign(new Error(errorCode), { errorCode });
}

function naaSource(overrides: Partial<AuthSource> = {}) {
  return {
    mode: "entra-msal",
    initialize: vi.fn(async () => undefined),
    acquireBootstrapToken: vi.fn(async () => ({
      idToken: "id-token",
      accessToken: "access-token",
    })),
    ...overrides,
  } satisfies AuthSource;
}

function bridgeMissingSource() {
  return naaSource({
    initialize: vi.fn(async () => {
      throw new NestedAppAuthUnavailableError();
    }),
  });
}

// Answers the proxy's session probe and redeem endpoint independently.
function stubProxy({
  sessionStatus = 401,
  redeemStatus = 202,
}: { sessionStatus?: number; redeemStatus?: number } = {}) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === OAUTH2_PROXY_AUTH_PATH) {
      return new Response("", { status: sessionStatus });
    }
    if (url === REDEEM_PATH) {
      return new Response("", { status: redeemStatus });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  Object.defineProperty(window, "fetch", {
    configurable: true,
    value: fetcher,
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function fetchedPaths(fetcher: ReturnType<typeof stubProxy>): string[] {
  return fetcher.mock.calls.map(([input]) => String(input));
}

function AuthProbe() {
  const auth = useSessionAuth();
  return (
    <dl>
      <dd data-testid="initialized">{String(auth.isInitialized)}</dd>
      <dd data-testid="authenticated">{String(auth.isAuthenticated)}</dd>
      <dd data-testid="error">{auth.error ?? ""}</dd>
      <button
        type="button"
        data-testid="sign-in"
        onClick={() => {
          void auth.retryAuthentication();
        }}
      >
        sign in
      </button>
    </dl>
  );
}

function renderProvider(
  createNaaSource: () => AuthSource | null,
  switchOnNaaFailure = false,
) {
  return render(
    <NaaOrProxyLoginProvider
      createNaaSource={createNaaSource}
      switchOnNaaFailure={switchOnNaaFailure}
    >
      <AuthProbe />
    </NaaOrProxyLoginProvider>,
  );
}

async function waitForInitialized() {
  await waitFor(() =>
    expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
  );
}

describe("NaaOrProxyLoginProvider", () => {
  beforeEach(() => {
    i18n.activate("en");
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("signs in through NAA when the bridge connects, initializing the source once", async () => {
    const fetcher = stubProxy();
    const source = naaSource();

    renderProvider(() => source);

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );
    expect(source.initialize).toHaveBeenCalledTimes(1);
    expect(source.acquireBootstrapToken).toHaveBeenCalledWith({
      allowInteraction: false,
    });
    expect(fetchedPaths(fetcher)).toEqual([REDEEM_PATH]);
    expect(console.info).toHaveBeenCalledWith("Add-in sign-in path: naa");
  });

  it("uses the proxy login without touching MSAL when the bridge is missing", async () => {
    const fetcher = stubProxy({ sessionStatus: 401 });
    const source = bridgeMissingSource();
    const open = vi.fn(() => null);
    Object.defineProperty(window, "open", { configurable: true, value: open });

    renderProvider(() => source);
    await waitForInitialized();

    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(fetchedPaths(fetcher)).toEqual([OAUTH2_PROXY_AUTH_PATH]);

    fireEvent.click(screen.getByTestId("sign-in"));

    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/^\/oauth2\/sign_in\?rd=/),
      "erato-oauth2-login",
      expect.any(String),
    );
    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent(
        "Sign-in popup was blocked",
      ),
    );
    expect(source.acquireBootstrapToken).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      "Add-in sign-in path: oauth2-proxy (no-naa-bridge)",
    );
  });

  it("keeps an existing proxy session when the bridge is missing", async () => {
    stubProxy({ sessionStatus: 202 });

    renderProvider(bridgeMissingSource);

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );
  });

  it("uses the proxy login when the host reports no NAA at all", async () => {
    const fetcher = stubProxy({ sessionStatus: 202 });

    renderProvider(() => null);

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );
    expect(fetchedPaths(fetcher)).toEqual([OAUTH2_PROXY_AUTH_PATH]);
  });

  it("keeps other init failures on the NAA flow and re-probes on retry", async () => {
    stubProxy();
    const broken = naaSource({
      initialize: vi.fn(async () => {
        throw new Error("MSAL client ID is not configured");
      }),
    });
    const healthy = naaSource();
    const createNaaSource = vi
      .fn<() => AuthSource | null>()
      .mockReturnValueOnce(broken)
      .mockReturnValue(healthy);

    renderProvider(createNaaSource);
    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent(
        "MSAL client ID is not configured",
      ),
    );
    expect(broken.initialize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("sign-in"));

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );
    expect(createNaaSource).toHaveBeenCalledTimes(2);
  });

  describe("when a NAA sign-in fails", () => {
    function sourceFailingInteractiveSignIn(error: unknown) {
      return naaSource({
        acquireBootstrapToken: vi.fn(async (options) => {
          if (options?.forceInteraction) {
            throw error;
          }
          throw new InteractionRequiredError();
        }),
      });
    }

    async function signInAndFail(
      error: unknown,
      { switchOnNaaFailure }: { switchOnNaaFailure: boolean },
    ) {
      const fetcher = stubProxy({ sessionStatus: 401 });
      const source = sourceFailingInteractiveSignIn(error);
      renderProvider(() => source, switchOnNaaFailure);
      await waitForInitialized();
      expect(screen.getByTestId("authenticated")).toHaveTextContent("false");

      fireEvent.click(screen.getByTestId("sign-in"));
      await waitFor(() =>
        expect(source.acquireBootstrapToken).toHaveBeenCalledWith(
          expect.objectContaining({ forceInteraction: true }),
        ),
      );
      await waitForInitialized();
      return fetcher;
    }

    it("switches to the proxy login on a non-interaction error and remembers it", async () => {
      const fetcher = await signInAndFail(msalError("timed_out"), {
        switchOnNaaFailure: true,
      });

      await waitFor(() =>
        expect(fetchedPaths(fetcher)).toContain(OAUTH2_PROXY_AUTH_PATH),
      );
      expect(readRememberedProxyLogin()).toBe(true);
      expect(console.warn).toHaveBeenCalledWith(
        "NAA sign-in failed (timed_out); switching to the oauth2-proxy login",
      );
    });

    it("switches when the proxy refuses the NAA token", async () => {
      const fetcher = stubProxy({ sessionStatus: 401, redeemStatus: 401 });
      const source = naaSource({
        acquireBootstrapToken: vi.fn(async (options) => {
          if (options?.forceInteraction) {
            return { idToken: "id-token" };
          }
          throw new InteractionRequiredError();
        }),
      });
      renderProvider(() => source, true);
      await waitForInitialized();

      fireEvent.click(screen.getByTestId("sign-in"));

      await waitFor(() =>
        expect(fetchedPaths(fetcher)).toContain(OAUTH2_PROXY_AUTH_PATH),
      );
      expect(console.warn).toHaveBeenCalledWith(
        "NAA sign-in failed (redeem_401); switching to the oauth2-proxy login",
      );
    });

    it("stays on NAA when the user cancels", async () => {
      const fetcher = await signInAndFail(msalError("user_cancelled"), {
        switchOnNaaFailure: true,
      });

      expect(fetchedPaths(fetcher)).not.toContain(OAUTH2_PROXY_AUTH_PATH);
      expect(readRememberedProxyLogin()).toBe(false);
      expect(screen.getByTestId("error")).toHaveTextContent("user_cancelled");
    });

    it("stays on NAA when the host doesn't allow the switch", async () => {
      const fetcher = await signInAndFail(msalError("timed_out"), {
        switchOnNaaFailure: false,
      });

      expect(fetchedPaths(fetcher)).not.toContain(OAUTH2_PROXY_AUTH_PATH);
      expect(readRememberedProxyLogin()).toBe(false);
      expect(console.warn).toHaveBeenCalledWith(
        "NAA sign-in failed (timed_out)",
      );
    });
  });

  it("goes straight to the proxy login after a switch earlier in this pane session", async () => {
    rememberProxyLogin();
    const fetcher = stubProxy({ sessionStatus: 202 });
    const createNaaSource = vi.fn(() => naaSource());

    renderProvider(createNaaSource);

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );
    expect(createNaaSource).not.toHaveBeenCalled();
    expect(fetchedPaths(fetcher)).toEqual([OAUTH2_PROXY_AUTH_PATH]);
  });
});
