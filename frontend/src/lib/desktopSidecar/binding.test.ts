import { describe, expect, it } from "vitest";

import { desktopSidecarBinding } from "./binding";

import type { SidecarSnapshot } from "@erato/desktop-sidecar-protocol";

const INSTALLATION = "installation-0123456789abcdef0123456789";

function ready(overrides: Partial<SidecarSnapshot> = {}): SidecarSnapshot {
  return {
    state: "ready",
    protocolVersion: "1.0",
    serverInfo: { name: "erato-desktop-sidecar", version: "0.1.43" },
    instanceId: "instance",
    installationId: INSTALLATION,
    catalogue: { revision: "r", digest: "d" },
    capabilities: new Map(),
    error: null,
    ...overrides,
  };
}

describe("desktopSidecarBinding", () => {
  it("names the app's installation, so every window on the computer shares it", () => {
    expect(desktopSidecarBinding(ready(), "client-a")).toEqual({
      device_id: INSTALLATION,
      realm: "desktop-sidecar",
      host_context: { kind: "desktop_sidecar", identity: "local" },
    });
    expect(desktopSidecarBinding(ready(), undefined)?.device_id).toBe(
      INSTALLATION,
    );
  });

  it("names this client alone for an app without an installation id", () => {
    const older = ready({ installationId: null });
    expect(desktopSidecarBinding(older, "client-a")?.device_id).toBe(
      "client-a",
    );
    expect(desktopSidecarBinding(older, undefined)).toBeUndefined();
  });

  it("offers none while the app is not ready or declares local delegation", () => {
    expect(
      desktopSidecarBinding(ready({ state: "unavailable" }), "client-a"),
    ).toBeUndefined();
    expect(
      desktopSidecarBinding(
        ready({ localDelegation: { enforcement: "enforced" } }),
        "client-a",
      ),
    ).toBeUndefined();
  });
});
