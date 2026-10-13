import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import {
  readWordDocument,
  WORD_PACKAGE_CAPTURE_TIMEOUT_MS,
  WORD_PARAGRAPH_READ_TIMEOUT_MS,
} from "../readWordDocument";
import {
  captureWordDocumentPackage,
  supportsWordDocumentPackage,
  WordDocumentCaptureTimeoutError,
  WordDocumentTransferError,
} from "../wordDocumentPackage";
import { WordDocumentTooLargeError } from "../wordDocumentPackageCodec";
import { wordInPlaceAvailability } from "../wordInPlaceSwitch";
import { wordParagraphIdsMissing } from "../wordParagraphIds";

import type { MockWordHost } from "../../../test/mocks/word/document";
import type * as wordDocumentPackageModule from "../wordDocumentPackage";

vi.mock("../wordDocumentPackage", async (importOriginal) => ({
  ...(await importOriginal<typeof wordDocumentPackageModule>()),
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

  it("keeps the paragraphs and drops authoring when the full package cannot be captured", async () => {
    vi.mocked(supportsWordDocumentPackage).mockReturnValueOnce(true);
    vi.mocked(captureWordDocumentPackage).mockRejectedValueOnce(
      new WordDocumentTransferError("Word could not read a document slice."),
    );

    const result = await readWordDocument(true);

    expect(result.ok && result.paragraphs).toHaveLength(3);
    expect(result.ok && result.authoring).toBeUndefined();
    expect(result.ok && result.authoringUnavailable).toEqual({
      issue: "unavailable",
      detail: "package-failed",
      error:
        "full-document capture: WordDocumentTransferError: Word could not read a document slice.",
    });
  });

  describe("on Word for the web", () => {
    const onPlatform = (platform: string) => {
      (Office.context as unknown as Record<string, unknown>).diagnostics = {
        platform,
      };
    };
    beforeEach(() => onPlatform("OfficeOnline"));
    afterEach(() => {
      delete (Office.context as unknown as Record<string, unknown>).diagnostics;
    });

    it("reads the body for authoring when Word refuses to open the file, as for a labelled document", async () => {
      vi.mocked(supportsWordDocumentPackage).mockReturnValueOnce(true);
      vi.mocked(captureWordDocumentPackage).mockRejectedValueOnce(
        new WordDocumentTransferError(
          "Word could not capture the document.",
          true,
          11001,
        ),
      );
      word.word.setTrackingMode("TrackAll");

      const result = await readWordDocument(true);

      expect(word.word.run).toHaveBeenCalledTimes(2);
      expect(result.ok && result.paragraphs).toHaveLength(3);
      expect(result.ok && result.authoringUnavailable).toBeUndefined();
      expect(result.ok && result.note).toBe("package-blocked");
      expect(result.ok && result.authoring).toMatchObject({
        fullDocument: false,
        tracking: "TrackAll",
      });
      expect(result.ok && result.authoring?.ooxml).toContain("Revenue grew.");
    });

    it.each([
      [
        "a transfer that fails part-way",
        new WordDocumentTransferError("Word could not read a document slice."),
      ],
      [
        "a document that changes during capture",
        new WordDocumentTransferError(
          "The open document changed during capture.",
        ),
      ],
      [
        "both file handles held",
        new WordDocumentTransferError(
          "Word could not capture the document.",
          true,
          11000,
        ),
      ],
      [
        "a refusal with another Office code",
        new WordDocumentTransferError(
          "Word could not capture the document.",
          true,
          5001,
        ),
      ],
      [
        "a refusal without an Office code",
        new WordDocumentTransferError(
          "Word could not capture the document.",
          true,
        ),
      ],
    ])("keeps today's result for %s", async (_, error) => {
      vi.mocked(supportsWordDocumentPackage).mockReturnValueOnce(true);
      vi.mocked(captureWordDocumentPackage).mockRejectedValueOnce(error);

      const result = await readWordDocument(true);

      expect(word.word.run).toHaveBeenCalledTimes(1);
      expect(result.ok && result.note).toBeUndefined();
      expect(result.ok && result.authoring).toBeUndefined();
      expect(result.ok && result.authoringUnavailable).toMatchObject({
        issue: "unavailable",
        detail: "package-failed",
      });
    });

    it("keeps today's result when the body read fails as well", async () => {
      vi.mocked(supportsWordDocumentPackage).mockReturnValueOnce(true);
      vi.mocked(captureWordDocumentPackage).mockRejectedValueOnce(
        new WordDocumentTransferError(
          "Word could not capture the document.",
          true,
          11001,
        ),
      );
      const run = word.word.run.getMockImplementation()!;
      word.word.run
        .mockImplementationOnce(run)
        .mockRejectedValueOnce(new Error("Body unavailable"));

      const result = await readWordDocument(true);

      expect(result.ok && result.note).toBeUndefined();
      expect(result.ok && result.authoring).toBeUndefined();
      expect(result.ok && result.authoringUnavailable).toMatchObject({
        issue: "unavailable",
        detail: "package-failed",
      });
    });

    it.each([
      [
        new WordDocumentTooLargeError("The expanded document is too large."),
        "too-large",
        "package-too-large",
      ],
      [new WordDocumentCaptureTimeoutError(), "unavailable", "package-timeout"],
    ] as const)("keeps today's result for %s", async (error, issue, detail) => {
      vi.mocked(supportsWordDocumentPackage).mockReturnValueOnce(true);
      vi.mocked(captureWordDocumentPackage).mockRejectedValueOnce(error);

      const result = await readWordDocument(true);

      expect(word.word.run).toHaveBeenCalledTimes(1);
      expect(result.ok && result.note).toBeUndefined();
      expect(result.ok && result.authoringUnavailable).toMatchObject({
        issue,
        detail,
      });
    });

    it("keeps today's result for a failed transfer on Word PC", async () => {
      onPlatform("PC");
      vi.mocked(supportsWordDocumentPackage).mockReturnValueOnce(true);
      vi.mocked(captureWordDocumentPackage).mockRejectedValueOnce(
        new WordDocumentTransferError(
          "Word could not capture the document.",
          true,
          11001,
        ),
      );

      const result = await readWordDocument(true);

      expect(word.word.run).toHaveBeenCalledTimes(1);
      expect(result.ok && result.authoring).toBeUndefined();
      expect(result.ok && result.authoringUnavailable).toMatchObject({
        issue: "unavailable",
        detail: "package-failed",
      });
    });
  });

  it.each([
    [
      new WordDocumentTooLargeError("The expanded document is too large."),
      "too-large",
      "package-too-large",
    ],
    [new WordDocumentCaptureTimeoutError(), "unavailable", "package-timeout"],
    [
      new Error("The proposed XML is incomplete or malformed."),
      "unavailable",
      "package-unsupported",
    ],
  ] as const)(
    "classifies a package failure: %s",
    async (error, issue, detail) => {
      vi.mocked(supportsWordDocumentPackage).mockReturnValueOnce(true);
      vi.mocked(captureWordDocumentPackage).mockRejectedValueOnce(error);

      const result = await readWordDocument(true);

      expect(result.ok && result.authoringUnavailable).toMatchObject({
        issue,
        detail,
      });
    },
  );

  it("keeps the paragraphs when the full transfer outlasts its deadline", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(supportsWordDocumentPackage).mockReturnValueOnce(true);
      vi.mocked(captureWordDocumentPackage).mockReturnValueOnce(
        new Promise(() => {}),
      );
      const read = readWordDocument(true);
      await vi.advanceTimersByTimeAsync(WORD_PACKAGE_CAPTURE_TIMEOUT_MS);

      const result = await read;
      expect(result.ok && result.paragraphs).toHaveLength(3);
      expect(result.ok && result.authoringUnavailable).toMatchObject({
        issue: "unavailable",
        detail: "package-timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting for a paragraph read that never settles", async () => {
    vi.useFakeTimers();
    try {
      word.word.run.mockReturnValueOnce(new Promise(() => {}));
      const read = readWordDocument();
      await vi.advanceTimersByTimeAsync(WORD_PARAGRAPH_READ_TIMEOUT_MS);
      await expect(read).resolves.toEqual({
        ok: false,
        error: "paragraph read: Error: timed out after 30000 ms",
      });
    } finally {
      vi.useRealTimers();
    }
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

describe("readWordDocument without paragraph IDs", () => {
  let word: MockWordHost;
  beforeEach(() => {
    word = installMockWordDocument([{ text: "One" }, { text: "Two" }]);
  });
  afterEach(() => {
    delete window.WORD_FORCE_NO_PARAGRAPH_IDS;
    uninstallMockWordDocument();
  });

  it("reads missing IDs as null and keeps the session out of in-place writing", async () => {
    word.word.hideParagraphIds(true);
    const missing = await readWordDocument();
    expect(
      missing.ok && missing.paragraphs.map((p) => p.uniqueLocalId),
    ).toEqual([null, null]);
    expect(wordParagraphIdsMissing()).toBe(true);
    expect(wordInPlaceAvailability()).toEqual({
      enabled: false,
      reason: "no-paragraph-ids",
    });

    word.word.hideParagraphIds(false);
    await readWordDocument();
    expect(wordParagraphIdsMissing()).toBe(false);
    expect(wordInPlaceAvailability()).toEqual({
      enabled: false,
      reason: "no-package",
    });
  });

  it("treats every ID as missing while the development switch is on", async () => {
    window.WORD_FORCE_NO_PARAGRAPH_IDS = true;
    const result = await readWordDocument();
    expect(result.ok && result.paragraphs.map((p) => p.uniqueLocalId)).toEqual([
      null,
      null,
    ]);
    expect(wordParagraphIdsMissing()).toBe(true);
  });
});
