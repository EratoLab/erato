import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  completedJob,
  fakeSidecarClient,
  fixtureDiscovery,
  JOB_HANDLE,
  NORMAL_MODE,
} from "./__tests__/sidecarJobTestUtils";
import {
  createSidecarChatTools,
  GET_SIDECAR_DOCUMENT_TOOL,
  GET_SIDECAR_FOLDER_HIERARCHY_TOOL,
  GET_SIDECAR_SEARCH_FIELDS_TOOL,
  LIST_SIDECAR_MAILBOXES_TOOL,
  READ_SIDECAR_CONVERSATION_TOOL,
  SEARCH_SIDECAR_INDEX_TOOL,
  SIDECAR_CHAT_TOOL_METHODS,
} from "./chatTools";
import jobEnvelope from "../../../../desktop-sidecar-protocol/conformance/fixtures/job-envelope.json";
import jobsExample from "../../../../desktop-sidecar-protocol/examples/jobs.json";

import type { SidecarReply } from "./__tests__/sidecarJobTestUtils";
import type {
  SidecarAttachmentUpload,
  SidecarChatToolOptions,
} from "./chatTools";
import type { ClientToolExecutionResult } from "@/hooks/chat/clientToolExecutors";
import type {
  JobCallResult,
  JobToolCall,
  SidecarSnapshot,
} from "@erato/desktop-sidecar-protocol";

// The reference mock's data (desktop-sidecar-protocol/test-server).
const MAILBOX = {
  id: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
  displayName: "Mock Outlook mailbox",
  emailAddress: "mock@example.com",
  profileName: "Mock Outlook Profile",
  source: "mock",
};
const EXTERNAL_IDS = [
  { key: "email_message_id", value: "<mock-outlook-email@example.com>" },
  { key: "ews_id", value: "AQMk/CaseSensitive+MockEwsId==" },
];
const SOURCE = {
  sourceId: "5c1e8f0a-2b3d-4e6f-8a9b-0c1d2e3f4a5b",
  sourceKind: "mock",
  enabled: true,
  lastSuccessAt: null,
  lastErrorCode: null,
  capabilities: { folders: true, metadataFields: [] },
};
const PARENT_ID = "2b0f6a43-8f5e-4c79-9d8e-0d6b5e7a9c11";
const MESSAGE = {
  external_ids: EXTERNAL_IDS,
  internetMessageId: "<mock-outlook-email@example.com>",
  subject: "Mock Outlook message",
  from: { name: "Erato Test", emailAddress: "test@example.com" },
  to: [{ name: "Mock Outlook mailbox", emailAddress: "mock@example.com" }],
  cc: [],
  sentAtUnixSeconds: 1_774_291_200,
  isDraft: false,
  body: { contentType: "text/plain", content: "Mock Outlook message body." },
  attachments: [
    {
      name: "mock-attachment.pdf",
      external_ids: [],
      topLevelParent: { documentId: PARENT_ID, external_ids: EXTERNAL_IDS },
      contentType: "application/pdf",
      size: 21,
      isInline: false,
      sha256: "b".repeat(64),
      contentBytes: globalThis.btoa("mock attachment bytes"),
    },
  ],
};
const HIT = {
  documentId: PARENT_ID,
  external_ids: [EXTERNAL_IDS[0]],
  chunkId: null,
  score: 1,
  kind: "email",
  title: "Mock Outlook message",
  sender: "Erato Test",
  mailboxId: MAILBOX.id,
  sourceId: SOURCE.sourceId,
  date: 1_774_291_200,
  mimeType: "message/rfc822",
  conversationKey: "mock-conversation",
};

/** The reference mock's direct RPCs, with the catalog source it describes. */
const RPC: Record<string, SidecarReply> = {
  "outlook.list_mailboxes.v1": {
    result: { mailboxes: [MAILBOX], warnings: [] },
  },
  "sources.list.v1": {
    result: {
      sources: [
        {
          ...SOURCE,
          sourceKey: "mock-source",
          product: "outlook",
          displayName: MAILBOX.displayName,
          locator: { mailboxId: MAILBOX.id },
          discoveryCursor: null,
          completedScanId: null,
        },
      ],
    },
  },
  "search.metadata_fields.v1": { result: { fields: [] } },
  "sources.get_folder_hierarchy.v1": {
    result: { sourceId: SOURCE.sourceId, nodes: [] },
  },
  "search.query.v1": {
    result: { hits: [HIT], elapsedMs: 0, blocksRead: 0, candidatesScored: 0 },
  },
  "outlook.get_conversation.v1": {
    result: {
      state: "ok",
      mailbox: MAILBOX,
      messages: [MESSAGE],
      warnings: [],
    },
  },
  "sources.get_document.v1": {
    result: {
      filename: "mock.eml",
      external_ids: EXTERNAL_IDS,
      mimeType: "message/rfc822",
      contentBase64: globalThis.btoa("Mock document"),
    },
  },
};

