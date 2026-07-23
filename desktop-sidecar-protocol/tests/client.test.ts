import { afterEach, describe, expect, it } from "vitest";

import {
  DesktopSidecarClient,
  HttpTransport,
  SidecarClientError,
  type SidecarClientInfo,
} from "../typescript/src/index.js";
import {
  MockSidecar,
  createMockSidecar,
  type MockSidecarOptions,
} from "../test-server/src/index.js";

const ORIGIN = "https://app.erato.example";
const clientInfo: SidecarClientInfo = {
  name: "erato-test-client",
  version: "0.1.0",
  host: { application: "test", runtime: "node" },
  os: { name: "test" },
};
const activeSidecars: MockSidecar[] = [];

afterEach(async () => {
  await Promise.all(activeSidecars.splice(0).map((sidecar) => sidecar.stop()));
});

async function setup(
  options: Omit<MockSidecarOptions, "allowedOrigins"> = {},
  clientOptions: { supportedProtocolVersions?: readonly string[] } = {},
): Promise<{ sidecar: MockSidecar; client: DesktopSidecarClient }> {
  const sidecar = await createMockSidecar({
    allowedOrigins: [ORIGIN],
    ...options,
  });
  activeSidecars.push(sidecar);
  const client = new DesktopSidecarClient({
    transport: new HttpTransport(sidecar.address.url, {
      fetch: fetchWithOrigin,
    }),
    clientInfo,
    ...clientOptions,
  });
  return { sidecar, client };
}

const fetchWithOrigin = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const headers = new Headers(init?.headers);
  headers.set("Origin", ORIGIN);
  return fetch(input, { ...init, headers });
};

