import { describe, expect, it } from "vitest";

import { buildThreadSynthInputs } from "../buildThreadSynthInputs";

import type { ThreadAttachment, ThreadMessage } from "../parsedThread";

function bytes(length: number, fill: number): ArrayBuffer {
  return new Uint8Array(length).fill(fill).buffer;
}

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
    fullBodyText: "body",
    fullBodyHtml: null,
    attachments: [],
    ...overrides,
  };
}

const NO_DISMISSALS = new Set<string>();

describe("buildThreadSynthInputs", () => {
  it("keeps one canonical copy of byte-identical attachments and marks the duplicates", () => {
    const shared = () => bytes(600, 0xaa);
    const messages = [
      makeMessage({
        id: "<m1@x>",
        from: { name: "Anna", address: "anna@x" },
        attachments: [
          makeAttachment({
            id: "<m1@x>:a1",
            filename: "Lastenheft.pdf",
            contentBytes: shared(),
            size: 600,
          }),
        ],
      }),
      makeMessage({
        id: "<m2@x>",
        attachments: [
          makeAttachment({
            id: "<m2@x>:a1",
            filename: "Lastenheft.pdf",
            contentBytes: shared(),
            size: 600,
          }),
        ],
      }),
      makeMessage({
        id: "<m3@x>",
        attachments: [
          makeAttachment({
            id: "<m3@x>:a1",
            filename: "Lastenheft.pdf",
            contentBytes: bytes(600, 0xbb), // different version → kept
            size: 600,
          }),
        ],
      }),
    ];

    const inputs = buildThreadSynthInputs(messages, NO_DISMISSALS);

    // Earliest message keeps the real copy.
    expect(inputs[0].attachments).toHaveLength(1);
    // Identical duplicate dropped, disclosed by a provenance marker.
    expect(inputs[1].attachments).toHaveLength(0);
    expect(inputs[1].bodyText).toContain("identical to");
    expect(inputs[1].bodyText).toContain("Lastenheft.pdf");
    expect(inputs[1].bodyText).toContain("Anna"); // canonical holder's label
    // A different version of the same filename is real content → kept.
    expect(inputs[2].attachments).toHaveLength(1);
  });

  it("does not dedup attachments below the minimum size (marker would cost more than the bytes)", () => {
    const tiny = () => bytes(64, 0x01);
    const messages = [
      makeMessage({
        id: "<m1@x>",
        attachments: [
          makeAttachment({ id: "<m1@x>:a", contentBytes: tiny(), size: 64 }),
        ],
      }),
      makeMessage({
        id: "<m2@x>",
        attachments: [
          makeAttachment({ id: "<m2@x>:a", contentBytes: tiny(), size: 64 }),
        ],
      }),
    ];

    const inputs = buildThreadSynthInputs(messages, NO_DISMISSALS);

    expect(inputs[0].attachments).toHaveLength(1);
    expect(inputs[1].attachments).toHaveLength(1);
    expect(inputs[1].bodyText).not.toContain("identical to");
  });

  it("discloses byte-less attachments (cloud / un-fetchable items) as markers", () => {
    const messages = [
      makeMessage({
        attachments: [
          makeAttachment({
            id: "<m@x>:ref",
            filename: "shared.docx",
            contentBytes: null,
            unavailableReason:
              "cloud attachment (OneDrive/SharePoint): shared.docx — not inlined",
          }),
        ],
      }),
    ];

    const inputs = buildThreadSynthInputs(messages, NO_DISMISSALS);

    expect(inputs[0].attachments).toHaveLength(0);
    expect(inputs[0].bodyText).toContain("cloud attachment");
    expect(inputs[0].bodyText).toContain("shared.docx");
  });

  it("appends markers into an html body as escaped paragraphs", () => {
    const messages = [
      makeMessage({
        bodyText: null,
        bodyHtml: "<p>Hallo</p>",
        fullBodyText: null,
        fullBodyHtml: "<p>Hallo</p>",
        attachments: [
          makeAttachment({
            id: "<m@x>:ref",
            filename: "a&b.docx",
            contentBytes: null,
            unavailableReason: "cloud attachment (OneDrive/SharePoint): a&b.docx — not inlined",
          }),
        ],
      }),
    ];

    const inputs = buildThreadSynthInputs(messages, NO_DISMISSALS);

    expect(inputs[0].bodyHtml).toContain("<p>Hallo</p>");
    expect(inputs[0].bodyHtml).toContain("<p>[cloud attachment");
    expect(inputs[0].bodyHtml).toContain("a&amp;b.docx"); // html-escaped
    expect(inputs[0].bodyText).toBeNull();
  });

  it("marks an image-only message so it isn't invisibly empty", () => {
    const messages = [
      makeMessage({
        bodyText: "",
        bodyHtml: null,
        fullBodyText: "",
        fullBodyHtml: null,
        attachments: [
          makeAttachment({
            id: "<m@x>:img",
            filename: "logo.png",
            isInline: true,
            contentBytes: bytes(10, 0x01),
          }),
        ],
      }),
    ];

    const inputs = buildThreadSynthInputs(messages, NO_DISMISSALS);

    expect(inputs[0].bodyText).toContain("image-only message");
    expect(inputs[0].bodyText).toContain("logo.png");
  });

  it("skips dismissed attachments", () => {
    const messages = [
      makeMessage({
        attachments: [
          makeAttachment({
            id: "<m@x>:a",
            filename: "secret.pdf",
            contentBytes: bytes(600, 0x09),
            size: 600,
          }),
        ],
      }),
    ];

    const inputs = buildThreadSynthInputs(messages, new Set(["<m@x>:a"]));

    expect(inputs[0].attachments).toHaveLength(0);
    expect(inputs[0].bodyText).not.toContain("identical to");
  });

  it("appends a synthetic partial-thread note when the thread is incomplete", () => {
    const inputs = buildThreadSynthInputs(
      [makeMessage()],
      NO_DISMISSALS,
      true,
    );

    expect(inputs).toHaveLength(2);
    expect(inputs[1].subject).toBe("[Partial conversation]");
    expect(inputs[1].bodyText).toContain("partial");
  });
});
