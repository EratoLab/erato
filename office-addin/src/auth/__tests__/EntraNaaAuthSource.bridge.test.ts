import { i18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NestedAppAuthUnavailableError } from "../../core/auth/AuthSource";
import { createEntraNaaAuthSource } from "../EntraNaaAuthSource";

// Runs the real MSAL, so a change to how it calls `pcaFactory` fails here.
vi.mock("@erato/frontend/library", () => ({
  env: () => ({
    msalClientId: "00000000-0000-0000-0000-000000000001",
    msalAuthority: "https://login.microsoftonline.com/common",
  }),
}));

// Answers MSAL's GetInitContext handshake the way an Office host does.
function installHostBridge() {
  const listeners: Array<(response: string) => void> = [];
  (window as unknown as { nestedAppAuthBridge?: unknown }).nestedAppAuthBridge =
    {
      addEventListener: (_name: string, listener: (r: string) => void) => {
        listeners.push(listener);
      },
      removeEventListener: () => {},
      postMessage: (raw: string) => {
        const request = JSON.parse(raw) as {
          method: string;
          requestId: string;
        };
        if (request.method !== "GetInitContext") {
          return;
        }
        const response = JSON.stringify({
          messageType: "NestedAppAuthResponse",
          requestId: request.requestId,
          success: true,
          initContext: { sdkName: "test-host", sdkVersion: "1.0.0" },
        });
        window.queueMicrotask(() =>
          listeners.forEach((listener) => listener(response)),
        );
      },
    };
}

describe("createEntraNaaAuthSource with MSAL", () => {
  beforeEach(() => {
    i18n.activate("en");
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "nestedAppAuthBridge");
  });

  it("initializes when the host bridge answers", async () => {
    installHostBridge();
    const source = createEntraNaaAuthSource({
      resolveLoginHint: async () => undefined,
      requireBridge: true,
    });

    await expect(source.initialize()).resolves.toBeUndefined();
  });

  it("rejects when the host has no bridge", async () => {
    const source = createEntraNaaAuthSource({
      resolveLoginHint: async () => undefined,
      requireBridge: true,
    });

    await expect(source.initialize()).rejects.toBeInstanceOf(
      NestedAppAuthUnavailableError,
    );
  });
});
