import { SIDECAR_PROVIDER } from "@erato/desktop-sidecar-protocol";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
} from "@/hooks/chat/clientToolExecutors";
import { useClientToolFileApprovalStore } from "@/hooks/chat/store/clientToolFileApprovalStore";
import { useClientToolFileApproval } from "@/hooks/chat/useClientToolFileApproval";
import {
  ClientToolOperationHandler,
  toOperationResult,
} from "@/lib/clientOperations/clientToolHandler";
import { ClientOperationCoordinator } from "@/lib/clientOperations/coordinator";
import { createClientOperationHandlerRegistry } from "@/lib/clientOperations/handlers";
import { fetchProfile } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  completedJob,
  fakeSidecarClient,
  fixtureDiscovery,
  JOB_HANDLE,
  NORMAL_MODE,
  STRICT_MODE,
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
  sidecarToolAvailable,
} from "./chatTools";
import { JOB_POLL_INTERVAL_MS } from "./sidecarJobs";
import {
  askForReviewAgain,
  rememberReview,
  reviewHasEnded,
  reviewLink,
  reviewLinkKey,
  useSidecarReviewLinks,
} from "./sidecarReviewLinks";
import jobEnvelope from "../../../../desktop-sidecar-protocol/conformance/fixtures/job-envelope.json";
import jobsExample from "../../../../desktop-sidecar-protocol/examples/jobs.json";

import type { SidecarReply } from "./__tests__/sidecarJobTestUtils";
import type {
  SidecarAttachmentUpload,
  SidecarChatToolOptions,
} from "./chatTools";
import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
} from "@/hooks/chat/clientToolExecutors";
import type { ClientOperationApi } from "@/lib/clientOperations/coordinator";
import type {
  AttemptState,
  ExecutorBinding,
  OperationPayload,
  OperationRequest,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type {
  CallToolResult,
  JobCallResult,
  JobToolCall,
  SidecarSnapshot,
} from "@erato/desktop-sidecar-protocol";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", async (original) => ({
  ...(await original<object>()),
  fetchProfile: vi.fn(),
}));

