import { describe, expect, it } from "vitest";

import { parseEmlBytes } from "../parsedEmail";
import {
  synthesizeThreadEml,
  type ThreadMessageInput,
} from "../synthesizeThreadEml";

function makeAttachmentBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const TEXT_PLAIN_PREFIX = "text/plain";
const APP_PDF_PREFIX = "application/pdf";

describe("synthesizeThreadEml", () => {
  it("produces a postal-mime-parsable .eml with nested rfc822 attachments per message", async () => {
    const messages: ThreadMessageInput[] = [
      {
        internetMessageId: "<msg-1@example.com>",
        subject: "Kickoff Kundenportal 2.0",
        from: { name: "Daniel Person", address: "daniel@example.com" },
        to: [{ name: "Team", address: "team@example.com" }],
        cc: [],
        date: "2026-03-01T09:00:00Z",
        bodyText: "Erste Nachricht",
        bodyHtml: null,
        attachments: [],
      },
      {
        internetMessageId: "<msg-2@example.com>",
        subject: "Re: Kickoff Kundenportal 2.0",
        from: { name: "Bob Reviewer", address: "bob@example.com" },
        to: [{ name: "Daniel Person", address: "daniel@example.com" }],
        cc: [],
        date: "2026-03-05T10:30:00Z",
        bodyText: "Hier ist das Lastenheft.",
        bodyHtml: null,
        attachments: [
          {
            filename: "Lastenheft.pdf",
            mimeType: APP_PDF_PREFIX,
            contentBytes: makeAttachmentBytes("PDF-V1-CONTENT"),
          },
        ],
      },
      {
        internetMessageId: "<msg-3@example.com>",
        subject: "Re: Kickoff Kundenportal 2.0",
        from: { name: "Daniel Person", address: "daniel@example.com" },
        to: [{ name: "Bob Reviewer", address: "bob@example.com" }],
        cc: [],
        date: "2026-03-12T14:00:00Z",
        bodyText: null,
        bodyHtml: "<p>Aktualisierte Version anbei.</p>",
        attachments: [
          {
            filename: "Lastenheft.pdf",
            mimeType: APP_PDF_PREFIX,
            contentBytes: makeAttachmentBytes("PDF-V2-CONTENT"),
          },
        ],
      },
    ];

    const file = synthesizeThreadEml({
      subject: "Re: Kickoff Kundenportal 2.0",
      messages,
    });

    expect(file.type).toBe("message/rfc822");
    expect(file.name).toBe("Re_Kickoff_Kundenportal_2.0.eml");

    const buffer = await file.arrayBuffer();
    const outer = await parseEmlBytes(buffer);
    expect(outer).not.toBeNull();
    if (!outer) return;

    expect(outer.subject).toBe("Re: Kickoff Kundenportal 2.0");
    expect(outer.attachments).toHaveLength(3);

    for (let i = 0; i < outer.attachments.length; i += 1) {
      const nestedAttachment = outer.attachments[i];
      expect(nestedAttachment.mimeType).toContain("message/rfc822");

      const nestedBytes = await nestedAttachment.toFile().arrayBuffer();
      const nested = await parseEmlBytes(nestedBytes);
      expect(nested).not.toBeNull();
      if (!nested) return;

      const expected = messages[i];
      expect(nested.subject).toBe(expected.subject);
      expect(nested.messageId).toBe(expected.internetMessageId);
      expect(nested.from?.address).toBe(expected.from?.address);
      expect(nested.to[0]?.address).toBe(expected.to[0]?.address);
      if (expected.bodyHtml) {
        expect(nested.html ?? "").toContain("Aktualisierte Version anbei.");
      } else if (expected.bodyText) {
        expect(nested.text ?? "").toContain(expected.bodyText);
      }
      expect(nested.attachments).toHaveLength(expected.attachments.length);
      if (expected.attachments.length > 0) {
        const att = nested.attachments[0];
        expect(att.filename).toBe(expected.attachments[0].filename);
        const attBytes = await att.toFile().arrayBuffer();
        const text = new TextDecoder().decode(new Uint8Array(attBytes));
        const sourceText = new TextDecoder().decode(
          expected.attachments[0].contentBytes instanceof Uint8Array
            ? expected.attachments[0].contentBytes
            : new Uint8Array(expected.attachments[0].contentBytes),
        );
        expect(text).toBe(sourceText);
      }
    }
  });

  it("preserves non-ASCII subjects and bodies through round-trip", async () => {
    const messages: ThreadMessageInput[] = [
      {
        internetMessageId: "<u1@example.com>",
        subject: "Grüße aus München – ÄÖÜß",
        from: { name: "Müller", address: "mueller@example.com" },
        to: [],
        cc: [],
        date: "2026-04-01T08:00:00Z",
        bodyText: "Heizölrückstoßabdämpfung — café résumé",
        bodyHtml: null,
        attachments: [],
      },
    ];

    const file = synthesizeThreadEml({
      subject: "Grüße — Thread",
      messages,
    });

    const outer = await parseEmlBytes(await file.arrayBuffer());
    expect(outer).not.toBeNull();
    if (!outer) return;
    expect(outer.subject).toBe("Grüße — Thread");

    const nested = await parseEmlBytes(
      await outer.attachments[0].toFile().arrayBuffer(),
    );
    expect(nested).not.toBeNull();
    if (!nested) return;
    expect(nested.subject).toBe("Grüße aus München – ÄÖÜß");
    expect(nested.from?.name).toBe("Müller");
    expect(nested.text ?? "").toContain(
      "Heizölrückstoßabdämpfung — café résumé",
    );
  });

  it("emits a single-body nested message when attachments are empty", async () => {
    const file = synthesizeThreadEml({
      subject: "No-attachment thread",
      messages: [
        {
          internetMessageId: null,
          subject: "Single body",
          from: { name: "", address: "anon@example.com" },
          to: [],
          cc: [],
          date: null,
          bodyText: "plain body only",
          bodyHtml: null,
          attachments: [],
        },
      ],
    });

    const outer = await parseEmlBytes(await file.arrayBuffer());
    expect(outer).not.toBeNull();
    if (!outer) return;
    expect(outer.attachments).toHaveLength(1);

    const nested = await parseEmlBytes(
      await outer.attachments[0].toFile().arrayBuffer(),
    );
    expect(nested).not.toBeNull();
    if (!nested) return;
    expect(nested.text?.trim()).toBe("plain body only");
    expect(nested.attachments).toHaveLength(0);
    expect(nested.html).toBeNull();
    expect(nested.from?.address).toBe("anon@example.com");
    // Body declared text/plain only — postal-mime should not synthesize HTML.
    const nestedHeaderText = new TextDecoder().decode(
      new Uint8Array(await outer.attachments[0].toFile().arrayBuffer()),
    );
    expect(nestedHeaderText).toContain(TEXT_PLAIN_PREFIX);
  });

  it("splits long non-ASCII subjects into ≤75 char RFC 2047 encoded-words", async () => {
    // Concatenate ~60 chars of umlaut-heavy German — easily produces a
    // single base64 token >75 chars if not chunked.
    const longSubject =
      "Grüße ÄÖÜßéàü 漢字テスト — Lastenheft v3 Kickoff Kundenportal 2.0 Sommer 2026";
    const file = synthesizeThreadEml({
      subject: longSubject,
      messages: [
        {
          internetMessageId: "<long@example.com>",
          subject: longSubject,
          from: { name: "Müller", address: "m@example.com" },
          to: [],
          cc: [],
          date: "2026-05-01T08:00:00Z",
          bodyText: "body",
          bodyHtml: null,
          attachments: [],
        },
      ],
    });

    const rawBytes = new Uint8Array(await file.arrayBuffer());
    const rawText = new TextDecoder().decode(rawBytes);

    // Every encoded-word token must fit the RFC 2047 75-char cap.
    const encodedWordMatches = rawText.match(/=\?utf-8\?B\?[^?]+\?=/g) ?? [];
    expect(encodedWordMatches.length).toBeGreaterThan(1); // proves we did split
    for (const word of encodedWordMatches) {
      expect(word.length).toBeLessThanOrEqual(75);
    }

    // Round-trip: postal-mime should join the folded continuation lines and
    // decode the full subject losslessly.
    const outer = await parseEmlBytes(await file.arrayBuffer());
    expect(outer?.subject).toBe(longSubject);
    const nested = await parseEmlBytes(
      await outer!.attachments[0].toFile().arrayBuffer(),
    );
    expect(nested?.subject).toBe(longSubject);
  });

  it("encodes non-ASCII attachment filenames per RFC 2231 (filename*=utf-8'')", async () => {
    const filename = "Anhang ÄÖÜ ñ — résumé.pdf";
    const file = synthesizeThreadEml({
      subject: "Attachment filename test",
      messages: [
        {
          internetMessageId: "<a@example.com>",
          subject: "Attachment filename test",
          from: { name: "A", address: "a@example.com" },
          to: [],
          cc: [],
          date: "2026-05-01T08:00:00Z",
          bodyText: "see attached",
          bodyHtml: null,
          attachments: [
            {
              filename,
              mimeType: APP_PDF_PREFIX,
              contentBytes: makeAttachmentBytes("FAKE-PDF-CONTENT"),
            },
          ],
        },
      ],
    });

    const outerBytes = new Uint8Array(await file.arrayBuffer());
    const nestedFile = (await parseEmlBytes(
      outerBytes.buffer,
    ))!.attachments[0].toFile();
    const nestedRaw = new TextDecoder().decode(
      new Uint8Array(await nestedFile.arrayBuffer()),
    );

    // RFC 2231 form (filename*=utf-8''…) — never an RFC 2047 encoded-word
    // inside a quoted-string.
    expect(nestedRaw).toMatch(/filename\*=utf-8''/i);
    expect(nestedRaw).not.toMatch(/filename="[^"]*=\?utf-8/i);

    // Round-trip filename via postal-mime.
    const nestedParsed = await parseEmlBytes(await nestedFile.arrayBuffer());
    expect(nestedParsed?.attachments[0].filename).toBe(filename);
  });
});
