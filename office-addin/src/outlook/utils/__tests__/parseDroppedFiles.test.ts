import { describe, expect, it, vi } from "vitest";

import {
  buildAnsiMsgWithInternetMessageId,
  buildMsgWithInternetMessageId,
} from "../../../test/fixtures/msg";
import { parseDroppedFiles } from "../parseDroppedFiles";

import type { OutlookMessageFetcher } from "../fetchOutlookMessage";
import type { ParseDroppedFilesProgress } from "../parseDroppedFiles";

const CRLF = "\r\n";

function toArrayBuffer(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy.buffer;
}

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

/**
 * Dropped `.msg` files arrive with an EMPTY `type`, so fixtures must not lean
 * on the `application/vnd.ms-outlook` type a file picker would supply.
 */
function makeDroppedMsgFile(bytes: Uint8Array, name = "dropped.msg"): File {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { type: "" });
}

function makeFetcherStub(
  delayFor: (internetMessageId: string) => number = () => 0,
): {
  fetcher: OutlookMessageFetcher;
  byteLookups: string[];
} {
  const byteLookups: string[] = [];
  const fetcher = {
    fetchMessageBytesByInternetMessageId: async (internetMessageId: string) => {
      byteLookups.push(internetMessageId);
      await new Promise((resolve) =>
        setTimeout(resolve, delayFor(internetMessageId)),
      );
      return {
        bytes: toArrayBuffer(buildEml(internetMessageId, "Fetched")),
        internetMessageId,
      };
    },
  } as unknown as OutlookMessageFetcher;
  return { fetcher, byteLookups };
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
    expect(result.skipped).toEqual([]);
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

  it("resolves a dropped .msg that stores its Message-ID as ANSI", async () => {
    const { fetcher, byteLookups } = makeFetcherStub();
    const msg = makeDroppedMsgFile(
      buildAnsiMsgWithInternetMessageId("<ansi-drop@example.com>"),
    );

    const result = await parseDroppedFiles([msg], { fetcher });

    expect(byteLookups).toEqual(["<ansi-drop@example.com>"]);
    expect(result.emails).toHaveLength(1);
    expect(result.nonEmail).toEqual([]);
  });

  it("resolves a dropped .msg with a Unicode Message-ID and no MIME type", async () => {
    const { fetcher, byteLookups } = makeFetcherStub();
    const msg = makeDroppedMsgFile(
      buildMsgWithInternetMessageId("<unicode-drop@example.com>"),
    );

    const result = await parseDroppedFiles([msg], { fetcher });

    expect(byteLookups).toEqual(["<unicode-drop@example.com>"]);
    expect(result.emails).toHaveLength(1);
  });

  it("warns instead of silently dropping a .msg with no Message-ID", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetcher, byteLookups } = makeFetcherStub();
    const msg = makeDroppedMsgFile(new Uint8Array([1, 2, 3, 4]), "broken.msg");

    const result = await parseDroppedFiles([msg], { fetcher });

    expect(byteLookups).toEqual([]);
    expect(result.emails).toEqual([]);
    expect(result.nonEmail).toEqual([]);
    expect(result.skipped).toEqual([{ file: msg, reason: "unparseable" }]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("reports .msg drops without a message fetcher as skipped", async () => {
    const msg = new File(["msg"], "x.msg", {
      type: "application/vnd.ms-outlook",
    });

    const result = await parseDroppedFiles([msg]);

    expect(result.emails).toEqual([]);
    expect(result.nonEmail).toEqual([]);
    expect(result.skipped).toEqual([{ file: msg, reason: "no-fetcher" }]);
  });

  it("reports an .eml whose bytes cannot be read as skipped", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const eml = makeEmlFile(buildEml("<a@x>"), "broken.eml");
    eml.arrayBuffer = () => Promise.reject(new Error("read failed"));

    const result = await parseDroppedFiles([eml]);

    expect(result.emails).toEqual([]);
    expect(result.skipped).toEqual([{ file: eml, reason: "unparseable" }]);
    warnSpy.mockRestore();
  });

  it("partitions a mixed drop and leaves duplicates out of skipped", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetcher } = makeFetcherStub();
    const ok = makeEmlFile(buildEml("<ok@x>"), "ok.eml");
    const dup = makeEmlFile(buildEml("<ok@x>"), "dup.eml");
    const pdf = new File(["pdf"], "doc.pdf", { type: "application/pdf" });
    const broken = makeDroppedMsgFile(
      new Uint8Array([1, 2, 3, 4]),
      "broken.msg",
    );
    const claimed = new Set<string>();
    const tryAttachEmail = (messageId: string) => {
      if (claimed.has(messageId)) return false;
      claimed.add(messageId);
      return true;
    };

    const result = await parseDroppedFiles([ok, pdf, dup, broken], {
      fetcher,
      tryAttachEmail,
    });

    expect(result.emails.map((email) => email.messageId)).toEqual(["<ok@x>"]);
    expect(result.nonEmail).toEqual([pdf]);
    expect(result.skipped).toEqual([{ file: broken, reason: "unparseable" }]);
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("reports reading for every email in input order, then resolving for each .msg", async () => {
    const { fetcher } = makeFetcherStub();
    const eml = makeEmlFile(buildEml("<a@x>"), "a.eml");
    const msg = makeDroppedMsgFile(
      buildMsgWithInternetMessageId("<b@x>"),
      "b.msg",
    );
    const pdf = new File(["pdf"], "doc.pdf", { type: "application/pdf" });
    const onProgress = vi.fn<(progress: ParseDroppedFilesProgress) => void>();

    await parseDroppedFiles([eml, pdf, msg], { fetcher, onProgress });

    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([
      { stage: "reading", index: 1, total: 2, name: "a.eml" },
      { stage: "reading", index: 2, total: 2, name: "b.msg" },
      { stage: "resolving", index: 1, total: 1, name: "b.msg" },
    ]);
  });

  it("keeps input order and claims in input order when lookups finish out of order", async () => {
    const { fetcher, byteLookups } = makeFetcherStub((id) =>
      id === "<first@x>" ? 30 : 0,
    );
    const first = makeDroppedMsgFile(
      buildMsgWithInternetMessageId("<first@x>"),
      "first.msg",
    );
    const eml = makeEmlFile(buildEml("<middle@x>"), "middle.eml");
    const last = makeDroppedMsgFile(
      buildMsgWithInternetMessageId("<last@x>"),
      "last.msg",
    );
    const claims: string[] = [];
    const tryAttachEmail = vi.fn((messageId: string) => {
      claims.push(messageId);
      return true;
    });

    const result = await parseDroppedFiles([first, eml, last], {
      fetcher,
      tryAttachEmail,
    });

    expect(byteLookups).toEqual(["<first@x>", "<last@x>"]);
    expect(result.emails.map((email) => email.messageId)).toEqual([
      "<first@x>",
      "<middle@x>",
      "<last@x>",
    ]);
    expect(claims).toEqual(["<first@x>", "<middle@x>", "<last@x>"]);
  });

  it("drops the later duplicate when two .msg files resolve to the same email", async () => {
    const { fetcher } = makeFetcherStub((id) => (id === "<dup@x>" ? 20 : 0));
    const a = makeDroppedMsgFile(
      buildMsgWithInternetMessageId("<dup@x>"),
      "a.msg",
    );
    const b = makeDroppedMsgFile(
      buildMsgWithInternetMessageId("<dup@x>"),
      "b.msg",
    );
    const claimed = new Set<string>();
    const tryAttachEmail = (messageId: string) => {
      if (claimed.has(messageId)) return false;
      claimed.add(messageId);
      return true;
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await parseDroppedFiles([a, b], { fetcher, tryAttachEmail });

    expect(result.emails).toHaveLength(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("skipping"),
      "b.msg",
      "<dup@x>",
    );
    logSpy.mockRestore();
  });
});
