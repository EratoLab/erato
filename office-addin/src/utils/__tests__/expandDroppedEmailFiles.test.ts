import { afterEach, describe, expect, it, vi } from "vitest";

import { expandDroppedEmailFiles } from "../expandDroppedEmailFiles";
import * as parseEmlFileModule from "../parseEmlFile";
import * as parseMsgFileModule from "../parseMsgFile";

import type * as ParseEmlFileModule from "../parseEmlFile";
import type * as ParseMsgFileModule from "../parseMsgFile";

vi.mock("../parseEmlFile", async () => {
  const actual =
    await vi.importActual<typeof ParseEmlFileModule>("../parseEmlFile");
  return {
    ...actual,
    parseEmlFileToFiles: vi.fn(),
  };
});

vi.mock("../parseMsgFile", async () => {
  const actual =
    await vi.importActual<typeof ParseMsgFileModule>("../parseMsgFile");
  return {
    ...actual,
    parseMsgFileToFiles: vi.fn(),
  };
});

const mockedParse = vi.mocked(parseEmlFileModule.parseEmlFileToFiles);
const mockedParseMsg = vi.mocked(parseMsgFileModule.parseMsgFileToFiles);

describe("expandDroppedEmailFiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockedParse.mockReset();
    mockedParseMsg.mockReset();
  });

  it("expands .eml files and preserves order of mixed input", async () => {
    const eml = new File(["email"], "msg.eml", { type: "message/rfc822" });
    const pdf = new File(["pdfbytes"], "doc.pdf", { type: "application/pdf" });
    const raw = new File(["email"], "msg.eml", { type: "message/rfc822" });
    const attach = new File(["a"], "a.txt", { type: "text/plain" });

    mockedParse.mockResolvedValueOnce({
      files: [raw, attach],
      messageId: "<m1@x>",
    });

    const result = await expandDroppedEmailFiles([eml, pdf]);
    expect(mockedParse).toHaveBeenCalledTimes(1);
    expect(result.map((f) => f.name)).toEqual(["msg.eml", "a.txt", "doc.pdf"]);
  });

  it("passes non-eml files through unchanged", async () => {
    const pdf = new File(["pdfbytes"], "doc.pdf", { type: "application/pdf" });
    const png = new File(["pngbytes"], "img.png", { type: "image/png" });

    const result = await expandDroppedEmailFiles([pdf, png]);
    expect(mockedParse).not.toHaveBeenCalled();
    expect(result).toEqual([pdf, png]);
  });

  it("returns [] when the only .eml input fails to parse", async () => {
    const eml = new File(["email"], "msg.eml", { type: "message/rfc822" });
    mockedParse.mockResolvedValueOnce({ files: [], messageId: null });

    const result = await expandDroppedEmailFiles([eml]);
    expect(result).toEqual([]);
  });

  it("drops a parsed .eml when tryAttachEmail returns false", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const eml = new File(["email"], "msg.eml", { type: "message/rfc822" });
    const raw = new File(["email"], "msg.eml", { type: "message/rfc822" });
    mockedParse.mockResolvedValueOnce({
      files: [raw],
      messageId: "<preview@host>",
    });

    const tryAttachEmail = vi.fn(
      (messageId: string) => messageId !== "<preview@host>",
    );

    const result = await expandDroppedEmailFiles([eml], { tryAttachEmail });

    expect(tryAttachEmail).toHaveBeenCalledWith("<preview@host>");
    expect(result).toEqual([]);
    expect(logSpy).toHaveBeenCalled();
  });

  it("keeps a parsed .eml when tryAttachEmail returns true", async () => {
    const eml = new File(["email"], "msg.eml", { type: "message/rfc822" });
    const raw = new File(["email"], "msg.eml", { type: "message/rfc822" });
    mockedParse.mockResolvedValueOnce({
      files: [raw],
      messageId: "<other@host>",
    });

    const tryAttachEmail = vi.fn(() => true);

    const result = await expandDroppedEmailFiles([eml], { tryAttachEmail });

    expect(tryAttachEmail).toHaveBeenCalledWith("<other@host>");
    expect(result).toEqual([raw]);
  });

  it("does not consult tryAttachEmail when the parsed email has no Message-ID", async () => {
    const eml = new File(["email"], "msg.eml", { type: "message/rfc822" });
    const raw = new File(["email"], "msg.eml", { type: "message/rfc822" });
    mockedParse.mockResolvedValueOnce({ files: [raw], messageId: null });

    const tryAttachEmail = vi.fn(() => false);

    const result = await expandDroppedEmailFiles([eml], { tryAttachEmail });

    expect(tryAttachEmail).not.toHaveBeenCalled();
    expect(result).toEqual([raw]);
  });

  it("does not consult tryAttachEmail when parsing produced no files", async () => {
    const eml = new File(["email"], "msg.eml", { type: "message/rfc822" });
    mockedParse.mockResolvedValueOnce({ files: [], messageId: "<m@x>" });
    const tryAttachEmail = vi.fn();

    await expandDroppedEmailFiles([eml], { tryAttachEmail });

    expect(tryAttachEmail).not.toHaveBeenCalled();
  });

  it("invokes tryAttachEmail for a successfully expanded .msg", async () => {
    const msg = new File([new Uint8Array([0])], "item.msg", {
      type: "application/vnd.ms-outlook",
    });
    const body = new File(["<html>"], "body.html", { type: "text/html" });
    const acquireGraphToken = vi.fn();
    const tryAttachEmail = vi.fn(() => true);
    mockedParseMsg.mockResolvedValueOnce({
      files: [body],
      messageId: "<msg@x>",
    });

    await expandDroppedEmailFiles([msg], {
      acquireGraphToken,
      tryAttachEmail,
    });

    expect(tryAttachEmail).toHaveBeenCalledWith("<msg@x>");
  });

  it("drops a .msg when tryAttachEmail returns false", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const msg = new File([new Uint8Array([0])], "item.msg", {
      type: "application/vnd.ms-outlook",
    });
    const body = new File(["<html>"], "body.html", { type: "text/html" });
    mockedParseMsg.mockResolvedValueOnce({
      files: [body],
      messageId: "<preview@host>",
    });
    const acquireGraphToken = vi.fn();
    const tryAttachEmail = vi.fn(
      (messageId: string) => messageId !== "<preview@host>",
    );

    const result = await expandDroppedEmailFiles([msg], {
      acquireGraphToken,
      tryAttachEmail,
    });

    expect(tryAttachEmail).toHaveBeenCalledWith("<preview@host>");
    expect(result).toEqual([]);
    expect(logSpy).toHaveBeenCalled();
  });

  it("routes .msg files through parseMsgFileToFiles when a Graph token is provided", async () => {
    const msg = new File([new Uint8Array([0])], "item.msg", {
      type: "application/vnd.ms-outlook",
    });
    const body = new File(["<html>"], "body.html", { type: "text/html" });
    const acquireGraphToken = vi.fn();
    mockedParseMsg.mockResolvedValueOnce({
      files: [body],
      messageId: "<m@x>",
    });

    const result = await expandDroppedEmailFiles([msg], { acquireGraphToken });

    expect(mockedParseMsg).toHaveBeenCalledTimes(1);
    expect(mockedParseMsg).toHaveBeenCalledWith(msg, acquireGraphToken);
    expect(result).toEqual([body]);
  });

  it("skips .msg files when no Graph token is available and logs a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const msg = new File([new Uint8Array([0])], "item.msg");

    const result = await expandDroppedEmailFiles([msg]);

    expect(result).toEqual([]);
    expect(mockedParseMsg).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("matches .msg by filename extension even when MIME is empty", async () => {
    const msg = new File([new Uint8Array([0])], "NoType.MSG");
    const acquireGraphToken = vi.fn();
    mockedParseMsg.mockResolvedValueOnce({ files: [], messageId: null });

    await expandDroppedEmailFiles([msg], { acquireGraphToken });

    expect(mockedParseMsg).toHaveBeenCalledWith(msg, acquireGraphToken);
  });
});