describe("DesktopSidecarClient", () => {
  it("discovers ready data and invokes a compiled enabled capability", async () => {
    const { client } = await setup();

    await client.discover();

    expect(client.getSnapshot()).toMatchObject({
      state: "ready",
      protocolVersion: "1.0",
      serverInfo: { name: "erato-mock-sidecar", version: "0.1.0" },
      instanceId: "mock-sidecar-instance",
    });
    expect(client.supports("diagnostics.echo.v1")).toBe(true);
    expect(client.supports("diagnostics.echo", 1)).toBe(true);
    await expect(
      client.invoke("diagnostics.echo.v1", { message: "hello" }),
    ).resolves.toEqual({
      message: "hello",
      sidecarInstanceId: "mock-sidecar-instance",
    });
  });

  it("acknowledges a sidecar restart request", async () => {
    const { client, sidecar } = await setup();
    await client.discover();

    expect(client.supports("sidecar.restart.v1")).toBe(true);
    await expect(client.invoke("sidecar.restart.v1", {})).resolves.toEqual({
      accepted: true,
    });
    expect(sidecar.restartRequests).toBe(1);
  });

  it("lists Outlook mailboxes and emails through pinned contracts", async () => {
    const { client } = await setup();
    await client.discover();

    expect(client.supports("outlook.list_mailboxes.v1")).toBe(true);
    expect(client.supports("outlook.list_emails.v1")).toBe(true);

    const mailboxResult = await client.invoke("outlook.list_mailboxes.v1", {});
    expect(mailboxResult.mailboxes).toEqual([
      expect.objectContaining({
        id: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
        displayName: "Mock Outlook mailbox",
        profileName: "Mock Outlook Profile",
      }),
    ]);

    await expect(
      client.invoke("outlook.list_emails.v1", {
        mailboxId: mailboxResult.mailboxes[0].id,
      }),
    ).resolves.toMatchObject({
      mailbox: { id: "8b7d2f4a6c9e1035d8a1b2c3e4f50617" },
      emails: [{ id: "mock-outlook-email", subject: "Mock Outlook message" }],
    });
  });

  it("reuses ready data for concurrent requests on independent HTTP connections", async () => {
    const { client } = await setup({ echoDelayMs: 5 });
    await client.discover();

    await expect(
      Promise.all([
        client.invoke("diagnostics.echo.v1", { message: "one" }),
        client.invoke("diagnostics.echo.v1", { message: "two" }),
      ]),
    ).resolves.toEqual([
      { message: "one", sidecarInstanceId: "mock-sidecar-instance" },
      { message: "two", sidecarInstanceId: "mock-sidecar-instance" },
    ]);
    expect(client.getSnapshot().state).toBe("ready");
  });

  it("selects the first mutually supported exact protocol version", async () => {
    const { client } = await setup(
      { supportedProtocolVersions: ["1.0"] },
      { supportedProtocolVersions: ["1.1", "1.0"] },
    );

    await client.discover();

    expect(client.getSnapshot().protocolVersion).toBe("1.0");
  });

  it("returns a typed error when there is no common protocol", async () => {
    const { client } = await setup(
      { supportedProtocolVersions: ["1.0"] },
      { supportedProtocolVersions: ["2.0"] },
    );

    await expect(client.discover()).rejects.toMatchObject({
      kind: "incompatible_protocol",
      code: -32010,
    });
    expect(client.getSnapshot().state).toBe("error");
  });

  it("does not expose disabled capabilities", async () => {
    const { client } = await setup({
      capabilityAvailability: "disabled",
      capabilityReasonCode: "organization_policy",
    });
    await client.discover();

    expect(client.supports("diagnostics.echo.v1")).toBe(false);
    expect(
      client.getSnapshot().capabilities.get("diagnostics.echo.v1"),
    ).toMatchObject({
      availability: "disabled",
      reasonCode: "organization_policy",
    });
    await expect(
      client.invoke("diagnostics.echo.v1", { message: "blocked" }),
    ).rejects.toMatchObject({ kind: "capability_unavailable" });
  });

  it("refreshes discovery after current policy rejects a stale capability", async () => {
    const { client, sidecar } = await setup();
    await client.discover();

    sidecar.setCapabilityAvailability("disabled", "policy_changed");
    await expect(
      client.invoke("diagnostics.echo.v1", { message: "blocked" }),
    ).rejects.toMatchObject({ kind: "capability_unavailable" });

    expect(client.getSnapshot()).toMatchObject({
      state: "ready",
      catalogue: { revision: "2" },
    });
    expect(
      client.getSnapshot().capabilities.get("diagnostics.echo.v1"),
    ).toMatchObject({
      availability: "disabled",
      reasonCode: "policy_changed",
    });
  });

  it("tolerates additive result fields from a newer sidecar", async () => {
    const { client } = await setup({
      echoResultOverride: {
        message: "hello",
        sidecarInstanceId: "mock-sidecar-instance",
        futureField: { revision: 2 },
      },
    });
    await client.discover();

    await expect(
      client.invoke("diagnostics.echo.v1", { message: "hello" }),
    ).resolves.toMatchObject({ message: "hello" });
  });

  it("invalidates readiness when a result violates the pinned contract", async () => {
    const { client } = await setup({ echoResultOverride: { message: 42 } });
    await client.discover();

    await expect(
      client.invoke("diagnostics.echo.v1", { message: "hello" }),
    ).rejects.toMatchObject({ kind: "invalid_result" });
    expect(client.getSnapshot().state).toBe("error");
  });

  it("rejects a discovery document with a mismatched catalogue digest", async () => {
    const { client } = await setup({
      catalogueDigestOverride:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    });

    await expect(client.discover()).rejects.toMatchObject({
      kind: "invalid_result",
    });
    expect(client.getSnapshot().state).toBe("error");
  });

  it("sends an acknowledged cancellation for a timed-out request", async () => {
    const { client } = await setup({ echoDelayMs: 100 });
    await client.discover();

    await expect(
      client.invoke(
        "diagnostics.echo.v1",
        { message: "slow" },
        { timeoutMs: 10 },
      ),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(client.getSnapshot().state).toBe("ready");
  });

  it("validates outgoing parameters before sending", async () => {
    const { client } = await setup();
    await client.discover();

    await expect(
      client.invoke("diagnostics.echo.v1", { message: 42 } as never),
    ).rejects.toBeInstanceOf(SidecarClientError);
    expect(client.getSnapshot().state).toBe("ready");
  });
});
