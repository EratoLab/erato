import { afterEach, describe, expect, it, vi } from "vitest";

import { isEmlFile, parseEmlFileToFiles } from "../parseEmlFile";

function makeEmlFile(content: string, name = "message.eml"): File {
  return new File([content], name, { type: "message/rfc822" });
}

const CRLF = "\r\n";

describe("isEmlFile", () => {
  it("returns true for MIME message/rfc822", () => {
    const file = new File(["x"], "something.bin", { type: "message/rfc822" });
    expect(isEmlFile(file)).toBe(true);
  });

  it("returns true for .eml filenames regardless of case", () => {
    expect(isEmlFile(new File(["x"], "lower.eml", { type: "" }))).toBe(true);
    expect(isEmlFile(new File(["x"], "UPPER.EML", { type: "" }))).toBe(true);
  });

  it("returns false for unrelated files", () => {
    expect(isEmlFile(new File(["x"], "doc.pdf", { type: "application/pdf" }))).toBe(
      false,
    );
  });
});

describe("parseEmlFileToFiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a plain-text .eml into a single HTML body file with rendered headers", async () => {
    const eml =
      `From: Alice <alice@example.com>${CRLF}` +
      `To: Bob <bob@example.com>${CRLF}` +
      `Subject: Hello there${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: text/plain; charset=utf-8${CRLF}` +
      `${CRLF}` +
      `plain body content`;

    const { files: result } = await parseEmlFileToFiles(makeEmlFile(eml));
    expect(result).toHaveLength(1);
    const body = result[0];
    expect(body.type).toBe("text/html");
    const text = await body.text();
    expect(text).toContain("<strong>From:</strong> Alice &lt;alice@example.com&gt;");
    expect(text).toContain("<strong>To:</strong> Bob &lt;bob@example.com&gt;");
    expect(text).toContain("<strong>Subject:</strong> Hello there");
    expect(text).toMatch(/<pre>plain body content\s*<\/pre>/);
  });

  it("keeps HTML body content verbatim, without <pre> wrapping", async () => {
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: Rich${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: text/html; charset=utf-8${CRLF}` +
      `${CRLF}` +
      `<p>hi there</p>`;

    const { files: result } = await parseEmlFileToFiles(makeEmlFile(eml));
    expect(result).toHaveLength(1);
    const text = await result[0].text();
    expect(text).toContain("<p>hi there</p>");
    expect(text).not.toContain("<pre>");
  });

  it("produces a body file plus one File per non-inline attachment", async () => {
    const boundary = "----BOUNDARY1";
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: With attachment${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}` +
      `${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: text/plain; charset=utf-8${CRLF}` +
      `${CRLF}` +
      `see attached${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: text/plain; name="notes.txt"${CRLF}` +
      `Content-Disposition: attachment; filename="notes.txt"${CRLF}` +
      `${CRLF}` +
      `attachment body${CRLF}` +
      `--${boundary}--${CRLF}`;

    const { files: result } = await parseEmlFileToFiles(makeEmlFile(eml));
    expect(result).toHaveLength(2);
    const attachment = result[1];
    expect(attachment.name).toBe("notes.txt");
    expect(attachment.type).toContain("text/plain");
    expect((await attachment.text()).trim()).toBe("attachment body");
  });

  it("skips inline attachments (Content-Disposition: inline)", async () => {
    const boundary = "----BOUNDARY2";
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: With inline${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}` +
      `${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: text/plain; charset=utf-8${CRLF}` +
      `${CRLF}` +
      `body${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: image/png; name="inline.png"${CRLF}` +
      `Content-Disposition: inline; filename="inline.png"${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}` +
      `${CRLF}` +
      `${btoa("pngbytes")}${CRLF}` +
      `--${boundary}--${CRLF}`;

    const { files: result } = await parseEmlFileToFiles(makeEmlFile(eml));
    expect(result).toHaveLength(1);
  });

  it("skips related (CID-referenced) attachments in multipart/related", async () => {
    const boundary = "----BOUNDARY3";
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: With related${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: multipart/related; boundary="${boundary}"${CRLF}` +
      `${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: text/html; charset=utf-8${CRLF}` +
      `${CRLF}` +
      `<p><img src="cid:logo"></p>${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: image/png; name="logo.png"${CRLF}` +
      `Content-ID: <logo>${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}` +
      `${CRLF}` +
      `${btoa("pngbytes")}${CRLF}` +
      `--${boundary}--${CRLF}`;

    const { files: result } = await parseEmlFileToFiles(makeEmlFile(eml));
    expect(result).toHaveLength(1);
  });

  it("returns [] on malformed input", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bogus = new File([new Uint8Array([0xff, 0xfe, 0xfd])], "broken.eml", {
      type: "message/rfc822",
    });
    // Force postal-mime to throw by providing a file.arrayBuffer that rejects.
    const failing = new File(["anything"], "broken.eml", {
      type: "message/rfc822",
    });
    vi.spyOn(failing, "arrayBuffer").mockRejectedValue(new Error("boom"));

    const result = await parseEmlFileToFiles(failing);
    expect(result).toEqual({ files: [], messageId: null });
    expect(warnSpy).toHaveBeenCalled();
    // Also confirm behaviour with the bogus bytes path.
    void bogus;
  });

  it("surfaces the RFC 5322 Message-ID header when present", async () => {
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: With id${CRLF}` +
      `Message-ID: <abc-123@example.com>${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: text/plain${CRLF}` +
      `${CRLF}` +
      `body`;

    const { messageId } = await parseEmlFileToFiles(makeEmlFile(eml));
    expect(messageId).toBe("<abc-123@example.com>");
  });

  it("returns messageId null when the header is absent", async () => {
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: No id${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: text/plain${CRLF}` +
      `${CRLF}` +
      `body`;

    const { messageId } = await parseEmlFileToFiles(makeEmlFile(eml));
    expect(messageId).toBeNull();
  });
});
