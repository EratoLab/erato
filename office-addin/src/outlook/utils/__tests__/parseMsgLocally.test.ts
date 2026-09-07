import { describe, expect, it } from "vitest";

import {
  buildRichMsg,
  cp1251,
  utf8,
  type RichMsgOptions,
} from "../../../test/fixtures/msg";
import { parseMsgLocallyToEml, readMsgMessage } from "../parseMsgLocally";
import { parseEmlBytes } from "../parsedEmail";

const SAMPLE: Omit<RichMsgOptions, "encoding"> = {
  messageId: "<local@example.com>",
  subject: "Angebot für Straßenbeleuchtung",
  body: "Guten Tag,\n\nanbei das Angebot.\n\nGrüße",
  senderName: "Jörg Müller",
  senderAddress: "joerg@example.com",
  to: [{ name: "Anna Schmidt", address: "anna@example.com" }],
  cc: [{ name: "Team", address: "team@example.com" }],
  sentAt: new Date("2026-03-04T09:15:00.000Z"),
  attachments: [
    {
      filename: "Angebot.pdf",
      mimeType: "application/pdf",
      content: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
    },
  ],
};

async function parseThroughEml(bytes: Uint8Array) {
  const eml = parseMsgLocallyToEml(bytes, { filename: "sample.eml" });
  expect(eml).not.toBeNull();
  return parseEmlBytes(await eml!.arrayBuffer(), { filename: "sample.eml" });
}

describe.each(["unicode", "ansi"] as const)(
  "readMsgMessage (%s encoding)",
  (encoding) => {
    const bytes = () => buildRichMsg({ ...SAMPLE, encoding });

    it("reads every field the synthesizer needs", () => {
      const message = readMsgMessage(bytes());

      expect(message).not.toBeNull();
      expect(message?.internetMessageId).toBe("<local@example.com>");
      expect(message?.subject).toBe("Angebot für Straßenbeleuchtung");
      expect(message?.from).toEqual({
        name: "Jörg Müller",
        address: "joerg@example.com",
      });
      expect(message?.to).toEqual([
        { name: "Anna Schmidt", address: "anna@example.com" },
      ]);
      expect(message?.cc).toEqual([
        { name: "Team", address: "team@example.com" },
      ]);
      expect(message?.date).toBe("2026-03-04T09:15:00.000Z");
      expect(message?.bodyText).toContain("anbei das Angebot");
      expect(message?.attachments).toHaveLength(1);
      expect(message?.attachments[0]).toMatchObject({
        filename: "Angebot.pdf",
        mimeType: "application/pdf",
      });
    });

    it("round-trips through the synthesized .eml", async () => {
      const parsed = await parseThroughEml(bytes());

      expect(parsed?.subject).toBe("Angebot für Straßenbeleuchtung");
      expect(parsed?.messageId).toBe("<local@example.com>");
      expect(parsed?.from?.address).toBe("joerg@example.com");
      expect(parsed?.to.map((entry) => entry.address)).toEqual([
        "anna@example.com",
      ]);
      expect(parsed?.cc.map((entry) => entry.address)).toEqual([
        "team@example.com",
      ]);
      expect(parsed?.text).toContain("anbei das Angebot");
      expect(parsed?.attachments).toHaveLength(1);
      expect(parsed?.attachments[0].filename).toBe("Angebot.pdf");
      expect(parsed?.attachments[0].size).toBe(6);
    });
  },
);

describe("PT_STRING8 code pages", () => {
  // These are the cases the windows-1252 default gets WRONG, so they fail if
  // PidTagMessageCodepage is ignored: utf-8 bytes read as 1252 mojibake, and
  // Cyrillic 1251 bytes land on Western glyphs.
  it("decodes a utf-8 (65001) message", () => {
    const message = readMsgMessage(
      buildRichMsg({
        encoding: "ansi",
        codepage: 65001,
        encodeAnsi: utf8,
        subject: "Jörg Müller grüßt",
        senderName: "Jörg Müller",
      }),
    );

    expect(message?.subject).toBe("Jörg Müller grüßt");
    expect(message?.from?.name).toBe("Jörg Müller");
  });

  it("decodes a windows-1251 Cyrillic message", () => {
    const message = readMsgMessage(
      buildRichMsg({
        encoding: "ansi",
        codepage: 1251,
        encodeAnsi: cp1251,
        subject: "Привет",
      }),
    );

    expect(message?.subject).toBe("Привет");
  });

  it("falls back to windows-1252 when the code page is absent", () => {
    const message = readMsgMessage(
      buildRichMsg({ encoding: "ansi", subject: "Grüße" }),
    );

    expect(message?.subject).toBe("Grüße");
  });

  it("falls back to windows-1252 for a code page it cannot decode", () => {
    const message = readMsgMessage(
      buildRichMsg({ encoding: "ansi", codepage: 99999, subject: "Grüße" }),
    );

    expect(message?.subject).toBe("Grüße");
  });
});

describe("readMsgMessage edge cases", () => {
  it("returns null for bytes that are not a compound file", () => {
    expect(readMsgMessage(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(parseMsgLocallyToEml(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it("omits bcc recipients from the synthesized message", async () => {
    const parsed = await parseThroughEml(
      buildRichMsg({
        ...SAMPLE,
        encoding: "unicode",
        bcc: [{ name: "Hidden", address: "hidden@example.com" }],
      }),
    );

    const everyAddress = [...parsed!.to, ...parsed!.cc, ...parsed!.bcc].map(
      (entry) => entry.address,
    );
    expect(everyAddress).not.toContain("hidden@example.com");
  });

  it("still describes a message with no recipients or attachments", async () => {
    const parsed = await parseThroughEml(
      buildRichMsg({
        encoding: "unicode",
        subject: "Nur Betreff",
        body: "kurz",
      }),
    );

    expect(parsed?.subject).toBe("Nur Betreff");
    expect(parsed?.to).toEqual([]);
    expect(parsed?.attachments).toEqual([]);
  });

  it.each([
    ["text/html\r\nX-Injected: yes", "a CRLF header injection"],
    ["text/html; boundary=--nope", "a smuggled parameter"],
    ["not-a-mime-type", "a malformed value"],
  ])("discards %j as an attachment MIME type (%s)", (mimeTag) => {
    const message = readMsgMessage(
      buildRichMsg({
        encoding: "unicode",
        subject: "s",
        attachments: [
          {
            filename: "a.bin",
            mimeType: mimeTag,
            content: new Uint8Array([1, 2, 3]),
          },
        ],
      }),
    );

    expect(message?.attachments[0].mimeType).toBe("application/octet-stream");
  });

  it("keeps a well-formed attachment MIME type", () => {
    const message = readMsgMessage(
      buildRichMsg({
        encoding: "unicode",
        subject: "s",
        attachments: [
          {
            filename: "a.pdf",
            mimeType: "application/pdf",
            content: new Uint8Array([1]),
          },
        ],
      }),
    );

    expect(message?.attachments[0].mimeType).toBe("application/pdf");
  });

  it("drops an X.500 sender address rather than forging a From", () => {
    const message = readMsgMessage(
      buildRichMsg({
        encoding: "unicode",
        subject: "s",
        senderName: "Jörg Müller",
        senderAddress: undefined,
      }),
    );

    expect(message?.from).toEqual({ name: "Jörg Müller", address: "" });
  });
});
