import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  DesktopSidecarClient,
  HttpTransport,
  SIDECAR_PROVIDER,
  type CallToolResult,
  type JobCallResult,
  type SidecarClientInfo,
} from "../typescript/src/index.js";
import {
  MockSidecar,
  createMockSidecar,
  type MockSidecarOptions,
} from "../test-server/src/index.js";
import {
  validateDiscoverResult,
  validateJobsStartV1Params,
  validateJobsStatusV1Result,
  validateSidecarStructuredContent,
} from "../typescript/src/generated/validators.mjs";

const ORIGIN = "https://app.erato.example";
const MAILBOX_ID = "8b7d2f4a6c9e1035d8a1b2c3e4f50617";
const JOB_METHODS = [
  "jobs.start.v1",
  "jobs.status.v1",
  "jobs.read.v1",
  "jobs.ack.v1",
  "jobs.cancel.v1",
  "jobs.review.v1",
];
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
  requestTimeoutMs?: number,
): Promise<DesktopSidecarClient> {
  const sidecar = await createMockSidecar({
    allowedOrigins: [ORIGIN],
    ...options,
  });
  activeSidecars.push(sidecar);
  const { maxResponseBytes } = options;
  const client = new DesktopSidecarClient({
    transport: new HttpTransport(sidecar.address.url, {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Origin", ORIGIN);
        return fetch(input, { ...init, headers });
      },
      maxResponseBytes,
    }),
    clientInfo,
    requestTimeoutMs,
    maxResponseBytes,
  });
  await client.discover();
  return client;
}

const mailboxes = {
  server: "sidecar",
  name: "list_sidecar_mailboxes",
  arguments: {},
};
const conversation = (mailboxId = MAILBOX_ID) => ({
  server: "sidecar",
  name: "read_sidecar_conversation",
  arguments: {
    mailboxId,
    internetMessageId: "<mock-outlook-email@example.com>",
  },
});
const MAILBOXES = "outlook.list_mailboxes.v1";
const CONVERSATION = "outlook.get_conversation.v1";
/** A result-level warning and warnings about the mock message and another. */
const conversationWarnings = [
  { code: "truncated", message: "Stopped after 1 of 2 messages." },
  {
    code: "body_preview_only",
    message: "Only the preview of Mock Outlook message is cached.",
    internetMessageId: "<mock-outlook-email@example.com>",
  },
  {
    code: "attachment_unavailable",
    message: "Could not read report.pdf.",
    internetMessageId: "<other-message@example.com>",
  },
];
const TRUNCATED = {
  code: "truncated",
  message: "The conversation was truncated.",
};

function outcome(results: JobCallResult[] | undefined, index: number) {
  const entry = results?.[index];
  if (!entry) throw new Error(`No outcome for call ${index}.`);
  return entry;
}

function resultOf(results: JobCallResult[] | undefined, index: number) {
  const { result } = outcome(results, index) as { result?: CallToolResult };
  if (!result) throw new Error(`Call ${index} has no result.`);
  return result;
}

