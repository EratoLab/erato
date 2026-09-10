import { describe, expect, it } from "vitest";

import { parseEmlBytes } from "../parsedEmail";
import { trimEmlAttachments } from "../trimEmlAttachments";

const CRLF = "\r\n";

function toArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

/**
 * An email carrying `top.pdf` plus a forwarded email (no Content-Disposition,
 * the way Outlook emits item attachments) that itself carries `deep.pdf`.
 */
function buildEmailWithForward(): string {
  const outer = "----OUTER";
  const inner = "----INNER";
  return (
    `From: a@example.com${CRLF}` +
    `To: b@example.com${CRLF}` +
    `Subject: Cover note${CRLF}` +
    `Content-Type: multipart/mixed; boundary="${outer}"${CRLF}${CRLF}` +
    `--${outer}${CRLF}` +
    `Content-Type: text/plain${CRLF}${CRLF}` +
    `See attached.${CRLF}` +
    `--${outer}${CRLF}` +
    `Content-Type: application/pdf; name="top.pdf"${CRLF}` +
    `Content-Disposition: attachment; filename="top.pdf"${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `VE9Q${CRLF}` +
    `--${outer}${CRLF}` +
    `Content-Type: message/rfc822${CRLF}${CRLF}` +
    `From: c@example.com${CRLF}` +
    `Subject: Re: budget numbers${CRLF}` +
    `Content-Type: multipart/mixed; boundary="${inner}"${CRLF}${CRLF}` +
    `--${inner}${CRLF}` +
    `Content-Type: text/plain${CRLF}${CRLF}` +
    `Forwarded body.${CRLF}` +
    `--${inner}${CRLF}` +
    `Content-Type: application/pdf; name="deep.pdf"${CRLF}` +
    `Content-Disposition: attachment; filename="deep.pdf"${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `REVFUA==${CRLF}` +
    `--${inner}--${CRLF}` +
    `--${outer}--${CRLF}`
  );
}

async function parseAndTrim(indices: number[]) {
  const parsed = await parseEmlBytes(toArrayBuffer(buildEmailWithForward()));
  if (!parsed) throw new Error("fixture did not parse");
  const raw = new Uint8Array(await parsed.rawEmlFile.arrayBuffer());
  const trimmed = trimEmlAttachments(raw, indices);
  if (!trimmed) throw new Error("trim returned null");
  const reparsed = await parseEmlBytes(trimmed.slice().buffer);
  if (!reparsed) throw new Error("trimmed bytes did not parse");
  return { parsed, trimmedText: new TextDecoder().decode(trimmed), reparsed };
}

/**
 * The chips dismiss attachments by index into `parsed.attachments`, and the
 * trim walker removes leaves by index into its own list. The two lists have
 * to describe the same parts, or unchecking one thing removes another.
 */
describe("dismissing parts of a dropped email with a forwarded email inside", () => {
  it("lists the forwarded email as one attachment, named after its subject", async () => {
    const parsed = await parseEmlBytes(toArrayBuffer(buildEmailWithForward()));

    expect(parsed?.attachments.map((a) => a.mimeType)).toEqual([
      "application/pdf",
      "message/rfc822",
    ]);
    expect(parsed?.attachments[0].filename).toBe("top.pdf");
    // Not hoisted to a sibling row, not called "attachment".
    expect(parsed?.attachments.map((a) => a.filename)).not.toContain(
      "deep.pdf",
    );
    // The default-name builder sanitises the subject; only the content matters.
    expect(parsed?.attachments[1].filename).toMatch(/budget[_ ]numbers/);
  });

  it("unchecking the forwarded email removes exactly that, keeping top.pdf", async () => {
    const { trimmedText, reparsed } = await parseAndTrim([1]);

    expect(reparsed.attachments.map((a) => a.filename)).toEqual(["top.pdf"]);
    expect(trimmedText).not.toContain("deep.pdf");
    expect(trimmedText).not.toContain("Forwarded body.");
  });

  it("unchecking top.pdf keeps the forwarded email intact, deep.pdf included", async () => {
    const { trimmedText, reparsed } = await parseAndTrim([0]);

    expect(reparsed.attachments.map((a) => a.mimeType)).toEqual([
      "message/rfc822",
    ]);
    expect(trimmedText).not.toContain("top.pdf");
    expect(trimmedText).toContain("deep.pdf");
    expect(trimmedText).toContain("Forwarded body.");
  });
});
