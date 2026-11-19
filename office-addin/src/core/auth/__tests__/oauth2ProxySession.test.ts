import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OAUTH2_PROXY_AUTH_PATH,
  OAUTH2_PROXY_REDEEM_EXTERNAL_TOKEN_PATH,
  OAUTH2_PROXY_SESSION_MIN_RENEW_INTERVAL_MS,
  OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS,
  OAUTH2_PROXY_SESSION_RENEW_AFTER_END_MS,
  OAUTH2_PROXY_SESSION_RENEW_BEFORE_END_MS,
  Oauth2ProxySessionRedeemError,
  checkOauth2ProxySession,
  oauth2ProxySessionEndsAt,
  oauth2ProxySessionRenewAt,
  readStoredOauth2ProxySessionEndsAt,
  readStoredOauth2ProxySessionRedeemedAt,
  redeemOauth2ProxySession,
  shouldRefreshOauth2ProxySession,
} from "../oauth2ProxySession";

const MINUTE = 60_000;
/** A JWT-shaped token with only an exp claim (seconds). */
const jwt = (expMs: number) =>
  `h.${btoa(JSON.stringify({ exp: Math.floor(expMs / 1000) }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}.s`;

describe("redeemOauth2ProxySession", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("posts the Microsoft tokens to oauth2-proxy and includes credentials", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 202 }));

    await expect(
      redeemOauth2ProxySession({
        idToken: " id-token ",
        accessToken: " access-token ",
        fetcher,
        now: () => 1234,
      }),
    ).resolves.toEqual({ redeemedAt: 1234, endsAt: null });

    expect(fetcher).toHaveBeenCalledWith(
      OAUTH2_PROXY_REDEEM_EXTERNAL_TOKEN_PATH,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id_token: "id-token",
          access_token: "access-token",
        }),
      },
    );
    expect(
      window.localStorage.getItem(
        "erato.officeAddin.oauth2ProxySessionRedeemedAt",
      ),
    ).toBe("1234");
  });

  it("omits the optional access token when MSAL does not return one", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 202 }));

    await redeemOauth2ProxySession({
      idToken: "id-token",
      accessToken: "",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ id_token: "id-token" }),
      }),
    );
  });

  it("rejects missing ID tokens before calling the endpoint", async () => {
    const fetcher = vi.fn();

    await expect(
      redeemOauth2ProxySession({ idToken: " ", fetcher }),
    ).rejects.toThrow(Oauth2ProxySessionRedeemError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps non-202 responses to a typed recoverable error", async () => {
    const fetcher = vi.fn(
      async () => new Response("Unauthorized", { status: 401 }),
    );

    await expect(
      redeemOauth2ProxySession({ idToken: "id-token", fetcher }),
    ).rejects.toMatchObject({
      name: "Oauth2ProxySessionRedeemError",
      status: 401,
      responseBody: "Unauthorized",
    });
  });

  // The oauth2-proxy fork is expected to return exactly 202 Accepted; a 2xx
  // other than 202 is treated as failure. This test pins that contract so the
  // assumption is explicit (see ERMAIN-329 fork). If the fork returns 200/204,
  // this is where the breakage will surface.
  it("treats a non-202 2xx response as a failure", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 200 }));

    await expect(
      redeemOauth2ProxySession({ idToken: "id-token", fetcher }),
    ).rejects.toMatchObject({
      name: "Oauth2ProxySessionRedeemError",
      status: 200,
    });
  });

  it("wraps network failures in a typed error and preserves the cause", async () => {
    const networkError = new TypeError("Failed to fetch");
    const fetcher = vi.fn(async () => {
      throw networkError;
    });

    const rejection = redeemOauth2ProxySession({
      idToken: "id-token",
      fetcher,
    });

    await expect(rejection).rejects.toBeInstanceOf(
      Oauth2ProxySessionRedeemError,
    );
    await expect(rejection).rejects.toMatchObject({
      status: null,
      cause: networkError,
    });
  });
});

describe("checkOauth2ProxySession", () => {
  it("probes the auth endpoint with credentials and threads the abort signal", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 202 }));
    const controller = new AbortController();

    await expect(
      checkOauth2ProxySession({ fetcher, signal: controller.signal }),
    ).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledWith(OAUTH2_PROXY_AUTH_PATH, {
      method: "GET",
      credentials: "include",
      signal: controller.signal,
    });
  });

  it("stays source-compatible without a signal (401 resolves false)", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 401 }));

    await expect(checkOauth2ProxySession({ fetcher })).resolves.toBe(false);

    expect(fetcher).toHaveBeenCalledWith(OAUTH2_PROXY_AUTH_PATH, {
      method: "GET",
      credentials: "include",
      signal: undefined,
    });
  });

  it("rejects with the abort reason when the probe request is aborted", async () => {
    const reason = new Error("probe aborted");
    const fetcher = vi.fn(async () => {
      // fetch rejects with the signal's reason once the abort fires.
      throw reason;
    });

    await expect(checkOauth2ProxySession({ fetcher })).rejects.toBe(reason);
  });
});