const INPUTS: Record<string, Record<string, unknown>> = {
  [LIST_SIDECAR_MAILBOXES_TOOL]: {},
  [GET_SIDECAR_SEARCH_FIELDS_TOOL]: {},
  [GET_SIDECAR_FOLDER_HIERARCHY_TOOL]: { sourceId: SOURCE.sourceId },
  [SEARCH_SIDECAR_INDEX_TOOL]: {
    query: "report",
    metadata_filters: [{ field: "importance", operator: "eq", value: "high" }],
  },
  [READ_SIDECAR_CONVERSATION_TOOL]: {
    mailboxId: MAILBOX.id,
    internetMessageId: MESSAGE.internetMessageId,
  },
};
const JOB_TOOLS = Object.keys(INPUTS);
/** Tools the reference mock answers without `freshness`, which the shared
 * wrapper adds on both paths. */
const WITHOUT_FRESHNESS = new Set([
  LIST_SIDECAR_MAILBOXES_TOOL,
  GET_SIDECAR_SEARCH_FIELDS_TOOL,
  GET_SIDECAR_FOLDER_HIERARCHY_TOOL,
]);
type CallError = Extract<JobCallResult, { error: unknown }>["error"];

const methodOf = (tool: string) =>
  SIDECAR_CHAT_TOOL_METHODS.find(({ name }) => name === tool)?.method ?? "";

const oversized = {
  code: -32016,
  message: "The sidecar could not complete the request.",
  data: { kind: "sidecar_internal", sourceError: "export_too_large" },
};
const { error: strictRefusal } = jobEnvelope.statuses[1]
  .results?.[1] as Extract<JobCallResult, { error: unknown }>;
/** Call errors as the direct RPC and the job report them alike. */
const ERROR_CASES: [string, string, CallError][] = [
  [
    "an unknown conversation anchor",
    READ_SIDECAR_CONVERSATION_TOOL,
    {
      code: -32602,
      message: "Unknown document.",
      data: { sourceError: "document_not_found" },
    },
  ],
  ...JOB_TOOLS.map((tool): [string, string, CallError] => [
    "an oversized result",
    tool,
    oversized,
  ]),
  ...JOB_TOOLS.map((tool): [string, string, CallError] => [
    "a strict sidecar's refusal",
    tool,
    strictRefusal,
  ]),
];

const context = { toolCallId: "call", messageId: "message", chatId: "chat" };
const grantContext = {
  ...context,
  hostGrant: {
    ownerChatId: "owner-chat",
    ownerMessageId: "owner-message",
    requestingChatId: context.chatId,
    requestingMessageId: context.messageId,
  },
};

/** A call's result as a 0.1.44 sidecar returns it: the tool result as structured content. */
function asCallResult(
  outcome: ClientToolExecutionResult,
  tool: string,
): JobCallResult {
  if (!outcome.ok) {
    return {
      result: {
        content: [{ type: "text", text: outcome.error }],
        isError: true,
      },
    };
  }
  const structuredContent = { ...(outcome.result as Record<string, unknown>) };
  if (WITHOUT_FRESHNESS.has(tool)) delete structuredContent.freshness;
  return {
    result: {
      content: [{ type: "text", text: "Plain-text rendering." }],
      structuredContent,
    },
  };
}

function options(): SidecarChatToolOptions & {
  uploadAttachment: ReturnType<typeof vi.fn<SidecarAttachmentUpload>>;
} {
  return {
    approveFiles: vi.fn<SidecarChatToolOptions["approveFiles"]>(
      async (files) => new Set(files),
    ),
    uploadAttachment: vi.fn<SidecarAttachmentUpload>(async () => ({
      id: "uploaded-file",
    })),
    uploadsEnabled: true,
    maxUploadBytes: 1000,
    maxFiles: 10,
  };
}

