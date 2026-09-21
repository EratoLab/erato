import { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";
import { describe, expect, it, vi } from "vitest";

import { createSidecarChatTools } from "./chatTools";
import { resolveSidecarMailboxId } from "./mailboxAccess";

import type { OutlookGetConversationV1Result } from "@erato/desktop-sidecar-protocol";

const mailboxId = "a".repeat(32);
const context = { toolCallId: "call", messageId: "message", chatId: "chat" };
const anchor = { mailboxId, internetMessageId: "<email@example.test>" };

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
