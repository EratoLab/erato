import { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";
import { describe, expect, it, vi } from "vitest";

import {
  createSidecarChatTools,
  GET_SIDECAR_DOCUMENT_TOOL,
  GET_SIDECAR_FOLDER_HIERARCHY_TOOL,
  GET_SIDECAR_SEARCH_FIELDS_TOOL,
  READ_SIDECAR_CONVERSATION_TOOL,
  SEARCH_SIDECAR_INDEX_TOOL,
} from "./chatTools";
import {
  readSidecarConversation,
  SidecarConversationUnavailableError,
} from "./mailboxAccess";
import { outlookStoreVariant } from "./outlookStores";
import {
  cachedSourceDirectory,
  sidecarSourceError,
  sourceDirectory,
} from "./sourceCapabilities";
import searchCoverageFixture from "../../../../desktop-sidecar-protocol/conformance/fixtures/search-coverage.json";
import capabilityFixture from "../../../../desktop-sidecar-protocol/conformance/fixtures/source-capabilities.json";

import type {
  SearchQueryV1Result,
  SourcesListV1Result,
} from "@erato/desktop-sidecar-protocol";

const context = { toolCallId: "call", messageId: "message", chatId: "chat" };
const sources = capabilityFixture as SourcesListV1Result;
const legacySources: SourcesListV1Result = {
  sources: sources.sources.map(
    ({ capabilities: _capabilities, ...source }) => source,
  ),
};
const [ost, hx] = sources.sources;
const fields = [
  {
    field: "to",
    operators: ["eq", "ne", "in"],
    type: "string",
    description: "Recipient email address.",
    applicable_kinds: ["email"],
  },
  {
    field: "sender",
    operators: ["eq", "ne", "in"],
    type: "string",
    description: "Sender.",
    applicable_kinds: ["email", "teams_message"],
  },
];

type Reply = { result: unknown } | { error: Record<string, unknown> };

function setup(replies: Record<string, Reply>) {
  const request = vi.fn(async (body: string) => {
    const { id, method } = JSON.parse(body) as { id: string; method: string };
    return JSON.stringify({ jsonrpc: "2.0", id, ...replies[method] });
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
  vi.spyOn(client, "supports").mockReturnValue(true);
  const tools = createSidecarChatTools(client, {
    approveFiles: vi.fn(async (files: File[]) => new Set(files)),
    uploadAttachment: vi.fn(async () => ({ id: "uploaded" })),
    uploadsEnabled: true,
    maxUploadBytes: 1000,
    maxFiles: 10,
  });
  const run = (name: string, input: unknown) =>
    tools.find((tool) => tool.name === name)!.execute(input, context);
  return { client, request, run };
}

function hit(source: (typeof sources.sources)[number], documentId: string) {
  return {
    documentId,
    chunkId: null,
    score: 1,
    kind: "email",
    title: "Offer",
    sender: "jane@example.com",
    mailboxId: source.locator.mailboxId as string,
    sourceId: source.sourceId,
    date: 1789387200,
    mimeType: "message/rfc822",
    conversationKey: "5d2f2a0e-8e57-4f0c-9e57-1f0a1c3d5b7e",
    external_ids: [{ key: "email_message_id", value: `<${documentId}@x>` }],
  };
}

const searchResult = (): SearchQueryV1Result => ({
  hits: [
    hit(ost, "d1111111-b222-4333-8444-c55555555555"),
    hit(hx, "d2222222-b222-4333-8444-c55555555555"),
  ],
  elapsedMs: 1,
  blocksRead: 1,
  candidatesScored: 2,
});

const sidecarError = (code: number, data: Record<string, unknown>) => ({
  error: { code, message: "The sidecar could not complete the request.", data },
});

describe("source capabilities in the chat tools", () => {
  it("offers readConversation only for mailboxes that can be read as conversations", async () => {
    const { run } = setup({
      "search.query.v1": { result: searchResult() },
      "sources.list.v1": { result: sources },
    });
    const result = await run(SEARCH_SIDECAR_INDEX_TOOL, { text: "offer" });
    expect(result.ok).toBe(true);
    const { hits, contentNotice } = (
      result as { result: { hits: { readConversation: unknown }[] } } & {
        result: { contentNotice: string };
      }
    ).result;
    expect(hits[0].readConversation).toEqual({
      mailboxId: "11111111222243338444555555555555",
      internetMessageId: "<d1111111-b222-4333-8444-c55555555555@x>",
    });
    expect(hits[1].readConversation).toBeNull();
    expect(contentNotice).toContain(
      "Conversation reading isn't available for Outlook · jane@example.com (new Outlook for Mac)",
    );
  });

  it("keeps readConversation for every hit of a sidecar without capabilities", async () => {
    for (const listed of [{ result: legacySources }, undefined]) {
      const { run } = setup({
        "search.query.v1": { result: searchResult() },
        ...(listed && { "sources.list.v1": listed }),
      });
      const result = (await run(SEARCH_SIDECAR_INDEX_TOOL, {
        text: "offer",
      })) as { result: { hits: { readConversation: unknown }[] } };
      expect(
        result.result.hits.every((item) => item.readConversation !== null),
      ).toBe(true);
    }
  });

  it("says which sources cannot match a metadata filter", async () => {
    const { run } = setup({
      "search.query.v1": { result: { ...searchResult(), hits: [] } },
      "sources.list.v1": { result: sources },
      "search.metadata_fields.v1": { result: { fields } },
    });
    const result = (await run(SEARCH_SIDECAR_INDEX_TOOL, {
      text: "",
      filters: { kind: "email" },
      metadata_filters: [
        { field: "to", operator: "eq", value: "sabrina@example.com" },
      ],
    })) as { result: { filterNotice?: string } };
    expect(result.result.filterNotice).toBe(
      "Some sources never record a filtered field, so their items cannot match it: to for Outlook · jane@example.com (new Outlook for Mac). Do not conclude that no such items exist there; tell the user that this information isn't available for those sources.",
    );
  });

  it("marks search fields per source that never records them", async () => {
    const { run } = setup({
      "search.metadata_fields.v1": { result: { fields } },
      "sources.list.v1": { result: sources },
    });
    const result = (await run(GET_SIDECAR_SEARCH_FIELDS_TOOL, {})) as {
      result: {
        fields: { field: string; unavailableFor?: unknown }[];
        notice?: string;
      };
    };
    const [to, sender] = result.result.fields;
    // Teams messages have no recipients, so only the Hx mailbox lacks `to`.
    expect(to.unavailableFor).toEqual([
      {
        sourceId: hx.sourceId,
        label: "Outlook · jane@example.com (new Outlook for Mac)",
      },
    ]);
    expect(sender.unavailableFor).toBeUndefined();
    expect(result.result.notice).toContain("unavailableFor");
  });

  it("turns typed document errors into final, actionable errors", async () => {
    for (const [code, data, expected] of [
      [
        -32016,
        { kind: "sidecar_internal", sourceError: "missing_from_local_cache" },
        /^Only part of this item, such as a preview, is cached on this device.*Do not retry/,
      ],
      [
        -32602,
        { sourceError: "document_not_found" },
        /^The item is no longer in the local index/,
      ],
      [
        -32016,
        { kind: "sidecar_internal", sourceError: "future_error" },
        /^The sidecar could not complete the request\.$/,
      ],
    ] as const) {
      const { run } = setup({
        "sources.get_document.v1": sidecarError(code, data),
      });
      const result = await run(GET_SIDECAR_DOCUMENT_TOOL, {
        documentId: "d2222222-b222-4333-8444-c55555555555",
      });
      expect(result).toEqual({
        ok: false,
        error: expect.stringMatching(expected),
      });
    }
  });

  it("says that an unsupported conversation must not be retried", async () => {
    const { run } = setup({
      "outlook.get_conversation.v1": {
        result: {
          state: "partial",
          mailbox: {
            id: "21111111222243338444555555555555",
            displayName: "jane@example.com",
            source: "macOsHxAccount",
          },
          messages: [],
          warnings: [
            {
              code: "unsupported_source",
              message:
                "Conversation retrieval is unavailable for this mailbox storage format.",
            },
          ],
        },
      },
    });
    const result = await run(READ_SIDECAR_CONVERSATION_TOOL, {
      mailboxId: "21111111222243338444555555555555",
      internetMessageId: "<message@x>",
    });
    expect(result).toEqual({
      ok: false,
      error:
        "Conversation reading isn't available for this mailbox (new Outlook for Mac). Use get_sidecar_document with the search hit's documentId instead. Do not retry read_sidecar_conversation for this mailbox.",
    });
  });

  it("explains a missing conversation anchor from current and older sidecars alike", async () => {
    const replies: Reply[] = [
      sidecarError(-32602, { sourceError: "document_not_found" }),
      { result: { state: "ok", messages: [], warnings: [] } },
    ];
    for (const reply of replies) {
      const { run } = setup({ "outlook.get_conversation.v1": reply });
      const result = await run(READ_SIDECAR_CONVERSATION_TOOL, {
        mailboxId: "11111111222243338444555555555555",
        internetMessageId: "<message@x>",
      });
      expect(result).toEqual({
        ok: false,
        error: expect.stringMatching(
          /^The local mailbox has no message with this Message-ID/,
        ),
      });
    }
  });

  it("reports unavailable folders instead of an empty mailbox", async () => {
    const { run } = setup({
      "sources.get_folder_hierarchy.v1": sidecarError(-32016, {
        kind: "sidecar_internal",
        sourceError: "unsupported_source",
      }),
      "sources.list.v1": { result: sources },
    });
    const result = await run(GET_SIDECAR_FOLDER_HIERARCHY_TOOL, {
      sourceId: hx.sourceId,
    });
    expect(result).toEqual({
      ok: true,
      result: {
        sourceId: hx.sourceId,
        foldersAvailable: false,
        notice: expect.stringMatching(
          /^Folders aren't available for Outlook · jane@example.com \(new Outlook for Mac\): .*does not mean the mailbox has no folders/,
        ),
      },
    });
  });
});

describe("source names and shared lookups", () => {
  it("names a mailbox as the search coverage does", async () => {
    const [covered] = searchCoverageFixture.coverage.sources;
    const { run } = setup({
      "search.query.v1": {
        result: {
          ...searchResult(),
          coverage: {
            ...searchCoverageFixture.coverage,
            sources: [
              {
                ...covered,
                sourceId: hx.sourceId,
                accountEmail: "jane.work@example.com",
              },
            ],
          },
        },
      },
      "sources.list.v1": { result: sources },
    });
    const result = (await run(SEARCH_SIDECAR_INDEX_TOOL, {
      text: "offer",
    })) as { result: { contentNotice: string; coverage: { notice: string } } };
    expect(result.result.coverage.notice).toContain(
      "Outlook · jane.work@example.com",
    );
    expect(result.result.contentNotice).toContain(
      "Conversation reading isn't available for Outlook · jane.work@example.com (new Outlook for Mac)",
    );
  });

  it("names only the filtered sources that cannot match a field", async () => {
    const { run } = setup({
      "search.query.v1": { result: { ...searchResult(), hits: [] } },
      "sources.list.v1": { result: sources },
      "search.metadata_fields.v1": { result: { fields } },
    });
    const result = (await run(SEARCH_SIDECAR_INDEX_TOOL, {
      text: "",
      filters: { sourceId: ost.sourceId },
      metadata_filters: [
        { field: "to", operator: "eq", value: "sabrina@example.com" },
      ],
    })) as { result: { filterNotice?: string } };
    expect(result.result.filterNotice).toBeUndefined();
  });

  it("keeps the shared source list for other callers when one cancels", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const request = vi.fn(async (body: string) => {
      const { id } = JSON.parse(body) as { id: string };
      await gate;
      return JSON.stringify({ jsonrpc: "2.0", id, result: sources });
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
    vi.spyOn(client, "supports").mockReturnValue(true);
    const load = cachedSourceDirectory(client);
    const cancelled = new AbortController();
    const first = load(cancelled.signal);
    const second = load();
    cancelled.abort();
    release();
    await expect(first).rejects.toThrow();
    const directory = await second;
    expect(directory?.bySourceId(hx.sourceId)[0]?.capabilities).toMatchObject({
      conversations: false,
    });
    expect(request).toHaveBeenCalledOnce();
  });
});

describe("source capability helpers", () => {
  it("names Outlook stores from catalog kinds and mailbox sources", () => {
    expect(
      [
        "macOS Hx account",
        "macOsHxAccount",
        "windowsNewOutlook",
        "OST",
        "teams",
      ].map(outlookStoreVariant),
    ).toEqual([
      "newOutlookForMac",
      "newOutlookForMac",
      "newOutlookForWindows",
      "classic",
      null,
    ]);
  });

  it("reads sourceError only from error data", () => {
    expect(
      sidecarSourceError({ data: { sourceError: "source_changed" } }),
    ).toBe("source_changed");
    expect(sidecarSourceError(new Error("x"))).toBeUndefined();
    expect(sidecarSourceError({ data: { sourceError: 1 } })).toBeUndefined();
  });

  it("finds sources by hyphenated or compact mailbox ID", () => {
    const directory = sourceDirectory(sources.sources);
    expect(
      directory.byMailboxId("21111111-2222-4333-8444-555555555555")[0]
        ?.sourceId,
    ).toBe(hx.sourceId);
    expect(
      directory.byMailboxId("21111111222243338444555555555555"),
    ).toHaveLength(1);
    expect(directory.byMailboxId("not-a-mailbox")).toEqual([]);
  });

  it("keeps a conversation's state and warnings on its error", async () => {
    const client = {
      invoke: vi.fn(async () => ({
        state: "partial",
        messages: [],
        warnings: [{ code: "unsupported_source" }],
      })),
    } as unknown as DesktopSidecarClient;
    const error = await readSidecarConversation(client, {
      mailboxId: "21111111222243338444555555555555",
      anchor: { internetMessageId: "<m@x>" },
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SidecarConversationUnavailableError);
    expect(error).toMatchObject({
      code: "unsupported_source",
      state: "partial",
      warnings: [{ code: "unsupported_source" }],
    });
  });
});
