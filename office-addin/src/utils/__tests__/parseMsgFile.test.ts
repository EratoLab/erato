import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractMsgInternetMessageId } from "../extractMsgInternetMessageId";
import { fetchOutlookMessageFilesByInternetMessageIdViaGraph } from "../fetchOutlookMessageGraph";
import { parseMsgFileToFiles } from "../parseMsgFile";

vi.mock("../extractMsgInternetMessageId", () => ({
  extractMsgInternetMessageId: vi.fn(),
}));

vi.mock("../fetchOutlookMessageGraph", () => ({
  fetchOutlookMessageFilesByInternetMessageIdViaGraph: vi.fn(),
}));

const mockExtract = extractMsgInternetMessageId as unknown as ReturnType<
  typeof vi.fn
>;
const mockGraph =
  fetchOutlookMessageFilesByInternetMessageIdViaGraph as unknown as ReturnType<
    typeof vi.fn
  >;

describe("parseMsgFileToFiles", () => {
  beforeEach(() => {
    mockExtract.mockReset();
    mockGraph.mockReset();
  });

  it("returns the Graph-fetched files when the lookup succeeds", async () => {
    const bodyFile = new File(["<html>"], "body.html", { type: "text/html" });
    const attachmentFile = new File(["x"], "attach.pdf", {
      type: "application/pdf",
    });
    mockExtract.mockResolvedValue("<abc@host>");
    mockGraph.mockResolvedValue({
      subject: "Hi",
      files: [bodyFile, attachmentFile],
      internetMessageId: "<abc@host>",
    });

    const acquireToken = vi.fn().mockResolvedValue("tok");
    const file = new File([new Uint8Array([0])], "sample.msg");
    const result = await parseMsgFileToFiles(file, acquireToken);

    expect(mockExtract).toHaveBeenCalledWith(file);
    expect(mockGraph).toHaveBeenCalledWith("<abc@host>", acquireToken);
    expect(result).toEqual({
      files: [bodyFile, attachmentFile],
      messageId: "<abc@host>",
    });
  });

  it("returns empty files with null messageId when the Internet Message-ID cannot be read", async () => {
    mockExtract.mockResolvedValue(null);
    const acquireToken = vi.fn();

    const result = await parseMsgFileToFiles(
      new File([new Uint8Array(0)], "no-id.msg"),
      acquireToken,
    );

    expect(result).toEqual({ files: [], messageId: null });
    expect(mockGraph).not.toHaveBeenCalled();
  });

  it("returns empty files with null messageId when the CFB read throws", async () => {
    mockExtract.mockRejectedValue(new Error("bad bytes"));
    const acquireToken = vi.fn();

    const result = await parseMsgFileToFiles(
      new File([new Uint8Array(0)], "broken.msg"),
      acquireToken,
    );

    expect(result).toEqual({ files: [], messageId: null });
    expect(mockGraph).not.toHaveBeenCalled();
  });

  it("returns empty files but preserves messageId when Graph has no match", async () => {
    mockExtract.mockResolvedValue("<missing@host>");
    mockGraph.mockResolvedValue(null);
    const acquireToken = vi.fn().mockResolvedValue("tok");

    const result = await parseMsgFileToFiles(
      new File([new Uint8Array(0)], "missing.msg"),
      acquireToken,
    );

    expect(result).toEqual({ files: [], messageId: "<missing@host>" });
  });

  it("returns empty files but preserves messageId when Graph fetch throws", async () => {
    mockExtract.mockResolvedValue("<abc@host>");
    mockGraph.mockRejectedValue(new Error("graph down"));
    const acquireToken = vi.fn().mockResolvedValue("tok");

    const result = await parseMsgFileToFiles(
      new File([new Uint8Array(0)], "err.msg"),
      acquireToken,
    );

    expect(result).toEqual({ files: [], messageId: "<abc@host>" });
  });
});