// The reference mock's data (desktop-sidecar-protocol/test-server), with a
// coverage report, an HTML body and a preview-only warning, so every shaping
// step runs.
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
  body: {
    contentType: "text/html",
    content: "<p>Mock Outlook</p><p>message body.</p>",
  },
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
const COVERAGE = {
  sampledAt: "2026-11-02T09:59:00Z",
  basis: "index",
  sources: [
    {
      sourceId: SOURCE.sourceId,
      mailboxId: MAILBOX.id,
      product: "outlook",
      displayName: MAILBOX.displayName,
      accountEmail: MAILBOX.emailAddress,
      from: { at: "2026-01-01T00:00:00Z", inclusive: true },
      through: null,
      observedAt: "2026-11-02T09:58:00Z",
      pendingNewer: 0,
      olderPending: 2,
      unsearchable: 1,
      undated: 0,
      dateBasis: "receivedAt",
      inventory: "cacheObservations",
      unavailableReason: null,
    },
  ],
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
  "search.metadata_fields.v1": {
    result: {
      fields: [
        {
          field: "importance",
          type: "string",
          description: "The email's importance.",
          applicable_kinds: ["email"],
          operators: ["eq"],
        },
      ],
    },
  },
  "sources.get_folder_hierarchy.v1": {
    result: { sourceId: SOURCE.sourceId, nodes: [] },
  },
  "search.query.v1": {
    result: {
      hits: [HIT],
      elapsedMs: 0,
      blocksRead: 0,
      candidatesScored: 0,
      coverage: COVERAGE,
      limitReached: true,
    },
  },
  "outlook.get_conversation.v1": {
    result: {
      state: "ok",
      mailbox: MAILBOX,
      messages: [MESSAGE],
      warnings: [
        {
          code: "body_preview_only",
          message: "Only the body preview the application cached is available.",
          internetMessageId: MESSAGE.internetMessageId,
        },
      ],
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
    filters: { dateFrom: 1_767_225_600 },
    metadata_filters: [{ field: "importance", operator: "eq", value: "high" }],
  },
  [READ_SIDECAR_CONVERSATION_TOOL]: {
    mailboxId: MAILBOX.id,
    internetMessageId: MESSAGE.internetMessageId,
    includeAttachments: true,
  },
  [GET_SIDECAR_DOCUMENT_TOOL]: {
    documentId: PARENT_ID,
    subject_scope: "subject_with_thread",
  },
};
const TOOLS = SIDECAR_PROVIDER.tools.map(({ name }) => name);
type CallError = Extract<JobCallResult, { error: unknown }>["error"];

const methodOf = (tool: string) =>
  SIDECAR_CHAT_TOOL_METHODS.find(({ name }) => name === tool)?.method ?? "";
/** Whether strict review selects items of the tool's results. */
const selects = (tool: string) =>
  SIDECAR_PROVIDER.tools.find(({ name }) => name === tool)?.selection !== null;

const oversized = {
  code: -32016,
  message: "The sidecar could not complete the request.",
  data: { kind: "sidecar_internal", sourceError: "export_too_large" },
};
const { error: invalidArguments } = jobEnvelope.statuses[2]
  .results?.[2] as Extract<JobCallResult, { error: unknown }>;

const context: ClientToolCallContext = {
  toolCallId: "call",
  messageId: "message",
  chatId: "chat",
};
const grantContext: ClientToolCallContext = {
  ...context,
  hostGrant: {
    ownerChatId: "owner-chat",
    ownerMessageId: "owner-message",
    requestingChatId: "chat",
    requestingMessageId: "message",
  },
};

const fileBlock = (item: string, blob: string) => ({
  type: "resource" as const,
  resource: { uri: `erato-sidecar:file${item}`, blob },
  _meta: { "ai.erato/item": item },
});

/**
 * A tool's job result as the sidecar composes it from the direct RPCs'
 * answers in `rpc`: the outcome of each method the provider table lists for
 * the tool, with file bytes moved into embedded resources (DELEGATION.md,
 * "Results and selection").
 */
function composedCall(
  tool: string,
  rpc: Record<string, SidecarReply>,
): JobCallResult {
  const methods =
    SIDECAR_PROVIDER.tools.find(({ name }) => name === tool)?.methods ?? [];
  const structuredContent: Record<string, unknown> = {};
  const content: CallToolResult["content"] = [];
  for (const method of methods) {
    if (!Object.hasOwn(rpc, method)) continue;
    const reply = rpc[method];
    if ("error" in reply) {
      structuredContent[method] = { error: reply.error };
      continue;
    }
    const result = globalThis.structuredClone(reply.result) as Record<
      string,
      unknown
    >;
    if (typeof result.contentBase64 === "string") {
      content.push(fileBlock(`/${method}/result`, result.contentBase64));
      delete result.contentBase64;
    }
    const messages = (result.messages ?? []) as {
      attachments: Record<string, unknown>[];
    }[];
    messages.forEach(({ attachments }, m) =>
      attachments.forEach((attachment, a) => {
        if (typeof attachment.contentBytes !== "string") return;
        content.push(
          fileBlock(
            `/${method}/result/messages/${m}/attachments/${a}`,
            attachment.contentBytes,
          ),
        );
        delete attachment.contentBytes;
      }),
    );
    structuredContent[method] = { result };
  }
  return { result: { content, structuredContent } };
}

function options() {
  return {
    approveFiles: vi.fn<SidecarChatToolOptions["approveFiles"]>(
      async (files) => new Set(files),
    ),
    uploadAttachment: vi.fn<SidecarAttachmentUpload>(async (file) => ({
      id: `uploaded-${file.name}`,
    })),
    uploadsEnabled: true,
    maxUploadBytes: 1000,
    maxFiles: 10,
  };
}

type ReviewOutcome = "approved" | "declined" | "cancelled" | "expired";

/**
 * A sidecar answering the direct RPCs from `rpc`, and each job call with
 * `call`, by default what a sidecar composes from `rpc`; with `discovery`,
 * the tools run as jobs. Under strict mode a job whose tool selects items
 * waits for its review, which ends as `review`.
 */
function sidecar(
  rpc: Record<string, SidecarReply>,
  discovery: Partial<SidecarSnapshot> = {},
  call: (tool: string) => JobCallResult = (tool) => composedCall(tool, rpc),
  review: ReviewOutcome | (() => ReviewOutcome) = "approved",
) {
  const reviewNow = () => (typeof review === "function" ? review() : review);
  // A job remembered from an earlier run has no start here to name its calls.
  let calls = [{ name: SEARCH_SIDECAR_INDEX_TOOL }] as JobToolCall[];
  const results = () => calls.map(({ name }) => call(name));
  const fake = fakeSidecarClient((method, params) => {
    if (method === "jobs.start.v1") {
      calls = params.calls as JobToolCall[];
      return discovery.strict && calls.some(({ name }) => selects(name))
        ? { result: { handle: JOB_HANDLE, state: "ready_for_review" } }
        : completedJob(results());
    }
    if (method === "jobs.review.v1")
      return { result: { handle: JOB_HANDLE, state: "ready_for_review" } };
    if (method === "jobs.status.v1")
      return {
        result: {
          handle: JOB_HANDLE,
          state: reviewNow(),
          ...(reviewNow() === "approved" ? { results: results() } : {}),
        },
      };
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
  call?: (tool: string) => JobCallResult,
) => sidecar(rpc, fixtureDiscovery(NORMAL_MODE), call);

/** What the upload callbacks received, with each file by name, type and text. */
async function uploadsOf(path: ReturnType<typeof sidecar>) {
  const described = async (file: File) => ({
    name: file.name,
    type: file.type,
    text: await new Promise<unknown>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(file);
    }),
  });
  const calls = (all: unknown[][]) =>
    Promise.all(
      all.map(async ([first, ...rest]) => [
        Array.isArray(first)
          ? await Promise.all((first as File[]).map(described))
          : await described(first as File),
        ...rest.map((value) =>
          value instanceof Map
            ? [...(value as Map<File, unknown>).values()]
            : value,
        ),
      ]),
    );
  return {
    approved: await calls(path.options.approveFiles.mock.calls),
    uploaded: await calls(path.options.uploadAttachment.mock.calls),
  };
}

/**
 * The tool's outcome on a sidecar without jobs, and on one that runs it as a
 * job whose result `call` makes, by default what a sidecar composes from the
 * same RPC answers.
 */
async function bothPaths(
  tool: string,
  input: unknown,
  rpc: Record<string, SidecarReply>,
  call?: (tool: string) => JobCallResult,
  callContext: ClientToolCallContext = context,
  discovery: Partial<SidecarSnapshot> = fixtureDiscovery(NORMAL_MODE),
) {
  const direct = sidecar(rpc);
  const legacy = await direct.tool(tool).execute(input, callContext);
  const job = sidecar(rpc, discovery, call);
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
  it.each(TOOLS)(
    "%s shapes the job's composed results as the direct read shapes its RPCs",
    async (tool) => {
      const { legacy, viaJob, direct, job } = await bothPaths(
        tool,
        INPUTS[tool],
        RPC,
      );
      expect(legacy.ok).toBe(true);
      expect(JSON.stringify(viaJob)).toBe(JSON.stringify(legacy));
      expect(await uploadsOf(job)).toEqual(await uploadsOf(direct));
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

  it.each([READ_SIDECAR_CONVERSATION_TOOL, GET_SIDECAR_DOCUMENT_TOOL])(
    "%s uploads the same file with the same provenance on both paths",
    async (tool) => {
      const { legacy, viaJob, direct, job } = await bothPaths(
        tool,
        INPUTS[tool],
        RPC,
      );
      expect(legacy).toMatchObject({
        ok: true,
        fileUploadIds: [expect.stringMatching(/^uploaded-/)],
      });
      expect(viaJob).toEqual(legacy);
      const uploads = await uploadsOf(job);
      expect(uploads).toEqual(await uploadsOf(direct));
      expect(uploads.uploaded).toEqual([
        [
          expect.objectContaining({
            text:
              tool === GET_SIDECAR_DOCUMENT_TOOL
                ? "Mock document"
                : "mock attachment bytes",
          }),
          context.chatId,
          undefined,
          tool === GET_SIDECAR_DOCUMENT_TOOL
            ? EXTERNAL_IDS[1].value
            : undefined,
          expect.objectContaining({ version: 1 }),
        ],
      ]);
    },
  );

  it("shapes the protocol example's results as the direct reads shape the same answers", async () => {
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
    // The direct RPCs answer what the example's calls composed.
    const rpc: Record<string, SidecarReply> = {};
    for (const outcome of results) {
      Object.assign(
        rpc,
        (outcome as Extract<JobCallResult, { result: unknown }>).result
          .structuredContent,
      );
    }
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
        result: expect.objectContaining({
          mailboxes: [
            expect.objectContaining({
              id: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
              sources: [
                expect.objectContaining({
                  sourceId: "3f2a9c4e-6b1d-4e8f-9a0b-1c2d3e4f5a6b",
                }),
              ],
            }),
          ],
          freshness: expect.objectContaining({ changes: "unknown" }),
        }),
      },
      { ok: false, error: "Unknown Outlook mailbox." },
    ]);
  });

  it("matches a folder the sidecar cannot read", async () => {
    const { legacy, viaJob } = await bothPaths(
      GET_SIDECAR_FOLDER_HIERARCHY_TOOL,
      INPUTS[GET_SIDECAR_FOLDER_HIERARCHY_TOOL],
      {
        ...RPC,
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
      result: {
        foldersAvailable: false,
        notice: expect.stringContaining("Mock Outlook mailbox"),
      },
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

  it.each([
    [
      "fails",
      { error: { code: -32603, message: "Internal error." } },
      "Catalog source discovery failed.",
    ],
    [
      "is not offered",
      undefined,
      "This sidecar does not support catalog source discovery.",
    ],
  ] as const)(
    "matches mailboxes whose catalog source listing %s",
    async (_case, sources, notice) => {
      const rpc = { ...RPC };
      if (sources) rpc["sources.list.v1"] = sources;
      else delete rpc["sources.list.v1"];
      const direct = sidecar(rpc);
      if (!sources)
        direct.supports.mockImplementation(
          (method) => method !== "sources.list.v1",
        );
      const legacy = await direct
        .tool(LIST_SIDECAR_MAILBOXES_TOOL)
        .execute({}, context);
      const viaJob = await jobSidecar(rpc)
        .tool(LIST_SIDECAR_MAILBOXES_TOOL)
        .execute({}, context);
      expect(legacy).toMatchObject({
        ok: true,
        result: { warnings: [{ message: expect.stringContaining(notice) }] },
      });
      expect(JSON.stringify(viaJob)).toBe(JSON.stringify(legacy));
    },
  );

  it.each(
    TOOLS.flatMap((tool): [string, string, CallError][] => [
      ["an oversized result", tool, oversized],
      ["arguments the tool does not accept", tool, invalidArguments],
    ]),
  )(
    "returns %s to %s as the direct read does, as a method's or the call's error",
    async (_case, tool, error) => {
      for (const callContext of [context, grantContext]) {
        const rpc = { ...RPC, [methodOf(tool)]: { error } };
        for (const call of [undefined, () => ({ error })]) {
          const { legacy, viaJob } = await bothPaths(
            tool,
            INPUTS[tool],
            rpc,
            call,
            callContext,
          );
          expect(legacy.ok).toBe(false);
          expect(viaJob).toEqual(legacy);
        }
      }
    },
  );

  it("returns an unknown conversation anchor as the direct read does", async () => {
    const { legacy, viaJob } = await bothPaths(
      READ_SIDECAR_CONVERSATION_TOOL,
      INPUTS[READ_SIDECAR_CONVERSATION_TOOL],
      {
        "outlook.get_conversation.v1": {
          error: {
            code: -32602,
            message: "Unknown document.",
            data: { sourceError: "document_not_found" },
          },
        },
      },
    );
    expect(legacy).toEqual({
      ok: false,
      error: expect.stringContaining("Use get_sidecar_document"),
    });
    expect(viaJob).toEqual(legacy);
  });

  it("reports a job that composed no result for the tool's method", async () => {
    const job = jobSidecar(RPC, () => ({
      result: { content: [], structuredContent: {} },
    }));
    for (const tool of TOOLS) {
      await expect(
        job.tool(tool).execute(INPUTS[tool], { ...context, toolCallId: tool }),
      ).resolves.toEqual({
        ok: false,
        error: "The desktop sidecar returned no result for this call.",
      });
    }
  });

  it("rejects a malformed composed result as the direct read rejects a malformed response", async () => {
    for (const [tool, malformed] of [
      [SEARCH_SIDECAR_INDEX_TOOL, { hits: "none" }],
      [LIST_SIDECAR_MAILBOXES_TOOL, { mailboxes: [{ id: 42 }] }],
      [
        GET_SIDECAR_DOCUMENT_TOOL,
        { filename: "mock.eml", mimeType: "message/rfc822" },
      ],
    ] as const) {
      const method = methodOf(tool);
      const { legacy, viaJob, job } = await bothPaths(tool, INPUTS[tool], {
        ...RPC,
        [method]: { result: malformed },
      });
      expect(legacy).toEqual({
        ok: false,
        error: expect.stringContaining(
          `Result for ${method} does not match the pinned contract.`,
        ),
      });
      expect(viaJob).toEqual(legacy);
      expect(job.options.uploadAttachment).not.toHaveBeenCalled();
    }
  });

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
      [GET_SIDECAR_DOCUMENT_TOOL, "document"],
      [GET_SIDECAR_DOCUMENT_TOOL, {}],
    ] as const) {
      const { legacy, viaJob, direct, job } = await bothPaths(tool, input, RPC);
      expect(legacy.ok).toBe(false);
      expect(viaJob).toEqual(legacy);
      expect(direct.methods()).toEqual([]);
      expect(job.methods()).toEqual([]);
    }
  });

  it("refuses a document export before it starts a job when the chat takes no upload", async () => {
    for (const [callContext, uploadsEnabled] of [
      [{ ...context, chatId: null }, true],
      [context, false],
    ] as const) {
      const paths = [sidecar(RPC), jobSidecar(RPC)];
      for (const path of paths) path.options.uploadsEnabled = uploadsEnabled;
      const [legacy, viaJob] = await Promise.all(
        paths.map((path) =>
          path
            .tool(GET_SIDECAR_DOCUMENT_TOOL)
            .execute(INPUTS[GET_SIDECAR_DOCUMENT_TOOL], callContext),
        ),
      );
      expect(legacy).toEqual({
        ok: false,
        error: "Document uploads are unavailable for this chat.",
      });
      expect(viaJob).toEqual(legacy);
      for (const path of paths) expect(path.methods()).toEqual([]);
    }
  });

  it.each([
    [
      "a search limit above 100",
      SEARCH_SIDECAR_INDEX_TOOL,
      { text: "report", limit: 500 },
      "/limit must be <= 100",
    ],
    [
      "a date filter that is not a timestamp",
      SEARCH_SIDECAR_INDEX_TOOL,
      { text: "report", filters: { dateFrom: "2026-01-01" } },
      "/filters/dateFrom must be integer",
    ],
    [
      "a source ID that is not a UUID",
      GET_SIDECAR_FOLDER_HIERARCHY_TOOL,
      { sourceId: "not-a-uuid" },
      '/sourceId must match format "uuid"',
    ],
    [
      "an anchor longer than the contract allows",
      READ_SIDECAR_CONVERSATION_TOOL,
      {
        ...INPUTS[READ_SIDECAR_CONVERSATION_TOOL],
        internetMessageId: "x".repeat(32_769),
      },
      "/anchor/internetMessageId must NOT have more than 32768 characters",
    ],
    [
      "a document ID that is not a UUID",
      GET_SIDECAR_DOCUMENT_TOOL,
      { documentId: "not-a-uuid" },
      '/documentId must match format "uuid"',
    ],
  ])(
    "rejects %s against the pinned contract before it starts a job",
    async (_case, tool, input, detail) => {
      for (const callContext of [context, grantContext]) {
        const { legacy, viaJob, direct, job } = await bothPaths(
          tool,
          input,
          RPC,
          undefined,
          callContext,
        );
        expect(legacy).toEqual({
          ok: false,
          error: `Parameters for ${methodOf(tool)} do not match the pinned contract. ${detail}`,
        });
        expect(viaJob).toEqual(legacy);
        expect(direct.methods()).toEqual([]);
        expect(job.methods()).toEqual([]);
      }
    },
  );

  it.each([
    [[SEARCH_SIDECAR_INDEX_TOOL, READ_SIDECAR_CONVERSATION_TOOL]],
    [[SEARCH_SIDECAR_INDEX_TOOL]],
    [[READ_SIDECAR_CONVERSATION_TOOL]],
  ])("keeps what jobs of %s tell a later document export", async (reads) => {
    const run = async (path: ReturnType<typeof sidecar>) => {
      for (const tool of reads)
        await path
          .tool(tool)
          .execute(INPUTS[tool], { ...context, toolCallId: tool });
      const outcome = await path
        .tool(GET_SIDECAR_DOCUMENT_TOOL)
        .execute(INPUTS[GET_SIDECAR_DOCUMENT_TOOL], context);
      return { outcome, uploads: await uploadsOf(path) };
    };
    const legacy = await run(sidecar(RPC));
    const viaJob = await run(jobSidecar(RPC));
    expect(legacy.outcome).toMatchObject({
      ok: true,
      result: { freshness: { scope: expect.any(Object) } },
    });
    expect(JSON.stringify(viaJob.outcome)).toBe(JSON.stringify(legacy.outcome));
    // The document's upload carries the mailbox the reads saw.
    expect(legacy.uploads.uploaded.at(-1)?.[4]).toMatchObject({
      origins: [{ document: { mailbox: { mailboxId: MAILBOX.id } } }],
    });
    expect(viaJob.uploads).toEqual(legacy.uploads);
  });

  it("offers every tool as a job while its direct RPC is not enabled", async () => {
    const job = jobSidecar(RPC);
    job.supports.mockImplementation((method) => method.startsWith("jobs."));
    for (const tool of TOOLS) {
      expect(job.tool(tool).isAvailable()).toBe(true);
      await expect(
        job.tool(tool).execute(INPUTS[tool], { ...context, toolCallId: tool }),
      ).resolves.toMatchObject({ ok: true });
    }
    expect(
      job.methods().filter((method) => !method.startsWith("jobs.")),
    ).toEqual([]);
    // Settings lists the tools the chat offers.
    for (const { name, method } of SIDECAR_CHAT_TOOL_METHODS) {
      expect(sidecarToolAvailable(job.client, { name, method })).toBe(
        job.tool(name).isAvailable(),
      );
    }
  });
});

