import {
  PublicClientApplication,
  createNestablePublicClientApplication,
  type IController,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import { i18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NestedAppAuthUnavailableError } from "../../core/auth/AuthSource";
import { createEntraNaaAuthSource } from "../EntraNaaAuthSource";

vi.mock("@azure/msal-browser", () => ({
  AuthError: class extends Error {},
  InteractionRequiredAuthError: class extends Error {},
  PublicClientApplication: vi.fn(function (this: Record<string, unknown>) {
    this.kind = "nested";
  }),
  createNestablePublicClientApplication: vi.fn(),
}));

vi.mock("@erato/frontend/library", () => ({
  env: () => ({
    msalClientId: "client-id",
    msalAuthority: "https://login.microsoftonline.com/tenant",
  }),
}));

const resolveLoginHint = vi.fn(async () => "user@example.com");
const standardPca = { kind: "standard" } as unknown as IPublicClientApplication;

// MSAL builds the client through the factory only when its NAA operating
// context connected to the host bridge; otherwise it returns a standard one.
function hostWithBridge(present: boolean) {
  vi.mocked(createNestablePublicClientApplication).mockImplementation(
    async (configuration, _correlationId, pcaFactory) => {
      if (present && pcaFactory) {
        return pcaFactory(configuration, {} as IController);
      }
      return standardPca;
    },
  );
}

describe("createEntraNaaAuthSource", () => {
  beforeEach(() => {
    i18n.activate("en");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("initializes on the nested client when the bridge connects", async () => {
    hostWithBridge(true);
    const source = createEntraNaaAuthSource({
      resolveLoginHint,
      requireBridge: true,
    });

    await expect(source.initialize()).resolves.toBeUndefined();
    expect(PublicClientApplication).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(createNestablePublicClientApplication).mock.calls[0]?.[0].auth,
    ).toMatchObject({ supportsNestedAppAuth: true });
  });

  it("rejects instead of using MSAL's standard client when the bridge is missing", async () => {
    hostWithBridge(false);
    const source = createEntraNaaAuthSource({
      resolveLoginHint,
      requireBridge: true,
    });

    await expect(source.initialize()).rejects.toBeInstanceOf(
      NestedAppAuthUnavailableError,
    );
    expect(resolveLoginHint).not.toHaveBeenCalled();
  });

  it("keeps MSAL's own fallback when the host doesn't require the bridge", async () => {
    hostWithBridge(false);
    const source = createEntraNaaAuthSource({ resolveLoginHint });

    await expect(source.initialize()).resolves.toBeUndefined();
    expect(
      vi.mocked(createNestablePublicClientApplication).mock.calls[0],
    ).toHaveLength(1);
  });
});
