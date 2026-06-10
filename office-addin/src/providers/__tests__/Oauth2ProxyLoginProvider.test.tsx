import { setAuthRecoveryHandler } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Oauth2ProxyLoginProvider } from "../Oauth2ProxyLoginProvider";
import { useSessionAuth } from "../SessionAuthProvider";

vi.mock("@erato/frontend/library", () => ({
  setAuthRecoveryHandler: vi.fn(),
}));

function stubFetch(response: Response | (() => Response)) {
  const fetcher = vi.fn(async () =>
    typeof response === "function" ? response() : response,
  );
  Object.defineProperty(window, "fetch", {
    configurable: true,
    value: fetcher,
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

// Returns a fresh Response per call, advancing through the factories and
// repeating the last one.
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

interface FakePopup {
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
}

function stubWindowOpen(popup: FakePopup | null) {
  const open = vi.fn(() => popup as unknown as Window | null);
  Object.defineProperty(window, "open", { configurable: true, value: open });
  return open;
}

function AuthProbe() {
  const auth = useSessionAuth();
  return (
    <dl>
      <dt>mode</dt>
      <dd data-testid="mode">{auth.mode}</dd>
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

describe("Oauth2ProxyLoginProvider", () => {
  beforeEach(() => {
    i18n.activate("en");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("authenticates when the mount probe finds a valid session", async () => {
    const fetcher = stubFetch(new Response("{}", { status: 202 }));

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("entra-msal");
    expect(screen.getByTestId("cookie")).toHaveTextContent("true");
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
    expect(fetcher).toHaveBeenCalledWith(
      "/oauth2/auth",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("shows needs-signin (initialized, not authenticated) when the probe is 401", async () => {
    stubFetch(new Response("Unauthorized", { status: 401 }));

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
  });

  it("signs in via a popup and authenticates on the postMessage completion", async () => {
    // Probe 401 first (needs-signin), then 202 once the popup completes.
    stubFetchSequence([
      () => new Response("Unauthorized", { status: 401 }),
      () => new Response("{}", { status: 202 }),
    ]);
    const popup: FakePopup = { closed: false, close: vi.fn() };
    const open = stubWindowOpen(popup);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");

    act(() => {
      screen.getByTestId("retry").click();
    });

    expect(open).toHaveBeenCalledWith(
      "/oauth2/sign_in?rd=" + encodeURIComponent("/auth-complete.html"),
      "erato-oauth2-login",
      "width=520,height=680",
    );
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");

    // The auth-complete page posts back from the same origin.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: "erato-oauth2-login-complete",
          origin: window.location.origin,
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );
    expect(popup.close).toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
  });

  it("returns to needs-signin with an error when the popup is blocked", async () => {
    stubFetch(new Response("Unauthorized", { status: 401 }));
    const open = stubWindowOpen(null);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );

    act(() => {
      screen.getByTestId("retry").click();
    });

    expect(open).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent("popup"),
    );
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
  });

  it("registers a recovery handler that re-probes the session on a 401", async () => {
    stubFetch(new Response("{}", { status: 202 }));

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true"),
    );

    const handler = vi
      .mocked(setAuthRecoveryHandler)
      .mock.calls.map((call) => call[0])
      .find(
        (arg): arg is (reason: string) => Promise<boolean> =>
          typeof arg === "function",
      );
    expect(handler).toBeDefined();

    // Cookie still valid server-side → recovery succeeds and the caller replays.
    const fetcher = stubFetch(new Response("{}", { status: 202 }));
    let recovered: boolean | undefined;
    await act(async () => {
      recovered = await handler!("rest-401");
    });
    expect(recovered).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "/oauth2/auth",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );

    // Cookie gone → recovery fails and escalates to needs-signin.
    stubFetch(new Response("Unauthorized", { status: 401 }));
    let recoveredAfterExpiry: boolean | undefined;
    await act(async () => {
      recoveredAfterExpiry = await handler!("rest-401-again");
    });
    expect(recoveredAfterExpiry).toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("false"),
    );
  });
});