describe("readStoredOauth2ProxySessionRedeemedAt", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredOauth2ProxySessionRedeemedAt()).toBeNull();
  });

  it("returns the stored finite timestamp", () => {
    window.localStorage.setItem(
      "erato.officeAddin.oauth2ProxySessionRedeemedAt",
      "1234",
    );
    expect(readStoredOauth2ProxySessionRedeemedAt()).toBe(1234);
  });

  it("returns null for a malformed (non-finite) stored value", () => {
    window.localStorage.setItem(
      "erato.officeAddin.oauth2ProxySessionRedeemedAt",
      "not-a-number",
    );
    expect(readStoredOauth2ProxySessionRedeemedAt()).toBeNull();
  });
});

describe("shouldRefreshOauth2ProxySession", () => {
  it("requires refresh when no session timestamp exists", () => {
    expect(shouldRefreshOauth2ProxySession(null, 10_000)).toBe(true);
  });

  it("does not refresh before the twenty minute threshold", () => {
    expect(
      shouldRefreshOauth2ProxySession(
        10_000,
        10_000 + OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS - 1,
      ),
    ).toBe(false);
  });

  it("refreshes at the twenty minute threshold", () => {
    expect(
      shouldRefreshOauth2ProxySession(
        10_000,
        10_000 + OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS,
      ),
    ).toBe(true);
  });
});

describe("oauth2ProxySessionEndsAt", () => {
  const now = 1_000 * MINUTE;

  it("ends with the access token, whether or not the ID token is still valid", () => {
    // 2026-11-19 10:05:51 UTC: an expired ID token and an access token with 7.4 minutes left.
    expect(
      oauth2ProxySessionEndsAt({
        idToken: jwt(now - MINUTE),
        accessToken: jwt(now + 7.4 * MINUTE),
      }),
    ).toBe(now + 7.4 * MINUTE);
    expect(
      oauth2ProxySessionEndsAt({
        idToken: jwt(now + 50 * MINUTE),
        accessToken: jwt(now + 40 * MINUTE),
      }),
    ).toBe(now + 40 * MINUTE);
  });

  it("ends with the ID token when no access token is redeemed", () => {
    expect(oauth2ProxySessionEndsAt({ idToken: jwt(now + 50 * MINUTE) })).toBe(
      now + 50 * MINUTE,
    );
  });

  it("is unknown for tokens without an expiry", () => {
    expect(
      oauth2ProxySessionEndsAt({ idToken: "id-token", accessToken: "x" }),
    ).toBeNull();
  });

  it("is stored with the redeem", async () => {
    window.localStorage.clear();
    const fetcher = vi.fn(async () => new Response("{}", { status: 202 }));
    await expect(
      redeemOauth2ProxySession({
        idToken: jwt(now + 50 * MINUTE),
        fetcher,
        now: () => now,
      }),
    ).resolves.toEqual({ redeemedAt: now, endsAt: now + 50 * MINUTE });
    expect(readStoredOauth2ProxySessionEndsAt()).toBe(now + 50 * MINUTE);
  });
});

describe("oauth2ProxySessionRenewAt", () => {
  const redeemedAt = 1_000 * MINUTE;

  it("renews on the fixed interval when the session lasts longer", () => {
    expect(
      oauth2ProxySessionRenewAt(redeemedAt, redeemedAt + 60 * MINUTE),
    ).toBe(redeemedAt + OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS);
    expect(oauth2ProxySessionRenewAt(redeemedAt, null)).toBe(
      redeemedAt + OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS,
    );
  });

  it("renews before a session that ends sooner", () => {
    expect(
      oauth2ProxySessionRenewAt(redeemedAt, redeemedAt + 7.4 * MINUTE),
    ).toBe(
      redeemedAt + 7.4 * MINUTE - OAUTH2_PROXY_SESSION_RENEW_BEFORE_END_MS,
    );
  });

  it("renews a session redeemed in its last minutes just after it ends, not over and over", () => {
    expect(oauth2ProxySessionRenewAt(redeemedAt, redeemedAt + 3 * MINUTE)).toBe(
      redeemedAt + 3 * MINUTE + OAUTH2_PROXY_SESSION_RENEW_AFTER_END_MS,
    );
  });

  it("never renews more often than the minimum interval, even from an expired token", () => {
    expect(oauth2ProxySessionRenewAt(redeemedAt, redeemedAt - MINUTE)).toBe(
      redeemedAt + OAUTH2_PROXY_SESSION_MIN_RENEW_INTERVAL_MS,
    );
  });

  it("refreshes on focus once the renewal is due", () => {
    const endsAt = redeemedAt + 7.4 * MINUTE;
    expect(
      shouldRefreshOauth2ProxySession(
        redeemedAt,
        redeemedAt + 3 * MINUTE,
        endsAt,
      ),
    ).toBe(false);
    expect(
      shouldRefreshOauth2ProxySession(
        redeemedAt,
        redeemedAt + 3.4 * MINUTE,
        endsAt,
      ),
    ).toBe(true);
  });
});
