import { describe, expect, it, vi } from "vitest";

import { parseDroppedFiles } from "../parseDroppedFiles";

const CRLF = "\r\n";

function makeEmlFile(content: string, name = "message.eml"): File {
  return new File([content], name, { type: "message/rfc822" });
}

function buildEml(messageId: string | null, subject = "Hi"): string {
  return (
    `From: a@x${CRLF}` +
    `To: b@x${CRLF}` +
    `Subject: ${subject}${CRLF}` +
    (messageId ? `Message-ID: ${messageId}${CRLF}` : "") +
    `MIME-Version: 1.0${CRLF}` +
    `Content-Type: text/plain${CRLF}${CRLF}body`
  );
}

describe("parseDroppedFiles", () => {
  it("splits emails from non-email files", async () => {
    const eml = makeEmlFile(buildEml("<a@x>"));
    const pdf = new File(["pdf"], "doc.pdf", { type: "application/pdf" });

    const result = await parseDroppedFiles([eml, pdf]);

    expect(result.emails).toHaveLength(1);
    expect(result.emails[0].messageId).toBe("<a@x>");
    expect(result.nonEmail).toHaveLength(1);
    expect(result.nonEmail[0]).toBe(pdf);
  });

  it("passes regular files through unchanged when there are no emails", async () => {
    const pdf = new File(["pdf"], "doc.pdf", { type: "application/pdf" });
    const png = new File(["png"], "img.png", { type: "image/png" });

    const result = await parseDroppedFiles([pdf, png]);

    expect(result.emails).toEqual([]);
    expect(result.nonEmail).toEqual([pdf, png]);
  });

  it("calls tryAttachEmail to claim message ids and drops duplicates", async () => {
    const a = makeEmlFile(buildEml("<a@host>"), "a.eml");
    const b = makeEmlFile(buildEml("<a@host>"), "b.eml");
    const claimed = new Set<string>();
    const tryAttachEmail = vi.fn((messageId: string) => {
      if (claimed.has(messageId)) return false;
      claimed.add(messageId);
      return true;
    });

    const result = await parseDroppedFiles([a, b], { tryAttachEmail });

    expect(result.emails).toHaveLength(1);
    expect(tryAttachEmail).toHaveBeenCalledTimes(2);
  });

  it("keeps emails without a Message-ID (no claim possible)", async () => {
    const eml = makeEmlFile(buildEml(null), "no-id.eml");
    const tryAttachEmail = vi.fn(() => false);

    const result = await parseDroppedFiles([eml], { tryAttachEmail });

    expect(result.emails).toHaveLength(1);
    expect(tryAttachEmail).not.toHaveBeenCalled();
  });

  it("skips .msg drops without a message fetcher", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const msg = new File(["msg"], "x.msg", {
      type: "application/vnd.ms-outlook",
    });

    const result = await parseDroppedFiles([msg]);

    expect(result.emails).toEqual([]);
    expect(result.nonEmail).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
