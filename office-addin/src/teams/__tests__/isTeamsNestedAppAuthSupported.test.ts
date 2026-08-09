import { afterEach, describe, expect, it } from "vitest";

import {
  installMockNestedAppAuthBridge,
  uninstallMockNestedAppAuthBridge,
} from "../../test/mocks/teams/context";
import { isTeamsNestedAppAuthSupported } from "../auth/isTeamsNestedAppAuthSupported";

describe("isTeamsNestedAppAuthSupported", () => {
  afterEach(() => {
    uninstallMockNestedAppAuthBridge();
  });

  it("reports support once TeamsJS installed the bridge", () => {
    installMockNestedAppAuthBridge();

    expect(isTeamsNestedAppAuthSupported()).toBe(true);
  });

  it("reports no support without the bridge", () => {
    expect(isTeamsNestedAppAuthSupported()).toBe(false);
  });

  it("does not read the Office global", () => {
    const originalOffice = Object.getOwnPropertyDescriptor(
      globalThis,
      "Office",
    );
    Reflect.deleteProperty(globalThis, "Office");

    expect(() => isTeamsNestedAppAuthSupported()).not.toThrow();

    if (originalOffice) {
      Object.defineProperty(globalThis, "Office", originalOffice);
    }
  });
});
