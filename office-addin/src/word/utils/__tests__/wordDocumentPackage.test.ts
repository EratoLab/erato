import { removeWordDetectedLanguages } from "@erato/frontend/word-review";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureWordDocumentPackage,
  decodeWordDocumentBackup,
  decodeWordInPlaceBackup,
  encodeWordDocumentBackup,
  insertWordDocumentFile,
  isWordDocumentBackup,
  readWordDocumentFile,
  syncWordDocumentImport,
  withWordInPlaceBackup,
  WORD_DOCUMENT_IMPORT_OPTIONS,
  WORD_FILE_OPEN_TIMEOUT_MS,
  WordDocumentCaptureTimeoutError,
  wordDocumentFileToOoxml,
  wordDocumentImportedAt,
  wordDocumentOoxmlToFile,
  wordPackageFingerprint,
  wordPackagesDifferInDetectedLanguageOnly,
  wordProofingComplete,
} from "../wordDocumentPackage";
import {
  readWordPackage,
  WordDocumentTooLargeError,
  wordXmlText,
} from "../wordDocumentPackageCodec";

import type * as wordReviewModule from "@erato/frontend/word-review";

vi.mock("@erato/frontend/word-review", async (importOriginal) => {
  const actual = await importOriginal<typeof wordReviewModule>();
  return {
    ...actual,
    removeWordDetectedLanguages: vi.fn(actual.removeWordDetectedLanguages),
  };
});

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
function fixture(footer = "Original footer") {
  const part = (name: string, type: string, body: string, binary = false) =>
    `<pkg:part pkg:name="${name}" pkg:contentType="${type}"><pkg:${binary ? "binaryData" : "xmlData"}>${body}</pkg:${binary ? "binaryData" : "xmlData"}></pkg:part>`;
  return `<pkg:package xmlns:pkg="${PKG}">${[
    part(
      "/_rels/.rels",
      "application/vnd.openxmlformats-package.relationships+xml",
      `<Relationships xmlns="${REL}"><Relationship Id="root" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    part(
      "/word/document.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>Native document</w:t></w:r></w:p><w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
    ),
    part(
      "/word/_rels/document.xml.rels",
      "application/vnd.openxmlformats-package.relationships+xml",
      `<Relationships xmlns="${REL}"><Relationship Id="footer" Type="${R}/footer" Target="footer1.xml"/><Relationship Id="asset" Type="${R}/image" Target="media/image1.png"/></Relationships>`,
    ),
    part(
      "/word/footer1.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
      `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>${footer}</w:t></w:r></w:p></w:ftr>`,
    ),
    part("/word/media/image1.png", "image/png", "AQIDBA==", true),
  ].join("")}</pkg:package>`;
}

afterEach(() => vi.unstubAllGlobals());

describe("complete Word document package transport", () => {
  it("roundtrips native stories, relationships, section geometry and binary assets", () => {
    const original = wordDocumentOoxmlToFile(fixture());
    const flat = wordDocumentFileToOoxml(original);
    const restored = readWordPackage(wordDocumentOoxmlToFile(flat));
    const before = readWordPackage(original);
    expect([...restored.keys()].sort()).toEqual([...before.keys()].sort());
    expect(restored.get("word/media/image1.png")).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(wordXmlText(restored.get("word/footer1.xml")!)).toContain(
      "Original footer",
    );
    expect(wordXmlText(restored.get("word/document.xml")!)).toContain(
      'w:w="11906"',
    );
  });

  it("rejects a dangling relationship before the native import boundary", () => {
    const bad = fixture().replace(
      'Target="footer1.xml"',
      'Target="missing.xml"',
    );
    expect(() => wordDocumentOoxmlToFile(bad)).toThrow(
      /Missing relationship target/,
    );
  });

  it("rejects duplicate package names and XML entity expansion", () => {
    const bad = fixture().replace(
      'pkg:name="/word/footer1.xml"',
      'pkg:name="/word/document.xml"',
    );
    expect(() => wordDocumentOoxmlToFile(bad)).toThrow(
      /Invalid document package part/,
    );
    expect(() =>
      wordDocumentOoxmlToFile(`<!DOCTYPE foo [<!ENTITY x "bad">]>${fixture()}`),
    ).toThrow(/entities/);
  });

  it("queues the document import with complete story/section preservation options", () => {
    const insert = vi.fn();
    const context = {
      document: { insertFileFromBase64: insert },
    } as unknown as Word.RequestContext;
    const bytes = wordDocumentOoxmlToFile(fixture());
    insertWordDocumentFile(context, bytes);
    expect(insert).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      "Replace",
      WORD_DOCUMENT_IMPORT_OPTIONS,
    );
    expect(WORD_DOCUMENT_IMPORT_OPTIONS).toMatchObject({
      importCustomProperties: false,
      importCustomXmlParts: false,
    });
  });

  it("starts Word for Mac's proofing window once the import's sync has settled, failed or not", async () => {
    vi.useFakeTimers();
    try {
      let sync = () =>
        new Promise<void>((resolve) => setTimeout(resolve, 12_000));
      const context = {
        document: { insertFileFromBase64: vi.fn() },
        sync: () => sync(),
      } as unknown as Word.RequestContext;
      const queued = Date.now();
      insertWordDocumentFile(context, wordDocumentOoxmlToFile(fixture()));
      const importing = syncWordDocumentImport(context);
      await vi.advanceTimersByTimeAsync(12_000);
      await importing;
      expect(wordDocumentImportedAt()).toBe(queued + 12_000);

      sync = () =>
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("GeneralException")), 5_000),
        );
      insertWordDocumentFile(context, wordDocumentOoxmlToFile(fixture()));
      const failing = expect(syncWordDocumentImport(context)).rejects.toThrow(
        "GeneralException",
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await failing;
      expect(wordDocumentImportedAt()).toBe(queued + 17_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the exact original DOCX bytes in the string recovery envelope", () => {
    const bytes = wordDocumentOoxmlToFile(fixture());
    const value = encodeWordDocumentBackup({
      bytes,
      ooxml: fixture(),
      documentUrl: "file:///fixture.docx",
      fingerprint: "source",
    });
    expect(isWordDocumentBackup(value)).toBe(true);
    const decoded = decodeWordDocumentBackup(value);
    expect(decoded.bytes).toEqual(bytes);
    expect(decoded.documentUrl).toBe("file:///fixture.docx");
    expect(decoded.ooxml).toContain("Original footer");
    expect(isWordDocumentBackup(fixture())).toBe(false);
  });

  it("carries an in-place record next to the same original bytes and ignores a malformed one", () => {
    const bytes = wordDocumentOoxmlToFile(fixture());
    const snapshot = {
      bytes,
      ooxml: fixture(),
      documentUrl: "file:///fixture.docx",
      fingerprint: "source",
    };
    const op = {
      kind: "text" as const,
      ref: "b2",
      paragraph: 0,
      runs: [{ text: "New", bold: true, italic: false, underline: false }],
      original: [{ text: "Old", bold: false, italic: false, underline: false }],
      id: "{paragraph}",
      originalSignature: "before",
    };
    const regions = [{ start: "{before}", end: null, before: [0] }];
    const value = encodeWordDocumentBackup(snapshot, {
      v: 1,
      ops: [op],
      regions,
    });
    const updated = withWordInPlaceBackup(value, {
      v: 1,
      ops: [{ ...op, afterSignature: "after" }],
      regions: [{ ...regions[0], after: ["{paragraph}"] }],
    });
    expect(decodeWordDocumentBackup(updated).bytes).toEqual(bytes);
    expect(decodeWordInPlaceBackup(updated)).toEqual({
      documentUrl: "file:///fixture.docx",
      inPlace: {
        v: 1,
        ops: [{ ...op, afterSignature: "after" }],
        regions: [{ ...regions[0], after: ["{paragraph}"] }],
      },
    });
    for (const malformed of [
      { v: 1 as const, ops: [{ ...op, runs: "not runs" as never }], regions },
      { v: 1 as const, ops: [op], regions: [{ ...regions[0], before: [1] }] },
      { v: 1 as const, ops: [{ ...op, kind: "insert" as never }], regions },
    ])
      expect(
        decodeWordInPlaceBackup(encodeWordDocumentBackup(snapshot, malformed)),
      ).toEqual({ documentUrl: "file:///fixture.docx" });
    expect(decodeWordInPlaceBackup(encodeWordDocumentBackup(snapshot))).toEqual(
      { documentUrl: "file:///fixture.docx" },
    );
  });
});

function officeFile(
  bytes: Uint8Array,
  failure?: "slice" | "wrong-size" | "oversize",
) {
  const close = vi.fn((callback: () => void) => callback());
  const value = {
    size: failure === "oversize" ? 4 * 1024 * 1024 + 1 : bytes.length,
    sliceCount: 1,
    closeAsync: close,
    getSliceAsync: vi.fn((index: number, callback: (result: unknown) => void) =>
      callback(
        failure === "slice"
          ? { status: "failed" }
          : {
              status: "succeeded",
              value: {
                index,
                size:
                  failure === "wrong-size" ? bytes.length + 1 : bytes.length,
                data: Array.from(bytes),
              },
            },
      ),
    ),
  };
  const document = {
    url: "file:///fixture.docx",
    getFileAsync: vi.fn(
      (
        _type: unknown,
        _options: unknown,
        callback: (result: unknown) => void,
      ) => callback({ status: "succeeded", value }),
    ),
  };
  vi.stubGlobal("Office", {
    context: { document },
    FileType: { Compressed: "compressed" },
    AsyncResultStatus: { Succeeded: "succeeded" },
  });
  return { close, document };
}

describe("native complete-document capture", () => {
  it("closes the native file handle after reading all bytes", async () => {
    const bytes = wordDocumentOoxmlToFile(fixture());
    const host = officeFile(bytes);
    expect(await readWordDocumentFile()).toEqual(bytes);
    expect(host.close).toHaveBeenCalledOnce();
  });

  it.each(["slice", "wrong-size", "oversize"] as const)(
    "closes the native file handle after %s failure",
    async (failure) => {
      const host = officeFile(wordDocumentOoxmlToFile(fixture()), failure);
      await expect(readWordDocumentFile()).rejects.toThrow();
      expect(host.close).toHaveBeenCalledOnce();
    },
  );

  it("reports a DOCX with more parts than the pane handles as too large", () => {
    const bytes = wordDocumentOoxmlToFile(fixture());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    while (end > 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
    view.setUint16(end + 10, 2049, true);

    expect(() => readWordPackage(bytes)).toThrow(WordDocumentTooLargeError);
  });

  it("reports an oversized document as too large", async () => {
    officeFile(wordDocumentOoxmlToFile(fixture()), "oversize");
    await expect(readWordDocumentFile()).rejects.toBeInstanceOf(
      WordDocumentTooLargeError,
    );
  });

  it("stops waiting for a file Word does not hand over, and closes it when it arrives late", async () => {
    vi.useFakeTimers();
    try {
      const host = officeFile(wordDocumentOoxmlToFile(fixture()));
      let deliver: (() => void) | undefined;
      host.document.getFileAsync.mockImplementationOnce(
        (_type, _options, callback) => {
          deliver = () =>
            callback({
              status: "succeeded",
              value: { closeAsync: host.close },
            });
        },
      );
      const read = readWordDocumentFile();
      const rejected = expect(read).rejects.toBeInstanceOf(
        WordDocumentCaptureTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(WORD_FILE_OPEN_TIMEOUT_MS);
      await rejected;
      deliver?.();
      expect(host.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the file when a slice never arrives", async () => {
    vi.useFakeTimers();
    try {
      const bytes = wordDocumentOoxmlToFile(fixture());
      const host = officeFile(bytes);
      host.document.getFileAsync.mockImplementationOnce(
        (_type, _options, callback) =>
          callback({
            status: "succeeded",
            value: {
              size: bytes.length,
              sliceCount: 1,
              closeAsync: host.close,
              getSliceAsync: () => {},
            },
          }),
      );
      const read = readWordDocumentFile();
      const rejected = expect(read).rejects.toBeInstanceOf(
        WordDocumentCaptureTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
      expect(host.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up when the close after a stuck slice never answers either", async () => {
    vi.useFakeTimers();
    try {
      const bytes = wordDocumentOoxmlToFile(fixture());
      const host = officeFile(bytes);
      host.document.getFileAsync.mockImplementationOnce(
        (_type, _options, callback) =>
          callback({
            status: "succeeded",
            value: {
              size: bytes.length,
              sliceCount: 1,
              closeAsync: () => {},
              getSliceAsync: () => {},
            },
          }),
      );
      const read = readWordDocumentFile();
      const rejected = expect(read).rejects.toBeInstanceOf(
        WordDocumentCaptureTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(15_000 + 2_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("requests Office's maximum slice size so one read covers a supported document", async () => {
    const host = officeFile(wordDocumentOoxmlToFile(fixture()));
    await readWordDocumentFile();
    expect(host.document.getFileAsync).toHaveBeenCalledWith(
      "compressed",
      { sliceSize: 4 * 1024 * 1024 },
      expect.any(Function),
    );
  });

  it("computes the package fingerprint on first read and matches the snapshot fingerprint", async () => {
    officeFile(wordDocumentOoxmlToFile(fixture()));
    const captured = await captureWordDocumentPackage();
    expect(
      Object.getOwnPropertyDescriptor(captured, "fingerprint")?.get,
    ).toBeTypeOf("function");
    expect(captured.fingerprint).toBe(wordPackageFingerprint(captured.ooxml));
    expect(captured.fingerprint).toBe(captured.fingerprint);
  });

  it("includes changes outside the body in the stale-state fingerprint", async () => {
    officeFile(wordDocumentOoxmlToFile(fixture()));
    const before = await captureWordDocumentPackage();
    officeFile(wordDocumentOoxmlToFile(fixture("Later footer")));
    const after = await captureWordDocumentPackage();
    expect(before.fingerprint).not.toBe(after.fingerprint);
  });
});

describe("Word for Mac's proofing pass", () => {
  const SETTINGS =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml";
  const lang = (extra = "") => `<w:rPr><w:lang w:val="en-GB"${extra}/></w:rPr>`;
  const RELS = "application/vnd.openxmlformats-package.relationships+xml";
  const read = ({
    paragraph = `<w:p><w:r><w:t>Revenue grew.</w:t></w:r></w:p>`,
    settings = "",
  } = {}) =>
    `<pkg:package xmlns:pkg="${PKG}"><pkg:part pkg:name="/_rels/.rels" pkg:contentType="${RELS}"><pkg:xmlData><Relationships xmlns="${REL}"><Relationship Id="root" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"><pkg:xmlData><w:document xmlns:w="${W}"><w:body>${paragraph}</w:body></w:document></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/_rels/document.xml.rels" pkg:contentType="${RELS}"><pkg:xmlData><Relationships xmlns="${REL}"><Relationship Id="settings" Type="${R}/settings" Target="settings.xml"/></Relationships></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/settings.xml" pkg:contentType="${SETTINGS}"><pkg:xmlData><w:settings xmlns:w="${W}">${settings}</w:settings></pkg:xmlData></pkg:part></pkg:package>`;
  const tagged = (extra = "") =>
    read({
      paragraph: `<w:p w:rsidRPr="00DC4D6D"><w:pPr>${lang(extra)}</w:pPr><w:r w:rsidRPr="00DC4D6D">${lang(extra)}<w:t>Revenue grew.</w:t></w:r></w:p>`,
    });
  /** As Word for Mac exports a document with a content control's placeholder text: the glossary
   * document's own settings part comes before the main one. */
  const withGlossary = (main: string, glossary = "") =>
    read({ settings: main }).replace(
      '<pkg:part pkg:name="/word/document.xml"',
      `<pkg:part pkg:name="/word/glossary/settings.xml" pkg:contentType="${SETTINGS}"><pkg:xmlData><w:settings xmlns:w="${W}">${glossary}</w:settings></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/document.xml"`,
    );

  it("is done once Word marks spelling clean", () => {
    const clean = read({
      settings: `<w:proofState w:spelling="clean" w:grammar="clean"/>`,
    });
    expect(wordProofingComplete(clean)).toBe(true);
    expect(
      wordProofingComplete(
        wordDocumentFileToOoxml(wordDocumentOoxmlToFile(clean)),
      ),
    ).toBe(true);
    expect(wordProofingComplete(read())).toBe(false);
    expect(
      wordProofingComplete(
        read({
          settings: `<w:proofState w:spelling="dirty" w:grammar="clean"/>`,
        }),
      ),
    ).toBe(false);
  });

  it("reads the done mark from the main document's settings, not the glossary's", () => {
    const clean = `<w:proofState w:spelling="clean" w:grammar="clean"/>`;
    const glossaryFirst = withGlossary(clean);
    expect(glossaryFirst.indexOf("/word/glossary/settings.xml")).toBeLessThan(
      glossaryFirst.indexOf('"/word/settings.xml"'),
    );
    expect(wordProofingComplete(glossaryFirst)).toBe(true);
    expect(
      wordProofingComplete(
        wordDocumentFileToOoxml(wordDocumentOoxmlToFile(glossaryFirst)),
      ),
    ).toBe(true);
    expect(wordProofingComplete(withGlossary("", clean))).toBe(false);
  });

  it("tells Word's language tags apart from other changes", () => {
    const differ = (a: string, b: string) =>
      wordPackagesDifferInDetectedLanguageOnly({ ooxml: a }, { ooxml: b });
    expect(differ(read(), tagged())).toBe(true);
    expect(differ(read(), tagged(' w:eastAsia="ja-JP"'))).toBe(false);
    expect(
      differ(
        read(),
        read({ paragraph: `<w:p><w:r><w:t>Revenue fell.</w:t></w:r></w:p>` }),
      ),
    ).toBe(false);
  });

  it("compares each read once across the polls it takes part in", () => {
    const [first, second, third] = [read(), tagged(), tagged()].map(
      (ooxml) => ({ ooxml }),
    );
    vi.mocked(removeWordDetectedLanguages).mockClear();
    expect(wordPackagesDifferInDetectedLanguageOnly(first, second)).toBe(true);
    expect(wordPackagesDifferInDetectedLanguageOnly(second, third)).toBe(true);
    expect(removeWordDetectedLanguages).toHaveBeenCalledTimes(3);
  });

  it("leaves the fingerprint Apply and Revert compare seeing a language added later", () => {
    expect(wordPackageFingerprint(tagged())).not.toBe(
      wordPackageFingerprint(read()),
    );
  });
});
