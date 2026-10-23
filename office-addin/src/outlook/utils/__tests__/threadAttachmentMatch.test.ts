import { describe, expect, it } from "vitest";

import { matchThreadAttachments } from "../threadAttachmentMatch";

import type {
  ParsedThread,
  ThreadAttachment,
  ThreadMessage,
} from "../parsedThread";

function makeAttachment(
  overrides: Partial<ThreadAttachment> = {},
): ThreadAttachment {
  return {
    id: "att",
    filename: "file.bin",
    mimeType: "application/octet-stream",
    size: 0,
    contentBytes: null,
    isInline: false,
    contentId: null,
    unavailableReason: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: "<m@x>",
    internetMessageId: "<m@x>",
    subject: "Subject",
    from: { name: "Sender", address: "sender@x" },
    to: [],
    cc: [],
    date: "2026-03-01T10:00:00Z",
    bodyText: "body",
    bodyHtml: null,
    attachments: [],
    ...overrides,
  };
}

function makeThread(messages: ThreadMessage[]): ParsedThread {
  return {
    conversationId: "conv-1",
    subject: "Project kickoff",
    messages,
    incomplete: false,
  };
}

const office = (id: string, name: string, size: number, isInline = false) => ({
  id,
  name,
  size,
  isInline,
});

describe("matchThreadAttachments", () => {
  const earlier = makeMessage({
    id: "<earlier@x>",
    internetMessageId: "<earlier@x>",
    attachments: [
      makeAttachment({ id: "e:1", filename: "plan.pdf", size: 10 }),
    ],
  });

  it("matches the open message's files by name and size", () => {
    const thread = makeThread([
      earlier,
      makeMessage({
        id: "<open@x>",
        internetMessageId: "<open@x>",
        attachments: [
          makeAttachment({ id: "o:1", filename: "plan.pdf", size: 20 }),
          makeAttachment({ id: "o:2", filename: "budget.xlsx", size: 30 }),
        ],
      }),
    ]);

    const matches = matchThreadAttachments(thread, "<open@x>", [
      office("A", "budget.xlsx", 30),
      office("B", "plan.pdf", 20),
    ]);

    expect(matches.get("A")).toEqual({
      messageId: "<open@x>",
      attachmentId: "o:2",
    });
    expect(matches.get("B")).toEqual({
      messageId: "<open@x>",
      attachmentId: "o:1",
    });
  });

  it("finds the open message by its fallback Graph id", () => {
    const thread = makeThread([
      makeMessage({
        id: "graph-id",
        internetMessageId: null,
        attachments: [makeAttachment({ id: "g:1", filename: "a.txt" })],
      }),
    ]);

    expect(
      matchThreadAttachments(thread, "graph-id", [office("A", "a.txt", 0)]).get(
        "A",
      ),
    ).toEqual({ messageId: "graph-id", attachmentId: "g:1" });
  });

  it("pairs duplicate names in order when sizes differ", () => {
    const thread = makeThread([
      makeMessage({
        attachments: [
          makeAttachment({ id: "m:1", filename: "scan.png", size: 101 }),
          makeAttachment({ id: "m:2", filename: "scan.png", size: 202 }),
        ],
      }),
    ]);

    const matches = matchThreadAttachments(thread, "<m@x>", [
      office("A", "scan.png", 1),
      office("B", "scan.png", 2),
    ]);

    expect(matches.get("A")?.attachmentId).toBe("m:1");
    expect(matches.get("B")?.attachmentId).toBe("m:2");
  });

  it("lets an exact size match win over order", () => {
    const thread = makeThread([
      makeMessage({
        attachments: [
          makeAttachment({ id: "m:1", filename: "scan.png", size: 101 }),
          makeAttachment({ id: "m:2", filename: "scan.png", size: 202 }),
        ],
      }),
    ]);

    const matches = matchThreadAttachments(thread, "<m@x>", [
      office("A", "scan.png", 202),
      office("B", "scan.png", 7),
    ]);

    expect(matches.get("A")?.attachmentId).toBe("m:2");
    expect(matches.get("B")?.attachmentId).toBe("m:1");
  });

  it("skips inline attachments on both sides", () => {
    const thread = makeThread([
      makeMessage({
        attachments: [
          makeAttachment({
            id: "m:logo",
            filename: "logo.png",
            isInline: true,
          }),
        ],
      }),
    ]);

    expect(
      matchThreadAttachments(thread, "<m@x>", [office("A", "logo.png", 0)])
        .size,
    ).toBe(0);
    expect(
      matchThreadAttachments(
        makeThread([
          makeMessage({
            attachments: [makeAttachment({ id: "m:1", filename: "logo.png" })],
          }),
        ]),
        "<m@x>",
        [office("A", "logo.png", 0, true)],
      ).size,
    ).toBe(0);
  });

  it("returns nothing without the open message or a match", () => {
    const thread = makeThread([earlier]);
    expect(
      matchThreadAttachments(thread, "<other@x>", [office("A", "plan.pdf", 10)])
        .size,
    ).toBe(0);
    expect(
      matchThreadAttachments(thread, null, [office("A", "plan.pdf", 10)]).size,
    ).toBe(0);
    expect(
      matchThreadAttachments(null, "<earlier@x>", [office("A", "plan.pdf", 10)])
        .size,
    ).toBe(0);
    expect(
      matchThreadAttachments(thread, "<earlier@x>", [
        office("A", "other.pdf", 10),
      ]).size,
    ).toBe(0);
  });
});
