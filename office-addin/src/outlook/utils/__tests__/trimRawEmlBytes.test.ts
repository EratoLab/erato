import { describe, expect, it } from "vitest";

import { EmailTrimError, trimRawEmlBytes } from "../trimRawEmlBytes";

const CRLF = "\r\n";

function emlWithOneAttachment(): string {
  const b = "----B";
  return (
    `Subject: hi${CRLF}` +
    `Content-Type: multipart/mixed; boundary="${b}"${CRLF}${CRLF}` +
    `--${b}${CRLF}` +
    `Content-Type: text/plain${CRLF}${CRLF}` +
    `body${CRLF}` +
    `--${b}${CRLF}` +
    `Content-Type: application/pdf; name="a.pdf"${CRLF}` +
    `Content-Disposition: attachment; filename="a.pdf"${CRLF}${CRLF}` +
    `PDF${CRLF}` +
    `--${b}--${CRLF}`
  );
}

describe("trimRawEmlBytes", () => {
  it("returns a file without the dismissed attachment", async () => {
    const file = new File([emlWithOneAttachment()], "thread.eml", {
      type: "message/rfc822",
    });

    const trimmed = await trimRawEmlBytes(file, [0]);
    const text = await trimmed.text();

    expect(trimmed.name).toBe("thread.eml");
    expect(trimmed.type).toBe("message/rfc822");
    expect(text).not.toContain("a.pdf");
    expect(text).toContain("body");
  });

  it("refuses rather than sending the untrimmed original when the trim fails", async () => {
    // Not MIME at all, so the structure parser has nothing to cut.
    const file = new File(["this is not an email"], "broken.eml", {
      type: "message/rfc822",
    });

    await expect(trimRawEmlBytes(file, [0])).rejects.toBeInstanceOf(
      EmailTrimError,
    );
    await expect(trimRawEmlBytes(file, [0])).rejects.toMatchObject({
      filename: "broken.eml",
    });
  });
});
