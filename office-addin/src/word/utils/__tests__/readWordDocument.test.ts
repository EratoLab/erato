import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { WORD_SEND_CAPTURE_DEADLINE_MS } from "../../components/WordChatInput";
import {
  readWordDocument,
  WORD_PACKAGE_CAPTURE_TIMEOUT_MS,
  WORD_PARAGRAPH_READ_TIMEOUT_MS,
  WORD_PROOFING_DEADLINE_MS,
  WORD_PROOFING_WINDOW_MS,
} from "../readWordDocument";
import {
  captureWordDocumentPackage,
  insertWordDocumentFile,
  supportsWordDocumentPackage,
  syncWordDocumentImport,
  WordDocumentCaptureTimeoutError,
  WordDocumentTransferError,
  wordDocumentOoxmlToFile,
  wordPackageFingerprint,
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

  describe.each(["TrackAll", "Off"] as const)(
    "with Track Changes %s",
    (mode) => {
      it.each([
        [
          new WordDocumentTooLargeError("The expanded document is too large."),
          "package-too-large",
        ],
        [new WordDocumentCaptureTimeoutError(), "package-timeout"],
        [new WordDocumentTransferError("Slice failed."), "package-failed"],
        [new Error("Missing relationship target: NULL"), "package-unsupported"],
      ] as const)(
        "keeps the mode when the package fails: %s",
        async (error, detail) => {
          word.word.setTrackingMode(mode);
          vi.mocked(supportsWordDocumentPackage).mockReturnValueOnce(true);
          vi.mocked(captureWordDocumentPackage).mockRejectedValueOnce(error);

          const result = await readWordDocument(true);

          expect(result.ok && result.authoringUnavailable?.detail).toBe(detail);
          expect(result.ok && result.tracking).toBe(mode);
        },
      );

      it("reads the mode without authoring", async () => {
        word.word.setTrackingMode(mode);

        const result = await readWordDocument();

        expect(result.ok && result.tracking).toBe(mode);
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

describe("readWordDocument on Word for Mac while its proofing pass is pending", () => {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
  const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
  const R =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const TEXTS = ["The Annual Report", "Der Umsatz stieg.", "Revenue grew."];
  /** A de-DE document as Word for Mac exports it: English paragraphs gain w:lang en-GB, mark and
   * runs, as its proofing pass reaches them; w:proofState follows once the pass is done. */
  const macPackage = ({
    tagged = [] as number[],
    clean = false,
    texts = TEXTS,
  } = {}) => {
    const lang = `<w:rPr><w:lang w:val="en-GB"/></w:rPr>`;
    const body = texts
      .map((text, i) =>
        tagged.includes(i)
          ? `<w:p w:rsidRPr="00DC4D6D"><w:pPr>${lang}</w:pPr><w:r w:rsidRPr="00DC4D6D">${lang}<w:t>${text}</w:t></w:r></w:p>`
          : `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
      )
      .join("");
    const part = (name: string, type: string, xml: string) =>
      `<pkg:part pkg:name="${name}" pkg:contentType="${type}"><pkg:xmlData>${xml}</pkg:xmlData></pkg:part>`;
    return `<pkg:package xmlns:pkg="${PKG}">${[
      part(
        "/_rels/.rels",
        "application/vnd.openxmlformats-package.relationships+xml",
        `<Relationships xmlns="${REL}"><Relationship Id="root" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
      part(
        "/word/document.xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
      ),
      part(
        "/word/_rels/document.xml.rels",
        "application/vnd.openxmlformats-package.relationships+xml",
        `<Relationships xmlns="${REL}"><Relationship Id="settings" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
      ),
      part(
        "/word/settings.xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
        `<w:settings xmlns:w="${W}">${clean ? `<w:proofState w:spelling="clean" w:grammar="clean"/>` : ""}<w:themeFontLang w:val="de-DE"/></w:settings>`,
      ),
    ].join("")}</pkg:package>`;
  };
  const snapshot = (ooxml: string, documentUrl: string) =>
    ({
      ooxml,
      documentUrl,
      bytes: new Uint8Array(),
      get fingerprint() {
        return wordPackageFingerprint(ooxml);
      },
    }) as Awaited<ReturnType<typeof captureWordDocumentPackage>>;
  const openDocument = (documentUrl: string) => {
    (Office.context.document as { url: string }).url = documentUrl;
  };
  /** Word's reads in order; the last one repeats. */
  const reads = (documentUrl: string, ...packages: string[]) => {
    openDocument(documentUrl);
    let next = 0;
    vi.mocked(captureWordDocumentPackage).mockImplementation(async () =>
      snapshot(packages[Math.min(next++, packages.length - 1)], documentUrl),
    );
    return () => next;
  };
  const onPlatform = (platform: string) => {
    (Office.context as unknown as Record<string, unknown>).diagnostics = {
      platform,
    };
  };
  /** Starts the window as an import does. */
  const imported = async () => {
    const context = {
      document: { insertFileFromBase64: vi.fn() },
      sync: async () => {},
    } as unknown as Word.RequestContext;
    insertWordDocumentFile(context, wordDocumentOoxmlToFile(macPackage()));
    await syncWordDocumentImport(context);
  };
  /** Each read takes `ms`, and Word tags one more paragraph per read without reporting done. */
  const slowTagging = (documentUrl: string, ms: number) => {
    openDocument(documentUrl);
    const texts = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}.`);
    const transfers = { started: 0, finished: 0 };
    vi.mocked(captureWordDocumentPackage).mockImplementation(() => {
      const index = transfers.started++;
      return new Promise((resolve) =>
        setTimeout(() => {
          transfers.finished++;
          resolve(
            snapshot(
              macPackage({
                texts,
                tagged: Array.from({ length: index }, (_, j) => j),
              }),
              documentUrl,
            ),
          );
        }, ms),
      );
    });
    return transfers;
  };
  const capture = async (advanceMs: number) => {
    const read = readWordDocument(true);
    await vi.advanceTimersByTimeAsync(advanceMs);
    const result = await read;
    return result.ok ? result.authoring : undefined;
  };

  beforeEach(() => {
    installMockWordDocument(TEXTS.map((text) => ({ text })));
    vi.mocked(supportsWordDocumentPackage).mockReturnValue(true);
    onPlatform("Mac");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(supportsWordDocumentPackage).mockReset();
    vi.mocked(supportsWordDocumentPackage).mockReturnValue(false);
    vi.mocked(captureWordDocumentPackage).mockReset();
    delete (Office.context as unknown as Record<string, unknown>).diagnostics;
    uninstallMockWordDocument();
  });

  it("waits until Word reports the pass done and captures Word's language tags with it", async () => {
    await imported();
    const done = macPackage({ tagged: [0, 2], clean: true });
    const count = reads(
      "https://contoso.example/opened.docx",
      macPackage(),
      macPackage(),
      macPackage(),
      macPackage({ tagged: [0] }),
      done,
    );

    expect(await capture(10_000)).toMatchObject({ ooxml: done });
    expect(count()).toBe(5);
  });

  it("captures at once when Word reports the pass done", async () => {
    const count = reads(
      "https://contoso.example/settled.docx",
      macPackage({ tagged: [0, 2], clean: true }),
    );

    await capture(0);
    expect(count()).toBe(1);
  });

  it.each(["PC", "OfficeOnline"])("does not wait on %s", async (platform) => {
    onPlatform(platform);
    const count = reads(
      `https://contoso.example/${platform}.docx`,
      macPackage(),
      macPackage({ tagged: [0, 2], clean: true }),
    );

    expect(await capture(WORD_PROOFING_DEADLINE_MS)).toEqual(
      expect.objectContaining({ ooxml: macPackage() }),
    );
    expect(count()).toBe(1);
  });

  it("stops at a change that is not Word's tagging and keeps the read before it", async () => {
    await imported();
    const first = macPackage();
    const count = reads(
      "https://contoso.example/edited.docx",
      first,
      macPackage({ texts: ["The Annual Report", "Edited.", "Revenue grew."] }),
      macPackage({ tagged: [0, 2], clean: true }),
    );

    expect(await capture(10_000)).toMatchObject({
      ooxml: first,
      proofingPending: "changed",
    });
    expect(count()).toBe(2);
  });

  it("stops after the window once nothing happens, and then no longer waits for that document", async () => {
    vi.setSystemTime(Date.now() + 10 * WORD_PROOFING_WINDOW_MS);
    const count = reads("https://contoso.example/quiet.docx", macPackage());

    const quiet = await capture(WORD_PROOFING_DEADLINE_MS);
    expect(quiet?.ooxml).toBe(macPackage());
    expect(quiet?.proofingPending).toBeUndefined();
    expect(count()).toBe(4);

    await capture(WORD_PROOFING_DEADLINE_MS);
    expect(count()).toBe(5);
  });

  it("waits through the window after an import for a pass that has not started", async () => {
    vi.setSystemTime(Date.now() + 20 * WORD_PROOFING_WINDOW_MS);
    await imported();
    const done = macPackage({ tagged: [0, 2], clean: true });
    const count = reads(
      "https://contoso.example/reimported.docx",
      ...Array.from({ length: 9 }, () => macPackage()),
      done,
    );

    expect(await capture(WORD_PROOFING_WINDOW_MS)).toMatchObject({
      ooxml: done,
    });
    expect(count()).toBe(10);
  });

  it("bounds the wait while Word keeps tagging", async () => {
    await imported();
    const texts = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}.`);
    const count = reads(
      "https://contoso.example/long.docx",
      ...texts.map((_, i) =>
        macPackage({ texts, tagged: Array.from({ length: i }, (_, j) => j) }),
      ),
    );

    const captured = await capture(2 * WORD_PROOFING_DEADLINE_MS);
    expect(count()).toBe(1 + WORD_PROOFING_DEADLINE_MS / 1_000);
    expect(captured).toMatchObject({
      ooxml: macPackage({
        texts,
        tagged: Array.from({ length: count() - 1 }, (_, j) => j),
      }),
      proofingPending: "tagging",
    });
  });

  it("does not wait past the read's deadline after a slow transfer, and marks the capture for the next send", async () => {
    await imported();
    const texts = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}.`);
    const count = reads(
      "https://contoso.example/slow.docx",
      ...texts.map((_, i) =>
        macPackage({ texts, tagged: Array.from({ length: i }, (_, j) => j) }),
      ),
    );
    const slow = WORD_PROOFING_DEADLINE_MS - 16_000;
    const reading = vi
      .mocked(captureWordDocumentPackage)
      .getMockImplementation()!;
    vi.mocked(captureWordDocumentPackage).mockImplementationOnce(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(reading()), slow)),
    );

    const captured = await capture(WORD_PROOFING_DEADLINE_MS + 5_000);
    expect(count()).toBe(1 + 16);
    expect(captured).toMatchObject({ proofingPending: "tagging" });
  });

  it("fails the capture when another document becomes active while it waits", async () => {
    await imported();
    let next = 0;
    vi.mocked(captureWordDocumentPackage).mockImplementation(async () =>
      snapshot(
        macPackage(),
        next++
          ? "https://contoso.example/other.docx"
          : "https://contoso.example/first.docx",
      ),
    );

    const read = readWordDocument(true);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await read;
    expect(result.ok && result.authoring).toBeUndefined();
    expect(result.ok && result.authoringUnavailable).toMatchObject({
      issue: "unavailable",
      detail: "package-failed",
    });
  });

  it("fails the capture when the open document changes during a poll", async () => {
    await imported();
    const url = "https://contoso.example/renamed.docx";
    openDocument(url);
    let next = 0;
    vi.mocked(captureWordDocumentPackage).mockImplementation(async () => {
      if (!next++) return snapshot(macPackage(), url);
      openDocument("https://contoso.example/saved-as.docx");
      throw new WordDocumentTransferError(
        "The open document changed during capture.",
      );
    });

    const read = readWordDocument(true);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await read;
    expect(result.ok && result.authoring).toBeUndefined();
    expect(result.ok && result.authoringUnavailable).toMatchObject({
      issue: "unavailable",
      detail: "package-failed",
    });
  });

  it("ends the wait in time for the send's capture deadline while Word keeps tagging", async () => {
    await imported();
    slowTagging("https://contoso.example/send.docx", 500);

    let settled = false;
    const read = readWordDocument(true).finally(() => {
      settled = true;
    });
    // Leaves the send's deadline room to build the snapshot from the read.
    await vi.advanceTimersByTimeAsync(WORD_SEND_CAPTURE_DEADLINE_MS - 5_000);
    expect(settled).toBe(true);
    const result = await read;
    expect(result.ok && result.authoring).toMatchObject({
      proofingPending: "tagging",
    });
  });

  it("does not start a poll it cannot finish before the deadline", async () => {
    await imported();
    const transfers = slowTagging(
      "https://contoso.example/handles.docx",
      4_500,
    );

    let running = -1;
    const read = readWordDocument(true).then((result) => {
      running = transfers.started - transfers.finished;
      return result;
    });
    await vi.advanceTimersByTimeAsync(WORD_PROOFING_DEADLINE_MS + 10_000);
    const result = await read;
    expect(transfers.started).toBeGreaterThan(2);
    expect(running).toBe(0);
    expect(result.ok && result.authoring).toMatchObject({
      proofingPending: "tagging",
    });
  });

  it("keeps waiting for a document whose last wait the deadline cut short", async () => {
    vi.setSystemTime(Date.now() + 40 * WORD_PROOFING_WINDOW_MS);
    const count = reads("https://contoso.example/cut.docx", macPackage());
    const reading = vi
      .mocked(captureWordDocumentPackage)
      .getMockImplementation()!;
    vi.mocked(captureWordDocumentPackage).mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(reading()),
            WORD_PROOFING_DEADLINE_MS - 2_000,
          ),
        ),
    );

    expect(await capture(WORD_PROOFING_DEADLINE_MS)).toMatchObject({
      proofingPending: "tagging",
    });
    const before = count();
    const quiet = await capture(WORD_PROOFING_DEADLINE_MS);
    expect(quiet?.proofingPending).toBeUndefined();
    expect(count() - before).toBe(4);
  });

  it("waits again for a quiet document once an import starts a new pass", async () => {
    vi.setSystemTime(Date.now() + 50 * WORD_PROOFING_WINDOW_MS);
    const url = "https://contoso.example/quiet-import.docx";
    let count = reads(url, macPackage());
    await capture(WORD_PROOFING_DEADLINE_MS);
    expect(count()).toBe(4);
    await capture(WORD_PROOFING_DEADLINE_MS);
    expect(count()).toBe(5);

    await imported();
    const done = macPackage({ tagged: [0, 2], clean: true });
    count = reads(
      url,
      macPackage(),
      macPackage(),
      macPackage({ tagged: [0] }),
      done,
    );
    expect(await capture(WORD_PROOFING_WINDOW_MS)).toMatchObject({
      ooxml: done,
    });
    expect(count()).toBe(4);
  });
});
