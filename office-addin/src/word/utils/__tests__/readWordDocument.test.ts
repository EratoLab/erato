import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { readWordDocument } from "../readWordDocument";
import {
  captureWordDocumentPackage,
  supportsWordDocumentPackage,
} from "../wordDocumentPackage";

import type { MockWordHost } from "../../../test/mocks/word/document";

vi.mock("../wordDocumentPackage", () => ({
  supportsWordDocumentPackage: vi.fn(() => false),
  captureWordDocumentPackage: vi.fn(),
}));

describe("readWordDocument", () => {
  let word: MockWordHost;

  afterEach(() => {
    uninstallMockWordDocument();
  });

  beforeEach(() => {
    word = installMockWordDocument([
      { text: "The Annual Report", styleBuiltIn: "Title", outlineLevel: 1 },
      { text: "" },
      { text: "Revenue grew.", uniqueLocalId: "para-revenue" },
    ]);
  });

  it("returns every paragraph with its ordinal, text, id and style", async () => {
    const result = await readWordDocument();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs).toEqual([
      {
        ordinal: 1,
        text: "The Annual Report",
        uniqueLocalId: "id-1",
        styleBuiltIn: "Title",
        outlineLevel: 1,
      },
      {
        ordinal: 2,
        text: "",
        uniqueLocalId: "id-2",
        styleBuiltIn: "Normal",
        outlineLevel: 10,
      },
      {
        ordinal: 3,
        text: "Revenue grew.",
        uniqueLocalId: "para-revenue",
        styleBuiltIn: "Normal",
        outlineLevel: 10,
      },
    ]);
  });

  it("reads the ids and the text inside ONE Word.run", async () => {
    await readWordDocument();

    expect(word.word.run).toHaveBeenCalledTimes(1);
    expect(word.word.syncCount()).toBe(2);
  });

  const countBodyOoxmlReads = () => {
    const reads = { count: 0 };
    const run = word.word.run.getMockImplementation()!;
    word.word.run.mockImplementationOnce((callback) =>
      run(async (raw: unknown) => {
        const context = raw as Word.RequestContext;
        const getOoxml = context.document.body.getOoxml.bind(
          context.document.body,
        );
        context.document.body.getOoxml = () => {
          reads.count += 1;
          return getOoxml();
        };
        return callback(context);
      }),
    );
    return reads;
  };

  it("reads the body OOXML for authoring without a full package", async () => {
    const reads = countBodyOoxmlReads();

    const result = await readWordDocument(true);

    expect(reads.count).toBe(1);
    expect(result.ok && result.authoring?.fullDocument).toBeFalsy();
    expect(result.ok && result.authoring?.ooxml).toContain("Revenue grew.");
  });

  it("skips the body OOXML when the full package replaces it", async () => {
    vi.mocked(supportsWordDocumentPackage).mockReturnValueOnce(true);
    vi.mocked(captureWordDocumentPackage).mockResolvedValueOnce({
      ooxml: "<package/>",
      documentUrl: "https://contoso.example/a.docx",
    } as Awaited<ReturnType<typeof captureWordDocumentPackage>>);
    const reads = countBodyOoxmlReads();

    const result = await readWordDocument(true);

    expect(reads.count).toBe(0);
    expect(result.ok && result.authoring).toMatchObject({
      ooxml: "<package/>",
      fullDocument: true,
      documentUrl: "https://contoso.example/a.docx",
    });
  });

  it("resolves to a failure when the full package cannot be captured", async () => {
    vi.mocked(supportsWordDocumentPackage).mockReturnValueOnce(true);
    vi.mocked(captureWordDocumentPackage).mockRejectedValueOnce(
      new Error("The expanded document is too large."),
    );

    await expect(readWordDocument(true)).resolves.toEqual({
      ok: false,
      error:
        "full-document capture: Error: The expanded document is too large.",
    });
  });

  it("resolves to a failure when the run rejects", async () => {
    word.word.run.mockRejectedValueOnce(
      Object.assign(new Error("private document text"), {
        code: "GeneralException",
      }),
    );

    await expect(readWordDocument()).resolves.toEqual({
      ok: false,
      error: "paragraph read: Error",
    });
  });

  it("resolves to a failure when the host exposes no Word namespace", async () => {
    delete (globalThis as Record<string, unknown>).Word;

    await expect(readWordDocument()).resolves.toEqual({ ok: false });
  });

  it("resolves to a failure when Word.run is not callable", async () => {
    (globalThis as Record<string, unknown>).Word = {};

    await expect(readWordDocument()).resolves.toEqual({ ok: false });
  });
});
