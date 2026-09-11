import { describe, expect, it } from "vitest";

import { parseEmlBytes } from "../parsedEmail";
import { trimEmlAttachments } from "../trimEmlAttachments";

import type { AttachmentTarget } from "../trimEmlAttachments";

const CRLF = "\r\n";

function toArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

/**
 * An email carrying `top.pdf` plus a forwarded email (no Content-Disposition,
 * the way Outlook emits item attachments) that itself carries `deep.pdf`.
 */
function buildEmailWithForward(
  forwardEncoding?: string,
  forwardDisposition?: string,
): string {
  const outer = "----OUTER";
  const inner = "----INNER";
  const forwardHeaders =
    `Content-Type: message/rfc822${CRLF}` +
    (forwardEncoding
      ? `Content-Transfer-Encoding: ${forwardEncoding}${CRLF}`
      : "") +
    (forwardDisposition
      ? `Content-Disposition: ${forwardDisposition}${CRLF}`
      : "");
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
    `${forwardHeaders}${CRLF}` +
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

async function parseAndTrim(targets: AttachmentTarget[]) {
  const parsed = await parseEmlBytes(toArrayBuffer(buildEmailWithForward()));
  if (!parsed) throw new Error("fixture did not parse");
  const raw = new Uint8Array(await parsed.rawEmlFile.arrayBuffer());
  const trimmed = trimEmlAttachments(raw, targets);
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

  it("exposes the forwarded email's own attachments under path ids", async () => {
    const parsed = await parseEmlBytes(toArrayBuffer(buildEmailWithForward()));

    expect(parsed?.attachments.map((a) => a.id)).toEqual(["att-0", "att-1"]);
    const nested = parsed?.attachments[1].nested;
    expect(nested?.subject).toBe("Re: budget numbers");
    expect(nested?.attachments.map((a) => [a.id, a.filename])).toEqual([
      ["att-1/att-0", "deep.pdf"],
    ]);
  });

  it("treats an inline-disposed forward the same as a disposition-less one", async () => {
    const raw = new TextEncoder().encode(
      buildEmailWithForward(undefined, "inline"),
    );
    const parsed = await parseEmlBytes(raw.slice().buffer);

    expect(parsed?.attachments.map((a) => a.id)).toEqual(["att-0", "att-1"]);
    expect(parsed?.attachments[1].nested?.attachments.map((a) => a.id)).toEqual(
      ["att-1/att-0"],
    );
    const trimmed = trimEmlAttachments(raw, [1]);
    expect(trimmed).not.toBeNull();
    expect(new TextDecoder().decode(trimmed!)).not.toContain("deep.pdf");
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

  it("unchecking deep.pdf by path removes only it, keeping the forwarded body", async () => {
    const { trimmedText, reparsed } = await parseAndTrim(["1/0"]);

    expect(reparsed.attachments.map((a) => a.mimeType)).toEqual([
      "application/pdf",
      "message/rfc822",
    ]);
    expect(trimmedText).toContain("top.pdf");
    expect(trimmedText).toContain("Forwarded body.");
    expect(trimmedText).not.toContain("deep.pdf");
    expect(trimmedText).not.toContain("REVFUA==");
  });

  it("accepts the top-level index spelled as a path", async () => {
    const byIndex = await parseAndTrim([1]);
    const byPath = await parseAndTrim(["1"]);

    expect(byPath.trimmedText).toBe(byIndex.trimmedText);
  });

  it("splices only the forwarded email when deep.pdf inside it is also targeted", async () => {
    const whole = await parseAndTrim([1]);
    const both = await parseAndTrim(["1/0", 1, "1/0"]);

    expect(both.trimmedText).toBe(whole.trimmedText);
    expect(both.reparsed.attachments.map((a) => a.filename)).toEqual([
      "top.pdf",
    ]);
  });

  it("refuses a path into a forwarded email whose bytes are transfer-encoded", () => {
    const raw = new TextEncoder().encode(buildEmailWithForward("base64"));

    expect(trimEmlAttachments(raw, ["1/0"])).toBeNull();
    // The forwarded email itself is still addressable as a whole.
    expect(trimEmlAttachments(raw, ["1"])).not.toBeNull();
  });

  it("refuses a path that does not resolve", () => {
    const raw = new TextEncoder().encode(buildEmailWithForward());

    expect(trimEmlAttachments(raw, ["1/1"])).toBeNull();
    expect(trimEmlAttachments(raw, ["0/0"])).toBeNull();
    expect(trimEmlAttachments(raw, ["x"])).toBeNull();
  });
});
