import PostalMime from "postal-mime";
import { describe, expect, it } from "vitest";

import { trimEmlAttachments } from "../trimEmlAttachments";

const CRLF = "\r\n";

function bytesFromString(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToString(buffer: Uint8Array): string {
  return new TextDecoder().decode(buffer);
}

describe("trimEmlAttachments", () => {
  function buildMultiAttachmentEml(): string {
    const boundary = "X";
    const closer = `--${boundary}--${CRLF}`;
    return (
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: Three attachments${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: text/plain; charset=utf-8${CRLF}${CRLF}` +
      `please review${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: application/pdf; name="report-a.pdf"${CRLF}` +
      `Content-Disposition: attachment; filename="report-a.pdf"${CRLF}${CRLF}` +
      `AAA${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: application/pdf; name="report-b.pdf"${CRLF}` +
      `Content-Disposition: attachment; filename="report-b.pdf"${CRLF}${CRLF}` +
      `BBB${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: application/pdf; name="report-c.pdf"${CRLF}` +
      `Content-Disposition: attachment; filename="report-c.pdf"${CRLF}${CRLF}` +
      `CCC${CRLF}` +
      closer
    );
  }

  it("returns the original bytes when nothing is removed (fast path)", () => {
    const input = bytesFromString(buildMultiAttachmentEml());
    const out = trimEmlAttachments(input, []);
    expect(out).toBe(input);
  });

  it("removes a single attachment and produces a valid .eml on re-parse", async () => {
    const input = bytesFromString(buildMultiAttachmentEml());
    const trimmed = trimEmlAttachments(input, [1]);
    expect(trimmed).not.toBeNull();
    const reparsed = await PostalMime.parse(trimmed!);
    const filenames = (reparsed.attachments ?? []).map((a) => a.filename);
    expect(filenames).toEqual(["report-a.pdf", "report-c.pdf"]);
    // Body untouched
    expect(reparsed.text?.trim()).toBe("please review");
  });

  it("removes the first and last attachment in one pass", async () => {
    const input = bytesFromString(buildMultiAttachmentEml());
    const trimmed = trimEmlAttachments(input, [0, 2]);
    expect(trimmed).not.toBeNull();
    const reparsed = await PostalMime.parse(trimmed!);
    const filenames = (reparsed.attachments ?? []).map((a) => a.filename);
    expect(filenames).toEqual(["report-b.pdf"]);
  });

  it("preserves header order and byte-for-byte fidelity outside the removed range", () => {
    const input = bytesFromString(buildMultiAttachmentEml());
    const trimmed = trimEmlAttachments(input, [1]);
    const inputStr = bytesToString(input);
    const trimmedStr = bytesToString(trimmed!);
    // Headers (everything before the first boundary) must match byte-for-byte
    const headerEnd = inputStr.indexOf("--X");
    expect(trimmedStr.slice(0, headerEnd)).toBe(inputStr.slice(0, headerEnd));
    // The surviving "report-a.pdf" part should be present unchanged
    expect(trimmedStr).toContain('filename="report-a.pdf"');
    expect(trimmedStr).toContain('filename="report-c.pdf"');
    expect(trimmedStr).not.toContain('filename="report-b.pdf"');
  });

  it("returns null when an index is out of range", () => {
    const input = bytesFromString(buildMultiAttachmentEml());
    const trimmed = trimEmlAttachments(input, [99]);
    expect(trimmed).toBeNull();
  });

  it("skips inline body parts (text/plain, text/html) when matching indices", async () => {
    // Body + 2 attachments. Index 0 should map to the first attachment,
    // not the text/plain body.
    const input = bytesFromString(buildMultiAttachmentEml());
    const trimmed = trimEmlAttachments(input, [0]);
    expect(trimmed).not.toBeNull();
    const reparsed = await PostalMime.parse(trimmed!);
    const filenames = (reparsed.attachments ?? []).map((a) => a.filename);
    expect(filenames).toEqual(["report-b.pdf", "report-c.pdf"]);
    expect(reparsed.text?.trim()).toBe("please review");
  });

  it("removes all attachments at once leaving only the body", async () => {
    const input = bytesFromString(buildMultiAttachmentEml());
    const trimmed = trimEmlAttachments(input, [0, 1, 2]);
    expect(trimmed).not.toBeNull();
    const reparsed = await PostalMime.parse(trimmed!);
    expect(reparsed.attachments ?? []).toEqual([]);
    expect(reparsed.text?.trim()).toBe("please review");
  });

  it("preserves mixed Content-Transfer-Encoding values byte-for-byte on kept parts", async () => {
    const boundary = "Y";
    const eml =
      `From: a@x${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: text/plain; charset=utf-8${CRLF}` +
      `Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}` +
      `caf=C3=A9${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: application/pdf; name="a.pdf"${CRLF}` +
      `Content-Disposition: attachment; filename="a.pdf"${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
      `${btoa("PDF-A")}${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: application/pdf; name="b.pdf"${CRLF}` +
      `Content-Disposition: attachment; filename="b.pdf"${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
      `${btoa("PDF-B")}${CRLF}` +
      `--${boundary}--${CRLF}`;

    const input = bytesFromString(eml);
    const trimmed = trimEmlAttachments(input, [1]);
    expect(trimmed).not.toBeNull();
    const reparsed = await PostalMime.parse(trimmed!);
    expect(reparsed.text?.trim()).toBe("café"); // quoted-printable still decodes
    expect((reparsed.attachments ?? []).map((a) => a.filename)).toEqual([
      "a.pdf",
    ]);
  });

  it("keeps multipart/related inline images when their index isn't dismissed", async () => {
    const outer = "OUTER";
    const inner = "INNER";
    const eml =
      `From: a@x${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${outer}"${CRLF}${CRLF}` +
      `--${outer}${CRLF}` +
      `Content-Type: multipart/related; boundary="${inner}"${CRLF}${CRLF}` +
      `--${inner}${CRLF}Content-Type: text/html; charset=utf-8${CRLF}${CRLF}<img src="cid:logo">${CRLF}` +
      `--${inner}${CRLF}Content-Type: image/png${CRLF}Content-ID: <logo>${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
      `${btoa("PNG")}${CRLF}` +
      `--${inner}--${CRLF}` +
      `--${outer}${CRLF}` +
      `Content-Type: application/pdf; name="r.pdf"${CRLF}` +
      `Content-Disposition: attachment; filename="r.pdf"${CRLF}${CRLF}` +
      `${btoa("PDF")}${CRLF}` +
      `--${outer}--${CRLF}`;

    const input = bytesFromString(eml);
    // postal-mime order:
    //   index 0 = image/png inline (logo)
    //   index 1 = application/pdf r.pdf
    // Dismiss the PDF, keep the inline image.
    const trimmed = trimEmlAttachments(input, [1]);
    expect(trimmed).not.toBeNull();
    const reparsed = await PostalMime.parse(trimmed!);
    const filenames = (reparsed.attachments ?? []).map((a) => a.filename);
    expect(filenames).toEqual([null]); // just the inline image survives
    expect(reparsed.attachments[0].related).toBe(true);
    expect(reparsed.html).toContain("cid:logo");
  });
});
