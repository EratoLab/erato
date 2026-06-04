import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OAUTH2_PROXY_REDEEM_EXTERNAL_TOKEN_PATH,
  OAUTH2_PROXY_SESSION_REFRESH_AFTER_MS,
  Oauth2ProxySessionRedeemError,
  readStoredOauth2ProxySessionRedeemedAt,
  redeemOauth2ProxySession,
  shouldRefreshOauth2ProxySession,
} from "../oauth2ProxySession";

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
    ).resolves.toEqual({ redeemedAt: 1234 });

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
