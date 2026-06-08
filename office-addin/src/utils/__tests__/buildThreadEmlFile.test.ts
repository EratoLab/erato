import { describe, expect, it } from "vitest";

import { buildThreadEmlFile } from "../buildThreadEmlFile";
import { parseEmlBytes } from "../parsedEmail";

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

function makeThread(
  messages: ThreadMessage[],
  overrides: Partial<ParsedThread> = {},
): ParsedThread {
  return {
    conversationId: "conv-1",
    subject: "Project kickoff",
    messages,
    incomplete: false,
    ...overrides,
  };
}

const NO_DISMISSALS = new Set<string>();

describe("buildThreadEmlFile", () => {
  it("produces a real .eml whose bytes are the actual content (not a zero-filled placeholder)", async () => {
    const messages = [
      makeMessage({
        id: "<m1@x>",
        subject: "Project kickoff",
        bodyText: "Let's get started on Monday.",
      }),
      makeMessage({
        id: "<m2@x>",
        from: { name: "Anna", address: "anna@x" },
        bodyText: "Sounds good, I'll prepare the deck.",
        attachments: [
          makeAttachment({
            id: "<m2@x>:a1",
            filename: "Deck.pdf",
            mimeType: "application/pdf",
            contentBytes: new Uint8Array(700).fill(0xab).buffer,
            size: 700,
          }),
        ],
      }),
    ];

    const file = buildThreadEmlFile(
      makeThread(messages),
      messages,
      NO_DISMISSALS,
    );

    expect(file).not.toBeNull();
    const buffer = await file!.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Regression guard: the old preview File was `new Uint8Array(size)` — all
    // zeroes. Real synthesized bytes must carry the MIME scaffolding and the
    // message content, so they are emphatically not all-zero.
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.some((byte) => byte !== 0)).toBe(true);

    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("Content-Type: multipart/mixed");
    expect(text).toContain("message/rfc822");
    // Both message bodies are present (base64-encoded bodies decode below via
    // a full parse, but the envelope subject is ASCII in the header block).
    expect(file!.type).toBe("message/rfc822");
  });

  it("round-trips through parseEmlBytes and preserves the nested messages as attachments", async () => {
    const messages = [
      makeMessage({ id: "<m1@x>", bodyText: "first" }),
      makeMessage({ id: "<m2@x>", bodyText: "second" }),
    ];

    const file = buildThreadEmlFile(
      makeThread(messages),
      messages,
      NO_DISMISSALS,
    );

    const parsed = await parseEmlBytes(await file!.arrayBuffer());
    expect(parsed).not.toBeNull();
    // Each thread member is wrapped as a nested message/rfc822 part, so the
    // outer envelope exposes one attachment per included message.
    expect(parsed!.attachments.length).toBe(2);
  });

  it("excludes attachments whose ids are in dismissedAttachmentIds", async () => {
    const messages = [
      makeMessage({
        id: "<m1@x>",
        attachments: [
          makeAttachment({
            id: "<m1@x>:keep",
            filename: "Keep.pdf",
            mimeType: "application/pdf",
            contentBytes: new Uint8Array(600).fill(0x01).buffer,
            size: 600,
          }),
          makeAttachment({
            id: "<m1@x>:drop",
            filename: "Drop.pdf",
            mimeType: "application/pdf",
            contentBytes: new Uint8Array(600).fill(0x02).buffer,
            size: 600,
          }),
        ],
      }),
    ];

    const file = buildThreadEmlFile(
      makeThread(messages),
      messages,
      new Set(["<m1@x>:drop"]),
    );

    const text = new TextDecoder().decode(await file!.arrayBuffer());
    // ASCII filenames are emitted literally in the MIME headers, so a kept
    // attachment is named in the output and a dismissed one is absent entirely
    // (no part, no provenance marker — it is skipped before any disclosure).
    expect(text).toContain("Keep.pdf");
    expect(text).not.toContain("Drop.pdf");
  });

  it("propagates thread.incomplete by appending the partial-conversation note", async () => {
    const messages = [makeMessage({ id: "<m1@x>" })];

    const complete = buildThreadEmlFile(
      makeThread(messages, { incomplete: false }),
      messages,
      NO_DISMISSALS,
    );
    const incomplete = buildThreadEmlFile(
      makeThread(messages, { incomplete: true }),
      messages,
      NO_DISMISSALS,
    );

    const completeText = new TextDecoder().decode(
      await complete!.arrayBuffer(),
    );
    const incompleteText = new TextDecoder().decode(
      await incomplete!.arrayBuffer(),
    );
    // The synthetic note carries the ASCII subject "[Partial conversation]",
    // emitted literally in the nested message's header block.
    expect(completeText).not.toContain("[Partial conversation]");
    expect(incompleteText).toContain("[Partial conversation]");
  });

  it("returns null when every message is dismissed (nothing to send)", () => {
    const messages = [makeMessage({ id: "<m1@x>" })];
    const file = buildThreadEmlFile(makeThread(messages), [], NO_DISMISSALS);
    expect(file).toBeNull();
  });
});
