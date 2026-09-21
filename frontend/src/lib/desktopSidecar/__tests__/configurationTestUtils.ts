import { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";
import { expect, vi } from "vitest";

import type { SidecarConfigureV1Params } from "@erato/desktop-sidecar-protocol";

export async function expectSidecarConfigurationAccepted(
  configuration: SidecarConfigureV1Params,
) {
  const request = vi.fn((body: string) => {
    const { id } = JSON.parse(body) as { id: string };
    return Promise.resolve(JSON.stringify({ jsonrpc: "2.0", id, result: {} }));
  });
  const client = new DesktopSidecarClient({
    transport: { request },
    clientInfo: {
      name: "mailbox-configuration-test",
      version: "0.1.0",
      host: { application: "test", runtime: "node" },
      os: { name: "test" },
    },
  });
  // Stub discovery and transport while exercising the client's pinned validators.
  vi.spyOn(client, "supports").mockReturnValue(true);
  await expect(
    client.invoke("sidecar.configure.v1", configuration),
  ).resolves.toEqual({});
  expect(request).toHaveBeenCalledTimes(1);
}
