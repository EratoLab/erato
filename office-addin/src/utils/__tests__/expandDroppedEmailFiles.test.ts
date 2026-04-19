import { afterEach, describe, expect, it, vi } from "vitest";

import { expandDroppedEmailFiles } from "../expandDroppedEmailFiles";
import * as parseEmlFileModule from "../parseEmlFile";

import type * as ParseEmlFileModule from "../parseEmlFile";

vi.mock("../parseEmlFile", async () => {
  const actual =
    await vi.importActual<typeof ParseEmlFileModule>("../parseEmlFile");
  return {
    ...actual,
    parseEmlFileToFiles: vi.fn(),
  };
});

const mockedParse = vi.mocked(parseEmlFileModule.parseEmlFileToFiles);

describe("expandDroppedEmailFiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockedParse.mockReset();
  });

  it("expands .eml files and preserves order of mixed input", async () => {
    const eml = new File(["email"], "msg.eml", { type: "message/rfc822" });
    const pdf = new File(["pdfbytes"], "doc.pdf", { type: "application/pdf" });
    const body = new File(["<html></html>"], "msg.html", { type: "text/html" });
    const attach = new File(["a"], "a.txt", { type: "text/plain" });

    mockedParse.mockResolvedValueOnce([body, attach]);

    const result = await expandDroppedEmailFiles([eml, pdf]);
    expect(mockedParse).toHaveBeenCalledTimes(1);
    expect(result.map((f) => f.name)).toEqual(["msg.html", "a.txt", "doc.pdf"]);
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
    mockedParse.mockResolvedValueOnce([]);

    const result = await expandDroppedEmailFiles([eml]);
    expect(result).toEqual([]);
  });
});
