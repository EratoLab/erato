import { afterEach, describe, expect, it } from "vitest";

import { hostShellWithCapability } from "./hostShell";

function setShell(value: unknown) {
  (window as { ERATO_SHELL?: unknown }).ERATO_SHELL = value;
}

const shellWith = (capabilities: Record<string, number>) => ({
  contract: 1,
  capabilities,
  request: () => Promise.resolve(null),
  on: () => () => {},
});

describe("hostShellWithCapability", () => {
  afterEach(() => {
    delete (window as { ERATO_SHELL?: unknown }).ERATO_SHELL;
  });

  it("is absent in a browser", () => {
    expect(hostShellWithCapability("share", 1)).toBeNull();
  });

  it("returns the shell when the capability is at least the version", () => {
    const shell = shellWith({ share: 2 });
    setShell(shell);
    expect(hostShellWithCapability("share", 1)).toBe(shell);
  });

  it("is absent when the capability is missing or older", () => {
    setShell(shellWith({ share: 1 }));
    expect(hostShellWithCapability("share", 2)).toBeNull();
    expect(hostShellWithCapability("files", 1)).toBeNull();
  });

  it("ignores an object that does not have the contract's shape", () => {
    setShell({ capabilities: { share: 1 } });
    expect(hostShellWithCapability("share", 1)).toBeNull();
  });
});