describe("job envelope", () => {
  it("advertises the jobs capability and the sidecar provider in discovery", async () => {
    const client = await setup();
    expect(client.getSnapshot()).toMatchObject({
      state: "ready",
      strict: false,
      jobs: { maxCalls: 8, maxWaitMs: 30_000 },
      providers: [
        {
          id: "sidecar",
          tools: SIDECAR_PROVIDER.tools.map((tool) => tool.name),
          readOnly: true,
          egress: "none",
          available: true,
        },
      ],
    });
    for (const method of JOB_METHODS)
      expect(client.supports(method), method).toBe(true);
  });

  it("runs a job through start, status, read and ack", async () => {
    const client = await setup({ jobDelayMs: 100 });
    const started = await client.invoke("jobs.start.v1", {
      calls: [mailboxes],
    });
    expect(["queued", "running"]).toContain(started.state);
    expect(started.results).toBeUndefined();

    const status = await client.invoke("jobs.status.v1", {
      handle: started.handle,
      wait_ms: 5_000,
    });
    expect(status.state).toBe("completed");
    expect(outcome(status.results, 0)).toMatchObject({
      result: {
        content: [],
        structuredContent: {
          [MAILBOXES]: { result: { mailboxes: [{ id: MAILBOX_ID }] } },
          "sources.list.v1": { result: { sources: [{ locator: {} }] } },
        },
      },
    });

    // Delivered results stay readable until acknowledged.
    await expect(
      client.invoke("jobs.status.v1", { handle: started.handle }),
    ).resolves.toMatchObject({ state: "read", results: status.results });
    await expect(
      client.invoke("jobs.read.v1", { handle: started.handle }),
    ).resolves.toEqual({ results: status.results });

    await expect(
      client.invoke("jobs.ack.v1", { handle: started.handle }),
    ).resolves.toEqual({ handle: started.handle, state: "acked" });
    await expect(
      client.invoke("jobs.status.v1", { handle: started.handle }),
    ).resolves.toEqual({ handle: started.handle, state: "acked" });
    await expect(
      client.invoke("jobs.read.v1", { handle: started.handle }),
    ).rejects.toMatchObject({ kind: "invalid_params" });
  });

  it("answers jobs.start with the results when the job finishes within wait_ms", async () => {
    const client = await setup({ jobDelayMs: 50 });
    const started = await client.invoke("jobs.start.v1", {
      calls: [mailboxes],
      wait_ms: 5_000,
    });
    expect(started.state).toBe("completed");
    expect(resultOf(started.results, 0).structuredContent).toHaveProperty([
      MAILBOXES,
      "result",
    ]);
  });

  it("reports the pending state when wait_ms elapses first", async () => {
    const client = await setup({ jobDelayMs: 2_000 });
    const started = await client.invoke("jobs.start.v1", {
      calls: [mailboxes],
      wait_ms: 50,
    });
    expect(started).toEqual({ handle: started.handle, state: "running" });
    await expect(
      client.invoke("jobs.cancel.v1", { handle: started.handle }),
    ).resolves.toEqual({ handle: started.handle, state: "cancelled" });
    // Cancellation is idempotent and terminal.
    await expect(
      client.invoke("jobs.cancel.v1", { handle: started.handle }),
    ).resolves.toEqual({ handle: started.handle, state: "cancelled" });
  });

  it("extends the default deadline of a long-poll by its wait", async () => {
    const client = await setup({ jobDelayMs: 400 }, 200);
    await expect(
      client.invoke("jobs.start.v1", { calls: [mailboxes], wait_ms: 2_000 }),
    ).resolves.toMatchObject({ state: "completed" });
  });

  it("returns each composed method's direct outcome, and an error for a call that cannot run", async () => {
    const client = await setup();
    const started = await client.invoke("jobs.start.v1", {
      calls: [
        mailboxes,
        conversation("00000000000000000000000000000000"),
        { ...mailboxes, arguments: { unexpected: true } },
      ],
      wait_ms: 5_000,
    });
    expect(started.state).toBe("completed");
    expect(started.results).toHaveLength(3);
    // The same result and error object the direct requests return.
    expect(resultOf(started.results, 0).structuredContent?.[MAILBOXES]).toEqual(
      { result: await client.invoke(MAILBOXES, {}) },
    );
    expect(resultOf(started.results, 1).structuredContent).toEqual({
      [CONVERSATION]: {
        error: { code: -32602, message: "Unknown Outlook mailbox." },
      },
    });
    expect(outcome(started.results, 2)).toEqual({
      error: { code: -32602, message: "Invalid method parameters." },
    });
  });

  it("moves file bytes into resources that name their item and Outlook origin", async () => {
    const client = await setup();
    const started = await client.invoke("jobs.start.v1", {
      calls: [conversation()],
      wait_ms: 5_000,
    });
    const { content, structuredContent } = resultOf(started.results, 0);
    expect(validateSidecarStructuredContent(structuredContent)).toBe(true);
    const direct = await client.invoke(CONVERSATION, {
      mailboxId: MAILBOX_ID,
      anchor: { internetMessageId: "<mock-outlook-email@example.com>" },
    });
    const attachment = direct.messages[0]?.attachments[0];
    expect(content).toEqual([
      {
        type: "resource",
        resource: {
          uri: `erato-sidecar:attachment/${attachment?.sha256}`,
          mimeType: attachment?.contentType,
          blob: attachment?.contentBytes,
        },
        _meta: {
          "ai.erato/item": `/${CONVERSATION}/result/messages/0/attachments/0`,
          "ai.erato/outlookProvenance": {
            version: 1,
            origins: [
              {
                topLevelParent: {
                  ...attachment?.topLevelParent,
                  mailbox: {
                    mailboxId: MAILBOX_ID,
                    emailAddress: direct.mailbox?.emailAddress,
                  },
                },
              },
            ],
          },
        },
      },
    ]);
    // Putting the bytes back at the named item restores the direct result.
    const restored = structuredClone(structuredContent?.[CONVERSATION]) as {
      result: typeof direct;
    };
    const target = restored.result.messages[0]?.attachments[0];
    if (target) target.contentBytes = attachment?.contentBytes;
    expect(restored).toEqual({ result: direct });
  });

  it("keeps a job's results within the response cap and fails only the call that would exceed it", async () => {
    // One export fits the cap; two together would not.
    const client = await setup({
      documentBytes: 400_000,
      maxResponseBytes: 1_048_576,
    });
    const document = (documentId: string) => ({
      server: "sidecar",
      name: "get_sidecar_document",
      arguments: { documentId },
    });
    const started = await client.invoke("jobs.start.v1", {
      calls: [
        document("2b0f6a43-8f5e-4c79-9d8e-0d6b5e7a9c11"),
        document("7d4c1e9a-3b6f-4a2d-8c5e-9f0a1b2c3d4e"),
      ],
      wait_ms: 5_000,
    });
    expect(started.state).toBe("completed");
    expect(outcome(started.results, 0)).toHaveProperty(
      "result.content.0.resource.blob",
    );
    // The error an oversized direct export returns.
    expect(outcome(started.results, 1)).toEqual({
      error: {
        code: -32016,
        message: "The sidecar could not complete the request.",
        data: { kind: "sidecar_internal", sourceError: "export_too_large" },
      },
    });
    expect(client.getSnapshot().state).toBe("ready");
    await expect(
      client.invoke("jobs.read.v1", { handle: started.handle }),
    ).resolves.toEqual({ results: started.results });
  });

  it("refuses tools outside the provider table per call", async () => {
    const client = await setup();
    const started = await client.invoke("jobs.start.v1", {
      calls: [
        { server: "sidecar", name: "outlook.list_emails.v1", arguments: {} },
        { server: "sidecar", name: "sidecar_configure", arguments: {} },
        { server: "files", name: "read_file", arguments: {} },
      ],
      wait_ms: 5_000,
    });
    for (const index of [0, 1, 2])
      expect(outcome(started.results, index)).toMatchObject({
        error: { code: -32011, data: { kind: "capability_unavailable" } },
      });
  });

  it("holds a strict job with a content tool for native review and exports only the approved items", async () => {
    const client = await setup({ strict: true, conversationWarnings });
    const sidecar = activeSidecars.at(-1)!;
    expect(client.getSnapshot().strict).toBe(true);
    const started = await client.invoke("jobs.start.v1", {
      calls: [conversation(), mailboxes],
      wait_ms: 5_000,
    });
    // Nothing leaves the sidecar before the decision.
    expect(started).toEqual({
      handle: started.handle,
      state: "ready_for_review",
    });
    await expect(
      client.invoke("jobs.review.v1", { handle: started.handle }),
    ).resolves.toEqual({ handle: started.handle, state: "ready_for_review" });
    // Naming the client is optional and changes nothing about the job.
    await expect(
      client.invoke("jobs.review.v1", {
        handle: started.handle,
        client: { platform: "web", locale: "de" },
      }),
    ).resolves.toEqual({ handle: started.handle, state: "ready_for_review" });
    await expect(
      client.invoke("jobs.read.v1", { handle: started.handle }),
    ).rejects.toMatchObject({ kind: "invalid_params" });

    const decided = client.invoke("jobs.status.v1", {
      handle: started.handle,
      wait_ms: 5_000,
    });
    sidecar.decideReview(started.handle, [[0]]);
    const approved = await decided;
    expect(approved.state).toBe("approved");
    const exported = resultOf(approved.results, 0);
    expect(exported.structuredContent).toMatchObject({
      [CONVERSATION]: {
        result: { state: "ok", mailbox: { id: MAILBOX_ID }, messages: [{}] },
      },
    });
    // Result-level warnings and those about an approved message cross.
    expect(exported.structuredContent?.[CONVERSATION]).toHaveProperty(
      "result.warnings",
      [
        TRUNCATED,
        {
          code: "body_preview_only",
          message: "Only the body preview the application cached is available.",
          internetMessageId: "<mock-outlook-email@example.com>",
        },
      ],
    );
    expect(exported.content).toMatchObject([
      {
        type: "resource",
        _meta: {
          "ai.erato/item": `/${CONVERSATION}/result/messages/0/attachments/0`,
        },
      },
    ]);
    // An account-level call in the same job is exported unchanged.
    expect(resultOf(approved.results, 1).structuredContent).toHaveProperty([
      MAILBOXES,
      "result",
      "mailboxes",
    ]);
  });

  it("exports only result-level metadata when no item is approved, and method errors under a fixed message", async () => {
    const client = await setup({ strict: true, conversationWarnings });
    const sidecar = activeSidecars.at(-1)!;
    const started = await client.invoke("jobs.start.v1", {
      calls: [
        conversation(),
        conversation("00000000000000000000000000000000"),
        {
          server: "sidecar",
          name: "get_sidecar_document",
          arguments: { documentId: "2b0f6a43-8f5e-4c79-9d8e-0d6b5e7a9c11" },
        },
      ],
      wait_ms: 5_000,
    });
    sidecar.decideReview(started.handle, [[], [], []]);
    // A review call reports the decision without delivering the export.
    await expect(
      client.invoke("jobs.review.v1", { handle: started.handle }),
    ).resolves.toEqual({ handle: started.handle, state: "approved" });
    const { results } = await client.invoke("jobs.status.v1", {
      handle: started.handle,
    });
    expect(resultOf(results, 0)).toEqual({
      content: [],
      structuredContent: {
        [CONVERSATION]: {
          result: {
            state: "ok",
            mailbox: expect.objectContaining({ id: MAILBOX_ID }),
            messages: [],
            warnings: [TRUNCATED],
          },
        },
      },
    });
    expect(resultOf(results, 1).structuredContent).toEqual({
      [CONVERSATION]: {
        error: { code: -32602, message: "Invalid method parameters." },
      },
    });
    // A file's own metadata stays with the file.
    expect(resultOf(results, 2)).toEqual({
      content: [],
      structuredContent: {
        [MAILBOXES]: await client
          .invoke(MAILBOXES, {})
          .then((result) => ({ result })),
      },
    });
  });

  it("ends a declined strict job without results and runs account-level tools without review", async () => {
    const client = await setup({ strict: true });
    const sidecar = activeSidecars.at(-1)!;
    const started = await client.invoke("jobs.start.v1", {
      calls: [conversation()],
      wait_ms: 5_000,
    });
    sidecar.decideReview(started.handle, null);
    await expect(
      client.invoke("jobs.status.v1", { handle: started.handle }),
    ).resolves.toEqual({ handle: started.handle, state: "declined" });
    await expect(
      client.invoke("jobs.read.v1", { handle: started.handle }),
    ).rejects.toMatchObject({ kind: "invalid_params" });

    await expect(
      client.invoke("jobs.start.v1", { calls: [mailboxes], wait_ms: 5_000 }),
    ).resolves.toMatchObject({ state: "completed" });
  });

  it("reports an unknown handle as expired", async () => {
    const client = await setup();
    const handle = "unknown-handle-0123456789abcdefghijklmnop";
    await expect(client.invoke("jobs.status.v1", { handle })).resolves.toEqual({
      handle,
      state: "expired",
    });
    await expect(client.invoke("jobs.ack.v1", { handle })).resolves.toEqual({
      handle,
      state: "expired",
    });
  });

  it("keeps the direct RPCs for a sidecar from before package 0.1.44", async () => {
    const client = await setup({ omitMethods: JOB_METHODS, strict: null });
    const snapshot = client.getSnapshot();
    expect(snapshot.state).toBe("ready");
    expect(snapshot).not.toHaveProperty("strict");
    expect(snapshot).not.toHaveProperty("jobs");
    expect(snapshot).not.toHaveProperty("providers");
    expect(client.supports("jobs.start.v1")).toBe(false);
    expect(client.supports("outlook.list_mailboxes.v1")).toBe(true);
  });

  it("validates the job envelope boundary", () => {
    expect(validateJobsStartV1Params({ calls: [] })).toBe(false);
    expect(
      validateJobsStartV1Params({
        calls: Array.from({ length: 17 }, () => mailboxes),
      }),
    ).toBe(false);
    expect(
      validateJobsStartV1Params({
        calls: [{ name: "list_sidecar_mailboxes" }],
      }),
    ).toBe(false);
    expect(
      validateJobsStartV1Params({
        calls: [{ server: "sidecar", name: "list_sidecar_mailboxes" }],
        wait_ms: 30_001,
      }),
    ).toBe(false);
    expect(
      validateJobsStartV1Params({
        calls: [{ ...mailboxes, futureCallField: true }],
        wait_ms: 0,
        futureField: true,
      }),
    ).toBe(true);
  });
});

