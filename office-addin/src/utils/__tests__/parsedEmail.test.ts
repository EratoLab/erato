import { describe, expect, it, vi } from "vitest";

import { parseEmlBytes } from "../parsedEmail";

const CRLF = "\r\n";

function toArrayBuffer(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy.buffer;
}

describe("parseEmlBytes", () => {
  it("returns a ParsedEmail with normalised headers, body, and attachments", async () => {
    const boundary = "----BOUND";
    const eml =
      `From: Alice Example <alice@example.com>${CRLF}` +
      `To: Bob <bob@example.com>, Carol <carol@example.com>${CRLF}` +
      `Cc: Dan <dan@example.com>${CRLF}` +
      `Subject: Hi there${CRLF}` +
      `Message-ID: <msg-1@example.com>${CRLF}` +
      `Date: Mon, 18 May 2026 10:00:00 +0000${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}` +
      `${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: text/plain; charset=utf-8${CRLF}` +
      `${CRLF}` +
      `Hello world${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: text/plain; name="notes.txt"${CRLF}` +
      `Content-Disposition: attachment; filename="notes.txt"${CRLF}` +
      `${CRLF}` +
      `attachment body${CRLF}` +
      `--${boundary}--${CRLF}`;

    const parsed = await parseEmlBytes(toArrayBuffer(eml));
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.subject).toBe("Hi there");
    expect(parsed.messageId).toBe("<msg-1@example.com>");
    expect(parsed.from).toEqual({ name: "Alice Example", address: "alice@example.com" });
    expect(parsed.to).toEqual([
      { name: "Bob", address: "bob@example.com" },
      { name: "Carol", address: "carol@example.com" },
    ]);
    expect(parsed.cc).toEqual([{ name: "Dan", address: "dan@example.com" }]);
    expect(parsed.bcc).toEqual([]);
    expect(parsed.text?.trim()).toBe("Hello world");
    expect(parsed.html).toBeNull();
    expect(parsed.date).toBe("2026-05-18T10:00:00.000Z");

    expect(parsed.attachments).toHaveLength(1);
    const [att] = parsed.attachments;
    expect(att.id).toBe("att-0");
    expect(att.filename).toBe("notes.txt");
    expect(att.mimeType).toContain("text/plain");
    expect(att.disposition).toBe("attachment");
    expect(att.related).toBe(false);
    expect(att.size).toBeGreaterThan(0);

    const file = att.toFile();
    expect(file.name).toBe("notes.txt");
    expect((await file.text()).trim()).toBe("attachment body");

    expect(parsed.rawEmlFile.type).toBe("message/rfc822");
    expect(parsed.rawEmlFile.name).toBe("Hi_there.eml");
  });

  it("honours the filename option for the wrapped rawEmlFile", async () => {
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: ignored${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: text/plain${CRLF}${CRLF}body`;

    const parsed = await parseEmlBytes(toArrayBuffer(eml), { filename: "drop.eml" });
    expect(parsed?.rawEmlFile.name).toBe("drop.eml");
  });

  it("falls back to message.eml when no subject is available", async () => {
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: text/plain${CRLF}${CRLF}body`;

    const parsed = await parseEmlBytes(toArrayBuffer(eml));
    expect(parsed?.rawEmlFile.name).toBe("message.eml");
    expect(parsed?.subject).toBeNull();
  });

  it("marks related CID-referenced attachments and preserves their position", async () => {
    const boundary = "----REL";
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: With related${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: multipart/related; boundary="${boundary}"${CRLF}${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: text/html; charset=utf-8${CRLF}${CRLF}` +
      `<p><img src="cid:logo"></p>${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: image/png; name="logo.png"${CRLF}` +
      `Content-ID: <logo>${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
      `${btoa("pngbytes")}${CRLF}` +
      `--${boundary}--${CRLF}`;

    const parsed = await parseEmlBytes(toArrayBuffer(eml));
    expect(parsed?.attachments).toHaveLength(1);
    const [att] = parsed!.attachments;
    expect(att.related).toBe(true);
    expect(att.contentId).toBe("<logo>");
    expect(att.filename).toBe("logo.png");
  });

  it("returns an empty-shaped ParsedEmail for non-MIME garbage (postal-mime is lenient)", async () => {
    const garbage = new Uint8Array([0xff, 0xfe, 0xfd]).buffer;
    const parsed = await parseEmlBytes(garbage);
    expect(parsed).not.toBeNull();
    expect(parsed?.subject).toBeNull();
    expect(parsed?.from).toBeNull();
    expect(parsed?.to).toEqual([]);
    expect(parsed?.messageId).toBeNull();
    expect(parsed?.attachments).toEqual([]);
  });

  it("returns null and logs when postal-mime throws (e.g. depth limit)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const PostalMimeModule = await import("postal-mime");
    const parseSpy = vi
      .spyOn(PostalMimeModule.default, "parse")
      .mockRejectedValueOnce(new Error("max nesting depth exceeded"));
    const parsed = await parseEmlBytes(new ArrayBuffer(8));
    expect(parsed).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    parseSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("produces stable, indexed attachment ids matching MIME order", async () => {
    const boundary = "----ORD";
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: Order${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: text/plain${CRLF}${CRLF}body${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: application/octet-stream; name="first.bin"${CRLF}` +
      `Content-Disposition: attachment; filename="first.bin"${CRLF}${CRLF}` +
      `aaa${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: application/octet-stream; name="second.bin"${CRLF}` +
      `Content-Disposition: attachment; filename="second.bin"${CRLF}${CRLF}` +
      `bbb${CRLF}` +
      `--${boundary}--${CRLF}`;

    const parsed = await parseEmlBytes(toArrayBuffer(eml));
    expect(parsed?.attachments.map((a) => [a.id, a.filename])).toEqual([
      ["att-0", "first.bin"],
      ["att-1", "second.bin"],
    ]);
  });
});
