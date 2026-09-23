import { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";
import { describe, expect, it, vi } from "vitest";

import {
  createSidecarChatTools,
  GET_SIDECAR_SEARCH_FIELDS_TOOL,
  GET_SIDECAR_DOCUMENT_TOOL,
} from "./chatTools";
import { resolveSidecarMailboxId } from "./mailboxAccess";

import type { OutlookGetConversationV1Result } from "@erato/desktop-sidecar-protocol";

const mailboxId = "a".repeat(32);
const context = { toolCallId: "call", messageId: "message", chatId: "chat" };
const anchor = { mailboxId, internetMessageId: "<email@example.test>" };
const externalIdCases = [
  { external_ids: undefined, expected: undefined },
  { external_ids: [], expected: undefined },
  {
    external_ids: [{ key: "email_message_id", value: "<email@example.test>" }],
    expected: undefined,
  },
  {
    external_ids: [
      { key: "email_message_id", value: "<email@example.test>" },
      { key: "ews_id", value: "AaM+opaque/id==" },
      { key: "future_id", value: "other-id" },
    ],
    expected: "AaM+opaque/id==",
  },
];

function setup(responses: Record<string, unknown>) {
  const request = vi.fn(async (body: string) => {
    const { id, method } = JSON.parse(body) as { id: string; method: string };
    return JSON.stringify({ jsonrpc: "2.0", id, result: responses[method] });
  });
  const client = new DesktopSidecarClient({
    transport: { request },
    clientInfo: {
      name: "test",
      version: "1",
      host: { application: "test", runtime: "test" },
      os: { name: "test" },
    },
  });
  // Exercise actual pinned request AND result validators, without discovery.
  const supports = vi.spyOn(client, "supports").mockReturnValue(true);
  const uploadAttachment = vi.fn(async () => ({ id: "uploaded-file" }));
  const options = {
    approveFiles: vi.fn(async (files: File[]) => new Set(files)),
    uploadAttachment,
    uploadsEnabled: true,
    maxUploadBytes: 1000,
    maxFiles: 10,
  };
  const tools = () => createSidecarChatTools(client, options);
  return { client, request, supports, uploadAttachment, options, tools };
}

function conversation(): OutlookGetConversationV1Result {
  return {
    state: "ok",
    messages: [
      {
        internetMessageId: anchor.internetMessageId,
        body: { contentType: "text/html", content: "<p>Hello</p><p>world</p>" },
        attachments: [
          {
            name: "note.txt",
            contentType: "text/plain",
            contentBytes: globalThis.btoa("attachment text"),
            size: 15,
            sha256: "b".repeat(64),
          },
        ],
      },
    ],
  };
}

describe("shared desktop sidecar tools", () => {
  it("uploads only individually approved attachments, including duplicate hashes", async () => {
    const data = conversation();
    data.messages[0].attachments[0].external_ids = [
      { key: "ews_id", value: "approved-ews-id" },
    ];
    data.messages[0].attachments.push({
      ...data.messages[0].attachments[0],
      name: "duplicate.txt",
    });
    const env = setup({ "outlook.get_conversation.v1": data });
    env.options.approveFiles.mockImplementation(
      async (files) => new Set([files[0]]),
    );
    const result = await env
      .tools()[1]
      .execute({ ...anchor, includeAttachments: true }, context);
    expect(env.options.approveFiles).toHaveBeenCalledTimes(1);
    expect(env.options.approveFiles.mock.calls[0][0]).toHaveLength(2);
    expect(env.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(env.uploadAttachment).toHaveBeenCalledWith(
      expect.any(File),
      "chat",
      undefined,
      "approved-ews-id",
    );
    expect(result).toMatchObject({
      ok: true,
      result: {
        messages: [
          {
            attachments: [
              { status: "uploaded" },
              { status: "rejected", fileId: undefined },
            ],
          },
        ],
      },
    });
  });

  it("does not upload while approval is pending and caches rejection for replay", async () => {
    const env = setup({ "outlook.get_conversation.v1": conversation() });
    let decide!: (files: Set<File>) => void;
    env.options.approveFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          decide = resolve;
        }),
    );
    const tool = env.tools()[1];
    const result = tool.execute(
      { ...anchor, includeAttachments: true },
      context,
    );
    await vi.waitFor(() => expect(env.options.approveFiles).toHaveBeenCalled());
    expect(env.uploadAttachment).not.toHaveBeenCalled();
    decide(new Set());
    expect(await result).toMatchObject({
      ok: true,
      fileUploadIds: [],
      result: {
        messages: [{ attachments: [{ status: "rejected" }] }],
      },
    });
    await tool.execute({ ...anchor, includeAttachments: true }, context);
    expect(env.options.approveFiles).toHaveBeenCalledTimes(1);
    expect(env.uploadAttachment).not.toHaveBeenCalled();
  });

  it("returns discovered metadata descriptors through the pinned contract", async () => {
    const fields = [
      {
        field: "custom_source_field",
        operators: ["eq", "in"],
        type: "string",
        description: "A source-specific identifier.",
        applicable_kinds: ["email", "teams_message"],
      },
    ];
    const env = setup({ "search.metadata_fields.v1": { fields } });
    const tool = env
      .tools()
      .find((item) => item.name === GET_SIDECAR_SEARCH_FIELDS_TOOL)!;
    expect(await tool.execute({}, context)).toEqual({
      ok: true,
      result: { fields },
    });
    expect(JSON.parse(env.request.mock.calls[0][0])).toMatchObject({
      method: "search.metadata_fields.v1",
      params: {},
    });
    expect(env.uploadAttachment).not.toHaveBeenCalled();
  });

  it("rejects malformed metadata discovery results", async () => {
    const env = setup({
      "search.metadata_fields.v1": {
        fields: [{ field: "missing-descriptors" }],
      },
    });
    const tool = env
      .tools()
      .find((item) => item.name === GET_SIDECAR_SEARCH_FIELDS_TOOL)!;
    expect(await tool.execute({})).toMatchObject({ ok: false });
  });

  it("keeps existing tools available when metadata discovery is unsupported", async () => {
    const env = setup({});
    env.supports.mockImplementation(
      (method) => method !== "search.metadata_fields.v1",
    );
    const tools = env.tools();
    expect(tools[0].isAvailable()).toBe(true);
    expect(tools[1].isAvailable()).toBe(true);
    const discovery = tools.find(
      (item) => item.name === GET_SIDECAR_SEARCH_FIELDS_TOOL,
    )!;
    expect(discovery.isAvailable()).toBe(false);
    expect(await discovery.execute({})).toMatchObject({ ok: false });
    expect(env.request).not.toHaveBeenCalled();
  });

  it("rejects extra discovery arguments before transport", async () => {
    const env = setup({});
    const tool = env
      .tools()
      .find((item) => item.name === GET_SIDECAR_SEARCH_FIELDS_TOOL)!;
    expect(await tool.execute({ unknown: true })).toMatchObject({ ok: false });
    expect(env.request).not.toHaveBeenCalled();
  });

  it("forwards metadata predicates alongside the existing filters", async () => {
    const env = setup({
      "search.query.v1": {
        hits: [],
        elapsedMs: 0,
        blocksRead: 0,
        candidatesScored: 0,
      },
    });
    const input = {
      text: "report",
      filters: {
        kind: "email",
        sourceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        dateFrom: 100,
      },
      metadata_filters: [
        { field: "has_attachments", operator: "eq", value: true },
        {
          field: "sender",
          operator: "in",
          value: ["a@example.test", "b@example.test"],
        },
      ],
    };
    expect(await env.tools()[0].execute(input)).toMatchObject({ ok: true });
    expect(JSON.parse(env.request.mock.calls[0][0]).params).toEqual(input);
  });

  it.each(["eq", "ne", "in"])(
    "normalizes mailbox metadata IDs for %s without changing the caller's input",
    async (operator) => {
      const env = setup({
        "search.query.v1": {
          hits: [],
          elapsedMs: 0,
          blocksRead: 0,
          candidatesScored: 0,
        },
      });
      const value = operator === "in" ? [mailboxId] : mailboxId;
      const input = {
        metadata_filters: [{ field: "mailbox_id", operator, value }],
      };
      expect(await env.tools()[0].execute(input)).toMatchObject({ ok: true });
      const expected = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      expect(
        JSON.parse(env.request.mock.calls[0][0]).params.metadata_filters,
      ).toEqual([
        {
          field: "mailbox_id",
          operator,
          value: operator === "in" ? [expected] : expected,
        },
      ]);
      expect(input.metadata_filters[0].value).toEqual(value);
    },
  );

  it("rejects malformed metadata predicates before transport", async () => {
    const env = setup({});
    expect(
      await env
        .tools()[0]
        .execute({ metadata_filters: [{ field: "kind", value: "email" }] }),
    ).toMatchObject({ ok: false });
    expect(env.request).not.toHaveBeenCalled();
  });

  it("uploads an audio attachment with its filename and MIME type preserved", async () => {
    const result = conversation();
    result.messages[0].attachments = [
      {
        name: "recording.mp3",
        contentType: "audio/mpeg",
        contentBytes: globalThis.btoa("audio bytes"),
        size: 11,
      },
    ];
    const env = setup({ "outlook.get_conversation.v1": result });
    const outcome = await env
      .tools()[1]
      .execute({ ...anchor, includeAttachments: true }, context);
    expect(env.uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "recording.mp3",
        type: "audio/mpeg",
        size: 11,
      }),
      "chat",
      undefined,
      undefined,
    );
    expect(outcome).toMatchObject({
      ok: true,
      fileUploadIds: ["uploaded-file"],
    });
  });

  it.each(["email", "file", "teams_message"])(
    "searches indexed %s through the pinned contract",
    async (kind) => {
      const env = setup({
        "search.query.v1": {
          hits: [
            {
              documentId: "doc",
              chunkId: null,
              score: 1,
              kind,
              title: "Match",
              sender: null,
              mailboxId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              date: null,
              mimeType: null,
              conversationKey: null,
              external_ids:
                kind === "email"
                  ? [
                      {
                        key: "email_message_id",
                        value: anchor.internetMessageId,
                      },
                    ]
                  : [],
            },
          ],
          elapsedMs: 1,
          blocksRead: 1,
          candidatesScored: 1,
        },
      });
      const outcome = await env
        .tools()[0]
        .execute({ text: "project", filters: { kind } }, context);
      expect(outcome).toMatchObject({
        ok: true,
        result: {
          hits: [{ kind, readConversation: kind === "email" ? anchor : null }],
        },
      });
      expect(env.uploadAttachment).not.toHaveBeenCalled();
    },
  );

  it("normalizes compact Outlook IDs when filtering the index", async () => {
    const env = setup({
      "search.query.v1": {
        hits: [],
        elapsedMs: 0,
        blocksRead: 0,
        candidatesScored: 0,
      },
    });
    expect(
      await env.tools()[0].execute({ filters: { mailboxId } }),
    ).toMatchObject({ ok: true });
    const request = JSON.parse(env.request.mock.calls[0][0]) as {
      params: { filters: { mailboxId: string } };
    };
    expect(request.params.filters.mailboxId).toBe(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
  });

  it("rejects invalid search filters before transport", async () => {
    const env = setup({});
    expect(
      await env.tools()[0].execute({ filters: { kind: "unknown" } }),
    ).toMatchObject({ ok: false });
    expect(env.request).not.toHaveBeenCalled();
  });

  it("does not advertise or invoke an unavailable capability", async () => {
    const env = setup({});
    env.supports.mockReturnValue(false);
    const tool = env.tools()[0];
    expect(tool.isAvailable()).toBe(false);
    expect(await tool.execute({ text: "hello" })).toMatchObject({ ok: false });
    expect(env.request).not.toHaveBeenCalled();
  });

  it("returns readable bodies and attachment metadata without sharing binary by default", async () => {
    const env = setup({ "outlook.get_conversation.v1": conversation() });
    const outcome = await env.tools()[1].execute(anchor, context);
    expect(outcome).toMatchObject({
      ok: true,
      result: {
        state: "ok",
        messages: [
          {
            bodyText: "Hello\n\nworld",
            attachments: [{ name: "note.txt", status: "not_requested" }],
          },
        ],
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("contentBytes");
    expect(env.uploadAttachment).not.toHaveBeenCalled();
  });

  it("uploads requested attachments once per hash and supplies file references", async () => {
    const data = conversation();
    data.messages.push(data.messages[0]);
    const env = setup({ "outlook.get_conversation.v1": data });
    const outcome = await env
      .tools()[1]
      .execute({ ...anchor, includeAttachments: true }, context);
    expect(outcome).toMatchObject({
      ok: true,
      fileUploadIds: ["uploaded-file"],
      result: {
        messages: [
          { attachments: [{ status: "uploaded", fileId: "uploaded-file" }] },
          { attachments: [{ fileId: "uploaded-file" }] },
        ],
      },
    });
    expect(env.uploadAttachment).toHaveBeenCalledTimes(1);
    const [file, chatId] = env.uploadAttachment.mock.calls[0] as unknown as [
      File,
      string,
    ];
    expect([file.name, file.size, chatId]).toEqual(["note.txt", 15, "chat"]);
    expect(JSON.stringify(outcome)).not.toContain(
      globalThis.btoa("attachment text"),
    );
  });

  it.each(externalIdCases)(
    "uses only the attachment's own EWS ID (%j)",
    async ({ external_ids, expected }) => {
      const data = conversation();
      data.messages[0].external_ids = [
        { key: "ews_id", value: "message-ews-id" },
      ];
      data.messages[0].attachments[0].external_ids = external_ids;
      data.messages[0].attachments[0].topLevelParent = {
        external_ids: [{ key: "ews_id", value: "parent-ews-id" }],
      };
      const env = setup({ "outlook.get_conversation.v1": data });
      expect(
        await env
          .tools()[1]
          .execute({ ...anchor, includeAttachments: true }, context),
      ).toMatchObject({ ok: true });
      expect(env.uploadAttachment).toHaveBeenCalledWith(
        expect.any(File),
        "chat",
        undefined,
        expected,
      );
    },
  );

  it("does not merge identical attachment bytes with different EWS identities", async () => {
    const data = conversation();
    const attachment = data.messages[0].attachments[0];
    data.messages[0].attachments = [
      undefined,
      "ews-one",
      "ews-two",
      "ews-one",
    ].map((id) => ({
      ...attachment,
      external_ids: id ? [{ key: "ews_id", value: id }] : [],
    }));
    const env = setup({ "outlook.get_conversation.v1": data });
    const outcome = await env
      .tools()[1]
      .execute({ ...anchor, includeAttachments: true }, context);
    expect(outcome).toMatchObject({ ok: true });
    expect(env.uploadAttachment).toHaveBeenCalledTimes(3);
    for (const [index, id] of [undefined, "ews-one", "ews-two"].entries()) {
      expect(env.uploadAttachment).toHaveBeenNthCalledWith(
        index + 1,
        expect.any(File),
        "chat",
        undefined,
        id,
      );
    }
  });

  it("replays a completed tool call without uploading its attachments again", async () => {
    const env = setup({ "outlook.get_conversation.v1": conversation() });
    const tool = env.tools()[1];
    const first = await tool.execute(
      { ...anchor, includeAttachments: true },
      context,
    );
    expect(
      await tool.execute({ ...anchor, includeAttachments: true }, context),
    ).toEqual(first);
    expect(env.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(env.request).toHaveBeenCalledTimes(1);
  });

  it.each(["size", "count", "disabled", "failed"])(
    "discloses %s attachment failures without dropping bodies",
    async (mode) => {
      const env = setup({ "outlook.get_conversation.v1": conversation() });
      if (mode === "size") env.options.maxUploadBytes = 2;
      if (mode === "count") env.options.maxFiles = 0;
      if (mode === "disabled") env.options.uploadsEnabled = false;
      if (mode === "failed")
        env.uploadAttachment.mockRejectedValue(new Error("offline"));
      const outcome = await env
        .tools()[1]
        .execute({ ...anchor, includeAttachments: true }, context);
      expect(outcome).toMatchObject({
        ok: true,
        fileUploadIds: [],
        result: {
          state: "partial",
          messages: [{ bodyText: "Hello\n\nworld" }],
        },
      });
    },
  );

  it("marks missing bytes and body truncation explicitly", async () => {
    const data = conversation();
    data.messages[0].body = {
      contentType: "text/plain",
      content: "x".repeat(20_001),
    };
    data.messages[0].attachments = [
      { name: "missing.pdf", unavailableReason: "unsupported_attachment" },
    ];
    const env = setup({ "outlook.get_conversation.v1": data });
    expect(await env.tools()[1].execute(anchor, context)).toMatchObject({
      ok: true,
      result: {
        state: "partial",
        messages: [
          { bodyTruncated: true, attachments: [{ status: "unavailable" }] },
        ],
      },
    });
  });

  it("does no work for an aborted call", async () => {
    const env = setup({});
    const signal = AbortSignal.abort();
    expect(
      await env.tools()[1].execute(anchor, { ...context, signal }),
    ).toMatchObject({ ok: false });
    expect(env.request).not.toHaveBeenCalled();
    expect(env.uploadAttachment).not.toHaveBeenCalled();
  });

  it("does not choose a different local mailbox when the account does not match", async () => {
    const env = setup({
      "outlook.list_mailboxes.v1": {
        warnings: [],
        mailboxes: [
          {
            source: "ost",
            id: mailboxId,
            displayName: "Other",
            emailAddress: "other@example.test",
          },
        ],
      },
    });
    await expect(
      resolveSidecarMailboxId(env.client, "user@example.test"),
    ).resolves.toBeNull();
    await expect(
      resolveSidecarMailboxId(env.client, " OTHER@example.test "),
    ).resolves.toBe(mailboxId);
  });
});

describe("sidecar document retrieval", () => {
  const documentId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const input = { documentId };
  const document = {
    filename: "message.eml",
    mimeType: "message/rfc822",
    contentBase64: globalThis.btoa("document bytes"),
  };
  const setupDocument = () => {
    const env = setup({ "sources.get_document.v1": { ...document } });
    return {
      ...env,
      tool: () =>
        env.tools().find((item) => item.name === GET_SIDECAR_DOCUMENT_TOOL)!,
    };
  };

  it.each(["reject", "abort", "failure"])(
    "never uploads a document after approval %s",
    async (mode) => {
      const env = setupDocument();
      const controller = new AbortController();
      env.options.approveFiles.mockImplementation(async (files) => {
        if (mode === "failure") throw new Error("Preference unavailable");
        if (mode === "abort") {
          controller.abort();
          return new Set(files);
        }
        return new Set();
      });
      const result = await env
        .tool()
        .execute(input, { ...context, signal: controller.signal });
      expect(result.ok).toBe(false);
      expect(env.uploadAttachment).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(document.contentBase64);
    },
  );

  it.each([undefined, "subject", "subject_with_thread"])(
    "uploads scope %s and replays without duplicate uploads",
    async (subject_scope) => {
      const env = setupDocument();
      const tool = env.tool();
      const args = { ...input, ...(subject_scope ? { subject_scope } : {}) };
      const signal = new AbortController().signal;
      const outcome = await tool.execute(args, { ...context, signal });
      expect(outcome).toMatchObject({
        ok: true,
        fileUploadIds: ["uploaded-file"],
        result: {
          filename: document.filename,
          mimeType: document.mimeType,
          documentId,
          subject_scope: subject_scope ?? "subject",
          fileId: "uploaded-file",
        },
      });
      expect(env.uploadAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          name: document.filename,
          type: document.mimeType,
          size: 14,
        }),
        "chat",
        signal,
        undefined,
      );
      expect(JSON.parse(env.request.mock.calls[0][0]).params).toEqual(args);
      expect(JSON.stringify(outcome)).not.toContain(document.contentBase64);
      expect(JSON.stringify(outcome)).not.toContain("contentBase64");
      expect(await tool.execute(args, context)).toEqual(outcome);
      expect(env.uploadAttachment).toHaveBeenCalledTimes(1);
      expect(env.request).toHaveBeenCalledTimes(1);
    },
  );

  it.each(externalIdCases)(
    "uploads the requested document's own EWS ID for both export scopes (%j)",
    async ({ external_ids, expected }) => {
      for (const subject_scope of ["subject", "subject_with_thread"]) {
        const env = setup({
          "sources.get_document.v1": {
            ...document,
            external_ids,
            topLevelParent: {
              external_ids: [{ key: "ews_id", value: "parent-ews-id" }],
            },
          },
        });
        const tool = env
          .tools()
          .find((item) => item.name === GET_SIDECAR_DOCUMENT_TOOL)!;
        expect(
          await tool.execute({ ...input, subject_scope }, context),
        ).toMatchObject({ ok: true });
        expect(env.uploadAttachment).toHaveBeenCalledWith(
          expect.any(File),
          "chat",
          undefined,
          expected,
        );
      }
    },
  );

  it.each([
    {},
    { documentId: "bad" },
    { ...input, subject_scope: "all" },
    { ...input, path: "/tmp/file" },
  ])("rejects invalid input %j before transport", async (args) => {
    const env = setupDocument();
    expect(await env.tool().execute(args, context)).toMatchObject({
      ok: false,
    });
    expect(env.request).not.toHaveBeenCalled();
    expect(env.uploadAttachment).not.toHaveBeenCalled();
  });

  it.each(["disabled", "count", "no-chat", "unsupported", "aborted"])(
    "does no retrieval when %s",
    async (mode) => {
      const env = setupDocument();
      if (mode === "disabled") env.options.uploadsEnabled = false;
      if (mode === "count") env.options.maxFiles = 0;
      if (mode === "unsupported")
        env.supports.mockImplementation(
          (method) => method !== "sources.get_document.v1",
        );
      const tool = env.tool();
      if (mode === "unsupported") expect(tool.isAvailable()).toBe(false);
      expect(
        await tool.execute(input, {
          ...context,
          chatId: mode === "no-chat" ? null : "chat",
          signal: mode === "aborted" ? AbortSignal.abort() : undefined,
        }),
      ).toMatchObject({ ok: false });
      expect(env.request).not.toHaveBeenCalled();
      expect(env.uploadAttachment).not.toHaveBeenCalled();
    },
  );

  it.each([1, 13, 14])(
    "enforces the decoded size limit of %s bytes",
    async (limit) => {
      const env = setupDocument();
      env.options.maxUploadBytes = limit;
      expect(await env.tool().execute(input, context)).toMatchObject({
        ok: limit === 14,
      });
      expect(env.uploadAttachment).toHaveBeenCalledTimes(limit === 14 ? 1 : 0);
    },
  );

  it.each([{}, { ...document, contentBase64: "%%%" }])(
    "rejects malformed results %j",
    async (result) => {
      const env = setup({ "sources.get_document.v1": result });
      const tool = env
        .tools()
        .find((item) => item.name === GET_SIDECAR_DOCUMENT_TOOL)!;
      expect(await tool.execute(input, context)).toMatchObject({ ok: false });
      expect(env.uploadAttachment).not.toHaveBeenCalled();
    },
  );

  it("reports upload failures without claiming a file was attached", async () => {
    const env = setupDocument();
    env.uploadAttachment.mockRejectedValue(new Error("offline"));
    expect(await env.tool().execute(input, context)).toEqual({
      ok: false,
      error: "offline",
    });
  });
});

it("blocks legacy tool execution for a present but unavailable delegation declaration", async () => {
  const f = setup({});
  vi.spyOn(f.client, "getSnapshot").mockReturnValue({
    ...f.client.getSnapshot(),
    state: "ready",
    localDelegation: { enforcement: "unavailable" },
    strictLocalDelegation: false,
  });
  for (const tool of f.tools()) {
    expect(tool.isAvailable()).toBe(false);
    expect(await tool.execute({}, context)).toEqual({
      ok: true,
      disposition: "local_only",
    });
  }
  expect(f.request).not.toHaveBeenCalled();
  expect(f.uploadAttachment).not.toHaveBeenCalled();
});
