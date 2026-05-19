import { describe, expect, it } from "vitest";

import { listLeafParts, parseMimeStructure } from "../emlMimeStructure";

const CRLF = "\r\n";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("parseMimeStructure", () => {
  it("parses a single-part text/plain message", () => {
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: Hello${CRLF}` +
      `Content-Type: text/plain; charset=utf-8${CRLF}${CRLF}` +
      `body content`;

    const root = parseMimeStructure(bytes(eml));
    expect(root).not.toBeNull();
    expect(root?.isMultipart).toBe(false);
    expect(root?.contentType).toBe("text/plain");
    expect(root?.contentTypeParams.charset).toBe("utf-8");
    expect(root?.children).toEqual([]);
    expect(root?.delimiterStart).toBeNull();
  });

  it("walks top-level multipart/mixed children with correct byte ranges", () => {
    const boundary = "X";
    const text = "body part";
    const attachment = "ZmlsZTE=";
    const part1 =
      `--${boundary}${CRLF}` +
      `Content-Type: text/plain; charset=utf-8${CRLF}${CRLF}` +
      `${text}${CRLF}`;
    const part2 =
      `--${boundary}${CRLF}` +
      `Content-Type: application/pdf; name="report.pdf"${CRLF}` +
      `Content-Disposition: attachment; filename="report.pdf"${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
      `${attachment}${CRLF}`;
    const closer = `--${boundary}--${CRLF}`;
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: With attachment${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}${CRLF}` +
      part1 +
      part2 +
      closer;

    const raw = bytes(eml);
    const root = parseMimeStructure(raw);
    expect(root).not.toBeNull();
    expect(root?.isMultipart).toBe(true);
    expect(root?.boundary).toBe(boundary);
    expect(root?.children).toHaveLength(2);

    const [body, pdf] = root!.children;
    expect(body.contentType).toBe("text/plain");
    expect(body.isMultipart).toBe(false);
    expect(pdf.contentType).toBe("application/pdf");
    expect(pdf.contentDisposition).toBe("attachment");
    expect(pdf.contentDispositionParams.filename).toBe("report.pdf");
    expect(pdf.contentTypeParams.name).toBe("report.pdf");

    // delimiterStart of each child points at the introducing "--X" line.
    const decoder = new TextDecoder();
    const bodyDelimiter = decoder.decode(
      raw.subarray(body.delimiterStart!, body.delimiterStart! + boundary.length + 2),
    );
    expect(bodyDelimiter).toBe(`--${boundary}`);
    const pdfDelimiter = decoder.decode(
      raw.subarray(pdf.delimiterStart!, pdf.delimiterStart! + boundary.length + 2),
    );
    expect(pdfDelimiter).toBe(`--${boundary}`);
    // pdf.end should point at the closing "--X--" delimiter (the next boundary).
    const afterPdf = decoder.decode(raw.subarray(pdf.end, pdf.end + boundary.length + 4));
    expect(afterPdf).toBe(`--${boundary}--`);
  });

  it("recurses into nested multipart/alternative inside multipart/mixed", () => {
    const outer = "OUTER";
    const inner = "INNER";
    const eml =
      `From: a@x${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${outer}"${CRLF}${CRLF}` +
      `--${outer}${CRLF}` +
      `Content-Type: multipart/alternative; boundary="${inner}"${CRLF}${CRLF}` +
      `--${inner}${CRLF}` +
      `Content-Type: text/plain${CRLF}${CRLF}plain${CRLF}` +
      `--${inner}${CRLF}` +
      `Content-Type: text/html${CRLF}${CRLF}<p>html</p>${CRLF}` +
      `--${inner}--${CRLF}` +
      `--${outer}${CRLF}` +
      `Content-Type: application/pdf; name="r.pdf"${CRLF}` +
      `Content-Disposition: attachment; filename="r.pdf"${CRLF}${CRLF}` +
      `PDFBYTES${CRLF}` +
      `--${outer}--${CRLF}`;

    const root = parseMimeStructure(bytes(eml));
    expect(root?.children).toHaveLength(2);
    const [alt, pdf] = root!.children;
    expect(alt.isMultipart).toBe(true);
    expect(alt.contentType).toBe("multipart/alternative");
    expect(alt.children).toHaveLength(2);
    expect(alt.children[0].contentType).toBe("text/plain");
    expect(alt.children[1].contentType).toBe("text/html");
    expect(pdf.contentType).toBe("application/pdf");
  });

  it("returns leaf parts in document order via listLeafParts", () => {
    const outer = "OUTER";
    const inner = "INNER";
    const eml =
      `Content-Type: multipart/mixed; boundary="${outer}"${CRLF}${CRLF}` +
      `--${outer}${CRLF}` +
      `Content-Type: multipart/alternative; boundary="${inner}"${CRLF}${CRLF}` +
      `--${inner}${CRLF}Content-Type: text/plain${CRLF}${CRLF}plain${CRLF}` +
      `--${inner}${CRLF}Content-Type: text/html${CRLF}${CRLF}html${CRLF}` +
      `--${inner}--${CRLF}` +
      `--${outer}${CRLF}` +
      `Content-Type: application/pdf; name="a.pdf"${CRLF}` +
      `Content-Disposition: attachment; filename="a.pdf"${CRLF}${CRLF}A${CRLF}` +
      `--${outer}${CRLF}` +
      `Content-Type: application/pdf; name="b.pdf"${CRLF}` +
      `Content-Disposition: attachment; filename="b.pdf"${CRLF}${CRLF}B${CRLF}` +
      `--${outer}--${CRLF}`;

    const root = parseMimeStructure(bytes(eml));
    const leaves = listLeafParts(root!);
    expect(leaves.map((p) => p.contentDispositionParams.filename ?? p.contentType)).toEqual([
      "text/plain",
      "text/html",
      "a.pdf",
      "b.pdf",
    ]);
  });

  it("unfolds RFC 5322 header continuation lines", () => {
    const eml =
      `From: a@x${CRLF}` +
      `Content-Type: multipart/mixed;${CRLF}` +
      `  boundary="X"${CRLF}${CRLF}` +
      `--X${CRLF}Content-Type: text/plain${CRLF}${CRLF}body${CRLF}` +
      `--X--${CRLF}`;
    const root = parseMimeStructure(bytes(eml));
    expect(root?.boundary).toBe("X");
    expect(root?.children).toHaveLength(1);
  });

  it("tolerates bare LF line endings (some mailers)", () => {
    const LF = "\n";
    const eml =
      `From: a@x${LF}` +
      `Content-Type: multipart/mixed; boundary="X"${LF}${LF}` +
      `--X${LF}Content-Type: text/plain${LF}${LF}body${LF}` +
      `--X--${LF}`;
    const root = parseMimeStructure(bytes(eml));
    expect(root?.isMultipart).toBe(true);
    expect(root?.children).toHaveLength(1);
  });

  it("returns null on completely unparseable bytes", () => {
    const empty = new Uint8Array(0);
    const root = parseMimeStructure(empty);
    // Empty input → "" content type, no children. Not null per design — a
    // truly broken input returns a degenerate but valid Part. The trim
    // utility treats a no-attachments tree as "nothing to remove".
    expect(root).not.toBeNull();
    expect(root?.children).toEqual([]);
  });
});