describe("desktop sidecar tools in strict mode", () => {
  const strict = fixtureDiscovery(STRICT_MODE);
  beforeEach(() => {
    localStorage.clear();
    useSidecarReviewLinks.setState({ links: {} });
    // The poll after the review opens waits out the poll interval.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
  });
  const settled = async <T>(pending: Promise<T>): Promise<T> => {
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
    return pending;
  };

  it.each(TOOLS)(
    "%s runs as a job, reviewed when it selects items, and shapes the approved results as the direct read does",
    async (tool) => {
      const { legacy, viaJob, direct, job } = await settled(
        bothPaths(tool, INPUTS[tool], RPC, undefined, context, strict),
      );
      expect(legacy).toMatchObject({ ok: true });
      expect(JSON.stringify(viaJob)).toBe(JSON.stringify(legacy));
      const directUploads = await uploadsOf(direct);
      expect(await uploadsOf(job)).toEqual({
        uploaded: directUploads.uploaded,
        // The same files, marked as already approved in the native review.
        approved: directUploads.approved.map((call) => [
          ...call.slice(0, -1),
          true,
        ]),
      });
      await vi.waitFor(() =>
        expect(job.methods()).toEqual(
          selects(tool)
            ? [
                "jobs.start.v1",
                "jobs.review.v1",
                "jobs.status.v1",
                "jobs.ack.v1",
              ]
            : ["jobs.start.v1", "jobs.ack.v1"],
        ),
      );
    },
  );

  describe("the web file approval after Share", () => {
    const BLOCKED =
      'The user approved this file in the Erato desktop app, but their file upload setting is "Never allow", so it was not uploaded. Tell the user why, and do not retry unless they change that setting.';
    const FILE_TOOLS = [
      READ_SIDECAR_CONVERSATION_TOOL,
      GET_SIDECAR_DOCUMENT_TOOL,
    ];
    const withPolicy = (
      policy: "ask" | "always_allow" | "never_allow",
      discovery: Partial<SidecarSnapshot> = strict,
    ) => {
      vi.mocked(fetchProfile).mockResolvedValue({
        client_tool_file_approval: policy,
      } as UserProfile);
      const path = sidecar(RPC, discovery);
      const { result } = renderHook(() => useClientToolFileApproval());
      path.options.approveFiles.mockImplementation(result.current.approveFiles);
      return path;
    };
    const fileStore = () => useClientToolFileApprovalStore.getState();
    afterEach(() => {
      useClientToolFileApprovalStore.setState({
        requests: [],
        blockedAfterReview: [],
      });
    });

    describe.each(FILE_TOOLS)("%s", (tool) => {
      it.each(["ask", "always_allow"] as const)(
        "with %s, reaches the turn with no card",
        async (policy) => {
          const job = withPolicy(policy);
          const outcome = await settled(
            job.tool(tool).execute(INPUTS[tool], context),
          );
          expect(outcome.ok).toBe(true);
          expect(fileStore().requests).toEqual([]);
          expect(fileStore().blockedAfterReview).toEqual([]);
          expect(job.options.uploadAttachment).toHaveBeenCalledTimes(1);
        },
      );

      it("still asks about a normal-mode job's files", async () => {
        const job = withPolicy("ask", fixtureDiscovery(NORMAL_MODE));
        const outcome = job.tool(tool).execute(INPUTS[tool], context);
        await vi.waitFor(() => expect(fileStore().requests).toHaveLength(1));
        const [request] = fileStore().requests;
        request.finish(new Set(request.files));
        expect((await outcome).ok).toBe(true);
        expect(job.options.uploadAttachment).toHaveBeenCalledTimes(1);
      });

      it("adds no notice when never allow blocks a normal-mode job's files", async () => {
        const job = withPolicy("never_allow", fixtureDiscovery(NORMAL_MODE));
        await job.tool(tool).execute(INPUTS[tool], context);
        expect(fileStore().blockedAfterReview).toEqual([]);
        expect(job.options.uploadAttachment).not.toHaveBeenCalled();
      });
    });

    it("with never allow, keeps a document blocked and says why", async () => {
      for (const callContext of [context, grantContext]) {
        const job = withPolicy("never_allow");
        const outcome = await settled(
          job
            .tool(GET_SIDECAR_DOCUMENT_TOOL)
            .execute(INPUTS[GET_SIDECAR_DOCUMENT_TOOL], callContext),
        );
        // Not a decline, even for a task's call: the person shared the file.
        expect(outcome).toEqual({ ok: false, error: BLOCKED });
        expect(job.options.uploadAttachment).not.toHaveBeenCalled();
        expect(fileStore().requests).toEqual([]);
      }
      expect(fileStore().blockedAfterReview).toEqual([
        {
          toolCallId: "call",
          messageId: "owner-message",
          fileNames: ["mock.eml"],
        },
      ]);
    });

    it("with never allow, gives a task's durable call the reason, not a decline", async () => {
      const job = withPolicy("never_allow");
      const outcome = await settled(
        job
          .tool(GET_SIDECAR_DOCUMENT_TOOL)
          .execute(INPUTS[GET_SIDECAR_DOCUMENT_TOOL], grantContext),
      );
      const binding: ExecutorBinding = {
        device_id: "installation-one",
        realm: "desktop-sidecar",
        host_context: { kind: "desktop_sidecar", identity: "local" },
      };
      const request: OperationRequest = {
        attempt_id: "00000000-0000-4000-8000-0000000000a1",
        operation_id: "desktop/get_sidecar_document",
        kind: "client_tool.v1",
        account_id: "00000000-0000-4000-8000-000000000001",
        chat_id: "00000000-0000-4000-8000-0000000000c2",
        message_id: "00000000-0000-4000-8000-0000000000e2",
        tool_call_id: "task-call",
        realm: "desktop-sidecar",
        consent: "none",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        input: INPUTS[GET_SIDECAR_DOCUMENT_TOOL] as OperationPayload,
        binding,
        lineage: {
          owner_chat_id: "00000000-0000-4000-8000-0000000000c1",
          owner_message_id: "00000000-0000-4000-8000-0000000000e1",
          requesting_chat_id: "00000000-0000-4000-8000-0000000000c2",
          requesting_message_id: "00000000-0000-4000-8000-0000000000e2",
        },
      };
      // A declined code would make the server replace the reason with its own.
      expect(toOperationResult(request, outcome)).toEqual({
        attempt_id: request.attempt_id,
        operation_id: request.operation_id,
        executor: binding,
        outcome: "failed",
        error: { code: "execution_failed", message: BLOCKED },
      });
    });

    it("with never allow, keeps a conversation's text, blocks its attachments and says why", async () => {
      const job = withPolicy("never_allow");
      const outcome = await settled(
        job
          .tool(READ_SIDECAR_CONVERSATION_TOOL)
          .execute(INPUTS[READ_SIDECAR_CONVERSATION_TOOL], context),
      );
      expect(outcome).toMatchObject({
        ok: true,
        result: {
          state: "partial",
          messages: [{ attachments: [{ status: "rejected", error: BLOCKED }] }],
        },
      });
      expect(job.options.uploadAttachment).not.toHaveBeenCalled();
      expect(fileStore().blockedAfterReview).toHaveLength(1);
      expect(fileStore().blockedAfterReview[0].messageId).toBe("message");
    });
  });

  it.each([
    [
      "declined",
      "The user declined sharing this result in the Erato desktop app. Do not retry without their permission.",
    ],
    [
      "cancelled",
      "The review of this result was cancelled in the Erato desktop app, so nothing was shared. Do not retry without the user's permission.",
    ],
    [
      "expired",
      "The review of this result in the Erato desktop app ended without a decision, so nothing was shared. Do not retry without the user's permission.",
    ],
  ] as const)(
    "reports a review that ended as %s as an error a retry cannot fix",
    async (state, error) => {
      for (const callContext of [context, grantContext]) {
        // Each row and context on a call of its own.
        useSidecarReviewLinks.setState({ links: {} });
        localStorage.clear();
        const job = sidecar(RPC, strict, undefined, state);
        const outcome = await settled(
          job
            .tool(READ_SIDECAR_CONVERSATION_TOOL)
            .execute(INPUTS[READ_SIDECAR_CONVERSATION_TOOL], callContext),
        );
        // A task's call reports a decline as such, as a declined upload does,
        // and a review nobody decided as expired.
        expect(outcome).toEqual(
          callContext === grantContext
            ? {
                ok: false,
                error,
                validationErrors: [
                  {
                    path: "",
                    code: state === "expired" ? "review_expired" : "declined",
                    message: error,
                  },
                ],
              }
            : state === "expired"
              ? // Stays open for the user to ask again.
                { ok: false, error, stillWaiting: true }
              : { ok: false, error },
        );
        expect(job.options.approveFiles).not.toHaveBeenCalled();
        expect(job.options.uploadAttachment).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ["reports no job envelope", { strict: true }],
    ["offers no sidecar provider", { ...strict, providers: [] }],
  ] as const)(
    "offers no tool while the strict sidecar %s, even with its direct RPCs enabled",
    async (_case, discovery) => {
      const path = sidecar(RPC, discovery);
      for (const tool of TOOLS) {
        expect(path.tool(tool).isAvailable()).toBe(false);
        expect(
          sidecarToolAvailable(path.client, {
            name: tool,
            method: methodOf(tool),
          }),
        ).toBe(false);
        expect(
          await path.tool(tool).execute(INPUTS[tool], {
            ...context,
            toolCallId: tool,
          }),
        ).toEqual({
          ok: false,
          error:
            "This desktop sidecar capability is unavailable on this device.",
        });
        expect(
          await path.tool(tool).execute(INPUTS[tool], {
            ...grantContext,
            toolCallId: `${tool}-task`,
          }),
        ).toMatchObject({
          ok: false,
          validationErrors: [{ code: "context_unavailable" }],
        });
      }
      expect(path.requests).toEqual([]);
    },
  );

  it("hands the turn off once a reviewed tool's review opens, and keeps every other call inline", async () => {
    for (const discovery of [strict, fixtureDiscovery(NORMAL_MODE)]) {
      for (const tool of TOOLS) {
        const path = sidecar(RPC, discovery);
        const park = vi.fn();
        const outcome = await settled(
          path
            .tool(tool)
            .execute(INPUTS[tool], { ...context, toolCallId: tool, park }),
        );
        // The executor still answers the call once the user decided.
        expect(outcome).toMatchObject({ ok: true });
        expect(park).toHaveBeenCalledTimes(
          discovery === strict && selects(tool) ? 1 : 0,
        );
      }
    }
  });

  /** A review's parked operation, on the server the coordinator talks to. */
  function parkedReviewOperation() {
    const binding: ExecutorBinding = {
      device_id: "installation-one",
      realm: "desktop-sidecar",
      host_context: { kind: "desktop_sidecar", identity: "local" },
    };
    const request: OperationRequest = {
      attempt_id: "00000000-0000-4000-8000-0000000000a1",
      operation_id: "desktop/search_sidecar_index",
      kind: "client_tool.v1",
      account_id: "00000000-0000-4000-8000-000000000001",
      chat_id: "00000000-0000-4000-8000-0000000000c1",
      message_id: "00000000-0000-4000-8000-0000000000e1",
      tool_call_id: "parked-call",
      realm: "desktop-sidecar",
      consent: "none",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      input: INPUTS[SEARCH_SIDECAR_INDEX_TOOL] as OperationPayload,
      binding,
    };
    let state: AttemptState = "pending";
    const api = {
      list: vi.fn<ClientOperationApi["list"]>(async () => ({
        enabled: true,
        executor_stream_enabled: false,
        account_id: request.account_id,
        operations: state === "completed" ? [] : [{ request, state }],
      })),
      claim: vi.fn<ClientOperationApi["claim"]>(async () => {
        state = "claimed";
        return {
          claim_token: "claim",
          expires_at: new Date(Date.now() + 120_000).toISOString(),
        };
      }),
      complete: vi.fn<ClientOperationApi["complete"]>(async () => {
        state = "ready";
        return { state };
      }),
      continue: vi.fn<ClientOperationApi["continue"]>(async () => {
        state = "completed";
      }),
    } satisfies ClientOperationApi;
    return { binding, request, api };
  }

  const reviewApproved = (shaped: ClientToolExecutionResult) => ({
    outcome: "succeeded",
    result: {
      type: "value",
      value: (shaped as { result: unknown }).result,
    },
  });
  const reviewDeclined = () => ({
    outcome: "failed",
    error: {
      code: "execution_failed",
      message:
        "The user declined sharing this result in the Erato desktop app. Do not retry without their permission.",
    },
  });
  it.each([
    ["approved", false, reviewApproved],
    ["declined", false, reviewDeclined],
    ["approved", true, reviewApproved],
    ["declined", true, reviewDeclined],
  ] as const)(
    "resumes a parked review's call through the durable coordinator once the review is %s (decided with no page open: %s)",
    async (review, decidedWhileAway, expected) => {
      const shaped = await settled(
        sidecar(RPC, strict)
          .tool(SEARCH_SIDECAR_INDEX_TOOL)
          .execute(INPUTS[SEARCH_SIDECAR_INDEX_TOOL], context),
      );
      // The same read, so the same `readAt`.
      vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
      const path = sidecar(RPC, strict, undefined, review);
      const tool = path.tool(SEARCH_SIDECAR_INDEX_TOOL);
      const { binding, request, api } = parkedReviewOperation();
      if (decidedWhileAway)
        rememberReview(
          reviewLinkKey(request.message_id, request.tool_call_id),
          JOB_HANDLE,
        );
      const registry = createClientOperationHandlerRegistry();
      // After a reload: no live call runs here, so the coordinator claims it.
      registry.register(
        new ClientToolOperationHandler(
          tool.name,
          tool.execute,
          () => binding,
          tool.isAvailable,
          () => false,
        ),
      );
      const coordinator = new ClientOperationCoordinator(
        request.account_id,
        api,
        [],
        vi.fn(),
        registry,
      );
      try {
        await coordinator.reconcile();
        await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
        await vi.waitFor(() => expect(api.continue).toHaveBeenCalledTimes(1));
      } finally {
        coordinator.dispose();
      }
      expect(api.complete).toHaveBeenCalledTimes(1);
      expect(api.complete.mock.calls[0][2]).toEqual({
        attempt_id: request.attempt_id,
        operation_id: request.operation_id,
        executor: binding,
        ...expected(shaped),
      });
      expect(path.methods().slice(0, decidedWhileAway ? 1 : 3)).toEqual(
        decidedWhileAway
          ? ["jobs.status.v1"]
          : ["jobs.start.v1", "jobs.review.v1", "jobs.status.v1"],
      );
      if (decidedWhileAway) {
        // No second review: the first decision is the one the turn receives.
        expect(path.methods()).not.toContain("jobs.start.v1");
        expect(path.methods()).not.toContain("jobs.review.v1");
      }
    },
  );

  it("keeps a parked call open when its review's hour ran out, and reviews it once more when the user asks again", async () => {
    let outcome: ReviewOutcome = "expired";
    const path = sidecar(RPC, strict, undefined, () => outcome);
    const tool = path.tool(SEARCH_SIDECAR_INDEX_TOOL);
    const { binding, request, api } = parkedReviewOperation();
    const key = reviewLinkKey(request.message_id, request.tool_call_id);
    rememberReview(key, JOB_HANDLE);
    const registry = createClientOperationHandlerRegistry();
    registry.register(
      new ClientToolOperationHandler(
        tool.name,
        tool.execute,
        () => binding,
        tool.isAvailable,
        () => false,
        ({ message_id, tool_call_id }) =>
          reviewHasEnded(message_id, tool_call_id),
      ),
    );
    const coordinator = new ClientOperationCoordinator(
      request.account_id,
      api,
      [],
      vi.fn(),
      registry,
    );
    try {
      await coordinator.reconcile();
      await vi.waitFor(() => expect(reviewLink(key)?.state).toBe("ended"));
      expect(api.complete).not.toHaveBeenCalled();
      expect(path.methods()).toEqual(["jobs.status.v1"]);

      // While it waits for the user nothing claims it or asks the app.
      const claims = api.claim.mock.calls.length;
      await coordinator.reconcile();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(api.claim).toHaveBeenCalledTimes(claims);
      expect(path.methods()).toEqual(["jobs.status.v1"]);

      outcome = "approved";
      askForReviewAgain(key);
      await coordinator.reconcile();
      await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
      await vi.waitFor(() => expect(api.continue).toHaveBeenCalledTimes(1));
      expect(api.complete).toHaveBeenCalledTimes(1);
      expect(
        path.methods().filter((method) => method === "jobs.start.v1"),
      ).toHaveLength(1);
      expect(reviewLink(key)).toBeUndefined();
    } finally {
      coordinator.dispose();
    }
  });

  it.each([
    ["while the page polls it", false],
    ["after the app restarted and lost its job", true],
  ] as const)(
    "ends a task's parked call whose review ended before its result arrived (%s) as expired, not declined, and opens no other review",
    async (_case, restarted) => {
      registerClientToolExecutor(
        SEARCH_SIDECAR_INDEX_TOOL,
        vi.fn(),
        undefined,
        { acceptsGrantCalls: true },
      );
      try {
        // A restarted app knows no handle and reports it as expired.
        const path = sidecar(RPC, strict, undefined, "expired");
        const tool = path.tool(SEARCH_SIDECAR_INDEX_TOOL);
        const { binding, request } = parkedReviewOperation();
        const taskRequest: OperationRequest = {
          ...request,
          lineage: {
            owner_chat_id: "00000000-0000-4000-8000-0000000000c0",
            owner_message_id: "00000000-0000-4000-8000-0000000000e0",
            requesting_chat_id: request.chat_id,
            requesting_message_id: request.message_id,
          },
        };
        const key = reviewLinkKey(request.message_id, request.tool_call_id);
        if (restarted) rememberReview(key, JOB_HANDLE);
        const handler = new ClientToolOperationHandler(
          tool.name,
          tool.execute,
          () => binding,
          tool.isAvailable,
          () => false,
        );
        const result = await settled(
          handler.execute(taskRequest, undefined, new AbortController().signal),
        );
        expect(result).toEqual({
          attempt_id: request.attempt_id,
          operation_id: request.operation_id,
          executor: binding,
          outcome: "rejected",
          error: { code: "review_expired" },
        });
        expect(path.methods()).toEqual(
          restarted
            ? ["jobs.status.v1"]
            : ["jobs.start.v1", "jobs.review.v1", "jobs.status.v1"],
        );
        // The call is over: nothing is left for the chat to open again.
        expect(reviewLink(key)).toBeUndefined();
      } finally {
        resetClientToolRegistryForTests();
      }
    },
  );

  it("offers a reviewed tool only while the strict sidecar enables jobs.review.v1", async () => {
    const path = sidecar(RPC, strict);
    path.supports.mockImplementation((method) => method !== "jobs.review.v1");
    for (const tool of TOOLS) {
      // An account-level tool runs without review, so it needs no opener.
      const offered = !selects(tool);
      expect(path.tool(tool).isAvailable()).toBe(offered);
      expect(
        sidecarToolAvailable(path.client, {
          name: tool,
          method: methodOf(tool),
        }),
      ).toBe(offered);
      const outcome = await path
        .tool(tool)
        .execute(INPUTS[tool], { ...context, toolCallId: tool });
      if (offered) {
        expect(outcome).toMatchObject({ ok: true });
        continue;
      }
      // Unavailable now, not a job that waits for a review nobody can open.
      expect(outcome).toEqual({
        ok: false,
        error: "This desktop sidecar capability is unavailable on this device.",
      });
      expect(
        await path.tool(tool).execute(INPUTS[tool], {
          ...grantContext,
          toolCallId: `${tool}-task`,
        }),
      ).toMatchObject({
        ok: false,
        validationErrors: [{ code: "context_unavailable" }],
      });
    }
    expect(
      path.requests
        .filter(({ method }) => method === "jobs.start.v1")
        .map(({ params }) => (params.calls as JobToolCall[])[0].name),
    ).toEqual(TOOLS.filter((tool) => !selects(tool)));
    expect(path.methods()).not.toContain("jobs.review.v1");
    expect(
      path.methods().filter((method) => !method.startsWith("jobs.")),
    ).toEqual([]);
  });
});
