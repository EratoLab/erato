import { afterEach, describe, expect, it } from "vitest";

import {
  DesktopSidecarClient,
  HttpTransport,
  SidecarClientError,
  type SidecarClientInfo,
  type SidecarProgressV1Result,
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

  it("supports outlook.get_conversation.v1 with inline body and attachment bytes", async () => {
    const { client } = await setup();
    await client.discover();

    expect(client.supports("outlook.get_conversation.v1")).toBe(true);
    expect(client.supports("outlook.get_conversation", 1)).toBe(true);

    const conversation = await client.invoke("outlook.get_conversation.v1", {
      mailboxId: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
      anchor: { internetMessageId: "<mock-outlook-email@example.com>" },
    });
    expect(conversation.state).toBe("ok");

    const message = conversation.messages[0];
    expect(message?.body).toEqual({
      contentType: "text/plain",
      content: "Mock Outlook message body.",
    });

    const attachment = message?.attachments[0];
    expect(attachment?.contentBytes).toBeDefined();
    expect(
      Buffer.from(attachment!.contentBytes!, "base64").toString("utf8"),
    ).toBe("mock attachment bytes");
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

  it("fully resets active and rebuilding indexes while preserving configuration", async () => {
    const { client, sidecar } = await setup();
    await client.discover();
    expect(client.supports("indexing.reset.v1")).toBe(true);
    const configuration = {
      user_configuration: {
        indexing_parallelism: 3,
        indexing_documents_per_minute: 60,
        show_tray_icon: false,
      },
      organization_configuration: { future_setting: "retained" },
    };
    await client.invoke("sidecar.configure.v1", configuration);
    expect(
      (await client.invoke("indexing.status.v1", {})).generations,
    ).toHaveLength(2);
    const reset = await client.invoke("indexing.reset.v1", {});
    expect(reset).toMatchObject({ completed: true, state: "stopped" });
    expect(Number.isNaN(Date.parse(reset.completedAt))).toBe(false);
    const status = await client.invoke("indexing.status.v1", {});
    expect(status.state).toBe("stopped");
    expect(status.indexingDirectory).toBe(
      "/Users/example/Library/Application Support/Erato/index",
    );
    expect(status.generations).toEqual([]);
    expect(status.discovery).toEqual([]);
    expect(status.resources.disk.allocatedBytes).toBe(0);
    expect(status.resources.disk.logicalBytes).toBe(0);
    expect(Object.values(status.resources.disk.breakdown)).toEqual(
      Array(7).fill({ allocatedBytes: 0, logicalBytes: 0 }),
    );
    expect(status.resources.liveExtractionWorkers).toEqual([]);
    expect(status.effectiveConfiguration).toEqual({
      parallelism: 3,
      documentsPerMinute: 60,
    });
    expect(sidecar.configuration).toEqual(configuration);
    await expect(client.invoke("indexing.reset.v1", {})).resolves.toEqual(
      reset,
    );
    await client.invoke("sidecar.configure.v1", configuration);
    expect((await client.invoke("indexing.status.v1", {})).state).toBe(
      "stopped",
    );
  });

  it("does not advertise reset on a previous sidecar", async () => {
    const { client } = await setup({ omitMethods: ["indexing.reset.v1"] });
    await client.discover();
    expect(client.supports("indexing.reset.v1")).toBe(false);
    await expect(client.invoke("indexing.reset.v1", {})).rejects.toBeInstanceOf(
      SidecarClientError,
    );
  });

  it("discovers statistics, resolves indexing knobs and replaces configuration layers", async () => {
    const { client } = await setup();
    await client.discover();
    expect(client.supports("indexing.status.v1")).toBe(true);
    expect(
      (await client.invoke("indexing.status.v1", {})).effectiveConfiguration,
    ).toEqual({ parallelism: 1, documentsPerMinute: 40 });
    await client.invoke("sidecar.configure.v1", {
      user_configuration: {
        indexing_parallelism: 2,
        indexing_documents_per_minute: null,
      },
      organization_configuration: {
        indexing_parallelism: 4,
        indexing_documents_per_minute: 60,
      },
    });
    const status = await client.invoke("indexing.status.v1", {
      includeSourceBreakdowns: false,
      includeFileTypeBreakdowns: false,
    });
    expect(status.effectiveConfiguration).toEqual({
      parallelism: 2,
      documentsPerMinute: 60,
    });
    expect(status.generations).toHaveLength(2);
    expect(
      status.generations.every((g) =>
        g.segments.every(
          (s) =>
            s.sourceId === null && s.mailboxId === null && s.fileType === null,
        ),
      ),
    ).toBe(true);
    await expect(
      client.invoke("sidecar.configure.v1", {
        user_configuration: { indexing_parallelism: 0 },
        organization_configuration: {},
      }),
    ).rejects.toBeInstanceOf(SidecarClientError);
    expect(
      (await client.invoke("indexing.status.v1", {})).effectiveConfiguration,
    ).toEqual({ parallelism: 2, documentsPerMinute: 60 });
    await client.invoke("sidecar.configure.v1", {
      user_configuration: {},
      organization_configuration: {},
    });
    expect(
      (await client.invoke("indexing.status.v1", {})).effectiveConfiguration,
    ).toEqual({ parallelism: 1, documentsPerMinute: 40 });
  });

  it("keeps the client ready to configure and search after Teams statistics", async () => {
    const { client, sidecar } = await setup();
    await client.discover();

    const status = await client.invoke("indexing.status.v1", {});
    expect(
      status.generations.every((generation) =>
        generation.segments.some((segment) => segment.kind === "teams_message"),
      ),
    ).toBe(true);
    expect(status.configuration).toBeDefined();
    const configuration = {
      ...status.configuration!,
      organization_configuration: { show_tray_icon: false },
    };
    await client.invoke("sidecar.configure.v1", configuration);
    expect(sidecar.configuration).toEqual(configuration);
    await client.invoke("search.query.v1", {
      filters: { kind: "teams_message" },
    });
    expect(client.getSnapshot().state).toBe("ready");
  });

  it("discovers an older sidecar without indexing statistics", async () => {
    const { client } = await setup({ omitMethods: ["indexing.status.v1"] });
    await client.discover();
    expect(client.supports("indexing.status.v1")).toBe(false);
    await expect(
      client.invoke("sidecar.configure.v1", {
        user_configuration: { indexing_parallelism: 2 },
        organization_configuration: {},
      }),
    ).resolves.toEqual({});
  });

  it("sends extensible user and organization configuration", async () => {
    const { client, sidecar } = await setup();
    await client.discover();

    expect(client.supports("sidecar.configure.v1")).toBe(true);
    await expect(
      client.invoke("sidecar.configure.v1", {
        user_configuration: {
          show_tray_icon: null,
          future_user_setting: "preserved",
        },
        organization_configuration: {
          show_tray_icon: false,
          future_organization_setting: { enabled: true },
        },
      }),
    ).resolves.toEqual({});
    expect(sidecar.configuration).toEqual({
      user_configuration: {
        show_tray_icon: null,
        future_user_setting: "preserved",
      },
      organization_configuration: {
        show_tray_icon: false,
        future_organization_setting: { enabled: true },
      },
    });
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

  it("recognizes source browsing only when the sidecar advertises it", async () => {
    const current = await setup();
    await current.client.discover();
    expect(current.client.supports("sources.list.v1")).toBe(true);
    expect(current.client.supports("sources.get_folder_hierarchy.v1")).toBe(
      true,
    );

    const older = await setup({
      omitMethods: ["sources.list.v1", "sources.get_folder_hierarchy.v1"],
    });
    await older.client.discover();
    expect(older.client.supports("sources.list.v1")).toBe(false);
    expect(older.client.supports("sources.get_folder_hierarchy.v1")).toBe(
      false,
    );
    expect(older.client.supports("outlook.list_mailboxes.v1")).toBe(true);
    expect(older.client.supports("search.query.v1")).toBe(true);
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

  it("observes progress steps while a delayed echo runs and after it settles", async () => {
    const { client } = await setup();
    await client.discover();

    const observations: SidecarProgressV1Result[] = [];
    await expect(
      client.invoke(
        "diagnostics.echo.v1",
        { message: "slow", delayMs: 300 },
        {
          progress: {
            intervalMs: 50,
            onProgress: (progress) => observations.push(progress),
          },
        },
      ),
    ).resolves.toMatchObject({ message: "slow" });

    const running = observations.find(
      (observation) => observation.state === "running",
    );
    expect(running?.trace?.steps).toEqual([
      expect.objectContaining({
        sequence: 0,
        id: "delay",
        status: "running",
      }),
    ]);
    expect(observations.at(-1)).toMatchObject({ state: "finished" });
    expect(observations.at(-1)?.trace?.steps).toEqual([
      expect.objectContaining({ sequence: 0, id: "delay", status: "ok" }),
    ]);
    expect(client.getSnapshot().state).toBe("ready");
  });

  it("delivers the result even when the progress observer throws", async () => {
    const { client } = await setup();
    await client.discover();

    let observations = 0;
    await expect(
      client.invoke(
        "diagnostics.echo.v1",
        { message: "sturdy", delayMs: 200 },
        {
          progress: {
            intervalMs: 50,
            onProgress: () => {
              observations += 1;
              throw new Error("observer bug");
            },
          },
        },
      ),
    ).resolves.toMatchObject({ message: "sturdy" });
    expect(observations).toBeGreaterThan(0);
    expect(client.getSnapshot().state).toBe("ready");
  });

  it("cancels a timed-out delayed echo and leaves its final trace observable", async () => {
    const { client } = await setup();
    await client.discover();

    const observations: SidecarProgressV1Result[] = [];
    await expect(
      client.invoke(
        "diagnostics.echo.v1",
        { message: "slow", delayMs: 5000 },
        {
          timeoutMs: 150,
          progress: {
            intervalMs: 50,
            onProgress: (progress) => observations.push(progress),
          },
        },
      ),
    ).rejects.toMatchObject({ kind: "timeout" });

    expect(observations.at(-1)).toMatchObject({ state: "finished" });
    expect(observations.at(-1)?.trace?.steps).toEqual([
      expect.objectContaining({
        sequence: 0,
        id: "delay",
        status: "skipped",
        detail: "cancelled",
      }),
    ]);
    expect(client.getSnapshot().state).toBe("ready");
  });

  it("streams search progress while the mock search runs", async () => {
    const { client } = await setup({ searchDelayMs: 300 });
    await client.discover();

    const observations: SidecarProgressV1Result[] = [];
    const result = await client.invoke(
      "outlook.search_emails.v1",
      { mailboxId: "8b7d2f4a6c9e1035d8a1b2c3e4f50617", query: "mock" },
      {
        progress: {
          intervalMs: 50,
          onProgress: (progress) => observations.push(progress),
        },
      },
    );

    const running = observations.find(
      (observation) => observation.state === "running",
    );
    expect(running?.trace?.steps).toContainEqual(
      expect.objectContaining({
        sequence: 1,
        id: "expandQuery",
        status: "running",
        model: "mock-local-model",
      }),
    );
    expect(observations.at(-1)).toMatchObject({ state: "finished" });
    expect(observations.at(-1)?.trace?.steps).toContainEqual(
      expect.objectContaining({ sequence: 3, id: "summarize", status: "ok" }),
    );
    expect(result.trace?.steps).toEqual(observations.at(-1)?.trace?.steps);
  });

  it("cancels a mock search mid-flight", async () => {
    const { client } = await setup({ searchDelayMs: 5000 });
    await client.discover();

    const observations: SidecarProgressV1Result[] = [];
    await expect(
      client.invoke(
        "outlook.search_emails.v1",
        { mailboxId: "8b7d2f4a6c9e1035d8a1b2c3e4f50617", query: "mock" },
        {
          timeoutMs: 150,
          progress: {
            intervalMs: 50,
            onProgress: (progress) => observations.push(progress),
          },
        },
      ),
    ).rejects.toMatchObject({ kind: "timeout" });

    expect(observations.at(-1)).toMatchObject({ state: "finished" });
    expect(observations.at(-1)?.trace?.steps).toContainEqual(
      expect.objectContaining({ status: "skipped", detail: "cancelled" }),
    );
    expect(client.getSnapshot().state).toBe("ready");
  });

  it("completes a call untouched when the sidecar predates sidecar.progress.v1", async () => {
    const { client } = await setup({ omitMethods: ["sidecar.progress.v1"] });
    await client.discover();

    expect(client.supports("sidecar.progress.v1")).toBe(false);
    const observations: SidecarProgressV1Result[] = [];
    await expect(
      client.invoke(
        "diagnostics.echo.v1",
        { message: "old sidecar", delayMs: 120 },
        {
          progress: {
            intervalMs: 30,
            onProgress: (progress) => observations.push(progress),
          },
        },
      ),
    ).resolves.toMatchObject({ message: "old sidecar" });
    expect(observations).toEqual([]);
    expect(client.getSnapshot().state).toBe("ready");
  });

  it("answers unknown for a request id the sidecar does not track", async () => {
    const { client } = await setup();
    await client.discover();

    await expect(
      client.invoke("sidecar.progress.v1", { requestId: "c-never-sent" }),
    ).resolves.toEqual({ state: "unknown" });
  });
});

describe("index lifecycle and lexical search", () => {
  it("discovers the commands, preserves configuration across stop/start and explicitly resumes after reset", async () => {
    const { client } = await setup();
    await client.discover();
    for (const method of [
      "indexing.start.v1",
      "indexing.stop.v1",
      "search.query.v1",
      "search.metadata_fields.v1",
    ])
      expect(client.supports(method)).toBe(true);
    await client.invoke("sidecar.configure.v1", {
      user_configuration: { indexing_documents_per_minute: 57 },
      organization_configuration: {},
    });
    const stopped = await client.invoke("indexing.stop.v1", {});
    expect(stopped.state).toBe("stopped");
    expect(stopped.generations.length).toBeGreaterThan(0);
    expect(
      (
        await client.invoke("search.query.v1", {
          text: "invoice",
          filters: { kind: "file" },
        })
      ).hits,
    ).toEqual([]);
    expect(
      (await client.invoke("search.metadata_fields.v1", {})).fields,
    ).toEqual([]);
    const started = await client.invoke("indexing.start.v1", {});
    expect(started.state).toBe("running");
    expect(started.effectiveConfiguration.documentsPerMinute).toBe(57);
    await client.invoke("indexing.reset.v1", {});
    await expect(client.invoke("search.query.v1", {})).rejects.toMatchObject({
      code: -32011,
    });
    expect((await client.invoke("indexing.start.v1", {})).state).toBe(
      "running",
    );
    expect((await client.invoke("search.query.v1", {})).hits).toEqual([]);
  });
  it("does not advertise added methods on older sidecars", async () => {
    const { client } = await setup({
      omitMethods: ["indexing.start.v1", "indexing.stop.v1", "search.query.v1"],
    });
    await client.discover();
    expect(client.supports("search.query.v1")).toBe(false);
    await expect(client.invoke("indexing.start.v1", {})).rejects.toBeInstanceOf(
      SidecarClientError,
    );
  });
});
