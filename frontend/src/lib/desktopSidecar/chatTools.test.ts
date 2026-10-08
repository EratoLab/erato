import { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";
import { describe, expect, it, vi } from "vitest";

import {
  createSidecarChatTools,
  GET_SIDECAR_SEARCH_FIELDS_TOOL,
  GET_SIDECAR_DOCUMENT_TOOL,
  numberedLabel,
  SIDECAR_CHAT_TOOL_METHODS,
} from "./chatTools";
import { resolveSidecarMailboxId } from "./mailboxAccess";
import searchCoverageFixture from "../../../../desktop-sidecar-protocol/conformance/fixtures/search-coverage.json";

import type {
  SidecarAttachmentUpload,
  SidecarChatToolOptions,
} from "./chatTools";
import type { KnownSearchCoverage, SearchCoverage } from "./searchCoverage";
import type {
  OutlookGetConversationV1Result,
  SearchQueryV1Result,
} from "@erato/desktop-sidecar-protocol";

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
  const uploadAttachment = vi.fn<SidecarAttachmentUpload>(async () => ({
    id: "uploaded-file",
  }));
  const options = {
    approveFiles: vi.fn<SidecarChatToolOptions["approveFiles"]>(
      async (files) => new Set(files),
    ),
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
  it("keeps each conversation message's identity when equal attachment bytes have different parents", async () => {
    const data = conversation();
    data.messages = ["first", "second"].map((name) => ({
      ...data.messages[0],
      internetMessageId: `<${name}@example.test>`,
      external_ids: [{ key: "ews_id", value: `${name}-ews` }],
    }));
    const env = setup({ "outlook.get_conversation.v1": data });
    env.options.approveFiles.mockImplementation(
      async (files, _context, provenance) => {
        expect(env.uploadAttachment).not.toHaveBeenCalled();
        for (const [index, name] of ["first", "second"].entries()) {
          expect(
            provenance?.get(files[index])?.origins[0].topLevelParent,
          ).toMatchObject({
            external_ids: [
              { key: "ews_id", value: `${name}-ews` },
              { key: "email_message_id", value: `<${name}@example.test>` },
            ],
            mailbox: { mailboxId },
          });
        }
        return new Set(files);
      },
    );
    await env
      .tools()[1]
      .execute({ ...anchor, includeAttachments: true }, context);
    expect(env.uploadAttachment).toHaveBeenCalledTimes(2);
    const consentProvenance = env.options.approveFiles.mock.calls[0][2];
    for (const [file, , , , provenance] of env.uploadAttachment.mock.calls) {
      expect(provenance).toBe(consentProvenance?.get(file));
    }
    for (const [index, name] of ["first", "second"].entries()) {
      expect(env.uploadAttachment).toHaveBeenNthCalledWith(
        index + 1,
        expect.any(File),
        "chat",
        undefined,
        undefined,
        {
          version: 1,
          origins: [
            {
              topLevelParent: {
                external_ids: [
                  { key: "ews_id", value: `${name}-ews` },
                  { key: "email_message_id", value: `<${name}@example.test>` },
                ],
                mailbox: { mailboxId },
              },
            },
          ],
        },
      );
    }
  });

  it.each([true, false])(
    "persists an attachment export's outer parent and verified search mailbox (mailbox discovery: %s)",
    async (mailboxDiscovery) => {
      const documentId = "11111111-1111-4111-8111-111111111111";
      const topLevelParent = {
        external_ids: [{ key: "ews_id", value: "outer-mail" }],
      };
      const env = setup({
        "search.query.v1": {
          hits: [
            {
              documentId,
              mailboxId,
              topLevelParent,
              chunkId: null,
              score: 1,
              kind: "file",
              title: null,
              sender: null,
              date: null,
              mimeType: "text/plain",
              conversationKey: null,
            },
          ],
          elapsedMs: 0,
          blocksRead: 0,
          candidatesScored: 0,
        },
        "sources.get_document.v1": {
          filename: "note.txt",
          mimeType: "text/plain",
          contentBase64: globalThis.btoa("note"),
          external_ids: [],
          topLevelParent,
        },
        "outlook.list_mailboxes.v1": {
          mailboxes: [
            {
              id: mailboxId,
              emailAddress: "shared@example.test",
              source: "windows-classic",
              displayName: "Shared",
            },
          ],
          warnings: [],
        },
      });
      env.supports.mockImplementation(
        (method) => mailboxDiscovery || method !== "outlook.list_mailboxes.v1",
      );
      env.options.approveFiles.mockImplementation(
        async (files, _context, provenance) => {
          expect(env.uploadAttachment).not.toHaveBeenCalled();
          expect(provenance?.get(files[0])?.origins[0].topLevelParent).toEqual({
            ...topLevelParent,
            mailbox: {
              mailboxId,
              ...(mailboxDiscovery
                ? { emailAddress: "shared@example.test" }
                : {}),
            },
          });
          return new Set(files);
        },
      );
      const tools = env.tools();
      expect(await tools[0].execute({ text: "note" })).toMatchObject({
        ok: true,
      });
      const tool = tools.find(
        (tool) => tool.name === GET_SIDECAR_DOCUMENT_TOOL,
      )!;
      expect(await tool.execute({ documentId }, context)).toMatchObject({
        ok: true,
      });
      expect(env.uploadAttachment).toHaveBeenCalledWith(
        expect.any(File),
        "chat",
        undefined,
        undefined,
        {
          version: 1,
          origins: [
            {
              topLevelParent: {
                ...topLevelParent,
                mailbox: {
                  mailboxId,
                  ...(mailboxDiscovery
                    ? { emailAddress: "shared@example.test" }
                    : {}),
                },
              },
            },
          ],
        },
      );
    },
  );

  it("keeps mailbox scope when exporting a parent observed in a conversation", async () => {
    const documentId = "11111111-1111-4111-8111-111111111111";
    const data = conversation();
    data.messages[0].attachments[0].topLevelParent = {
      documentId,
      external_ids: [{ key: "ews_id", value: "parent" }],
    };
    const env = setup({
      "outlook.get_conversation.v1": data,
      "sources.get_document.v1": {
        filename: "parent.eml",
        mimeType: "message/rfc822",
        contentBase64: globalThis.btoa("mail"),
        external_ids: [{ key: "ews_id", value: "parent" }],
      },
    });
    env.supports.mockImplementation(
      (method) => method !== "outlook.list_mailboxes.v1",
    );
    const tools = env.tools();
    await tools[1].execute(anchor);
    await tools
      .find((tool) => tool.name === GET_SIDECAR_DOCUMENT_TOOL)!
      .execute({ documentId }, context);
    expect(env.uploadAttachment).toHaveBeenCalledWith(
      expect.any(File),
      "chat",
      undefined,
      "parent",
      {
        version: 1,
        origins: [
          {
            document: {
              documentId,
              external_ids: [{ key: "ews_id", value: "parent" }],
              mailbox: { mailboxId },
            },
          },
        ],
      },
    );
  });

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
      expect.objectContaining({ version: 1 }),
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

  it("forwards additive discovery arguments", async () => {
    const env = setup({ "search.metadata_fields.v1": { fields: [] } });
    const tool = env
      .tools()
      .find((item) => item.name === GET_SIDECAR_SEARCH_FIELDS_TOOL)!;
    expect(await tool.execute({ unknown: true })).toMatchObject({ ok: true });
    expect(JSON.parse(env.request.mock.calls[0][0]).params).toEqual({
      unknown: true,
    });
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
      expect.objectContaining({ version: 1 }),
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
        expect.objectContaining({ version: 1 }),
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
        expect.objectContaining({ version: 1 }),
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
        {
          version: 1,
          origins: [{ document: { documentId, external_ids: [] } }],
        },
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
          expect.objectContaining({ version: 1 }),
        );
      }
    },
  );

  it.each([{}, { documentId: "bad" }, { ...input, subject_scope: "all" }])(
    "rejects invalid input %j before transport",
    async (args) => {
      const env = setupDocument();
      expect(await env.tool().execute(args, context)).toMatchObject({
        ok: false,
      });
      expect(env.request).not.toHaveBeenCalled();
      expect(env.uploadAttachment).not.toHaveBeenCalled();
    },
  );

  it("forwards additive document parameters", async () => {
    const env = setupDocument();
    expect(
      await env.tool().execute({ ...input, path: "/tmp/file" }, context),
    ).toMatchObject({ ok: true });
    expect(JSON.parse(env.request.mock.calls[0][0]).params).toEqual({
      ...input,
      path: "/tmp/file",
    });
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

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

describe("settings tool list", () => {
  it("lists every registered tool with the sidecar method it needs", () => {
    const registered = setup({})
      .tools()
      .map(({ name, method }) => ({ name, method }));
    expect([...SIDECAR_CHAT_TOOL_METHODS].sort(byName)).toEqual(
      registered.sort(byName),
    );
  });
});

type RawCoverageSource = NonNullable<
  SearchQueryV1Result["coverage"]
>["sources"][number];

const T_2026 = 1767225600;
const legacySearchResult = {
  hits: [],
  elapsedMs: 0,
  blocksRead: 0,
  candidatesScored: 0,
};

function coverageSource(
  overrides: Partial<RawCoverageSource> = {},
): RawCoverageSource {
  return {
    sourceId: "source-a",
    mailboxId: null,
    product: "outlook",
    displayName: "Work mailbox",
    accountEmail: "jane@example.com",
    from: { at: "2026-01-01T00:00:00Z", inclusive: true },
    through: null,
    observedAt: "2026-09-15T12:00:00Z",
    pendingNewer: 0,
    olderPending: 0,
    unsearchable: 0,
    undated: 0,
    dateBasis: "emailReceivedAtThenSentAt",
    inventory: "localStore",
    unavailableReason: null,
    ...overrides,
  };
}

function withCoverage(
  sources: RawCoverageSource[],
  extra: Partial<SearchQueryV1Result> = {},
): SearchQueryV1Result {
  return {
    ...legacySearchResult,
    coverage: { sampledAt: "2026-09-15T12:00:00Z", basis: "index", sources },
    limitReached: false,
    ...extra,
  };
}

async function searchResult(response: unknown, input: unknown = {}) {
  const outcome = await setup({ "search.query.v1": response })
    .tools()[0]
    .execute(input);
  if (!outcome.ok || !outcome.result) throw new Error("search failed");
  return outcome.result as Record<string, unknown> & {
    coverage: SearchCoverage;
  };
}

async function knownCoverage(response: unknown, input: unknown = {}) {
  return (await searchResult(response, input)).coverage as KnownSearchCoverage;
}

describe("search coverage for the model", () => {
  it("maps the conformance report to the compact shape and drops the raw keys", async () => {
    const result = await searchResult(searchCoverageFixture);
    expect(result).not.toHaveProperty("limitReached");
    expect(result.coverage).toEqual({
      v: 1,
      asOf: "2026-09-15T12:00:00Z",
      basis: "index",
      requested: { from: null, to: null },
      requestedFromBeforeCoverage: false,
      limitReached: true,
      sources: [
        {
          sourceId: "source-example",
          label: "Outlook · jane@example.com",
          kinds: ["email", "file"],
          from: "2025-03-14T08:30:01Z",
          to: "2026-09-15T12:00:00Z",
          status: "indexing",
          partialCache: false,
          requestedFromBeforeCoverage: false,
        },
        {
          sourceId: "teams-source-example",
          label: "Teams · Contoso Ltd (jane@example.com)",
          kinds: ["teams_message"],
          from: "2026-06-02T09:15:00Z",
          to: "2026-09-15T11:40:00Z",
          status: "newest_pending",
          partialCache: true,
          requestedFromBeforeCoverage: false,
        },
      ],
      notice:
        "Local search on this device covered Outlook · jane@example.com from 2025-03-14 to 2026-09-15 and Teams · Contoso Ltd (jane@example.com) from 2026-06-02 to 2026-09-15; earlier items were not searched; items in Teams · Contoso Ltd (jane@example.com) after 2026-09-15T11:40:00Z are still being indexed and were not searched; do not conclude that missing items do not exist; more items matched than were returned, so narrow the date range to see the rest.",
    });
    expect(Object.keys(result.coverage)).toEqual([
      "v",
      "asOf",
      "basis",
      "requested",
      "requestedFromBeforeCoverage",
      "limitReached",
      "sources",
      "notice",
    ]);
    expect(result.hits).toHaveLength(2);
  });

  it("reports an unknown period for a sidecar without coverage", async () => {
    const result = await searchResult(legacySearchResult);
    expect(result.coverage).toEqual({
      v: 1,
      status: "unknown",
      notice: expect.stringContaining("does not report which period"),
    });
    expect(result).not.toHaveProperty("limitReached");
  });

  it("keeps a reported limit when the sidecar reports no coverage", async () => {
    const result = await searchResult({
      ...legacySearchResult,
      limitReached: true,
    });
    expect(result).not.toHaveProperty("limitReached");
    expect(result.coverage).toEqual({
      v: 1,
      status: "unknown",
      limitReached: true,
      notice: expect.stringContaining(
        "more items matched than were returned, so narrow the date range",
      ),
    });
  });

  it("converts the requested filter to inclusive ISO bounds", async () => {
    const coverage = await knownCoverage(withCoverage([coverageSource()]), {
      filters: { dateFrom: T_2026 - 86400, dateTo: T_2026 + 86400 },
    });
    expect(coverage.requested).toEqual({
      from: "2025-12-31T00:00:00Z",
      to: "2026-01-01T23:59:59Z",
    });
  });

  it("moves an exclusive end back a second and uses observedAt without one", async () => {
    const coverage = await knownCoverage(
      withCoverage([
        coverageSource({
          through: { at: "2026-09-15T11:40:00Z", inclusive: false },
          pendingNewer: 2,
        }),
        coverageSource({ sourceId: "source-b", product: "teams" }),
      ]),
    );
    expect(coverage.sources.map(({ to, status }) => [to, status])).toEqual([
      ["2026-09-15T11:39:59Z", "newest_pending"],
      ["2026-09-15T12:00:00Z", "complete"],
    ]);
    expect(coverage.notice).toContain(
      "items in Outlook · jane@example.com after 2026-09-15T11:39:59Z are still being indexed and were not searched",
    );
  });

  it.each([
    { inclusive: true, dateFrom: T_2026, flagged: false },
    { inclusive: true, dateFrom: T_2026 - 1, flagged: true },
    { inclusive: false, dateFrom: T_2026, flagged: true },
    { inclusive: false, dateFrom: T_2026 + 1, flagged: false },
    { inclusive: true, dateFrom: undefined, flagged: false },
  ])(
    "flags a requested start of $dateFrom against an inclusive=$inclusive start: $flagged",
    async ({ inclusive, dateFrom, flagged }) => {
      const coverage = await knownCoverage(
        withCoverage([
          coverageSource({
            from: { at: "2026-01-01T00:00:00Z", inclusive },
          }),
          coverageSource({
            sourceId: "source-b",
            from: { at: "2020-01-01T00:00:00Z", inclusive: true },
          }),
        ]),
        dateFrom === undefined ? {} : { filters: { dateFrom } },
      );
      expect(coverage.sources[0].requestedFromBeforeCoverage).toBe(flagged);
      expect(coverage.sources[1].requestedFromBeforeCoverage).toBe(false);
      expect(coverage.requestedFromBeforeCoverage).toBe(flagged);
      expect(coverage.notice.includes("lies before that")).toBe(flagged);
    },
  );

  it("reports a source without a range as unavailable with its reason", async () => {
    const coverage = await knownCoverage(
      withCoverage([
        coverageSource({
          from: null,
          observedAt: null,
          olderPending: 40,
          unavailableReason: "not_enumerated",
        }),
      ]),
      { filters: { dateFrom: T_2026 } },
    );
    expect(coverage.sources[0]).toMatchObject({
      from: null,
      to: null,
      status: "unavailable",
      reason: "not_enumerated",
      requestedFromBeforeCoverage: false,
    });
    expect(coverage.notice).toBe(
      "Nothing in Outlook · jane@example.com (not_enumerated) is searchable yet; do not conclude that missing items do not exist.",
    );
  });

  it("says nothing was searched when no enabled source matched", async () => {
    const coverage = await knownCoverage(withCoverage([]));
    expect(coverage.sources).toEqual([]);
    expect(coverage.notice).toMatch(/^No enabled local source matched/);
  });

  it("marks every inventory but a complete local store as a partial cache", async () => {
    const coverage = await knownCoverage(
      withCoverage([
        coverageSource(),
        coverageSource({ sourceId: "b", inventory: "cacheObservations" }),
        coverageSource({ sourceId: "c", inventory: "futureInventory" }),
      ]),
    );
    expect(coverage.sources.map((source) => source.partialCache)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("says a capped listing only reaches back to its oldest hit", async () => {
    const coverage = await knownCoverage({
      ...searchCoverageFixture,
      coverage: { ...searchCoverageFixture.coverage, basis: "catalog" },
    });
    expect(coverage.basis).toBe("catalog");
    expect(coverage.notice).toContain(
      "this listing hit its limit and only reaches back to 2026-09-10, so narrow the date range",
    );
  });

  it("does not bound a listing by the indexed range", async () => {
    const listing = withCoverage([
      coverageSource(),
      coverageSource({
        sourceId: "source-b",
        accountEmail: "max@example.com",
        from: null,
        observedAt: null,
        unavailableReason: "not_enumerated",
      }),
    ]);
    const coverage = await knownCoverage(
      { ...listing, coverage: { ...listing.coverage!, basis: "catalog" } },
      { filters: { dateFrom: T_2026 - 86400 } },
    );
    expect(coverage.requestedFromBeforeCoverage).toBe(false);
    expect(coverage.sources[0].requestedFromBeforeCoverage).toBe(false);
    expect(coverage.notice).toBe(
      "This listing read the items discovered on this device in Outlook · jane@example.com, which can include items not yet searchable by text; Outlook · max@example.com has not been scanned yet; items not stored on this device were not listed, so do not conclude that missing items do not exist.",
    );
  });

  it("numbers sources that share a label by source id", async () => {
    const teams = (sourceId: string) =>
      coverageSource({
        sourceId,
        product: "teams",
        displayName: "Contoso Ltd",
      });
    const coverage = await knownCoverage(
      withCoverage([teams("source-b"), teams("source-a"), coverageSource()]),
    );
    expect(coverage.sources.map(numberedLabel)).toEqual([
      "Teams · Contoso Ltd (2)",
      "Teams · Contoso Ltd (1)",
      "Outlook · jane@example.com",
    ]);
    expect(coverage.sources.map((source) => source.number)).toEqual([
      2,
      1,
      undefined,
    ]);
    expect(coverage.notice).toContain(
      "covered Teams · Contoso Ltd (2) from 2026-01-01",
    );
  });
});
