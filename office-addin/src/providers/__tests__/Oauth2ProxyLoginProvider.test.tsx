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
  focus: ReturnType<typeof vi.fn>;
}

function fakePopup(): FakePopup {
  return { closed: false, close: vi.fn(), focus: vi.fn() };
}

function stubWindowOpen(popup: FakePopup | null) {
  const open = vi.fn(() => popup as unknown as Window | null);
  Object.defineProperty(window, "open", { configurable: true, value: open });
  return open;
}

// Returns the next popup per call, repeating the last one (mirrors
// stubFetchSequence).
function stubWindowOpenSequence(popups: Array<FakePopup | null>) {
  let index = 0;
  const open = vi.fn(() => {
    const popup = popups[Math.min(index, popups.length - 1)];
    index += 1;
    return popup as unknown as Window | null;
  });
  Object.defineProperty(window, "open", { configurable: true, value: open });
  return open;
}

// Drains the chained microtasks of an in-flight session probe (async fetch →
// await → setState) without advancing timers; enough rounds for the deepest
// chain in the provider. waitFor can't be used under fake timers, so the
// fake-timer tests flush explicitly instead.
async function flushSessionProbes() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
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
    // Discards any pending sign-in interval/timeout from fake-timer tests so
    // a stale tick can't leak into the next test's fetch stub.
    vi.useRealTimers();
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
    // Probe 401 first (needs-signin), then 202 for the verification probe that
    // the completion message triggers (the message is a hint, not proof).
    stubFetchSequence([
      () => new Response("Unauthorized", { status: 401 }),
      () => new Response("{}", { status: 202 }),
    ]);
    const popup = fakePopup();
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

  it("ignores the completion message from a foreign origin", async () => {
    const fetcher = stubFetch(new Response("Unauthorized", { status: 401 }));
    const popup = fakePopup();
    stubWindowOpen(popup);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    vi.useFakeTimers();
    act(() => {
      screen.getByTestId("retry").click();
    });
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: "erato-oauth2-login-complete",
          origin: "https://evil.example",
        }),
      );
      await flushSessionProbes();
    });

    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");
    // Only the mount probe hit fetch: the foreign message didn't even trigger
    // a verification probe.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(popup.close).not.toHaveBeenCalled();

    // Settle the flow (popup closed → give up) so its window message listener
    // doesn't leak into the next test — only succeed/giveUp remove it.
    popup.closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await flushSessionProbes();
    });
  });

  it("ignores a same-origin message with the wrong payload", async () => {
    const fetcher = stubFetch(new Response("Unauthorized", { status: 401 }));
    const popup = fakePopup();
    stubWindowOpen(popup);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    vi.useFakeTimers();
    act(() => {
      screen.getByTestId("retry").click();
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: "definitely-not-the-login-message",
          origin: window.location.origin,
        }),
      );
      await flushSessionProbes();
    });

    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(popup.close).not.toHaveBeenCalled();

    // Settle the flow so its window message listener doesn't leak into the
    // next test — only succeed/giveUp remove it.
    popup.closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await flushSessionProbes();
    });
  });

  it("keeps polling when the completion message arrives but the session probe is still 401", async () => {
    // Mount probe 401, message-hint verification probe 401 (the cookie isn't
    // visible to the taskpane yet), then the poll's probe 202.
    stubFetchSequence([
      () => new Response("Unauthorized", { status: 401 }),
      () => new Response("Unauthorized", { status: 401 }),
      () => new Response("{}", { status: 202 }),
    ]);
    const popup = fakePopup();
    stubWindowOpen(popup);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    vi.useFakeTimers();
    act(() => {
      screen.getByTestId("retry").click();
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: "erato-oauth2-login-complete",
          origin: window.location.origin,
        }),
      );
      await flushSessionProbes();
    });

    // Verification said "not yet" → no flash of "authenticated", popup stays
    // open, and the flow keeps going instead of giving up.
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");
    expect(popup.close).not.toHaveBeenCalled();

    // The poll picks the cookie up a beat later.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await flushSessionProbes();
    });
    expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
    expect(popup.close).toHaveBeenCalled();
  });

  it("authenticates when the cookie lands after the completed popup closed itself", async () => {
    // Mount probe 401, message-hint verification probe 401, first grace probe
    // after the popup self-closed still 401, second grace probe 202. The
    // auth-complete page closes the popup right after posting, so the cookie
    // lagging past one poll tick must NOT bounce the login back to the CTA.
    stubFetchSequence([
      () => new Response("Unauthorized", { status: 401 }),
      () => new Response("Unauthorized", { status: 401 }),
      () => new Response("Unauthorized", { status: 401 }),
      () => new Response("{}", { status: 202 }),
    ]);
    const popup = fakePopup();
    stubWindowOpen(popup);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    vi.useFakeTimers();
    act(() => {
      screen.getByTestId("retry").click();
    });

    // The popup posts completion and immediately closes itself.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: "erato-oauth2-login-complete",
          origin: window.location.origin,
        }),
      );
      await flushSessionProbes();
    });
    popup.closed = true;

    // First post-close tick: probe still 401 — the grace window keeps the flow
    // alive instead of giving up after a single probe.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await flushSessionProbes();
    });
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");
    expect(screen.getByTestId("error")).toHaveTextContent("");

    // Second post-close tick: the cookie is finally visible.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await flushSessionProbes();
    });
    expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  it("surfaces an error when the cookie never lands after a completed popup closed", async () => {
    // Mount probe 401, then every probe stays 401: the popup signaled
    // completion but the session never becomes visible to the taskpane.
    const fetcher = stubFetch(new Response("Unauthorized", { status: 401 }));
    const popup = fakePopup();
    stubWindowOpen(popup);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    vi.useFakeTimers();
    act(() => {
      screen.getByTestId("retry").click();
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: "erato-oauth2-login-complete",
          origin: window.location.origin,
        }),
      );
      await flushSessionProbes();
    });
    popup.closed = true;

    // Mid-grace (4 of the 8 grace ticks): still signing in, no bounce.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
      await flushSessionProbes();
    });
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");
    expect(screen.getByTestId("error")).toHaveTextContent("");

    // Remaining grace ticks plus the final probe tick (9 ticks total after
    // close): the grace window is exhausted and the failure is surfaced —
    // unlike a user-cancelled popup this is NOT silent.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_500);
      await flushSessionProbes();
    });
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.getByTestId("error")).toHaveTextContent(
      "Could not reach the sign-in service",
    );
    // Mount probe + message verification probe + 8 grace probes + final probe.
    expect(fetcher).toHaveBeenCalledTimes(11);

    // The flow is settled: no further polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500);
      await flushSessionProbes();
    });
    expect(fetcher).toHaveBeenCalledTimes(11);
  });

  it("authenticates via the polling fallback when the postMessage is missed", async () => {
    // Mount probe 401, first poll tick 401, second poll tick 202.
    stubFetchSequence([
      () => new Response("Unauthorized", { status: 401 }),
      () => new Response("Unauthorized", { status: 401 }),
      () => new Response("{}", { status: 202 }),
    ]);
    const popup = fakePopup();
    stubWindowOpen(popup);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    vi.useFakeTimers();
    act(() => {
      screen.getByTestId("retry").click();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await flushSessionProbes();
    });
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await flushSessionProbes();
    });
    expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
    expect(popup.close).toHaveBeenCalled();
  });

  it("re-probes once and returns to needs-signin when the user closes the popup", async () => {
    const fetcher = stubFetch(new Response("Unauthorized", { status: 401 }));
    const popup = fakePopup();
    stubWindowOpen(popup);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    vi.useFakeTimers();
    act(() => {
      screen.getByTestId("retry").click();
    });

    popup.closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await flushSessionProbes();
    });

    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    // User-closed is not an error — the CTA just comes back.
    expect(screen.getByTestId("error")).toHaveTextContent("");
    // Mount probe + exactly one closed-popup re-probe.
    expect(fetcher).toHaveBeenCalledTimes(2);

    // The flow is settled: no further polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500);
      await flushSessionProbes();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("times out after 10 minutes, closes the popup, and surfaces the error", async () => {
    stubFetch(new Response("Unauthorized", { status: 401 }));
    const popup = fakePopup();
    stubWindowOpen(popup);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    vi.useFakeTimers();
    act(() => {
      screen.getByTestId("retry").click();
    });

    // Still going at 3 minutes — the old timeout cut off first-time MFA logins.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      await flushSessionProbes();
    });
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");
    expect(popup.close).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 60_000);
      await flushSessionProbes();
    });
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.getByTestId("error")).toHaveTextContent("timed out");
    expect(popup.close).toHaveBeenCalled();
  });

  it("re-focuses the open popup instead of opening a second one on re-click", async () => {
    stubFetch(new Response("Unauthorized", { status: 401 }));
    const popup = fakePopup();
    const open = stubWindowOpen(popup);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    vi.useFakeTimers();
    act(() => {
      screen.getByTestId("retry").click();
    });
    expect(open).toHaveBeenCalledTimes(1);

    act(() => {
      screen.getByTestId("retry").click();
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");

    // Settle the flow so its window message listener doesn't leak into the
    // next test — only succeed/giveUp remove it.
    popup.closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await flushSessionProbes();
    });
  });

  it("keeps the second flow's popup and phase when the first flow's stale tick gives up", async () => {
    stubFetch(new Response("Unauthorized", { status: 401 }));
    const popup1 = fakePopup();
    const popup2 = fakePopup();
    const open = stubWindowOpenSequence([popup1, popup2]);

    render(
      <Oauth2ProxyLoginProvider>
        <AuthProbe />
      </Oauth2ProxyLoginProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("initialized")).toHaveTextContent("true"),
    );
    vi.useFakeTimers();

    // Flow #1 starts; the user closes its popup and re-clicks before flow #1's
    // poll tick notices, so flow #2 starts while flow #1 is still in flight.
    act(() => {
      screen.getByTestId("retry").click();
    });
    expect(open).toHaveBeenCalledTimes(1);
    popup1.closed = true;
    act(() => {
      screen.getByTestId("retry").click();
    });
    expect(open).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");

    // Flow #1's tick fires: it re-probes (401) and gives up — but it no longer
    // owns popupRef/phase, so flow #2 must keep signing in untouched.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await flushSessionProbes();
    });
    expect(screen.getByTestId("status")).toHaveTextContent("establishing");
    expect(popup2.close).not.toHaveBeenCalled();

    // popupRef still points at flow #2's popup: a third click re-focuses it
    // rather than opening another popup (the ref was not clobbered).
    act(() => {
      screen.getByTestId("retry").click();
    });
    expect(open).toHaveBeenCalledTimes(2);
    expect(popup2.focus).toHaveBeenCalledTimes(1);

    // Flow #2 still completes normally once the cookie lands.
    stubFetch(new Response("{}", { status: 202 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await flushSessionProbes();
    });
    expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
    expect(popup2.close).toHaveBeenCalled();
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
