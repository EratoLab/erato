import { i18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InteractionRequiredError } from "../AuthSource";
import { createEntraAuthSource } from "../entraAuthSource";

import type { CreatePca } from "../entraAuthSource";
import type {
  AccountInfo,
  AuthenticationResult,
  IPublicClientApplication,
} from "@azure/msal-browser";

// Mirror the deleted EntraInteractiveAuthSource test's mock: AuthError with an
// errorCode and InteractionRequiredAuthError extending it, so the shared
// factory's `requiresInteractiveSignIn` branches (interaction_required vs
// no_account_error / no_tokens_found) are exercised without the real SDK.
vi.mock("@azure/msal-browser", () => {
  class AuthError extends Error {
    errorCode: string;
    constructor(errorCode: string, message?: string) {
      super(message ?? errorCode);
      this.errorCode = errorCode;
    }
  }
  class InteractionRequiredAuthError extends AuthError {
    constructor(errorCode = "interaction_required", errorMessage?: string) {
      super(errorCode, errorMessage);
    }
  }

  return {
    AuthError,
    InteractionRequiredAuthError,
  };
});

vi.mock("@erato/frontend/library", () => ({
  env: () => ({
    msalClientId: "client-id",
    msalAuthority: "https://login.microsoftonline.com/tenant",
  }),
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

function createPcaMock(
  overrides: Partial<IPublicClientApplication> = {},
): IPublicClientApplication {
  return {
    acquireTokenSilent: vi.fn(async () => authenticationResult),
    acquireTokenPopup: vi.fn(async () => authenticationResult),
    setActiveAccount: vi.fn(),
    ...overrides,
  } as unknown as IPublicClientApplication;
}

const resolveLoginHint = vi.fn(async () => "user@example.com");

async function initializedSource(pca: IPublicClientApplication) {
  const createPca: CreatePca = vi.fn(async () => pca);
  const source = createEntraAuthSource({ resolveLoginHint, createPca });
  await source.initialize();
  return { source, createPca };
}

describe("createEntraAuthSource", () => {
  beforeEach(() => {
    i18n.activate("en");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("builds the PCA from the injected factory and reports entra-msal mode", async () => {
    const pca = createPcaMock();
    const { source, createPca } = await initializedSource(pca);

    expect(source.mode).toBe("entra-msal");
    expect(createPca).toHaveBeenCalledTimes(1);
    const config = vi.mocked(createPca).mock.calls[0][0];
    expect(typeof config.auth.clientId).toBe("string");
    expect(config.auth.clientId).toBeTruthy();
    expect(config.cache.cacheLocation).toBe("localStorage");
  });

  it("acquires the bootstrap token silently with the resolved login hint", async () => {
    const pca = createPcaMock();
    const { source } = await initializedSource(pca);

    await expect(source.acquireBootstrapToken()).resolves.toEqual({
      idToken: "id-token",
      accessToken: "access-token",
    });
    expect(pca.acquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["User.Read"],
        loginHint: "user@example.com",
      }),
    );
    expect(pca.acquireTokenPopup).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "ID token",
      refreshedIdToken: "id-token",
      refreshedAccessToken: "new-access-token",
      unchangedTokens: ["id_token"],
    },
    {
      name: "access token",
      refreshedIdToken: "new-id-token",
      refreshedAccessToken: "access-token",
      unchangedTokens: ["access_token"],
    },
    {
      name: "ID and access tokens",
      refreshedIdToken: "id-token",
      refreshedAccessToken: "access-token",
      unchangedTokens: ["id_token", "access_token"],
    },
  ])(
    "warns without logging credentials when a force refresh reuses the $name",
    async ({ refreshedIdToken, refreshedAccessToken, unchangedTokens }) => {
      const refreshedResult = {
        ...authenticationResult,
        idToken: refreshedIdToken,
        accessToken: refreshedAccessToken,
      } as AuthenticationResult;
      const pca = createPcaMock();
      (pca.acquireTokenSilent as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(authenticationResult)
        .mockResolvedValueOnce(refreshedResult);
      const { source } = await initializedSource(pca);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await source.acquireBootstrapToken();
      await source.acquireBootstrapToken({ forceRefresh: true });

      expect(warn).toHaveBeenCalledWith(
        "MSAL bootstrap token refresh returned unchanged token values",
        { unchangedTokens, refreshMode: "silent" },
      );
      const serializedWarning = JSON.stringify(warn.mock.calls);
      expect(serializedWarning).not.toContain("new-id-token");
      expect(serializedWarning).not.toContain("new-access-token");
      warn.mockRestore();
    },
  );

  it("does not warn when a force refresh replaces both bootstrap tokens", async () => {
    const refreshedResult = {
      ...authenticationResult,
      idToken: "new-id-token",
      accessToken: "new-access-token",
    } as AuthenticationResult;
    const pca = createPcaMock();
    (pca.acquireTokenSilent as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(authenticationResult)
      .mockResolvedValueOnce(refreshedResult);
    const { source } = await initializedSource(pca);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await source.acquireBootstrapToken();
    await source.acquireBootstrapToken({ forceRefresh: true });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back to a popup when interaction is required AND allowed", async () => {
    const { InteractionRequiredAuthError } = await import(
      "@azure/msal-browser"
    );
    const pca = createPcaMock({
      acquireTokenSilent: vi.fn(async () => {
        throw new InteractionRequiredAuthError(
          "interaction_required",
          "interaction required",
        );
      }),
    });
    const { source } = await initializedSource(pca);

    await expect(
      source.acquireBootstrapToken({ allowInteraction: true }),
    ).resolves.toEqual({ idToken: "id-token", accessToken: "access-token" });
    expect(pca.acquireTokenPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["User.Read"],
        prompt: "select_account",
      }),
    );
    expect(pca.setActiveAccount).toHaveBeenCalledWith(account);
  });

  it("acquires interactively without trying the silent cache when explicitly forced", async () => {
    const pca = createPcaMock();
    const { source } = await initializedSource(pca);

    await expect(
      source.acquireBootstrapToken({
        allowInteraction: true,
        forceInteraction: true,
      }),
    ).resolves.toEqual({ idToken: "id-token", accessToken: "access-token" });
    expect(pca.acquireTokenSilent).not.toHaveBeenCalled();
    expect(pca.acquireTokenPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["User.Read"],
        prompt: "select_account",
        loginHint: "user@example.com",
      }),
    );
  });

  it("rejects a forced interaction when interactive UI is not allowed", async () => {
    const pca = createPcaMock();
    const { source } = await initializedSource(pca);

    await expect(
      source.acquireBootstrapToken({ forceInteraction: true }),
    ).rejects.toBeInstanceOf(InteractionRequiredError);
    expect(pca.acquireTokenSilent).not.toHaveBeenCalled();
    expect(pca.acquireTokenPopup).not.toHaveBeenCalled();
  });

  it("translates a disallowed interaction into InteractionRequiredError", async () => {
    const { InteractionRequiredAuthError } = await import(
      "@azure/msal-browser"
    );
    const pca = createPcaMock({
      acquireTokenSilent: vi.fn(async () => {
        throw new InteractionRequiredAuthError(
          "interaction_required",
          "interaction required",
        );
      }),
    });
    const { source } = await initializedSource(pca);

    await expect(source.acquireBootstrapToken()).rejects.toBeInstanceOf(
      InteractionRequiredError,
    );
    expect(pca.acquireTokenPopup).not.toHaveBeenCalled();
  });

  it("treats an empty account cache (no_account_error) as a first-time sign-in: popups when allowed", async () => {
    const { AuthError } = await import("@azure/msal-browser");
    const pca = createPcaMock({
      acquireTokenSilent: vi.fn(async () => {
        throw new AuthError("no_account_error", "no account in cache");
      }),
    });
    const { source } = await initializedSource(pca);

    await expect(
      source.acquireBootstrapToken({ allowInteraction: true }),
    ).resolves.toEqual({ idToken: "id-token", accessToken: "access-token" });
    expect(pca.acquireTokenPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["User.Read"],
        prompt: "select_account",
        loginHint: "user@example.com",
      }),
    );
  });

  it("translates a no_account_error into InteractionRequiredError when interaction is disallowed", async () => {
    const { AuthError } = await import("@azure/msal-browser");
    const pca = createPcaMock({
      acquireTokenSilent: vi.fn(async () => {
        throw new AuthError("no_account_error", "no account in cache");
      }),
    });
    const { source } = await initializedSource(pca);

    await expect(source.acquireBootstrapToken()).rejects.toBeInstanceOf(
      InteractionRequiredError,
    );
    expect(pca.acquireTokenPopup).not.toHaveBeenCalled();
  });

  it("exposes the Graph capability reusing the same PCA + login hint", async () => {
    const pca = createPcaMock();
    const { source } = await initializedSource(pca);

    await expect(source.acquireGraphToken(["Mail.Read"])).resolves.toEqual({
      accessToken: "access-token",
      bootstrap: { idToken: "id-token", accessToken: "access-token" },
    });
    expect(pca.acquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["Mail.Read"],
        loginHint: "user@example.com",
      }),
    );
  });

  it("throws before initialize (MSAL not initialized)", async () => {
    const createPca: CreatePca = vi.fn(async () => createPcaMock());
    const source = createEntraAuthSource({ resolveLoginHint, createPca });

    await expect(source.acquireBootstrapToken()).rejects.toThrow(
      "MSAL not initialized",
    );
  });
});
