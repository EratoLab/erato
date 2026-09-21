import { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";
import { describe, expect, it, vi } from "vitest";

import {
  createSidecarChatTools,
  GET_SIDECAR_FOLDER_HIERARCHY_TOOL,
  LIST_SIDECAR_MAILBOXES_TOOL,
} from "./chatTools";

const mailboxId = "a".repeat(32);
const sourceId = "00000000-0000-4000-8000-000000000001";
const mailbox = {
  id: mailboxId,
  displayName: "Test mailbox",
  emailAddress: "test@example.test",
  profileName: "Outlook",
  source: "ost",
};
const source = {
  sourceId,
  sourceKind: "OST",
  sourceKey: "private-store-path:mailbox",
  locator: {
    path: "private-store-path",
    mailboxId: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
  },
  enabled: false,
  discoveryCursor: { private: "cursor" },
  completedScanId: null,
  lastSuccessAt: "2026-09-21T18:00:00Z",
  lastErrorCode: null,
};
const nodes = [
  {
    nodeId: "root",
    parentNodeId: null,
    name: "Mailbox",
    pathName: "Mailbox",
    artificialRoot: true,
    directChildNodes: 1,
    directLeafChildren: 0,
    totalLeafChildren: 30,
  },
  {
    nodeId: "folder:42",
    parentNodeId: "root",
    name: "Inbox",
    pathName: "Mailbox/Inbox",
    artificialRoot: false,
    directChildNodes: 0,
    directLeafChildren: 30,
    totalLeafChildren: 30,
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
  // Validate both sides of the real pinned protocol, without a discovery request.
  const supports = vi.spyOn(client, "supports").mockReturnValue(true);
  const uploadAttachment = vi.fn();
  const tools = createSidecarChatTools(client, {
    uploadAttachment,
    uploadsEnabled: false,
    maxUploadBytes: 0,
    maxFiles: 0,
  });
  const list = tools.find((tool) => tool.name === LIST_SIDECAR_MAILBOXES_TOOL)!;
  const folders = tools.find(
    (tool) => tool.name === GET_SIDECAR_FOLDER_HIERARCHY_TOOL,
  )!;
  return { client, request, supports, uploadAttachment, tools, list, folders };
}

describe("shared sidecar mailbox and folder tools", () => {
  it("joins source references by mailbox identity and omits private catalog details", async () => {
    const otherMailbox = { ...mailbox, id: "b".repeat(32) };
    const env = setup({
      "outlook.list_mailboxes.v1": {
        mailboxes: [mailbox, otherMailbox],
        warnings: [
          { path: "private-cache-path", message: "Cache unavailable" },
        ],
      },
      "sources.list.v1": {
        sources: [
          source,
          { ...source, sourceId: sourceId.replace(/1$/, "2"), locator: {} },
          {
            ...source,
            sourceId: sourceId.replace(/1$/, "3"),
            locator: { mailboxId: "invalid" },
          },
        ],
      },
    });
    const result = await env.list.execute({});
    expect(result).toMatchObject({
      ok: true,
      result: {
        mailboxes: [
          {
            ...mailbox,
            sources: [
              {
                sourceId,
                sourceKind: "OST",
                enabled: false,
                lastSuccessAt: source.lastSuccessAt,
                lastErrorCode: null,
              },
            ],
          },
          { ...otherMailbox, sources: [] },
        ],
        warnings: [{ message: "Cache unavailable" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(
      env.request.mock.calls.map(([body]) => JSON.parse(body).method),
    ).toEqual(["outlook.list_mailboxes.v1", "sources.list.v1"]);
    expect(env.uploadAttachment).not.toHaveBeenCalled();
  });

  it.each(["unsupported", "invalid_result"])(
    "retains mailboxes and marks source references unknown when discovery is %s",
    async (failure) => {
      const env = setup({
        "outlook.list_mailboxes.v1": { mailboxes: [mailbox], warnings: [] },
        "sources.list.v1": {
          sources: [{ ...source, lastSuccessAt: "invalid" }],
        },
      });
      if (failure === "unsupported") {
        env.supports.mockImplementation(
          (method) => method !== "sources.list.v1",
        );
      }
      expect(env.list.isAvailable()).toBe(true);
      expect(await env.list.execute({})).toMatchObject({
        ok: true,
        result: {
          mailboxes: [{ ...mailbox, sources: null }],
          warnings: [{ message: expect.any(String) }],
        },
      });
      expect(env.request).toHaveBeenCalledTimes(
        failure === "unsupported" ? 1 : 2,
      );
    },
  );

  it("rejects malformed mailbox results before source lookup", async () => {
    const env = setup({
      "outlook.list_mailboxes.v1": {
        mailboxes: [{ id: "invalid" }],
        warnings: [],
      },
    });
    expect(await env.list.execute({})).toMatchObject({ ok: false });
    expect(env.request).toHaveBeenCalledTimes(1);
  });

  it("rejects mailbox arguments before transport", async () => {
    const env = setup({});
    expect(await env.list.execute({ mailboxId })).toMatchObject({ ok: false });
    expect(env.request).not.toHaveBeenCalled();
  });

  it("preserves folder parent links and counts through the pinned contract", async () => {
    const env = setup({
      "sources.get_folder_hierarchy.v1": { sourceId, nodes },
    });
    expect(await env.folders.execute({ sourceId })).toMatchObject({
      ok: true,
      result: {
        sourceId,
        nodes,
        contentNotice: expect.stringContaining("Attachments"),
      },
    });
    expect(JSON.parse(env.request.mock.calls[0][0])).toMatchObject({
      method: "sources.get_folder_hierarchy.v1",
      params: { sourceId },
    });
    expect(env.uploadAttachment).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { mailboxId },
    { sourceId: mailboxId },
    { sourceId, extra: true },
  ])(
    "rejects invalid folder parameters before transport: %j",
    async (input) => {
      const env = setup({});
      expect(await env.folders.execute(input)).toMatchObject({ ok: false });
      expect(env.request).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid folder counts instead of reporting them", async () => {
    const env = setup({
      "sources.get_folder_hierarchy.v1": {
        sourceId,
        nodes: [{ ...nodes[0], totalLeafChildren: -1 }],
      },
    });
    expect(await env.folders.execute({ sourceId })).toMatchObject({
      ok: false,
    });
  });

  it("gates browsing independently and preserves existing tools", async () => {
    const env = setup({});
    env.supports.mockImplementation((method) =>
      [
        "search.query.v1",
        "outlook.get_conversation.v1",
        "search.metadata_fields.v1",
      ].includes(method),
    );
    expect(env.tools.slice(0, 3).every((tool) => tool.isAvailable())).toBe(
      true,
    );
    expect(env.list.isAvailable()).toBe(false);
    expect(env.folders.isAvailable()).toBe(false);
    expect(await env.list.execute({})).toMatchObject({ ok: false });
    expect(await env.folders.execute({ sourceId })).toMatchObject({
      ok: false,
    });
    expect(env.request).not.toHaveBeenCalled();
  });

  it("does not make RPCs for cancelled browsing calls", async () => {
    const env = setup({});
    const context = {
      toolCallId: "call",
      messageId: "message",
      chatId: "chat",
      signal: AbortSignal.abort(),
    };
    expect(await env.list.execute({}, context)).toMatchObject({ ok: false });
    expect(await env.folders.execute({ sourceId }, context)).toMatchObject({
      ok: false,
    });
    expect(env.request).not.toHaveBeenCalled();
  });
});
