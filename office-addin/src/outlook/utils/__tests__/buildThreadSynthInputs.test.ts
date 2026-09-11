import { describe, expect, it } from "vitest";

import { buildThreadSynthInputs } from "../buildThreadSynthInputs";
import { parseEmlBytes } from "../parsedEmail";
import { EmailTrimError } from "../trimRawEmlBytes";

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
    attachments: [],
    ...overrides,
  };
}

const NO_DISMISSALS = new Set<string>();

const CRLF = "\r\n";

/** A forwarded email carrying `keep.pdf` and `deep.pdf`, padded past the dedup floor. */
function buildForwardedEml(): string {
  const filler = "x".repeat(600);
  return (
    `From: c@example.com${CRLF}` +
    `Subject: Re: budget numbers${CRLF}` +
    `Content-Type: multipart/mixed; boundary="----INNER"${CRLF}${CRLF}` +
    `------INNER${CRLF}` +
    `Content-Type: text/plain${CRLF}${CRLF}` +
    `Forwarded body. ${filler}${CRLF}` +
    `------INNER${CRLF}` +
    `Content-Type: application/pdf; name="keep.pdf"${CRLF}` +
    `Content-Disposition: attachment; filename="keep.pdf"${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `S0VFUA==${CRLF}` +
    `------INNER${CRLF}` +
    `Content-Type: application/pdf; name="deep.pdf"${CRLF}` +
    `Content-Disposition: attachment; filename="deep.pdf"${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `REVFUA==${CRLF}` +
    `------INNER--${CRLF}`
  );
}

/** A thread attachment the way `fetchCurrentThread` delivers a forward: raw bytes plus the parsed `nested`. */
async function makeForward(id: string): Promise<ThreadAttachment> {
  const contentBytes = new TextEncoder().encode(buildForwardedEml()).buffer;
  const nested = await parseEmlBytes(contentBytes, { idPrefix: `${id}/` });
  return makeAttachment({
    id,
    filename: "Forwarded.eml",
    mimeType: "message/rfc822",
    size: contentBytes.byteLength,
    contentBytes,
    nested: nested!,
  });
}

function emittedText(input: {
  attachments: { contentBytes: ArrayBuffer | Uint8Array }[];
}): string {
  return new TextDecoder().decode(input.attachments[0].contentBytes);
}

describe("buildThreadSynthInputs", () => {
  describe("a dismissed part inside a forwarded email", () => {
    it("cuts it out of the forward's bytes and keeps the rest", async () => {
      const forward = await makeForward("<m1@x>:fwd");
      expect(forward.nested?.attachments.map((a) => a.id)).toEqual([
        "<m1@x>:fwd/att-0",
        "<m1@x>:fwd/att-1",
      ]);

      const [input] = buildThreadSynthInputs(
        [makeMessage({ id: "<m1@x>", attachments: [forward] })],
        new Set(["<m1@x>:fwd/att-1"]),
      );

      expect(input.attachments).toHaveLength(1);
      const text = emittedText(input);
      expect(text).toContain("keep.pdf");
      expect(text).toContain("Forwarded body.");
      expect(text).not.toContain("deep.pdf");
    });

    it("passes the forward through untouched when nothing inside it is dismissed", async () => {
      const forward = await makeForward("<m1@x>:fwd");

      const [input] = buildThreadSynthInputs(
        [makeMessage({ id: "<m1@x>", attachments: [forward] })],
        NO_DISMISSALS,
      );

      expect(emittedText(input)).toBe(buildForwardedEml());
    });

    it("trims before the byte-dedup, so a trimmed copy is not mistaken for its untrimmed twin", async () => {
      const messages = [
        makeMessage({
          id: "<m1@x>",
          attachments: [await makeForward("<m1@x>:fwd")],
        }),
        makeMessage({
          id: "<m2@x>",
          attachments: [await makeForward("<m2@x>:fwd")],
        }),
      ];

      const inputs = buildThreadSynthInputs(
        messages,
        new Set(["<m2@x>:fwd/att-1"]),
      );

      expect(inputs[0].attachments).toHaveLength(1);
      expect(emittedText(inputs[0])).toContain("deep.pdf");
      // Same fetched bytes, but the user kept less of the second copy.
      expect(inputs[1].attachments).toHaveLength(1);
      expect(inputs[1].bodyText).not.toContain("identical to");
      expect(emittedText(inputs[1])).not.toContain("deep.pdf");
    });

    it("refuses to build when the dismissal cannot be cut out", async () => {
      const forward = await makeForward("<m1@x>:fwd");
      // Bytes the trimmer cannot walk, with a nested list that still lets the
      // user address a part inside.
      const unwalkable = makeAttachment({
        ...forward,
        contentBytes: new TextEncoder().encode("this is not an email").buffer,
      });

      expect(() =>
        buildThreadSynthInputs(
          [makeMessage({ id: "<m1@x>", attachments: [unwalkable] })],
          new Set(["<m1@x>:fwd/att-1"]),
        ),
      ).toThrow(EmailTrimError);
      expect(() =>
        buildThreadSynthInputs(
          [makeMessage({ id: "<m1@x>", attachments: [unwalkable] })],
          new Set(["<m1@x>:fwd"]),
        ),
      ).not.toThrow();
    });
  });

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
        attachments: [
          makeAttachment({
            id: "<m@x>:ref",
            filename: "a&b.docx",
            contentBytes: null,
            unavailableReason:
              "cloud attachment (OneDrive/SharePoint): a&b.docx — not inlined",
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

  it("keeps every byte-distinct attachment exactly once across a long chain, collapsing only re-forwards", () => {
    const A = () => bytes(600, 0xaa); // the file re-forwarded down the whole chain
    const messages = [
      makeMessage({
        id: "<m1@x>",
        from: { name: "Anna", address: "anna@x" },
        attachments: [
          makeAttachment({
            id: "<m1@x>:A",
            filename: "spec.pdf",
            contentBytes: A(),
            size: 600,
          }),
        ],
      }),
      makeMessage({
        id: "<m2@x>",
        attachments: [
          makeAttachment({
            id: "<m2@x>:A",
            filename: "spec.pdf",
            contentBytes: A(),
            size: 600,
          }), // dup
          makeAttachment({
            id: "<m2@x>:B",
            filename: "review.docx",
            contentBytes: bytes(700, 0xbb),
            size: 700,
          }), // unique
        ],
      }),
      makeMessage({
        id: "<m3@x>",
        attachments: [
          makeAttachment({
            id: "<m3@x>:A",
            filename: "spec.pdf",
            contentBytes: A(),
            size: 600,
          }), // dup
          makeAttachment({
            id: "<m3@x>:C",
            filename: "budget.xlsx",
            contentBytes: bytes(800, 0xcc),
            size: 800,
          }), // unique
        ],
      }),
      makeMessage({
        id: "<m4@x>",
        attachments: [
          // same filename as spec.pdf but DIFFERENT bytes → a real new version, must be kept
          makeAttachment({
            id: "<m4@x>:A2",
            filename: "spec.pdf",
            contentBytes: bytes(600, 0xdd),
            size: 600,
          }),
        ],
      }),
      makeMessage({
        id: "<m5@x>",
        attachments: [
          makeAttachment({
            id: "<m5@x>:D",
            filename: "minutes.pdf",
            contentBytes: bytes(900, 0xee),
            size: 900,
          }), // unique
        ],
      }),
      makeMessage({
        id: "<m6@x>",
        attachments: [
          makeAttachment({
            id: "<m6@x>:A",
            filename: "spec.pdf",
            contentBytes: A(),
            size: 600,
          }), // dup again
        ],
      }),
    ];

    const inputs = buildThreadSynthInputs(messages, NO_DISMISSALS);

    // Collect every emitted attachment across the whole chain.
    const emitted = inputs.flatMap((input) => input.attachments);
    // 5 byte-distinct streams: A, B, C, A2 (new version), D — each exactly once.
    expect(emitted).toHaveLength(5);

    const emittedBytes = emitted.map(
      (att) =>
        new Uint8Array(
          att.contentBytes instanceof Uint8Array
            ? att.contentBytes
            : new Uint8Array(att.contentBytes),
        )[0],
    );
    // First byte of each distinct stream's fill — proves all five survive.
    expect(emittedBytes.sort()).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee]);

    // The canonical spec.pdf is the earliest copy (m1); later identical
    // re-forwards (m2, m3, m6) are dropped and markered.
    expect(inputs[0].attachments.map((a) => a.filename)).toEqual(["spec.pdf"]);
    expect(inputs[1].attachments.map((a) => a.filename)).toEqual([
      "review.docx",
    ]);
    expect(inputs[1].bodyText).toContain("identical to");
    expect(inputs[2].attachments.map((a) => a.filename)).toEqual([
      "budget.xlsx",
    ]);
    expect(inputs[3].attachments.map((a) => a.filename)).toEqual(["spec.pdf"]); // new version kept
    expect(inputs[5].attachments).toHaveLength(0);
    expect(inputs[5].bodyText).toContain("identical to");
  });

  it("appends a synthetic partial-thread note when the thread is incomplete", () => {
    const inputs = buildThreadSynthInputs([makeMessage()], NO_DISMISSALS, true);

    expect(inputs).toHaveLength(2);
    expect(inputs[1].subject).toBe("[Partial conversation]");
    expect(inputs[1].bodyText).toContain("partial");
  });
});