/**
 * A sidecar answering the direct RPCs from `rpc`, and each job call with
 * `call`; with `discovery`, the tools run as jobs.
 */
function sidecar(
  rpc: Record<string, SidecarReply>,
  call: (tool: string) => JobCallResult = () => {
    throw new Error("This sidecar runs no jobs.");
  },
  discovery: Partial<SidecarSnapshot> = {},
) {
  const fake = fakeSidecarClient((method, params) => {
    if (method === "jobs.start.v1")
      return completedJob(
        (params.calls as JobToolCall[]).map(({ name }) => call(name)),
      );
    if (method.startsWith("jobs."))
      return { result: { handle: JOB_HANDLE, state: "acked" } };
    return rpc[method] ?? { error: { code: -32601, message: "Not found." } };
  }, discovery);
  const toolOptions = options();
  const tools = createSidecarChatTools(fake.client, toolOptions);
  const tool = (name: string) => {
    const found = tools.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`No tool ${name}.`);
    return found;
  };
  return { ...fake, tool, options: toolOptions };
}

const jobSidecar = (
  rpc: Record<string, SidecarReply>,
  call: (tool: string) => JobCallResult,
) => sidecar(rpc, call, fixtureDiscovery(NORMAL_MODE));

/**
 * The tool's outcome on a sidecar without jobs, and on one whose job returns
 * what `call` makes of that outcome.
 */
async function bothPaths(
  tool: string,
  input: unknown,
  rpc: Record<string, SidecarReply>,
  call: (direct: ClientToolExecutionResult) => JobCallResult = (direct) =>
    asCallResult(direct, tool),
  callContext: typeof context = context,
) {
  const direct = sidecar(rpc);
  const legacy = await direct.tool(tool).execute(input, callContext);
  const job = jobSidecar(rpc, () => call(legacy));
  const viaJob = await job.tool(tool).execute(input, callContext);
  return { legacy, viaJob, direct, job };
}