describe("job envelope conformance fixture", () => {
  interface JobEnvelopeFixture {
    discovery: {
      name: string;
      result: Record<string, unknown>;
      jobs: boolean;
    }[];
    statuses: unknown[];
    invalidStatuses: { name: string; value: unknown }[];
    invalidMetaKeys: string[];
    invalidItemMeta: { name: string; value: Record<string, unknown> }[];
    sidecarStructuredContent: unknown[];
    invalidSidecarStructuredContent: { name: string; value: unknown }[];
  }

  const read = async <T>(relative: string): Promise<T> =>
    JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8")) as T;

  it("accepts discovery with and without the job envelope (both rollout directions)", async () => {
    const document = await read<unknown>("../openrpc.json");
    const fixture = await read<JobEnvelopeFixture>(
      "../conformance/fixtures/job-envelope.json",
    );
    for (const testCase of fixture.discovery) {
      expect(
        validateDiscoverResult({ ...testCase.result, document }),
        testCase.name,
      ).toBe(true);
      expect("jobs" in testCase.result, testCase.name).toBe(testCase.jobs);
    }
    const current = fixture.discovery.at(-1)!.result;
    for (const providers of [
      [{ id: "sidecar", tools: [], readOnly: true, available: true }],
      [
        {
          id: "Sidecar",
          tools: [],
          readOnly: true,
          egress: "none",
          available: true,
        },
      ],
    ]) {
      expect(validateDiscoverResult({ ...current, document, providers })).toBe(
        false,
      );
    }
    expect(
      validateDiscoverResult({ ...current, document, strict: "yes" }),
    ).toBe(false);
  });

  it("accepts every MCP content block kind and per-call errors, and rejects malformed outcomes", async () => {
    const fixture = await read<JobEnvelopeFixture>(
      "../conformance/fixtures/job-envelope.json",
    );
    for (const status of fixture.statuses)
      expect(validateJobsStatusV1Result(status)).toBe(true);
    for (const testCase of fixture.invalidStatuses)
      expect(validateJobsStatusV1Result(testCase.value), testCase.name).toBe(
        false,
      );
    for (const key of fixture.invalidMetaKeys)
      expect(
        validateJobsStatusV1Result({
          handle: "job-handle-0123456789abcdefghijklmnopqrstuv",
          state: "completed",
          results: [{ result: { content: [], _meta: { [key]: 1 } } }],
        }),
        key,
      ).toBe(false);
    for (const testCase of fixture.invalidItemMeta)
      expect(
        validateJobsStatusV1Result({
          handle: "job-handle-0123456789abcdefghijklmnopqrstuv",
          state: "completed",
          results: [
            {
              result: {
                content: [
                  {
                    type: "resource",
                    resource: { uri: "erato-sidecar:document/x", blob: "" },
                    _meta: testCase.value,
                  },
                ],
              },
            },
          ],
        }),
        testCase.name,
      ).toBe(false);
  });

  it("accepts raw method outcomes as a sidecar tool's structured content", async () => {
    const fixture = await read<JobEnvelopeFixture>(
      "../conformance/fixtures/job-envelope.json",
    );
    for (const value of fixture.sidecarStructuredContent)
      expect(validateSidecarStructuredContent(value)).toBe(true);
    for (const testCase of fixture.invalidSidecarStructuredContent)
      expect(
        validateSidecarStructuredContent(testCase.value),
        testCase.name,
      ).toBe(false);
  });
});