beforeEach(() => {
  // Both paths stamp `readAt` from the clock; hold it still.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("desktop sidecar tools run as jobs", () => {
  it.each(JOB_TOOLS)(
    "%s returns the direct read's result through one job",
    async (tool) => {
      const { legacy, viaJob, direct, job } = await bothPaths(
        tool,
        INPUTS[tool],
        RPC,
      );
      expect(legacy.ok).toBe(true);
      expect(JSON.stringify(viaJob)).toBe(JSON.stringify(legacy));
      expect(
        direct.methods().some((method) => method.startsWith("jobs.")),
      ).toBe(false);
      await vi.waitFor(() =>
        expect(job.methods()).toEqual(["jobs.start.v1", "jobs.ack.v1"]),
      );
      expect(job.requests[0].params).toEqual({
        calls: [{ server: "sidecar", name: tool, arguments: INPUTS[tool] }],
        wait_ms: fixtureDiscovery(NORMAL_MODE).jobs?.maxWaitMs,
      });
    },
  );

  it("matches the protocol example's mailbox listing", async () => {
    const start = jobsExample.messages[0].message.params as {
      calls: JobToolCall[];
    };
    const { results } = (
      jobsExample.messages[1].message as {
        result: { results: JobCallResult[] };
      }
    ).result;
    const example = (name: string) =>
      results[start.calls.findIndex((call) => call.name === name)];
    const mailboxes = example(LIST_SIDECAR_MAILBOXES_TOOL) as Extract<
      JobCallResult,
      { result: unknown }
    >;
    const [mailbox] = (
      mailboxes.result.structuredContent as {
        mailboxes: (Record<string, unknown> & {
          sources: Record<string, unknown>[];
        })[];
      }
    ).mailboxes;
    const { sources, ...listed } = mailbox;
    const rpc: Record<string, SidecarReply> = {
      "outlook.list_mailboxes.v1": {
        result: { mailboxes: [listed], warnings: [] },
      },
      "sources.list.v1": {
        result: {
          sources: sources.map((source) => ({
            ...source,
            sourceKey: "work-ost",
            locator: { mailboxId: listed.id },
            discoveryCursor: null,
            completedScanId: null,
          })),
        },
      },
      // The example's second call names a mailbox the sidecar does not know.
      "outlook.get_conversation.v1": {
        error: (
          example(READ_SIDECAR_CONVERSATION_TOOL) as Extract<
            JobCallResult,
            { error: unknown }
          >
        ).error,
      },
    };
    const outcomes: ClientToolExecutionResult[] = [];
    for (const call of start.calls) {
      const { legacy, viaJob } = await bothPaths(
        call.name,
        call.arguments,
        rpc,
        () => example(call.name),
      );
      expect(JSON.stringify(viaJob)).toBe(JSON.stringify(legacy));
      outcomes.push(viaJob);
    }
    expect(outcomes).toEqual([
      {
        ok: true,
        result: {
          ...mailboxes.result.structuredContent,
          freshness: expect.objectContaining({ changes: "unknown" }),
        },
      },
      { ok: false, error: "Unknown Outlook mailbox." },
    ]);
  });

  it("matches a folder the sidecar cannot read", async () => {
    const { legacy, viaJob } = await bothPaths(
      GET_SIDECAR_FOLDER_HIERARCHY_TOOL,
      { sourceId: "00000000-0000-4000-8000-000000000009" },
      {
        "sources.get_folder_hierarchy.v1": {
          error: {
            code: -32016,
            message: "The sidecar could not complete the request.",
            data: {
              kind: "sidecar_internal",
              sourceError: "unsupported_source",
            },
          },
        },
      },
    );
    expect(legacy).toMatchObject({
      ok: true,
      result: { foldersAvailable: false },
    });
    expect(JSON.stringify(viaJob)).toBe(JSON.stringify(legacy));
  });

  it("matches a conversation whose mailbox cannot be read as conversations", async () => {
    const { legacy, viaJob } = await bothPaths(
      READ_SIDECAR_CONVERSATION_TOOL,
      INPUTS[READ_SIDECAR_CONVERSATION_TOOL],
      {
        "outlook.get_conversation.v1": {
          result: {
            state: "partial",
            mailbox: MAILBOX,
            messages: [],
            warnings: [{ code: "unsupported_source" }],
          },
        },
      },
    );
    expect(legacy).toMatchObject({
      ok: false,
      error: expect.stringContaining("Do not retry read_sidecar_conversation"),
    });
    expect(viaJob).toEqual(legacy);
  });

  it.each(ERROR_CASES)(
    "returns %s to %s as the direct read does",
    async (_case, tool, error) => {
      for (const callContext of [context, grantContext]) {
        const { legacy, viaJob } = await bothPaths(
          tool,
          INPUTS[tool],
          { ...RPC, [methodOf(tool)]: { error } },
          () => ({ error }),
          callContext,
        );
        expect(legacy.ok).toBe(false);
        expect(viaJob).toEqual(legacy);
      }
    },
  );

  it("returns a lost job to a task as the loss of the app", async () => {
    const tool = LIST_SIDECAR_MAILBOXES_TOOL;
    const direct = sidecar({
      ...RPC,
      [methodOf(tool)]: {
        error: {
          code: -32011,
          message: "Unavailable.",
          data: { kind: "capability_unavailable" },
        },
      },
    });
    const job = fakeSidecarClient(
      () => ({ result: { handle: JOB_HANDLE, state: "expired" } }),
      fixtureDiscovery(NORMAL_MODE),
    );
    const viaJob = await createSidecarChatTools(job.client, options())
      .find((candidate) => candidate.name === tool)
      ?.execute({}, grantContext);
    expect(viaJob).toEqual(await direct.tool(tool).execute({}, grantContext));
    expect(viaJob).toMatchObject({
      submissionFeedback: { terminal: true, recovery: "cannot_continue" },
    });
  });

  it("checks the input before it starts a job, as the direct read does", async () => {
    for (const [tool, input] of [
      [LIST_SIDECAR_MAILBOXES_TOOL, { unexpected: true }],
      [GET_SIDECAR_FOLDER_HIERARCHY_TOOL, {}],
      [SEARCH_SIDECAR_INDEX_TOOL, "report"],
      [READ_SIDECAR_CONVERSATION_TOOL, { mailboxId: MAILBOX.id }],
      [
        READ_SIDECAR_CONVERSATION_TOOL,
        { ...INPUTS[READ_SIDECAR_CONVERSATION_TOOL], maxMessages: 51 },
      ],
      [
        READ_SIDECAR_CONVERSATION_TOOL,
        { ...INPUTS[READ_SIDECAR_CONVERSATION_TOOL], mailboxId: "not-an-id" },
      ],
    ] as const) {
      const { legacy, viaJob, job } = await bothPaths(tool, input, RPC);
      expect(legacy.ok).toBe(false);
      expect(viaJob).toEqual(legacy);
      expect(job.methods()).toEqual([]);
    }
  });

  it.each([
    [[SEARCH_SIDECAR_INDEX_TOOL, READ_SIDECAR_CONVERSATION_TOOL]],
    [[SEARCH_SIDECAR_INDEX_TOOL]],
    [[READ_SIDECAR_CONVERSATION_TOOL]],
  ])("keeps what jobs of %s tell a later document export", async (reads) => {
    const run = async (path: ReturnType<typeof sidecar>) => {
      for (const tool of reads)
        await path.tool(tool).execute(INPUTS[tool], context);
      const outcome = await path
        .tool(GET_SIDECAR_DOCUMENT_TOOL)
        .execute(
          { documentId: PARENT_ID, subject_scope: "subject_with_thread" },
          context,
        );
      return { outcome, upload: path.options.uploadAttachment.mock.calls };
    };
    const legacy = await run(sidecar(RPC));
    const outcomes = new Map<string, ClientToolExecutionResult>();
    for (const tool of reads) {
      outcomes.set(
        tool,
        await sidecar(RPC).tool(tool).execute(INPUTS[tool], context),
      );
    }
    const viaJob = await run(
      jobSidecar(RPC, (tool) => {
        const outcome = outcomes.get(tool);
        if (!outcome) throw new Error(`No job result for ${tool}.`);
        return asCallResult(outcome, tool);
      }),
    );
    expect(legacy.outcome).toMatchObject({
      ok: true,
      result: { freshness: { scope: expect.any(Object) } },
    });
    expect(JSON.stringify(viaJob.outcome)).toBe(JSON.stringify(legacy.outcome));
    // The upload's Outlook provenance carries the mailbox the reads saw.
    expect(legacy.upload[0][4]).toMatchObject({
      origins: [{ document: { mailbox: { mailboxId: MAILBOX.id } } }],
    });
    expect(viaJob.upload).toEqual(legacy.upload);
  });

  it("keeps the direct RPCs for document exports and attachment uploads", async () => {
    const job = jobSidecar(RPC, () => {
      throw new Error("No job expected.");
    });
    const direct = sidecar(RPC);
    for (const [tool, input] of [
      [GET_SIDECAR_DOCUMENT_TOOL, { documentId: PARENT_ID }],
      [
        READ_SIDECAR_CONVERSATION_TOOL,
        { ...INPUTS[READ_SIDECAR_CONVERSATION_TOOL], includeAttachments: true },
      ],
    ] as const) {
      const viaJob = await job.tool(tool).execute(input, context);
      expect(viaJob).toMatchObject({
        ok: true,
        fileUploadIds: ["uploaded-file"],
      });
      expect(JSON.stringify(viaJob)).toBe(
        JSON.stringify(await direct.tool(tool).execute(input, context)),
      );
    }
    expect(job.methods()).not.toContain("jobs.start.v1");
    expect(job.options.uploadAttachment.mock.calls).toEqual(
      direct.options.uploadAttachment.mock.calls,
    );
  });

  it("offers the job tools while their direct RPCs are not enabled", () => {
    const job = jobSidecar(RPC, () => {
      throw new Error("No job expected.");
    });
    job.supports.mockImplementation((method) => method.startsWith("jobs."));
    for (const tool of JOB_TOOLS)
      expect(job.tool(tool).isAvailable()).toBe(true);
    expect(job.tool(GET_SIDECAR_DOCUMENT_TOOL).isAvailable()).toBe(false);
  });

  it("keeps everything on the device once the sidecar declares local delegation", async () => {
    const job = sidecar(
      RPC,
      () => {
        throw new Error("No job expected.");
      },
      {
        ...fixtureDiscovery(NORMAL_MODE),
        localDelegation: { profile: "strict_snapshot_v1" },
      },
    );
    for (const tool of JOB_TOOLS) {
      expect(job.tool(tool).isAvailable()).toBe(false);
      await expect(
        job.tool(tool).execute(INPUTS[tool], context),
      ).resolves.toEqual({ ok: true, disposition: "local_only" });
    }
    expect(job.requests).toEqual([]);
  });
});
